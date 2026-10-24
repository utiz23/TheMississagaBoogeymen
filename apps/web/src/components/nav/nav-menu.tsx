'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/** How long the pointer may be off a hover-opened menu before it closes. */
const HOVER_CLOSE_MS = 180

/**
 * A drop-down for the desktop bar: a button that shows or hides a panel of
 * links under it. Disclosure pattern (button + `aria-expanded`), not an ARIA
 * `menu` — the items are ordinary links and buttons, reached with Tab.
 *
 * Closes on Escape (focus goes back to the button), on a click or tap outside,
 * when Tab moves focus out of it, when a link in it is chosen, and on any route
 * change. Reads only the pathname, not search params, so it needs no Suspense
 * boundary of its own.
 *
 * `lead` renders before the button inside the same box — the nav's Stats and
 * Roster pills put their page link there, so the label still navigates in one
 * click and only the ▾ opens the panel. With `openOnHover`, a mouse resting on
 * the box opens it too; clicking the ▾ then keeps it open after the mouse
 * leaves. Touch and keyboard use the button only.
 *
 * The panel is `absolute`, so the bar's `backdrop-blur-sm` — which captures
 * `position: fixed` descendants (see nav-drawer.tsx) — does not affect it. Its
 * top padding is transparent, so the mouse can cross from box to panel
 * without leaving the menu.
 */
export function NavMenu({
  className,
  align = 'right',
  openOnHover = false,
  lead,
  buttonClassName,
  buttonLabel,
  buttonTitle,
  button,
  children,
}: {
  /** The wrapper's classes — e.g. `hidden nav:block` for a desktop-only menu. */
  className?: string
  /** Which edge of the box the panel lines up with. */
  align?: 'left' | 'right'
  openOnHover?: boolean
  lead?: ReactNode
  buttonClassName: string
  /** Accessible name, when the button's content is a picture or a glyph. */
  buttonLabel?: string
  buttonTitle?: string
  button: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // True while the panel is open only because the mouse is over the box.
  const byHover = useRef(false)
  const closeTimer = useRef<number | null>(null)
  const panelId = useId()
  const pathname = usePathname()

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const close = () => {
    cancelClose()
    byHover.current = false
    setOpen(false)
  }

  useEffect(() => {
    close()
  }, [pathname])

  useEffect(() => cancelClose, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={`relative ${className ?? ''}`}
      onPointerEnter={(event) => {
        if (!openOnHover || event.pointerType !== 'mouse') return
        cancelClose()
        if (!open) {
          byHover.current = true
          setOpen(true)
        }
      }}
      onPointerLeave={(event) => {
        if (!openOnHover || event.pointerType !== 'mouse' || !byHover.current) return
        cancelClose()
        closeTimer.current = window.setTimeout(close, HOVER_CLOSE_MS)
      }}
      onBlur={(event) => {
        // Only a focus move to somewhere else on the page closes it. A null
        // `relatedTarget` is a click on a non-focusable spot, which the
        // pointerdown handler above already judges (inside: stay open).
        const next = event.relatedTarget
        if (next instanceof Node && !event.currentTarget.contains(next)) close()
      }}
    >
      {lead}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={buttonLabel}
        title={buttonTitle}
        onClick={() => {
          if (open && byHover.current) {
            // Opened by hover: the click pins it open rather than closing it.
            byHover.current = false
            cancelClose()
            return
          }
          if (open) close()
          else setOpen(true)
        }}
        className={buttonClassName}
      >
        {button}
      </button>
      <div
        id={panelId}
        hidden={!open}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a')) close()
        }}
        className={`absolute top-full z-10 pt-2.5 ${align === 'left' ? 'left-0' : 'right-0'}`}
      >
        <div className="min-w-[220px] rounded-xs border border-border bg-background py-1.5 shadow-[0_14px_36px_rgba(0,0,0,0.6)]">
          {children}
        </div>
      </div>
    </div>
  )
}

/** One row in a `NavMenu` panel. The drawer's active marker: a 3px accent rule. */
export function navMenuItemClass(active: boolean): string {
  return [
    'flex w-full items-center gap-2 border-l-[3px] px-4 py-2.5 text-left transition-colors',
    'font-condensed text-[13px] font-bold uppercase tracking-[0.15em]',
    active
      ? 'border-accent bg-surface-raised text-fg-1'
      : 'border-transparent text-fg-3 hover:bg-surface-raised hover:text-fg-1',
  ].join(' ')
}

/** A small grey heading above a group of `NavMenu` rows. */
export const NAV_MENU_HEADING =
  'px-4 pb-2 pt-1.5 font-condensed text-[11px] font-bold uppercase tracking-[0.2em] text-fg-5'

/** The ▾ on a `NavMenu` button. */
export function NavMenuChevron() {
  return (
    <svg aria-hidden viewBox="0 0 10 6" className="h-[6px] w-[10px] shrink-0 fill-current">
      <path d="M0 0h10L5 6z" />
    </svg>
  )
}
