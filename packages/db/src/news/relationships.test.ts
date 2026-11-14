import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EVENT_POINTS,
  REL_LEVELS,
  REL_MAX_POINTS,
  REL_THRESHOLDS,
  clampToRange,
  decayedPoints,
  eventPoints,
  leanOf,
  levelForPress,
  matchesTaste,
  relAtLeast,
  relLevelAt,
  relLevelOf,
  stepFactor,
} from './relationships.js'
import { REPORTERS, REPORTER_IDS } from './reporters.js'

const T0 = new Date('2026-11-14T12:00:00Z')
const after = (days: number) => new Date(T0.getTime() + days * 86_400_000)

void test('points fade toward zero by half every 7 days, on both sides', () => {
  assert.equal(decayedPoints(8, T0, T0), 8)
  assert.ok(Math.abs(decayedPoints(8, T0, after(7)) - 4) < 1e-9)
  assert.ok(Math.abs(decayedPoints(-8, T0, after(7)) + 4) < 1e-9)
  assert.ok(Math.abs(decayedPoints(8, T0, after(14)) - 2) < 1e-9)
  // A clock that runs backwards never raises the points.
  assert.equal(decayedPoints(-8, T0, after(-1)), -8)
})

void test('points never exceed the cap on either side', () => {
  assert.equal(decayedPoints(500, T0, T0), REL_MAX_POINTS)
  assert.equal(decayedPoints(-500, T0, T0), -REL_MAX_POINTS)
})

void test('the signed scale maps to seven levels at the thresholds, both ways', () => {
  assert.deepEqual(
    [...REL_LEVELS],
    ['war', 'feud', 'simmering', 'neutral', 'warm', 'fan', 'glazing'],
  )
  assert.equal(relLevelOf(0), 'neutral')
  assert.equal(relLevelOf(1.99), 'neutral')
  assert.equal(relLevelOf(-1.99), 'neutral')
  assert.equal(relLevelOf(-REL_THRESHOLDS.simmering), 'simmering')
  assert.equal(relLevelOf(-4.99), 'simmering')
  assert.equal(relLevelOf(-REL_THRESHOLDS.feud), 'feud')
  assert.equal(relLevelOf(-9.99), 'feud')
  assert.equal(relLevelOf(-REL_THRESHOLDS.war), 'war')
  assert.equal(relLevelOf(-REL_MAX_POINTS), 'war')
  assert.equal(relLevelOf(REL_THRESHOLDS.warm), 'warm')
  assert.equal(relLevelOf(4.99), 'warm')
  assert.equal(relLevelOf(REL_THRESHOLDS.fan), 'fan')
  assert.equal(relLevelOf(9.99), 'fan')
  assert.equal(relLevelOf(REL_THRESHOLDS.glazing), 'glazing')
  assert.equal(relLevelOf(REL_MAX_POINTS), 'glazing')
})

void test('T5 thresholds are kept on the negative side (-2 / -5 / -10)', () => {
  assert.deepEqual([REL_THRESHOLDS.simmering, REL_THRESHOLDS.feud, REL_THRESHOLDS.war], [2, 5, 10])
  // A stored T5 value (positive 6) becomes -6 in migration 0078: a feud.
  assert.equal(relLevelOf(-6), 'feud')
})

void test('one number: a reporter cannot feud and glaze the same player at once', () => {
  // Glazed (+10), then three strong insults (-6) land on the same number.
  const total = 10 + 3 * EVENT_POINTS.insultStrong
  assert.equal(relLevelOf(total), 'warm')
  assert.ok(relAtLeast('glazing', 'warm'))
  assert.ok(!relAtLeast('feud', 'neutral'))
})

void test('a feud cools off, a glaze cools off: war a week later is a feud, two weeks a simmer', () => {
  const war = { points: -10, lastEventAt: T0 }
  // Barlow: disposition 0, no lean, range feud..fan: use Mercer (floor war) for the full ladder.
  assert.equal(relLevelAt(war, 'pettibone', T0), 'war')
  assert.equal(relLevelAt({ points: -12, lastEventAt: T0 }, 'pettibone', after(7)), 'feud')
  const glaze = { points: 10, lastEventAt: T0 }
  assert.equal(relLevelAt(glaze, 'vale', T0), 'glazing')
  assert.equal(relLevelAt(glaze, 'vale', after(7)), 'fan')
  assert.equal(relLevelAt(glaze, 'vale', after(35)), 'neutral')
})

void test('dispositions scale the steps and give a lean', () => {
  assert.equal(stepFactor('up', 2), 1.5)
  assert.equal(stepFactor('up', -2), 0.5)
  assert.equal(stepFactor('down', 2), 0.5)
  assert.equal(stepFactor('down', -2), 1.5)
  assert.equal(stepFactor('up', 0), 1)
  assert.equal(leanOf(2), 1)
  assert.equal(leanOf(-2), -1)
  // Vale (+2) takes a thank-you as 1.5, Pettibone (-2) as 0.5.
  assert.equal(eventPoints('vale', 'praiseNice'), 1.5)
  assert.equal(eventPoints('pettibone', 'praiseNice'), 0.5)
  // And the reverse for an insult.
  assert.equal(eventPoints('vale', 'insultMild'), -0.5)
  assert.equal(eventPoints('pettibone', 'insultMild'), -1.5)
  assert.equal(eventPoints('barlow', 'insultStrong'), -2)
})

