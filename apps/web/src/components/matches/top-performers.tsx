import Link from 'next/link'
import type { TopPerformer } from '@/lib/match-recap'
import { formatPosition } from '@/lib/format'
import { PositionPill } from './position-pill'

interface TopPerformersProps {
  performers: TopPerformer[]
}

export function TopPerformers({ performers }: TopPerformersProps) {
  if (performers.length === 0) return null

  return (
    <section>
      <SectionHeader
        title="Top Performers"
        subtitle="computed from BGM player stats"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {performers.map((p, i) => (
          <PerformerCard key={p.playerId} performer={p} rank={i + 1} />
        ))}
      </div>
    </section>
  )
}

function PerformerCard({ performer, rank }: { performer: TopPerformer; rank: number }) {
  const positionLabel = performer.position
    ? formatPosition(performer.position)
    : performer.isGoalie
      ? 'G'
      : null

  return (
    <Link
      href={`/roster/${performer.playerId.toString()}`}
      className="group relative flex items-center gap-3 border border-zinc-800 bg-surface px-4 py-3 transition-colors hover:border-zinc-700 hover:bg-surface-raised"
    >
      <span
        aria-hidden
        className="font-condensed text-3xl font-black tabular leading-none text-zinc-700 group-hover:text-zinc-600"
      >
        {rank.toString()}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          {positionLabel !== null ? (
            <PositionPill label={positionLabel} position={performer.position} isGoalie={performer.isGoalie} />
          ) : null}
          <span className="truncate font-condensed text-sm font-bold uppercase tracking-wide text-zinc-100 group-hover:text-zinc-50">
            {performer.gamertag}
          </span>
        </div>
        <span className="font-condensed text-sm font-semibold tabular text-zinc-400">
          {performer.statLine}
        </span>
      </div>
    </Link>
  )
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </h2>
      {subtitle ? (
        <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-600">
          ({subtitle})
        </span>
      ) : null}
    </div>
  )
}
