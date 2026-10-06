/**
 * Shared display formatters.
 *
 * Run: node --test apps/web/src/lib/format.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDuration } from './format.ts'

const MIN = 60
const HOUR = 60 * MIN
const DAY = 24 * HOUR

void test('formatDuration rolls hours over into days', () => {
  // 17d 22h 47m — a season TOI total that used to render as "430h 47m".
  assert.equal(formatDuration(17 * DAY + 22 * HOUR + 47 * MIN), '17d 22h 47m')
})

void test('formatDuration keeps zero middle units once a larger unit is shown', () => {
  assert.equal(formatDuration(2 * DAY + 5 * MIN), '2d 0h 5m')
  assert.equal(formatDuration(3 * HOUR), '3h 0m')
})

void test('formatDuration drops leading zero units', () => {
  assert.equal(formatDuration(5 * HOUR + 12 * MIN), '5h 12m')
  assert.equal(formatDuration(42 * MIN), '42m')
})

void test('formatDuration floors partial minutes', () => {
  assert.equal(formatDuration(HOUR + 59), '1h 0m')
  assert.equal(formatDuration(59), '0m')
})

void test('formatDuration renders a dash for no time or bad input', () => {
  assert.equal(formatDuration(0), '—')
  assert.equal(formatDuration(-30), '—')
  assert.equal(formatDuration(null), '—')
  assert.equal(formatDuration(Number.NaN), '—')
})
