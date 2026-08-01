/**
 * Unit tests for resolve-period.ts — the period fallback that silently dropped
 * post-game events rows under the live `pass2/seg-NNN-<screen>/` capture layout.
 *
 * Regression anchor: match 2661, extraction 27191, capture
 *   …/pass2/seg-084-post_game_events/00004.png
 *
 * That frame holds 8 rows. Seven carry `period_number: 0` / `period_label: '?'`
 * because the post-game Events screen SCROLLS: the parser sets the period only
 * when it passes a "NTH PERIOD" header line (parsers.py:2314-2325 seeds
 * `current_period_label = '?'`), so every row rendered ABOVE the frame's first
 * visible header is emitted unlabelled. The 8th row sits below the "3RD PERIOD"
 * header and is labelled.
 *
 * Under the old resolver those seven rows fell through to `periodFromPath`,
 * which only recognises the retired `…/1st-Period-Events/` folder scheme. The
 * seg-NNN folder names a SCREEN, not a period, so it returned null → period 0 →
 * `skipped_bad_period`, and the row vanished with no error. Corpus-wide that
 * fallback matched 0 of 1193 post_game_events captures — it was entirely dead.
 *
 * The recovery rule ("a '?' row precedes the frame's first header, so it
 * belongs to the period before it") was validated against 160 rows whose true
 * period is independently known from a sibling frame that did capture the
 * header: 159 correct, and the single miss has self-contradictory ground truth
 * (labelled 1ST in one frame and 2ND in another).
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/ocr-promoters/__tests__/resolve-period.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalPeriodLabel,
  firstLabeledPeriod,
  periodFromPath,
  resolveEventPeriod,
  resolvePeriod,
} from '../resolve-period.js'

/** The real capture path for match 2661's events frames. */
const SEG_PATH =
  '/home/michal/ingest-cache/4b8a77d091a96e352c39b8ade5db811ebea663f29e4f4f5849c18d14ceba03e9' +
  '/pass2/seg-084-post_game_events/00004.png'

/** The retired layout, kept working for legacy re-ingests. */
const LEGACY_PATH = '/mnt/k/NHL/NHL26/match250/2nd-Period-Events/00003.png'

/**
 * Extraction 27191 verbatim (period_number / period_label only — the fields the
 * resolver reads). Row 7 is the penalty this session exists to recover:
 * "Tripping [Minor] [19:04] j. struble".
 */
const MATCH_2661_FRAME = [
  { period_number: 0, period_label: '?' }, // 1  unknown  U3:13 M. Rantanen
  { period_number: 0, period_label: '?' }, // 2  goal     04:22 M. Rantanen
  { period_number: 0, period_label: '?' }, // 3  goal     06:51 Silky
  { period_number: 0, period_label: '?' }, // 4  goal     08:01 P. Beav
  { period_number: 0, period_label: '?' }, // 5  goal     08:20 F. Potfan
  { period_number: 0, period_label: '?' }, // 6  goal     10:59 Silky
  { period_number: 0, period_label: '?' }, // 7  penalty  Tripping [Minor] [19:04] j. struble
  { period_number: 3, period_label: '3RD' }, // 8  goal   19:46 P. Beav
]

/** Index of the penalty row inside MATCH_2661_FRAME. */
const PENALTY_ROW = MATCH_2661_FRAME[6]!

// ── The dead path fallback ────────────────────────────────────────────────────

test('periodFromPath: seg-NNN capture layout names a screen, not a period', () => {
  assert.equal(periodFromPath(SEG_PATH), null)
})

test('periodFromPath: still resolves the retired per-period folder layout', () => {
  assert.equal(periodFromPath(LEGACY_PATH), 2)
  assert.equal(periodFromPath('/x/1st-Period-Events/00001.png'), 1)
  assert.equal(periodFromPath('/x/3rd-Period-Events/00001.png'), 3)
  assert.equal(periodFromPath('/x/OT-Events/00001.png'), 4)
})

// ── The bug: the old resolver drops match 2661's penalty ──────────────────────

test('resolvePeriod (path-only fallback) DROPS the seg-NNN penalty row', () => {
  // This is the pre-fix behaviour, kept under test so the regression can never
  // reappear silently: events.ts skipped every row whose resolved period < 1.
  const resolved = resolvePeriod(PENALTY_ROW.period_number, SEG_PATH)
  assert.equal(resolved, 0, 'path-only fallback yields 0 for the seg-NNN layout')
  assert.ok(resolved < 1, 'and a period < 1 is what made the promoter drop the row')
})

