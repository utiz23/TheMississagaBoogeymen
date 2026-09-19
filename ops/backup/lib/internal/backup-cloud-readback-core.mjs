/**
 * Contained readback, workspace, capacity, and cleanup — INTERNAL
 * IMPLEMENTATION CORE (E3J6B).
 *
 * WHAT THIS FILE IS
 * ------------------
 * Every line of the readback-session logic. It does NOT bind its own real
 * dependencies: `makeReadbackRunner(deps)` builds the five production
 * operations against a supplied dependency set. `../backup-cloud-readback.mjs`
 * is THE production API. It binds `REAL_READBACK_DEPS` once at module load.
 *
 * THE READBACK SESSION
 * ----------------------
 * `establishReadbackSession({config, artifactBase, attemptId, sourceEvidence})`
 * binds, once, `readback.dir`'s canonical identity AND the readback's entire
 * operational authority — CLI executable and hash pin, credential backend,
 * timeouts, the three canonical remote paths (derived here via
 * `buildPublishedObjectPaths()`, never supplied), and a validated private copy
 * of the source evidence within the per-role ceilings.
 * `readBackAttemptTriple({session, signal})` reads nothing else. The session
 * registry is private to each `makeReadbackRunner()` instance. Every later operation
 * (`proveReadbackCapacity`, `setupAttemptWorkspace`, `readBackAttemptTriple`,
 * `cleanupAttemptWorkspace`) takes the SAME session and reverifies that
 * identity before doing anything. A capacity result measured under one
 * filesystem identity can never authorize workspace creation on a
 * replacement filesystem: `setupAttemptWorkspace()` reverifies independently,
 * from scratch, before creating anything.
 *
 * Workspace and role-directory identities are recorded the moment each is
 * created and authenticated, so a partial setup failure still leaves exact
 * cleanup authority; an object created but not authenticated is residue that
 * is never deleted. Workspace and role-directory identities, the exact expected downloaded
 * filenames, per-role downloaded-file identity, and whether any invoked
 * child had unconfirmed termination are ALL private session state — never
 * returned through any public function. `cleanupAttemptWorkspace({session})`
 * takes no other argument: a caller cannot forge an inode identity or claim
 * termination was confirmed. It consults only what `setupAttemptWorkspace()`
 * and `readBackAttemptTriple()` themselves recorded.
 *
 * READBACK ORDER AND STOPPING
 * -----------------------------
 * manifest -> checksum -> ciphertext (deliberately reversed from upload's
 * ciphertext -> checksum -> manifest order — read the two small objects
 * first so a broken artifact fails before the large ciphertext download).
 * Per role: `runInfo` -> `runContainedDownload` -> independent no-follow
 * hash/byte recompute, compared against `sourceEvidence` BEFORE anything is
 * parsed. The sequence stops at the first role that does not match; a
 * mismatched role's bytes are never parsed. Only once all three match does
 * the bounded in-memory `verifyArtifactCompletion()` adapter run — reused
 * bytes already held in memory, zero additional filesystem I/O. Because the
 * downloaded bytes are, by that point, already proven byte-identical to
 * `sourceEvidence` (itself already validated complete at prepare time), a
 * completion-adapter failure here is a logical contradiction, never new
 * evidence about the artifact — `completion_adapter_internal_contradiction`,
 * indeterminate, never a conclusive rejection.
 *
 * TERMINATION UNCERTAINTY STOPS EVERYTHING
 * -------------------------------------------
 * A `provider_termination_unconfirmed` result from ANY invoked child (info
 * or contained-download) stops the sequence immediately, performs NO
 * readback cleanup for anything, at any role, and marks the session so
 * `cleanupAttemptWorkspace()` withholds cleanup entirely.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'

import {
  BackupError,
  publishedTripleNames,
  verifyArtifactCompletion,
} from '../backup-artifact-contract.mjs'
import { CLOUD_CLI_ERROR_CODES, runContainedDownload, runInfo } from '../backup-cloud-cli.mjs'
// (imported here only to build REAL_READBACK_DEPS.cloud — see below; every
// call site inside this module goes through the injected `deps.cloud`.)
import { validateCloudConfig } from '../backup-cloud-config.mjs'
import {
  ATTEMPT_ID_PATTERN,
  assertSafeRemoteComponent,
  assertValidArtifactBase,
  buildPublishedObjectPaths,
} from '../backup-cloud-naming.mjs'
import { REAL_EVIDENCE_READER } from './backup-cloud-source-evidence.mjs'
import {
  observeOwnedDirectoryIdentity,
  observeTrustedDirectoryIdentity,
  sameIdentity,
} from './backup-cloud-directory-authority.mjs'

export const ROLES = Object.freeze(['manifest', 'checksum', 'ciphertext'])

/** The complete closed set of codes this module can ever produce. */
export const CLOUD_READBACK_CODES = Object.freeze([
  'readback_dir_untrusted',
  'readback_dir_identity_changed',
  'capacity_unprovable',
  'capacity_insufficient',
  'workspace_setup_failed',
  'workspace_collision',
  'remote_object_absent',
  'remote_object_not_active_file',
  'role_hash_mismatch',
  'role_size_mismatch',
  'credential_unavailable',
  'provider_termination_unconfirmed',
  'download_containment_tripped',
  'download_containment_violated',
  'download_size_mismatch',
  'workspace_invariant_violated',
  'internal_invariant_violated',
  'provider_spawn_failed',
  'provider_timeout',
  'provider_cancelled',
  'provider_output_overflow',
  'provider_stream_failed',
  'provider_response_malformed',
  'provider_response_unexpected_shape',
  'provider_stderr_on_success',
  'provider_error_unrecognised',
  'completion_adapter_internal_contradiction',
])

