/**
 * Proton Drive CLI subprocess boundary — INTERNAL IMPLEMENTATION CORE.
 *
 * WHAT THIS FILE IS, AND WHY IT IS SEPARATE
 * ------------------------------------------
 * This module holds every line of the subprocess-boundary logic. It does NOT
 * bind its own real dependencies: `makeCloudCliOperations(deps)` builds the
 * four fixed operations against a supplied dependency set.
 *
 * `../backup-cloud-cli.mjs` is THE production API. It imports this file,
 * binds `REAL_CLI_DEPS` once at module load, and exposes four operations
 * whose signatures accept no dependency of any kind.
 *
 * WHAT THE SPLIT CLAIMS — AND WHAT IT DOES NOT (E3J4C)
 * ----------------------------------------------------
 * The production module necessarily imports this core, so the claim is NOT
 * "nothing in production imports the factory". The claims are exactly:
 *
 *   1. The production exports accept and forward NO dependency overrides.
 *      Hash, spawn, environment, local stat, and capture bounds are bound
 *      values, not parameters. A `deps` property on a production call's
 *      argument object is inert — never read, never merged, never forwarded.
 *   2. The production wrapper binds only `REAL_CLI_DEPS`, once, at module
 *      load.
 *   3. `makeCloudCliOperations()` is an explicitly internal TEST SEAM. It is
 *      not a cryptographic or runtime access-control boundary and must never
 *      be described as one.
 *   4. A static regression in `backup-cloud-cli.test.mjs` fails if any
 *      `ops/**` module other than `../backup-cloud-cli.mjs`,
 *      `../backup-cloud-containment.mjs` (E3J6A — the canary's thin wrapper,
 *      see `makeContainmentCanary()`), and their test files imports this
 *      core.
 *   5. Malicious local repository code is OUTSIDE this boundary's threat
 *      model — code that can add an import statement already has arbitrary
 *      execution. The property actually defended is that an ordinary
 *      production caller of the four operations cannot, through the call
 *      signature, substitute the executable hash, the process
 *      implementation, the child environment, the local filesystem
 *      evidence, or the capture bounds.
 *
 * This replaces the E3J4/E3J4A/E3J4B arrangement, in which the four
 * production entry points each accepted a caller-supplied `deps` object
 * merged over module defaults. Removing E3J4A's `runOperationForTests()`
 * closed the arbitrary-ARGV seam only; the larger dependency seam survived
 * until E3J4C. This file introduces no replacement command/spawn seam: the
 * factory still offers exactly four operations, each calling its own fixed
 * argv constructor. No operation name, argv builder, or command string is
 * accepted from anywhere.
 *
 * THE CENTRAL INVARIANT (§2.2 of the memo)
 * ------------------------------------------
 * Raw stdout, raw stderr, and the raw parsed JSON object never leave this
 * module. They are held in local variables inside this file, consumed by a
 * strict per-operation parser, and dropped. Nothing returns them, attaches
 * them to a thrown error's `message` or `cause`, or logs them. Every
 * returned result is one of exactly three shapes — `{kind: 'success',
 * ...allowlisted fields}`, `{kind: 'rejected', code, transferState:
 * 'definitely_zero'}`, or `{kind: 'indeterminate', code, transferState:
 * 'unknown'}` — built from FRESH, FROZEN object literals, never by spreading
 * a parsed provider object. `CLOUD_CLI_ERROR_CODES` is the complete, closed
 * set of `code` values a `rejected` or `indeterminate` result may carry;
 * nothing outside that list, and never provider-authored free text, appears
 * in any returned or thrown value.
 *
 * CALL ORDERING (T22), STATED PRECISELY
 * ---------------------------------------
 * Every one of the four operations performs, in this order:
 *
 *   1. validate the local call inputs (`signal` — validated BEFORE anything
 *      reads `.aborted` — then `credentials`, `timeouts`, capture limits,
 *      and any operation-specific local input such as upload's
 *      `expectedLocalSizeBytes`) and check the cancellation state;
 *   2. compute the executable's real SHA-512 and verify it against the
 *      configured pin via `verifyCliHashPin()` (`backup-cloud-config.mjs`,
 *      E3J3);
 *   3. only then validate the operation's own operands, build the fixed
 *      argv, and spawn.
 *
 * Hashing is therefore NOT the literal first action — local input
 * validation and the cancellation check precede it. What the ordering
 * guarantees is that no operand is inspected, no argv is constructed, and
 * no child is spawned until the hash gate has passed. The proof in
 * `backup-cloud-cli.test.mjs` uses no injected argv builder and no builder
 * spy: the SAME deliberately invalid operand yields the HASH error under a
 * mismatched pin and the OPERAND error under a matching one, and spawn is
 * observed not to be reached in the mismatch case.
 *
 * **Hashing proves only that the file read at hash time had the pinned
 * content.** It does NOT prove, and this module does not claim, that the
 * same bytes are what actually gets executed a moment later — a post-hash
 * executable-replacement (TOCTOU) window between the hash read and the
 * `spawn()` call remains open and is not closed by any control here.
 * Closing it is a deployment-ownership/immutability property.
 *
 * THE FOUR-OPERATION SURFACE, AND ITS EVIDENCE
 * -----------------------------------------------
 * Argv shape for `info`, `upload`, and `download` is directly evidenced in
 * `docs/planning/proton-drive-scratch-experiment.md` (§5 table and §7's raw
 * command log): `filesystem info <exact path> --json`,
 * `filesystem upload --json <local file> <remote parent>`,
 * `filesystem download --json <remote path> <local dir>`. `create-folder`'s
 * two positional arguments are evidenced the same way; `--json` on it is
 * this module's own inference (not captured with the flag in the scratch
 * session), made because `folderUid` is otherwise unobtainable. **That
 * remains an acknowledged design hypothesis, not verified real-CLI
 * behaviour.** No batch form, no conflict-strategy flag, no destructive or
 * enumeration operation, and no authentication command is ever
 * constructed — see `FORBIDDEN_ARGV_TOKENS` and its test coverage (T4, T5).
 *
 * RAW PROVIDER RESPONSE SHAPE — WHAT IS EVIDENCED AND WHAT IS DESIGN
 * ----------------------------------------------------------------------
 * The upload terminal summary shape — and the exact zero-transfer
 * `ValidationError: Name conflict on "…" (file) already exists` text — are
 * DIRECTLY quoted in `proton-drive-scratch-experiment.md` §7.4. The `info`
 * success sub-fields `claimedSize`, `claimedDigests.sha1` and `sha1Verified`
 * are directly evidenced in §7.1. The credential-failure two-line text
 * (§8.2, confirmed byte-identical at §8.3) and the not-found sentinels
 * (§8.3) are directly evidenced — but WHICH STREAM (stdout vs stderr)
 * carried them is not separately recorded by that prose, which is disclosed
 * explicitly at each classifier below rather than assumed silently.
 *
 * What is NOT independently evidenced by a captured raw JSON dump: the exact
 * top-level key spelling of a successful `info` response beyond those three
 * sub-fields, of a successful `create-folder` response, and of download's
 * own terminal-summary shape specifically (as opposed to the general
 * statement in §7.2 that covers it by description, not by a quoted blob).
 * For those, this module implements exactly the field names, types, and
 * trust levels the reviewed, corrected architecture memo's §2.3 table
 * specifies — treating that table as an authoritative design contract, not
 * as a claim of verified real-CLI compatibility. Because every unexpected
 * field, renamed field, or type mismatch is rejected as `indeterminate`
 * (never accepted as success), a schema that turns out not to match the real
 * CLI's exact raw spelling fails SAFE in production. Correcting any of these
 * schemas against a real captured response is deployment-session work
 * (E3J10+) requiring its own authorization to contact Proton.
 *
 * UPLOAD AND DOWNLOAD EVIDENCE CONTRACTS (E3J4C)
 * ------------------------------------------------
 * UPLOAD. `expectedLocalSizeBytes` is a REQUIRED, caller-supplied local
 * measurement, validated here as a non-negative safe integer. On an actual
 * one-file transfer the provider's `transferredBytes` must equal it, or the
 * result is `upload_size_mismatch` — the provider summary is never trusted
 * on its own. A `skippedItems: 1` response is NOT promoted to transport
 * success: without independently proven skip semantics and skipped-object
 * identity it fails closed as `upload_skipped_unverified`. What this does
 * NOT establish: that the caller measured the correct inode, that the value
 * corresponds to the file named by `localFilePath`, or anything at all about
 * local-file TOCTOU or filesystem immutability. E3J5 owes safe derivation
 * and validation of that value for each of the three local artifacts
 * (ciphertext, sidecar, manifest) before calling this boundary.
 *
 * DOWNLOAD. `expectedLocalPath` is not "any file that exists afterwards".
 * It must be the canonical IMMEDIATE CHILD of `localDir` whose basename
 * equals the queried remote path's basename, checked before any spawn; a
 * mismatched basename, a sibling, or a nested/outside path is refused
 * outright. The bound path is then `lstat`ed BEFORE the provider command
 * runs: only a definite ENOENT permits the spawn, an existing node of any
 * kind (including a dangling symlink) is `download_destination_exists` with
 * no spawn, and any other inability to establish absence is
 * `local_preflight_failed` with no spawn. After a clean response the same
 * bound path is `lstat`ed again (never `stat` — symlinks are not followed)
 * and must be a REGULAR file with a non-negative safe-integer size that the
 * provider's own reported byte count agrees with. Only an error's `code`
 * property is ever consulted; no native message, path, or errno text is
 * surfaced.
 *
 * CONTAINED DOWNLOAD (E3J6A). The uncontained download operation was
 * REMOVED. `runContainedDownload` is the only download: it hash-gates the
 * CLI and then the pinned RLIMIT_FSIZE wrapper, and executes
 * `<wrapper> --fsize=N:N -- <cli> filesystem download ...` with N the
 * caller's EXACT per-role ceiling (never N + 1). A SIGXFSZ close is
 * `download_containment_tripped` — supporting evidence only, never required,
 * since a child that ignores SIGXFSZ sees EFBIG instead. A clean report of a
 * file larger than N is `download_containment_violated`. A clean report of
 * exactly N stays a success: a legitimate object may be exactly the ceiling.
 * Whether the wrapper actually enforces N is not proven here; that is the
 * runtime canary's job (below) and, for the real CLI, E3J10's.
 *
 * What download still does NOT establish, and must not be described as
 * establishing: the absence check and the readback are two separate
 * observations, so the race between them is NOT closed; there is no
 * descriptor ownership; and the downloaded file's CONTENT is not verified
 * (E3J6B compares it against pre-upload evidence).
 *
 * TERMINATION EVIDENCE (E3J6A). When this module kills a child (timeout,
 * cancellation, overflow, stream failure, or a started child that emitted
 * `error`), only a `close` event inside the grace period confirms the end —
 * a known `exitCode`/`signalCode` does not, because a descendant may still
 * hold (and write to) the stdio. Otherwise the result is
 * `provider_termination_unconfirmed`. Every other result implies the child's
 * stdio closed or the child never started. The CLI's own descendants are not
 * tracked or killed as a group. This module deliberately does not use the
 * shared producer helper `cancelChild()`, whose contract is unchanged.
 *
 * THE ENVIRONMENT ALLOWLIST — WHAT IT BOUNDS, AND WHAT IT DOES NOT
 * -------------------------------------------------------------------
 * `ENV_ALLOWLIST` is a POSITIVE allowlist of key NAMES; everything else in
 * the parent environment is excluded. That is the entire guarantee. An
 * allowlisted variable's inherited VALUE is not trusted merely because its
 * name is allowed: `PATH`, `HOME` and the `XDG_*` paths, `GNUPGHOME`,
 * `PASSWORD_STORE_DIR`, the agent addresses, the locale variables, and
 * `TMPDIR` all remain deployment-controlled inputs. Their ownership, their
 * canonical values, and their behaviour under a service-mode (non-login,
 * non-interactive) run require E3J9/E3J10 proof, which does not exist yet.
 * E3J4 proves exclusion of non-allowlisted ambient variables only.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * --------------------------------------------
 * No attempt workflow, collision preflight, ordered triple upload, retry
 * loop, or lock ownership (E3J5/E3J6C). No readback workspace, content
 * verification, attestation schema or writer, and no download acceptance
 * claim (E3J6B). No generic command runner: the only processes this module
 * can start are the four fixed Proton operations and the fixed containment
 * canary. `--version` is never invoked, on any path, by this module.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { BackupError } from '../backup-artifact-contract.mjs'
import {
  assertCanonicalAbsolutePath,
  validateCloudConfig,
  verifyCliHashPin,
} from '../backup-cloud-config.mjs'
import {
  RUN_ID_PATTERN,
  assertSafeRemoteComponent,
  buildContainmentCanaryDirName,
  validateRemoteRoot,
} from '../backup-cloud-naming.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// The closed, machine-readable error/outcome code set.
//
// Every `rejected` or `indeterminate` result's `code` is one of exactly
// these. Nothing here is, or ever carries, provider-authored text — see the
// module docblock.
// ─────────────────────────────────────────────────────────────────────────────

export const CLOUD_CLI_ERROR_CODES = Object.freeze([
  // rejected — narrowly anchored, definite zero-transfer evidence only
  'name_conflict',
  'credential_unavailable',
  // indeterminate — everything uncertain defaults here (§2.2 invariant 5)
  'provider_spawn_failed',
  'provider_timeout',
  'provider_cancelled',
  'provider_output_overflow',
  'provider_stream_failed',
  'provider_response_malformed',
  'provider_response_unexpected_shape',
  'provider_stderr_on_success',
  'provider_error_unrecognised',
  // upload evidence (E3J4C) — the provider summary is never trusted alone
  'upload_size_mismatch',
  'upload_skipped_unverified',
  // download destination evidence (E3J4C)
  'download_destination_exists',
  'local_preflight_failed',
  'local_readback_missing',
  'local_readback_not_regular_file',
  'download_size_mismatch',
  // termination and containment evidence (E3J6A)
  'provider_termination_unconfirmed',
  'download_containment_tripped',
  'download_containment_violated',
])

/** Forbidden anywhere in a constructed argv — see §8.7 and §5 of the memo. */
const FORBIDDEN_ARGV_TOKENS = Object.freeze([
  // conflict strategy (T4)
  '-f',
  '--conflict-strategy',
  'create-new-revision',
  'rename',
  'replace',
  'skip',
  // destructive / enumeration / sharing / auth (T5)
  'trash',
  'delete',
  'empty-trash',
  'move',
  'copy',
  'sharing',
  'invitation',
  'list',
  'auth',
  'login',
  'logout',
  // never invoked at all by this module (§7.2, §6.2)
  'pass',
  'gpg',
  'gpg-agent',
  'secret-tool',
  '--version',
])

