import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  historicalPlayerSeasonStats,
  players,
  type HistoricalGameMode,
  type HistoricalPositionScope,
} from '../schema/index.js'

/**
 * Historical skater season totals imported from reviewed archive assets.
 *
 * Returns only reviewed rows for the requested title/mode/position scope. The
 * shape intentionally matches the existing skater table query as closely as
 * possible so future archive UI work can reuse current table components.
 */
export async function getHistoricalSkaterStats(
  gameTitleId: number,
  gameMode: HistoricalGameMode,
  positionScope: HistoricalPositionScope = 'all_skaters',
) {
  return db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamertag: players.gamertag,
      position: players.position,
      gamesPlayed: historicalPlayerSeasonStats.gamesPlayed,
      goals: historicalPlayerSeasonStats.goals,
      assists: historicalPlayerSeasonStats.assists,
      points: historicalPlayerSeasonStats.points,
      plusMinus: historicalPlayerSeasonStats.plusMinus,
      pim: historicalPlayerSeasonStats.pim,
      shots: historicalPlayerSeasonStats.shots,
      hits: historicalPlayerSeasonStats.hits,
      takeaways: historicalPlayerSeasonStats.takeaways,
      giveaways: historicalPlayerSeasonStats.giveaways,
      faceoffPct: historicalPlayerSeasonStats.faceoffPct,
      passPct: historicalPlayerSeasonStats.passPct,
      shotAttempts: historicalPlayerSeasonStats.shotAttempts,
      toiSeconds: historicalPlayerSeasonStats.toiSeconds,
    })
    .from(historicalPlayerSeasonStats)
    .innerJoin(players, eq(historicalPlayerSeasonStats.playerId, players.id))
    .where(
      and(
        eq(historicalPlayerSeasonStats.gameTitleId, gameTitleId),
        eq(historicalPlayerSeasonStats.roleGroup, 'skater'),
        eq(historicalPlayerSeasonStats.gameMode, gameMode),
        eq(historicalPlayerSeasonStats.positionScope, positionScope),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
    .orderBy(
      desc(historicalPlayerSeasonStats.points),
      desc(historicalPlayerSeasonStats.goals),
      desc(historicalPlayerSeasonStats.assists),
      asc(players.gamertag),
    )
}

export type HistoricalSkaterStatsRow = Omit<
  Awaited<ReturnType<typeof getHistoricalSkaterStats>>[number],
  'playerId'
> & {
  /** Nullable so club-member queries can surface unmatched gamertags. */
  playerId: number | null
}

/**
 * Historical goalie season totals imported from reviewed archive assets.
 *
 * Returns only reviewed goalie rows for the requested title/mode/position
 * scope. Shape aligns with the current goalie table query layer.
 */
export async function getHistoricalGoalieStats(
  gameTitleId: number,
  gameMode: HistoricalGameMode,
  positionScope: HistoricalPositionScope = 'goalie',
) {
  const rows = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamertag: players.gamertag,
      gamesPlayed: historicalPlayerSeasonStats.gamesPlayed,
      wins: historicalPlayerSeasonStats.wins,
      losses: historicalPlayerSeasonStats.losses,
      otl: historicalPlayerSeasonStats.otl,
      gaa: historicalPlayerSeasonStats.gaa,
      shutouts: historicalPlayerSeasonStats.shutouts,
      totalSaves: historicalPlayerSeasonStats.totalSaves,
      totalShotsAgainst: historicalPlayerSeasonStats.totalShotsAgainst,
      totalGoalsAgainst: historicalPlayerSeasonStats.totalGoalsAgainst,
      toiSeconds: historicalPlayerSeasonStats.toiSeconds,
    })
    .from(historicalPlayerSeasonStats)
    .innerJoin(players, eq(historicalPlayerSeasonStats.playerId, players.id))
    .where(
      and(
        eq(historicalPlayerSeasonStats.gameTitleId, gameTitleId),
        eq(historicalPlayerSeasonStats.roleGroup, 'goalie'),
        eq(historicalPlayerSeasonStats.gameMode, gameMode),
        eq(historicalPlayerSeasonStats.positionScope, positionScope),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
    .orderBy(
      desc(historicalPlayerSeasonStats.gamesPlayed),
      asc(historicalPlayerSeasonStats.gaa),
      asc(players.gamertag),
    )

  // Recompute SV% from raw saves / (saves + GA). The OCR-extracted save_pct
  // column is unreliable: NHL 22-24 screenshots store it as a fraction (0.74),
  // NHL 25 as a percentage (74.00). Always derive at read time.
  // Also derive shots_against from saves+GA since historical rows captured
  // saves and GA but not shots_against directly.
  return rows
    .map((r) => {
      const sv = r.totalSaves
      const ga = r.totalGoalsAgainst
      const denom = (sv ?? 0) + (ga ?? 0)
      const savePct =
        sv !== null && ga !== null && denom > 0
          ? ((sv / denom) * 100).toFixed(2)
          : null
      const totalShotsAgainst =
        sv !== null && ga !== null ? sv + ga : r.totalShotsAgainst
      return { ...r, savePct, totalShotsAgainst }
    })
    .sort((a, b) => {
      const sa = a.savePct === null ? -1 : Number.parseFloat(a.savePct)
      const sb = b.savePct === null ? -1 : Number.parseFloat(b.savePct)
      if (sb !== sa) return sb - sa
      return b.gamesPlayed - a.gamesPlayed
    })
}

export type HistoricalGoalieStatsRow = Omit<
  Awaited<ReturnType<typeof getHistoricalGoalieStats>>[number],
  'playerId'
> & {
  /** Nullable so club-member queries can surface unmatched gamertags. */
  playerId: number | null
}

/**
 * Historical skater season totals aggregated across both 6s and 3s modes.
 *
 * Counts are summed per player; rate fields (`faceoffPct`, `passPct`) are
 * recomputed from the summed underlying counts so they stay meaningful at
 * the combined-mode level. Returns the same row shape as
 * `getHistoricalSkaterStats` so the existing table component renders it
 * unchanged.
 */
export async function getHistoricalSkaterStatsAllModes(gameTitleId: number) {
  const rows = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamertag: players.gamertag,
      position: players.position,
      gamesPlayed: sql<string>`SUM(${historicalPlayerSeasonStats.gamesPlayed})`,
      goals: sql<string>`SUM(${historicalPlayerSeasonStats.goals})`,
      assists: sql<string>`SUM(${historicalPlayerSeasonStats.assists})`,
      points: sql<string>`SUM(${historicalPlayerSeasonStats.points})`,
      plusMinus: sql<string>`SUM(${historicalPlayerSeasonStats.plusMinus})`,
      pim: sql<string>`SUM(${historicalPlayerSeasonStats.pim})`,
      shots: sql<string>`SUM(${historicalPlayerSeasonStats.shots})`,
      hits: sql<string>`SUM(${historicalPlayerSeasonStats.hits})`,
      takeaways: sql<string>`SUM(${historicalPlayerSeasonStats.takeaways})`,
      giveaways: sql<string>`SUM(${historicalPlayerSeasonStats.giveaways})`,
      shotAttempts: sql<string>`SUM(${historicalPlayerSeasonStats.shotAttempts})`,
      faceoffWins: sql<string | null>`SUM(${historicalPlayerSeasonStats.faceoffWins})`,
      faceoffLosses: sql<string | null>`SUM(${historicalPlayerSeasonStats.faceoffLosses})`,
      passCompletions: sql<string | null>`SUM(${historicalPlayerSeasonStats.passCompletions})`,
      passAttempts: sql<string | null>`SUM(${historicalPlayerSeasonStats.passAttempts})`,
      toiSeconds: sql<string | null>`SUM(${historicalPlayerSeasonStats.toiSeconds})`,
    })
    .from(historicalPlayerSeasonStats)
    .innerJoin(players, eq(historicalPlayerSeasonStats.playerId, players.id))
    .where(
      and(
        eq(historicalPlayerSeasonStats.gameTitleId, gameTitleId),
        eq(historicalPlayerSeasonStats.roleGroup, 'skater'),
        eq(historicalPlayerSeasonStats.positionScope, 'all_skaters'),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
    .groupBy(historicalPlayerSeasonStats.playerId, players.gamertag, players.position)

  // Drizzle returns SUM(...) as a string (or null when the group is empty).
  // Convert back to number for typed columns and recompute rate fields from
  // the summed underlying counts.
  const toInt = (v: string | number | null): number =>
    v === null ? 0 : typeof v === 'number' ? v : Number.parseInt(v, 10) || 0
  const toIntOrNull = (v: string | number | null): number | null =>
    v === null ? null : typeof v === 'number' ? v : Number.parseInt(v, 10)
  const pct = (num: number | null, den: number | null): string | null =>
    num === null || den === null || den === 0 ? null : ((num / den) * 100).toFixed(2)

  const result = rows.map((r) => {
    const fow = toIntOrNull(r.faceoffWins)
    const fol = toIntOrNull(r.faceoffLosses)
    const pc = toIntOrNull(r.passCompletions)
    const pa = toIntOrNull(r.passAttempts)
    return {
      playerId: r.playerId,
      gamertag: r.gamertag,
      position: r.position,
      gamesPlayed: toInt(r.gamesPlayed),
      goals: toInt(r.goals),
      assists: toInt(r.assists),
      points: toInt(r.points),
      plusMinus: toInt(r.plusMinus),
      pim: toInt(r.pim),
      shots: toInt(r.shots),
      hits: toInt(r.hits),
      takeaways: toInt(r.takeaways),
      giveaways: toInt(r.giveaways),
      faceoffPct: pct(fow, (fow ?? 0) + (fol ?? 0)),
      passPct: pct(pc, pa),
      shotAttempts: toInt(r.shotAttempts),
      toiSeconds: toIntOrNull(r.toiSeconds),
    }
  })

  result.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.goals !== a.goals) return b.goals - a.goals
    if (b.assists !== a.assists) return b.assists - a.assists
    return a.gamertag.localeCompare(b.gamertag)
  })

  return result
}

