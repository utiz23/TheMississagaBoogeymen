/**
 * Cloud-backup run lock — E3J6C.
 *
 * Real temporary directories and real `O_EXCL` files throughout. Failure
 * boundaries that a real filesystem cannot be made to produce on demand
 * (a failed fsync, a short write, an identity that changes between two
 * observations) are driven through the internal `makeRunLock(deps)` seam by
 * wrapping ONE real dependency at a time; everything else stays real.
 *
 * Invariants pinned here:
 *   - an existing lock, residue, or replacement is NEVER modified or removed;
 *   - `refused` means the filesystem is unchanged, `uncertain` means residue
 *     may exist and no handle is ever returned;
 *   - release failures BEFORE unlink leave the path untouched; failures AFTER
 *     unlink never claim the lock is retained, recreate nothing, and touch no
 *     replacement;
 *   - only the exact factory-registered handle authorizes anything;
 *   - no result or error carries lock content, a host, a pid, or a
 *     caller-supplied string.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { BackupError } from './backup-artifact-contract.mjs'
import * as production from './backup-cloud-run-lock.mjs'
import {
  CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES,
  CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES,
  CLOUD_RUN_LOCK_CEILING_BYTES,
  CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE,
  CLOUD_RUN_LOCK_RETAIN_REASONS,
  REAL_RUN_LOCK_DEPS,
  isValidLockRecord,
  makeRunLock,
} from './internal/backup-cloud-run-lock-core.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-run-lock', warnAfterMs: 6_000, intervalMs: 4_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUN_ID = '20260919T120000Z-0a1b2c3d'
const BASE = 'eanhl-test-20260904T180007Z'
const MARKER = 'SECRET-MARKER-e3j6c-lock-7b21'
const SHA512_A = '0123456789abcdef'.repeat(8)
const SHA512_B = 'fedcba9876543210'.repeat(8)
const O = fs.constants

const sandboxes = []
afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-run-lock-'))
  sandboxes.push(dir)
  const lockDir = path.join(dir, 'run')
  fs.mkdirSync(lockDir, { mode: 0o700 })
  fs.chmodSync(lockDir, 0o700)
  const lockFile = path.join(lockDir, 'uploader.lock')
  return { dir, lockDir, lockFile }
}

function configFor(sb) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: SHA512_A },
    credentials: { backend: 'pass' },
    remote: { root: '/proton/eanhl-backups' },
    artifact: { sourceDir: path.join(sb.dir, 'artifacts') },
    attestation: { dir: path.join(sb.dir, 'attest') },
    readback: {
      dir: path.join(sb.dir, 'readback'),
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: { executable: '/usr/bin/prlimit', expectedSha512: SHA512_B },
    },
    run: { lockFile: sb.lockFile, operationTimeoutMs: 5_000, cancelGraceMs: 500 },
    retry: { maxAttemptsPerArtifactPerRun: 1, backoffMs: 1, maxTotalAttemptsPerRun: 1 },
    capacity: { minFreeBytes: 1, backingVolume: null },
  }
}

/** A lock factory over the real dependencies with named overrides, recording I/O calls. */
const RECORDED = ['open', 'openDir', 'write', 'read', 'unlink', 'fsync', 'fchmod', 'close']
function seam(overrides = {}) {
  const calls = []
  const deps = { ...REAL_RUN_LOCK_DEPS, ...overrides }
  for (const name of RECORDED) {
    const base = deps[name]
    deps[name] = (...args) => {
      calls.push({ name, args })
      return base(...args)
    }
  }
  return { lock: makeRunLock(deps), calls }
}

const acquire = (lock, sb, extra = {}) =>
  lock.acquireRunLock({ config: configFor(sb), cloudRunId: RUN_ID, artifactBase: BASE, ...extra })

/**
 * Everything observable about a path, for byte/identity equality before and
 * after. File content is compared by SHA-256 digest, so a failing assertion
 * can never print lock content.
 */
function snapshot(p) {
  let st
  try {
    st = fs.lstatSync(p, { bigint: true })
  } catch {
    return { exists: false }
  }
  const snap = {
    exists: true,
    ino: st.ino,
    mode: st.mode,
    mtimeNs: st.mtimeNs,
    nlink: st.nlink,
    kind: st.isSymbolicLink()
      ? 'symlink'
      : st.isFile()
        ? 'file'
        : st.isDirectory()
          ? 'dir'
          : 'other',
  }
  if (snap.kind === 'file')
    snap.sha256 = createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  if (snap.kind === 'symlink') snap.target = fs.readlinkSync(p)
  return snap
}

function dirListing(dir) {
  return fs.readdirSync(dir).sort()
}

