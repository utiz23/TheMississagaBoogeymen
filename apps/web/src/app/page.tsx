import type { Metadata } from 'next'
import type { ClubGameTitleStats, Match } from '@eanhl/db'
import Link from 'next/link'
import {
  listGameTitles,
  getGameTitleBySlug,
  getClubStats,
  getRecentMatches,
  getTopPerformers,
} from '@eanhl/db/queries'
import { StatCard } from '@/components/ui/stat-card'
import { MatchRow } from '@/components/matches/match-row'
import { ResultBadge } from '@/components/ui/result-badge'
import { formatMatchDate, formatScore } from '@/lib/format'

export const metadata: Metadata = { title: 'Club Stats' }

export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type TopPerformer = Awaited<ReturnType<typeof getTopPerformers>>[number]

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

/** Win% as "78.3%". Returns "—" when no games played. */
function winPct(wins: number, losses: number, otl: number): string {
  const total = wins + losses + otl
  if (total === 0) return '—'
  return ((wins / total) * 100).toFixed(1) + '%'
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
        <p className="text-sm text-zinc-500">No game titles are configured yet.</p>
      </div>
    )
  }

  const fetched = await (async () => {
    try {
      return await Promise.all([
        getClubStats(gameTitle.id),
        getRecentMatches({ gameTitleId: gameTitle.id, limit: 5 }),
        getTopPerformers(gameTitle.id),
      ])
    } catch {
      return null
    }
  })()

  if (fetched === null) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
        <p className="text-sm text-zinc-500">Unable to load data right now.</p>
      </div>
    )
  }

  const [clubStats, recentMatches, topPerformers] = fetched
  const lastMatch = recentMatches[0] ?? null

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-baseline gap-3">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
          Home
        </h1>
        <span className="text-sm text-zinc-500">{gameTitle.name}</span>
      </div>

      {/* Record hero — full width */}
      {clubStats !== null && clubStats.gamesPlayed > 0 ? (
        <RecordHero stats={clubStats} />
      ) : (
        <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
          <p className="text-sm text-zinc-500">No games recorded for {gameTitle.name} yet.</p>
        </div>
      )}

      {/* Last game card */}
      {lastMatch !== null && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Last Game
          </h2>
          <LastGameCard match={lastMatch} />
        </section>
      )}

      {/* Top performers */}
      {topPerformers.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Top Performers
            </h2>
            <Link
              href="/roster"
              className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
            >
              Full roster →
            </Link>
          </div>
          <TopPerformersTable rows={topPerformers} />
        </section>
      )}

      {/* Recent form */}
      {recentMatches.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
              Recent Games
            </h2>
            <Link
              href="/games"
              className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
            >
              All games →
            </Link>
          </div>
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

// ─── Record hero ──────────────────────────────────────────────────────────────

function RecordHero({ stats }: { stats: ClubGameTitleStats }) {
  const pct = winPct(stats.wins, stats.losses, stats.otl)

  return (
    <section>
      <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Record
      </h2>
      <div className="border border-l-4 border-zinc-800 border-l-accent bg-surface px-6 py-5">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          {/* W / L / OTL — Arena Board bold */}
          <div className="flex items-end gap-6 font-condensed font-bold tabular leading-none">
            <RecordStat label="W" value={stats.wins} accent />
            <RecordStat label="L" value={stats.losses} />
            <RecordStat label="OTL" value={stats.otl} />
          </div>

          {/* Win% + GP */}
          <div className="flex flex-col gap-0.5">
            <span className="font-condensed text-lg font-semibold tabular text-zinc-300">
              {pct}
            </span>
            <span className="text-xs text-zinc-500">Win% · {stats.gamesPlayed.toString()} GP</span>
          </div>

          {/* Stat cards — goals for/against — only when data present */}
          {(stats.goalsFor > 0 || stats.goalsAgainst > 0) && (
            <div className="flex gap-px">
              <StatCard label="Goals For" value={stats.goalsFor.toString()} featured />
              <StatCard label="Goals Against" value={stats.goalsAgainst.toString()} />
            </div>
          )}
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
      <span className={`text-5xl font-bold ${accent ? 'text-accent' : 'text-zinc-100'}`}>
        {value.toString()}
      </span>
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
    </div>
  )
}

// ─── Last game card ───────────────────────────────────────────────────────────

function LastGameCard({ match }: { match: Match }) {
  const scoreForColor = match.result === 'WIN' ? 'text-accent' : 'text-zinc-100'

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group block border border-zinc-800 bg-surface px-6 py-5 transition-colors hover:bg-surface-raised"
    >
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        {/* Score */}
        <div className="flex items-baseline gap-2 font-condensed font-bold tabular leading-none">
          <span className={`text-5xl font-bold ${scoreForColor}`}>{match.scoreFor.toString()}</span>
          <span className="text-2xl text-zinc-600">–</span>
          <span className="text-5xl font-bold text-zinc-400">{match.scoreAgainst.toString()}</span>
        </div>

        {/* Match info */}
        <div className="flex flex-col gap-1.5">
          <span className="font-condensed text-lg font-semibold text-zinc-200 group-hover:text-zinc-50">
            vs {match.opponentName}
          </span>
          <div className="flex items-center gap-2">
            <ResultBadge result={match.result} />
            <span className="text-sm text-zinc-500">{formatMatchDate(match.playedAt)}</span>
            <span className="text-sm text-zinc-600">
              {formatScore(match.shotsFor, match.shotsAgainst)} SOG
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ─── Top performers ───────────────────────────────────────────────────────────

function TopPerformersTable({ rows }: { rows: TopPerformer[] }) {
  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[360px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Player
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              G
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              A
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              PTS
            </th>
            <th className="py-2 pl-2 pr-4 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Hits
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <TopPerformerRow key={row.playerId} row={row} rank={idx} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface TopPerformerRowProps {
  row: TopPerformer
  rank: number
}

function TopPerformerRow({ row, rank }: TopPerformerRowProps) {
  const isTop = rank === 0
  return (
    <tr
      className="border-b border-zinc-800/60 transition-colors hover:bg-surface-raised last:border-0"
      style={isTop ? { boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
    >
      <td className="max-w-[10rem] truncate py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-200">
        {row.gamertag}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.goals.toString()}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.assists.toString()}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular font-semibold text-zinc-100">
        {row.points.toString()}
      </td>
      <td className="py-2.5 pl-2 pr-4 text-right text-sm tabular text-zinc-300">
        {row.hits.toString()}
      </td>
    </tr>
  )
}
