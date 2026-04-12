import type { Metadata } from 'next'
import { listGameTitles, getGameTitleBySlug, getRoster } from '@eanhl/db/queries'
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

export default async function RosterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  let rows: Awaited<ReturnType<typeof getRoster>> = []
  try {
    rows = await getRoster(gameTitle.id)
  } catch {
    return <EmptyState message="Unable to load roster data right now." />
  }

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

      {rows.length === 0 ? (
        <EmptyState message={`No player stats recorded for ${gameTitle.name} yet.`} />
      ) : (
        <RosterTable rows={rows} />
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}
