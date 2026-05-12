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
import { ocrExtractions, type OcrReviewStatus } from './ocr-pipeline.js'

export type EnrichmentSource = 'ea' | 'ocr' | 'manual'

/**
 * Period-level team totals per match.
 * Sourced from the Post-Game Box Score screens (three tabs: Goals, Shots, Faceoffs).
 *
 * period_number: 1=1st, 2=2nd, 3=3rd, 4=OT, 5=OT2, etc.
 * period_label: display string as captured ('1st', '2nd', '3rd', 'OT', 'OT2').
 * All stat columns are nullable — OCR may capture only one tab at a time.
 * Multiple sources for the same period are intentional (EA totals-only vs OCR per-period).
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
    reviewStatus: text('review_status')
      .notNull()
      .$type<OcrReviewStatus>()
      .default('pending_review'),
    /** Direction BGM attacks in this period, as drawn in the in-game art. */
    bgmAttackDirection: text('bgm_attack_direction').$type<'left' | 'right'>(),
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
    reviewStatus: text('review_status')
      .notNull()
      .$type<OcrReviewStatus>()
      .default('pending_review'),
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
