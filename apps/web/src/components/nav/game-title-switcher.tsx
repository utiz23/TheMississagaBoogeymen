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
  const firstTitle = titles[0]

  if (titles.length === 1) {
    return (
      <span className="inline-flex items-center border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-50">
        {firstTitle?.name}
      </span>
    )
  }

  return (
    <div className="flex items-center divide-x divide-zinc-700 overflow-hidden border border-zinc-700">
      {titles.map((t) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('title', t.slug)
        const isActive = t.slug === currentSlug
        return (
          <Link
            key={t.id}
            href={`${pathname}?${params.toString()}`}
            className={[
              'px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest transition-colors',
              isActive
                ? 'bg-accent text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            ].join(' ')}
          >
            {t.name}
          </Link>
        )
      })}
    </div>
  )
}