const DEFAULT_MAX_STDOUT_BYTES = 1_048_576 // 1 MiB — every real response here is a few KB at most
const DEFAULT_MAX_STDERR_BYTES = 262_144 // 256 KiB
/** Hard sanity ceiling for a `deps.maxStdoutBytes`/`maxStderrBytes` override. */
const HARD_MAX_CAPTURE_BYTES = 64 * 1024 * 1024 // 64 MiB

/** Opaque provider handle charset (§2.3 of the memo), e.g. a node or revision uid. */
const OPAQUE_HANDLE_PATTERN = /^[A-Za-z0-9_~-]{1,256}$/
const SHA1_HEX_PATTERN = /^[0-9a-f]{40}$/
const NODE_KIND_VALUES = new Set(['file', 'folder'])
const STATE_VALUES = new Set(['active', 'trashed'])

/**
 * A positive ALLOWLIST of environment variables the child process may
 * inherit (E3J4B correction 5) — replacing the E3J4A "copy everything,
 * delete six keys" approach, which still forwarded unrelated
 * credentials/tokens, `LD_PRELOAD` (capable of injecting code into the very
 * dynamically-linked binary the hash gate just verified), `NODE_OPTIONS`,
 * any inherited `PROTON_DRIVE_*` variable, and other ambient secrets.
 *
 * Each entry is justified by one of the four categories §7.2/§10.2(c) of
 * the memo actually needs:
 *   - `PATH` — executable lookup, if the CLI itself needs to locate a
 *     helper binary (e.g. `gpg`) via PATH rather than an absolute path;
 *   - `HOME`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
 *     `XDG_RUNTIME_DIR` — the default locations the CLI and the credential
 *     backend (`pass`'s `.password-store`, GnuPG's `.gnupg`) resolve
 *     relative to, and GnuPG's own agent-socket-directory algorithm;
 *   - `GNUPGHOME`, `GPG_AGENT_INFO`, `PASSWORD_STORE_DIR`,
 *     `DBUS_SESSION_BUS_ADDRESS` — reaching an ALREADY-RUNNING GPG or
 *     Secret-Service agent connection (the latter for a `keychain`
 *     backend on a D-Bus desktop), never unlocking one;
 *   - `LANG`, `LC_ALL`, `LC_CTYPE`, `TMPDIR` — locale and a controlled
 *     temporary directory, as this correction's own brief names explicitly.
 *
 * WHAT THIS ALLOWLIST DOES AND DOES NOT PROVE (E3J4C)
 * -----------------------------------------------------
 * It is an allowlist of key NAMES. Its entire guarantee is that a variable
 * whose name is not on this list is excluded from the child environment.
 *
 * An allowlisted variable's inherited VALUE is NOT trusted merely because
 * its name is allowed. `PATH` (which decides what a bare-name helper
 * resolves to), `HOME` and the `XDG_*` locations, `GNUPGHOME`,
 * `PASSWORD_STORE_DIR`, `GPG_AGENT_INFO`/`DBUS_SESSION_BUS_ADDRESS` (agent
 * addresses), `LANG`/`LC_ALL`/`LC_CTYPE`, and `TMPDIR` all remain
 * DEPLOYMENT-CONTROLLED INPUTS. Who owns those paths and sockets, what
 * their canonical values must be, and how they behave under a service-mode
 * (non-login, non-interactive, possibly empty-environment) run are
 * E3J9/E3J10 questions with no proof in this repository yet.
 *
 * This allowlist is likewise NOT evidence that the eventual Hotel-Echo
 * credential mechanism (U1, still open) will use any of these — it only
 * bounds what THIS boundary is willing to forward if configured with a
 * `pass`/`keychain` backend on a host shaped like the ones tested so far.
 */
const ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'HOME',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  'GNUPGHOME',
  'GPG_AGENT_INFO',
  'PASSWORD_STORE_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
])

/** Build the child's environment from `ENV_ALLOWLIST` plus the validated backend selector. Nothing else survives. */
function buildChildEnv(baseEnv, credentials) {
  const env = {}
  const base = baseEnv ?? {}
  for (const key of ENV_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(base, key)) env[key] = base[key]
  }
  env.PROTON_DRIVE_CREDENTIALS_STORE = credentials.backend
  return env
}

// ─────────────────────────────────────────────────────────────────────────────
// Immutability: every result this module returns is frozen, including any
// array-valued field.
// ─────────────────────────────────────────────────────────────────────────────

function freezeResult(result) {
  for (const value of Object.values(result)) {
    if (Array.isArray(value)) Object.freeze(value)
  }
  return Object.freeze(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Local input validation: every thrown error here is one stable, locally
// authored `BackupError` — never a native `fs`/type-coercion error, never an
// echo of the invalid value itself (E3J4B correction 6).
// ─────────────────────────────────────────────────────────────────────────────

function invalidInput(what) {
  throw new BackupError('cloud_cli_invalid_input', `${what} is invalid.`)
}

function argvInvalid(what) {
  throw new BackupError('cloud_cli_argv_invalid', `${what} is not a valid argument.`)
}

/** Positive safe integers only, and (E3J4B) the same coherence rule `backup-cloud-config.mjs` enforces for the producer config. */
function assertValidTimeouts(timeouts) {
  if (timeouts === null || typeof timeouts !== 'object') return invalidInput('timeouts')
  const { operationTimeoutMs, cancelGraceMs } = timeouts
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs <= 0) {
    return invalidInput('timeouts.operationTimeoutMs')
  }
  if (!Number.isSafeInteger(cancelGraceMs) || cancelGraceMs <= 0) {
    return invalidInput('timeouts.cancelGraceMs')
  }
  if (cancelGraceMs >= operationTimeoutMs) {
    return invalidInput('timeouts.cancelGraceMs')
  }
}

/** Exactly `pass` or `keychain` — re-validated at this boundary, never `unsafe_file` or anything else. */
function assertValidCredentials(credentials) {
  if (credentials === null || typeof credentials !== 'object') return invalidInput('credentials')
  if (credentials.backend !== 'pass' && credentials.backend !== 'keychain') {
    return invalidInput('credentials.backend')
  }
}

/**
 * Upload's required `expectedLocalSizeBytes` — CALLER-SUPPLIED local
 * evidence (E3J4C). Validated here as a non-negative safe integer and
 * nothing more.
 *
 * This boundary does not derive the value, cannot prove the caller measured
 * the correct inode, cannot prove the value corresponds to the file named by
 * `localFilePath`, and closes no local-file TOCTOU window. E3J5 owes safe
 * derivation and validation for each of the three local artifacts before
 * calling this boundary — the artifact contract records
 * `manifest.ciphertext.bytes` but no authoritative sidecar or manifest size.
 */
function assertValidExpectedLocalSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) return invalidInput('expectedLocalSizeBytes')
  return value
}

function assertValidCaptureLimit(value, what) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > HARD_MAX_CAPTURE_BYTES) {
    return invalidInput(what)
  }
  return value
}

/**
 * Validates `signal` BEFORE anything checks `.aborted` (E3J4B correction 7):
 * the E3J4A code checked `signal?.aborted` first, so a plain object like
 * `{aborted: true}` was accepted as a real cancellation without ever being
 * validated as an actual `AbortSignal`.
 */
function assertValidSignal(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) return invalidInput('signal')
}

