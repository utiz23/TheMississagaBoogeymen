/**
 * Unit tests for the X-Factor asset URL builder + tier guard.
 *
 * Run: node --test apps/web/src/lib/xfactor-asset.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { xFactorIconUrl, isXFactorTier } from './xfactor-asset.ts'

void test('isXFactorTier accepts only the three real tiers', () => {
  assert.equal(isXFactorTier('Elite'), true)
  assert.equal(isXFactorTier('All Star'), true)
  assert.equal(isXFactorTier('Specialist'), true)
})

void test('isXFactorTier rejects the bogus "null" string and other junk', () => {
  assert.equal(isXFactorTier('null'), false)
  assert.equal(isXFactorTier(null), false)
  assert.equal(isXFactorTier(undefined), false)
  assert.equal(isXFactorTier(''), false)
  assert.equal(isXFactorTier('elite'), false) // case-sensitive
})

void test('xFactorIconUrl builds the tier-colored path for a valid tier', () => {
  assert.equal(
    xFactorIconUrl('Wheels', 'Elite'),
    '/assets/x-factors/Wheels/NHL_26_Wheels_X-Factor_Image__Red__File.png',
  )
  assert.equal(
    xFactorIconUrl('Tape_to_Tape', 'All Star'),
    '/assets/x-factors/Tape_to_Tape/NHL_26_Tape_to_Tape_X-Factor_Image__Blue__File.png',
  )
})

void test('xFactorIconUrl returns null for a missing tier (no neutral PNG exists)', () => {
  assert.equal(xFactorIconUrl('Wheels', null), null)
  assert.equal(xFactorIconUrl('Wheels', undefined), null)
})

void test('xFactorIconUrl never builds a broken URL from a bogus "null" tier', () => {
  // Pre-fix, a stray "null" string indexed TIER_TO_COLOR as undefined and
  // produced `__undefined__File.png`. It must now resolve to no icon.
  const url = xFactorIconUrl('Wheels', 'null' as unknown as 'Elite')
  assert.equal(url, null)
})

void test('xFactorIconUrl returns null when the canonical name is missing', () => {
  assert.equal(xFactorIconUrl(null, 'Elite'), null)
  assert.equal(xFactorIconUrl(undefined, 'Elite'), null)
})
