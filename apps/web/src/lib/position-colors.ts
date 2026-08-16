/**
 * Shared position-color palette + lookup.
 *
 * Single source of truth for the position-tinted treatments used by the
 * roster profile hero, the lineup section's position badges, and the
 * lineup drill-down's center rail. Returns CSS custom-property names
 * (e.g. `var(--pos-c)`) defined in `apps/web/src/app/globals.css`, so
 * the actual hex values can be re-themed without touching consumers.
 *
 * Per `docs/specs/position-colors.md`:
 *   center           → --pos-c   (#c0061c)
 *   leftWing         → --pos-lw  (#23cf1d)
 *   rightWing        → --pos-rw  (#2659cf)
 *   leftDefenseMen   → --pos-ld  (#13dfc8)
 *   rightDefenseMen  → --pos-rd  (#ece335)
 *   defenseMen       → --pos-d   (alias of --pos-ld; default when L/R unknown)
 *   wing             → --pos-w   (alias of --pos-lw; default when L/R unknown)
 *   goalie           → --pos-g   (#6f00a5)
 *
 * The two generic keys (`defenseMen`, `wing`) carry the 3s ladder, where the
 * sources disagree on L/R and the slot label stays neutral. See `lineup-shape.ts`.
 */

export type LongPositionKey =
  | 'center'
  | 'leftWing'
  | 'rightWing'
  | 'wing'
  | 'defenseMen'
  | 'leftDefenseMen'
  | 'rightDefenseMen'
  | 'goalie'

/**
 * Short-form position tags used by the lineup section. `C | LW | RW | LD | RD | G`
 * is the 6s ladder; `W | D` are the 3s ladder's neutral wing/defence slots.
 */
export type ShortPositionKey = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G' | 'W' | 'D'

interface PositionMeta {
  tag: string
  colorVar: string
}

export const POSITION_META: Readonly<Record<LongPositionKey, PositionMeta>> = {
  center: { tag: 'C', colorVar: 'var(--pos-c)' },
  leftWing: { tag: 'LW', colorVar: 'var(--pos-lw)' },
  rightWing: { tag: 'RW', colorVar: 'var(--pos-rw)' },
  wing: { tag: 'W', colorVar: 'var(--pos-w)' },
  defenseMen: { tag: 'D', colorVar: 'var(--pos-d)' },
  leftDefenseMen: { tag: 'LD', colorVar: 'var(--pos-ld)' },
  rightDefenseMen: { tag: 'RD', colorVar: 'var(--pos-rd)' },
  goalie: { tag: 'G', colorVar: 'var(--pos-g)' },
}

const SHORT_TO_LONG: Readonly<Record<ShortPositionKey, LongPositionKey>> = {
  C: 'center',
  LW: 'leftWing',
  RW: 'rightWing',
  W: 'wing',
  LD: 'leftDefenseMen',
  RD: 'rightDefenseMen',
  D: 'defenseMen',
  G: 'goalie',
}

export function longPositionKey(short: ShortPositionKey): LongPositionKey {
  return SHORT_TO_LONG[short]
}

/**
 * Lookup the position's accent color (a CSS var reference) by either long-form
 * or short-form key. Falls back to a neutral gray when the input doesn't match.
 */
export function colorForPosition(pos: string | null | undefined): string {
  if (!pos) return 'var(--color-fg-5)'
  // Short-form: 'C' | 'LW' | ...
  if (pos in SHORT_TO_LONG) {
    const long = SHORT_TO_LONG[pos as ShortPositionKey]
    return POSITION_META[long].colorVar
  }
  // Long-form: 'center' | 'leftWing' | ...
  if (pos in POSITION_META) return POSITION_META[pos as LongPositionKey].colorVar
  return 'var(--color-fg-5)'
}
