import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeNumeral, showcaseChanges, showcaseText, type ShowcaseEvent } from './card-updates.js'

const ev = (over: Partial<ShowcaseEvent>): ShowcaseEvent => ({
  id: 1,
  playerId: 2,
  kind: 'badge_level_up',
  familyId: 'p6g',
  fromValue: 0,
  toValue: 1,
  ...over,
})

void test('badgeNumeral: every 5 internal steps, capped at VI', () => {
  assert.deepEqual([0, 1, 5, 6, 10, 11, 30, 40].map(badgeNumeral), [
    '',
    'I',
    'I',
    'II',
    'II',
    'III',
    'VI',
    'VI',
  ])
})

void test('badge texts: new badge uses the numeral reached; upgrades only when the numeral changes', () => {
  const name = (t: string | null) => t
  assert.match(name(showcaseText(ev({ fromValue: 0, toValue: 1 })))!, /^New badge: .+ I$/)
  assert.match(name(showcaseText(ev({ fromValue: 0, toValue: 6 })))!, /^New badge: .+ II$/)
  assert.match(name(showcaseText(ev({ fromValue: 5, toValue: 6 })))!, /^.+ I → II$/)
  assert.equal(showcaseText(ev({ fromValue: 13, toValue: 14 })), null)
  assert.equal(showcaseText(ev({ fromValue: 6, toValue: 10 })), null)
})

void test('level, tier, mythic texts; mythic cleared never shows', () => {
  assert.equal(
    showcaseText(ev({ kind: 'level_up', familyId: null, fromValue: 4, toValue: 5 })),
    'Card level 4 → 5',
  )
  assert.equal(
    showcaseText(ev({ kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 })),
    '⬆ Tier: Rookie → Stud',
  )
  assert.equal(
    showcaseText(ev({ kind: 'mythic_awarded', familyId: null, fromValue: 3, toValue: 6 })),
    'Mythic card awarded',
  )
  assert.equal(
    showcaseText(ev({ kind: 'mythic_cleared', familyId: null, fromValue: 6, toValue: 3 })),
    null,
  )
})

void test('showcaseChanges: per player, badges then level/tier/mythic, players in first-event order, ineligible dropped', () => {
  const out = showcaseChanges(
    [
      ev({ id: 10, playerId: 7, kind: 'level_up', familyId: null, fromValue: 4, toValue: 5 }),
      ev({ id: 11, playerId: 7, familyId: 'p6g', fromValue: 10, toValue: 11 }),
      ev({ id: 12, playerId: 9, familyId: 'p6g', fromValue: 13, toValue: 14 }),
      ev({ id: 13, playerId: 3, kind: 'tier_up', familyId: null, fromValue: 2, toValue: 3 }),
      ev({ id: 14, playerId: 99, kind: 'level_up', familyId: null, fromValue: 1, toValue: 2 }),
    ],
    (id) => id !== 99,
  )
  assert.deepEqual(
    out.map((p) => p.playerId),
    [7, 3],
  )
  assert.equal(out[0]?.changes.length, 2)
  assert.match(out[0]?.changes[0] ?? '', / II → III$/)
  assert.equal(out[0]?.changes[1], 'Card level 4 → 5')
  assert.deepEqual(out[1]?.changes, ['⬆ Tier: Rookie → Stud'])
})

void test('showcaseChanges: nothing counted ⇒ empty', () => {
  assert.deepEqual(
    showcaseChanges([ev({ fromValue: 13, toValue: 14 })], () => true),
    [],
  )
})
