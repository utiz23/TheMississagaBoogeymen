import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import { db } from '../client.js'
import {
  gameTitles,
  playerBadgeLevels,
  playerCardEvents,
  playerCardPrefs,
  playerCardProgress,
  players,
} from '../schema/index.js'
import type {
  BadgeFamilyId,
  CardThemeKey,
  CardTier,
  MythicThemeKey,
  TierPool,
} from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'
import { pickBestBadge, resolveEquippedTheme, type BadgeLevelRef } from '../cards/card-theme.js'

export interface PlayerCardProgress {
  /** One of the two AI goalies (their badges use AI_GOALIE_LADDERS). */
  aiGoalie: boolean
  /** The season (game title) this card belongs to; null when the player has no card yet. */
  gameTitle: { id: number; name: string } | null
  /** null until the worker's first recompute has seen this player. */
  standing: {
    tier: CardTier
    level: number
    pool: TierPool | 'manual'
    mythicTheme: MythicThemeKey | null
    /** The theme the member equipped (all titles); null = AUTO. May be locked on this card. */
    themePref: CardThemeKey | null
    computedAt: Date
    /** When the worker first computed this card: its history starts here. */
    trackedSince: Date
  } | null
  /** `featured`: the badge the card shows on its front (set by the worker's recompute). */
  badges: { familyId: BadgeFamilyId; value: number; level: number; featured: boolean }[]
  events: {
    kind: CardEventKind
    familyId: BadgeFamilyId | null
    fromValue: number
    toValue: number
    occurredAt: Date
  }[]
}

/** The player's card rows, newest season (highest release_order) first. */
async function cardRowsNewestFirst(playerIds: readonly number[]) {
  return db
    .select({
      playerId: playerCardProgress.playerId,
      gameTitleId: playerCardProgress.gameTitleId,
      gameTitleName: gameTitles.name,
      tier: playerCardProgress.tier,
      level: playerCardProgress.level,
      tierPool: playerCardProgress.tierPool,
      mythicTheme: playerCardProgress.mythicTheme,
      themePref: playerCardPrefs.theme,
      computedAt: playerCardProgress.computedAt,
      createdAt: playerCardProgress.createdAt,
    })
    .from(playerCardProgress)
    .innerJoin(gameTitles, eq(gameTitles.id, playerCardProgress.gameTitleId))
    .leftJoin(playerCardPrefs, eq(playerCardPrefs.playerId, playerCardProgress.playerId))
    .where(inArray(playerCardProgress.playerId, [...playerIds]))
    .orderBy(desc(gameTitles.releaseOrder), desc(gameTitles.id))
}

/**
 * Card standing, the 21 badge rows and the newest card events for one player,
 * for the player's newest season card (each title is its own season).
 */
export async function getPlayerCardProgress(
  playerId: number,
  eventLimit = 20,
): Promise<PlayerCardProgress> {
  const [[s], [who]] = await Promise.all([
    cardRowsNewestFirst([playerId]),
    db
      .select({ aiGoalieSide: players.aiGoalieSide })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1),
  ])
  const aiGoalie = (who?.aiGoalieSide ?? null) !== null
  if (s === undefined) return { aiGoalie, gameTitle: null, standing: null, badges: [], events: [] }
  const [badges, events] = await Promise.all([
    db
      .select({
        familyId: playerBadgeLevels.familyId,
        value: playerBadgeLevels.value,
        level: playerBadgeLevels.level,
        featured: playerBadgeLevels.featured,
      })
      .from(playerBadgeLevels)
      .where(
        and(
          eq(playerBadgeLevels.playerId, playerId),
          eq(playerBadgeLevels.gameTitleId, s.gameTitleId),
        ),
      ),
    db
      .select({
        kind: playerCardEvents.kind,
        familyId: playerCardEvents.familyId,
        fromValue: playerCardEvents.fromValue,
        toValue: playerCardEvents.toValue,
        occurredAt: playerCardEvents.occurredAt,
      })
      .from(playerCardEvents)
      .where(
        and(
          eq(playerCardEvents.playerId, playerId),
          eq(playerCardEvents.gameTitleId, s.gameTitleId),
        ),
      )
      .orderBy(desc(playerCardEvents.occurredAt), desc(playerCardEvents.id))
      .limit(eventLimit),
  ])
  return {
    aiGoalie,
    gameTitle: { id: s.gameTitleId, name: s.gameTitleName },
    standing: {
      tier: s.tier,
      level: s.level,
      pool: s.tierPool,
      mythicTheme: s.mythicTheme ?? null,
      themePref: s.themePref ?? null,
      computedAt: s.computedAt,
      trackedSince: s.createdAt,
    },
    badges,
    events,
  }
}

