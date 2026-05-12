'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { GoalieStatsRow, HistoricalGoalieStatsRow } from '@eanhl/db/queries'
import { Panel } from '@/components/ui/panel'
import type { PlayerMeta } from './skater-stats-table'

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColDef {
  key: string
  label: string
  /** Hover-tooltip text shown on the column header. */
  tooltip: string
  getSortValue: (row: ArchiveCompatibleGoalieStatsRow) => number | null
  renderCell: (row: ArchiveCompatibleGoalieStatsRow) => string
  /** When true, smaller value sorts higher when this column is active. */
  sortAsc?: boolean
}

type ArchiveCompatibleGoalieStatsRow = GoalieStatsRow | HistoricalGoalieStatsRow

function fmtInt(val: number | null): string {
  return val !== null ? val.toString() : '—'
}

function fmtPer(numerator: number | null, denominator: number, digits = 1): string {
  if (numerator === null || denominator === 0) return '—'
  return (numerator / denominator).toFixed(digits)
}

function fmtToi(seconds: number | null): string {
  if (seconds === null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0)
    return `${h.toString()}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString()}:${s.toString().padStart(2, '0')}`
}

function fmtToiShort(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString()}:${s.toString().padStart(2, '0')}`
}

function buildPlayerTooltip(meta: PlayerMeta | undefined, gamertag: string): string {
  if (!meta) return gamertag
  const parts: string[] = []
  if (meta.jerseyNumber !== null) parts.push(`#${meta.jerseyNumber.toString()}`)
  const pos = meta.preferredPosition ?? meta.position
  if (pos !== null && pos !== '') parts.push(pos)
  if (meta.lastSeenIso !== null) parts.push(`Last seen ${meta.lastSeenIso}`)
  return parts.length > 0 ? parts.join(' · ') : gamertag
}

// ─── Reusable column factories ────────────────────────────────────────────────

const GP_COL: ColDef = {
  key: 'gp',
  label: 'GP',
  tooltip: 'Games Played as goalie',
  getSortValue: (r) => r.gamesPlayed,
  renderCell: (r) => r.gamesPlayed.toString(),
}

// ─── View definitions ─────────────────────────────────────────────────────────

const BASIC: ColDef[] = [
  GP_COL,
  {
    key: 'w',
    label: 'W',
    tooltip: 'Wins',
    getSortValue: (r) => r.wins,
    renderCell: (r) => fmtInt(r.wins),
  },
  {
    key: 'l',
    label: 'L',
    tooltip: 'Losses',
    sortAsc: true,
    getSortValue: (r) => r.losses,
    renderCell: (r) => fmtInt(r.losses),
  },
  {
    key: 'otl',
    label: 'OTL',
    tooltip: 'Overtime Losses',
    sortAsc: true,
    getSortValue: (r) => r.otl,
    renderCell: (r) => fmtInt(r.otl),
  },
  {
    key: 'svpct',
    label: 'SV%',
    tooltip: 'Save % — saves / (saves + goals against) × 100',
    getSortValue: (r) => (r.savePct !== null ? parseFloat(r.savePct) : null),
    renderCell: (r) => (r.savePct !== null ? `${r.savePct}%` : '—'),
  },
  {
    key: 'gaa',
    label: 'GAA',
    tooltip: 'Goals Against Average per 60 minutes',
    sortAsc: true,
    getSortValue: (r) => (r.gaa !== null ? parseFloat(r.gaa) : null),
    renderCell: (r) => r.gaa ?? '—',
  },
  {
    key: 'so',
    label: 'SO',
    tooltip: 'Shutouts',
    getSortValue: (r) => r.shutouts,
    renderCell: (r) => fmtInt(r.shutouts),
  },
]

const ADVANCED: ColDef[] = [
  GP_COL,
  {
    key: 'sv',
    label: 'SV',
    tooltip: 'Total saves',
    getSortValue: (r) => r.totalSaves,
    renderCell: (r) => fmtInt(r.totalSaves),
  },
  {
    key: 'sa',
    label: 'SA',
    tooltip: 'Total shots against',
    getSortValue: (r) => r.totalShotsAgainst,
    renderCell: (r) => fmtInt(r.totalShotsAgainst),
  },
  {
    key: 'ga',
    label: 'GA',
    tooltip: 'Total goals against',
    sortAsc: true,
    getSortValue: (r) => r.totalGoalsAgainst,
    renderCell: (r) => fmtInt(r.totalGoalsAgainst),
  },
  {
    key: 'svgp',
    label: 'SV/GP',
    tooltip: 'Saves per game',
    getSortValue: (r) => (r.totalSaves !== null ? r.totalSaves / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.totalSaves, r.gamesPlayed),
  },
  {
    key: 'sagp',
    label: 'SA/GP',
    tooltip: 'Shots against per game',
    getSortValue: (r) =>
      r.totalShotsAgainst !== null ? r.totalShotsAgainst / r.gamesPlayed : null,
    renderCell: (r) => fmtPer(r.totalShotsAgainst, r.gamesPlayed),
  },
  {
    key: 'toi',
    label: 'TOI',
    tooltip: 'Total time in net (h:mm:ss)',
    getSortValue: (r) => r.toiSeconds,
    renderCell: (r) => fmtToi(r.toiSeconds),
  },
]

