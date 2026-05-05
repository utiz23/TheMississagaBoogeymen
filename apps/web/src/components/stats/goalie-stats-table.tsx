'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { GoalieStatsRow, HistoricalGoalieStatsRow } from '@eanhl/db/queries'

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColDef {
  key: string
  label: string
  getSortValue: (row: ArchiveCompatibleGoalieStatsRow) => number | null
  renderCell: (row: ArchiveCompatibleGoalieStatsRow) => string
  sortAsc?: boolean
}

type ArchiveCompatibleGoalieStatsRow = GoalieStatsRow | HistoricalGoalieStatsRow

function fmtInt(val: number | null): string {
  return val !== null ? val.toString() : '—'
}

function fmtPer(numerator: number | null, denominator: number): string {
  if (numerator === null || denominator === 0) return '—'
  return (numerator / denominator).toFixed(1)
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

const BASIC: ColDef[] = [
  {
    key: 'gp',
    label: 'GP',
    getSortValue: (r) => r.gamesPlayed,
    renderCell: (r) => r.gamesPlayed.toString(),
  },
  {
    key: 'w',
    label: 'W',
    getSortValue: (r) => r.wins,
    renderCell: (r) => fmtInt(r.wins),
  },
  {
    key: 'l',
    label: 'L',
    getSortValue: (r) => r.losses,
    renderCell: (r) => fmtInt(r.losses),
  },
  {
    key: 'otl',
    label: 'OTL',
    getSortValue: (r) => r.otl,
    renderCell: (r) => fmtInt(r.otl),
  },
  {
    key: 'svpct',
    label: 'SV%',
    getSortValue: (r) => (r.savePct !== null ? parseFloat(r.savePct) : null),
    renderCell: (r) => (r.savePct !== null ? `${r.savePct}%` : '—'),
  },
  {
    key: 'gaa',
    label: 'GAA',
    sortAsc: true,
    getSortValue: (r) => (r.gaa !== null ? parseFloat(r.gaa) : null),
    renderCell: (r) => r.gaa ?? '—',
  },
  {
    key: 'so',
    label: 'SO',
    getSortValue: (r) => r.shutouts,
    renderCell: (r) => fmtInt(r.shutouts),
  },
]

const ADVANCED: ColDef[] = [
  {
    key: 'gp',
    label: 'GP',
    getSortValue: (r) => r.gamesPlayed,
    renderCell: (r) => r.gamesPlayed.toString(),
  },
  {
    key: 'sv',
    label: 'SV',
    getSortValue: (r) => r.totalSaves,
    renderCell: (r) => fmtInt(r.totalSaves),
  },
  {
    key: 'sa',
    label: 'SA',
    getSortValue: (r) => r.totalShotsAgainst,
    renderCell: (r) => fmtInt(r.totalShotsAgainst),
  },
  {
    key: 'ga',
    label: 'GA',
    sortAsc: true,
    getSortValue: (r) => r.totalGoalsAgainst,
    renderCell: (r) => fmtInt(r.totalGoalsAgainst),
  },
  {
    key: 'svgp',
    label: 'SV/GP',
    getSortValue: (r) => (r.totalSaves !== null ? r.totalSaves / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.totalSaves, r.gamesPlayed),
  },
  {
    key: 'sagp',
    label: 'SA/GP',
    getSortValue: (r) =>
      r.totalShotsAgainst !== null ? r.totalShotsAgainst / r.gamesPlayed : null,
    renderCell: (r) => fmtPer(r.totalShotsAgainst, r.gamesPlayed),
  },
  {
    key: 'toi',
    label: 'TOI',
    getSortValue: (r) => r.toiSeconds,
    renderCell: (r) => fmtToi(r.toiSeconds),
  },
]

type ViewId = 'basic' | 'advanced'

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
]

// ─── Component ────────────────────────────────────────────────────────────────

interface GoalieStatsTableProps {
  rows: ArchiveCompatibleGoalieStatsRow[]
  title: string
  subtitle?: string
}

export function GoalieStatsTable({ rows, title, subtitle }: GoalieStatsTableProps) {
  const [viewId, setViewId] = useState<ViewId>('basic')
  const [sortKey, setSortKey] = useState<string>('svpct')
  const [sortAscOverride, setSortAscOverride] = useState<boolean | null>(null)

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

  const sorted = rows.slice().sort((a, b) => {
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
      {/* Section title + Basic / Advanced toggle in one row */}
      <div className="mb-px flex items-center justify-between border-b border-zinc-800">
        <div className="flex flex-col pl-4">
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            {title}
          </h2>
          {subtitle && <p className="text-[11px] text-zinc-600">{subtitle}</p>}
        </div>
        <div className="flex">
          {VIEWS.map((v) => {
            const isActive = v.id === viewId
            return (
              <button
                key={v.id}
                onClick={() => {
                  handleViewChange(v)
                }}
                className={[
                  'px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors',
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

      <div className="broadcast-panel overflow-x-auto">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-zinc-800 bg-surface-raised">
              <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Player
              </th>
              {view.cols.map((col) => {
                const isActive = col.key === sortKey
                return (
                  <th
                    key={col.key}
                    className={[
                      'cursor-pointer select-none px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider transition-colors',
                      isActive ? 'text-zinc-300' : 'text-zinc-600 hover:text-zinc-400',
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
                  className="py-10 text-center text-sm text-zinc-500"
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
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface GoalieRowProps {
  row: ArchiveCompatibleGoalieStatsRow
  cols: ColDef[]
  rank: number
}

function GoalieRow({ row, cols, rank }: GoalieRowProps) {
  const isTop = rank === 0
  return (
    <tr
      className="border-b border-zinc-800/60 transition-colors hover:bg-surface-raised"
      style={isTop ? { boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
    >
      <td className="max-w-[10rem] truncate py-2.5 pl-4 pr-2">
        {row.playerId !== null ? (
          <Link
            href={`/roster/${row.playerId.toString()}`}
            className="text-sm font-medium text-zinc-200 transition-colors hover:text-accent"
          >
            {row.gamertag}
          </Link>
        ) : (
          <span
            title="Unmatched gamertag — no current player profile"
            className="text-sm font-medium text-zinc-400"
          >
            {row.gamertag}
          </span>
        )}
      </td>
      {cols.map((col) => (
        <td key={col.key} className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
          {col.renderCell(row)}
        </td>
      ))}
    </tr>
  )
}
