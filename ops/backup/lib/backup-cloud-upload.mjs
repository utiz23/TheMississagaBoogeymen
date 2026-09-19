/**
 * Single-attempt Proton upload orchestration — THE PRODUCTION API (E3J5).
 *
 * WHAT THIS MODULE IS
 * --------------------
 * One call is exactly one upload attempt for one explicitly named producer
 * artifact: validate the local triple, derive a fresh attempt identity,
 * preflight and create the attempt's single remote folder
 * (`<remoteRoot>/<artifactBase>.<attemptId>`), and request the ciphertext,
 * checksum-sidecar, and manifest uploads in that order, stopping at the first
 * non-success. It returns a frozen, allowlisted, in-memory evidence object.
 * See `internal/backup-cloud-upload-core.mjs` for the full sequence, the
 * outcome's evidence semantics, and the limitations it does NOT close, and
 * `docs/planning/proton-drive-cloud-transport-architecture.md` §4, §8, §11-12.
 *
 * ONE-SHOT PREPARE / EXECUTE (E3J6A)
 * -------------------------------------
 * `prepareUploadAttempt({config, artifactBase, signal})` performs every
 * local step — including descriptor-based SHA-256 and byte evidence for all
 * three roles and the inclusive readback-ceiling check — and makes no
 * boundary call. It returns a frozen prepared object (`disposition: 'ready'`
 * with `sourceEvidence`, or `'refused'` with `refusal` and no evidence).
 * `executeUploadAttempt({prepared, signal})` consumes a prepared object from
 * THIS module exactly once, synchronously before its first `await`; any
 * reused, concurrent, forged, or foreign object fails locally with no
 * boundary call. `runUploadAttempt()` is the two in sequence.
 *
 * WHAT IT IS NOT
 * ---------------
 * Not a verifier: the outcome (schema v2) has `verification: 'not_performed'` and no
 * verdict. E3J6 consumes it, performs readback, and derives the attestation
 * verdict independently. Not a writer of anything local: no attestation file,
 * no lock (the run lock is E3J6C's `backup-cloud-run-lock.mjs`, held around
 * every attempt), no retry (bounded collision-only retry is E3J6C's run
 * core, one fresh attempt — and one fresh call here — per retry). This module
 * is reached only through the attested attempt; nothing here is activated.
 *
 * NO DEPENDENCY INJECTION ON THE PRODUCTION ROUTE
 * -------------------------------------------------
 * `ATTEMPT_RUNNER` is built once, at module load, bound to
 * `REAL_UPLOAD_DEPS`: read-only `fs` functions, `Date.now`,
 * `crypto.randomBytes`, `sha256File`, and the three public E3J4 operations
 * `runInfo`/`runCreateFolder`/`runUpload`. `runUploadAttempt()` destructures
 * exactly `config`, `artifactBase`, and `signal`; a `deps` property on the
 * caller's argument is inert — never read, merged, or forwarded. The
 * injectable factory in the core is an internal test seam, not an
 * access-control boundary; a static regression blocks any other `ops/**`
 * importer. Repository code able to add an import already has arbitrary
 * execution and is outside this threat model.
 */

import {
  CLOUD_UPLOAD_NAMESPACE_STATES,
  CLOUD_UPLOAD_OUTCOME_CODES,
  CLOUD_UPLOAD_STATUSES,
  CLOUD_UPLOAD_STEPS,
  CLOUD_UPLOAD_TRANSFER_STATES,
  REAL_UPLOAD_DEPS,
  makeUploadAttemptRunner,
} from './internal/backup-cloud-upload-core.mjs'

export {
  CLOUD_UPLOAD_NAMESPACE_STATES,
  CLOUD_UPLOAD_OUTCOME_CODES,
  CLOUD_UPLOAD_STATUSES,
  CLOUD_UPLOAD_STEPS,
  CLOUD_UPLOAD_TRANSFER_STATES,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const ATTEMPT_RUNNER = makeUploadAttemptRunner(REAL_UPLOAD_DEPS)

/**
 * Prepare one attempt: local validation and source evidence only.
 *
 * @param {object} args
 * @param {object} args.config
 * @param {string} args.artifactBase
 * @param {AbortSignal} [args.signal]
 * @returns {object} the frozen prepared object (synchronous)
 * @throws {BackupError} `cloud_upload_invalid_input` / `cloud_upload_attempt_id_failed`
 */
export function prepareUploadAttempt(args) {
  if (args === null || typeof args !== 'object') return ATTEMPT_RUNNER.prepareUploadAttempt(args)
  const { config, artifactBase, signal } = args
  return ATTEMPT_RUNNER.prepareUploadAttempt({ config, artifactBase, signal })
}

/**
 * Execute a prepared attempt exactly once.
 *
 * @param {object} args
 * @param {object} args.prepared  from `prepareUploadAttempt()` of THIS module
 * @param {AbortSignal} [args.signal]
 * @throws {BackupError} `cloud_upload_prepared_invalid` / `cloud_upload_prepared_reused`
 *   / `cloud_upload_invalid_input` — before any boundary call.
 */
export async function executeUploadAttempt(args) {
  if (args === null || typeof args !== 'object') return ATTEMPT_RUNNER.executeUploadAttempt(args)
  const { prepared, signal } = args
  return ATTEMPT_RUNNER.executeUploadAttempt({ prepared, signal })
}

/**
 * Release a genuine READY prepared attempt (E3J6B) that becomes blocked
 * before it can be executed — a record-session, intent, containment-proof,
 * capacity, or workspace failure discovered upstream of the first provider
 * call. Synchronous, makes NO provider call, and is mutually exclusive with
 * `executeUploadAttempt()`: whichever call reaches the prepared object's
 * registry entry first wins. A `refused` prepared object (a local
 * validation refusal from `prepareUploadAttempt()` itself) is never
 * discarded — it is always consumed through `executeUploadAttempt()`,
 * which makes zero provider calls for it by construction.
 *
 * @param {object} args
 * @param {object} args.prepared  from `prepareUploadAttempt()` of THIS module
 * @returns {object} a frozen `{kind, schemaVersion, attemptId}` acknowledgement
 * @throws {BackupError} `cloud_upload_prepared_invalid` / `cloud_upload_prepared_reused`
 */
export function discardPreparedUploadAttempt(args) {
  if (args === null || typeof args !== 'object')
    return ATTEMPT_RUNNER.discardPreparedUploadAttempt(args)
  const { prepared } = args
  return ATTEMPT_RUNNER.discardPreparedUploadAttempt({ prepared })
}

/**
 * Run exactly one upload attempt (prepare, then execute).
 *
 * @param {object} args
 * @param {object} args.config        a cloud config; re-validated with `validateCloudConfig()`
 * @param {string} args.artifactBase  `<artifactPrefix>-<YYYYMMDDTHHMMSSZ>`, under `config.artifact.sourceDir`
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<object>} the frozen attempt outcome (see the core's docblock)
 * @throws {BackupError} `cloud_upload_invalid_input` / `cloud_upload_attempt_id_failed`
 *   before any attempt exists; no boundary operation is called in either case.
 */
export async function runUploadAttempt(args) {
  // A non-object argument is refused by the core with its generic input error.
  if (args === null || typeof args !== 'object') return ATTEMPT_RUNNER.runUploadAttempt(args)
  const { config, artifactBase, signal } = args
  return ATTEMPT_RUNNER.runUploadAttempt({ config, artifactBase, signal })
}
