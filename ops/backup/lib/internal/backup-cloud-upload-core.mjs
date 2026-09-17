/**
 * Single-attempt Proton upload orchestration — INTERNAL IMPLEMENTATION CORE (E3J5).
 *
 * WHAT THIS FILE IS
 * ------------------
 * Every line of the upload-attempt logic: validate one explicit producer
 * artifact triple, derive one fresh attempt identity, preflight and create the
 * attempt's single remote folder, and request the three uploads in order —
 * ciphertext, checksum sidecar, manifest — stopping at the first non-success.
 * The result is a frozen, allowlisted, in-memory EVIDENCE object. It is not an
 * attestation and carries no verdict: E3J6 consumes it, performs its own
 * readback, and derives the attestation verdict independently.
 *
 * `../backup-cloud-upload.mjs` is THE production API. It binds
 * `REAL_UPLOAD_DEPS` once, at module load, and exposes `runUploadAttempt()`
 * with a signature that names no dependency. `makeUploadAttemptRunner()` is an
 * explicitly internal TEST SEAM — not a cryptographic or runtime
 * access-control boundary. A static regression in
 * `backup-cloud-upload.test.mjs` fails if any other `ops/**` module imports
 * this file. Malicious local repository code is outside this threat model:
 * anything able to add an import already has arbitrary execution. The
 * defended property is that an ordinary production caller cannot, through the
 * call signature, substitute the filesystem, the clock, the randomness, the
 * hashing, or the cloud operations.
 *
 * REMOTE LAYOUT AND REQUEST SEQUENCE
 * ------------------------------------
 *   <remoteRoot>/<artifactBase>.<attemptId>/<base>.dump.age
 *                                          /<base>.dump.age.sha256
 *                                          /<base>.manifest.json
 *
 * `<remoteRoot>` must already exist as an active folder; it is never created,
 * modified, or listed here. The sequence, stopping at the first non-success:
 *
 *   1. info(root)            — must be an active folder;
 *   2. info(namespace)       — must be absent (namespace collision check,
 *                              before the namespace-folder write);
 *   3. create-folder(root, <artifactBase>.<attemptId>);
 *   4. info(namespace)       — must be an active folder whose nodeUid equals
 *                              the create result's folderUid;
 *   5. info(each object path) — all three must be absent, under the now-
 *                              confirmed parent, before ANY upload;
 *   6. upload ciphertext, then checksum, then manifest.
 *
 * Folder creation necessarily precedes the object-path checks: the not-found
 * sentinel was only ever captured for a path whose parent existed, so an
 * absence report for a child of a possibly-missing parent is not evidence.
 * An object may still appear after its preflight; the upload boundary passes
 * no conflict strategy, so that case fails closed there.
 *
 * WHAT THE OUTCOME DOES AND DOES NOT CLAIM
 * ------------------------------------------
 *   - `providerBoundaryCallMade` / `writeBoundaryCallMade` / `boundaryCalls`
 *     record which public E3J4 operations THIS module called. They do not
 *     say a child was spawned, a provider was contacted, or a remote write
 *     was attempted — E3J4 does not expose reliable evidence of that on every
 *     cancellation or failure path.
 *   - `transferState` is only `definitely_zero` or `unknown`. It is
 *     `definitely_zero` only when no upload call was made, or the one upload
 *     call made ended in an anchored boundary refusal or a refusal before
 *     spawn. Everything else — including a boundary-reported success — is
 *     `unknown` until E3J6 readback.
 *   - `furthestUploadSuccessReportedRole` means only "the E3J4 boundary
 *     returned success for this role", never that the object exists remotely.
 *   - `namespaceState: 'active_folder_confirmed'` means only that the exact
 *     namespace path was observed as an active folder with matching opaque
 *     handles after the create call — never who created it.
 *   - no field carries provider-authored text, a provider handle, or the
 *     free-form failure text of `verifyArtifactCompletion()`.
 *
 * LOCAL SOURCE EVIDENCE — DETECTION, NOT TOCTOU CLOSURE
 * -------------------------------------------------------
 * The three names come only from `publishedTripleNames()` under the
 * configured `artifact.sourceDir` — no scanning, no staging access. Each file
 * must be a non-empty regular file (`lstat`, never following a symlink) of
 * safe-integer size, and the triple must pass `verifyArtifactCompletion()`.
 * The measured size is passed to each upload as `expectedLocalSizeBytes`.
 * File identity (dev, ino, size, mtime, ctime) is re-observed after the
 * completion check and before and after each upload, which DETECTS some
 * replacements. It does not close the window: a path-based CLI upload cannot
 * prove it opened the inode that was measured, and a same-size replacement
 * between observations is only caught by E3J6's readback hash.
 *
 * ONE-SHOT PREPARATION AND EXECUTION (E3J6A)
 * --------------------------------------------
 * `prepareUploadAttempt()` does all LOCAL work and no boundary call: input
 * validation (throws — no attempt exists), attempt identity, the local triple
 * checks above, the inclusive per-role readback-ceiling check
 * (`bytes <= ceiling`, else `local_exceeds_readback_ceiling`), and SOURCE
 * EVIDENCE: each role is re-opened through `backup-cloud-source-evidence.mjs`
 * (`O_RDONLY|O_NOFOLLOW|O_NONBLOCK`), its descriptor `fstat`ed against the
 * measured identity before and after, and its SHA-256 and exact byte count
 * computed from that descriptor. The captured manifest and sidecar bytes are
 * then validated with closed outcomes only (`local_manifest_identity_invalid`):
 * schema version, artifact name, `snapshot_ts` compacting to the base's
 * stamp, `run_id` shape, the manifest's ciphertext hash and size, and the
 * sidecar being exactly the producer's line for that hash and name. No
 * completion-failure text and no JSON parse error text is ever read.
 *
 * It returns a frozen PREPARED object with `disposition: 'ready'` (with
 * `sourceEvidence`) or `'refused'` (with `refusal: {step, code}` and
 * `sourceEvidence: null` — partial evidence from a refused preparation never
 * escapes). A refused attempt still has its identity and remote paths, so a
 * later attestation can name them without pretending evidence was captured.
 *
 * `executeUploadAttempt({prepared, signal})` accepts only an object this
 * runner instance prepared, and CONSUMES it synchronously, before its first
 * `await`: a second, concurrent, forged, or foreign execution fails locally
 * (`cloud_upload_prepared_reused` / `cloud_upload_prepared_invalid`) with no
 * boundary call. A refused object is consumed too and yields its refused
 * outcome with no boundary call. The upload uses the configuration and
 * measured identities captured at preparation, never new ones.
 * `runUploadAttempt()` is prepare followed by execute.
 *
 * The descriptor evidence makes a later readback comparable against
 * PRE-UPLOAD bytes. It does NOT close the CLI's path-based upload TOCTOU
 * window, and hashing the ciphertext a second time (the completion check
 * hashes it by path) is a deliberate cost, not an optimisation target.
 *
 * DELIBERATELY ABSENT
 * --------------------
 * No retry, no run lock, no entrypoint, no readback or download, no
 * attestation writer, no deletion or cleanup on any path, no enumeration, no
 * authentication, and no logging. One execution is exactly one attempt.
 */

