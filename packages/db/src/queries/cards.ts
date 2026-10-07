import { desc, eq } from 'drizzle-orm'
import { db } from '../client.js'
import { playerBadgeLevels, playerCardEvents, playerCardProgress } from '../schema/index.js'
import type { BadgeFamilyId, CardTier, MythicThemeKey, TierPool } from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

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
