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

void test('ladders match the season-cards spec (spot checks)', () => {
  // Level 30 = about the 2nd-best one-season value (2026-10-08 season-cards spec).
  const tops = Object.fromEntries(BADGE_FAMILY_IDS.map((id) => [id, BADGE_LADDERS[id][29]]))
  assert.deepEqual(tops, {
    p3v3: 100,
    p6v6: 480,
    p6g: 100,
    pwins: 320,
    pgoals: 550,
    pasts: 680,
    pshots: 2600,
    pdekes: 800,
    pht: 65,
    pbrk: 110,
    phits: 2000,
    pfo: 3500,
    ptka: 1650,
    pblk: 420,
    pfight: 40,
    gg: 60,
    gw: 30,
    gsv: 650,
    gdsv: 40,
    gpoke: 30,
    gso: 30,
  })
  assert.deepEqual(BADGE_LADDERS.pgoals.slice(0, 5), [1, 2, 6, 10, 15])
  assert.deepEqual(BADGE_LADDERS.phits.slice(0, 5), [2, 9, 20, 36, 56])
  assert.deepEqual(BADGE_LADDERS.gso.slice(0, 5), [1, 2, 3, 4, 5])
})
