'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The Press Box tab bar (the nav of the mock-up). Only the Overview and Relationships tabs are built in L1. */
const TABS = [
  { href: '/admin/press-box', label: 'Overview', exact: true },
  { href: '/admin/press-box/dossiers', label: 'Dossiers', exact: false },
  { href: '/admin/press-box/relationships', label: 'Relationships', exact: false },
  { href: '/admin/press-box/storylines', label: 'Storylines', exact: false },
  { href: '/admin/press-box/reporters', label: 'Reporters', exact: false },
] as const

export function PressBoxTabs() {
  const path = usePathname()
  return (
    <nav
      aria-label="Press Box"
      className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border-subtle"
    >
      {TABS.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href)
        return (
          <Link
            key={t.href}
            prefetch
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 py-3 font-condensed text-[13px] font-bold uppercase tracking-[0.14em] transition-colors ${
              active ? 'border-accent text-fg-1' : 'border-transparent text-fg-3 hover:text-fg-1'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