import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'

import {
  BackupError,
  MANIFEST_SCHEMA_VERSION,
  formatChecksumSidecar,
  formatSnapshotStamp,
  publishedTripleNames,
  verifyArtifactCompletion,
} from '../backup-artifact-contract.mjs'
import { sha256File } from '../backup-boundaries.mjs'
import { CLOUD_CLI_ERROR_CODES, runCreateFolder, runInfo, runUpload } from '../backup-cloud-cli.mjs'
import { validateCloudConfig } from '../backup-cloud-config.mjs'
import {
  RUN_ID_PATTERN,
  assertSafeRemoteComponent,
  assertValidArtifactBase,
  buildPublishedObjectPaths,
  formatAttemptId,
} from '../backup-cloud-naming.mjs'
import { REAL_EVIDENCE_READER } from './backup-cloud-source-evidence.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// Closed vocabularies.
// ─────────────────────────────────────────────────────────────────────────────

export const OUTCOME_KIND = 'eanhl.cloud-upload-attempt-outcome'
/** v2 (E3J6A): adds `sourceEvidence`. */
export const OUTCOME_SCHEMA_VERSION = 2
export const PREPARED_KIND = 'eanhl.cloud-upload-prepared'
export const PREPARED_SCHEMA_VERSION = 1

const ROLES = Object.freeze(['ciphertext', 'checksum', 'manifest'])

export const CLOUD_UPLOAD_STEPS = Object.freeze([
  'local_validation',
  'preflight_root',
  'preflight_namespace',
  'create_namespace',
  'confirm_namespace',
  'preflight_ciphertext',
  'preflight_checksum',
  'preflight_manifest',
  'upload_ciphertext',
  'upload_checksum',
  'upload_manifest',
])

export const CLOUD_UPLOAD_STATUSES = Object.freeze([
  'upload_success_reported_pending_readback',
  'rejected',
  'indeterminate',
])

export const CLOUD_UPLOAD_TRANSFER_STATES = Object.freeze(['definitely_zero', 'unknown'])

export const CLOUD_UPLOAD_NAMESPACE_STATES = Object.freeze([
  'no_namespace_write_evidence',
  'active_folder_confirmed',
  'unknown',
])

export const CLOUD_UPLOAD_BOUNDARY_RESULTS = Object.freeze([
  'success',
  'rejected',
  'indeterminate',
  'refused_before_spawn',
  'failed',
])

export const CLOUD_UPLOAD_OUTCOME_CODES = Object.freeze([
  // local, before any boundary call (or before one role's upload)
  'source_dir_unusable',
  'local_file_missing',
  'local_file_not_regular',
  'local_file_empty',
  'local_file_unmeasurable',
  'local_triple_incomplete',
  'local_triple_changed',
  'local_exceeds_readback_ceiling',
  'local_manifest_identity_invalid',
  // local, after a boundary-reported upload success
  'local_source_changed',
  // remote findings and boundary outcomes
  'remote_root_absent',
  'remote_root_not_active_folder',
  'remote_path_occupied',
  'created_folder_unconfirmed',
  'provider_rejected',
  'provider_indeterminate',
  'provider_refused_before_spawn',
  'provider_call_failed',
  'attempt_cancelled',
])

