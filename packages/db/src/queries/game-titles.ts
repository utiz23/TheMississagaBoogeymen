import { eq, getTableColumns, sql } from 'drizzle-orm'
import { db } from '../client.js'
import { gameTitles, matches } from '../schema/index.js'
import type { GameTitle } from '../schema/index.js'

/**
 * Title chronology, newest first, from the explicit `release_order` control
 * (migration 0057) — never from `id`, and never from `is_default`.
 *
 * A title whose `release_order` is unset sorts after every ordered title. Ties
 * (only possible among unset titles) break by slug, code-unit ascending: that
 * keeps the order deterministic, but it is NOT chronology — set
 * `release_order` for any such title.
 */
export interface TitleChronologyKey {
  releaseOrder: number | null
  slug: string
}

export function compareGameTitlesNewestFirst(a: TitleChronologyKey, b: TitleChronologyKey): number {
  if (a.releaseOrder !== b.releaseOrder) {
    if (a.releaseOrder === null) return 1
    if (b.releaseOrder === null) return -1
    return b.releaseOrder - a.releaseOrder
  }
  if (a.slug === b.slug) return 0
  return a.slug < b.slug ? -1 : 1
}

/** SQL mirror of `compareGameTitlesNewestFirst`, for queries that join `game_titles`. */
export const GAME_TITLE_NEWEST_FIRST = [
  sql`${gameTitles.releaseOrder} DESC NULLS LAST`,
  sql`${gameTitles.slug} COLLATE "C" ASC`,
]

/**
 * Live (match-backed) vs archive (reviewed historical import only) view class.
 * A title is live when the worker polls it OR it already has captured matches,
 * so a title keeps its match-derived pages after polling stops (NHL 26 after
 * the NHL 27 cutover). Independent of the frontend default.
 */
export function isLiveGameTitle(title: { isActive: boolean; hasMatches: boolean }): boolean {
  return title.isActive || title.hasMatches
}

export type GameTitleListing = GameTitle & {
  /** See `isLiveGameTitle`. */
  isLive: boolean
}

function qualifiedColumn(table: typeof gameTitles | typeof matches, column: { name: string }) {
  return sql`${table}.${sql.identifier(column.name)}`
}

/**
 * Every game title plus whether it has any captured match. The correlated
 * columns are spelled table-qualified on purpose: in a single-table select
 * Drizzle renders `${column}` unqualified, and an unqualified "id" inside the
 * subquery binds to matches.id — making EXISTS true for every title.
 */
export function gameTitleListingQuery() {
  return db
    .select({
      ...getTableColumns(gameTitles),
      hasMatches: sql<boolean>`exists (select 1 from ${matches} where ${qualifiedColumn(matches, matches.gameTitleId)} = ${qualifiedColumn(gameTitles, gameTitles.id)})`,
    })
    .from(gameTitles)
}

/**
 * Every game title with its live/archive view class, newest first by
 * `compareGameTitlesNewestFirst`. This is the single listing the frontend
 * title resolver, selectors and nav build on.
 */
export async function listAllGameTitles(): Promise<GameTitleListing[]> {
  const rows = await gameTitleListingQuery()
  return rows
    .map(({ hasMatches, ...title }) => ({
      ...title,
      isLive: isLiveGameTitle({ isActive: title.isActive, hasMatches }),
    }))
    .sort(compareGameTitlesNewestFirst)
}

/**
 * Live (match-backed) titles only, newest first. NOT default-first — resolve
 * the default with the web title resolver, never with `[0]` of this list.
 */
export async function listGameTitles(): Promise<GameTitleListing[]> {
  return (await listAllGameTitles()).filter((title) => title.isLive)
}

/**
 * Single game title by URL slug. Returns null if not found.
 */
export async function getGameTitleBySlug(slug: string) {
  const rows = await db.select().from(gameTitles).where(eq(gameTitles.slug, slug)).limit(1)
  return rows[0] ?? null
}
