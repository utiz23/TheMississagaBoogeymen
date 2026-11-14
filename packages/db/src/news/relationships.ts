/**
 * Press relationships (T9, migration 0078; replaces T5's feud-only points).
 * One signed number per player and reporter: negative = the feud side,
 * positive = the favour side. Points fade toward zero by half every 7 days.
 * The level is read in code from the faded points, never stored. Pure code,
 * shared by the press service (questions, replies), the news writers (recap,
 * weekly column) and the web admin line.
 *
 *   open war · feud · simmering · neutral · warm · fan · glazing
 *     <= -10    <= -5   <= -2      between    >= 2   >= 5   >= 10
 *
 * Choices (task 2026-11-14-discord-press-relationships):
 * - T5's feud thresholds stay on the negative side (-2, -5, -10); the favour
 *   side mirrors them (+2, +5, +10). The stored total is capped at +-12, so a
 *   spam night cannot become a month-long war or a month-long glaze.
 * - An event is worth `EVENT_POINTS`: a mild insult -1, a strong one -2; a
 *   thank-you or a compliment +1, a glowing one +2; a strong answer +1; a big
 *   night in the reporter's taste +1.
 * - Each reporter has a disposition (homer +2 ... critic -2): up steps are
 *   scaled by 1 + 0.25 d, down steps by 1 - 0.25 d, and the reporter starts
 *   with a lean of 0.5 d points that never fades (always below the first
 *   threshold of 2, so it only tips an event, never a level on its own).
 * - Each reporter has a range (floor and ceiling on the scale). The level is
 *   clamped to the range. A move that points outside the range is not stored
 *   (Father Rink: floor = neutral, never on the feud side).
 */

import { REPORTERS, type ReporterId } from './reporters.js'

export const REL_LEVELS = ['war', 'feud', 'simmering', 'neutral', 'warm', 'fan', 'glazing'] as const
export type RelLevel = (typeof REL_LEVELS)[number]

/** The negative side without neutral, and the positive side without neutral. */
export type NegativeLevel = 'simmering' | 'feud' | 'war'
export type PositiveLevel = 'warm' | 'fan' | 'glazing'

export const REL_HALF_LIFE_DAYS = 7
export const REL_MAX_POINTS = 12
/** Magnitude of the thresholds on each side (negative side: -2, -5, -10). */
export const REL_THRESHOLDS = {
  simmering: 2,
  feud: 5,
  war: 10,
  warm: 2,
  fan: 5,
  glazing: 10,
} as const

/** Base points of each event kind (negative = the feud side), before the reporter's disposition. */
export const EVENT_POINTS = {
  insultMild: -1,
  insultStrong: -2,
  praiseNice: 1,
  praiseGlowing: 2,
  strongAnswer: 1,
  taste: 1,
} as const
export type RelEvent = keyof typeof EVENT_POINTS

/** A reporter's disposition: -2 (critic) .. +2 (homer). */
export type Disposition = -2 | -1 | 0 | 1 | 2

/** A reporter's range on the scale. */
export interface RelRange {
  floor: RelLevel
  ceiling: RelLevel
}

/** What a reporter counts as a big night: one stat at or above `min` in one game. */
export interface TasteRule {
  stat: 'goals' | 'assists' | 'points' | 'shots' | 'hits' | 'saves'
  min: number
}

const DAY_MS = 86_400_000

const indexOf = (level: RelLevel): number => REL_LEVELS.indexOf(level)

/** The faded signed points (toward zero; never beyond the cap; a clock running backwards changes nothing). */
export function decayedPoints(points: number, lastEventAt: Date, now: Date): number {
  const days = Math.max(0, now.getTime() - lastEventAt.getTime()) / DAY_MS
  const capped = Math.max(-REL_MAX_POINTS, Math.min(REL_MAX_POINTS, points))
  return capped * Math.pow(0.5, days / REL_HALF_LIFE_DAYS)
}