const READBACK_INDETERMINATE_GENERIC = new Set([
  'provider_spawn_failed',
  'provider_timeout',
  'provider_cancelled',
  'provider_output_overflow',
  'provider_stream_failed',
  'provider_response_malformed',
  'provider_response_unexpected_shape',
  'provider_stderr_on_success',
  'provider_error_unrecognised',
])
const WORKSPACE_INVARIANT_BOUNDARY_CODES = new Set([
  'download_destination_exists',
  'local_preflight_failed',
  'local_readback_missing',
  'local_readback_not_regular_file',
])
const INFO_REACHABLE_CODES = new Set([
  ...READBACK_INDETERMINATE_GENERIC,
  'credential_unavailable',
  'provider_termination_unconfirmed',
])
const DOWNLOAD_REACHABLE_CODES = new Set([
  ...READBACK_INDETERMINATE_GENERIC,
  'credential_unavailable',
  'provider_termination_unconfirmed',
  ...WORKSPACE_INVARIANT_BOUNDARY_CODES,
  'download_size_mismatch',
  'download_containment_tripped',
  'download_containment_violated',
])

function invalidInput(what) {
  throw new BackupError('cloud_attempt_invalid_input', `${what} is invalid.`)
}

/** A boundary code is recorded only if it is a member of the closed E3J4 set — never verbatim. */
function closedBoundaryCode(code) {
  return CLOUD_CLI_ERROR_CODES.includes(code) ? code : null
}

function terminationOf(code) {
  return code === 'provider_termination_unconfirmed' ? 'unconfirmed' : 'confirmed'
}

/**
 * Classify a non-success `runInfo()` result for readback purposes. Every
 * boundary code not structurally reachable from `info` is
 * `internal_invariant_violated` — a defensive catch-all, never silently
 * accepted. `credential_unavailable` is deliberately INDETERMINATE here,
 * never the boundary's own `rejected` framing: a credential failure proves
 * nothing about the remote artifact's validity.
 */
function classifyInfoFailure(result) {
  const code = result.code
  if (!INFO_REACHABLE_CODES.has(code)) {
    return {
      verdict: 'indeterminate',
      code: 'internal_invariant_violated',
      boundaryCode: closedBoundaryCode(code),
      termination: 'confirmed',
    }
  }
  return { verdict: 'indeterminate', code, boundaryCode: code, termination: terminationOf(code) }
}