/** Every timeout and cancellation lands in one of these; everything else is `rejected`. */
const INDETERMINATE_CODES = new Set([
  'created_folder_unconfirmed',
  'provider_indeterminate',
  'provider_call_failed',
  'attempt_cancelled',
  'local_source_changed',
])

/**
 * The E3J4 `BackupError` codes that its documented ordering raises strictly
 * BEFORE any child is spawned (local input validation, the hash gate, operand
 * validation). Any other thrown value is treated as possibly post-spawn.
 */
export const E3J4_PRE_SPAWN_CODES = Object.freeze([
  'cloud_cli_invalid_input',
  'cloud_cli_argv_invalid',
  'cli_executable_unreadable',
  'cli_hash_pin_malformed',
  'cli_hash_observed_malformed',
  'cli_hash_mismatch',
])

const NODE_KINDS = new Set(['file', 'folder'])
const NODE_STATES = new Set(['active', 'trashed'])
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function invalidInput(what) {
  throw new BackupError('cloud_upload_invalid_input', `${what} is invalid.`)
}

// ─────────────────────────────────────────────────────────────────────────────
// The real dependency set — minimal, directly constructed, deep-frozen.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bound once by `../backup-cloud-upload.mjs`. Deliberately NOT built from
 * `makeRealDeps()`, which also constructs process, Docker, database, and
 * write/delete capabilities this module has no use for. The filesystem
 * surface is read-only: `lstat` (bigint, never following a symlink) and the
 * three functions `verifyArtifactCompletion()` reads through, plus the
 * read-only no-follow descriptor reader (`evidence`, E3J6A). No download
 * operation of any kind is bound.
 */
export const REAL_UPLOAD_DEPS = Object.freeze({
  lstat: (p) => fs.lstatSync(p, { bigint: true }),
  completionDeps: Object.freeze({
    fs: Object.freeze({
      existsSync: fs.existsSync,
      readFileSync: fs.readFileSync,
      statSync: fs.statSync,
    }),
    sha256File,
  }),
  evidence: REAL_EVIDENCE_READER,
  now: () => Date.now(),
  randomToken: (bytes) => randomBytes(bytes).toString('hex'),
  cloud: Object.freeze({ runInfo, runCreateFolder, runUpload }),
})

