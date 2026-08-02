import { Fragment } from 'react'
import type { BoxScoreGroup, BoxScoreRow } from '@/lib/match-recap'
import { delayVar, staggerDelay } from '@/lib/motion'
import { CountUp, MotionReveal } from './motion'

// Rail module — team head-to-head, ported to the prototype's revised panel
// (`Game sheet prototype layout (1)/Game Sheet copy.dc.html`, the TEAM STATS
// section; motion cues from `Team Stats Motion Recs.dc.html`).
//
// The panel is a FLAT list of duelling rows: one `.ds-section-label` header,
// then every stat at a single 9px rhythm, each with a centre-divider share bar
// (BGM grows leftward from the divider, opponent rightward, divider position =
// share of the pair's total). The prototype builds its rows in groups and then
// `flatMap`s them away — the group titles are an authoring device, not a
// visual. They survive here as sr-only headings so the structure stays in the
// accessibility tree without putting a divider every three rows.
//
// One meaning per panel: full team colour = won this stat, recessive = lost it.
// The two sides express "recessive" differently, and asymmetrically on purpose —
// it mirrors what the NUMERALS above the bar already do. BGM's losing bar takes
// neutral `--color-border` (a dim accent reads as "muted emphasis", not "BGM
// quieter", because accent is the page's emphasis colour everywhere), while the
// opponent's takes `--opp-line` — the opponent hue is a resolved neutral, so a
// faded version still reads as "the opponent, quieter" without competing with
// the winner. `--opp-line` (40%) rather than the numeral's `--opp-2` (74%):
// on a lower-better row the LOSER holds the wider bar (BGM 2 PIM vs 10), and at
// 74% an 83%-wide losing bar out-shouts the winner's sliver.
//
// No FULL HEAD-TO-HEAD link: the prototype links one, but this app has no
// per-opponent route to land on (`/games`, `/roster`, `/stats` only). The plan
// says link only if a destination exists — so it is omitted, not stubbed. Its
// hover arrow-nudge cue goes with it.
//
// Motion (Phase 12): the rows deal in top to bottom and each pair of share
// bars grows OUTWARD from the centre divider — a tug-of-war, not two fills
// travelling the same way. Only the winning side flares, once. Counting stats
// tick up; rates and clocks fade in, because counting a percentage up from
// zero would be inventing intermediate readings that never happened.

interface TeamStatsProps {
  rows: BoxScoreGroup[]
  opponentName: string
}

export function TeamStats({ rows, opponentName }: TeamStatsProps) {
  if (rows.length === 0) return null

  // Group footnotes collect at the foot of the panel — the slot the prototype
  // gave its CTA. They disclose overridden sources, so they cannot be dropped
  // along with the group headers they used to hang under.
  const footnotes = Array.from(
    new Set(rows.map((group) => group.footnote).filter((note): note is string => Boolean(note))),
  )

  // Step is derived from the row count across ALL groups, so the cascade is one
  // continuous sweep down the panel rather than one that runs out partway.
  const totalRows = rows.reduce((count, group) => count + group.rows.length, 0)
  const stepMs = rowStep(totalRows)

  return (
    <section>
      <MotionReveal className="gs-rise relative overflow-hidden border border-border bg-surface">
        <span aria-hidden className="gs-wipe" />
        <div className="flex flex-col gap-3 px-3.5 pb-3.5 pt-3">
          {/* House module header — the same 12px / semibold / 0.16em / fg-4
              with an fg-5 ornament that Box Score, Top Performers, DtW and
              Lineup carry. The accent belongs to the data, not to the label. */}
          <h2 className="font-condensed text-[12px] font-semibold uppercase tracking-[0.16em] text-fg-4">
            <span aria-hidden className="pr-1 text-fg-5">
              ▰
            </span>
            Team Stats
          </h2>

          {/* The bars are colour-coded and the sides are positional, neither of
              which survives being read aloud — so the split is stated once,
              for screen readers, where the prototype relies on layout. */}
          <p className="sr-only">
            Each row compares BGM on the left with {opponentName} on the right. The bar under a row
            is each side&apos;s share of the pair&apos;s total.
          </p>

          <div className="flex flex-col gap-[9px]">
            {/* Row index runs across ALL groups, so the deal-in reads as one
                sheet filling rather than each group restarting its own count. */}
            {rows.map((group, groupIndex) => {
              const rowOffset = rows
                .slice(0, groupIndex)
                .reduce((count, previous) => count + previous.rows.length, 0)
              return (
                <Fragment key={group.title}>
                  {/* Absolutely positioned by `sr-only`, so it is out of flow
                      and adds no gap to the flat rhythm. */}
                  <h3 className="sr-only">{group.title}</h3>
                  {group.rows.map((row, index) => (
                    <Row key={row.label} row={row} delayMs={rowDelay(rowOffset + index, stepMs)} />
                  ))}
                </Fragment>
              )
            })}
          </div>

          {footnotes.length > 0 ? (
            <p className="text-[10px] leading-snug text-fg-5">{footnotes.join(' ')}</p>
          ) : null}
        </div>
      </MotionReveal>
    </section>
  )
}

