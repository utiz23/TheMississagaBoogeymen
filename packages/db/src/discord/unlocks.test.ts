import test from 'node:test'
import assert from 'node:assert/strict'
import { describeUnlock } from './unlocks.js'

const none = { mythicTheme: null }

void test('badge: every level up counts; a jump posts the level reached; equal or down never', () => {
  assert.deepEqual(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pshots', fromValue: 9, toValue: 10 }, none),
    {
      kind: 'badge',
      subject: 'Shots 10',
      graphic: 'badge',
      badge: { familyId: 'pshots', level: 10 },
    },
  )
  assert.equal(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pgoals', fromValue: 3, toValue: 5 }, none)
      ?.subject,
    'Goals 5',
  )
  assert.equal(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pgoals', fromValue: 0, toValue: 1 }, none)
      ?.subject,
    'Goals 1',
  )
  assert.equal(
    describeUnlock({ kind: 'badge_level_up', familyId: 'pgoals', fromValue: 5, toValue: 5 }, none),
    null,
  )
})

void test('card level, tier, mythic; cleared mythic and missing mythic theme never post', () => {
  assert.deepEqual(
    describeUnlock({ kind: 'level_up', familyId: null, fromValue: 4, toValue: 5 }, none),
    {
      kind: 'card_level',
      subject: '5',
      graphic: 'card',
    },
  )
  assert.deepEqual(
    describeUnlock({ kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 }, none),
    {
      kind: 'tier',
      subject: 'STUD',
      graphic: 'card',
      cardTheme: 'alternate',
      cardTier: 3,
    },
  )
  assert.deepEqual(
    describeUnlock(
      { kind: 'mythic_awarded', familyId: null, fromValue: 3, toValue: 6 },
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
  assert.equal(
    describeUnlock({ kind: 'mythic_awarded', familyId: null, fromValue: 3, toValue: 6 }, none),
    null,
  )
  assert.equal(
    describeUnlock(
      { kind: 'mythic_cleared', familyId: null, fromValue: 6, toValue: 3 },
      { mythicTheme: 'inferno' },
    ),
    null,
  )
})
