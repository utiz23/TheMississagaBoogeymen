import type { Metadata } from 'next'
import Link from 'next/link'
import { listGameTitles, getGameTitleBySlug, getRoster } from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { RosterTable } from '@/components/roster/roster-table'

export const metadata: Metadata = { title: 'Roster — Club Stats' }

// Roster aggregates update after each ingestion cycle (~5 min). Cache for 1 hour;
// Next.js will revalidate in the background when stale.
export const revalidate = 3600

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

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

export default async function RosterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  let rows: Awaited<ReturnType<typeof getRoster>> = []
  try {
    rows = await getRoster(gameTitle.id, gameMode)
  } catch {
    return <EmptyState message="Unable to load roster data right now." />
  }

  const emptyMessage =
    gameMode !== null
      ? `No ${gameMode} stats recorded for ${gameTitle.name} yet.`
      : `No player stats recorded for ${gameTitle.name} yet.`

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Roster
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
        {rows.length > 0 && <span className="text-sm text-zinc-600">{rows.length} players</span>}
      </div>

      {/* Game mode filter */}
      <GameModeFilter titleSlug={titleSlug} activeMode={gameMode} />

      {rows.length === 0 ? <EmptyState message={emptyMessage} /> : <RosterTable rows={rows} />}
    </div>
  )
}

// ─── Game mode filter ─────────────────────────────────────────────────────────

const MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function gameModeHref(mode: GameMode | null, titleSlug: string | undefined): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (mode !== null) qs.set('mode', mode)
  return `/roster?${qs.toString()}`
}

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

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}
