import type { ReactNode } from 'react'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { getLegalDoc, formatLegalDate, type LegalSlug } from '@/lib/legal/legal-docs'
import { DraftBanner } from './draft-banner'
import { LegalContents } from './legal-contents'
import { LegalDocIndex } from './legal-doc-index'
import { LegalSection } from './legal-section'

export interface LegalPageSection {
  number: number
  heading: string
  body: ReactNode
}

interface LegalPageProps {
  slug: LegalSlug
  /** The document's public intro paragraph(s), or `null` when it has none. */
  intro: ReactNode
  sections: readonly LegalPageSection[]
}

/**
 * The one shared shell every legal route renders through. Reading order —
 * and therefore what a screen reader announces first — is: draft banner,
 * then the <h1> hero, then the Contents nav, then the transcribed document
 * body, then the cross-document index.
 *
 * `data-legal-content` marks the element that holds ONLY the transcribed
 * public-document content (the intro and the numbered sections) — never
 * the hero, the draft banner, the meta row, the Contents nav, or the
 * cross-document index. The fidelity check in `test/legal-http.test.ts`
 * compares this element's text against the source draft and nothing else,
 * so a decorative or navigational element here can never fail — or
 * silently pass — that check.
 */
export function LegalPage({ slug, intro, sections }: LegalPageProps) {
  const doc = getLegalDoc(slug)
  const isDraft = doc.status === 'draft'

  return (
    <article aria-labelledby="legal-title" className="space-y-8">
      {isDraft ? <DraftBanner /> : null}

      <BroadcastPanel className="px-6 py-8 nav:px-10 nav:py-10">
        <p className="font-condensed text-xs font-semibold uppercase tracking-[0.24em] text-fg-4">
          Legal
        </p>
        <h1
          id="legal-title"
          className="mt-2 font-condensed text-4xl font-black uppercase leading-[0.95] tracking-[0.02em] text-fg-1 sm:text-5xl nav:text-[56px]"
        >
          {doc.title}
        </h1>
        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
          <div className="flex items-baseline gap-2">
            <dt className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
              Status
            </dt>
            <dd className="font-condensed text-sm font-bold uppercase tracking-[0.1em] text-fg-2">
              {isDraft ? 'Draft' : 'Published'}
            </dd>
          </div>
          {/* Effective/Last updated rows render ONLY once a document is
              published, and never for a draft — see the plan's draft-gate
              spec. Omitted entirely rather than shown blank or as
              placeholder text. */}
          {!isDraft && doc.effectiveDate ? (
            <div className="flex items-baseline gap-2">
              <dt className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
                Effective
              </dt>
              <dd className="tabular font-condensed text-sm font-bold text-fg-2">
                <time dateTime={doc.effectiveDate}>{formatLegalDate(doc.effectiveDate)}</time>
              </dd>
            </div>
          ) : null}
          {!isDraft && doc.lastUpdated ? (
            <div className="flex items-baseline gap-2">
              <dt className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
                Last updated
              </dt>
              <dd className="tabular font-condensed text-sm font-bold text-fg-2">
                <time dateTime={doc.lastUpdated}>{formatLegalDate(doc.lastUpdated)}</time>
              </dd>
            </div>
          ) : null}
        </dl>
      </BroadcastPanel>

      <LegalContents sections={sections} />

      <div data-legal-content className="space-y-8 border-t border-border pt-8">
        {intro ? (
          <div className="max-w-[70ch] text-[15px] leading-[1.65] text-fg-2">{intro}</div>
        ) : null}
        <div>
          {sections.map((section) => (
            <LegalSection key={section.number} number={section.number} heading={section.heading}>
              {section.body}
            </LegalSection>
          ))}
        </div>
      </div>

      <LegalDocIndex current={slug} />
    </article>
  )
}
