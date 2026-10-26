import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  listAllGameTitles,
  listRosterMenuMembers,
  type GameTitleListing,
  type RosterMenuMember,
} from '@eanhl/db/queries'
import { pickDefaultTitle, switcherTitles } from '@/lib/title-resolver'
import { NavAccount } from './nav-account'
import { NavDrawer, NavDrawerFallback } from './nav-drawer'
import { NavLinks, NavLinksFallback } from './nav-links'

/**
 * Switcher titles (live titles plus the explicit default, newest first) and the
 * default's slug, from the same title policy as the pages. The switcher is a
 * Client Component and cannot reach the DB-backed resolver, so the default is
 * computed here rather than guessed from list order.
 */
async function fetchTitleSwitcher(): Promise<{
  titles: GameTitleListing[]
  defaultSlug: string | null
  defaultId: number | null
}> {
  try {
    const all = await listAllGameTitles()
    const defaultTitle = pickDefaultTitle(all)
    return {
      titles: switcherTitles(all),
      defaultSlug: defaultTitle?.slug ?? null,
      defaultId: defaultTitle?.id ?? null,
    }
  } catch {
    // DB unavailable — drawer renders without its switcher
    return { titles: [], defaultSlug: null, defaultId: null }
  }
}

/** The Roster menu's team list (the default title's members); empty on failure. */
async function fetchRosterMenu(defaultId: number | null): Promise<RosterMenuMember[]> {
  if (defaultId === null) return []
  try {
    return await listRosterMenuMembers(defaultId)
  } catch {
    // The menu still offers Full roster.
    return []
  }
}

/**
 * Site-wide top bar (rendered once, by the root layout).
 *
 * Ported from the game sheet design prototype
 * (`docs/design/handoffs/2026-07-game-sheet/Game Sheet copy.dc.html`): accent
 * rail above the bar, brand left, links
 * centred as accent-filled pills, one CTA right, and a burger + slide-in drawer
 * below the `nav` breakpoint. Box metrics follow the prototype's — nav pills
 * 8px/16px, CTA 9px/20px, burger 44px, all at 2px radius. Stats and Roster
 * pills carry drop-downs (nav-links.tsx); the drawer keeps plain links.
 *
 * No game-title switcher in the bar, matching the prototype — it sits in the
 * drawer footer instead, i.e. under 960px only. With two live titles (NHL 27
 * and NHL 26) wide viewports have no in-nav way to change title: /games,
 * /stats and /roster carry their own selectors, `/` only an explicit ?title=.
 *
 * The CTA is the member control (nav-account.tsx): LOG IN, or the member's
 * picture once signed in, which opens the account menu. It reads the member in
 * the browser, so the bar — and the root layout that renders it — never reads
 * `headers()`.
 */
export async function TopNav() {
  const { titles, defaultSlug, defaultId } = await fetchTitleSwitcher()
  const members = await fetchRosterMenu(defaultId)

  return (
    <header className="sticky top-0 z-50 border-b border-accent/40 bg-surface/95 backdrop-blur-sm">
      <span aria-hidden className="ticker-strip ticker-strip-thin block" />

      {/* `relative` anchors the absolutely-centred link row. */}
      <div className="relative mx-auto flex h-16 max-w-screen-xl items-center gap-6 px-4 nav:px-5">
        <Link
          prefetch
          href="/"
          className="flex shrink-0 items-center gap-3 transition-opacity hover:opacity-[0.88]"
          aria-label="Boogeymen Club Stats — home"
        >
          <Image
            src="/images/bgm-logo.png"
            alt=""
            width={38}
            height={38}
            className="h-[38px] w-[38px] object-contain"
            priority
          />
          <span className="font-condensed text-lg font-black uppercase leading-none tracking-[0.15em] text-fg-1">
            Boogeymen
          </span>
        </Link>

        <Suspense fallback={<NavLinksFallback />}>
          <NavLinks members={members} />
        </Suspense>

        <div className="ml-auto flex shrink-0 items-center gap-4">
          {/* Prototype's SIGN IN CTA box: 9px/20px, 13px/800, 0.15em, 2px radius. */}
          <NavAccount variant="bar" />
          <Suspense fallback={<NavDrawerFallback />}>
            <NavDrawer titles={titles} defaultSlug={defaultSlug} />
          </Suspense>
        </div>
      </div>

      {/* Loading cue for a nav tap that beat its preload (nav-pending-cue.tsx). */}
      <span aria-hidden className="nav-pending-bar" />
    </header>
  )
}
