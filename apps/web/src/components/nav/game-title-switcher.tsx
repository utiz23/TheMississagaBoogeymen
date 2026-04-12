'use client'

import { useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { GameTitle } from '@eanhl/db'

interface GameTitleSwitcherProps {
  titles: GameTitle[]
}

export function GameTitleSwitcher({ titles }: GameTitleSwitcherProps) {
  const searchParams = useSearchParams()
  const pathname = usePathname()

  if (titles.length === 0) return null

  const currentSlug = searchParams.get('title') ?? titles[0]?.slug ?? ''

  // Single title — no switcher needed, just show the name.
  // Assign to a const so TypeScript narrows away the undefined from noUncheckedIndexedAccess.
  const firstTitle = titles[0]
  if (titles.length === 1) {
    return (
      <span className="text-sm font-semibold text-zinc-50 tracking-wide">{firstTitle?.name}</span>
    )
  }

  return (
    <div className="flex items-center gap-1 rounded-sm overflow-hidden border border-zinc-800">
      {titles.map((t) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('title', t.slug)
        const isActive = t.slug === currentSlug
        return (
          <Link
            key={t.id}
            href={`${pathname}?${params.toString()}`}
            className={[
              'px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
              isActive
                ? 'bg-accent text-white'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
            ].join(' ')}
          >
            {t.name}
          </Link>
        )
      })}
    </div>
  )
}
