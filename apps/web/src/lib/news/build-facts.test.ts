import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNewsFactsResponse } from '@eanhl/db/news'
import {
  buildFacts,
  buildGameFacts,
  buildMilestones,
  buildPeople,
  buildRecordAndStreak,
  passPctOf,
  periodsFromSummaries,
  unlockText,
  type GameFactsArgs,
  type GamePlayerInput,
} from './build-facts.ts'

const profile = (name: string | null, pressLevel: 'full' | 'easy' | 'out' = 'full') => ({
  name,
  pressLevel,
})

// ── buildPeople ──────────────────────────────────────────────────────────────

void test('buildPeople: a member with press level out is not named; name and gamertag are forbidden', () => {
  const { people, forbiddenNames } = buildPeople({
    players: [
      { playerId: 1, gamertag: 'IgorTag', aiGoalie: false, position: 'center' },
      { playerId: 2, gamertag: 'Silky', aiGoalie: false, position: 'defenseMen' },
    ],
    memberIds: new Set([1, 2]),
    profiles: new Map([
      [1, profile('Igor Orlov', 'out')],
      [2, profile('Silky Joe', 'easy')],
    ]),
  })
  assert.deepEqual(people, [
    { playerId: 2, name: 'Silky Joe', position: 'defenseMen', pressLevel: 'easy' },
  ])
  assert.deepEqual([...forbiddenNames].sort(), ['Igor Orlov', 'IgorTag'])
})

void test('buildPeople: a blank profile name falls back to the gamertag (trimmed)', () => {
  const { people, forbiddenNames } = buildPeople({
    players: [
      { playerId: 3, gamertag: 'x_Sniper_x', aiGoalie: false, position: 'rightWing' },
      { playerId: 4, gamertag: 'PadTag', aiGoalie: false, position: 'goalie' },
    ],
    memberIds: new Set([3, 4]),
    profiles: new Map([
      [3, profile('  ')],
      [4, profile('  Pad Man  ')],
    ]),
  })
  assert.deepEqual(
    people.map((p) => [p.playerId, p.name, p.pressLevel]),
    [
      [3, 'x_Sniper_x', 'full'],
      [4, 'Pad Man', 'full'],
    ],
  )
  assert.deepEqual(forbiddenNames, [])
})

void test('buildPeople: a member without a profile row is named by gamertag at full press', () => {
  const { people } = buildPeople({
    players: [{ playerId: 5, gamertag: 'NoProfile', aiGoalie: false, position: 'center' }],
    memberIds: new Set([5]),
    profiles: new Map(),
  })
  assert.deepEqual(people, [
    { playerId: 5, name: 'NoProfile', position: 'center', pressLevel: 'full' },
  ])
})

void test('buildPeople: a guest is never named; gamertag and non-blank profile name are forbidden', () => {
  const { people, forbiddenNames } = buildPeople({
    players: [
      { playerId: 10, gamertag: 'GuestOne', aiGoalie: false, position: 'center' },
      { playerId: 11, gamertag: 'GuestTwo', aiGoalie: false, position: 'center' },
    ],
    memberIds: new Set(),
    profiles: new Map([
      [10, profile('Guest Person')],
      [11, profile('   ')],
    ]),
  })
  assert.deepEqual(people, [])
  assert.deepEqual([...forbiddenNames].sort(), ['Guest Person', 'GuestOne', 'GuestTwo'])
})

void test('buildPeople: an AI goalie is not named, even though the club counts it as a member', () => {
  const { people, forbiddenNames } = buildPeople({
    players: [{ playerId: 20, gamertag: 'Lehmann', aiGoalie: true, position: 'goalie' }],
    memberIds: new Set([20]),
    profiles: new Map(),
  })
  assert.deepEqual(people, [])
  assert.deepEqual(forbiddenNames, ['Lehmann'])
})

void test('buildPeople: one entry per player across games; forbidden names deduplicated; latest position wins', () => {
  const { people, forbiddenNames } = buildPeople({
    players: [
      { playerId: 1, gamertag: 'A', aiGoalie: false, position: 'center' },
      { playerId: 1, gamertag: 'A', aiGoalie: false, position: 'leftWing' },
      { playerId: 9, gamertag: 'Guest', aiGoalie: false, position: 'center' },
      { playerId: 9, gamertag: 'Guest', aiGoalie: false, position: 'center' },
      { playerId: 8, gamertag: 'guest', aiGoalie: false, position: 'center' },
    ],
    memberIds: new Set([1]),
    profiles: new Map(),
  })
  assert.equal(people.length, 1)
  assert.equal(people[0]?.position, 'leftWing')
  assert.deepEqual(forbiddenNames, ['Guest'])
})

