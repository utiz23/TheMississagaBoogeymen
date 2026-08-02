/**
 * Unit tests for the Action Tracker plot-in schedule. Pure functions, no
 * React/DOM.
 *
 * Run: node --test apps/web/src/lib/plot-schedule.test.ts
 *
 * The first test is the regression gate. Before the fix, `plotDelay` returned
 * `null` for any index >= 24, and rink.tsx renders a null-delay marker with no
 * `gs-marker-drop` class — i.e. at full opacity from the first frame, before
 * the cascade even starts. On match 1093 that was 92 of 116 markers already
 * sitting on the ice. `null` must now mean "the cascade is over" and nothing
 * else.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PLOT_BUDGET_MS,
  PLOT_MAX_STEP_MS,
  PLOT_START_MS,
  PLOT_TOTAL_MS,
  plotDelay,
  plotStep,
} from './plot-schedule.ts'

/** The real plottable-marker counts of the densest matches in the corpus. */
const DENSE_MATCH_COUNTS = [33, 74, 80, 113, 116]

void test('every marker is scheduled, however dense the match', () => {
  for (const count of DENSE_MATCH_COUNTS) {
    const step = plotStep(count)
    for (let i = 0; i < count; i++) {
      const delay = plotDelay(i, false, step)
      assert.notEqual(
        delay,
        null,
        `match with ${String(count)} markers: index ${String(i)} got no drop delay, so it would render ` +
          `with no gs-marker-drop class and be visible on the ice from the first frame`,
      )
    }
  }
})

void test('the last marker still lands inside the budget', () => {
  for (const count of DENSE_MATCH_COUNTS) {
    const step = plotStep(count)
    const last = plotDelay(count - 1, false, step)
    assert.ok(last !== null)
    assert.ok(
      last <= PLOT_START_MS + PLOT_BUDGET_MS,
      `match with ${String(count)} markers: last marker lands at ${String(last)}ms, past the ` +
        `${String(PLOT_START_MS + PLOT_BUDGET_MS)}ms budget — the ~2s guardrail is the reason ` +
        `the cap exists at all`,
    )
  }
})

void test('the whole cascade finishes before plotDone tears the classes off', () => {
  // If the last landing outran PLOT_TOTAL_MS, the timer would strip the drop
  // classes mid-animation and the final markers would snap into place.
  for (const count of DENSE_MATCH_COUNTS) {
    const step = plotStep(count)
    const last = plotDelay(count - 1, false, step)
    assert.ok(last !== null && last < PLOT_TOTAL_MS)
  }
})

void test('sparse matches keep the full uncompressed step', () => {
  // 25 markers is the most that fit at the full step (24 gaps × 95ms = 2280ms).
  assert.equal(plotStep(25), PLOT_MAX_STEP_MS)
  assert.equal(plotStep(10), PLOT_MAX_STEP_MS)
  assert.equal(plotStep(1), PLOT_MAX_STEP_MS)
  assert.equal(plotStep(0), PLOT_MAX_STEP_MS)
})

void test('dense matches compress the step instead of dropping markers', () => {
  assert.ok(plotStep(74) < PLOT_MAX_STEP_MS)
  assert.ok(plotStep(116) < plotStep(74), 'denser match ⇒ tighter ripple')
})

void test('markers land in strictly increasing order', () => {
  const count = 116
  const step = plotStep(count)
  let prev = -1
  for (let i = 0; i < count; i++) {
    const delay = plotDelay(i, false, step)
    assert.ok(delay !== null)
    assert.ok(delay > prev, `index ${String(i)} must land after index ${String(i - 1)}`)
    prev = delay
  }
})

void test('plotDone is the only thing that yields a null delay', () => {
  const step = plotStep(116)
  assert.equal(plotDelay(0, true, step), null)
  assert.equal(plotDelay(115, true, step), null)
  assert.notEqual(plotDelay(115, false, step), null)
})

void test('the first marker lands on the opening beat', () => {
  assert.equal(plotDelay(0, false, plotStep(50)), PLOT_START_MS)
})
