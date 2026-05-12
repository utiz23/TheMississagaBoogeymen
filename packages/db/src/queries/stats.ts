import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  eaMemberSeasonStats,
  historicalPlayerSeasonStats,
  playerGameTitleStats,
  players,
} from '../schema/index.js'
import type { GameMode } from '../schema/index.js'

/**
 * Skater season stats for the stats table.
 *
 * Source: player_game_title_stats — local aggregate, authoritative.
 *
 * Includes all players with skaterGp > 0 for this game title and mode.
 * Uses skaterGp as the GP denominator and skaterToiSeconds for TOI/GP.
 *
 * Ordered by points desc → goals desc → assists desc → gamertag asc.
 */
export async function getSkaterStats(gameTitleId: number, gameMode: GameMode | null = null) {
  const gameModeFilter =
    gameMode === null
      ? isNull(playerGameTitleStats.gameMode)
      : eq(playerGameTitleStats.gameMode, gameMode)

  return db
    .select({
      playerId: playerGameTitleStats.playerId,
      gamertag: players.gamertag,
      position: players.position,
      gamesPlayed: playerGameTitleStats.skaterGp,
      goals: playerGameTitleStats.goals,
      assists: playerGameTitleStats.assists,
      points: playerGameTitleStats.points,
      plusMinus: playerGameTitleStats.plusMinus,
      pim: playerGameTitleStats.pim,
      shots: playerGameTitleStats.shots,
      hits: playerGameTitleStats.hits,
      takeaways: playerGameTitleStats.takeaways,
      giveaways: playerGameTitleStats.giveaways,
      faceoffPct: playerGameTitleStats.faceoffPct,
      passPct: playerGameTitleStats.passPct,
      shotAttempts: playerGameTitleStats.shotAttempts,
      toiSeconds: playerGameTitleStats.skaterToiSeconds,
    })
    .from(playerGameTitleStats)
    .innerJoin(players, eq(playerGameTitleStats.playerId, players.id))
    .where(
      and(
        eq(playerGameTitleStats.gameTitleId, gameTitleId),
        gameModeFilter,
        gt(playerGameTitleStats.skaterGp, 0),
      ),
    )
    .orderBy(
      desc(playerGameTitleStats.points),
      desc(playerGameTitleStats.goals),
      desc(playerGameTitleStats.assists),
      asc(players.gamertag),
    )
}

/**
 * Goalie season stats for the stats table.
 *
 * Source: player_game_title_stats — local aggregate, authoritative.
 *
 * Includes only players with goalieGp > 0 for this game title and mode.
 * Uses goalieGp as the GP denominator and goalieToiSeconds for total TOI.
 *
 * Ordered by save_pct desc → goalieGp desc → gaa asc → gamertag asc.
 */
export async function getGoalieStats(gameTitleId: number, gameMode: GameMode | null = null) {
  const gameModeFilter =
    gameMode === null
      ? isNull(playerGameTitleStats.gameMode)
      : eq(playerGameTitleStats.gameMode, gameMode)

  return db
    .select({
      playerId: playerGameTitleStats.playerId,
      gamertag: players.gamertag,
      gamesPlayed: playerGameTitleStats.goalieGp,
      wins: playerGameTitleStats.wins,
      losses: playerGameTitleStats.losses,
      otl: playerGameTitleStats.otl,
      savePct: playerGameTitleStats.savePct,
      gaa: playerGameTitleStats.gaa,
      shutouts: playerGameTitleStats.shutouts,
      totalSaves: playerGameTitleStats.totalSaves,
      totalShotsAgainst: playerGameTitleStats.totalShotsAgainst,
      totalGoalsAgainst: playerGameTitleStats.totalGoalsAgainst,
      toiSeconds: playerGameTitleStats.goalieToiSeconds,
    })
    .from(playerGameTitleStats)
    .innerJoin(players, eq(playerGameTitleStats.playerId, players.id))
    .where(
      and(
        eq(playerGameTitleStats.gameTitleId, gameTitleId),
        gameModeFilter,
        gt(playerGameTitleStats.goalieGp, 0),
      ),
    )
    .orderBy(
      desc(playerGameTitleStats.savePct),
      desc(playerGameTitleStats.goalieGp),
      asc(playerGameTitleStats.gaa),
      asc(players.gamertag),
    )
}

