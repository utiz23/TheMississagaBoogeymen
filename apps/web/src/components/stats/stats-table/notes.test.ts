import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAREER_TOI_NOTE,
  expandedFailedNoteVisible,
  expandedKeyNoteVisible,
  LOCAL_RECORD_NOTE,
  collectFootnotes,
  localRecordNoteVisible,
} from './notes.ts'
import type { StatsSource } from './types.ts'

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

void test('switching Current → All Time drops the local-record note and adds the career note', () => {
  const base = { role: 'goalies' as const, source: src, visibleKeys: ['gp', 'w', 'l', 'otl'] }
  const current = collectFootnotes({ ...base, scope: 'current', activeRows: flagged })
  assert.ok(current.includes(LOCAL_RECORD_NOTE))
  assert.ok(!current.includes(CAREER_TOI_NOTE))
  // All Time rows are career rows: never flagged
  const allTime = collectFootnotes({ ...base, scope: 'allTime', activeRows: clean })
  assert.ok(!allTime.includes(LOCAL_RECORD_NOTE))
  assert.ok(allTime.includes(CAREER_TOI_NOTE))
  // …and back again
  const back = collectFootnotes({ ...base, scope: 'current', activeRows: flagged })
  assert.ok(back.includes(LOCAL_RECORD_NOTE) && !back.includes(CAREER_TOI_NOTE))
})

void test('career note uses the required wording', () => {
  assert.equal(
    CAREER_TOI_NOTE,
    'Career TOI is missing for some seasons, so TOI/GP and GAA may be inaccurate. Coverage review is pending.',
  )
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

void test('no generic note when expanded data is present, or for unspecified legacy sources', () => {
  assert.equal(keyNote({ hasExpanded: true }), false)
  assert.equal(keyNote({ sourceKind: 'unspecified' }), false)
  assert.equal(expandedFailedNoteVisible('current', false), false)
})
