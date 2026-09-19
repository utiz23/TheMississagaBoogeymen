/**
 * Contained readback, workspace, capacity, and cleanup — THE PRODUCTION API
 * (E3J6B).
 *
 * A thin wrapper over `internal/backup-cloud-readback-core.mjs`, bound once,
 * at module load, to `REAL_READBACK_DEPS`. See that file's docblock for the
 * readback-session model and the per-role/cleanup algorithms.
 *
 * `establishReadbackSession()` binds, once, `readback.dir`'s identity AND the
 * complete operational authority of the readback: the validated CLI
 * executable and its hash pin, the credential backend, the operation and
 * cancellation timeouts, the three canonical remote object paths (derived
 * internally from the validated config, `artifactBase`, and `attemptId`), and
 * the validated source evidence with its per-role ceilings.
 * `proveReadbackCapacity()`, `setupAttemptWorkspace()`,
 * `readBackAttemptTriple()`, and `cleanupAttemptWorkspace()` all take the
 * SAME session and accept no replacement for any of it:
 * `readBackAttemptTriple({session, signal})` reads nothing else from its
 * argument. Workspace and role-directory identities (recorded as each is
 * created), downloaded-file identities, and whether any child had unconfirmed
 * termination are private session state — `cleanupAttemptWorkspace({session})`
 * takes no other argument, so a caller cannot forge an inode identity or
 * claim termination was confirmed. A session from any other factory instance
 * is refused.
 *
 * What sealing does NOT add: it does not close the executable
 * check-then-exec TOCTOU window E3J4 documents, and it does not strengthen
 * filesystem containment beyond E3J6A's lexical, identity, and rlimit checks.
 */

import {
  CLOUD_READBACK_CODES,
  REAL_READBACK_DEPS,
  makeReadbackRunner,
} from './internal/backup-cloud-readback-core.mjs'

export { CLOUD_READBACK_CODES }

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const READBACK = makeReadbackRunner(REAL_READBACK_DEPS)

/**
 * @param {object} args
 * @param {object} args.config
 * @param {string} args.artifactBase
 * @param {string} args.attemptId
 * @param {object} args.sourceEvidence  the ready prepared attempt's `sourceEvidence`
 * @returns {object} an opaque, frozen readback session
 * @throws {BackupError} `cloud_attempt_invalid_input` / `readback_dir_untrusted`
 */
export function establishReadbackSession(args) {
  if (args === null || typeof args !== 'object') return READBACK.establishReadbackSession(args)
  const { config, artifactBase, attemptId, sourceEvidence } = args
  return READBACK.establishReadbackSession({ config, artifactBase, attemptId, sourceEvidence })
}

/** @throws {BackupError} `record_session_invalid` / `readback_dir_identity_changed` */
export async function proveReadbackCapacity(args) {
  if (args === null || typeof args !== 'object') return READBACK.proveReadbackCapacity(args)
  return READBACK.proveReadbackCapacity({ session: args.session })
}

/** @throws {BackupError} `record_session_invalid` / `readback_dir_identity_changed` */
export async function setupAttemptWorkspace(args) {
  if (args === null || typeof args !== 'object') return READBACK.setupAttemptWorkspace(args)
  return READBACK.setupAttemptWorkspace({ session: args.session })
}

/**
 * Read back the triple using ONLY the session's sealed authority. Exactly two
 * properties of `args` are read; a `cli`, `credentials`, `timeouts`,
 * `remotePaths`, or `sourceEvidence` property is never read or forwarded.
 *
 * @param {object} args
 * @param {object} args.session
 * @param {AbortSignal} [args.signal]
 */
export async function readBackAttemptTriple(args) {
  if (args === null || typeof args !== 'object') return READBACK.readBackAttemptTriple(args)
  const { session, signal } = args
  return READBACK.readBackAttemptTriple({ session, signal })
}

/**
 * The ONLY signature this module exposes for cleanup: no `downloadedIdentity`,
 * no `terminationConfirmed` — both are private session state, never accepted
 * from a caller.
 *
 * @param {object} args
 * @param {object} args.session
 * @returns {Promise<{state: string}>}
 */
export async function cleanupAttemptWorkspace(args) {
  if (args === null || typeof args !== 'object') return READBACK.cleanupAttemptWorkspace(args)
  return READBACK.cleanupAttemptWorkspace({ session: args.session })
}
