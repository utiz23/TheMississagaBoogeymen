import Link from 'next/link'
import type { Match } from '@eanhl/db'
import type { ClubFinalsBadge } from '@eanhl/db/queries'
import {
  clubFinalsLabel,
  clubFinalsOutcome,
  clubFinalsOutcomeText,
  clubFinalsSeriesScore,
  clubFinalsShortLabel,
} from '@/lib/club-finals-view'
import { Panel } from '@/components/ui/panel'
import { ResultPill } from '@/components/ui/result-pill'
import { formatMatchDate } from '@/lib/format'

interface RecentGamesStripProps {
  matches: Match[]
  /** Club Finals rows by match id (CF3): those games get an accent edge, "R4 · G5" and the series score. */
  clubFinals?: ReadonlyMap<number, ClubFinalsBadge>
}

/**
 * Compact strip of recent results — used below the LATEST RESULT hero
 * to provide a quick-scan trend over the last few games. Each row links
 * to the game detail page; result is shown as a small ResultPill chip.
 */
export function RecentGamesStrip({ matches, clubFinals }: RecentGamesStripProps) {
  if (matches.length === 0) return null

  return (
    <Panel className="divide-y divide-zinc-800/60">
      {matches.map((match) => {
        const badge = clubFinals?.get(match.id)
        const outcome = badge === undefined ? null : clubFinalsOutcome(badge)
        return (
          <Link
            prefetch
            key={match.id}
            href={`/games/${match.id.toString()}`}
            className={`flex items-center gap-3 py-2.5 transition-colors hover:bg-zinc-800/30 ${
              badge === undefined ? 'px-4' : 'border-l-4 border-l-accent bg-accent/[0.04] pl-3 pr-4'
            }`}
          >
            <ResultPill result={match.result} size="sm" />
            <span className="flex-1 truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200">
              vs {match.opponentName}
            </span>
            {badge !== undefined && (
              <span
                className="flex shrink-0 items-center gap-1.5 font-condensed text-[10px] font-bold uppercase tracking-[0.14em]"
                title={clubFinalsLabel(badge)}
              >
                <span className="border border-accent/60 bg-accent/10 px-1.5 py-0.5 text-accent-readable">
                  {clubFinalsShortLabel(badge)}
                </span>
                <span className="tabular-nums text-fg-3">{clubFinalsSeriesScore(badge)}</span>
                {outcome !== null && (
                  <span
                    className={`px-1.5 py-0.5 font-black ${
                      outcome === 'eliminated'
                        ? 'bg-accent-strong text-white'
                        : 'bg-emerald-900/80 text-emerald-100'
                    }`}
                  >
                    {clubFinalsOutcomeText(outcome)}
                  </span>
                )}
              </span>
            )}
            <span className="shrink-0 font-condensed text-sm font-bold tabular-nums text-zinc-400">
              {match.scoreFor.toString()}–{match.scoreAgainst.toString()}
            </span>
            {match.gameMode !== null && (
              <span
                className={`hidden shrink-0 rounded-full border px-2 py-0.5 font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] sm:inline ${
                  match.gameMode === '6s'
                    ? 'border-[rgba(139,92,246,0.5)] bg-[rgba(124,58,237,0.18)] text-[#c4b5fd]'
                    : 'border-[rgba(56,189,248,0.5)] bg-[rgba(2,132,199,0.18)] text-[#7dd3fc]'
                }`}
              >
                {match.gameMode}
              </span>
            )}
            <span className="hidden shrink-0 font-condensed text-xs uppercase tracking-wider text-zinc-600 sm:inline">
              {formatMatchDate(match.playedAt)}
            </span>
          </Link>
        )
      })}
    </Panel>
  )
}
