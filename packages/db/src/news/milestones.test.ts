import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GAMES_MILESTONES,
  MAX_SHEET_MILESTONES,
  compareMilestones,
  milestoneCrossed,
  rankMilestones,
} from './index.js'

void test('milestoneCrossed: points every 100, goals and assists every 50 (spec 12.12-10)', () => {
  assert.equal(milestoneCrossed('points', 99, 101), 100)
  assert.equal(milestoneCrossed('points', 49, 51), null) // 50 points is no milestone now
  assert.equal(milestoneCrossed('points', 100, 101), null)
  assert.equal(milestoneCrossed('points', 190, 310), 300) // highest crossed
  assert.equal(milestoneCrossed('goals', 49, 50), 50)
  assert.equal(milestoneCrossed('goals', 24, 26), null) // 25 is no milestone now
  assert.equal(milestoneCrossed('goals', 99, 100), 100)
  assert.equal(milestoneCrossed('assists', 140, 151), 150)
  assert.equal(milestoneCrossed('assists', 0, 0), null)
  assert.equal(milestoneCrossed('assists', 0, 49), null)
})

void test('milestoneCrossed: games only at 100, 250, 500, 750 and 1000', () => {
  assert.deepEqual([...GAMES_MILESTONES], [100, 250, 500, 750, 1000])
  assert.equal(milestoneCrossed('games', 99, 100), 100)
  assert.equal(milestoneCrossed('games', 149, 150), null)
  assert.equal(milestoneCrossed('games', 200, 201), null)
  assert.equal(milestoneCrossed('games', 249, 250), 250)
  assert.equal(milestoneCrossed('games', 499, 501), 500)
  assert.equal(milestoneCrossed('games', 749, 750), 750)
  assert.equal(milestoneCrossed('games', 999, 1000), 1000)
  assert.equal(milestoneCrossed('games', 1000, 1100), null)
  assert.equal(milestoneCrossed('games', 0, 260), 250)
})

void test('compareMilestones: 100s, then 50s; points, goals, assists, games; then larger (spec 12.7)', () => {
  const m = (stat: 'goals' | 'assists' | 'points' | 'games', value: number, playerId = 1) => ({
    playerId,
    name: `P${String(playerId)}`,
    stat,
    value,
  })
  const sorted = [
    m('games', 250),
    m('goals', 50),
    m('assists', 150),
    m('games', 100),
    m('points', 200),
    m('goals', 100),
    m('points', 100),
  ].sort(compareMilestones)
  assert.deepEqual(
    sorted.map((x) => `${x.stat} ${String(x.value)}`),
    ['points 200', 'points 100', 'goals 100', 'games 100', 'goals 50', 'assists 150', 'games 250'],
  )
})

void test('rankMilestones: at most 3 per sheet, best first; ties keep the input order', () => {
  assert.equal(MAX_SHEET_MILESTONES, 3)
  const list = [
    { playerId: 1, name: 'A', stat: 'goals' as const, value: 50 },
    { playerId: 2, name: 'B', stat: 'points' as const, value: 100 },
    { playerId: 3, name: 'C', stat: 'games' as const, value: 250 },
    { playerId: 4, name: 'D', stat: 'points' as const, value: 100 },
    { playerId: 5, name: 'E', stat: 'assists' as const, value: 50 },
  ]
  assert.deepEqual(
    rankMilestones(list).map((x) => x.name),
    ['B', 'D', 'A'],
  )
  assert.deepEqual(rankMilestones([]), [])
  // The input is not changed.
  assert.equal(list[0]!.name, 'A')
})
