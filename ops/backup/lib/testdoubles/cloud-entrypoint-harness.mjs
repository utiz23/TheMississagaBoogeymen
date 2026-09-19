/**
 * TEST DOUBLE — a harness executable for deterministic pre-lock signal tests.
 * **Not production, never activated, never scheduled.**
 *
 * It is `ops/backup/eanhl-backup-cloud.mjs` with exactly ONE dependency
 * substituted: the run core's pre-lock checkpoint. Everything else — the
 * entrypoint core, its real process-signal listeners, its real writers, the
 * real config loader, the real run lock, the real containment canary, and
 * the real attempt — is the production binding.
 *
 * The gated checkpoint writes `HARNESS-PRE-LOCK-READY` to stderr and then
 * waits for one line on stdin before taking the production one-turn yield.
 * A test can therefore deliver a REAL signal to this process at a point that
 * is provably after listener installation and config loading and provably
 * before lock acquisition, wait until the entrypoint reports the
 * cancellation, and only then release the gate. Synchronous JavaScript is
 * never interrupted: the signal is dispatched while this process is idle on
 * stdin.
 *
 * Production cannot reach this substitution: the executable binds the
 * internal cores with their fixed real dependencies and accepts only argv.
 */

import fs from 'node:fs'

import {
  REAL_ENTRYPOINT_DEPS,
  makeCloudEntrypoint,
} from '../internal/backup-cloud-entrypoint-core.mjs'
import { REAL_RUN_DEPS, makeCloudRunner } from '../internal/backup-cloud-run-core.mjs'

async function gatedYieldBeforeLock() {
  fs.writeSync(2, 'HARNESS-PRE-LOCK-READY\n')
  await new Promise((resolve) => {
    process.stdin.once('data', () => resolve())
    process.stdin.resume()
  })
  process.stdin.pause()
  process.stdin.destroy()
  await REAL_RUN_DEPS.yieldBeforeLock()
}

const runner = makeCloudRunner({ ...REAL_RUN_DEPS, yieldBeforeLock: gatedYieldBeforeLock })
const entrypoint = makeCloudEntrypoint({
  ...REAL_ENTRYPOINT_DEPS,
  runCloudBackup: runner.runCloudBackup,
})

process.exitCode = await entrypoint.main(process.argv.slice(2))
