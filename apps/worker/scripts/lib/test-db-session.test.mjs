/**
 * Verification-database isolation — accepted-path suite.
 *
 * Complements test-db-guard.test.mjs (which proves every rejection). Here the
 * attestation is made to PASS with fakes, so the tests can assert what happens
 * afterwards: the ordering of destructive SQL, what the child process actually
 * receives in DATABASE_URL, and that stale-clone cleanup only ever runs on an
 * attested target.
 *
 * No Docker, no PostgreSQL, no secrets, no `.env`.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { GuardError } from './test-db-guard.mjs'
import {
  SWEEP_MIN_AGE_MS,
  buildChildEnv,
  cloneAgeMs,
  withTestDatabase,
} from './test-db-session.mjs'

const PROD_DSN = 'postgresql://eanhl:prodpassword@127.0.0.1:5433/eanhl'
const TEST_DSN = 'postgresql://eanhl_test:testpw@127.0.0.1:5434/eanhl_test'
const SYSTEM_ID = '7412345678901234567'
const CONTAINER = 'eanhl-verify-test-db-test-1'
const NOW = 1_800_000_000_000
const PID = 4242
const CLONE = `eanhl_test_${PID}_${NOW.toString(36)}`

function goodEnv(overrides = {}) {
  return {
    DATABASE_URL: PROD_DSN, // present, and must be overwritten for the child
    PATH: '/usr/bin:/bin',
    TEST_DATABASE_URL: TEST_DSN,
    TEST_DB_CONTAINER: CONTAINER,
    TEST_DB_COMPOSE_PROJECT: 'eanhl-verify-test',
    TEST_DB_COMPOSE_SERVICE: 'db-test',
    ...overrides,
  }
}

/** A fake boundary on which attestation SUCCEEDS. */
function passingDeps(opts = {}) {
  const calls = []
  const sql = []
  function dockerExec(args) {
    calls.push(args)
    if (args[0] === 'inspect') {
      return JSON.stringify({
        Name: `/${CONTAINER}`,
        State: { Running: true },
        Config: {
          Labels: {
            'com.docker.compose.project': 'eanhl-verify-test',
            'com.docker.compose.service': 'db-test',
            'eanhl.nonproduction': 'true',
          },
        },
      })
    }
    if (args[0] === 'exec' && args[2] === 'pg_isready') return 'accepting connections\n'
    if (args[0] === 'exec' && args[2] === 'psql') {
      const statement = args[args.length - 1]
      if (statement.includes('pg_control_system')) return `${SYSTEM_ID}\n`
      if (statement.startsWith('SELECT datname')) return opts.sweepList ?? ''
      sql.push(statement)
      return ''
    }
    if (args[0] === 'exec' && args[2] === 'bash') {
      sql.push('COPY(pg_dump|psql)')
      return ''
    }
    throw new Error(`unexpected docker invocation: ${JSON.stringify(args)}`)
  }
  return {
    calls,
    sql,
    dockerExec,
    dockerExecInherit: dockerExec,
    networkSystemIdentifier: async () => SYSTEM_ID,
    now: () => NOW,
    pid: PID,
    log: () => {},
  }
}

test('the happy path creates, copies into, and finally drops the disposable clone', async () => {
  const deps = passingDeps()
  const status = await withTestDatabase({ env: goodEnv(), deps, run: async () => 0 })
  assert.equal(status, 0)
  assert.deepEqual(deps.sql, [
    `DROP DATABASE IF EXISTS "${CLONE}" WITH (FORCE)`, // pre-clean
    `CREATE DATABASE "${CLONE}"`,
    'COPY(pg_dump|psql)',
    `DROP DATABASE IF EXISTS "${CLONE}" WITH (FORCE)`, // teardown
  ])
})

test('attestation completes before any destructive SQL', async () => {
  const deps = passingDeps()
  await withTestDatabase({ env: goodEnv(), deps, run: async () => 0 })
  const kinds = deps.calls.map((a) =>
    a[0] === 'inspect' ? 'inspect' : a[2] === 'pg_isready' ? 'isready' : a[2],
  )
  const firstDestructive = deps.calls.findIndex((a) =>
    a.some((x) => /DATABASE|pg_dump/.test(String(x))),
  )
  assert.ok(firstDestructive > 0)
  assert.ok(kinds.indexOf('inspect') < firstDestructive, 'container inspect must precede any DDL')
  assert.ok(kinds.indexOf('isready') < firstDestructive, 'reachability check must precede any DDL')
  // Both system-identifier reads happen before the first destructive statement.
  const sysIdCalls = deps.calls
    .map((a, i) => [a, i])
    .filter(([a]) => a.some((x) => typeof x === 'string' && x.includes('pg_control_system')))
  assert.equal(sysIdCalls.length, 1, 'docker-side system identifier is read exactly once')
  assert.ok(sysIdCalls[0][1] < firstDestructive, 'system-identifier check must precede any DDL')
})

