import type { Metadata } from 'next'

/**
 * The four legal documents Gate 3 requires (operational-v1-roadmap.md,
 * "Legal surface and global footer"). Routes were decided at E2H
 * (2026-09-10; HANDOFF.md, "E2H GATE 2 DRAFTING CHECKPOINTS AND FUTURE
 * LEGAL ROUTES APPROVED"): /legal/privacy, /legal/terms,
 * /legal/data-collection, /legal/attribution.
 */
export type LegalSlug = 'privacy' | 'terms' | 'data-collection' | 'attribution'

export interface LegalDocMeta {
  slug: LegalSlug
  href: `/legal/${LegalSlug}`
  /** Document title, used in the <h1> and (undrafted) in <title>. */
  title: string
  /** Label used in the cross-document index / footer link. */
  footerLabel: string
  /** One-line <meta name="description">. */
  description: string
  status: 'draft' | 'published'
  /** ISO yyyy-mm-dd. MUST be null while status is 'draft'. */
  effectiveDate: string | null
  /** ISO yyyy-mm-dd. MUST be null while status is 'draft'. */
  lastUpdated: string | null
  /**
   * Other legal documents this one links to from its public text (via
   * `DocLink`). Used to check that a published document never links to a
   * still-draft one (see `publishedReferencesDraftViolations` below).
   */
  references: readonly LegalSlug[]
}

/**
 * The exact, single visible banner text every draft-gated legal page shows.
 * A single constant so the banner component and every test that looks for
 * it stay byte-identical by construction.
 */
export const DRAFT_BANNER_TEXT = 'Draft — not in effect.'

/**
 * THE DRAFT GATE.
 *
 * This registry is the only place that says whether a legal document is
 * live. Every other signal — the visible banner, the "(Draft)" title
 * suffix, `robots: noindex, nofollow`, the omitted effective/last-updated
 * rows, and the "Draft" tag in the cross-document index — is DERIVED from
 * `status` here, never set independently on a page.
 *
 * Flipping a document to `status: 'published'` with real `effectiveDate`/
 * `lastUpdated` values is the intended future one-file gate flip — but by
 * itself that flip is NOT publication. Publication additionally requires:
 * closing each draft's publication blockers (counsel review, the
 * Cloudflare Web Analytics variant swap, the logging inventory, the AI/TDM
 * crawler decision, and the rest — see the plan's blocker table), revising
 * and re-transcribing any draft text that changes as a result, adding
 * canonical URLs and sitemap entries, a separate owner authorization, a
 * merge to main, and a deploy. None of that happens by editing this file.
 */
export const LEGAL_DOCS: readonly LegalDocMeta[] = [
  {
    slug: 'privacy',
    href: '/legal/privacy',
    title: 'Privacy Policy',
    footerLabel: 'Privacy Policy',
    description:
      'How this site collects, uses, and retains information, and how to make a request about it.',
    status: 'draft',
    effectiveDate: null,
    lastUpdated: null,
    references: ['data-collection'],
  },
  {
    slug: 'terms',
    href: '/legal/terms',
    title: 'Terms of Use',
    footerLabel: 'Terms of Use',
    description:
      'The rules for using this website, including permitted use, accuracy, and liability.',
    status: 'draft',
    effectiveDate: null,
    lastUpdated: null,
    references: ['privacy', 'data-collection', 'attribution'],
  },
  {
    slug: 'data-collection',
    href: '/legal/data-collection',
    title: 'Data Collection Policy',
    footerLabel: 'Data Collection Policy',
    description:
      'The detailed inventory of what this site collects, where it comes from, and how long it is kept.',
    status: 'draft',
    effectiveDate: null,
    lastUpdated: null,
    references: [],
  },
  {
    slug: 'attribution',
    href: '/legal/attribution',
    title: 'Attribution & Non-Affiliation Notice',
    footerLabel: 'Attribution & Non-Affiliation Notice',
    description:
      "Where this site's EA-sourced data and third-party visual material come from, and our non-affiliation statement.",
    status: 'draft',
    effectiveDate: null,
    lastUpdated: null,
    references: ['terms'],
  },
] as const

export function getLegalDoc(slug: LegalSlug): LegalDocMeta {
  const doc = LEGAL_DOCS.find((candidate) => candidate.slug === slug)
  if (!doc) {
    throw new Error(`unknown legal document slug: ${slug}`)
  }
  return doc
}

