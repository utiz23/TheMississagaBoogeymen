# OCR Schema Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 11 new PostgreSQL tables that store OCR-captured game data as a non-destructive third evidence layer, keeping it completely separate from EA API canon and local tracking.

**Architecture:** Four new Drizzle schema files. `ocr-pipeline.ts` is the foundation — every OCR screenshot flows through its three tables (capture batches → extractions → per-field values). The other three files (`match-enrichments.ts`, `match-events.ts`, `player-loadout.ts`) each add a domain-specific enrichment layer that back-references `ocr_extractions`. All enrichment tables carry `review_status`; nothing is promoted into EA canon without a review pass. No existing tables are modified.

**Tech Stack:** Drizzle ORM (`drizzle-orm/pg-core`), PostgreSQL 16, TypeScript strict. Migration generated via `pnpm --filter db generate`, applied via `pnpm --filter db migrate`.

---

## Table Inventory

| Table | File | Purpose |
|---|---|---|
| `ocr_capture_batches` | `ocr-pipeline.ts` | One row per import session (e.g. one game's screenshots) |
| `ocr_extractions` | `ocr-pipeline.ts` | One row per screenshot/frame processed by the OCR CLI |
| `ocr_extraction_fields` | `ocr-pipeline.ts` | One row per parsed field from an extraction |
| `match_period_summaries` | `match-enrichments.ts` | Period-level goals/shots/faceoffs (Post-Game Box Score) |
| `match_shot_type_summaries` | `match-enrichments.ts` | Shot-type breakdown by category (Post-Game Net-Chart) |
| `match_events` | `match-events.ts` | Normalized event log (goals, shots, hits, penalties, faceoffs) |
| `match_goal_events` | `match-events.ts` | Goal detail: scorer, assists, goal number in game |
| `match_penalty_events` | `match-events.ts` | Penalty detail: infraction, type, culprit |
| `player_loadout_snapshots` | `player-loadout.ts` | Build header: class, height, weight, handedness, level |
| `player_loadout_x_factors` | `player-loadout.ts` | Up to 3 X-factors per loadout snapshot |
| `player_loadout_attributes` | `player-loadout.ts` | 23 individual attribute values per loadout snapshot |

## File Map

| Action | Path |
|---|---|
| Create | `packages/db/src/schema/ocr-pipeline.ts` |
| Create | `packages/db/src/schema/match-enrichments.ts` |
| Create | `packages/db/src/schema/match-events.ts` |
| Create | `packages/db/src/schema/player-loadout.ts` |
| Modify | `packages/db/src/schema/index.ts` |
| Generate | `packages/db/migrations/<hash>.sql` |

---

## OCR Screen Types Reference

Screens currently implemented in the `Game_Data_OCR` CLI are marked ✅. Others are documented targets — the schema supports them all so the pipeline can grow without a schema change.

| `screen_type` value | Source screen | Status |
|---|---|---|
| `pre_game_lobby_state_1` | Pre-Game Lobby state 1 | ✅ |
| `pre_game_lobby_state_2` | Pre-Game Lobby state 2 (jersey + player name) | ✅ |
| `player_loadout_view` | Player Loadout View | ✅ |
| `post_game_player_summary` | Post-Game Player Summary | ✅ |
| `in_game_clock` | In-Game HUD clock bar | future |
| `in_game_goal_state_1` | In-Game Goal overlay (scorer + goal count) | future |
| `in_game_goal_state_2` | In-Game Goal overlay (assists) | future |
| `post_game_box_score_goals` | Post-Game Box Score — Goals tab | future |
| `post_game_box_score_shots` | Post-Game Box Score — Shots tab | future |
| `post_game_box_score_faceoffs` | Post-Game Box Score — Faceoffs tab | future |
| `post_game_events` | Post-Game Events log (goals + penalties) | future |
| `post_game_action_tracker` | Post-Game Action Tracker (all/goals/shots/hits/penalties/faceoffs) | future |
| `post_game_net_chart` | Post-Game Net-Chart (shot types + shot map) | future |

---

### Task 1: OCR Pipeline Evidence Tables

**Files:**
- Create: `packages/db/src/schema/ocr-pipeline.ts`

These three tables are the prerequisite for everything else. `ocrExtractions.id` is the FK anchor for all enrichment tables.

Key design notes:
- `ocr_extractions.duplicate_of_extraction_id` is a self-referential FK. Drizzle requires `(): AnyPgColumn =>` lambda syntax to avoid circular-reference errors at module load time.
- `source_hash` stores a SHA-256 hex string for cross-batch deduplication. Nullable because hashing is optional for manual imports.
- `overall_confidence` is `numeric(5,4)` — stores 0.0000 to 1.0000 with four decimal places.
- `ocr_extraction_fields.entity_key` meaning by entity type: player → gamertag or slot-index string; team → `'home'` or `'away'`; match → null; event → sequential index string; loadout → null.

- [ ] **Step 1: Create `packages/db/src/schema/ocr-pipeline.ts`**

```typescript
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { type AnyPgColumn } from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { matches } from './matches.js'

export type OcrCaptureKind = 'video_frames' | 'manual_screenshots' | 'post_game_bundle'

export type OcrScreenType =
  | 'pre_game_lobby_state_1'
  | 'pre_game_lobby_state_2'
  | 'player_loadout_view'
  | 'post_game_player_summary'
  | 'in_game_clock'
  | 'in_game_goal_state_1'
  | 'in_game_goal_state_2'
  | 'post_game_box_score_goals'
  | 'post_game_box_score_shots'
  | 'post_game_box_score_faceoffs'
  | 'post_game_events'
  | 'post_game_action_tracker'
  | 'post_game_net_chart'

export type OcrTransformStatus = 'pending' | 'success' | 'error'
export type OcrReviewStatus = 'pending_review' | 'reviewed' | 'rejected'
export type OcrEntityType = 'match' | 'team' | 'player' | 'event' | 'loadout'
export type OcrFieldStatus = 'ok' | 'uncertain' | 'missing'

/**
 * Groups one game's worth of OCR captures into an import session.
 * match_id is nullable until reconciliation links the batch to a known match row.
 */
export const ocrCaptureBatches = pgTable('ocr_capture_batches', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  gameTitleId: integer('game_title_id')
    .notNull()
    .references(() => gameTitles.id),
  matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
  /** Filesystem directory or archive path containing source screenshots/frames. */
  sourceDirectory: text('source_directory'),
  captureKind: text('capture_kind').notNull().$type<OcrCaptureKind>(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
})

/**
 * One row per screenshot or video frame processed by the OCR CLI.
 * raw_result_json always preserved regardless of parse quality.
 * review_status guards promotion — nothing is trusted until 'reviewed'.
 */
export const ocrExtractions = pgTable(
  'ocr_extractions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    batchId: bigint('batch_id', { mode: 'number' })
      .notNull()
      .references(() => ocrCaptureBatches.id),
    /** Set after reconciliation links this extraction to a known match. */
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    screenType: text('screen_type').notNull().$type<OcrScreenType>(),
    sourcePath: text('source_path').notNull(),
    /** SHA-256 hex of the source file for cross-batch deduplication. */
    sourceHash: text('source_hash'),
    ocrBackend: text('ocr_backend').notNull().default('rapidocr'),
    /** Average OCR confidence across all detected regions (0.0000–1.0000). */
    overallConfidence: numeric('overall_confidence', { precision: 5, scale: 4 }),
    rawResultJson: jsonb('raw_result_json').notNull(),
    transformStatus: text('transform_status')
      .notNull()
      .$type<OcrTransformStatus>()
      .default('pending'),
    transformError: text('transform_error'),
    reviewStatus: text('review_status')
      .notNull()
      .$type<OcrReviewStatus>()
      .default('pending_review'),
    /** Points to the canonical extraction when this row is a detected duplicate. */
    duplicateOfExtractionId: bigint('duplicate_of_extraction_id', {
      mode: 'number',
    }).references((): AnyPgColumn => ocrExtractions.id),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ocr_extractions_batch_path_uniq').on(table.batchId, table.sourcePath),
    index('ocr_extractions_match_idx').on(table.matchId),
    index('ocr_extractions_review_idx').on(table.reviewStatus, table.transformStatus),
  ],
)

/**
 * One row per parsed field from an OCR extraction.
 * Granular confidence + status tracking lets review tooling surface uncertain
 * or missing fields without re-inspecting the whole extraction.
 *
 * entity_key semantics by entity_type:
 *   player  → gamertag string or slot index string ("0", "1", "silkyjoker85")
 *   team    → "home" or "away"
 *   match   → null (applies to the whole match)
 *   event   → sequential index string ("0", "1", ...)
 *   loadout → null (one loadout per extraction)
 */
export const ocrExtractionFields = pgTable(
  'ocr_extraction_fields',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    extractionId: bigint('extraction_id', { mode: 'number' })
      .notNull()
      .references(() => ocrExtractions.id),
    entityType: text('entity_type').notNull().$type<OcrEntityType>(),
    entityKey: text('entity_key'),
    fieldKey: text('field_key').notNull(),
    rawText: text('raw_text'),
    /** Typed parsed value: string, number, boolean, or object. */
    parsedValueJson: jsonb('parsed_value_json'),
    /** Per-field OCR confidence (0.0000–1.0000). */
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    status: text('status').notNull().$type<OcrFieldStatus>().default('ok'),
    /** Set when this field's value has been promoted into a canonical table. */
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
  },
  (table) => [
    index('ocr_extraction_fields_extraction_idx').on(table.extractionId),
    index('ocr_extraction_fields_promoted_idx').on(table.promotedAt),
  ],
)

export type OcrCaptureBatch = typeof ocrCaptureBatches.$inferSelect
export type NewOcrCaptureBatch = typeof ocrCaptureBatches.$inferInsert
export type OcrExtraction = typeof ocrExtractions.$inferSelect
export type NewOcrExtraction = typeof ocrExtractions.$inferInsert
export type OcrExtractionField = typeof ocrExtractionFields.$inferSelect
export type NewOcrExtractionField = typeof ocrExtractionFields.$inferInsert
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @eanhl/db build
```

Expected: exits 0 with no errors. If you see `AnyPgColumn` import errors, confirm the import line reads `import { type AnyPgColumn } from 'drizzle-orm/pg-core'` (type-only import, same module as the rest).

---

### Task 2: Match Enrichment Tables

**Files:**
- Create: `packages/db/src/schema/match-enrichments.ts`

Key design notes:
- `match_period_summaries`: `(match_id, period_number, source)` is the unique key. Multiple sources for the same period are intentional — EA might supply totals-only while OCR supplies per-period splits.
- `match_shot_type_summaries`: `period_number` uses -1 as a sentinel for "full-game aggregate." This avoids a COALESCE expression index while still enabling a clean 4-column unique constraint. The Net-Chart screen in the OCR document provides full-game shot type data by default; per-period filtering is a future extension.

- [ ] **Step 1: Create `packages/db/src/schema/match-enrichments.ts`**

```typescript
import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { matches } from './matches.js'
import { ocrExtractions } from './ocr-pipeline.js'

export type EnrichmentSource = 'ea' | 'ocr' | 'manual'

/**
 * Period-level team totals per match.
 * Sourced from the Post-Game Box Score screens (three tabs: Goals, Shots, Faceoffs).
 *
 * period_number: 1=1st, 2=2nd, 3=3rd, 4=OT, 5=OT2, etc.
 * period_label: display string as captured ('1st', '2nd', '3rd', 'OT', 'OT2').
 * All stat columns are nullable — OCR may capture only one tab at a time.
 */
export const matchPeriodSummaries = pgTable(
  'match_period_summaries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    periodNumber: integer('period_number').notNull(),
    periodLabel: text('period_label').notNull(),
    goalsFor: integer('goals_for'),
    goalsAgainst: integer('goals_against'),
    shotsFor: integer('shots_for'),
    shotsAgainst: integer('shots_against'),
    faceoffsFor: integer('faceoffs_for'),
    faceoffsAgainst: integer('faceoffs_against'),
    source: text('source').notNull().$type<EnrichmentSource>(),
    ocrExtractionId: bigint('ocr_extraction_id', { mode: 'number' }).references(
      () => ocrExtractions.id,
    ),
  },
  (table) => [
    uniqueIndex('match_period_summaries_uniq').on(
      table.matchId,
      table.periodNumber,
      table.source,
    ),
    index('match_period_summaries_match_idx').on(table.matchId),
  ],
)

/**
 * Shot-type breakdown per match team side, from the Post-Game Net-Chart screen.
 *
 * Net-Chart exposes: Total, Wrist, Slap, Backhand, Snap, Deflections, PP shots.
 * team_side = 'for' means BGM shots; 'against' means opponent shots.
 *
 * period_number: -1 = full-game aggregate (the default from Net-Chart's "All Periods"
 * view). Real period values (1, 2, 3, 4...) will be populated once per-period
 * filtering is implemented in the OCR parser.
 */
export const matchShotTypeSummaries = pgTable(
  'match_shot_type_summaries',
  {
    id: serial('id').primaryKey(),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    /** 'for' = BGM team shots. 'against' = opponent shots. */
    teamSide: text('team_side').notNull().$type<'for' | 'against'>(),
    /** -1 = full-game aggregate. 1/2/3/4... = specific period. */
    periodNumber: integer('period_number').notNull().default(-1),
    periodLabel: text('period_label'),
    totalShots: integer('total_shots'),
    wristShots: integer('wrist_shots'),
    slapShots: integer('slap_shots'),
    backhandShots: integer('backhand_shots'),
    snapShots: integer('snap_shots'),
    deflections: integer('deflections'),
    powerPlayShots: integer('power_play_shots'),
    source: text('source').notNull().$type<EnrichmentSource>(),
    ocrExtractionId: bigint('ocr_extraction_id', { mode: 'number' }).references(
      () => ocrExtractions.id,
    ),
  },
  (table) => [
    uniqueIndex('match_shot_type_summaries_uniq').on(
      table.matchId,
      table.teamSide,
      table.periodNumber,
      table.source,
    ),
    index('match_shot_type_summaries_match_idx').on(table.matchId),
  ],
)

export type MatchPeriodSummary = typeof matchPeriodSummaries.$inferSelect
export type NewMatchPeriodSummary = typeof matchPeriodSummaries.$inferInsert
export type MatchShotTypeSummary = typeof matchShotTypeSummaries.$inferSelect
export type NewMatchShotTypeSummary = typeof matchShotTypeSummaries.$inferInsert
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @eanhl/db build
```

Expected: exits 0.

---

### Task 3: Match Event Tables

**Files:**
- Create: `packages/db/src/schema/match-events.ts`

Key design notes:
- `match_goal_events` and `match_penalty_events` use `event_id` as their PK — a 1:1 extension of `match_events`. Same pattern as EA's per-match detail tables.
- `x` / `y` are rink coordinates from the Action Tracker event map. `rink_zone` (`'offensive'`, `'defensive'`, `'neutral'`) is a derived label added during human review.
- `goal_number_in_game` is the "player's Nth goal of this game" indicator shown on the In-Game Goal overlay (e.g., "2nd Goal").
- `actor_gamertag_snapshot` / `target_gamertag_snapshot` always persist the raw OCR string — even after `actor_player_id` is resolved, the snapshot stays as audit evidence.
- `EnrichmentSource` and `OcrReviewStatus` are imported as types from sibling files. Both files must exist before this one compiles.

- [ ] **Step 1: Create `packages/db/src/schema/match-events.ts`**

```typescript
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { matches } from './matches.js'
import { players } from './players.js'
import { ocrExtractions, type OcrReviewStatus } from './ocr-pipeline.js'
import { type EnrichmentSource } from './match-enrichments.js'

export type MatchEventType = 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'
export type MatchEventTeamSide = 'for' | 'against'

/**
 * Normalized event log per match.
 * Sources: Post-Game Events screen, Post-Game Action Tracker, In-Game Goal overlays.
 *
 * actor / target identity is nullable until a review pass resolves gamertag snapshots
 * to known players rows. Snapshots survive regardless of resolution state.
 *
 * x / y: floating-point rink coordinates from the Action Tracker event map.
 *   The in-game map uses a marker grid; store the raw numeric offset.
 *   rink_zone is added during review: 'offensive' | 'defensive' | 'neutral'.
 *
 * clock: time remaining in the period as shown in-game (MM:SS string, e.g. '14:23').
 */
export const matchEvents = pgTable(
  'match_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    periodNumber: integer('period_number').notNull(),
    periodLabel: text('period_label').notNull(),
    clock: text('clock'),
    eventType: text('event_type').notNull().$type<MatchEventType>(),
    teamSide: text('team_side').notNull().$type<MatchEventTeamSide>(),
    /** Team abbreviation as shown in the OCR capture (e.g. 'BGM', 'SHK'). */
    teamAbbreviation: text('team_abbreviation'),
    actorPlayerId: integer('actor_player_id').references(() => players.id),
    actorGamertagSnapshot: text('actor_gamertag_snapshot'),
    targetPlayerId: integer('target_player_id').references(() => players.id),
    targetGamertagSnapshot: text('target_gamertag_snapshot'),
    /** Free-form event detail string (e.g. shot type, hit sub-type). */
    eventDetail: text('event_detail'),
    x: numeric('x', { precision: 6, scale: 2 }),
    y: numeric('y', { precision: 6, scale: 2 }),
    rinkZone: text('rink_zone'),
    source: text('source').notNull().$type<EnrichmentSource>(),
    ocrExtractionId: bigint('ocr_extraction_id', { mode: 'number' }).references(
      () => ocrExtractions.id,
    ),
    reviewStatus: text('review_status')
      .notNull()
      .$type<OcrReviewStatus>()
      .default('pending_review'),
  },
  (table) => [
    index('match_events_match_idx').on(table.matchId),
    index('match_events_match_type_idx').on(table.matchId, table.eventType),
    check(
      'match_events_event_type_check',
      sql`${table.eventType} IN ('goal', 'shot', 'hit', 'penalty', 'faceoff')`,
    ),
    check(
      'match_events_team_side_check',
      sql`${table.teamSide} IN ('for', 'against')`,
    ),
  ],
)

/**
 * Goal-specific detail for match_events rows where event_type = 'goal'.
 * event_id is both PK and FK — 1:1 extension of match_events.
 *
 * scorer_snapshot / *_assist_snapshot: verbatim OCR strings, preserved permanently.
 * *_player_id: nullable until identity review links them to players rows.
 * goal_number_in_game: "player's Nth goal of this game" from the In-Game Goal overlay.
 */
export const matchGoalEvents = pgTable('match_goal_events', {
  eventId: bigint('event_id', { mode: 'number' })
    .primaryKey()
    .references(() => matchEvents.id),
  scorerPlayerId: integer('scorer_player_id').references(() => players.id),
  scorerSnapshot: text('scorer_snapshot').notNull(),
  goalNumberInGame: integer('goal_number_in_game'),
  primaryAssistPlayerId: integer('primary_assist_player_id').references(() => players.id),
  primaryAssistSnapshot: text('primary_assist_snapshot'),
  secondaryAssistPlayerId: integer('secondary_assist_player_id').references(() => players.id),
  secondaryAssistSnapshot: text('secondary_assist_snapshot'),
})

/**
 * Penalty-specific detail for match_events rows where event_type = 'penalty'.
 * event_id is both PK and FK — 1:1 extension of match_events.
 *
 * infraction: the call as shown in the Events screen ('Tripping', 'Fighting',
 *   'High-sticking'). Stored verbatim.
 * penalty_type: 'Major' or 'Minor' as shown in the Events screen.
 * minutes: 2 for minor, 5 for major. Nullable because OCR may not read it cleanly.
 */
export const matchPenaltyEvents = pgTable('match_penalty_events', {
  eventId: bigint('event_id', { mode: 'number' })
    .primaryKey()
    .references(() => matchEvents.id),
  culpritPlayerId: integer('culprit_player_id').references(() => players.id),
  culpritSnapshot: text('culprit_snapshot').notNull(),
  infraction: text('infraction').notNull(),
  penaltyType: text('penalty_type').notNull(),
  minutes: integer('minutes'),
})

export type MatchEvent = typeof matchEvents.$inferSelect
export type NewMatchEvent = typeof matchEvents.$inferInsert
export type MatchGoalEvent = typeof matchGoalEvents.$inferSelect
export type NewMatchGoalEvent = typeof matchGoalEvents.$inferInsert
export type MatchPenaltyEvent = typeof matchPenaltyEvents.$inferSelect
export type NewMatchPenaltyEvent = typeof matchPenaltyEvents.$inferInsert
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @eanhl/db build
```

Expected: exits 0.

---

### Task 4: Player Loadout Tables

**Files:**
- Create: `packages/db/src/schema/player-loadout.ts`

Key design notes:
- `player_loadout_snapshots` is build/profile data, not match performance data. Do NOT link into `player_match_stats` or `ea_member_season_stats`.
- `player_id` is nullable until review resolves `gamertag_snapshot` to a known `players` row.
- `player_level_raw` stores the verbatim OCR string (e.g. `'P2LVL40'`). `player_level_number` is the cleaned integer (e.g. `40`). NULL if parsing failed — do not guess.
- `player_loadout_x_factors.slot_index`: 0, 1, 2. Up to 3 X-factors per loadout.
- `player_loadout_attributes.attribute_key` uses the 23 snake_case keys listed in the comment below. `value` is 0–99; NULL if OCR produced a collapsed/ambiguous string.
- `player_loadout_attributes` has no unique constraint beyond `(loadout_snapshot_id, attribute_key)`. Re-running OCR on the same screenshot should update the existing row via the import script, not insert a duplicate.

Known attribute keys:
```
Technique:  wrist_shot_accuracy, slap_shot_accuracy, speed, balance, agility
Power:      wrist_shot_power, slap_shot_power, acceleration, puck_control, endurance
Playstyle:  passing, offensive_awareness, body_checking, stick_checking, defensive_awareness
Tenacity:   hand_eye, strength, durability, shot_blocking
Tactics:    deking, faceoffs, discipline, fighting_skill
```

- [ ] **Step 1: Create `packages/db/src/schema/player-loadout.ts`**

```typescript
import {
  bigint,
  bigserial,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { players } from './players.js'
import { gameTitles } from './game-titles.js'
import { matches } from './matches.js'
import { ocrExtractions, type OcrReviewStatus } from './ocr-pipeline.js'

/**
 * Build/loadout snapshot captured from Pre-Game Lobby or Player Loadout View screens.
 * One row per (player, capture) — not deduplicated across games because builds can
 * change between sessions.
 *
 * player_id: nullable until identity review links gamertag_snapshot to players.
 * match_id: nullable until batch reconciliation links the snapshot to a match.
 * player_level_raw: verbatim OCR string (e.g. 'P2LVL40').
 * player_level_number: cleaned integer (e.g. 40). NULL if parsing failed.
 * handedness: 'Left' or 'Right' as displayed in the loadout screen.
 */
export const playerLoadoutSnapshots = pgTable(
  'player_loadout_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id').references(() => players.id),
    gamertagSnapshot: text('gamertag_snapshot').notNull(),
    playerNameSnapshot: text('player_name_snapshot'),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    sourceExtractionId: bigint('source_extraction_id', { mode: 'number' })
      .notNull()
      .references(() => ocrExtractions.id),
    position: text('position'),
    buildClass: text('build_class'),
    heightText: text('height_text'),
    weightLbs: integer('weight_lbs'),
    handedness: text('handedness'),
    playerLevelRaw: text('player_level_raw'),
    playerLevelNumber: integer('player_level_number'),
    platform: text('platform'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    reviewStatus: text('review_status')
      .notNull()
      .$type<OcrReviewStatus>()
      .default('pending_review'),
  },
  (table) => [
    index('player_loadout_snapshots_player_idx').on(table.playerId),
    index('player_loadout_snapshots_match_idx').on(table.matchId),
  ],
)

/**
 * Up to 3 X-factors per loadout snapshot (slot_index 0, 1, 2).
 * x_factor_name is the verbatim OCR string (e.g. 'Tape-to-Tape', 'Puck on a String').
 */
export const playerLoadoutXFactors = pgTable(
  'player_loadout_x_factors',
  {
    id: serial('id').primaryKey(),
    loadoutSnapshotId: bigint('loadout_snapshot_id', { mode: 'number' })
      .notNull()
      .references(() => playerLoadoutSnapshots.id),
    slotIndex: integer('slot_index').notNull(),
    xFactorName: text('x_factor_name').notNull(),
  },
  (table) => [
    uniqueIndex('player_loadout_x_factors_snapshot_slot_uniq').on(
      table.loadoutSnapshotId,
      table.slotIndex,
    ),
  ],
)

/**
 * Individual attribute values per loadout snapshot (23 known keys across 5 groups).
 * attribute_key: snake_case name from the Loadout View screen (see plan for full list).
 * raw_text: verbatim OCR string — useful for diagnosing collapsed attribute rows.
 * value: cleaned integer 0–99. NULL if OCR produced an unresolvable string.
 * confidence: per-field OCR confidence (0.0000–1.0000) from the OCR backend.
 */
export const playerLoadoutAttributes = pgTable(
  'player_loadout_attributes',
  {
    id: serial('id').primaryKey(),
    loadoutSnapshotId: bigint('loadout_snapshot_id', { mode: 'number' })
      .notNull()
      .references(() => playerLoadoutSnapshots.id),
    attributeKey: text('attribute_key').notNull(),
    rawText: text('raw_text'),
    value: integer('value'),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
  },
  (table) => [
    uniqueIndex('player_loadout_attributes_snapshot_key_uniq').on(
      table.loadoutSnapshotId,
      table.attributeKey,
    ),
  ],
)

export type PlayerLoadoutSnapshot = typeof playerLoadoutSnapshots.$inferSelect
export type NewPlayerLoadoutSnapshot = typeof playerLoadoutSnapshots.$inferInsert
export type PlayerLoadoutXFactor = typeof playerLoadoutXFactors.$inferSelect
export type NewPlayerLoadoutXFactor = typeof playerLoadoutXFactors.$inferInsert
export type PlayerLoadoutAttribute = typeof playerLoadoutAttributes.$inferSelect
export type NewPlayerLoadoutAttribute = typeof playerLoadoutAttributes.$inferInsert
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @eanhl/db build
```

Expected: exits 0.

---

### Task 5: Wire Schema Index + Generate and Apply Migration

**Files:**
- Modify: `packages/db/src/schema/index.ts`
- Generate: `packages/db/migrations/<hash>.sql`

- [ ] **Step 1: Add the four new exports to `packages/db/src/schema/index.ts`**

Append these four lines to the end of the existing file:

```typescript
export * from './ocr-pipeline.js'
export * from './match-enrichments.js'
export * from './match-events.js'
export * from './player-loadout.js'
```

The full file should now be:

```typescript
export * from './game-titles.js'
export * from './content-seasons.js'
export * from './ingestion-log.js'
export * from './raw-payloads.js'
export * from './raw-member-stats-payloads.js'
export * from './matches.js'
export * from './players.js'
export * from './player-profiles.js'
export * from './player-archetype.js'
export * from './accounts.js'
export * from './player-match-stats.js'
export * from './opponent-player-match-stats.js'
export * from './aggregates.js'
export * from './ea-member-season-stats.js'
export * from './historical-player-season-stats.js'
export * from './historical-club-member-season-stats.js'
export * from './historical-club-team-stats.js'
export * from './club-seasonal-stats.js'
export * from './opponent-clubs.js'
export * from './club-season-rank.js'
export * from './ocr-pipeline.js'
export * from './match-enrichments.js'
export * from './match-events.js'
export * from './player-loadout.js'
```

- [ ] **Step 2: Build the db package**

```bash
pnpm --filter @eanhl/db build
```

Expected: exits 0. If there are any export-name collisions (two files exporting the same identifier), resolve them before continuing.

- [ ] **Step 3: Generate the migration**

```bash
pnpm --filter db generate
```

Expected: a new migration file at `packages/db/migrations/0028_*.sql` (or the next available number). Drizzle will prompt about the functional index if it does not recognise expression columns in `.on()` — accept the default action.

- [ ] **Step 4: Verify the generated migration SQL**

```bash
cat packages/db/migrations/0028_*.sql
```

Confirm the file contains `CREATE TABLE` statements for all 11 tables in this order (or any order — Drizzle respects FK dependencies automatically):

```
ocr_capture_batches
ocr_extractions
ocr_extraction_fields
match_period_summaries
match_shot_type_summaries
match_events
match_goal_events
match_penalty_events
player_loadout_snapshots
player_loadout_x_factors
player_loadout_attributes
```

Also confirm you see:
- A self-referential FK on `ocr_extractions.duplicate_of_extraction_id → ocr_extractions.id`
- Unique indexes: `ocr_extractions_batch_path_uniq`, `match_period_summaries_uniq`, `match_shot_type_summaries_uniq`, `player_loadout_x_factors_snapshot_slot_uniq`, `player_loadout_attributes_snapshot_key_uniq`
- Check constraints on `match_events`: `event_type` and `team_side`

If any table is absent, verify its schema file is exported from `index.ts` and re-run `generate`.

- [ ] **Step 5: Apply the migration**

```bash
set -a && source .env && set +a
pnpm --filter db migrate
```

Expected: migration runs without errors. If it fails on the self-referential FK, check that `ocr_extractions` is created before the FK is added (Drizzle handles this via `ALTER TABLE ADD CONSTRAINT` after the initial `CREATE TABLE`).

- [ ] **Step 6: Verify all 11 tables exist**

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'ocr_capture_batches',
    'ocr_extractions',
    'ocr_extraction_fields',
    'match_period_summaries',
    'match_shot_type_summaries',
    'match_events',
    'match_goal_events',
    'match_penalty_events',
    'player_loadout_snapshots',
    'player_loadout_x_factors',
    'player_loadout_attributes'
  )
