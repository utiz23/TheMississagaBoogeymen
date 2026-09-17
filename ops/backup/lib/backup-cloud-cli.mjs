/**
 * Proton Drive CLI subprocess boundary — THE PRODUCTION API.
 *
 * WHAT THIS MODULE IS
 * --------------------
 * The only route by which this repository would ever spawn the Proton Drive
 * CLI. It constructs argv for exactly four single-operation commands,
 * verifies the configured binary hash pin before touching an operand or a
 * child process, spawns with a bounded, no-shell, no-TTY boundary, and turns
 * whatever the CLI said into one of a closed set of normalized, allowlisted
 * results. See `docs/planning/proton-drive-cloud-transport-architecture.md`
 * §2, §6-8, §10-12 for the design this implements.
 *
 * All of that logic lives in `internal/backup-cloud-cli-core.mjs`. This file
 * is deliberately thin: it binds the real dependencies and re-exports the
 * pure constants and argv constructors, nothing more. Read the core's
 * docblock for the boundary's invariants, evidence disclosures, ordering
 * guarantees, and the limitations it does NOT close.
 *
 * EXPORTED SURFACE — CLOSED, NO EXCEPTIONS
 * --------------------------------------------
 * Exactly eleven names (E3J6A): `CLOUD_CLI_ERROR_CODES`,
 * `FORBIDDEN_ARGV_TOKENS`, `buildInfoArgv`, `buildCreateFolderArgv`,
 * `buildUploadArgv`, `buildDownloadArgv`, `buildContainedDownloadArgv`,
 * `runInfo`, `runCreateFolder`, `runUpload`, `runContainedDownload`.
 * Nothing here accepts an arbitrary operation name, an alternate argv
 * builder, or a dependency of any kind.
 *
 * E3J6A REMOVED the uncontained `runDownload`. The only download route is
 * `runContainedDownload`, which executes the pinned RLIMIT_FSIZE wrapper in
 * front of the pinned CLI with the exact per-role limit. `buildDownloadArgv`
 * remains exported only as the pure inner argv the contained builder wraps;
 * no exported function spawns it on its own.
 *
 * NO DEPENDENCY INJECTION ON ANY PRODUCTION ROUTE (E3J4C)
 * ----------------------------------------------------------
 * E3J4/E3J4A/E3J4B let every one of the four operations take a
 * caller-supplied `deps` object, merged over module defaults, which could
 * replace `sha512File`, `spawn`, `env`, `statSync`, and the capture
 * ceilings. A caller could therefore bypass the real executable hash,
 * substitute the process implementation, redirect the credential
 * environment, fabricate local filesystem evidence, or disable output
 * bounding — all through the public call signature. Removing E3J4A's
 * `runOperationForTests()` closed only the arbitrary-argv part of that seam.
 *
 * The four operations below destructure exactly their real parameters. The
 * word `deps` appears nowhere in their signatures or bodies; a `deps`
 * property on a caller's argument object is inert — never read, never
 * merged, never forwarded. `OPERATIONS` is built once, at module load, bound
 * to `REAL_CLI_DEPS`: the real streaming SHA-512, the real
 * `child_process.spawn`, the real `fs.lstatSync`, the real `process.env`,
 * and the module's own capture ceilings.
 *
 * What that claims, precisely — and what it does not:
 *
 *   - production exports accept and forward NO dependency overrides;
 *   - this wrapper binds only `REAL_CLI_DEPS`, once;
 *   - `makeCloudCliOperations()` in the core is an explicitly internal TEST
 *     SEAM, not a cryptographic or runtime access-control boundary, and is
 *     never described as one;
 *   - a static regression in `backup-cloud-cli.test.mjs` fails if any
 *     `ops/**` module other than this one, `backup-cloud-containment.mjs`
 *     (E3J6A), and their test files imports the core;
 *   - malicious local repository code is OUTSIDE this boundary's threat
 *     model — anything able to add an import already has arbitrary
 *     execution. The defended property is that an ordinary production
 *     caller of these four operations cannot, through the call signature,
 *     substitute the hash, the process, the environment, the local
 *     evidence, or the bounds.
 *
 * CALL ORDERING (T22)
 * ---------------------
 * Each operation, in this order: (1) validate the local call inputs —
 * `signal` before anything reads `.aborted`, then `credentials`, `timeouts`,
 * capture limits, and any operation-specific local input such as upload's
 * `expectedLocalSizeBytes` — and check the cancellation state; (2) compute
 * the executable's real SHA-512 and verify the configured pin; (3) only then
 * validate the operation's operands, build the fixed argv, and spawn.
 * Hashing is not the literal first action — step 1 precedes it — but no
 * operand is inspected, no argv constructed, and no child spawned until the
 * hash gate has passed. **Hashing proves only that the file read at hash
 * time had the pinned content; the post-hash executable-replacement TOCTOU
 * window is not closed here and is not claimed to be.**
 */

