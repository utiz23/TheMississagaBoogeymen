import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePosition,
  periodKey,
  resolvePeriodDirections,
  type PeriodShotSides,
  type RecordedDirection,
} from './directions.js'

const rec = (periodNumber: number, direction: string | null, matchId = 250): RecordedDirection => ({
  matchId,
  periodNumber,
  direction,
})
const shots = (
  periodNumber: number,
  total: number,
  right: number,
  matchId = 250,
): PeriodShotSides => ({
  matchId,
  periodNumber,
  total,
  right,
})

void test('match 250: recorded P2–P4 resolve; P1 (no BGM shots) stays unknown', () => {
  const d = resolvePeriodDirections(
    [rec(2, 'right'), rec(3, 'left'), rec(4, 'right'), rec(1, null)],
    [shots(2, 9, 9), shots(3, 6, 0), shots(4, 9, 9)],
  )
  assert.equal(d.get(periodKey(250, 2)), 'right')
  assert.equal(d.get(periodKey(250, 3)), 'left')
  assert.equal(d.get(periodKey(250, 4)), 'right')
  assert.equal(d.has(periodKey(250, 1)), false)
})

void test('shot side: at least 3 shots and 80% on one side, else unknown', () => {
  const d = resolvePeriodDirections(
    [],
    [shots(1, 5, 4, 1), shots(2, 5, 1, 1), shots(3, 5, 3, 1), shots(1, 2, 2, 2)],
  )
  assert.equal(d.get(periodKey(1, 1)), 'right')
  assert.equal(d.get(periodKey(1, 2)), 'left')
  assert.equal(d.has(periodKey(1, 3)), false)
  assert.equal(d.has(periodKey(2, 1)), false)
})

void test('a recorded direction beats the shot side', () => {
  const d = resolvePeriodDirections([rec(1, 'left', 7)], [shots(1, 9, 9, 7)])
  assert.equal(d.get(periodKey(7, 1)), 'left')
})

void test('conflicting recorded directions make the period unknown; junk values are ignored', () => {
  const d = resolvePeriodDirections(
    [rec(1, 'left', 8), rec(1, 'right', 8), rec(2, 'sideways', 8)],
    [shots(1, 9, 9, 8)],
  )
  assert.equal(d.has(periodKey(8, 1)), false)
  assert.equal(d.has(periodKey(8, 2)), false)
})

void test('left periods rotate 180°, right periods are unchanged', () => {
  assert.deepEqual(normalizePosition(30, -10, 'left'), { x: -30, y: 10 })
  assert.deepEqual(normalizePosition(30, -10, 'right'), { x: 30, y: -10 })
})
