import { eq, desc } from 'drizzle-orm'
import { db } from '../client.js'
import { gameTitles } from '../schema/index.js'

/**
 * Active game titles only, newest first (by id — launchedAt is nullable).
 * Inactive (legacy) titles such as NHL 23–25 remain in the table to support
 * the historical-archive pipeline but must not surface on the live site.
 */
export async function listGameTitles() {
  return db
    .select()
    .from(gameTitles)
    .where(eq(gameTitles.isActive, true))
    .orderBy(desc(gameTitles.id))
}

/**
 * Inactive archive titles only, newest first.
 */
export async function listArchiveGameTitles() {
  const rows = await db
    .select()
    .from(gameTitles)
    .where(eq(gameTitles.isActive, false))
  return rows.sort((a, b) => {
    const aYear = Number.parseInt(a.slug.replace(/^\D+/u, ''), 10)
    const bYear = Number.parseInt(b.slug.replace(/^\D+/u, ''), 10)
    return bYear - aYear
  })
}

/**
 * Single game title by URL slug. Returns null if not found.
 */
export async function getGameTitleBySlug(slug: string) {
  const rows = await db.select().from(gameTitles).where(eq(gameTitles.slug, slug)).limit(1)
  return rows[0] ?? null
}

/**
 * Active game title by slug.
 */
export async function getActiveGameTitleBySlug(slug: string) {
  const rows = await db
    .select()
    .from(gameTitles)
    .where(eq(gameTitles.slug, slug))
    .limit(1)
  const row = rows[0] ?? null
  return row?.isActive ? row : null
}

/**
 * Inactive archive title by slug.
 */
export async function getArchiveGameTitleBySlug(slug: string) {
  const rows = await db
    .select()
    .from(gameTitles)
    .where(eq(gameTitles.slug, slug))
    .limit(1)
  const row = rows[0] ?? null
  return row && !row.isActive ? row : null
}
