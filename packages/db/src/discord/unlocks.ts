/**
 * What one Discord unlock message says and shows (spec §4). Pure. Badge names
 * follow the badge board (badge-board.ts `themeLabel`): one card theme per 3
 * levels, framed I–III.
 */
import {
  BADGE_FAMILIES,
  CARD_THEME_NAMES,
  CARD_THEME_ORDER,
  TIER_LABELS,
  TIER_THEME,
  type BadgeFamilyId,
  type CardThemeKey,
  type CardTier,
  type MythicThemeKey,
  type StatsTier,
} from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

const FRAMES = ['I', 'II', 'III'] as const

export function badgeBoardName(level: number): string {
  const l = Math.max(1, Math.floor(level))
  const theme =
    CARD_THEME_ORDER[Math.ceil(l / 3) - 1] ?? CARD_THEME_ORDER[CARD_THEME_ORDER.length - 1]!
  return `${CARD_THEME_NAMES[theme]} ${FRAMES[(l - 1) % 3]!}`
}

export interface UnlockDescription {
  kind: 'badge' | 'card_level' | 'tier' | 'mythic'
  subject: string
  graphic: 'badge' | 'card'
  badge?: { familyId: BadgeFamilyId; level: number }
  cardTheme?: CardThemeKey
  cardTier?: CardTier
}

export function describeUnlock(
  e: { kind: CardEventKind; familyId: BadgeFamilyId | null; fromValue: number; toValue: number },
  ctx: { mythicTheme: MythicThemeKey | null },
): UnlockDescription | null {
  switch (e.kind) {
    case 'badge_level_up': {
      if (e.toValue <= e.fromValue || e.familyId === null) return null
      const name = BADGE_FAMILIES.find((f) => f.id === e.familyId)?.name ?? e.familyId
      return {
        kind: 'badge',
        subject: `${name} · ${badgeBoardName(e.toValue)}`,
        graphic: 'badge',
        badge: { familyId: e.familyId, level: e.toValue },
      }
    }
    case 'level_up':
      return { kind: 'card_level', subject: String(e.toValue), graphic: 'card' }
    case 'tier_up': {
      const tier = e.toValue as StatsTier
      return {
        kind: 'tier',
        subject: (TIER_LABELS[tier] ?? String(tier)).toUpperCase(),
        graphic: 'card',
        cardTheme: TIER_THEME[tier] ?? 'away',
        cardTier: tier,
      }
    }
    case 'mythic_awarded':
      if (ctx.mythicTheme === null) return null
      return {
        kind: 'mythic',
        subject: CARD_THEME_NAMES[ctx.mythicTheme].toUpperCase(),
        graphic: 'card',
        cardTheme: ctx.mythicTheme,
        cardTier: 6,
      }
    default:
      return null
  }
}
