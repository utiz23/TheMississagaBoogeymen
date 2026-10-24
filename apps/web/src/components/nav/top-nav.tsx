import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { listAllGameTitles, type GameTitleListing } from '@eanhl/db/queries'
import { pickDefaultTitle, switcherTitles } from '@/lib/title-resolver'
import { NavAccount } from './nav-account'
import { NavDrawer, NavDrawerFallback } from './nav-drawer'
import { NavLinks, NavLinksFallback } from './nav-links'
import { NavTitleMenu, NavTitleMenuFallback } from './nav-title-menu'

/**
 * Switcher titles (live titles plus the explicit default, newest first) and the
 * default's slug, from the same title policy as the pages. The switcher is a
 * Client Component and cannot reach the DB-backed resolver, so the default is
 * computed here rather than guessed from list order.
 */
async function fetchTitleSwitcher(): Promise<{
  titles: GameTitleListing[]
  defaultSlug: string | null
  /** slug → name for every title, so the bar's menu can name an archive title too. */
  titleNames: Record<string, string>
}> {
  try {
    const all = await listAllGameTitles()
    return {
      titles: switcherTitles(all),
      defaultSlug: pickDefaultTitle(all)?.slug ?? null,
      titleNames: Object.fromEntries(all.map((t) => [t.slug, t.name])),
    }
  } catch {
    // DB unavailable — bar and drawer render without their switchers
    return { titles: [], defaultSlug: null, titleNames: {} }
  }
}

/**
 * Site-wide top bar (rendered once, by the root layout).
 *
 * Ported from the game sheet design prototype (`Game sheet prototype layout
 * (1)/Game Sheet copy.dc.html`): accent rail above the bar, brand left, links
 * centred as accent-filled pills, one CTA right, and a burger + slide-in drawer
 * below the `nav` breakpoint. Box metrics follow the prototype's — nav pills
 * 8px/16px, CTA 9px/20px, burger 44px, all at 2px radius.
 *
 * The game-title switcher: a drop-down left of the CTA from 960px up
 * (nav-title-menu.tsx), and the drawer footer's pills below that. The
 * prototype had it in the drawer only, which left wide viewports no in-nav way
 * to change title.
 *
 * The CTA is the member control (nav-account.tsx): LOG IN, or the member's
 * picture once signed in, which opens the account menu. It reads the member in
 * the browser, so the bar — and the root layout that renders it — never reads
 * `headers()`.
 */
export async function TopNav() {
  const { titles, defaultSlug, titleNames } = await fetchTitleSwitcher()
  const defaultName = defaultSlug === null ? null : (titleNames[defaultSlug] ?? null)

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
          <NavLinks />
        </Suspense>

        <div className="ml-auto flex shrink-0 items-center gap-4">
          <Suspense
            fallback={<NavTitleMenuFallback label={defaultName} menu={titles.length > 1} />}
          >
            <NavTitleMenu titles={titles} defaultSlug={defaultSlug} titleNames={titleNames} />
          </Suspense>
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
