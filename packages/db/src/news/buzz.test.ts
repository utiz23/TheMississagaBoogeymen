import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUZZ_CUTOFFS,
  BUZZ_MODE_FACTOR,
  BUZZ_WEIGHTS,
  buzzLevel,
  buzzScore,
  expectedPostsPerGame,
  mulberry32,
  planBuzz,
  timelineHooks,
  weightedPick,
} from './buzz.js'
import { emptyPlayerExtras, type NewsGameFacts, type NewsPlayerLine } from './contract.js'

const line = (over: Partial<NewsPlayerLine> = {}): NewsPlayerLine => ({
  playerId: 2,
  name: 'Skater A',
  position: 'F',
  isGoalie: false,
  goals: 0,
  assists: 0,
  points: 0,
  shots: 2,
  hits: 1,
  pim: 0,
  saves: null,
  goalsAgainst: null,
  savePct: null,
  star: null,
  ...emptyPlayerExtras(),
  ...over,
})

const game = (over: Partial<NewsGameFacts> = {}): NewsGameFacts => ({
  matchId: 501,
  night: '2026-10-12',
  playedAt: '2026-10-13T02:00:00.000Z',
  gameTitleName: 'NHL 27',
  gameMode: null,
  result: 'WIN',
  overtime: false,
  scoreFor: 4,
  scoreAgainst: 2,
  opponentName: 'Shake N Bake',
  team: null,
  endedEarly: false,
  labels: null,
  patterns: [],
  periods: null,
  players: [line()],
  aiGoalieInNet: false,
  aiGoalie: null,
  guestCount: 0,
  context: {
    result: 'normal',
    streakBefore: null,
    streakAfter: { kind: 'W', count: 1 },
    last10: { wins: 6, losses: 3, otl: 1 },
    margin: 'comfortable',
    surprise: 'expected',
    night: [],
  },
  teamNotes: [],
  headToHead: null,
  newRecords: [],
  chemistry: [],
  unnamedTeammates: 0,
  unnamedGoals: 0,
  unnamedAssists: 0,
  goals: null,
  clockMeaning: null,
  ...over,
})
const sheet = { milestones: [], threads: [] }

void test('mulberry32: seeded, reproducible, in [0, 1)', () => {
  const a = mulberry32(501)
  const b = mulberry32(501)
  const xs = Array.from({ length: 50 }, () => a())
  assert.deepEqual(
    xs,
    Array.from({ length: 50 }, () => b()),
  )
  assert.ok(xs.every((x) => x >= 0 && x < 1))
  assert.notDeepEqual(xs, Array.from({ length: 50 }, mulberry32(502)))
  assert.equal(weightedPick([['only', 1]], a), 'only')
})

void test('buzz: a routine win is quiet; labels raise it; 6s weighs more than 3s', () => {
  assert.equal(buzzScore(game(), sheet).score, 0)
  assert.equal(planBuzz(game(), sheet).level, 'quiet')
  assert.equal(planBuzz(game(), sheet).posts, 1)
  const ot = game({ overtime: true, context: { ...game().context!, margin: 'close' } })
  assert.equal(buzzScore(ot, sheet).score, 3)
  // An overtime one-goal game alone stays quiet (tuned cut-offs); with an upset it is normal.
  assert.equal(buzzLevel(3, ot), 'quiet')
  const otUpset = { ...ot, context: { ...ot.context!, surprise: 'upset' as const } }
  assert.equal(buzzScore(otUpset, sheet).score, 5)
  assert.equal(planBuzz(otUpset, sheet).level, 'normal')
  assert.equal(planBuzz(otUpset, sheet).posts, 2)
  assert.deepEqual(planBuzz(otUpset, sheet).articles, [])
  const six = buzzScore({ ...ot, gameMode: '6s' }, sheet).score
  const three = buzzScore({ ...ot, gameMode: '3s' }, sheet).score
  assert.equal(six, 3 * BUZZ_MODE_FACTOR['6s'])
  assert.equal(three, Math.round(3 * BUZZ_MODE_FACTOR['3s'] * 100) / 100)
  assert.ok(six > three)
})

void test('buzz: an 11-2 blowout with a hat trick and 5 points is big; a record is historic; ended early is quiet', () => {
  const big = game({
    scoreFor: 11,
    scoreAgainst: 2,
    context: { ...game().context!, margin: 'blowout' },
    players: [line({ goals: 3, assists: 2, points: 5 })],
  })
  const s = buzzScore(big, sheet)
  // blowout 3 + many goals 1 + player (hat trick 3 + 5 points 3, capped at 4)
  assert.equal(s.score, 8)
  assert.ok(s.score >= BUZZ_CUTOFFS.big && s.score < BUZZ_CUTOFFS.huge)
  assert.equal(planBuzz(big, sheet).level, 'big')
  assert.deepEqual(planBuzz(big, sheet).articles, ['game'])
  const record = game({
    newRecords: [{ stat: 'goals', name: 'Skater A', value: 62, previous: 61 } as never],
  })
  const h = planBuzz(record, sheet)
  assert.equal(h.level, 'historic')
  assert.equal(h.posts, 9)
  assert.ok(h.articles.length === 2 || h.articles.length === 3)
  assert.deepEqual(h.articles.slice(0, 2), ['game', 'spotlight'])
  const early = { ...big, endedEarly: true }
  assert.equal(planBuzz(early, sheet).level, 'quiet')
  assert.equal(planBuzz(early, sheet).posts, 1)
})

