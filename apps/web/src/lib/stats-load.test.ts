import test from 'node:test'
import assert from 'node:assert/strict'
import {
  settle,
  rowsOrEmpty,
  resolveTablePresentation,
  shouldShowPlayerModule,
} from './stats-load.ts'

const noopLogger = () => {
  // Swallow the expected failure log in these tests; only the dedicated
  // "default logger" test below asserts on the real console.error text.
}

void test('settle: a resolved query settles to ok with its data', async () => {
  const result = await settle('some query', () => Promise.resolve([1, 2, 3]))
  assert.deepEqual(result, { status: 'ok', data: [1, 2, 3] })
})

void test('settle: a rejected query settles to error and never throws', async () => {
  const result = await settle('some query', () => Promise.reject(new Error('boom')), noopLogger)
  assert.deepEqual(result, { status: 'error' })
})

void test('settle: a throwing synchronous query also settles to error', async () => {
  const result = await settle(
    'some query',
    () => {
      throw new Error('sync boom')
    },
    noopLogger,
  )
  assert.deepEqual(result, { status: 'error' })
})

void test('settle: the default logger prefixes with [stats], not [roster]', async () => {
  const logged: [string, unknown][] = []
  await settle(
    'current skater stats',
    () => Promise.reject(new Error('boom')),
    (label, error) => {
      logged.push([label, error])
    },
  )
  assert.equal(logged.length, 1)
  assert.equal(logged[0]?.[0], 'current skater stats')

  // Verify the module's actual default logger text via console.error capture.
  const original = console.error
  const calls: unknown[][] = []
  console.error = (...args: unknown[]) => {
    calls.push(args)
  }
  try {
    await settle('archive club/team rows', () => Promise.reject(new Error('boom')))
  } finally {
    console.error = original
  }
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.[0], '[stats] archive club/team rows failed')
})

void test('rowsOrEmpty: ok returns the rows; error returns [] (state must still be checked separately)', () => {
  assert.deepEqual(rowsOrEmpty({ status: 'ok', data: [1, 2] }), [1, 2])
  assert.deepEqual(rowsOrEmpty({ status: 'error' }), [])
})

// ─── resolveTablePresentation: the load-bearing per-table decision ─────────

void test('resolveTablePresentation: a failed query is error, never empty', () => {
  assert.deepEqual(resolveTablePresentation({ status: 'error' }), { kind: 'error' })
})

void test('resolveTablePresentation: a successful zero-row result is an explicit empty, never an error', () => {
  assert.deepEqual(resolveTablePresentation({ status: 'ok', data: [] }), { kind: 'empty' })
})

void test('resolveTablePresentation: a successful non-empty result carries its rows', () => {
  assert.deepEqual(resolveTablePresentation({ status: 'ok', data: [1, 2, 3] }), {
    kind: 'rows',
    rows: [1, 2, 3],
  })
})

void test('resolveTablePresentation: club-member goalie success with zero rows is an explicit empty', () => {
  // Same rule applies regardless of which query/source it backs — the
  // decision is generic, and this is one of the two rows the correction
  // specifically calls out (previously silently omitted).
  const clubMemberGoalies = { status: 'ok' as const, data: [] as { gamertag: string }[] }
  assert.deepEqual(resolveTablePresentation(clubMemberGoalies), { kind: 'empty' })
})

void test('resolveTablePresentation: player-card goalie success with zero rows is an explicit empty', () => {
  const playerCardGoalies = { status: 'ok' as const, data: [] as { gamertag: string }[] }
  assert.deepEqual(resolveTablePresentation(playerCardGoalies), { kind: 'empty' })
})

void test('resolveTablePresentation: independent results for different roles/sources never influence each other', () => {
  const currentSkaters = resolveTablePresentation({ status: 'error' })
  const currentGoalies = resolveTablePresentation({ status: 'ok', data: [{ id: 1 }] })
  const allTimeSkaters = resolveTablePresentation({ status: 'ok', data: [] })
  const allTimeGoalies = resolveTablePresentation({ status: 'error' })

  assert.deepEqual(currentSkaters, { kind: 'error' })
  assert.deepEqual(currentGoalies, { kind: 'rows', rows: [{ id: 1 }] })
  assert.deepEqual(allTimeSkaters, { kind: 'empty' })
  assert.deepEqual(allTimeGoalies, { kind: 'error' })
})

// ─── shouldShowPlayerModule: the active-title module visibility rule ───────

const ok = <T>(data: T[]) => ({ status: 'ok' as const, data })
const err = { status: 'error' as const }
const allOkEmpty = {
  hasClubActivity: false,
  currentSkaters: ok<never>([]),
  currentGoalies: ok<never>([]),
  allTimeSkaters: ok<never>([]),
  allTimeGoalies: ok<never>([]),
}

void test('shouldShowPlayerModule: zero club GP + nonempty All Time skaters => visible', () => {
  assert.equal(shouldShowPlayerModule({ ...allOkEmpty, allTimeSkaters: ok([{ id: 1 }]) }), true)
})

void test('shouldShowPlayerModule: zero club GP + nonempty All Time goalies => visible', () => {
  assert.equal(shouldShowPlayerModule({ ...allOkEmpty, allTimeGoalies: ok([{ id: 1 }]) }), true)
})

void test('shouldShowPlayerModule: zero club GP + Current skater failure => visible', () => {
  assert.equal(shouldShowPlayerModule({ ...allOkEmpty, currentSkaters: err }), true)
})

void test('shouldShowPlayerModule: zero club GP + Current goalie failure => visible', () => {
  assert.equal(shouldShowPlayerModule({ ...allOkEmpty, currentGoalies: err }), true)
})

void test('shouldShowPlayerModule: zero club GP + All Time failure (either role) => visible', () => {
  assert.equal(shouldShowPlayerModule({ ...allOkEmpty, allTimeSkaters: err }), true)
  assert.equal(shouldShowPlayerModule({ ...allOkEmpty, allTimeGoalies: err }), true)
})

void test('shouldShowPlayerModule: zero club GP + every query successful and empty => hidden', () => {
  assert.equal(shouldShowPlayerModule(allOkEmpty), false)
})

void test('shouldShowPlayerModule: current club activity alone => visible, regardless of query results', () => {
  assert.equal(shouldShowPlayerModule({ ...allOkEmpty, hasClubActivity: true }), true)
})
