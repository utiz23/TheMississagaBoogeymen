import { asc, desc, eq } from 'drizzle-orm'
import { db } from '../client.js'
import { opponentPlayerMatchStats } from '../schema/index.js'

/**
 * All opponent player rows for a single match, ordered for scoresheet display.
 *
 * Returns raw rows from `opponent_player_match_stats`. Identity (gamertag,
 * eaPlayerId, opponentClubId, isGuest) lives on the row — there is no JOIN to
 * the `players` table. Opponent persons do NOT have BGM-style profile pages,
 * so the UI must not render `/roster/[id]` links for these rows.
 *
 * Row ordering: skaters first (isGoalie = false), then goalies; within
 * skaters, sorted by goals desc, assists desc to mirror getPlayerMatchStats.
 */
export async function getOpponentPlayerMatchStats(matchId: number) {
  return db
    .select()
    .from(opponentPlayerMatchStats)
    .where(eq(opponentPlayerMatchStats.matchId, matchId))
    .orderBy(
      asc(opponentPlayerMatchStats.isGoalie),
      desc(opponentPlayerMatchStats.goals),
      desc(opponentPlayerMatchStats.assists),
    )
}
