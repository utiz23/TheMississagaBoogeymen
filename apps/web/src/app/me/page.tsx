import type { Metadata } from 'next'
import Link from 'next/link'
import { getPlayerGameLog, getPlayerProfileOverview } from '@eanhl/db/queries'
import { requireUser } from '@/lib/auth'

export const metadata: Metadata = { title: 'My Performance - Club Stats' }

function pct(numerator: number, denominator: number): string {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : '—'
}

export default async function MyPerformancePage() {
  const user = await requireUser()

  if (user.playerId === null) {
    return (
      <div className="broadcast-panel mx-auto max-w-2xl p-6">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
          My Performance
        </h1>
        <p className="mt-2 text-sm text-zinc-500">No player claim assigned yet.</p>
      </div>
    )
  }

  const [overview, gameLog] = await Promise.all([
    getPlayerProfileOverview(user.playerId),
    getPlayerGameLog(user.playerId, null, 8, 0),
  ])

  if (!overview) {
    return (
      <div className="broadcast-panel mx-auto max-w-2xl p-6">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
          My Performance
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Linked player profile was not found.</p>
      </div>
    )
  }

  const season = overview.currentEaSeason
  const skaterGp = season?.skaterGp ?? 0
  const points = season?.points ?? 0
  const goals = season?.goals ?? 0
  const assists = season?.assists ?? 0
  const goalieGp = season?.goalieGp ?? 0

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
            My Performance
          </h1>
          <p className="text-sm text-zinc-500">
            {overview.player.gamertag} · private dashboard
          </p>
        </div>
        <Link
          href={`/roster/${user.playerId.toString()}`}
          className="border border-zinc-700 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
        >
          Public Profile
        </Link>
      </div>

      <section className="grid gap-px overflow-hidden border border-zinc-800 bg-zinc-800 md:grid-cols-4">
        <Metric label="Skater GP" value={skaterGp.toString()} />
        <Metric label="Points" value={points.toString()} sub={`${goals.toString()} G · ${assists.toString()} A`} />
        <Metric label="Pts / GP" value={skaterGp > 0 ? (points / skaterGp).toFixed(2) : '—'} />
        <Metric label="Goalie GP" value={goalieGp.toString()} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="broadcast-panel overflow-hidden">
          <div className="ticker-strip-thin ticker-strip" />
          <div className="border-b border-zinc-800 px-5 py-3">
            <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
              Recent Games
            </h2>
          </div>
          <div className="divide-y divide-zinc-800/70">
            {gameLog.length > 0 ? (
              gameLog.map((game) => (
                <div key={game.matchId} className="grid grid-cols-[1fr_auto] gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-condensed text-sm font-bold uppercase text-zinc-200">
                      {game.opponentName}
                    </div>
                    <div className="text-xs text-zinc-600">
                      {game.playedAt.toISOString().slice(0, 10)} · {game.gameMode ?? 'all'}
                    </div>
                  </div>
                  <div className="text-right font-condensed tabular-nums">
                    <div className="font-bold text-zinc-100">
                      {game.scoreFor.toString()}-{game.scoreAgainst.toString()}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {game.isGoalie
                        ? `${game.saves?.toString() ?? '0'} SV`
                        : `${game.goals.toString()}G ${game.assists.toString()}A`}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-5 py-6 text-sm text-zinc-500">No tracked local game log yet.</p>
            )}
          </div>
        </div>

        <div className="broadcast-panel p-5">
          <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
            Private Notes
          </h2>
          <p className="mt-3 text-sm text-zinc-500">
            Notes and goals are reserved for the next account slice. The private account model is
            ready for it.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden border border-zinc-800 bg-zinc-800">
            <Metric label="Shooting" value={pct(goals, season?.shots ?? 0)} compact />
            <Metric label="Role" value={season?.favoritePosition ?? overview.player.position ?? '—'} compact />
          </div>
        </div>
      </section>
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  compact = false,
}: {
  label: string
  value: string
  sub?: string
  compact?: boolean
}) {
  return (
    <div className={`bg-surface ${compact ? 'p-3' : 'p-5'}`}>
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div className="mt-1 font-condensed text-2xl font-black uppercase tabular-nums text-zinc-50">
        {value}
      </div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}
