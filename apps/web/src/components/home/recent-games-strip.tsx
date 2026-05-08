import Link from 'next/link'
import type { Match } from '@eanhl/db'
import { Panel } from '@/components/ui/panel'
import { ResultPill } from '@/components/ui/result-pill'
import { formatMatchDate } from '@/lib/format'

interface RecentGamesStripProps {
  matches: Match[]
}

/**
 * Compact strip of recent results — used below the LATEST RESULT hero
 * to provide a quick-scan trend over the last few games. Each row links
 * to the game detail page; result is shown as a small ResultPill chip.
 */
export function RecentGamesStrip({ matches }: RecentGamesStripProps) {
  if (matches.length === 0) return null

  return (
    <Panel className="divide-y divide-zinc-800/60">
      {matches.map((match) => (
        <Link
          key={match.id}
          href={`/games/${match.id.toString()}`}
          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-zinc-800/30"
        >
          <ResultPill result={match.result} size="sm" />
          <span className="flex-1 truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200">
            vs {match.opponentName}
          </span>
          <span className="shrink-0 font-condensed text-sm font-bold tabular-nums text-zinc-400">
            {match.scoreFor.toString()}–{match.scoreAgainst.toString()}
          </span>
          {match.gameMode !== null && (
            <span className="hidden shrink-0 border border-zinc-700/60 bg-zinc-800 px-1.5 py-0.5 font-condensed text-[10px] font-semibold uppercase tracking-wider text-zinc-500 sm:inline">
              {match.gameMode}
            </span>
          )}
          <span className="hidden shrink-0 font-condensed text-xs uppercase tracking-wider text-zinc-600 sm:inline">
            {formatMatchDate(match.playedAt)}
          </span>
        </Link>
      ))}
    </Panel>
  )
}
