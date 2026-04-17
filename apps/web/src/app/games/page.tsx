import type { Metadata } from 'next'
import Link from 'next/link'
import {
  listGameTitles,
  getGameTitleBySlug,
  getRecentMatches,
  countMatches,
} from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { MatchRow } from '@/components/matches/match-row'

export const metadata: Metadata = { title: 'Games — Club Stats' }

// Matches are ingested every 5 minutes — revalidate on the same cadence
export const revalidate = 300

const PAGE_SIZE = 20

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function resolveGameTitle(titleSlug: string | undefined) {
  try {
    if (titleSlug) {
      const found = await getGameTitleBySlug(titleSlug)
      if (found) return found
    }
    const all = await listGameTitles()
    return all[0] ?? null
  } catch {
    return null
  }
}

function parsePage(raw: string | string[] | undefined): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 1
}

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

export default async function GamesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const page = parsePage(params.page)
  const offset = (page - 1) * PAGE_SIZE

  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  let pageMatches: Awaited<ReturnType<typeof getRecentMatches>> = []
  let total = 0
  try {
    ;[pageMatches, total] = await Promise.all([
      getRecentMatches({ gameTitleId: gameTitle.id, limit: PAGE_SIZE, offset, gameMode }),
      countMatches({ gameTitleId: gameTitle.id, gameMode }),
    ])
  } catch {
    return <EmptyState message="Unable to load match data right now." />
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  // Clamp page to valid range — handles stale bookmarks
  const clampedPage = Math.min(page, totalPages)

  const emptyMessage =
    gameMode !== null
      ? `No ${gameMode} games recorded for ${gameTitle.name} yet.`
      : `No games recorded for ${gameTitle.name} yet.`

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Games
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
        {total > 0 && <span className="text-sm text-zinc-600">{total} matches</span>}
      </div>

      {/* Game mode filter pills */}
      <GameModeFilter titleSlug={titleSlug} activeMode={gameMode} />

      {total === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <>
          <div className="overflow-hidden border border-zinc-800 bg-surface">
            {/* Column header — mirrors MatchRow's flex structure exactly */}
            <div className="flex items-center border-b border-zinc-800">
              <div className="w-1 shrink-0" /> {/* accent bar gutter */}
              <div className="flex flex-1 items-center gap-4 px-4 py-2">
                <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Date
                </span>
                <span className="flex-1 min-w-0 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Opponent
                </span>
                <div className="w-10 shrink-0" /> {/* result badge — no header text */}
                <span className="w-14 shrink-0 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  Score
                </span>
                <span className="hidden sm:block w-20 shrink-0 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
                  SOG
                </span>
              </div>
            </div>

            {/* Match rows */}
            <div className="divide-y divide-zinc-800/60">
              {pageMatches.map((match, i) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  isMostRecent={clampedPage === 1 && i === 0}
                />
              ))}
            </div>
          </div>

          {totalPages > 1 && (
            <PaginationNav
              page={clampedPage}
              totalPages={totalPages}
              titleSlug={titleSlug}
              gameMode={gameMode}
            />
          )}
        </>
      )}
    </div>
  )
}

// ─── Game mode filter ─────────────────────────────────────────────────────────

function gameModeHref(mode: GameMode | null, titleSlug: string | undefined): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (mode !== null) qs.set('mode', mode)
  return `/games?${qs.toString()}`
}

const MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function GameModeFilter({
  titleSlug,
  activeMode,
}: {
  titleSlug: string | undefined
  activeMode: GameMode | null
}) {
  return (
    <div className="flex gap-1">
      {MODE_LABELS.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={gameModeHref(mode, titleSlug)}
            className={[
              'px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded border transition-colors',
              isActive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-zinc-700 bg-transparent text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function paginationHref(
  page: number,
  titleSlug: string | undefined,
  gameMode: GameMode | null,
): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (gameMode !== null) qs.set('mode', gameMode)
  qs.set('page', page.toString())
  return `/games?${qs.toString()}`
}

function PaginationNav({
  page,
  totalPages,
  titleSlug,
  gameMode,
}: {
  page: number
  totalPages: number
  titleSlug: string | undefined
  gameMode: GameMode | null
}) {
  const hasPrev = page > 1
  const hasNext = page < totalPages

  return (
    <div className="flex items-center justify-between py-1 text-sm">
      {hasPrev ? (
        <Link
          href={paginationHref(page - 1, titleSlug, gameMode)}
          className="text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          ← Prev
        </Link>
      ) : (
        <span className="text-zinc-700 select-none">← Prev</span>
      )}

      <span className="text-zinc-600">
        Page {page} of {totalPages}
      </span>

      {hasNext ? (
        <Link
          href={paginationHref(page + 1, titleSlug, gameMode)}
          className="text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Next →
        </Link>
      ) : (
        <span className="text-zinc-700 select-none">Next →</span>
      )}
    </div>
  )
}

// ─── Empty / error state ──────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}
