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
const srcDb = url.pathname.replace(/^\//, '') || 'eanhl'
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

// Safety net: drop any clones leaked by a previously hard-killed run (a kill mid
// dump/restore can outrun teardown). Best-effort — never block the run on it.
try {
  const stale = execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', dbUser, '-d', 'postgres', '-tA', '-c',
      "SELECT datname FROM pg_database WHERE datname LIKE 'eanhl_test_%'"],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const s of stale) {
    try {
      dockerPsql('postgres', `DROP DATABASE IF EXISTS "${s}" WITH (FORCE)`)
      console.error(`[with-test-db] swept stale clone ${s}`)
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
  execFileSync(
    'docker',
    [
      'exec',
      CONTAINER,
      'bash',
      '-lc',
      `pg_dump -U ${dbUser} --no-owner --no-privileges ${srcDb} | ` +
        `psql -U ${dbUser} -d ${testDb} -q -v ON_ERROR_STOP=1`,
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

const testFiles = readdirSync(DIST_DIR, { recursive: true })
  .filter((p) => typeof p === 'string' && p.endsWith('.test.js'))
  .map((p) => path.join(DIST_DIR, p))
  .sort()

console.error(`[with-test-db] discovered ${testFiles.length} test file(s) under apps/worker/dist`)
if (testFiles.length === 0) {
  dropClone()
  die('no test files discovered — did the build run?')
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
