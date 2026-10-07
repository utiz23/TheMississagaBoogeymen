import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BADGE_FAMILIES,
  BADGE_FAMILY_IDS,
  BADGE_GROUPS,
  BADGE_LADDERS,
  BADGE_MAX_LEVEL,
  poolOf,
} from './badge-catalog.js'

void test('21 families with unique ids, in BADGE_FAMILY_IDS order', () => {
  assert.equal(BADGE_FAMILIES.length, 21)
  assert.deepEqual(
    BADGE_FAMILIES.map((f) => f.id),
    [...BADGE_FAMILY_IDS],
  )
})

void test('every ladder has 30 strictly increasing positive thresholds', () => {
  for (const id of BADGE_FAMILY_IDS) {
    const ladder = BADGE_LADDERS[id]
    assert.equal(ladder.length, BADGE_MAX_LEVEL, id)
    assert.ok((ladder[0] ?? 0) > 0, id)
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(
        (ladder[i] ?? 0) > (ladder[i - 1] ?? 0),
        `${id} not increasing at level ${String(i + 1)}`,
      )
    }
  }
})

void test('every family sits in a listed group; the goalie group is the goalie pool', () => {
  const groupIds = new Set(BADGE_GROUPS.map((g) => g.id))
  for (const f of BADGE_FAMILIES) assert.ok(groupIds.has(f.group), f.id)
  assert.equal(BADGE_FAMILIES.filter((f) => poolOf(f) === 'skater').length, 15)
  assert.deepEqual(
    BADGE_FAMILIES.filter((f) => poolOf(f) === 'goalie').map((f) => f.id),
    ['gg', 'gw', 'gsv', 'gdsv', 'gpoke', 'gso'],
  )
})

void test('ladders match the approved spec table (spot checks)', () => {
  assert.deepEqual(BADGE_LADDERS.pgoals.slice(0, 5), [1, 4, 16, 65, 130])
  assert.equal(BADGE_LADDERS.pgoals[29], 5200)
  assert.deepEqual(BADGE_LADDERS.phits.slice(0, 5), [5, 23, 110, 500, 750])
  assert.equal(BADGE_LADDERS.phits[29], 20000)
  assert.deepEqual(BADGE_LADDERS.gsv.slice(0, 5), [15, 39, 100, 260, 350])
  assert.equal(BADGE_LADDERS.gso[29], 63)
  assert.equal(BADGE_LADDERS.p6g[29], 200)
  assert.deepEqual(BADGE_LADDERS.pdekes.slice(0, 5), [5, 11, 23, 50, 75])
  assert.equal(BADGE_LADDERS.pdekes[29], 2000)
})
