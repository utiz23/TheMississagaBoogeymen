'use client'

import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import { GOALIE_METRICS } from '@/components/stats/stats-table/goalie-metrics'
import { SKATER_METRICS } from '@/components/stats/stats-table/skater-metrics'
import { StatsTableShell, type RowLabel } from '@/components/stats/stats-table/stats-table-shell'
import { GOALIE_VIEWS, SKATER_VIEWS } from '@/components/stats/stats-table/views'
import type { SeasonLabel, SeasonTable } from './career-season-rows'

// ─── Public component ─────────────────────────────────────────────────────────

/**
 * Career-by-season table for the player profile page: the roster's stats
 * table (category tabs, Per GP, sortable columns, stat key) with one row per
 * game title instead of one row per player. Rows arrive newest title first
 * from `buildSeasonTable`; each carries an EA / Archive source badge.
 */
export function CareerSeasonsTable({ table }: { table: SeasonTable }) {
  if (table.rows.length === 0) {
    return (
      <Panel className="flex min-h-[8rem] items-center justify-center">
        <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
          No career data for {table.role} role yet.
        </p>
      </Panel>
    )
  }

  return table.role === 'skater' ? (
    <StatsTableShell
      role="skaters"
      title="Skater seasons"
      metrics={SKATER_METRICS}
      views={SKATER_VIEWS}
      current={{
        rows: table.rows,
        source: table.source,
        hasExpanded: table.rows.some((r) => r.expanded !== null),
      }}
      rowLabel={seasonLabel()}
    />
  ) : (
    <StatsTableShell
      role="goalies"
      title="Goalie seasons"
      metrics={GOALIE_METRICS}
      views={GOALIE_VIEWS}
      current={{
        rows: table.rows,
        source: table.source,
        hasExpanded: table.rows.some((r) => r.expanded !== null),
      }}
      rowLabel={seasonLabel()}
    />
  )
}

function seasonLabel<R extends { season: SeasonLabel }>(): RowLabel<R> {
  return {
    header: 'Season',
    id: (row) => row.season.gameTitleSlug,
    render: (row) => <SeasonCell season={row.season} />,
    order: { input: 'newest first', reversed: 'oldest first' },
  }
}

function SeasonCell({ season }: { season: SeasonLabel }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Link
        prefetch
        href={`/stats?title=${season.gameTitleSlug}`}
        className="truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
      >
        {season.gameTitleName}
      </Link>
      <SourceBadge source={season.source} />
    </div>
  )
}

// ─── Source badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: 'ea' | 'historical' }) {
  if (source === 'ea') {
    return (
      <span className="inline-flex items-center border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.18em] text-accent">
        EA
      </span>
    )
  }
  return (
    <span className="inline-flex items-center border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
      Archive
    </span>
  )
}
