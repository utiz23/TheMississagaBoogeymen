import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyPlayerExtras,
  parseNewsFactsResponse,
  type NewsFacts,
  type NewsGameFacts,
  type NewsPlayerLine,
} from '@eanhl/db/news'
import { MAX_TOP_FACTS, rankFacts, runningKey, scoreText } from './rank-facts.ts'

const line = (
  over: Partial<NewsPlayerLine> & Pick<NewsPlayerLine, 'playerId' | 'name'>,
): NewsPlayerLine => {
  const goals = over.goals ?? 0
  const assists = over.assists ?? 0
  return {
    position: 'F',
    isGoalie: false,
    shots: 3,
    hits: 1,
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

const normFor = (
  goals: number,
  labels: Partial<
    Record<
      'goals' | 'assists' | 'points' | 'shots' | 'hits',
      'typical' | 'big for him' | 'quiet for him'
    >
  >,
) => ({
  games: 20,
  perGame: { goals, assists: 0.6, points: goals + 0.6, shots: 3.1, hits: 1.5 },
  last10: { goals, assists: 0.6, points: goals + 0.6 },
  labels: {
    goals: 'typical',
    assists: 'typical',
    points: 'typical',
    shots: 'typical',
    hits: 'typical',
    ...labels,
  } as const,
})

const game = (over: Partial<NewsGameFacts> = {}): NewsGameFacts => ({
  matchId: 501,
  night: '2026-05-08',
  playedAt: '2026-05-09T02:00:00.000Z',
  gameTitleName: 'NHL 26',
  gameMode: '6s',
  result: 'WIN',
  overtime: false,
  scoreFor: 4,
  scoreAgainst: 2,
  opponentName: 'Shake N Bake',
  team: {
    shotsFor: 25,
    shotsAgainst: 18,
    hitsFor: 12,
    hitsAgainst: 15,
    ppGoals: 1,
    ppOpportunities: 3,
    passPct: 75.5,
    timeOnAttackSeconds: 600,
  },
  endedEarly: false,
  labels: null,
  patterns: [],
  periods: null,
  players: [],
  aiGoalieInNet: false,
  aiGoalie: null,
  guestCount: 0,
  context: {
    result: 'normal',
    streakBefore: { kind: 'W', count: 1 },
    streakAfter: { kind: 'W', count: 2 },
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

const sheet = (games: NewsGameFacts[], over: Partial<NewsFacts> = {}): NewsFacts => ({
  kind: 'game',
  key: '2026-05-08',
  gameTitleName: 'NHL 26',
  games,
  nightTotals: {
    goalsFor: 0,
    goalsAgainst: 0,
    shotsFor: 0,
    shotsAgainst: 0,
    wins: 0,
    losses: 0,
    otl: 0,
  },
  record: { wins: 10, losses: 5, otl: 1 },
  streak: { kind: 'W', count: 2 },
  unlocks: [],
  milestones: [],
  recentNights: [],
  people: [],
  history: [],
  weekPlayers: [],
  aiGoalieWeek: [],
  lore: [],
  norms: { '3s': null, '6s': null },
  records: [],
  threads: [],
  stances: [],
  scorecards: [],
  topFacts: [],
  ...over,
})

void test('scoreText: winner first, overtime named', () => {
  assert.equal(scoreText(game()), '4-2 win over Shake N Bake')
  assert.equal(
    scoreText(game({ result: 'LOSS', scoreFor: 2, scoreAgainst: 6 })),
    '6-2 loss to Shake N Bake',
  )
  assert.equal(
    scoreText(game({ result: 'OTL', overtime: true, scoreFor: 3, scoreAgainst: 4 })),
    '4-3 overtime loss to Shake N Bake',
  )
})

void test('rankFacts: an 11-2 blowout ranks first, ahead of a big night for a player', () => {
  const g = game({
    scoreFor: 11,
    scoreAgainst: 2,
    context: { ...game().context!, margin: 'blowout' },
    teamNotes: ['biggest win of the season: 11-2', 'most goals in a game this season: 11'],
    players: [
      line({
        playerId: 2,
        name: 'Raz',
        goals: 2,
        assists: 1,
        norm: normFor(0.5, { goals: 'big for him' }),
      }),
    ],
  })
  const top = rankFacts(sheet([g]))
  assert.deepEqual(
    top.slice(0, 3).map((f) => [f.text, f.weight]),
    [
      ['Blowout: 11-2 win over Shake N Bake', 67],
      ['Team: biggest win of the season: 11-2', 50],
      ['Raz: 2 goals vs Shake N Bake — big for him (season avg 0.5)', 40],
    ],
  )
  assert.equal(top[2]!.subject, 'Raz')
  assert.equal(top[0]!.subject, null)
})

void test('rankFacts: a new club record ranks first, with the old record from the sheet', () => {
  const g = game({
    context: {
      ...game().context!,
      result: 'blip',
      streakBefore: { kind: 'W', count: 7 },
      streakAfter: { kind: 'L', count: 1 },
    },
    result: 'LOSS',
    scoreFor: 3,
    scoreAgainst: 5,
    newRecords: [{ stat: 'goals', name: 'Raz', value: 62 }],
    players: [
      line({ playerId: 2, name: 'Raz', goals: 3, firsts: ['first hat trick of the season'] }),
    ],
  })
  const top = rankFacts(
    sheet([g], { records: [{ stat: 'goals', holder: 'Old Sniper', value: 61, title: 'NHL 24' }] }),
  )
  assert.deepEqual(top[0], {
    id: 'g501:record:goals:Raz',
    text: 'New club record: Raz, 62 goals this season (the record was 61 by Old Sniper, NHL 24)',
    weight: 100,
    subject: 'Raz',
  })
  assert.equal(
    top[1]!.text,
    'Result: blip — 5-3 loss to Shake N Bake, the first loss after 7 straight wins',
  )
  // A player without a norm: a hat trick is a fact on its own.
  assert.ok(
    top.some((f) => f.text === 'Raz: hat trick (3 goals) vs Shake N Bake' && f.weight === 45),
  )
})

void test('rankFacts: player labels, bests, streaks, debuts, threads, chemistry; nothing typical; sorted by weight', () => {
  const p = line({
    playerId: 3,
    name: 'Erb',
    assists: 2,
    shots: 0,
    norm: normFor(0.4, { assists: 'big for him', shots: 'quiet for him' }),
    bests: ['career high assists'],
    streaks: [{ kind: 'noGoal', games: 9, status: 'extended' }],
    approaching: [{ stat: 'assists', value: 50, remaining: 1 }],
    debut: 'title',
    returnAfterDays: 41,
  })
  const g = game({
    players: [p],
    chemistry: [{ pair: ['Erb', 'Raz'], games: 16, wins: 12, losses: 3, otl: 1 }],
    patterns: ['the Boogeymen were out-hit as usual'],
  })
  const facts = rankFacts(
    sheet([g], {
      threads: [
        {
          key: 'player-slump:3@2026-04-20',
          kind: 'player-slump',
          subject: 'Erb',
          since: '2026-04-20',
          status: 'open',
          summary: 'Erb: no goal in 9 games',
        },
      ],
      milestones: [{ playerId: 3, name: 'Erb', stat: 'points', value: 100 }],
    }),
  )
  const texts = facts.map((f) => f.text)
  for (const t of [
    'Erb: reached 100 points this title',
    'Erb: career high assists (2) vs Shake N Bake',
    'Erb: 2 assists vs Shake N Bake — big for him (season avg 0.6)',
    'Erb: back after 41 days',
    'Thread (open): Erb: no goal in 9 games',
    'Erb: no goal in 9 games',
    'Erb: 1 assist from 50 this title',
    'Erb: first game of NHL 26',
    'Erb and Raz together: 12-3-1 in 16 games',
    'Erb: 0 shots vs Shake N Bake — quiet for him (season avg 3.1)',
    'Pattern: the Boogeymen were out-hit as usual',
  ]) {
    assert.ok(texts.includes(t), t)
  }
  assert.equal(texts[0], 'Erb: reached 100 points this title')
  assert.ok(facts.every((f, i) => i === 0 || facts[i - 1]!.weight >= f.weight))
  assert.ok(!texts.some((t) => t.includes('typical')))
})

void test('rankFacts: texts use only numbers on the sheet; the ranked sheet passes the contract', () => {
  const g = game({
    scoreFor: 6,
    scoreAgainst: 0,
    context: {
      ...game().context!,
      result: 'turnaround',
      streakBefore: { kind: 'L', count: 4 },
      surprise: 'upset',
      night: ['swept the night'],
    },
    headToHead: {
      wins: 1,
      losses: 2,
      otl: 0,
      lastMeeting: { result: 'LOSS', scoreFor: 1, scoreAgainst: 5, night: '2026-04-30' },
    },
    aiGoalie: {
      name: 'Matteo Lehmann',
      saves: 20,
      shotsAgainst: 20,
      goalsAgainst: 0,
      savePct: 100,
    },
  })
  const f = sheet([g])
  const ranked = { ...f, topFacts: rankFacts(f) }
  const texts = ranked.topFacts.map((x) => x.text)
  assert.ok(
    texts.includes('Result: turnaround — 6-0 win over Shake N Bake, a win after 4 straight losses'),
  )
  assert.ok(texts.includes('Shutout: 6-0 win over Shake N Bake'))
  assert.ok(
    texts.includes(
      'Rematch with Shake N Bake: 1-2-0 before this game; last meeting a 5-1 loss on 2026-04-30',
    ),
  )
  assert.ok(texts.includes('Matteo Lehmann (AI goalie): 20 saves on 20 shots, 100% — a steal'))
  assert.ok(texts.includes('Night: swept the night'))
  const parsed = parseNewsFactsResponse({ facts: ranked, forbiddenNames: [] })
  assert.deepEqual(parsed.facts.topFacts, ranked.topFacts)
})

void test('rankFacts: on a night sheet a running fact keeps only its latest state; at most 25 facts; readable team stat names (C2 fix B)', () => {
  const streak = (matchId: number, games: number) =>
    game({
      matchId,
      players: [
        line({
          playerId: 3,
          name: 'Erb',
          assists: 1,
          streaks: [{ kind: 'points', games, status: 'extended' }],
        }),
      ],
      context: { ...game().context!, night: [`${games === 19 ? '4th' : '3rd'} win of the night`] },
    })
  const night = rankFacts(
    sheet([streak(1, 16), streak(2, 17), streak(3, 18), streak(4, 19)], { kind: 'night' }),
  )
  const texts = night.map((f) => f.text)
  assert.deepEqual(
    texts.filter((t) => t.includes('straight games')),
    ['Erb: points in 19 straight games'],
  )
  assert.deepEqual(
    texts.filter((t) => t.startsWith('Night:')),
    ['Night: 4th win of the night'],
  )
  assert.equal(runningKey('g7:p3:streak:points:ended'), 'p3:streak:points')
  assert.equal(runningKey('g7:p3:big:goals'), null)
  // Per-game events stay: two big nights by one player both count.
  const big = (matchId: number, goals: number) =>
    game({
      matchId,
      players: [
        line({ playerId: 2, name: 'Raz', goals, norm: normFor(0.5, { goals: 'big for him' }) }),
      ],
    })
  assert.equal(
    rankFacts(sheet([big(1, 2), big(2, 3)], { kind: 'night' })).filter((f) => f.subject === 'Raz')
      .length,
    2,
  )
  // The cap.
  const many = Array.from({ length: 30 }, (_, i) =>
    game({ matchId: 100 + i, teamNotes: [`note ${String(i)}`] }),
  )
  assert.equal(rankFacts(sheet(many, { kind: 'week' })).length, MAX_TOP_FACTS)
  // Team stat names.
  const labelled = game({
    labels: {
      hitsFor: 'unusually high',
      hitsAgainst: null,
      shotsFor: 'typical',
      shotsAgainst: null,
      timeOnAttack: 'unusually low',
      passPct: 'unusually high',
    },
  })
  const t = rankFacts(sheet([labelled])).map((f) => f.text)
  assert.ok(t.includes('Team hits 12: unusually high'))
  assert.ok(t.includes('Team time on attack 600 s: unusually low'))
  assert.ok(t.includes('Team pass completion 75.5%: unusually high'))
})
