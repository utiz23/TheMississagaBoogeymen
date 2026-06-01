#!/usr/bin/env node
/**
 * WS5 — Worker integration-test DB isolation harness.
 *
 * Provisions a throwaway clone of the local dev Postgres, points DATABASE_URL at
 * it, runs the full worker test suite against the clone (serial), then drops it.
 * Both the in-process `db` singleton (which reads DATABASE_URL at import time) and
 * every `spawnSync`'d CLI (which inherits process.env) land on the clone, so the
 * live dev DB is never written.
 *
 * Why a clone, not a blank migrate-only DB: ~10 tests anchor on real ingested
 * match 250/463 data (FK parents + calibration gates) that migrations don't
 * recreate. A `pg_dump | psql` clone carries that data; ~5-10s/run on the 135MB
 * dev DB. A Postgres TEMPLATE clone is ruled out — the live worker holds
 * connections and TEMPLATE requires zero.
 *
 * Preconditions (guarded below, not assumed):
 *   - DATABASE_URL points at the local Dockerized Postgres (localhost/127.0.0.1).
 *     A local-but-non-Docker Postgres is explicitly unsupported (clone path is
 *     docker-exec-only).
 *   - The configured container is reachable.
 *   - Node >= 22 (recursive fs.readdirSync + native node --test).
 *
 * Usage:
 *   set -a && source .env && set +a   # primary: DATABASE_URL in env
 *   node apps/worker/scripts/with-test-db.mjs
 * (the wrapper also falls back to parsing repo-root .env if DATABASE_URL is unset)
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(scriptDir, '../../..')
const DIST_DIR = path.join(REPO_ROOT, 'apps/worker/dist')
const CONTAINER = process.env['TEST_DB_CONTAINER'] ?? 'eanhl-team-website-db-1'

function die(msg) {
  console.error(`[with-test-db] ERROR: ${msg}`)
  process.exit(1)
}

// ── 1. Resolve DATABASE_URL (env first, then a tiny inline .env parser) ────────

function loadDatabaseUrl() {
  if (process.env['DATABASE_URL']) return process.env['DATABASE_URL']
  // No `dotenv` dependency in this repo — parse repo-root .env minimally.
  const envPath = path.join(REPO_ROOT, '.env')
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      if (key !== 'DATABASE_URL') continue
      let val = line.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      return val
    }
  }
  return undefined
}

const databaseUrl = loadDatabaseUrl()
if (!databaseUrl) {
  die('DATABASE_URL is unset. Run `set -a && source .env && set +a` first, or set DATABASE_URL.')
}

// ── 2. Preconditions + derive names ────────────────────────────────────────────

let url
try {
  url = new URL(databaseUrl)
} catch {
  die(`DATABASE_URL is not a valid URL: ${databaseUrl}`)
}

const host = url.hostname
if (host !== 'localhost' && host !== '127.0.0.1') {
  die(
    `refusing to run: DATABASE_URL host is "${host}", expected localhost/127.0.0.1. ` +
      `This harness clones via docker exec against the local container and must never ` +
      `touch a remote/prod DB.`,
  )
}

const dbUser = decodeURIComponent(url.username || 'eanhl')
const srcDb = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'eanhl'
if (!srcDb) die('could not derive source database name from DATABASE_URL')

const testDb = `eanhl_test_${process.pid}_${Date.now().toString(36)}`

function dockerPsql(targetDb, statement) {
  return execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', dbUser, '-d', targetDb, '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  )
}

// Verify the container is reachable before any DDL.
try {
  execFileSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', dbUser], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (err) {
  die(
    `container "${CONTAINER}" not reachable (pg_isready failed). ` +
      `Is it running? Override with TEST_DB_CONTAINER. Detail: ${err?.message ?? err}`,
  )
}

// ── 3. Provision the clone ──────────────────────────────────────────────────────

let created = false
let child = null

function dropClone() {
  if (!created) return
  try {
    dockerPsql('postgres', `DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`)
    created = false
    console.error(`[with-test-db] dropped clone ${testDb}`)
  } catch (err) {
    console.error(`[with-test-db] WARN: failed to drop clone ${testDb}: ${err?.message ?? err}`)
  }
}

// Signal-safe teardown: with an async spawn the event loop stays free, so these
// handlers actually fire on Ctrl-C (a blocking spawnSync would have starved them,
// leaking the clone). Kill the child first, then drop the clone synchronously.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    dropClone()
    process.exit(130)
  })
}

// Safety net: drop clones leaked by a previously hard-killed run (a kill mid
// dump/restore can outrun teardown). Best-effort — never block the run on it.
//
// A clone is swept only if it is BOTH (a) unconnected and (b) older than
// SWEEP_MIN_AGE_MS. Neither alone is safe against a concurrent run: an in-use
// clone briefly has zero connections between tests / during teardown (so the
// connection check races), and a concurrent run's clone is recent (so the age
// check protects it). The clone name encodes its creation time as a base36 ms
// timestamp (eanhl_test_<pid>_<base36ms>); a real run never lasts SWEEP_MIN_AGE_MS,
// so any clone older than that with no connections is a genuine orphan.
const SWEEP_MIN_AGE_MS = 2 * 60 * 60 * 1000 // 2h ≫ a full suite run
function cloneAgeMs(name) {
  const ts = parseInt(name.slice(name.lastIndexOf('_') + 1), 36)
  return Number.isFinite(ts) && ts > 0 ? Date.now() - ts : NaN
}
try {
  const candidates = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', dbUser, '-d', 'postgres', '-tA', '-c',
      "SELECT datname FROM pg_database d WHERE datname LIKE 'eanhl_test_%' " +
        'AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const s of candidates) {
    const age = cloneAgeMs(s)
    // Skip unparseable names (be conservative) and anything recent enough to be
    // a concurrent run's clone.
    if (!Number.isFinite(age) || age < SWEEP_MIN_AGE_MS) continue
    try {
      dockerPsql('postgres', `DROP DATABASE IF EXISTS "${s}" WITH (FORCE)`)
      console.error(`[with-test-db] swept stale clone ${s} (age ${Math.round(age / 60000)}m)`)
    } catch {
      /* leave it; not fatal */
    }
  }
} catch {
  /* sweep is best-effort */
}

