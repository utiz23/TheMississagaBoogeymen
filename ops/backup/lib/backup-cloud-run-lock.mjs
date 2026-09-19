/**
 * Cloud-backup run lock — THE PRODUCTION API (E3J6C).
 *
 * A thin wrapper over `internal/backup-cloud-run-lock-core.mjs`, bound once,
 * at module load, to `REAL_RUN_LOCK_DEPS`. See that file's docblock for the
 * lock-file schema, the acquisition boundaries and their residue, and the
 * pre-unlink versus post-unlink release semantics.
 *
 * The caller supplies no filesystem dependency, clock, randomness source,
 * hostname, pid, or directory identity; a `deps` property on an argument
 * object is inert. Only a handle returned by THIS module's
 * `acquireRunLock()` authorizes anything.
 *
 * Nothing here removes, rewrites, renames, or reclaims a lock it did not
 * create, and nothing ever removes acquisition residue automatically.
 */

import {
  CLOUD_RUN_LOCK_ACQUIRE_KINDS,
  CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES,
  CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES,
  CLOUD_RUN_LOCK_CEILING_BYTES,
  CLOUD_RUN_LOCK_CONTENTION_REFUSAL_CODES,
  CLOUD_RUN_LOCK_HELD_CODES_BY_STATE,
  CLOUD_RUN_LOCK_HELD_STATES,
  CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES,
  CLOUD_RUN_LOCK_KIND,
  CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE,
  CLOUD_RUN_LOCK_RELEASE_STATES,
  CLOUD_RUN_LOCK_RETAIN_REASONS,
  CLOUD_RUN_LOCK_RETAIN_REFUSAL_CODES,
  CLOUD_RUN_LOCK_RETAIN_STATES,
  CLOUD_RUN_LOCK_SCHEMA_VERSION,
  REAL_RUN_LOCK_DEPS,
  makeRunLock,
} from './internal/backup-cloud-run-lock-core.mjs'

export {
  CLOUD_RUN_LOCK_ACQUIRE_KINDS,
  CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES,
  CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES,
  CLOUD_RUN_LOCK_CEILING_BYTES,
  CLOUD_RUN_LOCK_CONTENTION_REFUSAL_CODES,
  CLOUD_RUN_LOCK_HELD_CODES_BY_STATE,
  CLOUD_RUN_LOCK_HELD_STATES,
  CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES,
  CLOUD_RUN_LOCK_KIND,
  CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE,
  CLOUD_RUN_LOCK_RELEASE_STATES,
  CLOUD_RUN_LOCK_RETAIN_REASONS,
  CLOUD_RUN_LOCK_RETAIN_REFUSAL_CODES,
  CLOUD_RUN_LOCK_RETAIN_STATES,
  CLOUD_RUN_LOCK_SCHEMA_VERSION,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const LOCK = makeRunLock(REAL_RUN_LOCK_DEPS)

/**
 * @param {object} args
 * @param {object} args.config        a cloud config; re-validated here
 * @param {string} args.cloudRunId    `YYYYMMDDTHHMMSSZ-<8 hex>`
 * @param {string} args.artifactBase
 * @returns {{kind: 'acquired', handle: object} | {kind: 'refused', code: string} |
 *   {kind: 'uncertain', code: string}}  frozen; `refused` = filesystem unchanged,
 *   `uncertain` = residue possible, never a handle
 * @throws {BackupError} `cloud_run_lock_invalid_input` for malformed arguments only
 */
export function acquireRunLock(args) {
  if (args === null || typeof args !== 'object') return LOCK.acquireRunLock(args)
  const { config, cloudRunId, artifactBase } = args
  return LOCK.acquireRunLock({ config, cloudRunId, artifactBase })
}

/** @returns {{state: 'held'|'lost'|'replaced'|'unverifiable', code: string|null}} frozen */
export function verifyRunLockHeld(args) {
  if (args === null || typeof args !== 'object') return LOCK.verifyRunLockHeld(args)
  const { handle } = args
  return LOCK.verifyRunLockHeld({ handle })
}

/** @returns {{state: string, code: string|null}} frozen; see `CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE` */
export function releaseRunLock(args) {
  if (args === null || typeof args !== 'object') return LOCK.releaseRunLock(args)
  const { handle } = args
  return LOCK.releaseRunLock({ handle })
}

/**
 * Keep the lock; writes nothing.
 *
 * @returns {{state: 'retained', reason: string} | {state: 'retain_refused', code: string}} frozen
 * @throws {BackupError} `lock_retain_reason_invalid` for a reason outside
 *   `CLOUD_RUN_LOCK_RETAIN_REASONS` (the reason is never echoed)
 */
export function retainRunLock(args) {
  if (args === null || typeof args !== 'object') return LOCK.retainRunLock(args)
  const { handle, reason } = args
  return LOCK.retainRunLock({ handle, reason })
}
