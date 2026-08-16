/**
 * Unit tests for the OCR coverage tier derivation behind the games-list pill.
 * Pure functions, no React/DOM.
 *
 * Tested hardest: the tier is a COUNT of independent OCR streams, so every
 * pair collapses to the same tier regardless of which streams are present —
 * a match with loadouts+events is no better covered than periods+events.
 *
 * Run: node --test apps/web/src/lib/ocr-coverage.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { getOcrCoverageStyle, ocrCoverageTier, type OcrCoverageStreams } from './ocr-coverage.ts'

const NONE: OcrCoverageStreams = { loadouts: false, periods: false, events: false }

void test('all three streams present is full coverage', () => {
  assert.equal(ocrCoverageTier({ loadouts: true, periods: true, events: true }), 'full')
})

void test('any two streams is partial coverage, whichever two', () => {
  assert.equal(ocrCoverageTier({ loadouts: true, periods: true, events: false }), 'partial')
  assert.equal(ocrCoverageTier({ loadouts: true, periods: false, events: true }), 'partial')
  assert.equal(ocrCoverageTier({ loadouts: false, periods: true, events: true }), 'partial')
})

void test('exactly one stream is minimal coverage, whichever one', () => {
  assert.equal(ocrCoverageTier({ ...NONE, loadouts: true }), 'minimal')
  assert.equal(ocrCoverageTier({ ...NONE, periods: true }), 'minimal')
  assert.equal(ocrCoverageTier({ ...NONE, events: true }), 'minimal')
})

void test('no streams is the none tier', () => {
  assert.equal(ocrCoverageTier(NONE), 'none')
})

void test('the none tier has no style, so the pill renders nothing', () => {
  assert.equal(getOcrCoverageStyle('none'), null)
})

void test('full/partial/minimal map to green/orange/red dots', () => {
  const full = getOcrCoverageStyle('full')
  const partial = getOcrCoverageStyle('partial')
  const minimal = getOcrCoverageStyle('minimal')
  assert.ok(full && partial && minimal)

  // Distinct hues — the dot is the only colour-bearing element, so a shared
  // value between tiers would make two tiers indistinguishable.
  const dots = [full.dot, partial.dot, minimal.dot]
  assert.equal(new Set(dots).size, 3)
})

void test('every tier states its stream count in the tooltip', () => {
  // The pill label alone ("PARTIAL") does not say what is missing; the title
  // is the only place the operator learns 2-of-3 from.
  assert.match(getOcrCoverageStyle('full')?.title ?? '', /3 of 3/)
  assert.match(getOcrCoverageStyle('partial')?.title ?? '', /2 of 3/)
  assert.match(getOcrCoverageStyle('minimal')?.title ?? '', /1 of 3/)
})
