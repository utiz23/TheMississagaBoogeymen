import Image from 'next/image'
import Link from 'next/link'
import type { Match } from '@eanhl/db'
import { ResultBadge } from '@/components/ui/result-badge'
import { formatMatchDate, formatScore, formatTOA, formatPct } from '@/lib/format'

interface LatestResultProps {
  match: Match
}

/**
 * Scoreboard-style hero panel for the most recent match result.
 *
 * Shows: large score, opponent name, result badge, date, and a
 * comparison stats strip (shots, hits, faceoff%, TOA).
 * Team logo appears as a subtle watermark.
 */
export function LatestResult({ match }: LatestResultProps) {
  const scoreForColor = match.result === 'WIN' ? 'text-accent' : 'text-zinc-100'

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className="group relative block overflow-hidden border border-l-4 border-zinc-800 border-l-accent bg-surface transition-colors hover:bg-surface-raised"
    >
      {/* Team logo watermark */}
      <Image
        src="/images/bgm-logo.png"
        alt=""
        width={200}
        height={200}
        className="pointer-events-none absolute -right-4 -top-4 h-48 w-48 object-contain opacity-[0.04] sm:h-56 sm:w-56"
        aria-hidden
      />

      <div className="relative px-6 py-6">
        {/* Top line — label + date */}
        <div className="mb-4 flex items-center gap-3">
          <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Latest Result
          </span>
          <span className="text-xs text-zinc-600">{formatMatchDate(match.playedAt)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          {/* Score — Arena Board bold */}
          <div className="flex items-baseline gap-2 font-condensed font-bold tabular leading-none">
            <span className={`text-5xl font-bold sm:text-6xl ${scoreForColor}`}>
              {match.scoreFor.toString()}
            </span>
            <span className="text-2xl text-zinc-600 sm:text-3xl">–</span>
            <span className="text-5xl font-bold text-zinc-400 sm:text-6xl">
              {match.scoreAgainst.toString()}
            </span>
          </div>

          {/* Match info */}
          <div className="flex flex-col gap-1.5">
            <span className="font-condensed text-xl font-semibold text-zinc-200 group-hover:text-zinc-50">
              vs {match.opponentName}
            </span>
            <div className="flex items-center gap-2.5">
              <ResultBadge result={match.result} />
              <span className="text-sm text-zinc-500">
                {formatScore(match.shotsFor, match.shotsAgainst)} SOG
              </span>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-zinc-800/60 pt-4 text-xs text-zinc-500">
          <StripStat label="Shots" value={formatScore(match.shotsFor, match.shotsAgainst)} />
          <StripStat label="Hits" value={formatScore(match.hitsFor, match.hitsAgainst)} />
          {match.faceoffPct !== null && (
            <StripStat label="FO%" value={formatPct(match.faceoffPct)} />
          )}
          {match.timeOnAttack !== null && (
            <StripStat label="TOA" value={formatTOA(match.timeOnAttack)} />
          )}
        </div>
      </div>
    </Link>
  )
}

function StripStat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="font-semibold uppercase tracking-wider text-zinc-600">{label}</span>{' '}
      <span className="tabular text-zinc-400">{value}</span>
    </span>
  )
}
