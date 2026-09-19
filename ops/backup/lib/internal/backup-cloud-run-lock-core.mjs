/**
 * Cloud-backup RUN LOCK — INTERNAL IMPLEMENTATION CORE (E3J6C).
 *
 * WHAT THIS FILE IS
 * ------------------
 * Every line of the run-lock logic. `makeRunLock(deps)` builds the four lock
 * operations against a supplied dependency set; `../backup-cloud-run-lock.mjs`
 * is THE production API and binds `REAL_RUN_LOCK_DEPS` once, at module load.
 * This factory is an internal TEST SEAM, not an access-control boundary; a
 * static regression blocks any other `ops/**` importer.
 *
 * THE LOCK FILE
 * --------------
 * `run.lockFile` is created ONCE, with `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|
 * O_CLOEXEC` mode 0600, directly inside an operator-provisioned, trusted
 * directory (existing, not a symlink, owned by the effective uid, no
 * group/world bits, real path equal to itself — this code never creates it).
 * Its bytes are one deterministic JSON line, written once and NEVER modified:
 *
 *   {"kind":"eanhl.cloud-run-lock","schema_version":1,"cloud_run_id":…,
 *    "artifact_base":…,"pid":…,"host":…,"acquired_at":…,"owner_nonce":…}\n
 *
 * Every field is validated and bounded BEFORE anything is created, so the
 * record stays below `CLOUD_RUN_LOCK_CEILING_BYTES`. It carries ACQUISITION
 * METADATA ONLY — there is no retention reason in it, and there is no
 * in-place rewrite or rename-over scheme.
 *
 * AUTHORITY
 * ----------
 * `acquireRunLock()` returns an opaque, empty, frozen handle registered in a
 * `WeakMap` created INSIDE this factory. Only that exact object authorizes
 * `verifyRunLockHeld()` / `releaseRunLock()` / `retainRunLock()`; a structural
 * copy, a JSON clone, or a handle from another factory instance authorizes
 * nothing and touches no file. The `owner_nonce` (16 cryptographic random
 * bytes) binds the EXACT bytes this run wrote; it is not itself an authority.
 * Every handle is ONE-SHOT: release, retain, or a failed held-check settles it
 * permanently.
 *
 * ACQUISITION BOUNDARIES AND RESIDUE
 * ------------------------------------
 *   A0  before O_EXCL creates anything — invalid identity, host, clock,
 *       nonce, untrusted directory, or an EXISTING lock (classified read-only
 *       and left byte-identical): `refused`, filesystem UNCHANGED.
 *   A1  `open` failed for a reason other than EEXIST: a no-follow `lstat`
 *       decides — definitely absent → `refused/lock_create_failed`;
 *       present or unobservable → `uncertain/lock_create_outcome_unknown`.
 *   A2  created, write short or failed → `uncertain/lock_write_incomplete`.
 *   A3  written, fchmod/fsync/fstat validation or close failed →
 *       `uncertain/lock_file_durability_unconfirmed`.
 *   A4  file durable, directory re-observation/descriptor/fsync failed →
 *       `uncertain/lock_dir_durability_unconfirmed`.
 *   A5  directory durable, final pathname verification failed →
 *       `uncertain/lock_path_verification_failed`.
 * An `uncertain` result NEVER carries a handle, and residue is NEVER removed
 * automatically: proving a removal safe would need the path to still name our
 * inode in the trusted directory with our bytes, and a check-then-unlink window
 * would remain anyway. Exclusion is preferred over availability. Every
 * possible residue is refused by the next run (malformed, wrong mode, or a
 * complete record whose pid has gone).
 *
 * RELEASE — PRE-UNLINK VERSUS POST-UNLINK
 * -----------------------------------------
 * Before `unlink` (P1 directory identity, P2 `lstat` identity/uid/mode/size/
 * nlink, P3 exact bytes through a no-follow descriptor, P4 directory identity
 * again) any failure leaves the observed path UNTOUCHED and returns
 * `release_refused`. Once `unlink` has succeeded the old lock is gone from the
 * namespace: a failure to confirm absence or to fsync the directory is
 * `release_durability_unconfirmed`, an object found at the path is
 * `release_replaced` and is never touched, and nothing is ever recreated.
 * The window between P4 and `unlink` is NARROWED, not closed — only a
 * same-uid actor can exploit it, which is the standing caveat of every
 * directory-trust check in this codebase. File identity is `dev`/`ino`/
 * `ctimeNs`; an EXACT byte copy of this run's record (nonce included) that a
 * same-uid actor places on a reused inode number within the kernel's
 * timestamp granularity is indistinguishable from the original — outside
 * this boundary's threat model, and documented rather than claimed closed.
 *
 * NEVER ECHOED
 * -------------
 * No result, thrown error, or code carries lock-file content, a path, a
 * hostname, a pid, a native error message, or a caller-supplied string. An
 * existing lock is classified only into closed codes.
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'

import { BackupError } from '../backup-artifact-contract.mjs'
import { validateCloudConfig } from '../backup-cloud-config.mjs'
import {
  RUN_ID_PATTERN,
  assertSafeRemoteComponent,
  assertValidArtifactBase,
} from '../backup-cloud-naming.mjs'
import {
  observeTrustedDirectoryIdentity,
  sameIdentity,
} from './backup-cloud-directory-authority.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// Schema and bounds.
// ─────────────────────────────────────────────────────────────────────────────

export const CLOUD_RUN_LOCK_KIND = 'eanhl.cloud-run-lock'
export const CLOUD_RUN_LOCK_SCHEMA_VERSION = 1
/** A security/resource ceiling for the one-line record — not a U12/U13 production value. */
export const CLOUD_RUN_LOCK_CEILING_BYTES = 4096