/** The level of a (faded) signed total, before any reporter's range. */
export function relLevelOf(points: number): RelLevel {
  if (points <= -REL_THRESHOLDS.war) return 'war'
  if (points <= -REL_THRESHOLDS.feud) return 'feud'
  if (points <= -REL_THRESHOLDS.simmering) return 'simmering'
  if (points >= REL_THRESHOLDS.glazing) return 'glazing'
  if (points >= REL_THRESHOLDS.fan) return 'fan'
  if (points >= REL_THRESHOLDS.warm) return 'warm'
  return 'neutral'
}

/** True when `level` is at least as far toward the favour side as `min`. */
export function relAtLeast(level: RelLevel, min: RelLevel): boolean {
  return indexOf(level) >= indexOf(min)
}

/** True when the level is on the feud side (below neutral). */
export function isNegative(level: RelLevel): boolean {
  return indexOf(level) < indexOf('neutral')
}

/** True when the level is on the favour side (above neutral). */
export function isPositive(level: RelLevel): boolean {
  return indexOf(level) > indexOf('neutral')
}

/** The reporter's disposition. */
export function dispositionOf(reporter: ReporterId): Disposition {
  return REPORTERS[reporter].disposition
}

/** The reporter's range. */
export function rangeOf(reporter: ReporterId): RelRange {
  return REPORTERS[reporter].range
}

/** The level inside the reporter's range (never below the floor, never above the ceiling). */
export function clampToRange(level: RelLevel, range: RelRange): RelLevel {
  const i = Math.max(indexOf(range.floor), Math.min(indexOf(range.ceiling), indexOf(level)))
  return REL_LEVELS[i]!
}

/** The starting lean: 0.5 points per step of disposition, never fading. */
export function leanOf(disposition: Disposition): number {
  return 0.5 * disposition
}

/** The multiplier of a step: up steps grow with a homer, down steps with a critic. */
export function stepFactor(direction: 'up' | 'down', disposition: Disposition): number {
  return direction === 'up' ? 1 + 0.25 * disposition : 1 - 0.25 * disposition
}

/**
 * The signed points one event is worth for this reporter, or 0 when the
 * reporter's range does not allow that side (a reporter whose floor is neutral
 * never takes a negative step; one whose ceiling is neutral never a positive
 * one). Nothing is stored for 0.
 */
export function eventPoints(reporter: ReporterId, event: RelEvent): number {
  const base: number = EVENT_POINTS[event]
  const { floor, ceiling } = rangeOf(reporter)
  if (base < 0 && !isNegative(floor)) return 0
  if (base > 0 && !isPositive(ceiling)) return 0
  const factor = stepFactor(base > 0 ? 'up' : 'down', dispositionOf(reporter))
  return Math.round(base * factor * 100) / 100
}

/**
 * The level the writers and askers use for a stored row now: the faded points
 * plus the reporter's lean, capped, mapped to a level, then clamped to the
 * reporter's range.
 */
export function relLevelAt(
  row: { points: number; lastEventAt: Date },
  reporter: ReporterId,
  now: Date,
): RelLevel {
  const faded = decayedPoints(row.points, row.lastEventAt, now)
  const total = Math.max(
    -REL_MAX_POINTS,
    Math.min(REL_MAX_POINTS, faded + leanOf(dispositionOf(reporter))),
  )
  return clampToRange(relLevelOf(total), rangeOf(reporter))
}

/**
 * The level for a player's press level: "Go easy" players never get a level
 * on the feud side (neutral at worst), they may be on the favour side.
 */
export function levelForPress(level: RelLevel, pressLevel: 'full' | 'easy'): RelLevel {
  return pressLevel === 'easy' && isNegative(level) ? 'neutral' : level
}

/** Does this stat line match the reporter's taste (a big night in the reporter's own taste)? */
export function matchesTaste(
  reporter: ReporterId,
  line: {
    goals: number
    assists: number
    points: number
    shots: number | null
    hits: number | null
    saves: number | null
  },
): boolean {
  return REPORTERS[reporter].taste.some((t) => {
    const value = line[t.stat]
    return value !== null && value >= t.min
  })
}

/** Reads well in the admin line and the prompts: "open war" for `war`. */
export const REL_LABELS: Readonly<Record<RelLevel, string>> = {
  war: 'open war',
  feud: 'feud',
  simmering: 'simmering',
  neutral: 'neutral',
  warm: 'warm',
  fan: 'fan',
  glazing: 'glazing',
}
