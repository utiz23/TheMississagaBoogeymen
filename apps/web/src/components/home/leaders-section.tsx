import Link from 'next/link'
import type { GameMode } from '@eanhl/db'
import type { RosterRow } from './player-card'
import { PlayerSilhouette } from './player-card'
import { formatPositionFull } from '@/lib/format'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScoringLeadersPanelProps {
  pointsLeaders: RosterRow[]
  goalsLeaders: RosterRow[]
  gameMode?: GameMode | null
}

// ─── Panel ────────────────────────────────────────────────────────────────────

/**
 * Scoring Leaders panel — home page stats showcase.
 *
 * Layout: 4 equal columns — Points hero | Points list | Goals hero | Goals list.
 * On mobile (< sm) the two hero columns stack on top, lists below (grid-cols-2).
 *
 * Design decision: the #1 player appears in BOTH the hero block and as the
 * first row of the ranked list. The hero provides visual emphasis; the full
 * list (starting from #1) shows the gaps to #2, #3, etc. without ambiguity.
 *
 * Data (provisional — pre-schema rework):
 * - Source: existing getRoster() flow filtered to skaters (position !== 'goalie')
 * - Sorting is done in page.tsx; rankings are approximate
 * - No minimum GP threshold applied
 * - Jersey numbers are not in the current schema and are omitted
 *
 * TODO (post-schema rework):
 * - Replace with a dedicated scoring leaders query
 * - Enforce minimum games played threshold before ranking
 * - Implement full tiebreaker chain: pts → goals → name (spec §10)
 * - Add jersey number display once field is added to player schema
 */
export function ScoringLeadersPanel({
  pointsLeaders,
  goalsLeaders,
  gameMode,
}: ScoringLeadersPanelProps) {
  if (pointsLeaders.length === 0 && goalsLeaders.length === 0) return null

  const pointsFeature = pointsLeaders[0] ?? null
  const goalsFeature = goalsLeaders[0] ?? null

  return (
    <div className="overflow-hidden border border-zinc-800 bg-surface">
      <div className="h-1 w-full bg-gradient-to-r from-red-900 via-red-600 to-red-900" />
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
        <span className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500">
          {gameMode != null ? `${gameMode} ` : ''}Scoring Leaders
        </span>
        {/* CTA lives in the header — whole panel cannot be a link due to nested player links */}
        <Link
          href="/stats"
          className="font-condensed text-xs text-zinc-600 transition-colors hover:text-zinc-400"
        >
          View all stats →
        </Link>
      </div>

      {/* 4-column grid: Points hero | Points list | Goals hero | Goals list */}
      {/* On small screens collapse to 2 cols (heroes on top row, lists on bottom) */}
      <div className="grid grid-cols-2 divide-x divide-zinc-800/60 sm:grid-cols-4">
        {/* Col 1 — Points hero */}
        <div className="p-4">
          <h3 className="mb-3 font-condensed text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Points
          </h3>
          {pointsFeature === null ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <FeaturedPlayerBlock player={pointsFeature} statLabel="Points" statKey="points" />
          )}
        </div>

        {/* Col 2 — Points leaderboard */}
        <div className="p-4 sm:border-r-0">
          <h3 className="mb-3 font-condensed text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
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

        {/* Col 3 — Goals hero */}
        <div className="border-t border-zinc-800/60 p-4 sm:border-t-0">
          <h3 className="mb-3 font-condensed text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Goals
          </h3>
          {goalsFeature === null ? (
            <p className="text-sm text-zinc-600">—</p>
          ) : (
            <FeaturedPlayerBlock player={goalsFeature} statLabel="Goals" statKey="goals" />
          )}
        </div>

        {/* Col 4 — Goals leaderboard */}
        <div className="border-t border-zinc-800/60 p-4 sm:border-t-0">
          <h3 className="mb-3 font-condensed text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
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
    </div>
  )
}

// ─── Featured player block ────────────────────────────────────────────────────

function FeaturedPlayerBlock({
  player,
  statLabel,
  statKey,
}: {
  player: RosterRow
  statLabel: string
  statKey: 'points' | 'goals'
}) {
  const pos = player.position ? formatPositionFull(player.position) : null

  return (
    <Link
      href={`/roster/${player.playerId.toString()}`}
      className="group flex w-full flex-col items-center gap-1.5"
      aria-label={`${statLabel} leader: ${player.gamertag}, ${player[statKey].toString()} ${statLabel.toLowerCase()}`}
    >
      {/* Profile placeholder — silhouette; container clips top overflow */}
      <div className="flex h-16 w-full items-end justify-center overflow-hidden rounded-sm border border-zinc-800/70 bg-zinc-900/60">
        <PlayerSilhouette className="text-zinc-800" sizeClass="h-[72px] w-[72px]" />
      </div>

      {/* Identity */}
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="line-clamp-2 max-w-full font-condensed text-xs font-black uppercase leading-tight tracking-wide text-zinc-100 transition-colors group-hover:text-accent">
          {player.gamertag}
        </span>
        {/* Position (full label) + jersey number placeholder inline */}
        <div className="flex flex-wrap items-center justify-center gap-1">
          {pos !== null && (
            <span className="rounded-sm bg-zinc-800 px-1.5 py-0.5 font-condensed text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              {pos}
            </span>
          )}
          <span className="font-condensed text-[11px] font-bold leading-none text-zinc-600">
            ##
          </span>
        </div>
      </div>

      {/* Featured stat */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-condensed text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
          {statLabel}
        </span>
        <span className="font-condensed text-5xl font-black leading-none text-zinc-100">
          {player[statKey].toString()}
        </span>
      </div>
    </Link>
  )
}

// ─── Leader row ───────────────────────────────────────────────────────────────

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
        className="flex items-center gap-2 rounded-sm border border-zinc-800/70 bg-zinc-900/30 px-2 py-1.5 transition-colors hover:border-zinc-700 hover:bg-zinc-800/40"
        style={isFirst ? { boxShadow: 'inset 2px 0 0 var(--color-accent)' } : undefined}
        aria-label={`Rank ${rank.toString()}, ${player.gamertag}, ${player[statKey].toString()} ${statKey}`}
      >
        <span
          className={`w-5 shrink-0 font-condensed text-xs font-bold tabular-nums ${isFirst ? 'text-accent' : 'text-zinc-600'}`}
        >
          {rank.toString()}
        </span>
        <span className="min-w-0 flex-1 truncate font-condensed text-xs font-semibold text-zinc-300">
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
