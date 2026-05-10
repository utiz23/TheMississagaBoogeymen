import type { MatchPeriodSummaryRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface PeriodSummaryProps {
  rows: MatchPeriodSummaryRow[]
}

/** Period-by-period goals / shots / faceoffs grid. Hides itself when empty. */
export function PeriodSummary({ rows }: PeriodSummaryProps) {
  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Period Summary" subtitle="Goals, shots, faceoffs by period — OCR-derived" />
      <Panel className="overflow-x-auto px-4 py-4">
        <table className="w-full min-w-[480px] table-fixed text-sm">
          <thead>
            <tr className="font-condensed text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              <th className="w-20 text-left">Period</th>
              <th className="text-right">Goals</th>
              <th className="text-right">Shots</th>
              <th className="text-right">Faceoffs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {rows.map((r) => (
              <tr key={`${r.matchId}-${r.periodNumber}-${r.source}`} className="text-zinc-200">
                <td className="py-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-400">
                  {r.periodLabel}
                </td>
                <td className="text-right tabular-nums">
                  <SplitCell forVal={r.goalsFor} againstVal={r.goalsAgainst} />
                </td>
                <td className="text-right tabular-nums">
                  <SplitCell forVal={r.shotsFor} againstVal={r.shotsAgainst} />
                </td>
                <td className="text-right tabular-nums">
                  <SplitCell forVal={r.faceoffsFor} againstVal={r.faceoffsAgainst} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  )
}

function SplitCell({ forVal, againstVal }: { forVal: number | null; againstVal: number | null }) {
  return (
    <span>
      <span className="font-semibold text-zinc-100">{forVal ?? '—'}</span>
      <span className="px-1.5 text-zinc-700">·</span>
      <span className="text-zinc-500">{againstVal ?? '—'}</span>
    </span>
  )
}
