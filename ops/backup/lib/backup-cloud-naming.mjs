/**
 * Cloud-transport naming and remote-path construction (E3J3).
 *
 * WHAT THIS MODULE IS
 * --------------------
 * Pure helpers for the identity and path shapes §4 and §8.1 of
 * `docs/planning/proton-drive-cloud-transport-architecture.md` define: a safe
 * remote path component, a canonical remote root, an attempt id, the
 * immutable per-attempt remote namespace, the three published object paths
 * inside it, and the attempt-scoped local attestation filename. Nothing here
 * spawns a process, touches the network, or reads the filesystem — nothing
 * upstream of "these are the strings the uploader would use" is in scope for
 * E3J3.
 *
 * WHY A SEPARATE MODULE FROM THE ARTIFACT CONTRACT
 * -------------------------------------------------
 * `backup-artifact-contract.mjs` is imported by the producer and the
 * acceptor today, neither of which constructs a remote path. Keeping the
 * remote-path rules here, importing the artifact contract rather than being
 * imported by it, keeps that existing dependency graph one-directional and
 * keeps this module's surface named for what it actually does.
 *
 * WHY THESE FUNCTIONS DO NOT USE `backup-acceptance.mjs`'s `assertSafeComponent`
 * -------------------------------------------------------------------------------
 * That function is correct and this module's `assertSafeRemoteComponent`
 * enforces the identical rule (empty, `.`, `..`, a path separator, NUL, or a
 * leading dot are all rejected), but importing it would make a cloud-transport
 * module depend on the destination-host acceptance module, which owns an
 * unrelated inbox-sweep surface. The rule is small enough that stating it
 * once more here, rather than reaching across that boundary, is the smaller
 * coupling.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ------------------------------
 * No Proton CLI argv, no subprocess, no upload/download, no provider-response
 * parsing, no attestation writer, no mutable "latest" pointer, no
 * enumeration, deletion, or collision-strategy behaviour. Those are E3J4
 * onward (`docs/planning/proton-drive-cloud-transport-architecture.md` §12).
 */

import {
  ARTIFACT_PREFIX_PATTERN,
  BackupError,
  SNAPSHOT_STAMP_PATTERN,
  publishedTripleNames,
} from './backup-artifact-contract.mjs'

/** `YYYYMMDDTHHMMSSZ-<8 lowercase hex>` — the same shape as the producer's `runId` and the acceptor's `sweepId`. */
export const ATTEMPT_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/

/**
 * A run identity — the producer manifest's `run_id` and (E3J6A) the cloud
 * run id that names a containment canary. The same fixed shape as an
 * `attemptId`, stated separately so each use names what it validates.
 */
export const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/

/**
 * `<artifactPrefix>-<compact stamp>`, split at the LAST hyphen that leaves a
 * 16-character `\d{8}T\d{6}Z` suffix. This is deliberate, not incidental:
 * `ARTIFACT_PREFIX_PATTERN` (`/^[a-z0-9][a-z0-9-]*$/`) permits a prefix that
 * itself ends in a hyphen, so `buildArtifactNames('eanhl-', stamp)` produces
 * a base like `eanhl--20260904T180007Z` — two consecutive hyphens, one from
 * the prefix and one as separator. A naive split on the first or only hyphen
 * gets that case wrong; a greedy, backtracking regex anchored on the fixed-
 * width stamp shape does not.
 */
const ARTIFACT_BASE_PATTERN = /^([a-z0-9][a-z0-9-]*)-(\d{8}T\d{6}Z)$/

/**
 * Refuse anything that is not a single, ordinary POSIX path component.
 *
 * The exact acceptor rule (`backup-acceptance.mjs`'s `assertSafeComponent`):
 * reject empty, `.`, `..`, a component containing `/` or `\`, a component
 * containing a NUL byte, and a component starting with `.`. Applied to every
 * segment of a remote path before it is interpolated into one.
 */
export function assertSafeRemoteComponent(name, what) {
  if (typeof name !== 'string' || name === '') {
    throw new BackupError('unsafe_remote_component', `${what} must be a non-empty string.`)
  }
  if (name === '.' || name === '..') {
    throw new BackupError('unsafe_remote_component', `${what} may not be ${JSON.stringify(name)}.`)
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new BackupError(
      'unsafe_remote_component',
      `${what} may not contain a path separator (got ${JSON.stringify(name)}).`,
    )
  }
  if (name.includes('\0')) {
    throw new BackupError('unsafe_remote_component', `${what} may not contain a NUL byte.`)
  }
  if (name.startsWith('.')) {
    throw new BackupError(
      'unsafe_remote_component',
      `${what} may not start with a dot (got ${JSON.stringify(name)}).`,
    )
  }
  return name
}

