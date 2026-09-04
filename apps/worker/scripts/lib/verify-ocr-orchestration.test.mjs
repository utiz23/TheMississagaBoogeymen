/**
 * scripts/verify-ocr.sh — orchestration (behavioural) suite.
 *
 * Runs the REAL shell script inside a sandbox repo whose every external
 * program is a recording fake (`node`, `pnpm`, `python`, `docker`). Each fake
 * appends a JSON line describing its argv and the environment it was handed,
 * so the tests can assert on what the script actually launched and with what —
 * rather than on the text of the script.
 *
 * No Docker, no PostgreSQL, no secrets, no `.env`, no network. Nothing is
 * started: `docker` is a fake whose only job is to prove it was never called.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')

const PROD_DSN = 'postgresql://eanhl:ORCHSECRET@127.0.0.1:5433/eanhl'
const TEST_DSN = 'postgresql://eanhl_test:testpw@127.0.0.1:5434/eanhl_test'

/**
 * A recording fake: writes one JSON line per invocation to $RECORD_LOG, then
 * exits 0. `env -0` is not used; the few variables the assertions care about
 * are captured explicitly, including whether DATABASE_URL exists at all.
 */
function recorder(name, exitCode = 0) {
  return [
    '#!/bin/sh',
    'log="$RECORD_LOG"',
    '{',
    '  printf \'{"cmd":"%s","argv":[\' "' + name + '"',
    '  sep=""',
    '  for a in "$@"; do',
    // JSON-escape backslashes and double quotes, and collapse newlines.
    "    esc=$(printf '%s' \"$a\" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/\"/\\\\\"/g' | tr '\\n' ' ')",
    '    printf \'%s"%s"\' "$sep" "$esc"',
    '    sep=","',
    '  done',
    "  printf ']'",
    '  if [ -n "${DATABASE_URL+set}" ]; then',
    "    esc=$(printf '%s' \"$DATABASE_URL\" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/\"/\\\\\"/g')",
    '    printf \',"database_url_present":true,"database_url":"%s"\' "$esc"',
    '  else',
    '    printf \',"database_url_present":false\'',
    '  fi',
    '  printf \',"run_reprocess_e2e":"%s"\' "${RUN_REPROCESS_E2E:-}"',
    '  printf \',"run_reprocess_integration":"%s"\' "${RUN_REPROCESS_INTEGRATION:-}"',
    "  printf '}\\n'",
    '} >> "$log"',
    `exit ${exitCode}`,
    '',
  ].join('\n')
}

/**
 * Build a sandbox repo carrying the real verify-ocr.sh + the real
 * apps/worker/scripts, plus every prerequisite the script checks for and a
 * PATH of recording fakes.
 */
function makeSandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'verify-ocr-orch-'))

  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  cpSync(path.join(REPO_ROOT, 'scripts/verify-ocr.sh'), path.join(root, 'scripts/verify-ocr.sh'))

  const scriptsDst = path.join(root, 'apps/worker/scripts')
  mkdirSync(scriptsDst, { recursive: true })
  cpSync(path.join(REPO_ROOT, 'apps/worker/scripts'), scriptsDst, { recursive: true })

  // Prerequisites the script refuses to run without.
  const venvBin = path.join(root, '.venv-1/bin')
  mkdirSync(venvBin, { recursive: true })
  writeFileSync(path.join(venvBin, 'python'), recorder('python'), { mode: 0o755 })
  mkdirSync(path.join(root, 'tools/game_ocr/game_ocr/weights'), { recursive: true })
  writeFileSync(
    path.join(root, 'tools/game_ocr/game_ocr/weights/nhl26-screen-classifier-v2.json'),
    '{}',
  )
  mkdirSync(path.join(root, 'tools/video_ingest'), { recursive: true })
  mkdirSync(path.join(root, 'docs/ocr'), { recursive: true })
  writeFileSync(path.join(root, 'docs/ocr/tier0-quarantined-worker-tests.txt'), '# none\n')

  // A decoy application .env. Nothing in this path may read it.
  writeFileSync(root + '/.env', `DATABASE_URL=${PROD_DSN}\n`, 'utf8')

  const binDir = path.join(root, 'bin')
  mkdirSync(binDir)
  for (const name of ['node', 'pnpm', 'docker']) {
    writeFileSync(path.join(binDir, name), recorder(name), { mode: 0o755 })
  }

  return { root, binDir, log: path.join(root, 'record.log') }
}

