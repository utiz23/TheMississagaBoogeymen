/**
 * Verification-database isolation — rejection (negative) suite.
 *
 * Runs with plain `node --test`. It requires NO Docker, NO PostgreSQL, no
 * secrets, no production data and no `.env`: every process boundary is a fake
 * injected through `deps`. That is deliberate — this is the suite that has to
 * be runnable *before* anything is allowed to touch a database.
 *
 * Every rejection case drives the REAL guard through `withTestDatabase()` and
 * asserts two things:
 *   1. it throws a GuardError with the expected code, and
 *   2. NO destructive SQL (CREATE/DROP DATABASE, pg_dump copy) was issued.
 * (2) is the property that actually matters: a check that rejects late, after
 * the clone was created, is not a safety check.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  APPROVED_DATABASE_NAME,
  GuardError,
  assertApprovedDatabaseName,
  generateCloneName,
  parseTestDatabaseUrl,
  quoteIdentifier,
} from './test-db-guard.mjs'
import { runCli } from './cli.mjs'
import { withTestDatabase } from './test-db-session.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')

// A production-looking DSN that must never be used, echoed, or inherited.
const PROD_DSN = 'postgresql://eanhl:prodpassword@127.0.0.1:5433/eanhl'
const TEST_DSN = 'postgresql://eanhl_test:testpw@127.0.0.1:5434/eanhl_test'
const SYSTEM_ID = '7412345678901234567'

const CONTAINER = 'eanhl-verify-test-db-test-1'
const PROJECT = 'eanhl-verify-test'
const SERVICE = 'db-test'

function makeEnv(overrides = {}) {
  const env = {
    // Present on purpose: the guard must never fall back to it.
    DATABASE_URL: PROD_DSN,
    TEST_DATABASE_URL: TEST_DSN,
    TEST_DB_CONTAINER: CONTAINER,
    TEST_DB_COMPOSE_PROJECT: PROJECT,
    TEST_DB_COMPOSE_SERVICE: SERVICE,
    ...overrides,
  }
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k]
  return env
}

function defaultInspect() {
  return {
    Name: `/${CONTAINER}`,
    State: { Running: true },
    Config: {
      Labels: {
        'com.docker.compose.project': PROJECT,
        'com.docker.compose.service': SERVICE,
        'eanhl.nonproduction': 'true',
      },
    },
  }
}

/**
 * Fake Docker/PostgreSQL boundary. Records every call so the tests can assert
 * on what was (and was not) executed.
 */
function makeDeps(opts = {}) {
  const calls = []
  const inspect = opts.inspect === undefined ? defaultInspect() : opts.inspect

  function dockerExec(args) {
    calls.push(args)
    if (args[0] === 'inspect') {
      if (opts.inspectThrows) throw new Error('Error: No such object: ' + args[args.length - 1])
      return opts.inspectRaw !== undefined ? opts.inspectRaw : JSON.stringify(inspect)
    }
    if (args[0] === 'exec' && args[2] === 'pg_isready') {
      if (opts.pgIsReadyThrows) throw new Error('pg_isready: no response')
      return 'accepting connections\n'
    }
    if (args[0] === 'exec' && args[2] === 'psql') {
      const statement = args[args.length - 1]
      if (statement.includes('pg_control_system')) {
        if (opts.dockerSystemIdThrows) throw new Error('psql: FATAL: permission denied')
        return opts.dockerSystemId === undefined ? `${SYSTEM_ID}\n` : opts.dockerSystemId
      }
      if (statement.startsWith('SELECT datname')) return opts.sweepList ?? ''
      return ''
    }
    if (args[0] === 'exec' && args[2] === 'bash') return ''
    throw new Error(`unexpected docker invocation: ${JSON.stringify(args)}`)
  }

  return {
    calls,
    dockerExec,
    dockerExecInherit: dockerExec,
    networkSystemIdentifier: async (dsn) => {
      calls.push(['<network>', dsn])
      if (opts.networkThrows) throw new Error('connection refused')
      return opts.networkSystemId === undefined ? SYSTEM_ID : opts.networkSystemId
    },
    now: () => opts.now ?? 1_800_000_000_000,
    pid: opts.pid ?? 4242,
    log: () => {},
  }
}

const DESTRUCTIVE = /\b(?:CREATE|DROP)\s+DATABASE\b|pg_dump/i

