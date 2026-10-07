'use client'

import Link from 'next/link'
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useReducedMotion } from '@/components/matches/motion'
import { CARD_THEMES } from './card-themes'
import { cardLook, resolveFx } from './card-style'
import type { CardViewModel } from './card-model'
import { CardFront } from './card-front'
import { CardBack } from './card-back'
import { useInView } from './use-in-view'
import './player-card.css'

interface PlayerCardProps {
  card: CardViewModel
  /** 'hero' animates while on screen and flips; 'list' animates only when hot. */
  context: 'hero' | 'list'
  /** List cards link to the player page. */
  href?: string
  /** Carousel centre card: counts as hot (red rule, glow, effects). */
  active?: boolean
  /** Dev preview: start on the back face. */
  initialFace?: 'front' | 'back'
}

/**
 * The collectible player card (PlayerCard.dc.html port): 264px, front/back,
 * themed by tier. Effects run only while motion is allowed: not reduced, on
 * screen, and (in lists) only on the hovered or active card.
 */
export function PlayerCard({
  card,
  context,
  href,
  active = false,
  initialFace = 'front',
}: PlayerCardProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [face, setFace] = useState<'front' | 'back'>(initialFace)
  const reduced = useReducedMotion()
  const inView = useInView(rootRef)
  const uid = `pc${useId().replace(/[^\w-]/g, '')}`

  const hot = hover || active
  const motionOn = !reduced && inView && (context === 'hero' || hot)
  const theme = CARD_THEMES[card.front.theme]
  const look = cardLook(theme, {
    tier: card.front.tier,
    level: card.front.level,
    hot,
    role: card.front.role,
    position: card.front.position,
  })
  const fx = resolveFx(theme, card.front.tier, { motionOn, hot })
  const flippable = context === 'hero' && card.back !== null

  const resetTilt = () => {
    if (tiltRef.current) tiltRef.current.style.transform = ''
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = tiltRef.current
    if (el === null || !fx.tilt || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `perspective(900px) rotateX(${(-y * 10).toFixed(2)}deg) rotateY(${(x * 12).toFixed(2)}deg) scale(1.02)`
  }
  const flip = () => {
    if (flippable) setFace((f) => (f === 'front' ? 'back' : 'front'))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!flippable || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    flip()
  }

  const body = (
    <div
      ref={rootRef}
      className="pcard"
      data-motion={motionOn ? 'on' : 'off'}
      data-hot={hot}
      data-flippable={flippable}
      data-face={face}
      data-theme={card.front.theme}
      style={{ transform: hot && !fx.tilt && !active ? 'translateY(-3px)' : 'none' }}
      onPointerEnter={() => {
        setHover(true)
      }}
      onPointerLeave={() => {
        setHover(false)
        resetTilt()
      }}
      onPointerMove={onPointerMove}
      onClick={flippable ? flip : undefined}
      onKeyDown={flippable ? onKeyDown : undefined}
      role={flippable ? 'button' : undefined}
      tabIndex={flippable ? 0 : undefined}
      aria-label={flippable ? `${card.front.name} card — press to flip` : undefined}
      aria-pressed={flippable ? face === 'back' : undefined}
    >
      <div ref={tiltRef} className="pcard-tilt">
        <div
          className="pcard-flip"
          style={{
            transform: face === 'back' ? 'rotateY(180deg)' : 'rotateY(0deg)',
            transition: fx.flip ? 'transform 650ms cubic-bezier(.3,.7,.3,1)' : 'none',
          }}
        >
          <CardFront card={card.front} theme={theme} look={look} fx={fx} uid={uid} hover={hover} />
          {card.back !== null && (
            <CardBack front={card.front} back={card.back} theme={theme} look={look} />
          )}
        </div>
      </div>
    </div>
  )

  if (href !== undefined && !flippable) {
    return (
      <Link
        prefetch
        href={href}
        className="pcard-link"
        aria-label={`${card.front.name} — player page`}
      >
        {body}
      </Link>
    )
  }
  return body
}
