import type { GameTitle } from '@eanhl/db'
import {
  getActiveGameTitleBySlug,
  getArchiveGameTitleBySlug,
  listArchiveGameTitles,
  listGameTitles,
} from '@eanhl/db/queries'

export interface ResolvedTitle {
  gameTitle: GameTitle
  isActive: boolean
  /** Active titles first (newest desc), then archive titles (year desc). */
  allTitles: GameTitle[]
}

export type ResolveResult =
  | { kind: 'ok'; resolved: ResolvedTitle }
  | { kind: 'invalid'; allTitles: GameTitle[] }
  | { kind: 'empty' }

/**
 * Resolve a game title slug across both active and archive titles.
 *
 * - When `slug` is provided: tries active first, then archive. If neither
 *   matches, returns `invalid` so the caller can redirect.
 * - When `slug` is omitted: returns the newest active title; if no active
 *   titles exist, falls back to the newest archive title; if neither
 *   exists, returns `empty`.
 *
 * The unioned `allTitles` is always present on `ok`/`invalid` so callers
 * can render a title selector even on the invalid path.
 */
export async function resolveTitleFromSlug(slug?: string): Promise<ResolveResult> {
  const [active, archive] = await Promise.all([listGameTitles(), listArchiveGameTitles()])
  const allTitles: GameTitle[] = [...active, ...archive]

  if (slug) {
    const activeMatch = await getActiveGameTitleBySlug(slug)
    if (activeMatch) {
      return {
        kind: 'ok',
        resolved: { gameTitle: activeMatch, isActive: true, allTitles },
      }
    }
    const archiveMatch = await getArchiveGameTitleBySlug(slug)
    if (archiveMatch) {
      return {
        kind: 'ok',
        resolved: { gameTitle: archiveMatch, isActive: false, allTitles },
      }
    }
    return { kind: 'invalid', allTitles }
  }

  const fallback = active[0] ?? archive[0] ?? null
  if (!fallback) return { kind: 'empty' }
  return {
    kind: 'ok',
    resolved: { gameTitle: fallback, isActive: fallback.isActive, allTitles },
  }
}
