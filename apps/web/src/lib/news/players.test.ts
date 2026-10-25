import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyPlayerExtras, type NewsGameFacts, type NewsPlayerLine } from '@eanhl/db/news'
import {
  applyPlayerFacts,
  playerApproaching,
  playerBests,
  playerFirsts,
  playerForm,
  playerGameFromRow,
  playerLabel,
  playerNorm,
  priorGames,
  titleTotalsAfter,
  type PlayerGameInput,
} from './players.ts'

const TITLE = 7
let nextId = 1000
const pg = (over: Partial<PlayerGameInput> = {}): PlayerGameInput => ({
  matchId: nextId++,
  gameTitleId: TITLE,
  night: '2026-05-01',
  playedAt: '2026-05-02T01:00:00.000Z',
  gameMode: '6s',
  result: 'WIN',
  goals: 0,
  assists: 1,
  shots: 3,
  hits: 2,
  position: 'F',
  endedEarly: false,
  ...over,
})
const many = (n: number, over: Partial<PlayerGameInput> = {}) =>
  Array.from({ length: n }, () => pg(over))

const line = (over: Partial<NewsPlayerLine> = {}): NewsPlayerLine => {
  const goals = over.goals ?? 0
  const assists = over.assists ?? 0
  return {
    playerId: 2,
    name: 'Skater A',
    position: 'F',
    isGoalie: false,
    shots: 3,
    hits: 2,
    pim: 0,
    saves: null,
    goalsAgainst: null,
    savePct: null,
    star: null,
    ...emptyPlayerExtras(),
    ...over,
    goals,
    assists,
    points: goals + assists,
  }
}
const GAME = {
  matchId: 1,
  playedAt: '2026-06-01T01:00:00.000Z',
  gameMode: '6s',
  endedEarly: false,
} as const

void test('playerLabel: above the 80th percentile big, under the 20th quiet; never quiet on shots for D/G', () => {
  // Goals 0,0,0,0,0,0,1,1,1,2: p80 = 1, p20 = 0.
  const goals = [0, 0, 0, 0, 0, 0, 1, 1, 1, 2]
  assert.equal(playerLabel(2, goals, 'goals', 'F'), 'big for him')
  assert.equal(playerLabel(1, goals, 'goals', 'F'), 'typical')
  assert.equal(playerLabel(0, goals, 'goals', 'F'), 'typical')
  // Shots 2..6: p20 = 2.8.
  const shots = [2, 3, 3, 4, 4, 4, 5, 5, 6, 6]
  assert.equal(playerLabel(1, shots, 'shots', 'F'), 'quiet for him')
  assert.equal(playerLabel(1, shots, 'shots', 'D'), 'typical')
  assert.equal(playerLabel(1, shots, 'hits', 'D'), 'quiet for him')
  assert.equal(playerLabel(9, shots, 'shots', 'D'), 'big for him')
})

void test('playerNorm: this title, mode and position, counted games not ended early; null below 10, for G and ended early', () => {
  const sample = [
    ...many(9, { goals: 1, assists: 0, shots: 4, hits: 1 }),
    pg({ goals: 0, assists: 2, shots: 2, hits: 3 }),
  ]
  const noise = [
    pg({ gameMode: '3s', goals: 5 }),
    pg({ gameTitleId: 6, goals: 5 }),
    pg({ position: 'D', goals: 5 }),
    pg({ result: 'DNF', goals: 5 }),
    pg({ endedEarly: true, goals: 5 }),
  ]
  const prior = [...noise, ...sample]
  const n = playerNorm(line({ goals: 3, assists: 0, shots: 1 }), GAME, TITLE, prior)
  assert.ok(n)
  assert.equal(n.games, 10)
  assert.deepEqual(n.perGame, { goals: 0.9, assists: 0.2, points: 1.1, shots: 3.8, hits: 1.2 })
  assert.deepEqual(n.last10, { goals: 0.9, assists: 0.2, points: 1.1 })
  assert.equal(n.labels.goals, 'big for him')
  assert.equal(n.labels.shots, 'quiet for him')
  assert.equal(n.labels.assists, 'typical')
  // Nine games: no norm.
  assert.equal(playerNorm(line(), GAME, TITLE, sample.slice(1)), null)
  // A goalie line, a game that ended early, a game without a mode: no norm.
  assert.equal(playerNorm(line({ position: 'G', isGoalie: true }), GAME, TITLE, prior), null)
  assert.equal(playerNorm(line(), { ...GAME, endedEarly: true }, TITLE, prior), null)
  assert.equal(playerNorm(line(), { ...GAME, gameMode: null }, TITLE, prior), null)
  // last10 = the sample's last 10 games.
  const longer = [...many(5, { goals: 3, assists: 0 }), ...sample]
  assert.deepEqual(playerNorm(line(), GAME, TITLE, longer)?.last10, {
    goals: 0.9,
    assists: 0.2,
    points: 1.1,
  })
  assert.equal(playerNorm(line(), GAME, TITLE, longer)?.games, 15)
})

