import Link from 'next/link'

interface SectionHeaderProps {
  /** The section label, rendered UPPERCASE. */
  label: string
  /**
   * Optional secondary line below the label. Use sparingly — for context that
   * belongs with the section label (e.g. "Last 15 skater appearances · most
   * recent first") rather than provenance (which goes in StatStrip).
   */
  subtitle?: string
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
 * the optional CTA arrow. Optional subtitle renders below the label
 * in dimmer text for sections that need contextual sub-text.
 */
export function SectionHeader({
  label,
  subtitle,
  cta,
  as: Heading = 'h2',
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-baseline justify-between ${className}`}>
      <div className="flex flex-col gap-0.5">
        <Heading className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:text-sm">
          {label}
        </Heading>
        {subtitle ? (
          <p className="font-condensed text-[11px] uppercase tracking-wider text-zinc-600">
            {subtitle}
          </p>
        ) : null}
      </div>
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
