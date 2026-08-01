'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { MatchPeriodSummaryRow } from '@eanhl/db/queries'
import { abbreviateTeamName, formatScore } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period-label'
import { delayDurationVars, delayVar, staggerDelay } from '@/lib/motion'
import { CountUp, MotionReveal, useReducedMotion } from './motion'
import { ProvenanceChip } from './ocr-provenance-footer'

// Rail module — period-by-period box score. Restyled to the prototype's
// compact grid (TEAM · periods · TOT) at ~299px rail width; the pre-regrid
// layout carried a headline total inside every tab, which no longer fits and
// is redundant with the TOT column.
//
// The roving-tabindex tablist is kept verbatim — it is the a11y template the
// rest of the game sheet copies.
//
// Rail collapse rule: no period rows (every EA-only match) → render nothing.
//
// OCR is operator vocabulary, not visitor vocabulary: the provenance chip sits
// behind `showDiagnostics` (the `showOcrDiagnostics()` gate the lineup footer
// and the DtW coverage chip already use). The unread-periods warning stays
// visible to everyone — that is a statement about the numbers on screen, not
// about our ingest.
//
// No subtitle: the prototype's header is the section label alone. Faceoff share
// survives as `Won 70.0%` in the footnote; the per-period FO% sub-row is gone.

interface BoxScoreProps {
  rows: MatchPeriodSummaryRow[]
  opponentLabel: string
  /** Admin/OCR_DIAGNOSTICS gate — see `lib/ocr-diagnostics.ts`. */
  showDiagnostics: boolean
}

type BoxScoreMode = 'goals' | 'shots' | 'faceoffs'

const MODES: readonly BoxScoreMode[] = ['goals', 'shots', 'faceoffs'] as const
/** Tab face. `FO` is the prototype's label; the accessible name stays long. */
const MODE_LABEL: Record<BoxScoreMode, string> = {
  goals: 'Goals',
  shots: 'Shots',
  faceoffs: 'FO',
}
const MODE_A11Y_LABEL: Record<BoxScoreMode, string> = {
  goals: 'Goals',
  shots: 'Shots',
  faceoffs: 'Faceoffs',
}

export function BoxScore({ rows, opponentLabel, showDiagnostics }: BoxScoreProps) {
  const [mode, setMode] = useState<BoxScoreMode>('goals')
  const tableId = useId()
  const tablistId = useId()

  const sortedRows = useMemo(() => sortPeriods(rows), [rows])
  // A mode with no readable cell anywhere is dropped from the rotation cycle —
  // auto-swapping into a table of em-dashes is worse than skipping it. It stays
  // in the tablist and stays clickable; only the unattended cycle skips it.
  const rotatableModes = useMemo(
    () => MODES.filter((m) => hasAnyValue(sortedRows, m)),
    [sortedRows],
  )
  const rotation = useBoxScoreRotation({
    mode,
    modes: rotatableModes,
    onAdvance: setMode,
  })

  if (rows.length === 0) return null

  const oppAbbrev = abbreviateTeamName(opponentLabel)
  const sourceKind = detectSource(rows)
  // When the table has finished filling: every column, plus the TOT that lands
  // after them, plus its count. The dwell tick and the footnote both hang off
  // this rather than off a hardcoded guess.
  const settledMs = totalDelay(sortedRows.length) + COUNT_MS

  return (
    <section>
      <MotionReveal className="gs-rise relative overflow-hidden border border-border bg-surface">
        {/* The hairline wipe replays on every auto-swap — `key` is what restarts
            a CSS animation, and it is the same trick the prototype spelled as
            alternating `box-wipe-a` / `box-wipe-b` keyframe names. `step` only
            moves on rotation, so a manual tab click refills the table without a
            second panel sweep, exactly as the motion spec asks. */}
        <span key={rotation.step} aria-hidden className="gs-wipe" />
        <div
          ref={rotation.panelRef}
          onMouseEnter={() => {
            rotation.setHovered(true)
          }}
          onMouseLeave={() => {
            rotation.setHovered(false)
          }}
          onFocusCapture={() => {
            rotation.setHovered(true)
          }}
          onBlurCapture={() => {
            rotation.setHovered(false)
          }}
          className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3"
        >
          {/* House module header — the same 12px / semibold / 0.16em / fg-4
              with an fg-5 ornament that Top Performers, DtW and Lineup carry.
              The accent belongs to the data in this panel, not to its label. */}
          <h2 className="font-condensed text-[12px] font-semibold uppercase tracking-[0.16em] text-fg-4">
            <span aria-hidden className="pr-1 text-fg-5">
              ▰
            </span>
            Box Score
          </h2>

          <ModeTabs
            mode={mode}
            onChange={setMode}
            tablistId={tablistId}
            tableId={tableId}
            rotation={rotation}
            tickArmMs={settledMs}
          />

          {/* `key={mode}` is the tab-refill cue: switching GOALS/SHOTS/FO
              remounts the table so the columns fill again with the new stat,
              while the panel itself does NOT replay — the spec asks for a
              refill, not a second entrance. */}
          <BoxScoreTable
            key={mode}
            mode={mode}
            rows={sortedRows}
            oppAbbrev={oppAbbrev}
            tableId={tableId}
            tablistId={tablistId}
          />

          {/* The caption to a settled graphic — it fades up once the table has
              resolved. */}
          <div className="gs-fade-in" style={delayVar(settledMs + 60)}>
            <Footnotes
              mode={mode}
              rows={sortedRows}
              sourceKind={sourceKind}
              showDiagnostics={showDiagnostics}
            />
          </div>
        </div>
      </MotionReveal>
    </section>
  )
}

