/**
 * Unit tests for the shared X-Factor tier validator used on every write path
 * (worker promoters) and the lineup read/provenance path.
 *
 * Run (after build): node --test dist/schema/x-factor-tier.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { isXFactorTier, coerceXFactorTier, X_FACTOR_TIERS } from './player-loadout.js'

void test('X_FACTOR_TIERS is the closed 3-value vocabulary', () => {
  assert.deepEqual([...X_FACTOR_TIERS], ['Elite', 'All Star', 'Specialist'])
})

void test('isXFactorTier accepts only genuine tiers', () => {
  for (const t of X_FACTOR_TIERS) assert.equal(isXFactorTier(t), true)
})

void test('isXFactorTier rejects the bogus "null" string (provenance regression)', () => {
  // This is the exact value that inflated match 250's "Tiered · 10%": three
  // rows where String(null) was written as the literal text "null".
  assert.equal(isXFactorTier('null'), false)
  assert.equal(isXFactorTier(null), false)
  assert.equal(isXFactorTier(undefined), false)
  assert.equal(isXFactorTier(''), false)
  assert.equal(isXFactorTier('Gold'), false)
})

void test('coerceXFactorTier passes valid tiers through and nulls everything else', () => {
  assert.equal(coerceXFactorTier('All Star'), 'All Star')
  assert.equal(coerceXFactorTier('null'), null)
  assert.equal(coerceXFactorTier(null), null)
  assert.equal(coerceXFactorTier(undefined), null)
  assert.equal(coerceXFactorTier(42), null)
})
