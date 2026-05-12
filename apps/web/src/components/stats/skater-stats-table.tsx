'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { HistoricalSkaterStatsRow, SkaterStatsRow } from '@eanhl/db/queries'
import { Panel } from '@/components/ui/panel'

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColDef {
  key: string
  label: string
  /** Hover-tooltip text shown on the column header (HTML title attribute). */
  tooltip: string
  getSortValue: (row: ArchiveCompatibleSkaterStatsRow) => number | null
  renderCell: (row: ArchiveCompatibleSkaterStatsRow) => string
  /** When true, smaller value sorts higher when this column is active. */
  sortAsc?: boolean
}

type ArchiveCompatibleSkaterStatsRow = SkaterStatsRow | HistoricalSkaterStatsRow

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

function fmtPer(num: number, gp: number, digits = 2): string {
  if (gp <= 0) return '—'
  return (num / gp).toFixed(digits)
}

function fmtSigned(n: number): string {
  return n > 0 ? `+${n.toString()}` : n.toString()
}

// ─── Reusable column factories ────────────────────────────────────────────────

const GP_COL: ColDef = {
  key: 'gp',
  label: 'GP',
  tooltip: 'Games Played',
  getSortValue: (r) => r.gamesPlayed,
  renderCell: (r) => r.gamesPlayed.toString(),
}

const TOI_PG_COL: ColDef = {
  key: 'toi',
  label: 'TOI/GP',
  tooltip: 'Average Time On Ice per Game (mm:ss)',
  getSortValue: (r) =>
    r.toiSeconds !== null && r.gamesPlayed > 0 ? r.toiSeconds / r.gamesPlayed : null,
  renderCell: (r) =>
    r.toiSeconds !== null && r.gamesPlayed > 0
      ? fmtToi(Math.round(r.toiSeconds / r.gamesPlayed))
      : '—',
}

const SHT_PCT_COL: ColDef = {
  key: 'sht',
  label: 'SHT%',
  tooltip: 'Shooting % — goals divided by shot attempts × 100',
  getSortValue: (r) => (r.shotAttempts > 0 ? (r.goals / r.shotAttempts) * 100 : null),
  renderCell: (r) => fmtSht(r.goals, r.shotAttempts),
}

// ─── View definitions ─────────────────────────────────────────────────────────

const BASIC: ColDef[] = [
  GP_COL,
  {
    key: 'g',
    label: 'G',
    tooltip: 'Goals',
    getSortValue: (r) => r.goals,
    renderCell: (r) => r.goals.toString(),
  },
  {
    key: 'a',
    label: 'A',
    tooltip: 'Assists',
    getSortValue: (r) => r.assists,
    renderCell: (r) => r.assists.toString(),
  },
  {
    key: 'pts',
    label: 'PTS',
    tooltip: 'Points (goals + assists)',
    getSortValue: (r) => r.points,
    renderCell: (r) => r.points.toString(),
  },
  {
    key: 'pm',
    label: '+/-',
    tooltip: 'Plus / Minus — goal differential while on ice',
    getSortValue: (r) => r.plusMinus,
    renderCell: (r) => fmtSigned(r.plusMinus),
  },
  {
    key: 'pim',
    label: 'PIM',
    tooltip: 'Penalty Minutes',
    getSortValue: (r) => r.pim,
    renderCell: (r) => r.pim.toString(),
  },
  {
    key: 'sog',
    label: 'SOG',
    tooltip: 'Shots On Goal',
    getSortValue: (r) => r.shots,
    renderCell: (r) => r.shots.toString(),
  },
  {
    key: 'ppg',
    label: 'P/GP',
    tooltip: 'Points per Game (points / games played)',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.points / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.points, r.gamesPlayed),
  },
]

