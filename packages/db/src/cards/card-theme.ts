/**
 * Card theme resolution and badge picks for the player card (spec Part 2).
 * Pure: shared by the batch query and the web card.
 */
import {
  BADGE_FAMILY_IDS,
  CARD_THEME_ORDER,
  MYTHIC_THEMES,
  TIER_THEME,
  type BadgeFamilyId,
  type CardThemeKey,
  type CardTier,
  type MythicThemeKey,
} from './badge-catalog.js'

/** Theme follows tier; tier 6 shows the operator-awarded mythic (Hardlight if none is set). */
export function resolveCardTheme(tier: CardTier, mythicTheme: MythicThemeKey | null): CardThemeKey {
  if (tier === 6) return mythicTheme ?? 'futureB'
  return TIER_THEME[tier]
}

/** Tier a theme unlocks at: one theme per tier up to T5, the five mythics at T6. */
export function themeTier(theme: CardThemeKey): CardTier {
  const index = CARD_THEME_ORDER.indexOf(theme)
  return (index < 5 ? index + 1 : 6) as CardTier
}

export function isThemeUnlocked(theme: CardThemeKey, tier: CardTier): boolean {
  return themeTier(theme) <= tier
}

/**
 * Whether a member may equip `theme` on a card of this tier. The five regular
 * themes unlock with tier; a mythic only ever as the one the club awarded
 * this card (operator, 2026-10-09: reaching T6 does not open every mythic).
 */
export function isThemeEquippable(
  theme: CardThemeKey,
  tier: CardTier,
  mythicTheme: MythicThemeKey | null,
): boolean {
  if ((MYTHIC_THEMES as readonly string[]).includes(theme)) {
    return tier === 6 && theme === mythicTheme
  }
  return themeTier(theme) <= tier
}

/**
 * The theme a card shows: the member's equipped pick where this card allows
 * it, otherwise AUTO (follow tier). One pick covers every title's card, so an
 * older season with a lower tier simply falls back to AUTO there.
 */
export function resolveEquippedTheme(
  tier: CardTier,
  mythicTheme: MythicThemeKey | null,
  pref: CardThemeKey | null,
): CardThemeKey {
  if (pref !== null && isThemeEquippable(pref, tier, mythicTheme)) return pref
  return resolveCardTheme(tier, mythicTheme)
}

export interface BadgeLevelRef {
  familyId: BadgeFamilyId
  level: number
}

/** Earned badges (level > 0), highest level first, ties in catalog order, at most `limit`. */
export function topBadges(rows: readonly BadgeLevelRef[], limit = 4): BadgeLevelRef[] {
  const order = (id: BadgeFamilyId) => BADGE_FAMILY_IDS.indexOf(id)
  return rows
    .filter((r) => r.level > 0)
    .sort((a, b) => b.level - a.level || order(a.familyId) - order(b.familyId))
    .slice(0, limit)
    .map((r) => ({ familyId: r.familyId, level: r.level }))
}

/** The card's featured badge (the "equipped" slot until players can choose one). */
export function pickBestBadge(rows: readonly BadgeLevelRef[]): BadgeLevelRef | null {
  return topBadges(rows, 1)[0] ?? null
}
