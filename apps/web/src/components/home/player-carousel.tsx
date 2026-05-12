'use client'

import { useState } from 'react'
import { PlayerCard } from './player-card'
import type { RosterRow } from './player-card'
import './player-carousel.css'

interface PlayerCarouselProps {
  players: RosterRow[]
}

/**
 * Stacked V-formation carousel for featured player cards.
 *
 * Desktop: 5-slot podium layout — center card at full scale, flanking cards
 * recede via scale + Y-offset. All 5 staged cards are fully opaque; opacity
 * animates only when a card enters or leaves the visible formation.
 * Clicking any non-center staged card promotes it to the front.
 *
 * Mobile: single card with arrow + swipe navigation.
 *
 * All player data is fetched server-side; this component is Client-only
 * for interactivity (activeIndex state + transitions).
 */
export function PlayerCarousel({ players }: PlayerCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [swipeStart, setSwipeStart] = useState<number | null>(null)
  const total = players.length

  if (total === 0) return null

  const prev = () => {
    setActiveIndex((i) => (i - 1 + total) % total)
  }
  const next = () => {
    setActiveIndex((i) => (i + 1) % total)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    setSwipeStart(e.touches[0]?.clientX ?? null)
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (swipeStart === null) return
    const delta = (e.changedTouches[0]?.clientX ?? swipeStart) - swipeStart
    if (Math.abs(delta) > 44) {
      if (delta < 0) next()
      else prev()
    }
    setSwipeStart(null)
  }

  return (
    <div
      className="select-none outline-none"
      role="region"
      aria-label="Featured players"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') prev()
        if (e.key === 'ArrowRight') next()
      }}
    >
      {/* ── Desktop: stacked depth carousel ─────────────────────────────── */}
      <div className="hidden sm:block">
        <div
          className="hpcr-stage"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* LIVE indicator — top-left of stage. The label updates with the
              active player so the chrome reads as a broadcast lower-third. */}
          <div className="hpcr-now-tag">
            <span className="live">Live</span>
            <span className="type">
              {players[activeIndex]?.gamertag ?? 'Player Spotlight'}
            </span>
          </div>
          {/* Side vignette masks — create the "cards fade into darkness" effect */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-20 w-36"
            style={{
              background: 'linear-gradient(to right, var(--color-background) 0%, transparent 100%)',
            }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-20 w-36"
            style={{
              background: 'linear-gradient(to left, var(--color-background) 0%, transparent 100%)',
            }}
          />

          {/* Cards — all rendered so CSS opacity transitions fire on enter/exit */}
          {players.map((player, index) => {
            const rel = getRelPos(index, activeIndex, total)
            // Visible slots use full opacity. Off-stage cards park at the nearest
            // outer position with opacity 0 so entering/leaving fades animate there.
            const cfg = SLOT_CONFIG[rel] ?? (rel < 0 ? HIDDEN_LEFT : HIDDEN_RIGHT)
            const visible = Math.abs(rel) <= 2
            const isActive = rel === 0

            return (
              <div
                key={player.playerId}
                className="absolute"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: `translateX(calc(-50% + ${cfg.x.toString()}px)) translateY(-50%) rotate(${cfg.rotate.toString()}deg) scale(${cfg.scale.toString()})`,
                  opacity: cfg.opacity,
                  zIndex: cfg.zIndex,
                  transition:
                    'transform 600ms cubic-bezier(0.22, 0.8, 0.2, 1), opacity 400ms ease',
                  cursor: !isActive && visible ? 'pointer' : 'default',
                  // Off-stage cards must not intercept clicks on visible cards below
                  pointerEvents: visible ? 'auto' : 'none',
                }}
                onClick={
                  !isActive && visible
                    ? () => {
                        setActiveIndex(index)
                      }
                    : undefined
                }
              >
                {/* Prevents the Link from navigating when the intent is to rotate.
                    The outer div owns the click; this inner div only blocks card-link events. */}
                <div style={{ pointerEvents: isActive ? 'auto' : 'none' }}>
                  <PlayerCard player={player} isActive={isActive} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Controls — arrow · progress bars · arrow (bundle pattern) */}
        <div className="hpcr-controls">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous player"
            className="hpcr-arrow"
          >
            <ChevronLeft />
          </button>

          <div className="hpcr-progress" role="tablist">
            {players.map((p, i) => (
              <button
                key={p.playerId}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                aria-label={`Show ${p.gamertag}`}
                onClick={() => {
                  setActiveIndex(i)
                }}
                className={`seg${i === activeIndex ? ' active' : i < activeIndex ? ' passed' : ''}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={next}
            aria-label="Next player"
            className="hpcr-arrow"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Index counter + keybind hint */}
        <div className="hpcr-meta">
          <span className="hpcr-index">
            <span className="now">{(activeIndex + 1).toString().padStart(2, '0')}</span>
            <span className="sep">/</span>
            <span>{total.toString().padStart(2, '0')}</span>
          </span>
          <span className="hpcr-index dim">⇠ ⇢ Arrow Keys · Click Peeks</span>
        </div>
      </div>

      {/* ── Mobile: single card + arrows ────────────────────────────────── */}
      <div className="sm:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous player"
            className="flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-700 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            <ChevronLeft />
          </button>

          <div
            className="flex flex-1 justify-center"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {players[activeIndex] && (
              <PlayerCard player={players[activeIndex]} isActive />
            )}
          </div>

          <button
            type="button"
            onClick={next}
            aria-label="Next player"
            className="flex h-9 w-9 shrink-0 items-center justify-center border border-zinc-700 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
          >
            <ChevronRight />
          </button>
        </div>

        {/* Thin-bar indicators + player label */}
        <div className="mt-3 flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5">
            {players.map((p, i) => (
              <button
                key={p.playerId}
                type="button"
                aria-label={`Show ${p.gamertag}`}
                onClick={() => {
                  setActiveIndex(i)
                }}
                className={[
                  'rounded-full transition-all duration-300',
                  i === activeIndex
                    ? 'h-0.5 w-6 bg-accent'
                    : 'h-0.5 w-3 bg-zinc-700 hover:bg-zinc-500',
                ].join(' ')}
              />
            ))}
          </div>
          <span className="font-condensed text-sm font-black uppercase tracking-wider text-zinc-400">
            {players[activeIndex]?.gamertag ?? ''}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Position config ──────────────────────────────────────────────────────────

interface SlotConfig {
  x: number
  rotate: number
  scale: number
  opacity: number
  zIndex: number
}

/**
 * Fan-layout slot values, ported from the bundle's
 * `components-card-carousel-v3.html`. Rotation + horizontal offset
 * + scale + opacity falloff create the deck-shuffle look. No vertical
 * offset — all cards are vertically centered.
 *   rel 0  → center hero (full scale, no rotate)
 *   rel ±1 → inner peeks  (scale 0.86, ±8°,  ±250px, opacity 0.55)
 *   rel ±2 → outer peeks  (scale 0.72, ±14°, ±440px, opacity 0.22)
 */
const SLOT_CONFIG: Record<number, SlotConfig> = {
  [-2]: { x: -440, rotate: -14, scale: 0.72, opacity: 0.22, zIndex: 10 },
  [-1]: { x: -250, rotate: -8, scale: 0.86, opacity: 0.55, zIndex: 20 },
  [0]: { x: 0, rotate: 0, scale: 1.0, opacity: 1.0, zIndex: 30 },
  [1]: { x: 250, rotate: 8, scale: 0.86, opacity: 0.55, zIndex: 20 },
  [2]: { x: 440, rotate: 14, scale: 0.72, opacity: 0.22, zIndex: 10 },
}

/**
 * Off-stage holding positions — parked further out at scale 0.6 with full
 * tilt and opacity 0 so cards fade out at the outer edge as they exit.
 */
const HIDDEN_LEFT: SlotConfig = { x: -620, rotate: -18, scale: 0.6, opacity: 0, zIndex: 0 }
const HIDDEN_RIGHT: SlotConfig = { x: 620, rotate: 18, scale: 0.6, opacity: 0, zIndex: 0 }

/**
 * Compute the relative position of a card from the active index.
 * Wraps circularly so the nearest path (left or right) is chosen.
 */
function getRelPos(index: number, activeIndex: number, total: number): number {
  let rel = index - activeIndex
  // Wrap to the shorter arc
  if (rel > total / 2) rel -= total
  if (rel < -(total / 2)) rel += total
  return rel
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function ChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
