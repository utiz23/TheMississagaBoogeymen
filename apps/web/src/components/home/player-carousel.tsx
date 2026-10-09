'use client'

import { useRef, useState, type PointerEvent } from 'react'
import { PlayerCard } from '@/components/cards/player-card'
import { PlayerCardCompact, type CompactCardSize } from '@/components/cards/player-card-compact'
import type { CardViewModel } from '@/components/cards/card-model'
import { colorForPosition } from '@/lib/position-colors'
import './player-carousel.css'

interface PlayerCarouselProps {
  cards: CardViewModel[]
}

/**
 * Stacked fan carousel for featured player cards.
 *
 * Desktop (>1100px): full player cards in a 5-slot fan — center card at full
 * scale, flanking cards recede via rotate + scale + opacity. Clicking any
 * non-center staged card promotes it to the front.
 *
 * Smaller screens use the compact card (Roster Carousel.dc.html), one fan per
 * tier, swapped by CSS (player-carousel.css) so nothing depends on JS sizing:
 *   Medium ≤1100 — 176px cards, LIVE tag + counter inside the stage
 *   Small  ≤720  — 115px cards, arrows · dots · name below
 *   Micro  ≤480  — 67px cards, a stat strip for the active player below
 *
 * All player data is fetched server-side; this component is Client-only
 * for interactivity (activeIndex state + transitions).
 */
