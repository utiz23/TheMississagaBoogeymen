/**
 * Cloud-transport configuration contract (E3J3).
 *
 * WHOSE CONFIGURATION THIS IS
 * ---------------------------
 * This describes the eventual Proton Drive uploader's configuration — not the
 * producer's (`backup-config.mjs`) and not the destination acceptor's
 * (`backup-acceptance-config.mjs`). It is kept as its own file and its own
 * validator for the reasons §10.1 of
 * `docs/planning/proton-drive-cloud-transport-architecture.md` gives: a
 * different owner and lifetime than the producer config, a different failure
 * domain (a malformed cloud config must never be able to stop the producer
 * from making an artifact), and a different eventual deployment host.
 *
 * The rules are the same fail-closed rules `backup-config.mjs` states and
 * exports for exactly this reuse: no defaults, absolute local paths only,
 * `backingVolume` required-but-nullable. This module imports those shared
 * primitives rather than redefining them.
 *
 * WHAT THIS MODULE DOES NOT DO
 * -----------------------------
 * No Proton CLI is invoked, no provider is contacted, and no credential is
 * read. `verifyCliHashPin()` below is a pure string comparison; the value it
 * compares against — the CLI executable's actual SHA-512 — is obtained by
 * hashing a local file, which is E3J4's job, not this module's. See that
 * function's docblock for the exact boundary and the T22 session split.
 *
 * SECRET-SHAPED KEYS
 * -------------------
 * No passphrase, token, session path, account identifier, e-mail, or unlock
 * command may ever appear in this configuration (§10.2(c) of the memo): the
 * uploader consumes an already-unlocked credential context and names only a
 * backend selector. `validateCloudConfig()` recursively rejects any key whose
 * NAME looks like it carries that kind of material, at any nesting depth,
 * before returning. This is a key-name check only — see
 * `assertNoSecretShapedKeys()`. The rejection message is deliberately
 * generic: the key itself may BE the sensitive material (an operator who
 * pastes a real token as a key name, say), so neither the raw key, its
 * value, nor an accumulated path built from untrusted key names is ever
 * echoed back — only a stable error code and a locally authored diagnostic.
 *
 * LOCAL PATH CANONICALITY — LEXICAL ONLY
 * ----------------------------------------
 * Every local path field (`cli.executable`, `artifact.sourceDir`,
 * `attestation.dir`, `readback.dir`, `run.lockFile`, and
 * `capacity.backingVolume.mountPoint` when non-null) must already be
 * canonical POSIX form — no repeated separators, no trailing separator, no
 * `.`/`..` segment — before it is used or compared for containment. A
 * non-canonical value is REJECTED, never silently normalized: normalizing
 * `/data/x/../artifacts/readback` to `/data/artifacts/readback` before
 * comparing it against `/data/artifacts` would make the path-separation
 * checks below pass on an alias that textually looks separate. This is a
 * LEXICAL guarantee only — it proves the string, as written, does not
 * resolve elsewhere via `.`/`..`/repeated separators. It does NOT prove
 * anything about symlinks, bind mounts, or other filesystem-level aliasing;
 * that requires deployment-time proof, exactly as the E3J1 memo's readback
 * containment discussion (§3) already states for hard containment. See
 * `assertCanonicalAbsolutePath()`.
 *
 * This module performs no I/O of its own beyond the injected `readFile`.
 */

import { BackupError } from './backup-artifact-contract.mjs'
import {
  ConfigError,
  fail,
  requireAbsolutePath,
  requireBackingVolume,
  requireObject,
  requirePositiveInt,
  requireString,
} from './backup-config.mjs'
import { validateRemoteRoot } from './backup-cloud-naming.mjs'

/** Exactly 128 lowercase hexadecimal characters — a SHA-512 digest. */
const SHA512_HEX_PATTERN = /^[0-9a-f]{128}$/