function destructiveCalls(calls) {
  return calls.filter((args) => args.some((a) => typeof a === 'string' && DESTRUCTIVE.test(a)))
}

/** Drive the real guard and assert it refused before doing anything destructive. */
async function expectRefusal({ env, deps, code }) {
  const ran = []
  const err = await withTestDatabase({
    env,
    deps,
    run: async () => {
      ran.push('ran')
      return 0
    },
  }).then(
    () => null,
    (e) => e,
  )
  assert.ok(err instanceof GuardError, `expected GuardError, got: ${err}`)
  assert.equal(err.code, code, `expected code "${code}", got "${err.code}": ${err.message}`)
  assert.deepEqual(ran, [], 'the child command must not run when attestation fails')
  assert.deepEqual(
    destructiveCalls(deps.calls),
    [],
    `destructive SQL was issued before attestation passed: ${JSON.stringify(destructiveCalls(deps.calls))}`,
  )
  return err
}

// ── 1. TEST_DATABASE_URL missing while DATABASE_URL is present ────────────────

test('refuses when TEST_DATABASE_URL is missing even though DATABASE_URL is set', async () => {
  const deps = makeDeps()
  const err = await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: undefined }),
    deps,
    code: 'test_database_url_missing',
  })
  assert.match(err.message, /TEST_DATABASE_URL/)
  // The production DSN must not be used, and must not leak into the message.
  assert.ok(!err.message.includes('prodpassword'), 'error message must not echo the production DSN')
  assert.deepEqual(deps.calls, [], 'nothing external may be contacted without TEST_DATABASE_URL')
})

// ── 2. no root .env fallback (end-to-end, through the real bin) ───────────────

