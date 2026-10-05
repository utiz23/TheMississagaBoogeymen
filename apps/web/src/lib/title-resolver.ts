import type { GameTitleListing, PlayerCareerSeasonRow } from '@eanhl/db/queries'
import { compareGameTitlesNewestFirst, listAllGameTitles } from '@eanhl/db/queries'

/**
 * The single title policy for every title-aware surface (`/`, `/games`,
 * `/stats`, `/roster`, nav). Three operator controls stay independent:
 *
 *   - ingestion eligibility (`isActive`) — the worker's concern only; it never
 *     picks the default or the order here;
 *   - the frontend default (`isDefault`) — what a visitor with no `?title=` sees;
 *   - chronology (`releaseOrder`) — every list is newest first, never by id and
 *     never default-first.
 *
 * `isLive` (polled OR has captured matches) picks the live (match-backed) view
 * versus the archive (reviewed historical import) view, so a title keeps its
 * match-derived pages after polling stops.
 */

export interface ResolvedTitle {
  /** The selected title. `gameTitle.isLive` picks the live vs archive view. */
  gameTitle: GameTitleListing
  /** Every title, newest first by explicit chronology. */
  allTitles: GameTitleListing[]
}

export type ResolveResult =
  | { kind: 'ok'; resolved: ResolvedTitle }
  | { kind: 'invalid'; allTitles: GameTitleListing[] }
  | { kind: 'empty' }

/** The fields the default and switcher rules read. */
type TitleChoice = Pick<GameTitleListing, 'id' | 'slug' | 'releaseOrder' | 'isDefault' | 'isLive'>

function newestFirst<T extends Pick<GameTitleListing, 'releaseOrder' | 'slug'>>(
  titles: readonly T[],
): T[] {
  return [...titles].sort(compareGameTitlesNewestFirst)
}

/**
 * The no-`?title=` title: the operator's explicit default; if none is set, the
 * newest live title; then the newest title of any kind; null when there are
 * no titles.
 */
export function pickDefaultTitle<T extends TitleChoice>(titles: readonly T[]): T | null {
  const ordered = newestFirst(titles)
  return ordered.find((t) => t.isDefault) ?? ordered.find((t) => t.isLive) ?? ordered[0] ?? null
}

/**
 * Titles offered by the compact switchers (nav drawer, `/games` toolbar): every
 * live title, the default even when it is neither polled nor match-backed, and
 * the selected title. Newest first — the default is NOT hoisted, so take it
 * from `pickDefaultTitle`, never from `[0]`.
 */
export function switcherTitles<T extends TitleChoice>(
  allTitles: readonly T[],
  selectedId?: number,
): T[] {
  const defaultId = pickDefaultTitle(allTitles)?.id
  return newestFirst(allTitles).filter((t) => t.isLive || t.id === defaultId || t.id === selectedId)
}

/**
 * Resolve a `?title=` slug against every title.
 *
 * - A slug that matches any title — live or archive, polled or not — wins over
 *   the default. A slug that matches nothing is `invalid`, so the caller can
 *   redirect to its no-filter URL.
 * - No slug resolves to `pickDefaultTitle`; no titles at all is `empty`.
 *
 * `allTitles` is present on `ok`/`invalid` so callers can render a selector.
 */
export function resolveTitle(
  slug: string | undefined,
  titles: readonly GameTitleListing[],
): ResolveResult {
  const allTitles = newestFirst(titles)

  if (slug) {
    const match = allTitles.find((t) => t.slug === slug)
    if (!match) return { kind: 'invalid', allTitles }
    return { kind: 'ok', resolved: { gameTitle: match, allTitles } }
  }

  const fallback = pickDefaultTitle(allTitles)
  if (!fallback) return { kind: 'empty' }
  return { kind: 'ok', resolved: { gameTitle: fallback, allTitles } }
}

export async function resolveTitleFromSlug(slug?: string): Promise<ResolveResult> {
  return resolveTitle(slug, await listAllGameTitles())
}

type CareerRangeRow = Pick<
  PlayerCareerSeasonRow,
  'gameTitleName' | 'gameTitleSlug' | 'gameTitleReleaseOrder'
>

/**
 * Profile career-range subtitle, oldest to newest: "NHL 22–NHL 27 · sum". The
 * endpoints come from explicit chronology, not from row order or ids.
 */
export function formatCareerTitleRange(rows: readonly CareerRangeRow[]): string {
  const ordered = [...rows].sort((a, b) =>
    compareGameTitlesNewestFirst(
      { releaseOrder: a.gameTitleReleaseOrder, slug: a.gameTitleSlug },
      { releaseOrder: b.gameTitleReleaseOrder, slug: b.gameTitleSlug },
    ),
  )
  const newest = ordered[0]
  const oldest = ordered[ordered.length - 1]
  if (newest === undefined || oldest === undefined) return 'Career · sum'
  if (newest.gameTitleSlug === oldest.gameTitleSlug) return `${newest.gameTitleName} · sum`
  return `${oldest.gameTitleName}–${newest.gameTitleName} · sum`
}
