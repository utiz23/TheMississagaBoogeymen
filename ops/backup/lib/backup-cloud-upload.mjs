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
 * WHAT IT IS NOT
 * ---------------
 * Not a verifier: the outcome has `verification: 'not_performed'` and no
 * verdict. E3J6 consumes it, performs readback, and derives the attestation
 * verdict independently. Not a writer of anything local: no attestation file,
 * no lock (`run.lockFile` is reserved for the entrypoint session whose lock
 * must span upload, readback, and attestation), no retry (`retry.*` is
 * reserved until the attestation writer exists). No entrypoint calls this
 * module, and nothing here is activated.
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
 * Run exactly one upload attempt.
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
