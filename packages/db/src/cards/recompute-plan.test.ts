import test from 'node:test'
import assert from 'node:assert/strict'
import { planCardRecompute } from './recompute-plan.js'
import { emptyBadgeValues, type BadgeValues, type CardStanding } from './progression.js'

const values = (partial: Partial<BadgeValues>): BadgeValues => ({
  ...emptyBadgeValues(),
  ...partial,
})
const manual: CardStanding = { tier: 6, level: 10, pool: 'manual', mythicTheme: 'inferno' }

void test('a hand-awarded (manual) standing is never re-written by a recompute', () => {
  // The recompute read the row while it was a mythic; if `card-mythic --clear`
  // commits before the upsert, re-writing the stale T6 row would undo the clear.
  const [p] = planCardRecompute(
    new Map([[3, values({ pgoals: 25 })]]),
    new Map([[3, manual]]),
    new Map([[3, { pgoals: 4 }]]),
  )
  assert.ok(p)
  assert.equal(p.writeStanding, false)
  assert.deepEqual(p.standing, manual)
  assert.equal(p.levels.pgoals, 5)
})

void test('a stats standing is written; the first computation writes but emits no events', () => {
  const plan = planCardRecompute(
    new Map([
      [1, values({ pgoals: 25 })],
      [2, values({ pgoals: 25 })],
    ]),
    new Map([[1, { tier: 1, level: 1, pool: 'skater', mythicTheme: null }]]),
    new Map([[1, { pgoals: 4 }]]),
  )
  const byId = new Map(plan.map((p) => [p.playerId, p]))
  assert.equal(byId.get(1)?.writeStanding, true)
  assert.equal(byId.get(1)?.firstRun, false)
  assert.deepEqual(byId.get(1)?.events, [
    // pgoals 25 = the T2 bar: 1 of the best 4 families is complete → avg 0.25 → level 3.
    { kind: 'level_up', familyId: null, fromValue: 1, toValue: 3 },
    { kind: 'badge_level_up', familyId: 'pgoals', fromValue: 4, toValue: 5 },
  ])
  assert.equal(byId.get(2)?.writeStanding, true)
  assert.equal(byId.get(2)?.firstRun, true)
  assert.deepEqual(byId.get(2)?.events, [])
})

const allLevels = (level: number) =>
  Object.fromEntries(Object.keys(emptyBadgeValues()).map((id) => [id, level]))

void test('rebase lowers a stored tier to the computed standing and emits no events', () => {
  const [p] = planCardRecompute(
    new Map([[1, values({ pgoals: 5 })]]),
    new Map([[1, { tier: 3, level: 2, pool: 'skater', mythicTheme: null }]]),
    new Map([[1, allLevels(13)]]),
    undefined,
    { rebase: true },
  )
  assert.ok(p)
  assert.equal(p.standing.tier, 1)
  assert.equal(p.writeStanding, true)
  assert.deepEqual(p.events, [])
})

void test('rebase keeps a manual standing and does not write it', () => {
  const [p] = planCardRecompute(
    new Map([[3, values({ pgoals: 25 })]]),
    new Map([[3, manual]]),
    new Map([[3, { pgoals: 4 }]]),
    undefined,
    { rebase: true },
  )
  assert.ok(p)
  assert.deepEqual(p.standing, manual)
  assert.equal(p.writeStanding, false)
  assert.deepEqual(p.events, [])
})

void test('rebase with a level increase still emits no events', () => {
  const [p] = planCardRecompute(
    new Map([[1, values({ pgoals: 25 })]]),
    new Map([[1, { tier: 1, level: 1, pool: 'skater', mythicTheme: null }]]),
    new Map([[1, { pgoals: 4 }]]),
    undefined,
    { rebase: true },
  )
  assert.ok(p)
  assert.equal(p.levels.pgoals, 5)
  assert.equal(p.standing.level, 3)
  assert.deepEqual(p.events, [])
})
