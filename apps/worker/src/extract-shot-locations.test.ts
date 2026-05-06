import test from 'node:test'
import assert from 'node:assert/strict'
import type { EaMemberStats } from '@eanhl/ea-client'
import { extractShotLocations } from './extract-shot-locations.js'

// Minimal helper: produce a member stub. Caller provides the location fields.
function member(overrides: Partial<EaMemberStats> = {}): EaMemberStats {
  return { name: 'tester', ...overrides }
}

void test('returns null when no location fields are present', () => {
  const result = extractShotLocations(member())
  assert.equal(result, null)
})

void test('returns null for a goalie regardless of fields', () => {
  const result = extractShotLocations(
    member({
      favoritePosition: 'goalie',
      skShotsLocationOnIce1: '1',
      skShotsLocationOnNet1: '1',
    }),
  )
  assert.equal(result, null)
})

void test('parses all 42 fields into four integer arrays in index order', () => {
  // Build a complete fixture: ice indices 1..16 → values 0..15, net 1..5 → 100..104,
  // goals ice 1..16 → 20..35, goals net 1..5 → 200..204.
  const fixture = member({ favoritePosition: 'center' })
  for (let i = 1; i <= 16; i++) {
    fixture[`skShotsLocationOnIce${i}`] = String(i - 1)
    fixture[`skGoalsLocationOnIce${i}`] = String(i + 19)
  }
  for (let i = 1; i <= 5; i++) {
    fixture[`skShotsLocationOnNet${i}`] = String(99 + i)
    fixture[`skGoalsLocationOnNet${i}`] = String(199 + i)
  }
  // Force the sum invariants to hold by adjusting net arrays to match ice sums.
  // sum(0..15) = 120; sum(20..35) = 440. Override nets accordingly.
  fixture.skShotsLocationOnNet1 = '120'
  fixture.skShotsLocationOnNet2 = '0'
  fixture.skShotsLocationOnNet3 = '0'
  fixture.skShotsLocationOnNet4 = '0'
  fixture.skShotsLocationOnNet5 = '0'
  fixture.skGoalsLocationOnNet1 = '440'
  fixture.skGoalsLocationOnNet2 = '0'
  fixture.skGoalsLocationOnNet3 = '0'
  fixture.skGoalsLocationOnNet4 = '0'
  fixture.skGoalsLocationOnNet5 = '0'

  const result = extractShotLocations(fixture)
  assert.notEqual(result, null)
  assert.equal(result!.shotsIce.length, 16)
  assert.equal(result!.goalsIce.length, 16)
  assert.equal(result!.shotsNet.length, 5)
  assert.equal(result!.goalsNet.length, 5)
  assert.deepEqual(result!.shotsIce, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  assert.deepEqual(result!.shotsNet, [120, 0, 0, 0, 0])
  assert.equal(result!.goalsIce[0], 20)
  assert.equal(result!.goalsIce[15], 35)
})

void test('treats missing individual fields as 0', () => {
  // Only one field present; the rest default to 0.
  const result = extractShotLocations(
    member({
      favoritePosition: 'center',
      skShotsLocationOnIce7: '37',
      skShotsLocationOnNet1: '37',
    }),
  )
  assert.notEqual(result, null)
  assert.equal(result!.shotsIce[6], 37)
  assert.equal(result!.shotsIce[0], 0)
  assert.equal(result!.shotsNet[0], 37)
})

void test('returns null and does NOT throw when sum invariant fails', () => {
  // shots ice sum = 10, shots net sum = 5 → mismatch.
  const result = extractShotLocations(
    member({
      favoritePosition: 'center',
      skShotsLocationOnIce1: '10',
      skShotsLocationOnNet1: '5',
    }),
  )
  assert.equal(result, null)
})
