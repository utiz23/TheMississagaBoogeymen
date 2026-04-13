import type { Metadata } from 'next'
import type { ClubGameTitleStats } from '@eanhl/db'
import {
  listGameTitles,
  getGameTitleBySlug,
  getClubStats,
  getRecentMatches,
} from '@eanhl/db/queries'
import { StatCard } from '@/components/ui/stat-card'
import { MatchRow } from '@/components/matches/match-row'
import { formatPct } from '@/lib/format'

export const metadata: Metadata = { title: 'Stats — Club Stats' }

// Aggregates update each ingestion cycle (~5 min) — match the worker cadence
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

/** Win% as a display string, e.g. "78.3%". Returns "—" when no games played. */
function winPct(wins: number, losses: number, otl: number): string {
  const total = wins + losses + otl
  if (total === 0) return '—'
  return ((wins / total) * 100).toFixed(1) + '%'
}

export default async function StatsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  // Fetch club stats and last 5 matches in parallel via IIFE so we can use
  // const destructuring (avoids pre-declared variable assignment quirks)
  const fetched = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 5 }),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return <EmptyState message="Unable to load stats right now." />
  }

  const [clubStats, recentMatches] = fetched

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Stats
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
      </div>

      {/* Record + stat cards — show when at least 1 game is recorded */}
      {clubStats !== null && clubStats.gamesPlayed > 0 ? (
        <>
          <RecordCard stats={clubStats} />

          <section>
            <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Team Averages
            </h2>
            <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
              <StatCard
                label="Goals For"
                value={clubStats.goalsFor.toString()}
                sublabel={`${clubStats.gamesPlayed.toString()} GP`}
                featured
              />
              <StatCard
                label="Goals Against"
                value={clubStats.goalsAgainst.toString()}
                sublabel={`${clubStats.gamesPlayed.toString()} GP`}
              />
              <StatCard label="Shots / GP" value={clubStats.shotsPerGame ?? '—'} />
              <StatCard label="Hits / GP" value={clubStats.hitsPerGame ?? '—'} />
              <StatCard label="Faceoff %" value={formatPct(clubStats.faceoffPct)} />
              <StatCard label="Pass %" value={formatPct(clubStats.passPct)} />
            </div>
          </section>
        </>
      ) : (
        <EmptyState message={`No stats recorded for ${gameTitle.name} yet.`} />
      )}

      {/* Recent games — rendered independently so it shows even before aggregates exist */}
      {recentMatches.length > 0 && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Recent Games
          </h2>
          <div className="overflow-hidden border border-zinc-800 bg-surface divide-y divide-zinc-800/60">
            {recentMatches.map((match, i) => (
              <MatchRow key={match.id} match={match} isMostRecent={i === 0} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Record hero card ─────────────────────────────────────────────────────────

function RecordCard({ stats }: { stats: ClubGameTitleStats }) {
  const pct = winPct(stats.wins, stats.losses, stats.otl)

  return (
    <section>
      <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Record
      </h2>
      <div className="border border-l-4 border-zinc-800 border-l-accent bg-surface px-6 py-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          {/* W / L / OTL — Arena Board bold numbers */}
          <div className="flex items-end gap-6 font-condensed font-bold leading-none tabular">
            <RecordStat label="W" value={stats.wins} accent />
            <RecordStat label="L" value={stats.losses} />
            <RecordStat label="OTL" value={stats.otl} />
          </div>

          {/* Summary line */}
          <div className="flex flex-col gap-0.5">
            <span className="font-condensed text-lg font-semibold tabular text-zinc-300">
              {pct}
            </span>
            <span className="text-xs text-zinc-500">Win% · {stats.gamesPlayed.toString()} GP</span>
          </div>
        </div>
      </div>
    </section>
  )
}

interface RecordStatProps {
  label: string
  value: number
  accent?: boolean
}

function RecordStat({ label, value, accent = false }: RecordStatProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`text-4xl sm:text-5xl font-bold ${accent ? 'text-accent' : 'text-zinc-100'}`}
      >
        {value.toString()}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
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
