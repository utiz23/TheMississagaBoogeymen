import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewsFactsResponse, type NewsPerson } from './contract.js'
import {
  TAKE_REUSE_DAYS,
  adjustTakeIntensity,
  dueTakes,
  takeCritics,
  takesForSheet,
  type TakeRowInput,
} from './takes.js'

// Invented takes only: the real ones are GM secrets and never in git.
const row = (over: Partial<TakeRowInput> = {}): TakeRowInput => ({
  id: 1,
  reporter: 'mercer',
  playerId: 2,
  take: 'Invented: he pads his points against weak clubs.',
  spread: 'a few',
  critics: ['pettibone'],
  defender: 'quill',
  dataAngle: 'points per game against winning clubs',
  active: true,
  intensity: 0,
  ...over,
})

const people: NewsPerson[] = [
  { playerId: 2, name: 'Skater A', pressLevel: 'full' },
  { playerId: 3, name: 'Skater B', pressLevel: 'easy' },
]

void test('adjustTakeIntensity: big for him in 3 of the last 5 softens, quiet hardens, clamped', () => {
  const big = 'big for him' as const
  const quiet = 'quiet for him' as const
  const typical = 'typical' as const
  assert.equal(adjustTakeIntensity(0, [big, big, big, typical, typical]), -1)
  assert.equal(adjustTakeIntensity(0, [big, big, typical, typical, typical]), 0)
  assert.equal(adjustTakeIntensity(1, [quiet, quiet, quiet]), 2)
  assert.equal(adjustTakeIntensity(2, [quiet, quiet, quiet]), 2)
  assert.equal(adjustTakeIntensity(-2, [big, big, big]), -2)
  // Only the last 5 count.
  assert.equal(
    adjustTakeIntensity(0, [big, big, big, typical, typical, typical, typical, typical]),
    0,
  )
})

void test('takesForSheet: named players only, Go easy is mild and never hard, inactive skipped', () => {
  const t = takesForSheet(
    [
      row(),
      row({ id: 2, playerId: 3, intensity: 2 }),
      row({ id: 3, playerId: 99 }), // not on the sheet (a Leave me out player is never in people)
      row({ id: 4, active: false }),
      row({ id: 5, reporter: 'nobody' }),
      row({ id: 6, critics: ['mercer', 'vale', 'nobody'], defender: 'mercer' }),
    ],
    people,
    (id) => (id === 2 ? ['big for him', 'big for him', 'big for him'] : []),
  )
  assert.deepEqual(
    t.map((x) => x.id),
    [1, 2, 6],
  )
  assert.equal(t[0]!.player, 'Skater A')
  assert.equal(t[0]!.intensity, -1)
  assert.equal(t[0]!.mild, false)
  assert.equal(t[1]!.mild, true)
  assert.equal(t[1]!.intensity, 0)
  assert.deepEqual(t[2]!.critics, ['vale'])
  assert.equal(t[2]!.defender, null)
  assert.deepEqual(takeCritics(t[2]!), ['mercer', 'vale'])
})

void test('dueTakes: not voiced in the last 7 days; one take per player', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  const takes = takesForSheet([row(), row({ id: 2 }), row({ id: 3, playerId: 3 })], people)
  const recent = new Date(now.getTime() - 2 * 86_400_000)
  const old = new Date(now.getTime() - (TAKE_REUSE_DAYS + 1) * 86_400_000)
  assert.deepEqual(
    dueTakes(takes, new Map(), now).map((t) => t.id),
    [1, 3],
  )
  assert.deepEqual(
    dueTakes(takes, new Map([[1, recent]]), now).map((t) => t.id),
    [2, 3],
  )
  assert.deepEqual(
    dueTakes(
      takes,
      new Map([
        [1, old],
        [3, recent],
      ]),
      now,
    ).map((t) => t.id),
    [1],
  )
})

void test('response takes (C3a.6): parsed next to the facts; [] when missing; only named players', () => {
  const facts = {
    kind: 'game',
    key: '2026-10-12',
    gameTitleName: 'NHL 27',
    games: [],
    nightTotals: {
      goalsFor: 0,
      goalsAgainst: 0,
      shotsFor: 0,
      shotsAgainst: 0,
      wins: 0,
      losses: 0,
      otl: 0,
    },
    record: { wins: 0, losses: 0, otl: 0 },
    streak: null,
    unlocks: [],
    milestones: [],
    recentNights: [],
    people,
    norms: { '3s': null, '6s': null },
  }
  const take = takesForSheet([row()], people)[0]!
  const r = parseNewsFactsResponse({ facts, forbiddenNames: [], takes: [take] })
  assert.deepEqual(r.takes, [take])
  // Takes never go inside the facts.
  assert.ok(!('takes' in r.facts))
  assert.deepEqual(parseNewsFactsResponse({ facts, forbiddenNames: [] }).takes, [])
  for (const bad of [
    { ...take, player: 'Someone Else' },
    { ...take, playerId: 99 },
    { ...take, intensity: 3 },
    { ...take, spread: 'all' },
    { ...take, critics: ['nobody'] },
    { ...take, mild: 'no' },
  ]) {
    assert.throws(() => parseNewsFactsResponse({ facts, forbiddenNames: [], takes: [bad] }))
  }
})
