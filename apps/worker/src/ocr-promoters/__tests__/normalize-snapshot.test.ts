/**
 * Unit tests for normalizeSnapshot() in resolve-identity.ts.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/ocr-promoters/__tests__/normalize-snapshot.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSnapshot } from '../resolve-identity.js'

void test('strips leading -. ornament', () => {
  assert.equal(normalizeSnapshot('-. Toews'), 'Toews')
  assert.equal(normalizeSnapshot('. Wilde'), 'Wilde')
})

void test('strips trailing punctuation', () => {
  assert.equal(normalizeSnapshot('Silky.'), 'Silky')
  assert.equal(normalizeSnapshot('Wilde,'), 'Wilde')
})

void test('strips trailing OCR-noise bracket', () => {
  assert.equal(
    normalizeSnapshot('Silky ['),
    'Silky',
    'trailing " [" from OCR noise should be stripped',
  )
  assert.equal(normalizeSnapshot('Toews]'), 'Toews]', 'orphan trailing ] left alone (no opener)')
})

void test('strips trailing OCR-noise parenthesized group', () => {
  assert.equal(
    normalizeSnapshot('S. Zubov (1l'),
    'S. Zubov',
    'trailing " (junk" should be stripped from first ( onward',
  )
  assert.equal(
    normalizeSnapshot('PlayerX(1)'),
    'PlayerX',
    'trailing "(1)" parenthesized group should be stripped',
  )
})

void test('leaves real gamertags intact', () => {
  assert.equal(normalizeSnapshot('silkyjoker85'), 'silkyjoker85')
  assert.equal(normalizeSnapshot('Stick Menace'), 'Stick Menace')
  assert.equal(normalizeSnapshot('MrHomiecide'), 'MrHomiecide')
  // Dashes inside a real name must NOT be stripped.
  assert.equal(normalizeSnapshot('DaveL-234'), 'DaveL-234')
})

void test('compounds: leading ornament + trailing junk', () => {
  assert.equal(
    normalizeSnapshot('-. Silky ['),
    'Silky',
    'leading ornament and trailing bracket both stripped',
  )
})

void test('empty + whitespace edge cases', () => {
  assert.equal(normalizeSnapshot(''), '')
  assert.equal(normalizeSnapshot('   '), '')
  assert.equal(normalizeSnapshot('  Silky  '), 'Silky')
})
