/**
 * What a Discord card-update post shows (spec §4): pure, shared by the web
 * loader and its tests. Badge levels are internal steps 1–30; the site shows
 * one Roman numeral per 5 steps (card-badge.tsx), so only a numeral change
 * counts.
 */
import {
  BADGE_FAMILIES,
  TIER_LABELS,
  type BadgeFamilyId,
  type CardTier,
} from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

const numeralIndex = (level: number) => (level <= 0 ? 0 : Math.min(6, Math.ceil(level / 5)))

/** The site's Roman numeral for an internal badge level; '' for no badge. */
export function badgeNumeral(level: number): string {
  const i = numeralIndex(level)
  return i === 0 ? '' : (ROMAN[i - 1] ?? '')
}

export interface ShowcaseEvent {
  id: number
  playerId: number
  kind: CardEventKind
  familyId: BadgeFamilyId | null
  fromValue: number
  toValue: number
}

const familyName = (id: BadgeFamilyId | null) =>
  BADGE_FAMILIES.find((f) => f.id === id)?.name ?? String(id)
const tierLabel = (t: number) => TIER_LABELS[t as CardTier] ?? String(t)

/** The line text for one event, or null when it doesn't count. */
export function showcaseText(e: ShowcaseEvent): string | null {
  switch (e.kind) {
    case 'badge_level_up': {
      if (numeralIndex(e.toValue) <= numeralIndex(e.fromValue)) return null
      const name = familyName(e.familyId)
      return numeralIndex(e.fromValue) === 0
        ? `New badge: ${name} ${badgeNumeral(e.toValue)}`
        : `${name} ${badgeNumeral(e.fromValue)} → ${badgeNumeral(e.toValue)}`
    }
    case 'level_up':
      return `Card level ${String(e.fromValue)} → ${String(e.toValue)}`
    case 'tier_up':
      return `⬆ Tier: ${tierLabel(e.fromValue)} → ${tierLabel(e.toValue)}`
    case 'mythic_awarded':
      return 'Mythic card awarded'
    default:
      return null
  }
}

const KIND_ORDER: Partial<Record<CardEventKind, number>> = {
  badge_level_up: 0,
  level_up: 1,
  tier_up: 2,
  mythic_awarded: 3,
}

/**
 * Each eligible player's counted changes, players in order of their first
 * counted event, texts ordered badges → level → tier → mythic.
 */
export function showcaseChanges(
  events: readonly ShowcaseEvent[],
  eligible: (playerId: number) => boolean,
): { playerId: number; changes: string[] }[] {
  const byPlayer = new Map<
    number,
    { first: number; items: { order: number; id: number; text: string }[] }
  >()
  for (const e of events) {
    if (!eligible(e.playerId)) continue
    const text = showcaseText(e)
    if (text === null) continue
    const entry = byPlayer.get(e.playerId) ?? { first: e.id, items: [] }
    entry.first = Math.min(entry.first, e.id)
    entry.items.push({ order: KIND_ORDER[e.kind] ?? 9, id: e.id, text })
    byPlayer.set(e.playerId, entry)
  }
  return [...byPlayer.entries()]
    .sort((a, b) => a[1].first - b[1].first)
    .map(([playerId, v]) => ({
      playerId,
      changes: v.items.sort((a, b) => a.order - b.order || a.id - b.id).map((i) => i.text),
    }))
}
