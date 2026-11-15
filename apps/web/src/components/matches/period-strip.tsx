import type { EnginePeriodStripRow } from '@eanhl/db/queries'
import { formatPeriodLabel } from '@/lib/period-label'

// Compact "goals and shots by period" strip for the /games cards and the home latest-game
// panel (task P1). The numbers are read from the game recording by the live engine and the
// goals add up to EA's final score (checked when imported and again when read). The label
// says so, in small type.
//
// FIXED HEIGHT. A /games card with the strip and a card without it must stay the same
// height (CF3b), so the strip is exactly `PERIOD_STRIP_HEIGHT_PX` tall for any number of
// periods (the rows never wrap; extra periods only add columns). A card with no data
// renders <PeriodStripSpacer /> of the same height when its neighbours have a strip.

export const PERIOD_STRIP_HEIGHT_PX = 84
const ROW_PX = 18

const LABEL = 'font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5'

/** An empty block the height of the strip, for cards that have no period data. */
export function PeriodStripSpacer() {
  return <div aria-hidden style={{ height: PERIOD_STRIP_HEIGHT_PX }} />
}

export function PeriodStrip({ rows }: { rows: readonly EnginePeriodStripRow[] }) {
  const cols = `34px repeat(${String(rows.length)}, minmax(0, 1fr)) 44px`
  // A total exists only when every period has a count (a period with none shows a dash).
  const sum = (pick: (r: EnginePeriodStripRow) => number | null): number | null =>
    rows.reduce<number | null>((n, r) => {
      const v = pick(r)
      return n === null || v === null ? null : n + v
    }, 0)
  return (
    <div
      className="flex flex-col justify-between overflow-hidden"
      style={{ height: PERIOD_STRIP_HEIGHT_PX }}
      aria-label="Goals and shots by period, read from video"
    >
      <div className="flex items-center justify-between" style={{ height: ROW_PX }}>
        <span className={LABEL}>By period</span>
        <span
          className={LABEL}
          title="Goals and shots per period were read from the game recording. The goals add up to EA's final score."
        >
          Read from video
        </span>
      </div>
      <div className="grid items-center" style={{ gridTemplateColumns: cols, height: ROW_PX }}>
        <span />
        {rows.map((r) => (
          <span key={r.periodNumber} className={`${LABEL} text-center tracking-[0.08em]`}>
            {formatPeriodLabel(r.periodNumber)}
          </span>
        ))}
        <span className={`${LABEL} text-center tracking-[0.08em]`}>Tot</span>
      </div>
      <StripRow
        label="Goals"
        cols={cols}
        cells={rows.map((r) => [r.goalsFor, r.goalsAgainst])}
        total={[sum((r) => r.goalsFor), sum((r) => r.goalsAgainst)]}
      />
      <StripRow
        label="Shots"
        cols={cols}
        cells={rows.map((r) => [r.shotsFor, r.shotsAgainst])}
        total={[sum((r) => r.shotsFor), sum((r) => r.shotsAgainst)]}
      />
    </div>
  )
}

function StripRow({
  label,
  cols,
  cells,
  total,
}: {
  label: string
  cols: string
  cells: [number | null, number | null][]
  total: [number | null, number | null]
}) {
  return (
    <div className="grid items-center" style={{ gridTemplateColumns: cols, height: ROW_PX }}>
      <span className={LABEL}>{label}</span>
      {cells.map(([us, them], i) => (
        <Pair key={i} us={us} them={them} />
      ))}
      <Pair us={total[0]} them={total[1]} bold />
    </div>
  )
}

function Pair({
  us,
  them,
  bold = false,
}: {
  us: number | null
  them: number | null
  bold?: boolean
}) {
  if (us === null || them === null) {
    return <span className="text-center font-condensed text-[12px] text-fg-5">–</span>
  }
  return (
    <span className="whitespace-nowrap text-center font-condensed text-[12px] tabular-nums">
      <span className={`${bold ? 'font-black' : 'font-bold'} text-zinc-100`}>{String(us)}</span>
      <span className="font-medium text-fg-5">–{String(them)}</span>
    </span>
  )
}