export function PlayerCarousel({ cards }: PlayerCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const swipe = useRef<{ x: number | null; dragged: boolean }>({ x: null, dragged: false })
  const total = cards.length

  if (total === 0) return null

  const prev = () => {
    setActiveIndex((i) => (i - 1 + total) % total)
  }
  const next = () => {
    setActiveIndex((i) => (i + 1) % total)
  }

  // Pointer swipe for every stage; a drag past 30px rotates and swallows the
  // click that follows, so it doesn't also promote the card under the pointer.
  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, dragged: false }
  }
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current.x
    if (start === null) return
    swipe.current.x = null
    const dx = e.clientX - start
    if (Math.abs(dx) > 30) {
      swipe.current.dragged = true
      if (dx < 0) next()
      else prev()
      setTimeout(() => {
        swipe.current.dragged = false
      }, 0)
    }
  }
  const promote = (index: number) => {
    if (!swipe.current.dragged) setActiveIndex(index)
  }

  const active = cards[activeIndex]
  const now = (activeIndex + 1).toString().padStart(2, '0')
  const totalStr = total.toString().padStart(2, '0')

  const stageProps = {
    onPointerDown,
    onPointerUp,
    onPointerCancel: () => {
      swipe.current.x = null
    },
  }

  const dots = (
    <div className="hpcr-dots">
      {cards.map((c, i) => (
        <button
          key={c.front.playerId}
          type="button"
          aria-label={`Show ${c.front.name}`}
          aria-current={i === activeIndex ? 'true' : undefined}
          onClick={() => {
            setActiveIndex(i)
          }}
          className={i === activeIndex ? 'dot on' : 'dot'}
        />
      ))}
    </div>
  )

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
      <div className="hpcr-desktop">
        <div className="hpcr-stage" {...stageProps}>
          {/* LIVE indicator — top-left of stage. The label updates with the
              active player so the chrome reads as a broadcast lower-third. */}
          <div className="hpcr-now-tag">
            <span className="live">Live</span>
            <span className="type">{active?.front.name ?? 'Player Spotlight'}</span>
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
          {cards.map((card, index) => (
            <FanSlot
              key={card.front.playerId}
              rel={getRelPos(index, activeIndex, total)}
              fan={DESKTOP_FAN}
              onPromote={() => {
                promote(index)
              }}
            >
              {(isActive) => (
                <PlayerCard
                  card={card}
                  context="list"
                  active={isActive}
                  href={`/roster/${String(card.front.playerId)}`}
                />
              )}
            </FanSlot>
          ))}
        </div>

        {/* Controls — arrow · progress bars · arrow (bundle pattern) */}
        <div className="hpcr-controls">
          <button type="button" onClick={prev} aria-label="Previous player" className="hpcr-arrow">
            <ChevronLeft />
          </button>

          <div className="hpcr-progress">
            {cards.map((c, i) => (
              <button
                key={c.front.playerId}
                type="button"
                aria-current={i === activeIndex ? 'true' : undefined}
                aria-label={`Show ${c.front.name}`}
                onClick={() => {
                  setActiveIndex(i)
                }}
                className={`seg${i === activeIndex ? ' active' : i < activeIndex ? ' passed' : ''}`}
              />
            ))}
          </div>

          <button type="button" onClick={next} aria-label="Next player" className="hpcr-arrow">
            <ChevronRight />
          </button>
        </div>

        {/* Index counter + keybind hint */}
        <div className="hpcr-meta">
          <span className="hpcr-index">
            <span className="now">{now}</span>
            <span className="sep">/</span>
            <span>{totalStr}</span>
          </span>
          <span className="hpcr-index dim">⇠ ⇢ Arrow Keys · Click Peeks</span>
        </div>
      </div>

      {/* ── Medium: compact fan, chrome inside the stage ────────────────── */}
      <div className="hpcr-m">
        <div className="hpcr-cstage" {...stageProps}>
          <div className="hpcr-ctag">
            <span className="live">
              <i />
              Live
            </span>
            <span className="name">{active?.front.name ?? ''}</span>
          </div>
          <div className="hpcr-vig left" />
          <div className="hpcr-vig right" />
          <CompactFan
            cards={cards}
            activeIndex={activeIndex}
            fan={MEDIUM_FAN}
            size="medium"
            top="52%"
            onPromote={promote}
          />
          <div className="hpcr-cfoot">
            <span className="count">
              <b>{now}</b>
              <span>/</span>
              <span>{totalStr}</span>
            </span>
            <span>⇠ ⇢ Arrow keys · Click peeks</span>
          </div>
        </div>
      </div>

      {/* ── Small: compact fan · arrows, dots and name below ────────────── */}
      <div className="hpcr-s">
        <div className="hpcr-cstage" {...stageProps}>
          <div className="hpcr-vig left" />
          <div className="hpcr-vig right" />
          <CompactFan
            cards={cards}
            activeIndex={activeIndex}
            fan={SMALL_FAN}
            size="small"
            top="50%"
            onPromote={promote}
          />
        </div>
        <div className="hpcr-srow">
          <button type="button" onClick={prev} aria-label="Previous player" className="hpcr-sarrow">
            <ChevronLeft />
          </button>
          <div className="mid">
            {dots}
            <span className="name">{active?.front.name ?? ''}</span>
          </div>
          <button type="button" onClick={next} aria-label="Next player" className="hpcr-sarrow">
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* ── Micro: compact fan · stat strip for the active player ───────── */}
      <div className="hpcr-u">
        <div className="hpcr-cstage" {...stageProps}>
          <span className="hpcr-ucount">
            <b>{now}</b> / {totalStr}
          </span>
          <div className="hpcr-vig left" />
          <div className="hpcr-vig right" />
          <CompactFan
            cards={cards}
            activeIndex={activeIndex}
            fan={MICRO_FAN}
            size="micro"
            top="50%"
            onPromote={promote}
          />
        </div>
        {active !== undefined && (
          <div className="hpcr-strip">
            <div className="who">
              <div className="tags">
                <span className="num">#{active.front.jersey}</span>
                {active.front.position !== null && (
                  <span style={{ color: colorForPosition(active.front.position) }}>
                    {active.front.position}
                  </span>
                )}
                <span className="rec">{active.front.record}</span>
              </div>
              <span className="name">{active.front.name}</span>
            </div>
            <div className="line">
              {active.front.stats.map((st, i) => (
                <div key={st.label} className="st">
                  <span className="k">{st.label}</span>
                  <span className={i === active.front.stats.length - 1 ? 'v lead' : 'v'}>
                    {st.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {dots}
        <span className="hpcr-uhint">Swipe · Tap peeks</span>
      </div>
    </div>
  )
}

// ─── Fan slots ────────────────────────────────────────────────────────────────

/**
 * One fan layout. Arrays are indexed by distance from the center card; the
 * last entry is the off-stage holding position (opacity 0), where cards park
 * so entering/leaving fades animate at the outer edge.
 */
interface Fan {
  x: number[]
  rotate: number[]
  scale: number[]
  opacity: number[]
  /** z-index drop per step away from the center. */
  zStep: number
}

/**
 * Desktop fan, ported from the bundle's `components-card-carousel-v3.html`.
 *   rel 0  → center hero (full scale, no rotate)
 *   rel ±1 → inner peeks  (scale 0.86, ±8°,  ±250px, opacity 0.55)
 *   rel ±2 → outer peeks  (scale 0.72, ±14°, ±440px, opacity 0.22)
 *   beyond → parked at ±620px, scale 0.6, ±18°, opacity 0
 */
const DESKTOP_FAN: Fan = {
  x: [0, 250, 440, 620],
  rotate: [0, 8, 14, 18],
  scale: [1, 0.86, 0.72, 0.6],
  opacity: [1, 0.55, 0.22, 0],
  zStep: 10,
}
// Compact fans — Roster Carousel.dc.html.
const MEDIUM_FAN: Fan = {
  x: [0, 150, 258, 340],
  rotate: [0, 8, 14, 18],
  scale: [1, 0.86, 0.72, 0.6],
  opacity: [1, 0.55, 0.22, 0],
  zStep: 5,
}
const SMALL_FAN: Fan = { ...MEDIUM_FAN, x: [0, 96, 164, 220] }
const MICRO_FAN: Fan = {
  x: [0, 60, 110, 152, 186],
  rotate: [0, 6, 11, 15, 18],
  scale: [1, 0.88, 0.76, 0.66, 0.56],
  opacity: [1, 0.7, 0.42, 0.18, 0],
  zStep: 5,
}

function FanSlot({
  rel,
  fan,
  top = '50%',
  onPromote,
  children,
}: {
  rel: number
  fan: Fan
  top?: string
  onPromote: () => void
  children: (isActive: boolean) => React.ReactNode
}) {
  const last = fan.x.length - 1
  const dist = Math.min(Math.abs(rel), last)
  const sign = rel < 0 ? -1 : 1
  const visible = Math.abs(rel) < last
  const isActive = rel === 0
  return (
    <div
      className="absolute"
      style={{
        top,
        left: '50%',
        transform: `translate(-50%, -50%) translateX(${String(sign * (fan.x[dist] ?? 0))}px) rotate(${String(sign * (fan.rotate[dist] ?? 0))}deg) scale(${String(fan.scale[dist] ?? 1)})`,
        opacity: visible ? (fan.opacity[dist] ?? 0) : 0,
        zIndex: 30 - dist * fan.zStep,
        transition: 'transform 600ms cubic-bezier(0.22, 0.8, 0.2, 1), opacity 400ms ease',
        cursor: !isActive && visible ? 'pointer' : 'default',
        // Off-stage cards must not intercept clicks on visible cards below
        pointerEvents: visible ? 'auto' : 'none',
      }}
      onClick={!isActive && visible ? onPromote : undefined}
    >
      {/* Prevents the Link from navigating when the intent is to rotate.
          The outer div owns the click; this inner div only blocks card-link events. */}
      {/* Only the front card is reachable by Tab and screen readers; the others
          are scenery you promote with a click or the arrows. */}
      <div style={{ pointerEvents: isActive ? 'auto' : 'none' }} inert={!isActive}>
        {children(isActive)}
      </div>
    </div>
  )
}

function CompactFan({
  cards,
  activeIndex,
  fan,
  size,
  top,
  onPromote,
}: {
  cards: CardViewModel[]
  activeIndex: number
  fan: Fan
  size: CompactCardSize
  top: string
  onPromote: (index: number) => void
}) {
  return (
    <>
      {cards.map((card, index) => (
        <FanSlot
          key={card.front.playerId}
          rel={getRelPos(index, activeIndex, cards.length)}
          fan={fan}
          top={top}
          onPromote={() => {
            onPromote(index)
          }}
        >
          {() => (
            <PlayerCardCompact
              card={card.front}
              size={size}
              href={`/roster/${String(card.front.playerId)}`}
            />
          )}
        </FanSlot>
      ))}
    </>
  )
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
