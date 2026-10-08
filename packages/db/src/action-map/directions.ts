/**
 * Career Action Map direction normalisation (spec Part 5). Pure.
 *
 * Teams switch ends between periods, so raw rink positions from different
 * periods can't share one map. Each (match, period) gets the side BGM attacked:
 *   1. the recorded `match_period_summaries.bgm_attack_direction`, else
 *   2. the side holding ≥ 80% of at least 3 positioned BGM shots/goals, else
 *   3. unknown: the period's events are listed but not plotted.
 * "Left" periods are rotated 180° (not mirrored), so a play on the attacker's
 * left wing stays on their left.
 */

export type AttackDirection = 'left' | 'right'

export interface RecordedDirection {
  matchId: number
  periodNumber: number
  direction: string | null
}

/** Positioned BGM (team_side 'for') shots and goals in one period. */
export interface PeriodShotSides {
  matchId: number
  periodNumber: number
  total: number
  /** Of `total`, how many had x > 0. */
  right: number
}

export const MIN_DIRECTION_SHOTS = 3
export const DIRECTION_SHARE = 0.8

export const periodKey = (matchId: number, periodNumber: number) =>
  `${String(matchId)}:${String(periodNumber)}`

const isDirection = (v: string | null): v is AttackDirection => v === 'left' || v === 'right'

/** Known directions only; a period missing from the map is unknown. */
export function resolvePeriodDirections(
  recorded: readonly RecordedDirection[],
  shots: readonly PeriodShotSides[],
): Map<string, AttackDirection> {
  const out = new Map<string, AttackDirection>()
  const conflicted = new Set<string>()
  const recordedKeys = new Set<string>()
  for (const r of recorded) {
    if (!isDirection(r.direction)) continue
    const key = periodKey(r.matchId, r.periodNumber)
    recordedKeys.add(key)
    const held = out.get(key)
    if (held !== undefined && held !== r.direction) conflicted.add(key)
    out.set(key, r.direction)
  }
  for (const key of conflicted) out.delete(key)

  for (const s of shots) {
    const key = periodKey(s.matchId, s.periodNumber)
    if (recordedKeys.has(key) || s.total < MIN_DIRECTION_SHOTS) continue
    if (s.right / s.total >= DIRECTION_SHARE) out.set(key, 'right')
    else if ((s.total - s.right) / s.total >= DIRECTION_SHARE) out.set(key, 'left')
  }
  return out
}

export function normalizePosition(
  x: number,
  y: number,
  dir: AttackDirection,
): { x: number; y: number } {
  return dir === 'left' ? { x: -x || 0, y: -y || 0 } : { x, y }
}