// ── the child process env — requirement 5 / 6 ────────────────────────────────

test('the child receives the clone DSN and cannot inherit the production DATABASE_URL', async () => {
  const deps = passingDeps()
  let seen = null
  await withTestDatabase({
    env: goodEnv(),
    deps,
    run: async ({ childEnv }) => {
      seen = childEnv
      return 0
    },
  })
  assert.equal(seen['DATABASE_URL'], `postgresql://eanhl_test:testpw@127.0.0.1:5434/${CLONE}`)
  assert.notEqual(seen['DATABASE_URL'], PROD_DSN)
  assert.ok(!seen['DATABASE_URL'].includes('/eanhl?') && !seen['DATABASE_URL'].endsWith('/eanhl'))
  assert.equal(seen['PATH'], '/usr/bin:/bin', 'unrelated environment is still passed through')
})

test('buildChildEnv overwrites DATABASE_URL even when the caller set a production value', () => {
  const attestation = {
    testDatabaseUrl: TEST_DSN,
    cloneDatabase: 'eanhl_test_1_abc',
  }
  const child = buildChildEnv({ DATABASE_URL: PROD_DSN, OTHER: 'keep' }, attestation)
  assert.equal(
    child['DATABASE_URL'],
    'postgresql://eanhl_test:testpw@127.0.0.1:5434/eanhl_test_1_abc',
  )
  assert.equal(child['OTHER'], 'keep')
})

test('the clone is dropped even when the child command fails or throws', async () => {
  const failing = passingDeps()
  const status = await withTestDatabase({ env: goodEnv(), deps: failing, run: async () => 7 })
  assert.equal(status, 7)
  assert.equal(failing.sql.at(-1), `DROP DATABASE IF EXISTS "${CLONE}" WITH (FORCE)`)

  const throwing = passingDeps()
  await assert.rejects(
    withTestDatabase({
      env: goodEnv(),
      deps: throwing,
      run: async () => {
        throw new Error('suite crashed')
      },
    }),
    /suite crashed/,
  )
  assert.equal(throwing.sql.at(-1), `DROP DATABASE IF EXISTS "${CLONE}" WITH (FORCE)`)
})

// ── stale-clone cleanup — only on an attested target, only genuine orphans ───

test('stale-clone cleanup sweeps only old, unconnected clones', async () => {
  const old = `eanhl_test_99_${(NOW - SWEEP_MIN_AGE_MS - 1000).toString(36)}`
  const recent = `eanhl_test_98_${(NOW - 1000).toString(36)}`
  const foreign = 'eanhl_test_97_zzzz-not-base36' // outside the approved namespace
  const deps = passingDeps({ sweepList: `${old}\n${recent}\n${foreign}\n` })
  await withTestDatabase({ env: goodEnv(), deps, run: async () => 0 })
  assert.equal(
    deps.sql[0],
    `DROP DATABASE IF EXISTS "${old}" WITH (FORCE)`,
    'the genuine orphan is swept',
  )
  assert.ok(
    !deps.sql.some((s) => s.includes(recent)),
    "a concurrent run's recent clone must not be swept",
  )
  assert.ok(
    !deps.sql.some((s) => s.includes('zzzz')),
    'a name outside the approved clone namespace must be left alone',
  )
})

test('stale-clone cleanup never runs when attestation fails', async () => {
  const deps = passingDeps({
    sweepList: `eanhl_test_99_${(NOW - SWEEP_MIN_AGE_MS - 1000).toString(36)}\n`,
  })
  await assert.rejects(
    withTestDatabase({ env: goodEnv({ TEST_DB_CONTAINER: undefined }), deps, run: async () => 0 }),
    GuardError,
  )
  assert.deepEqual(deps.sql, [], 'no sweep, no DDL')
})

test('cloneAgeMs recovers the creation time encoded in a clone name', () => {
  assert.equal(cloneAgeMs(`eanhl_test_1_${(NOW - 5000).toString(36)}`, NOW), 5000)
  // parseInt would stop at the first invalid char and yield a plausible age;
  // a partially-base36 suffix must be rejected outright instead.
  assert.ok(Number.isNaN(cloneAgeMs('eanhl_test_1_zzzz-not-base36', NOW)))
  assert.ok(Number.isNaN(cloneAgeMs('eanhl_test_1_0', NOW)))
})

// ── the cleanup hook the bin uses for signal-safe teardown ──────────────────

test('a cleanup callback is registered as soon as the clone exists', async () => {
  const deps = passingDeps()
  let registered = null
  deps.registerCleanup = (fn) => {
    registered = fn
  }
  await withTestDatabase({
    env: goodEnv(),
    deps,
    run: async () => {
      assert.equal(
        typeof registered,
        'function',
        'signal handlers must be able to drop the clone mid-run',
      )
      return 0
    },
  })
})
