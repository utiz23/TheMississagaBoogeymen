import { eq, desc } from 'drizzle-orm'
import { db } from '../client.js'
import { matches } from '../schema/index.js'

/**
 * Most recent matches for a given game title, newest first.
 * All matches are returned from our club's perspective (single-club system).
 */
export async function getRecentMatches(params: { gameTitleId: number; limit?: number }) {
  return db
    .select()
    .from(matches)
    .where(eq(matches.gameTitleId, params.gameTitleId))
    .orderBy(desc(matches.playedAt))
    .limit(params.limit ?? 50)
}

/**
 * Single match by surrogate PK. Returns null if not found.
 */
export async function getMatchById(id: number) {
  const rows = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
  return rows[0] ?? null
}
