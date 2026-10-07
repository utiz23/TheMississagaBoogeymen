import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCareerTotals, type EaTitleTotals, type HistoryTitleTotals } from './career-totals.js'
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
  dekes: 0,
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

const hist = (
  playerId: number,
  gameTitleId: number,
  partial: Partial<HistoryTitleTotals> = {},
): HistoryTitleTotals => ({
  playerId,
  gameTitleId,
  gameMode: '6s',
  gamesPlayed: 0,
  wins: 0,
  goals: 0,
  assists: 0,
  shots: 0,
  hits: 0,
  takeaways: 0,
  blockedShots: 0,
  saves: 0,
  shutouts: 0,
  ...partial,
})

const none = { ea: [], history: [], recordedModes: [], recordedSixesWithGoalie: [] }

void test('EA columns map to their families; wins count skater + goalie wins', () => {
  const m = mergeCareerTotals({
    ...none,
    ea: [
      ea(1, 26, {
        skaterWins: 10,
        goalieWins: 2,
        goals: 3,
        assists: 4,
        shots: 5,
        dekes: 6,
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
  assert.deepEqual(m.get(1), {
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

void test('titles add up across EA and history; only 6s history games count toward 6v6', () => {
  const m = mergeCareerTotals({
    ...none,
    ea: [ea(1, 26, { goals: 10 }), ea(1, 27, { goals: 5 })],
    history: [
      hist(1, 25, { gameMode: '6s', gamesPlayed: 40, goals: 20, saves: 7, shutouts: 1 }),
      hist(1, 24, { gameMode: '3s', gamesPlayed: 9, goals: 2 }),
    ],
  })
  const v = m.get(1)
  assert.ok(v)
  assert.equal(v.pgoals, 37)
  assert.equal(v.p6v6, 40)
  assert.equal(v.p3v3, 0)
  assert.equal(v.gsv, 7)
  assert.equal(v.gso, 1)
})

void test('one source per title: history for a title EA already covers is ignored', () => {
  const m = mergeCareerTotals({
    ...none,
    ea: [ea(1, 26, { goals: 100 })],
    history: [hist(1, 26, { goals: 999, gamesPlayed: 50 }), hist(2, 26, { goals: 8 })],
  })
  assert.equal(m.get(1)?.pgoals, 100)
  assert.equal(m.get(1)?.p6v6, 0)
  assert.equal(m.get(2)?.pgoals, 8)
})

void test('site-recorded mode games and 6s-with-goalie games', () => {
  const m = mergeCareerTotals({
    ...none,
    history: [hist(1, 25, { gameMode: '6s', gamesPlayed: 100 })],
    recordedModes: [
      { playerId: 1, gameMode: '3s', gamesPlayed: 12 },
      { playerId: 1, gameMode: '6s', gamesPlayed: 30 },
    ],
    recordedSixesWithGoalie: [{ playerId: 1, games: 9 }],
  })
  const v = m.get(1)
  assert.ok(v)
  assert.equal(v.p3v3, 12)
  assert.equal(v.p6v6, 130)
  assert.equal(v.p6g, 9)
})

void test('a player seen only in recorded games gets a full zeroed record', () => {
  const m = mergeCareerTotals({ ...none, recordedSixesWithGoalie: [{ playerId: 7, games: 1 }] })
  assert.deepEqual(m.get(7), { ...emptyBadgeValues(), p6g: 1 })
})
