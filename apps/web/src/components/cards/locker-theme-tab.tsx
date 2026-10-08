'use client'

import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { PlayerCard } from './player-card'
import { CARD_THEMES } from './card-themes'
import { swatchStyle } from './card-style'
import { swatchThumb } from './card-assets'
import type { CardViewModel } from './card-model'
import {
  lockerPreviewCard,
  type LockerRequirement,
  type LockerTheme,
  type LockerView,
} from './locker-model'

/** Theme tab: browse all 10 themes on this player's card (read-only). */
export function LockerThemeTab({
  card,
  view,
  index,
  onSelect,
  onStep,
}: {
  card: CardViewModel
  view: LockerView
  index: number
  onSelect: (i: number) => void
  onStep: (delta: number) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)

  // Keep the selected swatch centred in the rail (a phone shows about 5 of the 10).
  useEffect(() => {
    const rail = railRef.current
    const el = rail?.children[index]
    if (!rail || !(el instanceof HTMLElement)) return
    rail.scrollTo({ left: el.offsetLeft - (rail.clientWidth - el.offsetWidth) / 2 })
    // ←/→ while a swatch has focus: move the focus ring with the selection.
    if (rail.contains(document.activeElement) && document.activeElement !== el) {
      el.focus({ preventScroll: true })
    }
  }, [index])

  const browse = view.themes[index] ?? view.themes[0]
  if (browse === undefined) return null
  const locked = browse.status === 'locked'

  return (
    <>
      <div className="clk-stage">
        <div className="clk-viewer">
          <button
            type="button"
            className="clk-icon-btn clk-arrow"
            aria-label="Previous theme"
            onClick={() => {
              onStep(-1)
            }}
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
          <div className="clk-preview" data-locked={locked}>
            {/* 'hero' animates while on screen; with no back face it never flips. */}
            <PlayerCard key={browse.key} card={lockerPreviewCard(card, browse)} context="hero" />
          </div>
          <button
            type="button"
            className="clk-icon-btn clk-arrow"
            aria-label="Next theme"
            onClick={() => {
              onStep(1)
            }}
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
        <div className="clk-info" aria-live="polite">
          <div className="clk-info-head">
            <h3 className="clk-name">{browse.name}</h3>
            <span className="clk-tag" data-status={browse.status}>
              {browse.tag}
            </span>
          </div>
          {locked && <RequirementBlock req={view.requirement} extra={browse.unlockNote} />}
          {browse.status === 'unlocked' && (
            <p className="clk-note">Equipping arrives with member logins.</p>
          )}
        </div>
      </div>
      <div className="clk-railwrap">
        <div ref={railRef} className="clk-rail" role="group" aria-label="Themes">
          {view.themes.map((t, i) => {
            const label = `${t.name} · T${String(t.tier)}${t.status === 'locked' ? ' · locked' : ''}`
            return (
              <button
                key={t.key}
                type="button"
                className="clk-swatch"
                aria-pressed={i === index}
                aria-label={label}
                title={label}
                data-locked={t.status === 'locked'}
                onClick={() => {
                  onSelect(i)
                }}
              >
                <span
                  className="clk-swatch-tile"
                  style={swatchStyle(CARD_THEMES[t.key], swatchThumb(t.key))}
                />
                {t.status === 'locked' && (
                  <Lock className="clk-swatch-lock" size={14} aria-hidden />
                )}
                <span className="clk-swatch-label">{t.short}</span>
                <span className="clk-dot" data-on={t.status === 'equipped'} aria-hidden />
              </button>
            )
          })}
        </div>
        <div className="clk-legend">
          <span className="clk-legend-eq">
            <span className="clk-dot" data-on="true" aria-hidden />
            EQUIPPED
          </span>
          <span>T1–T5 · ONE THEME PER TIER</span>
          <span>T6 · FIVE MYTHICS</span>
        </div>
      </div>
    </>
  )
}

function RequirementBlock({ req, extra }: { req: LockerRequirement; extra: string | null }) {
  return (
    <div className="clk-req">
      <div className="clk-req-head">
        <span className="clk-req-title">{req.title}</span>
        <span className="clk-req-count">{req.count}</span>
      </div>
      {req.pct !== null && (
        <span className="clk-bar">
          <span style={{ width: `${String(req.pct)}%` }} />
        </span>
      )}
      <p className="clk-note">{extra === null ? req.note : `${req.note} ${extra}`}</p>
    </div>
  )
}

/** Footer: everything shown, nothing enabled until member logins (D1/D10). */
export function LockerThemeFooter({ theme, onClose }: { theme: LockerTheme; onClose: () => void }) {
  return (
    <div className="clk-foot">
      <button
        type="button"
        className="clk-auto"
        aria-pressed="true"
        disabled
        title="Equipping arrives with member logins"
      >
        <span className="clk-auto-box" aria-hidden />
        AUTO · FOLLOW TIER
      </button>
      <div className="clk-actions">
        <button type="button" className="clk-btn" onClick={onClose}>
          CLOSE
        </button>
        <button
          type="button"
          className="clk-primary"
          disabled
          title={theme.status === 'unlocked' ? 'Equipping arrives with member logins' : undefined}
        >
          {theme.action}
        </button>
      </div>
    </div>
  )
}
