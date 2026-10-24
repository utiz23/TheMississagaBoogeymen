'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

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
 * The panel is `absolute`, so the bar's `backdrop-blur-sm` — which captures
 * `position: fixed` descendants (see nav-drawer.tsx) — does not affect it.
 */
export function NavMenu({
  className,
  buttonClassName,
  buttonLabel,
  buttonTitle,
  button,
  children,
}: {
  /** The wrapper's classes — e.g. `hidden nav:block` for a desktop-only menu. */
  className?: string
  buttonClassName: string
  /** Accessible name, when the button's content is a picture. */
  buttonLabel?: string
  buttonTitle?: string
  button: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const pathname = usePathname()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
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
      onBlur={(event) => {
        // Only a focus move to somewhere else on the page closes it. A null
        // `relatedTarget` is a click on a non-focusable spot, which the
        // pointerdown handler above already judges (inside: stay open).
        const next = event.relatedTarget
        if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={buttonLabel}
        title={buttonTitle}
        onClick={() => {
          setOpen((was) => !was)
        }}
        className={buttonClassName}
      >
        {button}
      </button>
      <div
        id={panelId}
        hidden={!open}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a')) setOpen(false)
        }}
        className="absolute right-0 top-[calc(100%+10px)] z-10 min-w-[220px] rounded-xs border border-border bg-background py-1.5 shadow-[0_14px_36px_rgba(0,0,0,0.6)]"
      >
        {children}
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

/** The ▾ on a `NavMenu` button. */
export function NavMenuChevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 6"
      className="h-[6px] w-[10px] shrink-0 fill-current text-fg-4"
    >
      <path d="M0 0h10L5 6z" />
    </svg>
  )
}
