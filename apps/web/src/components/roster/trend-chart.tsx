import type { getPlayerProfileOverview } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

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
      <SectionHeader
        label="Recent Form"
        subtitle={`Last ${trendGames.length.toString()} ${selectedRole} appearances · oldest to newest`}
      />

      <Panel className="p-4">
        <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
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
              g.result === 'WIN' ? '#10b981' : g.result === 'OTL' ? '#f59e0b' : '#e11d48'
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
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-condensed text-[11px] uppercase tracking-wider text-zinc-600">
          <span>
            avg <span className="tabular-nums text-zinc-400">{avg.toFixed(1)}</span> / game
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500 opacity-85" />W
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-amber-500 opacity-85" />
              OT
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-rose-500 opacity-85" />L
            </span>
          </div>
        </div>
      </Panel>
    </section>
  )
}
