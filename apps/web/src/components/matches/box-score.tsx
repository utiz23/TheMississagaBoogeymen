'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { MatchPeriodSummaryRow } from '@eanhl/db/queries'
import { abbreviateTeamName } from '@/lib/format'
import { formatPeriodLabel } from '@/lib/period-label'
import { SectionHeader } from '@/components/ui/section-header'

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
  const bgmAbbrev = 'BGM'
  const oppAbbrev = abbreviateTeamName(opponentLabel)
  const sourceKind = detectSource(rows)

  return (
    <section className="space-y-3">
      <SectionHeader label="Box Score" subtitle="Period-by-period · OCR-reviewed" />

      <ModeTabs
        mode={mode}
        onChange={setMode}
        rows={sortedRows}
        tablistId={tablistId}
        tableId={tableId}
      />

      <BoxScoreTable
        mode={mode}
        rows={sortedRows}
        bgmAbbrev={bgmAbbrev}
        oppAbbrev={oppAbbrev}
        tableId={tableId}
        tablistId={tablistId}
      />

      <Footnotes mode={mode} rows={sortedRows} sourceKind={sourceKind} />
    </section>
  )
}

// ─── ModeTabs ─────────────────────────────────────────────────────────────────

function ModeTabs({
  mode,
  onChange,
  rows,
  tablistId,
  tableId,
}: {
  mode: BoxScoreMode
  onChange: (m: BoxScoreMode) => void
  rows: MatchPeriodSummaryRow[]
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
      className="grid grid-cols-3 border border-zinc-800 bg-surface"
    >
      {MODES.map((m, i) => (
        <ModeTab
          key={m}
          mode={m}
          active={mode === m}
          onActivate={() => {
            onChange(m)
          }}
          tableId={tableId}
          rows={rows}
          last={i === MODES.length - 1}
        />
      ))}
    </div>
  )
}

function ModeTab({
  mode,
  active,
  onActivate,
  tableId,
  rows,
  last,
}: {
  mode: BoxScoreMode
  active: boolean
  onActivate: () => void
  tableId: string
  rows: MatchPeriodSummaryRow[]
  last: boolean
}) {
  const totals = computeTotals(rows, mode)
  const wrapperCls = [
    'relative flex flex-col items-start gap-1 px-3 py-3 text-left transition-colors sm:px-4',
    last ? '' : 'border-r border-zinc-800',
    active
      ? '[background:linear-gradient(180deg,rgba(232,65,49,0.10),rgba(232,65,49,0.02))]'
      : 'hover:bg-surface-raised/50',
  ].join(' ')

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={tableId}
      tabIndex={active ? 0 : -1}
      onClick={onActivate}
      className={wrapperCls}
    >
      {active ? (
        <span aria-hidden className="ticker-strip ticker-strip-thin absolute inset-x-0 top-0" />
      ) : null}
      <span
        className={`font-condensed text-[11px] font-bold uppercase tracking-[0.22em] ${
          active ? 'text-fg-1' : 'text-fg-5'
        }`}
      >
        {MODE_LABEL[mode]}
      </span>
      <ModeTabSummary mode={mode} totals={totals} active={active} />
    </button>
  )
}

