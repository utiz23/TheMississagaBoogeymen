import Link from 'next/link'
import { useId, type CSSProperties, type ReactNode } from 'react'
import { PlatformIcon } from '@/components/player-meta-icons'
import { CARD_THEMES } from './card-themes'
import { cardLook } from './card-style'
import type { CardFront } from './card-model'
import type { CardTheme } from './card-theme-types'
import { HardlightPortrait } from './fx/hardlight'
import { InfernoPortrait } from './fx/inferno'
import { OlympusPortrait } from './fx/olympus'
import { TraceFrame, TraceStats } from './fx/cyber'
import { cardAsset } from './card-assets'
import './player-card.css'
import './player-card-compact.css'

export type CompactCardSize = 'medium' | 'small' | 'micro'

interface PlayerCardCompactProps {
  card: CardFront
  /** medium 176×252 (4-stat row) · small 115×168 (name + lead stat) · micro 67×94 (number + lead stat). */
  size: CompactCardSize
  /** List cards link to the player page. */
  href?: string
}

/**
 * The compact player card (PlayerCardCompact.dc.html) for the tight layouts:
 * depth chart below desktop and the profile-hero slot on phones. Same theme
 * data as the full card (cardLook), static look only — no hooks besides
 * useId, so it renders on the server. Hover (lift, red rule/rim) is CSS.
 * Effects kept: gloss, synthwave grid, inferno sigil, olympus rays, cyber
 * traces, storm arc frame and ice panel, all drawn still.
 */
