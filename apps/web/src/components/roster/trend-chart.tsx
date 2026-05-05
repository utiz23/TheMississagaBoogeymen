import type { ReactNode } from 'react'
import type { getPlayerProfileOverview } from '@eanhl/db/queries'
import { SectionHeading } from '@/components/roster/section-heading'

type Overview = NonNullable<Awaited<ReturnType<typeof getPlayerProfileOverview>>>
type TrendGame = Overview['trendGames'][number]

interface Props {
  trendGames: TrendGame[]
  selectedRole: 'skater' | 'goalie'
}

export function TrendChart({ trendGames, selectedRole }: Props) {
  if (trendGames.length === 0) return null

  const stats = trendGames.map((g) =>
    selectedRole === 'goalie' ? (g.saves ?? 0) : g.goals + g.assists,
  )
  const maxStat = Math.max(...stats, 1)
  const total = stats.reduce((a, b) => a + b, 0)
  const avg = stats.length > 0 ? total / stats.length : 0

  const chartW = 280
  const chartH = 64
  const barW = Math.max(4, Math.floor((chartW - trendGames.length) / trendGames.length))

  const avgY = chartH - Math.max(2, (avg / maxStat) * (chartH - 4))

  return (
    <section id="form-chart" className="space-y-4 scroll-mt-24">
      <SectionHeading
        title="Recent Form"
        subtitle={`Last ${trendGames.length.toString()} ${selectedRole} appearances · oldest to newest`}
      />

      <SurfaceCard>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
          {selectedRole === 'goalie' ? 'Saves per game' : 'Points per game'}
        </p>
        <svg
          viewBox={`0 0 ${chartW.toString()} ${chartH.toString()}`}
          className="w-full"
          style={{ height: `${chartH.toString()}px` }}
          aria-hidden
        >
          {/* Average reference line */}
          <line
            x1="0"
            y1={avgY}
            x2={chartW}
            y2={avgY}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          {trendGames.map((g, i) => {
            const stat = stats[i] ?? 0
            const barH = Math.max(3, (stat / maxStat) * (chartH - 4))
            const x = i * (barW + 1)
            const color =
              g.result === 'WIN'
                ? '#10b981'
                : g.result === 'OTL'
                  ? '#f59e0b'
                  : '#e11d48'
            return (
              <rect
                key={g.matchId}
                x={x}
                y={chartH - barH}
                width={barW}
                height={barH}
                fill={color}
                rx="1"
                opacity="0.85"
              >
                <title>
                  {`vs ${g.opponentName} (${g.result}): ${stat.toString()} ${selectedRole === 'goalie' ? 'saves' : 'pts'}`}
                </title>
              </rect>
            )
          })}
        </svg>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-600">
          <span>avg {avg.toFixed(1)} / game</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500 opacity-85" />
              W
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-amber-500 opacity-85" />
              OT
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-rose-500 opacity-85" />
              L
            </span>
          </div>
        </div>
      </SurfaceCard>
    </section>
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