export function legalHref(slug: LegalSlug): LegalDocMeta['href'] {
  return getLegalDoc(slug).href
}

/**
 * Builds the route's `export const metadata`. The `(Draft)` title suffix
 * and `noindex, nofollow` robots directives (including `googleBot`) are
 * derived from `status` and cannot be set independently by a page.
 */
export function legalMetadata(slug: LegalSlug): Metadata {
  const doc = getLegalDoc(slug)
  const isDraft = doc.status === 'draft'
  const title = isDraft ? `${doc.title} (Draft) — Club Stats` : `${doc.title} — Club Stats`

  return {
    title,
    description: doc.description,
    ...(isDraft
      ? {
          robots: {
            index: false,
            follow: false,
            googleBot: { index: false, follow: false },
          },
        }
      : {}),
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Calendar-strict ISO yyyy-mm-dd validation. `Date.parse`/`Date.UTC` on
 * their own NORMALIZE an impossible date instead of rejecting it — e.g.
 * `2026-02-30` silently becomes March 2, 2026 — so a regex-plus-Date.parse
 * check would wrongly accept it. This constructs the UTC date and then
 * round-trips its year/month/day back against the parsed input: an
 * impossible date (Feb 30, a Feb 29 outside a leap year, a month over 12,
 * …) always rolls over to a different calendar date, so the round-trip
 * comparison catches it.
 */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value)
  if (!match) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/**
 * Invariant checks for one document's status/date fields. Every real entry
 * in `LEGAL_DOCS` is a draft today, so the "published" branch below is
 * exercised only by `legal-docs.test.ts`'s synthetic fixtures — it exists
 * for the future gate flip, not for anything currently in this registry.
 */
export function validateLegalDoc(doc: LegalDocMeta, now: Date = new Date()): string[] {
  const errors: string[] = []

  if (doc.status === 'draft') {
    if (doc.effectiveDate !== null) {
      errors.push(`${doc.slug}: draft document must have effectiveDate: null`)
    }
    if (doc.lastUpdated !== null) {
      errors.push(`${doc.slug}: draft document must have lastUpdated: null`)
    }
    return errors
  }

  // status === 'published'
  if (doc.effectiveDate === null || !isIsoDate(doc.effectiveDate)) {
    errors.push(`${doc.slug}: published document must have a valid ISO effectiveDate`)
  }
  if (doc.lastUpdated === null || !isIsoDate(doc.lastUpdated)) {
    errors.push(`${doc.slug}: published document must have a valid ISO lastUpdated`)
  }
  if (
    doc.effectiveDate &&
    doc.lastUpdated &&
    isIsoDate(doc.effectiveDate) &&
    isIsoDate(doc.lastUpdated)
  ) {
    if (doc.lastUpdated < doc.effectiveDate) {
      errors.push(`${doc.slug}: lastUpdated must not be earlier than effectiveDate`)
    }
    const todayIso = now.toISOString().slice(0, 10)
    if (doc.effectiveDate > todayIso) {
      errors.push(`${doc.slug}: effectiveDate must not be in the future`)
    }
    if (doc.lastUpdated > todayIso) {
      errors.push(`${doc.slug}: lastUpdated must not be in the future`)
    }
  }
  return errors
}

/**
 * Flags a published document that still links to a document that is not
 * itself published. Every entry in `LEGAL_DOCS` is a draft today, so this
 * is vacuously `[]` for the real registry right now — the rule exists for
 * the future gate flip. `legal-docs.test.ts` proves the rule actually
 * catches a violation using a synthetic fixture, independent of today's
 * all-draft state.
 */
export function publishedReferencesDraftViolations(
  docs: readonly LegalDocMeta[] = LEGAL_DOCS,
): string[] {
  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]))
  const violations: string[] = []
  for (const doc of docs) {
    if (doc.status !== 'published') continue
    for (const ref of doc.references) {
      const target = bySlug.get(ref)
      if (target && target.status !== 'published') {
        violations.push(`${doc.slug} is published but references draft document ${ref}`)
      }
    }
  }
  return violations
}

/**
 * Formats an ISO yyyy-mm-dd date for display. Only used once a document is
 * published — draft pages render no date at all.
 */
export function formatLegalDate(iso: string): string {
  const parts = iso.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const day = Number(parts[2])
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
