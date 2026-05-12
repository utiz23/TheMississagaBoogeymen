import { and, eq, isNotNull, ne, gte } from 'drizzle-orm'
import { db } from '../client.js'
import { eaMemberSeasonStats } from '../schema/index.js'
import type { ShotLocations } from '../schema/ea-member-season-stats.js'

const ICE_LEN = 16
const NET_LEN = 5

/**
 * Compute per-zone team-average shot/goal grids for a given game title.
 *
 * Filters:
 *   - shot_locations IS NOT NULL
 *   - games_played >= 5         (filter tryouts / one-game members)
 *   - favorite_position != 'goalie'
 *
 * Returns four arrays of floats (averages, not rounded).
 * If no qualifying rows exist, all averages are 0.
 */
export async function getTeamAverageShotLocations(
  gameTitleId: number,
): Promise<ShotLocations> {
  const rows = await db
    .select({ shotLocations: eaMemberSeasonStats.shotLocations })
    .from(eaMemberSeasonStats)
    .where(
      and(
        eq(eaMemberSeasonStats.gameTitleId, gameTitleId),
        isNotNull(eaMemberSeasonStats.shotLocations),
        gte(eaMemberSeasonStats.gamesPlayed, 5),
        ne(eaMemberSeasonStats.favoritePosition, 'goalie'),
      ),
    )

  const shotsIce = new Array(ICE_LEN).fill(0)
  const goalsIce = new Array(ICE_LEN).fill(0)
  const shotsNet = new Array(NET_LEN).fill(0)
  const goalsNet = new Array(NET_LEN).fill(0)
  let count = 0

  for (const row of rows) {
    const sl = row.shotLocations
    if (!sl) continue
    count++
    for (let i = 0; i < ICE_LEN; i++) {
      shotsIce[i] += sl.shotsIce[i] ?? 0
      goalsIce[i] += sl.goalsIce[i] ?? 0
    }
    for (let i = 0; i < NET_LEN; i++) {
      shotsNet[i] += sl.shotsNet[i] ?? 0
      goalsNet[i] += sl.goalsNet[i] ?? 0
    }
  }

  if (count === 0) {
    return { shotsIce, goalsIce, shotsNet, goalsNet }
  }

  return {
    shotsIce: shotsIce.map((v) => v / count),
    goalsIce: goalsIce.map((v) => v / count),
    shotsNet: shotsNet.map((v) => v / count),
    goalsNet: goalsNet.map((v) => v / count),
  }
}

/**
 * Sum shot/goal zone arrays across qualifying non-goalie skaters for a game title.
 *
 * Same population as getTeamAverageShotLocations (gamesPlayed >= 5, non-goalie)
 * but returns raw integer sums instead of per-player averages.
 * Used for the team-level shot heatmap on the stats page.
 */
export async function getTeamShotLocationAggregates(
  gameTitleId: number,
): Promise<ShotLocations> {
  const rows = await db
    .select({ shotLocations: eaMemberSeasonStats.shotLocations })
    .from(eaMemberSeasonStats)
    .where(
      and(
        eq(eaMemberSeasonStats.gameTitleId, gameTitleId),
        isNotNull(eaMemberSeasonStats.shotLocations),
        gte(eaMemberSeasonStats.gamesPlayed, 5),
        ne(eaMemberSeasonStats.favoritePosition, 'goalie'),
      ),
    )

  const shotsIce = new Array(ICE_LEN).fill(0)
  const goalsIce = new Array(ICE_LEN).fill(0)
  const shotsNet = new Array(NET_LEN).fill(0)
  const goalsNet = new Array(NET_LEN).fill(0)

  for (const row of rows) {
    const sl = row.shotLocations
    if (!sl) continue
    for (let i = 0; i < ICE_LEN; i++) {
      shotsIce[i] += sl.shotsIce[i] ?? 0
      goalsIce[i] += sl.goalsIce[i] ?? 0
    }
    for (let i = 0; i < NET_LEN; i++) {
      shotsNet[i] += sl.shotsNet[i] ?? 0
      goalsNet[i] += sl.goalsNet[i] ?? 0
    }
  }

  return { shotsIce, goalsIce, shotsNet, goalsNet }
}

