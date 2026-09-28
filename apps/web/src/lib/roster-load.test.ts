import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveRosterSections, loadRosterData, settle, type Loaded } from './roster-load.ts'

const silent = (): void => undefined
const ok = <T>(data: T): Loaded<T> => ({ status: 'ok', data })
const err: Loaded<never> = { status: 'error' }

void test('settle converts rejections and synchronous throws into an error result', async () => {
  assert.deepEqual(await settle('x', () => Promise.reject(new Error('boom')), silent), {
    status: 'error',
  })
  assert.deepEqual(
    await settle(
      'x',
      () => {
        throw new Error('sync')
      },
      silent,
    ),
    { status: 'error' },
  )
  assert.deepEqual(await settle('x', () => Promise.resolve(5), silent), { status: 'ok', data: 5 })
})

void test('settle logs the failing query by name', async () => {
  const seen: string[] = []
  await settle(
    'getEARoster',
    () => Promise.reject(new Error('x')),
    (label) => seen.push(label),
  )
  assert.deepEqual(seen, ['getEARoster'])
})

void test('all four queries ok: everything ready, nothing empty', () => {
  const s = deriveRosterSections({
    roster: ok([1]),
    eligibility: ok([1]),
    skaters: ok([1]),
    goalies: ok([1]),
  })
  assert.deepEqual(s, {
    pageEmpty: false,
    summary: 'ready',
    depthChart: 'ready',
    skaters: { state: 'ok', empty: false },
    goalies: { state: 'ok', empty: false },
  })
})

void test('roster failure: summary + depth chart unavailable, NOT an empty roster; tables unaffected', () => {
  const s = deriveRosterSections({
    roster: err,
    eligibility: ok([1]),
    skaters: ok([1]),
    goalies: ok([1]),
  })
  assert.equal(s.pageEmpty, false)
  assert.equal(s.summary, 'unavailable')
  assert.equal(s.depthChart, 'unavailable')
  assert.deepEqual(s.skaters, { state: 'ok', empty: false })
  assert.deepEqual(s.goalies, { state: 'ok', empty: false })
})

void test('eligibility failure: only the depth chart is unavailable', () => {
  const s = deriveRosterSections({
    roster: ok([1]),
    eligibility: err,
    skaters: ok([1]),
    goalies: ok([1]),
  })
  assert.equal(s.summary, 'ready')
  assert.equal(s.depthChart, 'unavailable')
  assert.equal(s.pageEmpty, false)
})

void test('skater failure is an error state, never "no skaters"; goalies still render', () => {
  const s = deriveRosterSections({
    roster: ok([1]),
    eligibility: ok([1]),
    skaters: err,
    goalies: ok([1]),
  })
  assert.deepEqual(s.skaters, { state: 'error', empty: false })
  assert.deepEqual(s.goalies, { state: 'ok', empty: false })
})

void test('goalie failure is an error state, never "no goalies"; skaters still render', () => {
  const s = deriveRosterSections({
    roster: ok([1]),
    eligibility: ok([1]),
    skaters: ok([1]),
    goalies: err,
  })
  assert.deepEqual(s.goalies, { state: 'error', empty: false })
  assert.deepEqual(s.skaters, { state: 'ok', empty: false })
})

void test('true empties stay distinct from failures', () => {
  const s = deriveRosterSections({
    roster: ok([]),
    eligibility: ok([]),
    skaters: ok([]),
    goalies: ok([]),
  })
  assert.equal(s.pageEmpty, true)
  assert.deepEqual(s.skaters, { state: 'ok', empty: true })
  assert.deepEqual(s.goalies, { state: 'ok', empty: true })
})

void test('exhaustive: a failed query never reads as empty/zero, in any of the 16 combinations', () => {
  const states = [ok([1]), err] as const
  for (const roster of states)
    for (const eligibility of states)
      for (const skaters of states)
        for (const goalies of states) {
          const s = deriveRosterSections({ roster, eligibility, skaters, goalies })
          if (roster.status === 'error') {
            assert.equal(s.pageEmpty, false)
            assert.equal(s.summary, 'unavailable')
            assert.equal(s.depthChart, 'unavailable')
          }
          if (eligibility.status === 'error') assert.equal(s.depthChart, 'unavailable')
          if (skaters.status === 'error')
            assert.deepEqual(s.skaters, { state: 'error', empty: false })
          if (goalies.status === 'error')
            assert.deepEqual(s.goalies, { state: 'error', empty: false })
          // independence: one table's failure never changes the other's state
          assert.equal(s.skaters.state, skaters.status)
          assert.equal(s.goalies.state, goalies.status)
        }
})

void test('Retry recovers: a transient failure renders the error state, the next load succeeds', async () => {
  let skaterCalls = 0
  let goalieCalls = 0
  const fetchers = {
    roster: () => Promise.resolve([{ id: 1 }]),
    eligibility: () => Promise.resolve([]),
    // skaters: fails once (transient), then recovers
    skaters: () => {
      skaterCalls += 1
      return skaterCalls === 1
        ? Promise.reject(new Error('connection reset'))
        : Promise.resolve([{ id: 1 }])
    },
    // goalies: always fine
    goalies: () => {
      goalieCalls += 1
      return Promise.resolve([{ id: 2 }])
    },
  }

  // first request: failure state, goalies unaffected
  const first = deriveRosterSections(await loadRosterData(fetchers, silent))
  assert.deepEqual(first.skaters, { state: 'error', empty: false })
  assert.deepEqual(first.goalies, { state: 'ok', empty: false })

  // Retry = router.refresh() = the server component runs the queries again from scratch
  const second = deriveRosterSections(await loadRosterData(fetchers, silent))
  assert.deepEqual(second.skaters, { state: 'ok', empty: false })
  assert.equal(skaterCalls, 2, 'skater query is re-run on retry, not served from the failed result')
  assert.equal(goalieCalls, 2)
})