// ── buildGameFacts ───────────────────────────────────────────────────────────

const skater = (over: Partial<GamePlayerInput>): GamePlayerInput => ({
  playerId: 1,
  gamertag: 'Tag',
  position: 'center',
  isGoalie: false,
  aiGoalie: false,
  goals: 0,
  assists: 0,
  shots: 0,
  hits: 0,
  plusMinus: 0,
  pim: 0,
  saves: null,
  goalsAgainst: null,
  shotsAgainst: null,
  gameScore: null,
  star: null,
  ...over,
})

const gameArgs = (over: Partial<GameFactsArgs> = {}): GameFactsArgs => ({
  match: {
    id: 900,
    playedAt: new Date('2026-10-13T03:30:00Z'), // 21:30 Oct 12 in Edmonton
    result: 'WIN',
    scoreFor: 3,
    scoreAgainst: 2,
    opponentName: 'XYZ Hockey Club',
    gameMode: '6s',
    hitsFor: 11,
    hitsAgainst: 7,
    ppGoals: 1,
    ppOpportunities: 3,
    timeOnAttack: 410,
  },
  gameTitleName: 'NHL 27',
  overtime: true,
  shots: { for: 30, against: 21 },
  passPct: 78.5,
  periods: null,
  players: [
    skater({
      playerId: 1,
      gamertag: 'Hero',
      goals: 2,
      assists: 1,
      shots: 6,
      star: 1,
      gameScore: 9.1,
    }),
    skater({ playerId: 2, gamertag: 'OutGuy', goals: 1, shots: 4, star: 2, gameScore: 7.2 }),
    skater({ playerId: 3, gamertag: 'GuestA', assists: 1 }),
    skater({ playerId: 4, gamertag: 'GuestB' }),
    skater({
      playerId: 5,
      gamertag: 'Lehmann',
      position: 'goalie',
      isGoalie: true,
      aiGoalie: true,
      saves: 19,
      goalsAgainst: 2,
      shotsAgainst: 21,
    }),
  ],
  people: [{ playerId: 1, name: 'Hero Name', position: 'center', pressLevel: 'full' }],
  ...over,
})

void test('buildGameFacts: an OT win 3-2 is a WIN with overtime true; the out-member goal stays in the score only', () => {
  const g = buildGameFacts(gameArgs())
  assert.equal(g.result, 'WIN')
  assert.equal(g.overtime, true)
  assert.equal(g.scoreFor, 3)
  assert.equal(g.scoreAgainst, 2)
  assert.equal(g.matchId, 900)
  assert.equal(g.night, '2026-10-12')
  assert.equal(g.playedAt, '2026-10-13T03:30:00.000Z')
  // Only the named player has a line; the out-member (player 2) is absent.
  assert.deepEqual(
    g.players.map((p) => [p.playerId, p.name, p.goals, p.assists, p.points, p.star]),
    [[1, 'Hero Name', 2, 1, 3, 1]],
  )
  assert.equal(g.players[0]?.gameScore, 9.1)
})

void test('buildGameFacts: guestCount counts the unnamed BGM players, not AI goalies; aiGoalieInNet is set', () => {
  const g = buildGameFacts(gameArgs())
  // OutGuy, GuestA and GuestB are unnamed; Lehmann is an AI goalie.
  assert.equal(g.guestCount, 3)
  assert.equal(g.aiGoalieInNet, true)
  const none = buildGameFacts(gameArgs({ players: [skater({ playerId: 1, gamertag: 'Hero' })] }))
  assert.equal(none.aiGoalieInNet, false)
  assert.equal(none.guestCount, 0)
})

void test('buildGameFacts: team numbers come from the arguments the match page uses', () => {
  const g = buildGameFacts(gameArgs())
  assert.deepEqual(g.team, {
    shotsFor: 30,
    shotsAgainst: 21,
    hitsFor: 11,
    hitsAgainst: 7,
    ppGoals: 1,
    ppOpportunities: 3,
    passPct: 78.5,
    timeOnAttackSeconds: 410,
  })
  assert.equal(g.gameTitleName, 'NHL 27')
  assert.equal(g.gameMode, '6s')
  assert.equal(g.opponentName, 'XYZ Hockey Club')
})

void test('buildGameFacts: a goalie line carries saves, goals against and save % (one decimal)', () => {
  const g = buildGameFacts(
    gameArgs({
      players: [
        skater({
          playerId: 1,
          gamertag: 'Hero',
          position: 'goalie',
          isGoalie: true,
          saves: 27,
          goalsAgainst: 3,
          shotsAgainst: 30,
          star: 3,
        }),
      ],
    }),
  )
  const line = g.players[0]
  assert.equal(line?.isGoalie, true)
  assert.equal(line?.saves, 27)
  assert.equal(line?.goalsAgainst, 3)
  assert.equal(line?.savePct, 90)
  const skaterLine = buildGameFacts(gameArgs()).players[0]
  assert.equal(skaterLine?.saves, null)
  assert.equal(skaterLine?.savePct, null)
})

