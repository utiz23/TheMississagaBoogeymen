'use client'

import { useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { GameTitle } from '@eanhl/db'

interface GameTitleSwitcherProps {
  titles: GameTitle[]
}

/**
 * Game-title switcher. Lives in the mobile drawer's footer only — the desktop
 * bar has no switcher, matching the prototype.
 *
 * Sized to the prototype's `.nav-switch` treatment (12px/10px padding, 12px
 * type, 0.2em tracking, on surface behind a hairline border).
 *
 * In practice only the one-title branch renders today: `listGameTitles()`
 * filters on `is_active`, and NHL 26 is the only active title — the other four
 * are archive. The multi branch is a WRAPPING pill group rather than the old
 * divided segmented bar because the drawer only has ~280px of inner width, so
 * a row of segments would clip under its own `overflow-hidden` the moment a
 * second title goes active.
 */
export function GameTitleSwitcher({ titles }: GameTitleSwitcherProps) {
  const searchParams = useSearchParams()
  const pathname = usePathname()

  if (titles.length === 0) return null

  const currentSlug = searchParams.get('title') ?? titles[0]?.slug ?? ''
  const firstTitle = titles[0]

  const box =
    'flex items-center justify-center border px-3 py-2.5 font-condensed text-xs font-bold uppercase tracking-[0.2em] rounded-xs'

  if (titles.length === 1) {
    return <span className={`${box} border-border bg-surface text-fg-1`}>{firstTitle?.name}</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {titles.map((t) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('title', t.slug)
        const isActive = t.slug === currentSlug
        return (
          <Link
            key={t.id}
            href={`${pathname}?${params.toString()}`}
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
