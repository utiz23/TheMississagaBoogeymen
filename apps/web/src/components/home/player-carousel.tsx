'use client'

import { useState } from 'react'
import { PlayerCard } from './player-card'
import type { RosterRow } from './player-card'

interface PlayerCarouselProps {
  players: RosterRow[]
  /** Club win% string forwarded to each PlayerCard's zone A. */
  winPct?: string | undefined
}

/**
 * Stacked 3D carousel for featured player cards.
 *
 * Desktop: 5-slot depth layout — center card at full scale, side cards
 * scaled down and faded, back cards smaller still. Side/back cards can be
 * clicked to bring them forward. Vignette masks on edges create depth.
 *
 * Mobile: single card with previous/next arrow navigation.
 *
 * All player data is fetched server-side; this component is Client-only
 * for interactivity (activeIndex state + transitions).
 */
export function PlayerCarousel({ players, winPct }: PlayerCarouselProps) {
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
        {/* Stage — fixed height, overflow hidden to clip side cards */}
        <div
          className="relative h-[400px] overflow-hidden"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
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

          {/* Cards */}
          {players.map((player, index) => {
            const rel = getRelPos(index, activeIndex, total)
            const cfg = SLOT_CONFIG[rel]
            // Hide cards beyond ±2 positions
            if (cfg === undefined) return null

            const isActive = rel === 0

            return (
              <div
                key={player.playerId}
                className="absolute"
                style={{
                  top: '50%',
                  left: '50%',
                  transform: `translateX(calc(-50% + ${cfg.x.toString()}px)) translateY(calc(-50% + ${cfg.y.toString()}px)) scale(${cfg.scale.toString()})`,
                  opacity: cfg.opacity,
                  zIndex: cfg.zIndex,
                  transition: 'transform 350ms ease-in-out, opacity 350ms ease-in-out',
                  cursor: isActive ? 'default' : 'pointer',
                }}
              >
                {/* Pointer-events blocker for non-active cards — prevents
                    the Link inside PlayerCard from navigating on click.
                    The outer div catches the click to advance the carousel. */}
                <div
                  style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                  onClick={
                    !isActive
                      ? () => {
                          setActiveIndex(index)
                        }
                      : undefined
                  }
                >
                  <PlayerCard player={player} isActive={isActive} winPct={winPct} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Controls — thin-bar indicators + player label + arrows */}
        <div className="mt-4 flex flex-col items-center gap-2">
          {/* Thin-bar indicators */}
          <div className="flex items-center gap-1.5" role="tablist">
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
                className={[
                  'rounded-full transition-all duration-300',
                  i === activeIndex
                    ? 'h-0.5 w-6 bg-accent'
                    : 'h-0.5 w-3 bg-zinc-700 hover:bg-zinc-500',
                ].join(' ')}
              />
            ))}
          </div>

          {/* Player label + flanking arrows */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={prev}
              aria-label="Previous player"
              className="flex h-8 w-8 items-center justify-center border border-zinc-800 text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-200"
            >
              <ChevronLeft />
            </button>

            <span className="min-w-[140px] text-center font-condensed text-sm font-black uppercase tracking-wider text-zinc-300">
              {players[activeIndex]?.gamertag ?? ''}
            </span>

            <button
              type="button"
              onClick={next}
              aria-label="Next player"
              className="flex h-8 w-8 items-center justify-center border border-zinc-800 text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-200"
            >
              <ChevronRight />
            </button>
          </div>
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
              <PlayerCard player={players[activeIndex]} isActive winPct={winPct} />
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
  y: number
  scale: number
  opacity: number
  zIndex: number
}

/**
 * V-formation slot values.
 * rel 0 = center hero; ±1 = inner flanks; ±2 = outer flanks.
 * Y offset shifts outer cards downward so card tops form a V — podium silhouette.
 * Cards at |rel| > 2 are hidden (cfg returns undefined).
 */
const SLOT_CONFIG: Record<number, SlotConfig> = {
  [-2]: { x: -280, y: 56, scale: 0.65, opacity: 0.28, zIndex: 2 },
  [-1]: { x: -148, y: 26, scale: 0.82, opacity: 0.58, zIndex: 5 },
  [0]: { x: 0, y: 0, scale: 1.0, opacity: 1.0, zIndex: 10 },
  [1]: { x: 148, y: 26, scale: 0.82, opacity: 0.58, zIndex: 5 },
  [2]: { x: 280, y: 56, scale: 0.65, opacity: 0.28, zIndex: 2 },
}

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
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M9 11L5 7l4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M5 11l4-4-4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