function Row({ row, delayMs }: { row: BoxScoreRow; delayMs: number }) {
  const { winner, bgmPct, oppPct, comparable } = rowGeometry(row)
  const unit = timeUnit(row)
  const bgmCount = countableValue(row.us)
  const oppCount = countableValue(row.them)

  return (
    <div
      className="gs-row-in gs-hover-row group -mx-1.5 flex flex-col gap-[3px] px-1.5 py-0.5 hover:bg-surface-raised"
      style={delayVar(delayMs)}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <span
          className={`min-w-[40px] font-condensed text-[13px] font-extrabold tabular-nums ${
            winner === 'bgm' ? 'text-accent' : 'text-fg-4'
          }`}
        >
          {bgmCount === null ? (
            row.us
          ) : (
            <CountUp value={bgmCount} durationMs={480} delayMs={delayMs}>
              {row.us}
            </CountUp>
          )}
        </span>
        {/* Hovering a stat brightens its label so a reader can isolate one
            comparison (prototype cue ⑥). `gs-hover-row` carries the transition
            because colour does not inherit one from the row. */}
        <span className="gs-hover-row text-center font-condensed text-[12px] font-semibold uppercase leading-tight tracking-[0.06em] text-fg-4 group-hover:text-fg-2">
          {row.label}
          {unit !== null ? (
            <span
              className="ml-1 align-middle font-condensed text-[10px] font-bold tracking-[0.12em] text-fg-5"
              title="Minutes and seconds"
            >
              {unit}
            </span>
          ) : null}
          {row.polarity === 'lower-better' ? (
            <span
              className="ml-1 align-middle font-condensed text-[10px] font-bold tracking-[0.12em] text-fg-5"
              title="Lower is better"
            >
              ↓ BETTER
            </span>
          ) : null}
        </span>
        <span
          className={`min-w-[40px] text-right font-condensed text-[13px] font-extrabold tabular-nums ${
            winner === 'opp' ? '[color:var(--opp)]' : '[color:var(--opp-2)]'
          }`}
        >
          {oppCount === null || row.them === null ? (
            (row.them ?? '—')
          ) : (
            <CountUp value={oppCount} durationMs={480} delayMs={delayMs}>
              {row.them}
            </CountUp>
          )}
        </span>
      </div>

      {comparable ? (
        <div aria-hidden className="flex h-[5px] overflow-hidden bg-background">
          {/* The two shares sum to 100%, so each gives up 1px to the divider —
              otherwise the track overflows by 2px and clips the opponent tail. */}
          {/* Only the inner fill scales; the outer span keeps its computed
              width, so the divider never moves and no row reflows. BGM's fill
              is anchored at its RIGHT edge and the opponent's at its LEFT, so
              both grow away from the divider between them. */}
          <span
            className="flex flex-none justify-end overflow-hidden"
            style={{ width: `calc(${bgmPct.toFixed(1)}% - 1px)` }}
          >
            <span
              className={`gs-grow-from-right h-full w-full ${
                winner === 'bgm' ? 'gs-flare-accent' : ''
              }`}
              style={{
                background: winner === 'bgm' ? 'var(--color-accent)' : 'var(--color-border)',
                ...delayVar(delayMs),
              }}
            />
          </span>
          <span className="w-[2px] flex-none bg-surface" />
          <span
            className="flex-none overflow-hidden"
            style={{ width: `calc(${oppPct.toFixed(1)}% - 1px)` }}
          >
            <span
              className={`gs-grow-x h-full w-full ${winner === 'opp' ? 'gs-flare-opp' : ''}`}
              style={{
                background: winner === 'opp' ? 'var(--opp)' : 'var(--opp-line)',
                ...delayVar(delayMs),
              }}
            />
          </span>
        </div>
      ) : null}
    </div>
  )
}

