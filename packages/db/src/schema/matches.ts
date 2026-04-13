import {
  bigserial,
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/** Normalized game mode derived from cNhlOnlineGameType. */
export const GAME_MODE = ['3s', '6s'] as const
export type GameMode = (typeof GAME_MODE)[number]
import { sql } from 'drizzle-orm'
import { gameTitles } from './game-titles.js'
import { contentSeasons } from './content-seasons.js'

export const MATCH_RESULT = ['WIN', 'LOSS', 'OTL', 'DNF'] as const
export type MatchResult = (typeof MATCH_RESULT)[number]

export const MATCH_TYPE = ['gameType5', 'gameType10', 'club_private'] as const
export type MatchType = (typeof MATCH_TYPE)[number]

/**
 * One row per game played, from our club's perspective.
 *
 * Uniqueness: (game_title_id, ea_match_id) — composite because match IDs
 * may not be globally unique across game titles (UNVERIFIED, safe default).
 * Surrogate bigserial PK simplifies FK chains in player_match_stats.
 *
 * content_season_id is nullable:
 * DEFERRED until fixtures confirm whether in-game season data is present
 * in EA API match responses. Can be back-filled from date ranges in
 * content_seasons once confirmed.
 */
export const matches = pgTable(
  'matches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    /** EA match ID as returned by the API. */
    eaMatchId: text('ea_match_id').notNull(),
    matchType: text('match_type').notNull().$type<MatchType>(),
    /**
     * DEFERRED: Nullable until fixtures confirm in-game season is in payloads.
     * Assigned by the worker based on played_at vs. content_seasons date ranges.
     */
    contentSeasonId: integer('content_season_id').references(() => contentSeasons.id),
    opponentClubId: text('opponent_club_id').notNull(),
    opponentName: text('opponent_name').notNull(),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull(),
    result: text('result').notNull().$type<MatchResult>(),
    scoreFor: integer('score_for').notNull(),
    scoreAgainst: integer('score_against').notNull(),
    shotsFor: integer('shots_for').notNull(),
    shotsAgainst: integer('shots_against').notNull(),
    hitsFor: integer('hits_for').notNull(),
    hitsAgainst: integer('hits_against').notNull(),
    /** numeric(5,2) per architecture spec. e.g. 52.50 */
    faceoffPct: numeric('faceoff_pct', { precision: 5, scale: 2 }),
    /** Time on attack in seconds. */
    timeOnAttack: integer('time_on_attack'),
    penaltyMinutes: integer('penalty_minutes'),

    // ── Game mode ───────────────────────────────────────────────────────────────
    /**
     * Raw cNhlOnlineGameType value from EA API.
     * Known values: 5 = 6's, 10 = playoffs (6's format), 200 = 3's.
     * Stored as-is so we can re-derive gameMode if the mapping changes.
     */
    eaGameTypeCode: integer('ea_game_type_code'),
    /**
     * Derived game mode for filtering. '3s' or '6s'.
     * Null if the cNhlOnlineGameType value is unknown or absent.
     */
    gameMode: text('game_mode').$type<GameMode>(),

    // ── Club pass and powerplay stats ────────────────────────────────────────────
    /** Total pass attempts by our club in this match. */
    passAttempts: integer('pass_attempts'),
    /** Total pass completions by our club in this match. */
    passCompletions: integer('pass_completions'),
    /** Powerplay goals scored by our club. */
    ppGoals: integer('pp_goals'),
    /** Powerplay opportunities for our club. */
    ppOpportunities: integer('pp_opportunities'),
  },
  (table) => [
    uniqueIndex('matches_title_match_uniq').on(table.gameTitleId, table.eaMatchId),
    check('matches_result_check', sql`${table.result} IN ('WIN', 'LOSS', 'OTL', 'DNF')`),
    check(
      'matches_match_type_check',
      sql`${table.matchType} IN ('gameType5', 'gameType10', 'club_private')`,
    ),
  ],
)

export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert

/** Map a raw EA cNhlOnlineGameType integer to our normalized GameMode. */
export function deriveGameMode(code: number | undefined | null): GameMode | null {
  if (code === 5 || code === 10) return '6s'
  if (code === 200) return '3s'
  return null
}
