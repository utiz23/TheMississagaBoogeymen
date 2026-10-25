import test from 'node:test'
import assert from 'node:assert/strict'
import { nightKey, nightLabel, nightsOfWeek, previousWeekStarts, weekStart } from './keys.js'

void test('nightKey: late evening MDT belongs to that calendar day', () => {
  assert.equal(nightKey(new Date('2026-10-13T05:30:00Z')), '2026-10-12') // 23:30 MDT
  assert.equal(nightKey(new Date('2026-10-12T23:28:49Z')), '2026-10-12') // 17:28 MDT
})

void test('nightKey: small hours before 06:00 local belong to the previous night', () => {
  assert.equal(nightKey(new Date('2026-10-13T07:30:00Z')), '2026-10-12') // 01:30 MDT
  assert.equal(nightKey(new Date('2026-10-13T11:59:00Z')), '2026-10-12') // 05:59 MDT
  assert.equal(nightKey(new Date('2026-10-13T12:30:00Z')), '2026-10-13') // 06:30 MDT
})

void test('nightKey: across the DST change (2026-11-01) uses the local offset', () => {
  assert.equal(nightKey(new Date('2026-11-10T06:30:00Z')), '2026-11-09') // 23:30 MST
  assert.equal(nightKey(new Date('2026-11-10T12:30:00Z')), '2026-11-09') // 05:30 MST
  assert.equal(nightKey(new Date('2026-11-10T13:30:00Z')), '2026-11-10') // 06:30 MST
  assert.equal(nightKey(new Date('2026-11-01T11:30:00Z')), '2026-10-31') // 04:30 MST after fall back
  // Wall clock minus 6 h, as the SQL does: 05:30 MST on the change day is still the Oct 31 night.
  assert.equal(nightKey(new Date('2026-11-01T12:30:00Z')), '2026-10-31')
})

void test('weekStart: the Monday of the night’s week', () => {
  assert.equal(weekStart('2026-10-12'), '2026-10-12') // Monday
  assert.equal(weekStart('2026-10-18'), '2026-10-12') // Sunday
  assert.equal(weekStart('2026-10-14'), '2026-10-12')
  assert.equal(weekStart('2026-11-01'), '2026-10-26') // across the DST date and month end
  assert.equal(weekStart('2027-01-01'), '2026-12-28') // across the year end
})

void test('nightsOfWeek: seven consecutive nights from the Monday', () => {
  assert.deepEqual(nightsOfWeek('2026-10-12'), [
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
  ])
  const w = nightsOfWeek('2026-10-26')
  assert.equal(w.length, 7)
  assert.equal(w[6], '2026-11-01')
  assert.equal(nightsOfWeek('2026-12-28')[6], '2027-01-03')
})

void test('nightLabel: weekday, month and day of the night key, no year and no ISO date', () => {
  assert.equal(nightLabel('2026-10-12'), 'Monday, October 12')
  assert.equal(nightLabel('2026-10-18'), 'Sunday, October 18')
  assert.equal(nightLabel('2026-11-01'), 'Sunday, November 1') // DST change day
  assert.equal(nightLabel('2027-01-01'), 'Friday, January 1')
  assert.throws(() => nightLabel('2026-13-01'))
})

void test('previousWeekStarts: the Mondays before a week, oldest first (A4)', () => {
  assert.deepEqual(previousWeekStarts('2026-10-19', 4), [
    '2026-09-21',
    '2026-09-28',
    '2026-10-05',
    '2026-10-12',
  ])
  // Across the DST date and the year end.
  assert.deepEqual(previousWeekStarts('2027-01-04', 2), ['2026-12-21', '2026-12-28'])
  assert.deepEqual(previousWeekStarts('2026-11-02', 1), ['2026-10-26'])
  assert.deepEqual(previousWeekStarts('2026-10-19', 0), [])
  assert.throws(() => previousWeekStarts('2026-10-20', 4), /Monday/)
})
