import type { EnginePeriodStripRow } from '@eanhl/db/queries'
import { periodGoalCells, periodGoalsText, periodWord } from '@/lib/period-goals'

// Goals by period, read from the game recording by the live engine (task P1). The goals add
// up to EA's final score (checked when imported and again when read). GOALS ONLY (operator
// decision D27, 2026-11-14): shots per period are stored but never shown. The small label
// "Read from video" says where the numbers come from.
//
// Two shapes:
//   * <PeriodGoalsLine>: ONE line for the /games cards. A card with data grows by this one
//     line (`PERIOD_LINE_PX` plus its top margin); a card without data shows nothing extra.
//   * <PeriodGoalsTable>: three fixed rows (title, period names, goals) for the home
//     latest-game panel.

export const PERIOD_LINE_PX = 16
const ROW_PX = 18

const LABEL = 'font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5'
const FROM_VIDEO_TITLE =
  "Goals per period were read from the game recording. They add up to EA's final score."

/** One line for a /games card: "1ST 2–1  2ND 1–1  3RD 2–1  OT 1–0", label on the right. */
export function PeriodGoalsLine({ rows }: { rows: readonly EnginePeriodStripRow[] }) {
  return (
    <div
      className="flex items-center justify-between gap-3 overflow-hidden whitespace-nowrap"
      style={{ height: PERIOD_LINE_PX }}
      aria-label={`Goals by period, read from video: ${periodGoalsText(rows)}`}
    >
      <span className="flex min-w-0 items-baseline gap-x-2.5 font-condensed text-[12px] tabular-nums">
        {periodGoalCells(rows).map((c) => (
          <span key={c.label}>
            <span className={`${LABEL} tracking-[0.08em]`}>{c.label}</span>{' '}
            <span className="font-bold text-zinc-100">{c.score}</span>
          </span>
        ))}
      </span>
      <span className={`${LABEL} shrink-0 text-[9px] tracking-[0.1em]`} title={FROM_VIDEO_TITLE}>
        Read from video
      </span>
    </div>
  )
}

/** Three rows for the home latest-game panel: title and label, period names, goals. */
export function PeriodGoalsTable({ rows }: { rows: readonly EnginePeriodStripRow[] }) {
  const sorted = [...rows].sort((a, b) => a.periodNumber - b.periodNumber)
  const cols = `34px repeat(${String(sorted.length)}, minmax(0, 1fr)) 44px`
  const forTotal = sorted.reduce((n, r) => n + r.goalsFor, 0)
  const againstTotal = sorted.reduce((n, r) => n + r.goalsAgainst, 0)
  return (
    <div aria-label="Goals by period, read from video">
      <div className="flex items-center justify-between" style={{ height: ROW_PX }}>
        <span className={LABEL}>Goals by period</span>
        <span className={LABEL} title={FROM_VIDEO_TITLE}>
          Read from video
        </span>
      </div>
      <div className="grid items-center" style={{ gridTemplateColumns: cols, height: ROW_PX }}>
        <span />
        {sorted.map((r) => (
          <span key={r.periodNumber} className={`${LABEL} text-center uppercase tracking-[0.08em]`}>
            {periodWord(r.periodNumber)}
          </span>
        ))}
        <span className={`${LABEL} text-center tracking-[0.08em]`}>Tot</span>
      </div>
      <div className="grid items-center" style={{ gridTemplateColumns: cols, height: ROW_PX }}>
        <span className={LABEL}>Goals</span>
        {sorted.map((r) => (
          <Pair key={r.periodNumber} us={r.goalsFor} them={r.goalsAgainst} />
        ))}
        <Pair us={forTotal} them={againstTotal} bold />
      </div>
    </div>
  )
}

function Pair({ us, them, bold = false }: { us: number; them: number; bold?: boolean }) {
  return (
    <span className="whitespace-nowrap text-center font-condensed text-[12px] tabular-nums">
      <span className={`${bold ? 'font-black' : 'font-bold'} text-zinc-100`}>{String(us)}</span>
      <span className="font-medium text-fg-5">
        {'–'}
        {String(them)}
      </span>
    </span>
  )
}
