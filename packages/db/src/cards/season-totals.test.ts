import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSeasonTotals, type EaTitleTotals } from './season-totals.js'
import { emptyBadgeValues } from './progression.js'

const ea = (
  playerId: number,
  gameTitleId: number,
  partial: Partial<EaTitleTotals> = {},
): EaTitleTotals => ({
  playerId,
  gameTitleId,
  skaterWins: 0,
  goalieWins: 0,
  goals: 0,
  assists: 0,
  shots: 0,
  dekesMade: 0,
  hatTricks: 0,
  breakaways: 0,
  hits: 0,
  faceoffWins: 0,
  takeaways: 0,
  blockedShots: 0,
  fightsWon: 0,
  goalieGamesCompleted: 0,
  goalieSaves: 0,
  goalieDesperationSaves: 0,
  goaliePokeChecks: 0,
  goalieShutouts: 0,
  ...partial,
})

const none = { ea: [], recordedModes: [], recordedSixesWithGoalie: [] }

void test('EA columns map to their families; wins count skater + goalie wins', () => {
  const m = mergeSeasonTotals({
    ...none,
    ea: [
      ea(1, 26, {
        skaterWins: 10,
        goalieWins: 2,
        goals: 3,
        assists: 4,
        shots: 5,
        dekesMade: 6,
        hatTricks: 7,
        breakaways: 8,
        hits: 9,
        faceoffWins: 11,
        takeaways: 12,
        blockedShots: 13,
        fightsWon: 14,
        goalieGamesCompleted: 15,
        goalieSaves: 16,
        goalieDesperationSaves: 17,
        goaliePokeChecks: 18,
        goalieShutouts: 19,
      }),
    ],
  })
  assert.deepEqual(m.get(26)?.get(1), {
    ...emptyBadgeValues(),
    pwins: 12,
    pgoals: 3,
    pasts: 4,
    pshots: 5,
    pdekes: 6,
    pht: 7,
    pbrk: 8,
    phits: 9,
    pfo: 11,
    ptka: 12,
    pblk: 13,
    pfight: 14,
    gg: 15,
    gw: 2,
    gsv: 16,
    gdsv: 17,
    gpoke: 18,
    gso: 19,
  })
})

void test('each title is its own season: nothing adds up across titles', () => {
  const m = mergeSeasonTotals({
    ...none,
    ea: [ea(1, 27, { goals: 10 }), ea(1, 28, { goals: 5 }), ea(2, 27, { goals: 3 })],
    recordedModes: [
      { playerId: 1, gameTitleId: 27, gameMode: '6s', gamesPlayed: 30 },
      { playerId: 1, gameTitleId: 28, gameMode: '6s', gamesPlayed: 4 },
    ],
  })
  assert.deepEqual([...m.keys()].sort(), [27, 28])
  assert.equal(m.get(27)?.get(1)?.pgoals, 10)
  assert.equal(m.get(27)?.get(1)?.p6v6, 30)
  assert.equal(m.get(28)?.get(1)?.pgoals, 5)
  assert.equal(m.get(28)?.get(1)?.p6v6, 4)
  assert.equal(m.get(27)?.get(2)?.pgoals, 3)
  assert.equal(m.get(28)?.get(2), undefined)
})

void test('site-recorded mode games and 6s-with-goalie games', () => {
  const m = mergeSeasonTotals({
    ...none,
    recordedModes: [
      { playerId: 1, gameTitleId: 27, gameMode: '3s', gamesPlayed: 12 },
      { playerId: 1, gameTitleId: 27, gameMode: '6s', gamesPlayed: 30 },
      { playerId: 1, gameTitleId: 27, gameMode: '1s', gamesPlayed: 99 },
    ],
    recordedSixesWithGoalie: [{ playerId: 1, gameTitleId: 27, games: 9 }],
  })
  const v = m.get(27)?.get(1)
  assert.ok(v)
  assert.equal(v.p3v3, 12)
  assert.equal(v.p6v6, 30)
  assert.equal(v.p6g, 9)
})

void test('a player seen only in recorded games gets a full zeroed record', () => {
  const m = mergeSeasonTotals({
    ...none,
    recordedSixesWithGoalie: [{ playerId: 7, gameTitleId: 27, games: 1 }],
  })
  assert.deepEqual(m.get(27)?.get(7), { ...emptyBadgeValues(), p6g: 1 })
})