function ModeTabSummary({
  mode,
  totals,
  active,
}: {
  mode: BoxScoreMode
  totals: { forVal: number | null; againstVal: number | null }
  active: boolean
}) {
  if (totals.forVal === null || totals.againstVal === null) {
    return <span className="font-condensed text-[18px] font-black tabular-nums text-fg-5">—</span>
  }
  const bgmAhead = totals.forVal > totals.againstVal
  const oppAhead = totals.againstVal > totals.forVal
  const dim = active ? 'text-accent' : 'text-fg-3'
  const win = active ? 'text-accent' : 'text-fg-1'

  if (mode === 'faceoffs') {
    const pct = computeFaceoffPct(totals.forVal, totals.againstVal)
    const totalAttempts = totals.forVal + totals.againstVal
    return (
      <span className="flex items-baseline gap-2 font-condensed tabular-nums">
        <span className={`text-[18px] font-black ${active ? 'text-accent' : 'text-fg-3'}`}>
          {pct !== null ? `${pct.toFixed(1)}%` : '—'}
        </span>
        <span className="text-[11px] font-bold text-fg-5">
          {totalAttempts > 0
            ? `${totals.forVal.toString()}W · ${totalAttempts.toString()} total`
            : '—'}
        </span>
      </span>
    )
  }

  const delta = totals.forVal - totals.againstVal
  return (
    <span className="flex items-baseline gap-2 font-condensed tabular-nums">
      <span
        className={`text-[18px] font-black ${
          bgmAhead ? win : oppAhead ? (active ? 'text-fg-1' : 'text-fg-3') : dim
        }`}
      >
        {totals.forVal} – {totals.againstVal}
      </span>
      {(mode === 'shots' && delta !== 0) || mode === 'goals' ? (
        <span
          className={`text-[11px] font-extrabold tracking-[0.06em] ${
            delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-fg-3'
          }`}
        >
          {delta > 0 ? '+' : delta === 0 ? '±' : ''}
          {delta}
        </span>
      ) : null}
    </span>
  )
}

// ─── Table ────────────────────────────────────────────────────────────────────

function BoxScoreTable({
  mode,
  rows,
  bgmAbbrev,
  oppAbbrev,
  tableId,
  tablistId,
}: {
  mode: BoxScoreMode
  rows: MatchPeriodSummaryRow[]
  bgmAbbrev: string
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
      className="overflow-x-auto border border-zinc-800 bg-surface"
    >
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th
              scope="col"
              className="border-b border-zinc-800 bg-surface-raised px-3 py-2 text-left font-condensed text-[10px] font-bold uppercase tracking-[0.20em] text-fg-5"
            >
              Team
            </th>
            {rows.map((r) => (
              <th
                key={r.id}
                scope="col"
                className="border-b border-zinc-800 bg-surface-raised px-3 py-2 text-center font-condensed text-[10px] font-bold uppercase tracking-[0.20em] text-fg-5"
              >
                <PeriodHeading number={r.periodNumber} />
              </th>
            ))}
            <th
              scope="col"
              className="border-b border-zinc-800 border-l border-accent/40 bg-[linear-gradient(180deg,rgba(232,65,49,0.10),rgba(232,65,49,0.02))] px-3 py-2 text-center font-condensed text-[10px] font-bold uppercase tracking-[0.20em] text-accent"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          <BgmRow
            mode={mode}
            rows={rows}
            bgmAbbrev={bgmAbbrev}
            totals={totals}
            isWinner={bgmWinsTotal}
          />
          {mode === 'faceoffs' ? (
            <FaceoffPctRow rows={rows} totals={totals} bgmWinsTotal={bgmWinsTotal} />
          ) : null}
          <OppRow
            mode={mode}
            rows={rows}
            oppAbbrev={oppAbbrev}
            totals={totals}
            isWinner={oppWinsTotal}
          />
        </tbody>
      </table>
    </div>
  )
}

function PeriodHeading({ number }: { number: number }) {
  const isOt = number >= 4
  return <span className={isOt ? 'font-black text-fg-1' : ''}>{formatPeriodLabel(number)}</span>
}

function BgmRow({
  mode,
  rows,
  bgmAbbrev,
  totals,
  isWinner,
}: {
  mode: BoxScoreMode
  rows: MatchPeriodSummaryRow[]
  bgmAbbrev: string
  totals: { forVal: number | null; againstVal: number | null }
  isWinner: boolean
}) {
  return (
    <tr>
      <th
        scope="row"
        className="px-3 py-3 text-left font-condensed text-[11px] font-black uppercase tracking-[0.16em] text-accent"
      >
        {bgmAbbrev}
      </th>
      {rows.map((r) => {
        const { forVal, againstVal } = getModeValues(r, mode)
        const isPeriodWinner = forVal !== null && againstVal !== null && forVal > againstVal
        return (
          <td
            key={r.id}
            className={`border-b border-zinc-800/40 px-3 py-3 text-center font-condensed text-[17px] tabular-nums ${
              forVal === null
                ? 'font-bold text-fg-5'
                : isPeriodWinner
                  ? 'font-black text-accent'
                  : 'font-bold text-fg-2'
            } ${isPeriodWinner ? 'bg-accent/[0.04]' : ''}`}
          >
            {forVal ?? '—'}
          </td>
        )
      })}
      <td
        className={`border-l border-accent/40 bg-accent/[0.04] px-3 py-3 text-center font-condensed text-[24px] font-black tabular-nums ${
          totals.forVal === null
            ? 'text-fg-5'
            : isWinner
              ? 'text-accent [text-shadow:0_0_10px_rgba(232,65,49,0.30)]'
              : 'text-fg-1'
        }`}
      >
        {totals.forVal ?? '—'}
      </td>
    </tr>
  )
}