function assertValidCliShape(cli) {
  if (
    cli === null ||
    typeof cli !== 'object' ||
    typeof cli.executable !== 'string' ||
    cli.executable === ''
  ) {
    return invalidInput('cli.executable')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Argv operand validators. Every operand this module hands to `spawn()` is
// either a canonical absolute path (local or remote) or a safe single
// component — never an arbitrary nonempty string — and none may begin with
// `-`, so the real CLI's own argument parser cannot reinterpret a
// caller-supplied value as an option even though no shell is ever involved.
// Every rejection is a fixed, generic message naming only the field
// identity — never the invalid value (E3J4B correction 6).
// ─────────────────────────────────────────────────────────────────────────────

/** True if any `/`-delimited segment of `path` begins with `-`. */
function hasOptionLikeSegment(path) {
  return path
    .split('/')
    .slice(1)
    .some((segment) => segment.startsWith('-'))
}

/**
 * A canonical absolute LOCAL path operand — reuses E3J3's exact
 * `assertCanonicalAbsolutePath()` rule (imported from
 * `backup-cloud-config.mjs`) rather than duplicating it, then additionally
 * rejects any segment beginning with `-`. Spaces, quotes, and `*` inside an
 * otherwise-valid segment are NOT rejected — see T3. The underlying
 * validator's own message (which would name the invalid value) is
 * deliberately discarded; only its pass/fail result is used.
 */
function assertSafeLocalPathOperand(value, what) {
  if (typeof value !== 'string' || value === '' || !value.startsWith('/')) {
    return argvInvalid(what)
  }
  let canonical = true
  try {
    assertCanonicalAbsolutePath(value, what)
  } catch {
    canonical = false
  }
  if (!canonical || hasOptionLikeSegment(value)) {
    return argvInvalid(what)
  }
  return value
}

/**
 * A canonical absolute REMOTE path operand — reuses E3J3's
 * `validateRemoteRoot()` for canonicality and per-component safety, then
 * additionally rejects any segment beginning with `-`.
 */
function assertSafeRemotePathOperand(value, what) {
  let validated = null
  try {
    validated = validateRemoteRoot(value)
  } catch {
    return argvInvalid(what)
  }
  for (const segment of validated.segments) {
    if (segment.startsWith('-')) return argvInvalid(what)
  }
  return value
}

/** A single safe remote component (e.g. a create-folder name) — reuses E3J3's `assertSafeRemoteComponent()`, plus the same leading-`-` rejection. */
function assertSafeOperandComponent(value, what) {
  let checked = null
  try {
    checked = assertSafeRemoteComponent(value, what)
  } catch {
    return argvInvalid(what)
  }
  if (checked.startsWith('-')) return argvInvalid(what)
  return checked
}

/** The basename (final `/`-delimited segment) of an already-validated absolute path. */
function basenameOf(absolutePath) {
  const segments = absolutePath.split('/')
  return segments[segments.length - 1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Argv constructors — pure, deterministic, one operation each.
// ─────────────────────────────────────────────────────────────────────────────

/** `filesystem info <exact path> --json` (§8.3 of the memo; evidenced verbatim). */
export function buildInfoArgv({ executable, remotePath }) {
  assertSafeLocalPathOperand(executable, 'executable')
  assertSafeRemotePathOperand(remotePath, 'remotePath')
  return [executable, 'filesystem', 'info', remotePath, '--json']
}

/**
 * `filesystem create-folder <parent> <name> --json`.
 *
 * The two positional arguments are evidenced verbatim (§5 of the scratch
 * experiment); `--json` is this module's own addition — see the module
 * docblock's "THE FOUR-OPERATION SURFACE" section for why, and its
 * evidence-boundary disclosure.
 */
export function buildCreateFolderArgv({ executable, parentPath, name }) {
  assertSafeLocalPathOperand(executable, 'executable')
  assertSafeRemotePathOperand(parentPath, 'parentPath')
  assertSafeOperandComponent(name, 'name')
  return [executable, 'filesystem', 'create-folder', parentPath, name, '--json']
}

/** `filesystem upload --json <local file> <remote parent>` — one file per invocation (§8.7). */
export function buildUploadArgv({ executable, localFilePath, remoteParentPath }) {
  assertSafeLocalPathOperand(executable, 'executable')
  assertSafeLocalPathOperand(localFilePath, 'localFilePath')
  assertSafeRemotePathOperand(remoteParentPath, 'remoteParentPath')
  return [executable, 'filesystem', 'upload', '--json', localFilePath, remoteParentPath]
}

/** `filesystem download --json <exact remote path> <local dir>` — one file per invocation (§8.7). */
export function buildDownloadArgv({ executable, remotePath, localDir }) {
  assertSafeLocalPathOperand(executable, 'executable')
  assertSafeRemotePathOperand(remotePath, 'remotePath')
  assertSafeLocalPathOperand(localDir, 'localDir')
  return [executable, 'filesystem', 'download', '--json', remotePath, localDir]
}

/**
 * The contained download (E3J6A): the pinned RLIMIT_FSIZE wrapper, the EXACT
 * per-role limit as both soft and hard limit (so the child cannot raise it),
 * `--`, then exactly `buildDownloadArgv()`'s argv:
 *
 *   [wrapper, --fsize=N:N, --, cli, filesystem, download, --json, <remote>, <localDir>]
 *
 * `maxFileBytes` is the configured role ceiling itself — never ceiling + 1.
 */
export function buildContainedDownloadArgv({
  wrapperExecutable,
  maxFileBytes,
  executable,
  remotePath,
  localDir,
}) {
  assertSafeLocalPathOperand(wrapperExecutable, 'wrapperExecutable')
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    return argvInvalid('maxFileBytes')
  }
  const inner = buildDownloadArgv({ executable, remotePath, localDir })
  if (wrapperExecutable === executable) return argvInvalid('wrapperExecutable')
  return [wrapperExecutable, `--fsize=${maxFileBytes}:${maxFileBytes}`, '--', ...inner]
}

// ─────────────────────────────────────────────────────────────────────────────
// The hash gate — strictly before argv construction or spawn.
// ─────────────────────────────────────────────────────────────────────────────

function sha512FileReal(filePath) {
  try {
    const hash = createHash('sha512')
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.allocUnsafe(1 << 20)
      for (;;) {
        const read = fs.readSync(fd, buf, 0, buf.length, null)
        if (read === 0) break
        hash.update(buf.subarray(0, read))
      }
    } finally {
      fs.closeSync(fd)
    }
    return hash.digest('hex')
  } catch {
    // A missing file, a permissions failure, a directory instead of a file —
    // none of that native `fs` detail (path, errno, message) may escape. One
    // stable code, no cause, regardless of the underlying error.
    throw new BackupError(
      'cli_executable_unreadable',
      'the configured CLI executable could not be read for hashing.',
    )
  }
}

/**
 * The REAL dependency set. `../backup-cloud-cli.mjs` binds exactly this
 * object, once, at module load. It is the only dependency set any production
 * route uses; no production operation signature accepts or honours an
 * override of any of these.
 *
 * `lstatSync` — never `statSync`: download's local evidence must not follow
 * a symlink, either when establishing the destination's absence before the
 * spawn or when measuring the written file afterwards.
 */
export const REAL_CLI_DEPS = Object.freeze({
  sha512File: sha512FileReal,
  spawn: nodeSpawn,
  lstatSync: (p) => fs.lstatSync(p),
  env: process.env,
  maxStdoutBytes: DEFAULT_MAX_STDOUT_BYTES,
  maxStderrBytes: DEFAULT_MAX_STDERR_BYTES,
})

/**
 * THE hash gate. Throws `BackupError` (`cli_executable_unreadable` if the
 * file cannot be hashed at all, or `cli_hash_pin_malformed` /
 * `cli_hash_observed_malformed` / `cli_hash_mismatch` from
 * `verifyCliHashPin()`, E3J3) before returning. Every production entry point
 * calls this immediately after the pre-hash cancellation check, before
 * touching an argv builder or `deps.spawn`. See also "WHAT HASHING DOES NOT
 * PROVE" in the module docblock — this is not a TOCTOU-closing control.
 */
function assertCliIdentity({ cli, deps }) {
  assertValidCliShape(cli)
  const observedSha512 = deps.sha512File(cli.executable)
  verifyCliHashPin({ expectedSha512: cli.expectedSha512, observedSha512 })
}

function assertValidWrapperShape(wrapper) {
  if (
    wrapper === null ||
    typeof wrapper !== 'object' ||
    typeof wrapper.executable !== 'string' ||
    wrapper.executable === '' ||
    typeof wrapper.expectedSha512 !== 'string'
  ) {
    return invalidInput('wrapper')
  }
}

/**
 * The SAME gate for the RLIMIT_FSIZE wrapper (E3J6A), which also sits in the
 * exec chain. Runs after the CLI gate and before any operand is inspected.
 * Every failure is one stable code with no native text; the same
 * post-hash replacement TOCTOU caveat as the CLI applies.
 */
function assertWrapperIdentity({ wrapper, deps }) {
  let observedSha512
  try {
    observedSha512 = deps.sha512File(wrapper.executable)
  } catch {
    throw new BackupError(
      'rlimit_wrapper_unreadable',
      'the configured RLIMIT_FSIZE wrapper could not be read for hashing.',
    )
  }
  try {
    verifyCliHashPin({ expectedSha512: wrapper.expectedSha512, observedSha512 })
  } catch {
    throw new BackupError(
      'rlimit_wrapper_hash_mismatch',
      'the RLIMIT_FSIZE wrapper does not match its configured pin.',
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Termination that is confirmed ONLY by `close` (E3J6A correction).
//
// The shared producer helper `cancelChild()` treats a child whose `exitCode`
// or `signalCode` is already set as ended and returns at once. For this
// boundary that is not enough: a process can have exited while a descendant
// still holds its stdout/stderr — and may still be writing — and `close` is
// the only event that says the stdio is gone. So this module does not use
// `cancelChild()`. It sends the same SIGTERM, escalates to SIGKILL at the
// same point (half the grace period), bounds the wait to the same grace
// period, and resolves `true` only if `close` was observed.
// ─────────────────────────────────────────────────────────────────────────────

function terminateAwaitingClose(child, graceMs, closeWatch) {
  return new Promise((resolve) => {
    if (closeWatch.seen) return resolve(true)
    let done = false
    let escalate = null
    let expire = null
    const end = (confirmed) => {
      if (done) return
      done = true
      clearTimeout(escalate)
      clearTimeout(expire)
      closeWatch.onClose = null
      resolve(confirmed)
    }
    closeWatch.onClose = () => end(true)
    // A kill that throws or reports "not delivered" proves nothing about the
    // stdio; only `close` (or the bounded expiry) settles this.
    try {
      child.kill('SIGTERM')
    } catch {
      /* keep waiting for close */
    }
    escalate = setTimeout(
      () => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* keep waiting for close */
        }
      },
      Math.max(10, Math.floor(graceMs / 2)),
    )
    expire = setTimeout(() => end(false), Math.max(20, graceMs))
    escalate.unref?.()
    expire.unref?.()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Bounded, no-shell, no-TTY subprocess capture. PRIVATE — its result is
// consumed by the classifiers below and never returned to a caller of this
// module. Never resolves with a raw `stdout`/`stderr` on any non-`exited`
// outcome (spawn-error / timeout / overflow / stream-failed / cancelled).
// ─────────────────────────────────────────────────────────────────────────────

function spawnCapturingBounded({
  command,
  args,
  env,
  timeoutMs,
  cancelGraceMs,
  maxStdoutBytes,
  maxStderrBytes,
  spawnImpl,
  signal,
}) {
  return new Promise((resolve) => {
    // Recheck immediately before spawning — the one place a signal that
    // fired during hashing/argv-construction is still caught before a child
    // is ever created.
    if (signal?.aborted) return resolve({ kind: 'cancelled' })

    let settled = false
    // Set to the REASON this module decided to kill the child, the moment
    // that decision is made — before SIGTERM is even sent.
    // The plain `close` handler below consults this so that a child which
    // dies BECAUSE we killed it is always reported as `terminating`'s
    // reason, never mistaken for an ordinary exit.
    let terminating = null
    let timeoutTimer = null
    let onAbort = null
    const stdoutChunks = []
    let stdoutBytes = 0
    const stderrChunks = []
    let stderrBytes = 0

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (onAbort && signal) signal.removeEventListener('abort', onAbort)
      resolve(result)
    }

    let child
    try {
      // No shell, ever — explicit, not merely the default. Argv is an
      // array, never a command string. Stdin is 'ignore' — the child cannot
      // prompt and has no controlling TTY to depend on. `env` is composed by
      // `invoke()` from `ENV_ALLOWLIST` plus the credentials selector —
      // this function never adds anything to it.
      child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env, shell: false })
    } catch {
      return finish({ kind: 'spawn-error' })
    }

    // Observed from the moment the child exists, before any path below can
    // begin a termination, so a `close` can never be missed.
    const closeWatch = { seen: false, onClose: null }
    try {
      child.once('close', () => {
        closeWatch.seen = true
        closeWatch.onClose?.()
      })
    } catch {
      return finish({ kind: 'spawn-error' })
    }

    // E3J6A: termination is confirmed only by `close` inside the bounded
    // grace period — never by a known `exitCode`/`signalCode`. Otherwise the
    // child, or a descendant still holding its stdio, may still exist and may
    // still be writing, so the result is `termination-unconfirmed`, never the
    // reason we started killing it.
    const beginTermination = (kind) => {
      if (terminating || settled) return
      terminating = kind
      terminateAwaitingClose(child, cancelGraceMs, closeWatch).then(
        (confirmed) => finish(confirmed ? { kind } : { kind: 'termination-unconfirmed' }),
        () => finish({ kind: 'termination-unconfirmed' }),
      )
    }

    timeoutTimer = setTimeout(() => beginTermination('timeout'), Math.max(1, timeoutMs))
    timeoutTimer.unref?.()

    onAbort = () => beginTermination('cancelled')
    if (signal) {
      if (signal.aborted) return beginTermination('cancelled')
      signal.addEventListener('abort', onAbort, { once: true })
    }

    // A child that never received a pid never started, so nothing can still
    // be running. One that did start is terminated through the same bounded
    // path as a timeout, so its end is confirmed (or reported unconfirmed)
    // rather than assumed (E3J6A).
    child.on('error', () => {
      let started = false
      try {
        started = Number.isSafeInteger(child.pid)
      } catch {
        started = true
      }
      if (started) beginTermination('spawn-error')
      else finish({ kind: 'spawn-error' })
    })

    child.stdout.on('data', (chunk) => {
      if (settled || terminating) return
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdoutBytes) {
        beginTermination('overflow')
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (settled || terminating) return
      stderrBytes += chunk.length
      if (stderrBytes > maxStderrBytes) {
        beginTermination('overflow')
        return
      }
      stderrChunks.push(chunk)
    })
    // A capture-stream failure must not let an incomplete-but-parseable
    // response through — it is terminated through the SAME bounded path as
    // timeout/overflow, never silently swallowed (E3J4B correction 8).
    child.stdout.on('error', () => beginTermination('stream-failed'))
    child.stderr.on('error', () => beginTermination('stream-failed'))

    child.on('close', (code, signalName) => {
      // If we decided to kill this child ourselves, `beginTermination`'s own
      // `terminateAwaitingClose(...)` continuation owns settling this promise —
      // with the REASON we killed it, not a fabricated exit code from the kill.
      if (terminating) return
      // `close` means the process ended and its stdio closed: termination is
      // confirmed. The terminating signal (E3J6A) is kept only so a
      // contained download can recognise SIGXFSZ as supporting evidence.
      finish({
        kind: 'exited',
        code,
        signal: typeof signalName === 'string' ? signalName : null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared invocation wrapper: composes env, runs the bounded capture, and
// collapses every non-clean outcome to a uniform `indeterminate` result.
// ─────────────────────────────────────────────────────────────────────────────

async function invoke({ argv, credentials, timeouts, deps, signal }) {
  const env = buildChildEnv(deps.env, credentials)
  const result = await spawnCapturingBounded({
    command: argv[0],
    args: argv.slice(1),
    env,
    timeoutMs: timeouts.operationTimeoutMs,
    cancelGraceMs: timeouts.cancelGraceMs,
    maxStdoutBytes: deps.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES,
    maxStderrBytes: deps.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
    spawnImpl: deps.spawn,
    signal,
  })
  if (result.kind === 'spawn-error') {
    return { kind: 'indeterminate', code: 'provider_spawn_failed', transferState: 'unknown' }
  }
  if (result.kind === 'timeout') {
    return { kind: 'indeterminate', code: 'provider_timeout', transferState: 'unknown' }
  }
  if (result.kind === 'cancelled') {
    // Stopping the local client proves nothing about the remote effect (§8.8).
    return { kind: 'indeterminate', code: 'provider_cancelled', transferState: 'unknown' }
  }
  if (result.kind === 'overflow') {
    return { kind: 'indeterminate', code: 'provider_output_overflow', transferState: 'unknown' }
  }
  if (result.kind === 'stream-failed') {
    return { kind: 'indeterminate', code: 'provider_stream_failed', transferState: 'unknown' }
  }
  if (result.kind === 'termination-unconfirmed') {
    // Never claims the child ended (E3J6A).
    return {
      kind: 'indeterminate',
      code: 'provider_termination_unconfirmed',
      transferState: 'unknown',
    }
  }
  return result // { kind: 'exited', code, signal, stdout, stderr } — consumed by a projector below, never returned as-is
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification and projection helpers, shared across operations.
// ─────────────────────────────────────────────────────────────────────────────

const PARSE_FAILED = Symbol('cloud-cli-parse-failed')

function safeJsonParse(text) {
  if (typeof text !== 'string' || text.trim() === '') return PARSE_FAILED
  try {
    return JSON.parse(text)
  } catch {
    return PARSE_FAILED
  }
}

function indeterminate(operation, code) {
  return freezeResult({ kind: 'indeterminate', operation, code, transferState: 'unknown' })
}

/** Strip at most one trailing newline — used only for exact-line anchoring, never for tolerance beyond that. */
function stripOneTrailingNewline(s) {
  return s.endsWith('\n') ? s.slice(0, -1) : s
}

/**
 * The complete, exact, two-line `pass`/GPG failure shape — the AUTHORITATIVE
 * raw text from `proton-drive-scratch-experiment.md` §8.2 (confirmed
 * byte-identical again at §8.3/E3I3), not the architecture memo's shortened
 * paraphrase (E3J4B correction 1: E3J4A used the shortened form, which does
 * not match the actual captured evidence and would never have fired against
 * a real occurrence of it). Evidenced specifically for
 * `credentials.backend === 'pass'`; this exact text is not evidenced for
 * `keychain`, so a `keychain` failure never matches this anchor and falls
 * through to `indeterminate`.
 */
const CREDENTIAL_UNAVAILABLE_LINES = [
  'Failed to load session in pass: gpg: public key decryption failed: No such file or directory',
  'gpg: decryption failed: No such file or directory',
]
const CREDENTIAL_UNAVAILABLE_TEXT = CREDENTIAL_UNAVAILABLE_LINES.join('\n')

/**
 * `null` when the anchor does not match; otherwise the (already-final)
 * rejected result.
 *
 * Requires ALL of: `credentials.backend === 'pass'` (the only backend this
 * text is evidenced for); exit code 1; stdout completely empty (so no
 * structured response can coexist with — or contradict — this
 * classification); and stderr equal to EXACTLY the two-line text above,
 * with at most one trailing newline and no other prefix, suffix, or extra
 * line.
 *
 * STREAM-ARRANGEMENT DISCLOSURE: the captured evidence records the failure
 * TEXT byte-for-byte but does not separately record which stream (stdout vs
 * stderr) carried it. This function assumes stderr, the conventional error
 * stream for a CLI failure with no JSON ever produced. If that assumption is
 * wrong for the real binary, the practical effect is that this
 * classification never fires in production (everything falls through to
 * `indeterminate`) — it can never cause a FALSE `credential_unavailable`,
 * only a missed one.
 */
function classifyCredentialFailure(operation, { code, stdout, stderr }, credentials) {
  if (credentials?.backend !== 'pass') return null
  if (code !== 1) return null
  if (stdout !== '') return null
  if (stripOneTrailingNewline(stderr) !== CREDENTIAL_UNAVAILABLE_TEXT) return null
  return freezeResult({
    kind: 'rejected',
    operation,
    code: 'credential_unavailable',
    transferState: 'definitely_zero',
  })
}

/** Fixed text, never templated with a name in any captured evidence (§7.3/§8.3). */
const TRASHED_NOT_FOUND_LINE = 'Trashed node not found'

/**
 * True only when EXACTLY ONE of stdout/stderr is, in its entirety (± one
 * trailing newline), the not-found sentinel evidenced for the QUERIED path,
 * and the OTHER stream is completely empty.
 *
 * `Node not found: <name>` is bound to the queried path's own basename — the
 * one captured example (§8.3) queried `/my-files/eanhl-e3-scratch-…` and got
 * back `Node not found: eanhl-e3-scratch-…`, i.e. the query's basename, not
 * its full path. Accepting `Node not found: <anything>` (the E3J4A
 * behaviour) would let a stale or unrelated response about a DIFFERENT node
 * be misread as "the path I asked about is absent" (E3J4B correction 2).
 *
 * `Trashed node not found` is accepted only when the query itself targeted
 * `/trash` or a path beneath it — every captured occurrence of this text
 * was for a trash-namespace query (§7.3, §8.3); treating it as a generic
 * active-namespace absence response would be exactly the kind of
 * over-generalisation those sections warn against.
 *
 * Same stream-arrangement disclosure as `classifyCredentialFailure()`
 * applies.
 */
function classifyNotFound(remotePath, stdout, stderr) {
  const a = stripOneTrailingNewline(stdout)
  const b = stripOneTrailingNewline(stderr)
  const basename = basenameOf(remotePath)
  const isTrashQuery = remotePath === '/trash' || remotePath.startsWith('/trash/')
  const isAnchor = (s) => {
    if (s === `Node not found: ${basename}`) return true
    if (isTrashQuery && s === TRASHED_NOT_FOUND_LINE) return true
    return false
  }
  if (isAnchor(a) && b === '') return true
  if (isAnchor(b) && a === '') return true
  return false
}

function exactKeySet(obj, expectedKeysSorted) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj).sort()
  if (keys.length !== expectedKeysSorted.length) return false
  return keys.every((k, i) => k === expectedKeysSorted[i])
}

// ── info ─────────────────────────────────────────────────────────────────────

const INFO_RAW_KEYS = [
  'activeRevisionUid',
  'claimedDigests',
  'claimedSize',
  'nodeKind',
  'nodeUid',
  'sha1Verified',
  'state',
].sort()

function projectInfoShape(parsed) {
  if (!exactKeySet(parsed, INFO_RAW_KEYS)) return null
  const { nodeUid, nodeKind, state, activeRevisionUid, claimedSize, claimedDigests, sha1Verified } =
    parsed
  if (typeof nodeUid !== 'string' || !OPAQUE_HANDLE_PATTERN.test(nodeUid)) return null
  if (typeof nodeKind !== 'string' || !NODE_KIND_VALUES.has(nodeKind)) return null
  if (typeof state !== 'string' || !STATE_VALUES.has(state)) return null
  if (activeRevisionUid !== null) {
    if (typeof activeRevisionUid !== 'string' || !OPAQUE_HANDLE_PATTERN.test(activeRevisionUid))
      return null
  }
  if (claimedSize !== null) {
    // SAFE integer, not merely integer: a provider-reported byte count above
    // 2^53-1 cannot be represented exactly by `JSON.parse`, so comparing or
    // echoing it would be comparing a rounded value (E3J4C).
    if (!Number.isSafeInteger(claimedSize) || claimedSize < 0) return null
  }
  if (!exactKeySet(claimedDigests, ['sha1'])) return null
  const sha1 = claimedDigests.sha1
  if (sha1 !== null) {
    if (typeof sha1 !== 'string' || !SHA1_HEX_PATTERN.test(sha1)) return null
  }
  if (typeof sha1Verified !== 'boolean' && sha1Verified !== null) return null
  return {
    nodeKind,
    nodeUid,
    state,
    activeRevisionUid,
    claimedSizeBytes: claimedSize,
    claimedSha1: sha1,
    sha1Verified,
  }
}

function projectInfo(captured, { remotePath, credentials }) {
  if (captured.kind !== 'exited') return freezeResult({ ...captured, operation: 'info' })
  const { code, stdout, stderr } = captured
  // The not-found sentinel is plain text, not JSON, even with --json passed
  // (§8.3, evidenced verbatim) — checked before anything else.
  if (code === 1 && classifyNotFound(remotePath, stdout, stderr)) {
    return freezeResult({ kind: 'success', operation: 'info', present: false })
  }
  const credFail = classifyCredentialFailure('info', captured, credentials)
  if (credFail) return credFail
  if (code !== 0) return indeterminate('info', 'provider_error_unrecognised')
  if (stderr !== '') return indeterminate('info', 'provider_stderr_on_success')
  const parsed = safeJsonParse(stdout)
  if (parsed === PARSE_FAILED) return indeterminate('info', 'provider_response_malformed')
  const projected = projectInfoShape(parsed)
  if (projected === null) return indeterminate('info', 'provider_response_unexpected_shape')
  return freezeResult({ kind: 'success', operation: 'info', present: true, ...projected })
}

// ── create-folder ───────────────────────────────────────────────────────────

const CREATE_FOLDER_RAW_KEYS = ['created', 'folderUid'].sort()

function projectCreateFolder(captured, { credentials }) {
  if (captured.kind !== 'exited') return freezeResult({ ...captured, operation: 'create-folder' })
  const { code, stdout, stderr } = captured
  const credFail = classifyCredentialFailure('create-folder', captured, credentials)
  if (credFail) return credFail
  if (code !== 0) return indeterminate('create-folder', 'provider_error_unrecognised')
  if (stderr !== '') return indeterminate('create-folder', 'provider_stderr_on_success')
  const parsed = safeJsonParse(stdout)
  if (parsed === PARSE_FAILED) return indeterminate('create-folder', 'provider_response_malformed')
  if (!exactKeySet(parsed, CREATE_FOLDER_RAW_KEYS)) {
    return indeterminate('create-folder', 'provider_response_unexpected_shape')
  }
  // No `false` case exists for `created` (§2.3 of the memo): anything that
  // did not clearly succeed is indeterminate, never a typed rejection.
  if (parsed.created !== true)
    return indeterminate('create-folder', 'provider_response_unexpected_shape')
  if (typeof parsed.folderUid !== 'string' || !OPAQUE_HANDLE_PATTERN.test(parsed.folderUid)) {
    return indeterminate('create-folder', 'provider_response_unexpected_shape')
  }
  return freezeResult({
    kind: 'success',
    operation: 'create-folder',
    created: true,
    folderUid: parsed.folderUid,
  })
}

// ── upload / download shared terminal-summary shape ─────────────────────────
//
// Evidenced verbatim for UPLOAD in §7.4 of the scratch experiment. §7.2
// states, generally, that "Result semantics are a single terminal summary:
// {transferredItems, transferredBytes, skippedItems, failedItems,
// failures[]}" while discussing "Large-file behaviour" — the very section
// whose table also reports the download test's item/byte counts in the same
// style. Reusing this one shape for BOTH operations' raw-response validation
// is therefore a disclosed inference from that general statement for
// download specifically, not an independently captured download-only blob.
// It is used here only as a GATE; download's returned result never echoes
// any of these fields — see `projectDownload()`.

const TRANSFER_SUMMARY_RAW_KEYS = [
  'failedItems',
  'failures',
  'skippedItems',
  'transferredBytes',
  'transferredItems',
].sort()

function isFailureEntry(f) {
  return (
    f !== null &&
    typeof f === 'object' &&
    !Array.isArray(f) &&
    exactKeySet(f, ['error', 'name']) &&
    typeof f.name === 'string' &&
    typeof f.error === 'string'
  )
}

/** Strict shape/type validation only — no success/failure classification. Returns the parsed summary or `null`. */
function validateTransferSummaryShape(parsed) {
  if (!exactKeySet(parsed, TRANSFER_SUMMARY_RAW_KEYS)) return null
  const { transferredItems, transferredBytes, skippedItems, failedItems, failures } = parsed
  const zeroOrOne = (v) => v === 0 || v === 1
  if (!zeroOrOne(transferredItems) || !zeroOrOne(skippedItems) || !zeroOrOne(failedItems)) {
    return null
  }
  // SAFE integer, not merely integer — see the note in `projectInfoShape()`.
  if (!Number.isSafeInteger(transferredBytes) || transferredBytes < 0) return null
  if (!Array.isArray(failures) || !failures.every(isFailureEntry)) return null
  return { transferredItems, transferredBytes, skippedItems, failedItems, failures }
}

// ── upload ───────────────────────────────────────────────────────────────────

/** The exact zero-transfer conflict text, capturing the quoted name (§7.4, evidenced verbatim). */
const NAME_CONFLICT_PATTERN =
  /^ValidationError: Name conflict on "(.+)" \((file|folder)\) already exists$/

/**
 * The ONE narrowly anchored, definite-zero-transfer rejection. Requires, on
 * top of the exact counts and the anchored error-text pattern: exit 1,
 * stderr completely empty (E3J4B correction 3 — E3J4A did not check this,
 * so contradictory provider stderr could accompany an otherwise-matching
 * JSON body and still be classified as this definite outcome), and — the
 * other half of correction 3 — the failure entry's `name` field AND the
 * name embedded in its error text both equal the basename of the
 * CALLER-SUPPLIED `localFilePath`. Identity is never derived from provider
 * text alone: a conflict report naming a different file, even if otherwise
 * perfectly shaped, does not match.
 */
function classifyNameConflict({ code, stderr }, summary, localFilePath) {
  if (code !== 1) return false
  if (stderr !== '') return false
  const { transferredItems, transferredBytes, skippedItems, failedItems, failures } = summary
  if (transferredItems !== 0 || transferredBytes !== 0 || skippedItems !== 0) return false
  if (failedItems !== 1 || failures.length !== 1) return false
  const match = NAME_CONFLICT_PATTERN.exec(failures[0].error)
  if (!match) return false
  const basename = basenameOf(localFilePath)
  if (failures[0].name !== basename) return false
  if (match[1] !== basename) return false
  return true
}

/**
 * `expectedLocalSizeBytes` is the caller's own local measurement (validated
 * as a non-negative safe integer before the hash gate). An actual one-file
 * transfer must report exactly that many bytes, or the result is
 * `upload_size_mismatch`; a `skippedItems: 1` response is never promoted to
 * transport success. See `assertValidExpectedLocalSize()` for what this
 * cross-check does NOT prove.
 */
function projectUpload(captured, { credentials, localFilePath, expectedLocalSizeBytes }) {
  if (captured.kind !== 'exited') return freezeResult({ ...captured, operation: 'upload' })
  const { code, stdout, stderr } = captured
  const credFail = classifyCredentialFailure('upload', captured, credentials)
  if (credFail) return credFail
  if (code === 0 && stderr !== '') return indeterminate('upload', 'provider_stderr_on_success')
  const parsed = safeJsonParse(stdout)
  if (parsed === PARSE_FAILED) return indeterminate('upload', 'provider_response_malformed')
  const summary = validateTransferSummaryShape(parsed)
  if (summary === null) return indeterminate('upload', 'provider_response_unexpected_shape')
  const { transferredItems, transferredBytes, skippedItems, failedItems, failures } = summary

  // A clean terminal report — exit 0, nothing failed, no failure entries —
  // is the only thing that can reach a success or a skip classification at
  // all. A shape that only coincidentally looks like success on a nonzero
  // exit is not evidence of anything.
  if (code === 0 && failedItems === 0 && failures.length === 0) {
    // ONE FILE ACTUALLY TRANSFERRED. The provider's own byte count must
    // agree with the caller's local measurement; the summary is never
    // trusted on its own (E3J4C correction 2).
    if (transferredItems === 1 && skippedItems === 0) {
      if (transferredBytes !== expectedLocalSizeBytes) {
        return indeterminate('upload', 'upload_size_mismatch')
      }
      return freezeResult({
        kind: 'success',
        operation: 'upload',
        transferredItems,
        transferredBytes,
        skippedItems,
        failedItems: 0,
        failureCodes: [],
      })
    }
    // NOTHING TRANSFERRED, ONE ITEM SKIPPED. E3J4/E3J4A/E3J4B counted this
    // as success. It is not: no captured evidence establishes WHY the real
    // CLI skips an item, WHICH object it decided was already present, or
    // whether that object's content matches this artifact. Without proven
    // semantics and proven identity it fails closed (E3J4C correction 2).
    if (transferredItems === 0 && skippedItems === 1) {
      return indeterminate('upload', 'upload_skipped_unverified')
    }
  }
  if (classifyNameConflict(captured, summary, localFilePath)) {
    return freezeResult({
      kind: 'rejected',
      operation: 'upload',
      code: 'name_conflict',
      transferState: 'definitely_zero',
    })
  }
  return indeterminate('upload', 'provider_error_unrecognised')
}

// ── download ─────────────────────────────────────────────────────────────────

/**
 * The path `download` is allowed to accept as local evidence: the canonical
 * IMMEDIATE CHILD of `localDir` whose basename equals the QUERIED remote
 * path's basename (E3J4C correction 3).
 *
 * Both operands are already-validated canonical absolute paths (no trailing
 * separator, no repeated separator, no `.`/`..` segment), so exact string
 * equality against this construction is precisely "immediate child, correct
 * name" — it admits no sibling, no deeper descendant, no path outside
 * `localDir`, and no differently named file. Before E3J4C
 * `expectedLocalPath` was any canonical local path at all, so ANY file that
 * happened to exist after the command could be presented as the download's
 * evidence.
 */
function boundDownloadDestination(localDir, remotePath) {
  const base = basenameOf(remotePath)
  return localDir === '/' ? `/${base}` : `${localDir}/${base}`
}

/**
 * Establish, WITHOUT following a symlink and WITHOUT spawning anything, that
 * the bound destination does not already exist (E3J4C correction 3).
 *
 * Path binding alone cannot reject a pre-existing unrelated file sitting at
 * exactly the bound path — this check is what rejects it. Returns `null`
 * when absence is definitely established (and only then may the provider
 * command run); otherwise the already-final `indeterminate` result.
 *
 *   - a definite `ENOENT` — absence established, proceed;
 *   - any returned node (regular file, directory, symlink, dangling
 *     symlink, socket, anything) — `download_destination_exists`, no spawn;
 *   - any other failure to establish absence (`EACCES`, `ELOOP`, `ENOTDIR`,
 *     a `deps.lstatSync` that returns a non-object, a thrown value with no
 *     usable `code`) — `local_preflight_failed`, no spawn.
 *
 * Only the error's `code` property is ever consulted; no native message,
 * path, or errno text is read, returned, or attached.
 */
function assertDestinationAbsent(expectedLocalPath, deps) {
  let observed
  try {
    observed = deps.lstatSync(expectedLocalPath)
  } catch (err) {
    let code
    try {
      code = err?.code
    } catch {
      code = undefined
    }
    if (code === 'ENOENT') return null
    return indeterminate('download', 'local_preflight_failed')
  }
  if (observed === null || typeof observed !== 'object') {
    return indeterminate('download', 'local_preflight_failed')
  }
  return indeterminate('download', 'download_destination_exists')
}

/**
 * Defensive local-evidence validation of a post-command `lstat` result: it
 * must actually be a plausible `fs.Stats`-like object with a CALLABLE
 * `isFile` and a non-negative safe-integer `size`. A malformed result — or
 * one whose accessor throws — must never crash this function or let a
 * native/injected error message escape.
 *
 * Returns `null` when the result is unusable as evidence at all (→
 * `local_readback_missing`), or `{isFile, size}` with `isFile` the observed
 * boolean, so the caller can separate "no usable evidence" from "evidence
 * that this is not a regular file" (→ `local_readback_not_regular_file`).
 * Because the caller uses `lstat`, a SYMLINK reports `isFile() === false`
 * here and is rejected rather than silently resolved to its target.
 *
 * Both observations are made EXACTLY ONCE, each inside its own `try`, and
 * every later check and the returned value use the captured local — never a
 * fresh property read. An earlier revision read `stat.size` three times (twice
 * to validate, once to return), so a throwing `size` accessor escaped this
 * function with its native message intact, and a stateful one could report a
 * valid size during validation and a different value on the way out.
 */
function validateLocalStat(stat) {
  if (stat === null || typeof stat !== 'object') return null
  if (typeof stat.isFile !== 'function') return null
  let isFile
  try {
    isFile = stat.isFile()
  } catch {
    return null
  }
  if (typeof isFile !== 'boolean') return null
  let size
  try {
    size = stat.size
  } catch {
    return null
  }
  if (!Number.isSafeInteger(size) || size < 0) return null
  return { isFile, size }
}

/**
 * Validates download's own terminal-summary output against the SAME shape
 * as upload's (see the shared-shape note above) as a GATE — an unambiguous,
 * single-item, zero-failure/zero-skip summary is required before the local
 * evidence below is even consulted. `deps.lstatSync` is then the local
 * filesystem evidence, applied to the BOUND destination path (already
 * proven, before the spawn, to be the correctly named immediate child of
 * `localDir` and to have been absent) — never a path parsed from provider
 * output. That path must now be a REGULAR file (a symlink reports
 * `isFile() === false` under `lstat` and is refused), with a non-negative
 * safe-integer size the provider's own reported byte count agrees with — a
 * disagreement is `download_size_mismatch`, never silently ignored and
 * never resolved in the provider's favour. The RETURNED result carries none
 * of the provider's own fields (§2.3 of the memo).
 *
 * STILL NOT PROVEN HERE (E3J6, unchanged by E3J4C): the pre-spawn absence
 * check and this readback are two separate observations, so the race
 * between them is not closed; no byte ceiling is enforced during the
 * transfer; no descriptor is owned; and the file's CONTENT is not verified.
 */
function projectDownload(captured, { expectedLocalPath, deps, credentials }) {
  if (captured.kind !== 'exited') return freezeResult({ ...captured, operation: 'download' })
  const { code, stdout, stderr } = captured
  const credFail = classifyCredentialFailure('download', captured, credentials)
  if (credFail) return credFail
  if (code === 0 && stderr !== '') return indeterminate('download', 'provider_stderr_on_success')
  const parsed = safeJsonParse(stdout)
  if (parsed === PARSE_FAILED) return indeterminate('download', 'provider_response_malformed')
  const summary = validateTransferSummaryShape(parsed)
  if (summary === null) return indeterminate('download', 'provider_response_unexpected_shape')
  const { transferredItems, transferredBytes, skippedItems, failedItems, failures } = summary

  const cleanSuccess =
    code === 0 &&
    transferredItems === 1 &&
    skippedItems === 0 &&
    failedItems === 0 &&
    failures.length === 0
  if (!cleanSuccess) return indeterminate('download', 'provider_error_unrecognised')

  let rawStat
  try {
    rawStat = deps.lstatSync(expectedLocalPath)
  } catch {
    return indeterminate('download', 'local_readback_missing')
  }
  const stat = validateLocalStat(rawStat)
  if (stat === null) return indeterminate('download', 'local_readback_missing')
  if (stat.isFile !== true) return indeterminate('download', 'local_readback_not_regular_file')
  if (transferredBytes !== stat.size) return indeterminate('download', 'download_size_mismatch')

  return freezeResult({
    kind: 'success',
    operation: 'download',
    localPath: expectedLocalPath,
    bytesWritten: stat.size,
    completed: true,
  })
}

/**
 * The contained download's projection (E3J6A). Same gates as
 * `projectDownload()`, plus the containment evidence this boundary can see:
 *
 *   - a child that ended on SIGXFSZ is `download_containment_tripped`
 *     (indeterminate). This is SUPPORTING evidence only — a child that
 *     ignores SIGXFSZ sees EFBIG instead and ends however it chooses, which
 *     lands in the ordinary non-clean classifications below; nothing here
 *     requires SIGXFSZ to have been observed;
 *   - an otherwise clean success whose regular file is LARGER than the
 *     enforced limit is `download_containment_violated` (indeterminate) —
 *     the bound did not hold;
 *   - a clean success whose size is EXACTLY the limit stays a success: a
 *     legitimate object may be exactly the configured ceiling. Whether it is
 *     the RIGHT object is the caller's hash comparison, not this boundary's.
 *
 * Every non-`exited` outcome (timeout, cancellation, overflow, stream
 * failure, spawn failure, unconfirmed termination) was already mapped by
 * `invoke()`; `provider_termination_unconfirmed` is the only one of those
 * that does not imply the child ended.
 */
function projectContainedDownload(
  captured,
  { expectedLocalPath, maxFileBytes, deps, credentials },
) {
  if (captured.kind === 'exited' && captured.signal === 'SIGXFSZ') {
    return indeterminate('download', 'download_containment_tripped')
  }
  const projected = projectDownload(captured, { expectedLocalPath, deps, credentials })
  if (projected.kind === 'success' && projected.bytesWritten > maxFileBytes) {
    return indeterminate('download', 'download_containment_violated')
  }
  return projected
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared per-call preparation and the four fixed operations.
// ─────────────────────────────────────────────────────────────────────────────

function cancelledResult(operation) {
  return freezeResult({
    kind: 'indeterminate',
    operation,
    code: 'provider_cancelled',
    transferState: 'unknown',
  })
}

/**
 * Step 1 of the T22 ordering: validate the LOCAL CALL INPUTS and the
 * cancellation state. Throws on any malformed input; never touches the
 * filesystem or a process. `signal` is validated FIRST — before anything
 * reads `.aborted` — so a plain object cannot be accepted as a real
 * cancellation signal.
 */
function prepareCall({ credentials, timeouts, deps }) {
  assertValidCredentials(credentials)
  assertValidTimeouts(timeouts)
  assertValidCaptureLimit(deps.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES, 'maxStdoutBytes')
  assertValidCaptureLimit(deps.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES, 'maxStderrBytes')
}

/**
 * Build the four fixed operations against a supplied dependency set.
 *
 * INTERNAL TEST SEAM — not a production route, and not an access-control
 * boundary of any kind. `../backup-cloud-cli.mjs` calls this exactly once,
 * with `REAL_CLI_DEPS`, and exposes operations whose signatures accept no
 * dependency at all; a `deps` property passed to one of those is inert. See
 * this file's docblock, "WHAT THE SPLIT CLAIMS — AND WHAT IT DOES NOT".
 *
 * This is NOT a renamed arbitrary-command seam: the returned object offers
 * exactly the four operations below, each calling its own fixed argv
 * constructor. No operation name, argv builder, or command string is
 * accepted here or anywhere else in this module.
 *
 * Each operation follows the same ordering, in this order and no other:
 *
 *   1. validate local call inputs (signal first, then credentials,
 *      timeouts, capture limits, and any operation-specific local input)
 *      and check cancellation;
 *   2. compute the real SHA-512 of the configured executable and verify the
 *      pin — nothing below this line runs if it fails;
 *   3. validate the operation's operands, build the fixed argv, spawn.
 *
 * Hashing is not the literal first action; step 1 precedes it. What the
 * ordering guarantees is that no operand is inspected, no argv built, and
 * no child spawned before the hash gate passes.
 */
export function makeCloudCliOperations(deps) {
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')

  async function runInfo({ remotePath, cli, credentials, timeouts, signal }) {
    assertValidSignal(signal)
    if (signal?.aborted) return cancelledResult('info')
    prepareCall({ credentials, timeouts, deps })
    assertCliIdentity({ cli, deps })
    const argv = buildInfoArgv({ executable: cli.executable, remotePath })
    const captured = await invoke({ argv, credentials, timeouts, deps, signal })
    return projectInfo(captured, { remotePath, credentials })
  }

  async function runCreateFolder({ parentPath, name, cli, credentials, timeouts, signal }) {
    assertValidSignal(signal)
    if (signal?.aborted) return cancelledResult('create-folder')
    prepareCall({ credentials, timeouts, deps })
    assertCliIdentity({ cli, deps })
    const argv = buildCreateFolderArgv({ executable: cli.executable, parentPath, name })
    const captured = await invoke({ argv, credentials, timeouts, deps, signal })
    return projectCreateFolder(captured, { credentials })
  }

  async function runUpload({
    localFilePath,
    remoteParentPath,
    expectedLocalSizeBytes,
    cli,
    credentials,
    timeouts,
    signal,
  }) {
    assertValidSignal(signal)
    if (signal?.aborted) return cancelledResult('upload')
    prepareCall({ credentials, timeouts, deps })
    // A local call input, not an argv operand — validated in step 1.
    assertValidExpectedLocalSize(expectedLocalSizeBytes)
    assertCliIdentity({ cli, deps })
    const argv = buildUploadArgv({ executable: cli.executable, localFilePath, remoteParentPath })
    const captured = await invoke({ argv, credentials, timeouts, deps, signal })
    return projectUpload(captured, { credentials, localFilePath, expectedLocalSizeBytes })
  }

  /**
   * The ONLY download this module offers (E3J6A). The uncontained
   * `runDownload` was removed from both this factory and the public module:
   * no route in this repository downloads without the pinned RLIMIT_FSIZE
   * wrapper and an exact per-role limit.
   *
   * Order: signal → local inputs (credentials, timeouts, capture limits,
   * `maxFileBytes`, wrapper shape) → CLI hash gate → wrapper hash gate →
   * operands (including the wrapper path) → destination binding → absence
   * proof (`lstat`, never following a symlink) → spawn.
   */
  async function runContainedDownload({
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
    assertValidSignal(signal)
    if (signal?.aborted) return cancelledResult('download')
    prepareCall({ credentials, timeouts, deps })
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) invalidInput('maxFileBytes')
    assertValidWrapperShape(wrapper)
    assertCliIdentity({ cli, deps })
    assertWrapperIdentity({ wrapper, deps })
    // Operand step. `buildContainedDownloadArgv()` validates the wrapper
    // path, the limit, `remotePath`, and `localDir`; `expectedLocalPath` is
    // then validated as a canonical local path AND bound to the exact
    // immediate child of `localDir` named by the queried remote basename, so
    // it cannot be an arbitrary file that merely exists once the command has
    // run.
    const argv = buildContainedDownloadArgv({
      wrapperExecutable: wrapper.executable,
      maxFileBytes,
      executable: cli.executable,
      remotePath,
      localDir,
    })
    assertSafeLocalPathOperand(expectedLocalPath, 'expectedLocalPath')
    if (expectedLocalPath !== boundDownloadDestination(localDir, remotePath)) {
      return argvInvalid('expectedLocalPath')
    }
    // Destination cleanliness, before any child exists: only a definite
    // absence permits the spawn.
    const blocked = assertDestinationAbsent(expectedLocalPath, deps)
    if (blocked) return blocked
    const captured = await invoke({ argv, credentials, timeouts, deps, signal })
    return projectContainedDownload(captured, {
      expectedLocalPath,
      maxFileBytes,
      deps,
      credentials,
    })
  }

  return Object.freeze({ runInfo, runCreateFolder, runUpload, runContainedDownload })
}

// ═════════════════════════════════════════════════════════════════════════════
// THE CONTAINMENT CANARY (E3J6A) — a fixed-purpose subprocess operation.
//
// It lives in this file, beside the private bounded spawn, precisely so no
// generic command runner has to exist anywhere. `makeContainmentCanary()`
// builds exactly two functions: `proveReadbackContainment()` and
// `verifyContainmentProof()`. Nothing in either accepts an executable, argv,
// script, environment, spawn implementation, or filesystem dependency from
// its caller — the wrapper comes only from validated configuration, and the
// Node interpreter and the writer script are module-owned.
//
// WHAT THE CANARY PROVES. Under the pinned wrapper with
// `--fsize=L:L` (L = the SMALLEST configured role ceiling), the fixed writer
// asks to write L + 64 KiB bytes into a fresh probe file. The canary passes
// only if, with termination CONFIRMED:
//   - the writer did NOT report a clean complete write (it exited with
//     CANARY_WRITER_EXIT_FILE_TOO_LARGE after EFBIG, or ended on SIGXFSZ —
//     SIGXFSZ is accepted but never required: Node ignores it and sees EFBIG);
//   - the probe is a regular file of EXACTLY L bytes (no larger, which is the
//     containment claim; and no smaller, which proves the writer actually
//     reached the limit rather than failing for another reason);
//   - every canary-owned path was then removed after exact identity checks.
// That is evidence that THIS wrapper plus THIS kernel enforce L on THIS
// filesystem for a Node child, now. It is NOT evidence about the Proton
// Drive CLI, about larger limit values, about the CLI's own descendants, or
// about any other host (E3J10).
//
// DIRECTORY TRUST IS OWNED HERE. The caller supplies no directory identity.
// `config.readback.dir` must be an existing directory, not a symlink, owned
// by the effective uid, with no group/world permission bits, whose real path
// is itself; its `{dev, ino}` is re-checked before every create and remove.
// These are lexical/ownership/mode observations, not proof that the deployed
// filesystem enforces those semantics, and the check-then-act windows are
// narrowed, not closed.
//
// NON-FORGEABLE PROOF. A successful run returns a frozen proof object that is
// also registered in a WeakMap private to the factory instance that made it.
// `verifyContainmentProof()` accepts only a registered object whose recorded
// binding (run id, readback directory identity, mechanism, wrapper path and
// pin, all three ceilings, limit) still matches the supplied configuration
// and the directory as it is NOW. A structurally identical copy, or a proof
// from another factory instance, is refused.
// ═════════════════════════════════════════════════════════════════════════════

export const CONTAINMENT_PROOF_KIND = 'eanhl.cloud-containment-proof'

export const CONTAINMENT_REFUSAL_CODES = Object.freeze([
  'containment_unsupported',
  'rlimit_wrapper_unverified',
  'readback_dir_untrusted',
  'canary_collision',
  'canary_setup_failed',
  'canary_cancelled',
  'containment_unproven',
  'containment_violated',
  'canary_cleanup_failed',
  'termination_unconfirmed',
])

export const CONTAINMENT_CLEANUP_STATES = Object.freeze([
  'not_started',
  'complete',
  'incomplete',
  'withheld_termination_unconfirmed',
])

/** The writer's exit status after EFBIG — the "limit refused my write" report. */
export const CANARY_WRITER_EXIT_FILE_TOO_LARGE = 3
const CANARY_OVERSHOOT_BYTES = 65_536
const CANARY_MAX_OUTPUT_BYTES = 4_096
const CANARY_PROBE_NAME = 'probe.bin'

/**
 * The fixed writer. Its only inputs are its two argv operands (the probe
 * path and the byte count to attempt), both constructed by this module. It
 * creates the probe exclusively without following a symlink, writes until
 * done or refused, and reports: 0 = every byte written (a CLEAN complete
 * write — the canary fails), 3 = EFBIG, 4 = any other failure, 5 = bad
 * operands.
 */
export const CANARY_SCRIPT = [
  "'use strict'",
  "const fs = require('fs')",
  'const [target, totalText] = process.argv.slice(1)',
  'const total = Number(totalText)',
  'if (typeof target !== "string" || !target.startsWith("/") || !Number.isSafeInteger(total) || total <= 0) process.exit(5)',
  'const c = fs.constants',
  'let fd',
  'try { fd = fs.openSync(target, c.O_WRONLY | c.O_CREAT | c.O_EXCL | c.O_NOFOLLOW, 0o600) } catch { process.exit(4) }',
  'const chunk = Buffer.alloc(65536, 0x5a)',
  'let written = 0',
  'try {',
  '  while (written < total) written += fs.writeSync(fd, chunk, 0, Math.min(chunk.length, total - written))',
  '} catch (e) { process.exit(e && e.code === "EFBIG" ? 3 : 4) }',
  'process.exit(0)',
].join('\n')

/**
 * `[wrapper, --fsize=L:L, --, node, --input-type=commonjs, -e, CANARY_SCRIPT, probe, total]`.
 * Every element is validated or module-owned; exported for argv-shape tests.
 */
export function buildCanaryArgv({ wrapperExecutable, limitBytes, nodeExecutable, probePath }) {
  assertSafeLocalPathOperand(wrapperExecutable, 'wrapperExecutable')
  assertSafeLocalPathOperand(nodeExecutable, 'nodeExecutable')
  assertSafeLocalPathOperand(probePath, 'probePath')
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) return argvInvalid('limitBytes')
  const total = limitBytes + CANARY_OVERSHOOT_BYTES
  if (!Number.isSafeInteger(total)) return argvInvalid('limitBytes')
  return [
    wrapperExecutable,
    `--fsize=${limitBytes}:${limitBytes}`,
    '--',
    nodeExecutable,
    '--input-type=commonjs',
    '-e',
    CANARY_SCRIPT,
    probePath,
    String(total),
  ]
}

/** The REAL canary dependency set, bound once by `../backup-cloud-containment.mjs`. */
export const REAL_CANARY_DEPS = Object.freeze({
  sha512File: sha512FileReal,
  spawn: nodeSpawn,
  lstat: (p) => fs.lstatSync(p, { bigint: true }),
  realpath: (p) => fs.realpathSync(p),
  mkdir: (p, mode) => fs.mkdirSync(p, { mode }),
  chmod: (p, mode) => fs.chmodSync(p, mode),
  unlink: (p) => fs.unlinkSync(p),
  rmdir: (p) => fs.rmdirSync(p),
  geteuid: () => process.geteuid(),
  nodeExecutable: process.execPath,
  now: () => Date.now(),
})

function assertValidCanaryDeps(deps) {
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')
  for (const name of [
    'sha512File',
    'spawn',
    'lstat',
    'realpath',
    'mkdir',
    'chmod',
    'unlink',
    'rmdir',
    'geteuid',
    'now',
  ]) {
    if (typeof deps[name] !== 'function') return invalidInput('deps')
  }
  if (typeof deps.nodeExecutable !== 'string') return invalidInput('deps')
}

function errnoOf(err) {
  try {
    return typeof err?.code === 'string' ? err.code : undefined
  } catch {
    return undefined
  }
}

function joinDir(dir, name) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

/**
 * Build the canary against a supplied dependency set.
 *
 * INTERNAL TEST SEAM — `../backup-cloud-containment.mjs` calls this exactly
 * once, with `REAL_CANARY_DEPS`. Proofs are registered per instance.
 */
export function makeContainmentCanary(deps) {
  assertValidCanaryDeps(deps)
  const proofs = new WeakMap()

  const euid = () => BigInt(deps.geteuid())

  /** `{dev, ino}` of a trusted, operator-provisioned directory, or `null`. */
  function observeTrustedDir(dir) {
    try {
      const st = deps.lstat(dir)
      if (st === null || typeof st !== 'object') return null
      if (st.isSymbolicLink() !== false || st.isDirectory() !== true) return null
      if (typeof st.uid !== 'bigint' || st.uid !== euid()) return null
      if (typeof st.mode !== 'bigint' || (st.mode & 0o077n) !== 0n) return null
      if (typeof st.dev !== 'bigint' || typeof st.ino !== 'bigint') return null
      if (deps.realpath(dir) !== dir) return null
      return Object.freeze({ dev: st.dev, ino: st.ino })
    } catch {
      return null
    }
  }

  /** `{dev, ino}` of a directory THIS run just created, or `null`. */
  function observeOwnedDir(dir, parentDev) {
    try {
      const st = deps.lstat(dir)
      if (st === null || typeof st !== 'object') return null
      if (st.isSymbolicLink() !== false || st.isDirectory() !== true) return null
      if (st.uid !== euid() || (st.mode & 0o7777n) !== 0o700n || st.dev !== parentDev) return null
      return Object.freeze({ dev: st.dev, ino: st.ino })
    } catch {
      return null
    }
  }

  const sameId = (observed, expected) =>
    observed !== null && observed.dev === expected.dev && observed.ino === expected.ino

  /**
   * The probe as it is now: `{state:'absent'}`, `{state:'file', dev, ino,
   * size}` for a regular file owned by us, or `{state:'other'}` for anything
   * else (including an unobservable one).
   */
  function observeProbe(probe) {
    let st
    try {
      st = deps.lstat(probe)
    } catch (err) {
      return errnoOf(err) === 'ENOENT' ? { state: 'absent' } : { state: 'other' }
    }
    try {
      if (st === null || typeof st !== 'object') return { state: 'other' }
      if (st.isSymbolicLink() !== false || st.isFile() !== true) return { state: 'other' }
      if (st.uid !== euid() || typeof st.size !== 'bigint') return { state: 'other' }
      return { state: 'file', dev: st.dev, ino: st.ino, size: st.size }
    } catch {
      return { state: 'other' }
    }
  }

  /**
   * Remove exactly the canary's own probe and directory. Every removal is
   * preceded by identity checks of the readback directory, the canary
   * directory, and (for the probe) the file observed at classification.
   * Never recursive. Returns `true` only when both paths are gone.
   */
  function cleanup({ dir, dirId, canaryDir, canaryId, probe, probeSeen }) {
    try {
      if (!sameId(observeTrustedDir(dir), dirId)) return false
      if (!sameId(observeOwnedDir(canaryDir, dirId.dev), canaryId)) return false
      const now = observeProbe(probe)
      if (now.state === 'other') return false
      if (now.state === 'file') {
        if (probeSeen.state !== 'file') return false
        if (now.dev !== probeSeen.dev || now.ino !== probeSeen.ino) return false
        deps.unlink(probe)
        if (observeProbe(probe).state !== 'absent') return false
      }
      if (!sameId(observeTrustedDir(dir), dirId)) return false
      if (!sameId(observeOwnedDir(canaryDir, dirId.dev), canaryId)) return false
      deps.rmdir(canaryDir)
      return true
    } catch {
      return false
    }
  }

  const refused = (code, cleanupState) =>
    Object.freeze({ kind: 'refused', code, cleanup: cleanupState })

  async function proveReadbackContainment(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { config, runId, signal } = args
    assertValidSignal(signal)
    let cfg
    try {
      cfg = validateCloudConfig(config)
    } catch {
      return invalidInput('config')
    }
    if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return invalidInput('runId')
    if (signal?.aborted) return refused('canary_cancelled', 'not_started')
    if (cfg.readback.containment !== 'rlimit_fsize' || cfg.readback.rlimitWrapper === null) {
      return refused('containment_unsupported', 'not_started')
    }
    const wrapper = cfg.readback.rlimitWrapper
    try {
      assertWrapperIdentity({ wrapper, deps })
    } catch {
      return refused('rlimit_wrapper_unverified', 'not_started')
    }

    const dir = cfg.readback.dir
    const dirId = observeTrustedDir(dir)
    if (dirId === null) return refused('readback_dir_untrusted', 'not_started')

    const { maxCiphertextBytes, maxSidecarBytes, maxManifestBytes } = cfg.readback
    const limitBytes = Math.min(maxCiphertextBytes, maxSidecarBytes, maxManifestBytes)
    // A validator-accepted ceiling can be so large that L + overshoot is not a
    // safe integer, and a validator-accepted path can still be refused as an
    // argv operand (a segment beginning with `-`). Neither may escape as a
    // thrown argv error, and neither may weaken the attempt: without a
    // representable write beyond the exact L, nothing is proven. Both are
    // decided here, before anything is created or spawned.
    if (!Number.isSafeInteger(limitBytes + CANARY_OVERSHOOT_BYTES)) {
      return refused('containment_unproven', 'not_started')
    }
    const canaryDir = joinDir(dir, buildContainmentCanaryDirName(runId))
    const probe = joinDir(canaryDir, CANARY_PROBE_NAME)
    let argv
    try {
      argv = buildCanaryArgv({
        wrapperExecutable: wrapper.executable,
        limitBytes,
        nodeExecutable: deps.nodeExecutable,
        probePath: probe,
      })
    } catch {
      return refused('containment_unproven', 'not_started')
    }

    // ── create the one directory this run owns ──
    if (!sameId(observeTrustedDir(dir), dirId))
      return refused('readback_dir_untrusted', 'not_started')
    try {
      deps.mkdir(canaryDir, 0o700)
    } catch (err) {
      return errnoOf(err) === 'EEXIST'
        ? refused('canary_collision', 'not_started')
        : refused('canary_setup_failed', 'not_started')
    }
    let canaryId = null
    try {
      deps.chmod(canaryDir, 0o700)
      canaryId = observeOwnedDir(canaryDir, dirId.dev)
    } catch {
      canaryId = null
    }
    // Without a recorded identity nothing may be removed: leave it.
    if (canaryId === null) return refused('canary_setup_failed', 'incomplete')
    const ctx = { dir, dirId, canaryDir, canaryId, probe, probeSeen: { state: 'absent' } }
    if (observeProbe(probe).state !== 'absent' || !sameId(observeTrustedDir(dir), dirId)) {
      return refused('canary_setup_failed', cleanup(ctx) ? 'complete' : 'incomplete')
    }

    // ── run the fixed writer under the pinned wrapper ──
    const result = await spawnCapturingBounded({
      command: argv[0],
      args: argv.slice(1),
      env: {},
      timeoutMs: cfg.run.operationTimeoutMs,
      cancelGraceMs: cfg.run.cancelGraceMs,
      maxStdoutBytes: CANARY_MAX_OUTPUT_BYTES,
      maxStderrBytes: CANARY_MAX_OUTPUT_BYTES,
      spawnImpl: deps.spawn,
      signal,
    })

    // A child that may still exist may still be writing: touch nothing.
    if (result.kind === 'termination-unconfirmed') {
      return refused('termination_unconfirmed', 'withheld_termination_unconfirmed')
    }

    // ── classify (termination confirmed from here on) ──
    let failure = null
    const seen = observeProbe(probe)
    ctx.probeSeen = seen
    if (result.kind === 'cancelled') {
      failure = 'canary_cancelled'
    } else if (seen.state === 'file' && seen.size > BigInt(limitBytes)) {
      failure = 'containment_violated'
    } else if (result.kind !== 'exited') {
      failure = 'containment_unproven'
    } else {
      const refusedWrite =
        (result.code === CANARY_WRITER_EXIT_FILE_TOO_LARGE && result.signal === null) ||
        result.signal === 'SIGXFSZ'
      if (!refusedWrite || seen.state !== 'file' || seen.size !== BigInt(limitBytes)) {
        failure = 'containment_unproven'
      }
    }

    // ── remove exactly what this run created ──
    const cleaned = cleanup(ctx)
    if (failure !== null) return refused(failure, cleaned ? 'complete' : 'incomplete')
    if (!cleaned) return refused('canary_cleanup_failed', 'incomplete')

    let provenAt = null
    try {
      provenAt = new Date(deps.now()).toISOString()
    } catch {
      provenAt = null
    }
    const ceilings = Object.freeze({
      ciphertext: maxCiphertextBytes,
      checksum: maxSidecarBytes,
      manifest: maxManifestBytes,
    })
    const proof = Object.freeze({
      kind: CONTAINMENT_PROOF_KIND,
      runId,
      mechanism: 'rlimit_fsize',
      readbackDir: dir,
      wrapperExecutable: wrapper.executable,
      wrapperExpectedSha512: wrapper.expectedSha512,
      ceilings,
      limitBytes,
      provenAt,
    })
    proofs.set(
      proof,
      Object.freeze({
        runId,
        readbackDir: dir,
        dev: dirId.dev,
        ino: dirId.ino,
        wrapperExecutable: wrapper.executable,
        wrapperExpectedSha512: wrapper.expectedSha512,
        ceilings,
        limitBytes,
      }),
    )
    return Object.freeze({ kind: 'proven', proof, cleanup: 'complete' })
  }

  /**
   * The validation route a later consumer (E3J6B) uses. Returns `true`, or
   * throws one generic `containment_proof_invalid` — never says which part
   * failed, and never echoes a value.
   */
  function verifyContainmentProof(args) {
    const invalid = () => {
      throw new BackupError('containment_proof_invalid', 'the containment proof is not valid here.')
    }
    if (args === null || typeof args !== 'object') return invalid()
    const { proof, config, runId } = args
    if (proof === null || typeof proof !== 'object') return invalid()
    const binding = proofs.get(proof)
    if (binding === undefined) return invalid()
    let cfg
    try {
      cfg = validateCloudConfig(config)
    } catch {
      return invalid()
    }
    const rb = cfg.readback
    if (
      runId !== binding.runId ||
      rb.containment !== 'rlimit_fsize' ||
      rb.rlimitWrapper === null ||
      rb.dir !== binding.readbackDir ||
      rb.rlimitWrapper.executable !== binding.wrapperExecutable ||
      rb.rlimitWrapper.expectedSha512 !== binding.wrapperExpectedSha512 ||
      rb.maxCiphertextBytes !== binding.ceilings.ciphertext ||
      rb.maxSidecarBytes !== binding.ceilings.checksum ||
      rb.maxManifestBytes !== binding.ceilings.manifest
    ) {
      return invalid()
    }
    if (!sameId(observeTrustedDir(rb.dir), binding)) return invalid()
    return true
  }

  return Object.freeze({ proveReadbackContainment, verifyContainmentProof })
}

export { FORBIDDEN_ARGV_TOKENS }
