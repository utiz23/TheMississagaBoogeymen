import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { gameTitles } from './game-titles.js'
import { matches } from './matches.js'

/**
 * Club Finals rounds (CF1; migration 0083, hand-applied). The worker derives both tables after
 * each pass (`apps/worker/src/club-finals.ts`); the web app only reads them. Rules: a round is
 * first to 4 wins; 4 losses in a round end the attempt; round 4 is the final; a DNF or an OT loss
 * counts as a loss. Only 6v6 Club Finals games (`gameType10`, EA code 10) are in here.
 */

export const CLUB_FINALS_ATTEMPT_STATUS = ['active', 'eliminated', 'final_won'] as const
export type ClubFinalsAttemptStatus = (typeof CLUB_FINALS_ATTEMPT_STATUS)[number]

/** One row per attempt: its record, the furthest round and its status. */
export const clubFinalsAttempts = pgTable(
  'club_finals_attempts',
  {
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    attempt: smallint('attempt').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    games: smallint('games').notNull(),
    wins: smallint('wins').notNull(),
    losses: smallint('losses').notNull(),
    roundReached: smallint('round_reached').notNull(),
    roundsWon: smallint('rounds_won').notNull(),
    status: text('status').$type<ClubFinalsAttemptStatus>().notNull(),
    firstMatchId: bigint('first_match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    lastMatchId: bigint('last_match_id', { mode: 'number' })
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.gameTitleId, table.attempt] }),
    check(
      'club_finals_attempts_status_check',
      sql`${table.status} IN ('active', 'eliminated', 'final_won')`,
    ),
    check(
      'club_finals_attempts_round_check',
      sql`${table.roundReached} BETWEEN 1 AND 4 AND ${table.roundsWon} BETWEEN 0 AND 4`,
    ),
  ],
)

/** One row per 6v6 Club Finals game. */
export const clubFinalsGames = pgTable(
  'club_finals_games',
  {
    matchId: bigint('match_id', { mode: 'number' })
      .primaryKey()
      .references(() => matches.id, { onDelete: 'cascade' }),
    gameTitleId: integer('game_title_id')
      .notNull()
      .references(() => gameTitles.id),
    attempt: smallint('attempt').notNull(),
    round: smallint('round').notNull(),
    /** 1-based position of the game in its round (1 to 7). */
    gameInRound: smallint('game_in_round').notNull(),
    roundWinsBefore: smallint('round_wins_before').notNull(),
    roundLossesBefore: smallint('round_losses_before').notNull(),
    roundWinsAfter: smallint('round_wins_after').notNull(),
    roundLossesAfter: smallint('round_losses_after').notNull(),
    attemptWinsAfter: smallint('attempt_wins_after').notNull(),
    attemptLossesAfter: smallint('attempt_losses_after').notNull(),
    /** The game as the panel counts it: a win, or a loss (LOSS, OTL and DNF). */
    countedAs: text('counted_as').$type<'win' | 'loss'>().notNull(),
    /** The round's results up to and including this game, e.g. "WLLWW". */
    roundResults: text('round_results').notNull(),
    roundWon: boolean('round_won').notNull(),
    eliminated: boolean('eliminated').notNull(),
    isFinal: boolean('is_final').notNull(),
    finalWon: boolean('final_won').notNull(),
    derivedAt: timestamp('derived_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('club_finals_games_title_attempt_idx').on(
      table.gameTitleId,
      table.attempt,
      table.round,
      table.gameInRound,
    ),
    check('club_finals_games_counted_as_check', sql`${table.countedAs} IN ('win', 'loss')`),
    check(
      'club_finals_games_round_check',
      sql`${table.round} BETWEEN 1 AND 4 AND ${table.gameInRound} BETWEEN 1 AND 7`,
    ),
  ],
)

export type ClubFinalsGame = typeof clubFinalsGames.$inferSelect
export type NewClubFinalsGame = typeof clubFinalsGames.$inferInsert
export type ClubFinalsAttempt = typeof clubFinalsAttempts.$inferSelect
export type NewClubFinalsAttempt = typeof clubFinalsAttempts.$inferInsert