test('the CLI never falls back to a repo-root .env and never invokes docker', async () => {
  // IN-PROCESS, deliberately. Spawning the real bin would prove the same thing
  // but requires permission to spawn a Node process from a Node process, which
  // some managed runners deny (EPERM). Running the production orchestration
  // directly needs no such permission AND proves more: a subprocess cannot show
  // that the filesystem boundary was never touched or that no Docker/network
  // dependency was invoked even once.
  const sandbox = mkdtempSync(path.join(tmpdir(), 'with-test-db-envfallback-'))
  try {
    // A real decoy .env on disk at the sandbox "repo root", holding a
    // production-shaped DSN. If anything in this path still parses .env, it
    // will find this.
    const decoyDsn = 'postgresql://eanhl:DECOYSECRET@127.0.0.1:5433/eanhl'
    writeFileSync(path.join(sandbox, '.env'), `DATABASE_URL=${decoyDsn}\n`, 'utf8')
    assert.equal(existsSync(path.join(sandbox, '.env')), true, 'fixture: the decoy .env must exist')

    // Every boundary is a recording fake. None of them may fire.
    const fsReads = []
    const dockerCalls = []
    const networkCalls = []
    const childRuns = []
    const written = []

    const status = await runCli({
      argv: ['--', '/bin/true'],
      // DATABASE_URL is present and production-shaped; no TEST_* at all.
      env: { DATABASE_URL: decoyDsn, PATH: '/usr/bin:/bin', HOME: sandbox },
      write: (line) => written.push(line),
      deps: {
        dockerExec: (args) => {
          dockerCalls.push(args)
          return ''
        },
        dockerExecInherit: (args) => {
          dockerCalls.push(args)
          return ''
        },
        networkSystemIdentifier: async (dsn) => {
          networkCalls.push(dsn)
          return SYSTEM_ID
        },
        now: () => 1_800_000_000_000,
        pid: 4242,
        runChild: (cmd, args, childEnv) => {
          childRuns.push({ cmd, args, childEnv })
          return Promise.resolve(0)
        },
      },
      fs: {
        existsSync: (p) => {
          fsReads.push(p)
          return existsSync(p)
        },
        readdirSync: (p, opts) => {
          fsReads.push(p)
          return readdirSync(p, opts)
        },
      },
      path,
      distDir: path.join(sandbox, 'apps/worker/dist'),
      nodeExecPath: '/nonexistent/node',
    })

    const detail = `\n--- status=${status}\n--- written:\n${written.join('\n')}`

    // 1. TEST_DATABASE_URL is mandatory even though DATABASE_URL is present.
    // 2. The exact refusal diagnostic is produced (never an empty stream).
    assert.ok(written.length > 0, `the CLI produced no diagnostic at all${detail}`)
    const output = written.join('\n')
    assert.match(output, /\[with-test-db\] REFUSED \(test_database_url_missing\)/, `${detail}`)
    assert.match(output, /TEST_DATABASE_URL/, `${detail}`)
    assert.match(
      output,
      /no \.env fallback/,
      `the refusal must state that .env is not consulted${detail}`,
    )

    // 3. Exit status is 1.
    assert.equal(status, 1, `must fail closed with status 1${detail}`)

    // 4. The decoy secret never appears in any diagnostic.
    assert.ok(!output.includes('DECOYSECRET'), `the production/decoy secret leaked${detail}`)
    assert.ok(!output.includes('eanhl:'), `a DSN userinfo segment leaked${detail}`)

    // 5. No `.env` was read — the CLI's only filesystem boundary was never
    //    pointed at one, and in command mode it is not touched at all.
    assert.deepEqual(
      fsReads.filter((p) => String(p).endsWith('.env')),
      [],
      `a .env file was read${detail}`,
    )

    // 6. No Docker, no network, no destructive dependency, no child process.
    assert.deepEqual(dockerCalls, [], `docker was invoked before attestation passed${detail}`)
    assert.deepEqual(networkCalls, [], `the network DSN was contacted${detail}`)
    assert.deepEqual(childRuns, [], `a child command ran despite the refusal${detail}`)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('the CLI refuses in-process without consulting DATABASE_URL as a source', async () => {
  // Complements the case above: DATABASE_URL is a PERFECTLY VALID nonproduction
  // DSN here. If it were consulted as a source the run would proceed; it must
  // still be refused, because only TEST_DATABASE_URL is a source.
  const written = []
  const dockerCalls = []
  const status = await runCli({
    argv: ['--', '/bin/true'],
    env: { DATABASE_URL: 'postgresql://eanhl_test:pw@127.0.0.1:5434/eanhl_test' },
    write: (line) => written.push(line),
    deps: {
      dockerExec: (args) => {
        dockerCalls.push(args)
        return ''
      },
      dockerExecInherit: () => '',
      networkSystemIdentifier: async () => SYSTEM_ID,
      now: () => 1_800_000_000_000,
      pid: 4242,
      runChild: () => Promise.resolve(0),
    },
    fs: { existsSync: () => false, readdirSync: () => [] },
    path,
    distDir: '/nonexistent',
    nodeExecPath: '/nonexistent/node',
  })
  assert.equal(status, 1)
  assert.match(written.join('\n'), /REFUSED \(test_database_url_missing\)/)
  assert.deepEqual(dockerCalls, [])
})

// ── 3. invalid URL ───────────────────────────────────────────────────────────

test('refuses a malformed TEST_DATABASE_URL', async () => {
  await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: 'not a url' }),
    deps: makeDeps(),
    code: 'test_database_url_invalid',
  })
})

test('refuses a non-postgres TEST_DATABASE_URL scheme', async () => {
  await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: 'mysql://root@127.0.0.1:3306/eanhl_test' }),
    deps: makeDeps(),
    code: 'test_database_url_invalid',
  })
})

test('refuses a TEST_DATABASE_URL with no database in its path', async () => {
  await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: 'postgresql://eanhl_test:pw@127.0.0.1:5434/' }),
    deps: makeDeps(),
    code: 'test_database_url_invalid',
  })
})

// ── 4. production / reserved source database names ───────────────────────────

for (const reserved of ['eanhl', 'postgres', 'template0', 'template1']) {
  test(`refuses "${reserved}" as the clone source database`, async () => {
    await expectRefusal({
      env: makeEnv({ TEST_DATABASE_URL: `postgresql://eanhl:pw@127.0.0.1:5433/${reserved}` }),
      deps: makeDeps(),
      code: 'database_name_reserved',
    })
  })
}

test('refuses a production-marked source database name', async () => {
  await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: 'postgresql://u:pw@127.0.0.1:5434/eanhl_test_prod' }),
    deps: makeDeps(),
    code: 'database_name_production_marker',
  })
})

// ── 5. source or clone outside the approved namespace ────────────────────────

