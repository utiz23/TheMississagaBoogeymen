import type { ReactNode } from 'react'
import { ComingSoonCard } from '@/components/roster/coming-soon-card'
import { SectionHeader } from '@/components/ui/section-header'

interface Props {
  trendChart: ReactNode
}

export function ChartsVisualsSection({ trendChart }: Props) {
  return (
    <section className="space-y-4">
      <SectionHeader
        label="Charts & Visuals"
        subtitle="Trend analysis, archetype radar, and awards"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {trendChart}
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
