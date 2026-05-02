import {
  bigserial,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { players } from './players.js'

export type HistoricalRoleGroup = 'skater' | 'goalie'
export type HistoricalGameMode = '6s' | '3s'
export type HistoricalPositionScope =
  | 'all_skaters'
  | 'wing'
  | 'leftWing'
  | 'center'
  | 'rightWing'
  | 'defenseMen'
  | 'goalie'
export type HistoricalReviewStatus = 'pending_review' | 'reviewed' | 'rejected'

/**
 * Reviewed historical season totals imported from archived screenshots/videos.
 *
 * This table intentionally stores archive aggregates only. It must not be used
 * as a source of fake match logs or blended into the live-ingest aggregate
 * tables. `statsJson` preserves the full extracted stat map, while promoted
 * typed columns support current and future historical archive queries.
 */
export const historicalPlayerSeasonStats = pgTable(
  'historical_player_season_stats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    gamertagSnapshot: text('gamertag_snapshot').notNull(),

    roleGroup: text('role_group').$type<HistoricalRoleGroup>().notNull(),
    gameMode: text('game_mode').$type<HistoricalGameMode>().notNull(),
    positionScope: text('position_scope').$type<HistoricalPositionScope>().notNull(),

    sourceGameModeLabel: text('source_game_mode_label').notNull(),
    sourcePositionLabel: text('source_position_label').notNull(),
    sourceAssetPath: text('source_asset_path').notNull(),
    importBatch: text('import_batch').notNull(),

    gamesPlayed: integer('games_played').notNull().default(0),
    goals: integer('goals').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    points: integer('points').notNull().default(0),
    plusMinus: integer('plus_minus').notNull().default(0),
    pim: integer('pim').notNull().default(0),
    shots: integer('shots').notNull().default(0),
    shotAttempts: integer('shot_attempts').notNull().default(0),
    hits: integer('hits').notNull().default(0),
    takeaways: integer('takeaways').notNull().default(0),
    giveaways: integer('giveaways').notNull().default(0),
    faceoffWins: integer('faceoff_wins'),
    faceoffLosses: integer('faceoff_losses'),
    faceoffPct: numeric('faceoff_pct', { precision: 5, scale: 2 }),
    passCompletions: integer('pass_completions'),
    passAttempts: integer('pass_attempts'),
    passPct: numeric('pass_pct', { precision: 5, scale: 2 }),
    blockedShots: integer('blocked_shots').notNull().default(0),
    interceptions: integer('interceptions').notNull().default(0),
    shGoals: integer('sh_goals').notNull().default(0),
    gwGoals: integer('gw_goals').notNull().default(0),
    toiSeconds: integer('toi_seconds'),

    wins: integer('wins'),
    losses: integer('losses'),
    otl: integer('otl'),
    savePct: numeric('save_pct', { precision: 5, scale: 2 }),
    gaa: numeric('gaa', { precision: 4, scale: 2 }),
    shutouts: integer('shutouts'),
    totalSaves: integer('total_saves'),
    totalShotsAgainst: integer('total_shots_against'),
    totalGoalsAgainst: integer('total_goals_against'),

    statsJson: jsonb('stats_json').notNull(),
    reviewStatus: text('review_status')
      .$type<HistoricalReviewStatus>()
      .notNull()
      .default('pending_review'),
    confidenceScore: numeric('confidence_score', { precision: 5, scale: 2 }),

    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('historical_player_season_stats_scope_uniq').on(
      table.gameTitleId,
      table.playerId,
      table.gameMode,
      table.positionScope,
      table.roleGroup,
    ),
  ],
)

export type HistoricalPlayerSeasonStat = typeof historicalPlayerSeasonStats.$inferSelect
export type NewHistoricalPlayerSeasonStat = typeof historicalPlayerSeasonStats.$inferInsert