/**
 * Validate a canonical absolute remote root.
 *
 * "Canonical" means: POSIX-style, starts with `/`, no repeated separators, no
 * trailing separator, no `.`/`..` segment, no backslash, no NUL, and at least
 * one ordinary component. Normalization is deliberately never applied before
 * validation — `path.posix.normalize()` or similar would turn `/a//b` or
 * `/a/./b` into an accepted `/a/b`, which is exactly the class of unsafe
 * input silently becoming accepted input this function exists to refuse.
 *
 * Returns a frozen `{ root, segments }`.
 */
export function validateRemoteRoot(root) {
  if (typeof root !== 'string' || root === '') {
    throw new BackupError('remote_root_invalid', 'remote root must be a non-empty string.')
  }
  if (!root.startsWith('/')) {
    throw new BackupError(
      'remote_root_invalid',
      `remote root must be an absolute POSIX path (got ${JSON.stringify(root)}).`,
    )
  }
  const segments = root.split('/').slice(1)
  if (segments.every((s) => s === '')) {
    throw new BackupError(
      'remote_root_invalid',
      `remote root must contain at least one ordinary path component (got ${JSON.stringify(root)}).`,
    )
  }
  for (const segment of segments) {
    assertSafeRemoteComponent(segment, 'remote root component')
  }
  return Object.freeze({ root, segments: Object.freeze(segments) })
}

/**
 * Construct `attemptId = <UTC compact>-<8 hex>`, the same shape
 * `backup-producer.mjs`'s `runId` and `backup-acceptance.mjs`'s `sweepId`
 * already use.
 *
 * The constructed value is validated before it is returned — `randomToken`
 * is an injected boundary, and a double that returns something other than
 * exactly eight lowercase hex characters (`../BAD`, uppercase, too short,
 * too long, a slash) must not silently produce an attemptId shape this
 * module's own callers would then trust. This does NOT change
 * `backup-producer.mjs`'s `runId` construction, which is untouched and
 * unvalidated by this function — only this module's own `formatAttemptId`.
 *
 * @param {{now: () => number, randomToken: (bytes: number) => string}} deps
 *   The same clock/randomness injection style every other backup module uses
 *   (`makeRealDeps()` in `backup-boundaries.mjs`).
 */
export function formatAttemptId({ now, randomToken }) {
  const compact = new Date(now())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
  return assertValidAttemptId(`${compact}-${randomToken(4)}`)
}

/** Validate that a value is a well-formed `attemptId`. Returns it unchanged. */
export function assertValidAttemptId(attemptId) {
  if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new BackupError(
      'attempt_id_malformed',
      `attemptId must match YYYYMMDDTHHMMSSZ-<8 lowercase hex> (got ${JSON.stringify(attemptId)}).`,
    )
  }
  return attemptId
}

/**
 * Validate the exact identity shape a published artifact base must have:
 * `<artifactPrefix>-<YYYYMMDDTHHMMSSZ>`, where the prefix satisfies
 * `ARTIFACT_PREFIX_PATTERN` and the compact stamp satisfies
 * `SNAPSHOT_STAMP_PATTERN`. Unlike `assertSafeRemoteComponent` (which only
 * proves a string is safe to use as ONE path component), this proves the
 * component is actually an artifact identity — `buildPublishedObjectPaths()`
 * accepting an arbitrary safe-looking string like `"not-a-stamped-artifact"`
 * as an `artifactBase` was exactly the gap this closes.
 */
export function assertValidArtifactBase(base) {
  if (typeof base !== 'string') {
    throw new BackupError('artifact_base_malformed', 'artifactBase must be a string.')
  }
  const m = ARTIFACT_BASE_PATTERN.exec(base)
  if (!m || !ARTIFACT_PREFIX_PATTERN.test(m[1]) || !SNAPSHOT_STAMP_PATTERN.test(m[2])) {
    throw new BackupError(
      'artifact_base_malformed',
      `artifactBase must have the exact shape <artifactPrefix>-<YYYYMMDDTHHMMSSZ>, with the prefix ` +
        `matching ARTIFACT_PREFIX_PATTERN and the stamp matching SNAPSHOT_STAMP_PATTERN ` +
        `(got ${JSON.stringify(base)}).`,
    )
  }
  return base
}

