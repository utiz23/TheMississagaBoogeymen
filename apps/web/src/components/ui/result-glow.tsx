import type { MatchResult } from '@eanhl/db'

interface ResultGlowProps {
  result: MatchResult
  /**
   * Glow intensity. `default` = visible result tinting on cards. `soft` = dimmer
   * tinting for nested or supporting placements.
   */
  intensity?: 'default' | 'soft'
}

const GLOW_DEFAULT: Record<MatchResult, string> = {
  WIN: 'bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.10),transparent_50%)]',
  LOSS: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.07),transparent_50%)]',
  OTL: 'bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.10),transparent_45%)]',
  DNF: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.05),transparent_50%)]',
}

const GLOW_SOFT: Record<MatchResult, string> = {
  WIN: 'bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.06),transparent_55%)]',
  LOSS: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.04),transparent_55%)]',
  OTL: 'bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.06),transparent_50%)]',
  DNF: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.03),transparent_55%)]',
}

/**
 * Result-themed radial-gradient overlay. Place INSIDE a sharp Panel or
 * BroadcastPanel as the first child; subsequent children should sit on a
 * `<div className="relative">` wrapper to render above the glow.
 *
 * Mirrors the per-result tinting (emerald / rose / amber / dim-rose) that
 * Phase 4 dropped to make cards uniform. Restored as an opt-in coloring
 * layer per the renovation spec's deferred-decisions section, without
 * breaking the design-system "sharp panels, no soft cards" rule (the
 * panel border + radius is still the hosting Panel's responsibility).
 */
export function ResultGlow({ result, intensity = 'default' }: ResultGlowProps) {
  const tint = intensity === 'soft' ? GLOW_SOFT[result] : GLOW_DEFAULT[result]
  return <div aria-hidden className={`pointer-events-none absolute inset-0 ${tint}`} />
}