/**
 * Key-name substrings that mean "this field names secret or session
 * material, and must never live in this configuration." Matched
 * case-insensitively against the key name only — never against values, and
 * never against the authorized `credentials` object or its `backend`
 * selector, neither of which contains any of these substrings.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  'token',
  'secret',
  'password',
  'passphrase',
  'cookie',
  'recovery',
  'email',
  'account',
  'auth',
  'session',
]

/**
 * Recursively reject any object key whose name is secret- or session-shaped,
 * at any nesting depth, anywhere in the parsed configuration — including
 * inside unrecognised objects the schema below never reads. A value is never
 * inspected: an ordinary field that happens to contain incidental text (an
 * `s3cr3t-bucket` path segment, say) is not what this check exists to catch.
 *
 * The thrown message is deliberately generic and carries NO location
 * information: not the offending key, not its value, and not a path built by
 * accumulating the untrusted key names walked to reach it. The key name
 * itself may be the sensitive material an operator accidentally pasted in,
 * so echoing it back — even inside an error message meant only for a local
 * operator — would defeat the point of rejecting it.
 */
function assertNoSecretShapedKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretShapedKeys(item)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    const lower = key.toLowerCase()
    if (FORBIDDEN_KEY_SUBSTRINGS.some((s) => lower.includes(s))) {
      fail(
        'config_secret_shaped_key',
        'a configuration key name looks like it names secret- or session-shaped material and may ' +
          'not appear anywhere in cloud configuration. Credential unlocking and storage mechanics ' +
          "are outside the uploader's scope — this file names only a backend selector, never a " +
          'secret, token, passphrase, cookie, recovery material, account identifier, or ' +
          'authentication URL. (The offending key name is deliberately not repeated here.)',
      )
    }
    assertNoSecretShapedKeys(value[key])
  }
}

/**
 * Lexical-canonicality check on a value ALREADY known to be an absolute
 * path (leading `/`, non-empty). Rejects a trailing separator, a repeated
 * separator, a `.`/`..` segment, a backslash, or a NUL byte — never
 * normalizes. See the module docblock's "LOCAL PATH CANONICALITY" section
 * for why normalization-before-comparison is exactly the bug this exists to
 * close, and for the limits of what a lexical check can prove.
 *
 * Exported (E3J4A) so `backup-cloud-cli.mjs`'s local-path argv operand
 * validation reuses this exact rule rather than duplicating it with weaker
 * behaviour — throws `ConfigError`; that module wraps the call and rethrows
 * as its own `BackupError` for type consistency with its other errors.
 */
export function assertCanonicalAbsolutePath(value, what) {
  if (value === '/') return value
  if (value.endsWith('/')) {
    fail(
      'config_field_not_canonical',
      `${what} must not have a trailing separator (got ${JSON.stringify(value)}). Paths must ` +
        `already be canonical — nothing here is normalized before use or before a containment check.`,
    )
  }
  for (const segment of value.split('/').slice(1)) {
    if (segment === '') {
      fail(
        'config_field_not_canonical',
        `${what} must not contain repeated separators (got ${JSON.stringify(value)}).`,
      )
    }
    if (segment === '.' || segment === '..') {
      fail(
        'config_field_not_canonical',
        `${what} must not contain a "." or ".." segment (got ${JSON.stringify(value)}). A value ` +
          `that would only become canonical after normalization is rejected outright, never ` +
          `normalized and accepted.`,
      )
    }
    if (segment.includes('\\')) {
      fail(
        'config_field_not_canonical',
        `${what} must not contain a backslash (got ${JSON.stringify(value)}).`,
      )
    }
    if (segment.includes('\0')) {
      fail('config_field_not_canonical', `${what} must not contain a NUL byte.`)
    }
  }
  return value
}

/** `requireAbsolutePath()` plus the lexical canonicality check above. */
function requireCanonicalAbsolutePath(obj, key, path) {
  const value = requireAbsolutePath(obj, key, path)
  return assertCanonicalAbsolutePath(value, `${path}.${key}`)
}

