import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '../client.js'
import {
  eaMemberSeasonStats,
  historicalPlayerSeasonStats,
  playerGameTitleStats,
  players,
} from '../schema/index.js'
import type { GameMode } from '../schema/index.js'
import { maskPlayerWideGoalieRecord } from './goalie-record-mask.js'
import {
  excludeHistoricalRowsCoveredByEa,
  aggregateSkaterCareerRows,
  aggregateGoalieCareerRows,
  type CareerCoverage,
  type CareerSkaterCountRow,
  type CareerGoalieCountRow,
} from './career-coverage.js'

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
 * W/L/OTL: the stored `wins/losses/otl` are the player's results across EVERY
 * role, not a goalie-only record, so they are returned as null with
 * `recordUnavailable: true` (see goalie-record-mask.ts). Stored values are
 * untouched; a real goalie-only record needs separate aggregate columns.
 *
 * Ordered by save_pct desc → goalieGp desc → gaa asc → gamertag asc.
 */
export async function getGoalieStats(gameTitleId: number, gameMode: GameMode | null = null) {
  const gameModeFilter =
    gameMode === null
      ? isNull(playerGameTitleStats.gameMode)
      : eq(playerGameTitleStats.gameMode, gameMode)

  const rows = await db
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

  return maskPlayerWideGoalieRecord(rows)
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
type LocalGoalieStatsRow = Awaited<ReturnType<typeof getGoalieStats>>[number]
/**
 * Shared goalie row shape. `recordUnavailable` is set only by `getGoalieStats`
 * (local 6s/3s); EA and career rows leave it undefined.
 */
export type GoalieStatsRow = Omit<LocalGoalieStatsRow, 'recordUnavailable'> & {
  recordUnavailable?: true
}

/**
 * EA-only expanded skater stats (Active title + All mode). Keyed to the same
 * players as getEASkaterStats; the roster table merges by playerId. Decimal
 * columns arrive as strings (numeric) or null; counts are numbers.
 */
export async function getEASkaterExpandedStats(gameTitleId: number) {
  return db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      powerPlayGoals: eaMemberSeasonStats.powerPlayGoals,
      shortHandedGoals: eaMemberSeasonStats.shortHandedGoals,
      gameWinningGoals: eaMemberSeasonStats.gameWinningGoals,
      hatTricks: eaMemberSeasonStats.hatTricks,
      shotPct: eaMemberSeasonStats.shotPct,
      shotOnNetPct: eaMemberSeasonStats.shotOnNetPct,
      passes: eaMemberSeasonStats.passes,
      passAttempts: eaMemberSeasonStats.passAttempts,
      saucerPasses: eaMemberSeasonStats.saucerPasses,
      possessionSeconds: eaMemberSeasonStats.possessionSeconds,
      dekes: eaMemberSeasonStats.dekes,
      dekesMade: eaMemberSeasonStats.dekesMade,
      deflections: eaMemberSeasonStats.deflections,
      faceoffWins: eaMemberSeasonStats.faceoffWins,
      faceoffLosses: eaMemberSeasonStats.faceoffLosses,
      blockedShots: eaMemberSeasonStats.blockedShots,
      interceptions: eaMemberSeasonStats.interceptions,
      pkClearZone: eaMemberSeasonStats.pkClearZone,
      penaltiesDrawn: eaMemberSeasonStats.penaltiesDrawn,
      offsides: eaMemberSeasonStats.offsides,
      fights: eaMemberSeasonStats.fights,
      fightsWon: eaMemberSeasonStats.fightsWon,
      breakaways: eaMemberSeasonStats.breakaways,
      breakawayGoals: eaMemberSeasonStats.breakawayGoals,
      breakawayPct: eaMemberSeasonStats.breakawayPct,
      penaltyShotAttempts: eaMemberSeasonStats.penaltyShotAttempts,
      penaltyShotGoals: eaMemberSeasonStats.penaltyShotGoals,
      penaltyShotPct: eaMemberSeasonStats.penaltyShotPct,
    })
    .from(eaMemberSeasonStats)
    .where(
      and(eq(eaMemberSeasonStats.gameTitleId, gameTitleId), gt(eaMemberSeasonStats.skaterGp, 0)),
    )
}

