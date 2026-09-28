import Link from 'next/link'
import { LEGAL_DOCS, type LegalSlug } from '@/lib/legal/legal-docs'

interface LegalDocIndexProps {
  current: LegalSlug
}

/**
 * The cross-document index: all four legal documents, every time, on every
 * legal page — including the current one, marked with `aria-current`. This
 * is what makes every legal cross-link resolve from every legal page, not
 * just the ones a given document's own body happens to mention.
 */
export function LegalDocIndex({ current }: LegalDocIndexProps) {
  return (
    <nav aria-label="Legal documents" className="border-t border-border pt-6">
      <p className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4">
        Legal documents
      </p>
      <ul className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
        {LEGAL_DOCS.map((doc) => {
          const isCurrent = doc.slug === current
          return (
            <li key={doc.slug}>
              <Link
                href={doc.href}
                aria-current={isCurrent ? 'page' : undefined}
                className="inline-flex items-center gap-2 font-condensed text-sm font-bold uppercase tracking-[0.08em] text-fg-3 transition-colors hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {doc.footerLabel}
                {doc.status === 'draft' ? (
                  <span className="rounded-xs border border-accent-line px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
                    Draft
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
