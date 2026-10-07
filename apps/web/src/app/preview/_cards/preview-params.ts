/**
 * Dev-only URL params for the card preview (deleted at the switch):
 *   ?cardTheme=away|home|alternate|carbon|futureB  ?cardTier=1–6  ?cardLevel=1–10
 *   ?face=back  ?gallery=0
 */
import { resolveCardTheme, themeTier } from '@eanhl/db/cards'
import type { CardThemeKey, CardTier } from '@eanhl/db/cards'
import type { CardViewModel } from '../../../components/cards/card-model'

/** Round 1 ships the regular themes; the mythics arrive with their assets in round 2. */
export const PREVIEW_THEMES: readonly CardThemeKey[] = [
  'away',
  'home',
  'alternate',
  'carbon',
  'futureB',
]

export interface CardPreviewParams {
  theme: CardThemeKey | null
  tier: CardTier | null
  level: number | null
  face: 'front' | 'back'
  gallery: boolean
}

type SearchParams = Record<string, string | string[] | undefined>

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

function intIn(v: string | undefined, min: number, max: number): number | null {
  if (v === undefined || !/^\d+$/.test(v)) return null
  const n = Number(v)
  return n >= min && n <= max ? n : null
}

export function parseCardPreviewParams(sp: SearchParams): CardPreviewParams {
  const theme = one(sp.cardTheme)
  return {
    theme:
      theme !== undefined && (PREVIEW_THEMES as readonly string[]).includes(theme)
        ? (theme as CardThemeKey)
        : null,
    tier: intIn(one(sp.cardTier), 1, 6) as CardTier | null,
    level: intIn(one(sp.cardLevel), 1, 10),
    face: one(sp.face) === 'back' ? 'back' : 'front',
    gallery: one(sp.gallery) !== '0',
  }
}

export function applyCardOverrides(card: CardViewModel, p: CardPreviewParams): CardViewModel {
  if (p.theme === null && p.tier === null && p.level === null) return card
  const tier = p.tier ?? (p.theme !== null ? themeTier(p.theme) : card.front.tier)
  const theme = p.theme ?? (p.tier !== null ? resolveCardTheme(p.tier, null) : card.front.theme)
  return { ...card, front: { ...card.front, theme, tier, level: p.level ?? card.front.level } }
}
