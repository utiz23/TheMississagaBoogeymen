/**
 * Milestone tiers for the fact sheets (spec §12.12-10) and their order
 * (spec §12.7). Pure: shared by the web app's sheet builder and the news
 * service's prompt cap.
 */

export type MilestoneStat = 'goals' | 'assists' | 'points' | 'games'

export interface Milestone {
  playerId: number
  name: string
  stat: MilestoneStat
  value: number
}

/** Points milestones every 100; goals and assists every 50. */
const STEP: Record<Exclude<MilestoneStat, 'games'>, number> = {
  points: 100,
  goals: 50,
  assists: 50,
}

/** Games milestones: only these. */
export const GAMES_MILESTONES = [100, 250, 500, 750, 1000] as const

/** At most this many milestones per sheet. */
export const MAX_SHEET_MILESTONES = 3

/** The highest milestone a title total crosses from `before` to `after`, or null. */
export function milestoneCrossed(
  stat: MilestoneStat,
  before: number,
  after: number,
): number | null {
  if (stat === 'games') {
    const crossed = GAMES_MILESTONES.filter((t) => before < t && t <= after)
    return crossed.length === 0 ? null : crossed[crossed.length - 1]!
  }
  const step = STEP[stat]
  const top = Math.floor(after / step) * step
  return top > 0 && top > Math.floor(before / step) * step ? top : null
}

/**
 * The next milestone above a title total (the same tiers as
 * `milestoneCrossed`), or null past the last games milestone.
 */
export function nextMilestone(stat: MilestoneStat, total: number): number | null {
  if (stat === 'games') return GAMES_MILESTONES.find((t) => t > total) ?? null
  const step = STEP[stat]
  return (Math.floor(total / step) + 1) * step
}

/** 0 = a multiple of 100, 1 = of 50, 2 = any other value. */
function tier(value: number): number {
  return value % 100 === 0 ? 0 : value % 50 === 0 ? 1 : 2
}

const STAT_ORDER: Record<MilestoneStat, number> = { points: 0, goals: 1, assists: 2, games: 3 }

/**
 * Spec §12.7: round numbers first (100s, then 50s, then the rest), points
 * before goals before assists before games, then the larger value. Use with a
 * stable sort so full ties keep the sheet order.
 */
export function compareMilestones(
  a: Pick<Milestone, 'stat' | 'value'>,
  b: Pick<Milestone, 'stat' | 'value'>,
): number {
  return (
    tier(a.value) - tier(b.value) || STAT_ORDER[a.stat] - STAT_ORDER[b.stat] || b.value - a.value
  )
}

/** The sheet's milestones: best first by `compareMilestones`, at most `MAX_SHEET_MILESTONES`. */
export function rankMilestones<T extends Pick<Milestone, 'stat' | 'value'>>(
  list: readonly T[],
): T[] {
  return [...list].sort(compareMilestones).slice(0, MAX_SHEET_MILESTONES)
}
