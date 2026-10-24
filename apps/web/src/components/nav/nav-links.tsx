'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { RosterMenuMember } from '@eanhl/db/queries'
import { NAV_MENU_HEADING, NavMenu, NavMenuChevron, navMenuItemClass } from './nav-menu'
import { NavPendingCue } from './nav-pending-cue'

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
 * The Stats menu: the page's sections, in page order. Each id is a
 * `scroll-mt-24` wrapper in app/stats/page.tsx. An archive title's page has
 * only Career Team Stats and Skaters (its career-stats block, skaters first);
 * the other links then just open the page.
 */
export const STATS_SECTIONS = [
  { id: 'stats-record', label: 'Record' },
  { id: 'stats-shot-map', label: 'Shot Map' },
  { id: 'stats-team-history', label: 'Career Team Stats' },
  { id: 'stats-skaters', label: 'Skaters' },
  { id: 'stats-goalies', label: 'Goalies' },
  { id: 'stats-chemistry', label: 'Chemistry' },
  { id: 'stats-recent', label: 'Recent Games' },
] as const

const PILL_TEXT = 'font-condensed text-[13px] font-bold uppercase tracking-[0.15em]'

function pillTone(active: boolean): string {
  return active ? 'bg-accent text-white' : 'text-fg-3 hover:bg-surface-raised hover:text-fg-1'
}

/**
 * Desktop links, centred in the bar (`nav` breakpoint and up — below that the
 * burger + drawer takes over). Absolute centring rather than flex ordering:
 * the row has to sit on the bar's midpoint, not on the midpoint of whatever
 * space the brand and the right-hand controls happen to leave.
 *
 * Stats and Roster are split pills: the label opens the page, the ▾ (or a
 * resting mouse) opens a drop-down — Stats' sections, or the current team's
 * player pages (`members`, from top-nav.tsx).
 */
export function NavLinks({ members }: { members: RosterMenuMember[] }) {
  const pathname = usePathname()
  const title = useSearchParams().get('title')

  return (
    <nav
      aria-label="Main"
      className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 nav:flex"
    >
      {NAV_LINKS.map(({ href, label }) => {
        const active = isActive(pathname, href)
        const pageLink = (
          <Link
            prefetch
            key={href}
            href={buildHref(href, title)}
            aria-current={active ? 'page' : undefined}
            className={
              href === '/stats' || href === '/roster'
                ? `flex items-center py-2 pl-4 pr-1 ${PILL_TEXT}`
                : `flex items-center rounded-xs px-4 py-2 transition-colors ${PILL_TEXT} ${pillTone(active)}`
            }
          >
            {label}
            <NavPendingCue />
          </Link>
        )
        if (href === '/stats') {
          return (
            <NavMenu
              key={href}
              align="left"
              openOnHover
              className={`flex items-center rounded-xs transition-colors ${pillTone(active)}`}
              lead={pageLink}
              buttonLabel="Stats sections"
              buttonClassName="flex items-center self-stretch py-2 pl-1 pr-3"
              button={<NavMenuChevron />}
            >
              <p className={NAV_MENU_HEADING}>Jump to</p>
              {STATS_SECTIONS.map((section) => (
                <Link
                  prefetch
                  key={section.id}
                  href={`${buildHref('/stats', title)}#${section.id}`}
                  className={navMenuItemClass(false)}
                >
                  {section.label}
                </Link>
              ))}
            </NavMenu>
          )
        }
        if (href === '/roster') {
          return (
            <NavMenu
              key={href}
              align="left"
              openOnHover
              className={`flex items-center rounded-xs transition-colors ${pillTone(active)}`}
              lead={pageLink}
              buttonLabel="Team members"
              buttonClassName="flex items-center self-stretch py-2 pl-1 pr-3"
              button={<NavMenuChevron />}
            >
              <Link
                prefetch
                href={buildHref('/roster', title)}
                aria-current={pathname === '/roster' ? 'page' : undefined}
                className={navMenuItemClass(pathname === '/roster')}
              >
                Full roster
              </Link>
              {members.length > 0 && (
                <>
                  <div aria-hidden className="mx-4 my-1.5 border-t border-border" />
                  <p className={NAV_MENU_HEADING}>Team</p>
                  {members.map((m) => {
                    const memberHref = `/roster/${String(m.id)}`
                    const current = pathname === memberHref
                    return (
                      <Link
                        prefetch
                        key={m.id}
                        href={buildHref(memberHref, title)}
                        aria-current={current ? 'page' : undefined}
                        className={navMenuItemClass(current)}
                      >
                        <span className="w-7 shrink-0 text-right text-fg-5">
                          {m.jerseyNumber === null ? '' : `#${String(m.jerseyNumber)}`}
                        </span>
                        {m.gamertag}
                      </Link>
                    )
                  })}
                </>
              )}
            </NavMenu>
          )
        }
        return pageLink
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
      {NAV_LINKS.map(({ href, label }) =>
        href === '/stats' || href === '/roster' ? (
          <span key={label} className={`flex items-center rounded-xs text-fg-3 ${PILL_TEXT}`}>
            <span className="py-2 pl-4 pr-1">{label}</span>
            <span className="flex items-center py-2 pl-1 pr-3">
              <NavMenuChevron />
            </span>
          </span>
        ) : (
          <span
            key={label}
            className={`flex items-center rounded-xs px-4 py-2 text-fg-3 ${PILL_TEXT}`}
          >
            {label}
          </span>
        ),
      )}
    </div>
  )
}
