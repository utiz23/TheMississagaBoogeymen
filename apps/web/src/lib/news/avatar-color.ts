// Initials colour on a reporter's tint, by WCAG 2 contrast: white only when
// white reaches 4.5:1 on the tint, else dark. Used by the on-site badge and
// the avatar PNG that Discord shows.

export const AVATAR_DARK_TEXT = '#1a1819'
export const AVATAR_LIGHT_TEXT = '#ffffff'
const MIN_CONTRAST = 4.5

function channels(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 2 relative luminance of a `#rrggbb` colour (0 = black, 1 = white). Throws on another form. */
export function relativeLuminance(hex: string): number {
  const c = channels(hex)
  if (c === null) throw new Error(`avatar colour: "${hex}" is not #rrggbb`)
  const [r, g, b] = c.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Dark initials unless white reaches 4.5:1 on `tint`; dark for a tint that is not `#rrggbb`. */
export function initialsColor(tint: string): typeof AVATAR_DARK_TEXT | typeof AVATAR_LIGHT_TEXT {
  if (channels(tint) === null) return AVATAR_DARK_TEXT
  return contrastRatio(tint, AVATAR_LIGHT_TEXT) >= MIN_CONTRAST
    ? AVATAR_LIGHT_TEXT
    : AVATAR_DARK_TEXT
}