/** EA-only expanded goalie stats (Active title + All mode). Counterpart of getEASkaterExpandedStats. */
export async function getEAGoalieExpandedStats(gameTitleId: number) {
  return db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      shutoutPeriods: eaMemberSeasonStats.goalieShutoutPeriods,
      desperationSaves: eaMemberSeasonStats.goalieDesperationSaves,
      breakawayShots: eaMemberSeasonStats.goalieBrkShots,
      breakawaySaves: eaMemberSeasonStats.goalieBrkSaves,
      breakawaySavePct: eaMemberSeasonStats.goalieBrkSavePct,
      penaltyShots: eaMemberSeasonStats.goaliePenShots,
      penaltyShotSaves: eaMemberSeasonStats.goaliePenSaves,
      penaltyShotSavePct: eaMemberSeasonStats.goaliePenSavePct,
      pokeChecks: eaMemberSeasonStats.goaliePokeChecks,
      pkClearZone: eaMemberSeasonStats.goaliePkClearZone,
    })
    .from(eaMemberSeasonStats)
    .where(
      and(eq(eaMemberSeasonStats.gameTitleId, gameTitleId), gt(eaMemberSeasonStats.goalieGp, 0)),
    )
}

export type EASkaterExpandedRow = Awaited<ReturnType<typeof getEASkaterExpandedStats>>[number]
export type EAGoalieExpandedRow = Awaited<ReturnType<typeof getEAGoalieExpandedStats>>[number]

/**
 * Career skater row: `SkaterStatsRow` plus TOI coverage metadata.
 *
 * `toiSeconds`/`gamesPlayed` keep their normal meaning (total career TOI and
 * total career GP); `toiCoverageGp` is the GP from exactly the rows that
 * contributed to `toiSeconds`, which is the correct TOI/GP denominator — see
 * `career-coverage.ts`.
 */
export type CareerSkaterStatsRow = SkaterStatsRow & {
  toiCoverageGp: number
  toiCoverage: CareerCoverage
}

/**
 * All-time skater totals across every game title.
 *
 * Combines EA member-season totals (live titles) with reviewed
 * historical_player_season_stats (older titles, all modes summed), applying
 * the same source precedence as `getPlayerCareerSeasons`: an EA row is
 * authoritative for its player+title, so any reviewed historical row for
 * that exact player+title is excluded (see `excludeHistoricalRowsCoveredByEa`
 * — production currently has zero overlaps, but the exclusion always runs).
 *
 * Rate fields (faceoffPct, passPct) are recomputed from raw counts across
 * every selected row, unaffected by TOI coverage. TOI/GP coverage is
 * computed by `aggregateSkaterCareerRows`: TOI sums only rows that captured
 * it, paired with the GP from those same rows — reviewed NHL 22-25
 * player-card rows have GP but no TOI, so a naive TOI-sum ÷ total-GP
 * previously understated career TOI/GP.
 *
 * Shape matches `SkaterStatsRow` (plus coverage metadata) so the existing
 * skater table renders unchanged for every other field. Filters to players
 * with `gamesPlayed > 0`, sorted by points desc.
 */
