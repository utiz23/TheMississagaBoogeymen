import type { ReactNode } from 'react'
import { ComingSoonCard } from '@/components/roster/coming-soon-card'

interface Props {
  trendChart: ReactNode
  shotMap?: ReactNode
}

export function ChartsVisualsSection({ trendChart, shotMap }: Props) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-[0.2em] text-zinc-100">
          Charts & Visuals
        </h2>
        <p className="text-[11px] text-zinc-500">
          Trend analysis, shot maps, archetype radar, and awards.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {trendChart}
        {shotMap ?? null}
        <ComingSoonCard
          title="Overall Archetype"
          description="Radar visualization of player score across all six contribution dimensions."
        />
        <ComingSoonCard
          title="Awards & Achievements"
          description="Notable career milestones, hat tricks, and team awards."
        />
      </div>
    </section>
  )
}
