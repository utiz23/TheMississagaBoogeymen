import { eq, desc } from 'drizzle-orm'
import { db } from '../client.js'
import { gameTitles } from '../schema/index.js'

/**
 * All game titles, newest first (by id — launchedAt is nullable).
 * Used to populate the game title switcher in the nav.
 */
export async function listGameTitles() {
  return db.select().from(gameTitles).orderBy(desc(gameTitles.id))
}

/**
 * Single game title by URL slug. Returns null if not found.
 */
export async function getGameTitleBySlug(slug: string) {
  const rows = await db.select().from(gameTitles).where(eq(gameTitles.slug, slug)).limit(1)
  return rows[0] ?? null
}
