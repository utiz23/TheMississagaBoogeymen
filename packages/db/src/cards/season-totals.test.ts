import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSeasonTotals, type ClubTitleTotals, type EaOnlyTotals } from './season-totals.js'
import { emptyBadgeValues } from './progression.js'

const club = (
  playerId: number,
  gameTitleId: number,
  partial: Partial<ClubTitleTotals> = {},
): ClubTitleTotals => ({
  playerId,
  gameTitleId,
  wins: 0,
  goals: 0,
  assists: 0,
  shots: 0,
  hatTricks: 0,
  hits: 0,
  faceoffWins: 0,
  takeaways: 0,
  blockedShots: 0,
  goalieGamesCompleted: 0,
  goalieWins: 0,
  goalieSaves: 0,
  goalieDesperationSaves: 0,
  goaliePokeChecks: 0,
  goalieShutouts: 0,
  ...partial,
})

const eaOnly = (
  playerId: number,
  gameTitleId: number,
  partial: Partial<EaOnlyTotals> = {},
): EaOnlyTotals => ({
  playerId,
  gameTitleId,
  dekesMade: 0,
  fightsWon: 0,
  breakaways: 0,
  ...partial,
})

const none = { club: [], eaOnly: [], recordedModes: [], recordedSixesWithGoalie: [] }

void test('club totals map to families; EA-only fills dekes, fights, breakaways', () => {
  const m = mergeSeasonTotals({
    ...none,
    club: [
      club(1, 7, {
        wins: 1,
        goals: 2,
        assists: 3,
        shots: 4,
        hatTricks: 5,
        hits: 6,
        faceoffWins: 7,
        takeaways: 8,
        blockedShots: 9,
        goalieGamesCompleted: 10,
        goalieWins: 11,
        goalieSaves: 12,
        goalieDesperationSaves: 13,
        goaliePokeChecks: 14,
        goalieShutouts: 15,
      }),
    ],
    eaOnly: [eaOnly(1, 7, { dekesMade: 21, fightsWon: 22, breakaways: 23 })],
  })
  assert.deepEqual(m.get(7)?.get(1), {
    ...emptyBadgeValues(),
    pwins: 1,
    pgoals: 2,
    pasts: 3,
    pshots: 4,
    pht: 5,
    phits: 6,
    pfo: 7,
    ptka: 8,
    pblk: 9,
    gg: 10,
    gw: 11,
    gsv: 12,
    gdsv: 13,
    gpoke: 14,
    gso: 15,
    pdekes: 21,
    pfight: 22,
    pbrk: 23,
  })
})

void test('a player with only an EA-only row gets a card with zero club values', () => {
  const m = mergeSeasonTotals({
    ...none,
    eaOnly: [eaOnly(3, 7, { dekesMade: 4, fightsWon: 1, breakaways: 2 })],
  })
  assert.deepEqual(m.get(7)?.get(3), {
    ...emptyBadgeValues(),
    pdekes: 4,
    pfight: 1,
    pbrk: 2,
  })
})

void test('each title is its own season: nothing adds up across titles', () => {
  const m = mergeSeasonTotals({
    ...none,
    club: [club(1, 27, { goals: 10 }), club(1, 28, { goals: 5 }), club(2, 27, { goals: 3 })],
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
