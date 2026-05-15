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
 * Build a `/assets/x-factors/...` URL for a given canonical X-Factor name +
 * tier. Returns null when either input is missing — caller decides the
 * fallback (e.g. render a text pill).
 */
export function xFactorIconUrl(
  canonicalName: string | null | undefined,
  tier: XFactorTier | null | undefined,
): string | null {
  if (!canonicalName || !tier) return null
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
