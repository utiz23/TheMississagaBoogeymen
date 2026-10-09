import type { CSSProperties } from 'react'
import type { AwardKind, AwardStat, AwardTier } from './awards-model'
import './award-symbol.css'

/**
 * One award's symbol on an 84×72 box — port of Award Symbol.dc.html. Only the
 * stat-derived kinds are ported; the club-trophy and banner symbols in that
 * file wait for a data source.
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
  kind: AwardKind
  glyph: string
  stat: AwardStat
  tier: AwardTier | null
}

export function AwardSymbol({ kind, glyph, stat, tier }: AwardSymbolProps) {
  return (
    <div className="as" aria-hidden>
      {kind === 'milestone' && (
        <div className="as-ms" style={METAL[tier ?? 'silver']}>
          <div className="as-ms-face">
            <span className="as-ms-rivet" style={{ left: 6, top: 6 }} />
            <span className="as-ms-rivet" style={{ right: 6, top: 6 }} />
            <span className="as-ms-rivet" style={{ left: 6, bottom: 6 }} />
            <span className="as-ms-rivet" style={{ right: 6, bottom: 6 }} />
            <span className="as-ms-glyph">{glyph}</span>
            <span className="as-ms-bar" />
            <span className="as-ms-plate">{STAT_LABEL[stat]}</span>
          </div>
        </div>
      )}
      {kind === 'record' && (
        <div className="as-rec">
          <div className="as-rec-head">
            <span>SEASON</span>
          </div>
          <span className="as-rec-glyph">{glyph}</span>
          <span className="as-rec-word">RECORD</span>
          <span className="as-rec-stat">{STAT_LABEL[stat]}</span>
        </div>
      )}
      {kind === 'alltime' && (
        <div className="as-at">
          <div className="as-at-rim">
            <div className="as-at-face">
              <div className="as-at-star" />
              <span className="as-at-word">ALL-TIME</span>
              <span className="as-at-glyph">{glyph}</span>
              <span className="as-at-stat">{STAT_LABEL[stat]}</span>
            </div>
          </div>
          <div className="as-at-step1" />
          <div className="as-at-step2" />
        </div>
      )}
    </div>
  )
}
