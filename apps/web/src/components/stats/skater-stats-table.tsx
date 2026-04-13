'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { SkaterStatsRow } from '@eanhl/db/queries'

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColDef {
  key: string
  label: string
  getSortValue: (row: SkaterStatsRow) => number | null
  renderCell: (row: SkaterStatsRow) => string
  sortAsc?: boolean
}

function fmtPct(val: string | null): string {
  return val !== null ? `${val}%` : '—'
}

function fmtToi(seconds: number | null): string {
  if (seconds === null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString()}:${s.toString().padStart(2, '0')}`
}

function fmtSht(goals: number, attempts: number): string {
  if (attempts === 0) return '—'
  return ((goals / attempts) * 100).toFixed(1) + '%'
}

const BASIC: ColDef[] = [
  {
    key: 'gp',
    label: 'GP',
    getSortValue: (r) => r.gamesPlayed,
    renderCell: (r) => r.gamesPlayed.toString(),
  },
  {
    key: 'g',
    label: 'G',
    getSortValue: (r) => r.goals,
    renderCell: (r) => r.goals.toString(),
  },
  {
    key: 'a',
    label: 'A',
    getSortValue: (r) => r.assists,
    renderCell: (r) => r.assists.toString(),
  },
  {
    key: 'pts',
    label: 'PTS',
    getSortValue: (r) => r.points,
    renderCell: (r) => r.points.toString(),
  },
  {
    key: 'pm',
    label: '+/-',
    getSortValue: (r) => r.plusMinus,
    renderCell: (r) => (r.plusMinus > 0 ? `+${r.plusMinus.toString()}` : r.plusMinus.toString()),
  },
  {
    key: 'pim',
    label: 'PIM',
    getSortValue: (r) => r.pim,
    renderCell: (r) => r.pim.toString(),
  },
  {
    key: 'sog',
    label: 'SOG',
    getSortValue: (r) => r.shots,
    renderCell: (r) => r.shots.toString(),
  },
  {
    key: 'ppg',
    label: 'P/GP',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.points / r.gamesPlayed : null),
    renderCell: (r) => (r.gamesPlayed > 0 ? (r.points / r.gamesPlayed).toFixed(2) : '—'),
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
    key: 'sht',
    label: 'SHT%',
    getSortValue: (r) => (r.shotAttempts > 0 ? (r.goals / r.shotAttempts) * 100 : null),
    renderCell: (r) => fmtSht(r.goals, r.shotAttempts),
  },
  {
    key: 'toi',
    label: 'TOI/GP',
    getSortValue: (r) =>
      r.toiSeconds !== null && r.gamesPlayed > 0 ? r.toiSeconds / r.gamesPlayed : null,
    renderCell: (r) =>
      r.toiSeconds !== null && r.gamesPlayed > 0
        ? fmtToi(Math.round(r.toiSeconds / r.gamesPlayed))
        : '—',
  },
  {
    key: 'hits',
    label: 'Hits',
    getSortValue: (r) => r.hits,
    renderCell: (r) => r.hits.toString(),
  },
  {
    key: 'ta',
    label: 'TA',
    getSortValue: (r) => r.takeaways,
    renderCell: (r) => r.takeaways.toString(),
  },
  {
    key: 'gv',
    label: 'GV',
    getSortValue: (r) => r.giveaways,
    renderCell: (r) => r.giveaways.toString(),
  },
  {
    key: 'fo',
    label: 'FO%',
    getSortValue: (r) => (r.faceoffPct !== null ? parseFloat(r.faceoffPct) : null),
    renderCell: (r) => fmtPct(r.faceoffPct),
  },
  {
    key: 'pass',
    label: 'Pass%',
    getSortValue: (r) => (r.passPct !== null ? parseFloat(r.passPct) : null),
    renderCell: (r) => fmtPct(r.passPct),
  },
]

type ViewId = 'basic' | 'advanced'

interface View {
  id: ViewId
  label: string
  cols: ColDef[]
  defaultSort: string
}

const DEFAULT_VIEW: View = { id: 'basic', label: 'Basic', cols: BASIC, defaultSort: 'pts' }

const VIEWS: View[] = [
  DEFAULT_VIEW,
  { id: 'advanced', label: 'Advanced', cols: ADVANCED, defaultSort: 'toi' },
]

// ─── Component ────────────────────────────────────────────────────────────────

interface SkaterStatsTableProps {
  rows: SkaterStatsRow[]
  title: string
}

export function SkaterStatsTable({ rows, title }: SkaterStatsTableProps) {
  const [viewId, setViewId] = useState<ViewId>('basic')
  const [sortKey, setSortKey] = useState<string>('pts')
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
        <h2 className="pl-4 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </h2>
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

      <div className="overflow-x-auto border border-zinc-800 bg-surface">
        <table className="w-full min-w-[520px]">
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
                  No skater data yet.
                </td>
              </tr>
            ) : (
              sorted.map((row, idx) => (
                <SkaterRow key={row.playerId} row={row} cols={view.cols} rank={idx} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface SkaterRowProps {
  row: SkaterStatsRow
  cols: ColDef[]
  rank: number
}

function SkaterRow({ row, cols, rank }: SkaterRowProps) {
  const isTop = rank === 0
  return (
    <tr
      className="border-b border-zinc-800/60 transition-colors hover:bg-surface-raised"
      style={isTop ? { boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
    >
      <td className="max-w-[10rem] truncate py-2.5 pl-4 pr-2">
        <Link
          href={`/roster/${row.playerId.toString()}`}
          className="text-sm font-medium text-zinc-200 transition-colors hover:text-accent"
        >
          {row.gamertag}
        </Link>
      </td>
      {cols.map((col) => {
        const value = col.renderCell(row)
        const isPlusMinus = col.key === 'pm'
        let colorClass = 'text-zinc-300'
        if (isPlusMinus) {
          colorClass =
            row.plusMinus > 0
              ? 'text-emerald-400'
              : row.plusMinus < 0
                ? 'text-rose-400'
                : 'text-zinc-400'
        }
        return (
          <td key={col.key} className={`px-2 py-2.5 text-right text-sm tabular ${colorClass}`}>
            {value}
          </td>
        )
      })}
    </tr>
  )
}
