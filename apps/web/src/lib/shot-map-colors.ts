/**
 * Shot map color/heat math.
 *
 * Two color modes:
 *
 * 1. `count` — used for the Shots and Goals views. Color a zone by the
 *    player's count relative to the team average. Five buckets:
 *
 *      delta = (playerCount - teamAvg) / max(teamAvg, 1)
 *
 *      delta ≥ +0.50          → #c34353  (BGM accent / well above)
 *      +0.15 ≤ delta < +0.50  → #c3435399
 *      -0.15 < delta < +0.15  → #3f3f46  (zinc-700 / at average)
 *      -0.50 < delta ≤ -0.15  → #656cbe66
 *      delta ≤ -0.50          → #656cbe  (BGM right-wing / well below)
 *
 * 2. `pct` — used for the Shooting % view. Zones with fewer than
 *    `MIN_PCT_SAMPLE` shots render as gray hatching. Otherwise color on
 *    a green→red scale relative to the player's own min/max zone
 *    percentage. (Not vs team — small samples make team comparison
 *    misleading.)
 *
 * See docs/specs/position-colors.md for canonical palette context.
 */

export const COLOR_WELL_ABOVE = '#c34353'
export const COLOR_ABOVE = '#c3435399'
export const COLOR_AT_AVG = '#3f3f46'
export const COLOR_BELOW = '#656cbe66'
export const COLOR_WELL_BELOW = '#656cbe'

export const COLOR_PCT_HOT = '#c34353'
export const COLOR_PCT_COLD = '#74f2df'
export const COLOR_PCT_INSUFFICIENT = '#27272a' // gray; rendered with hatching

export const MIN_PCT_SAMPLE = 5

export type DeviationBucket =
  | 'well-above'
  | 'above'
  | 'at-avg'
  | 'below'
  | 'well-below'

export function deviationBucket(playerCount: number, teamAvg: number): DeviationBucket {
  const delta = (playerCount - teamAvg) / Math.max(teamAvg, 1)
  if (delta >= 0.5) return 'well-above'
  if (delta >= 0.15) return 'above'
  if (delta > -0.15) return 'at-avg'
  if (delta > -0.5) return 'below'
  return 'well-below'
}

export function deviationColor(playerCount: number, teamAvg: number): string {
  const bucket = deviationBucket(playerCount, teamAvg)
  switch (bucket) {
    case 'well-above':
      return COLOR_WELL_ABOVE
    case 'above':
      return COLOR_ABOVE
    case 'at-avg':
      return COLOR_AT_AVG
    case 'below':
      return COLOR_BELOW
    case 'well-below':
      return COLOR_WELL_BELOW
  }
}

/**
 * Linearly interpolate between two hex colors. `t` clamped to [0, 1].
 * Inputs must be 6-char hex strings (no alpha, with or without leading #).
 */
function lerpHex(a: string, b: string, t: number): string {
  const clamp = Math.max(0, Math.min(1, t))
  const ax = a.replace('#', '')
  const bx = b.replace('#', '')
  const ar = parseInt(ax.slice(0, 2), 16)
  const ag = parseInt(ax.slice(2, 4), 16)
  const ab = parseInt(ax.slice(4, 6), 16)
  const br = parseInt(bx.slice(0, 2), 16)
  const bg = parseInt(bx.slice(2, 4), 16)
  const bb = parseInt(bx.slice(4, 6), 16)
  const rr = Math.round(ar + (br - ar) * clamp)
  const rg = Math.round(ag + (bg - ag) * clamp)
  const rb = Math.round(ab + (bb - ab) * clamp)
  return `#${rr.toString(16).padStart(2, '0')}${rg.toString(16).padStart(2, '0')}${rb.toString(16).padStart(2, '0')}`
}

/**
 * Color for a zone in Shooting % mode.
 *
 * Returns COLOR_PCT_INSUFFICIENT when the zone has fewer than MIN_PCT_SAMPLE
 * shots. Otherwise lerps from cold (lowest pct) to hot (highest pct) using
 * the player's own min/max range.
 */
export function shootingPctColor(
  shots: number,
  goals: number,
  playerMinPct: number,
  playerMaxPct: number,
): string {
  if (shots < MIN_PCT_SAMPLE) return COLOR_PCT_INSUFFICIENT
  const pct = shots > 0 ? goals / shots : 0
  const range = playerMaxPct - playerMinPct
  const t = range > 0 ? (pct - playerMinPct) / range : 0.5
  return lerpHex(COLOR_PCT_COLD, COLOR_PCT_HOT, t)
}
