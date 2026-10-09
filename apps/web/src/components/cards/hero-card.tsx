'use client'

import dynamic from 'next/dynamic'
import { useCallback, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { PlayerCard } from './player-card'
import { PlayerCardCompact } from './player-card-compact'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'
import './card-locker.css'

/**
 * The locker's code (drawer, both tabs) loads on the first EDIT tap, so it
 * stays out of every player-page load (switch note, step 3). The drawer only
 * exists once opened, so no loading placeholder is needed.
 */
const CardLocker = dynamic(() => import('./card-locker').then((m) => m.CardLocker), {
  ssr: false,
})

/**
 * The player-page hero slot (spec D9/D10): the flippable card with an EDIT
 * button under it, shown to everyone, opening the read-only Card Locker.
 */
export function HeroCard({
  card,
  locker,
  initialFace,
}: {
  card: CardViewModel
  locker: LockerView
  initialFace?: 'front' | 'back'
}) {
  const [open, setOpen] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    editRef.current?.focus()
  }, [])
  return (
    <div className="clk-hero">
      <PlayerCard card={card} context="hero" initialFace={initialFace ?? 'front'} />
      {/* Phone tiers show the compact card instead (card-locker.css). */}
      <div className="clk-compact clk-compact-s">
        <PlayerCardCompact card={card.front} size="small" />
      </div>
      <div className="clk-compact clk-compact-xs">
        <PlayerCardCompact card={card.front} size="micro" />
      </div>
      <button
        ref={editRef}
        type="button"
        className="clk-edit"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true)
        }}
      >
        <Pencil size={14} aria-hidden />
        EDIT
      </button>
      {open && <CardLocker card={card} view={locker} onClose={close} />}
    </div>
  )
}
