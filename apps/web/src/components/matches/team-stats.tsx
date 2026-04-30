import type { BoxScoreRow } from '@/lib/match-recap'
import { SectionHeader } from './top-performers'

interface TeamStatsProps {
  rows: BoxScoreRow[]
}

export function TeamStats({ rows }: TeamStatsProps) {
  if (rows.length === 0) return null

  return (
    <section>
      <SectionHeader title="Team Stats" />
      <div className="border border-zinc-800 bg-surface px-4">
        {/* Column labels */}
        <div className="grid grid-cols-[5rem_1fr_5rem] items-center gap-3 border-b border-zinc-800 py-2">
          <span className="text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
            BGM
          </span>
          <span className="flex-1" />
          <span className="text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
            Opp
          </span>
        </div>

        {rows.map((row, i) => (
          <Row key={row.label} row={row} isLast={i === rows.length - 1} />
        ))}
      </div>
    </section>
  )
}

function Row({ row, isLast }: { row: BoxScoreRow; isLast: boolean }) {
  return (
    <div
      className={`grid grid-cols-[5rem_1fr_5rem] items-center gap-3 py-2.5 ${
        isLast ? '' : 'border-b border-zinc-800/60'
      }`}
    >
      <span className="text-right font-condensed text-base font-semibold tabular text-zinc-100">
        {row.us}
      </span>
      <span className="text-center text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {row.label}
      </span>
      <span className="text-left font-condensed text-base font-semibold tabular text-zinc-400">
        {row.them ?? '—'}
      </span>
    </div>
  )
}