void test('playerBests: season high after 5 games of the title in the mode, career high after 20 in every title, minimum values', () => {
  const season = many(5, { goals: 1, assists: 1, shots: 4, hits: 4 })
  assert.deepEqual(playerBests(line({ goals: 2, assists: 0, shots: 5 }), GAME, TITLE, season), [
    'season high goals',
    'season high shots',
  ])
  // Below the minimum value (1 goal, 4 shots): nothing; equal is not a high.
  assert.deepEqual(playerBests(line({ goals: 1, shots: 4 }), GAME, TITLE, season), [])
  // Four games: too few for a season high.
  assert.deepEqual(playerBests(line({ goals: 2 }), GAME, TITLE, season.slice(1)), [])
  // Career: 20+ earlier games of the mode in every title; it replaces the season high.
  const career = [...many(16, { gameTitleId: 5, goals: 1 }), ...season]
  assert.deepEqual(playerBests(line({ goals: 2 }), GAME, TITLE, career), ['career high goals'])
  const beaten = [pg({ gameTitleId: 5, goals: 4 }), ...career]
  assert.deepEqual(playerBests(line({ goals: 2 }), GAME, TITLE, beaten), ['season high goals'])
  // Other modes and DNF games do not count; goalies get none.
  const other = [
    ...many(3, { gameMode: '3s', goals: 6 }),
    pg({ result: 'DNF', goals: 6 }),
    ...season,
  ]
  assert.deepEqual(playerBests(line({ goals: 2 }), GAME, TITLE, other), ['season high goals'])
  assert.deepEqual(playerBests(line({ goals: 2, position: 'G' }), GAME, TITLE, season), [])
  // Shots of an ended-early earlier game are not a high to beat; null shots give none.
  const early = [pg({ endedEarly: true, shots: 9 }), ...season]
  assert.deepEqual(playerBests(line({ shots: 5 }), GAME, TITLE, early), ['season high shots'])
  assert.deepEqual(playerBests(line({ shots: null, hits: null }), GAME, TITLE, season), [])
})

void test('playerForm: last 5 against the season, 1.5x and +0.6 up, half and -0.6 down', () => {
  const season = many(10, { goals: 0, assists: 1 }) // 1.0 points per game
  const norm = playerNorm(line(), GAME, TITLE, season)
  assert.ok(norm)
  const hot = [...season, ...many(4, { goals: 1, assists: 1 })]
  // Last 5 = 4 x 2 + this game's 2 = 2.0 per game.
  assert.equal(playerForm(line({ goals: 1, assists: 1 }), norm, GAME, TITLE, hot), 'heating up')
  const cold = [...season, ...many(4, { goals: 0, assists: 0 })]
  assert.equal(playerForm(line(), norm, GAME, TITLE, cold), 'cooling off')
  // Last 5 = 1.4: not 1.5x.
  const warm = [...season, ...many(2, { goals: 1, assists: 1 }), ...many(2, { assists: 1 })]
  assert.equal(playerForm(line({ assists: 1 }), norm, GAME, TITLE, warm), null)
  assert.equal(playerForm(line(), null, GAME, TITLE, hot), null)
})

