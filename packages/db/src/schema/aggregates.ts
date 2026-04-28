import { integer, numeric, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { players } from './players.js'
import { gameTitles } from './game-titles.js'
import type { GameMode } from './matches.js'

/**
 * Precomputed player stats aggregated per game title (PRIMARY aggregate level).
 *
 * Recomputed by the worker after each ingestion cycle via INSERT ... ON CONFLICT UPDATE.
 * Never computed on read — always read from this table.
 *
 * All numeric(5,2) per architecture spec. GAA uses numeric(4,2).
 * Goalie columns are nullable — only populated for players who have played goalie.
 */
export const playerGameTitleStats = pgTable(
  'player_game_title_stats',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    gamesPlayed: integer('games_played').notNull().default(0),

    // ── Skater aggregates ─────────────────────────────────��────────────────────
    goals: integer('goals').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    points: integer('points').notNull().default(0),
    plusMinus: integer('plus_minus').notNull().default(0),
    shots: integer('shots').notNull().default(0),
    hits: integer('hits').notNull().default(0),
    pim: integer('pim').notNull().default(0),
    takeaways: integer('takeaways').notNull().default(0),
    giveaways: integer('giveaways').notNull().default(0),
    /** numeric(5,2). e.g. 52.50 */
    faceoffPct: numeric('faceoff_pct', { precision: 5, scale: 2 }),
    /** numeric(5,2). e.g. 78.30 */
    passPct: numeric('pass_pct', { precision: 5, scale: 2 }),

    // ── Skater advanced aggregates ────────────────────────────────────────────
    /** Total shot attempts (goals + missed + blocked). Summed from shot_attempts. */
    shotAttempts: integer('shot_attempts').notNull().default(0),
    /** Total TOI in seconds across all appearances. Nullable for pre-Phase-1 rows. */
    toiSeconds: integer('toi_seconds'),

    // ── Role-specific GP and TOI ──────────────────────────────────────────────
    /** Appearances where is_goalie = false. Use as denominator for skater rate stats. */
    skaterGp: integer('skater_gp').notNull().default(0),
    /** Appearances where is_goalie = true. Use as denominator for goalie rate stats. */
    goalieGp: integer('goalie_gp').notNull().default(0),
    /** TOI in seconds for skater appearances only. Nullable when no skater games exist. */
    skaterToiSeconds: integer('skater_toi_seconds'),
    /** TOI in seconds for goalie appearances only. Nullable when no goalie games exist. */
    goalieToiSeconds: integer('goalie_toi_seconds'),

    // ── Team record across all appearances (nullable — null until first reprocess) ──
    wins: integer('wins'),
    losses: integer('losses'),
    /** Overtime losses (match result = 'OTL'). Zero when source data has no OTL results. */
    otl: integer('otl'),
    /** numeric(5,2). e.g. 92.75 */
    savePct: numeric('save_pct', { precision: 5, scale: 2 }),
    /** Goals Against Average. numeric(4,2). e.g. 2.35 */
    gaa: numeric('gaa', { precision: 4, scale: 2 }),
    shutouts: integer('shutouts'),
    /** Total saves across all goalie appearances. */
    totalSaves: integer('total_saves'),
    /** Total shots against across all goalie appearances. */
    totalShotsAgainst: integer('total_shots_against'),
    /** Total goals against across all goalie appearances. */
    totalGoalsAgainst: integer('total_goals_against'),

    // ── Game mode dimension ───────────────────────────────────────────────────
    /**
     * NULL = all-modes combined row (the default).
     * '6s' or '3s' = mode-specific row emitted alongside the combined row.
     */
    gameMode: text('game_mode').$type<GameMode>(),
  },
  (table) => [
    uniqueIndex('player_game_title_stats_uniq').on(
      table.playerId,
      table.gameTitleId,
      sql`COALESCE(${table.gameMode}, '')`,
    ),
  ],
)

/**
 * Precomputed club stats aggregated per game title.
 * One row per (game_title_id, COALESCE(game_mode, '')) combination.
 * NULL game_mode = all-modes combined; '6s'/'3s' = mode-specific rows.
 */
export const clubGameTitleStats = pgTable(
  'club_game_title_stats',
  {
    id: serial('id').primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    gamesPlayed: integer('games_played').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    otl: integer('otl').notNull().default(0),
    goalsFor: integer('goals_for').notNull().default(0),
    goalsAgainst: integer('goals_against').notNull().default(0),
    /** numeric(5,2) */
    shotsPerGame: numeric('shots_per_game', { precision: 5, scale: 2 }),
    /** numeric(5,2) */
    hitsPerGame: numeric('hits_per_game', { precision: 5, scale: 2 }),
    /** numeric(5,2) */
    faceoffPct: numeric('faceoff_pct', { precision: 5, scale: 2 }),
    /** numeric(5,2) */
    passPct: numeric('pass_pct', { precision: 5, scale: 2 }),

    // ── Game mode dimension ─────────────────────────────────────────────────
    /**
     * NULL = all-modes combined row (the default).
     * '6s' or '3s' = mode-specific row emitted alongside the combined row.
     */
    gameMode: text('game_mode').$type<GameMode>(),
  },
  (table) => [
    uniqueIndex('club_game_title_stats_uniq').on(
      table.gameTitleId,
      sql`COALESCE(${table.gameMode}, '')`,
    ),
  ],
)

export type PlayerGameTitleStats = typeof playerGameTitleStats.$inferSelect
export type NewPlayerGameTitleStats = typeof playerGameTitleStats.$inferInsert
export type ClubGameTitleStats = typeof clubGameTitleStats.$inferSelect
export type NewClubGameTitleStats = typeof clubGameTitleStats.$inferInsert