void test('buzz: post counts per level and the huge articles; reproducible per match', () => {
  const huge = game({
    overtime: true,
    gameMode: '6s',
    context: { ...game().context!, margin: 'close', result: 'turnaround', surprise: 'big upset' },
    players: [line({ goals: 3, points: 3 })],
  })
  // overtime 2 + close 1 + turnaround 2 + big upset 3 + hat trick 3 = 11 x 1.25
  assert.equal(buzzScore(huge, sheet).score, 13.75)
  for (let id = 1; id < 60; id++) {
    const p = planBuzz({ ...huge, matchId: id }, sheet)
    assert.equal(p.level, 'huge')
    assert.ok(p.posts >= 6 && p.posts <= 8)
    assert.equal(p.articles[0], 'game')
    assert.ok(p.articles[1] === 'spotlight' || p.articles[1] === 'column')
    assert.deepEqual(planBuzz({ ...huge, matchId: id }, sheet), p)
  }
  const bigs = new Set<number>()
  for (let id = 1; id < 200; id++) {
    const p = planBuzz(
      game({
        matchId: id,
        context: { ...game().context!, margin: 'blowout', surprise: 'big upset', result: 'blip' },
      }),
      sheet,
    )
    assert.equal(p.level, 'big')
    bigs.add(p.posts)
  }
  assert.deepEqual([...bigs].sort(), [3, 4, 5])
  assert.ok(Math.abs(expectedPostsPerGame() - 2.0) < 0.15)
})

void test('buzz: timeline comeback and late winner; milestones, notes, AI goalie, shutout, threads', () => {
  const goals = [
    { period: '1st', clock: '02:00', side: 'against', scorer: null, assists: [] },
    { period: '1st', clock: '05:00', side: 'against', scorer: null, assists: [] },
    { period: '2nd', clock: '03:00', side: 'for', scorer: null, assists: [] },
    { period: '2nd', clock: '09:00', side: 'for', scorer: null, assists: [] },
    { period: '3rd', clock: '18:30', side: 'for', scorer: null, assists: [] },
  ] as NewsGameFacts['goals']
  assert.deepEqual(
    timelineHooks({ result: 'WIN', scoreAgainst: 2, goals, clockMeaning: 'elapsed' }),
    { comeback: true, lateWinner: true },
  )
  assert.deepEqual(
    timelineHooks({ result: 'WIN', scoreAgainst: 2, goals, clockMeaning: 'remaining' }),
    { comeback: true, lateWinner: false },
  )
  assert.deepEqual(
    timelineHooks({ result: 'LOSS', scoreAgainst: 2, goals, clockMeaning: 'elapsed' }),
    {
      comeback: false,
      lateWinner: false,
    },
  )
  const g = game({
    scoreAgainst: 0,
    teamNotes: ['biggest 6s win of the season: 4-0', '100th win of the title'],
    aiGoalie: {
      name: 'Jonas Wagner',
      saves: 20,
      shotsAgainst: 20,
      goalsAgainst: 0,
      savePct: 100,
      label: 'steal',
    },
  })
  const s = buzzScore(g, {
    milestones: [{ playerId: 2, name: 'Skater A', stat: 'points', value: 100 }],
    threads: [
      {
        key: 'k',
        kind: 'pp-drought',
        subject: null,
        since: '2026-10-01',
        status: 'closed-tonight',
        summary: 's',
      },
    ],
  })
  // milestone 2 + notes 2 + 2 + steal 2 + shutout 2 + thread 1
  assert.equal(s.score, 11)
})

void test('buzz fix 1: a player run adds buzz only at a round count (5, 10, 15, ...) or when it ends', () => {
  const withRun = (
    games: number,
    status: 'extended' | 'ended',
    kind: 'points' | 'goals' | 'noGoal' = 'points',
  ) => buzzScore(game({ players: [line({ streaks: [{ kind, games, status }] })] }), sheet).score
  for (const n of [6, 7, 8, 16, 19]) assert.equal(withRun(n, 'extended'), 0, String(n))
  for (const n of [5, 10, 15, 20])
    assert.equal(withRun(n, 'extended'), BUZZ_WEIGHTS.streak, String(n))
  assert.equal(withRun(8, 'ended'), BUZZ_WEIGHTS.streak)
  assert.equal(withRun(9, 'ended', 'noGoal'), BUZZ_WEIGHTS.streak)
  assert.equal(withRun(10, 'extended', 'noGoal'), 0) // a slump going on is no buzz
})
