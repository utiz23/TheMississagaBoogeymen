import { integer, numeric, pgTable, serial, uniqueIndex } from 'drizzle-orm/pg-core'
import { players } from './players.js'
import { gameTitles } from './game-titles.js'

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

    // ── Goalie aggregates (nullable) ──────────────────────────────���────────────
    wins: integer('wins'),
    losses: integer('losses'),
    /** numeric(5,2). e.g. 92.75 */
    savePct: numeric('save_pct', { precision: 5, scale: 2 }),
    /** Goals Against Average. numeric(4,2). e.g. 2.35 */
    gaa: numeric('gaa', { precision: 4, scale: 2 }),
    shutouts: integer('shutouts'),
  },
  (table) => [uniqueIndex('player_game_title_stats_uniq').on(table.playerId, table.gameTitleId)],
)

/**
 * Precomputed club stats aggregated per game title.
 * One row per game title — unique constraint on game_title_id.
 */
export const clubGameTitleStats = pgTable('club_game_title_stats', {
  id: serial('id').primaryKey(),
  gameTitleId: integer('game_title_id')
    .notNull()
    .references(() => gameTitles.id)
    .unique(),
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
})

export type PlayerGameTitleStats = typeof playerGameTitleStats.$inferSelect
export type NewPlayerGameTitleStats = typeof playerGameTitleStats.$inferInsert
export type ClubGameTitleStats = typeof clubGameTitleStats.$inferSelect
export type NewClubGameTitleStats = typeof clubGameTitleStats.$inferInsert
