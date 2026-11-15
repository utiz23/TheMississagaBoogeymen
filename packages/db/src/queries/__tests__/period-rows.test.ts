import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dropUnverifiedEngineRows,
  periodGoalsMatchFinal,
  preferOtherSourceRows,
} from '../period-rows.js'

const eng = (periodNumber: number, goalsFor: number | null, goalsAgainst: number | null) => ({
  source: 'engine_video',
  periodNumber,
  goalsFor,
  goalsAgainst,
})

void test('period goals must sum to EA final on both sides', () => {
  assert.equal(periodGoalsMatchFinal([eng(1, 2, 1), eng(2, 1, 1), eng(3, 2, 1)], 5, 3), true)
  assert.equal(periodGoalsMatchFinal([eng(1, 2, 1), eng(2, 1, 1), eng(3, 2, 1)], 5, 4), false)
  assert.equal(periodGoalsMatchFinal([eng(1, 2, 1), eng(2, 1, 1), eng(3, 2, 1)], 4, 3), false)
})

void test('an empty list or a masked (null) goal never matches', () => {
  assert.equal(periodGoalsMatchFinal([], 0, 0), false)
  assert.equal(periodGoalsMatchFinal([eng(1, null, null), eng(2, 1, 0)], 1, 0), false)
})

void test('a 0-0 period is a real value, not a missing one', () => {
  assert.equal(periodGoalsMatchFinal([eng(1, 0, 0), eng(2, 1, 0), eng(3, 0, 0)], 1, 0), true)
})

void test('overtime periods count toward the sum', () => {
  const rows = [eng(1, 1, 1), eng(2, 0, 0), eng(3, 1, 1), eng(4, 1, 0)]
  assert.equal(periodGoalsMatchFinal(rows, 3, 2), true)
})

void test('other sources keep winning over engine rows', () => {
  const ocr = { source: 'ocr', periodNumber: 1, goalsFor: 1, goalsAgainst: 0 }
  assert.deepEqual(preferOtherSourceRows([eng(1, 1, 0), ocr]), [ocr])
  const only = [eng(1, 1, 0)]
  assert.deepEqual(preferOtherSourceRows(only), only)
})

void test('engine rows that do not add up to the final are dropped, others stay', () => {
  const ocr = { source: 'ocr', periodNumber: 1, goalsFor: 9, goalsAgainst: 9 }
  const rows = [eng(1, 1, 0), eng(2, 0, 0), ocr]
  assert.deepEqual(dropUnverifiedEngineRows(rows, 2, 0), [ocr])
  assert.deepEqual(dropUnverifiedEngineRows(rows, 1, 0), rows)
  assert.deepEqual(dropUnverifiedEngineRows([ocr], 1, 1), [ocr])
})
