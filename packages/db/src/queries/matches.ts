import { and, eq, desc, count, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { matches } from '../schema/index.js'
import type { GameMode } from '../schema/index.js'

/**
 * Most recent matches for a given game title, newest first.
 * Optional gameMode filter ('6s' | '3s') narrows to that subset.
 */
export async function getRecentMatches(params: {
  gameTitleId: number
  limit?: number
  offset?: number
  gameMode?: GameMode | null
}) {
  const where =
    params.gameMode != null
      ? and(eq(matches.gameTitleId, params.gameTitleId), eq(matches.gameMode, params.gameMode))
      : eq(matches.gameTitleId, params.gameTitleId)

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
export async function countMatches(params: { gameTitleId: number; gameMode?: GameMode | null }) {
  const where =
    params.gameMode != null
      ? and(eq(matches.gameTitleId, params.gameTitleId), eq(matches.gameMode, params.gameMode))
      : eq(matches.gameTitleId, params.gameTitleId)

  const rows = await db.select({ total: count() }).from(matches).where(where)
  return rows[0]?.total ?? 0
}

/**
 * Single match by surrogate PK. Returns null if not found.
 */
export async function getMatchById(id: number) {
  const rows = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
  return rows[0] ?? null
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
