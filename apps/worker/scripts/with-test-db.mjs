#!/usr/bin/env node
/**
 * Verification-database isolation harness.
 *
 * Provisions a throwaway clone of an ATTESTED nonproduction PostgreSQL
 * database, points DATABASE_URL at that clone, runs either the worker test
 * suite (default) or an arbitrary command (`-- cmd ...`), then drops the clone.
 * Both the in-process `db` singleton (which reads DATABASE_URL at import time)
 * and every spawned CLI (which inherits process.env) land on the clone.
 *
 * SAFETY CONTRACT — see apps/worker/scripts/lib/test-db-guard.mjs for the full
 * threat model. In short:
 *   - The source DSN is TEST_DATABASE_URL and nothing else. The application
 *     DATABASE_URL is never read as a source and there is NO `.env` fallback.
 *   - TEST_DB_CONTAINER / TEST_DB_COMPOSE_PROJECT / TEST_DB_COMPOSE_SERVICE are
 *     mandatory and have no defaults.
 *   - Source and clone database names must be inside the approved
 *     `eanhl_{test,dev,ci,scratch}` namespace.
 *   - Before ANY CREATE/DROP DATABASE (stale-clone sweep included) the target
 *     container is inspected, its Compose labels matched exactly, its
 *     nonproduction label required, and the cluster `system_identifier` read
 *     BOTH over the network DSN and through `docker exec` and required to be
 *     identical. A loopback address alone proves nothing — an SSH tunnel forges
 *     it; the system identifier does not.
 *
 * Why a clone, not a blank migrate-only DB: ~10 tests anchor on real ingested
 * match 250/463 data (FK parents + calibration gates) that migrations don't
 * recreate. A `pg_dump | psql` clone carries that data.
 *
 * Required environment (no defaults, nothing sourced from `.env`):
 *   TEST_DATABASE_URL        postgresql://<user>:<pw>@127.0.0.1:<port>/eanhl_test
 *   TEST_DB_CONTAINER        e.g. eanhl-verify-test-db-test-1
 *   TEST_DB_COMPOSE_PROJECT  e.g. eanhl-verify-test
 *   TEST_DB_COMPOSE_SERVICE  e.g. db-test
 *
 * Usage:
 *   node apps/worker/scripts/with-test-db.mjs                 # full worker suite
 *   node apps/worker/scripts/with-test-db.mjs decoder-runs    # selector(s)
 *   node apps/worker/scripts/with-test-db.mjs -- bash -c '...' # arbitrary command
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCli } from './lib/cli.mjs'
import { dockerExec, dockerExecInherit, makeNetworkSystemIdentifier } from './lib/real-deps.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(scriptDir, '../../..')
const DIST_DIR = path.join(REPO_ROOT, 'apps/worker/dist')

// ── the child process, and signal-safe teardown ───────────────────────────────
//
// Signal handling stays HERE, in the production glue, rather than in the
// testable runner: it is the one place a forced `process.exit()` is correct,
// and it needs the live child handle.

let child = null
let cleanup = null

// With an async spawn the event loop stays free, so these handlers actually
// fire on Ctrl-C (a blocking spawnSync would starve them, leaking the clone).
// Kill the child first, then drop the clone synchronously.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    cleanup?.()
    process.exit(130)
  })
}

function runChild(cmd, args, childEnv) {
  return new Promise((resolve) => {
    child = spawn(cmd, args, { cwd: REPO_ROOT, env: childEnv, stdio: 'inherit' })
    child.on('error', (err) => {
      console.error(`[with-test-db] ERROR: failed to launch ${cmd}: ${err?.message ?? err}`)
      resolve(1)
    })
    child.on('exit', (code, signal) => {
      child = null
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}

// `process.exitCode` + natural termination, NOT `process.exit()`: the clone is
// already dropped by withTestDatabase's `finally`, nothing else holds the event
// loop (a registered signal listener does not ref it), and stderr — which is
// ASYNCHRONOUS when piped — gets to flush before the process ends.
process.exitCode = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  write: (line) => {
    console.error(line)
  },
  deps: {
    dockerExec,
    dockerExecInherit,
    networkSystemIdentifier: makeNetworkSystemIdentifier(REPO_ROOT),
    now: () => Date.now(),
    pid: process.pid,
    runChild,
    registerCleanup: (fn) => {
      cleanup = fn
    },
  },
  fs: { existsSync, readdirSync },
  path,
  distDir: DIST_DIR,
  nodeExecPath: process.execPath,
})
