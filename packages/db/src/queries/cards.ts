import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import { db } from '../client.js'
import { playerBadgeLevels, playerCardEvents, playerCardProgress } from '../schema/index.js'
import type {
  BadgeFamilyId,
  CardThemeKey,
  CardTier,
  MythicThemeKey,
  TierPool,
} from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'
import { pickBestBadge, resolveCardTheme, type BadgeLevelRef } from '../cards/card-theme.js'

export interface PlayerCardProgress {
  /** null until the worker's first recompute has seen this player. */
  standing: {
    tier: CardTier
    level: number
    pool: TierPool | 'manual'
    mythicTheme: MythicThemeKey | null
    computedAt: Date
  } | null
  badges: { familyId: BadgeFamilyId; value: number; level: number }[]
  events: {
    kind: CardEventKind
    familyId: BadgeFamilyId | null
    fromValue: number
    toValue: number
    occurredAt: Date
  }[]
}

/** Card standing, the 21 badge rows and the newest card events for one player. */
export async function getPlayerCardProgress(
  playerId: number,
  eventLimit = 20,
): Promise<PlayerCardProgress> {
  const [standingRows, badges, events] = await Promise.all([
    db.select().from(playerCardProgress).where(eq(playerCardProgress.playerId, playerId)).limit(1),
    db
      .select({
        familyId: playerBadgeLevels.familyId,
        value: playerBadgeLevels.value,
        level: playerBadgeLevels.level,
      })
      .from(playerBadgeLevels)
      .where(eq(playerBadgeLevels.playerId, playerId)),
    db
      .select({
        kind: playerCardEvents.kind,
        familyId: playerCardEvents.familyId,
        fromValue: playerCardEvents.fromValue,
        toValue: playerCardEvents.toValue,
        occurredAt: playerCardEvents.occurredAt,
      })
      .from(playerCardEvents)
      .where(eq(playerCardEvents.playerId, playerId))
      .orderBy(desc(playerCardEvents.occurredAt), desc(playerCardEvents.id))
      .limit(eventLimit),
  ])
  const s = standingRows[0]
  return {
    standing:
      s === undefined
        ? null
        : {
            tier: s.tier,
            level: s.level,
            pool: s.tierPool,
            mythicTheme: s.mythicTheme ?? null,
            computedAt: s.computedAt,
          },
    badges,
    events,
  }
}

export interface CardSummary {
  tier: CardTier
  level: number
  theme: CardThemeKey
  /** The card's featured badge (highest level, catalog order on ties), or null. */
  bestBadge: BadgeLevelRef | null
}

/**
 * Card tier, level, theme and featured badge for many players in one query
 * (carousel, depth chart). Players the worker has not computed yet are absent
 * from the map; callers show them as tier 1, level 1.
 */
export async function getCardProgressForPlayers(
  playerIds: readonly number[],
): Promise<Map<number, CardSummary>> {
  const out = new Map<number, CardSummary>()
  if (playerIds.length === 0) return out
  const rows = await db
    .select({
      playerId: playerCardProgress.playerId,
      tier: playerCardProgress.tier,
      level: playerCardProgress.level,
      mythicTheme: playerCardProgress.mythicTheme,
      familyId: playerBadgeLevels.familyId,
      badgeLevel: playerBadgeLevels.level,
    })
    .from(playerCardProgress)
    .leftJoin(
      playerBadgeLevels,
      and(
        eq(playerBadgeLevels.playerId, playerCardProgress.playerId),
        gt(playerBadgeLevels.level, 0),
      ),
    )
    .where(inArray(playerCardProgress.playerId, [...playerIds]))
  const badges = new Map<number, BadgeLevelRef[]>()
  for (const r of rows) {
    if (!out.has(r.playerId)) {
      out.set(r.playerId, {
        tier: r.tier,
        level: r.level,
        theme: resolveCardTheme(r.tier, r.mythicTheme ?? null),
        bestBadge: null,
      })
      badges.set(r.playerId, [])
    }
    if (r.familyId !== null && r.badgeLevel !== null) {
      badges.get(r.playerId)?.push({ familyId: r.familyId, level: r.badgeLevel })
    }
  }
  for (const [playerId, summary] of out) {
    summary.bestBadge = pickBestBadge(badges.get(playerId) ?? [])
  }
  return out
}
