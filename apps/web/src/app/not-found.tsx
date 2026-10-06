import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { getResultStyle } from '@/lib/result-colors'

/**
 * Scoreboard-style 404, built from the operator's "Custom 404 scoreboard
 * design" Claude Design export (2026-09-08, `404 Page.dc.html`; catalogued in
 * docs/planning/launch-page-design-prototypes.md). The site header and footer
 * come from the root layout, so only the card and the buttons live here.
 */

const BUTTON =
  'border px-[18px] py-2.5 font-condensed text-xs font-bold uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const SECONDARY_LINKS = [
  { href: '/games', label: 'Games' },
  { href: '/roster', label: 'Roster' },
  { href: '/stats', label: 'Stats' },
] as const

function Side({
  label,
  dashed,
  children,
}: {
  label: string
  dashed?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full border border-border bg-black/25 sm:h-[88px] sm:w-[88px] ${dashed ? 'border-dashed' : ''}`}
      >
        {children}
      </div>
      <span className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-fg-3">
        {label}
      </span>
    </div>
  )
}

export default function NotFound() {
  const dnf = getResultStyle('DNF')

  return (
    <div className="flex min-h-[60vh] items-center justify-center py-6">
      <div className="w-full max-w-[820px]">
        <section aria-labelledby="not-found-title" className="broadcast-panel-strong">
          <span aria-hidden="true" className="ticker-strip ticker-strip-thin block" />

          <div className="flex items-center justify-between gap-4 px-6 py-5">
            <h1
              id="not-found-title"
              className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4"
            >
              Page not found
            </h1>
            <span
              className={`rounded-full border px-3 py-[3px] font-condensed text-[11px] font-bold uppercase tracking-[0.18em] ${dnf.container}`}
            >
              {dnf.label}
            </span>
          </div>

          {/* Decorative scoreboard: the heading and the line below carry the meaning. */}
          <div
            aria-hidden="true"
            className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 pb-12 pt-10 sm:gap-6 sm:px-8 sm:pt-14"
          >
            <Side label="BGM">
              <Image
                src="/images/bgm-logo.png"
                alt=""
                width={56}
                height={56}
                className="h-10 w-10 object-contain sm:h-14 sm:w-14"
              />
            </Side>
            <div className="text-center">
              <p className="font-condensed text-6xl font-black leading-[0.9] tabular-nums text-fg-1 [text-shadow:0_0_14px_rgba(232,65,49,0.2)] sm:text-[5.75rem]">
                404
              </p>
              <p className="mt-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.24em] text-fg-5">
                No result
              </p>
            </div>
            <Side label="UNK" dashed>
              <span className="font-condensed text-2xl font-black text-fg-6">?</span>
            </Side>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border-subtle px-6 py-[18px]">
            <p className="text-sm text-fg-3">This route is not on the schedule.</p>
            <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
              HTTP 404 · no record
            </p>
          </div>
        </section>

        <nav aria-label="Where to next" className="mt-6 flex flex-wrap gap-3">
          <Link
            prefetch
            href="/"
            className={`${BUTTON} border-accent-line bg-accent-soft text-accent-readable hover:bg-[rgba(232,65,49,0.18)]`}
          >
            Back to home
          </Link>
          {SECONDARY_LINKS.map((link) => (
            <Link
              prefetch
              key={link.href}
              href={link.href}
              className={`${BUTTON} border-border text-fg-3 hover:border-fg-5 hover:text-fg-1`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  )
}
