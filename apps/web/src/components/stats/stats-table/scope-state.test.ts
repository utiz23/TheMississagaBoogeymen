import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveScopeAvailability, resolveScopeState } from './scope-state.ts'

// ─── resolveScopeAvailability ────────────────────────────────────────────────

void test('resolveScopeAvailability: no All Time rows => cannot switch, stays Current', () => {
  assert.deepEqual(resolveScopeAvailability('current', 0), {
    canAllTime: false,
    activeScope: 'current',
  })
  assert.deepEqual(resolveScopeAvailability('allTime', 0), {
    canAllTime: false,
    activeScope: 'current',
  })
})

void test('resolveScopeAvailability: All Time has rows => can switch, honors the request', () => {
  assert.deepEqual(resolveScopeAvailability('current', 5), {
    canAllTime: true,
    activeScope: 'current',
  })
  assert.deepEqual(resolveScopeAvailability('allTime', 5), {
    canAllTime: true,
    activeScope: 'allTime',
  })
})

// ─── resolveScopeState ────────────────────────────────────────────────────────

void test('resolveScopeState: Current scope passes the Current state through unchanged', () => {
  assert.equal(resolveScopeState('current', 'ok'), 'ok')
  assert.equal(resolveScopeState('current', 'error'), 'error')
})

void test('resolveScopeState: All Time scope is always ok, regardless of the Current state', () => {
  assert.equal(resolveScopeState('allTime', 'error'), 'ok')
  assert.equal(resolveScopeState('allTime', 'ok'), 'ok')
})

// ─── The exact failure matrix from the correction ───────────────────────────

void test('Current failure + All Time success: Current scope is error; All Time scope is usable', () => {
  const allTimeRowCount = 5 // a genuine successful, non-empty All Time result
  const currentState: 'ok' | 'error' = 'error'

  const onCurrent = resolveScopeAvailability('current', allTimeRowCount)
  assert.equal(onCurrent.activeScope, 'current')
  assert.equal(resolveScopeState(onCurrent.activeScope, currentState), 'error')

  const onAllTime = resolveScopeAvailability('allTime', allTimeRowCount)
  assert.equal(onAllTime.canAllTime, true)
  assert.equal(onAllTime.activeScope, 'allTime')
  assert.equal(resolveScopeState(onAllTime.activeScope, currentState), 'ok')

  // …and back to Current restores the error.
  const backToCurrent = resolveScopeAvailability('current', allTimeRowCount)
  assert.equal(resolveScopeState(backToCurrent.activeScope, currentState), 'error')
})

void test('Current success + All Time failure: Current remains usable; All Time stays unavailable', () => {
  const allTimeRowCount = 0 // a failed All Time query always settles to 0 rows
  const currentState: 'ok' | 'error' = 'ok'

  const onCurrent = resolveScopeAvailability('current', allTimeRowCount)
  assert.equal(onCurrent.canAllTime, false)
  assert.equal(resolveScopeState(onCurrent.activeScope, currentState), 'ok')

  // Requesting All Time cannot force it open with no data — collapses to Current.
  const attemptAllTime = resolveScopeAvailability('allTime', allTimeRowCount)
  assert.equal(attemptAllTime.canAllTime, false)
  assert.equal(attemptAllTime.activeScope, 'current')
  assert.equal(resolveScopeState(attemptAllTime.activeScope, currentState), 'ok')
})

void test('Both Current and All Time failed: Current shows its error; All Time stays unavailable', () => {
  const allTimeRowCount = 0
  const currentState: 'ok' | 'error' = 'error'

  const availability = resolveScopeAvailability('allTime', allTimeRowCount)
  assert.equal(availability.canAllTime, false)
  assert.equal(availability.activeScope, 'current')
  assert.equal(resolveScopeState(availability.activeScope, currentState), 'error')
})