/**
 * Historical goalie season totals aggregated across both 6s and 3s modes.
 *
 * Counts (W/L/OTL/SV/GA/SA/SO/TOI) are summed per player; `savePct` and
 * `gaa` are recomputed from the summed underlying counts. Returns the same
 * row shape as `getHistoricalGoalieStats`.
 */
export async function getHistoricalGoalieStatsAllModes(gameTitleId: number) {
  const rows = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamertag: players.gamertag,
      gamesPlayed: sql<string>`SUM(${historicalPlayerSeasonStats.gamesPlayed})`,
      wins: sql<string | null>`SUM(${historicalPlayerSeasonStats.wins})`,
      losses: sql<string | null>`SUM(${historicalPlayerSeasonStats.losses})`,
      otl: sql<string | null>`SUM(${historicalPlayerSeasonStats.otl})`,
      shutouts: sql<string | null>`SUM(${historicalPlayerSeasonStats.shutouts})`,
      totalSaves: sql<string | null>`SUM(${historicalPlayerSeasonStats.totalSaves})`,
      totalShotsAgainst: sql<string | null>`SUM(${historicalPlayerSeasonStats.totalShotsAgainst})`,
      totalGoalsAgainst: sql<string | null>`SUM(${historicalPlayerSeasonStats.totalGoalsAgainst})`,
      toiSeconds: sql<string | null>`SUM(${historicalPlayerSeasonStats.toiSeconds})`,
    })
    .from(historicalPlayerSeasonStats)
    .innerJoin(players, eq(historicalPlayerSeasonStats.playerId, players.id))
    .where(
      and(
        eq(historicalPlayerSeasonStats.gameTitleId, gameTitleId),
        eq(historicalPlayerSeasonStats.roleGroup, 'goalie'),
        eq(historicalPlayerSeasonStats.positionScope, 'goalie'),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
    .groupBy(historicalPlayerSeasonStats.playerId, players.gamertag)

  const toInt = (v: string | number | null): number =>
    v === null ? 0 : typeof v === 'number' ? v : Number.parseInt(v, 10) || 0
  const toIntOrNull = (v: string | number | null): number | null =>
    v === null ? null : typeof v === 'number' ? v : Number.parseInt(v, 10)

  const result = rows.map((r) => {
    const sv = toIntOrNull(r.totalSaves)
    const ga = toIntOrNull(r.totalGoalsAgainst)
    const toi = toIntOrNull(r.toiSeconds)
    const savePct =
      sv !== null && ga !== null && sv + ga > 0
        ? ((sv / (sv + ga)) * 100).toFixed(2)
        : null
    // GAA = goals_against * 3600 / toi_seconds (per 60 minutes). Only meaningful
    // when both fields are populated across all aggregated mode-rows.
    const gaa =
      ga !== null && toi !== null && toi > 0 ? ((ga * 3600) / toi).toFixed(2) : null
    return {
      playerId: r.playerId,
      gamertag: r.gamertag,
      gamesPlayed: toInt(r.gamesPlayed),
      wins: toIntOrNull(r.wins),
      losses: toIntOrNull(r.losses),
      otl: toIntOrNull(r.otl),
      savePct,
      gaa,
      shutouts: toIntOrNull(r.shutouts),
      totalSaves: sv,
      totalShotsAgainst: toIntOrNull(r.totalShotsAgainst),
      totalGoalsAgainst: ga,
      toiSeconds: toi,
    }
  })

  result.sort((a, b) => {
    const sa = a.savePct === null ? -1 : Number.parseFloat(a.savePct)
    const sb = b.savePct === null ? -1 : Number.parseFloat(b.savePct)
    if (sb !== sa) return sb - sa
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed
    return a.gamertag.localeCompare(b.gamertag)
  })

  return result
}
