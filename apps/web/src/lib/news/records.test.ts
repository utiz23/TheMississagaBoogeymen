import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsGameFacts, NewsPlayerLine } from '@eanhl/db/news'
import { applyNewRecords, buildRecords, publicRecords, type SeasonLineInput } from './records.ts'

const sl = (
  over: Partial<SeasonLineInput> & Pick<SeasonLineInput, 'playerId'>,
): SeasonLineInput => ({
  title: 'NHL 24',
  releaseOrder: 24,
  current: false,
  goals: 0,
  assists: 0,
  points: 0,
  ...over,
})
const names = new Map([
  [1, { name: 'Old Sniper', pressLevel: 'easy' as const }],
  [2, { name: 'Skater A', pressLevel: 'full' as const }],
])
const nameOf = (id: number) => names.get(id) ?? null

void test('buildRecords: the best season per stat; later titles left out; ties to the first set; unnameable holder null', () => {
  const r = buildRecords(
    [
      sl({ playerId: 1, goals: 40, assists: 30, points: 70 }),
      sl({ playerId: 3, title: 'NHL 25', releaseOrder: 25, goals: 40, assists: 45, points: 85 }),
      // NHL 27 is after the current NHL 26: not seen.
      sl({ playerId: 2, title: 'NHL 27', releaseOrder: 27, goals: 90, assists: 90, points: 180 }),
      sl({
        playerId: 2,
        title: 'NHL 26',
        releaseOrder: 26,
        current: true,
        goals: 12,
        assists: 50,
        points: 62,
      }),
    ],
    26,
    nameOf,
  )
  assert.deepEqual(publicRecords(r), [
    { stat: 'goals', holder: 'Old Sniper', holderPressLevel: 'easy', value: 40, title: 'NHL 24' },
    { stat: 'assists', holder: 'Skater A', holderPressLevel: 'full', value: 50, title: 'NHL 26' },
    { stat: 'points', holder: null, holderPressLevel: null, value: 85, title: 'NHL 25' },
  ])
  assert.equal(r[1]!.current, true)
  // No positive season: no record.
  assert.deepEqual(buildRecords([sl({ playerId: 1 })], 26, nameOf), [])
})

const line = (
  playerId: number,
  name: string,
  goals: number,
  assists: number,
  totals: [number, number],
): NewsPlayerLine =>
  ({
    playerId,
    name,
    goals,
    assists,
    points: goals + assists,
    seasonTotals: {
      goals: totals[0],
      assists: totals[1],
      points: totals[0] + totals[1],
      games: 30,
    },
  }) as NewsPlayerLine
const game = (players: NewsPlayerLine[]) =>
  ({ players, newRecords: [] }) as unknown as NewsGameFacts

void test('applyNewRecords: the game that passes the record; not his own record of this title; a record set on the sheet moves the bar', () => {
  const records = buildRecords(
    [sl({ playerId: 1, goals: 40, assists: 30, points: 70 })],
    26,
    nameOf,
  )
  const out = applyNewRecords(
    [
      // 39 -> 41 goals: a new record; 69 -> 71 points: a new record.
      game([line(2, 'Skater A', 2, 0, [41, 30])]),
      // Skater A again: his own record of this title now; no new one.
      game([line(2, 'Skater A', 1, 0, [42, 30]), line(5, 'Skater B', 1, 0, [41, 0])]),
      // Skater B passes Skater A's 42.
      game([line(5, 'Skater B', 2, 0, [43, 0])]),
    ],
    records,
    'NHL 26',
  )
  assert.deepEqual(out[0]!.newRecords, [
    { stat: 'goals', name: 'Skater A', value: 41 },
    { stat: 'points', name: 'Skater A', value: 71 },
  ])
  assert.deepEqual(out[1]!.newRecords, [])
  assert.deepEqual(out[2]!.newRecords, [{ stat: 'goals', name: 'Skater B', value: 43 }])
  // Already above before this game (his own record of this title): nothing.
  const own = buildRecords(
    [sl({ playerId: 2, current: true, title: 'NHL 26', goals: 45 })],
    26,
    nameOf,
  )
  assert.deepEqual(
    applyNewRecords([game([line(2, 'Skater A', 1, 0, [46, 0])])], own, 'NHL 26')[0]!.newRecords,
    [],
  )
  // Equal is not past; a line without totals is skipped.
  assert.deepEqual(
    applyNewRecords([game([line(2, 'Skater A', 1, 0, [40, 0])])], records, 'NHL 26')[0]!.newRecords,
    [],
  )
  const noTotals = { ...line(2, 'Skater A', 5, 0, [50, 0]), seasonTotals: null }
  assert.deepEqual(applyNewRecords([game([noTotals])], records, 'NHL 26')[0]!.newRecords, [])
})
