import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { listGameTitles } from '@eanhl/db/queries'
import { NavDrawer, NavDrawerFallback } from './nav-drawer'
import { NavLinks, NavLinksFallback } from './nav-links'

async function fetchGameTitles() {
  try {
    return await listGameTitles()
  } catch {
    // DB unavailable — drawer renders without its switcher
    return []
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
 * No game-title switcher in the bar, matching the prototype — it sits in the
 * drawer footer instead, i.e. under 960px only. Costs nothing today: NHL 26 is
 * the only active title, so the switcher renders as a static label either way.
 * Activating a second title would leave wide viewports with no in-nav way to
 * change it, and the switcher would need a home in the bar again.
 *
 * NO AUTH CTA. The prototype's SIGN IN box, and the LOGIN link that stood in
 * for it, are both gone: authentication is disabled before launch and /login is
 * a 404, so a CTA here would be a link into a dead route. The bar stays
 * session-agnostic — it does not read `headers()` or construct Better Auth, and
 * the root layout that renders it therefore stays static-friendly.
 *
 * Restoring the CTA is part of re-enabling the account system after launch; see
 * src/deferred/auth/README.md. `src/lib/account-system-disabled.test.ts` fails
 * if a login/account link reappears here or in the drawer.
 */
export async function TopNav() {
  const titles = await fetchGameTitles()

  return (
    <header className="sticky top-0 z-50 border-b border-accent/40 bg-surface/95 backdrop-blur-sm">
      <span aria-hidden className="ticker-strip ticker-strip-thin block" />

      {/* `relative` anchors the absolutely-centred link row. */}
      <div className="relative mx-auto flex h-16 max-w-screen-xl items-center gap-6 px-4 nav:px-5">
        <Link
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
          <Suspense fallback={<NavDrawerFallback />}>
            <NavDrawer titles={titles} />
          </Suspense>
        </div>
      </div>
    </header>
  )
}
