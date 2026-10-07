/**
 * Per-theme style values for the player card — a direct port of the style
 * half of PlayerCard.dc.html renderVals (levelStyle 'back'). Pure: the card
 * components apply these as inline styles, the way the prototype does.
 */
import { TIER_LABELS } from '@eanhl/db/cards'
import type { CardTier } from '@eanhl/db/cards'
import { CARD_POS_COLORS, CARD_TIER_STYLE } from './card-themes.ts'
import type { CardTheme } from './card-theme-types'
import type { CardRole } from './card-model'

export interface CardLookInput {
  tier: CardTier
  level: number
  hot: boolean
  role: CardRole
  position: string | null
}

export interface CardStatLook {
  sep: boolean
  gem: boolean
  lc: string
  vc: string
  fs: string
  pad: string
  ts: string
  bg: string
  clip: string
  sh: string
}

const LEDGER_FALLBACK =
  'linear-gradient(135deg, transparent 0 80%, rgba(232,65,49,0.16) 80% 81.5%, transparent 81.5%), linear-gradient(180deg, rgba(14,14,15,0.9), rgba(4,4,4,0.94))'
const SCAN =
  'repeating-linear-gradient(180deg, transparent 0, transparent 3px, rgba(255,255,255,0.012) 3px, rgba(255,255,255,0.012) 4px)'

