import Link from 'next/link'
import type { AdjacentMatch } from '@eanhl/db/queries'
import { Panel } from '@/components/ui/panel'
import { ResultPill } from '@/components/ui/result-pill'
import { formatMatchDate } from '@/lib/format'
import type { FinalsContextLine } from '@/lib/club-finals-view'

interface ContextFooterProps {
  previous: AdjacentMatch | null
  next: AdjacentMatch | null
  /** The games-list filters this sheet was opened from, kept across prev/next (as the top bar does). */
  listQuery?: string | undefined
  /** Club Finals: what this game decided and what comes next (stored state; CF3). */
  finals?: FinalsContextLine | null | undefined
}

const FINALS_TONE: Record<FinalsContextLine['kind'], string> = {
  final_won: 'border-emerald-500 bg-emerald-950/50 text-emerald-200',
  round_won: 'border-emerald-700 bg-emerald-950/40 text-emerald-200',
  eliminated: 'border-accent bg-accent/10 text-accent-readable',
  next: 'border-accent/40 bg-accent/5 text-fg-2',
}

function FinalsContext({ line }: { line: FinalsContextLine }) {
  return (
    <div
      className={`flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-l-4 px-4 py-3 font-condensed uppercase ${FINALS_TONE[line.kind]}`}
    >
      <span className="text-[10px] font-extrabold tracking-[0.24em] opacity-80">Club Finals</span>
      <span className="text-base font-black tracking-[0.08em]">{line.title}</span>
      {line.detail !== null ? (
        <span className="w-full text-xs font-semibold tracking-[0.14em] opacity-80 sm:ml-auto sm:w-auto">
          {line.detail}
        </span>
      ) : null}
    </div>
  )
}

export function ContextFooter({ previous, next, listQuery, finals }: ContextFooterProps) {
  if (!previous && !next && !finals) return null

  return (
    <div className="space-y-3 border-t border-zinc-800 pt-6">
      {finals ? <FinalsContext line={finals} /> : null}
      {previous || next ? (
        <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {previous ? (
            <AdjacentLink match={previous} direction="prev" listQuery={listQuery} />
          ) : (
            <Spacer direction="prev" />
          )}
          {next ? (
            <AdjacentLink match={next} direction="next" listQuery={listQuery} />
          ) : (
            <Spacer direction="next" />
          )}
        </nav>
      ) : null}
    </div>
  )
}

function AdjacentLink({
  match,
  direction,
  listQuery,
}: {
  match: AdjacentMatch
  direction: 'prev' | 'next'
  listQuery?: string | undefined
}) {
  const arrow = direction === 'prev' ? '←' : '→'
  const label = direction === 'prev' ? 'Previous game' : 'Next game'

  return (
    <Link
      prefetch
      href={`/games/${match.id.toString()}${listQuery ? `?${listQuery}` : ''}`}
      className="group block"
    >
      <Panel
        hoverable
        className={`flex flex-col gap-1.5 p-4 ${
          direction === 'next' ? 'sm:text-right sm:items-end' : ''
        }`}
      >
        <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
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
          <ResultPill result={match.result} size="sm" />
          <span className="font-condensed text-base font-semibold tabular-nums text-zinc-400">
            {match.scoreFor.toString()}–{match.scoreAgainst.toString()}
          </span>
          <span className="font-condensed text-xs uppercase tracking-wider text-zinc-600">
            {formatMatchDate(match.playedAt)}
          </span>
        </div>
      </Panel>
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
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-700">
        {direction === 'prev' ? 'No earlier game' : 'No later game'}
      </span>
    </div>
  )
}
