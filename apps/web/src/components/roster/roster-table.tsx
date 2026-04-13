'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { getRoster } from '@eanhl/db/queries'

type RosterRow = Awaited<ReturnType<typeof getRoster>>[number]

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColDef {
  key: string
  label: string
  /** Extract a sortable number from the row. null = sort to bottom. */
  getSortValue: (row: RosterRow) => number | null
  /** Render cell content. */
  renderCell: (row: RosterRow) => string
  /** When true, lower sort value ranks higher (e.g. GAA). */
  sortAsc?: boolean
}

function numStr(val: string | null): string {
  return val ?? '—'
}

const SCORING: ColDef[] = [
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
    key: 'sog',
    label: 'SOG',
    getSortValue: (r) => r.shots,
    renderCell: (r) => r.shots.toString(),
  },
]

const POSSESSION: ColDef[] = [
  {
    key: 'gp',
    label: 'GP',
    getSortValue: (r) => r.gamesPlayed,
    renderCell: (r) => r.gamesPlayed.toString(),
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
    renderCell: (r) => (r.faceoffPct !== null ? `${r.faceoffPct}%` : '—'),
  },
  {
    key: 'pass',
    label: 'Pass%',
    getSortValue: (r) => (r.passPct !== null ? parseFloat(r.passPct) : null),
    renderCell: (r) => (r.passPct !== null ? `${r.passPct}%` : '—'),
  },
]

const PHYSICAL: ColDef[] = [
  {
    key: 'gp',
    label: 'GP',
    getSortValue: (r) => r.gamesPlayed,
    renderCell: (r) => r.gamesPlayed.toString(),
  },
  {
    key: 'hits',
    label: 'Hits',
    getSortValue: (r) => r.hits,
    renderCell: (r) => r.hits.toString(),
  },
  {
    key: 'pim',
    label: 'PIM',
    getSortValue: (r) => r.pim,
    renderCell: (r) => r.pim.toString(),
  },
]

const GOALIE: ColDef[] = [
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
    renderCell: (r) => numStr(r.wins !== null ? r.wins.toString() : null),
  },
  {
    key: 'l',
    label: 'L',
    getSortValue: (r) => r.losses,
    renderCell: (r) => numStr(r.losses !== null ? r.losses.toString() : null),
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
    renderCell: (r) => numStr(r.gaa),
  },
  {
    key: 'so',
    label: 'SO',
    getSortValue: (r) => r.shutouts,
    renderCell: (r) => numStr(r.shutouts !== null ? r.shutouts.toString() : null),
  },
]

type TabId = 'scoring' | 'possession' | 'physical' | 'goalie'

interface Tab {
  id: TabId
  label: string
  cols: ColDef[]
  defaultSort: string
  filterGoalie?: boolean
}

const DEFAULT_TAB: Tab = { id: 'scoring', label: 'Scoring', cols: SCORING, defaultSort: 'pts' }

const TABS: Tab[] = [
  DEFAULT_TAB,
  { id: 'possession', label: 'Possession', cols: POSSESSION, defaultSort: 'ta' },
  { id: 'physical', label: 'Physical', cols: PHYSICAL, defaultSort: 'hits' },
  { id: 'goalie', label: 'Goalie', cols: GOALIE, defaultSort: 'svpct', filterGoalie: true },
]

// ─── Component ────────────────────────────────────────────────────────────────

interface RosterTableProps {
  rows: RosterRow[]
}

export function RosterTable({ rows }: RosterTableProps) {
  const [activeTabId, setActiveTabId] = useState<TabId>('scoring')
  const [sortKey, setSortKey] = useState<string>('pts')
  const [sortAscOverride, setSortAscOverride] = useState<boolean | null>(null)

  const activeTab = TABS.find((t) => t.id === activeTabId) ?? DEFAULT_TAB

  function handleTabChange(tab: Tab) {
    setActiveTabId(tab.id)
    setSortKey(tab.defaultSort)
    setSortAscOverride(null)
  }

  function handleSort(col: ColDef) {
    if (sortKey === col.key) {
      // Toggle direction
      const defaultAsc = col.sortAsc ?? false
      setSortAscOverride((prev) => !(prev ?? defaultAsc))
    } else {
      setSortKey(col.key)
      setSortAscOverride(null)
    }
  }

  const activeCol = activeTab.cols.find((c) => c.key === sortKey)
  const isAsc = sortAscOverride ?? activeCol?.sortAsc ?? false

  const displayRows = (activeTab.filterGoalie ? rows.filter((r) => r.wins !== null) : rows).slice()

  displayRows.sort((a, b) => {
    if (!activeCol) return 0
    const av = activeCol.getSortValue(a)
    const bv = activeCol.getSortValue(b)
    // Null values always go to the bottom regardless of sort direction
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const diff = isAsc ? av - bv : bv - av
    return diff
  })

  return (
    <div>
      {/* Tab bar — overflow-x-auto prevents clipping on small screens */}
      <div className="mb-px flex gap-0 overflow-x-auto border-b border-zinc-800">
        {TABS.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <button
              key={tab.id}
              onClick={() => {
                handleTabChange(tab)
              }}
              className={[
                'px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                'border-b-2 -mb-px',
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-zinc-800 bg-surface">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Player
              </th>
              {activeTab.cols.map((col) => {
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
            {displayRows.length === 0 ? (
              <tr>
                <td
                  colSpan={activeTab.cols.length + 1}
                  className="py-10 text-center text-sm text-zinc-500"
                >
                  No data yet.
                </td>
              </tr>
            ) : (
              displayRows.map((row, idx) => (
                <RosterRow key={row.playerId} row={row} cols={activeTab.cols} rank={idx} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface RosterRowProps {
  row: RosterRow
  cols: ColDef[]
  rank: number
}

function RosterRow({ row, cols, rank }: RosterRowProps) {
  const isTop = rank === 0
  return (
    <tr
      className="border-b border-zinc-800/60 hover:bg-surface-raised transition-colors group"
      style={isTop ? { boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
    >
      <td className="py-2.5 pl-4 pr-2 max-w-[10rem] truncate">
        <Link
          href={`/roster/${row.playerId.toString()}`}
          className="text-sm font-medium text-zinc-200 hover:text-accent transition-colors"
        >
          {row.gamertag}
        </Link>
      </td>
      {cols.map((col) => {
        const value = col.renderCell(row)
        const isPlusMinus = col.key === 'pm'
        let colorClass = 'text-zinc-300'
        if (isPlusMinus) {
          const num = row.plusMinus
          colorClass = num > 0 ? 'text-emerald-400' : num < 0 ? 'text-rose-400' : 'text-zinc-400'
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