void test('buildGameFacts: a game on the night boundary keeps the evening before', () => {
  const g = buildGameFacts(
    gameArgs({ match: { ...gameArgs().match, playedAt: new Date('2026-10-13T05:30:00Z') } }),
  ) // 23:30 Oct 12 Edmonton
  assert.equal(g.night, '2026-10-12')
  const later = buildGameFacts(
    gameArgs({ match: { ...gameArgs().match, playedAt: new Date('2026-10-13T11:00:00Z') } }),
  ) // 05:00 Oct 13 Edmonton, still the Oct 12 night
  assert.equal(later.night, '2026-10-12')
})

// ── helpers ──────────────────────────────────────────────────────────────────

void test('passPctOf: completions over attempts, one decimal, null without attempts', () => {
  assert.equal(passPctOf(157, 200), 78.5)
  assert.equal(passPctOf(1, 3), 33.3)
  assert.equal(passPctOf(0, 0), null)
})

void test('periodsFromSummaries: needs every period read and the goals to add up to the score', () => {
  const rows = [
    { periodNumber: 1, goalsFor: 1, goalsAgainst: 0 },
    { periodNumber: 2, goalsFor: 0, goalsAgainst: 1 },
    { periodNumber: 3, goalsFor: 1, goalsAgainst: 1 },
    { periodNumber: 4, goalsFor: 1, goalsAgainst: 0 },
  ]
  assert.deepEqual(periodsFromSummaries(rows, 3, 2), [
    { period: 1, goalsFor: 1, goalsAgainst: 0 },
    { period: 2, goalsFor: 0, goalsAgainst: 1 },
    { period: 3, goalsFor: 1, goalsAgainst: 1 },
    { period: 4, goalsFor: 1, goalsAgainst: 0 },
  ])
  assert.equal(periodsFromSummaries(rows, 4, 2), null, 'goals do not add up')
  assert.equal(
    periodsFromSummaries([{ periodNumber: 1, goalsFor: null, goalsAgainst: null }], 0, 0),
    null,
  )
  assert.equal(periodsFromSummaries([], 0, 0), null)
  // The -1 "TOT" sentinel is ignored.
  assert.deepEqual(
    periodsFromSummaries(
      [
        { periodNumber: -1, goalsFor: 9, goalsAgainst: 9 },
        { periodNumber: 1, goalsFor: 2, goalsAgainst: 0 },
      ],
      2,
      0,
    ),
    [{ period: 1, goalsFor: 2, goalsAgainst: 0 }],
  )
})

void test('buildRecordAndStreak: record from results; streak is the run at the newest end', () => {
  // Newest first.
  const r = buildRecordAndStreak(['WIN', 'WIN', 'WIN', 'LOSS', 'OTL', 'WIN'])
  assert.deepEqual(r.record, { wins: 4, losses: 1, otl: 1 })
  assert.deepEqual(r.streak, { kind: 'W', count: 3 })
  // OTL ends a win streak and counts as a non-win in a losing run.
  const l = buildRecordAndStreak(['OTL', 'LOSS', 'WIN'])
  assert.deepEqual(l.streak, { kind: 'L', count: 2 })
  assert.deepEqual(buildRecordAndStreak([]), {
    record: { wins: 0, losses: 0, otl: 0 },
    streak: null,
  })
})

void test('unlockText: badge, card level, tier and mythic phrasing', () => {
  assert.equal(
    unlockText({ kind: 'badge', subject: 'Sniper V', graphic: 'badge' }),
    'unlocked the Sniper V badge',
  )
  assert.equal(
    unlockText({ kind: 'card_level', subject: '12', graphic: 'card' }),
    'reached card level 12',
  )
  assert.equal(
    unlockText({ kind: 'tier', subject: 'ALL STAR', graphic: 'card' }),
    'unlocked the ALL STAR card',
  )
  assert.equal(
    unlockText({ kind: 'mythic', subject: 'INFERNO', graphic: 'card' }),
    'unlocked the INFERNO card',
  )
})

// ── buildMilestones ──────────────────────────────────────────────────────────

const people = [
  { playerId: 1, name: 'Hero Name', position: 'center', pressLevel: 'full' as const },
  { playerId: 2, name: 'Second', position: 'center', pressLevel: 'full' as const },
]
const totals = (goals: number, assists: number, games: number, points = goals + assists) => ({
  goals,
  assists,
  points,
  games,
})