function runVerify(sandbox, { args = [], env = {} } = {}) {
  const childEnv = { ...process.env }
  for (const key of Object.keys(childEnv)) {
    if (key === 'TEST_DATABASE_URL' || key.startsWith('TEST_DB_')) delete childEnv[key]
  }
  Object.assign(childEnv, {
    PATH: `${sandbox.binDir}:${childEnv['PATH'] ?? '/usr/bin:/bin'}`,
    HOME: sandbox.root,
    RECORD_LOG: sandbox.log,
    // An inherited PRODUCTION DSN. The script must strip it before it can reach
    // any child process.
    DATABASE_URL: PROD_DSN,
    ...env,
  })

  const result = spawnSync('bash', [path.join(sandbox.root, 'scripts/verify-ocr.sh'), ...args], {
    cwd: sandbox.root,
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const records = existsSync(sandbox.log)
    ? readFileSync(sandbox.log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : []

  return { result, records, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const configured = {
  TEST_DATABASE_URL: TEST_DSN,
  TEST_DB_CONTAINER: 'eanhl-verify-test-db-test-1',
  TEST_DB_COMPOSE_PROJECT: 'eanhl-verify-test',
  TEST_DB_COMPOSE_SERVICE: 'db-test',
}

/** Every invocation routed through the isolation harness. */
function isolatedInvocations(records) {
  return records.filter(
    (r) =>
      r.cmd === 'node' && r.argv.some((a) => a.endsWith('apps/worker/scripts/with-test-db.mjs')),
  )
}

test('verify-ocr.sh --full orchestrates every DB-writing step through the isolation harness', () => {
  const sandbox = makeSandbox()
  try {
    const { result, records, output } = runVerify(sandbox, { args: ['--full'], env: configured })
    const detail = `\n--- exit=${result.status}\n--- output:\n${output}\n--- records:\n${JSON.stringify(records, null, 2)}`

    assert.equal(result.status, 0, `the orchestration run must complete${detail}`)
    assert.ok(records.length > 0, `no child process was recorded — the fakes never ran${detail}`)

    // 1. The inherited PRODUCTION DATABASE_URL is removed for the whole run.
    assert.match(output, /DATABASE_URL was set in the environment; unsetting it/)
    const leaked = records.filter((r) => r.database_url_present)
    assert.deepEqual(leaked, [], `a child inherited DATABASE_URL${detail}`)
    assert.ok(
      !output.includes('ORCHSECRET'),
      `the production secret must never be printed${detail}`,
    )

    // 2. Every DB-touching step is launched THROUGH with-test-db.mjs. The
    //    script wraps three of them directly (step 1, step 4, and --full);
    //    step 2 is `pnpm --filter @eanhl/worker test`, which isolates itself
    //    inside the worker package script.
    const isolated = isolatedInvocations(records)
    assert.equal(isolated.length, 3, `expected steps 1, 4 and --full to be wrapped${detail}`)
    const snippets = isolated.map((r) => r.argv[r.argv.length - 1])
    assert.ok(
      snippets.some((sn) => sn.includes('pnpm --filter @eanhl/db test')),
      `step 1 (@eanhl/db, which writes) must be isolated${detail}`,
    )
    assert.ok(
      snippets.some(
        (sn) => sn.includes('RUN_REPROCESS_INTEGRATION=1') && !sn.includes('RUN_REPROCESS_E2E'),
      ),
      `step 4 (video_ingest DB smoke) must be isolated${detail}`,
    )
    const workerStep = records.filter(
      (r) => r.cmd === 'pnpm' && r.argv.join(' ').includes('@eanhl/worker test'),
    )
    assert.equal(workerStep.length, 1, `step 2 must run the worker suite${detail}`)
    assert.equal(
      workerStep[0].database_url_present,
      false,
      `step 2 must not inherit DATABASE_URL${detail}`,
    )

    const reprocess = isolated.filter((r) =>
      r.argv.some((a) => a.includes('test_reprocess_cli.py')),
    )
    assert.equal(
      reprocess.length,
      1,
      `the --full reprocess E2E must run through the harness exactly once${detail}`,
    )

    const call = reprocess[0]
    // ... as `node <with-test-db.mjs> -- bash -c '<snippet>'`
    const sepIndex = call.argv.indexOf('--')
    assert.ok(sepIndex > 0, `the harness must be invoked in command mode${detail}`)
    assert.equal(call.argv[0].endsWith('apps/worker/scripts/with-test-db.mjs'), true)
    assert.deepEqual(call.argv.slice(sepIndex + 1, sepIndex + 3), ['bash', '-c'], `${detail}`)

    // 3. Both opt-in flags reach that isolated invocation.
    const snippet = call.argv[sepIndex + 3]
    assert.match(snippet, /RUN_REPROCESS_E2E=1/, `${detail}`)
    assert.match(snippet, /RUN_REPROCESS_INTEGRATION=1/, `${detail}`)
    assert.match(snippet, /test_reprocess_cli\.py/, `${detail}`)

    // 4. The reprocess command is NOT launched directly.
    const directPython = records.filter((r) => r.cmd === 'python')
    assert.ok(directPython.length > 0, `the no-DB python steps should still run directly${detail}`)
    for (const r of directPython) {
      assert.notEqual(
        r.run_reprocess_e2e,
        '1',
        `a python step ran the reprocess E2E outside the harness${detail}`,
      )
      assert.ok(
        !r.argv.some((a) => a.includes('test_reprocess_cli.py')),
        `the reprocess E2E was launched directly, bypassing isolation${detail}`,
      )
    }

    // 5. Nothing contacted Docker: with-test-db.mjs is the only thing allowed
    //    to, and here it is a fake that records instead of attesting.
    assert.deepEqual(
      records.filter((r) => r.cmd === 'docker'),
      [],
      `verify-ocr.sh itself must never invoke docker${detail}`,
    )
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('verify-ocr.sh fails before any Docker or database contact when TEST_* is missing', () => {
  const sandbox = makeSandbox()
  try {
    // Configuration absent; a production DATABASE_URL and a decoy .env present.
    const { result, records, output } = runVerify(sandbox, { args: ['--full'] })
    const detail = `\n--- exit=${result.status}\n--- output:\n${output}\n--- records:\n${JSON.stringify(records, null, 2)}`

    assert.notEqual(result.status, 0, `must fail closed${detail}`)
    assert.match(output, /verification database configuration is incomplete/, `${detail}`)
    for (const key of Object.keys(configured)) {
      assert.match(output, new RegExp(`missing: ${key}`), `${detail}`)
    }
    assert.ok(!output.includes('ORCHSECRET'), `must not echo the production DSN${detail}`)

    // Nothing beyond the prerequisite probe may have run: no docker, no pnpm,
    // no isolation harness, no pytest.
    assert.deepEqual(
      records.filter((r) => r.cmd === 'docker'),
      [],
      `docker was contacted${detail}`,
    )
    assert.deepEqual(
      records.filter((r) => r.cmd === 'pnpm'),
      [],
      `a suite was launched${detail}`,
    )
    assert.deepEqual(isolatedInvocations(records), [], `a clone was provisioned${detail}`)
    const pytest = records.filter((r) => r.cmd === 'python' && r.argv.includes('pytest'))
    assert.deepEqual(pytest, [], `pytest ran despite missing configuration${detail}`)
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('the default (non-full) run does not launch the reprocess E2E at all', () => {
  const sandbox = makeSandbox()
  try {
    const { result, records, output } = runVerify(sandbox, { env: configured })
    const detail = `\n--- exit=${result.status}\n--- output:\n${output}\n--- records:\n${JSON.stringify(records, null, 2)}`
    assert.equal(result.status, 0, `${detail}`)
    for (const r of records) {
      assert.equal(r.run_reprocess_e2e, '', `RUN_REPROCESS_E2E leaked into a default run${detail}`)
      assert.ok(!r.argv.some((a) => a.includes('RUN_REPROCESS_E2E')), `${detail}`)
    }
    assert.deepEqual(
      records.filter((r) => r.database_url_present),
      [],
      `${detail}`,
    )
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})
