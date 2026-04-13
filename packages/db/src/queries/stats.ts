import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm'
import { db } from '../client.js'
import { eaMemberSeasonStats } from '../schema/index.js'

/**
 * Skater season stats for the stats table.
 *
 * Source: ea_member_season_stats — EA /members/stats authoritative season totals.
 *
 * Includes all players whose favoritePosition is not 'goalie' (or is null).
 * This mirrors the EA reference: primary skaters appear in the skater section
 * even when they have some goalie appearances (e.g. an LW with 14 goalie games).
 *
 * Ordered by points desc → goals desc → assists desc → gamertag asc.
 */
export async function getSkaterStats(gameTitleId: number) {
  return db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamertag: eaMemberSeasonStats.gamertag,
      // favoritePosition exposed as 'position' to match existing SkaterStatsRow shape
      position: eaMemberSeasonStats.favoritePosition,
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
    .where(
      and(
        eq(eaMemberSeasonStats.gameTitleId, gameTitleId),
        or(
          ne(eaMemberSeasonStats.favoritePosition, 'goalie'),
          isNull(eaMemberSeasonStats.favoritePosition),
        ),
      ),
    )
    .orderBy(
      desc(eaMemberSeasonStats.points),
      desc(eaMemberSeasonStats.goals),
      desc(eaMemberSeasonStats.assists),
      asc(eaMemberSeasonStats.gamertag),
    )
}

/**
 * Goalie season stats for the stats table.
 *
 * Source: ea_member_season_stats — EA /members/stats authoritative season totals.
 *
 * Includes only players whose favoritePosition = 'goalie'.
 * Returns goalie-specific stats (goalieGp, goalieSavePct, etc.) mapped to the
 * existing GoalieStatsRow shape for component compatibility.
 *
 * Ordered by save_pct desc (nulls last) → games_played desc → gaa asc → gamertag asc.
 */
export async function getGoalieStats(gameTitleId: number) {
  return db
    .select({
      playerId: eaMemberSeasonStats.playerId,
      gamertag: eaMemberSeasonStats.gamertag,
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
    .where(
      and(
        eq(eaMemberSeasonStats.gameTitleId, gameTitleId),
        eq(eaMemberSeasonStats.favoritePosition, 'goalie'),
      ),
    )
    .orderBy(
      desc(eaMemberSeasonStats.goalieSavePct),
      desc(eaMemberSeasonStats.goalieGp),
      asc(eaMemberSeasonStats.goalieGaa),
      asc(eaMemberSeasonStats.gamertag),
    )
}

export type SkaterStatsRow = Awaited<ReturnType<typeof getSkaterStats>>[number]
export type GoalieStatsRow = Awaited<ReturnType<typeof getGoalieStats>>[number]
