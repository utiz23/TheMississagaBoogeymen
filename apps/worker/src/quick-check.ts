/**
 * A quick check (live events E1, operator 2026-11-14): read ONLY the EA match lists, store any
 * new game exactly as a normal pass does, then the database-only follow-ups a new game needs
 * (AI goalies, aggregates, card progression) and the `finished_at` stamp, so the Discord poster
 * posts it at once. No member stats, club record, season rank, settings or opponent club info:
 * those stay in the normal 5-minute pass.
 *
 * At most 3 match-list calls per active title (1 when the event names the match type), 1 s
 * throttle after each call (same as a normal pass). The database and EA parts are injected, so
 * the tests need neither.
 */

import type { EaMatchType } from '@eanhl/ea-client'

export const ALL_MATCH_TYPES: readonly EaMatchType[] = ['gameType5', 'gameType10', 'club_private']

export interface QuickCheckTitle {
  id: number
  slug: string
}

export interface QuickCheckDeps<T extends QuickCheckTitle> {
  /** Active (ingestion-eligible) titles. */
  listActiveTitles: () => Promise<T[]>
  /** One EA match-list call + raw-first store + transform (the normal pass's `ingestMatchType`). */
  ingestMatchList: (title: T, matchType: EaMatchType) => Promise<{ matchesNew: number }>
  /** The 1 s wait between EA calls. */
  throttle: () => Promise<void>
  /** Database-only follow-ups for a title that got a new game (AI goalies, aggregates). */
  afterNewGames: (title: T) => Promise<void>
  /** Database-only, once, when any title got a new game (card progression). */
  afterAllNewGames: () => Promise<void>
  /** Stamps `finished_at` on this check's ingestion_log rows (always, also on error). */
  markFinished: () => Promise<void>
  log: (line: string) => void
}

export interface QuickCheckRequest {
  /** The event's `game_title`; only that title when it is active, else every active title. */
  titleSlug: string | null
  /** The event's `match_type`; only that match list when it is a known type, else all 3. */
  matchType: string | null
}

export interface QuickCheckResult {
  calls: number
  newGames: number
  titles: string[]
  matchTypes: EaMatchType[]
}

export function quickCheckMatchTypes(matchType: string | null): EaMatchType[] {
  const known = ALL_MATCH_TYPES.find((t) => t === matchType)
  return known ? [known] : [...ALL_MATCH_TYPES]
}

export async function runQuickCheck<T extends QuickCheckTitle>(
  request: QuickCheckRequest,
  deps: QuickCheckDeps<T>,
): Promise<QuickCheckResult> {
  const matchTypes = quickCheckMatchTypes(request.matchType)
  let calls = 0
  let newGames = 0
  let titles: T[] = []
  try {
    const active = await deps.listActiveTitles()
    const named = request.titleSlug ? active.filter((t) => t.slug === request.titleSlug) : []
    titles = named.length > 0 ? named : active
    const gotNew: T[] = []
    for (const title of titles) {
      let titleNew = 0
      for (const matchType of matchTypes) {
        calls++
        const { matchesNew } = await deps.ingestMatchList(title, matchType)
        titleNew += matchesNew
        await deps.throttle()
      }
      if (titleNew > 0) gotNew.push(title)
      newGames += titleNew
    }
    for (const title of gotNew) {
      try {
        await deps.afterNewGames(title)
      } catch (err) {
        deps.log(`[quick-check] follow-up failed for ${title.slug}: ${errorText(err)}`)
      }
    }
    if (gotNew.length > 0) {
      try {
        await deps.afterAllNewGames()
      } catch (err) {
        deps.log(`[quick-check] card progression failed: ${errorText(err)}`)
      }
    }
  } finally {
    await deps.markFinished()
  }
  return { calls, newGames, titles: titles.map((t) => t.slug), matchTypes }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
