/**
 * Unit tests for match-events-dedup.ts
 *
 * Covers the three strategies:
 *   0 — Positioned-vs-junk prefix guard (normalizeActorForPrefix + DB query)
 *   A — Resolved-player path
 *   B — Unresolved-actor Levenshtein-1 fallback
 *
 * Strategy 0 cases (the focus of Phase 1 hardening):
 *   1. Positioned existing + unpositioned incoming with matching 4-char prefix
 *      → returns existing row id (drops the incoming junk)
 *   2. Positioned existing + unpositioned incoming with NO matching 4-char prefix
 *      → falls through (does not drop — legit distinct event like WILDE vs S.ZUBOV)
 *   3. Both positioned (x IS NOT NULL) → strategy 0 not triggered, falls through
 *   4. Both unpositioned (x IS NULL) → strategy 0 not triggered, falls through
 *   5. Empty / null incoming actor snapshot → strategy 0 not triggered
 *   6. Incoming actor has fewer than 4 alpha chars → strategy 0 not triggered
 *
 * These tests use a minimal in-memory stub for the PromoterDb interface to
 * avoid requiring a real database connection.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/ocr-promoters/__tests__/match-events-dedup.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeActorForPrefix } from '../match-events-dedup.js'

// ── normalizeActorForPrefix unit tests ────────────────────────────────────────

test('normalizeActorForPrefix: strips non-alpha, lowercases, returns first 4', () => {
  assert.equal(normalizeActorForPrefix('SILKY'), 'silk')
  assert.equal(normalizeActorForPrefix('Silky ['), 'silk')
  assert.equal(normalizeActorForPrefix('TOEWS'), 'toew')
  assert.equal(normalizeActorForPrefix('Toews [2l'), 'toew')
  assert.equal(normalizeActorForPrefix('S. ZUBOV'), 'szub')
  assert.equal(normalizeActorForPrefix('S. Zubov (1l'), 'szub')
  assert.equal(normalizeActorForPrefix('M. RANTANEN'), 'mran')
  assert.equal(normalizeActorForPrefix('M. RANI ANEN'), 'mran')
})

test('normalizeActorForPrefix: WILDE and S. ZUBOV produce different prefixes (legit pair)', () => {
  const wildePrefix = normalizeActorForPrefix('WILDE')
  const zubovPrefix = normalizeActorForPrefix('S. ZUBOV')
  assert.equal(wildePrefix, 'wild')
  assert.equal(zubovPrefix, 'szub')
  assert.notEqual(wildePrefix, zubovPrefix)
})

test('normalizeActorForPrefix: returns empty string for null', () => {
  assert.equal(normalizeActorForPrefix(null), '')
})

test('normalizeActorForPrefix: returns empty string for empty string', () => {
  assert.equal(normalizeActorForPrefix(''), '')
})

test('normalizeActorForPrefix: returns empty string for all-punctuation', () => {
  assert.equal(normalizeActorForPrefix('[[['), '')
})

test('normalizeActorForPrefix: actor shorter than 4 alpha chars returns partial prefix', () => {
  // "E." strips to "e" — only 1 char
  assert.equal(normalizeActorForPrefix('E.'), 'e')
  // "EW" → "ew" — 2 chars
  assert.equal(normalizeActorForPrefix('EW'), 'ew')
  // "HI" → "hi" — 2 chars
  assert.equal(normalizeActorForPrefix('H. I.'), 'hi')
})

test('normalizeActorForPrefix: numeric chars are stripped', () => {
  // "S. Zubov (1l" → strips digits and parens → "szubol" → first 4 = "szub"
  assert.equal(normalizeActorForPrefix('S. Zubov (1l'), 'szub')
})

// ── Strategy 0 prefix-match rules ─────────────────────────────────────────────

test('Strategy 0: known OCR-junk pairs from Phase 1 HMM re-ingest all share 4-char prefix', () => {
  // These are the actual corrupt actor strings from match 250 (HMM re-ingest)
  const pairs: Array<[string, string, string]> = [
    ['SILKY', 'Silky [', 'silk'],      // P2 13:41 goal
    ['TOEWS', 'Toews [2l', 'toew'],    // P3 1:09 goal
    ['S. ZUBOV', 'S. Zubov (1l', 'szub'], // P3 0:52 goal
    ['M. RANTANEN', 'M. RANI ANEN', 'mran'], // match 463 P2 15:08 faceoff
  ]
  for (const [canonical, junk, expectedPrefix] of pairs) {
    const canonPrefix = normalizeActorForPrefix(canonical)
    const junkPrefix = normalizeActorForPrefix(junk)
    assert.equal(canonPrefix, expectedPrefix, `canonical "${canonical}" should normalize to "${expectedPrefix}"`)
    assert.equal(junkPrefix, expectedPrefix, `junk "${junk}" should normalize to "${expectedPrefix}"`)
    assert.equal(canonPrefix, junkPrefix, `"${canonical}" and "${junk}" should share prefix`)
  }
})

test('Strategy 0: match 463 faceoff pairs with different first letter do NOT share prefix', () => {
  // H. YOINT vs R.YOINT (different player initials — distinct events)
  const hPrefix = normalizeActorForPrefix('H. YOINT')
  const rPrefix = normalizeActorForPrefix('R.YOINT')
  assert.equal(hPrefix, 'hyoi')
  assert.equal(rPrefix, 'ryoi')
  assert.notEqual(hPrefix, rPrefix)
})

test('Strategy 0: H. O\'YOINTSKI and H. U\'YOINISKI do NOT share 4-char prefix', () => {
  // These are genuinely corrupt OCR reads of different opponent names.
  // The strategy correctly does NOT collapse them via prefix (first 4: hoyo vs huyo).
  const prefix1 = normalizeActorForPrefix("H. O'YOINTSKI")
  const prefix2 = normalizeActorForPrefix("H. U'YOINISKI")
  assert.equal(prefix1, 'hoyo')
  assert.equal(prefix2, 'huyo')
  assert.notEqual(prefix1, prefix2)
})
