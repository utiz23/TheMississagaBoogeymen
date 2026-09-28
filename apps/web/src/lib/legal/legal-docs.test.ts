import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGAL_DOCS,
  DRAFT_BANNER_TEXT,
  getLegalDoc,
  legalHref,
  legalMetadata,
  validateLegalDoc,
  publishedReferencesDraftViolations,
  formatLegalDate,
  isIsoDate,
  type LegalDocMeta,
} from './legal-docs.ts'

const EXPECTED_SLUGS = ['privacy', 'terms', 'data-collection', 'attribution'] as const

void test('all four legal documents are present, in the expected slugs', () => {
  assert.deepEqual(
    LEGAL_DOCS.map((doc) => doc.slug),
    [...EXPECTED_SLUGS],
  )
})

void test('every slug and href is unique', () => {
  const slugs = LEGAL_DOCS.map((doc) => doc.slug)
  const hrefs = LEGAL_DOCS.map((doc) => doc.href)
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug in LEGAL_DOCS')
  assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate href in LEGAL_DOCS')
})

void test('every href is exactly /legal/<slug>', () => {
  for (const doc of LEGAL_DOCS) {
    assert.equal(doc.href, `/legal/${doc.slug}`)
  }
})

void test('getLegalDoc resolves each real slug and throws on an unknown one', () => {
  for (const slug of EXPECTED_SLUGS) {
    assert.equal(getLegalDoc(slug).slug, slug)
  }
  assert.throws(() => getLegalDoc('not-a-real-slug' as never))
})

void test('legalHref matches the registry href for each document', () => {
  for (const doc of LEGAL_DOCS) {
    assert.equal(legalHref(doc.slug), doc.href)
  }
})

void test('DRAFT_BANNER_TEXT is the exact, single sentence the plan specifies', () => {
  assert.equal(DRAFT_BANNER_TEXT, 'Draft — not in effect.')
})

void test('every real document is currently a draft with no dates set', () => {
  for (const doc of LEGAL_DOCS) {
    assert.equal(doc.status, 'draft', `${doc.slug} must be status: 'draft' in Unit 1`)
    assert.equal(doc.effectiveDate, null, `${doc.slug} must have effectiveDate: null while draft`)
    assert.equal(doc.lastUpdated, null, `${doc.slug} must have lastUpdated: null while draft`)
  }
})

void test('validateLegalDoc accepts every real (draft) document as-is', () => {
  for (const doc of LEGAL_DOCS) {
    assert.deepEqual(validateLegalDoc(doc), [])
  }
})

void test('legalMetadata marks every real document noindex, nofollow, with a "(Draft)" title', () => {
  for (const doc of LEGAL_DOCS) {
    const metadata = legalMetadata(doc.slug)
    assert.equal(metadata.title, `${doc.title} (Draft) — Club Stats`)
    assert.equal(metadata.description, doc.description)
    assert.deepEqual(metadata.robots, {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    })
  }
})

void test('publishedReferencesDraftViolations is empty for the real, all-draft registry', () => {
  assert.deepEqual(publishedReferencesDraftViolations(LEGAL_DOCS), [])
})

/**
 * Nothing in `LEGAL_DOCS` is published today, so the two tests below use a
 * synthetic fixture rather than the real registry — they exist to prove the
 * validators actually enforce the FUTURE gate-flip invariants (published
 * dates, published-to-draft link safety), not just that they pass
 * vacuously against today's all-draft state.
 */

void test('isIsoDate: calendar-strict validation rejects impossible dates', () => {
  // Valid ordinary date.
  assert.equal(isIsoDate('2026-03-05'), true)

  // Valid leap day — 2028 is a leap year (divisible by 4, not by 100).
  assert.equal(isIsoDate('2028-02-29'), true)

  // Invalid non-leap day — 2027 is not a leap year.
  assert.equal(isIsoDate('2027-02-29'), false)

  // Invalid date — February has at most 29 days.
  assert.equal(isIsoDate('2026-02-30'), false)

  // Invalid month — there is no month 13.
  assert.equal(isIsoDate('2026-13-01'), false)

  // Malformed input: wrong shape, non-numeric, empty, and a value
  // Date.parse would normally accept but this format must not.
  assert.equal(isIsoDate('2026-3-5'), false)
  assert.equal(isIsoDate('2026/03/05'), false)
  assert.equal(isIsoDate('03-05-2026'), false)
  assert.equal(isIsoDate('2026-03-05T00:00:00Z'), false)
  assert.equal(isIsoDate('not-a-date'), false)
  assert.equal(isIsoDate(''), false)
})

function fixtureDoc(overrides: Partial<LegalDocMeta>): LegalDocMeta {
  return {
    slug: 'privacy',
    href: '/legal/privacy',
    title: 'Privacy Policy',
    footerLabel: 'Privacy Policy',
    description: 'fixture',
    status: 'draft',
    effectiveDate: null,
    lastUpdated: null,
    references: [],
    ...overrides,
  }
}

void test('validateLegalDoc: published-state date invariants (synthetic, for future use)', () => {
  const valid = fixtureDoc({
    status: 'published',
    effectiveDate: '2026-01-01',
    lastUpdated: '2026-01-02',
  })
  assert.deepEqual(validateLegalDoc(valid, new Date('2026-06-01T00:00:00Z')), [])

  const missingDates = fixtureDoc({ status: 'published' })
  assert.equal(validateLegalDoc(missingDates, new Date('2026-06-01T00:00:00Z')).length, 2)

  const lastUpdatedBeforeEffective = fixtureDoc({
    status: 'published',
    effectiveDate: '2026-03-01',
    lastUpdated: '2026-02-01',
  })
  assert.ok(
    validateLegalDoc(lastUpdatedBeforeEffective, new Date('2026-06-01T00:00:00Z')).some((e) =>
      e.includes('lastUpdated must not be earlier than effectiveDate'),
    ),
  )

  const dateInTheFuture = fixtureDoc({
    status: 'published',
    effectiveDate: '2099-01-01',
    lastUpdated: '2099-01-01',
  })
  assert.ok(
    validateLegalDoc(dateInTheFuture, new Date('2026-06-01T00:00:00Z')).some((e) =>
      e.includes('must not be in the future'),
    ),
  )

  const draftWithDates = fixtureDoc({ effectiveDate: '2026-01-01' })
  assert.ok(validateLegalDoc(draftWithDates).some((e) => e.includes('effectiveDate: null')))
})

void test('publishedReferencesDraftViolations catches a published document linking to a draft (synthetic, for future use)', () => {
  const published = fixtureDoc({
    slug: 'terms',
    href: '/legal/terms',
    status: 'published',
    effectiveDate: '2026-01-01',
    lastUpdated: '2026-01-01',
    references: ['privacy'],
  })
  const stillDraft = fixtureDoc({ slug: 'privacy', href: '/legal/privacy', status: 'draft' })

  const violations = publishedReferencesDraftViolations([published, stillDraft])
  assert.equal(violations.length, 1)
  assert.match(violations.at(0) ?? '', /terms is published but references draft document privacy/)

  const bothPublished = fixtureDoc({
    slug: 'privacy',
    href: '/legal/privacy',
    status: 'published',
    effectiveDate: '2026-01-01',
    lastUpdated: '2026-01-01',
  })
  assert.deepEqual(publishedReferencesDraftViolations([published, bothPublished]), [])
})

void test('formatLegalDate renders a stable, unambiguous long-form date', () => {
  assert.equal(formatLegalDate('2026-03-05'), 'March 5, 2026')
})