const ADVANCED: ColDef[] = [
  GP_COL,
  SHT_PCT_COL,
  TOI_PG_COL,
  {
    key: 'hits',
    label: 'Hits',
    tooltip: 'Body checks delivered',
    getSortValue: (r) => r.hits,
    renderCell: (r) => r.hits.toString(),
  },
  {
    key: 'ta',
    label: 'TA',
    tooltip: 'Takeaways — possessions stripped from the opponent',
    getSortValue: (r) => r.takeaways,
    renderCell: (r) => r.takeaways.toString(),
  },
  {
    key: 'gv',
    label: 'GV',
    tooltip: 'Giveaways — possessions surrendered to the opponent',
    getSortValue: (r) => r.giveaways,
    renderCell: (r) => r.giveaways.toString(),
  },
  {
    key: 'fo',
    label: 'FO%',
    tooltip: 'Faceoff Win % — wins / (wins + losses)',
    getSortValue: (r) => (r.faceoffPct !== null ? parseFloat(r.faceoffPct) : null),
    renderCell: (r) => fmtPct(r.faceoffPct),
  },
  {
    key: 'pass',
    label: 'Pass%',
    tooltip: 'Pass completion % — completed / attempted',
    getSortValue: (r) => (r.passPct !== null ? parseFloat(r.passPct) : null),
    renderCell: (r) => fmtPct(r.passPct),
  },
]

const POSSESSION: ColDef[] = [
  GP_COL,
  {
    key: 'sog',
    label: 'SOG',
    tooltip: 'Shots On Goal',
    getSortValue: (r) => r.shots,
    renderCell: (r) => r.shots.toString(),
  },
  {
    key: 'sog_gp',
    label: 'SOG/GP',
    tooltip: 'Shots on goal per game',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.shots / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.shots, r.gamesPlayed),
  },
  SHT_PCT_COL,
  {
    key: 'pass',
    label: 'Pass%',
    tooltip: 'Pass completion %',
    getSortValue: (r) => (r.passPct !== null ? parseFloat(r.passPct) : null),
    renderCell: (r) => fmtPct(r.passPct),
  },
  {
    key: 'fo',
    label: 'FO%',
    tooltip: 'Faceoff Win %',
    getSortValue: (r) => (r.faceoffPct !== null ? parseFloat(r.faceoffPct) : null),
    renderCell: (r) => fmtPct(r.faceoffPct),
  },
  TOI_PG_COL,
]

const DEFENSE: ColDef[] = [
  GP_COL,
  {
    key: 'hits',
    label: 'Hits',
    tooltip: 'Body checks delivered',
    getSortValue: (r) => r.hits,
    renderCell: (r) => r.hits.toString(),
  },
  {
    key: 'hits_gp',
    label: 'Hits/GP',
    tooltip: 'Hits per game',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.hits / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.hits, r.gamesPlayed),
  },
  {
    key: 'ta',
    label: 'TA',
    tooltip: 'Takeaways',
    getSortValue: (r) => r.takeaways,
    renderCell: (r) => r.takeaways.toString(),
  },
  {
    key: 'ta_gp',
    label: 'TA/GP',
    tooltip: 'Takeaways per game',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.takeaways / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.takeaways, r.gamesPlayed),
  },
  {
    key: 'gv',
    label: 'GV',
    tooltip: 'Giveaways',
    getSortValue: (r) => r.giveaways,
    renderCell: (r) => r.giveaways.toString(),
  },
  {
    key: 'pm',
    label: '+/-',
    tooltip: 'Plus / Minus',
    getSortValue: (r) => r.plusMinus,
    renderCell: (r) => fmtSigned(r.plusMinus),
  },
]

const DISCIPLINE: ColDef[] = [
  GP_COL,
  {
    key: 'pim',
    label: 'PIM',
    tooltip: 'Penalty Minutes',
    sortAsc: true,
    getSortValue: (r) => r.pim,
    renderCell: (r) => r.pim.toString(),
  },
  {
    key: 'pim_gp',
    label: 'PIM/GP',
    tooltip: 'Penalty minutes per game',
    sortAsc: true,
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.pim / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.pim, r.gamesPlayed),
  },
  {
    key: 'gv',
    label: 'GV',
    tooltip: 'Giveaways',
    sortAsc: true,
    getSortValue: (r) => r.giveaways,
    renderCell: (r) => r.giveaways.toString(),
  },
  {
    key: 'gv_gp',
    label: 'GV/GP',
    tooltip: 'Giveaways per game',
    sortAsc: true,
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.giveaways / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.giveaways, r.gamesPlayed),
  },
  {
    key: 'ta_gv',
    label: 'TA:GV',
    tooltip: 'Takeaway-to-giveaway ratio (higher is better)',
    getSortValue: (r) => (r.giveaways > 0 ? r.takeaways / r.giveaways : null),
    renderCell: (r) => (r.giveaways > 0 ? (r.takeaways / r.giveaways).toFixed(2) : '—'),
  },
  {
    key: 'pm',
    label: '+/-',
    tooltip: 'Plus / Minus',
    getSortValue: (r) => r.plusMinus,
    renderCell: (r) => fmtSigned(r.plusMinus),
  },
]

