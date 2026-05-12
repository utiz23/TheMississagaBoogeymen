import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  smallint,
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
 * player_name_snapshot: full real name from the loadout view title bar (e.g. "Evgeni Wanhg").
 * player_name_persona: short in-game persona name from the lobby state-2 / loadout left strip
 *   (e.g. "E. Wanhg"). Distinct from player_name_snapshot.
 * player_number: in-game jersey number from lobby state-2 / loadout left strip (e.g. 11).
 * is_captain: yellow ★ marker detected next to gamertag in lobby/loadout (V2 "Leader? Yes").
 */
export const playerLoadoutSnapshots = pgTable(
  'player_loadout_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    playerId: integer('player_id').references(() => players.id),
    gamertagSnapshot: text('gamertag_snapshot').notNull(),
    playerNameSnapshot: text('player_name_snapshot'),
    playerNamePersona: text('player_name_persona'),
    playerNumber: integer('player_number'),
    isCaptain: boolean('is_captain'),
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
 * tier: Elite | All Star | Specialist, classified from HSV color sample on the
 *   icon (red / blue / yellow respectively). NULL when not yet classified.
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
    tier: text('tier').$type<'Elite' | 'All Star' | 'Specialist'>(),
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
 * attribute_key: snake_case name from the Loadout View screen.
 *   Technique:  wrist_shot_accuracy, slap_shot_accuracy, speed, balance, agility
 *   Power:      wrist_shot_power, slap_shot_power, acceleration, puck_control, endurance
 *   Playstyle:  passing, offensive_awareness, body_checking, stick_checking, defensive_awareness
 *   Tenacity:   hand_eye, strength, durability, shot_blocking
 *   Tactics:    deking, faceoffs, discipline, fighting_skill
 *
 * raw_text: verbatim OCR string — useful for diagnosing collapsed attribute rows.
 * value: cleaned integer 0–99. NULL if OCR produced an unresolvable string.
 *   This is the DISPLAYED (post-buff) rating shown on the screen.
 * delta_value: signed buff/nerf chip (e.g. +5, -2). NULL when no Δ chip present.
 *   base_rating = value - delta_value (Δ is the buff added to the base).
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
    deltaValue: smallint('delta_value'),
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