function requireSha512Hex(obj, key, path) {
  const value = requireString(obj, key, path)
  if (!SHA512_HEX_PATTERN.test(value)) {
    fail(
      'config_field_invalid',
      `${path}.${key} must be exactly 128 lowercase hexadecimal characters (got ${JSON.stringify(value)}). ` +
        `There is no fallback identity check: a missing or malformed pin fails configuration validation ` +
        `rather than falling back to an unpinned CLI invocation (see the E3J1 memo §6.3).`,
    )
  }
  return value
}

/** `true` when `child` is `parent` or lies beneath it, comparing whole path components. */
function isInside(child, parent) {
  const c = child.replace(/\/+$/, '')
  const p = parent.replace(/\/+$/, '')
  return c === p || c.startsWith(p + '/')
}

/**
 * Validate a parsed cloud-transport configuration and return a frozen,
 * normalised copy.
 *
 * @param {unknown} raw
 * @param {string} sourcePath  Only used to phrase errors.
 */
export function validateCloudConfig(raw, sourcePath = '<cloud-config>') {
  requireObject(raw, sourcePath)
  assertNoSecretShapedKeys(raw)

  // ── CLI identity ────────────────────────────────────────────────────────
  const cliRaw = requireObject(raw.cli, `${sourcePath}.cli`)
  const cli = {
    executable: requireCanonicalAbsolutePath(cliRaw, 'executable', `${sourcePath}.cli`),
    expectedSha512: requireSha512Hex(cliRaw, 'expectedSha512', `${sourcePath}.cli`),
  }

  // ── credentials — a backend selector, never a secret ──────────────────────
  const credRaw = requireObject(raw.credentials, `${sourcePath}.credentials`)
  const backend = requireString(credRaw, 'backend', `${sourcePath}.credentials`)
  if (backend !== 'pass' && backend !== 'keychain') {
    fail(
      'config_field_invalid',
      `${sourcePath}.credentials.backend must be exactly "pass" or "keychain" (got ` +
        `${JSON.stringify(backend)}). "unsafe_file" and every other value are refused: the uploader ` +
        `consumes an already-unlocked credential context and never reads a secret from a file this ` +
        `configuration names.`,
    )
  }
  const credentials = { backend }

  // ── remote root ─────────────────────────────────────────────────────────
  const remoteRaw = requireObject(raw.remote, `${sourcePath}.remote`)
  const rootValue = requireString(remoteRaw, 'root', `${sourcePath}.remote`)
  let validatedRoot
  try {
    validatedRoot = validateRemoteRoot(rootValue)
  } catch (err) {
    fail('config_field_invalid', `${sourcePath}.remote.root: ${err.message}`)
  }
  const remote = { root: validatedRoot.root }

  // ── local directories the uploader reads or owns ───────────────────────────
  const artifactRaw = requireObject(raw.artifact, `${sourcePath}.artifact`)
  const artifact = {
    sourceDir: requireCanonicalAbsolutePath(artifactRaw, 'sourceDir', `${sourcePath}.artifact`),
  }

  const attestationRaw = requireObject(raw.attestation, `${sourcePath}.attestation`)
  const attestation = {
    dir: requireCanonicalAbsolutePath(attestationRaw, 'dir', `${sourcePath}.attestation`),
  }

  const readbackRaw = requireObject(raw.readback, `${sourcePath}.readback`)
  const readback = {
    dir: requireCanonicalAbsolutePath(readbackRaw, 'dir', `${sourcePath}.readback`),
    // Three SEPARATE ceilings, one per readback role — never derived from one
    // another. See the E3J1 memo §3.3: the ciphertext ceiling is production-
    // envelope-sized (U12, still open); the manifest and sidecar ceilings are
    // much smaller but are their own explicit production decision, not a
    // fraction of the ciphertext ceiling.
    maxCiphertextBytes: requirePositiveInt(
      readbackRaw,
      'maxCiphertextBytes',
      `${sourcePath}.readback`,
    ),
    maxManifestBytes: requirePositiveInt(readbackRaw, 'maxManifestBytes', `${sourcePath}.readback`),
    maxSidecarBytes: requirePositiveInt(readbackRaw, 'maxSidecarBytes', `${sourcePath}.readback`),
    containment: requireString(readbackRaw, 'containment', `${sourcePath}.readback`),
  }
  if (readback.containment !== 'rlimit_fsize' && readback.containment !== 'quota_mount') {
    fail(
      'config_field_invalid',
      `${sourcePath}.readback.containment must be exactly "rlimit_fsize" or "quota_mount" (got ` +
        `${JSON.stringify(readback.containment)}). This field is a DECLARATION of which mechanism is ` +
        `deployed — it does not itself prove kernel or filesystem enforcement (E3J1 memo §3.3).`,
    )
  }

  // ── run lifecycle ───────────────────────────────────────────────────────
  const runRaw = requireObject(raw.run, `${sourcePath}.run`)
  const run = {
    lockFile: requireCanonicalAbsolutePath(runRaw, 'lockFile', `${sourcePath}.run`),
    operationTimeoutMs: requirePositiveInt(runRaw, 'operationTimeoutMs', `${sourcePath}.run`),
    cancelGraceMs: requirePositiveInt(runRaw, 'cancelGraceMs', `${sourcePath}.run`),
  }
  if (run.cancelGraceMs >= run.operationTimeoutMs) {
    fail(
      'config_field_invalid',
      `${sourcePath}.run.cancelGraceMs (${run.cancelGraceMs}) must be smaller than operationTimeoutMs ` +
        `(${run.operationTimeoutMs}): cancelling a timed-out operation has to fit inside the budget ` +
        `that declared it timed out.`,
    )
  }

  // ── retry bounds (values themselves unresolved — U13; shape is not) ────────
  const retryRaw = requireObject(raw.retry, `${sourcePath}.retry`)
  const retry = {
    maxAttemptsPerArtifactPerRun: requirePositiveInt(
      retryRaw,
      'maxAttemptsPerArtifactPerRun',
      `${sourcePath}.retry`,
    ),
    backoffMs: requirePositiveInt(retryRaw, 'backoffMs', `${sourcePath}.retry`),
    maxTotalAttemptsPerRun: requirePositiveInt(
      retryRaw,
      'maxTotalAttemptsPerRun',
      `${sourcePath}.retry`,
    ),
  }
  if (retry.maxTotalAttemptsPerRun < retry.maxAttemptsPerArtifactPerRun) {
    fail(
      'config_field_invalid',
      `${sourcePath}.retry.maxTotalAttemptsPerRun (${retry.maxTotalAttemptsPerRun}) must not be smaller ` +
        `than maxAttemptsPerArtifactPerRun (${retry.maxAttemptsPerArtifactPerRun}): a run-level ceiling ` +
        `smaller than one artifact's own ceiling could not be reached by a single artifact anyway.`,
    )
  }

  // ── capacity ────────────────────────────────────────────────────────────
  const capacityRaw = requireObject(raw.capacity, `${sourcePath}.capacity`)
  const backingVolumeRaw = requireBackingVolume(capacityRaw, `${sourcePath}.capacity`)
  if (backingVolumeRaw !== null) {
    assertCanonicalAbsolutePath(
      backingVolumeRaw.mountPoint,
      `${sourcePath}.capacity.backingVolume.mountPoint`,
    )
  }
  const capacity = {
    minFreeBytes: requirePositiveInt(capacityRaw, 'minFreeBytes', `${sourcePath}.capacity`),
    // requireBackingVolume() returns a plain, unfrozen object when non-null —
    // freeze it here so a caller cannot mutate a nested field of an otherwise
    // "frozen, normalised" result (Object.freeze() is shallow).
    backingVolume: backingVolumeRaw === null ? null : Object.freeze({ ...backingVolumeRaw }),
  }

  // ── path separation — the property that makes containment meaningful ──────
  //
  // Whole-component comparisons only: a naive string-prefix check would treat
  // "/data/readback-2" as inside "/data/readback", which it is not.
  const owned = [
    ['artifact.sourceDir', artifact.sourceDir],
    ['attestation.dir', attestation.dir],
    ['readback.dir', readback.dir],
  ]
  for (let i = 0; i < owned.length; i++) {
    for (let j = i + 1; j < owned.length; j++) {
      const [labelA, dirA] = owned[i]
      const [labelB, dirB] = owned[j]
      if (isInside(dirA, dirB) || isInside(dirB, dirA)) {
        fail(
          'config_field_invalid',
          `${sourcePath}.${labelA} (${dirA}) and ${sourcePath}.${labelB} (${dirB}) must be distinct, ` +
            `and neither may contain or be contained by the other — each has a different owner and a ` +
            `different lifetime.`,
        )
      }
    }
  }
  if (isInside(run.lockFile, artifact.sourceDir)) {
    fail(
      'config_field_invalid',
      `${sourcePath}.run.lockFile (${run.lockFile}) is inside artifact.sourceDir (${artifact.sourceDir}).`,
    )
  }
  if (isInside(run.lockFile, readback.dir)) {
    fail(
      'config_field_invalid',
      `${sourcePath}.run.lockFile (${run.lockFile}) is inside readback.dir (${readback.dir}).`,
    )
  }
  for (const [label, dir] of owned) {
    if (run.lockFile === dir) {
      fail(
        'config_field_invalid',
        `${sourcePath}.run.lockFile must not equal ${sourcePath}.${label} (${dir}); a lock file is a ` +
          `file path, not a directory.`,
      )
    }
  }

  return Object.freeze({
    cli: Object.freeze(cli),
    credentials: Object.freeze(credentials),
    remote: Object.freeze(remote),
    artifact: Object.freeze(artifact),
    attestation: Object.freeze(attestation),
    readback: Object.freeze(readback),
    run: Object.freeze(run),
    retry: Object.freeze(retry),
    capacity: Object.freeze(capacity),
  })
}

