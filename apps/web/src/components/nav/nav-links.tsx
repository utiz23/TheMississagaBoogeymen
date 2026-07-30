'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * The site's four destinations. Shared with the mobile drawer (`nav-drawer`)
 * so the two renderings of the nav can never drift out of sync.
 */
export const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/games', label: 'Games' },
  { href: '/roster', label: 'Roster' },
  { href: '/stats', label: 'Stats' },
] as const

export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')
}

/**
 * Carries the active `?title=` across a nav hop, so moving between sections
 * keeps the game title the user is looking at instead of snapping back to the
 * newest one.
 */
export function buildHref(href: string, title: string | null): string {
  return title ? `${href}?title=${encodeURIComponent(title)}` : href
}

/**
 * Desktop links, centred in the bar (`nav` breakpoint and up — below that the
 * burger + drawer takes over). Absolute centring rather than flex ordering:
 * the row has to sit on the bar's midpoint, not on the midpoint of whatever
 * space the brand and the right-hand controls happen to leave.
 */
export function NavLinks() {
  const pathname = usePathname()
  const title = useSearchParams().get('title')

  return (
    <nav
      aria-label="Main"
      className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 nav:flex"
    >
      {NAV_LINKS.map(({ href, label }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={buildHref(href, title)}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex items-center rounded-xs px-4 py-2 transition-colors',
              'font-condensed text-[13px] font-bold uppercase tracking-[0.15em]',
              active ? 'bg-accent text-white' : 'text-fg-3 hover:bg-surface-raised hover:text-fg-1',
            ].join(' ')}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * Suspense fallback for the above (`useSearchParams` suspends on a statically
 * rendered route). Mirrors the real row's box exactly so the bar does not
 * reflow when the links land.
 */
export function NavLinksFallback() {
  return (
    <div
      aria-hidden
      className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 nav:flex"
    >
      {NAV_LINKS.map(({ label }) => (
        <span
          key={label}
          className="flex items-center rounded-xs px-4 py-2 font-condensed text-[13px] font-bold uppercase tracking-[0.15em] text-fg-3"
        >
          {label}
        </span>
      ))}
    </div>
  )
}