/** Linux's `pid_max` upper bound (2^22). */
const MAX_PID = 4_194_304
const MAX_ARTIFACT_BASE_BYTES = 255
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/
const NONCE_PATTERN = /^[0-9a-f]{32}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const LOCK_KEYS = Object.freeze([
  'kind',
  'schema_version',
  'cloud_run_id',
  'artifact_base',
  'pid',
  'host',
  'acquired_at',
  'owner_nonce',
])

// ─────────────────────────────────────────────────────────────────────────────
// Closed vocabularies.
// ─────────────────────────────────────────────────────────────────────────────

const frozenList = (values) => Object.freeze([...values])

/** Refusals caused by contention or the operator environment — filesystem UNCHANGED. */
export const CLOUD_RUN_LOCK_CONTENTION_REFUSAL_CODES = frozenList([
  'lock_dir_untrusted',
  'lock_host_unrepresentable',
  'lock_path_untrusted',
  'lock_malformed',
  'lock_held_foreign_host',
  'lock_held_live',
  'lock_held_stale_looking',
  'lock_unobservable',
  'lock_create_failed',
])

/** Refusals caused by this run's own identity generation — filesystem UNCHANGED. */
export const CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES = frozenList([
  'lock_identity_invalid',
  'lock_clock_unusable',
  'lock_nonce_unavailable',
])

export const CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES = frozenList([
  ...CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES,
  ...CLOUD_RUN_LOCK_CONTENTION_REFUSAL_CODES,
])

/** Acquisition failed AFTER `O_EXCL` may have created something — residue possible. */
export const CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES = frozenList([
  'lock_create_outcome_unknown',
  'lock_write_incomplete',
  'lock_file_durability_unconfirmed',
  'lock_dir_durability_unconfirmed',
  'lock_path_verification_failed',
])

export const CLOUD_RUN_LOCK_ACQUIRE_KINDS = frozenList(['acquired', 'refused', 'uncertain'])

export const CLOUD_RUN_LOCK_HELD_STATES = frozenList(['held', 'lost', 'replaced', 'unverifiable'])

/** The code each held-check state may carry. */
export const CLOUD_RUN_LOCK_HELD_CODES_BY_STATE = Object.freeze({
  held: frozenList([null]),
  lost: frozenList(['lock_path_absent']),
  replaced: frozenList(['lock_identity_changed', 'lock_content_changed']),
  unverifiable: frozenList([
    'lock_dir_identity_changed',
    'lock_unobservable',
    'lock_handle_invalid',
    'lock_already_settled',
  ]),
})

