import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FEUD_MAX_POINTS,
  FEUD_THRESHOLDS,
  INSULT_POINTS,
  decayedPoints,
  feudAtLeast,
  feudLevelAt,
  feudLevelOf,
} from './feuds.js'

const T0 = new Date('2026-11-13T12:00:00Z')
const after = (days: number) => new Date(T0.getTime() + days * 86_400_000)

void test('points fade by half every 7 days', () => {
  assert.equal(decayedPoints(8, T0, T0), 8)
  assert.ok(Math.abs(decayedPoints(8, T0, after(7)) - 4) < 1e-9)
  assert.ok(Math.abs(decayedPoints(8, T0, after(14)) - 2) < 1e-9)
  // A clock that runs backwards never raises the points.
  assert.equal(decayedPoints(8, T0, after(-1)), 8)
})

void test('points never exceed the cap', () => {
  assert.equal(decayedPoints(500, T0, T0), FEUD_MAX_POINTS)
})

void test('points map to the four levels at the thresholds', () => {
  assert.equal(feudLevelOf(0), 'none')
  assert.equal(feudLevelOf(1.99), 'none')
  assert.equal(feudLevelOf(FEUD_THRESHOLDS.simmering), 'simmering')
  assert.equal(feudLevelOf(4.99), 'simmering')
  assert.equal(feudLevelOf(FEUD_THRESHOLDS.feud), 'feud')
  assert.equal(feudLevelOf(9.99), 'feud')
  assert.equal(feudLevelOf(FEUD_THRESHOLDS.war), 'war')
  assert.equal(feudLevelOf(FEUD_MAX_POINTS), 'war')
})

void test('insult points: one strong insult is a simmer, three are a feud', () => {
  assert.equal(feudLevelOf(INSULT_POINTS.mild), 'none')
  assert.equal(feudLevelOf(INSULT_POINTS.strong), 'simmering')
  assert.equal(feudLevelOf(3 * INSULT_POINTS.strong), 'feud')
})

void test('a feud cools off: war after a week is a feud, after two weeks a simmer', () => {
  const row = { points: 10, lastEventAt: T0 }
  assert.equal(feudLevelAt(row, T0), 'war')
  assert.equal(feudLevelAt(row, after(7)), 'feud')
  assert.equal(feudLevelAt(row, after(14)), 'simmering')
  assert.equal(feudLevelAt(row, after(35)), 'none')
})

void test('feudAtLeast compares the order of the levels', () => {
  assert.equal(feudAtLeast('war', 'feud'), true)
  assert.equal(feudAtLeast('feud', 'feud'), true)
  assert.equal(feudAtLeast('simmering', 'feud'), false)
  assert.equal(feudAtLeast('none', 'simmering'), false)
})
