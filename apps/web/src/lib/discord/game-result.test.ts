import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiscordGameResult, type DiscordGameResultInput } from './game-result.ts'

const base: DiscordGameResultInput = {
  match: {
    id: 900,
    result: 'WIN',
    scoreFor: 4,
    scoreAgainst: 2,
    opponentName: 'XYZ Hockey Club',
    gameMode: '6s',
    playedAt: new Date('2026-10-10T03:42:00Z'),
  },
  gameTitleName: 'NHL 26',
  overtime: false,
  stars: [
    { side: 'bgm', playerId: 7, gamertag: 'Member1', score: 8.4, statLine: '2G 1A' },
    { side: 'opp', playerId: null, gamertag: 'OppGuy', score: 6.1, statLine: '1G' },
    { side: 'bgm', playerId: 50, gamertag: 'Guesty', score: 5.3, statLine: '1A' },
  ],
  memberIds: new Set([7, 8]),
  cardPlayerIds: new Set([7]),
}

void test('classifies member, opponent and guest stars in star order', () => {
  const r = buildDiscordGameResult(base)
  assert.deepEqual(
    r.stars.map((s) => [s.rank, s.kind, s.playerId, s.teamAbbrev]),
    [
      [1, 'member', 7, null],
      [2, 'opponent', null, 'XHC'],
      [3, 'guest', 50, null],
    ],
  )
  assert.deepEqual(r.cardPlayerIds, [7])
  assert.equal(r.playedAt, '2026-10-10T03:42:00.000Z')
})

void test('a BGM star with no player id is a guest, never a member', () => {
  const r = buildDiscordGameResult({
    ...base,
    stars: [{ side: 'bgm', playerId: null, gamertag: 'Unresolved', score: 3, statLine: '' }],
  })
  assert.equal(r.stars[0]?.kind, 'guest')
  assert.deepEqual(r.cardPlayerIds, [])
})

void test('a member whose card did not load gets no card but stays a member line', () => {
  const r = buildDiscordGameResult({ ...base, cardPlayerIds: new Set() })
  assert.equal(r.stars[0]?.kind, 'member')
  assert.deepEqual(r.cardPlayerIds, [])
})

void test('cards follow star order, not id order', () => {
  const r = buildDiscordGameResult({
    ...base,
    stars: [
      { side: 'bgm', playerId: 8, gamertag: 'B', score: 9, statLine: '' },
      { side: 'bgm', playerId: 7, gamertag: 'A', score: 8, statLine: '' },
    ],
    cardPlayerIds: new Set([7, 8]),
  })
  assert.deepEqual(r.cardPlayerIds, [8, 7])
})

void test('DNF drops stars and cards', () => {
  const r = buildDiscordGameResult({ ...base, match: { ...base.match, result: 'DNF' } })
  assert.deepEqual(r.stars, [])
  assert.deepEqual(r.cardPlayerIds, [])
})

void test('zero stars is a valid result', () => {
  const r = buildDiscordGameResult({ ...base, stars: [] })
  assert.deepEqual(r.stars, [])
})