export function PlayerCardCompact({ card, size, href }: PlayerCardCompactProps) {
  const uid = `pcc${useId().replace(/[^\w-]/g, '')}`
  const th = CARD_THEMES[card.theme]
  const lookIn = {
    tier: card.tier,
    level: card.level,
    role: card.role,
    position: card.position,
  }
  const look = cardLook(th, { ...lookIn, hot: false })
  const hotLook = cardLook(th, { ...lookIn, hot: true })
  const home = card.theme === 'home'
  // The compact spec leads with SV% for goalies (the full card's 4th stat is W).
  const leadIdx = card.role === 'goalie' ? 1 : 3
  const lead = card.stats[leadIdx]

  const rootStyle = {
    background: look.cardBg,
    color: th.tk.ink,
    '--pcc-border': look.border,
    '--pcc-border-hot': hotLook.border,
    '--pcc-shadow': `0 1px 0 rgba(255,255,255,0.02) inset, 0 6px 16px rgba(0,0,0,0.35)${th.shadow}`,
    '--pcc-shadow-hot': `0 1px 0 rgba(255,255,255,0.04) inset, 0 10px 24px rgba(0,0,0,0.45), 0 0 24px rgba(232,65,49,0.20)${th.shadow}`,
    '--pcc-rule': look.ruleBg,
    '--pcc-rule-hot': hotLook.ruleBg,
  } as CSSProperties

  const pos =
    card.position === null ? null : (
      <span
        className="pcc-pos"
        style={{
          border: `1px solid ${look.posBorder}`,
          background: look.posBg,
          color: look.posColor,
        }}
      >
        {card.position}
      </span>
    )
  const portrait: CSSProperties = {
    background: th.portrait,
    boxShadow: `inset 0 0 0 1px ${(home ? 'rgba(255,255,255,0.06)' : th.innerRim) ?? 'rgba(255,255,255,0.03)'}`,
  }
  const silh = (
    <svg
      viewBox="0 0 100 110"
      fill="currentColor"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
      className="pcc-silh"
      style={{ color: home ? '#323034' : th.silh }}
    >
      <circle cx="50" cy="32" r="21" />
      <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
    </svg>
  )
  const portraitFx = (
    <>
      {th.future === 'grid' && <HardlightPortrait uid={uid} animated={false} />}
      {th.inferno === true && <InfernoPortrait on={false} />}
      {th.olympus === true && <OlympusPortrait on={false} />}
    </>
  )
  const jerseyStyle = (cut: number): CSSProperties => ({
    background: th.jersey,
    boxShadow: look.jerseyEdge,
    clipPath: th.jerseyClip
      ? `polygon(0 0, 100% 0, 100% calc(100% - ${String(cut)}px), calc(100% - ${String(cut)}px) 100%, 0 100%)`
      : 'none',
  })
  const portraitClip = (cut: number) =>
    th.clip
      ? `polygon(0 0, 100% 0, 100% calc(100% - ${String(cut)}px), calc(100% - ${String(cut)}px) 100%, 0 100%)`
      : 'none'
  const num = (
    <span className="pcc-num" style={{ color: th.num, textShadow: th.numGlow ?? 'none' }}>
      {card.jersey}
    </span>
  )
  const meander =
    th.meander !== undefined ? (
      <div className="pcc-meander" style={{ backgroundImage: th.meander }} />
    ) : null
  const panelFx = (radius: number): ReactNode => (
    <>
      {th.traces !== undefined && <TraceFrame traces={th.traces} on={false} />}
      {th.arc !== undefined && <ArcPanel arc={th.arc} />}
      {th.icePanel === true && <IcePanelStill radius={radius} />}
    </>
  )

  let body: ReactNode
  if (size === 'medium') {
    const framed = th.traces !== undefined || th.icePanel === true || th.arc !== undefined
    const pl = th.plates ?? null
    body = (
      <>
        <div className="pcc-jersey" style={jerseyStyle(11)}>
          {num}
          {pos}
        </div>
        <div className="pcc-portrait" style={{ ...portrait, clipPath: portraitClip(15) }}>
          {portraitFx}
          {silh}
          <span
            className="pcc-chip"
            style={{
              border: `1px solid ${look.chip.b}`,
              background: look.chip.bg,
              color: look.chip.c,
            }}
          >
            {look.chipText}
          </span>
        </div>
        {meander}
        <div className="pcc-panel" style={{ margin: framed ? '0 8px 8px' : '0' }}>
          {panelFx(9)}
          <div className="pcc-name-row">
            <span className="pcc-plat">
              <PlatformIcon platform={card.platform} />
            </span>
            <span className="pcc-name" style={{ textShadow: th.nameGlow ?? 'none' }}>
              {card.name}
            </span>
          </div>
          <div className="pcc-stat-wrap">
            {th.traces !== undefined && <TraceStats traces={th.traces} on={false} />}
            <div
              className="pcc-stats"
              style={{
                margin: th.icePanel === true || th.arc ? '0 6px' : th.traces ? '0' : '0 8px',
                gap: pl ? '3px' : '0',
                padding: pl ? '8px 0 10px' : th.icePanel === true ? '8px 0 9px' : '8px 0 11px',
                borderTop: pl || framed ? 'none' : `1px solid ${th.tk.line}`,
              }}
            >
              {card.stats.map((stat, i) => (
                <MediumStat key={stat.label} th={th} i={i} lead={i === leadIdx} {...stat} />
              ))}
            </div>
          </div>
        </div>
      </>
    )
  } else if (size === 'small') {
    const plated = (th.inferno === true || th.olympus === true) && th.plates
    const pl = plated ? th.plates : null
    body = (
      <>
        <div className="pcc-jersey" style={jerseyStyle(8)}>
          {num}
          {pos}
        </div>
        <div className="pcc-portrait" style={{ ...portrait, clipPath: portraitClip(10) }}>
          {portraitFx}
          {silh}
        </div>
        {meander}
        <div
          className="pcc-panel"
          style={{
            margin: th.traces || th.icePanel || th.arc ? '0 6px 6px' : '0',
            padding:
              th.icePanel === true || th.arc
                ? '7px 6px 6px'
                : th.traces
                  ? '6px 6px 7px'
                  : '7px 6px 8px',
          }}
        >
          {panelFx(7)}
          <span className="pcc-name" style={{ textShadow: th.nameGlow ?? 'none' }}>
            {card.name}
          </span>
          {lead !== undefined && (
            <span
              className="pcc-lead"
              style={{
                padding: pl ? '5px 0 5px' : '5px 0 0',
                borderTop: pl
                  ? 'none'
                  : `1px solid ${
                      th.arc
                        ? th.arc.line
                        : th.icePanel === true
                          ? 'rgba(210,238,250,0.35)'
                          : th.traces
                            ? th.traces.line
                            : th.tk.line
                    }`,
                background: pl ? pl.lead : 'transparent',
                boxShadow: pl ? pl.leadSh : 'none',
                clipPath:
                  th.inferno === true
                    ? 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)'
                    : 'none',
              }}
            >
              <b
                style={{
                  color: pl ? pl.leadV : th.tk.lead,
                  textShadow: th.plates?.glow ?? 'none',
                }}
              >
                {lead.value}
              </b>
              <span style={{ color: pl ? pl.leadL : th.tk.leadL }}>{lead.label}</span>
            </span>
          )}
        </div>
      </>
    )
  } else {
    body = (
      <>
        <div className="pcc-micro-head">
          <div className="pcc-jersey" style={jerseyStyle(6)}>
            {num}
          </div>
          {pos}
        </div>
        {th.future === 'grid' && (
          <div aria-hidden className="pcc-micro-grid">
            <HardlightPortrait uid={uid} animated={false} />
          </div>
        )}
        {(th.frost === true || th.inferno === true || th.storm === true) && (
          <div
            aria-hidden
            className="pcc-rim"
            style={{
              boxShadow: th.frost
                ? 'inset 0 0 12px 1px rgba(210,240,252,0.4), inset 0 0 2px 1px rgba(255,255,255,0.6)'
                : th.inferno
                  ? 'inset 0 0 12px 1px rgba(255,80,20,0.28), inset 0 0 2px 1px rgba(255,200,160,0.35)'
                  : 'inset 0 0 12px 1px rgba(111,182,255,0.32), inset 0 0 2px 1px rgba(240,248,255,0.5)',
            }}
          />
        )}
        {meander}
        {lead !== undefined && <MicroFoot th={th} meander={meander !== null} lead={lead} />}
      </>
    )
  }

  const root = (
    <div className="pcc" data-size={size} data-theme={card.theme} style={rootStyle}>
      <div className="pcc-rule" />
      {th.inferno === true && size !== 'micro' && (
        <div
          aria-hidden
          className="pcc-rim"
          style={{
            boxShadow:
              'inset 0 0 18px 1px rgba(255,80,20,0.22), inset 0 0 6px 1px rgba(255,140,60,0.22), inset 0 0 2px 1px rgba(255,200,160,0.35)',
          }}
        />
      )}
      {th.gloss === true && <div aria-hidden className="pcc-gloss" />}
      {body}
    </div>
  )

  if (href === undefined) return root
  return (
    <Link prefetch href={href} className="pcc-link" aria-label={`${card.name} — player page`}>
      {root}
    </Link>
  )
}