/**
 * Sum goalie shot/goal-against zone arrays across qualifying goalies for a
 * game title.
 *
 * Defensive analogue of `getTeamShotLocationAggregates`: where the offensive
 * variant tells "where our skaters shot from," this tells "where opponents
 * shot from when we were defending." Pair with `role="goalie"` in the shot
 * map renderer so the ice flips to put the defending net at the bottom.
 *
 * Filters mirror `getTeamAverageGoalieShotLocations` (gp >= 1 since the team
 * carries 3–5 goalies and a 5-game cutoff would zero the cohort).
 */
export async function getTeamGoalieShotLocationAggregates(
  gameTitleId: number,
): Promise<ShotLocations> {
  const rows = await db
    .select({ goalieShotLocations: eaMemberSeasonStats.goalieShotLocations })
    .from(eaMemberSeasonStats)
    .where(
      and(
        eq(eaMemberSeasonStats.gameTitleId, gameTitleId),
        isNotNull(eaMemberSeasonStats.goalieShotLocations),
        gte(eaMemberSeasonStats.goalieGp, 1),
      ),
    )

  const shotsIce = new Array(ICE_LEN).fill(0)
  const goalsIce = new Array(ICE_LEN).fill(0)
  const shotsNet = new Array(NET_LEN).fill(0)
  const goalsNet = new Array(NET_LEN).fill(0)

  for (const row of rows) {
    const sl = row.goalieShotLocations
    if (!sl) continue
    for (let i = 0; i < ICE_LEN; i++) {
      shotsIce[i] += sl.shotsIce[i] ?? 0
      goalsIce[i] += sl.goalsIce[i] ?? 0
    }
    for (let i = 0; i < NET_LEN; i++) {
      shotsNet[i] += sl.shotsNet[i] ?? 0
      goalsNet[i] += sl.goalsNet[i] ?? 0
    }
  }

  return { shotsIce, goalsIce, shotsNet, goalsNet }
}

/**
 * Compute per-zone team-average GOALIE shot/goal-against grids.
 *
 * Filters:
 *   - goalie_shot_locations IS NOT NULL
 *   - goalie_gp >= 1 (looser than the skater 5-game threshold since the team
 *     typically only has 3–5 goalies; a 5-game cutoff would zero the cohort).
 *
 * Returns shots faced + goals allowed averaged across qualifying goalies.
 * If no rows qualify, returns all zeros.
 */
export async function getTeamAverageGoalieShotLocations(
  gameTitleId: number,
): Promise<ShotLocations> {
  const rows = await db
    .select({ goalieShotLocations: eaMemberSeasonStats.goalieShotLocations })
    .from(eaMemberSeasonStats)
    .where(
      and(
        eq(eaMemberSeasonStats.gameTitleId, gameTitleId),
        isNotNull(eaMemberSeasonStats.goalieShotLocations),
        gte(eaMemberSeasonStats.goalieGp, 1),
      ),
    )

  const shotsIce = new Array(ICE_LEN).fill(0)
  const goalsIce = new Array(ICE_LEN).fill(0)
  const shotsNet = new Array(NET_LEN).fill(0)
  const goalsNet = new Array(NET_LEN).fill(0)
  let count = 0

  for (const row of rows) {
    const sl = row.goalieShotLocations
    if (!sl) continue
    count++
    for (let i = 0; i < ICE_LEN; i++) {
      shotsIce[i] += sl.shotsIce[i] ?? 0
      goalsIce[i] += sl.goalsIce[i] ?? 0
    }
    for (let i = 0; i < NET_LEN; i++) {
      shotsNet[i] += sl.shotsNet[i] ?? 0
      goalsNet[i] += sl.goalsNet[i] ?? 0
    }
  }

  if (count === 0) return { shotsIce, goalsIce, shotsNet, goalsNet }

  return {
    shotsIce: shotsIce.map((v) => v / count),
    goalsIce: goalsIce.map((v) => v / count),
    shotsNet: shotsNet.map((v) => v / count),
    goalsNet: goalsNet.map((v) => v / count),
  }
}
