/**
 * Opponent colour resolver — the clash-contingency ladder from the game-sheet
 * design spec (`Game sheet prototype layout (1)/Opponent Colour Rules.dc.html`).
 *
 * BGM red (#E84131) is reserved: it always means "us" and is never issued to
 * an opponent. An opponent's brand hex is an INPUT to this resolver, never
 * the output — every opponent colour passes the three clash zones before it
 * reaches a score, a bar, or a crest ring:
 *
 *   RED WEDGE — hue within ±30° of BGM red's 29° (OKLCH) at C ≥ .05
 *   TOO DARK  — OKLCH L < .55 (sinks into the #1a1819 panel field)
 *   TOO PALE  — OKLCH L > .93 at C < .045 (indistinguishable from text)
 *
 * The ladder stops at the first rung that clears:
 *   1. brand hex passes          → ship it unchanged            ('brand')
 *   2. too dark / too pale       → lift or drop, keep the hue   ('adjusted')
 *      …unless achromatic       → lift to gunmetal             ('gunmetal')
 *   3. red wedge / missing hex   → deterministic cool alternate ('alternate')
 *
 * Pure module — no React, no DB. The page resolves once server-side and
 * publishes the result as the `--opp*` CSS custom properties (see the
 * comment in `app/globals.css`).
 */

export type OpponentColorProvenance = 'brand' | 'adjusted' | 'alternate' | 'gunmetal'

export type ClashFailure = 'RED WEDGE' | 'TOO DARK' | 'TOO PALE' | 'INVALID'

export interface OpponentColorInput {
  /** Club abbreviation (e.g. from `abbreviateTeamName`) — keys the alternate set. */
  abbrev: string
  /** Brand hex if known (`matches.opp_color_hex` ?? `opponent_clubs.primary_color`). */
  brandHex: string | null
}

export interface OpponentColors {
  /** Resolved opaque colour → `--opp`. Never BGM red, never raw failing brand hex. */
  base: string
  /** 74%-alpha variant → `--opp-2` (secondary numerals). */
  strong: string
  /** 40%-alpha variant → `--opp-line` (borders, crest ring). */
  line: string
  /** 12%-alpha variant → `--opp-soft` (row tints). */
  soft: string
  /** Readable text colour when `base` is used as a fill behind text. */
  fg: string
  /** Which rung of the ladder produced `base`. */
  provenance: OpponentColorProvenance
}

/**
 * Rung-3 issued alternates. All four are cool-side: nothing in the set can be
 * mistaken for BGM red, WIN emerald, or OTL amber. Assignment hashes the club
 * abbreviation so a given opponent always draws the same alternate.
 */
export const OPPONENT_ALTERNATES = [
  { name: 'STEEL', hex: '#8FA6C4' },
  { name: 'ICE', hex: '#6FB7D8' },
  { name: 'VIOLET', hex: '#9B8CE8' },
  { name: 'COBALT', hex: '#6E8FE8' },
] as const

// ── Clash-zone thresholds (spec §02/§04 defaults) ─────────────────────────────
const BGM_HUE = 29 // OKLCH hue of #E84131
const WEDGE = 30 // ± degrees reserved around BGM_HUE
const FLOOR_L = 0.55 // below this the colour sinks into the panel field
const CEIL_L = 0.93 // above this (at low chroma) it reads as primary text
const COOL_HUE = 250 // the faint cool cast used for gunmetal / de-paled greys

/**
 * Test a hex against the three clash zones. Empty result = the colour ships.
 * Exported so callers (and tests) can assert the resolver's core invariant:
 * every resolved `base` clears all three zones.
 */
export function clashFailures(hex: string | null | undefined): ClashFailure[] {
  const o = toOklch(hex)
  if (!o) return ['INVALID']
  const fails: ClashFailure[] = []
  const dh = Math.min(Math.abs(o.h - BGM_HUE), 360 - Math.abs(o.h - BGM_HUE))
  if (dh <= WEDGE && o.C >= 0.05) fails.push('RED WEDGE')
  if (o.L < FLOOR_L) fails.push('TOO DARK')
  if (o.L > CEIL_L && o.C < 0.045) fails.push('TOO PALE')
  return fails
}

