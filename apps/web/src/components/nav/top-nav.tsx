import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { listGameTitles } from '@eanhl/db/queries'
import { GameTitleSwitcher } from './game-title-switcher'
import { NavLinks } from './nav-links'

async function fetchGameTitles() {
  try {
    return await listGameTitles()
  } catch {
    // DB unavailable — nav renders without switcher
    return []
  }
}

export async function TopNav() {
  const titles = await fetchGameTitles()

  return (
    <header className="sticky top-0 z-50 border-b border-accent/15 bg-surface/95 backdrop-blur-sm">
      {/* Main bar */}
      <div className="mx-auto flex h-16 max-w-screen-xl items-center gap-6 px-4">

        {/* Brand zone — crest + wordmark */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-3 transition-opacity hover:opacity-90"
          aria-label="Boogeymen Club Stats — home"
        >
          <Image
            src="/images/bgm-logo.png"
            alt="Boogeymen"
            width={40}
            height={40}
            className="h-10 w-10 object-contain"
            priority
          />
          {/* sm+: wordmark alongside logo; xs: logo only */}
          <span className="hidden font-condensed text-lg font-black uppercase leading-none tracking-widest text-zinc-50 sm:block">
            Boogeymen
          </span>
        </Link>

        {/* Nav links zone — desktop, immediately right of brand */}
        <Suspense fallback={<DesktopLinksFallback />}>
          <NavLinks variant="desktop" />
        </Suspense>

        {/* Title switcher zone — right slot */}
        <div className="ml-auto">
          <Suspense fallback={<div className="h-7 w-24 animate-pulse rounded-sm bg-zinc-800" />}>
            <GameTitleSwitcher titles={titles} />
          </Suspense>
        </div>
      </div>

      {/* Mobile nav tab row */}
      <nav className="border-t border-zinc-800/60 sm:hidden">
        <Suspense fallback={<MobileTabsFallback />}>
          <NavLinks variant="mobile" />
        </Suspense>
      </nav>
    </header>
  )
}

function DesktopLinksFallback() {
  return (
    <div className="hidden sm:flex items-center gap-5">
      {(['Home', 'Games', 'Roster', 'Stats', 'Archive'] as const).map((label) => (
        <span
          key={label}
          className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-400"
        >
          {label}
        </span>
      ))}
    </div>
  )
}

function MobileTabsFallback() {
  return (
    <div className="flex divide-x divide-zinc-800/60">
      {(['Home', 'Games', 'Roster', 'Stats', 'Archive'] as const).map((label) => (
        <span
          key={label}
          className="flex-1 py-2 text-center font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-400"
        >
          {label}
        </span>
      ))}
    </div>
  )
}
