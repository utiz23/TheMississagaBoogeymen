import type { Metadata } from 'next'
import { listGameTitles, getGameTitleBySlug, getRecentMatches } from '@eanhl/db/queries'
import { MatchRow } from '@/components/matches/match-row'

export const metadata: Metadata = { title: 'Games — Club Stats' }

// Matches are ingested every 5 minutes — revalidate on the same cadence
export const revalidate = 300

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

export default async function GamesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  let matches: Awaited<ReturnType<typeof getRecentMatches>> = []
  try {
    matches = await getRecentMatches({ gameTitleId: gameTitle.id })
  } catch {
    return <EmptyState message="Unable to load match data right now." />
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Games
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
        {matches.length > 0 && (
          <span className="text-sm text-zinc-600">{matches.length} matches</span>
        )}
      </div>

      {matches.length === 0 ? (
        <EmptyState message={`No games recorded for ${gameTitle.name} yet.`} />
      ) : (
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
            {matches.map((match, i) => (
              <MatchRow key={match.id} match={match} isMostRecent={i === 0} />
            ))}
          </div>
        </div>
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
