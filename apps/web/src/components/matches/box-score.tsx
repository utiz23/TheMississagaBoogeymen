'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { MatchPeriodSummaryRow } from '@eanhl/db/queries'
import { abbreviateTeamName } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period-label'
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

interface BoxScoreProps {
  rows: MatchPeriodSummaryRow[]
  opponentLabel: string
}

type BoxScoreMode = 'goals' | 'shots' | 'faceoffs'

const MODES: readonly BoxScoreMode[] = ['goals', 'shots', 'faceoffs'] as const
const MODE_LABEL: Record<BoxScoreMode, string> = {
  goals: 'Goals',
  shots: 'Shots',
  faceoffs: 'Faceoffs',
}

export function BoxScore({ rows, opponentLabel }: BoxScoreProps) {
  const [mode, setMode] = useState<BoxScoreMode>('goals')
  const tableId = useId()
  const tablistId = useId()

  if (rows.length === 0) return null

  const sortedRows = sortPeriods(rows)
  const oppAbbrev = abbreviateTeamName(opponentLabel)
  const sourceKind = detectSource(rows)

  return (
    <section>
      <div className="border border-border bg-surface">
        <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.18em] text-fg-4">
              <span aria-hidden className="pr-1 text-accent">
                ▰
              </span>
              Box Score
            </h2>
            <p className="font-condensed text-[10px] uppercase tracking-[0.12em] text-fg-5">
              Period-by-period · {sourceKind === 'ocr' ? 'OCR-reviewed' : 'EA totals'}
            </p>
          </div>

          <ModeTabs mode={mode} onChange={setMode} tablistId={tablistId} tableId={tableId} />

          <BoxScoreTable
            mode={mode}
            rows={sortedRows}
            oppAbbrev={oppAbbrev}
            tableId={tableId}
            tablistId={tablistId}
          />

          <Footnotes mode={mode} rows={sortedRows} sourceKind={sourceKind} />
        </div>
      </div>
    </section>
  )
}

// ─── ModeTabs ─────────────────────────────────────────────────────────────────

function ModeTabs({
  mode,
  onChange,
  tablistId,
  tableId,
}: {
  mode: BoxScoreMode
  onChange: (m: BoxScoreMode) => void
  tablistId: string
  tableId: string
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
      className="flex flex-wrap gap-1.5"
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
            tabIndex={active ? 0 : -1}
            onClick={() => {
              onChange(m)
            }}
            className={`border px-2.5 py-1 font-condensed text-[10px] font-bold uppercase tracking-[0.06em] transition-colors ${
              active
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-border text-fg-4 hover:bg-surface-raised/50 hover:text-fg-3'
            }`}
          >
            {MODE_LABEL[m]}
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
              className="px-1.5 py-1 text-left font-condensed text-[10px] font-bold uppercase tracking-[0.06em] text-fg-4"
            >
              Team
            </th>
            {rows.map((r) => (
              <th
                key={r.id}
                scope="col"
                className="px-0.5 py-1 text-center font-condensed text-[10px] font-bold uppercase tracking-[0.04em] tabular-nums text-fg-4"
              >
                {formatPeriodLabel(r.periodNumber)}
              </th>
            ))}
            <th
              scope="col"
              className="border-l border-accent/40 px-0.5 py-1 text-center font-condensed text-[10px] font-bold uppercase tracking-[0.04em] text-accent"
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
          {mode === 'faceoffs' ? (
            <FaceoffPctRow rows={rows} totals={totals} bgmWinsTotal={bgmWinsTotal} />
          ) : null}
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
  const edge = topBorder ? 'border-t border-border-subtle' : ''
  const teamColor = isBgm ? 'text-accent' : '[color:var(--opp)]'
  const winColor = isBgm ? 'text-accent' : '[color:var(--opp)]'
  const winTint = isBgm ? 'bg-accent/[0.08]' : 'bg-[color:var(--opp-soft)]'
  const total = isBgm ? totals.forVal : totals.againstVal

  return (
    <tr>
      <th
        scope="row"
        className={`px-1.5 py-1.5 text-left font-condensed text-[11px] font-black uppercase tracking-[0.06em] ${teamColor} ${edge}`}
      >
        {label}
      </th>
      {rows.map((r) => {
        const { forVal, againstVal } = getModeValues(r, mode)
        const mine = isBgm ? forVal : againstVal
        const other = isBgm ? againstVal : forVal
        const wins = mine !== null && other !== null && mine > other
        return (
          <td
            key={r.id}
            className={`px-0.5 py-1.5 text-center font-condensed text-[12px] tabular-nums ${edge} ${
              mine === null ? 'text-fg-5' : wins ? `font-bold ${winColor} ${winTint}` : 'text-fg-3'
            }`}
          >
            {mine ?? '—'}
          </td>
        )
      })}
      <td
        className={`border-l border-accent/40 bg-accent/[0.06] px-0.5 py-1.5 text-center font-condensed text-[14px] font-black tabular-nums ${edge} ${
          total === null ? 'text-fg-5' : isWinner ? winColor : 'text-fg-2'
        }`}
        style={isWinner && isBgm ? { textShadow: '0 0 10px rgba(232,65,49,0.30)' } : undefined}
      >
        {total ?? '—'}
      </td>
    </tr>
  )
}

function FaceoffPctRow({
  rows,
  totals,
  bgmWinsTotal,
}: {
  rows: MatchPeriodSummaryRow[]
  totals: Totals
  bgmWinsTotal: boolean
}) {
  const totalPct = computeFaceoffPct(totals.forVal, totals.againstVal)
  return (
    <tr>
      <th scope="row" className="sr-only">
        BGM faceoff percentage by period
      </th>
      {rows.map((r) => {
        const pct = computeFaceoffPct(r.faceoffsFor, r.faceoffsAgainst)
        const isBgmWin =
          pct !== null &&
          r.faceoffsFor !== null &&
          r.faceoffsAgainst !== null &&
          r.faceoffsFor > r.faceoffsAgainst
        return (
          <td
            key={r.id}
            aria-hidden
            className={`px-0.5 pb-1.5 pt-0 text-center font-condensed text-[9.5px] font-bold tabular-nums ${
              pct === null ? 'text-fg-5' : isBgmWin ? 'text-accent' : 'text-fg-4'
            }`}
          >
            {pct !== null ? `${pct.toFixed(0)}%` : '—'}
          </td>
        )
      })}
      <td
        aria-hidden
        className={`border-l border-accent/40 bg-accent/[0.06] px-0.5 pb-1.5 pt-0 text-center font-condensed text-[9.5px] font-bold tabular-nums ${
          totalPct === null ? 'text-fg-5' : bgmWinsTotal ? 'text-accent' : 'text-fg-4'
        }`}
      >
        {totalPct !== null ? `${totalPct.toFixed(0)}%` : '—'}
      </td>
    </tr>
  )
}

// ─── Footnotes ────────────────────────────────────────────────────────────────

function Footnotes({
  mode,
  rows,
  sourceKind,
}: {
  mode: BoxScoreMode
  rows: MatchPeriodSummaryRow[]
  sourceKind: 'ocr' | 'ea'
}) {
  const { missingPeriods } = computeTotals(rows, mode)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {missingPeriods.length > 0 ? (
        <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">
          {missingPeriods.join(', ')} unread — excluded from totals
        </span>
      ) : null}
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
    </div>
  )
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
