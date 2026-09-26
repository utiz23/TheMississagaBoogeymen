import test from 'node:test'
import assert from 'node:assert/strict'
import { compareNullsLast, nextSort, sortRows } from './sort.ts'

void test('nulls and non-finite values stay last in both directions', () => {
  const rows = [
    { n: 'a', v: null },
    { n: 'b', v: 3 },
    { n: 'c', v: Number.POSITIVE_INFINITY },
    { n: 'd', v: 1 },
    { n: 'e', v: Number.NaN },
  ]
  const get = (r: { v: number | null }) => r.v
  const name = (r: { n: string }) => r.n
  assert.deepEqual(
    sortRows(rows, get, name, false).map((r) => r.n),
    ['b', 'd', 'a', 'c', 'e'],
  )
  assert.deepEqual(
    sortRows(rows, get, name, true).map((r) => r.n),
    ['d', 'b', 'a', 'c', 'e'],
  )
})

void test('ties fall back to name; input is not mutated', () => {
  const rows = [
    { n: 'zed', v: 2 },
    { n: 'amy', v: 2 },
  ]
  const out = sortRows(
    rows,
    (r) => r.v,
    (r) => r.n,
    false,
  )
  assert.deepEqual(
    out.map((r) => r.n),
    ['amy', 'zed'],
  )
  assert.equal(rows[0]?.n, 'zed')
})

void test('compareNullsLast returns 0 for two unavailable values', () => {
  assert.equal(compareNullsLast(null, Number.NaN, true), 0)
})

void test('nextSort: same column flips, new column starts at its default', () => {
  assert.deepEqual(nextSort('pts', false, 'pts'), { key: 'pts', asc: true })
  assert.deepEqual(nextSort('pts', true, 'pts'), { key: 'pts', asc: false })
  assert.deepEqual(nextSort('pts', false, 'g'), { key: 'g', asc: null })
})
