import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { matches } from './matches.js'

/**
 * Per-game stats for OPPONENT players in a match.
 *
 * Distinct from `player_match_stats` (which is BGM-only). Opponent identity is
 * NOT linked to the `players` table — opponent persons appear once and are not
 * tracked across the BGM identity model (no profile, no roster, no career
 * aggregation). Their data lives entirely on this row:
 *
 *   - `ea_player_id`  : EA Pro Clubs persona ID, the JSON object key in
 *                       `payload.players[opponentClubId][?]`. Stable across matches.
 *   - `gamertag`      : EA `playername`. Snapshot at match time. Not version-tracked.
 *   - `opponent_club_id`: Matches `matches.opponent_club_id` for this match.
 *
 * Field set mirrors `player_match_stats` so the UI can render symmetric two-team
 * scoresheets without a schema-translation layer. Goalie fields are nullable and
 * populated only when `is_goalie = true`.
 *
 * `is_guest = true` for EA "guest" appearances (drop-in players outside the club
 * roster). Guest IDs are still stable per EA but the player is incidental.
 */
export const opponentPlayerMatchStats = pgTable(
  'opponent_player_match_stats',
  {
    id: serial('id').primaryKey(),
    matchId: bigint('match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id),
    /** EA persona ID (JSON object key in payload). Stable across matches. */
    eaPlayerId: text('ea_player_id').notNull(),
    /** Opponent's club ID for this match (= matches.opponent_club_id). */
    opponentClubId: text('opponent_club_id').notNull(),
    /** Display gamertag at the time of this match. */
    gamertag: text('gamertag').notNull(),
    /** Position played in this game. */
    position: text('position'),
    isGoalie: boolean('is_goalie').notNull().default(false),
    /** EA "guest" flag — drop-in player outside the club roster. */
    isGuest: boolean('is_guest').notNull().default(false),
    playerDnf: boolean('player_dnf').notNull().default(false),
    /** Console platform from EA (e.g. 'xbsx', 'ps5'). */
    clientPlatform: text('client_platform'),

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
    /** Time on ice in seconds. Nullable to mirror player_match_stats. */
    toiSeconds: integer('toi_seconds'),

    // Skater advanced
    shotAttempts: integer('shot_attempts').notNull().default(0),
    blockedShots: integer('blocked_shots').notNull().default(0),
    ppGoals: integer('pp_goals').notNull().default(0),
    shGoals: integer('sh_goals').notNull().default(0),
    interceptions: integer('interceptions').notNull().default(0),
    penaltiesDrawn: integer('penalties_drawn').notNull().default(0),
    possession: integer('possession').notNull().default(0),
    deflections: integer('deflections').notNull().default(0),
    saucerPasses: integer('saucer_passes').notNull().default(0),

    // ── Goalie fields (nullable) ───────────────────────────────────────────────
    saves: integer('saves'),
    goalsAgainst: integer('goals_against'),
    shotsAgainst: integer('shots_against'),
    breakawaySaves: integer('breakaway_saves'),
    breakawayShots: integer('breakaway_shots'),
    despSaves: integer('desp_saves'),
    penSaves: integer('pen_saves'),
    penShots: integer('pen_shots'),
    pokechecks: integer('pokechecks'),
  },
  (table) => [
    // One row per (match, opponent player). EA player IDs are always present in
    // the payload (they ARE the JSON object key), so this can be NOT NULL.
    uniqueIndex('opponent_player_match_stats_match_player_uniq').on(
      table.matchId,
      table.eaPlayerId,
    ),
    // Lookup by match for the scoresheet view.
    index('opponent_player_match_stats_match_idx').on(table.matchId),
    check(
      'opponent_player_match_stats_position_check',
      sql`${table.position} IN ('goalie', 'center', 'defenseMen', 'leftWing', 'rightWing')`,
    ),
  ],
)

export type OpponentPlayerMatchStats = typeof opponentPlayerMatchStats.$inferSelect
export type NewOpponentPlayerMatchStats = typeof opponentPlayerMatchStats.$inferInsert
