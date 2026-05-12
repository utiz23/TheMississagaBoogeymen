'use client'

import { useState } from 'react'
import type { ShotLocations } from '@eanhl/db'
import { ShotMap } from '@/components/roster/shot-map'

type Side = 'offense' | 'defense'

interface Props {
  /** Team aggregate offensive shot map (shots taken & goals scored). */
  offense: ShotLocations
  offenseHasData: boolean
  /** Team aggregate defensive shot map (shots faced & goals allowed). */
  defense: ShotLocations
  defenseHasData: boolean
  /** Total team games played for the active mode — drives the rink-legend "GP" cell. */
  teamGp?: number | undefined
  /** ISO date for the footer "Updated" cell. */
  updatedDate?: string | undefined
}

/**
 * Team-scope shot map with an Offense/Defense toggle.
 *
 * Reuses the broadcast-styled `<ShotMap>` from the player profile (rink + net
 * + distance buckets + hot zone summary). On Offense, the ice is in skater
 * orientation (offensive zone at top); on Defense, the ice flips via
 * `role="goalie"` so the defending net is at the bottom and the modes relabel
 * to "Shots Against / Goals Against / Save %."
 *
 * The Offense/Defense toggle sits on the same row as the inner Ice/Goal
 * toggle (opposite side) by way of the `headerSlot` prop — both segmented
 * controls share the `sm-view-toggle` styling for visual consistency.
 */
export function TeamShotMap({
  offense,
  offenseHasData,
  defense,
  defenseHasData,
  teamGp,
  updatedDate,
}: Props) {
  const [side, setSide] = useState<Side>('offense')
  const isOffense = side === 'offense'
  const aggregates = isOffense ? offense : defense
  const hasData = isOffense ? offenseHasData : defenseHasData

  const sideToggle = (
    <div className="sm-view-toggle" role="tablist" aria-label="Shot side">
      <button
        type="button"
        aria-selected={isOffense}
        onClick={() => {
          setSide('offense')
        }}
      >
        Offense
      </button>
      <button
        type="button"
        aria-selected={!isOffense}
        onClick={() => {
          setSide('defense')
        }}
      >
        Defense
      </button>
    </div>
  )

  return (
    <ShotMap
      player={aggregates}
      hasData={hasData}
      role={isOffense ? 'skater' : 'goalie'}
      subject="Team"
      gamertag="Boogeymen"
      sheetCode={isOffense ? 'BGM/TSM/0010' : 'BGM/TSM/0020'}
      headerSlot={sideToggle}
      {...(teamGp !== undefined ? { playerGp: teamGp } : {})}
      {...(updatedDate !== undefined ? { updatedDate } : {})}
    />
  )
}
