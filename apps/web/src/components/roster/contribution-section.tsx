import type { ProfileContributionSummary } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import {
  ContributionWheel,
  type ContributionWheelSeason,
  type ContributionWheelTeammate,
} from './contribution-wheel'

const ROLE_CHIPS = {
  skater: 'Skater',
  goalie: 'Goalie',
} as const

const CONTRIBUTION_COLORS = ['#e84131', '#fbbf24', '#38bdf8', '#34d399', '#a78bfa', '#fb923c']

interface Props {
  contribution: ProfileContributionSummary | null
  selectedRole: 'skater' | 'goalie'
  /** Skater season row used to compute the new contribution wheel. */
  skaterSeason?: ContributionWheelSeason | null
  /** Other team members (used for per-stat ranking on the wheel). */
  teammates?: ContributionWheelTeammate[] | undefined
  /** Focal player's id so they're excluded from the rank pool. */
  playerId?: number | undefined
  gamertag?: string | undefined
  gameTitleName?: string | undefined
  /** Real freshness timestamp for the wheel header. */
  updatedAt?: Date | string | undefined
}

export function ContributionSection({
  contribution,
  selectedRole,
  skaterSeason,
  teammates,
  playerId,
  gamertag,
  gameTitleName,
  updatedAt,
}: Props) {
  // Skater profile renders the impact-weighted contribution wheel.
  if (selectedRole === 'skater') {
    if (!skaterSeason || skaterSeason.gamesPlayed === 0) {
      return (
        <section id="profile" className="space-y-4 scroll-mt-24">
          <SectionHeader
            label="Contribution Wheel"
            subtitle="Impact share weighted by gamescore · skater view"
          />
          <Panel className="flex min-h-[6rem] items-center justify-center">
            <p className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
              Not enough season data to build the contribution wheel yet.
            </p>
          </Panel>
        </section>
      )
    }
    return (
      <section id="profile" className="scroll-mt-24">
        <ContributionWheel
          season={skaterSeason}
          teammates={teammates}
          playerId={playerId}
          gamertag={gamertag}
          gameTitleName={gameTitleName}
          updatedAt={updatedAt}
        />
      </section>
    )
  }

  // Goalie still uses the normalized-vs-teammates donut/bars view.
  return (
    <section id="profile" className="space-y-4 scroll-mt-24">
      <SectionHeader
        label="Season Profile"
        subtitle="Normalized vs teammates in the same role · goalie view"
      />
      {!contribution || contribution.metrics.length === 0 ? (
        <Panel className="flex min-h-[6rem] items-center justify-center">
          <p className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
            Not enough data to compute a season profile yet.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Panel className="flex flex-col items-center justify-center gap-4 py-6">
            <ContributionDonut metrics={contribution.metrics} />
            <p className="font-condensed text-[11px] uppercase tracking-wider text-zinc-600">
              Based on <span className="tabular-nums">{contribution.sampleSize}</span>{' '}
              {contribution.role} appearances
            </p>
          </Panel>
          <Panel className="p-4">
            <p className="font-condensed text-base font-bold uppercase tracking-wide text-zinc-100">
              {ROLE_CHIPS[contribution.role]} Profile
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {contribution.metrics.map((metric, i) => (
                <MetricBar
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                  color={CONTRIBUTION_COLORS[i % CONTRIBUTION_COLORS.length] ?? '#e84131'}
                />
              ))}
            </div>
          </Panel>
        </div>
      )}
    </section>
  )
}

function ContributionDonut({ metrics }: { metrics: ProfileContributionSummary['metrics'] }) {
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
    <svg
      viewBox={`0 0 ${size.toString()} ${size.toString()}`}
      className="h-[160px] w-[160px]"
      aria-hidden
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(39 39 42)" strokeWidth={strokeWidth} />
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
        <span className="font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-300">
          {label}
        </span>
        <span className="font-condensed text-xs font-semibold tabular-nums text-zinc-500">
          {Math.round(value).toString()}
        </span>
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
