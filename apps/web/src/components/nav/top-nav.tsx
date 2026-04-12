import { Suspense } from 'react'
import Link from 'next/link'
import { listGameTitles } from '@eanhl/db/queries'
import { GameTitleSwitcher } from './game-title-switcher'

async function fetchGameTitles() {
  try {
    return await listGameTitles()
  } catch {
    // DB unavailable (no connection in this environment) — nav renders without switcher
    return []
  }
}

export async function TopNav() {
  const titles = await fetchGameTitles()

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800 bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-6 px-4">
        {/* Logo / club name */}
        <Link
          href="/"
          className="flex items-center gap-2 font-condensed text-base font-semibold uppercase tracking-widest text-zinc-50 hover:text-accent transition-colors"
        >
          <span className="text-accent font-bold">▶</span>
          Club Stats
        </Link>

        {/* Game title switcher — center */}
        <div className="flex flex-1 justify-center">
          <Suspense fallback={<div className="h-7 w-28 animate-pulse rounded-sm bg-zinc-800" />}>
            <GameTitleSwitcher titles={titles} />
          </Suspense>
        </div>

        {/* Right slot — nav links */}
        <nav className="hidden sm:flex items-center gap-5 text-sm font-medium text-zinc-400">
          <Link href="/games" className="hover:text-zinc-200 transition-colors">
            Games
          </Link>
          <Link href="/roster" className="hover:text-zinc-200 transition-colors">
            Roster
          </Link>
          <Link href="/stats" className="hover:text-zinc-200 transition-colors">
            Stats
          </Link>
        </nav>
      </div>
    </header>
  )
}
