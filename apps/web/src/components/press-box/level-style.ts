import type { RelLevel } from '@eanhl/db/news'

/**
 * How a relationship level looks on the board: red side (simmering, feud, open war) and green side
 * (warm, fan, glazing) in steps, grey for none. Classes only; the words come with them (colour is
 * never the only signal).
 */
export const LEVEL_SHORT: Readonly<Record<RelLevel, string>> = {
  war: 'War',
  feud: 'Feud',
  simmering: 'Sim',
  neutral: '—',
  warm: 'Warm',
  fan: 'Fan',
  glazing: 'Glaze',
}

export const LEVEL_CLASS: Readonly<Record<RelLevel, string>> = {
  war: 'border-accent bg-accent-soft text-accent-readable',
  feud: 'border-otl/60 bg-otl/10 text-otl',
  simmering: 'border-fg-5 text-fg-3',
  neutral: 'border-border-subtle text-fg-6',
  warm: 'border-win/40 text-win',
  fan: 'border-win/70 bg-win/10 text-win',
  glazing: 'border-win bg-win/20 text-win',
}

/** Text colour only (for a level word inside a list row). */
export const LEVEL_TEXT: Readonly<Record<RelLevel, string>> = {
  war: 'text-accent-readable',
  feud: 'text-otl',
  simmering: 'text-fg-3',
  neutral: 'text-fg-4',
  warm: 'text-win',
  fan: 'text-win',
  glazing: 'text-win',
}

export const pointsText = (n: number): string => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))