ORDER BY table_name;"
```

Expected: 11 rows. If fewer, a migration step was skipped — re-run `pnpm --filter db migrate`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/ocr-pipeline.ts \
        packages/db/src/schema/match-enrichments.ts \
        packages/db/src/schema/match-events.ts \
        packages/db/src/schema/player-loadout.ts \
        packages/db/src/schema/index.ts \
        packages/db/migrations/
git commit -m "feat(db): add OCR evidence + event + loadout schema (11 tables)"
```

---

## Self-Review

### Spec Coverage

| Requirement from investigation doc | Task |
|---|---|
| `ocr_capture_batches` | Task 1 |
| `ocr_extractions` with raw JSON, review status, transform status | Task 1 |
| `ocr_extraction_fields` with per-field confidence + status | Task 1 |
| Self-referential duplicate FK on `ocr_extractions` | Task 1 |
| `match_period_summaries` (period goals/shots/faceoffs) | Task 2 |
| `match_shot_type_summaries` (Net-Chart shot-type breakdown) | Task 2 |
| `match_events` with spatial x/y/rink_zone coordinates | Task 3 |
| `match_goal_events` (scorer, assists, goal-number-in-game) | Task 3 |
| `match_penalty_events` (infraction, type, culprit) | Task 3 |
| `player_loadout_snapshots` (build class, height, weight, handedness, level) | Task 4 |
| `player_loadout_x_factors` (up to 3 X-factors) | Task 4 |
| `player_loadout_attributes` (23 named attribute keys) | Task 4 |
| Schema index wiring | Task 5 |
| Migration generation + application | Task 5 |
| DB verification | Task 5 |