for (const outside of ['scratchpad', 'eanhl_staging', 'my_test_db', 'eanhl2_test']) {
  test(`refuses source database "${outside}" (outside approved namespace)`, async () => {
    await expectRefusal({
      env: makeEnv({ TEST_DATABASE_URL: `postgresql://u:pw@127.0.0.1:5434/${outside}` }),
      deps: makeDeps(),
      code: 'database_name_outside_namespace',
    })
  })
}

test('a generated clone name is itself validated against the approved namespace', () => {
  assert.equal(
    generateCloneName({ pid: 4242, now: 1_800_000_000_000 }),
    `eanhl_test_4242_${(1_800_000_000_000).toString(36)}`,
  )
  assert.match(generateCloneName({ pid: 1, now: Date.now() }), APPROVED_DATABASE_NAME)
  // A hostile "pid" cannot smuggle an identifier past the namespace rule.
  assert.throws(() => generateCloneName({ pid: '1; DROP DATABASE eanhl', now: 1 }), GuardError)
})

test('clone-role names outside the namespace are rejected', () => {
  for (const bad of ['eanhl', 'postgres', 'template1', 'eanhl_prod_clone', 'EANHL_TEST']) {
    assert.throws(
      () => assertApprovedDatabaseName(bad, 'clone'),
      GuardError,
      `expected rejection for ${bad}`,
    )
  }
  assert.equal(assertApprovedDatabaseName('eanhl_test_1_abc', 'clone'), 'eanhl_test_1_abc')
})

test('quoteIdentifier refuses anything that is not a plain lowercase identifier', () => {
  assert.equal(quoteIdentifier('eanhl_test_1_abc'), '"eanhl_test_1_abc"')
  for (const bad of [
    'eanhl"; DROP DATABASE eanhl; --',
    'eanhl test',
    'EANHL',
    '',
    'a'.repeat(64),
  ]) {
    assert.throws(() => quoteIdentifier(bad), GuardError)
  }
})

// ── 6. omitted container / project / service identity ────────────────────────

for (const key of ['TEST_DB_CONTAINER', 'TEST_DB_COMPOSE_PROJECT', 'TEST_DB_COMPOSE_SERVICE']) {
  test(`refuses when ${key} is omitted (there is no default)`, async () => {
    const err = await expectRefusal({
      env: makeEnv({ [key]: undefined }),
      deps: makeDeps(),
      code: 'target_identity_missing',
    })
    assert.match(err.message, new RegExp(key))
  })
}

// ── 7. wrong container ───────────────────────────────────────────────────────

test('refuses the production container by name, before contacting docker', async () => {
  const deps = makeDeps()
  await expectRefusal({
    env: makeEnv({
      TEST_DB_CONTAINER: 'eanhl-team-website-db-1',
      TEST_DB_COMPOSE_PROJECT: 'eanhl-team-website',
    }),
    deps,
    code: 'target_identity_not_nonproduction',
  })
  assert.deepEqual(
    deps.calls,
    [],
    'a production-looking identity must be rejected without any docker call',
  )
})

test('refuses a production-marked compose project', async () => {
  await expectRefusal({
    env: makeEnv({ TEST_DB_COMPOSE_PROJECT: 'eanhl-prod-test' }),
    deps: makeDeps(),
    code: 'target_identity_production',
  })
})

test('refuses when docker resolves the name to a different container', async () => {
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ inspect: { ...defaultInspect(), Name: '/eanhl-team-website-db-1' } }),
    code: 'container_identity_mismatch',
  })
})

test('refuses when docker inspect fails', async () => {
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ inspectThrows: true }),
    code: 'container_inspect_failed',
  })
})

for (const [label, raw] of [
  ['empty', ''],
  ['not JSON', 'no such object'],
  ['JSON but not an object', 'null'],
]) {
  test(`refuses when docker inspect output is ${label}`, async () => {
    await expectRefusal({
      env: makeEnv(),
      deps: makeDeps({ inspectRaw: raw }),
      code: 'container_inspect_unparseable',
    })
  })
}

// ── 8. wrong compose project or service label ────────────────────────────────

test('refuses when the container carries a different com.docker.compose.project', async () => {
  const inspect = defaultInspect()
  inspect.Config.Labels['com.docker.compose.project'] = 'eanhl-team-website'
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ inspect }),
    code: 'compose_project_mismatch',
  })
})

