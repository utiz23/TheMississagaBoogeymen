'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/games', label: 'Games' },
  { href: '/roster', label: 'Roster' },
  { href: '/stats', label: 'Stats' },
] as const

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')
}

function buildHref(href: string, title: string | null): string {
  return title ? `${href}?title=${encodeURIComponent(title)}` : href
}

export function NavLinks({ variant }: { variant: 'desktop' | 'mobile' }) {
  const pathname = usePathname()
  const title = useSearchParams().get('title')

  if (variant === 'desktop') {
    return (
      <nav className="hidden sm:flex self-stretch items-center gap-5">
        {LINKS.map(({ href, label }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={buildHref(href, title)}
              className={[
                'relative flex self-stretch items-center px-1',
                'font-condensed text-sm font-bold uppercase tracking-[0.15em] transition-colors',
                active ? 'text-zinc-50' : 'text-zinc-400 hover:text-zinc-100',
              ].join(' ')}
            >
              <span>{label}</span>
              {active && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent"
                />
              )}
            </Link>
          )
        })}
      </nav>
    )
  }

  return (
    <div className="flex divide-x divide-zinc-800/60">
      {LINKS.map(({ href, label }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            key={href}
            href={buildHref(href, title)}
            className={[
              'relative flex-1 py-2 text-center transition-colors',
              'text-xs font-semibold uppercase tracking-wider',
              active
                ? 'bg-surface-raised text-zinc-200'
                : 'text-zinc-400 hover:bg-surface-raised hover:text-zinc-200',
            ].join(' ')}
          >
            <span>{label}</span>
            {active && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent"
              />
            )}
          </Link>
        )
      })}
    </div>
  )
}
