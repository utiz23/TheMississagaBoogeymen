import Link from 'next/link'
import type { GameMode } from '@eanhl/db'
import type { RosterRow } from './player-card'
import { PlayerSilhouette } from './player-card'
import { formatPosition } from '@/lib/format'
import { PositionPill } from '@/components/matches/position-pill'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { SectionHeader } from '@/components/ui/section-header'

interface ScoringLeadersPanelProps {
  pointsLeaders: RosterRow[]
  goalsLeaders: RosterRow[]
  gameMode?: GameMode | null
  source?: string
}

/**
 * Scoring Leaders panel — home page stats showcase.
 *
 * Layout: 4 equal columns — Points hero | Points list | Goals hero | Goals list.
 * On mobile (< sm) the two hero columns stack on top, lists below (grid-cols-2).
 *
 * Design decision: the #1 player appears in BOTH the hero block and as the
 * first row of the ranked list. The hero provides visual emphasis; the full
 * list (starting from #1) shows the gaps to #2, #3, etc. without ambiguity.
 */
export function ScoringLeadersPanel({
  pointsLeaders,
  goalsLeaders,
  gameMode,
  source,
}: ScoringLeadersPanelProps) {
  if (pointsLeaders.length === 0 && goalsLeaders.length === 0) return null

  const pointsFeature = pointsLeaders[0] ?? null
  const goalsFeature = goalsLeaders[0] ?? null
  const sectionLabel = gameMode != null ? `${gameMode} Scoring Leaders` : 'Scoring Leaders'
  const ctaHref = gameMode != null ? `/stats?mode=${gameMode}` : '/stats'

  return (
    <BroadcastPanel>
      <div className="flex flex-col gap-1 border-b border-zinc-800/60 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <SectionHeader label={sectionLabel} />
          {source ? (
            <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
              {source}
            </span>
          ) : null}
        </div>
        {/* CTA renders manually here — SectionHeader's CTA can't co-exist with the source line. */}
        <Link
          href={ctaHref}
          className="font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-100"
        >
          View all stats <span aria-hidden>→</span>
        </Link>
      </div>

      {/* 4-column grid: Points hero | Points list | Goals hero | Goals list */}
      <div className="grid grid-cols-2 divide-x divide-zinc-800/60 bg-[linear-gradient(180deg,rgba(24,24,27,0.88),rgba(9,9,11,1))] sm:grid-cols-4">
        <div className="p-4">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Points
          </h3>
          {pointsFeature === null ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <FeaturedPlayerBlock player={pointsFeature} statLabel="Points" statKey="points" />
          )}
        </div>

        <div className="p-4">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            &nbsp;
          </h3>
          <ol className="flex flex-col gap-1" aria-label="Points leaderboard">
            {pointsLeaders.map((player, idx) => (
              <LeaderRow
                key={player.playerId}
                rank={idx + 1}
                player={player}
                statKey="points"
                isFirst={idx === 0}
              />
            ))}
          </ol>
        </div>

        <div className="border-t border-zinc-800/60 p-4 sm:border-t-0">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Goals
          </h3>
          {goalsFeature === null ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <FeaturedPlayerBlock player={goalsFeature} statLabel="Goals" statKey="goals" />
          )}
        </div>

        <div className="border-t border-zinc-800/60 p-4 sm:border-t-0">
          <h3 className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            &nbsp;
          </h3>
          <ol className="flex flex-col gap-1" aria-label="Goals leaderboard">
            {goalsLeaders.map((player, idx) => (
              <LeaderRow
                key={player.playerId}
                rank={idx + 1}
                player={player}
                statKey="goals"
                isFirst={idx === 0}
              />
            ))}
          </ol>
        </div>
      </div>
    </BroadcastPanel>
  )
}

function FeaturedPlayerBlock({
  player,
  statLabel,
  statKey,
}: {
  player: RosterRow
  statLabel: string
  statKey: 'points' | 'goals'
}) {
  const pos = player.position ? formatPosition(player.position) : null

  return (
    <Link
      href={`/roster/${player.playerId.toString()}`}
      className="group flex w-full flex-col items-center gap-1.5"
      aria-label={`${statLabel} leader: ${player.gamertag}, ${player[statKey].toString()} ${statLabel.toLowerCase()}`}
    >
      <div className="relative flex h-20 w-full items-end justify-center overflow-hidden border border-accent/30 bg-[radial-gradient(circle_at_top,rgba(225,29,72,0.20),transparent_55%),linear-gradient(180deg,rgba(24,24,27,0.9),rgba(9,9,11,1))]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <PlayerSilhouette className="text-zinc-700" sizeClass="h-[82px] w-[82px]" />
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <span className="line-clamp-2 max-w-full font-condensed text-xs font-black uppercase leading-tight tracking-wide text-zinc-100 transition-colors group-hover:text-accent">
          {player.gamertag}
        </span>
        {pos !== null && (
          <PositionPill label={pos} position={player.position} isGoalie={player.position === 'goalie'} />
        )}
      </div>

      <div className="mt-1 flex flex-col items-center gap-0.5">
        <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-accent/70">
          {statLabel}
        </span>
        <span className="font-condensed text-5xl font-black leading-none tabular-nums text-zinc-50 drop-shadow-[0_0_14px_rgba(225,29,72,0.18)]">
          {player[statKey].toString()}
        </span>
      </div>
    </Link>
  )
}

function LeaderRow({
  rank,
  player,
  statKey,
  isFirst,
}: {
  rank: number
  player: RosterRow
  statKey: 'points' | 'goals'
  isFirst: boolean
}) {
  return (
    <li>
      <Link
        href={`/roster/${player.playerId.toString()}`}
        className={[
          'flex items-center gap-2 border px-2 py-1.5 transition-colors',
          isFirst
            ? 'border-accent/55 bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)] hover:border-accent/70'
            : 'border-zinc-800/70 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-800/60',
        ].join(' ')}
        aria-label={`Rank ${rank.toString()}, ${player.gamertag}, ${player[statKey].toString()} ${statKey}`}
      >
        <span
          className={`w-5 shrink-0 font-condensed text-xs font-bold tabular-nums ${isFirst ? 'text-accent' : 'text-zinc-500'}`}
        >
          {rank.toString()}
        </span>
        <span
          className={`min-w-0 flex-1 truncate font-condensed text-xs font-semibold ${isFirst ? 'text-zinc-100' : 'text-zinc-200'}`}
        >
          {player.gamertag}
        </span>
        <span
          className={`shrink-0 font-condensed text-xs font-bold tabular-nums ${isFirst ? 'text-zinc-100' : 'text-zinc-500'}`}
        >
          {player[statKey].toString()}
        </span>
      </Link>
    </li>
  )
}