// ─── Motion helpers ───────────────────────────────────────────────────────────

/** Beat before the first row deals in. */
const ROW_START_MS = 300
/** Widest gap between two rows — used until the row count forces compression. */
const ROW_MAX_STEP_MS = 105
/** Total time the deal-in may occupy, whatever the row count. */
const ROW_BUDGET_MS = 720

/**
 * Gap between consecutive rows, compressed so the LAST row still deals in
 * inside the budget.
 *
 * THE BUG THIS SHAPE EXISTS TO PREVENT. The step was a fixed 105ms against a
 * 720ms cap, so only the first seven rows had distinct delays and every row
 * from the eighth on shared 720ms exactly. A full five-group match runs to 21
 * rows — two thirds of the panel arrived in one slab after a cascade that
 * visibly stopped halfway down. Same fix, and same reasoning, as the rink's
 * `plotStep` (see `lib/plot-schedule.ts`): compress the step, never drop rows
 * out of the cascade.
 *
 * Denominator is `count - 1` because the gaps sit *between* rows: row 0 deals
 * at delay 0, so N rows have N-1 gaps and the last lands at exactly
 * `ROW_BUDGET_MS`. Short panels never compress — they keep the full 105ms and
 * simply finish early. The spec's "full entrance <= 1.2s" guardrail holds at
 * any row count, because `ROW_START_MS + ROW_BUDGET_MS` is the ceiling.
 */
function rowStep(count: number): number {
  if (count <= 1) return ROW_MAX_STEP_MS
  return Math.min(ROW_MAX_STEP_MS, ROW_BUDGET_MS / (count - 1))
}

/** Deal-in delay for the row at `index`. */
function rowDelay(index: number, stepMs: number): number {
  return ROW_START_MS + staggerDelay(index, stepMs, ROW_BUDGET_MS)
}

/**
 * The number a value can honestly count up to, or null if it must simply fade
 * in. Rates, clocks and made/attempted pairs are excluded: ticking "62.5%" up
 * from zero would render a run of percentages the game never had.
 */
function countableValue(value: string | null): number | null {
  if (value === null) return null
  if (/[%:/]/.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// ─── Share geometry ───────────────────────────────────────────────────────────

interface RowGeometry {
  winner: 'bgm' | 'opp' | null
  bgmPct: number
  oppPct: number
  /** False when there is nothing honest to compare — no bar is drawn. */
  comparable: boolean
}

const NOT_COMPARABLE: RowGeometry = { winner: null, bgmPct: 0, oppPct: 0, comparable: false }

/**
 * Share of the pair's total, so the two segments always meet at a divider
 * whose position IS the split. Rows with no opponent value (or a 0–0 pair)
 * draw no bar rather than a full-width one that would read as domination.
 */
function rowGeometry(row: BoxScoreRow): RowGeometry {
  if (row.them === null) return NOT_COMPARABLE
  const ours = parseStat(row.us)
  const theirs = parseStat(row.them)
  const total = ours + theirs
  if (total <= 0) return NOT_COMPARABLE
  const lowerBetter = row.polarity === 'lower-better'
  const winner = ours === theirs ? null : ours > theirs !== lowerBetter ? 'bgm' : 'opp'
  return {
    winner,
    bgmPct: (ours / total) * 100,
    oppPct: (theirs / total) * 100,
    comparable: true,
  }
}

/** `M:SS` marker for the clock rows (Possession, Time on Attack). */
function timeUnit(row: BoxScoreRow): string | null {
  const isClock = (v: string | null) => v !== null && /^\d+:\d{2}$/.test(v)
  return isClock(row.us) || isClock(row.them) ? 'M:SS' : null
}

function parseStat(value: string | null): number {
  if (!value) return 0
  if (value.includes('/')) return parseFloat(value.split('/')[0] ?? '0') || 0
  if (value.includes(':')) {
    const [m, s] = value.split(':')
    return parseInt(m ?? '0', 10) * 60 + (parseInt(s ?? '0', 10) || 0)
  }
  const cleaned = value.replace('%', '')
  const parsed = parseFloat(cleaned)
  if (Number.isNaN(parsed)) return 0
  return parsed
}
