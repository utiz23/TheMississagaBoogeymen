interface LegalContentsSection {
  number: number
  heading: string
}

interface LegalContentsProps {
  sections: readonly LegalContentsSection[]
}

/**
 * The per-document table of contents: one `#section-N` anchor per section,
 * in a single column below `sm` and an auto-filling grid from `sm` up.
 * Generated from the same `sections` data the page passes to
 * `LegalSection`, so an anchor here can never point at a heading id that
 * does not exist.
 */
export function LegalContents({ sections }: LegalContentsProps) {
  return (
    <nav
      aria-labelledby="legal-contents-label"
      className="border border-border bg-surface p-5 nav:p-6"
    >
      <p
        id="legal-contents-label"
        className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4"
      >
        Contents
      </p>
      <ol className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {sections.map((section) => (
          <li key={section.number}>
            <a
              href={`#section-${String(section.number)}`}
              className="font-condensed text-xs font-bold uppercase tracking-[0.1em] text-fg-3 transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {String(section.number).padStart(2, '0')} · {section.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
