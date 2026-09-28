import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DASH,
  fmtHms,
  fmtInt,
  fmtMmss,
  fmtPct1,
  fmtSigned,
  fmtSuppliedPct,
  parseSupplied,
  perGame,
  ratio,
} from './format.ts'

void test('null and non-finite values render as a dash, never NaN/Infinity/0', () => {
  for (const f of [fmtInt, fmtSigned, fmtPct1, fmtMmss, fmtHms]) {
    assert.equal(f(null), DASH)
    assert.equal(f(Number.NaN), DASH)
    assert.equal(f(Number.POSITIVE_INFINITY), DASH)
  }
})

void test('signed integers use a real minus sign and a plus for positives', () => {
  assert.equal(fmtSigned(12), '+12')
  assert.equal(fmtSigned(0), '0')
  assert.equal(fmtSigned(-8), '−8')
})

void test('m:ss allows minutes above 59; h:mm:ss only past an hour', () => {
  assert.equal(fmtMmss(3725), '62:05')
  assert.equal(fmtHms(3725), '1:02:05')
  assert.equal(fmtHms(125), '2:05')
  assert.equal(fmtMmss(59.6), '1:00')
})

void test('supplied percentage strings keep their stored precision', () => {
  assert.equal(fmtSuppliedPct('54.50'), '54.50%')
  assert.equal(fmtSuppliedPct(null), DASH)
  assert.equal(parseSupplied('81.82'), 81.82)
  assert.equal(parseSupplied(null), null)
  assert.equal(parseSupplied(''), null)
})

void test('per-game and ratio are null on missing numerator or non-positive denominator', () => {
  assert.equal(perGame(10, 4), 2.5)
  assert.equal(perGame(10, 0), null)
  assert.equal(perGame(10, null), null)
  assert.equal(perGame(null, 4), null)
  assert.equal(ratio(3, 0), null)
  assert.equal(perGame(0, 4), 0)
})
