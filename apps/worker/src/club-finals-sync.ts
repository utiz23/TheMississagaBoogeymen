/**
 * Club Finals sync (CF1): derives the rounds of one title's 6v6 Club Finals games and stores them
 * (club_finals_games, club_finals_attempts; migration 0083). Rules: ./club-finals.ts.
 *
 * Runs after each normal pass and each quick check that stored a new game, with the other
 * database-only follow-ups. Rebuilds the title's rows from the matches table every time, so a
 * late game that lands before others fixes the rows after it. Idempotent. Non-fatal: the caller
 * catches errors. Without migration 0083 the step skips.
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { clubFinalsAttempts, clubFinalsGames, db, matches } from '@eanhl/db'
import { deriveClubFinals, type FinalsResult } from './club-finals.js'

export interface ClubFinalsSyncResult {
  gameTitleId: number
  games: number
  attempts: number
  unplaced: number
  skipped?: string
}

export async function syncClubFinals(gameTitleId: number): Promise<ClubFinalsSyncResult> {
  const present = (await db.execute(sql`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_name IN ('club_finals_games', 'club_finals_attempts')`)) as unknown as {
    n: number
  }[]
  if ((present[0]?.n ?? 0) < 2) {
    return {
      gameTitleId,
      games: 0,
      attempts: 0,
      unplaced: 0,
      skipped: 'migration 0083 not applied',
    }
  }

  // 6v6 Club Finals games only: gameType10 with EA code 10 (3v3 code 206 is not one).
  const rows = await db
    .select({ id: matches.id, playedAt: matches.playedAt, result: matches.result })
    .from(matches)
    .where(
      and(
        eq(matches.gameTitleId, gameTitleId),
        eq(matches.matchType, 'gameType10'),
        eq(matches.eaGameTypeCode, 10),
      ),
    )
    .orderBy(asc(matches.playedAt), asc(matches.id))

  const derived = deriveClubFinals(
    rows.map((r) => ({ matchId: r.id, playedAt: r.playedAt, result: r.result as FinalsResult })),
  )

  await db.transaction(async (tx) => {
    await tx.delete(clubFinalsGames).where(eq(clubFinalsGames.gameTitleId, gameTitleId))
    await tx.delete(clubFinalsAttempts).where(eq(clubFinalsAttempts.gameTitleId, gameTitleId))
    if (derived.attempts.length > 0) {
      await tx.insert(clubFinalsAttempts).values(
        derived.attempts.map((a) => ({
          gameTitleId,
          attempt: a.attempt,
          startedAt: a.startedAt,
          endedAt: a.endedAt,
          games: a.games,
          wins: a.wins,
          losses: a.losses,
          roundReached: a.roundReached,
          roundsWon: a.roundsWon,
          status: a.status,
          firstMatchId: a.firstMatchId,
          lastMatchId: a.lastMatchId,
        })),
      )
    }
    if (derived.states.length > 0) {
      await tx.insert(clubFinalsGames).values(derived.states.map((s) => ({ gameTitleId, ...s })))
    }
  })

  return {
    gameTitleId,
    games: derived.states.length,
    attempts: derived.attempts.length,
    unplaced: derived.unplacedMatchIds.length,
  }
}
