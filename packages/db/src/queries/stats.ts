import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import { db } from '../client.js'
import { eaMemberSeasonStats, playerGameTitleStats, players } from '../schema/index.js'
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