export async function getAllTimeSkaterStats(): Promise<CareerSkaterStatsRow[]> {
  const eaRows = await db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gameTitleId: eaMemberSeasonStats.gameTitleId,
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
      shotAttempts: eaMemberSeasonStats.shotAttempts,
      faceoffWins: eaMemberSeasonStats.faceoffWins,
      faceoffLosses: eaMemberSeasonStats.faceoffLosses,
      passCompletions: eaMemberSeasonStats.passes,
      passAttempts: eaMemberSeasonStats.passAttempts,
      toiSeconds: eaMemberSeasonStats.toiSeconds,
    })
    .from(eaMemberSeasonStats)

  const historicalRowsRaw = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gameTitleId: historicalPlayerSeasonStats.gameTitleId,
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
      shotAttempts: historicalPlayerSeasonStats.shotAttempts,
      faceoffWins: historicalPlayerSeasonStats.faceoffWins,
      faceoffLosses: historicalPlayerSeasonStats.faceoffLosses,
      passCompletions: historicalPlayerSeasonStats.passCompletions,
      passAttempts: historicalPlayerSeasonStats.passAttempts,
      toiSeconds: historicalPlayerSeasonStats.toiSeconds,
    })
    .from(historicalPlayerSeasonStats)
    .where(
      and(
        eq(historicalPlayerSeasonStats.roleGroup, 'skater'),
        eq(historicalPlayerSeasonStats.positionScope, 'all_skaters'),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )

  const historicalRows = excludeHistoricalRowsCoveredByEa(eaRows, historicalRowsRaw)

  const meta = await db
    .select({
      playerId: players.id,
      gamertag: players.gamertag,
      position: players.position,
    })
    .from(players)

  const rowsByPlayer = new Map<number, CareerSkaterCountRow[]>()
  const pushRow = (playerId: number, row: CareerSkaterCountRow): void => {
    const group = rowsByPlayer.get(playerId) ?? []
    group.push(row)
    rowsByPlayer.set(playerId, group)
  }
  const orZero = (v: number | null): number => v ?? 0
  for (const r of eaRows) {
    pushRow(r.playerId, {
      gamesPlayed: r.gamesPlayed,
      goals: r.goals,
      assists: r.assists,
      points: r.points,
      plusMinus: r.plusMinus,
      pim: r.pim,
      shots: r.shots,
      hits: r.hits,
      takeaways: r.takeaways,
      giveaways: r.giveaways,
      shotAttempts: r.shotAttempts,
      faceoffWins: orZero(r.faceoffWins),
      faceoffLosses: orZero(r.faceoffLosses),
      passCompletions: r.passCompletions,
      passAttempts: r.passAttempts,
      toiSeconds: r.toiSeconds,
    })
  }
  for (const r of historicalRows) {
    pushRow(r.playerId, {
      gamesPlayed: r.gamesPlayed,
      goals: r.goals,
      assists: r.assists,
      points: r.points,
      plusMinus: r.plusMinus,
      pim: r.pim,
      shots: r.shots,
      hits: r.hits,
      takeaways: r.takeaways,
      giveaways: r.giveaways,
      shotAttempts: r.shotAttempts,
      faceoffWins: orZero(r.faceoffWins),
      faceoffLosses: orZero(r.faceoffLosses),
      passCompletions: orZero(r.passCompletions),
      passAttempts: orZero(r.passAttempts),
      toiSeconds: r.toiSeconds,
    })
  }

  const result: CareerSkaterStatsRow[] = []
  for (const m of meta) {
    const rows = rowsByPlayer.get(m.playerId)
    if (rows === undefined) continue
    const a = aggregateSkaterCareerRows(rows)
    if (a.gamesPlayed === 0) continue
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
      faceoffPct: a.faceoffPct,
      passPct: a.passPct,
      shotAttempts: a.shotAttempts,
      toiSeconds: a.toiSeconds,
      toiCoverageGp: a.toiCoverageGp,
      toiCoverage: a.toiCoverage,
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
 * Career goalie row: `GoalieStatsRow` plus TOI and GAA coverage metadata.
 * `gaa` in the returned row is calculated only from same-row covered GA and
 * TOI — see `aggregateGoalieCareerRows` in `career-coverage.ts`.
 */
export type CareerGoalieStatsRow = GoalieStatsRow & {
  toiCoverageGp: number
  toiCoverage: CareerCoverage
  gaaCoveredGoalsAgainst: number | null
  gaaCoverageGp: number
  gaaCoverage: CareerCoverage
}

/**
 * All-time goalie totals across every game title.
 *
 * Combines EA member-season totals (live titles) with reviewed
 * historical_player_season_stats (older titles), applying the same
 * player+title source precedence as `getAllTimeSkaterStats` (see
 * `excludeHistoricalRowsCoveredByEa`).
 *
 * SV% and total-shots-against derivation are unaffected by TOI coverage —
 * they still sum saves/GA across every selected row (see
 * `aggregateGoalieCareerRows`). GAA, however, is computed only from GA and
 * TOI captured on the SAME rows: reviewed NHL 22-25 player-card rows have GP
 * and GA but no TOI, so the previous formula (GA summed across every row,
 * divided by TOI summed across only the TOI-having rows) mismatched
 * numerator and denominator and produced a badly inflated GAA (e.g. 39.41
 * instead of the same-row-covered 4.87). Shape matches `GoalieStatsRow`
 * (plus coverage metadata) so the existing goalie table renders unchanged
 * for every other field.
 *
 * Filters to players with `goalieGp > 0`, sorted by SV% desc.
 */
export async function getAllTimeGoalieStats(): Promise<CareerGoalieStatsRow[]> {
  const eaRows = await db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gameTitleId: eaMemberSeasonStats.gameTitleId,
      gamesPlayed: eaMemberSeasonStats.goalieGp,
      wins: eaMemberSeasonStats.goalieWins,
      losses: eaMemberSeasonStats.goalieLosses,
      otl: eaMemberSeasonStats.goalieOtl,
      shutouts: eaMemberSeasonStats.goalieShutouts,
      totalSaves: eaMemberSeasonStats.goalieSaves,
      totalGoalsAgainst: eaMemberSeasonStats.goalieGoalsAgainst,
      toiSeconds: eaMemberSeasonStats.goalieToiSeconds,
    })
    .from(eaMemberSeasonStats)

  const historicalRowsRaw = await db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gameTitleId: historicalPlayerSeasonStats.gameTitleId,
      gamesPlayed: historicalPlayerSeasonStats.gamesPlayed,
      wins: historicalPlayerSeasonStats.wins,
      losses: historicalPlayerSeasonStats.losses,
      otl: historicalPlayerSeasonStats.otl,
      shutouts: historicalPlayerSeasonStats.shutouts,
      totalSaves: historicalPlayerSeasonStats.totalSaves,
      totalGoalsAgainst: historicalPlayerSeasonStats.totalGoalsAgainst,
      toiSeconds: historicalPlayerSeasonStats.toiSeconds,
    })
    .from(historicalPlayerSeasonStats)
    .where(
      and(
        eq(historicalPlayerSeasonStats.roleGroup, 'goalie'),
        eq(historicalPlayerSeasonStats.positionScope, 'goalie'),
        eq(historicalPlayerSeasonStats.reviewStatus, 'reviewed'),
      ),
    )

  const historicalRows = excludeHistoricalRowsCoveredByEa(eaRows, historicalRowsRaw)

  const meta = await db.select({ playerId: players.id, gamertag: players.gamertag }).from(players)

  const rowsByPlayer = new Map<number, CareerGoalieCountRow[]>()
  const pushRow = (playerId: number, row: CareerGoalieCountRow): void => {
    const group = rowsByPlayer.get(playerId) ?? []
    group.push(row)
    rowsByPlayer.set(playerId, group)
  }
  for (const r of [...eaRows, ...historicalRows]) {
    pushRow(r.playerId, {
      gamesPlayed: r.gamesPlayed,
      wins: r.wins,
      losses: r.losses,
      otl: r.otl,
      shutouts: r.shutouts,
      totalSaves: r.totalSaves,
      totalGoalsAgainst: r.totalGoalsAgainst,
      toiSeconds: r.toiSeconds,
    })
  }

  const result: CareerGoalieStatsRow[] = []
  for (const m of meta) {
    const rows = rowsByPlayer.get(m.playerId)
    if (rows === undefined) continue
    const a = aggregateGoalieCareerRows(rows)
    if (a.gamesPlayed === 0) continue
    result.push({
      playerId: m.playerId,
      gamertag: m.gamertag,
      gamesPlayed: a.gamesPlayed,
      wins: a.wins,
      losses: a.losses,
      otl: a.otl,
      savePct: a.savePct,
      gaa: a.gaa,
      shutouts: a.shutouts,
      totalSaves: a.totalSaves,
      totalShotsAgainst: a.totalShotsAgainst,
      totalGoalsAgainst: a.totalGoalsAgainst,
      toiSeconds: a.toiSeconds,
      toiCoverageGp: a.toiCoverageGp,
      toiCoverage: a.toiCoverage,
      gaaCoveredGoalsAgainst: a.gaaCoveredGoalsAgainst,
      gaaCoverageGp: a.gaaCoverageGp,
      gaaCoverage: a.gaaCoverage,
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