import {
  CLOUD_CLI_ERROR_CODES,
  FORBIDDEN_ARGV_TOKENS,
  REAL_CLI_DEPS,
  buildContainedDownloadArgv,
  buildCreateFolderArgv,
  buildDownloadArgv,
  buildInfoArgv,
  buildUploadArgv,
  makeCloudCliOperations,
} from './internal/backup-cloud-cli-core.mjs'

export {
  CLOUD_CLI_ERROR_CODES,
  FORBIDDEN_ARGV_TOKENS,
  buildContainedDownloadArgv,
  buildCreateFolderArgv,
  buildDownloadArgv,
  buildInfoArgv,
  buildUploadArgv,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const OPERATIONS = makeCloudCliOperations(REAL_CLI_DEPS)

/** `filesystem info <remotePath> --json`. Resolves to `success` (with `present`), `rejected`, or `indeterminate`. */
export async function runInfo({ remotePath, cli, credentials, timeouts, signal }) {
  return OPERATIONS.runInfo({ remotePath, cli, credentials, timeouts, signal })
}

/** `filesystem create-folder <parentPath> <name> --json`. */
export async function runCreateFolder({ parentPath, name, cli, credentials, timeouts, signal }) {
  return OPERATIONS.runCreateFolder({ parentPath, name, cli, credentials, timeouts, signal })
}

/**
 * `filesystem upload --json <localFilePath> <remoteParentPath>`.
 *
 * `expectedLocalSizeBytes` is REQUIRED caller-supplied local evidence, and a
 * one-file transfer whose reported byte count disagrees with it is
 * `upload_size_mismatch`, never success. See the core's
 * `assertValidExpectedLocalSize()` for exactly what that cross-check does
 * and does not prove, and for E3J5's obligation to derive the value safely.
 */
export async function runUpload({
  localFilePath,
  remoteParentPath,
  expectedLocalSizeBytes,
  cli,
  credentials,
  timeouts,
  signal,
}) {
  return OPERATIONS.runUpload({
    localFilePath,
    remoteParentPath,
    expectedLocalSizeBytes,
    cli,
    credentials,
    timeouts,
    signal,
  })
}

/**
 * `<wrapper> --fsize=N:N -- <cli> filesystem download --json <remotePath> <localDir>` (E3J6A).
 *
 * `maxFileBytes` is the applicable per-role readback ceiling, applied as both
 * the soft and the hard RLIMIT_FSIZE. `wrapper` is `{executable,
 * expectedSha512}` and is hash-gated after the CLI and before any operand is
 * inspected. `expectedLocalPath` must be the canonical immediate child of
 * `localDir` whose basename equals `remotePath`'s, must be proven absent
 * (without following a symlink) before the command runs, and must be a
 * regular file of the reported size afterwards.
 *
 * `provider_termination_unconfirmed` means the child may still exist — the
 * caller must not touch `localDir`. `download_containment_tripped` (SIGXFSZ
 * observed) and `download_containment_violated` (a clean report of a file
 * larger than the limit) are indeterminate. A clean success of exactly
 * `maxFileBytes` is still a success; this boundary does not verify content.
 */
export async function runContainedDownload({
  remotePath,
  localDir,
  expectedLocalPath,
  maxFileBytes,
  wrapper,
  cli,
  credentials,
  timeouts,
  signal,
}) {
  return OPERATIONS.runContainedDownload({
    remotePath,
    localDir,
    expectedLocalPath,
    maxFileBytes,
    wrapper,
    cli,
    credentials,
    timeouts,
    signal,
  })
}