function assertNoLeak(value) {
  const text = JSON.stringify(value) ?? ''
  assert.equal(text.includes(MARKER), false, 'marker leaked')
  assert.equal(text.includes(os.hostname()), false, 'hostname leaked')
  assert.equal(/\bat [\w.<>]+ \(/.test(text), false, 'stack text leaked')
}

function validRecordBytes(overrides = {}) {
  const r = {
    kind: 'eanhl.cloud-run-lock',
    schema_version: 1,
    cloud_run_id: RUN_ID,
    artifact_base: BASE,
    pid: process.pid,
    host: os.hostname(),
    acquired_at: '2026-09-19T12:00:00.000Z',
    owner_nonce: 'ab'.repeat(16),
    ...overrides,
  }
  return Buffer.from(JSON.stringify(r) + '\n')
}

const errno = (code) => Object.assign(new Error(`${code} ${MARKER}`), { code })

// ═════════════════════════════════════════════════════════════════════════════
// Acquisition — the happy path and the record
// ═════════════════════════════════════════════════════════════════════════════

test('acquire: one immutable 0600 record, deterministic and bounded, and an opaque frozen handle', () => {
  const sb = sandbox()
  const r = production.acquireRunLock({
    config: configFor(sb),
    cloudRunId: RUN_ID,
    artifactBase: BASE,
  })
  assert.equal(r.kind, 'acquired')
  assert.ok(Object.isFrozen(r))
  assert.deepEqual(Object.keys(r).sort(), ['handle', 'kind'])
  assert.ok(Object.isFrozen(r.handle))
  assert.deepEqual(Object.keys(r.handle), [])

  const st = fs.lstatSync(sb.lockFile)
  assert.equal(st.mode & 0o7777, 0o600)
  assert.equal(st.nlink, 1)
  const text = fs.readFileSync(sb.lockFile, 'utf8')
  assert.ok(text.length <= CLOUD_RUN_LOCK_CEILING_BYTES)
  assert.ok(text.endsWith('\n'))
  assert.equal(text.indexOf('\n'), text.length - 1)
  const rec = JSON.parse(text)
  assert.deepEqual(Object.keys(rec), [
    'kind',
    'schema_version',
    'cloud_run_id',
    'artifact_base',
    'pid',
    'host',
    'acquired_at',
    'owner_nonce',
  ])
  assert.equal(rec.kind, 'eanhl.cloud-run-lock')
  assert.equal(rec.schema_version, 1)
  assert.equal(rec.cloud_run_id, RUN_ID)
  assert.equal(rec.artifact_base, BASE)
  assert.equal(rec.pid, process.pid)
  assert.match(rec.owner_nonce, /^[0-9a-f]{32}$/)
  assert.match(rec.acquired_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.ok(isValidLockRecord(rec))
  assert.equal(production.releaseRunLock({ handle: r.handle }).state, 'released')
  assert.equal(fs.existsSync(sb.lockFile), false)
})

test('acquire: the production nonce is 16 cryptographic bytes (32 lowercase hex), fresh every time', () => {
  const sb = sandbox()
  const seen = new Set()
  for (let i = 0; i < 20; i++) {
    const r = production.acquireRunLock({
      config: configFor(sb),
      cloudRunId: RUN_ID,
      artifactBase: BASE,
    })
    assert.equal(r.kind, 'acquired')
    const nonce = JSON.parse(fs.readFileSync(sb.lockFile, 'utf8')).owner_nonce
    assert.match(nonce, /^[0-9a-f]{32}$/)
    assert.equal(seen.has(nonce), false)
    seen.add(nonce)
    assert.equal(production.releaseRunLock({ handle: r.handle }).state, 'released')
  }
})

/** The kernel's view of an open descriptor's flags (octal), from /proc/self/fdinfo. */
function fdFlags(fd) {
  return parseInt(
    /flags:\s+([0-7]+)/.exec(fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'))[1],
    8,
  )
}
const LINUX_O_CLOEXEC = 0o2000000

test('acquire/classify: every descriptor is exclusive/no-follow and CLOSE-ON-EXEC in the kernel; reads are non-blocking', () => {
  const opened = []
  const recordingOpen = (p, flags, mode) => {
    const fd = REAL_RUN_LOCK_DEPS.open(p, flags, mode)
    opened.push({ flags, mode, kernel: fdFlags(fd), create: (flags & O.O_CREAT) !== 0 })
    return fd
  }
  const recordingOpenDir = (p, flags) => {
    const fd = REAL_RUN_LOCK_DEPS.openDir(p, flags)
    opened.push({ flags, kernel: fdFlags(fd), dir: true })
    return fd
  }
  const sb = sandbox()
  const { lock } = seam({ open: recordingOpen, openDir: recordingOpenDir })
  const r = acquire(lock, sb)
  assert.equal(r.kind, 'acquired')
  // A second acquisition classifies the existing lock through the read path.
  assert.equal(acquire(lock, sb).code, 'lock_held_live')
  const create = opened.filter((o) => o.create)
  assert.equal(create.length, 1)
  for (const flag of [O.O_WRONLY, O.O_CREAT, O.O_EXCL, O.O_NOFOLLOW]) {
    assert.equal(create[0].flags & flag, flag)
  }
  assert.equal(create[0].mode, 0o600)
  const reads = opened.filter((o) => !o.create && !o.dir)
  assert.ok(reads.length >= 2, 'the A5 verification read and the classification read')
  for (const o of reads) {
    for (const flag of [O.O_NOFOLLOW, O.O_NONBLOCK]) assert.equal(o.flags & flag, flag)
    assert.equal(o.flags & (O.O_WRONLY | O.O_RDWR), 0)
    assert.equal(o.kernel & O.O_NONBLOCK, O.O_NONBLOCK)
  }
  for (const o of opened.filter((x) => x.dir)) {
    assert.equal(o.flags & O.O_DIRECTORY, O.O_DIRECTORY)
    assert.equal(o.flags & O.O_NOFOLLOW, O.O_NOFOLLOW)
  }
  for (const o of opened) assert.equal(o.kernel & LINUX_O_CLOEXEC, LINUX_O_CLOEXEC, 'close-on-exec')
  assert.equal(lock.releaseRunLock({ handle: r.handle }).state, 'released')
})

// ═════════════════════════════════════════════════════════════════════════════
// A0 — refusals before anything is created: filesystem UNCHANGED
// ═════════════════════════════════════════════════════════════════════════════

test('A0: identity, pid, nonce, host, and clock failures refuse before any create call', () => {
  const cases = [
    ['bad run id', {}, { cloudRunId: 'nope' }, 'lock_identity_invalid'],
    ['bad base', {}, { artifactBase: '../x' }, 'lock_identity_invalid'],
    ['non-stamped base', {}, { artifactBase: 'not-a-stamped-artifact' }, 'lock_identity_invalid'],
    ['pid 0', { pid: 0 }, {}, 'lock_identity_invalid'],
    ['pid above pid_max', { pid: 4_194_305 }, {}, 'lock_identity_invalid'],
    ['pid fractional', { pid: 1.5 }, {}, 'lock_identity_invalid'],
    [
      'random throws',
      {
        randomBytes: () => {
          throw new Error(MARKER)
        },
      },
      {},
      'lock_nonce_unavailable',
    ],
    ['random short', { randomBytes: () => Buffer.alloc(15) }, {}, 'lock_nonce_unavailable'],
    ['random not a buffer', { randomBytes: () => 'ab'.repeat(16) }, {}, 'lock_nonce_unavailable'],
    ['host with space', { hostname: () => `bad host ${MARKER}` }, {}, 'lock_host_unrepresentable'],
    ['host empty', { hostname: () => '' }, {}, 'lock_host_unrepresentable'],
    ['host too long', { hostname: () => 'a'.repeat(254) }, {}, 'lock_host_unrepresentable'],
    [
      'host throws',
      {
        hostname: () => {
          throw new Error(MARKER)
        },
      },
      {},
      'lock_host_unrepresentable',
    ],
    ['clock NaN', { now: () => NaN }, {}, 'lock_clock_unusable'],
    [
      'clock throws',
      {
        now: () => {
          throw new Error(MARKER)
        },
      },
      {},
      'lock_clock_unusable',
    ],
    ['clock out of range', { now: () => 1e20 }, {}, 'lock_clock_unusable'],
  ]
  for (const [label, depOverrides, argOverrides, code] of cases) {
    const sb = sandbox()
    const before = dirListing(sb.lockDir)
    const { lock, calls } = seam(depOverrides)
    const r = acquire(lock, sb, argOverrides)
    assert.equal(r.kind, 'refused', label)
    assert.equal(r.code, code, label)
    assert.ok(Object.isFrozen(r))
    assert.equal(calls.filter((c) => c.name === 'open').length, 0, `${label}: nothing opened`)
    assert.deepEqual(dirListing(sb.lockDir), before, label)
    assertNoLeak(r)
  }
})

test('A0: an untrusted lock directory refuses with the filesystem unchanged', () => {
  for (const setup of [
    (sb) => fs.chmodSync(sb.lockDir, 0o750),
    (sb) => fs.chmodSync(sb.lockDir, 0o707),
    (sb) => {
      fs.rmSync(sb.lockDir, { recursive: true })
      const real = path.join(sb.dir, 'real-run')
      fs.mkdirSync(real, { mode: 0o700 })
      fs.symlinkSync(real, sb.lockDir)
    },
    (sb) => fs.rmSync(sb.lockDir, { recursive: true }),
  ]) {
    const sb = sandbox()
    setup(sb)
    const r = production.acquireRunLock({
      config: configFor(sb),
      cloudRunId: RUN_ID,
      artifactBase: BASE,
    })
    assert.equal(r.kind, 'refused')
    assert.equal(r.code, 'lock_dir_untrusted')
    assert.equal(fs.existsSync(path.join(sb.dir, 'real-run', 'uploader.lock')), false)
  }
})

test('A0: malformed arguments throw one generic input error that echoes nothing', () => {
  for (const bad of [undefined, null, 7, { config: { [MARKER]: 1 } }, { config: null }]) {
    assert.throws(
      () => production.acquireRunLock(bad),
      (err) =>
        err instanceof BackupError &&
        err.code === 'cloud_run_lock_invalid_input' &&
        !String(err.message).includes(MARKER),
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// A0 / EEXIST — an existing lock is classified, never modified
// ═════════════════════════════════════════════════════════════════════════════

test('EEXIST: every kind of existing lock is refused with a closed code and left byte/ino/mtime identical', () => {
  const deadPid = spawnSync(process.execPath, ['-e', '0']).pid
  const cases = [
    [
      'live same-host record',
      (p) => fs.writeFileSync(p, validRecordBytes(), { mode: 0o600 }),
      'lock_held_live',
    ],
    [
      'foreign host',
      (p) => fs.writeFileSync(p, validRecordBytes({ host: 'other-host.example' }), { mode: 0o600 }),
      'lock_held_foreign_host',
    ],
    [
      'dead pid',
      (p) => fs.writeFileSync(p, validRecordBytes({ pid: deadPid }), { mode: 0o600 }),
      'lock_held_stale_looking',
    ],
    [
      'malformed JSON carrying a marker',
      (p) => fs.writeFileSync(p, `{not json ${MARKER}\n`, { mode: 0o600 }),
      'lock_malformed',
    ],
    [
      'empty file (A2 residue shape)',
      (p) => fs.writeFileSync(p, '', { mode: 0o600 }),
      'lock_malformed',
    ],
    [
      'extra key',
      (p) => {
        const r = JSON.parse(validRecordBytes().toString())
        fs.writeFileSync(p, JSON.stringify({ ...r, note: MARKER }) + '\n', { mode: 0o600 })
      },
      'lock_malformed',
    ],
    [
      'non-canonical spacing',
      (p) =>
        fs.writeFileSync(
          p,
          JSON.stringify(JSON.parse(validRecordBytes().toString()), null, 1) + '\n',
          { mode: 0o600 },
        ),
      'lock_malformed',
    ],
    [
      'oversize',
      (p) => fs.writeFileSync(p, 'x'.repeat(CLOUD_RUN_LOCK_CEILING_BYTES + 10), { mode: 0o600 }),
      'lock_malformed',
    ],
    [
      'wrong mode 0644',
      (p) => fs.writeFileSync(p, validRecordBytes(), { mode: 0o644 }),
      'lock_path_untrusted',
    ],
    [
      'live symlink to a valid record',
      (p) => {
        const target = `${p}.target`
        fs.writeFileSync(target, validRecordBytes(), { mode: 0o600 })
        fs.symlinkSync(target, p)
      },
      'lock_path_untrusted',
    ],
    ['dangling symlink', (p) => fs.symlinkSync(`${p}.nowhere`, p), 'lock_path_untrusted'],
    ['directory', (p) => fs.mkdirSync(p, { mode: 0o700 }), 'lock_path_untrusted'],
    [
      'FIFO',
      (p) => {
        const r = spawnSync('mkfifo', ['-m', '600', p])
        assert.equal(r.status, 0)
      },
      'lock_path_untrusted',
    ],
  ]
  for (const [label, create, code] of cases) {
    const sb = sandbox()
    create(sb.lockFile)
    fs.chmodSync(sb.lockDir, 0o700)
    const before = snapshot(sb.lockFile)
    const listing = dirListing(sb.lockDir)
    const r = production.acquireRunLock({
      config: configFor(sb),
      cloudRunId: RUN_ID,
      artifactBase: BASE,
    })
    assert.equal(r.kind, 'refused', label)
    assert.equal(r.code, code, label)
    assert.ok(CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES.includes(r.code))
    assert.deepEqual(snapshot(sb.lockFile), before, `${label}: not modified`)
    assert.deepEqual(dirListing(sb.lockDir), listing, `${label}: nothing added or removed`)
    assertNoLeak(r)
  }
})

test('EEXIST: a lock swapped to a FIFO between lstat and open never blocks and is refused', () => {
  const sb = sandbox()
  const fifo = sb.lockFile
  assert.equal(spawnSync('mkfifo', ['-m', '600', fifo]).status, 0)
  const fifoSt = fs.lstatSync(fifo, { bigint: true })
  const regular = path.join(sb.dir, 'decoy')
  fs.writeFileSync(regular, validRecordBytes(), { mode: 0o600 })
  const decoySt = fs.lstatSync(regular, { bigint: true })
  // lstat of the lock path reports a regular file (the decoy's stats); the
  // real path is a FIFO with no writer. The non-blocking open must return at
  // once and the fstat comparison must refuse it — no read is attempted.
  const { lock, calls } = seam({
    lstat: (p) => (p === fifo ? decoySt : REAL_RUN_LOCK_DEPS.lstat(p)),
  })
  const started = Date.now()
  const r = acquire(lock, sb)
  assert.ok(Date.now() - started < 2_000, 'never blocks')
  assert.equal(r.kind, 'refused')
  assert.equal(r.code, 'lock_unobservable')
  assert.equal(calls.filter((c) => c.name === 'read').length, 0)
  assert.equal(fs.lstatSync(fifo, { bigint: true }).ino, fifoSt.ino)
})

test('EEXIST: the classification read is bounded at the ceiling plus one byte', () => {
  const sb = sandbox()
  fs.writeFileSync(sb.lockFile, validRecordBytes(), { mode: 0o600 })
  const { lock, calls } = seam()
  const r = acquire(lock, sb)
  assert.equal(r.code, 'lock_held_live')
  const requested = calls
    .filter((c) => c.name === 'read')
    .reduce((n, c) => Math.max(n, c.args[2] + c.args[3]), 0)
  assert.ok(requested <= CLOUD_RUN_LOCK_CEILING_BYTES + 1)
})

test('concurrency: of two acquisitions — two factory instances, same path — exactly one holds the lock', () => {
  const sb = sandbox()
  const a = makeRunLock(REAL_RUN_LOCK_DEPS)
  const b = makeRunLock(REAL_RUN_LOCK_DEPS)
  const results = [acquire(a, sb), acquire(b, sb)]
  assert.equal(results.filter((r) => r.kind === 'acquired').length, 1)
  const loser = results.find((r) => r.kind !== 'acquired')
  assert.equal(loser.code, 'lock_held_live')
  const bytes = fs.readFileSync(sb.lockFile)
  // The loser's handle-less refusal changed nothing; the winner still releases.
  const winner = results.find((r) => r.kind === 'acquired')
  const owner = results[0] === winner ? a : b
  assert.ok(fs.readFileSync(sb.lockFile).equals(bytes), 'lock bytes unchanged')
  assert.equal(owner.releaseRunLock({ handle: winner.handle }).state, 'released')
})

// ═════════════════════════════════════════════════════════════════════════════
// A1-A5 — failures after creation may leave RESIDUE; never a handle, never removed
// ═════════════════════════════════════════════════════════════════════════════

function assertResidueUntouched(sb, r, code, calls) {
  assert.equal(r.kind, 'uncertain')
  assert.equal(r.code, code)
  assert.ok(CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES.includes(r.code))
  assert.deepEqual(Object.keys(r).sort(), ['code', 'kind'], 'never a handle')
  assert.equal(calls.filter((c) => c.name === 'unlink').length, 0, 'residue never removed')
  const residue = snapshot(sb.lockFile)
  // The next run refuses whatever residue exists, and leaves it identical.
  const next = production.acquireRunLock({
    config: configFor(sb),
    cloudRunId: RUN_ID,
    artifactBase: BASE,
  })
  if (residue.exists) {
    assert.equal(next.kind, 'refused')
    assert.ok(
      ['lock_malformed', 'lock_held_live', 'lock_path_untrusted'].includes(next.code),
      next.code,
    )
  }
  assert.deepEqual(snapshot(sb.lockFile), residue)
  return residue
}

test('A1: open fails with the path provably absent -> refused/lock_create_failed, nothing created', () => {
  const sb = sandbox()
  fs.chmodSync(sb.lockDir, 0o500) // still trusted, but not writable
  const r = production.acquireRunLock({
    config: configFor(sb),
    cloudRunId: RUN_ID,
    artifactBase: BASE,
  })
  fs.chmodSync(sb.lockDir, 0o700)
  assert.equal(r.kind, 'refused')
  assert.equal(r.code, 'lock_create_failed')
  assert.equal(fs.existsSync(sb.lockFile), false)
})

test('A1: open fails but something is at the path -> uncertain/lock_create_outcome_unknown', () => {
  const sb = sandbox()
  const { lock, calls } = seam({
    open: (p, flags, mode) => {
      if ((flags & O.O_CREAT) !== 0) {
        fs.writeFileSync(p, '', { mode: 0o600 }) // "created" — then the call reports failure
        throw errno('EIO')
      }
      return REAL_RUN_LOCK_DEPS.open(p, flags, mode)
    },
  })
  const r = acquire(lock, sb)
  assertResidueUntouched(sb, r, 'lock_create_outcome_unknown', calls)
  assert.ok(fs.existsSync(sb.lockFile))
  assertNoLeak(r)
})

test('A2: a short or failed write -> uncertain/lock_write_incomplete, partial residue left', () => {
  for (const write of [
    (fd, buf) => {
      fs.writeSync(fd, buf, 0, 5)
      throw errno('ENOSPC')
    },
    () => 0,
  ]) {
    const sb = sandbox()
    const { lock, calls } = seam({ write })
    const r = acquire(lock, sb)
    const residue = assertResidueUntouched(sb, r, 'lock_write_incomplete', calls)
    assert.equal(residue.exists, true)
  }
})

test('A3: fchmod, file fsync, fstat validation, or close failure -> uncertain/lock_file_durability_unconfirmed', () => {
  const variants = [
    {
      fchmod: () => {
        throw errno('EPERM')
      },
    },
    {
      fsync: () => {
        throw errno('EIO')
      },
    },
    {
      fstat: (fd) => {
        const st = REAL_RUN_LOCK_DEPS.fstat(fd)
        return st.isFile() ? { ...st, isFile: () => true, mode: st.mode | 0o044n } : st
      },
    },
    {
      close: (() => {
        let first = true
        return (fd) => {
          REAL_RUN_LOCK_DEPS.close(fd)
          if (first) {
            first = false
            throw errno('EIO')
          }
        }
      })(),
    },
  ]
  for (const v of variants) {
    const sb = sandbox()
    const { lock, calls } = seam(v)
    const r = acquire(lock, sb)
    const residue = assertResidueUntouched(sb, r, 'lock_file_durability_unconfirmed', calls)
    assert.equal(residue.exists, true)
  }
})

test('A4: directory re-observation, descriptor, or fsync failure -> uncertain/lock_dir_durability_unconfirmed', () => {
  const variants = [
    {
      openDir: () => {
        throw errno('EACCES')
      },
    },
    {
      fsync: (fd) => {
        const st = fs.fstatSync(fd)
        if (st.isDirectory()) throw errno('EIO')
        return REAL_RUN_LOCK_DEPS.fsync(fd)
      },
    },
    {
      fstat: (fd) => {
        const st = REAL_RUN_LOCK_DEPS.fstat(fd)
        return st.isDirectory() ? { ...st, ino: st.ino + 1n } : st
      },
    },
  ]
  for (const v of variants) {
    const sb = sandbox()
    const { lock, calls } = seam(v)
    const r = acquire(lock, sb)
    const residue = assertResidueUntouched(sb, r, 'lock_dir_durability_unconfirmed', calls)
    assert.equal(residue.exists, true)
  }
})

test('A4: the lock directory REPLACED during acquisition -> uncertain, both directories left alone', () => {
  const sb = sandbox()
  const aside = path.join(sb.dir, 'run-aside')
  const { lock, calls } = seam({
    open: (p, flags, mode) => {
      if ((flags & O.O_CREAT) !== 0) {
        fs.renameSync(sb.lockDir, aside)
        fs.mkdirSync(sb.lockDir, { mode: 0o700 })
      }
      return REAL_RUN_LOCK_DEPS.open(p, flags, mode)
    },
  })
  const r = acquire(lock, sb)
  assert.equal(r.kind, 'uncertain')
  assert.equal(r.code, 'lock_dir_durability_unconfirmed')
  assert.equal(calls.filter((c) => c.name === 'unlink').length, 0)
  assert.ok(fs.existsSync(sb.lockFile), 'residue in the replacement directory is left')
  assert.deepEqual(fs.readdirSync(aside), [])
})

test('A5: the final pathname verification fails -> uncertain/lock_path_verification_failed', () => {
  const sb = sandbox()
  let fileLstats = 0
  const { lock, calls } = seam({
    lstat: (p) => {
      const st = REAL_RUN_LOCK_DEPS.lstat(p)
      if (p === sb.lockFile && ++fileLstats === 1)
        return { ...st, isSymbolicLink: () => false, isFile: () => true, ino: st.ino + 1n }
      return st
    },
  })
  const r = acquire(lock, sb)
  const residue = assertResidueUntouched(sb, r, 'lock_path_verification_failed', calls)
  assert.equal(residue.exists, true)
})

// ═════════════════════════════════════════════════════════════════════════════
// Release — pre-unlink refusals leave the path untouched
// ═════════════════════════════════════════════════════════════════════════════

function acquired(lockImpl, sb) {
  const r = acquire(lockImpl, sb)
  assert.equal(r.kind, 'acquired')
  return r.handle
}

function assertSettled(lockImpl, handle) {
  assert.deepEqual(lockImpl.releaseRunLock({ handle }), {
    state: 'release_refused',
    code: 'lock_already_settled',
  })
  assert.deepEqual(lockImpl.retainRunLock({ handle, reason: 'run_internal_error' }), {
    state: 'retain_refused',
    code: 'lock_already_settled',
  })
  assert.deepEqual(lockImpl.verifyRunLockHeld({ handle }), {
    state: 'unverifiable',
    code: 'lock_already_settled',
  })
}

test('release P1: the lock directory replaced -> release_refused, both files untouched', () => {
  const sb = sandbox()
  const lock = makeRunLock(REAL_RUN_LOCK_DEPS)
  const handle = acquired(lock, sb)
  const bytes = fs.readFileSync(sb.lockFile)
  const aside = path.join(sb.dir, 'run-aside')
  fs.renameSync(sb.lockDir, aside)
  fs.mkdirSync(sb.lockDir, { mode: 0o700 })
  fs.writeFileSync(sb.lockFile, bytes, { mode: 0o600 }) // identical bytes, different directory
  const before = [snapshot(sb.lockFile), snapshot(path.join(aside, 'uploader.lock'))]
  const r = lock.releaseRunLock({ handle })
  assert.deepEqual(r, { state: 'release_refused', code: 'lock_dir_identity_changed' })
  assert.deepEqual([snapshot(sb.lockFile), snapshot(path.join(aside, 'uploader.lock'))], before)
  assertSettled(lock, handle)
})

test('release P2: absent, replaced by identical bytes, hard-linked, or re-moded -> release_refused, untouched', () => {
  const cases = [
    ['absent', (sb) => fs.unlinkSync(sb.lockFile), 'lock_path_absent'],
    [
      'replaced (new inode, same bytes, renamed over)',
      (sb) => {
        const bytes = fs.readFileSync(sb.lockFile)
        fs.writeFileSync(`${sb.lockFile}.new`, bytes, { mode: 0o600 })
        fs.renameSync(`${sb.lockFile}.new`, sb.lockFile)
      },
      'lock_identity_changed',
    ],
    [
      'hard link added',
      (sb) => fs.linkSync(sb.lockFile, `${sb.lockFile}.link`),
      'lock_identity_changed',
    ],
    ['mode changed', (sb) => fs.chmodSync(sb.lockFile, 0o640), 'lock_identity_changed'],
  ]
  for (const [label, tamper, code] of cases) {
    const sb = sandbox()
    const lock = makeRunLock(REAL_RUN_LOCK_DEPS)
    const handle = acquired(lock, sb)
    tamper(sb)
    const before = snapshot(sb.lockFile)
    const listing = dirListing(sb.lockDir)
    const r = lock.releaseRunLock({ handle })
    assert.deepEqual(r, { state: 'release_refused', code }, label)
    assert.deepEqual(snapshot(sb.lockFile), before, label)
    assert.deepEqual(dirListing(sb.lockDir), listing, label)
    assertSettled(lock, handle)
  }
})

test('release P2: a changed ctime on the same inode is an identity change (deterministic, via the lstat seam)', () => {
  const sb = sandbox()
  let armed = false
  const { lock, calls } = seam({
    lstat: (p) => {
      const st = REAL_RUN_LOCK_DEPS.lstat(p)
      if (armed && p === sb.lockFile) {
        return { ...st, isSymbolicLink: () => false, isFile: () => true, ctimeNs: st.ctimeNs + 1n }
      }
      return st
    },
  })
  const handle = acquired(lock, sb)
  armed = true
  const before = snapshot(sb.lockFile)
  assert.deepEqual(lock.releaseRunLock({ handle }), {
    state: 'release_refused',
    code: 'lock_identity_changed',
  })
  assert.equal(calls.filter((c) => c.name === 'unlink').length, 0)
  assert.deepEqual(snapshot(sb.lockFile), before)
})

test('release P2: a second hard link under an otherwise identical stat is refused (deterministic, via the lstat seam)', () => {
  // A real `link(2)` also moves ctime — within timestamp granularity it may
  // not — so the nlink check is pinned here on its own.
  const sb = sandbox()
  let armed = false
  const { lock, calls } = seam({
    lstat: (p) => {
      const st = REAL_RUN_LOCK_DEPS.lstat(p)
      if (armed && p === sb.lockFile) {
        return { ...st, isSymbolicLink: () => false, isFile: () => true, nlink: 2n }
      }
      return st
    },
  })
  const handle = acquired(lock, sb)
  armed = true
  const before = snapshot(sb.lockFile)
  assert.deepEqual(lock.releaseRunLock({ handle }), {
    state: 'release_refused',
    code: 'lock_identity_changed',
  })
  assert.equal(calls.filter((c) => c.name === 'unlink').length, 0)
  assert.deepEqual(snapshot(sb.lockFile), before)
})

test('release P3: a real in-place rewrite is refused (P2 if ctime moved, else P3); bytes differing under an identical stat are caught at P3', () => {
  // A real rewrite of the same inode normally moves ctime (P2), but within the
  // kernel's coarse timestamp granularity it may not — then the exact byte
  // comparison (P3) catches it. Either way: refused, and untouched.
  const sb = sandbox()
  const lock = makeRunLock(REAL_RUN_LOCK_DEPS)
  const handle = acquired(lock, sb)
  const text = fs.readFileSync(sb.lockFile, 'utf8')
  const tampered = text.replace(
    /"owner_nonce":"[0-9a-f]/,
    (m) => m.slice(0, -1) + (m.at(-1) === 'a' ? 'b' : 'a'),
  )
  const fd = fs.openSync(sb.lockFile, 'r+')
  fs.writeSync(fd, tampered, 0)
  fs.closeSync(fd)
  const before = snapshot(sb.lockFile)
  const r = lock.releaseRunLock({ handle })
  assert.equal(r.state, 'release_refused')
  assert.ok(['lock_identity_changed', 'lock_content_changed'].includes(r.code), r.code)
  assert.deepEqual(snapshot(sb.lockFile), before)

  // Bytes that differ while every stat field still matches reach the byte
  // comparison itself (P3), and the path is still untouched.
  const sb2 = sandbox()
  let armed = false
  const { lock: lock2, calls } = seam({
    read: (fd2, buf, offset, length) => {
      const n = REAL_RUN_LOCK_DEPS.read(fd2, buf, offset, length)
      if (armed && n > 0) buf[offset] = buf[offset] === 0x7b ? 0x5b : 0x7b
      return n
    },
  })
  const h2 = acquired(lock2, sb2)
  armed = true
  const before2 = snapshot(sb2.lockFile)
  assert.deepEqual(lock2.releaseRunLock({ handle: h2 }), {
    state: 'release_refused',
    code: 'lock_content_changed',
  })
  assert.equal(calls.filter((c) => c.name === 'unlink').length, 0)
  assert.deepEqual(snapshot(sb2.lockFile), before2)
  assertSettled(lock2, h2)
})

test('release P4: the directory identity changes during the pre-unlink checks -> release_refused, no unlink', () => {
  const sb = sandbox()
  let armed = false
  let dirLstats = 0
  const { lock, calls } = seam({
    lstat: (p) => {
      const st = REAL_RUN_LOCK_DEPS.lstat(p)
      if (armed && p === sb.lockDir && ++dirLstats === 2)
        return { ...st, ino: st.ino + 1n, isSymbolicLink: () => false, isDirectory: () => true }
      return st
    },
  })
  const handle = acquired(lock, sb)
  armed = true
  const before = snapshot(sb.lockFile)
  assert.deepEqual(lock.releaseRunLock({ handle }), {
    state: 'release_refused',
    code: 'lock_dir_identity_changed',
  })
  assert.equal(calls.filter((c) => c.name === 'unlink').length, 0)
  assert.deepEqual(snapshot(sb.lockFile), before)
})

test('release P5: unlink fails and the path is still ours -> release_refused/lock_unlink_failed, untouched', () => {
  const sb = sandbox()
  const { lock } = seam({
    unlink: () => {
      throw errno('EPERM')
    },
  })
  const handle = acquired(lock, sb)
  const before = snapshot(sb.lockFile)
  const r = lock.releaseRunLock({ handle })
  assert.deepEqual(r, { state: 'release_refused', code: 'lock_unlink_failed' })
  assert.deepEqual(snapshot(sb.lockFile), before)
  assertSettled(lock, handle)
})

// ═════════════════════════════════════════════════════════════════════════════
// Release — after unlink succeeded: never "retained", nothing recreated,
// no replacement touched
// ═════════════════════════════════════════════════════════════════════════════

function assertPostUnlink(lock, handle, sb, r, state, code) {
  assert.deepEqual(r, { state, code })
  assert.ok(CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE[state].includes(code))
  assert.notEqual(r.state, 'retained')
  assertSettled(lock, handle)
}

test('release post-unlink: unlink reports failure but removed the file -> durability unconfirmed, not recreated', () => {
  const sb = sandbox()
  const { lock } = seam({
    unlink: (p) => {
      REAL_RUN_LOCK_DEPS.unlink(p)
      throw errno('EIO')
    },
  })
  const handle = acquired(lock, sb)
  const r = lock.releaseRunLock({ handle })
  assertPostUnlink(
    lock,
    handle,
    sb,
    r,
    'release_durability_unconfirmed',
    'lock_absence_unconfirmed',
  )
  assert.equal(fs.existsSync(sb.lockFile), false)
})

test('release Q1: absence confirmation fails (EIO) or contradicts (same inode) -> durability unconfirmed', () => {
  for (const mode of ['eio', 'same-inode']) {
    const sb = sandbox()
    let unlinked = false
    let oldStat = null
    const { lock } = seam({
      unlink: (p) => {
        oldStat = REAL_RUN_LOCK_DEPS.lstat(p)
        REAL_RUN_LOCK_DEPS.unlink(p)
        unlinked = true
      },
      lstat: (p) => {
        if (unlinked && p === sb.lockFile) {
          if (mode === 'eio') throw errno('EIO')
          return oldStat
        }
        return REAL_RUN_LOCK_DEPS.lstat(p)
      },
    })
    const handle = acquired(lock, sb)
    const r = lock.releaseRunLock({ handle })
    assertPostUnlink(
      lock,
      handle,
      sb,
      r,
      'release_durability_unconfirmed',
      'lock_absence_unconfirmed',
    )
    assert.equal(fs.existsSync(sb.lockFile), false, 'never recreated')
  }
})

test('release Q1: a replacement appearing after unlink is reported and NEVER touched', () => {
  const sb = sandbox()
  let unlinks = 0
  const { lock } = seam({
    unlink: (p) => {
      unlinks++
      // Created BEFORE our file is unlinked, so it cannot reuse our inode.
      fs.writeFileSync(`${p}.incoming`, `replacement ${MARKER}\n`, { mode: 0o600 })
      REAL_RUN_LOCK_DEPS.unlink(p)
      fs.renameSync(`${p}.incoming`, p)
    },
  })
  const handle = acquired(lock, sb)
  const r = lock.releaseRunLock({ handle })
  assertPostUnlink(lock, handle, sb, r, 'release_replaced', 'lock_path_replaced_after_unlink')
  const after = snapshot(sb.lockFile)
  assert.ok(
    fs.readFileSync(sb.lockFile).equals(Buffer.from(`replacement ${MARKER}\n`)),
    'replacement unchanged',
  )
  assert.equal(unlinks, 1, 'exactly one unlink, of our own file')
  // A later acquisition refuses the replacement and leaves it identical.
  const next = production.acquireRunLock({
    config: configFor(sb),
    cloudRunId: RUN_ID,
    artifactBase: BASE,
  })
  assert.equal(next.kind, 'refused')
  assert.deepEqual(snapshot(sb.lockFile), after)
  assertNoLeak(r)
  assertNoLeak(next)
})

test('release Q2: the directory changes after unlink -> durability unconfirmed', () => {
  const sb = sandbox()
  let unlinked = false
  const { lock } = seam({
    unlink: (p) => {
      REAL_RUN_LOCK_DEPS.unlink(p)
      unlinked = true
    },
    lstat: (p) => {
      const st = REAL_RUN_LOCK_DEPS.lstat(p)
      if (unlinked && p === sb.lockDir)
        return { ...st, ino: st.ino + 1n, isSymbolicLink: () => false, isDirectory: () => true }
      return st
    },
  })
  const handle = acquired(lock, sb)
  const r = lock.releaseRunLock({ handle })
  assertPostUnlink(
    lock,
    handle,
    sb,
    r,
    'release_durability_unconfirmed',
    'lock_dir_identity_changed_after_unlink',
  )
  assert.equal(fs.existsSync(sb.lockFile), false)
})

test('release Q3: the directory fsync fails after unlink -> durability unconfirmed, not recreated', () => {
  for (const failure of ['fsync', 'openDir']) {
    const sb = sandbox()
    let unlinked = false
    const { lock } = seam({
      unlink: (p) => {
        REAL_RUN_LOCK_DEPS.unlink(p)
        unlinked = true
      },
      fsync: (fd) => {
        if (unlinked && failure === 'fsync') throw errno('EIO')
        return REAL_RUN_LOCK_DEPS.fsync(fd)
      },
      openDir: (p, flags) => {
        if (unlinked && failure === 'openDir') throw errno('EMFILE')
        return REAL_RUN_LOCK_DEPS.openDir(p, flags)
      },
    })
    const handle = acquired(lock, sb)
    const r = lock.releaseRunLock({ handle })
    assertPostUnlink(lock, handle, sb, r, 'release_durability_unconfirmed', 'lock_dir_fsync_failed')
    assert.equal(fs.existsSync(sb.lockFile), false)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Authority: only the exact registered handle
// ═════════════════════════════════════════════════════════════════════════════

test('handles: forged, cloned, and foreign-factory handles authorize nothing and touch nothing', () => {
  const sb = sandbox()
  const lock = makeRunLock(REAL_RUN_LOCK_DEPS)
  const other = makeRunLock(REAL_RUN_LOCK_DEPS)
  const handle = acquired(lock, sb)
  const before = snapshot(sb.lockFile)
  for (const forged of [
    {},
    Object.freeze({}),
    JSON.parse(JSON.stringify(handle)),
    { ...handle },
    null,
    'x',
  ]) {
    assert.deepEqual(lock.releaseRunLock({ handle: forged }), {
      state: 'release_refused',
      code: 'lock_handle_invalid',
    })
    assert.deepEqual(lock.verifyRunLockHeld({ handle: forged }), {
      state: 'unverifiable',
      code: 'lock_handle_invalid',
    })
    assert.deepEqual(lock.retainRunLock({ handle: forged, reason: 'run_internal_error' }), {
      state: 'retain_refused',
      code: 'lock_handle_invalid',
    })
  }
  assert.deepEqual(other.releaseRunLock({ handle }), {
    state: 'release_refused',
    code: 'lock_handle_invalid',
  })
  assert.deepEqual(production.releaseRunLock({ handle }), {
    state: 'release_refused',
    code: 'lock_handle_invalid',
  })
  assert.deepEqual(snapshot(sb.lockFile), before)
  // ...and the genuine handle still works.
  assert.equal(lock.verifyRunLockHeld({ handle }).state, 'held')
  assert.equal(lock.releaseRunLock({ handle }).state, 'released')
  assertSettled(lock, handle)
})

test('handles: retain-then-release keeps the lock; release-then-retain claims nothing', () => {
  const sb = sandbox()
  const lock = makeRunLock(REAL_RUN_LOCK_DEPS)
  const h1 = acquired(lock, sb)
  const before = snapshot(sb.lockFile)
  assert.deepEqual(lock.retainRunLock({ handle: h1, reason: 'retain_internal_error' }), {
    state: 'retained',
    reason: 'retain_internal_error',
  })
  assert.deepEqual(snapshot(sb.lockFile), before, 'retain writes nothing')
  assert.deepEqual(lock.releaseRunLock({ handle: h1 }), {
    state: 'release_refused',
    code: 'lock_already_settled',
  })
  assert.deepEqual(snapshot(sb.lockFile), before)

  const sb2 = sandbox()
  const h2 = acquired(lock, sb2)
  assert.equal(lock.releaseRunLock({ handle: h2 }).state, 'released')
  assert.deepEqual(lock.retainRunLock({ handle: h2, reason: 'retain_internal_error' }), {
    state: 'retain_refused',
    code: 'lock_already_settled',
  })
  assert.equal(fs.existsSync(sb2.lockFile), false)
})

test('retain: every reason outside the closed vocabulary is refused generically, echoed nowhere, and settles nothing', () => {
  const sb = sandbox()
  const { lock, calls } = seam()
  const handle = acquired(lock, sb)
  const opensBefore = calls.length
  for (const reason of [
    MARKER,
    `retain_internal_error ${MARKER}`,
    'release',
    '',
    undefined,
    null,
    42,
    { toString: () => MARKER },
  ]) {
    assert.throws(
      () => lock.retainRunLock({ handle, reason }),
      (err) => {
        assert.ok(err instanceof BackupError)
        assert.equal(err.code, 'lock_retain_reason_invalid')
        assert.equal(JSON.stringify({ ...err, message: err.message }).includes(MARKER), false)
        assert.equal(String(err.message).includes(MARKER), false)
        return true
      },
    )
  }
  assert.equal(calls.length, opensBefore, 'no filesystem call for a refused reason')
  assert.equal(lock.verifyRunLockHeld({ handle }).state, 'held', 'the handle is not settled')
  for (const reason of CLOUD_RUN_LOCK_RETAIN_REASONS) assert.equal(typeof reason, 'string')
  assert.deepEqual(lock.retainRunLock({ handle, reason: 'attempt_threw' }), {
    state: 'retained',
    reason: 'attempt_threw',
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Held-ness
// ═════════════════════════════════════════════════════════════════════════════

test('verifyRunLockHeld: held, lost, replaced, and unverifiable — any non-held result settles the handle', () => {
  const lock = makeRunLock(REAL_RUN_LOCK_DEPS)

  const sb1 = sandbox()
  const h1 = acquired(lock, sb1)
  assert.deepEqual(lock.verifyRunLockHeld({ handle: h1 }), { state: 'held', code: null })
  assert.deepEqual(lock.verifyRunLockHeld({ handle: h1 }), { state: 'held', code: null })
  fs.unlinkSync(sb1.lockFile)
  assert.deepEqual(lock.verifyRunLockHeld({ handle: h1 }), {
    state: 'lost',
    code: 'lock_path_absent',
  })
  assertSettled(lock, h1)
  assert.equal(fs.existsSync(sb1.lockFile), false, 'never recreated')

  const sb2 = sandbox()
  const h2 = acquired(lock, sb2)
  fs.unlinkSync(sb2.lockFile)
  fs.writeFileSync(sb2.lockFile, `someone else ${MARKER}\n`, { mode: 0o600 })
  const replacement = snapshot(sb2.lockFile)
  const r2 = lock.verifyRunLockHeld({ handle: h2 })
  assert.deepEqual(r2, { state: 'replaced', code: 'lock_identity_changed' })
  assertSettled(lock, h2)
  assert.deepEqual(snapshot(sb2.lockFile), replacement, 'a replacement is never removed')
  assertNoLeak(r2)

  const sb3 = sandbox()
  const h3 = acquired(lock, sb3)
  fs.chmodSync(sb3.lockDir, 0o750)
  assert.deepEqual(lock.verifyRunLockHeld({ handle: h3 }), {
    state: 'unverifiable',
    code: 'lock_dir_identity_changed',
  })
  fs.chmodSync(sb3.lockDir, 0o700)
  assertSettled(lock, h3)
  assert.ok(fs.existsSync(sb3.lockFile), 'an unverifiable lock is left in place')
})

// ═════════════════════════════════════════════════════════════════════════════
// Surface
// ═════════════════════════════════════════════════════════════════════════════

test('production API: closed export surface, frozen vocabularies, inert deps', () => {
  assert.deepEqual(Object.keys(production).sort(), [
    'CLOUD_RUN_LOCK_ACQUIRE_KINDS',
    'CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES',
    'CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES',
    'CLOUD_RUN_LOCK_CEILING_BYTES',
    'CLOUD_RUN_LOCK_CONTENTION_REFUSAL_CODES',
    'CLOUD_RUN_LOCK_HELD_CODES_BY_STATE',
    'CLOUD_RUN_LOCK_HELD_STATES',
    'CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES',
    'CLOUD_RUN_LOCK_KIND',
    'CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE',
    'CLOUD_RUN_LOCK_RELEASE_STATES',
    'CLOUD_RUN_LOCK_RETAIN_REASONS',
    'CLOUD_RUN_LOCK_RETAIN_REFUSAL_CODES',
    'CLOUD_RUN_LOCK_RETAIN_STATES',
    'CLOUD_RUN_LOCK_SCHEMA_VERSION',
    'acquireRunLock',
    'releaseRunLock',
    'retainRunLock',
    'verifyRunLockHeld',
  ])
  for (const [name, v] of Object.entries(production)) {
    if (typeof v === 'object') {
      assert.ok(Object.isFrozen(v), name)
      for (const inner of Object.values(v))
        if (typeof inner === 'object' && inner !== null) assert.ok(Object.isFrozen(inner), name)
    }
  }
  const sb = sandbox()
  const poisoned = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('a deps override was consulted')
      },
    },
  )
  const r = production.acquireRunLock({
    config: configFor(sb),
    cloudRunId: RUN_ID,
    artifactBase: BASE,
    deps: poisoned,
  })
  assert.equal(r.kind, 'acquired')
  assert.equal(production.releaseRunLock({ handle: r.handle, deps: poisoned }).state, 'released')
})

test('static: no ops/** module other than the lock API and this suite imports the lock core', () => {
  const opsRoot = path.resolve(HERE, '..', '..')
  const allowed = new Set([
    path.join(HERE, 'backup-cloud-run-lock.mjs'),
    path.join(HERE, 'backup-cloud-run-lock.test.mjs'),
    path.join(HERE, 'internal', 'backup-cloud-run-lock-core.mjs'),
  ])
  const IMPORTS_CORE =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-cloud-run-lock-core\.mjs['"]/
  const offenders = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
        continue
      }
      if (!entry.name.endsWith('.mjs') || allowed.has(full)) continue
      if (IMPORTS_CORE.test(fs.readFileSync(full, 'utf8'))) offenders.push(full)
    }
  }
  walk(opsRoot)
  assert.deepEqual(offenders, [])
})