export interface CardSummary {
  tier: CardTier
  level: number
  theme: CardThemeKey
  /** The card's featured badge (the worker's pick; highest level until it has run), or null. */
  bestBadge: BadgeLevelRef | null
}

/**
 * Card tier, level, theme and featured badge for many players (carousel, depth
 * chart). With `gameTitleId`, that season's cards; without it, each player's
 * newest season card. Players without a card are absent from the map; callers
 * show them as tier 1, level 1.
 */
export async function getCardProgressForPlayers(
  playerIds: readonly number[],
  gameTitleId?: number,
): Promise<Map<number, CardSummary>> {
  const out = new Map<number, CardSummary>()
  if (playerIds.length === 0) return out
  const cards = new Map<
    number,
    {
      gameTitleId: number
      tier: CardTier
      level: number
      mythicTheme: MythicThemeKey | null
      themePref: CardThemeKey | null
    }
  >()
  for (const r of await cardRowsNewestFirst(playerIds)) {
    if (gameTitleId !== undefined && r.gameTitleId !== gameTitleId) continue
    if (!cards.has(r.playerId)) {
      cards.set(r.playerId, {
        ...r,
        mythicTheme: r.mythicTheme ?? null,
        themePref: r.themePref ?? null,
      })
    }
  }
  if (cards.size === 0) return out
  const badgeRows = await db
    .select({
      playerId: playerBadgeLevels.playerId,
      gameTitleId: playerBadgeLevels.gameTitleId,
      familyId: playerBadgeLevels.familyId,
      level: playerBadgeLevels.level,
      featured: playerBadgeLevels.featured,
    })
    .from(playerBadgeLevels)
    .where(
      and(
        inArray(playerBadgeLevels.playerId, [...cards.keys()]),
        inArray(playerBadgeLevels.gameTitleId, [
          ...new Set([...cards.values()].map((c) => c.gameTitleId)),
        ]),
        gt(playerBadgeLevels.level, 0),
      ),
    )
  const badges = new Map<number, BadgeLevelRef[]>()
  const featured = new Map<number, BadgeLevelRef>()
  for (const r of badgeRows) {
    if (cards.get(r.playerId)?.gameTitleId !== r.gameTitleId) continue
    const list = badges.get(r.playerId) ?? []
    list.push({ familyId: r.familyId, level: r.level })
    badges.set(r.playerId, list)
    if (r.featured) featured.set(r.playerId, { familyId: r.familyId, level: r.level })
  }
  for (const [playerId, c] of cards) {
    out.set(playerId, {
      tier: c.tier,
      level: c.level,
      theme: resolveEquippedTheme(c.tier, c.mythicTheme, c.themePref),
      bestBadge: featured.get(playerId) ?? pickBestBadge(badges.get(playerId) ?? []),
    })
  }
  return out
}

/**
 * Equip a card theme for a player (every title's card), or `null` for AUTO.
 * The caller checks who may do this and that the theme is equippable.
 */
export async function setPlayerCardPref(args: {
  playerId: number
  theme: CardThemeKey | null
  userId: string
}): Promise<void> {
  await db
    .insert(playerCardPrefs)
    .values({ playerId: args.playerId, theme: args.theme, updatedByUserId: args.userId })
    .onConflictDoUpdate({
      target: playerCardPrefs.playerId,
      set: { theme: args.theme, updatedByUserId: args.userId, updatedAt: new Date() },
    })
}
