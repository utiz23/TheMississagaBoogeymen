'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GameTitle } from '@eanhl/db'
import { GameTitleSwitcher } from './game-title-switcher'
import { NAV_LINKS, buildHref, isActive } from './nav-links'

/**
 * Mobile navigation: burger in the bar, slide-in panel from the right. Replaces
 * the old always-visible tab strip below the bar — the strip cost 36px of every
 * viewport it appeared on and had nowhere to put the title switcher or the
 * account entry point.
 *
 * The panel stays mounted and toggles `invisible` rather than unmounting, so
 * the transform transition plays on the way out as well as the way in.
 * `invisible` (visibility: hidden) also takes the closed panel out of the
 * accessibility tree, so no `aria-hidden` bookkeeping is needed.
 *
 * The overlay is PORTALLED to `document.body`, and has to be: the bar it lives
 * in carries `backdrop-blur-sm`, and `backdrop-filter` makes an element a
 * containing block for `position: fixed` descendants. Rendered in place, the
 * `fixed inset-0` overlay resolves against the 64px-tall bar instead of the
 * viewport — measured 390x66 at x=-104, i.e. a sliver of panel with no scrim.
 */
export function NavDrawer({ titles }: { titles: GameTitle[] }) {
  const [open, setOpen] = useState(false)
  // Portals need a DOM; there is none during SSR. The drawer starts closed, so
  // deferring the overlay to after mount costs nothing visible.
  const [mounted, setMounted] = useState(false)
  const pathname = usePathname()
  const title = useSearchParams().get('title')

  const burgerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Gates the focus-return effect: without it, the initial `open === false`
  // render would pull focus to the burger on every page load.
  const everOpened = useRef(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Safety net for navigation the link handlers below don't see (browser
  // back/forward). Clicking a link closes the drawer itself, so it does not
  // hang around waiting for the new route to resolve.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (open) {
      everOpened.current = true
      closeRef.current?.focus()
    } else if (everOpened.current) {
      burgerRef.current?.focus()
    }
  }, [open])

  const close = () => {
    setOpen(false)
  }

  const overlay = (
    <div
      className={`fixed inset-0 z-60 ${open ? 'pointer-events-auto' : 'invisible pointer-events-none'}`}
    >
      {/* Click-to-dismiss convenience only — Escape and the × button are the
          keyboard routes out, so the scrim stays out of the a11y tree. */}
      <div
        aria-hidden
        onClick={close}
        className={`absolute inset-0 bg-black/[0.62] transition-opacity duration-[250ms] motion-reduce:transition-none ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`absolute inset-y-0 right-0 flex w-[min(84vw,320px)] flex-col border-l border-border bg-background px-5 py-[18px] transition-transform duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-10 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Image
              src="/images/bgm-logo.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
            />
            <span className="font-condensed text-[15px] font-black uppercase leading-none tracking-[0.15em] text-fg-1">
              Boogeymen
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close menu"
            onClick={close}
            className="grid h-10 w-10 place-items-center text-2xl leading-none text-fg-3 transition-colors hover:text-fg-1"
          >
            &times;
          </button>
        </div>

        <nav aria-label="Main" className="mt-7 flex flex-col gap-0.5">
          {NAV_LINKS.map(({ href, label }, index) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={buildHref(href, title)}
                onClick={close}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex items-center gap-3.5 border-l-[3px] px-3 py-3.5 transition-colors',
                  'font-condensed text-[22px] font-extrabold uppercase tracking-[0.1em]',
                  active
                    ? 'border-accent text-fg-1'
                    : 'border-transparent text-fg-3 hover:text-fg-1',
                ].join(' ')}
              >
                {/* Decorative index — the prototype's numbered stack. */}
                <span
                  aria-hidden
                  className="font-condensed text-[12px] font-extrabold tracking-normal text-fg-5"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3.5">
          <GameTitleSwitcher titles={titles} />
          {/* Prototype's drawer CTA box: 13px padding, 14px/800, 0.15em. */}
          <Link
            href="/login"
            onClick={close}
            className="rounded-xs bg-accent p-[13px] text-center font-condensed text-sm font-extrabold uppercase tracking-[0.15em] text-white transition-[filter] hover:brightness-110"
          >
            Login
          </Link>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <button
        ref={burgerRef}
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(true)
        }}
        className="grid h-11 w-11 place-items-center nav:hidden"
      >
        <span aria-hidden className="flex w-[22px] flex-col gap-[5px]">
          <span className="h-0.5 rounded-xs bg-fg-1" />
          <span className="h-0.5 rounded-xs bg-fg-1" />
          <span className="h-0.5 rounded-xs bg-fg-1" />
        </span>
      </button>
      {mounted ? createPortal(overlay, document.body) : null}
    </>
  )
}

/**
 * Suspense fallback: the burger's box only. `GameTitleSwitcher` and the link
 * hrefs both read search params, so the whole drawer suspends — but the bar
 * must not shift when it lands.
 */
export function NavDrawerFallback() {
  return <div aria-hidden className="h-11 w-11 nav:hidden" />
}
