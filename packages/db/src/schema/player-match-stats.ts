import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { players } from './players.js'
import { matches } from './matches.js'

/**
 * Per-game individual player stats.
 *
 * Skater and goalie stats coexist in one table with nullable goalie columns.
 * Avoids JOIN complexity for roster views. At this data volume (hundreds of
 * rows) nullable columns are preferable to table-per-type inheritance.
 *
 * Foreign key to matches.id (surrogate bigserial) — simpler than a composite FK
 * to (game_title_id, ea_match_id), with equivalent uniqueness guarantees.
 */
export const playerMatchStats = pgTable(
  'player_match_stats',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    /** Position played in this specific game. May differ from players.position. */
    position: text('position'),
    isGoalie: boolean('is_goalie').notNull().default(false),

    // ── Skater fields ──────────────────────────────────────────────────────────
    goals: integer('goals').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    plusMinus: integer('plus_minus').notNull().default(0),
    shots: integer('shots').notNull().default(0),
    hits: integer('hits').notNull().default(0),
    pim: integer('pim').notNull().default(0),
    takeaways: integer('takeaways').notNull().default(0),
    giveaways: integer('giveaways').notNull().default(0),
    faceoffWins: integer('faceoff_wins').notNull().default(0),
    faceoffLosses: integer('faceoff_losses').notNull().default(0),
    passAttempts: integer('pass_attempts').notNull().default(0),
    passCompletions: integer('pass_completions').notNull().default(0),

    /**
     * Time on ice in seconds. Present for all players per EA API (e.g. 3600 for a
     * full 60-minute skater appearance, 685 for a drop-in goalie). Used to compute
     * GAA in the aggregate. Nullable to handle payloads where toiseconds is absent.
     */
    toiSeconds: integer('toi_seconds'),

    // ── Skater advanced fields ─────────────────────────────────────────────────
    /** Total shot attempts (including blocked + missed). EA field: skshotattempts. */
    shotAttempts: integer('shot_attempts').notNull().default(0),
    /** Shots blocked by the player defensively. EA field: skbs. */
    blockedShots: integer('blocked_shots').notNull().default(0),
    /** Powerplay goals. EA field: skppg. */
    ppGoals: integer('pp_goals').notNull().default(0),
    /** Short-handed goals. EA field: skshg. */
    shGoals: integer('sh_goals').notNull().default(0),
    /** Interceptions. EA field: skinterceptions. */
    interceptions: integer('interceptions').notNull().default(0),
    /** Penalties drawn. EA field: skpenaltiesdrawn. */
    penaltiesDrawn: integer('penalties_drawn').notNull().default(0),
    /** Possession time in seconds. EA field: skpossession. */
    possession: integer('possession').notNull().default(0),
    /** Deflections. EA field: skdeflections. */
    deflections: integer('deflections').notNull().default(0),
    /** Saucer passes. EA field: sksaucerpasses. */
    saucerPasses: integer('saucer_passes').notNull().default(0),

    // ── Per-match context ──────────────────────────────────────────────────────
    /** Console platform this player used. EA field: clientPlatform. */
    clientPlatform: text('client_platform'),
    /** True if this player disconnected (did not finish). EA field: player_dnf. */
    playerDnf: boolean('player_dnf').notNull().default(false),

    // ── Goalie fields (nullable — only populated when is_goalie = true) ────────
    saves: integer('saves'),
    goalsAgainst: integer('goals_against'),
    shotsAgainst: integer('shots_against'),

    // ── Goalie advanced fields (nullable) ─────────────────────────────────────
    /** Breakaway saves. EA field: glbrksaves. */
    breakawaySaves: integer('breakaway_saves'),
    /** Breakaway shots faced. EA field: glbrkshots. */
    breakawayShots: integer('breakaway_shots'),
    /** Desperation saves. EA field: gldsaves. */
    despSaves: integer('desp_saves'),
    /** Penalty shot saves. EA field: glpensaves. */
    penSaves: integer('pen_saves'),
    /** Penalty shots faced. EA field: glpenshots. */
    penShots: integer('pen_shots'),
    /** Poke checks. EA field: glpokechecks. */
    pokechecks: integer('pokechecks'),

    // ── EA per-match ratings (numeric 0–100, two decimals) ────────────────────
    /** Offensive performance rating. EA field: ratingOffense. numeric(5,2) */
    ratingOffense: numeric('rating_offense', { precision: 5, scale: 2 }),
    /** Defensive performance rating. EA field: ratingDefense. numeric(5,2) */
    ratingDefense: numeric('rating_defense', { precision: 5, scale: 2 }),
    /** Teamplay performance rating. EA field: ratingTeamplay. numeric(5,2) */
    ratingTeamplay: numeric('rating_teamplay', { precision: 5, scale: 2 }),

    // ── EA rank context ───────────────────────────────────────────────────────
    /** Player rank points after this match. EA field: rankpoints (may be "--"). */
    rankPoints: integer('rank_points'),
    /** Rank tier asset id (used by EA UI to render tier badge). EA field: ranktierassetid. */
    rankTierAssetId: text('rank_tier_asset_id'),
    /** Player level (XP). EA field: playerLevel. */
    playerLevel: integer('player_level'),
    /** Player class / build id. EA field: class. */
    playerClass: integer('player_class'),
    /** EA-canonical lineup slot 1–5. EA field: posSorted. */
    posSorted: integer('pos_sorted'),
    /** Reason the player was removed mid-game (numeric code). EA field: removedReason. */
    removedReason: integer('removed_reason'),
    /** Home / away indicator (0 or 1). EA field: teamSide. */
    teamSide: integer('team_side'),
  },
  (table) => [
    uniqueIndex('player_match_stats_player_match_uniq').on(table.playerId, table.matchId),
    index('player_match_stats_lineup_idx').on(table.matchId, table.position, table.playerId),
    check(
      'player_match_stats_position_check',
      sql`${table.position} IN ('goalie', 'center', 'defenseMen', 'leftWing', 'rightWing')`,
    ),
  ],
)

export type PlayerMatchStats = typeof playerMatchStats.$inferSelect
export type NewPlayerMatchStats = typeof playerMatchStats.$inferInsert