/** Same shape, for a non-success `runContainedDownload()` result. */
function classifyDownloadFailure(result) {
  const code = result.code
  if (!DOWNLOAD_REACHABLE_CODES.has(code)) {
    return {
      verdict: 'indeterminate',
      code: 'internal_invariant_violated',
      boundaryCode: closedBoundaryCode(code),
      termination: 'confirmed',
    }
  }
  const finalCode = WORKSPACE_INVARIANT_BOUNDARY_CODES.has(code)
    ? 'workspace_invariant_violated'
    : code
  return {
    verdict: 'indeterminate',
    code: finalCode,
    boundaryCode: code,
    termination: terminationOf(code),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Independent no-follow hash/byte recompute of a just-downloaded file.
// ─────────────────────────────────────────────────────────────────────────────

function fstatIdentity(deps, fd) {
  try {
    const st = deps.evidence.fstat(fd)
    if (st === null || typeof st !== 'object' || typeof st.isFile !== 'function') return null
    if (st.isFile() !== true) return null
    const id = { dev: st.dev, ino: st.ino, size: st.size, uid: st.uid, mode: st.mode }
    for (const value of Object.values(id)) if (typeof value !== 'bigint') return null
    return id
  } catch {
    return null
  }
}

/**
 * Read a downloaded file through a no-follow descriptor, hashing and
 * counting it. `keepContent` retains the decoded text (checksum/manifest
 * only, already bounded by their own readback ceilings).
 */
function hashDownloadedFile({ filePath, ceiling, keepContent }, deps) {
  let fd
  try {
    fd = deps.evidence.open(filePath)
  } catch {
    return { ok: false }
  }
  try {
    const before = fstatIdentity(deps, fd)
    if (before === null) return { ok: false }
    if (before.size < 0n || before.size > BigInt(ceiling)) return { ok: false }
    const hash = createHash('sha256')
    const chunks = []
    const buf = Buffer.alloc(1 << 16)
    let total = 0
    for (;;) {
      const n = deps.evidence.read(fd, buf)
      if (!Number.isSafeInteger(n) || n < 0 || n > buf.length) return { ok: false }
      if (n === 0) break
      total += n
      if (total > ceiling) return { ok: false }
      hash.update(buf.subarray(0, n))
      if (keepContent) chunks.push(Buffer.from(buf.subarray(0, n)))
    }
    const after = fstatIdentity(deps, fd)
    if (after === null) return { ok: false }
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size)
      return { ok: false }
    if (BigInt(total) !== after.size) return { ok: false }
    // Only a file this user owns is ever measured — and so ever later unlinked.
    if (after.uid !== BigInt(deps.geteuid())) return { ok: false }
    return {
      ok: true,
      bytes: total,
      sha256: hash.digest('hex'),
      content: keepContent ? Buffer.concat(chunks).toString('utf8') : null,
      // The complete identity cleanup must re-observe before it may unlink.
      identity: Object.freeze({
        dev: after.dev,
        ino: after.ino,
        size: after.size,
        uid: after.uid,
        mode: after.mode & 0o7777n,
      }),
    }
  } catch {
    return { ok: false }
  } finally {
    try {
      deps.evidence.close(fd)
    } catch {
      /* read-only, and the measurement is already complete or already failed */
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The bounded in-memory completion adapter — no additional filesystem I/O.
// Exported for independent testing with synthetic inputs.
// ─────────────────────────────────────────────────────────────────────────────

const ADAPTER_SENTINEL_DIR = '/eanhl-readback-adapter'

/**
 * @param {object} args
 * @param {string} args.artifactBase
 * @param {string} args.manifestText
 * @param {string} args.checksumText
 * @param {string} args.ciphertextSha256
 * @param {number} args.ciphertextBytes
 * @returns {{ok: boolean}} — only the boolean is ever consumed by a caller.
 */
export function runCompletionAdapter({
  artifactBase,
  manifestText,
  checksumText,
  ciphertextSha256,
  ciphertextBytes,
}) {
  const names = publishedTripleNames(artifactBase)
  const ciphertextPath = `${ADAPTER_SENTINEL_DIR}/${names.ciphertext}`
  const checksumPath = `${ADAPTER_SENTINEL_DIR}/${names.checksum}`
  const manifestPath = `${ADAPTER_SENTINEL_DIR}/${names.manifest}`
  const shimFs = {
    existsSync: (p) => p === ciphertextPath || p === checksumPath || p === manifestPath,
    readFileSync: (p) => {
      if (p === checksumPath) return checksumText
      if (p === manifestPath) return manifestText
      throw new Error('unexpected path')
    },
    statSync: (p) => {
      if (p !== ciphertextPath) throw new Error('unexpected path')
      return { size: ciphertextBytes }
    },
  }
  const shimSha256File = (p) => {
    if (p !== ciphertextPath) throw new Error('unexpected path')
    return ciphertextSha256
  }
  try {
    const result = verifyArtifactCompletion({
      dir: ADAPTER_SENTINEL_DIR,
      base: artifactBase,
      deps: { fs: shimFs, sha256File: shimSha256File },
    })
    return { ok: result?.complete === true }
  } catch {
    return { ok: false }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The factory.
// ─────────────────────────────────────────────────────────────────────────────

function assertValidDeps(deps) {
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')
  for (const name of [
    'lstat',
    'realpath',
    'geteuid',
    'mkdir',
    'unlink',
    'rmdir',
    'statfs',
    'verifyCompletion',
  ]) {
    if (typeof deps[name] !== 'function') return invalidInput('deps')
  }
  if (deps.evidence === null || typeof deps.evidence !== 'object') return invalidInput('deps')
  for (const name of ['open', 'fstat', 'read', 'close']) {
    if (typeof deps.evidence[name] !== 'function') return invalidInput('deps')
  }
  if (deps.cloud === null || typeof deps.cloud !== 'object') return invalidInput('deps')
  if (
    typeof deps.cloud.runInfo !== 'function' ||
    typeof deps.cloud.runContainedDownload !== 'function'
  ) {
    return invalidInput('deps')
  }
}

function joinDir(dir, name) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

const SHA256_HEX = /^[0-9a-f]{64}$/
const SOURCE_EVIDENCE_KEYS = ['ciphertext', 'checksum', 'manifest', 'snapshotTs', 'runId']

/**
 * Validate and privately COPY a prepared attempt's `sourceEvidence`: exactly
 * the five keys a ready preparation produces, each role a lowercase SHA-256
 * and a positive byte count no larger than that role's readback ceiling.
 * The copy is what the session binds — later mutation of the caller's object
 * changes nothing.
 */
function bindSourceEvidence(sourceEvidence, ceilings) {
  if (sourceEvidence === null || typeof sourceEvidence !== 'object') {
    return invalidInput('sourceEvidence')
  }
  const keys = Object.keys(sourceEvidence).sort()
  const expected = [...SOURCE_EVIDENCE_KEYS].sort()
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    return invalidInput('sourceEvidence')
  }
  const bound = {}
  for (const role of ROLES) {
    const r = sourceEvidence[role]
    if (r === null || typeof r !== 'object') return invalidInput(`sourceEvidence.${role}`)
    const rk = Object.keys(r).sort()
    if (rk.length !== 2 || rk[0] !== 'bytes' || rk[1] !== 'sha256') {
      return invalidInput(`sourceEvidence.${role}`)
    }
    if (typeof r.sha256 !== 'string' || !SHA256_HEX.test(r.sha256)) {
      return invalidInput(`sourceEvidence.${role}.sha256`)
    }
    if (!Number.isSafeInteger(r.bytes) || r.bytes < 1 || r.bytes > ceilings[role]) {
      return invalidInput(`sourceEvidence.${role}.bytes`)
    }
    bound[role] = Object.freeze({ sha256: r.sha256, bytes: r.bytes })
  }
  if (typeof sourceEvidence.snapshotTs !== 'string' || sourceEvidence.snapshotTs === '') {
    return invalidInput('sourceEvidence.snapshotTs')
  }
  if (typeof sourceEvidence.runId !== 'string' || sourceEvidence.runId === '') {
    return invalidInput('sourceEvidence.runId')
  }
  return Object.freeze(bound)
}

export function makeReadbackRunner(deps) {
  assertValidDeps(deps)

  // FACTORY-PRIVATE: every `makeReadbackRunner()` instance owns its own
  // registry. A session produced by any other instance — even one bound to
  // the identical dependency set, with an identical visible shape — is
  // `record_session_invalid` here.
  const SESSIONS = new WeakMap()

  function dirStillTrusted(entry) {
    const now = observeTrustedDirectoryIdentity(entry.dir, deps)
    return sameIdentity(now, { dev: entry.dev, ino: entry.ino, uid: entry.uid, mode: entry.mode })
  }

  function assertReadbackDirStillTrusted(entry) {
    if (!dirStillTrusted(entry)) {
      throw new BackupError(
        'readback_dir_identity_changed',
        'the readback directory identity has changed.',
      )
    }
  }

  function getEntry(session) {
    const entry =
      session !== null && typeof session === 'object' ? SESSIONS.get(session) : undefined
    if (entry === undefined) {
      throw new BackupError(
        'record_session_invalid',
        'the readback session was not produced by this module.',
      )
    }
    return entry
  }

  /**
   * Bind, ONCE, everything the readback may ever act with: the readback
   * directory's identity, the validated CLI executable and its hash pin, the
   * credential backend, the operation/cancellation timeouts, the three
   * canonical remote object paths (derived here from the validated config,
   * `artifactBase`, and `attemptId` — never supplied), the validated source
   * evidence and the per-role ceilings. Nothing later accepts a replacement
   * for any of them.
   */
  function establishReadbackSession(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { config, artifactBase, attemptId, sourceEvidence } = args
    let cfg
    try {
      cfg = validateCloudConfig(config)
    } catch {
      return invalidInput('config')
    }
    try {
      assertSafeRemoteComponent(artifactBase, 'artifactBase')
      assertValidArtifactBase(artifactBase)
    } catch {
      return invalidInput('artifactBase')
    }
    if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId))
      return invalidInput('attemptId')
    let published
    try {
      published = buildPublishedObjectPaths({
        remoteRoot: cfg.remote.root,
        artifactBase,
        attemptId,
      })
    } catch {
      return invalidInput('remote paths')
    }
    const ceilings = Object.freeze({
      ciphertext: cfg.readback.maxCiphertextBytes,
      checksum: cfg.readback.maxSidecarBytes,
      manifest: cfg.readback.maxManifestBytes,
    })
    const evidence = bindSourceEvidence(sourceEvidence, ceilings)

    const dirId = observeTrustedDirectoryIdentity(cfg.readback.dir, deps)
    if (dirId === null) {
      throw new BackupError('readback_dir_untrusted', 'the readback directory is not trusted.')
    }
    const session = Object.freeze({})
    SESSIONS.set(session, {
      cfg,
      dir: cfg.readback.dir,
      dev: dirId.dev,
      ino: dirId.ino,
      uid: dirId.uid,
      mode: dirId.mode,
      artifactBase,
      attemptId,
      // ── sealed operational authority ──
      boundary: Object.freeze({
        cli: Object.freeze({
          executable: cfg.cli.executable,
          expectedSha512: cfg.cli.expectedSha512,
        }),
        credentials: Object.freeze({ ...cfg.credentials }),
        timeouts: Object.freeze({
          operationTimeoutMs: cfg.run.operationTimeoutMs,
          cancelGraceMs: cfg.run.cancelGraceMs,
        }),
      }),
      wrapper: cfg.readback.rlimitWrapper,
      remotePaths: Object.freeze({
        manifest: published.manifestPath,
        checksum: published.checksumPath,
        ciphertext: published.ciphertextPath,
      }),
      sourceEvidence: evidence,
      ceilings,
      expectedFilenames: publishedTripleNames(artifactBase),
      // ── lifecycle ──
      capacityProven: false,
      setupAttempted: false,
      workspaceReady: false,
      readbackStarted: false,
      workspacePath: joinDir(cfg.readback.dir, `${artifactBase}.${attemptId}`),
      // Recorded the MOMENT each object is created and authenticated — never
      // deferred until every role exists — so a later setup failure still
      // leaves exact authority to clean up precisely what was made.
      workspaceId: null,
      roleDirs: { manifest: null, checksum: null, ciphertext: null },
      // An object this session created (mkdir succeeded) but could not then
      // authenticate: never deleted, and always makes cleanup `incomplete`.
      unauthenticatedResidue: false,
      downloadedIdentity: { manifest: null, checksum: null, ciphertext: null },
      anyUnconfirmedTermination: false,
    })
    return session
  }

  async function proveReadbackCapacity(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const entry = getEntry(args.session)
    assertReadbackDirStillTrusted(entry)

    const { capacity, readback } = entry.cfg
    const b = (n) => BigInt(n)
    const reserve =
      b(capacity.minFreeBytes) +
      b(readback.maxCiphertextBytes) +
      b(readback.maxManifestBytes) +
      b(readback.maxSidecarBytes)

    let st
    try {
      st = deps.statfs(entry.dir)
    } catch {
      return { ok: false, code: 'capacity_unprovable' }
    }
    const availBytes = b(st.bavail) * b(st.bsize)

    if (capacity.backingVolume !== null) {
      const mount = capacity.backingVolume.mountPoint
      const c = entry.dir.replace(/\/+$/, '')
      const p = mount.replace(/\/+$/, '')
      const contained = c === p || c.startsWith(`${p}/`)
      if (!contained) return { ok: false, code: 'capacity_unprovable' }
      let devReadback, devMount
      try {
        devReadback = deps.lstat(entry.dir).dev
        devMount = deps.lstat(mount).dev
      } catch {
        return { ok: false, code: 'capacity_unprovable' }
      }
      if (devReadback !== devMount) return { ok: false, code: 'capacity_unprovable' }
      let stVol
      try {
        stVol = deps.statfs(mount)
      } catch {
        return { ok: false, code: 'capacity_unprovable' }
      }
      const volAvail = b(stVol.bavail) * b(stVol.bsize)
      const volReserve =
        b(capacity.backingVolume.minFreeBytes) +
        b(readback.maxCiphertextBytes) +
        b(readback.maxManifestBytes) +
        b(readback.maxSidecarBytes)
      if (volAvail < volReserve) return { ok: false, code: 'capacity_insufficient' }
    }
    if (availBytes < reserve) return { ok: false, code: 'capacity_insufficient' }
    entry.capacityProven = true
    return { ok: true }
  }

  /**
   * Create `<readback.dir>/<base>.<attemptId>/` and its three role
   * directories, each mode 0700. Each object's identity is recorded in the
   * session IMMEDIATELY after it is created and authenticated. A `mkdir`
   * that succeeded but whose result cannot be authenticated is recorded only
   * as unauthenticated residue: never trusted, never deleted.
   */
  async function setupAttemptWorkspace(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const entry = getEntry(args.session)
    if (entry.capacityProven !== true)
      return invalidInput('session (capacity must be proven first)')
    assertReadbackDirStillTrusted(entry)
    entry.setupAttempted = true

    try {
      deps.mkdir(entry.workspacePath, 0o700)
    } catch (err) {
      // Nothing was created — an EEXIST object is someone else's and is never touched.
      return {
        ok: false,
        code: err?.code === 'EEXIST' ? 'workspace_collision' : 'workspace_setup_failed',
      }
    }
    if (entry.workspaceId !== null) return invalidInput('session (workspace already recorded)')
    const workspaceId = observeOwnedDirectoryIdentity(entry.workspacePath, entry.dev, deps)
    if (workspaceId === null) {
      entry.unauthenticatedResidue = true
      return { ok: false, code: 'workspace_setup_failed' }
    }
    entry.workspaceId = workspaceId

    for (const role of ROLES) {
      const roleDir = joinDir(entry.workspacePath, role)
      try {
        deps.mkdir(roleDir, 0o700)
      } catch {
        return { ok: false, code: 'workspace_setup_failed' }
      }
      const roleId = observeOwnedDirectoryIdentity(roleDir, workspaceId.dev, deps)
      if (roleId === null) {
        entry.unauthenticatedResidue = true
        return { ok: false, code: 'workspace_setup_failed' }
      }
      entry.roleDirs[role] = Object.freeze({ path: roleDir, dev: roleId.dev, ino: roleId.ino })
    }

    entry.workspaceReady = true
    return { ok: true }
  }

  function notObservedRole() {
    return {
      attempted: false,
      observed: 'not_observed',
      boundaryCode: null,
      termination: 'not_applicable',
      bytes: null,
      sha256: null,
      matchesSource: null,
    }
  }

  /**
   * Read back the triple, using ONLY the session's sealed authority. The
   * argument object is read for exactly two properties: `session` and
   * `signal`. Any other property — a `cli`, `credentials`, `timeouts`,
   * `remotePaths`, or `sourceEvidence` — is never read.
   */
  async function readBackAttemptTriple(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const session = args.session
    const signal = args.signal
    const entry = getEntry(session)
    if (signal !== undefined && !(signal instanceof AbortSignal)) return invalidInput('signal')
    if (entry.workspaceReady !== true)
      return invalidInput('session (workspace must be set up first)')
    if (entry.readbackStarted === true) return invalidInput('session (readback already ran)')
    entry.readbackStarted = true

    const boundaryOptions = { ...entry.boundary, signal }
    const { remotePaths, sourceEvidence, ceilings } = entry

    const roles = {
      manifest: notObservedRole(),
      checksum: notObservedRole(),
      ciphertext: notObservedRole(),
    }
    const content = { checksum: null, manifest: null }
    let stoppedAtRole = null
    let overallCode = null
    let overallVerdict = null
    let unconfirmedTermination = false

    for (const role of ROLES) {
      if (!dirStillTrusted(entry)) {
        roles[role] = { ...notObservedRole(), attempted: true }
        stoppedAtRole = role
        overallCode = 'readback_dir_identity_changed'
        overallVerdict = 'indeterminate'
        break
      }
      if (
        !sameIdentity(
          observeOwnedDirectoryIdentity(entry.roleDirs[role].path, entry.workspaceId.dev, deps),
          {
            dev: entry.roleDirs[role].dev,
            ino: entry.roleDirs[role].ino,
          },
        )
      ) {
        roles[role] = { ...notObservedRole(), attempted: true }
        stoppedAtRole = role
        overallCode = 'internal_invariant_violated'
        overallVerdict = 'indeterminate'
        break
      }

      roles[role].attempted = true
      const infoResult = await deps.cloud.runInfo({
        remotePath: remotePaths[role],
        ...boundaryOptions,
      })
      if (infoResult.kind !== 'success') {
        const c = classifyInfoFailure(infoResult)
        roles[role] = {
          ...roles[role],
          observed: 'other',
          boundaryCode: c.boundaryCode,
          termination: c.termination,
        }
        stoppedAtRole = role
        overallCode = c.code
        overallVerdict = c.verdict
        if (c.termination === 'unconfirmed') unconfirmedTermination = true
        break
      }
      if (infoResult.present === false) {
        roles[role] = { ...roles[role], observed: 'absent', termination: 'confirmed' }
        stoppedAtRole = role
        overallCode = 'remote_object_absent'
        overallVerdict = 'rejected'
        break
      }
      if (infoResult.nodeKind !== 'file' || infoResult.state !== 'active') {
        roles[role] = { ...roles[role], observed: 'other', termination: 'confirmed' }
        stoppedAtRole = role
        overallCode = 'remote_object_not_active_file'
        overallVerdict = 'rejected'
        break
      }
      roles[role].observed = 'active_file'

      const roleDir = entry.roleDirs[role]
      const expectedLocalPath = joinDir(roleDir.path, entry.expectedFilenames[role])
      const downloadResult = await deps.cloud.runContainedDownload({
        remotePath: remotePaths[role],
        localDir: roleDir.path,
        expectedLocalPath,
        maxFileBytes: ceilings[role],
        wrapper: entry.wrapper,
        ...boundaryOptions,
      })
      if (downloadResult.kind !== 'success') {
        const c = classifyDownloadFailure(downloadResult)
        roles[role] = { ...roles[role], boundaryCode: c.boundaryCode, termination: c.termination }
        stoppedAtRole = role
        overallCode = c.code
        overallVerdict = c.verdict
        if (c.termination === 'unconfirmed') unconfirmedTermination = true
        break
      }

      const hashed = hashDownloadedFile(
        {
          filePath: expectedLocalPath,
          ceiling: ceilings[role],
          keepContent: role !== 'ciphertext',
        },
        deps,
      )
      if (!hashed.ok) {
        roles[role] = { ...roles[role], termination: 'confirmed' }
        stoppedAtRole = role
        overallCode = 'internal_invariant_violated'
        overallVerdict = 'indeterminate'
        break
      }
      // A measured file is an exact, authenticated object — recorded for
      // cleanup whether or not its content then matches the source.
      entry.downloadedIdentity[role] = hashed.identity
      const expected = sourceEvidence[role]
      const bytesMatch = hashed.bytes === expected.bytes
      const hashMatch = hashed.sha256 === expected.sha256
      roles[role] = {
        ...roles[role],
        termination: 'confirmed',
        bytes: hashed.bytes,
        sha256: hashed.sha256,
        matchesSource: bytesMatch && hashMatch,
      }
      if (!bytesMatch || !hashMatch) {
        stoppedAtRole = role
        overallCode = bytesMatch ? 'role_hash_mismatch' : 'role_size_mismatch'
        overallVerdict = 'rejected'
        break
      }
      if (role !== 'ciphertext') content[role] = hashed.content
    }

    entry.anyUnconfirmedTermination = unconfirmedTermination

    let completion = { checked: false, ok: null }
    if (stoppedAtRole === null) {
      // Total: an adapter that throws is the same internal contradiction as
      // one that returns false — never an escaping exception.
      let ok = false
      try {
        const adapterResult = deps.verifyCompletion({
          artifactBase: entry.artifactBase,
          manifestText: content.manifest,
          checksumText: content.checksum,
          ciphertextSha256: sourceEvidence.ciphertext.sha256,
          ciphertextBytes: sourceEvidence.ciphertext.bytes,
        })
        ok = adapterResult?.ok === true
      } catch {
        ok = false
      }
      completion = { checked: true, ok }
      if (!ok) {
        overallCode = 'completion_adapter_internal_contradiction'
        overallVerdict = 'indeterminate'
      }
    }

    return Object.freeze({
      performed: true,
      roles: Object.freeze(Object.fromEntries(ROLES.map((r) => [r, Object.freeze(roles[r])]))),
      completion: Object.freeze(completion),
      stoppedAtRole,
      overallCode,
      overallVerdict,
      terminationConfirmed: !unconfirmedTermination,
    })
  }

  /**
   * Re-observe a downloaded file's COMPLETE captured identity immediately
   * before unlinking it: a regular, non-symlink file with the same dev/ino,
   * owner, mode, and size that was measured. Anything else is left alone.
   */
  function downloadedFileUnchanged(filePath, captured) {
    try {
      const st = deps.lstat(filePath)
      return (
        st !== null &&
        typeof st === 'object' &&
        st.isSymbolicLink() === false &&
        st.isFile() === true &&
        st.dev === captured.dev &&
        st.ino === captured.ino &&
        st.uid === captured.uid &&
        st.uid === BigInt(deps.geteuid()) &&
        (st.mode & 0o7777n) === captured.mode &&
        st.size === captured.size
      )
    } catch {
      return false
    }
  }

  /**
   * Exact, conservative, non-recursive cleanup of ONLY the objects this
   * session created and authenticated — including after a PARTIAL setup.
   * Returns `not_started` if the session never created anything,
   * `withheld_termination_unconfirmed` if any child's termination is
   * unconfirmed, `complete` only when every created object was removed, and
   * otherwise `incomplete` (an unauthenticated residue, a changed identity,
   * an unexpected sibling, or a failed removal — none of which is ever forced).
   */
  async function cleanupAttemptWorkspace(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const entry = getEntry(args.session)
    if (entry.anyUnconfirmedTermination) return { state: 'withheld_termination_unconfirmed' }
    if (entry.workspaceId === null) {
      return { state: entry.unauthenticatedResidue ? 'incomplete' : 'not_started' }
    }

    let incomplete = entry.unauthenticatedResidue
    for (const role of ROLES) {
      const roleId = entry.roleDirs[role]
      if (roleId === null) continue // never created (setup stopped before this role)
      const roleIdOnly = { dev: roleId.dev, ino: roleId.ino }
      if (
        !sameIdentity(
          observeOwnedDirectoryIdentity(roleId.path, entry.workspaceId.dev, deps),
          roleIdOnly,
        )
      ) {
        incomplete = true
        continue
      }
      const downloaded = entry.downloadedIdentity[role]
      if (downloaded !== null) {
        const filePath = joinDir(roleId.path, entry.expectedFilenames[role])
        if (!downloadedFileUnchanged(filePath, downloaded)) {
          incomplete = true
          continue
        }
        try {
          deps.unlink(filePath)
        } catch {
          incomplete = true
          continue
        }
      }
      if (
        !sameIdentity(
          observeOwnedDirectoryIdentity(roleId.path, entry.workspaceId.dev, deps),
          roleIdOnly,
        )
      ) {
        incomplete = true
        continue
      }
      try {
        deps.rmdir(roleId.path)
      } catch {
        incomplete = true
      }
    }
    if (
      !sameIdentity(
        observeOwnedDirectoryIdentity(entry.workspacePath, entry.dev, deps),
        entry.workspaceId,
      )
    ) {
      return { state: 'incomplete' }
    }
    try {
      deps.rmdir(entry.workspacePath)
    } catch {
      incomplete = true
    }
    return { state: incomplete ? 'incomplete' : 'complete' }
  }

  return Object.freeze({
    establishReadbackSession,
    proveReadbackCapacity,
    setupAttemptWorkspace,
    readBackAttemptTriple,
    cleanupAttemptWorkspace,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// The real dependency set.
// ─────────────────────────────────────────────────────────────────────────────

export const REAL_READBACK_DEPS = Object.freeze({
  lstat: (p) => fs.lstatSync(p, { bigint: true }),
  realpath: (p) => fs.realpathSync(p),
  geteuid: () => process.geteuid(),
  mkdir: (p, mode) => fs.mkdirSync(p, { mode }),
  unlink: (p) => fs.unlinkSync(p),
  rmdir: (p) => fs.rmdirSync(p),
  statfs: (p) => fs.statfsSync(p, { bigint: true }),
  evidence: REAL_EVIDENCE_READER,
  verifyCompletion: runCompletionAdapter,
  cloud: Object.freeze({ runInfo, runContainedDownload }),
})
