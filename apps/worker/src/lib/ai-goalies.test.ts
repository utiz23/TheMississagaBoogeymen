import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aiGoalieSeasonTotals,
  aiGoalieSide,
  planAiGoalieLines,
  type AiGameInput,
} from './ai-goalies.js'

const game = (partial: Partial<AiGameInput> & { matchId: number }): AiGameInput => ({
  bgmWasHome: true,
  shotsAgainst: 10,
  scoreAgainst: 2,
  result: 'WIN',
  toiSeconds: 3600,
  ...partial,
})

void test('home side → Lehmann (home), away → Wagner (away); unknown alternates by match id', () => {
  assert.equal(aiGoalieSide({ matchId: 7, bgmWasHome: true }), 'home')
  assert.equal(aiGoalieSide({ matchId: 7, bgmWasHome: false }), 'away')
  assert.equal(aiGoalieSide({ matchId: 8, bgmWasHome: null }), 'home')
  assert.equal(aiGoalieSide({ matchId: 9, bgmWasHome: null }), 'away')
})

void test('a game line comes from the team totals; saves never go negative', () => {
  const [a, b] = planAiGoalieLines([
    game({ matchId: 1, bgmWasHome: false, shotsAgainst: 14, scoreAgainst: 3 }),
    game({ matchId: 2, shotsAgainst: 1, scoreAgainst: 2, result: 'DNF' }),
  ])
  assert.deepEqual(a, {
    matchId: 1,
    side: 'away',
    teamSide: 1,
    shotsAgainst: 14,
    goalsAgainst: 3,
    saves: 11,
    toiSeconds: 3600,
    result: 'WIN',
  })
  assert.equal(b?.saves, 0)
  assert.equal(b.teamSide, 0)
})

void test('season totals: record, SV%, GAA, shutouts; a DNF is played but not completed', () => {
  const lines = planAiGoalieLines([
    game({ matchId: 1, shotsAgainst: 20, scoreAgainst: 0 }),
    game({ matchId: 2, shotsAgainst: 10, scoreAgainst: 4, result: 'LOSS' }),
    game({ matchId: 3, shotsAgainst: 10, scoreAgainst: 2, result: 'OTL', toiSeconds: 3900 }),
    game({ matchId: 4, shotsAgainst: 5, scoreAgainst: 0, result: 'DNF', toiSeconds: null }),
  ])
  assert.deepEqual(aiGoalieSeasonTotals(lines), {
    gamesPlayed: 4,
    gamesCompleted: 3,
    dnf: 1,
    wins: 1,
    losses: 1,
    otl: 1,
    shots: 45,
    saves: 39,
    goalsAgainst: 6,
    shutouts: 1, // the DNF with 0 against is not a shutout
    toiSeconds: 11100,
    savePct: '86.67',
    gaa: '1.95', // 6 goals over 11,100 timed seconds
    winPct: '33.33',
  })
})

void test('no games → zeros and nulls', () => {
  const t = aiGoalieSeasonTotals([])
  assert.equal(t.gamesPlayed, 0)
  assert.equal(t.savePct, null)
  assert.equal(t.gaa, null)
  assert.equal(t.toiSeconds, null)
})
