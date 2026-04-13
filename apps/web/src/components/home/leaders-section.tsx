import Link from 'next/link'
import type { RosterRow } from './player-card'

interface LeadersSectionProps {
  pointsLeaders: RosterRow[]
  goalsLeaders: RosterRow[]
}

/**
 * Two-column leaders display: Points leaders and Goals leaders.
 *
 * Data is pre-sorted and sliced in the page component.
 * Top-ranked row in each column gets an accent left border.
 */
export function LeadersSection({ pointsLeaders, goalsLeaders }: LeadersSectionProps) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <LeaderColumn title="Points Leaders" rows={pointsLeaders} statKey="points" />
      <LeaderColumn title="Goals Leaders" rows={goalsLeaders} statKey="goals" />
    </div>
  )
}

// ─── Leader column ───────────────────────────────────────────────────────────

interface LeaderColumnProps {
  title: string
  rows: RosterRow[]
  statKey: 'points' | 'goals'
}

function LeaderColumn({ title, rows, statKey }: LeaderColumnProps) {
  return (
    <div>
      <h3 className="mb-2 font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {title}
      </h3>
      <div className="border border-zinc-800 bg-surface divide-y divide-zinc-800/60">
        {rows.map((row, idx) => (
          <LeaderRow key={row.playerId} row={row} rank={idx + 1} statKey={statKey} />
        ))}
      </div>
    </div>
  )
}

// ─── Leader row ──────────────────────────────────────────────────────────────

interface LeaderRowProps {
  row: RosterRow
  rank: number
  statKey: 'points' | 'goals'
}

function LeaderRow({ row, rank, statKey }: LeaderRowProps) {
  const isTop = rank === 1

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-raised"
      style={isTop ? { boxShadow: 'inset 3px 0 0 var(--color-accent)' } : undefined}
    >
      {/* Rank */}
      <span
        className={`w-5 shrink-0 font-condensed text-sm font-bold tabular ${isTop ? 'text-accent' : 'text-zinc-600'}`}
      >
        {rank.toString()}
      </span>

      {/* Gamertag */}
      <Link
        href={`/roster/${row.playerId.toString()}`}
        className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200 transition-colors hover:text-accent"
      >
        {row.gamertag}
      </Link>

      {/* Stat value */}
      <span
        className={`shrink-0 font-condensed text-sm font-bold tabular ${isTop ? 'text-zinc-100' : 'text-zinc-400'}`}
      >
        {row[statKey].toString()}
      </span>
    </div>
  )
}
