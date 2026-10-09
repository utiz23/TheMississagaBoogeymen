'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { CardThemeKey } from '@eanhl/db/cards'
import { equipCardTheme } from '@/app/roster/[id]/card-actions'
import type { CardViewModel } from './card-model'
import type { LockerView } from './locker-model'
import { LockerThemeFooter, LockerThemeTab } from './locker-theme-tab'
import { LockerProgressTab } from './locker-progress-tab'
import './card-locker.css'

type LockerTab = 'theme' | 'progress'

const TABS: readonly { id: LockerTab; label: string }[] = [
  { id: 'theme', label: 'THEME' },
  { id: 'progress', label: 'PROGRESS' },
]

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The Card Locker drawer (Card Locker.dc.html; spec Part 3). Anyone can
 * browse; the card's own member (or an admin) can equip a theme or switch
 * back to AUTO (member logins step 1, closing D1/D10).
 * Portalled to <body> (see nav-drawer.tsx: an ancestor filter or transform
 * would otherwise trap `position: fixed`). Esc or the scrim closes it, Tab
 * stays inside, and ←/→ browse themes on the Theme tab.
 */
export function CardLocker({
  card,
  view,
  onClose,
}: {
  card: CardViewModel
  view: LockerView
  onClose: () => void
}) {
  const [tab, setTab] = useState<LockerTab>('theme')
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      view.themes.findIndex((t) => t.status === 'equipped'),
    ),
  )
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const count = view.themes.length
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Saves, then re-renders the page so the hero card, the locker and the
  // compact cards all show the new theme. The drawer stays open on the
  // same theme (its state lives here, above the refresh).
  const equip = (theme: CardThemeKey | null) => {
    setError(null)
    startTransition(async () => {
      const result = await equipCardTheme(card.front.playerId, theme)
      if (result.ok) router.refresh()
      else setError(result.message)
    })
  }

  // Focus the close button and lock page scroll while open.
  useEffect(() => {
    closeRef.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (tab === 'theme' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        const delta = event.key === 'ArrowLeft' ? -1 : 1
        setIndex((i) => (i + delta + count) % count)
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)
      if (event.shiftKey ? !inside || active === first : !inside || active === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [tab, onClose, count])

  const browse = view.themes[index] ?? view.themes[0]
  if (browse === undefined) return null

  return createPortal(
    <div className="clk-overlay">
      {/* Click-to-dismiss only; Esc and the × button are the keyboard routes out. */}
      <div className="clk-scrim" aria-hidden onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="clk-panel"
      >
        <div className="clk-topline" aria-hidden />
        <div className="clk-head">
          <div className="clk-head-text">
            <h2 id={titleId} className="clk-title">
              CARD LOCKER
            </h2>
            <span className="clk-sub">{view.subline}</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="clk-icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="clk-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="clk-tab"
              aria-pressed={tab === t.id}
              onClick={() => {
                setTab(t.id)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Keyed by tab: each tab opens scrolled to its top (one shared scroller otherwise keeps the old offset). */}
        <div className="clk-body" key={tab}>
          {tab === 'theme' && (
            <LockerThemeTab
              card={card}
              view={view}
              index={index}
              onSelect={setIndex}
              onStep={(delta) => {
                setIndex((i) => (i + delta + count) % count)
              }}
            />
          )}
          {tab === 'progress' && <LockerProgressTab card={card} view={view} />}
        </div>
        {tab === 'theme' && (
          <LockerThemeFooter
            theme={browse}
            view={view}
            pending={pending}
            error={error}
            onEquip={equip}
            onClose={onClose}
          />
        )}
      </div>
    </div>,
    document.body,
  )
}
