/**
 * X-Factor branding asset URL helper.
 *
 * Canonical X-Factor names + Elite/All Star/Specialist tiers map to PNG
 * icons served from `public/assets/x-factors/<Name>/<file>.png`.
 *
 * Tier → color mapping is fixed by EA's asset naming convention:
 *   Elite       → Red    (rarest tier, red diamond)
 *   All Star    → Blue   (mid tier, blue diamond with arrows)
 *   Specialist  → Gold   (entry tier, gold/bronze pin)
 */

export type XFactorTier = 'Elite' | 'All Star' | 'Specialist'

const TIER_TO_COLOR: Readonly<Record<XFactorTier, 'Red' | 'Blue' | 'Gold'>> = {
  Elite: 'Red',
  'All Star': 'Blue',
  Specialist: 'Gold',
}

/**
 * Type guard for a genuine tier enum. Guards against bogus values (e.g. the
 * legacy string "null") that would otherwise index `TIER_TO_COLOR` as
 * `undefined` and build a broken `__undefined__File.png` URL.
 */
export function isXFactorTier(value: unknown): value is XFactorTier {
  return value === 'Elite' || value === 'All Star' || value === 'Specialist'
}

/**
 * Build a `/assets/x-factors/...` URL for a given canonical X-Factor name +
 * tier.
 *
 * Returns null when the canonical name is missing OR the tier is absent/invalid.
 * The tier-colored PNGs are the ONLY X-Factor art that exists (Red/Blue/Gold),
 * so there is intentionally no icon for a tier-less X-Factor — the caller is
 * expected to render a neutral, visually-distinct placeholder via
 * `hasXFactorIcon` so a known-but-untiered X-Factor still reads as present
 * (rather than vanishing). See `matches/lineup/lineup-row.tsx` (icon tiles) and
 * `matches/lineup/drawer-loadout.tsx` (build compare).
 */
export function xFactorIconUrl(
  canonicalName: string | null | undefined,
  tier: XFactorTier | null | undefined,
): string | null {
  if (!canonicalName || !isXFactorTier(tier)) return null
  const color = TIER_TO_COLOR[tier]
  return `/assets/x-factors/${canonicalName}/NHL_26_${canonicalName}_X-Factor_Image__${color}__File.png`
}

/**
 * Human-readable tier badge text — used in tooltips and accessibility labels.
 * Matches EA's in-game terminology.
 */
export function tierLabel(tier: XFactorTier | null | undefined): string {
  if (!tier) return 'Unknown tier'
  return tier
}