test('refuses when the container carries a different com.docker.compose.service', async () => {
  const inspect = defaultInspect()
  inspect.Config.Labels['com.docker.compose.service'] = 'db'
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ inspect }),
    code: 'compose_service_mismatch',
  })
})

test('refuses a container with no labels at all', async () => {
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ inspect: { Name: `/${CONTAINER}`, State: { Running: true }, Config: {} } }),
    code: 'container_labels_missing',
  })
})

test('refuses a container that is not explicitly declared nonproduction', async () => {
  const inspect = defaultInspect()
  delete inspect.Config.Labels['eanhl.nonproduction']
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ inspect }),
    code: 'container_not_declared_nonproduction',
  })
})

// ── 9. stopped / unreachable container ───────────────────────────────────────

test('refuses a stopped container', async () => {
  const inspect = defaultInspect()
  inspect.State.Running = false
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ inspect }),
    code: 'container_not_running',
  })
})

test('refuses when PostgreSQL inside the container is unreachable', async () => {
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ pgIsReadyThrows: true }),
    code: 'container_postgres_unreachable',
  })
})

// ── 10 + 12. system-identifier mismatch, incl. the loopback tunnel spoof ─────

test('refuses when the network DSN and docker exec report different clusters', async () => {
  const err = await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ networkSystemId: '1111111111111111111' }),
    code: 'system_identifier_mismatch',
  })
  assert.match(err.message, /different/i)
})

test('refuses a loopback DSN that is actually an SSH tunnel to another cluster', async () => {
  // The spoof: the DSN host is 127.0.0.1 (indistinguishable from the local
  // container by address alone) and every container check passes, but the
  // cluster answering on that port is a different PostgreSQL instance.
  const deps = makeDeps({ networkSystemId: '9999999999999999999' })
  const err = await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: 'postgresql://eanhl_test:pw@127.0.0.1:5434/eanhl_test' }),
    deps,
    code: 'system_identifier_mismatch',
  })
  assert.match(err.message, /system_identifier|cluster/i)
})

test('refuses a non-loopback TEST_DATABASE_URL outright', async () => {
  await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: 'postgresql://u:pw@db.example.com:5432/eanhl_test' }),
    deps: makeDeps(),
    code: 'test_database_url_not_loopback',
  })
})

test("loopback host matching handles Node's bracketed IPv6 serialisation", async () => {
  // `new URL('postgresql://u@[::1]/db').hostname` is '[::1]', WITH brackets, so
  // a bare '::1' comparison never matches. Accept the bracketed form; keep
  // rejecting every non-loopback IPv6 address.
  assert.equal(new URL('postgresql://u:p@[::1]:5434/eanhl_test').hostname, '[::1]')
  assert.equal(
    parseTestDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://u:p@[::1]:5434/eanhl_test' }).host,
    '[::1]',
  )
  for (const host of ['127.0.0.1', 'localhost']) {
    assert.equal(
      parseTestDatabaseUrl({ TEST_DATABASE_URL: `postgresql://u:p@${host}:5434/eanhl_test` }).host,
      host,
    )
  }
  for (const host of ['[2001:db8::1]', '[fe80::1]', 'db.example.com']) {
    assert.throws(
      () => parseTestDatabaseUrl({ TEST_DATABASE_URL: `postgresql://u:p@${host}:5434/eanhl_test` }),
      (err) => err instanceof GuardError && err.code === 'test_database_url_not_loopback',
      `expected ${host} to be rejected as non-loopback`,
    )
  }
})

test('an IPv6-loopback DSN still has to pass every remaining attestation step', async () => {
  await expectRefusal({
    env: makeEnv({ TEST_DATABASE_URL: 'postgresql://eanhl_test:pw@[::1]:5434/eanhl_test' }),
    deps: makeDeps({ networkSystemId: '1111111111111111111' }),
    code: 'system_identifier_mismatch',
  })
})

// ── 11. failed / empty / malformed system-ID output ──────────────────────────

test('refuses when the network system-identifier query fails', async () => {
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ networkThrows: true }),
    code: 'system_identifier_unreadable',
  })
})

test('refuses when the docker-exec system-identifier query fails', async () => {
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ dockerSystemIdThrows: true }),
    code: 'system_identifier_unreadable',
  })
})