export function cardLook(th: CardTheme, input: CardLookInput) {
  const { tier, level, hot } = input
  const tk = th.tk
  const pl = th.plates ?? null
  const framed = Boolean(th.traces ?? th.arc)
  const tierStyle = CARD_TIER_STYLE[tier]

  const cardBg = th.grad
    ? [...th.layers.map((l) => `${l} padding-box`), `${th.grad} border-box`].join(', ')
    : th.layers.join(', ')
  const border = th.grad
    ? '1px solid transparent'
    : `1px solid ${hot && !(th.border ?? '').startsWith('#5c') ? 'rgba(232,65,49,0.45)' : String(th.border)}`
  const shadow =
    (hot
      ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 14px 32px rgba(0,0,0,0.45), 0 0 32px rgba(232,65,49,0.22)'
      : '0 1px 0 rgba(255,255,255,0.02) inset, 0 8px 24px rgba(0,0,0,0.35)') + th.shadow

  const posC = (input.position !== null ? CARD_POS_COLORS[input.position] : undefined) ?? '#71717a'
  const stats: CardStatLook[] = [0, 1, 2, 3].map((i) => {
    const lead = i === 3
    return {
      sep: i > 0 && !pl && !th.shelf && !framed,
      gem: i > 0 && Boolean(th.shelf),
      lc: pl ? (lead ? pl.leadL : pl.lc) : lead ? tk.leadL : tk.sl,
      vc: pl ? (lead ? pl.leadV : pl.vc) : lead ? tk.lead : tk.sv,
      fs: lead ? '23px' : '19px',
      pad: pl ? '10px 0 11px' : '0',
      ts: pl?.glow ? ((lead ? pl.glowLead : pl.glow) ?? 'none') : 'none',
      bg: pl ? (lead ? pl.lead : pl.bg) : 'none',
      clip: pl ? pl.clip : 'none',
      sh: pl ? (lead ? pl.leadSh : pl.sh) : 'none',
    }
  })

  return {
    cardBg,
    border,
    shadow,
    ruleBg: hot ? th.ruleHot : th.rule,
    pips: Array.from({ length: 10 }, (_, i) => (i < level ? tk.pipOn : tk.pipOff)),
    chip:
      tk.chipC && tier <= 2
        ? { c: tk.chipC, b: tk.chipB ?? tk.chipC, bg: 'transparent' }
        : tierStyle.chip,
    chipText: TIER_LABELS[tier],
    posColor: th.posInk ? th.posInk.c : th.light ? `color-mix(in oklch, ${posC} 62%, black)` : posC,
    posBorder: th.posInk ? th.posInk.b : `${posC}${th.light ? 'aa' : '66'}`,
    posBg: th.posInk ? th.posInk.bg : `${posC}${th.light ? '24' : '1a'}`,
    portraitClip: th.clip ?? 'none',
    jerseyEdge: th.jerseyEdge ?? 'none',
    jerseyClip: th.jerseyClip ?? 'none',
    silhSize: `${String(tierStyle.silh)}px`,
    scanBg: SCAN,
    nameShadow: th.nameGlow ?? 'none',
    namePad: th.meander ? '8px 16px 8px' : th.shelf || framed ? '10px 4px 8px' : '14px 16px 10px',
    stats,
    plateGap: pl ? '4px' : '0',
    statRule: pl || th.shelf || framed ? 'none' : `1px solid ${tk.line}`,
    statPad: pl ? '2px 0 4px' : th.shelf ? '12px 0 13px' : framed ? '13px 0' : '12px 0',
    statM: th.shelf || framed ? '0' : '0 12px',
    footPad: th.meander
      ? '6px 12px 18px'
      : pl
        ? '8px 12px 27px'
        : th.shelf
          ? '6px 0 12px'
          : framed
            ? '14px 0 10px'
            : '16px 12px 20px',
    footSeps: !pl && !th.shelf && !framed,
    plateBg: pl ? pl.bg : 'none',
    plateClip: pl ? pl.clip : 'none',
    plateSh: pl ? pl.sh : 'none',
    plateR: th.ledgerR ?? pl?.radius ?? '0',
    shelfBg: th.shelf ? th.shelf.bg : 'none',
    shelfR: th.shelf ? '12px' : '0',
    shelfSh: th.shelf ? th.shelf.sh : 'none',
    panelM: th.shelf ? '4px 12px 20px' : framed ? '4px 12px 16px' : '0',
    // ── back face ────────────────────────────────────────────────────────────
    backNum: th.backNum ?? th.num,
    numShadow: th.numGlow ?? 'none',
    barGlow: th.barGlow ?? 'none',
    backHeadBg: th.backHead || 'transparent',
    backHeadLine: th.backHeadLine || (th.backHead ? 'rgba(0,0,0,0.55)' : 'rgba(63,63,70,0.4)'),
    backHeadSh: th.backHeadSh || 'none',
    backSubC: th.backHeadSub || (th.backHead ? '#a1a1aa' : tk.sl),
    ledgerBg: th.ledgerBg ?? th.careerPanel ?? LEDGER_FALLBACK,
    ledgerBorder: th.ledgerBorder ?? (th.careerSh ? '0' : '1px solid rgba(63,63,70,0.5)'),
    ledgerSh: th.ledgerSh ?? th.careerSh ?? 'none',
    ledgerClip: th.ledgerClip ?? (th.careerPanel ? (th.clip ?? 'none') : 'none'),
    ledgerHeadLine:
      th.ledgerLine || (th.careerPanel ? 'rgba(255,255,255,0.12)' : 'rgba(63,63,70,0.4)'),
    ledgerRowLine: `1px solid ${th.ledgerLine2 || (th.careerPanel ? 'rgba(255,255,255,0.06)' : 'rgba(63,63,70,0.25)')}`,
    ledgerLead: ((th.careerPanel ?? th.ledgerBg) ? tk.careerLead : undefined) ?? tk.lead,
  }
}

export type CardLook = ReturnType<typeof cardLook>

export interface CardFxInput {
  /** Motion allowed right now (not reduced, on screen, and hero or hot). */
  motionOn: boolean
  hot: boolean
}

/** Which effect layers render — the prototype's `mo()` gates. */
export function resolveFx(th: CardTheme, tier: CardTier, { motionOn, hot }: CardFxInput) {
  return {
    foil: motionOn && tier >= 4 && !th.inferno,
    pulse: motionOn && (tier >= 2 || hot),
    sweep: motionOn,
    tilt: motionOn,
    flip: motionOn,
    /** Hardlight synthwave grid: drawn static when motion is off. */
    grid: th.future === 'grid',
    gridAnimated: motionOn && th.future === 'grid',
    scan: motionOn && th.future === 'grid',
  }
}
