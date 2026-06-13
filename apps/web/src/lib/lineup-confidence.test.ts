/**
 * Unit tests for computeLineupConfidence — field-completeness buckets over the
 * rendered lineup rows. Pure function, no DB/React.
 *
 * Run: node --test apps/web/src/lib/lineup-confidence.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { LineupRow, MatchLineups } from '@eanhl/db/queries'
import { computeLineupConfidence } from './lineup-confidence.ts'

// Minimal row builder — only the fields the buckets read. Cast through unknown
// because the buckets never touch the other LineupRow fields.
function row(overrides: Partial<LineupRow>): LineupRow {
  return {
    snapshotId: 1,
    gamertagSnapshot: 'PlayerOne',
    playerNameSnapshot: null,
    playerNamePersona: 'P. One',
    playerNumber: 11,
    isCaptain: false,
    position: 'C',
    buildClass: 'Sniper',
    buildClassCanonical: null,
    heightText: "6'0\"",
    weightLbs: 190,
    handedness: 'L',
    playerLevelNumber: null,
    playerLevelRaw: null,
    playerPrestigeNumber: null,
    platform: 'ps5',
    capturedAt: new Date('2026-05-12T00:00:00Z'),
    player: null,
    xFactors: [],
    attributes: { speed: { value: 88, delta: null } },
    ...overrides,
  } as LineupRow
}

function lineups(bgm: LineupRow[], opponent: LineupRow[] = []): MatchLineups {
  return { bgm, opponent } as MatchLineups
}

void test('empty lineups → all buckets null, overall 0', () => {
  const c = computeLineupConfidence(lineups([], []))
  assert.equal(c.identity, null)
  assert.equal(c.build, null)
  assert.equal(c.xfactor, null)
  assert.equal(c.tier, null)
  assert.equal(c.attribute, null)
  assert.equal(c.overall, 0)
})

void test('fully populated row → identity/build/attribute = 1', () => {
  const c = computeLineupConfidence(lineups([row({})]))
  assert.equal(c.identity, 1)
  assert.equal(c.build, 1)
  assert.equal(c.attribute, 1)
  // no x-factors detected → xfactor/tier are empty-denominator
  assert.equal(c.xfactor, null)
  assert.equal(c.tier, null)
})

void test('missing platform drops identity to 3/4', () => {
  const c = computeLineupConfidence(lineups([row({ platform: null })]))
  assert.equal(c.identity, 0.75)
})

void test('missing height + weight drops build to 1/3', () => {
  const c = computeLineupConfidence(lineups([row({ heightText: null, weightLbs: null })]))
  assert.ok(Math.abs((c.build ?? 0) - 1 / 3) < 1e-9)
})

void test('gamertag present via resolved player counts even when snapshot is null', () => {
  const c = computeLineupConfidence(
    lineups([row({ gamertagSnapshot: null, player: { id: 7, gamertag: 'Resolved' } })]),
  )
  assert.equal(c.identity, 1)
})

void test('x-factor canonical + tier rates over detected entries', () => {
  const c = computeLineupConfidence(
    lineups([
      row({
        xFactors: [
          { slotIndex: 0, name: 'a', canonicalName: 'Tape_to_Tape', tier: 'Elite' },
          { slotIndex: 1, name: 'b', canonicalName: 'PressurePlus', tier: null },
          { slotIndex: 2, name: 'c', canonicalName: null, tier: null },
        ],
      }),
    ]),
  )
  assert.ok(Math.abs((c.xfactor ?? 0) - 2 / 3) < 1e-9) // 2 of 3 canonical
  assert.ok(Math.abs((c.tier ?? 0) - 1 / 3) < 1e-9) // 1 of 3 tiered
})

void test('attribute bucket = share of rows carrying attributes', () => {
  const c = computeLineupConfidence(lineups([row({}), row({ attributes: null })]))
  assert.equal(c.attribute, 0.5)
})

void test('buckets average both sides (bgm + opponent)', () => {
  const c = computeLineupConfidence(
    lineups([row({ platform: 'ps5' })], [row({ platform: null })]),
  )
  // identity = (1 + 0.75) / 2
  assert.equal(c.identity, 0.875)
})

void test('overall excludes empty-denominator buckets', () => {
  // No x-factors anywhere → overall = mean(identity, build, attribute) = 1
  const c = computeLineupConfidence(lineups([row({})]))
  assert.equal(c.overall, 1)
})

void test('empty attributes object counts as absent', () => {
  const c = computeLineupConfidence(lineups([row({ attributes: {} })]))
  assert.equal(c.attribute, 0)
})

void test('overall blends all five buckets when x-factors are present', () => {
  // identity=1, build=1, attribute=1, xfactor=2/3, tier=1/3 → mean of five
  const c = computeLineupConfidence(
    lineups([
      row({
        xFactors: [
          { slotIndex: 0, name: 'a', canonicalName: 'X', tier: 'Elite' },
          { slotIndex: 1, name: 'b', canonicalName: 'Y', tier: null },
          { slotIndex: 2, name: 'c', canonicalName: null, tier: null },
        ],
      }),
    ]),
  )
  const expected = (1 + 1 + 2 / 3 + 1 / 3 + 1) / 5
  assert.ok(Math.abs(c.overall - expected) < 1e-9)
})