const WORKLOAD: ColDef[] = [
  GP_COL,
  {
    key: 'toi',
    label: 'TOI',
    tooltip: 'Total time in net (h:mm:ss)',
    getSortValue: (r) => r.toiSeconds,
    renderCell: (r) => fmtToi(r.toiSeconds),
  },
  {
    key: 'toi_gp',
    label: 'TOI/GP',
    tooltip: 'Average minutes in net per appearance',
    getSortValue: (r) =>
      r.toiSeconds !== null && r.gamesPlayed > 0 ? r.toiSeconds / r.gamesPlayed : null,
    renderCell: (r) =>
      r.toiSeconds !== null && r.gamesPlayed > 0
        ? fmtToiShort(Math.round(r.toiSeconds / r.gamesPlayed))
        : '—',
  },
  {
    key: 'sagp',
    label: 'SA/GP',
    tooltip: 'Shots against per game (workload pressure)',
    getSortValue: (r) =>
      r.totalShotsAgainst !== null ? r.totalShotsAgainst / r.gamesPlayed : null,
    renderCell: (r) => fmtPer(r.totalShotsAgainst, r.gamesPlayed),
  },
  {
    key: 'svgp',
    label: 'SV/GP',
    tooltip: 'Saves per game',
    getSortValue: (r) => (r.totalSaves !== null ? r.totalSaves / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.totalSaves, r.gamesPlayed),
  },
  {
    key: 'so',
    label: 'SO',
    tooltip: 'Shutouts',
    getSortValue: (r) => r.shutouts,
    renderCell: (r) => fmtInt(r.shutouts),
  },
]

type ViewId = 'basic' | 'advanced' | 'workload'

interface View {
  id: ViewId
  label: string
  cols: ColDef[]
  defaultSort: string
}

const DEFAULT_VIEW: View = { id: 'basic', label: 'Basic', cols: BASIC, defaultSort: 'svpct' }

const VIEWS: View[] = [
  DEFAULT_VIEW,
  { id: 'advanced', label: 'Advanced', cols: ADVANCED, defaultSort: 'sv' },
  { id: 'workload', label: 'Workload', cols: WORKLOAD, defaultSort: 'toi' },
]

// ─── Component ────────────────────────────────────────────────────────────────

type ScopeId = 'current' | 'allTime'

interface GoalieStatsTableProps {
  rows: ArchiveCompatibleGoalieStatsRow[]
  title: string
  subtitle?: string
  allTimeRows?: ArchiveCompatibleGoalieStatsRow[]
  allTimeSubtitle?: string
  /** Per-player metadata keyed by playerId. Drives row tooltips on the gamertag column. */
  playerMeta?: Record<number, PlayerMeta>
}

