import type { EaMemberStats } from '@eanhl/ea-client'
import type { ShotLocations } from '@eanhl/db'

const ICE_LEN = 16
const NET_LEN = 5

function readInt(raw: EaMemberStats, field: string): number {
  const val = raw[field]
  if (val === undefined || val === null) return 0
  const n =
    typeof val === 'string' ? parseInt(val, 10) : typeof val === 'number' ? Math.round(val) : NaN
  return Number.isNaN(n) ? 0 : n
}

function readArray(raw: EaMemberStats, prefix: string, length: number): number[] {
  const arr: number[] = new Array(length)
  for (let i = 0; i < length; i++) {
    arr[i] = readInt(raw, `${prefix}${i + 1}`)
  }
  return arr
}

function sum(arr: number[]): number {
  let total = 0
  for (const n of arr) total += n
  return total
}

function hasAnyLocationField(raw: EaMemberStats): boolean {
  for (let i = 1; i <= ICE_LEN; i++) {
    if (raw[`skShotsLocationOnIce${i}`] !== undefined) return true
    if (raw[`skGoalsLocationOnIce${i}`] !== undefined) return true
  }
  for (let i = 1; i <= NET_LEN; i++) {
    if (raw[`skShotsLocationOnNet${i}`] !== undefined) return true
    if (raw[`skGoalsLocationOnNet${i}`] !== undefined) return true
  }
  return false
}

/**
 * Extract the 42 EA shot-location fields into four fixed-length arrays.
 *
 * Returns null for:
 *   - Goalies (favoritePosition === 'goalie')
 *   - Members with no location fields at all (pre-NHL-26 titles)
 *   - Sum invariant violations (would indicate corrupt/partial data)
 *
 * The caller is responsible for logging the invariant-failure case.
 * Missing individual fields default to 0.
 */
export function extractShotLocations(raw: EaMemberStats): ShotLocations | null {
  if (raw.favoritePosition === 'goalie') return null
  if (!hasAnyLocationField(raw)) return null

  const shotsIce = readArray(raw, 'skShotsLocationOnIce', ICE_LEN)
  const goalsIce = readArray(raw, 'skGoalsLocationOnIce', ICE_LEN)
  const shotsNet = readArray(raw, 'skShotsLocationOnNet', NET_LEN)
  const goalsNet = readArray(raw, 'skGoalsLocationOnNet', NET_LEN)

  if (sum(shotsIce) !== sum(shotsNet)) return null
  if (sum(goalsIce) !== sum(goalsNet)) return null

  return { shotsIce, goalsIce, shotsNet, goalsNet }
}

function hasAnyGoalieLocationField(raw: EaMemberStats): boolean {
  for (let i = 1; i <= ICE_LEN; i++) {
    if (raw[`glShotsLocationOnIce${i}`] !== undefined) return true
    if (raw[`glGoalsLocationOnIce${i}`] !== undefined) return true
  }
  for (let i = 1; i <= NET_LEN; i++) {
    if (raw[`glShotsLocationOnNet${i}`] !== undefined) return true
    if (raw[`glGoalsLocationOnNet${i}`] !== undefined) return true
  }
  return false
}

/**
 * Extract goalie shot-location grids (shots FACED + goals ALLOWED) from
 * `glShots*` / `glGoals*` fields. Same shape as `extractShotLocations`,
 * but the arrays count opponents' shots from each ice/net zone instead
 * of the player's own shots.
 *
 * Returns null when:
 *   - the member has no goalie GP (caller should pass null in that case
 *     anyway, but we double-check via hasAnyGoalieLocationField),
 *   - sum invariants are violated.
 */
export function extractGoalieShotLocations(raw: EaMemberStats): ShotLocations | null {
  if (!hasAnyGoalieLocationField(raw)) return null

  const shotsIce = readArray(raw, 'glShotsLocationOnIce', ICE_LEN)
  const goalsIce = readArray(raw, 'glGoalsLocationOnIce', ICE_LEN)
  const shotsNet = readArray(raw, 'glShotsLocationOnNet', NET_LEN)
  const goalsNet = readArray(raw, 'glGoalsLocationOnNet', NET_LEN)

  if (sum(shotsIce) !== sum(shotsNet)) return null
  if (sum(goalsIce) !== sum(goalsNet)) return null

  return { shotsIce, goalsIce, shotsNet, goalsNet }
}
