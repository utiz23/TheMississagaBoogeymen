import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../client.js'
import { clubGameTitleStats, clubSeasonalStats } from '../schema/index.js'
import type { GameMode } from '../schema/index.js'

/**
 * Club aggregate stats for a given game title.
 *
 * gameMode defaults to null = all-modes combined row. Pass '6s' or '3s' for
 * mode-specific rows emitted by the Phase 2 aggregate dimension.
 *
 * Returns null when no aggregate row exists (worker has not yet run).
 * All integer fields (wins, losses, otl, etc.) default to 0 in the schema,
 * so a non-null result always has complete integer data.
 * Numeric rate fields (shotsPerGame, hitsPerGame, faceoffPct, passPct) are
 * nullable — null means the worker has not yet computed them.
 */
/**
 * Official EA club record from clubs/seasonalStats.
 *
 * Returns null when no snapshot has been captured yet (worker has not yet fetched
 * from the EA endpoint). Never falls back to local aggregate counts.
 * Display an honest unavailable state when this returns null.
 */
export async function getOfficialClubRecord(gameTitleId: number) {
  const rows = await db
    .select()
    .from(clubSeasonalStats)
    .where(eq(clubSeasonalStats.gameTitleId, gameTitleId))
    .limit(1)
  return rows[0] ?? null
}

export async function getClubStats(gameTitleId: number, gameMode: GameMode | null = null) {
  const gameModeFilter =
    gameMode === null
      ? isNull(clubGameTitleStats.gameMode)
      : eq(clubGameTitleStats.gameMode, gameMode)
  const rows = await db
    .select()
    .from(clubGameTitleStats)
    .where(and(eq(clubGameTitleStats.gameTitleId, gameTitleId), gameModeFilter))
    .limit(1)
  return rows[0] ?? null
}
