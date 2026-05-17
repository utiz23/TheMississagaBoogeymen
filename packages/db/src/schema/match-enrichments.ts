import {
  bigint,
  bigserial,
  index,
  integer,
  numeric,
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
    uniqueIndex('match_period_summaries_uniq').on(table.matchId, table.periodNumber, table.source),
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

/**
 * Per-dot face-off outcomes per match × period, from the post-game Faceoff
 * Map screen's rink diagram. One row per (match_id, period_number, dot_id,
 * source). All 9 dots are inserted whenever a faceoff_map screen is processed
 * for a period; away_wins/home_wins are nullable when the OCR ROI couldn't be
 * read confidently.
 *
 * dot_id is an absolute rink position (independent of attacking direction):
 *   lz_top, lz_bot      — left  end-zone dots
 *   lnz_top, lnz_bot    — left  neutral-zone dots
 *   center              — center-ice dot
 *   rnz_top, rnz_bot    — right neutral-zone dots
 *   rz_top, rz_bot      — right end-zone dots
 *
 * period_number: 1..6 for periods (incl. OT); -1 for All-Periods aggregate.
 *
 * home_wins / away_wins keep the EA UI's H/A orientation. BGM↔home/away
 * resolution happens at read time via matches.bgmWasHome — mirrors how
 * ActionTrackerMap handles team_side.
 */
export const matchFaceoffDots = pgTable(
  'match_faceoff_dots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    periodNumber: integer('period_number').notNull(),
    periodLabel: text('period_label'),
    dotId: text('dot_id')
      .notNull()
      .$type<
        | 'lz_top'
        | 'lz_bot'
        | 'lnz_top'
        | 'lnz_bot'
        | 'center'
        | 'rnz_top'
        | 'rnz_bot'
        | 'rz_top'
        | 'rz_bot'
      >(),
    awayWins: integer('away_wins'),
    homeWins: integer('home_wins'),
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
    uniqueIndex('match_faceoff_dots_uniq').on(
      table.matchId,
      table.periodNumber,
      table.dotId,
      table.source,
    ),
    index('match_faceoff_dots_match_idx').on(table.matchId),
  ],
)

/**
 * Per-period zone-split faceoff totals (offensive / defensive zone) plus the
 * overall win % for both sides, from the post-game Faceoff Map's text panel.
 * One row per (match_id, period_number, team_side, source).
 *
 * team_side = 'home' | 'away' matches the EA UI labels (not BGM-perspective
 * for/against) because the "offensive zone" / "defensive zone" labels are
 * team-relative — they don't map cleanly into the F/A axis used by
 * matchPeriodSummaries. Frontend resolves to BGM-perspective via
 * matches.bgmWasHome.
 *
 * overall_win_pct: numeric(5,2) per CLAUDE.md convention. Other fields ints.
 */
export const matchFaceoffZoneSummaries = pgTable(
  'match_faceoff_zone_summaries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    periodNumber: integer('period_number').notNull(),
    periodLabel: text('period_label'),
    teamSide: text('team_side').notNull().$type<'home' | 'away'>(),
    overallWinPct: numeric('overall_win_pct', { precision: 5, scale: 2 }),
    offensiveZoneWins: integer('offensive_zone_wins'),
    offensiveZoneTotal: integer('offensive_zone_total'),
    defensiveZoneWins: integer('defensive_zone_wins'),
    defensiveZoneTotal: integer('defensive_zone_total'),
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
    uniqueIndex('match_faceoff_zone_summaries_uniq').on(
      table.matchId,
      table.periodNumber,
      table.teamSide,
      table.source,
    ),
    index('match_faceoff_zone_summaries_match_idx').on(table.matchId),
  ],
)

export type MatchPeriodSummary = typeof matchPeriodSummaries.$inferSelect
export type NewMatchPeriodSummary = typeof matchPeriodSummaries.$inferInsert
export type MatchShotTypeSummary = typeof matchShotTypeSummaries.$inferSelect
export type NewMatchShotTypeSummary = typeof matchShotTypeSummaries.$inferInsert
export type MatchFaceoffDot = typeof matchFaceoffDots.$inferSelect
export type NewMatchFaceoffDot = typeof matchFaceoffDots.$inferInsert
export type MatchFaceoffZoneSummary = typeof matchFaceoffZoneSummaries.$inferSelect
export type NewMatchFaceoffZoneSummary = typeof matchFaceoffZoneSummaries.$inferInsert
