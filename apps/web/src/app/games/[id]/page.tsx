import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getMatchById, getPlayerMatchStats } from '@eanhl/db/queries'
import type { Match } from '@eanhl/db'
import { ResultBadge } from '@/components/ui/result-badge'
import { PlayerStatsTable } from '@/components/matches/player-stats-table'
import { formatMatchDate, formatTOA, formatPct, opponentFaceoffPct } from '@/lib/format'
import Link from 'next/link'

// Match data never changes once written — cache indefinitely
export const revalidate = false

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return { title: 'Game Not Found — Club Stats' }
  try {
    const match = await getMatchById(id)
    if (!match) return { title: 'Game Not Found — Club Stats' }
    return { title: `vs ${match.opponentName} — Club Stats` }
  } catch {
    return { title: 'Game — Club Stats' }
  }
}

export default async function GameDetailPage({ params }: Props) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)

  if (isNaN(id)) notFound()

  let match: Match | null = null
  try {
    match = await getMatchById(id)
  } catch {
    return <ErrorState message="Unable to load match data right now." />
  }

  if (!match) notFound()

  let playerStats: Awaited<ReturnType<typeof getPlayerMatchStats>> = []
  try {
    playerStats = await getPlayerMatchStats(match.id)
  } catch {
    // Player stats unavailable — render the match summary without the player table
  }

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/games"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <span aria-hidden>←</span> Games
      </Link>

      {/* Hero — Arena Board bold score with Broadcast Strip card treatment */}
      <HeroSection match={match} />

      {/* Team comparison strip */}
      <ComparisonStrip match={match} />

      {/* Player stats */}
      <section>
        <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Players
        </h2>
        {playerStats.length > 0 ? (
          <PlayerStatsTable playerStats={playerStats} />
        ) : (
          <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
            <p className="text-sm text-zinc-500">No player stats recorded for this game.</p>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function HeroSection({ match }: { match: Match }) {
  const scoreForColor = match.result === 'WIN' ? 'text-accent' : 'text-zinc-100'

  return (
    <div className="border border-zinc-800 border-l-4 border-l-accent bg-surface px-6 py-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        {/* Score — large, condensed, Arena Board bold */}
        <div className="flex items-baseline gap-2 font-condensed font-bold tabular leading-none">
          <span className={`text-6xl ${scoreForColor}`}>{match.scoreFor}</span>
          <span className="text-3xl text-zinc-600">–</span>
          <span className="text-6xl text-zinc-400">{match.scoreAgainst}</span>
        </div>

        {/* Match info */}
        <div className="flex flex-col gap-1.5">
          <span className="font-condensed text-xl font-semibold text-zinc-200">
            vs {match.opponentName}
          </span>
          <div className="flex items-center gap-2.5">
            <ResultBadge result={match.result} />
            <span className="text-sm text-zinc-500">{formatMatchDate(match.playedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Team comparison strip ───────────────────────────────────────────────────

interface ComparisonRowProps {
  label: string
  us: string
  them: string | null
}

function ComparisonRow({ label, us, them }: ComparisonRowProps) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-zinc-800/60 last:border-0">
      <span className="w-20 shrink-0 text-right font-condensed text-base font-semibold text-zinc-100 tabular">
        {us}
      </span>
      <span className="flex-1 text-center text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className="w-20 shrink-0 text-left font-condensed text-base font-semibold text-zinc-400 tabular">
        {them ?? '—'}
      </span>
    </div>
  )
}

function ComparisonStrip({ match }: { match: Match }) {
  const opponentFO = opponentFaceoffPct(match.faceoffPct)

  return (
    <section>
      <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Team Stats
      </h2>
      <div className="border border-zinc-800 bg-surface px-4">
        {/* Column labels */}
        <div className="flex items-center gap-3 border-b border-zinc-800 py-2">
          <span className="w-20 shrink-0 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
            Us
          </span>
          <span className="flex-1" />
          <span className="w-20 shrink-0 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
            Them
          </span>
        </div>

        <ComparisonRow
          label="Shots"
          us={match.shotsFor.toString()}
          them={match.shotsAgainst.toString()}
        />
        <ComparisonRow
          label="Hits"
          us={match.hitsFor.toString()}
          them={match.hitsAgainst.toString()}
        />
        {match.faceoffPct !== null && (
          <ComparisonRow
            label="Faceoffs"
            us={formatPct(match.faceoffPct)}
            them={formatPct(opponentFO)}
          />
        )}
        {match.timeOnAttack !== null && (
          <ComparisonRow label="TOA" us={formatTOA(match.timeOnAttack)} them={null} />
        )}
        {match.penaltyMinutes !== null && match.penaltyMinutes > 0 && (
          <ComparisonRow label="PIM" us={match.penaltyMinutes.toString()} them={null} />
        )}
      </div>
    </section>
  )
}

// ─── Error state ─────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}