**Screens from `docs/Game OCR Document.md` and where they land:**

| Screen | Tables populated |
|---|---|
| Pre-Game Lobby (state 1 + 2) | `ocr_extractions`, `ocr_extraction_fields`, `player_loadout_snapshots` |
| Player Loadout View | `ocr_extractions`, `player_loadout_snapshots`, `player_loadout_x_factors`, `player_loadout_attributes` |
| Post-Game Player Summary | `ocr_extractions`, `ocr_extraction_fields` → promotes to `player_match_stats` via future review step |
| In-Game Clock | `ocr_extractions`, `ocr_extraction_fields` |
| In-Game Goal overlays (state 1 + 2) | `ocr_extractions`, `match_events`, `match_goal_events` |
| Post-Game Box Score (Goals/Shots/Faceoffs tabs) | `ocr_extractions`, `match_period_summaries` |
| Post-Game Events | `ocr_extractions`, `match_events`, `match_goal_events`, `match_penalty_events` |
| Post-Game Action Tracker | `ocr_extractions`, `match_events` (with x/y coordinates) |
| Post-Game Net-Chart | `ocr_extractions`, `match_shot_type_summaries` |
| Post-Game Event Map — Faceoffs | `ocr_extractions`, `match_events` |

### Placeholder Scan

No TBD, TODO, or "similar to above" entries present. All column types are explicit. All FK references point to tables defined in earlier tasks or existing schema files.

### Type Consistency

- `OcrReviewStatus` — defined once in `ocr-pipeline.ts`, imported as a type in `match-events.ts` and `player-loadout.ts`. ✓
- `EnrichmentSource` — defined once in `match-enrichments.ts`, imported as a type in `match-events.ts`. ✓
- FK column types: `bigint(..., { mode: 'number' })` for all FKs referencing `bigserial` PKs (`matches.id`, `ocrCaptureBatches.id`, `ocrExtractions.id`, `matchEvents.id`, `playerLoadoutSnapshots.id`). `integer` for FKs referencing `serial` PKs (`players.id`, `gameTitles.id`). ✓
- `period_number = -1` sentinel documented in both the schema comment and the plan. ✓
- All 23 attribute keys listed in Task 4 are the exact snake_case equivalents of the 5-group, 23-attribute list from the Loadout View screen in the Game OCR Document. ✓
