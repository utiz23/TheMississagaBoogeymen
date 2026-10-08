'use client'

import { useMemo } from 'react'
import type { EASkaterExpandedRow } from '@eanhl/db/queries'
import { SKATER_METRICS } from './stats-table/skater-metrics.ts'
import { toSkaterDisplayRow, type SkaterInputRow } from './stats-table/row-adapters.ts'
import { positionSubsets, type PositionData } from './stats-table/position-adapters.ts'
import { StatsTableShell } from './stats-table/stats-table-shell.tsx'
import type { PlayerMeta } from './stats-table/player-label.ts'
import type { StatsSource } from './stats-table/types.ts'
import { SKATER_VIEWS } from './stats-table/views.ts'

export type { PlayerMeta }

interface SkaterStatsTableProps {
  rows: SkaterInputRow[]
  title: string
  /** Legacy free-text source line; superseded by `source` when given. */
  subtitle?: string
  allTimeRows?: SkaterInputRow[]
  allTimeSubtitle?: string
  /** Per-player metadata keyed by playerId: jersey/position line and row tooltip. */
  playerMeta?: Record<number, PlayerMeta>
  source?: StatsSource
  allTimeSource?: StatsSource
  /** EA-only expanded stats keyed by playerId (Active title + All mode). */
  expanded?: Record<number, EASkaterExpandedRow>
  /** The expanded query failed: base stats render with a notice. */
  expandedFailed?: boolean
  /** The rows query failed: render an error, never an empty/zero table. */
  state?: 'ok' | 'error'
  /** The All Time query failed: toggle shown disabled. */
  allTimeUnavailable?: boolean
  emptyMessage?: string
  /** Per-position rows: adds the Position pills (All · C · LW · RW · W · D). */
  positions?: PositionData
}

export function SkaterStatsTable(props: SkaterStatsTableProps) {
  const { rows, allTimeRows, expanded, positions } = props

  const expandedById = useMemo(
    () =>
      expanded === undefined
        ? undefined
        : new Map(Object.entries(expanded).map(([id, v]) => [Number(id), v] as const)),
    [expanded],
  )
  const hasExpanded = expandedById !== undefined && expandedById.size > 0

  const currentRows = useMemo(
    () => rows.map((r) => toSkaterDisplayRow(r, expandedById)),
    [rows, expandedById],
  )
  const allTime = useMemo(
    () =>
      allTimeRows !== undefined && allTimeRows.length > 0
        ? allTimeRows.map((r) => toSkaterDisplayRow(r))
        : undefined,
    [allTimeRows],
  )

  const subsets = useMemo(
    () => (positions === undefined ? undefined : positionSubsets(positions)),
    [positions],
  )

  return (
    <StatsTableShell
      role="skaters"
      title={props.title}
      metrics={SKATER_METRICS}
      views={SKATER_VIEWS}
      current={{
        rows: currentRows,
        hasExpanded,
        source: props.source ?? { kind: 'unspecified', label: props.subtitle ?? '' },
      }}
      {...(allTime !== undefined
        ? {
            allTime: {
              rows: allTime,
              hasExpanded: false,
              source: props.allTimeSource ?? {
                kind: 'career',
                label: props.allTimeSubtitle ?? 'Career totals · all clubs',
              },
            },
          }
        : {})}
      {...(props.allTimeUnavailable === true ? { allTimeUnavailable: true } : {})}
      {...(props.state !== undefined ? { state: props.state } : {})}
      {...(props.expandedFailed === true ? { expandedFailed: true } : {})}
      {...(props.emptyMessage !== undefined ? { emptyMessage: props.emptyMessage } : {})}
      {...(props.playerMeta !== undefined ? { playerMeta: props.playerMeta } : {})}
      {...(subsets !== undefined ? { subsets } : {})}
    />
  )
}
