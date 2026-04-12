import Link from 'next/link'
import type { Match } from '@eanhl/db'
import { ResultBadge } from '@/components/ui/result-badge'
import { formatMatchDate, formatScore } from '@/lib/format'

interface MatchRowProps {
  match: Match
  /** Highlights the row with an accent left bar — use for the most recent game. */
  isMostRecent?: boolean
}

/**
 * A single match row for the game log.
 *
 * Layout uses a 1px-wide accent bar as the first flex child so the column
 * header (which uses the same structure) aligns naturally.
 *
 * Columns: [bar] [date 80px] [opponent flex-1] [result 40px] [score 56px] [sog 80px hidden-mobile]
 */
export function MatchRow({ match, isMostRecent = false }: MatchRowProps) {
  return (
    <div className="flex items-stretch group">
      {/* Accent bar — 4px, accent color on most recent game only */}
      <div className={`w-1 shrink-0 ${isMostRecent ? 'bg-accent' : 'bg-transparent'}`} />

      {/* Row link — entire row is clickable */}
      <Link
        href={`/games/${match.id.toString()}`}
        className="flex flex-1 items-center gap-4 px-4 py-3 hover:bg-surface-raised transition-colors"
      >
        {/* Date */}
        <span className="w-20 shrink-0 text-sm text-zinc-500 group-hover:text-zinc-400 tabular whitespace-nowrap">
          {formatMatchDate(match.playedAt)}
        </span>

        {/* Opponent — truncates on narrow screens */}
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-zinc-200 group-hover:text-zinc-50">
          {match.opponentName}
        </span>

        {/* Result badge */}
        <div className="w-10 shrink-0 flex justify-start">
          <ResultBadge result={match.result} />
        </div>

        {/* Score */}
        <span className="w-14 shrink-0 text-right font-condensed text-sm font-semibold text-zinc-100 tabular">
          {formatScore(match.scoreFor, match.scoreAgainst)}
        </span>

        {/* Shots for–against — hidden on mobile */}
        <span className="hidden sm:block w-20 shrink-0 text-right text-xs text-zinc-500 tabular whitespace-nowrap">
          {match.shotsFor.toString()}–{match.shotsAgainst.toString()}
        </span>
      </Link>
    </div>
  )
}