/**
 * Read and validate a cloud-transport configuration file.
 *
 * @param {string} path
 * @param {(p: string) => string} readFile
 */
export function loadCloudConfig(path, readFile) {
  let text
  try {
    text = readFile(path)
  } catch (err) {
    throw new ConfigError(
      'config_unreadable',
      `could not read cloud config ${path}: ${err?.message ?? String(err)}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(
      'config_unparseable',
      `cloud config ${path} is not valid JSON: ${err?.message ?? String(err)}`,
    )
  }
  return validateCloudConfig(parsed, path)
}

/**
 * Pure local comparison of the configured CLI hash pin against an observed
 * SHA-512. THE ENTIRE GUARD: it does not invoke the CLI, spawn a process,
 * read a file, or touch a provider. Obtaining `observedSha512` — hashing the
 * configured executable — is E3J4's job (the subprocess boundary session),
 * not this function's.
 *
 * E3J3 proves two things: the pin is required and well-formed
 * (`validateCloudConfig`'s `cli.expectedSha512` check), and this comparison
 * fails closed on a malformed or mismatched observed value. It does **not**
 * prove that hash verification runs before any provider-command
 * construction — there is no provider-command constructor yet. That
 * integration assertion belongs to E3J4, once the subprocess boundary this
 * guard would sit in front of actually exists (corrected T22 split, see
 * `docs/planning/proton-drive-cloud-transport-architecture.md` §11.1/§13).
 */
export function verifyCliHashPin({ expectedSha512, observedSha512 }) {
  if (typeof expectedSha512 !== 'string' || !SHA512_HEX_PATTERN.test(expectedSha512)) {
    throw new BackupError(
      'cli_hash_pin_malformed',
      'the configured CLI hash pin is not 128 lowercase hexadecimal characters.',
    )
  }
  if (typeof observedSha512 !== 'string' || !SHA512_HEX_PATTERN.test(observedSha512)) {
    throw new BackupError(
      'cli_hash_observed_malformed',
      'the observed CLI hash is not 128 lowercase hexadecimal characters.',
    )
  }
  if (observedSha512 !== expectedSha512) {
    throw new BackupError(
      'cli_hash_mismatch',
      'the observed CLI hash does not match the configured pin.',
    )
  }
  return true
}