function OppRow({
  mode,
  rows,
  oppAbbrev,
  totals,
  isWinner,
}: {
  mode: BoxScoreMode
  rows: MatchPeriodSummaryRow[]
  oppAbbrev: string
  totals: { forVal: number | null; againstVal: number | null }
  isWinner: boolean
}) {
  return (
    <tr>
      <th
        scope="row"
        className="px-3 py-3 text-left font-condensed text-[11px] font-black uppercase tracking-[0.16em] text-fg-3"
      >
        {oppAbbrev}
      </th>
      {rows.map((r) => {
        const { forVal, againstVal } = getModeValues(r, mode)
        const isPeriodWinner = forVal !== null && againstVal !== null && againstVal > forVal
        return (
          <td
            key={r.id}
            className={`border-b border-zinc-800/40 px-3 py-3 text-center font-condensed text-[17px] tabular-nums ${
              againstVal === null
                ? 'font-bold text-fg-5'
                : isPeriodWinner
                  ? 'font-black text-fg-1'
                  : 'font-bold text-fg-3'
            } ${isPeriodWinner ? 'bg-fg-4/[0.04]' : ''}`}
          >
            {againstVal ?? '—'}
          </td>
        )
      })}
      <td
        className={`border-l border-accent/40 bg-accent/[0.04] px-3 py-3 text-center font-condensed text-[24px] font-black tabular-nums ${
          totals.againstVal === null ? 'text-fg-5' : isWinner ? 'text-fg-1' : 'text-fg-3'
        }`}
      >
        {totals.againstVal ?? '—'}
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
  totals: { forVal: number | null; againstVal: number | null }
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
            className={`border-b border-zinc-800/40 px-3 pb-3 pt-0 text-center font-condensed text-[10px] font-bold tabular-nums tracking-[0.06em] ${
              pct === null ? 'text-fg-5' : isBgmWin ? 'text-accent' : 'text-fg-3'
            }`}
          >
            {pct !== null ? `${pct.toFixed(1)}%` : '—'}
          </td>
        )
      })}
      <td
        aria-hidden
        className={`border-l border-accent/40 bg-accent/[0.04] px-3 pb-3 pt-0 text-center font-condensed text-[10px] font-bold tabular-nums ${
          totalPct === null ? 'text-fg-5' : bgmWinsTotal ? 'text-accent' : 'text-fg-3'
        }`}
      >
        {totalPct !== null ? `${totalPct.toFixed(1)}%` : '—'}
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pt-1">
      {missingPeriods.length > 0 ? (
        <span className="inline-flex items-center gap-2 font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {missingPeriods.join(', ')} OCR unavailable — excluded from totals
        </span>
      ) : null}
      <span className="ml-auto inline-flex items-center gap-2 font-condensed text-[10px] font-bold uppercase tracking-[0.18em] text-fg-5">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            sourceKind === 'ocr' ? 'bg-emerald-400' : 'bg-fg-3'
          }`}
          style={sourceKind === 'ocr' ? { boxShadow: '0 0 6px rgba(16,185,129,0.6)' } : undefined}
        />
        {sourceKind === 'ocr' ? 'OCR-reviewed · post-game' : 'EA · official'}
      </span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function computeTotals(
  rows: MatchPeriodSummaryRow[],
  mode: BoxScoreMode,
): { forVal: number | null; againstVal: number | null; missingPeriods: string[] } {
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
