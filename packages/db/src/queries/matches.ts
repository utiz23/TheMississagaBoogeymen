import { and, asc, eq, desc, count, sql, lte, lt, gt, ilike, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { matches, playerMatchStats, opponentPlayerMatchStats } from '../schema/index.js'
import type { GameMode, MatchResult } from '../schema/index.js'

/**
 * Most recent matches for a given game title, newest first.
 * Optional gameMode filter ('6s' | '3s') narrows to that subset.
 */
export async function getRecentMatches(params: {
  gameTitleId: number
  limit?: number
  offset?: number
  gameMode?: GameMode | null
  result?: MatchResult | MatchResult[] | null
  opponent?: string | null
}) {
  const where = buildMatchListWhere(params)

  return db
    .select()
    .from(matches)
    .where(where)
    .orderBy(desc(matches.playedAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0)
}

/**
 * Total number of matches for a given game title.
 * Optional gameMode filter narrows to that subset.
 */
export async function countMatches(params: {
  gameTitleId: number
  gameMode?: GameMode | null
  result?: MatchResult | MatchResult[] | null
  opponent?: string | null
}) {
  const where = buildMatchListWhere(params)

  const rows = await db.select({ total: count() }).from(matches).where(where)
  return rows[0]?.total ?? 0
}

function buildMatchListWhere(params: {
  gameTitleId: number
  gameMode?: GameMode | null
  result?: MatchResult | MatchResult[] | null
  opponent?: string | null
}) {
  const conditions: SQL[] = [eq(matches.gameTitleId, params.gameTitleId)]

  if (params.gameMode != null) {
    conditions.push(eq(matches.gameMode, params.gameMode))
  }

  if (Array.isArray(params.result) && params.result.length > 0) {
    conditions.push(inArray(matches.result, params.result))
  } else if (typeof params.result === 'string') {
    conditions.push(eq(matches.result, params.result))
  }

  const opponent = params.opponent?.trim()
  if (opponent) {
    conditions.push(ilike(matches.opponentName, `%${opponent}%`))
  }

  return and(...conditions)
}

/**
 * Single match by surrogate PK. Returns null if not found.
 */
export async function getMatchById(id: number) {
  const rows = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
  return rows[0] ?? null
}

/**
 * Chronological position of this match in its game title (1-indexed).
 * "Game N of season" — counts matches with played_at <= this match's played_at.
 */
export async function getMatchSeasonNumber(gameTitleId: number, playedAt: Date): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(matches)
    .where(and(eq(matches.gameTitleId, gameTitleId), lte(matches.playedAt, playedAt)))
  return rows[0]?.n ?? 0
}

export interface SeriesContext {
  /** Chronological meeting number for THIS match (1-indexed). */
  meetingNumber: number
  /** All-time series record vs this opponent within the game title (incl. this match). */
  series: { wins: number; losses: number; otl: number; total: number }
}

/**
 * Same-opponent series context: meeting number for this match plus all-time
 * W/L/OTL record vs this opponent within the game title.
 */
export async function getMatchSeriesContext(
  gameTitleId: number,
  opponentClubId: string,
  playedAt: Date,
): Promise<SeriesContext> {
  const [meetingRows, recordRows] = await Promise.all([
    db
      .select({ n: count() })
      .from(matches)
      .where(
        and(
          eq(matches.gameTitleId, gameTitleId),
          eq(matches.opponentClubId, opponentClubId),
          lte(matches.playedAt, playedAt),
        ),
      ),
    db
      .select({ result: matches.result, n: count() })
      .from(matches)
      .where(and(eq(matches.gameTitleId, gameTitleId), eq(matches.opponentClubId, opponentClubId)))
      .groupBy(matches.result),
  ])

  const series = { wins: 0, losses: 0, otl: 0, total: 0 }
  for (const row of recordRows) {
    series.total += row.n
    if (row.result === 'WIN') series.wins += row.n
    else if (row.result === 'LOSS') series.losses += row.n
    else if (row.result === 'OTL') series.otl += row.n
  }

  return {
    meetingNumber: meetingRows[0]?.n ?? 0,
    series,
  }
}

export interface AdjacentMatch {
  id: number
  opponentName: string
  result: MatchResult
  scoreFor: number
  scoreAgainst: number
  playedAt: Date
}

/**
 * Previous and next match (chronologically) within the same game title.
 * Either side may be null at season boundaries.
 */
export async function getAdjacentMatches(
  gameTitleId: number,
  playedAt: Date,
): Promise<{ previous: AdjacentMatch | null; next: AdjacentMatch | null }> {
  const select = {
    id: matches.id,
    opponentName: matches.opponentName,
    result: matches.result,
    scoreFor: matches.scoreFor,
    scoreAgainst: matches.scoreAgainst,
    playedAt: matches.playedAt,
  }
  const [prevRows, nextRows] = await Promise.all([
    db
      .select(select)
      .from(matches)
      .where(and(eq(matches.gameTitleId, gameTitleId), lt(matches.playedAt, playedAt)))
      .orderBy(desc(matches.playedAt))
      .limit(1),
    db
      .select(select)
      .from(matches)
      .where(and(eq(matches.gameTitleId, gameTitleId), gt(matches.playedAt, playedAt)))
      .orderBy(asc(matches.playedAt))
      .limit(1),
  ])
  return { previous: prevRows[0] ?? null, next: nextRows[0] ?? null }
}

export interface LineupCondition {
  position: 'goalie' | 'center' | 'defenseMen' | 'leftWing' | 'rightWing'
  gamertag: string
}

export interface LineupMatchRow {
  id: number
  playedAt: Date
  opponentName: string
  result: string
  scoreFor: number
  scoreAgainst: number
}

/**
 * Matches where all given position/gamertag slots were filled simultaneously.
 *
 * Each condition adds one self-join: "player X played position Y in the same game."
 * Conditions are ANDed — all must be satisfied in the same match.
 *
 * Example: [{ position: 'center', gamertag: 'silkyjoker85' }, { position: 'rightWing', gamertag: 'camrazz' }]
 * Returns matches where silkyjoker85 played center AND camrazz played right wing.
 *
 * Returns all matches for the game title when conditions is empty.
 */
export async function getMatchesWithLineup(
  gameTitleId: number,
  conditions: LineupCondition[],
): Promise<LineupMatchRow[]> {
  if (conditions.length === 0) {
    const rows = await db
      .select({
        id: matches.id,
        playedAt: matches.playedAt,
        opponentName: matches.opponentName,
        result: matches.result,
        scoreFor: matches.scoreFor,
        scoreAgainst: matches.scoreAgainst,
      })
      .from(matches)
      .where(eq(matches.gameTitleId, gameTitleId))
      .orderBy(desc(matches.playedAt))
    return rows
  }

  // Build one self-join per condition using sql template literals.
  // Alias integers (i) are safe to interpolate as raw SQL; gamertag and position
  // are bound as parameters via the sql template (not sql.raw).
  let query = sql`
    SELECT DISTINCT
      m.id,
      m.played_at   AS "playedAt",
      m.opponent_name AS "opponentName",
      m.result,
      m.score_for   AS "scoreFor",
      m.score_against AS "scoreAgainst"
    FROM matches m`

  for (let i = 0; i < conditions.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { gamertag, position } = conditions[i]!
    const pms = sql.raw(`pms_${String(i)}`)
    const p = sql.raw(`p_${String(i)}`)
    query = sql`${query}
    JOIN player_match_stats ${pms}
      ON ${pms}.match_id = m.id
    JOIN players ${p}
      ON ${p}.id = ${pms}.player_id
     AND ${p}.gamertag = ${gamertag}
     AND ${pms}.position = ${position}`
  }

  query = sql`${query}
    WHERE m.game_title_id = ${gameTitleId}
    ORDER BY m.played_at DESC`

  const result = await db.execute(query)
  return result as unknown as LineupMatchRow[]
}

/**
 * Per-match faceoff totals for both sides. Sums faceoff_wins / faceoff_losses
 * across all skater rows on each side. Used to compute team FO% on the
 * latest-result scoreboard (match.faceoff_pct from EA payloads is null).
 */
export async function getMatchFaceoffTotals(matchId: number) {
  const [oursRow] = await db
    .select({
      wins: sql<number>`COALESCE(SUM(${playerMatchStats.faceoffWins}), 0)`.mapWith(Number),
      losses: sql<number>`COALESCE(SUM(${playerMatchStats.faceoffLosses}), 0)`.mapWith(Number),
      maxToi: sql<number>`COALESCE(MAX(${playerMatchStats.toiSeconds}), 0)`.mapWith(Number),
    })
    .from(playerMatchStats)
    .where(eq(playerMatchStats.matchId, matchId))

  const [theirsRow] = await db
    .select({
      wins: sql<number>`COALESCE(SUM(${opponentPlayerMatchStats.faceoffWins}), 0)`.mapWith(Number),
      losses: sql<number>`COALESCE(SUM(${opponentPlayerMatchStats.faceoffLosses}), 0)`.mapWith(
        Number,
      ),
      maxToi: sql<number>`COALESCE(MAX(${opponentPlayerMatchStats.toiSeconds}), 0)`.mapWith(Number),
    })
    .from(opponentPlayerMatchStats)
    .where(eq(opponentPlayerMatchStats.matchId, matchId))

  // Max player TOI across both sides — if anyone played more than 60:00,
  // the game went to overtime (regulation = 3 × 20:00 = 3600 s).
  const maxToiSeconds = Math.max(oursRow?.maxToi ?? 0, theirsRow?.maxToi ?? 0)

  return {
    ourWins: oursRow?.wins ?? 0,
    ourLosses: oursRow?.losses ?? 0,
    oppWins: theirsRow?.wins ?? 0,
    oppLosses: theirsRow?.losses ?? 0,
    maxToiSeconds,
  }
}