/**
 * EA-authoritative skater season stats for the stats table (All mode).
 *
 * Source: ea_member_season_stats — full EA season totals, not filtered by game mode.
 * Includes all players with skaterGp > 0 for this game title.
 * Shape matches getSkaterStats so consumers can use SkaterStatsRow for both.
 *
 * Ordered by points desc → goals desc → assists desc → gamertag asc.
 */
export async function getEASkaterStats(gameTitleId: number) {
  return db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamertag: players.gamertag,
      position: players.position,
      gamesPlayed: eaMemberSeasonStats.skaterGp,
      goals: eaMemberSeasonStats.goals,
      assists: eaMemberSeasonStats.assists,
      points: eaMemberSeasonStats.points,
      plusMinus: eaMemberSeasonStats.plusMinus,
      pim: eaMemberSeasonStats.pim,
      shots: eaMemberSeasonStats.shots,
      hits: eaMemberSeasonStats.hits,
      takeaways: eaMemberSeasonStats.takeaways,
      giveaways: eaMemberSeasonStats.giveaways,
      faceoffPct: eaMemberSeasonStats.faceoffPct,
      passPct: eaMemberSeasonStats.passPct,
      shotAttempts: eaMemberSeasonStats.shotAttempts,
      toiSeconds: eaMemberSeasonStats.toiSeconds,
    })
    .from(eaMemberSeasonStats)
    .innerJoin(players, eq(eaMemberSeasonStats.playerId, players.id))
    .where(
      and(eq(eaMemberSeasonStats.gameTitleId, gameTitleId), gt(eaMemberSeasonStats.skaterGp, 0)),
    )
    .orderBy(
      desc(eaMemberSeasonStats.points),
      desc(eaMemberSeasonStats.goals),
      desc(eaMemberSeasonStats.assists),
      asc(players.gamertag),
    )
}

/**
 * EA-authoritative goalie season stats for the stats table (All mode).
 *
 * Source: ea_member_season_stats — full EA season totals, not filtered by game mode.
 * Includes only players with goalieGp > 0 for this game title.
 * Shape matches getGoalieStats so consumers can use GoalieStatsRow for both.
 *
 * Ordered by savePct desc → goalieGp desc → gaa asc → gamertag asc.
 */
export async function getEAGoalieStats(gameTitleId: number) {
  return db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamertag: players.gamertag,
      gamesPlayed: eaMemberSeasonStats.goalieGp,
      wins: eaMemberSeasonStats.goalieWins,
      losses: eaMemberSeasonStats.goalieLosses,
      otl: eaMemberSeasonStats.goalieOtl,
      savePct: eaMemberSeasonStats.goalieSavePct,
      gaa: eaMemberSeasonStats.goalieGaa,
      shutouts: eaMemberSeasonStats.goalieShutouts,
      totalSaves: eaMemberSeasonStats.goalieSaves,
      totalShotsAgainst: eaMemberSeasonStats.goalieShots,
      totalGoalsAgainst: eaMemberSeasonStats.goalieGoalsAgainst,
      toiSeconds: eaMemberSeasonStats.goalieToiSeconds,
    })
    .from(eaMemberSeasonStats)
    .innerJoin(players, eq(eaMemberSeasonStats.playerId, players.id))
    .where(
      and(eq(eaMemberSeasonStats.gameTitleId, gameTitleId), gt(eaMemberSeasonStats.goalieGp, 0)),
    )
    .orderBy(
      desc(eaMemberSeasonStats.goalieSavePct),
      desc(eaMemberSeasonStats.goalieGp),
      asc(eaMemberSeasonStats.goalieGaa),
      asc(players.gamertag),
    )
}

export type SkaterStatsRow = Awaited<ReturnType<typeof getSkaterStats>>[number]
export type GoalieStatsRow = Awaited<ReturnType<typeof getGoalieStats>>[number]

/**
 * All-time skater totals across every game title.
 *
 * Combines EA member-season totals (live titles) with reviewed
 * historical_player_season_stats (older titles, all modes summed). Rate fields
 * (faceoffPct, passPct) are recomputed from raw counts so they remain
 * meaningful at the multi-title scope. Shape matches `SkaterStatsRow` so the
 * existing skater table renders unchanged.
 *
 * Filters to players with `gamesPlayed > 0`, sorted by points desc.
 */