const PRODUCTION: ColDef[] = [
  GP_COL,
  {
    key: 'g_gp',
    label: 'G/GP',
    tooltip: 'Goals per game',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.goals / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.goals, r.gamesPlayed),
  },
  {
    key: 'a_gp',
    label: 'A/GP',
    tooltip: 'Assists per game',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.assists / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.assists, r.gamesPlayed),
  },
  {
    key: 'pts_gp',
    label: 'PTS/GP',
    tooltip: 'Points per game',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.points / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.points, r.gamesPlayed),
  },
  SHT_PCT_COL,
  {
    key: 'sog_gp',
    label: 'SOG/GP',
    tooltip: 'Shots on goal per game',
    getSortValue: (r) => (r.gamesPlayed > 0 ? r.shots / r.gamesPlayed : null),
    renderCell: (r) => fmtPer(r.shots, r.gamesPlayed),
  },
  TOI_PG_COL,
]

type ViewId = 'basic' | 'advanced' | 'possession' | 'defense' | 'discipline' | 'production'

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
  { id: 'possession', label: 'Possession', cols: POSSESSION, defaultSort: 'sog' },
  { id: 'defense', label: 'Defense', cols: DEFENSE, defaultSort: 'hits' },
  { id: 'discipline', label: 'Discipline', cols: DISCIPLINE, defaultSort: 'pim' },
  { id: 'production', label: 'Rates', cols: PRODUCTION, defaultSort: 'pts_gp' },
]

// ─── Player metadata for row tooltips ─────────────────────────────────────────

export interface PlayerMeta {
  jerseyNumber: number | null
  preferredPosition: string | null
  position: string | null
  lastSeenIso: string | null
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

// ─── Component ────────────────────────────────────────────────────────────────

type ScopeId = 'current' | 'allTime'

interface SkaterStatsTableProps {
  rows: ArchiveCompatibleSkaterStatsRow[]
  title: string
  subtitle?: string
  allTimeRows?: ArchiveCompatibleSkaterStatsRow[]
  allTimeSubtitle?: string
  /** Per-player metadata keyed by playerId. Drives row tooltips on the gamertag column. */
  playerMeta?: Record<number, PlayerMeta>
}

export function SkaterStatsTable({
  rows,
  title,
  subtitle,
  allTimeRows,
  allTimeSubtitle,
  playerMeta,
}: SkaterStatsTableProps) {
  const [viewId, setViewId] = useState<ViewId>('basic')
  const [sortKey, setSortKey] = useState<string>('pts')
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
      {/* Section title + scope (Current / All Time) + view toggles. Title is
          rendered with a heavier accent treatment (▌ accent bar + bold zinc-100
          text) so the table label is unmistakable when this component is
          stacked with sibling tables in the same module-frame container. */}
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
        <table className="w-full min-w-[520px]">
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
                  No skater data yet.
                </td>
              </tr>
            ) : (
              sorted.map((row, idx) => (
                <SkaterRow
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

interface SkaterRowProps {
  row: ArchiveCompatibleSkaterStatsRow
  cols: ColDef[]
  rank: number
  meta: PlayerMeta | undefined
}

function SkaterRow({ row, cols, rank, meta }: SkaterRowProps) {
  // Top-3 leader band: brightest accent on rank 0, fading down to rank 2.
  const leaderClass =
    rank === 0 ? 'rl-rank-1' : rank === 1 ? 'rl-rank-2' : rank === 2 ? 'rl-rank-3' : ''
  // Zebra stripe for visual separation past the leader band.
  const stripe = rank >= 3 && rank % 2 === 1 ? 'bg-zinc-900/30' : ''
  const tooltip = buildPlayerTooltip(meta, row.gamertag)
  return (
    <tr
      className={[
        'border-b border-zinc-800/40 transition-colors hover:bg-surface-raised',
        stripe,
        leaderClass,
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
          <td
            key={col.key}
            className={`px-2 py-2.5 text-right font-condensed text-sm tabular-nums ${colorClass}`}
          >
            {value}
          </td>
        )
      })}
    </tr>
  )
}