// ─── Auto-rotation ────────────────────────────────────────────────────────────

/* The selected view cycles GOALS → SHOTS → FO on a dwell timer, each swap
   replaying the column fill behind the panel's hairline wipe.

   THERE IS NO JS TIMER. The tick's CSS animation IS the clock: `advance` fires
   on its `animationend`, and pausing is `animation-play-state: paused`, which
   preserves elapsed time for free. The prototype ran a `setTimeout` alongside
   the bar and had to hand-track the remaining ms on every pause to keep the two
   together; one clock cannot drift from itself. This is the same correction the
   lineup auto-walk already carries. */

const ROTATE_DWELL_MS = 9000

interface BoxRotation {
  on: boolean
  paused: boolean
  step: number
  advance: () => void
  stop: () => void
  setHovered: (hovered: boolean) => void
  panelRef: (el: HTMLDivElement | null) => void
}

function useBoxScoreRotation({
  mode,
  modes,
  onAdvance,
}: {
  mode: BoxScoreMode
  modes: readonly BoxScoreMode[]
  onAdvance: (mode: BoxScoreMode) => void
}): BoxRotation {
  const reduced = useReducedMotion()
  const [stopped, setStopped] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [offscreen, setOffscreen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [step, setStep] = useState(0)
  const panelEl = useRef<HTMLDivElement | null>(null)

  // Hold the cycle while the panel is off screen — a rotation nobody is looking
  // at only burns frames, and it would otherwise be several views along by the
  // time it scrolls back in.
  useEffect(() => {
    const el = panelEl.current
    if (el === null || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setOffscreen(!e.isIntersecting)
      },
      { threshold: 0.05 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      setHidden(document.hidden)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const on = !stopped && !reduced && modes.length > 1
  const paused = hovered || offscreen || hidden

  const stop = useCallback(() => {
    setStopped(true)
  }, [])

  const advance = useCallback(() => {
    if (modes.length === 0) return
    const i = modes.indexOf(mode)
    // `-1` means the user is parked on a mode the cycle skips; restarting from
    // the top is the honest recovery rather than guessing a neighbour.
    const next = modes[(i + 1) % modes.length]
    if (next !== undefined) onAdvance(next)
    setStep((s) => s + 1)
  }, [mode, modes, onAdvance])

  return {
    on,
    paused,
    step,
    advance,
    stop,
    setHovered,
    panelRef: (el) => {
      panelEl.current = el
    },
  }
}

// ─── ModeTabs ─────────────────────────────────────────────────────────────────

function ModeTabs({
  mode,
  onChange,
  tablistId,
  tableId,
  rotation,
  tickArmMs,
}: {
  mode: BoxScoreMode
  onChange: (m: BoxScoreMode) => void
  tablistId: string
  tableId: string
  rotation: BoxRotation
  tickArmMs: number
}) {
  const tablistRef = useRef<HTMLDivElement>(null)

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    if (!buttons || buttons.length === 0) return
    const focused = Array.from(buttons).findIndex((b) => b === document.activeElement)
    if (focused < 0) return

    let nextIdx: number | null = null
    if (e.key === 'ArrowRight') nextIdx = (focused + 1) % buttons.length
    else if (e.key === 'ArrowLeft') nextIdx = (focused - 1 + buttons.length) % buttons.length
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = buttons.length - 1

    if (nextIdx === null) return
    e.preventDefault()
    // Arrowing to a view is a deliberate takeover, same as clicking one.
    rotation.stop()
    const next = MODES[nextIdx] ?? 'goals'
    onChange(next)
    // After React re-renders with the new tabIndex layout, move focus to the
    // now-active tab (canonical roving-tabindex pattern).
    requestAnimationFrame(() => {
      buttons[nextIdx]?.focus()
    })
  }

  return (
    <div
      id={tablistId}
      ref={tablistRef}
      role="tablist"
      aria-label="Box score mode"
      onKeyDown={handleKey}
      // Three equal columns, not a wrapping row of content-sized pills: the
      // prototype's `grid-template-columns:repeat(3,1fr);gap:5px`. GOALS is a
      // wider word than FO, so content sizing gave three ragged tabs and left
      // the row short of the panel's width.
      className="grid grid-cols-3 items-stretch gap-[5px]"
    >
      {MODES.map((m) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tableId}
            aria-label={MODE_A11Y_LABEL[m]}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              // Any deliberate click hands the panel back to the user — the
              // rotation is over for this visit, matching the lineup auto-walk.
              rotation.stop()
              onChange(m)
            }}
            className={`relative overflow-hidden whitespace-nowrap border px-[9px] py-1.5 font-condensed text-[12px] font-bold uppercase tracking-[0.06em] transition-colors ${
              active
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-border text-fg-3 hover:border-accent hover:bg-accent/10 hover:text-accent'
            }`}
          >
            {MODE_LABEL[m]}
            {/* Dwell tick — the rotation's clock and its only visible
                indicator. `key` restarts it on each swap. */}
            {active && rotation.on ? (
              <span
                key={rotation.step}
                aria-hidden
                onAnimationEnd={rotation.advance}
                style={{
                  ...delayDurationVars(tickArmMs, ROTATE_DWELL_MS),
                  animationPlayState: rotation.paused ? 'paused' : 'running',
                }}
                className="gs-tick absolute inset-x-0 bottom-0 h-[2px] [background:linear-gradient(90deg,rgba(232,65,49,0.2),var(--color-accent))]"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────

function BoxScoreTable({
  mode,
  rows,
  oppAbbrev,
  tableId,
  tablistId,
}: {
  mode: BoxScoreMode
  rows: MatchPeriodSummaryRow[]
  oppAbbrev: string
  tableId: string
  tablistId: string
}) {
  const totals = computeTotals(rows, mode)
  const bgmWinsTotal =
    totals.forVal !== null && totals.againstVal !== null && totals.forVal > totals.againstVal
  const oppWinsTotal =
    totals.forVal !== null && totals.againstVal !== null && totals.againstVal > totals.forVal

  return (
    <div
      id={tableId}
      role="tabpanel"
      aria-labelledby={tablistId}
      className="overflow-x-auto border border-border-subtle"
    >
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-charcoal">
            <th
              scope="col"
              className="px-1.5 py-1 text-left font-condensed text-[10px] font-bold uppercase tracking-[0.06em] text-fg-3"
            >
              Team
            </th>
            {rows.map((r) => (
              <th
                key={r.id}
                scope="col"
                className="px-0.5 py-1 text-center font-condensed text-[10px] font-bold uppercase tracking-[0.04em] tabular-nums text-fg-3"
              >
                {formatPeriodLabel(r.periodNumber)}
              </th>
            ))}
            {/* TOT is a structural column, not an accent event: neutral field
                and a plain rule, with the team colour carried by the number. */}
            <th
              scope="col"
              className="border-l border-border px-0.5 py-1 text-center font-condensed text-[10px] font-bold uppercase tracking-[0.04em] text-fg-3"
            >
              Tot
            </th>
          </tr>
        </thead>
        <tbody>
          <TeamRow
            mode={mode}
            rows={rows}
            side="bgm"
            label="BGM"
            totals={totals}
            isWinner={bgmWinsTotal}
          />
          <TeamRow
            mode={mode}
            rows={rows}
            side="opp"
            label={oppAbbrev}
            totals={totals}
            isWinner={oppWinsTotal}
            topBorder
          />
        </tbody>
      </table>
    </div>
  )
}

function TeamRow({
  mode,
  rows,
  side,
  label,
  totals,
  isWinner,
  topBorder = false,
}: {
  mode: BoxScoreMode
  rows: MatchPeriodSummaryRow[]
  side: 'bgm' | 'opp'
  label: string
  totals: Totals
  isWinner: boolean
  topBorder?: boolean
}) {
  const isBgm = side === 'bgm'
  // `border-t-*` (top colour only), NOT `border-border-subtle` (all four sides).
  // This class lands on every cell in the row including the TOT cell, which sets
  // its own `border-l` colour; an all-sides colour here is a same-specificity
  // collision decided by Tailwind's output order, and it was silently repainting
  // the bottom row's TOT rule a different grey from the top row's.
  const edge = topBorder ? 'border-t border-t-border-subtle' : ''
  const teamColor = isBgm ? 'text-accent' : '[color:var(--opp)]'
  const winColor = isBgm ? 'text-accent' : '[color:var(--opp)]'
  // A period winner settles into a faint fill: red-soft for us, neutral
  // charcoal for them. A tint, never a glow — the one glow belongs to the total.
  const winTint = isBgm ? 'bg-accent/[0.08]' : 'bg-charcoal'
  const total = isBgm ? totals.forVal : totals.againstVal
  const totalDelayMs = totalDelay(rows.length)

  return (
    <tr>
      <th
        scope="row"
        className={`px-1.5 py-1.5 text-left font-condensed text-[12px] font-bold uppercase tracking-[0.06em] ${teamColor} ${edge}`}
      >
        {label}
      </th>
      {rows.map((r, index) => {
        const { forVal, againstVal } = getModeValues(r, mode)
        const mine = isBgm ? forVal : againstVal
        const other = isBgm ? againstVal : forVal
        const wins = mine !== null && other !== null && mine > other
        const delayMs = columnDelay(index)
        return (
          <td
            key={r.id}
            className={`gs-fade-in px-0.5 py-1.5 text-center font-condensed text-[12px] tabular-nums ${edge} ${
              mine === null ? 'text-fg-3' : wins ? `font-bold ${winColor} ${winTint}` : 'text-fg-2'
            }`}
            style={delayVar(delayMs)}
          >
            {mine === null ? (
              '—'
            ) : (
              <CountUp value={mine} durationMs={COUNT_MS} delayMs={delayMs}>
                {String(mine)}
              </CountUp>
            )}
          </td>
        )
      })}
      {/* The conclusion, arriving last: the TOT column lands after every
          period column, and only the winning total blooms — one event. The
          bloom rides an inner span so it can start when the count *lands*
          rather than when the cell arrives; both cues read `--gs-delay`, so
          sharing one element would force them onto the same clock. */}
      <td
        className={`gs-fade-in border-l border-border bg-charcoal px-0.5 py-1.5 text-center font-condensed text-[14px] font-black tabular-nums ${edge} ${
          total === null ? 'text-fg-3' : isWinner ? winColor : 'text-fg-2'
        }`}
        style={delayVar(totalDelayMs)}
      >
        {total === null ? (
          '—'
        ) : (
          <span
            className={isWinner ? (isBgm ? 'gs-bloom-accent' : 'gs-bloom-opp') : undefined}
            style={isWinner ? delayVar(totalDelayMs + COUNT_MS) : undefined}
          >
            <CountUp value={total} durationMs={COUNT_MS} delayMs={totalDelayMs}>
              {String(total)}
            </CountUp>
          </span>
        )}
      </td>
    </tr>
  )
}

/* --- column fill schedule (Phase 12 motion) ------------------------------
   Periods reveal left to right so the game appears to play out, then TOT lands
   after all of them. Both team cells in a column share a delay, so a column
   arrives as a pair rather than one row racing the other. */
const COLUMN_START_MS = 140
const COLUMN_STEP_MS = 150
const COUNT_MS = 320

function columnDelay(index: number): number {
  return COLUMN_START_MS + staggerDelay(index, COLUMN_STEP_MS, 750)
}

function totalDelay(periodCount: number): number {
  return columnDelay(periodCount) + 60
}

// ─── Footnotes ────────────────────────────────────────────────────────────────

function Footnotes({
  mode,
  rows,
  sourceKind,
  showDiagnostics,
}: {
  mode: BoxScoreMode
  rows: MatchPeriodSummaryRow[]
  sourceKind: 'ocr' | 'ea'
  showDiagnostics: boolean
}) {
  const totals = computeTotals(rows, mode)
  const summary = summaryLine(mode, totals)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {summary !== null ? (
        <span className="font-condensed text-[12px] uppercase tracking-[0.1em] text-fg-3">
          {summary}
        </span>
      ) : null}
      {totals.missingPeriods.length > 0 ? (
        <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-3">
          {totals.missingPeriods.join(', ')} unread — excluded from totals
        </span>
      ) : null}
      {showDiagnostics ? (
        <span className="ml-auto">
          <ProvenanceChip
            label={sourceKind === 'ocr' ? 'OCR · post-game' : 'EA · official'}
            tone={sourceKind === 'ocr' ? 'ok' : 'neutral'}
            tooltip={
              sourceKind === 'ocr'
                ? 'Period rows read from the in-game post-game screens and operator-reviewed.'
                : 'Period rows derived from the EA Pro Clubs API.'
            }
          />
        </span>
      ) : null}
    </div>
  )
}

/**
 * The prototype's caption line — the table's headline, restated once the
 * columns have settled. Derived entirely from the totals already on screen, so
 * it can never disagree with them.
 *
 * Null when nothing was readable: a summary of no periods is not a summary.
 */
function summaryLine(mode: BoxScoreMode, totals: Totals): string | null {
  const { forVal, againstVal } = totals
  if (forVal === null || againstVal === null) return null

  const score = formatScore(forVal, againstVal)
  if (mode === 'faceoffs') {
    const pct = computeFaceoffPct(forVal, againstVal)
    return pct === null ? `Faceoffs ${score}` : `Faceoffs ${score} · Won ${pct.toFixed(1)}%`
  }
  const label = mode === 'goals' ? 'Goals' : 'SOG'
  return `${label} ${score} (${formatDiff(forVal - againstVal)})`
}

/** `+3` / `−3` / `EVEN`. Typographic minus, to match the en-dash in the score. */
function formatDiff(diff: number): string {
  if (diff === 0) return 'EVEN'
  return diff > 0 ? `+${String(diff)}` : `−${String(Math.abs(diff))}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface Totals {
  forVal: number | null
  againstVal: number | null
  missingPeriods: string[]
}

function sortPeriods(rows: MatchPeriodSummaryRow[]): MatchPeriodSummaryRow[] {
  return [...rows].sort((a, b) => a.periodNumber - b.periodNumber)
}

function getModeValues(
  row: MatchPeriodSummaryRow,
  mode: BoxScoreMode,
): { forVal: number | null; againstVal: number | null } {
  if (mode === 'goals') return { forVal: row.goalsFor, againstVal: row.goalsAgainst }
  if (mode === 'shots') return { forVal: row.shotsFor, againstVal: row.shotsAgainst }
  return { forVal: row.faceoffsFor, againstVal: row.faceoffsAgainst }
}

/** Does this mode have a single readable cell? Drives the rotation cycle. */
function hasAnyValue(rows: MatchPeriodSummaryRow[], mode: BoxScoreMode): boolean {
  return rows.some((r) => {
    const { forVal, againstVal } = getModeValues(r, mode)
    return forVal !== null || againstVal !== null
  })
}

function computeTotals(rows: MatchPeriodSummaryRow[], mode: BoxScoreMode): Totals {
  let forSum = 0
  let againstSum = 0
  let contributed = 0
  const missingPeriods: string[] = []
  for (const r of rows) {
    const { forVal, againstVal } = getModeValues(r, mode)
    if (forVal === null || againstVal === null) {
      missingPeriods.push(r.periodLabel)
      continue
    }
    forSum += forVal
    againstSum += againstVal
    contributed++
  }
  if (contributed === 0) return { forVal: null, againstVal: null, missingPeriods }
  return { forVal: forSum, againstVal: againstSum, missingPeriods }
}

function computeFaceoffPct(wins: number | null, oppWins: number | null): number | null {
  if (wins === null || oppWins === null) return null
  const total = wins + oppWins
  if (total === 0) return null
  return Math.round((wins / total) * 1000) / 10
}

function detectSource(rows: MatchPeriodSummaryRow[]): 'ocr' | 'ea' {
  return rows.some((r) => r.source === 'ocr' && r.reviewStatus === 'reviewed') ? 'ocr' : 'ea'
}
