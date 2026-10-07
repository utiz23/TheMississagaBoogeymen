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
    new Map([[3, values({ pgoals: 130 })]]),
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
      [1, values({ pgoals: 130 })],
      [2, values({ pgoals: 130 })],
    ]),
    new Map([[1, { tier: 1, level: 1, pool: 'skater', mythicTheme: null }]]),
    new Map([[1, { pgoals: 4 }]]),
  )
  const byId = new Map(plan.map((p) => [p.playerId, p]))
  assert.equal(byId.get(1)?.writeStanding, true)
  assert.equal(byId.get(1)?.firstRun, false)
  assert.deepEqual(byId.get(1)?.events, [
    { kind: 'level_up', familyId: null, fromValue: 1, toValue: 2 },
    { kind: 'badge_level_up', familyId: 'pgoals', fromValue: 4, toValue: 5 },
  ])
  assert.equal(byId.get(2)?.writeStanding, true)
  assert.equal(byId.get(2)?.firstRun, true)
  assert.deepEqual(byId.get(2)?.events, [])
})
