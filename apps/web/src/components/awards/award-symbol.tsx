import type { CSSProperties } from 'react'
import type { AwardStat, AwardSymbolKind, AwardTier } from './awards-model'
import './award-symbol.css'

/**
 * One award's symbol on an 84×72 box — port of Award Symbol.dc.html. The
 * points trophy reuses that file's stepped "versatile" tower.
 */

const STAT_LABEL: Record<AwardStat, string> = {
  G: 'GOALS',
  A: 'ASSISTS',
  PTS: 'POINTS',
  GP: 'GAMES',
  W: 'WINS',
  SO: 'SHUTOUTS',
}

const METAL: Record<AwardTier, CSSProperties> = {
  bronze: {
    '--as-edge': '#8a5a3b',
    '--as-rivet': '#c98b5e',
    '--as-plate': 'linear-gradient(90deg,#6e4529,#d89a6a 45%,#a8693f 65%,#6e4529)',
  } as CSSProperties,
  silver: {
    '--as-edge': '#71717a',
    '--as-rivet': '#a1a1aa',
    '--as-plate': 'linear-gradient(90deg,#71717a,#e4e4e7 45%,#a1a1aa 65%,#71717a)',
  } as CSSProperties,
  gold: {
    '--as-edge': '#a8842c',
    '--as-rivet': '#e2be5c',
    '--as-plate': 'linear-gradient(90deg,#8a6a1c,#f2d27a 45%,#c9a23e 65%,#8a6a1c)',
  } as CSSProperties,
}

interface AwardSymbolProps {
  symbol: AwardSymbolKind
  glyph: string
  stat: AwardStat | null
  tier: AwardTier | null
}

/** Trophy stem, foot and name plate shared by the club trophies. */
function Base({
  stem,
  foot,
  label,
  thin = false,
}: {
  stem: number
  foot: number
  label: string
  thin?: boolean
}) {
  return (
    <>
      <div className="as-tr-stem" style={{ height: stem, width: thin ? 5 : 6 }} />
      <div className="as-tr-foot" style={{ width: foot }} />
      <div className="as-tr-plate">
        <span>{label}</span>
      </div>
    </>
  )
}

export function AwardSymbol({ symbol, glyph, stat, tier }: AwardSymbolProps) {
  const statLabel = stat === null ? '' : STAT_LABEL[stat]
  return (
    <div className="as" aria-hidden>
      {symbol === 'mvp' && (
        <div className="as-tr">
          <div className="as-mvp-cup">
            <div className="as-mvp-handle as-mvp-handle-l" />
            <div className="as-mvp-handle as-mvp-handle-r" />
            <div className="as-mvp-bowl" />
            <div className="as-mvp-band" />
          </div>
          <Base stem={9} foot={18} label="MVP" />
        </div>
      )}
      {symbol === 'scorer' && (
        <div className="as-tr">
          <div className="as-sc-puck" />
          <div className="as-sc-rim" />
          <div className="as-sc-cone" />
          <Base stem={8} foot={18} label="G" />
        </div>
      )}
      {symbol === 'assist' && (
        <div className="as-tr">
          <div className="as-as-lip" />
          <div className="as-as-dish" />
          <div className="as-as-band" />
          <Base stem={16} foot={18} label="A" thin />
        </div>
      )}
      {symbol === 'points' && (
        <div className="as-tr" style={{ gap: 2 }}>
          <div className="as-pt-gem" />
          <div className="as-pt-step" style={{ width: 12 }} />
          <div className="as-pt-step" style={{ width: 18 }} />
          <div className="as-pt-step" style={{ width: 24 }} />
          <div className="as-tr-plate">
            <span>PTS</span>
          </div>
        </div>
      )}
      {symbol === 'defense' && (
        <div className="as-tr">
          <div className="as-df-shield">
            <div className="as-df-inner" />
            <div className="as-df-bar" />
          </div>
          <Base stem={6} foot={18} label="DEF" />
        </div>
      )}
      {symbol === 'rookie' && (
        <div className="as-tr">
          <div className="as-ry-star" />
          <div className="as-ry-cup" />
          <Base stem={8} foot={14} label="ROY" thin />
        </div>
      )}
      {symbol === 'banner-3s' && (
        <div className="as-b3">
          <div className="as-b3-rod" />
          <div className="as-b3-edge">
            <div className="as-b3-face">
              <span className="as-b3-mode">3V3</span>
              <span className="as-b3-glyph">{glyph}</span>
              <span className="as-b3-word">CHAMPS</span>
            </div>
          </div>
        </div>
      )}
      {symbol === 'banner-arcade' && (
        <div className="as-ba">
          <div className="as-ba-knob" />
          <div className="as-ba-pole" />
          <div className="as-ba-edge">
            <div className="as-ba-face">
              <div className="as-ba-tag">
                <span>ARCADE</span>
              </div>
              <span className="as-ba-glyph">{glyph}</span>
            </div>
          </div>
        </div>
      )}
      {symbol === 'milestone' && (
        <div className="as-ms" style={METAL[tier ?? 'silver']}>
          <div className="as-ms-face">
            <span className="as-ms-rivet" style={{ left: 6, top: 6 }} />
            <span className="as-ms-rivet" style={{ right: 6, top: 6 }} />
            <span className="as-ms-rivet" style={{ left: 6, bottom: 6 }} />
            <span className="as-ms-rivet" style={{ right: 6, bottom: 6 }} />
            <span className="as-ms-glyph">{glyph}</span>
            <span className="as-ms-bar" />
            <span className="as-ms-plate">{statLabel}</span>
          </div>
        </div>
      )}
      {symbol === 'record' && (
        <div className="as-rec">
          <div className="as-rec-head">
            <span>SEASON</span>
          </div>
          <span className="as-rec-glyph">{glyph}</span>
          <span className="as-rec-word">RECORD</span>
          <span className="as-rec-stat">{statLabel}</span>
        </div>
      )}
      {symbol === 'alltime' && (
        <div className="as-at">
          <div className="as-at-rim">
            <div className="as-at-face">
              <div className="as-at-star" />
              <span className="as-at-word">ALL-TIME</span>
              <span className="as-at-glyph">{glyph}</span>
              <span className="as-at-stat">{statLabel}</span>
            </div>
          </div>
          <div className="as-at-step1" />
          <div className="as-at-step2" />
        </div>
      )}
    </div>
  )
}
