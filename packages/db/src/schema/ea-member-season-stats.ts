import {
  bigserial,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { players } from './players.js'

/**
 * EA-authoritative season stats for all club members, one row per (game_title_id, gamertag).
 *
 * Sourced from the EA /members/stats endpoint — NOT derived from locally ingested matches.
 * EA provides full season totals (e.g. 442 GP vs ~15 locally ingested). No web surface
 * reads from this table; all stats/roster pages use player_game_title_stats (local aggregate).
 *
 * This table is maintained for two reasons:
 *  1. Debug/baseline comparison — structured SQL access to full EA totals vs local counts.
 *  2. Player resolution — the ingest-members write loop creates players+profiles for members
 *     not yet seen in any locally ingested match, so /roster/[id] links work immediately.
 *
 * TOI notes:
 *   - EA returns sktoi/gltoi in total MINUTES. Stored here as seconds (× 60) to match
 *     the toiSeconds convention used throughout the rest of the codebase.
 *
 * player_id:
 *   - Resolved at ingest time by upserting into the players table by gamertag.
 *   - Always non-null after ingest, enabling /roster/[id] links.
 *   - Forward-compat: when a stable ea_id becomes available, the FK can be strengthened
 *     without changing the column.
 */
export const eaMemberSeasonStats = pgTable(
  'ea_member_season_stats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** EA gamertag / display name. Join key to players table. */
    gamertag: text('gamertag').notNull(),
    /** Resolved local player id. Always populated at ingest time. */
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),

    /**
     * EA favoritePosition. Used to route rows into skater vs goalie sections.
     * Known values: 'goalie', 'center', 'defenseMen', 'leftWing', 'rightWing'.
     */
    favoritePosition: text('favorite_position'),

    // ── Total GP (all games across all positions) ─────────────────────────────
    /** EA field: gamesplayed */
    gamesPlayed: integer('games_played').notNull().default(0),

    // ── Skater stats ──────────────────────────────────────────────────────────
    /** Games played as skater. EA field: skgp */
    skaterGp: integer('skater_gp').notNull().default(0),
    /** EA field: skgoals */
    goals: integer('goals').notNull().default(0),
    /** EA field: skassists */
    assists: integer('assists').notNull().default(0),
    /** EA field: skpoints */
    points: integer('points').notNull().default(0),
    /** Points per game (pre-computed by EA). EA field: skpointspg. numeric(5,2) */
    pointsPerGame: numeric('points_per_game', { precision: 5, scale: 2 }),
    /** EA field: skplusmin */
    plusMinus: integer('plus_minus').notNull().default(0),
    /** EA field: skpim */
    pim: integer('pim').notNull().default(0),
    /** Shots on goal. EA field: skshots */
    shots: integer('shots').notNull().default(0),
    /** Shooting % (goals / shots on goal × 100). EA field: skshotpct. numeric(5,2) */
    shotPct: numeric('shot_pct', { precision: 5, scale: 2 }),
    /** Total shot attempts (goals + missed + blocked). EA field: skshotattempts */
    shotAttempts: integer('shot_attempts').notNull().default(0),
    /** EA field: skhits */
    hits: integer('hits').notNull().default(0),
    /**
     * Total skater TOI in seconds (= EA sktoi minutes × 60).
     * Nullable so that rows with no skater time show as — in the UI.
     */
    toiSeconds: integer('toi_seconds'),
    /** Faceoff %. EA field: skfop. numeric(5,2) */
    faceoffPct: numeric('faceoff_pct', { precision: 5, scale: 2 }),
    /** Pass completion %. EA field: skpasspct. numeric(5,2) */
    passPct: numeric('pass_pct', { precision: 5, scale: 2 }),
    /** EA field: sktakeaways */
    takeaways: integer('takeaways').notNull().default(0),
    /** EA field: skgiveaways */
    giveaways: integer('giveaways').notNull().default(0),

    // ── Goalie stats (null when goalieGp = 0) ─────────────────────────────────
    /** Games played as goalie. EA field: glgp */
    goalieGp: integer('goalie_gp').notNull().default(0),
    /** EA field: glwins */
    goalieWins: integer('goalie_wins'),
    /** EA field: gllosses */
    goalieLosses: integer('goalie_losses'),
    /** EA field: glotl */
    goalieOtl: integer('goalie_otl'),
    /**
     * Save percentage (0–100 range). EA field: glsavepct.
     * numeric(5,2) — e.g. 67.00 represents 67.00%.
     */
    goalieSavePct: numeric('goalie_save_pct', { precision: 5, scale: 2 }),
    /** Goals Against Average (pre-computed by EA). EA field: glgaa. numeric(4,2) */
    goalieGaa: numeric('goalie_gaa', { precision: 4, scale: 2 }),
    /** EA field: glso */
    goalieShutouts: integer('goalie_shutouts'),
    /** Total saves. EA field: glsaves */
    goalieSaves: integer('goalie_saves'),
    /** Total shots against. EA field: glshots */
    goalieShots: integer('goalie_shots'),
    /** Total goals against. EA field: glga */
    goalieGoalsAgainst: integer('goalie_goals_against'),
    /**
     * Total goalie TOI in seconds (= EA gltoi minutes × 60).
     * Nullable when goalieGp = 0.
     */
    goalieToiSeconds: integer('goalie_toi_seconds'),

    // ── Context ───────────────────────────────────────────────────────────────
    /** Console platform reported by EA. e.g. 'xbsx', 'ps5'. EA field: clientPlatform */
    clientPlatform: text('client_platform'),
    /** Timestamp of the most recent fetch from EA for this game title. */
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ea_member_season_stats_uniq').on(table.gameTitleId, table.gamertag)],
)

export type EaMemberSeasonStats = typeof eaMemberSeasonStats.$inferSelect
export type NewEaMemberSeasonStats = typeof eaMemberSeasonStats.$inferInsert
