/**
 * One locked cloud-backup run — THE PRODUCTION API (E3J6C).
 *
 * A thin wrapper over `internal/backup-cloud-run-core.mjs`, bound once, at
 * module load, to `REAL_RUN_DEPS`: the real run lock
 * (`backup-cloud-run-lock.mjs`), the real containment canary
 * (`backup-cloud-containment.mjs`), the real attested attempt
 * (`backup-cloud-attempt.mjs`), the real clock, `crypto.randomBytes`, the
 * fixed one-turn pre-lock checkpoint, and the fixed abort-aware backoff. See
 * the core's docblock for the exact sequence.
 *
 * `runCloudBackup({config, artifactBase, signal})` accepts only those three
 * values. No dependency, clock, randomness source, yield, sleep, emitter, or
 * process object is accepted, and a `deps` property is inert. This module
 * installs NO signal listener and exports no way to install one — process
 * signal ownership belongs to the executable entrypoint alone. Cancellation
 * reaches a run only through the `AbortSignal` its caller owns.
 *
 * Nothing here activates, deploys, or schedules anything.
 */

import {
  CLOUD_ENTRYPOINT_EXIT_CLASSES,
  CLOUD_RUN_CONTAINMENT_STATES,
  CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE,
  CLOUD_RUN_LOCK_SUMMARY_STATES,
  CLOUD_RUN_OUTCOMES,
  CLOUD_RUN_PRELOCK_CODES,
  CLOUD_RUN_STOP_REASONS,
  CLOUD_RUN_SUMMARY_KIND,
  CLOUD_RUN_SUMMARY_SCHEMA_VERSION,
  REAL_RUN_DEPS,
  makeCloudRunner,
} from './internal/backup-cloud-run-core.mjs'

export {
  CLOUD_ENTRYPOINT_EXIT_CLASSES,
  CLOUD_RUN_CONTAINMENT_STATES,
  CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE,
  CLOUD_RUN_LOCK_SUMMARY_STATES,
  CLOUD_RUN_OUTCOMES,
  CLOUD_RUN_PRELOCK_CODES,
  CLOUD_RUN_STOP_REASONS,
  CLOUD_RUN_SUMMARY_KIND,
  CLOUD_RUN_SUMMARY_SCHEMA_VERSION,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const RUNNER = makeCloudRunner(REAL_RUN_DEPS)

/**
 * Run one locked cloud backup of one explicitly named artifact: acquire the
 * run lock, prove readback containment once, make bounded attested attempts
 * (automatic retry ONLY for the zero-transfer name-collision class), dispose
 * of the lock, and return the deeply frozen `CloudRunSummary`.
 *
 * @param {object} args
 * @param {object} args.config        a cloud config; re-validated here
 * @param {string} args.artifactBase  `<artifactPrefix>-<YYYYMMDDTHHMMSSZ>`
 * @param {AbortSignal} [args.signal] owned by the caller (the entrypoint)
 * @returns {Promise<object>} the deeply frozen summary
 * @throws {BackupError} `cloud_run_invalid_input` for malformed inputs only,
 *   before anything is created
 */
export async function runCloudBackup(args) {
  if (args === null || typeof args !== 'object') return RUNNER.runCloudBackup(args)
  const { config, artifactBase, signal } = args
  return RUNNER.runCloudBackup({ config, artifactBase, signal })
}
