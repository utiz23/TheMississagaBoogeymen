/**
 * Club Finals reads (CF1). The worker derives the rounds (apps/worker/src/club-finals.ts) into
 * club_finals_games / club_finals_attempts (migration 0083); these queries only read them, and the
 * page shows what is stored. A game with no row has no badge: nothing is guessed.
 */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { clubFinalsAttempts, clubFinalsGames, matches } from '../schema/index.js'
import type { ClubFinalsAttemptStatus, MatchResult } from '../schema/index.js'
import { panelViewFromGame, type ClubFinalsPanelView } from './club-finals-panel.js'

/** What a game card or game page shows for one Club Finals game. */
export interface ClubFinalsBadge {
  matchId: number
  attempt: number
  round: number
  gameInRound: number
  roundWinsAfter: number
  roundLossesAfter: number
  attemptWinsAfter: number
  attemptLossesAfter: number
  isFinal: boolean
  roundWon: boolean
  eliminated: boolean
  finalWon: boolean
}

const badgeColumns = {
  matchId: clubFinalsGames.matchId,
  attempt: clubFinalsGames.attempt,
  round: clubFinalsGames.round,
  gameInRound: clubFinalsGames.gameInRound,
  roundWinsAfter: clubFinalsGames.roundWinsAfter,
  roundLossesAfter: clubFinalsGames.roundLossesAfter,
  attemptWinsAfter: clubFinalsGames.attemptWinsAfter,
  attemptLossesAfter: clubFinalsGames.attemptLossesAfter,
  isFinal: clubFinalsGames.isFinal,
  roundWon: clubFinalsGames.roundWon,
  eliminated: clubFinalsGames.eliminated,
  finalWon: clubFinalsGames.finalWon,
}

/** The Club Finals badge of one game, or null when it is not a derived Club Finals game. */
export async function getClubFinalsBadge(matchId: number): Promise<ClubFinalsBadge | null> {
  const rows = await db
    .select(badgeColumns)
    .from(clubFinalsGames)
    .where(eq(clubFinalsGames.matchId, matchId))
    .limit(1)
  return rows[0] ?? null
}

/** Badges for a page of games, by match id. Games with no row are not in the map. */
export async function getClubFinalsBadges(
  matchIds: readonly number[],
): Promise<Map<number, ClubFinalsBadge>> {
  if (matchIds.length === 0) return new Map()
  const rows = await db
    .select(badgeColumns)
    .from(clubFinalsGames)
    .where(inArray(clubFinalsGames.matchId, [...matchIds]))
  return new Map(rows.map((r) => [r.matchId, r]))
}

/** One derived game with what the Club Finals page shows next to it. */
export interface ClubFinalsPageGame extends ClubFinalsBadge {
  playedAt: Date
  opponentName: string
  scoreFor: number
  scoreAgainst: number
  result: MatchResult
  roundResults: string
}

export interface ClubFinalsPageAttempt {
  attempt: number
  startedAt: Date
  endedAt: Date
  games: number
  wins: number
  losses: number
  roundReached: number
  roundsWon: number
  status: ClubFinalsAttemptStatus
  /** Every game of the attempt, in time order. */
  gameRows: ClubFinalsPageGame[]
}

export { panelViewFromGame, type ClubFinalsPanelView } from './club-finals-panel.js'

export interface ClubFinalsOverview {
  /** Oldest first. */
  attempts: ClubFinalsPageAttempt[]
  /**
   * The panel's state now. `null` when the last attempt ended with a won final: what comes next
   * is not known, so nothing is shown.
   */
  panel: ClubFinalsPanelView | null
  /** The newest game with a row, for "last game" and the panel's time. */
  lastGame: ClubFinalsPageGame | null
  /** Furthest round, then most wins, then fewest losses. */
  best: ClubFinalsPageAttempt | null
  /** Club Finals games played after a won final: no state is derived for them. */
  unplacedGames: number
}

/** The Club Finals page for one title. Empty `attempts` = no Club Finals games derived. */
export async function getClubFinalsOverview(gameTitleId: number): Promise<ClubFinalsOverview> {
  const [attemptRows, gameRows] = await Promise.all([
    db
      .select()
      .from(clubFinalsAttempts)
      .where(eq(clubFinalsAttempts.gameTitleId, gameTitleId))
      .orderBy(asc(clubFinalsAttempts.attempt)),
    db
      .select({
        ...badgeColumns,
        playedAt: matches.playedAt,
        opponentName: matches.opponentName,
        scoreFor: matches.scoreFor,
        scoreAgainst: matches.scoreAgainst,
        result: matches.result,
        roundResults: clubFinalsGames.roundResults,
      })
      .from(clubFinalsGames)
      .innerJoin(matches, eq(matches.id, clubFinalsGames.matchId))
      .where(eq(clubFinalsGames.gameTitleId, gameTitleId))
      .orderBy(asc(matches.playedAt), asc(matches.id)),
  ])

  const byAttempt = new Map<number, ClubFinalsPageGame[]>()
  for (const g of gameRows) {
    const list = byAttempt.get(g.attempt) ?? []
    list.push(g)
    byAttempt.set(g.attempt, list)
  }
  const attempts: ClubFinalsPageAttempt[] = attemptRows.map((a) => ({
    attempt: a.attempt,
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    games: a.games,
    wins: a.wins,
    losses: a.losses,
    roundReached: a.roundReached,
    roundsWon: a.roundsWon,
    status: a.status,
    gameRows: byAttempt.get(a.attempt) ?? [],
  }))

  const lastGame = gameRows[gameRows.length - 1] ?? null
  const lastAttempt = attempts[attempts.length - 1] ?? null
  const panel =
    lastGame === null || lastAttempt?.status === 'final_won' ? null : panelViewFromGame(lastGame)

  let best: ClubFinalsPageAttempt | null = null
  for (const a of attempts) {
    if (
      best === null ||
      a.roundReached > best.roundReached ||
      (a.roundReached === best.roundReached &&
        (a.wins > best.wins || (a.wins === best.wins && a.losses < best.losses)))
    ) {
      best = a
    }
  }

  let unplacedGames = 0
  if (lastAttempt?.status === 'final_won') {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(matches)
      .where(
        and(
          eq(matches.gameTitleId, gameTitleId),
          eq(matches.matchType, 'gameType10'),
          eq(matches.eaGameTypeCode, 10),
          gt(matches.playedAt, lastAttempt.endedAt),
        ),
      )
    unplacedGames = rows[0]?.n ?? 0
  }

  return { attempts, panel, lastGame, best, unplacedGames }
}