function assertValidDeps(deps) {
  const isFn = (v) => typeof v === 'function'
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')
  const { lstat, completionDeps, evidence, now, randomToken, cloud } = deps
  if (!isFn(lstat) || !isFn(now) || !isFn(randomToken)) return invalidInput('deps')
  if (evidence === null || typeof evidence !== 'object') return invalidInput('deps')
  if (
    !isFn(evidence.open) ||
    !isFn(evidence.fstat) ||
    !isFn(evidence.read) ||
    !isFn(evidence.close)
  ) {
    return invalidInput('deps')
  }
  if (completionDeps === null || typeof completionDeps !== 'object') return invalidInput('deps')
  const cfs = completionDeps.fs
  if (cfs === null || typeof cfs !== 'object') return invalidInput('deps')
  if (!isFn(cfs.existsSync) || !isFn(cfs.readFileSync) || !isFn(cfs.statSync)) {
    return invalidInput('deps')
  }
  if (!isFn(completionDeps.sha256File)) return invalidInput('deps')
  if (cloud === null || typeof cloud !== 'object') return invalidInput('deps')
  if (!isFn(cloud.runInfo) || !isFn(cloud.runCreateFolder) || !isFn(cloud.runUpload)) {
    return invalidInput('deps')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local evidence helpers. Only an error's `code` is ever read; no native
// message, path, or errno text is kept.
// ─────────────────────────────────────────────────────────────────────────────

function errorCodeOf(err) {
  try {
    return typeof err?.code === 'string' ? err.code : undefined
  } catch {
    return undefined
  }
}

/** A frozen join that never produces `//` for a root `sourceDir`. */
function joinLocal(dir, name) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

function observeDirectory(deps, dir) {
  try {
    const st = deps.lstat(dir)
    if (st === null || typeof st !== 'object' || typeof st.isDirectory !== 'function') return false
    return st.isDirectory() === true
  } catch {
    return false
  }
}

/**
 * Observe one artifact file WITHOUT following a symlink. Every field is read
 * exactly once, inside a `try`, and every later comparison uses the captured
 * values. Returns `{ ok: true, id, bytes }` or `{ ok: false, code }`.
 */
function observeFile(deps, filePath) {
  let st
  try {
    st = deps.lstat(filePath)
  } catch (err) {
    return {
      ok: false,
      code: errorCodeOf(err) === 'ENOENT' ? 'local_file_missing' : 'local_file_unmeasurable',
    }
  }
  if (st === null || typeof st !== 'object') return { ok: false, code: 'local_file_unmeasurable' }
  let isFile
  let id
  try {
    if (typeof st.isFile !== 'function') return { ok: false, code: 'local_file_unmeasurable' }
    isFile = st.isFile()
    id = { dev: st.dev, ino: st.ino, size: st.size, mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs }
  } catch {
    return { ok: false, code: 'local_file_unmeasurable' }
  }
  if (isFile === false) return { ok: false, code: 'local_file_not_regular' }
  if (isFile !== true) return { ok: false, code: 'local_file_unmeasurable' }
  for (const value of Object.values(id)) {
    if (typeof value !== 'bigint') return { ok: false, code: 'local_file_unmeasurable' }
  }
  if (id.size < 0n || id.size > MAX_SAFE_BIGINT) {
    return { ok: false, code: 'local_file_unmeasurable' }
  }
  if (id.size === 0n) return { ok: false, code: 'local_file_empty' }
  return { ok: true, id, bytes: Number(id.size) }
}

function sameIdentity(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  )
}

/** `true` only if the file is still the exact file that was measured. */
function unchanged(deps, filePath, measured) {
  const again = observeFile(deps, filePath)
  return again.ok && sameIdentity(again.id, measured)
}

/**
 * One clock reading as ISO-8601, or `null` if the clock throws or returns an
 * unusable value — an attempt that has already started must still return its
 * outcome rather than throw on the way out.
 */
function readIsoOrNull(now) {
  try {
    return new Date(now()).toISOString()
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Source evidence (E3J6A): hashes and byte counts from a held descriptor.
// ─────────────────────────────────────────────────────────────────────────────

const EVIDENCE_CHUNK_BYTES = 1 << 20
const SHA256_HEX = /^[0-9a-f]{64}$/

/** The descriptor's identity, read once per field, or `null` if unusable. */
function fstatIdentity(deps, fd) {
  try {
    const st = deps.evidence.fstat(fd)
    if (st === null || typeof st !== 'object' || typeof st.isFile !== 'function') return null
    if (st.isFile() !== true) return null
    const id = { dev: st.dev, ino: st.ino, size: st.size, mtimeNs: st.mtimeNs, ctimeNs: st.ctimeNs }
    for (const value of Object.values(id)) if (typeof value !== 'bigint') return null
    return id
  } catch {
    return null
  }
}

/**
 * Hash one role through a descriptor opened without following a symlink.
 * The descriptor must be the measured inode before and after the read, and
 * exactly the measured number of bytes must be read. `keepBytes` retains the
 * content (only ever for the small checksum and manifest roles, already
 * bounded by their readback ceilings).
 */
function captureRole(deps, filePath, measuredId, keepBytes) {
  const changed = { ok: false, code: 'local_triple_changed' }
  const unmeasurable = { ok: false, code: 'local_file_unmeasurable' }
  let fd
  try {
    fd = deps.evidence.open(filePath)
  } catch (err) {
    const code = errorCodeOf(err)
    return code === 'ELOOP' || code === 'ENOENT' || code === 'ENOTDIR' ? changed : unmeasurable
  }
  try {
    const before = fstatIdentity(deps, fd)
    if (before === null) return unmeasurable
    if (!sameIdentity(before, measuredId)) return changed
    const expected = Number(measuredId.size)
    const hash = createHash('sha256')
    const chunks = []
    const buf = Buffer.alloc(Math.max(1, Math.min(EVIDENCE_CHUNK_BYTES, expected + 1)))
    let total = 0
    for (;;) {
      const n = deps.evidence.read(fd, buf)
      if (!Number.isSafeInteger(n) || n < 0 || n > buf.length) return unmeasurable
      if (n === 0) break
      total += n
      if (total > expected) return changed
      hash.update(buf.subarray(0, n))
      if (keepBytes) chunks.push(Buffer.from(buf.subarray(0, n)))
    }
    if (total !== expected) return changed
    const after = fstatIdentity(deps, fd)
    if (after === null) return unmeasurable
    if (!sameIdentity(after, measuredId)) return changed
    return {
      ok: true,
      sha256: hash.digest('hex'),
      bytes: total,
      content: keepBytes ? Buffer.concat(chunks) : null,
    }
  } catch {
    return unmeasurable
  } finally {
    try {
      deps.evidence.close(fd)
    } catch {
      /* a read-only descriptor; nothing to preserve */
    }
  }
}

/**
 * Validate the captured manifest and sidecar bytes. Returns
 * `{snapshotTs, runId}` or `null` — never a reason, never a parse message.
 */
function validateSourceIdentity({ artifactBase, names, captured }) {
  const ciphertextSha = captured.ciphertext.sha256
  if (!SHA256_HEX.test(ciphertextSha)) return null
  let manifest
  let sidecarText
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    manifest = JSON.parse(decoder.decode(captured.manifest.content))
    sidecarText = decoder.decode(captured.checksum.content)
  } catch {
    return null
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return null
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) return null
  if (manifest.artifact !== names.ciphertext) return null
  const snapshotTs = manifest.snapshot_ts
  if (typeof snapshotTs !== 'string') return null
  let compact
  try {
    compact = formatSnapshotStamp(snapshotTs)
  } catch {
    return null
  }
  if (compact !== artifactBase.slice(-16)) return null
  const runId = manifest.run_id
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return null
  const ct = manifest.ciphertext
  if (ct === null || typeof ct !== 'object' || Array.isArray(ct)) return null
  if (ct.sha256 !== ciphertextSha || ct.bytes !== captured.ciphertext.bytes) return null
  if (sidecarText !== formatChecksumSidecar(ciphertextSha, names.ciphertext)) return null
  return { snapshotTs, runId }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boundary-result normalization. Only the fields named here are ever read,
// each once; opaque handles are compared internally and never returned.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeBoundaryResult(operation, r) {
  const failed = { result: 'failed', boundaryCode: null, finding: null, view: null }
  try {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return failed
    const kind = r.kind
    if (r.operation !== operation) return failed
    if (kind === 'rejected' || kind === 'indeterminate') {
      const code = r.code
      if (typeof code !== 'string' || !CLOUD_CLI_ERROR_CODES.includes(code)) return failed
      if (kind === 'rejected' && r.transferState !== 'definitely_zero') return failed
      return { result: kind, boundaryCode: code, finding: null, view: null }
    }
    if (kind !== 'success') return failed
    if (operation === 'info') {
      const present = r.present
      if (present === false) {
        return { result: 'success', boundaryCode: null, finding: 'absent', view: null }
      }
      if (present !== true) return failed
      const { nodeKind, state, nodeUid } = r
      if (!NODE_KINDS.has(nodeKind) || !NODE_STATES.has(state)) return failed
      if (typeof nodeUid !== 'string' || nodeUid === '') return failed
      return {
        result: 'success',
        boundaryCode: null,
        finding: 'present',
        view: { nodeKind, state, nodeUid },
      }
    }
    if (operation === 'create-folder') {
      const { created, folderUid } = r
      if (created !== true || typeof folderUid !== 'string' || folderUid === '') return failed
      return { result: 'success', boundaryCode: null, finding: null, view: { folderUid } }
    }
    if (operation === 'upload') {
      if (r.transferredItems !== 1) return failed
      return { result: 'success', boundaryCode: null, finding: null, view: null }
    }
    return failed
  } catch {
    return failed
  }
}

function codeForNonSuccess(result) {
  if (result === 'rejected') return 'provider_rejected'
  if (result === 'refused_before_spawn') return 'provider_refused_before_spawn'
  if (result === 'indeterminate') return 'provider_indeterminate'
  return 'provider_call_failed'
}

/** An anchored refusal or a refusal before spawn — the only definite-zero boundary evidence. */
function isDefiniteZero(result) {
  return result === 'rejected' || result === 'refused_before_spawn'
}

// ─────────────────────────────────────────────────────────────────────────────
// Input validation (throws — no attempt exists yet).
// ─────────────────────────────────────────────────────────────────────────────

function validateInputs(args) {
  if (args === null || typeof args !== 'object') return invalidInput('arguments')
  const { config, artifactBase, signal } = args
  if (signal !== undefined && !(signal instanceof AbortSignal)) return invalidInput('signal')
  let cfg
  try {
    cfg = validateCloudConfig(config)
  } catch {
    return invalidInput('config')
  }
  const root = cfg.remote.root
  if (root === '/trash' || root.startsWith('/trash/')) return invalidInput('config.remote.root')
  try {
    assertSafeRemoteComponent(artifactBase, 'artifactBase')
    assertValidArtifactBase(artifactBase)
  } catch {
    return invalidInput('artifactBase')
  }
  return { cfg, artifactBase, signal }
}

// ─────────────────────────────────────────────────────────────────────────────
// The attempt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the single-attempt runner against a supplied dependency set.
 *
 * INTERNAL TEST SEAM — see the module docblock. `../backup-cloud-upload.mjs`
 * calls this exactly once, with `REAL_UPLOAD_DEPS`.
 */
export function makeUploadAttemptRunner(deps) {
  assertValidDeps(deps)

  /**
   * Prepared objects THIS runner created → their hidden state. A frozen
   * prepared object is informational; execution reads only this record, so
   * nothing a caller can copy or construct is ever executable.
   */
  const registry = new WeakMap()

  function register(visible, internal) {
    registry.set(visible, { state: 'ready', internal })
    return visible
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PREPARE — local only, no boundary call.
  // ───────────────────────────────────────────────────────────────────────────

  function prepareUploadAttempt(args) {
    const { cfg, artifactBase, signal } = validateInputs(args)

    // ── attempt identity: ONE clock reading for both the id and startedAt ──
    let attemptId
    let startedAt
    try {
      const startMs = deps.now()
      attemptId = formatAttemptId({ now: () => startMs, randomToken: deps.randomToken })
      startedAt = new Date(startMs).toISOString()
    } catch {
      throw new BackupError(
        'cloud_upload_attempt_id_failed',
        'an attempt identity could not be derived.',
      )
    }

    const sourceDir = cfg.artifact.sourceDir
    const names = publishedTripleNames(artifactBase)
    const remote = buildPublishedObjectPaths({
      remoteRoot: cfg.remote.root,
      artifactBase,
      attemptId,
    })
    const localPaths = {}
    for (const role of ROLES) localPaths[role] = joinLocal(sourceDir, names[role])
    const ceilings = {
      ciphertext: cfg.readback.maxCiphertextBytes,
      checksum: cfg.readback.maxSidecarBytes,
      manifest: cfg.readback.maxManifestBytes,
    }

    const make = ({ code, measured, evidence }) => {
      const ready = code === null
      const visible = Object.freeze({
        kind: PREPARED_KIND,
        schemaVersion: PREPARED_SCHEMA_VERSION,
        disposition: ready ? 'ready' : 'refused',
        refusal: ready ? null : Object.freeze({ step: 'local_validation', code }),
        attempt: Object.freeze({ attemptId, startedAt }),
        artifact: Object.freeze({ base: artifactBase, ...names }),
        remote: Object.freeze({
          root: remote.root,
          attemptFolderName: remote.attemptFolderName,
          namespace: remote.namespace,
          ciphertextPath: remote.ciphertextPath,
          checksumPath: remote.checksumPath,
          manifestPath: remote.manifestPath,
        }),
        local: Object.freeze({
          sourceDir,
          ciphertextPath: localPaths.ciphertext,
          checksumPath: localPaths.checksum,
          manifestPath: localPaths.manifest,
        }),
        sourceEvidence: ready ? evidence : null,
      })
      return register(visible, {
        cfg,
        artifactBase,
        attemptId,
        startedAt,
        sourceDir,
        names,
        remote,
        localPaths,
        refusalCode: code,
        measured: ready ? measured : null,
        evidence: ready ? evidence : null,
      })
    }
    const refuse = (code) => make({ code, measured: null, evidence: null })

    // ── S2: cancellation before anything ──
    if (signal?.aborted === true) return refuse('attempt_cancelled')

    // ── L1-L4: the local triple ──
    if (!observeDirectory(deps, sourceDir)) return refuse('source_dir_unusable')
    const measured = {}
    for (const role of ROLES) {
      const obs = observeFile(deps, localPaths[role])
      if (!obs.ok) return refuse(obs.code)
      measured[role] = obs
    }
    // Inclusive ceilings: a role of exactly its ceiling is acceptable. Checked
    // before anything reads a file's content.
    for (const role of ROLES) {
      if (measured[role].bytes > ceilings[role]) return refuse('local_exceeds_readback_ceiling')
    }
    let completion
    try {
      completion = verifyArtifactCompletion({
        dir: sourceDir,
        base: artifactBase,
        deps: deps.completionDeps,
      })
    } catch {
      return refuse('local_triple_incomplete')
    }
    // The free-form `failures` text is never read — only the boolean.
    let complete
    let manifestBytes
    try {
      complete = completion?.complete
      manifestBytes = completion?.manifest?.ciphertext?.bytes
    } catch {
      return refuse('local_triple_incomplete')
    }
    if (complete !== true) return refuse('local_triple_incomplete')
    if (!Number.isSafeInteger(manifestBytes) || manifestBytes !== measured.ciphertext.bytes) {
      return refuse('local_triple_changed')
    }

    // ── E1: descriptor evidence for all three roles, before any boundary call ──
    const captured = {}
    for (const role of ROLES) {
      const got = captureRole(deps, localPaths[role], measured[role].id, role !== 'ciphertext')
      if (!got.ok) return refuse(got.code)
      captured[role] = got
    }
    for (const role of ROLES) {
      if (!unchanged(deps, localPaths[role], measured[role].id)) {
        return refuse('local_triple_changed')
      }
    }
    const identity = validateSourceIdentity({ artifactBase, names, captured })
    if (identity === null) return refuse('local_manifest_identity_invalid')

    const evidence = Object.freeze({
      ciphertext: Object.freeze({
        sha256: captured.ciphertext.sha256,
        bytes: captured.ciphertext.bytes,
      }),
      checksum: Object.freeze({ sha256: captured.checksum.sha256, bytes: captured.checksum.bytes }),
      manifest: Object.freeze({ sha256: captured.manifest.sha256, bytes: captured.manifest.bytes }),
      snapshotTs: identity.snapshotTs,
      runId: identity.runId,
    })
    return make({ code: null, measured, evidence })
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXECUTE — consumes a prepared object exactly once.
  // ───────────────────────────────────────────────────────────────────────────

  async function executeUploadAttempt(args) {
    // Everything up to `entry.state = 'consumed'` is synchronous: no `await`
    // precedes it, so no second call can interleave between check and set.
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { prepared, signal } = args
    if (signal !== undefined && !(signal instanceof AbortSignal)) return invalidInput('signal')
    const entry =
      prepared !== null && typeof prepared === 'object' ? registry.get(prepared) : undefined
    if (entry === undefined) {
      throw new BackupError(
        'cloud_upload_prepared_invalid',
        'the prepared attempt was not produced by this uploader.',
      )
    }
    if (entry.state !== 'ready') {
      throw new BackupError(
        'cloud_upload_prepared_reused',
        'the prepared attempt has already been executed.',
      )
    }
    entry.state = 'consumed'
    return runPrepared(entry.internal, signal)
  }

  async function runPrepared(internal, signal) {
    const { cfg, artifactBase, attemptId, startedAt, sourceDir, names, remote, localPaths } =
      internal
    const measured = internal.measured
    const remotePaths = {
      ciphertext: remote.ciphertextPath,
      checksum: remote.checksumPath,
      manifest: remote.manifestPath,
    }

    const boundaryOptions = {
      cli: cfg.cli,
      credentials: cfg.credentials,
      timeouts: {
        operationTimeoutMs: cfg.run.operationTimeoutMs,
        cancelGraceMs: cfg.run.cancelGraceMs,
      },
      signal,
    }

    // ── mutable run state, frozen into the outcome at the end ──
    const calls = []
    const expectedBytes = { ciphertext: null, checksum: null, manifest: null }
    if (measured !== null) for (const role of ROLES) expectedBytes[role] = measured[role].bytes
    let providerBoundaryCallMade = false
    let writeBoundaryCallMade = false
    let uploadNotDefinitelyZero = false
    let createEvidence = 'none' // 'none' | 'definite_zero' | 'possible'
    let namespaceConfirmed = false
    let furthestUploadSuccessReportedRole = null

    const finish = (code, failedStep) => {
      const status =
        code === null
          ? 'upload_success_reported_pending_readback'
          : INDETERMINATE_CODES.has(code)
            ? 'indeterminate'
            : 'rejected'
      const namespaceState =
        createEvidence !== 'possible'
          ? 'no_namespace_write_evidence'
          : namespaceConfirmed
            ? 'active_folder_confirmed'
            : 'unknown'
      const local = { sourceDir }
      for (const role of ROLES) {
        local[role] = Object.freeze({ path: localPaths[role], expectedBytes: expectedBytes[role] })
      }
      return Object.freeze({
        kind: OUTCOME_KIND,
        schemaVersion: OUTCOME_SCHEMA_VERSION,
        verification: 'not_performed',
        status,
        code,
        failedStep,
        transferState: uploadNotDefinitelyZero ? 'unknown' : 'definitely_zero',
        namespaceState,
        providerBoundaryCallMade,
        writeBoundaryCallMade,
        furthestUploadSuccessReportedRole,
        attempt: Object.freeze({ attemptId, startedAt, finishedAt: readIsoOrNull(deps.now) }),
        artifact: Object.freeze({ base: artifactBase, ...names }),
        local: Object.freeze(local),
        remote: Object.freeze({
          root: remote.root,
          attemptFolderName: remote.attemptFolderName,
          namespace: remote.namespace,
          ciphertextPath: remote.ciphertextPath,
          checksumPath: remote.checksumPath,
          manifestPath: remote.manifestPath,
        }),
        sourceEvidence: internal.evidence,
        boundaryCalls: Object.freeze(calls.slice()),
      })
    }

    // A refused preparation is consumed and reported with no boundary call.
    if (internal.refusalCode !== null) return finish(internal.refusalCode, 'local_validation')

    /**
     * The ONLY way a boundary operation is called. `writeBoundaryCallMade` is
     * set for create-folder/upload BEFORE the call, regardless of what the
     * call later returns or throws.
     */
    const callBoundary = async (step, operation, remotePath, invoke) => {
      providerBoundaryCallMade = true
      if (operation !== 'info') writeBoundaryCallMade = true
      let normalized
      try {
        normalized = normalizeBoundaryResult(operation, await invoke())
      } catch (err) {
        const code = errorCodeOf(err)
        normalized =
          err instanceof BackupError && E3J4_PRE_SPAWN_CODES.includes(code)
            ? { result: 'refused_before_spawn', boundaryCode: code, finding: null, view: null }
            : { result: 'failed', boundaryCode: null, finding: null, view: null }
      }
      calls.push(
        Object.freeze({
          step,
          operation,
          remotePath,
          boundaryResult: normalized.result,
          boundaryCode: normalized.boundaryCode,
          reportedFinding: normalized.finding,
        }),
      )
      return normalized
    }

    /**
     * Internal invariant (T20) — every write target must be exactly one the
     * model allows. Unreachable by construction; if it ever fires it throws
     * (a programming defect), BEFORE the write boundary call is made.
     */
    const assertWriteTarget = (target) => {
      const ok =
        target.kind === 'create-folder'
          ? target.parentPath === remote.root && target.name === remote.attemptFolderName
          : target.remoteParentPath === remote.namespace &&
            ROLES.some((role) => localPaths[role] === target.localFilePath)
      if (!ok) {
        throw new BackupError(
          'cloud_upload_invariant_violated',
          'a write target outside the attempt model was constructed.',
        )
      }
    }

    const cancelled = () => signal?.aborted === true

    // ── R1: the pre-provisioned root ──
    if (cancelled()) return finish('attempt_cancelled', 'preflight_root')
    const rootInfo = await callBoundary('preflight_root', 'info', remote.root, () =>
      deps.cloud.runInfo({ remotePath: remote.root, ...boundaryOptions }),
    )
    if (rootInfo.result !== 'success') {
      return finish(codeForNonSuccess(rootInfo.result), 'preflight_root')
    }
    if (rootInfo.finding === 'absent') return finish('remote_root_absent', 'preflight_root')
    if (rootInfo.view.nodeKind !== 'folder' || rootInfo.view.state !== 'active') {
      return finish('remote_root_not_active_folder', 'preflight_root')
    }

    // ── R2: namespace collision check, before the namespace-folder write ──
    if (cancelled()) return finish('attempt_cancelled', 'preflight_namespace')
    const nsInfo = await callBoundary('preflight_namespace', 'info', remote.namespace, () =>
      deps.cloud.runInfo({ remotePath: remote.namespace, ...boundaryOptions }),
    )
    if (nsInfo.result !== 'success') {
      return finish(codeForNonSuccess(nsInfo.result), 'preflight_namespace')
    }
    if (nsInfo.finding !== 'absent') return finish('remote_path_occupied', 'preflight_namespace')

    // ── R3: the ONE folder this attempt creates ──
    if (cancelled()) return finish('attempt_cancelled', 'create_namespace')
    const createTarget = {
      kind: 'create-folder',
      parentPath: remote.root,
      name: remote.attemptFolderName,
    }
    assertWriteTarget(createTarget)
    const created = await callBoundary('create_namespace', 'create-folder', remote.namespace, () =>
      deps.cloud.runCreateFolder({
        parentPath: createTarget.parentPath,
        name: createTarget.name,
        ...boundaryOptions,
      }),
    )
    createEvidence = isDefiniteZero(created.result) ? 'definite_zero' : 'possible'
    if (created.result !== 'success') {
      return finish(codeForNonSuccess(created.result), 'create_namespace')
    }

    // ── R4: confirm the exact namespace is the active folder the create reported ──
    if (cancelled()) return finish('attempt_cancelled', 'confirm_namespace')
    const confirm = await callBoundary('confirm_namespace', 'info', remote.namespace, () =>
      deps.cloud.runInfo({ remotePath: remote.namespace, ...boundaryOptions }),
    )
    if (
      confirm.result !== 'success' ||
      confirm.finding !== 'present' ||
      confirm.view.nodeKind !== 'folder' ||
      confirm.view.state !== 'active' ||
      confirm.view.nodeUid !== created.view.folderUid
    ) {
      return finish('created_folder_unconfirmed', 'confirm_namespace')
    }
    namespaceConfirmed = true

    // ── R5: all three object paths, under the confirmed parent, before ANY upload ──
    for (const role of ROLES) {
      const step = `preflight_${role}`
      if (cancelled()) return finish('attempt_cancelled', step)
      const objInfo = await callBoundary(step, 'info', remotePaths[role], () =>
        deps.cloud.runInfo({ remotePath: remotePaths[role], ...boundaryOptions }),
      )
      if (objInfo.result !== 'success') return finish(codeForNonSuccess(objInfo.result), step)
      if (objInfo.finding !== 'absent') return finish('remote_path_occupied', step)
    }

    // ── U1-U3: ciphertext, then checksum, then manifest; stop at the first non-success ──
    for (const role of ROLES) {
      const step = `upload_${role}`
      if (cancelled()) return finish('attempt_cancelled', step)
      if (!unchanged(deps, localPaths[role], measured[role].id)) {
        return finish('local_triple_changed', step)
      }
      const uploadTarget = {
        kind: 'upload',
        localFilePath: localPaths[role],
        remoteParentPath: remote.namespace,
      }
      assertWriteTarget(uploadTarget)
      const uploaded = await callBoundary(step, 'upload', remotePaths[role], () =>
        deps.cloud.runUpload({
          localFilePath: uploadTarget.localFilePath,
          remoteParentPath: uploadTarget.remoteParentPath,
          expectedLocalSizeBytes: expectedBytes[role],
          ...boundaryOptions,
        }),
      )
      if (!isDefiniteZero(uploaded.result)) uploadNotDefinitelyZero = true
      if (uploaded.result !== 'success') return finish(codeForNonSuccess(uploaded.result), step)
      furthestUploadSuccessReportedRole = role
      if (!unchanged(deps, localPaths[role], measured[role].id)) {
        return finish('local_source_changed', step)
      }
    }

    return finish(null, null)
  }

  /** Prepare followed by execute — the E3J5 single-call form. */
  async function runUploadAttempt(args) {
    const prepared = prepareUploadAttempt(args)
    return executeUploadAttempt({
      prepared,
      signal: args !== null && typeof args === 'object' ? args.signal : undefined,
    })
  }

  return Object.freeze({ prepareUploadAttempt, executeUploadAttempt, runUploadAttempt })
}