export const CLOUD_RUN_LOCK_RELEASE_STATES = frozenList([
  'released',
  'release_refused',
  'release_durability_unconfirmed',
  'release_replaced',
])

/** The code each release state may carry. */
export const CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE = Object.freeze({
  released: frozenList([null]),
  release_refused: frozenList([
    'lock_handle_invalid',
    'lock_already_settled',
    'lock_dir_identity_changed',
    'lock_path_absent',
    'lock_identity_changed',
    'lock_content_changed',
    'lock_unobservable',
    'lock_unlink_failed',
  ]),
  release_durability_unconfirmed: frozenList([
    'lock_absence_unconfirmed',
    'lock_dir_identity_changed_after_unlink',
    'lock_dir_fsync_failed',
  ]),
  release_replaced: frozenList(['lock_path_replaced_after_unlink']),
})

/** The ONLY reasons `retainRunLock()` accepts. Nothing else is ever accepted or echoed. */
export const CLOUD_RUN_LOCK_RETAIN_REASONS = frozenList([
  'retain_attestation_unconfirmed',
  'retain_termination_unconfirmed',
  'retain_internal_error',
  'containment_termination_unconfirmed',
  'containment_result_invalid',
  'attempt_report_invalid',
  'attempt_threw',
  'run_internal_error',
])

export const CLOUD_RUN_LOCK_RETAIN_STATES = frozenList(['retained', 'retain_refused'])
export const CLOUD_RUN_LOCK_RETAIN_REFUSAL_CODES = frozenList([
  'lock_handle_invalid',
  'lock_already_settled',
])

// ─────────────────────────────────────────────────────────────────────────────
// Real dependencies.
// ─────────────────────────────────────────────────────────────────────────────

const O = fs.constants
/**
 * Close-on-exec: Node's `fs.constants` does not expose `O_CLOEXEC` on Linux,
 * because libuv ORs it into EVERY `open(2)` it performs (`uv__fs_open`). The
 * `?? 0` keeps the intent explicit where a platform does expose it; the lock
 * suite verifies the flag on every descriptor this module opens through
 * `/proc/self/fdinfo`.
 */
const CREATE_FLAGS = O.O_WRONLY | O.O_CREAT | O.O_EXCL | O.O_NOFOLLOW | (O.O_CLOEXEC ?? 0)
const READ_FLAGS = O.O_RDONLY | O.O_NOFOLLOW | (O.O_NONBLOCK ?? 0) | (O.O_CLOEXEC ?? 0)
const DIR_FLAGS = O.O_RDONLY | (O.O_DIRECTORY ?? 0) | O.O_NOFOLLOW | (O.O_CLOEXEC ?? 0)

/** The REAL dependency set, bound once by `../backup-cloud-run-lock.mjs`. */
export const REAL_RUN_LOCK_DEPS = Object.freeze({
  lstat: (p) => fs.lstatSync(p, { bigint: true }),
  realpath: (p) => fs.realpathSync(p),
  geteuid: () => process.geteuid(),
  open: (p, flags, mode) => fs.openSync(p, flags, mode),
  openDir: (p, flags) => fs.openSync(p, flags),
  write: (fd, buf, offset) => fs.writeSync(fd, buf, offset, buf.length - offset),
  read: (fd, buf, offset, length) => fs.readSync(fd, buf, offset, length, null),
  fstat: (fd) => fs.fstatSync(fd, { bigint: true }),
  fchmod: (fd, mode) => fs.fchmodSync(fd, mode),
  fsync: (fd) => fs.fsyncSync(fd),
  close: (fd) => fs.closeSync(fd),
  unlink: (p) => fs.unlinkSync(p),
  now: () => Date.now(),
  randomBytes: (n) => randomBytes(n),
  hostname: () => os.hostname(),
  pid: process.pid,
  processAlive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return err?.code === 'EPERM'
    }
  },
})

