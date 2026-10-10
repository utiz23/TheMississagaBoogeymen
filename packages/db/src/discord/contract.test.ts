import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDiscordGameResult, type DiscordGameResult } from './contract.js'

const valid: DiscordGameResult = {
  matchId: 1234,
  result: 'WIN',
  overtime: true,
  scoreFor: 4,
  scoreAgainst: 3,
  opponentName: 'XYZ Hockey Club',
  gameTitleName: 'NHL 26',
  gameMode: '6s',
  playedAt: '2026-10-10T03:42:00.000Z',
  stars: [
    {
      rank: 1,
      gamertag: 'PlayerA',
      kind: 'member',
      playerId: 7,
      score: 8.4,
      statLine: '2G 1A',
      teamAbbrev: null,
    },
    {
      rank: 2,
      gamertag: 'OppGuy',
      kind: 'opponent',
      playerId: null,
      score: 6.1,
      statLine: '1G',
      teamAbbrev: 'XYZ',
    },
  ],
  cardPlayerIds: [7],
}

void test('a valid payload round-trips through JSON', () => {
  assert.deepEqual(parseDiscordGameResult(JSON.parse(JSON.stringify(valid))), valid)
})

void test('rejects an unknown result', () => {
  assert.throws(() => parseDiscordGameResult({ ...valid, result: 'TIE' }), /result/)
})

void test('rejects a star with a non-numeric score', () => {
  const bad = { ...valid, stars: [{ ...valid.stars[0], score: '8.4' }] }
  assert.throws(() => parseDiscordGameResult(bad), /stars\[0\]\.score/)
})

void test('rejects a card id that is not one of the member stars', () => {
  assert.throws(() => parseDiscordGameResult({ ...valid, cardPlayerIds: [99] }), /cardPlayerIds/)
})

void test('rejects non-objects', () => {
  assert.throws(() => parseDiscordGameResult(null), /discord contract/)
})