test('resolveEventPeriod PROMOTES the seg-NNN penalty row it used to drop', () => {
  const firstLabeled = firstLabeledPeriod(MATCH_2661_FRAME)
  assert.equal(firstLabeled, 3, "the frame's first labelled row is the 3RD-period goal")

  const resolved = resolveEventPeriod(PENALTY_ROW.period_number, SEG_PATH, firstLabeled)
  assert.equal(resolved.period, 2, 'the penalty precedes the 3RD header, so it is 2nd period')
  assert.equal(resolved.basis, 'preceding-header')
  assert.ok(resolved.period >= 1, 'and a period >= 1 is what makes the promoter keep the row')
})

// ── firstLabeledPeriod ────────────────────────────────────────────────────────

test('firstLabeledPeriod: takes the first labelled row in LIST order, not the lowest', () => {
  // Ordering matters — the header that bounds the unlabelled rows is the first
  // one encountered, even when a later row carries a smaller period number
  // (which happens when OCR misreads a header).
  assert.equal(firstLabeledPeriod([{ period_number: 0 }, { period_number: 3 }]), 3)
  assert.equal(
    firstLabeledPeriod([{ period_number: 0 }, { period_number: 3 }, { period_number: 1 }]),
    3,
  )
})

test('firstLabeledPeriod: null when no row in the frame carries a period', () => {
  assert.equal(firstLabeledPeriod([{ period_number: 0 }, { period_number: -1 }]), null)
  assert.equal(firstLabeledPeriod([]), null)
})

// ── Precedence ────────────────────────────────────────────────────────────────

test('resolveEventPeriod: a labelled row uses its own period, untouched', () => {
  const r = resolveEventPeriod(3, SEG_PATH, 3)
  assert.equal(r.period, 3)
  assert.equal(r.basis, 'payload')
})

test('resolveEventPeriod: payload-derived header beats the path', () => {
  // Instruction from the fix brief: prefer the payload over the folder name,
  // because a segment folder may not identify a period at all.
  const r = resolveEventPeriod(0, LEGACY_PATH, 3)
  assert.equal(r.period, 2)
  assert.equal(r.basis, 'preceding-header')
})

test('resolveEventPeriod: falls back to the path when the frame has no header', () => {
  const r = resolveEventPeriod(0, LEGACY_PATH, null)
  assert.equal(r.period, 2)
  assert.equal(r.basis, 'path')
})

// ── Never silently default ────────────────────────────────────────────────────

test('resolveEventPeriod: unresolvable frame reports unresolved, does NOT default to 1', () => {
  const r = resolveEventPeriod(0, SEG_PATH, null)
  assert.equal(r.basis, 'unresolved')
  assert.ok(r.period < 1, 'must stay below 1 so the promoter still skips + counts it')
  assert.notEqual(r.period, 1)
})

test('resolveEventPeriod: a 1ST-period header cannot bound anything earlier', () => {
  // Nothing precedes the 1st period, so an unlabelled row above a "1ST PERIOD"
  // header is a contradiction (misread header, or a row from a prior screen).
  // Report it rather than inventing period 0 or 1.
  const r = resolveEventPeriod(0, SEG_PATH, 1)
  assert.equal(r.basis, 'unresolved')
  assert.ok(r.period < 1)
})

test('resolveEventPeriod: preserves a negative parse marker for the stats bucket', () => {
  const r = resolveEventPeriod(-1, SEG_PATH, null)
  assert.equal(r.basis, 'unresolved')
  assert.ok(r.period < 1)
})

// ── Canonical labels for recovered rows ───────────────────────────────────────

test('canonicalPeriodLabel: maps recovered period numbers to screen labels', () => {
  assert.equal(canonicalPeriodLabel(1), '1ST')
  assert.equal(canonicalPeriodLabel(2), '2ND')
  assert.equal(canonicalPeriodLabel(3), '3RD')
  assert.equal(canonicalPeriodLabel(4), 'OT')
  assert.equal(canonicalPeriodLabel(5), 'OT2')
  assert.equal(canonicalPeriodLabel(6), 'OT3')
})

test('canonicalPeriodLabel: null outside the known range', () => {
  assert.equal(canonicalPeriodLabel(0), null)
  assert.equal(canonicalPeriodLabel(7), null)
  assert.equal(canonicalPeriodLabel(-1), null)
})

// ── resolvePeriod stays byte-identical for the action-tracker ─────────────────

test('resolvePeriod: unchanged contract for the action-tracker promoter', () => {
  assert.equal(resolvePeriod(2, SEG_PATH), 2)
  assert.equal(resolvePeriod(0, LEGACY_PATH), 2)
  assert.equal(resolvePeriod(-1, SEG_PATH), -1)
})
