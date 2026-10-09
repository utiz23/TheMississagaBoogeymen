'use client'

import dynamic from 'next/dynamic'
import { useCallback, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { PlayerCard } from './player-card'
import { PlayerCardCompact } from './player-card-compact'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'
import './card-locker.css'

const loadLocker = () => import('./card-locker')

const RELOADED_KEY = 'clk-locker-reloaded'

/**
 * A page left open across a redeploy asks for a chunk that no longer exists.
 * Reload once to pick up the new build; a second failure is a real error.
 */
function reloadOnce(err: unknown): never {
  let first = false
  try {
    first = sessionStorage.getItem(RELOADED_KEY) === null
    sessionStorage.setItem(RELOADED_KEY, '1')
  } catch {
    // Storage blocked: never reload, so a persistent failure can't loop.
  }
  if (first) window.location.reload()
  throw err
}

/** Loaded: re-arm the reload for the next redeploy. */
function loaded(m: Awaited<ReturnType<typeof loadLocker>>) {
  try {
    sessionStorage.removeItem(RELOADED_KEY)
  } catch {
    // Storage blocked: nothing to re-arm.
  }
  return m.CardLocker
}

/**
 * The locker's code (drawer, both tabs) loads on the first EDIT tap, so it
 * stays out of every player-page load (switch note, step 3); hovering or
 * focusing EDIT starts that load early. The drawer only exists once opened,
 * so no loading placeholder is needed.
 */
const CardLocker = dynamic(() => loadLocker().then(loaded, reloadOnce), {
  ssr: false,
})

const preload = () => {
  void loadLocker().catch(() => undefined)
}

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
        onPointerEnter={preload}
        onFocus={preload}
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