export function resolveOpponentColors({ abbrev, brandHex }: OpponentColorInput): OpponentColors {
  const rgb = hexToRgb(brandHex)
  const o = rgb ? rgbToOklch(rgb) : null
  const fails = clashFailures(brandHex)

  if (rgb && o && fails.length === 0) return finish(rgbToHex(rgb), 'brand')

  // Invalid/missing hex, or a red-wedge club: no lightness change can save it —
  // issue a cool alternate so red keeps meaning us.
  if (!o || fails.includes('RED WEDGE')) {
    return finish(alternateFor(abbrev), 'alternate')
  }

  // Too pale: drop lightness, add a faint cool cast when nearly achromatic so
  // it reads as a team, not a label.
  if (fails.includes('TOO PALE')) {
    return finish(
      oklchToHex({ L: 0.86, C: Math.max(o.C, 0.035), h: o.C < 0.02 ? COOL_HUE : o.h }),
      'adjusted',
    )
  }

  // Too dark and achromatic (black, charcoal, grey): there is no hue to keep,
  // so lift straight up the neutral axis to gunmetal — never invent a hue.
  if (o.C < 0.03) {
    return finish(oklchToHex({ L: FLOOR_L + 0.07, C: 0.012, h: COOL_HUE }), 'gunmetal')
  }

  // Too dark but genuinely chromatic: lift it out of the field, keep the identity.
  return finish(
    oklchToHex({ L: FLOOR_L + 0.07, C: Math.max(Math.min(o.C, 0.14), 0.06), h: o.h }),
    'adjusted',
  )
}

// ── Derivations ───────────────────────────────────────────────────────────────

function alternateFor(abbrev: string): string {
  const s = (abbrev.trim() || 'OPP').toUpperCase()
  let n = 0
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0
  const alt = OPPONENT_ALTERNATES[n % OPPONENT_ALTERNATES.length] ?? OPPONENT_ALTERNATES[0]
  return alt.hex
}

function finish(hex: string, provenance: OpponentColorProvenance): OpponentColors {
  // Every ladder output is a valid 6-digit hex, so the fallback never fires;
  // it only satisfies the nullable parse type.
  const [r, g, b] = hexToRgb(hex) ?? [143, 166, 196]
  const alpha = (a: number) =>
    `rgba(${r.toString()}, ${g.toString()}, ${b.toString()}, ${a.toString()})`
  const L = rgbToOklch([r, g, b]).L
  return {
    base: hex,
    strong: alpha(0.74),
    line: alpha(0.4),
    soft: alpha(0.12),
    // Page charcoal on light fills, paper on dark — both from the site palette.
    fg: L >= 0.6 ? '#1A1819' : '#EBEBEB',
    provenance,
  }
}

// ── Colour maths (sRGB ↔ OKLCH, ported verbatim from the spec) ───────────────

type Rgb = [number, number, number]

interface Oklch {
  L: number
  C: number
  h: number
}

function hexToRgb(hex: string | null | undefined): Rgb | null {
  let s = (hex ?? '').trim().replace('#', '')
  if (s.length === 3)
    s = s
      .split('')
      .map((c) => c + c)
      .join('')
  if (!/^[0-9a-f]{6}$/i.test(s)) return null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

function rgbToHex(rgb: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`.toUpperCase()
}

function lin(c: number): number {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function unlin(c: number): number {
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
}

function toOklch(hex: string | null | undefined): Oklch | null {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToOklch(rgb) : null
}

function rgbToOklch(rgb: Rgb): Oklch {
  const r = lin(rgb[0])
  const g = lin(rgb[1])
  const b = lin(rgb[2])
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { L, C: Math.sqrt(A * A + B * B), h }
}

/** Convert OKLCH → hex, walking chroma down until the colour is in sRGB gamut. */
function oklchToHex(o: Oklch): string {
  let C = o.C
  for (let i = 0; i < 40; i++) {
    const rgb = lchToRgb(o.L, C, o.h)
    if (rgb.every((v) => v >= -0.5 && v <= 255.5)) return rgbToHex(rgb)
    C *= 0.94
  }
  return rgbToHex(lchToRgb(o.L, 0, o.h))
}

function lchToRgb(L: number, C: number, h: number): Rgb {
  const A = C * Math.cos((h * Math.PI) / 180)
  const B = C * Math.sin((h * Math.PI) / 180)
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3)
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3)
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3)
  return [
    unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}