for (const [label, value] of [
  ['empty', ''],
  ['whitespace only', '   \n'],
]) {
  test(`refuses an ${label} network system identifier`, async () => {
    await expectRefusal({
      env: makeEnv(),
      deps: makeDeps({ networkSystemId: value }),
      code: 'system_identifier_empty',
    })
  })
  test(`refuses an ${label} docker-exec system identifier`, async () => {
    await expectRefusal({
      env: makeEnv(),
      deps: makeDeps({ dockerSystemId: value }),
      code: 'system_identifier_empty',
    })
  })
}

for (const [label, value] of [
  ['non-numeric', 'ERROR:  permission denied for function pg_control_system\n'],
  ['multi-row', '7412345678901234567\n7412345678901234568\n'],
  ['over-long', '1'.repeat(21)],
]) {
  test(`refuses a ${label} network system identifier`, async () => {
    await expectRefusal({
      env: makeEnv(),
      deps: makeDeps({ networkSystemId: value }),
      code: 'system_identifier_malformed',
    })
  })
  test(`refuses a ${label} docker-exec system identifier`, async () => {
    await expectRefusal({
      env: makeEnv(),
      deps: makeDeps({ dockerSystemId: value }),
      code: 'system_identifier_malformed',
    })
  })
}

test('refuses when the network identifier query returns nothing at all', async () => {
  await expectRefusal({
    env: makeEnv(),
    deps: makeDeps({ networkSystemId: null }),
    code: 'system_identifier_unreadable',
  })
})

// ── 13. no CREATE/DROP before attestation — aggregate proof ──────────────────

test('no destructive SQL is issued for ANY rejected configuration', async () => {
  const scenarios = [
    { env: makeEnv({ TEST_DATABASE_URL: undefined }), deps: makeDeps() },
    { env: makeEnv({ TEST_DATABASE_URL: PROD_DSN }), deps: makeDeps() },
    { env: makeEnv({ TEST_DB_CONTAINER: undefined }), deps: makeDeps() },
    { env: makeEnv({ TEST_DB_COMPOSE_PROJECT: undefined }), deps: makeDeps() },
    { env: makeEnv({ TEST_DB_COMPOSE_SERVICE: undefined }), deps: makeDeps() },
    { env: makeEnv(), deps: makeDeps({ inspectThrows: true }) },
    { env: makeEnv(), deps: makeDeps({ pgIsReadyThrows: true }) },
    { env: makeEnv(), deps: makeDeps({ networkSystemId: '1' }) },
    { env: makeEnv(), deps: makeDeps({ dockerSystemId: 'oops' }) },
  ]
  for (const { env, deps } of scenarios) {
    await assert.rejects(withTestDatabase({ env, deps, run: async () => 0 }), GuardError)
    assert.deepEqual(
      destructiveCalls(deps.calls),
      [],
      `destructive SQL leaked for ${JSON.stringify(env['TEST_DATABASE_URL'] ?? null)}`,
    )
  }
})

// ── the pre-push hook must block, not skip, and must not read `.env` ─────────

test('the pre-push hook blocks (does not skip) when verification config is missing', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'pre-push-guard-'))
  const hookEnv = { ...process.env }
  for (const key of Object.keys(hookEnv)) {
    if (key === 'TEST_DATABASE_URL' || key.startsWith('TEST_DB_')) delete hookEnv[key]
  }
  try {
    let stderr = ''
    let statusCode = 0
    try {
      execFileSync('bash', [path.join(REPO_ROOT, '.githooks/pre-push')], {
        cwd: REPO_ROOT,
        // Inherit the real environment (so bash always starts), then strip the
        // verification variables and plant a production-shaped DATABASE_URL.
        // The old hook would have sourced .env and run the harness with it.
        env: {
          ...hookEnv,
          HOME: sandbox,
          DATABASE_URL: 'postgresql://eanhl:HOOKSECRET@127.0.0.1:5433/eanhl',
        },
        input: '',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      statusCode = err.status ?? 1
      stderr = String(err.stderr ?? '')
    }
    assert.notEqual(
      statusCode,
      0,
      'a missing safety configuration must block the push, not skip the check',
    )
    assert.match(stderr, /BLOCKED/)
    assert.match(stderr, /TEST_DATABASE_URL/)
    assert.match(
      stderr,
      /--no-verify/,
      'the block must tell the user how to bypass it deliberately',
    )
    assert.ok(!stderr.includes('HOOKSECRET'), 'the hook must not echo an application DSN')
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})