/**
 * The ONE remote folder name an attempt creates: `<artifactBase>.<attemptId>`
 * (E3J5 layout).
 *
 * E3J3 nested the attempt under a per-artifact folder
 * (`<remoteRoot>/<artifactBase>/<attemptId>`). That shape needs a shared
 * `<artifactBase>` parent which some attempt must first create and every later
 * attempt must reuse — a folder that can never be retired after an
 * indeterminate create, whose first-creation race depends on unevidenced
 * duplicate-create semantics, and under which an absence query could not be
 * trusted while the parent itself might be missing. The flat layout makes each
 * attempt create exactly one folder, directly beneath the pre-provisioned
 * root. See `docs/planning/proton-drive-cloud-transport-architecture.md` §4.2
 * and §8.2.
 *
 * The `.` separator mirrors the attestation filename's
 * `<base>.<attemptId>.` convention. Both halves are validated fixed shapes,
 * the result is one safe component, and it can never begin with `.` or `-`
 * (`ARTIFACT_PREFIX_PATTERN` requires a leading `[a-z0-9]`).
 */
export function buildAttemptFolderName({ artifactBase, attemptId }) {
  assertSafeRemoteComponent(artifactBase, 'artifactBase')
  assertValidArtifactBase(artifactBase)
  assertValidAttemptId(attemptId)
  return assertSafeRemoteComponent(`${artifactBase}.${attemptId}`, 'attempt folder name')
}

/**
 * The immutable per-attempt remote namespace: `<remoteRoot>/<artifactBase>.<attemptId>`.
 *
 * Every argument is validated before interpolation. No caller of this
 * function can construct a namespace outside the configured root: `remoteRoot`
 * must itself validate as canonical, `artifactBase` must both be one ordinary
 * safe component AND satisfy the artifact identity shape (`assertValidArtifactBase`
 * — ordinary-component validation stays as an ADDITIONAL path-safety control,
 * not a replacement for it), and `attemptId` must validate as a well-formed
 * attempt id, so nothing resembling `..` can appear in any segment of the
 * result and no caller can pass an arbitrary safe-looking string that is not
 * actually an artifact identity.
 */
export function buildAttemptNamespace({ remoteRoot, artifactBase, attemptId }) {
  const { root } = validateRemoteRoot(remoteRoot)
  return `${root}/${buildAttemptFolderName({ artifactBase, attemptId })}`
}

/**
 * The exact three published object paths beneath one attempt's namespace,
 * derived from `publishedTripleNames()` — never the plaintext dump.
 *
 * Returns a frozen `{ root, attemptFolderName, namespace, ciphertextPath,
 * checksumPath, manifestPath }`.
 */
export function buildPublishedObjectPaths({ remoteRoot, artifactBase, attemptId }) {
  const namespace = buildAttemptNamespace({ remoteRoot, artifactBase, attemptId })
  const triple = publishedTripleNames(artifactBase)
  return Object.freeze({
    root: remoteRoot,
    attemptFolderName: buildAttemptFolderName({ artifactBase, attemptId }),
    namespace,
    ciphertextPath: `${namespace}/${triple.ciphertext}`,
    checksumPath: `${namespace}/${triple.checksum}`,
    manifestPath: `${namespace}/${triple.manifest}`,
  })
}

/**
 * The one directory a containment canary run may create directly beneath
 * `readback.dir` (E3J6A): `<runId>.containment-canary`. A validated run id
 * cannot begin with `.` or `-`, and the result is one safe component.
 */
export function buildContainmentCanaryDirName(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    throw new BackupError(
      'run_id_malformed',
      'runId must match YYYYMMDDTHHMMSSZ-<8 lowercase hex>.',
    )
  }
  return assertSafeRemoteComponent(`${runId}.containment-canary`, 'canary directory name')
}

/**
 * The attempt-scoped LOCAL attestation filename: `<base>.<attemptId>.cloud-attestation.json`.
 *
 * This is a local filename, not a remote path — it lives under the operator's
 * configured `attestation.dir` — but it is built from the same two validated
 * identities, so it is validated the same way.
 */
export function buildAttestationFileName({ artifactBase, attemptId }) {
  assertSafeRemoteComponent(artifactBase, 'artifactBase')
  assertValidArtifactBase(artifactBase)
  assertValidAttemptId(attemptId)
  return `${artifactBase}.${attemptId}.cloud-attestation.json`
}
