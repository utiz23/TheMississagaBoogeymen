'use client'

import { useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { GameTitle } from '@eanhl/db'

interface GameTitleSwitcherProps {
  /** Newest first — NOT default-first. */
  titles: GameTitle[]
  /** The no-`?title=` title from the shared title policy (`pickDefaultTitle`). */
  defaultSlug: string | null
}

/**
 * The current page with `?title=` set to `slug`, keeping every other query
 * param (e.g. `?mode=`). Shared with the desktop title menu (nav-title-menu.tsx).
 */
export function titleSwitchHref(
  pathname: string,
  searchParams: { toString(): string },
  slug: string,
): string {
  const params = new URLSearchParams(searchParams.toString())
  params.set('title', slug)
  return `${pathname}?${params.toString()}`
}

/**
 * Game-title switcher for the mobile drawer's footer. The desktop bar has its
 * own drop-down form of it (nav-title-menu.tsx).
 *
 * Sized to the prototype's `.nav-switch` treatment (12px/10px padding, 12px
 * type, 0.2em tracking, on surface behind a hairline border).
 *
 * Lists the live titles plus the default (NHL 27 and NHL 26 today). With no
 * `?title=` the highlighted pill is `defaultSlug`, never the first pill. The
 * multi branch is a WRAPPING pill group rather than the old divided segmented
 * bar because the drawer only has ~280px of inner width, so a row of segments
 * would clip under its own `overflow-hidden`.
 */
export function GameTitleSwitcher({ titles, defaultSlug }: GameTitleSwitcherProps) {
  const searchParams = useSearchParams()
  const pathname = usePathname()

  if (titles.length === 0) return null

  const currentSlug = searchParams.get('title') ?? defaultSlug ?? ''
  const onlyTitle = titles.length === 1 ? titles[0] : undefined

  const box =
    'flex items-center justify-center border px-3 py-2.5 font-condensed text-xs font-bold uppercase tracking-[0.2em] rounded-xs'

  if (onlyTitle !== undefined) {
    return <span className={`${box} border-border bg-surface text-fg-1`}>{onlyTitle.name}</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {titles.map((t) => {
        const isActive = t.slug === currentSlug
        return (
          <Link
            prefetch
            key={t.id}
            href={titleSwitchHref(pathname, searchParams, t.slug)}
            aria-current={isActive ? 'true' : undefined}
            className={[
              box,
              'flex-1 transition-colors',
              isActive
                ? 'border-accent bg-accent text-white'
                : 'border-border bg-surface text-fg-3 hover:border-accent/40 hover:bg-surface-raised hover:text-fg-1',
            ].join(' ')}
          >
            {t.name}
          </Link>
        )
      })}
    </div>
  )
}
