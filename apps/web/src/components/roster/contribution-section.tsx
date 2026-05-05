import type { ReactNode } from 'react'
import type { ProfileContributionSummary } from '@eanhl/db/queries'
import { SectionHeading } from '@/components/roster/section-heading'

const ROLE_CHIPS = {
  skater: 'Skater',
  goalie: 'Goalie',
} as const

const CONTRIBUTION_COLORS = [
  '#e11d48',
  '#fbbf24',
  '#38bdf8',
  '#34d399',
  '#a78bfa',
  '#fb923c',
]

interface Props {
  contribution: ProfileContributionSummary | null
  selectedRole: 'skater' | 'goalie'
}

export function ContributionSection({ contribution, selectedRole }: Props) {
  return (
    <section id="profile" className="space-y-4 scroll-mt-24">
      <SectionHeading
        title="Season Profile"
        subtitle={`Normalized vs teammates in the same role · ${selectedRole === 'skater' ? 'skater' : 'goalie'} view`}
      />
      {!contribution || contribution.metrics.length === 0 ? (
        <EmptyPanel message="Not enough data to compute a season profile yet." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <SurfaceCard className="flex flex-col items-center justify-center gap-4 py-6">
            <ContributionDonut metrics={contribution.metrics} />
            <p className="text-[11px] text-zinc-600">
              Based on {contribution.sampleSize} {contribution.role} appearances
            </p>
          </SurfaceCard>
          <SurfaceCard>
            <p className="font-condensed text-base font-bold uppercase tracking-wide text-zinc-100">
              {ROLE_CHIPS[contribution.role]} Profile
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {contribution.metrics.map((metric, i) => (
                <MetricBar
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  color={CONTRIBUTION_COLORS[i % CONTRIBUTION_COLORS.length] ?? '#e11d48'}
                />
              ))}
            </div>
          </SurfaceCard>
        </div>
      )}
    </section>
  )
}

function ContributionDonut({
  metrics,
}: {
  metrics: ProfileContributionSummary['metrics']
}) {
  const size = 180
  const strokeWidth = 20
  const cx = size / 2
  const cy = size / 2
  const r = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * r
  const GAP = 3

  const total = metrics.reduce((sum, m) => sum + Math.max(m.value, 0), 0)

  const cumulativeLengths = metrics.reduce<number[]>((acc, m) => {
    const prev = acc[acc.length - 1] ?? 0
    const segFull = total > 0 ? (Math.max(m.value, 0) / total) * circumference : 0
    return [...acc, prev + segFull]
  }, [])

  return (
    <svg viewBox={`0 0 ${size.toString()} ${size.toString()}`} className="h-[160px] w-[160px]" aria-hidden>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="rgb(39 39 42)"
        strokeWidth={strokeWidth}
      />
      {total > 0 &&
        metrics.map((metric, i) => {
          const segFull = (Math.max(metric.value, 0) / total) * circumference
          const segLen = Math.max(0, segFull - GAP)
          const prevAcc = i === 0 ? 0 : (cumulativeLengths[i - 1] ?? 0)
          return (
            <circle
              key={metric.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={CONTRIBUTION_COLORS[i % CONTRIBUTION_COLORS.length]}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segLen.toString()} ${(circumference - segLen).toString()}`}
              strokeDashoffset={circumference * 0.25 - prevAcc}
            >
              <title>
                {metric.label}: {Math.round(metric.value).toString()}
              </title>
            </circle>
          )
        })}
    </svg>
  )
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-300">{label}</span>
        <span className="text-xs tabular text-zinc-500">{Math.round(value).toString()}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(4, value).toString()}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function SurfaceCard({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`border border-zinc-800 bg-surface p-4 ${className}`}>{children}</div>
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="px-4 text-center text-sm text-zinc-500">{message}</p>
    </div>
  )
}
