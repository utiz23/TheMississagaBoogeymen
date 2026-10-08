'use client'

import { useCallback, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { PlayerCard } from './player-card'
import { CardLocker } from './card-locker'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'
import './card-locker.css'

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
