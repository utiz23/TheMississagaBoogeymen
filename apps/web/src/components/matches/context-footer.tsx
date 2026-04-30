import Link from 'next/link'
import type { AdjacentMatch } from '@eanhl/db/queries'
import { formatMatchDate } from '@/lib/format'

interface ContextFooterProps {
  previous: AdjacentMatch | null
  next: AdjacentMatch | null
}

export function ContextFooter({ previous, next }: ContextFooterProps) {
  if (!previous && !next) return null

  return (
    <nav className="grid grid-cols-1 gap-3 border-t border-zinc-800 pt-6 sm:grid-cols-2">
      {previous ? (
        <AdjacentLink match={previous} direction="prev" />
      ) : (
        <Spacer direction="prev" />
      )}
      {next ? <AdjacentLink match={next} direction="next" /> : <Spacer direction="next" />}
    </nav>
  )
}

function AdjacentLink({
  match,
  direction,
}: {
  match: AdjacentMatch
  direction: 'prev' | 'next'
}) {
  const arrow = direction === 'prev' ? '←' : '→'
  const label = direction === 'prev' ? 'Previous game' : 'Next game'

  const resultColor =
    match.result === 'WIN'
      ? 'text-accent'
      : match.result === 'OTL'
        ? 'text-amber-300'
        : 'text-zinc-400'

  return (
    <Link
      href={`/games/${match.id.toString()}`}
      className={`group flex flex-col gap-1.5 border border-zinc-800 bg-surface p-4 transition-colors hover:border-zinc-700 hover:bg-surface-raised ${
        direction === 'next' ? 'sm:text-right sm:items-end' : ''
      }`}
    >
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
        {direction === 'prev' ? `${arrow} ${label}` : `${label} ${arrow}`}
      </span>
      <span className="font-condensed text-sm font-bold uppercase tracking-wide text-zinc-200 group-hover:text-zinc-50">
        vs {match.opponentName}
      </span>
      <div
        className={`flex items-baseline gap-2 ${
          direction === 'next' ? 'sm:flex-row-reverse' : ''
        }`}
      >
        <span className={`font-condensed text-base font-bold tabular ${resultColor}`}>
          {match.result}
        </span>
        <span className="font-condensed text-base font-semibold tabular text-zinc-400">
          {match.scoreFor.toString()}–{match.scoreAgainst.toString()}
        </span>
        <span className="text-xs text-zinc-600">{formatMatchDate(match.playedAt)}</span>
      </div>
    </Link>
  )
}

function Spacer({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <div
      className={`flex items-center border border-dashed border-zinc-800/60 bg-zinc-950/30 p-4 ${
        direction === 'next' ? 'justify-end' : 'justify-start'
      }`}
    >
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-700">
        {direction === 'prev' ? 'No earlier game' : 'No later game'}
      </span>
    </div>
  )
}
