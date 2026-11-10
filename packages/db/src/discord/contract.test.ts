import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDiscordGameResult,
  parseDiscordUnlock,
  parseDiscordUnlockResponse,
  type DiscordGameResult,
} from './contract.js'

void test('unlock response: an explicit skip, or an unlock; anything else rejected', () => {
  assert.deepEqual(parseDiscordUnlockResponse({ skip: 'nothing to show' }), {
    skip: 'nothing to show',
  })
  const u = {
    eventId: 9,
    playerId: 2,
    name: 'A',
    kind: 'tier',
    subject: 'STUD',
    graphic: 'card',
    discordUserId: null,
  }
  assert.deepEqual(parseDiscordUnlockResponse(u), u)
  assert.throws(() => parseDiscordUnlockResponse({ skip: 3 }), /skip/)
  assert.throws(() => parseDiscordUnlockResponse({}), /discord contract/)
})

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
  lineupCardCount: 6,
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

void test('rejects a negative or fractional lineupCardCount', () => {
  assert.throws(() => parseDiscordGameResult({ ...valid, lineupCardCount: -1 }), /lineupCardCount/)
  assert.throws(() => parseDiscordGameResult({ ...valid, lineupCardCount: 1.5 }), /lineupCardCount/)
})

void test('rejects non-objects', () => {
  assert.throws(() => parseDiscordGameResult(null), /discord contract/)
})

void test('unlock: valid round-trip; bad kind/graphic rejected; badges are gone', () => {
  const v = {
    eventId: 9,
    playerId: 2,
    name: 'SILKY',
    kind: 'tier',
    subject: 'STUD',
    graphic: 'card',
    discordUserId: null,
  }
  assert.deepEqual(parseDiscordUnlock(JSON.parse(JSON.stringify(v))), v)
  assert.throws(() => parseDiscordUnlock({ ...v, kind: 'x' }), /kind/)
  assert.throws(() => parseDiscordUnlock({ ...v, graphic: 'gif' }), /graphic/)
  // Badge announcements were removed (operator, 2026-11-09).
  assert.throws(() => parseDiscordUnlock({ ...v, kind: 'badge' }), /kind/)
  assert.throws(() => parseDiscordUnlock({ ...v, graphic: 'badge' }), /graphic/)
})

void test('unlock discordUserId: 17–20 digits or null', () => {
  const v = { eventId: 9, playerId: 2, name: 'A', kind: 'tier', subject: 'STUD', graphic: 'card' }
  assert.equal(
    parseDiscordUnlock({ ...v, discordUserId: '447213088828030998' }).discordUserId,
    '447213088828030998',
  )
  assert.equal(parseDiscordUnlock({ ...v, discordUserId: null }).discordUserId, null)
  assert.throws(() => parseDiscordUnlock({ ...v, discordUserId: '12ab' }), /discordUserId/)
})