void test('playerFirsts: first goal / assist / point / hat trick of the season, title-wide', () => {
  const noPoints = many(4, { goals: 0, assists: 0 })
  assert.deepEqual(playerFirsts(line({ goals: 3, assists: 1 }), TITLE, noPoints), [
    'first goal of the season',
    'first assist of the season',
    'first hat trick of the season',
  ])
  // An earlier title's goals do not count; a DNF game's goal does.
  assert.deepEqual(
    playerFirsts(line({ goals: 1 }), TITLE, [
      pg({ gameTitleId: 6, goals: 2, assists: 0 }),
      ...noPoints,
    ]),
    ['first goal of the season'],
  )
  assert.deepEqual(
    playerFirsts(line({ goals: 1 }), TITLE, [pg({ result: 'DNF', goals: 1, assists: 0 })]),
    [],
  )
  // First point only when it is not also the first goal or first assist.
  const hadGoal = [pg({ goals: 1, assists: 0 })]
  assert.deepEqual(playerFirsts(line({ assists: 1 }), TITLE, hadGoal), [
    'first assist of the season',
  ])
  assert.deepEqual(playerFirsts(line({ goals: 2 }), TITLE, hadGoal), [])
  assert.deepEqual(playerFirsts(line({ goals: 3 }), TITLE, [pg({ goals: 3 })]), [])
})

void test('playerApproaching: title milestones 1-3 away after the game', () => {
  assert.deepEqual(playerApproaching({ goals: 48, assists: 10, points: 97, games: 99 }), [
    { stat: 'points', value: 100, remaining: 3 },
    { stat: 'goals', value: 50, remaining: 2 },
    { stat: 'games', value: 100, remaining: 1 },
  ])
  assert.deepEqual(playerApproaching({ goals: 50, assists: 46, points: 96, games: 1000 }), [])
  assert.deepEqual(
    titleTotalsAfter(line({ goals: 1, assists: 2 }), TITLE, [
      pg({ goals: 4, assists: 0 }),
      pg({ gameTitleId: 6, goals: 9 }),
      pg({ result: 'DNF', goals: 1, assists: 1 }),
    ]),
    { goals: 6, assists: 3, points: 9, games: 3 },
  )
})

void test('priorGames: the rows before this match; by time when the match is not in the rows', () => {
  const rows = [pg({ playedAt: '2026-05-01T00:00:00.000Z' }), pg({ matchId: 1 }), pg()]
  assert.deepEqual(priorGames(rows, GAME), rows.slice(0, 1))
  const byTime = [
    pg({ playedAt: '2026-05-01T00:00:00.000Z' }),
    pg({ playedAt: '2026-07-01T00:00:00.000Z' }),
  ]
  assert.deepEqual(priorGames(byTime, GAME), byTime.slice(0, 1))
})

void test('applyPlayerFacts: each line read against its own earlier rows; a sheet game sees the earlier sheet game', () => {
  const g = (matchId: number, players: NewsPlayerLine[]) =>
    ({
      matchId,
      playedAt: `2026-06-0${String(matchId)}T01:00:00.000Z`,
      gameMode: '6s',
      endedEarly: false,
      players,
    }) as unknown as NewsGameFacts
  const rows = [
    ...many(10, { goals: 0, assists: 0 }),
    pg({ matchId: 1, goals: 1, assists: 0 }),
    pg({ matchId: 2 }),
  ]
  const out = applyPlayerFacts(
    [g(1, [line({ goals: 1 }), line({ playerId: 9 })]), g(2, [line({ goals: 1 })])],
    new Map([[2, rows]]),
    TITLE,
  )
  const first = out[0]!.players[0]!
  assert.deepEqual(first.firsts, ['first goal of the season'])
  assert.equal(first.norm?.labels.goals, 'big for him')
  assert.deepEqual(out[1]!.players[0]!.firsts, [])
  // A player without rows keeps empty facts.
  assert.deepEqual(out[0]!.players[1]!.firsts, [])
  assert.equal(out[0]!.players[1]!.norm, null)
})

void test('playerGameFromRow: F/D/G and the ended-early rule', () => {
  const row = {
    playerId: 2,
    matchId: 5,
    gameTitleId: TITLE,
    night: '2026-05-01',
    playedAt: '2026-05-02T01:00:00.000Z',
    gameMode: '6s' as const,
    result: 'WIN' as const,
    goals: 1,
    assists: 0,
    shots: 3,
    hits: 1,
    position: 'defenseMen',
    isGoalie: false,
    scoreFor: 3,
    creditedGoals: 3,
    timeOnAttack: 500,
    shotsFor: 20,
    shotsAgainst: 15,
  }
  assert.equal(playerGameFromRow(row).position, 'D')
  assert.equal(playerGameFromRow(row).endedEarly, false)
  assert.equal(playerGameFromRow({ ...row, creditedGoals: 2 }).endedEarly, true)
})
