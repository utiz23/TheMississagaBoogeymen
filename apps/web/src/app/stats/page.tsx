import type { Metadata } from 'next'
import type { ClubGameTitleStats } from '@eanhl/db'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  listGameTitles,
  getActiveGameTitleBySlug,
  getClubStats,
  getRecentMatches,
  getSkaterStats,
  getGoalieStats,
  getEASkaterStats,
  getEAGoalieStats,
  getPlayerWithWithoutSplits,
  getPlayerPairs,
} from '@eanhl/db/queries'
import { StatCard } from '@/components/ui/stat-card'
import { MatchRow } from '@/components/matches/match-row'
import { SkaterStatsTable } from '@/components/stats/skater-stats-table'
import { GoalieStatsTable } from '@/components/stats/goalie-stats-table'
import { WithWithoutTable, BestPairsTable, ChemistrySection } from '@/components/stats/chemistry-tables'
import { formatPct } from '@/lib/format'

export const metadata: Metadata = { title: 'Stats — Club Stats' }

// Aggregates update each ingestion cycle (~5 min) — match the worker cadence
export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function resolveGameTitle(titleSlug: string | undefined) {
  try {
    if (titleSlug) {
      const found = await getActiveGameTitleBySlug(titleSlug)
      if (found) return { gameTitle: found, invalidRequested: false }
      return { gameTitle: null, invalidRequested: true }
    }
    const all = await listGameTitles()
    return { gameTitle: all[0] ?? null, invalidRequested: false }
  } catch {
    return { gameTitle: null, invalidRequested: false }
  }
}

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
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
  const gameMode = parseGameMode(params.mode)
  const { gameTitle, invalidRequested } = await resolveGameTitle(titleSlug)

  if (invalidRequested) {
    const nextParams = new URLSearchParams()
    if (typeof params.mode === 'string') nextParams.set('mode', params.mode)
    redirect(nextParams.size > 0 ? `/stats?${nextParams.toString()}` : '/stats')
  }

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  // All mode sources from EA full-season totals; 6s/3s modes source from local tracked stats.
  const statsSource = gameMode === null ? 'EA season totals' : `local tracked ${gameMode}`

  const fetched = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id, gameMode),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 5 }),
        gameMode === null ? getEASkaterStats(gameTitle.id) : getSkaterStats(gameTitle.id, gameMode),
        gameMode === null ? getEAGoalieStats(gameTitle.id) : getGoalieStats(gameTitle.id, gameMode),
        getPlayerWithWithoutSplits(gameTitle.id, gameMode),
        getPlayerPairs(gameTitle.id, gameMode),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return <EmptyState message="Unable to load stats right now." />
  }

  const [clubStats, recentMatches, skaterRows, goalieRows, withWithoutRows, pairRows] = fetched

  const emptyModeLabel = gameMode !== null ? `${gameMode} ` : ''

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Stats
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
      </div>

      {/* Game mode filter */}
      <GameModeFilter titleSlug={titleSlug} activeMode={gameMode} />

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
        <EmptyState
          message={
            gameMode !== null
              ? `No ${emptyModeLabel}games recorded for ${gameTitle.name} yet.`
              : `No stats recorded for ${gameTitle.name} yet.`
          }
        />
      )}

      {/* Skater stats — primary table content */}
      {skaterRows.length > 0 ? (
        <section>
          <SkaterStatsTable rows={skaterRows} title="Skaters" subtitle={statsSource} />
        </section>
      ) : (
        clubStats !== null &&
        clubStats.gamesPlayed > 0 && (
          <EmptyState message={`No ${emptyModeLabel}skater stats recorded yet.`} />
        )
      )}

      {/* Goalie stats */}
      {goalieRows.length > 0 && (
        <section>
          <GoalieStatsTable rows={goalieRows} title="Goalies" subtitle={statsSource} />
        </section>
      )}

      {/* Chemistry — with/without splits and best pairs */}
      <section className="space-y-6">
        <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Chemistry
        </h2>
        <ChemistrySection title="Team Record With / Without">
          <WithWithoutTable rows={withWithoutRows} />
        </ChemistrySection>
        <ChemistrySection title="Best Pairs">
          <BestPairsTable rows={pairRows} />
        </ChemistrySection>
      </section>

      {/* Recent games — context strip below the stats tables */}
      {recentMatches.length > 0 && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Recent Games
          </h2>
          <div className="divide-y divide-zinc-800/60 overflow-hidden border border-zinc-800 bg-surface">
            {recentMatches.map((match, i) => (
              <MatchRow key={match.id} match={match} isMostRecent={i === 0} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Game mode filter ─────────────────────────────────────────────────────────

const MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function statsModeHref(mode: GameMode | null, titleSlug: string | undefined): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (mode !== null) qs.set('mode', mode)
  const s = qs.toString()
  return `/stats${s ? `?${s}` : ''}`
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
            href={statsModeHref(mode, titleSlug)}
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
