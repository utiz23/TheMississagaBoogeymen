import type { ComponentType } from 'react'
import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'

export type MarkerSide = 'home' | 'away'

export interface MarkerComponentProps {
  side: MarkerSide
  size?: number
  className?: string
}

export type MarkerEventType = 'goal' | 'shot' | 'hit' | 'penalty'

const MARKERS: Record<MarkerEventType, ComponentType<MarkerComponentProps>> = {
  goal: GoalMarker,
  shot: ShotMarker,
  hit: HitMarker,
  penalty: PenaltyMarker,
}

/**
 * Pick the marker component for a given event type. Returns `null` for event
 * types without a branded marker (e.g. faceoffs — those fall back to a plain
 * dot in callers). The component itself takes `side` + sizing props.
 */
export function eventMarkerFor(
  eventType: string,
): ComponentType<MarkerComponentProps> | null {
  if (eventType in MARKERS) return MARKERS[eventType as MarkerEventType]
  return null
}

/**
 * Map a `match_events.team_side` value ('for' | 'against') to the marker
 * `side` prop. BGM is "home" in the site's convention.
 */
export function markerSideFromTeamSide(teamSide: 'for' | 'against' | string): MarkerSide {
  return teamSide === 'for' ? 'home' : 'away'
}