const DEP_FUNCTIONS = Object.freeze([
  'lstat',
  'realpath',
  'geteuid',
  'open',
  'openDir',
  'write',
  'read',
  'fstat',
  'fchmod',
  'fsync',
  'close',
  'unlink',
  'now',
  'randomBytes',
  'hostname',
  'processAlive',
])

function invalidInput() {
  throw new BackupError('cloud_run_lock_invalid_input', 'the run-lock arguments are invalid.')
}

function assertValidDeps(deps) {
  if (deps === null || typeof deps !== 'object') return invalidInput()
  for (const name of DEP_FUNCTIONS) if (typeof deps[name] !== 'function') return invalidInput()
}

function errnoOf(err) {
  try {
    return typeof err?.code === 'string' ? err.code : undefined
  } catch {
    return undefined
  }
}

function parentOf(p) {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/**
 * Strict validation of a parsed lock record: exact key set and every field
 * bounded. Returns `true` or `false`; never throws, never echoes.
 */
export function isValidLockRecord(r) {
  try {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return false
    const keys = Object.keys(r)
    if (keys.length !== LOCK_KEYS.length || !LOCK_KEYS.every((k) => keys.includes(k))) return false
    if (r.kind !== CLOUD_RUN_LOCK_KIND || r.schema_version !== CLOUD_RUN_LOCK_SCHEMA_VERSION)
      return false
    if (typeof r.cloud_run_id !== 'string' || !RUN_ID_PATTERN.test(r.cloud_run_id)) return false
    if (typeof r.artifact_base !== 'string') return false
    if (Buffer.byteLength(r.artifact_base, 'utf8') > MAX_ARTIFACT_BASE_BYTES) return false
    assertSafeRemoteComponent(r.artifact_base, 'artifact_base')
    assertValidArtifactBase(r.artifact_base)
    if (!Number.isSafeInteger(r.pid) || r.pid < 1 || r.pid > MAX_PID) return false
    if (typeof r.host !== 'string' || !HOST_PATTERN.test(r.host)) return false
    if (typeof r.acquired_at !== 'string' || !ISO_UTC.test(r.acquired_at)) return false
    if (typeof r.owner_nonce !== 'string' || !NONCE_PATTERN.test(r.owner_nonce)) return false
    return true
  } catch {
    return false
  }
}

/** The one deterministic serialization: fixed key order, one line, trailing newline. */
function serializeLockRecord(r) {
  const ordered = {
    kind: r.kind,
    schema_version: r.schema_version,
    cloud_run_id: r.cloud_run_id,
    artifact_base: r.artifact_base,
    pid: r.pid,
    host: r.host,
    acquired_at: r.acquired_at,
    owner_nonce: r.owner_nonce,
  }
  return Buffer.from(JSON.stringify(ordered) + '\n', 'utf8')
}

const frozenResult = (obj) => Object.freeze({ ...obj })

/**
 * Build the four lock operations against a supplied dependency set.
 *
 * INTERNAL TEST SEAM — `../backup-cloud-run-lock.mjs` calls this exactly once,
 * with `REAL_RUN_LOCK_DEPS`. Handles are registered per instance.
 */
export function makeRunLock(deps) {
  assertValidDeps(deps)
  const handles = new WeakMap()
  const euid = () => BigInt(deps.geteuid())

  const refused = (code) => frozenResult({ kind: 'refused', code })
  const uncertain = (code) => frozenResult({ kind: 'uncertain', code })

  function safeClose(fd) {
    try {
      deps.close(fd)
      return true
    } catch {
      return false
    }
  }

  /**
   * Read at most CEILING + 1 bytes from `path` through a no-follow,
   * non-blocking, close-on-exec descriptor whose `fstat` must equal the
   * supplied prior `lstat` identity and be a regular file BEFORE any byte is
   * read. A swap to a FIFO or device never blocks: the non-blocking open
   * returns at once and the identity comparison refuses it.
   *
   * @returns {{kind: 'bytes', buf: Buffer} | {kind: 'mismatch'} | {kind: 'unobservable'}}
   */
  function readBounded(path, prior) {
    let fd
    try {
      fd = deps.open(path, READ_FLAGS)
    } catch {
      return { kind: 'unobservable' }
    }
    try {
      const fst = deps.fstat(fd)
      if (fst.dev !== prior.dev || fst.ino !== prior.ino) return { kind: 'mismatch' }
      if (fst.isFile() !== true) return { kind: 'mismatch' }
      const buf = Buffer.alloc(CLOUD_RUN_LOCK_CEILING_BYTES + 1)
      let total = 0
      while (total < buf.length) {
        const n = deps.read(fd, buf, total, buf.length - total)
        if (!Number.isSafeInteger(n) || n < 0) return { kind: 'unobservable' }
        if (n === 0) break
        total += n
      }
      return { kind: 'bytes', buf: buf.subarray(0, total) }
    } catch {
      return { kind: 'unobservable' }
    } finally {
      safeClose(fd)
    }
  }

  /** Read-only classification of an EXISTING lock into one closed code. Never modifies it. */
  function classifyExisting(path, host) {
    let st
    try {
      st = deps.lstat(path)
    } catch {
      return 'lock_unobservable' // vanished or unreadable since EEXIST: never retry creation
    }
    try {
      if (st.isSymbolicLink() !== false || st.isFile() !== true) return 'lock_path_untrusted'
      if (st.uid !== euid() || (st.mode & 0o7777n) !== 0o600n) return 'lock_path_untrusted'
      if (st.size > BigInt(CLOUD_RUN_LOCK_CEILING_BYTES)) return 'lock_malformed'
    } catch {
      return 'lock_unobservable'
    }
    const read = readBounded(path, st)
    if (read.kind === 'mismatch') return 'lock_unobservable'
    if (read.kind !== 'bytes') return 'lock_unobservable'
    if (read.buf.length > CLOUD_RUN_LOCK_CEILING_BYTES) return 'lock_malformed'
    let record
    try {
      const text = read.buf.toString('utf8')
      if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) return 'lock_malformed'
      record = JSON.parse(text.slice(0, -1))
    } catch {
      return 'lock_malformed'
    }
    if (!isValidLockRecord(record)) return 'lock_malformed'
    // Canonical form only: the exact bytes this module would have written.
    if (!serializeLockRecord(record).equals(read.buf)) return 'lock_malformed'
    if (record.host !== host) return 'lock_held_foreign_host'
    let alive = true
    try {
      alive = deps.processAlive(record.pid) !== false
    } catch {
      alive = true
    }
    return alive ? 'lock_held_live' : 'lock_held_stale_looking'
  }

  /** After a non-EEXIST create failure: is anything at the path now? */
  function presenceAfterFailedCreate(path) {
    try {
      deps.lstat(path)
      return 'present'
    } catch (err) {
      return errnoOf(err) === 'ENOENT' ? 'absent' : 'unknown'
    }
  }

  /** Same device, inode AND change time as the file this handle created. */
  function isOurFile(st, entry) {
    return (
      st.dev === entry.fileId.dev &&
      st.ino === entry.fileId.ino &&
      st.ctimeNs === entry.fileId.ctimeNs
    )
  }

  function dirStillTrusted(entry) {
    return sameIdentity(observeTrustedDirectoryIdentity(entry.dir, deps), entry.dirId)
  }

  // ── acquire ────────────────────────────────────────────────────────────────

  function acquireRunLock(args) {
    if (args === null || typeof args !== 'object') return invalidInput()
    const { config, cloudRunId, artifactBase } = args
    let cfg
    try {
      cfg = validateCloudConfig(config)
    } catch {
      return invalidInput()
    }
    const path = cfg.run.lockFile
    const dir = parentOf(path)

    // ── A0: every field validated and bounded before anything is created ──
    if (typeof cloudRunId !== 'string' || !RUN_ID_PATTERN.test(cloudRunId)) {
      return refused('lock_identity_invalid')
    }
    try {
      if (typeof artifactBase !== 'string') return refused('lock_identity_invalid')
      if (Buffer.byteLength(artifactBase, 'utf8') > MAX_ARTIFACT_BASE_BYTES) {
        return refused('lock_identity_invalid')
      }
      assertSafeRemoteComponent(artifactBase, 'artifactBase')
      assertValidArtifactBase(artifactBase)
    } catch {
      return refused('lock_identity_invalid')
    }
    const pid = deps.pid
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) {
      return refused('lock_identity_invalid')
    }
    let nonce = null
    try {
      const raw = deps.randomBytes(16)
      if (Buffer.isBuffer(raw) && raw.length === 16) nonce = raw.toString('hex')
    } catch {
      nonce = null
    }
    if (nonce === null || !NONCE_PATTERN.test(nonce)) return refused('lock_nonce_unavailable')
    let host = null
    try {
      host = deps.hostname()
    } catch {
      host = null
    }
    if (typeof host !== 'string' || !HOST_PATTERN.test(host)) {
      return refused('lock_host_unrepresentable')
    }
    let acquiredAt = null
    try {
      const ms = deps.now()
      if (Number.isFinite(ms)) acquiredAt = new Date(ms).toISOString()
    } catch {
      acquiredAt = null
    }
    if (acquiredAt === null || !ISO_UTC.test(acquiredAt)) return refused('lock_clock_unusable')

    const record = {
      kind: CLOUD_RUN_LOCK_KIND,
      schema_version: CLOUD_RUN_LOCK_SCHEMA_VERSION,
      cloud_run_id: cloudRunId,
      artifact_base: artifactBase,
      pid,
      host,
      acquired_at: acquiredAt,
      owner_nonce: nonce,
    }
    if (!isValidLockRecord(record)) return refused('lock_identity_invalid')
    const bytes = serializeLockRecord(record)
    if (bytes.length > CLOUD_RUN_LOCK_CEILING_BYTES) return refused('lock_identity_invalid')

    const dirId = observeTrustedDirectoryIdentity(dir, deps)
    if (dirId === null) return refused('lock_dir_untrusted')

    // ── the one creating call ──
    let fd
    try {
      fd = deps.open(path, CREATE_FLAGS, 0o600)
    } catch (err) {
      if (errnoOf(err) === 'EEXIST') return refused(classifyExisting(path, host))
      // A1 — nothing is known to have been created unless the path is provably absent.
      return presenceAfterFailedCreate(path) === 'absent'
        ? refused('lock_create_failed')
        : uncertain('lock_create_outcome_unknown')
    }

    // ── A2: write the complete record ──
    try {
      let written = 0
      while (written < bytes.length) {
        const n = deps.write(fd, bytes, written)
        if (!Number.isSafeInteger(n) || n <= 0) throw new Error('short write')
        written += n
      }
    } catch {
      safeClose(fd)
      return uncertain('lock_write_incomplete')
    }

    // ── A3: file mode, file durability, created identity ──
    let fileId
    try {
      deps.fchmod(fd, 0o600)
      deps.fsync(fd)
      const st = deps.fstat(fd)
      const ok =
        st.isFile() === true &&
        st.uid === euid() &&
        (st.mode & 0o7777n) === 0o600n &&
        st.size === BigInt(bytes.length) &&
        st.nlink === 1n &&
        st.dev === dirId.dev &&
        typeof st.ctimeNs === 'bigint'
      if (!ok) throw new Error('created file identity')
      // `ctimeNs` narrows inode-number reuse: a different file that later
      // lands on the same inode number carries a later change time (subject
      // to the kernel's timestamp granularity — see the docblock).
      fileId = { dev: st.dev, ino: st.ino, ctimeNs: st.ctimeNs }
    } catch {
      safeClose(fd)
      return uncertain('lock_file_durability_unconfirmed')
    }
    if (!safeClose(fd)) return uncertain('lock_file_durability_unconfirmed')

    // ── A4: directory durability, on the directory we trusted ──
    const entry = { path, dir, dirId, fileId, bytes, settled: false }
    if (!dirStillTrusted(entry)) return uncertain('lock_dir_durability_unconfirmed')
    let dirFd
    try {
      dirFd = deps.openDir(dir, DIR_FLAGS)
    } catch {
      return uncertain('lock_dir_durability_unconfirmed')
    }
    try {
      const pst = deps.fstat(dirFd)
      if (pst.dev !== dirId.dev || pst.ino !== dirId.ino) throw new Error('dir descriptor')
      deps.fsync(dirFd)
    } catch {
      safeClose(dirFd)
      return uncertain('lock_dir_durability_unconfirmed')
    }
    if (!safeClose(dirFd)) return uncertain('lock_dir_durability_unconfirmed')

    // ── A5: the pathname still names exactly the file we created ──
    if (observeOwned(entry) !== null) return uncertain('lock_path_verification_failed')

    const handle = Object.freeze({})
    handles.set(handle, entry)
    return frozenResult({ kind: 'acquired', handle })
  }

  /**
   * P1-P4 (also the held-check): `null` when the path still names exactly our
   * file with exactly our bytes in the trusted directory; otherwise a frozen
   * `{state, code}` in the held-check vocabulary. Read-only.
   */
  function observeOwned(entry) {
    if (!dirStillTrusted(entry)) {
      return frozenResult({ state: 'unverifiable', code: 'lock_dir_identity_changed' })
    }
    let st
    try {
      st = deps.lstat(entry.path)
    } catch (err) {
      return errnoOf(err) === 'ENOENT'
        ? frozenResult({ state: 'lost', code: 'lock_path_absent' })
        : frozenResult({ state: 'unverifiable', code: 'lock_unobservable' })
    }
    try {
      const ok =
        st.isSymbolicLink() === false &&
        st.isFile() === true &&
        st.dev === entry.fileId.dev &&
        st.ino === entry.fileId.ino &&
        st.ctimeNs === entry.fileId.ctimeNs &&
        st.uid === euid() &&
        (st.mode & 0o7777n) === 0o600n &&
        st.size === BigInt(entry.bytes.length) &&
        st.nlink === 1n
      if (!ok) return frozenResult({ state: 'replaced', code: 'lock_identity_changed' })
    } catch {
      return frozenResult({ state: 'unverifiable', code: 'lock_unobservable' })
    }
    const read = readBounded(entry.path, entry.fileId)
    if (read.kind === 'mismatch') {
      return frozenResult({ state: 'replaced', code: 'lock_identity_changed' })
    }
    if (read.kind !== 'bytes') {
      return frozenResult({ state: 'unverifiable', code: 'lock_unobservable' })
    }
    if (!read.buf.equals(entry.bytes)) {
      return frozenResult({ state: 'replaced', code: 'lock_content_changed' })
    }
    if (!dirStillTrusted(entry)) {
      return frozenResult({ state: 'unverifiable', code: 'lock_dir_identity_changed' })
    }
    return null
  }

  function entryFor(args) {
    try {
      if (args === null || typeof args !== 'object') return undefined
      const { handle } = args
      if (handle === null || typeof handle !== 'object') return undefined
      return handles.get(handle)
    } catch {
      return undefined
    }
  }

  // ── held-ness ──────────────────────────────────────────────────────────────

  /** Read-only. Any non-held result PERMANENTLY settles the handle. */
  function verifyRunLockHeld(args) {
    const entry = entryFor(args)
    if (entry === undefined) {
      return frozenResult({ state: 'unverifiable', code: 'lock_handle_invalid' })
    }
    if (entry.settled) {
      return frozenResult({ state: 'unverifiable', code: 'lock_already_settled' })
    }
    const problem = observeOwned(entry)
    if (problem !== null) {
      entry.settled = true
      return problem
    }
    return frozenResult({ state: 'held', code: null })
  }

  // ── release ────────────────────────────────────────────────────────────────

  function releaseRunLock(args) {
    const entry = entryFor(args)
    const result = (state, code) => frozenResult({ state, code })
    if (entry === undefined) return result('release_refused', 'lock_handle_invalid')
    if (entry.settled) return result('release_refused', 'lock_already_settled')
    entry.settled = true // one-shot, whatever happens below

    // ── P1-P4: nothing is touched on any failure here ──
    const pre = observeOwned(entry)
    if (pre !== null) return result('release_refused', pre.code)

    // ── P5: unlink ──
    try {
      deps.unlink(entry.path)
    } catch {
      // `unlink` reported failure: what is at the path now decides. Absent
      // (the call removed it anyway) or unobservable: the removal may have
      // happened but is not confirmed durable.
      let st
      try {
        st = deps.lstat(entry.path)
      } catch {
        return result('release_durability_unconfirmed', 'lock_absence_unconfirmed')
      }
      try {
        if (isOurFile(st, entry)) return result('release_refused', 'lock_unlink_failed')
      } catch {
        return result('release_durability_unconfirmed', 'lock_absence_unconfirmed')
      }
      return result('release_replaced', 'lock_path_replaced_after_unlink')
    }

    // ── Q1: the old lock is gone from the namespace from here on ──
    let present = null
    try {
      present = deps.lstat(entry.path)
    } catch (err) {
      if (errnoOf(err) !== 'ENOENT') {
        return result('release_durability_unconfirmed', 'lock_absence_unconfirmed')
      }
      present = null
    }
    if (present !== null) {
      try {
        // Our own file still visible after a successful unlink is a
        // contradiction; claim nothing about it.
        if (isOurFile(present, entry)) {
          return result('release_durability_unconfirmed', 'lock_absence_unconfirmed')
        }
      } catch {
        return result('release_durability_unconfirmed', 'lock_absence_unconfirmed')
      }
      // Something else is at the path now. It is not ours; it is never touched.
      return result('release_replaced', 'lock_path_replaced_after_unlink')
    }

    // ── Q2: the directory is still the one we trusted ──
    if (!dirStillTrusted(entry)) {
      return result('release_durability_unconfirmed', 'lock_dir_identity_changed_after_unlink')
    }

    // ── Q3: make the removal durable ──
    let dirFd
    try {
      dirFd = deps.openDir(entry.dir, DIR_FLAGS)
    } catch {
      return result('release_durability_unconfirmed', 'lock_dir_fsync_failed')
    }
    try {
      const pst = deps.fstat(dirFd)
      if (pst.dev !== entry.dirId.dev || pst.ino !== entry.dirId.ino) {
        throw new Error('dir descriptor')
      }
      deps.fsync(dirFd)
    } catch {
      safeClose(dirFd)
      return result('release_durability_unconfirmed', 'lock_dir_fsync_failed')
    }
    if (!safeClose(dirFd)) return result('release_durability_unconfirmed', 'lock_dir_fsync_failed')
    return result('released', null)
  }

  // ── retain ─────────────────────────────────────────────────────────────────

  /**
   * Keep the lock. Writes NOTHING — the lock carries acquisition metadata
   * only, and no reason is ever made durable here. `reason` must be a member
   * of `CLOUD_RUN_LOCK_RETAIN_REASONS`; anything else is refused with a
   * generic error that echoes nothing, before the handle is touched.
   */
  function retainRunLock(args) {
    let reason
    try {
      reason = args !== null && typeof args === 'object' ? args.reason : undefined
    } catch {
      reason = undefined
    }
    if (typeof reason !== 'string' || !CLOUD_RUN_LOCK_RETAIN_REASONS.includes(reason)) {
      throw new BackupError(
        'lock_retain_reason_invalid',
        'the retain reason is not a member of the closed vocabulary.',
      )
    }
    const entry = entryFor(args)
    if (entry === undefined) {
      return frozenResult({ state: 'retain_refused', code: 'lock_handle_invalid' })
    }
    if (entry.settled) {
      return frozenResult({ state: 'retain_refused', code: 'lock_already_settled' })
    }
    entry.settled = true
    return frozenResult({ state: 'retained', reason })
  }

  return Object.freeze({ acquireRunLock, verifyRunLockHeld, releaseRunLock, retainRunLock })
}
