import test from 'node:test'
import assert from 'node:assert/strict'
import { maskPlayerWideGoalieRecord } from '../goalie-record-mask.js'

void test('masks player-wide W/L/OTL and flags the row, leaving other fields intact', () => {
  const input = [
    {
      playerId: 5,
      gamertag: 'JoeyFlopfish',
      gamesPlayed: 2,
      wins: 77,
      losses: 18,
      otl: 5,
      savePct: '81.82',
    },
  ]
  const row = maskPlayerWideGoalieRecord(input)[0]
  assert.ok(row)
  assert.equal(row.wins, null)
  assert.equal(row.losses, null)
  assert.equal(row.otl, null)
  assert.equal(row.recordUnavailable, true)
  assert.equal(row.gamesPlayed, 2)
  assert.equal(row.savePct, '81.82')
})

void test('does not mutate the input rows', () => {
  const input = [{ wins: 3, losses: 1, otl: 0 }]
  maskPlayerWideGoalieRecord(input)
  assert.deepEqual(input, [{ wins: 3, losses: 1, otl: 0 }])
})

void test('empty input yields empty output', () => {
  assert.deepEqual(maskPlayerWideGoalieRecord([]), [])
})
