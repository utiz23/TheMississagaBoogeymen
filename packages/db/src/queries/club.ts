import { eq } from 'drizzle-orm'
import { db } from '../client.js'
import { clubGameTitleStats } from '../schema/index.js'

/**
 * Club aggregate stats for a given game title.
 *
 * Returns null when no aggregate row exists (worker has not yet run).
 * All integer fields (wins, losses, otl, etc.) default to 0 in the schema,
 * so a non-null result always has complete integer data.
 * Numeric rate fields (shotsPerGame, hitsPerGame, faceoffPct, passPct) are
 * nullable — null means the worker has not yet computed them.
 */
export async function getClubStats(gameTitleId: number) {
  const rows = await db
    .select()
    .from(clubGameTitleStats)
    .where(eq(clubGameTitleStats.gameTitleId, gameTitleId))
    .limit(1)
  return rows[0] ?? null
}
