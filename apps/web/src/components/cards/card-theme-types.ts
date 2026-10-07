/**
 * Shape of one player-card theme, as ported from the design bundle's
 * card-data.js by docs/design/handoffs/2026-10-cards/port-card-themes.mjs.
 * Values are CSS strings used verbatim, the way PlayerCard.dc.html uses them.
 */

/** Text colour tokens; the generator merges the prototype's defaults (PlayerCard.dc.html L326). */
export interface CardTextTokens {
  ink: string
  sv: string
  sl: string
  rec: string
  pct: string
  line: string
  lead: string
  leadL: string
  pipOn: string
  pipOff: string
  edition: string
  arch: string
  backLabel: string
  backHead: string
  backFoot: string
  chipC?: string | null
  chipB?: string | null
  badgeLabel?: string
  careerLead?: string
}

/** Stat "plates" (Carbon, Hardlight, …): per-cell panels instead of rules. */
export interface CardPlates {
  clip: string
  bg: string
  sh: string
  lead: string
  leadSh: string
  lc: string
  vc: string
  leadL: string
  leadV: string
  radius?: string
  glow?: string
  glowLead?: string
}

export interface CardTheme {
  name: string
  tier: number
  desc: string
  /** Card background stack (background shorthand layers). */
  layers: string[]
  border: string | null
  /** Gradient rim; when set the layers are padding-box and the rim border-box. */
  grad: string | null
  rule: string
  ruleHot: string
  jersey: string
  jerseyEdge?: string
  jerseyClip?: string
  num: string
  portrait: string
  clip?: string
  silh: string
  shadow: string
  light?: boolean
  innerRim?: string
  gloss?: boolean
  bevel?: boolean
  plates?: CardPlates | null
  posInk?: { c: string; b: string; bg: string }
  backNum?: string
  numGlow?: string
  nameGlow?: string
  barGlow?: string
  backHead: string
  backHeadLine: string
  backHeadSub: string
  backHeadSh: string
  careerPanel?: string
  careerSh?: string
  ledgerBg?: string
  ledgerBorder?: string
  ledgerSh?: string
  ledgerClip?: string
  ledgerR?: string
  ledgerLine: string
  ledgerLine2: string
  pulse?: string
  foilTint?: string
  mythic?: boolean
  edition?: string
  tk: CardTextTokens
  // ── Mythic effect switches (rendered in round 2) ──────────────────────────
  future?: string
  frost?: boolean
  icePanel?: boolean
  shelf?: { bg: string; sh: string }
  circuit?: string
  traces?: { line: string; hot: string }
  inferno?: boolean
  embers?: string
  storm?: boolean
  art?: {
    clouds?: string | null
    bolt?: string | null
    burst?: string
    rain?: string
    noFlash?: boolean
    rimAlways?: boolean
    jitter?: string
  }
  arc?: { fill: string; line: string; core: string; glow: string }
  olympus?: boolean
  meander?: string
  backMeander?: boolean
}

export interface CardTierStyle {
  chip: { c: string; b: string; bg: string }
  /** Silhouette size in px. */
  silh: number
}
