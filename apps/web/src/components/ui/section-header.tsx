import Link from 'next/link'

interface SectionHeaderProps {
  /** The section label, rendered UPPERCASE. */
  label: string
  /** Optional right-side call-to-action with arrow. */
  cta?: {
    href: string
    label: string
  }
  /**
   * Heading level for accessibility. Defaults to h2.
   * Use h1 only on the page hero.
   */
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}

/**
 * Section header — the "LATEST RESULT", "SCORING LEADERS" rule that
 * runs above every page section. Uppercase wide-tracking label in
 * font-condensed, dim zinc-500 on the label, lifting to zinc-100 on
 * the optional CTA arrow.
 */
export function SectionHeader({
  label,
  cta,
  as: Heading = 'h2',
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-baseline justify-between ${className}`}>
      <Heading className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:text-sm">
        {label}
      </Heading>
      {cta ? (
        <Link
          href={cta.href}
          className="font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-100"
        >
          {cta.label} <span aria-hidden>→</span>
        </Link>
      ) : null}
    </div>
  )
}
