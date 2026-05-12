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
    /**
     * Confidence of the (x, y) derivation:
     *   'interpolated' — pixel position was inside the convex hull of the
     *      calibration landmarks; RBF prediction is bounded by the
     *      enclosing landmarks and high-confidence.
     *   'extrapolated' — pixel position was outside the landmark hull;
     *      RBF extrapolated and TRE is unbounded. UI should treat these
     *      markers as low-confidence (dotted outline / muted).
     * Null when (x, y) is null OR derived via a non-OCR pipeline.
     * See `docs/ocr/marker-extraction-research.md` for the calibration
     * method and hull-coverage statistics.
     */
    positionConfidence: text('position_confidence').$type<
      'interpolated' | 'extrapolated'
    >(),
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
    check(
      'match_events_position_confidence_check',
      sql`${table.positionConfidence} IS NULL OR ${table.positionConfidence} IN ('interpolated', 'extrapolated')`,
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
