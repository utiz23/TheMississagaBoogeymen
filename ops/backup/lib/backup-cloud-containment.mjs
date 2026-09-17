/**
 * Readback containment canary — THE PRODUCTION API (E3J6A).
 *
 * WHAT THIS MODULE IS
 * --------------------
 * A thin wrapper over the fixed-purpose canary in
 * `internal/backup-cloud-cli-core.mjs` (`makeContainmentCanary`), bound once,
 * at module load, to `REAL_CANARY_DEPS`. It exposes exactly:
 *
 *   - `proveReadbackContainment({config, runId, signal})` — runs the pinned
 *     RLIMIT_FSIZE wrapper over the module-owned Node writer, with an empty
 *     environment, against a fresh `<readback.dir>/<runId>.containment-canary`
 *     directory, and returns either `{kind:'proven', proof, cleanup}` or
 *     `{kind:'refused', code, cleanup}` (both frozen, closed codes only);
 *   - `verifyContainmentProof({proof, config, runId})` — `true`, or a thrown
 *     generic `containment_proof_invalid`. Only a proof object produced by
 *     THIS module instance, whose binding still matches the configuration and
 *     the readback directory's current identity, is accepted;
 *   - `CONTAINMENT_PROOF_KIND`, `CONTAINMENT_REFUSAL_CODES`,
 *     `CONTAINMENT_CLEANUP_STATES`.
 *
 * The caller supplies no executable, argv, script, environment, spawn
 * implementation, filesystem dependency, or directory identity; a `deps` or
 * `readbackDirIdentity` property on the argument object is inert. The
 * readback directory is trusted only after this module observes it itself.
 *
 * WHAT A PROOF MEANS — AND WHAT IT DOES NOT
 * -------------------------------------------
 * The wrapper and the kernel enforced the smallest configured ceiling on the
 * readback filesystem for a Node child, during this run, and every canary
 * path was removed. It is not evidence about the Proton Drive CLI, about
 * larger limit values, about descendants of the CLI, or about another host;
 * that is the E3J10 deployment proof. `quota_mount` is refused
 * (`containment_unsupported`) until a verification exists for it. Nothing
 * consumes a proof yet (E3J6B), and nothing calls this module in production.
 */

import {
  CONTAINMENT_CLEANUP_STATES,
  CONTAINMENT_PROOF_KIND,
  CONTAINMENT_REFUSAL_CODES,
  REAL_CANARY_DEPS,
  makeContainmentCanary,
} from './internal/backup-cloud-cli-core.mjs'

export { CONTAINMENT_CLEANUP_STATES, CONTAINMENT_PROOF_KIND, CONTAINMENT_REFUSAL_CODES }

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const CANARY = makeContainmentCanary(REAL_CANARY_DEPS)

/**
 * @param {object} args
 * @param {object} args.config   a cloud config; re-validated here
 * @param {string} args.runId    `YYYYMMDDTHHMMSSZ-<8 hex>`
 * @param {AbortSignal} [args.signal]
 * @throws {BackupError} `cloud_cli_invalid_input` for malformed arguments only
 */
export async function proveReadbackContainment(args) {
  if (args === null || typeof args !== 'object') return CANARY.proveReadbackContainment(args)
  const { config, runId, signal } = args
  return CANARY.proveReadbackContainment({ config, runId, signal })
}

/** @throws {BackupError} `containment_proof_invalid` */
export function verifyContainmentProof(args) {
  if (args === null || typeof args !== 'object') return CANARY.verifyContainmentProof(args)
  const { proof, config, runId } = args
  return CANARY.verifyContainmentProof({ proof, config, runId })
}