export async function getAllTimeSkaterStats(): Promise<SkaterStatsRow[]> {
  const liveAgg = await db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamesPlayed: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.skaterGp}), 0)::int`,
      goals: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goals}), 0)::int`,
      assists: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.assists}), 0)::int`,
      points: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.points}), 0)::int`,
      plusMinus: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.plusMinus}), 0)::int`,
      pim: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.pim}), 0)::int`,
      shots: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.shots}), 0)::int`,
      hits: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.hits}), 0)::int`,
      takeaways: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.takeaways}), 0)::int`,
      giveaways: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.giveaways}), 0)::int`,
      shotAttempts: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.shotAttempts}), 0)::int`,
      faceoffWins: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.faceoffWins}), 0)::int`,
      faceoffLosses: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.faceoffLosses}), 0)::int`,
      passes: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.passes}), 0)::int`,
      passAttempts: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.passAttempts}), 0)::int`,
      toiSeconds: sql<number | null>`SUM(${eaMemberSeasonStats.toiSeconds})::int`,
    })
    .from(eaMemberSeasonStats)
    .groupBy(eaMemberSeasonStats.playerId)

  const histAgg = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamesPlayed: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.gamesPlayed}), 0)::int`,
      goals: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.goals}), 0)::int`,
      assists: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.assists}), 0)::int`,
      points: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.points}), 0)::int`,
      plusMinus: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.plusMinus}), 0)::int`,
      pim: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.pim}), 0)::int`,
      shots: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.shots}), 0)::int`,
      hits: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.hits}), 0)::int`,
      takeaways: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.takeaways}), 0)::int`,
      giveaways: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.giveaways}), 0)::int`,
      shotAttempts: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.shotAttempts}), 0)::int`,
      faceoffWins: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.faceoffWins}), 0)::int`,
      faceoffLosses: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.faceoffLosses}), 0)::int`,
      passCompletions: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.passCompletions}), 0)::int`,
      passAttempts: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.passAttempts}), 0)::int`,
      toiSeconds: sql<number | null>`SUM(${historicalPlayerSeasonStats.toiSeconds})::int`,
    })
    .from(historicalPlayerSeasonStats)
    .where(
      and(
        eq(historicalPlayerSeasonStats.roleGroup, 'skater'),
        eq(historicalPlayerSeasonStats.positionScope, 'all_skaters'),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
    .groupBy(historicalPlayerSeasonStats.playerId)

  const meta = await db
    .select({
      playerId: players.id,
      gamertag: players.gamertag,
      position: players.position,
    })
    .from(players)

  type Agg = {
    gamesPlayed: number
    goals: number
    assists: number
    points: number
    plusMinus: number
    pim: number
    shots: number
    hits: number
    takeaways: number
    giveaways: number
    shotAttempts: number
    faceoffWins: number
    faceoffLosses: number
    passes: number
    passAttempts: number
    toiSeconds: number | null
  }
  const byPlayer = new Map<number, Agg>()
  const empty = (): Agg => ({
    gamesPlayed: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plusMinus: 0,
    pim: 0,
    shots: 0,
    hits: 0,
    takeaways: 0,
    giveaways: 0,
    shotAttempts: 0,
    faceoffWins: 0,
    faceoffLosses: 0,
    passes: 0,
    passAttempts: 0,
    toiSeconds: null,
  })
  const sumToi = (a: number | null, b: number | null): number | null =>
    a === null && b === null ? null : (a ?? 0) + (b ?? 0)

  for (const r of liveAgg) {
    const cur = byPlayer.get(r.playerId) ?? empty()
    byPlayer.set(r.playerId, {
      gamesPlayed: cur.gamesPlayed + r.gamesPlayed,
      goals: cur.goals + r.goals,
      assists: cur.assists + r.assists,
      points: cur.points + r.points,
      plusMinus: cur.plusMinus + r.plusMinus,
      pim: cur.pim + r.pim,
      shots: cur.shots + r.shots,
      hits: cur.hits + r.hits,
      takeaways: cur.takeaways + r.takeaways,
      giveaways: cur.giveaways + r.giveaways,
      shotAttempts: cur.shotAttempts + r.shotAttempts,
      faceoffWins: cur.faceoffWins + r.faceoffWins,
      faceoffLosses: cur.faceoffLosses + r.faceoffLosses,
      passes: cur.passes + r.passes,
      passAttempts: cur.passAttempts + r.passAttempts,
      toiSeconds: sumToi(cur.toiSeconds, r.toiSeconds),
    })
  }
  for (const r of histAgg) {
    const cur = byPlayer.get(r.playerId) ?? empty()
    byPlayer.set(r.playerId, {
      gamesPlayed: cur.gamesPlayed + r.gamesPlayed,
      goals: cur.goals + r.goals,
      assists: cur.assists + r.assists,
      points: cur.points + r.points,
      plusMinus: cur.plusMinus + r.plusMinus,
      pim: cur.pim + r.pim,
      shots: cur.shots + r.shots,
      hits: cur.hits + r.hits,
      takeaways: cur.takeaways + r.takeaways,
      giveaways: cur.giveaways + r.giveaways,
      shotAttempts: cur.shotAttempts + r.shotAttempts,
      faceoffWins: cur.faceoffWins + r.faceoffWins,
      faceoffLosses: cur.faceoffLosses + r.faceoffLosses,
      passes: cur.passes + r.passCompletions,
      passAttempts: cur.passAttempts + r.passAttempts,
      toiSeconds: sumToi(cur.toiSeconds, r.toiSeconds),
    })
  }

  const pct = (num: number, den: number): string | null =>
    den > 0 ? ((num / den) * 100).toFixed(2) : null

  const result: SkaterStatsRow[] = []
  for (const m of meta) {
    const a = byPlayer.get(m.playerId)
    if (!a || a.gamesPlayed === 0) continue
    const foTotal = a.faceoffWins + a.faceoffLosses
    result.push({
      playerId: m.playerId,
      gamertag: m.gamertag,
      position: m.position,
      gamesPlayed: a.gamesPlayed,
      goals: a.goals,
      assists: a.assists,
      points: a.points,
      plusMinus: a.plusMinus,
      pim: a.pim,
      shots: a.shots,
      hits: a.hits,
      takeaways: a.takeaways,
      giveaways: a.giveaways,
      faceoffPct: pct(a.faceoffWins, foTotal),
      passPct: pct(a.passes, a.passAttempts),
      shotAttempts: a.shotAttempts,
      toiSeconds: a.toiSeconds,
    })
  }
  result.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.goals !== a.goals) return b.goals - a.goals
    if (b.assists !== a.assists) return b.assists - a.assists
    return a.gamertag.localeCompare(b.gamertag)
  })
  return result
}