console.error(`[with-test-db] cloning ${srcDb} -> ${testDb} (container ${CONTAINER})`)
try {
  dockerPsql('postgres', `DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`)
  dockerPsql('postgres', `CREATE DATABASE "${testDb}"`)
  created = true
  // Pipe dump->restore entirely inside the container (fast, no host round-trip).
  // `set -o pipefail` so a pg_dump failure is NOT masked by psql exiting 0 (which
  // would leave a silently-partial clone). Values are passed as positional args
  // ($1=user $2=src $3=test) and quoted, so a db/user name with shell metachars
  // can't break or inject into the command.
  execFileSync(
    'docker',
    [
      'exec',
      CONTAINER,
      'bash',
      '-lc',
      'set -o pipefail; ' +
        'pg_dump -U "$1" --no-owner --no-privileges "$2" | ' +
        'psql -U "$1" -d "$3" -q -v ON_ERROR_STOP=1',
      'with-test-db', // $0
      dbUser, // $1
      srcDb, // $2
      testDb, // $3
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
} catch (err) {
  console.error(`[with-test-db] ERROR: clone failed: ${err?.message ?? err}`)
  dropClone()
  process.exit(1)
}

// ── 4. Build child env pointed at the clone ─────────────────────────────────────

const childUrl = new URL(databaseUrl)
childUrl.pathname = `/${testDb}`
const childEnv = { ...process.env, DATABASE_URL: childUrl.toString() }

// ── 5. Enumerate test files explicitly (no shell globstar) ──────────────────────

if (!existsSync(DIST_DIR)) {
  dropClone()
  die(`${DIST_DIR} not found — build first (pnpm --filter @eanhl/worker build).`)
}

const allTestFiles = readdirSync(DIST_DIR, { recursive: true })
  .filter((p) => typeof p === 'string' && p.endsWith('.test.js'))
  .map((p) => path.join(DIST_DIR, p))
  .sort()

// Positional args = test-file selectors (substring match), so the targeted
// workflow still works under isolation, e.g.
//   pnpm --filter worker test decoder-runs-cli
// No args → the full suite. Selectors match on the .test.js path (the .ts source
// name works too, since dist mirrors src). Matching is against the clone, so a
// targeted run is isolated the same as a full run.
const selectors = process.argv.slice(2)
const testFiles =
  selectors.length === 0
    ? allTestFiles
    : allTestFiles.filter((f) => selectors.some((s) => f.includes(s.replace(/\.ts$/, ''))))

if (selectors.length === 0) {
  console.error(`[with-test-db] discovered ${testFiles.length} test file(s) under apps/worker/dist`)
} else {
  console.error(
    `[with-test-db] selectors [${selectors.join(', ')}] matched ${testFiles.length}/${allTestFiles.length} file(s)`,
  )
}
if (testFiles.length === 0) {
  dropClone()
  die(
    selectors.length === 0
      ? 'no test files discovered — did the build run?'
      : `no test files matched selectors: ${selectors.join(', ')}`,
  )
}

// ── 6. Run the suite (serial) against the clone, then drop it ───────────────────

// `--test-force-exit`: backstop so a file that leaves the @eanhl/db pool open
// can't keep its child process alive after its tests complete. (Combined with
// the per-file `sql.end({ timeout })` teardowns, which prevent a hung after-hook
// in the first place.) Async spawn keeps the event loop free for signal handlers.
let status = 1
try {
  status = await new Promise((resolve) => {
    child = spawn(
      process.execPath,
      ['--test', '--test-force-exit', '--test-concurrency=1', ...testFiles],
      { cwd: REPO_ROOT, env: childEnv, stdio: 'inherit' },
    )
    child.on('error', (err) => {
      console.error(`[with-test-db] ERROR: failed to launch node --test: ${err?.message ?? err}`)
      resolve(1)
    })
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
} finally {
  child = null
  dropClone()
}

process.exit(status)
