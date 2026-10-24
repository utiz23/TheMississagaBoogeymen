'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { GameTitle } from '@eanhl/db'
import { titleSwitchHref } from './game-title-switcher'
import { NavMenu, NavMenuChevron, navMenuItemClass } from './nav-menu'

/** Box of the bar's title control — the prototype's `.nav-switch` type at the CTA's 38px height. */
const TITLE_BOX =
  'flex h-[38px] items-center gap-2.5 rounded-xs border px-3 font-condensed text-xs font-bold uppercase tracking-[0.2em]'

/**
 * Desktop game-title menu: "NHL 27 ▾" in the bar (`nav` breakpoint and up),
 * opening the same titles as the drawer's switcher (game-title-switcher.tsx).
 * Choosing one keeps the page and its other query params and swaps `?title=`.
 *
 * The button names the title the page shows: `?title=` when set, else
 * `defaultSlug` — never `titles[0]`. `titleNames` covers every title, so an
 * archive title picked on /stats or /roster (not in the menu) still shows its
 * name instead of a blank.
 */
export function NavTitleMenu({
  titles,
  defaultSlug,
  titleNames,
}: {
  /** Newest first — NOT default-first. */
  titles: GameTitle[]
  /** The no-`?title=` title from the shared title policy (`pickDefaultTitle`). */
  defaultSlug: string | null
  /** slug → name for every title. */
  titleNames: Record<string, string>
}) {
  const searchParams = useSearchParams()
  const pathname = usePathname()

  if (titles.length === 0) return null

  const currentSlug = searchParams.get('title') ?? defaultSlug ?? ''
  const currentName = titleNames[currentSlug] ?? titleNames[defaultSlug ?? ''] ?? ''

  if (titles.length === 1) {
    return (
      <span className={`${TITLE_BOX} hidden border-border bg-surface text-fg-1 nav:flex`}>
        {currentName}
      </span>
    )
  }

  return (
    <NavMenu
      className="hidden nav:block"
      buttonLabel={`Game title: ${currentName}`}
      buttonClassName={`${TITLE_BOX} border-border bg-surface text-fg-1 transition-colors hover:border-accent/40 hover:bg-surface-raised aria-expanded:border-accent`}
      button={
        <>
          {currentName}
          <NavMenuChevron />
        </>
      }
    >
      <p className="px-4 pb-2 pt-1.5 font-condensed text-[11px] font-bold uppercase tracking-[0.2em] text-fg-5">
        Game title
      </p>
      {titles.map((t) => {
        const active = t.slug === currentSlug
        return (
          <Link
            prefetch
            key={t.id}
            href={titleSwitchHref(pathname, searchParams, t.slug)}
            aria-current={active ? 'true' : undefined}
            className={navMenuItemClass(active)}
          >
            {t.name}
          </Link>
        )
      })}
    </NavMenu>
  )
}

/**
 * Suspense fallback (`useSearchParams` suspends on a statically rendered
 * route): the default title's box, inert, so the bar does not shift when the
 * real menu lands.
 */
export function NavTitleMenuFallback({ label, menu }: { label: string | null; menu: boolean }) {
  if (label === null) return null
  return (
    <span aria-hidden className={`${TITLE_BOX} hidden border-border bg-surface text-fg-1 nav:flex`}>
      {label}
      {menu && <NavMenuChevron />}
    </span>
  )
}