/**
 * All-time goalie totals across every game title.
 *
 * Combines EA member-season totals (live titles) with reviewed
 * historical_player_season_stats (older titles). SV% recomputed from
 * sum(saves)/sum(shots). GAA recomputed from sum(goals_against)*3600/sum(toi)
 * — null when TOI was not captured for any contributing season. Shape matches
 * `GoalieStatsRow` so the existing goalie table renders unchanged.
 *
 * Filters to players with `goalieGp > 0`, sorted by SV% desc.
 */
export async function getAllTimeGoalieStats(): Promise<GoalieStatsRow[]> {
  const liveAgg = await db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamesPlayed: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieGp}), 0)::int`,
      wins: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieWins}), 0)::int`,
      losses: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieLosses}), 0)::int`,
      otl: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieOtl}), 0)::int`,
      shutouts: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieShutouts}), 0)::int`,
      totalSaves: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieSaves}), 0)::int`,
      totalShotsAgainst: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieShots}), 0)::int`,
      totalGoalsAgainst: sql<number>`COALESCE(SUM(${eaMemberSeasonStats.goalieGoalsAgainst}), 0)::int`,
      toiSeconds: sql<number | null>`SUM(${eaMemberSeasonStats.goalieToiSeconds})::int`,
    })
    .from(eaMemberSeasonStats)
    .groupBy(eaMemberSeasonStats.playerId)

  const histAgg = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamesPlayed: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.gamesPlayed}), 0)::int`,
      wins: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.wins}), 0)::int`,
      losses: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.losses}), 0)::int`,
      otl: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.otl}), 0)::int`,
      shutouts: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.shutouts}), 0)::int`,
      totalSaves: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.totalSaves}), 0)::int`,
      totalShotsAgainst: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.totalShotsAgainst}), 0)::int`,
      totalGoalsAgainst: sql<number>`COALESCE(SUM(${historicalPlayerSeasonStats.totalGoalsAgainst}), 0)::int`,
      toiSeconds: sql<number | null>`SUM(${historicalPlayerSeasonStats.toiSeconds})::int`,
    })
    .from(historicalPlayerSeasonStats)
    .where(
      and(
        eq(historicalPlayerSeasonStats.roleGroup, 'goalie'),
        eq(historicalPlayerSeasonStats.positionScope, 'goalie'),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )
    .groupBy(historicalPlayerSeasonStats.playerId)

  const meta = await db
    .select({ playerId: players.id, gamertag: players.gamertag })
    .from(players)

  type Agg = {
    gamesPlayed: number
    wins: number
    losses: number
    otl: number
    shutouts: number
    totalSaves: number
    totalShotsAgainst: number
    totalGoalsAgainst: number
    toiSeconds: number | null
  }
  const byPlayer = new Map<number, Agg>()
  const empty = (): Agg => ({
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    otl: 0,
    shutouts: 0,
    totalSaves: 0,
    totalShotsAgainst: 0,
    totalGoalsAgainst: 0,
    toiSeconds: null,
  })
  const sumToi = (a: number | null, b: number | null): number | null =>
    a === null && b === null ? null : (a ?? 0) + (b ?? 0)
  const addAgg = (id: number, r: Agg) => {
    const cur = byPlayer.get(id) ?? empty()
    byPlayer.set(id, {
      gamesPlayed: cur.gamesPlayed + r.gamesPlayed,
      wins: cur.wins + r.wins,
      losses: cur.losses + r.losses,
      otl: cur.otl + r.otl,
      shutouts: cur.shutouts + r.shutouts,
      totalSaves: cur.totalSaves + r.totalSaves,
      totalShotsAgainst: cur.totalShotsAgainst + r.totalShotsAgainst,
      totalGoalsAgainst: cur.totalGoalsAgainst + r.totalGoalsAgainst,
      toiSeconds: sumToi(cur.toiSeconds, r.toiSeconds),
    })
  }

  for (const r of liveAgg) addAgg(r.playerId, r)
  for (const r of histAgg) addAgg(r.playerId, r)

  const result: GoalieStatsRow[] = []
  for (const m of meta) {
    const a = byPlayer.get(m.playerId)
    if (!a || a.gamesPlayed === 0) continue
    // Compute SV% from saves / (saves + goals_against). Equivalent to saves /
    // shots_against (shots = saves + GA) but robust to historical rows that
    // captured goals_against without shots_against.
    const svDenom = a.totalSaves + a.totalGoalsAgainst
    const savePct = svDenom > 0 ? ((a.totalSaves / svDenom) * 100).toFixed(2) : null
    const gaa =
      a.toiSeconds !== null && a.toiSeconds > 0
        ? ((a.totalGoalsAgainst * 3600) / a.toiSeconds).toFixed(2)
        : null
    // Historical rows captured saves + GA but not shots_against. Derive SA
    // from saves + GA so the Advanced view shows a consistent total instead
    // of an under-count. (Live rows already satisfy shots = saves + GA.)
    const totalShotsAgainst = a.totalSaves + a.totalGoalsAgainst
    result.push({
      playerId: m.playerId,
      gamertag: m.gamertag,
      gamesPlayed: a.gamesPlayed,
      wins: a.wins,
      losses: a.losses,
      otl: a.otl,
      savePct,
      gaa,
      shutouts: a.shutouts,
      totalSaves: a.totalSaves,
      totalShotsAgainst,
      totalGoalsAgainst: a.totalGoalsAgainst,
      toiSeconds: a.toiSeconds,
    })
  }
  result.sort((a, b) => {
    const sa = a.savePct === null ? -1 : Number.parseFloat(a.savePct)
    const sb = b.savePct === null ? -1 : Number.parseFloat(b.savePct)
    if (sb !== sa) return sb - sa
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed
    return a.gamertag.localeCompare(b.gamertag)
  })
  return result
}
