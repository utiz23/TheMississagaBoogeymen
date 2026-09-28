import type { ReactNode } from 'react'

interface LegalSectionProps {
  number: number
  heading: string
  children: ReactNode
}

/**
 * One numbered section of a legal document: `#section-N` anchor target
 * (what the Contents nav and the cross-document links point at),
 * `aria-labelledby`-linked heading, and a decorative large numeral shown
 * only from `md` up (hidden from assistive tech — the real heading text
 * already carries the number).
 */
export function LegalSection({ number, heading, children }: LegalSectionProps) {
  const id = `section-${String(number)}`
  const headingId = `${id}-heading`

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="scroll-mt-24 border-b border-border-subtle py-7 last:border-b-0"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[72px_1fr] md:gap-6">
        <div
          aria-hidden
          className="hidden font-condensed text-3xl font-black leading-none text-fg-6 md:block"
        >
          {String(number).padStart(2, '0')}
        </div>
        <div className="min-w-0">
          <h2
            id={headingId}
            className="font-condensed text-lg font-bold uppercase tracking-[0.08em] text-fg-1"
          >
            {number}. {heading}
          </h2>
          <div className="mt-3 max-w-[70ch] space-y-4 text-[15px] leading-[1.65] text-fg-2">
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}
