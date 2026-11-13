import test from 'node:test'
import assert from 'node:assert/strict'
import { describeUnlock } from './unlocks.js'

const none = { mythicTheme: null }

void test('badge level-ups are never announced (operator, 2026-11-09)', () => {
  for (const [fromValue, toValue] of [
    [9, 10],
    [3, 5],
    [0, 1],
    [5, 5],
  ] as const) {
    assert.equal(describeUnlock({ kind: 'badge_level_up', fromValue, toValue }, none), null)
  }
})

void test('card level, tier, mythic; cleared mythic and missing mythic theme never post', () => {
  assert.deepEqual(describeUnlock({ kind: 'level_up', fromValue: 4, toValue: 5 }, none), {
    kind: 'card_level',
    subject: '5',
    graphic: 'card',
  })
  assert.deepEqual(describeUnlock({ kind: 'tier_up', fromValue: 2, toValue: 3 }, none), {
    kind: 'tier',
    subject: 'STUD',
    graphic: 'card',
    cardTheme: 'alternate',
    cardTier: 3,
  })
  assert.deepEqual(
    describeUnlock(
      { kind: 'mythic_awarded', fromValue: 3, toValue: 6 },
      { mythicTheme: 'inferno' },
    ),
    {
      kind: 'mythic',
      subject: 'INFERNO',
      graphic: 'card',
      cardTheme: 'inferno',
      cardTier: 6,
    },
  )
  assert.equal(describeUnlock({ kind: 'mythic_awarded', fromValue: 3, toValue: 6 }, none), null)
  assert.equal(
    describeUnlock(
      { kind: 'mythic_cleared', fromValue: 6, toValue: 3 },
      { mythicTheme: 'inferno' },
    ),
    null,
  )
})
