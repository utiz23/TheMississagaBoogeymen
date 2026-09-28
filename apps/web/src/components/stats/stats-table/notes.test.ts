import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAREER_TOI_COVERAGE_FOOTNOTE,
  careerToiFootnoteVisible,
  expandedFailedNoteVisible,
  expandedKeyNoteVisible,
  gaaCoverageAnnotation,
  LOCAL_RECORD_NOTE,
  collectFootnotes,
  localRecordNoteVisible,
  toiCoverageAnnotation,
} from './notes.ts'
import type { CareerCoverage, StatsSource } from './types.ts'

const src: StatsSource = { kind: 'local-tracked', label: 'Local tracked 6s' }
const flagged = [{ recordUnavailable: true }]
const clean = [{ recordUnavailable: false }, {}]

void test('record note needs flagged ACTIVE rows AND a visible W/L/OTL column', () => {
  assert.equal(localRecordNoteVisible('goalies', ['gp', 'w', 'l', 'otl'], flagged), true)
  assert.equal(localRecordNoteVisible('goalies', ['gp', 'svp', 'gaa'], flagged), false)
  assert.equal(localRecordNoteVisible('goalies', ['gp', 'w'], clean), false)
  assert.equal(localRecordNoteVisible('skaters', ['gp', 'w'], flagged), false)
  assert.equal(localRecordNoteVisible('goalies', ['gp', 'l'], []), false)
})

void test('switching Current → All Time drops the local-record note; the career coverage footnote only appears when a partial-coverage row is on screen', () => {
  const base = {
    role: 'goalies' as const,
    source: src,
    visibleKeys: ['gp', 'w', 'l', 'otl', 'gaa'],
  }
  const current = collectFootnotes({ ...base, scope: 'current', activeRows: flagged })
  assert.ok(current.includes(LOCAL_RECORD_NOTE))
  assert.ok(!current.includes(CAREER_TOI_COVERAGE_FOOTNOTE))
  // All Time rows are career rows: never flagged for the local-record note
  const partialGaa: CareerCoverage = { state: 'partial', coveredGp: 26, totalGp: 210 }
  const allTime = collectFootnotes({
    ...base,
    scope: 'allTime',
    activeRows: [{ recordUnavailable: false, gaaCoverage: partialGaa }],
  })
  assert.ok(!allTime.includes(LOCAL_RECORD_NOTE))
  assert.ok(allTime.includes(CAREER_TOI_COVERAGE_FOOTNOTE))
  // …and back again
  const back = collectFootnotes({ ...base, scope: 'current', activeRows: flagged })
  assert.ok(back.includes(LOCAL_RECORD_NOTE) && !back.includes(CAREER_TOI_COVERAGE_FOOTNOTE))
})

void test('careerToiFootnoteVisible: false for Current scope regardless of coverage', () => {
  const partial: CareerCoverage = { state: 'partial', coveredGp: 1, totalGp: 2 }
  assert.equal(careerToiFootnoteVisible('current', ['toigp'], [{ toiCoverage: partial }]), false)
})

void test('careerToiFootnoteVisible: false when no relevant metric is visible', () => {
  const partial: CareerCoverage = { state: 'partial', coveredGp: 1, totalGp: 2 }
  assert.equal(
    careerToiFootnoteVisible('allTime', ['gp', 'pts'], [{ toiCoverage: partial }]),
    false,
  )
})

void test('careerToiFootnoteVisible: false for complete-only or unavailable-only rows', () => {
  const complete: CareerCoverage = { state: 'complete', coveredGp: 5, totalGp: 5 }
  const unavailable: CareerCoverage = { state: 'unavailable', coveredGp: 0, totalGp: 5 }
  assert.equal(careerToiFootnoteVisible('allTime', ['toigp'], [{ toiCoverage: complete }]), false)
  assert.equal(
    careerToiFootnoteVisible('allTime', ['toigp'], [{ toiCoverage: unavailable }]),
    false,
  )
})

void test('careerToiFootnoteVisible: true when a visible metric has a partial-coverage row (skater TOI/GP or goalie TOI/TOI-GP/GAA)', () => {
  const partial: CareerCoverage = { state: 'partial', coveredGp: 1, totalGp: 2 }
  assert.equal(careerToiFootnoteVisible('allTime', ['toigp'], [{ toiCoverage: partial }]), true)
  assert.equal(careerToiFootnoteVisible('allTime', ['toi'], [{ toiCoverage: partial }]), true)
  assert.equal(careerToiFootnoteVisible('allTime', ['gaa'], [{ gaaCoverage: partial }]), true)
})

// ─── Metric-specific footnote: a visible column's own coverage field only ──

void test('careerToiFootnoteVisible: GAA visible + TOI partial + GAA complete => false (no visible cell would carry the marker)', () => {
  const row = {
    toiCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage,
    gaaCoverage: { state: 'complete', coveredGp: 2, totalGp: 2 } as CareerCoverage,
  }
  assert.equal(careerToiFootnoteVisible('allTime', ['gaa'], [row]), false)
})

void test('careerToiFootnoteVisible: GAA visible + TOI partial + GAA unavailable => false', () => {
  const row = {
    toiCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage,
    gaaCoverage: { state: 'unavailable', coveredGp: 0, totalGp: 2 } as CareerCoverage,
  }
  assert.equal(careerToiFootnoteVisible('allTime', ['gaa'], [row]), false)
})

void test('careerToiFootnoteVisible: GAA visible + GAA partial => true', () => {
  const row = { gaaCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage }
  assert.equal(careerToiFootnoteVisible('allTime', ['gaa'], [row]), true)
})

