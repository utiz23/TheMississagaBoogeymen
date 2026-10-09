/**
 * Shared display formatters.
 *
 * Run: node --test apps/web/src/lib/format.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatDataDay,
  formatDuration,
  formatMatchDate,
  formatMatchTime,
  formatSavePct,
  headingName,
} from './format.ts'

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

void test('headingName shortens long multi-word names to initial + last name', () => {
  assert.equal(headingName('Matteo Lehmann'), 'M. Lehmann')
  assert.equal(headingName('DaQuarius McBum'), 'D. McBum')
  assert.equal(headingName('Jonas Wagner'), 'Jonas Wagner') // 12 characters: fits
  assert.equal(headingName('Igor Orlov'), 'Igor Orlov')
  assert.equal(headingName('HenryTheBobJr'), 'HenryTheBobJr') // one word: a gamertag
})

void test('formatSavePct: hockey style, a perfect game reads 1.000', () => {
  assert.equal(formatSavePct('92.30'), '.923')
  assert.equal(formatSavePct('100.00'), '1.000')
  assert.equal(formatSavePct('0'), '.000')
  assert.equal(formatSavePct(null), '—')
  assert.equal(formatSavePct('x'), '—')
})

void test('formatDataDay: the club-zone calendar day, the same on server and browser', () => {
  // 03:30 UTC on Oct 9 is still Oct 8 evening in Edmonton (MDT, UTC−6).
  assert.equal(formatDataDay(new Date('2026-10-09T03:30:00Z')), '2026-10-08')
  assert.equal(formatDataDay('2026-10-09T18:00:00Z'), '2026-10-09')
  assert.equal(formatDataDay(undefined), '—')
  assert.equal(formatDataDay(null), '—')
  assert.equal(formatDataDay('not a date'), '—')
})

void test('match date and time read in the club zone, whatever the server zone is', () => {
  // 03:30 UTC Oct 9 = 9:30 PM Oct 8 in Edmonton (MDT). The live server runs UTC.
  const end = new Date('2026-10-09T03:30:00Z')
  assert.equal(formatMatchTime(end), '9:30 PM')
  assert.match(formatMatchDate(end), /^Oct 8/)
})
