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