function MediumStat({
  th,
  i,
  lead,
  label,
  value,
}: {
  th: CardTheme
  i: number
  lead: boolean
  label: string
  value: string
}) {
  const pl = th.plates ?? null
  const tk = th.tk
  const sep = i > 0 && !pl && th.icePanel !== true && !th.traces && !th.arc
  const gem = i > 0 && th.icePanel === true
  return (
    <div
      className="pcc-stat"
      style={{
        padding: pl ? '4px 0 5px' : '0',
        borderRadius: th.inferno === true ? '0' : '3px',
        clipPath: pl && pl.clip !== 'none' ? pl.clip.replace(/7px/g, '5px') : 'none',
        background: pl ? (lead ? pl.lead : pl.bg) : 'transparent',
        boxShadow: pl ? (lead ? pl.leadSh : pl.sh) : 'none',
      }}
    >
      {sep && <div className="pcc-stat-sep" style={{ background: tk.line }} />}
      {gem && <div className="pcc-stat-gem" />}
      <span
        className="pcc-stat-k"
        style={{ color: pl ? (lead ? pl.leadL : pl.lc) : lead ? tk.leadL : tk.sl }}
      >
        {label}
      </span>
      <span
        className="pcc-stat-v"
        style={{
          fontSize: lead ? '17px' : '15px',
          color: pl ? (lead ? pl.leadV : pl.vc) : lead ? tk.lead : tk.sv,
          textShadow: pl ? ((lead ? pl.glowLead : pl.glow) ?? 'none') : 'none',
        }}
      >
        {value}
      </span>
    </div>
  )
}

