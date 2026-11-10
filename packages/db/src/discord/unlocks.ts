/**
 * What one Discord unlock message and one news-sheet unlock say and show
 * (spec §4). Pure. Badge level-ups are never announced (operator,
 * 2026-11-09): badges stay on the site and the cards only.
 */
import {
  CARD_THEME_NAMES,
  TIER_LABELS,
  TIER_THEME,
  type CardThemeKey,
  type CardTier,
  type MythicThemeKey,
  type StatsTier,
} from '../cards/badge-catalog.js'
import type { CardEventKind } from '../cards/progression.js'

export interface UnlockDescription {
  kind: 'card_level' | 'tier' | 'mythic'
  subject: string
  graphic: 'card'
  cardTheme?: CardThemeKey
  cardTier?: CardTier
}

export function describeUnlock(
  e: { kind: CardEventKind; fromValue: number; toValue: number },
  ctx: { mythicTheme: MythicThemeKey | null },
): UnlockDescription | null {
  switch (e.kind) {
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