void test('buildMilestones: goals 24 -> 26 crosses 25', () => {
  const m = buildMilestones(
    new Map([[1, totals(24, 3, 10, 27)]]),
    new Map([[1, totals(26, 3, 11, 29)]]),
    people,
  )
  assert.deepEqual(m, [{ playerId: 1, name: 'Hero Name', stat: 'goals', value: 25 }])
})

void test('buildMilestones: 25 -> 26 is not a milestone', () => {
  const m = buildMilestones(
    new Map([[1, totals(25, 3, 10, 28)]]),
    new Map([[1, totals(26, 3, 11, 29)]]),
    people,
  )
  assert.deepEqual(m, [])
})

void test('buildMilestones: 49 -> 51 points crosses 50 (goals plus assists)', () => {
  const m = buildMilestones(
    new Map([[1, totals(30, 19, 10, 49)]]),
    new Map([[1, totals(31, 20, 11, 51)]]),
    people,
  )
  assert.deepEqual(m, [{ playerId: 1, name: 'Hero Name', stat: 'points', value: 50 }])
})

void test('buildMilestones: games, a new player, only named people, highest multiple crossed', () => {
  const m = buildMilestones(
    new Map([
      [1, totals(0, 0, 24)],
      [2, totals(60, 0, 100)],
    ]),
    new Map([
      [1, totals(0, 0, 25)],
      [2, totals(130, 0, 101)],
      [3, totals(50, 50, 50)], // not a named person
    ]),
    people,
  )
  assert.deepEqual(m, [
    { playerId: 1, name: 'Hero Name', stat: 'games', value: 25 },
    { playerId: 2, name: 'Second', stat: 'goals', value: 125 },
    { playerId: 2, name: 'Second', stat: 'points', value: 125 },
  ])
  // No "before" row: totals start at zero.
  const fresh = buildMilestones(new Map(), new Map([[1, totals(0, 0, 1)]]), people)
  assert.deepEqual(fresh, [])
})

// ── buildFacts ───────────────────────────────────────────────────────────────

void test('buildFacts: night totals add up the games; the response passes the shared contract', () => {
  const win = buildGameFacts(gameArgs())
  const loss = buildGameFacts(
    gameArgs({
      match: {
        ...gameArgs().match,
        id: 901,
        result: 'LOSS',
        scoreFor: 0,
        scoreAgainst: 6,
        playedAt: new Date('2026-10-13T05:00:00Z'),
      },
      overtime: false,
      shots: { for: 3, against: 16 },
    }),
  )
  const otl = buildGameFacts(
    gameArgs({
      match: {
        ...gameArgs().match,
        id: 902,
        result: 'OTL',
        scoreFor: 1,
        scoreAgainst: 2,
        playedAt: new Date('2026-10-13T06:00:00Z'),
      },
      shots: { for: 10, against: 12 },
    }),
  )
  const facts = buildFacts({
    kind: 'night',
    key: '2026-10-12',
    gameTitleName: 'NHL 27',
    games: [win, loss, otl],
    record: { wins: 1, losses: 1, otl: 1 },
    streak: { kind: 'L', count: 2 },
    unlocks: [],
    milestones: [],
    recentNights: [],
    people: [{ playerId: 1, name: 'Hero Name', position: 'center', pressLevel: 'full' }],
  })
  assert.deepEqual(facts.nightTotals, {
    goalsFor: 4,
    goalsAgainst: 10,
    shotsFor: 43,
    shotsAgainst: 49,
    wins: 1,
    losses: 1,
    otl: 1,
  })
  const parsed = parseNewsFactsResponse(
    JSON.parse(JSON.stringify({ facts, forbiddenNames: ['A'] })),
  )
  assert.equal(parsed.facts.games.length, 3)
  assert.equal(parsed.facts.key, '2026-10-12')
})

void test('route params: night is a real date; week start is a real Monday', async () => {
  const { isNightKey, isWeekStartKey } = await import('./build-facts.ts')
  assert.equal(isNightKey('2026-10-12'), true)
  assert.equal(isNightKey('2026-02-30'), false)
  assert.equal(isNightKey('2026-10-1'), false)
  assert.equal(isNightKey('abc'), false)
  assert.equal(isWeekStartKey('2026-10-12'), true) // a Monday
  assert.equal(isWeekStartKey('2026-10-13'), false)
  assert.equal(isWeekStartKey('2026-13-01'), false)
})

void test('buildGameFacts: opponent club name has whitespace runs collapsed and is trimmed', () => {
  const g = buildGameFacts(
    gameArgs({ match: { ...gameArgs().match, opponentName: ' Shake   N   Bake ' } }),
  )
  assert.equal(g.opponentName, 'Shake N Bake')
})
