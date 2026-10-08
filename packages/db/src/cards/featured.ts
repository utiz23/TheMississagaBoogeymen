/**
 * Featured badge per card: the badge on the card's front, chosen across the
 * whole club for one title so cards don't all show the same games-played badge.
 *
 * 1. Club leaders: in prestige order, a family's sole season leader features it,
 *    unless they already feature a more prestigious one (the leading scorer
 *    shows Goals, the assists leader Assists).
 * 2. Everyone else, strongest first: the badge with the best value relative to
 *    the club leader × prestige, preferring one nobody features yet.
 * 3. Participation badges (no prestige) only when nothing else is unlocked.
 * Only families in the player's own pool count (a skater card shows a skater badge).
 */
import {
  BADGE_FAMILIES,
  BADGE_PRESTIGE,
  poolOf,
  type BadgeFamilyId,
  type TierPool,
} from './badge-catalog.js'
import type { BadgeValues } from './progression.js'
import { pickBestBadge } from './card-theme.js'

export interface FeaturedInput {
  playerId: number
  pool: TierPool
  values: BadgeValues
  levels: Record<BadgeFamilyId, number>
}

const PRESTIGE_ORDER = Object.keys(BADGE_PRESTIGE) as BadgeFamilyId[]

export function pickFeaturedBadges(
  players: readonly FeaturedInput[],
): Map<number, BadgeFamilyId | null> {
  const best = new Map<BadgeFamilyId, number>()
  for (const f of BADGE_FAMILIES) best.set(f.id, Math.max(0, ...players.map((p) => p.values[f.id])))
  const eligible = (p: FeaturedInput) =>
    PRESTIGE_ORDER.filter(
      (id) => p.levels[id] > 0 && BADGE_FAMILIES.some((f) => f.id === id && poolOf(f) === p.pool),
    )

  const featured = new Map<number, BadgeFamilyId | null>()
  const taken = new Set<BadgeFamilyId>()

  for (const id of PRESTIGE_ORDER) {
    const leaders = players.filter((p) => eligible(p).includes(id) && p.values[id] === best.get(id))
    const [leader] = leaders
    if (leaders.length === 1 && leader !== undefined && !featured.has(leader.playerId)) {
      featured.set(leader.playerId, id)
      taken.add(id)
    }
  }

  const maxLevel = (p: FeaturedInput) => Math.max(0, ...Object.values(p.levels))
  const rest = players
    .filter((p) => !featured.has(p.playerId))
    .sort((a, b) => maxLevel(b) - maxLevel(a) || a.playerId - b.playerId)
  for (const p of rest) {
    const score = (id: BadgeFamilyId) => {
      const top = best.get(id) ?? 0
      return top > 0 ? (p.values[id] / top) * (BADGE_PRESTIGE[id] ?? 0) : 0
    }
    const candidates = eligible(p).sort(
      (a, b) => score(b) - score(a) || PRESTIGE_ORDER.indexOf(a) - PRESTIGE_ORDER.indexOf(b),
    )
    const pick =
      candidates.find((id) => !taken.has(id)) ??
      candidates[0] ??
      pickBestBadge(
        BADGE_FAMILIES.filter((f) => poolOf(f) === p.pool).map((f) => ({
          familyId: f.id,
          level: p.levels[f.id],
        })),
      )?.familyId ??
      null
    featured.set(p.playerId, pick)
    if (pick !== null) taken.add(pick)
  }
  return featured
}
