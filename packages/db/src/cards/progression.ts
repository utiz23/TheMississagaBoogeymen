/**
 * Pure rules for badge levels, card tier and card level.
 * Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md, Part 1.
 */
import {
  BADGE_FAMILIES,
  BADGE_LADDERS,
  BADGE_MAX_LEVEL,
  poolOf,
  type BadgeFamilyId,
  type CardTier,
  type LadderSet,
  type MythicThemeKey,
  type StatsTier,
  type TierPool,
} from './badge-catalog.js'

export type BadgeValues = Record<BadgeFamilyId, number>

export function emptyBadgeValues(): BadgeValues {
  return Object.fromEntries(BADGE_FAMILIES.map((f) => [f.id, 0])) as BadgeValues
}

/** Level 0–30 = number of ladder thresholds the total meets or exceeds. */
export function badgeLevel(ladder: readonly number[], value: number): number {
  let level = 0
  for (const threshold of ladder) {
    if (value >= threshold) level++
    else break
  }
  return level
}

export function badgeLevels(
  values: BadgeValues,
  ladders: LadderSet = BADGE_LADDERS,
): Record<BadgeFamilyId, number> {
  return Object.fromEntries(
    BADGE_FAMILIES.map((f) => [f.id, badgeLevel(ladders[f.id], values[f.id])]),
  ) as Record<BadgeFamilyId, number>
}

export interface BadgeProgress {
  level: number
  value: number
  /** Threshold of the current level (0 when locked). */
  prevThreshold: number
  /** Threshold of the next level, or null when maxed. */
  nextThreshold: number | null
  /** 0–1 progress from prevThreshold to nextThreshold (1 when maxed). */
  pct: number
  /** Amount still needed for the next level, or null when maxed. */
  remaining: number | null
}

export function badgeProgress(ladder: readonly number[], value: number): BadgeProgress {
  const level = badgeLevel(ladder, value)
  const prevThreshold = level > 0 ? (ladder[level - 1] ?? 0) : 0
  const nextThreshold = level < BADGE_MAX_LEVEL ? (ladder[level] ?? null) : null
  if (nextThreshold === null) {
    return { level, value, prevThreshold, nextThreshold, pct: 1, remaining: null }
  }
  const span = nextThreshold - prevThreshold
  const pct = span > 0 ? Math.min(1, Math.max(0, (value - prevThreshold) / span)) : 0
  return { level, value, prevThreshold, nextThreshold, pct, remaining: nextThreshold - value }
}

/**
 * Badge level a family needs to count toward tier N (1–5). Sized so a regular
 * reaches T5 near the end of one title's season
 * (docs/superpowers/specs/2026-10-08-season-cards-design.md).
 */
const TIER_BARS: readonly number[] = [1, 5, 12, 20, 29]

/** Tiers above T5 (mythic) have no stats bar; they read as T5's. */
export function tierBar(tier: number): number {
  return TIER_BARS[Math.min(MAX_STATS_TIER, Math.max(1, Math.round(tier))) - 1] ?? 1
}

/** Families needed at a tier's bar to reach that tier. */
export const FAMILIES_PER_TIER = 4
export const MAX_STATS_TIER: StatsTier = 5

export interface PoolStanding {
  pool: TierPool
  tier: StatsTier
  /** Average fractional progress of the best 4 families toward the next tier (0–1). */
  avgProgress: number
  level: number
}

function familyProgress(
  familyId: BadgeFamilyId,
  value: number,
  tier: StatsTier,
  ladders: LadderSet,
): number {
  const ladder = ladders[familyId]
  const from = ladder[tierBar(tier) - 1] ?? 0
  const to = ladder[tierBar(tier + 1) - 1] ?? from
  if (to <= from) return 0
  return Math.min(1, Math.max(0, (value - from) / (to - from)))
}

export function evaluatePool(
  pool: TierPool,
  values: BadgeValues,
  ladders: LadderSet = BADGE_LADDERS,
): PoolStanding {
  const families = BADGE_FAMILIES.filter((f) => poolOf(f) === pool)
  const levels = families.map((f) => badgeLevel(ladders[f.id], values[f.id]))
  let tier: StatsTier = 1
  for (let next = 2; next <= MAX_STATS_TIER; next++) {
    const bar = tierBar(next)
    if (levels.filter((l) => l >= bar).length >= FAMILIES_PER_TIER) tier = next as StatsTier
    else break
  }
  if (tier === MAX_STATS_TIER) return { pool, tier, avgProgress: 1, level: 10 }
  const progresses = families
    .map((f) => familyProgress(f.id, values[f.id], tier, ladders))
    .sort((a, b) => b - a)
    .slice(0, FAMILIES_PER_TIER)
  const avgProgress = progresses.reduce((s, p) => s + p, 0) / FAMILIES_PER_TIER
  const level = Math.min(10, Math.max(1, 1 + Math.floor(avgProgress * 10)))
  return { pool, tier, avgProgress, level }
}

export interface CardStanding {
  tier: CardTier
  level: number
  pool: TierPool | 'manual'
  mythicTheme: MythicThemeKey | null
}

/** Stats-only standing: the better of the skater and goalie pools (tie → higher progress). */
export function computeStanding(
  values: BadgeValues,
  ladders: LadderSet = BADGE_LADDERS,
): CardStanding {
  const skater = evaluatePool('skater', values, ladders)
  const goalie = evaluatePool('goalie', values, ladders)
  const best =
    goalie.tier > skater.tier ||
    (goalie.tier === skater.tier && goalie.avgProgress > skater.avgProgress)
      ? goalie
      : skater
  return { tier: best.tier, level: best.level, pool: best.pool, mythicTheme: null }
}

/**
 * Never-downgrade merge of a freshly computed standing onto the stored one.
 * A manual (tier 6) standing is only changed by the card-mythic CLI.
 */
export function applyStanding(prev: CardStanding | null, computed: CardStanding): CardStanding {
  if (prev === null) return computed
  if (prev.pool === 'manual') return prev
  if (computed.tier > prev.tier) return computed
  if (computed.tier < prev.tier) return prev
  return { ...computed, level: Math.max(prev.level, computed.level) }
}

export type CardEventKind =
  | 'tier_up'
  | 'level_up'
  | 'badge_level_up'
  | 'mythic_awarded'
  | 'mythic_cleared'

export interface CardEvent {
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
}

/**
 * Events for one player's recompute. The first computation for a player
 * (prev === null) emits nothing, so the backfill does not invent history.
 */
export function diffCardEvents(
  prev: { standing: CardStanding; levels: Partial<Record<BadgeFamilyId, number>> } | null,
  next: { standing: CardStanding; levels: Record<BadgeFamilyId, number> },
): CardEvent[] {
  if (prev === null) return []
  const events: CardEvent[] = []
  if (next.standing.tier > prev.standing.tier) {
    events.push({
      kind: 'tier_up',
      familyId: null,
      fromValue: prev.standing.tier,
      toValue: next.standing.tier,
    })
  } else if (
    next.standing.tier === prev.standing.tier &&
    next.standing.level > prev.standing.level
  ) {
    events.push({
      kind: 'level_up',
      familyId: null,
      fromValue: prev.standing.level,
      toValue: next.standing.level,
    })
  }
  for (const f of BADGE_FAMILIES) {
    const before = prev.levels[f.id] ?? 0
    const after = next.levels[f.id]
    if (after > before)
      events.push({ kind: 'badge_level_up', familyId: f.id, fromValue: before, toValue: after })
  }
  return events
}