export function GoalieStatsTable({
  rows,
  title,
  subtitle,
  allTimeRows,
  allTimeSubtitle,
  playerMeta,
}: GoalieStatsTableProps) {
  const [viewId, setViewId] = useState<ViewId>('basic')
  const [sortKey, setSortKey] = useState<string>('svpct')
  const [sortAscOverride, setSortAscOverride] = useState<boolean | null>(null)
  const [scopeId, setScopeId] = useState<ScopeId>('current')

  const hasAllTime = allTimeRows !== undefined && allTimeRows.length > 0
  const activeRows = scopeId === 'allTime' && hasAllTime ? allTimeRows : rows
  const activeSubtitle = scopeId === 'allTime' && hasAllTime ? allTimeSubtitle : subtitle

  const view = VIEWS.find((v) => v.id === viewId) ?? DEFAULT_VIEW

  function handleViewChange(v: View) {
    setViewId(v.id)
    setSortKey(v.defaultSort)
    setSortAscOverride(null)
  }

  function handleSort(col: ColDef) {
    if (sortKey === col.key) {
      const defaultAsc = col.sortAsc ?? false
      setSortAscOverride((prev) => !(prev ?? defaultAsc))
    } else {
      setSortKey(col.key)
      setSortAscOverride(null)
    }
  }

  const activeCol = view.cols.find((c) => c.key === sortKey)
  const isAsc = sortAscOverride ?? activeCol?.sortAsc ?? false

  const sorted = activeRows.slice().sort((a, b) => {
    if (!activeCol) return 0
    const av = activeCol.getSortValue(a)
    const bv = activeCol.getSortValue(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return isAsc ? av - bv : bv - av
  })

  return (
    <div>
      {/* Section title + scope (Current / All Time) + view toggles. Heavier
          treatment (▌ accent bar + bold zinc-100) so this table label can't
          be confused with the skater label sitting in the same module frame. */}
      <div className="mb-px flex flex-wrap items-center justify-between gap-y-1 border-b border-zinc-800">
        <div className="flex flex-col gap-0.5 pl-4 py-2">
          <h3 className="flex items-center gap-2 font-condensed text-base sm:text-lg font-black uppercase tracking-[0.18em] text-zinc-50">
            <span className="text-accent" aria-hidden>
              ▌
            </span>
            {title}
          </h3>
          {activeSubtitle !== undefined && (
            <p className="font-condensed text-[11px] uppercase tracking-wider text-zinc-600">
              {activeSubtitle}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-stretch">
          {hasAllTime && (
            <div className="flex border-r border-zinc-800/80">
              {(['current', 'allTime'] as const).map((s) => {
                const isActive = s === scopeId
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setScopeId(s)
                    }}
                    className={[
                      'px-3 py-2.5 font-condensed text-xs font-semibold uppercase tracking-widest transition-colors',
                      'border-b-2 -mb-px',
                      isActive
                        ? 'border-accent text-accent'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300',
                    ].join(' ')}
                  >
                    {s === 'current' ? 'Current' : 'All Time'}
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex flex-wrap">
            {VIEWS.map((v) => {
              const isActive = v.id === viewId
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    handleViewChange(v)
                  }}
                  className={[
                    'px-3 py-2.5 font-condensed text-xs font-semibold uppercase tracking-widest transition-colors',
                    'border-b-2 -mb-px',
                    isActive
                      ? 'border-accent text-accent'
                      : 'border-transparent text-zinc-500 hover:text-zinc-300',
                  ].join(' ')}
                >
                  {v.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-zinc-800 bg-surface-raised">
              <th className="sticky left-0 z-10 bg-surface-raised py-2 pl-4 pr-2 text-left font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Player
              </th>
              {view.cols.map((col) => {
                const isActive = col.key === sortKey
                return (
                  <th
                    key={col.key}
                    title={col.tooltip}
                    className={[
                      'cursor-pointer select-none px-2 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest transition-colors',
                      isActive ? 'text-zinc-200' : 'text-zinc-500 hover:text-zinc-300',
                    ].join(' ')}
                    onClick={() => {
                      handleSort(col)
                    }}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      {col.label}
                      {isActive && (
                        <span className="text-[10px] text-accent">{isAsc ? '↑' : '↓'}</span>
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={view.cols.length + 1}
                  className="py-10 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500"
                >
                  No goalie data yet.
                </td>
              </tr>
            ) : (
              sorted.map((row, idx) => (
                <GoalieRow
                  key={row.playerId !== null ? `p${row.playerId.toString()}` : `g${row.gamertag}`}
                  row={row}
                  cols={view.cols}
                  rank={idx}
                  meta={
                    row.playerId !== null && playerMeta ? playerMeta[row.playerId] : undefined
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface GoalieRowProps {
  row: ArchiveCompatibleGoalieStatsRow
  cols: ColDef[]
  rank: number
  meta: PlayerMeta | undefined
}

function GoalieRow({ row, cols, rank, meta }: GoalieRowProps) {
  const stripe = rank >= 3 && rank % 2 === 1 ? 'bg-zinc-900/30' : ''
  const tooltip = buildPlayerTooltip(meta, row.gamertag)
  return (
    <tr
      className={[
        'border-b border-zinc-800/40 transition-colors hover:bg-surface-raised',
        stripe,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        rank === 0
          ? { boxShadow: 'inset 2px 0 0 var(--color-accent)' }
          : rank === 1
            ? { boxShadow: 'inset 2px 0 0 rgba(232, 65, 49, 0.55)' }
            : rank === 2
              ? { boxShadow: 'inset 2px 0 0 rgba(232, 65, 49, 0.30)' }
              : undefined
      }
    >
      <td className="sticky left-0 z-[1] max-w-[10rem] truncate bg-inherit py-2.5 pl-4 pr-2">
        {row.playerId !== null ? (
          <Link
            href={`/roster/${row.playerId.toString()}`}
            title={tooltip}
            className="font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
          >
            {row.gamertag}
          </Link>
        ) : (
          <span
            title="Unmatched gamertag — no current player profile"
            className="font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-400"
          >
            {row.gamertag}
          </span>
        )}
      </td>
      {cols.map((col) => (
        <td
          key={col.key}
          className="px-2 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300"
        >
          {col.renderCell(row)}
        </td>
      ))}
    </tr>
  )
}
