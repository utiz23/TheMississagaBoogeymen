/**
 * Reporter feuds (T5, migration 0076): a player who insults a reporter (and
 * is not off-limits) adds feud points between that player and that reporter.
 * Points fade with a half-life; the level is read from the faded points. Pure
 * code, shared by the press service (questions, replies), the news writers
 * (recap, weekly column) and the web admin line.
 *
 * Choices (task 2026-11-13-discord-press-hard-lines-feuds):
 * - an insult is worth `INSULT_POINTS`: mild (cheeky, rude) 1, strong
 *   (swearing or a hard insult at the reporter) 2;
 * - half-life 7 days (Lead), so a feud cools over about two weeks;
 * - thresholds: simmering 2 (two mild insults, or one strong one), feud 5
 *   (about three strong insults inside a few days), open war 10 (a sustained
 *   campaign); the stored total never goes above `FEUD_MAX_POINTS`, so one
 *   night of spam is the same as a long grudge and cannot grow without end.
 */

export const FEUD_LEVELS = ['none', 'simmering', 'feud', 'war'] as const
export type FeudLevel = (typeof FEUD_LEVELS)[number]

export const FEUD_HALF_LIFE_DAYS = 7
export const FEUD_MAX_POINTS = 12
export const FEUD_THRESHOLDS = { simmering: 2, feud: 5, war: 10 } as const
export const INSULT_POINTS = { mild: 1, strong: 2 } as const
export type InsultStrength = keyof typeof INSULT_POINTS

const DAY_MS = 86_400_000

/** The points after the half-life since `lastEventAt` (never negative; never above the cap). */
export function decayedPoints(points: number, lastEventAt: Date, now: Date): number {
  const days = Math.max(0, now.getTime() - lastEventAt.getTime()) / DAY_MS
  const value = Math.min(points, FEUD_MAX_POINTS) * Math.pow(0.5, days / FEUD_HALF_LIFE_DAYS)
  return Math.max(0, value)
}

/** The level of a (faded) point total. */
export function feudLevelOf(points: number): FeudLevel {
  if (points >= FEUD_THRESHOLDS.war) return 'war'
  if (points >= FEUD_THRESHOLDS.feud) return 'feud'
  if (points >= FEUD_THRESHOLDS.simmering) return 'simmering'
  return 'none'
}

/** The level of a stored row now. */
export function feudLevelAt(row: { points: number; lastEventAt: Date }, now: Date): FeudLevel {
  return feudLevelOf(decayedPoints(row.points, row.lastEventAt, now))
}

/** True when `level` is at least `min`. */
export function feudAtLeast(level: FeudLevel, min: Exclude<FeudLevel, 'none'>): boolean {
  return FEUD_LEVELS.indexOf(level) >= FEUD_LEVELS.indexOf(min)
}

/** Reads well in the admin line and the prompts: "open war" for `war`. */
export const FEUD_LABELS: Readonly<Record<FeudLevel, string>> = {
  none: 'none',
  simmering: 'simmering',
  feud: 'feud',
  war: 'open war',
}
