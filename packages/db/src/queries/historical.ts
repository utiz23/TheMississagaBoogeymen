import { and, asc, desc, eq } from 'drizzle-orm'
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

export type HistoricalSkaterStatsRow = Awaited<ReturnType<typeof getHistoricalSkaterStats>>[number]

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
  return db
    .select({
      playerId: historicalPlayerSeasonStats.playerId,
      gamertag: players.gamertag,
      gamesPlayed: historicalPlayerSeasonStats.gamesPlayed,
      wins: historicalPlayerSeasonStats.wins,
      losses: historicalPlayerSeasonStats.losses,
      otl: historicalPlayerSeasonStats.otl,
      savePct: historicalPlayerSeasonStats.savePct,
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
      desc(historicalPlayerSeasonStats.savePct),
      desc(historicalPlayerSeasonStats.gamesPlayed),
      asc(historicalPlayerSeasonStats.gaa),
      asc(players.gamertag),
    )
}

export type HistoricalGoalieStatsRow = Awaited<ReturnType<typeof getHistoricalGoalieStats>>[number]