/** Micro footer: lead stat label + value (the prototype's mFoot). */
function MicroFoot({
  th,
  meander,
  lead,
}: {
  th: CardTheme
  meander: boolean
  lead: { label: string; value: string }
}) {
  const tk = th.tk
  const s = {
    margin: 'auto 0 0',
    borderTop: `1px solid ${tk.line}`,
    borderRadius: '0',
    background: 'transparent',
    boxShadow: 'none',
    clipPath: 'none',
    padding: '3px 5px 4px',
    kc: tk.leadL,
    vc: tk.lead,
    ts: 'none',
  }
  const inset = {
    margin: `${meander ? '3px' : 'auto'} 4px 4px`,
    borderTop: 'none',
    padding: '3px 4px 3px',
  }
  const pl = th.plates ?? null
  if ((th.future === 'grid' || th.inferno === true || th.olympus === true) && pl) {
    Object.assign(s, inset, {
      borderRadius: th.inferno ? '0' : (pl.radius ?? '3px'),
      clipPath: th.inferno
        ? 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)'
        : 'none',
      background: pl.lead,
      boxShadow: pl.leadSh,
      kc: pl.leadL,
      vc: pl.leadV,
      ts: pl.glowLead ?? 'none',
    })
  } else if (th.arc) {
    Object.assign(s, inset, {
      padding: '3px 5px 3px',
      kc: '#cfeaff',
      vc: '#f2faff',
      ts: `0 0 6px ${th.arc.glow}`,
    })
  } else if (th.icePanel === true) {
    Object.assign(s, inset, {
      borderRadius: '5px',
      background:
        'radial-gradient(60% 60% at 0% 100%, rgba(230,246,255,0.26), transparent 70%), radial-gradient(60% 60% at 100% 100%, rgba(230,246,255,0.26), transparent 70%), rgba(6,14,20,0.35)',
      boxShadow:
        'inset 0 0 10px rgba(220,240,252,0.28), inset 0 0 1px rgba(255,255,255,0.6), inset 0 1px 0 rgba(255,255,255,0.65)',
    })
  } else if (th.traces) {
    Object.assign(s, inset, {
      padding: '3px 5px 3px',
      vc: th.traces.hot,
      ts: `0 0 6px ${th.traces.hot}`,
    })
  }
  const { kc, vc, ts, ...box } = s
  return (
    <div className="pcc-foot" style={box}>
      {th.traces !== undefined && <TraceFrame traces={th.traces} on={false} />}
      <span className="pcc-foot-k" style={{ color: kc }}>
        {lead.label}
      </span>
      <b className="pcc-foot-v" style={{ color: vc, textShadow: ts }}>
        {lead.value}
      </b>
    </div>
  )
}

/** Storm arc frame, still: the chamfered panel without the animated bolts. */
function ArcPanel({ arc }: { arc: NonNullable<CardTheme['arc']> }) {
  const ch = 5
  const pts = `${String(ch)},0 ${String(240 - ch)},0 240,${String(ch)} 240,${String(200 - ch)} ${String(240 - ch)},200 ${String(ch)},200 0,${String(200 - ch)} 0,${String(ch)}`
  return (
    <svg aria-hidden viewBox="0 0 240 200" preserveAspectRatio="none" className="pcc-fx-under">
      <polygon
        points={pts}
        fill="rgba(8,16,32,0.55)"
        stroke={arc.line}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={pts} fill={arc.fill} />
    </svg>
  )
}

/** Frozen ice panel, still (the prototype's compact isIce block). */
function IcePanelStill({ radius }: { radius: number }) {
  return (
    <div aria-hidden className="pcc-ice" style={{ borderRadius: `${String(radius)}px` }}>
      <div
        className="pcc-ice-cracks"
        style={{ backgroundImage: `url("${cardAsset('ice-cracks.avif')}")` }}
      />
    </div>
  )
}
