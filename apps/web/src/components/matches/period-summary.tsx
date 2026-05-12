import type { MatchPeriodSummaryRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface PeriodSummaryProps {
  rows: MatchPeriodSummaryRow[]
}

type Winner = 'bgm' | 'opp' | 'tied' | 'unknown'

/** Period-by-period goals / shots / faceoffs grid. Hides itself when empty. */
export function PeriodSummary({ rows }: PeriodSummaryProps) {
  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader
        label="Period Summary"
        subtitle="Goals, shots, faceoffs by period — OCR-derived"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => (
          <PeriodCard key={`${r.matchId}-${r.periodNumber}-${r.source}`} row={r} />
        ))}
      </div>
    </section>
  )
}

function PeriodCard({ row }: { row: MatchPeriodSummaryRow }) {
  const winner = decideWinner(row.goalsFor, row.goalsAgainst)
  const ribbon =
    winner === 'bgm'
      ? 'bg-[#ce202f]'
      : winner === 'opp'
        ? 'bg-zinc-700'
        : winner === 'tied'
          ? 'bg-zinc-600'
          : 'bg-zinc-800'
  const subtitle =
    winner === 'bgm'
      ? 'BGM took this period'
      : winner === 'opp'
        ? 'Lost this period'
        : winner === 'tied'
          ? 'Tied this period'
          : '—'
  return (
    <Panel className="relative overflow-hidden px-4 py-4">
      <div className={`absolute inset-x-0 top-0 h-[3px] ${ribbon}`} aria-hidden />
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-100">
          {row.periodLabel}
        </h3>
        <span className="font-condensed text-[10px] uppercase tracking-wider text-zinc-500">
          {subtitle}
        </span>
      </div>
      <div className="space-y-2.5">
        <StatRow label="Goals" forVal={row.goalsFor} againstVal={row.goalsAgainst} accent />
        <StatRow label="Shots" forVal={row.shotsFor} againstVal={row.shotsAgainst} />
        <StatRow
          label="Faceoffs"
          forVal={row.faceoffsFor}
          againstVal={row.faceoffsAgainst}
        />
      </div>
    </Panel>
  )
}

function StatRow({
  label,
  forVal,
  againstVal,
  accent = false,
}: {
  label: string
  forVal: number | null
  againstVal: number | null
  accent?: boolean
}) {
  const total = (forVal ?? 0) + (againstVal ?? 0)
  const pct = total > 0 ? Math.round(((forVal ?? 0) / total) * 100) : 50
  const barColor = accent ? 'bg-[#ce202f]' : 'bg-zinc-400'
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between font-condensed text-[10px] uppercase tracking-wider text-zinc-500">
        <span>{label}</span>
        <span className="tabular-nums">
          <span className={accent ? 'font-bold text-zinc-100' : 'text-zinc-200'}>
            {forVal ?? '—'}
          </span>
          <span className="px-1 text-zinc-700">·</span>
          <span className="text-zinc-500">{againstVal ?? '—'}</span>
        </span>
      </div>
      {total > 0 ? (
        <div className="h-1.5 w-full overflow-hidden bg-zinc-900">
          <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className="h-1.5 w-full bg-zinc-900" />
      )}
    </div>
  )
}

function decideWinner(forVal: number | null, againstVal: number | null): Winner {
  if (forVal === null || againstVal === null) return 'unknown'
  if (forVal > againstVal) return 'bgm'
  if (forVal < againstVal) return 'opp'
  return 'tied'
}
