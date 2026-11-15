import type { EnginePeriodStripRow } from '@eanhl/db/queries'
import { periodWord } from '@/lib/period-goals'

// Goals by period, read from the game recording by the live engine (task P1). The goals add
// up to EA's final score (checked when imported and again when read). GOALS ONLY (operator
// decision D27, 2026-11-14): shots per period are stored but never shown.
//
// The simple classic box, the same look as the game page Box Score: a BGM row and the
// opponent row, one column per period, then TOT. One small "Read from video" note in the
// top-right corner. Used on the home latest-game panel only; the /games cards do not show it
// (operator, 2026-11-14: too crowded and too tall).

const HEAD =
  'px-1.5 py-1 font-condensed text-[12px] font-bold uppercase tracking-[0.06em] text-fg-4'

export function PeriodGoalsTable({
  rows,
  opponentAbbrev,
}: {
  rows: readonly EnginePeriodStripRow[]
  /** EA's opponent abbreviation from our matches table (never the file's). */
  opponentAbbrev: string
}) {
  const sorted = [...rows].sort((a, b) => a.periodNumber - b.periodNumber)
  const forTotal = sorted.reduce((n, r) => n + r.goalsFor, 0)
  const againstTotal = sorted.reduce((n, r) => n + r.goalsAgainst, 0)
  return (
    <div aria-label="Goals by period, read from video">
      <p
        className="mb-1 text-right font-condensed text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4"
        title="Goals per period were read from the game recording. They add up to EA's final score."
      >
        Read from video
      </p>
      <div className="overflow-x-auto border border-border-subtle">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-charcoal">
              <th scope="col" className={`${HEAD} text-left`}>
                Team
              </th>
              {sorted.map((r) => (
                <th key={r.periodNumber} scope="col" className={`${HEAD} px-0.5 text-center`}>
                  {periodWord(r.periodNumber)}
                </th>
              ))}
              <th scope="col" className={`${HEAD} border-l border-border px-0.5 text-center`}>
                Tot
              </th>
            </tr>
          </thead>
          <tbody>
            <TeamRow
              label="BGM"
              side="bgm"
              goals={sorted.map((r) => [r.goalsFor, r.goalsAgainst] as const)}
              total={forTotal}
              won={forTotal > againstTotal}
            />
            <TeamRow
              label={opponentAbbrev}
              side="opp"
              goals={sorted.map((r) => [r.goalsAgainst, r.goalsFor] as const)}
              total={againstTotal}
              won={againstTotal > forTotal}
              topBorder
            />
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TeamRow({
  label,
  side,
  goals,
  total,
  won,
  topBorder = false,
}: {
  label: string
  side: 'bgm' | 'opp'
  /** [this team's goals, the other team's goals] per period. */
  goals: (readonly [number, number])[]
  total: number
  won: boolean
  topBorder?: boolean
}) {
  const isBgm = side === 'bgm'
  const edge = topBorder ? 'border-t border-t-border-subtle' : ''
  const color = isBgm ? 'text-accent' : 'text-fg-2'
  const tint = isBgm ? 'bg-accent/[0.08]' : 'bg-charcoal'
  return (
    <tr>
      <th
        scope="row"
        className={`px-1.5 py-1.5 text-left font-condensed text-[12px] font-bold uppercase tracking-[0.06em] ${color} ${edge}`}
      >
        {label}
      </th>
      {goals.map(([mine, other], i) => (
        <td
          key={i}
          className={`px-0.5 py-1.5 text-center font-condensed text-[12px] tabular-nums ${edge} ${
            mine > other ? `font-bold ${color} ${tint}` : 'text-fg-2'
          }`}
        >
          {String(mine)}
        </td>
      ))}
      <td
        className={`border-l border-border bg-charcoal px-0.5 py-1.5 text-center font-condensed text-[14px] font-black tabular-nums ${edge} ${
          won ? color : 'text-fg-2'
        }`}
      >
        {String(total)}
      </td>
    </tr>
  )
}