void test('a homer glazes easily and a critic almost never', () => {
  // One compliment (nice) plus the lean: Vale is warm at once, Pettibone is not.
  const vale = { points: eventPoints('vale', 'praiseNice'), lastEventAt: T0 }
  const gord = { points: eventPoints('pettibone', 'praiseNice'), lastEventAt: T0 }
  assert.equal(relLevelAt(vale, 'vale', T0), 'warm')
  assert.equal(relLevelAt(gord, 'pettibone', T0), 'neutral')
  // Three glowing compliments: Vale glazing-capable (7.5 = fan at most from points, range allows glazing).
  const gush = { points: 4 * eventPoints('vale', 'praiseGlowing'), lastEventAt: T0 }
  assert.equal(relLevelAt(gush, 'vale', T0), 'glazing')
  // Pettibone has a ceiling: he cannot get past warm, whatever the points.
  assert.equal(relLevelAt({ points: 12, lastEventAt: T0 }, 'pettibone', T0), 'warm')
})

void test('Father Rink never goes below neutral (hard rule)', () => {
  assert.equal(REPORTERS.rink.range.floor, 'neutral')
  // No negative event is worth anything for Rink.
  assert.equal(eventPoints('rink', 'insultMild'), 0)
  assert.equal(eventPoints('rink', 'insultStrong'), 0)
  // Even a stored negative row (T5 data mapped to the negative side) reads neutral.
  for (const points of [-1, -2, -5, -10, -12]) {
    assert.equal(relLevelAt({ points, lastEventAt: T0 }, 'rink', T0), 'neutral', `points ${points}`)
    assert.equal(relLevelAt({ points, lastEventAt: T0 }, 'rink', after(3)), 'neutral')
  }
  // He can be favourable.
  assert.equal(relLevelAt({ points: 11, lastEventAt: T0 }, 'rink', T0), 'glazing')
  assert.ok(eventPoints('rink', 'praiseNice') > 0)
})

void test('every reporter range is a real range, only Rink has a neutral floor', () => {
  for (const id of REPORTER_IDS) {
    const r = REPORTERS[id]
    assert.ok(relAtLeast(r.range.ceiling, r.range.floor), id)
    assert.ok([-2, -1, 0, 1, 2].includes(r.disposition), id)
    assert.ok(r.taste.length > 0, id)
    if (id === 'rink') continue
    assert.ok(!relAtLeast(r.range.floor, 'neutral'), `${id} can feud`)
  }
  // Pettibone and Mercer reach open war, Vale glazing.
  assert.equal(REPORTERS.pettibone.range.floor, 'war')
  assert.equal(REPORTERS.mercer.range.floor, 'war')
  assert.equal(REPORTERS.vale.range.ceiling, 'glazing')
})

void test('a step outside the range is not stored', () => {
  assert.equal(eventPoints('quill', 'praiseNice') > 0, true)
  // A reporter whose ceiling is neutral would take no positive step: none of the nine today, so pin the clamp.
  assert.equal(clampToRange('glazing', { floor: 'war', ceiling: 'warm' }), 'warm')
  assert.equal(clampToRange('war', { floor: 'feud', ceiling: 'fan' }), 'feud')
  assert.equal(clampToRange('neutral', { floor: 'neutral', ceiling: 'glazing' }), 'neutral')
})

void test('Go easy never gets the feud side, the favour side stays', () => {
  assert.equal(levelForPress('war', 'easy'), 'neutral')
  assert.equal(levelForPress('feud', 'easy'), 'neutral')
  assert.equal(levelForPress('simmering', 'easy'), 'neutral')
  assert.equal(levelForPress('glazing', 'easy'), 'glazing')
  assert.equal(levelForPress('warm', 'easy'), 'warm')
  assert.equal(levelForPress('feud', 'full'), 'feud')
})

void test('taste: a big night in the reporter taste is a hit, a quiet one is not', () => {
  const quiet = { goals: 1, assists: 0, points: 1, shots: 3, hits: 2, saves: null }
  assert.equal(matchesTaste('vale', quiet), false)
  assert.equal(matchesTaste('vale', { ...quiet, goals: 3, points: 3 }), true)
  assert.equal(matchesTaste('bergstrom', { ...quiet, shots: 9 }), true)
  assert.equal(matchesTaste('bergstrom', { ...quiet, goals: 3, points: 3 }), false)
  // Null stats (a game that ended early) never match.
  assert.equal(matchesTaste('bergstrom', { ...quiet, shots: null, hits: null }), false)
  assert.equal(matchesTaste('rink', { ...quiet, saves: 31 }), true)
})
