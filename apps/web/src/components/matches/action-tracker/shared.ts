'use client'

import { createContext, useContext } from 'react'

/**
 * Shared primitives for the Action Tracker section.
 *
 * Colour policy (Phase 9): the section paints with the site tokens —
 * `--color-accent` for BGM and `--opp` for the opponent — NOT the per-match
 * OCR-extracted broadcast hexes the previous implementation used. Two reasons:
 *
 *   1. `globals.css` states the rule outright ("opponent colour is `--opp`,
 *      never the raw brand hex"); Phases 3–8 all follow it.
 *   2. On the rink specifically it is a correctness property, not just a style
 *      one: a raw OCR hex can land inside the red wedge and make the two teams'
 *      markers confusable. The Phase 1 resolver guarantees `--opp` clears the
 *      accent clash zone and the legibility floor, so BGM and opponent glyphs
 *      can never read as each other.
 *
 * Because the values are now CSS custom properties rather than hex literals,
 * alpha is applied with `color-mix()` (see `withAlpha`) instead of parsing.
 */

export const BGM_COLOR = 'var(--color-accent)'
export const OPP_COLOR = 'var(--opp, #81878D)'

export interface TeamPalette {
  /** Colour of the club that had home ice — the solid-glyph treatment. */
  HOME_COLOR: string
  /** Colour of the visiting club — the outlined-glyph treatment. */
  AWAY_COLOR: string
}

/**
 * Single source of truth for the per-match palette, so the marker, tooltip and
 * event card don't each need it prop-drilled.
 */
export const TeamPaletteContext = createContext<TeamPalette>({
  HOME_COLOR: BGM_COLOR,
  AWAY_COLOR: OPP_COLOR,
})

export function useTeamPalette(): TeamPalette {
  return useContext(TeamPaletteContext)
}

export type FilterableType = 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'
export type TeamFilter = 'all' | 'home' | 'away'
export type PeriodFilter = 'all' | number
export type SortMode = 'period' | 'chrono' | 'newest'

export const ALL_TYPES: FilterableType[] = ['goal', 'shot', 'hit', 'penalty', 'faceoff']
export const TRACKED_TYPES = new Set<string>(ALL_TYPES)

export const TYPE_META: { type: FilterableType; label: string }[] = [
  { type: 'goal', label: 'Goals' },
  { type: 'shot', label: 'Shots' },
  { type: 'hit', label: 'Hits' },
  { type: 'penalty', label: 'Penalties' },
  { type: 'faceoff', label: 'Faceoffs' },
]

/**
 * Faceoffs are the one tracked type with no rink position: the OCR pipeline
 * reads them from the post-game event list, which carries no (x, y). They stay
 * a filterable type so the event list can surface them, and the chip says so.
 */
export const FACEOFF_NOTE =
  'Faceoffs are tracked in the event list — the post-game screen carries no rink position for them, so they draw no marker.'

/**
 * Apply an alpha to a colour that may be a `var(--token)` reference rather than
 * a hex literal. `color-mix()` handles both, which the old hex parser could not.
 */
export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${String(Math.round(alpha * 100))}%, transparent)`
}

/**
 * Resolve which marker design treatment ('home' = solid fill, 'away' = colour
 * ring around a white interior) an event should wear, based on its team side
 * and which club actually had home ice. Colour still follows the team — this
 * only picks the fill treatment. Defaults to BGM-as-home when `bgmIsHome`
 * can't be determined.
 */
export function resolveMarkerSide(teamSide: string, bgmIsHome: boolean): 'home' | 'away' {
  const eventIsBgm = teamSide === 'for'
  return eventIsBgm === bgmIsHome ? 'home' : 'away'
}

/** Period clock counts DOWN, so a higher value is EARLIER within the period. */
export function clockToSeconds(clock: string | null): number {
  if (!clock) return 0
  const [m, s] = clock.split(':')
  return Number(m) * 60 + Number(s)
}

/**
 * Strip the OCR region prefixes/suffixes ("RT 2ND PERIOD") the extractor writes
 * into `match_events.period_label`.
 */
export function cleanPeriodLabel(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/^\s*(?:RT|LT|RB|LB)\s+/i, '')
    .replace(/\s+(?:RT|LT|RB|LB)\s*$/i, '')
    .trim()
}
