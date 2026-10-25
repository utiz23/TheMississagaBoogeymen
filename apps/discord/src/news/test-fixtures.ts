import {
  emptyPlayerExtras,
  type NewsFacts,
  type NewsGameFacts,
  type NewsPlayerLine,
} from '@eanhl/db/news'

/**
 * The real 2026-10-12 numbers (two losses, 2-6 and 0-6) with placeholder
 * player names. No real teammate names in git. The numbers 4 and 7 appear
 * nowhere in the sheet on purpose: tests use them as "not on the sheet".
 */

function line(
  over: Partial<NewsPlayerLine> & Pick<NewsPlayerLine, 'playerId' | 'name'>,
): NewsPlayerLine {
  return {
    position: over.isGoalie === true ? 'G' : 'F',
    isGoalie: false,
    goals: 0,
    assists: 0,
    points: 0,
    shots: 0,
    hits: 0,
    pim: 0,
    saves: null,
    goalsAgainst: null,
    savePct: null,
    star: null,
    ...emptyPlayerExtras(),
    ...over,
  }
}

const game1: NewsGameFacts = {
  matchId: 90001,
  night: '2026-10-12',
  playedAt: '2026-10-13T02:15:00.000Z',
  gameTitleName: 'NHL 27',
  gameMode: '6s',
  result: 'LOSS',
  overtime: false,
  scoreFor: 2,
  scoreAgainst: 6,
  opponentName: 'Shake N Bake',
  team: {
    shotsFor: 14,
    shotsAgainst: 29,
    hitsFor: 5,
    hitsAgainst: 10,
    ppGoals: null,
    ppOpportunities: null,
    passPct: null,
    timeOnAttackSeconds: null,
  },
  periods: null,
  players: [
    line({
      playerId: 1,
      name: 'Skater A',
      goals: 1,
      assists: 1,
      points: 2,
      shots: 5,
      hits: 2,
    }),
    line({ playerId: 2, name: 'Skater B', goals: 1, points: 1, shots: 3, hits: 3 }),
    line({
      playerId: 3,
      name: 'Goalie G',
      isGoalie: true,
      saves: 23,
      goalsAgainst: 6,
      savePct: 79.3,
    }),
  ],
  aiGoalieInNet: false,
  aiGoalie: null,
  endedEarly: false,
  labels: null,
  patterns: [],
  context: null,
  teamNotes: [],
  headToHead: null,
  newRecords: [],
  chemistry: [],
  guestCount: 0,
  unnamedTeammates: 0,
  unnamedGoals: 0,
  unnamedAssists: 0,
  goals: null,
  clockMeaning: null,
}

const game2: NewsGameFacts = {
  ...game1,
  matchId: 90002,
  playedAt: '2026-10-13T03:05:00.000Z',
  scoreFor: 0,
  scoreAgainst: 6,
  opponentName: 'WestKent Creamers',
  team: { ...game1.team!, shotsFor: 3, shotsAgainst: 16, hitsFor: 6, hitsAgainst: 6 },
  players: [
    line({ playerId: 1, name: 'Skater A', shots: 1, hits: 3 }),
    line({ playerId: 2, name: 'Skater B', shots: 2, hits: 3 }),
    line({
      playerId: 3,
      name: 'Goalie G',
      isGoalie: true,
      saves: 10,
      goalsAgainst: 6,
      savePct: 62.5,
    }),
  ],
}

export function oct12Facts(kind: NewsFacts['kind'] = 'game'): NewsFacts {
  return {
    kind,
    key: '2026-10-12',
    gameTitleName: 'NHL 27',
    games: [game1, game2],
    nightTotals: {
      goalsFor: 2,
      goalsAgainst: 12,
      shotsFor: 17,
      shotsAgainst: 45,
      wins: 0,
      losses: 2,
      otl: 0,
    },
    record: { wins: 9, losses: 11, otl: 1 },
    streak: { kind: 'L', count: 2 },
    unlocks: [{ playerId: 1, name: 'Skater A', text: 'Tier 2 card' }],
    milestones: [{ playerId: 2, name: 'Skater B', stat: 'goals', value: 25 }],
    recentNights: [
      { night: '2026-10-08', wins: 2, losses: 1, otl: 0, goalsFor: 9, goalsAgainst: 8 },
    ],
    people: [
      { playerId: 1, name: 'Skater A', pressLevel: 'full' },
      { playerId: 2, name: 'Skater B', pressLevel: 'easy' },
      { playerId: 3, name: 'Goalie G', pressLevel: 'full' },
    ],
    history: [],
    weekPlayers: [],
    aiGoalieWeek: [],
    lore: ["The Boogeymen's farm team is the Oregon Outlaws."],
    norms: { '3s': null, '6s': null },
    records: [],
  }
}

export function oct12Response(kind: NewsFacts['kind'] = 'game'): {
  facts: NewsFacts
  forbiddenNames: string[]
} {
  return { facts: oct12Facts(kind), forbiddenNames: ['Hidden Hank'] }
}
