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
import { sql } from 'drizzle-orm'
import { gameTitles } from './game-titles.js'
import { players } from './players.js'

export type HistoricalClubMemberRoleGroup = 'skater' | 'goalie'
export type HistoricalClubMemberGameMode = '6s' | '3s'
export type HistoricalClubMemberReviewStatus =
  | 'pending_review'
  | 'reviewed'
  | 'rejected'
  | 'needs_identity_match'
export type HistoricalClubMemberSourceReviewStatus =
  | 'pending_review'
  | 'reviewed'
  | 'rejected'

/**
 * Club-scoped historical member-leaderboard rows from archived screenshots.
 *
 * Distinct from `historical_player_season_stats`:
 *   - `historical_player_season_stats` = player-card season totals (may include
 *     play for other clubs).
 *   - `historical_club_member_season_stats` = club-scoped totals only, sourced
 *     from the in-game CLUBS → members table.
 *
 * The two tables live side by side. Never UPSERT across them. Never blend.
 *
 * Grain: one row per (game_title_id, game_mode, role_group, identity).
 * Identity = matched `player_id` when available, else `lower(gamertag_snapshot)`
 * for unmatched rows.
 */
export const historicalClubMemberSeasonStats = pgTable(
  'historical_club_member_season_stats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    gameMode: text('game_mode').$type<HistoricalClubMemberGameMode>().notNull(),
    roleGroup: text('role_group').$type<HistoricalClubMemberRoleGroup>().notNull(),

    // Identity. `player_id` is nullable to allow capture of unmatched members.
    playerId: integer('player_id').references(() => players.id),
    gamertagSnapshot: text('gamertag_snapshot').notNull(),
    /** In-game player name from the PLAYER NAME column, e.g. "Lane Hutson". */
    playerNameSnapshot: text('player_name_snapshot'),

    // Skater metric columns. Nullable — populated only as sources arrive.
    skaterGp: integer('skater_gp'),
    goalieGp: integer('goalie_gp'),
    goals: integer('goals'),
    assists: integer('assists'),
    points: integer('points'),
    plusMinus: integer('plus_minus'),
    pim: integer('pim'),
    hits: integer('hits'),
    ppGoals: integer('pp_goals'),
    shGoals: integer('sh_goals'),
    dnfPct: numeric('dnf_pct', { precision: 5, scale: 2 }),
    passPct: numeric('pass_pct', { precision: 5, scale: 2 }),
    // Skater advanced — sourced from screenshots 03/07-style mixed views.
    blockedShots: integer('blocked_shots'),
    giveaways: integer('giveaways'),
    takeaways: integer('takeaways'),
    interceptions: integer('interceptions'),
    shots: integer('shots'),
    shootingPct: numeric('shooting_pct', { precision: 5, scale: 2 }),

    // Goalie metric columns. Nullable — populated only as sources arrive.
    wins: integer('wins'),
    losses: integer('losses'),
    otl: integer('otl'),
    savePct: numeric('save_pct', { precision: 5, scale: 2 }),
    gaa: numeric('gaa', { precision: 4, scale: 2 }),
    shutouts: integer('shutouts'),
    shutoutPeriods: integer('shutout_periods'),
    totalSaves: integer('total_saves'),
    totalGoalsAgainst: integer('total_goals_against'),

    // Whole-row review state. Per-source review lives on the sources table.
    reviewStatus: text('review_status')
      .$type<HistoricalClubMemberReviewStatus>()
      .notNull()
      .default('pending_review'),

    importBatch: text('import_batch').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Matched rows: one per (title, mode, role, player).
    uniqueIndex('hcm_season_stats_player_uniq')
      .on(table.gameTitleId, table.gameMode, table.roleGroup, table.playerId)
      .where(sql`player_id IS NOT NULL`),
    // Unmatched rows: one per (title, mode, role, lowercased snapshot tag).
    uniqueIndex('hcm_season_stats_unmatched_uniq')
      .on(
        table.gameTitleId,
        table.gameMode,
        table.roleGroup,
        sql`lower(gamertag_snapshot)`,
      )
      .where(sql`player_id IS NULL`),
  ],
)

/**
 * Append-only provenance log. One row per contributing screenshot per
 * canonical row. Lets us trace which cells came from which capture and
 * detect cross-source disagreement without losing history.
 */
export const historicalClubMemberStatSources = pgTable(
  'historical_club_member_stat_sources',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    statRowId: bigint('stat_row_id', { mode: 'number' })
      .notNull()
      .references(() => historicalClubMemberSeasonStats.id, { onDelete: 'cascade' }),

    sourceAssetPath: text('source_asset_path').notNull(),
    /** The metric the screenshot was sorted by, e.g. "Skater Games Played". */
    sortedByMetricLabel: text('sorted_by_metric_label').notNull(),
    /** Snake-case keys of the canonical columns this source contributed to. */
    contributedMetrics: text('contributed_metrics').array().notNull(),
    /** The full key/value slice for this row as captured from the screenshot. */
    rawExtractJson: jsonb('raw_extract_json').notNull(),

    confidenceScore: numeric('confidence_score', { precision: 5, scale: 2 }),
    reviewStatus: text('review_status')
      .$type<HistoricalClubMemberSourceReviewStatus>()
      .notNull()
      .default('pending_review'),

    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    index('hcm_sources_stat_row_idx').on(table.statRowId),
    index('hcm_sources_asset_idx').on(table.sourceAssetPath),
  ],
)

export type HistoricalClubMemberSeasonStat =
  typeof historicalClubMemberSeasonStats.$inferSelect
export type NewHistoricalClubMemberSeasonStat =
  typeof historicalClubMemberSeasonStats.$inferInsert
export type HistoricalClubMemberStatSource =
  typeof historicalClubMemberStatSources.$inferSelect
export type NewHistoricalClubMemberStatSource =
  typeof historicalClubMemberStatSources.$inferInsert