void test('careerToiFootnoteVisible: TOI visible + GAA partial + TOI complete => false', () => {
  const row = {
    toiCoverage: { state: 'complete', coveredGp: 2, totalGp: 2 } as CareerCoverage,
    gaaCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage,
  }
  assert.equal(careerToiFootnoteVisible('allTime', ['toi'], [row]), false)
  assert.equal(careerToiFootnoteVisible('allTime', ['toigp'], [row]), false)
})

void test('careerToiFootnoteVisible: TOI/GP visible + TOI partial => true', () => {
  const row = { toiCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage }
  assert.equal(careerToiFootnoteVisible('allTime', ['toigp'], [row]), true)
})

void test('careerToiFootnoteVisible: both categories visible + either matching coverage partial => true', () => {
  const toiPartialOnly = {
    toiCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage,
    gaaCoverage: { state: 'complete', coveredGp: 2, totalGp: 2 } as CareerCoverage,
  }
  assert.equal(careerToiFootnoteVisible('allTime', ['toi', 'gaa'], [toiPartialOnly]), true)

  const gaaPartialOnly = {
    toiCoverage: { state: 'complete', coveredGp: 2, totalGp: 2 } as CareerCoverage,
    gaaCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage,
  }
  assert.equal(careerToiFootnoteVisible('allTime', ['toigp', 'gaa'], [gaaPartialOnly]), true)
})

void test('careerToiFootnoteVisible: Current scope and unrelated views remain false regardless of coverage', () => {
  const bothPartial = {
    toiCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage,
    gaaCoverage: { state: 'partial', coveredGp: 1, totalGp: 2 } as CareerCoverage,
  }
  assert.equal(careerToiFootnoteVisible('current', ['toi', 'gaa'], [bothPartial]), false)
  assert.equal(careerToiFootnoteVisible('allTime', ['gp', 'pts'], [bothPartial]), false)
})

void test('toiCoverageAnnotation: complete has accessible text and no marker', () => {
  const a = toiCoverageAnnotation({ state: 'complete', coveredGp: 46, totalGp: 46 })
  assert.equal(a?.marker, undefined)
  assert.equal(a?.srText, 'Based on all 46 GP with recorded time on ice.')
})

void test('toiCoverageAnnotation: partial has a visible marker and exact coverage wording', () => {
  const a = toiCoverageAnnotation({ state: 'partial', coveredGp: 26, totalGp: 210 })
  assert.equal(a?.marker, '*')
  // `a` is narrowed non-undefined by the assertion above.
  assert.equal(a.srText, 'Based on 26 of 210 GP with recorded time on ice.')
})

void test('toiCoverageAnnotation: unavailable has no marker', () => {
  const a = toiCoverageAnnotation({ state: 'unavailable', coveredGp: 0, totalGp: 21 })
  assert.equal(a?.marker, undefined)
  assert.equal(a?.srText, 'No time on ice was recorded for this player’s career history.')
})

void test('toiCoverageAnnotation: undefined coverage (non-career row) yields no annotation', () => {
  assert.equal(toiCoverageAnnotation(undefined), undefined)
})

void test('gaaCoverageAnnotation: mentions both TOI and GA for every state', () => {
  const complete = gaaCoverageAnnotation({ state: 'complete', coveredGp: 14, totalGp: 14 })
  assert.match(complete?.srText ?? '', /time on ice and goals against/)
  const partial = gaaCoverageAnnotation({ state: 'partial', coveredGp: 26, totalGp: 210 })
  assert.equal(partial?.marker, '*')
  // `partial` is narrowed non-undefined by the assertion above.
  assert.match(partial.srText, /26 of 210 GP with recorded time on ice and goals against/)
  const unavailable = gaaCoverageAnnotation({ state: 'unavailable', coveredGp: 0, totalGp: 21 })
  assert.match(unavailable?.srText ?? '', /No matching time-on-ice and goals-against coverage/)
})

void test('source notes are always included', () => {
  const notes = collectFootnotes({
    role: 'skaters',
    scope: 'current',
    source: { kind: 'archive-club-member', label: 'x', notes: ['archive caveat'] },
    visibleKeys: ['gp'],
    activeRows: [],
  })
  assert.deepEqual(notes, ['archive caveat'])
})

const keyNote = (over: Partial<Parameters<typeof expandedKeyNoteVisible>[0]> = {}) =>
  expandedKeyNoteVisible({
    hasExpanded: false,
    sourceKind: 'ea-season',
    scope: 'current',
    expandedFailed: false,
    ...over,
  })

void test('expanded query FAILED in All mode: failure notice only, no generic availability text', () => {
  assert.equal(expandedFailedNoteVisible('current', true), true)
  assert.equal(keyNote({ expandedFailed: true }), false)
})

void test('expanded genuinely out of scope keeps the generic explanation (local, archive, career)', () => {
  assert.equal(keyNote({ sourceKind: 'local-tracked' }), true)
  assert.equal(keyNote({ sourceKind: 'archive-club-member' }), true)
  assert.equal(keyNote({ sourceKind: 'career', scope: 'allTime' }), true)
  // failure in the current scope does not hide the explanation once All Time is shown
  assert.equal(expandedFailedNoteVisible('allTime', true), false)
  assert.equal(keyNote({ sourceKind: 'career', scope: 'allTime', expandedFailed: true }), true)
})

void test('archive-player-card is treated like every other real source: expanded stats are out of scope', () => {
  assert.equal(keyNote({ sourceKind: 'archive-player-card' }), true)
  assert.equal(keyNote({ sourceKind: 'archive-player-card', hasExpanded: true }), false)
})

void test('no generic note when expanded data is present, or for unspecified legacy sources', () => {
  assert.equal(keyNote({ hasExpanded: true }), false)
  assert.equal(keyNote({ sourceKind: 'unspecified' }), false)
  assert.equal(expandedFailedNoteVisible('current', false), false)
})
