import test from 'node:test'
import assert from 'node:assert/strict'
import type { PlayerGameInput } from '../../../lib/news/players.ts'
import {
  currentTitle,
  hotAndCold,
  milestoneText,
  milestonesInReach,
  type FormPlayer,
} from './form.ts'

const NOW = new Date('2026-11-14T12:00:00Z')

function game(i: number, over: Partial<PlayerGameInput> = {}): PlayerGameInput {
  return {
    matchId: i,
    gameTitleId: 3,
    night: '2026-11-01',
    playedAt: new Date(NOW.getTime() - (100 - i) * 3_600_000).toISOString(),
    gameMode: '6s',
    result: 'WIN',
    goals: 0,
    assists: 0,
    shots: 0,
    hits: 0,
    position: 'F',
    endedEarly: false,
    ...over,
  }
}
/** `n` games, `point` says whether game i has a point (a goal); `goalsOf` overrides goals. */
const run = (n: number, point: (i: number) => boolean): PlayerGameInput[] =>
  Array.from({ length: n }, (_, i) => game(i, { goals: point(i) ? 1 : 0 }))

const P = (id: number, name: string, games: PlayerGameInput[]): FormPlayer => ({
  playerId: id,
  name,
  games,
})

void test('current title is the title of the newest game', () => {
  assert.equal(
    currentTitle([
      P(1, 'A', [game(1, { gameTitleId: 2 })]),
      P(2, 'B', [game(50, { gameTitleId: 3 })]),
    ]),
    3,
  )
  assert.equal(currentTitle([]), null)
})

void test('a points streak that is unlikely at his own rate is hot', () => {
  // 20 games, a point in about a third, then 6 in a row: a long, unlikely run.
  const games = run(26, (i) => i % 3 === 0 || i >= 20)
  const { hot, cold } = hotAndCold([P(1, 'Stick', games)], 3, NOW)
  assert.equal(cold.length, 0)
  assert.equal(hot[0]?.text, 'points in 6 straight')
})

void test('a forward 8+ games without a goal is cold; a goalie is never listed', () => {
  const dry = run(20, (i) => i < 10)
  const { cold } = hotAndCold([P(1, 'Erb', dry)], 3, NOW)
  assert.equal(cold[0]?.text, '10 games without a goal')
  const goalie = run(20, () => false).map((g) => ({ ...g, position: 'G' as const }))
  const none = hotAndCold([P(2, 'Gus', goalie)], 3, NOW)
  assert.deepEqual(none, { hot: [], cold: [] })
})

void test('form: last 5 games against the title average (the news desk ratio)', () => {
  // 20 games of 1 point, then 4 games of 3 points and a game with none: no streak at the end,
  // but 2.4 a game against 1 before is heating up (1.5x and +0.6).
  const games = [
    ...Array.from({ length: 20 }, (_, i) => game(i, { goals: i % 2, assists: (i + 1) % 2 })),
    ...Array.from({ length: 4 }, (_, i) => game(20 + i, { goals: 2, assists: 1 })),
    game(24),
  ]
  const { hot } = hotAndCold([P(1, 'Silky', games)], 3, NOW)
  assert.match(hot[0]?.text ?? '', /2.4 points a game in the last 5 \(1 before\)/)
})

void test('players who have not played for 14 days are left out', () => {
  const old = run(26, (i) => i >= 20).map((g) => ({
    ...g,
    playedAt: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
  }))
  assert.deepEqual(hotAndCold([P(1, 'Gone', old)], 3, NOW), { hot: [], cold: [] })
})

void test('milestones in reach: 1-3 away, nearest first, goalies only get games', () => {
  const silky = [...run(20, () => false), game(20, { goals: 48 })]
  const stick = Array.from({ length: 98 }, (_, i) => game(i))
  const gus = Array.from({ length: 99 }, (_, i) => game(i, { position: 'G' as const, goals: 0 }))
  const far = [game(1, { goals: 10 })]
  const out = milestonesInReach(
    [P(1, 'Silky', silky), P(2, 'Stick', stick), P(3, 'Gus', gus), P(4, 'Far', far)],
    3,
  )
  const text = out.map((m) => `${m.name}: ${milestoneText(m)}`)
  assert.deepEqual(text, [
    'Gus: 1 game from 100',
    'Stick: 2 games from 100',
    'Silky: 2 goals from 50',
  ])
})
