/**
 * Destination acceptance — behavioural suite.
 *
 * These tests drive the REAL acceptor over a REAL temporary filesystem. Only
 * the clock, the identity (hostname/pid) and the free-space probe are injected;
 * every file operation, hash and rename is the genuine article, because what is
 * being asserted is what an operator would find on disk afterwards.
 *
 * Four properties get the most attention, because a wrong implementation would
 * still pass a superficial test on all of them:
 *
 *   1. The verdict is computed from a copy the destination owns. A test mutates
 *      the inbox the instant each file has been copied and pins that the
 *      accepted bytes, the receipt hash and the archive are the ORIGINAL ones.
 *   2. A young incomplete triple is left exactly as found — not read, not
 *      moved, not deleted. Deleting a partial upload destroys a backup that was
 *      about to arrive.
 *   3. An identity that is already archived is never overwritten, and an
 *      identical re-delivery never rewrites the receipt — which is what stops it
 *      from moving a freshness metric.
 *   4. Nothing is followed out of the inbox: a symlink named like an artifact is
 *      quarantined without its target ever being read.
 *
 * No network, no database, no key, no subprocess, no production data.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  AcceptanceError,
  acceptInboxArtifacts,
  acquireAcceptanceLock,
  artifactFileNames,
  assertSafeComponent,
  buildReceipt,
  parseArtifactEntryName,
  receiptFileName,
  validateManifestIdentity,
  validateReceiptBinding,
} from './backup-acceptance.mjs'
import {
  RECEIPT_SCHEMA_VERSION,
  loadAcceptanceConfig,
  validateAcceptanceConfig,
} from './backup-acceptance-config.mjs'
import { MANIFEST_SCHEMA_VERSION } from './backup-config.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'acceptance' })

const PREFIX = 'eanhl-prod'
const STAMP = '20260904T180007Z'
const SNAPSHOT_ISO = '2026-09-04T18:00:07Z'
const BASE = `${PREFIX}-${STAMP}`
const AGE_HEADER = 'age-encryption.org/v1'
const NOW = 1_788_600_000_000

const sandboxes = []
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-accept-test-'))
  sandboxes.push(dir)
  // Deployment creates the transport-writable inbox, not the acceptor — so the
  // fixture does, once, here. Nothing else in this file may recreate it, or the
  // "the inbox is not a directory" cases would silently repair themselves.
  fs.mkdirSync(`${dir}/inbox`, { recursive: true })
  fs.mkdirSync(`${dir}/backing`, { recursive: true })
  return dir
}
test.after(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true })
})

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ─── the world ───────────────────────────────────────────────────────────────

function rawConfig(dir) {
  return {
    inbox: { dir: `${dir}/inbox`, incompleteGraceMs: 3_600_000 },
    work: { dir: `${dir}/private/work`, orphanGraceMs: 3_600_000 },
    archive: { dir: `${dir}/private/archive` },
    receipts: { dir: `${dir}/private/receipts` },
    quarantine: { dir: `${dir}/private/quarantine` },
    capacity: {
      minFreeBytes: 1000,
      backingVolume: { mountPoint: `${dir}/backing`, minFreeBytes: 1000 },
    },
    acceptance: {
      artifactPrefix: PREFIX,
      lockFile: `${dir}/private/accept.lock`,
      lockStaleAfterMs: 3_600_000,
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 100_000,
      maxSidecarBytes: 4096,
      maxArtifactsPerSweep: 8,
      sweepDeadlineMs: 600_000,
    },
  }
}

function makeConfig(dir, overrides = {}) {
  const merged = structuredClone(rawConfig(dir))
  for (const [section, patch] of Object.entries(overrides)) {
    merged[section] = { ...merged[section], ...patch }
  }
  return validateAcceptanceConfig(merged, '<test>')
}

/**
 * The injected boundary bundle, with four interleaving seams.
 *
 * `onMkdir`, `onOpen`, `onRead` and `onClose` are not hooks the production code
 * knows about: they are the ordinary `deps.fs` primitives, wrapped. That is what
 * lets a test act at an exact point in a real sweep — after every check and
 * immediately before the first byte is copied (`onMkdir` on the artifact's work
 * directory), or in the middle of a copy (`onRead`), or the instant a source has
 * been copied out in full (`onClose` on a source descriptor) — without the
 * acceptor carrying a single line of test-only code.
 *
 * `opened` records every path opened, which is how "nothing outside the inbox
 * was ever opened" is asserted rather than assumed.
 */
function makeDeps(dir, opts = {}) {
  const reads = []
  const hashed = []
  const logs = []
  const opened = []
  const freeSpaceProbes = []
  const fdPaths = new Map()
  const realFs = {
    readdirSync: fs.readdirSync,
    writeFileSync: fs.writeFileSync,
    writeSync: fs.writeSync,
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    fstatSync: fs.fstatSync,
    lstatSync: fs.lstatSync,
    renameSync: fs.renameSync,
    rmSync: fs.rmSync,
    unlinkSync: fs.unlinkSync,
    constants: fs.constants,
  }
  const deps = {
    now: opts.now ?? (() => NOW),
    pid: opts.pid ?? 4242,
    hostname: opts.hostname ?? (() => 'hotel-echo'),
    randomToken: opts.randomToken ?? (() => 'abcd1234'),
    processAlive: opts.processAlive ?? (() => false),
    fs: {
      ...realFs,
      mkdirSync: (p, o) => {
        const result = fs.mkdirSync(p, o)
        opts.onMkdir?.(String(p))
        return result
      },
      openSync: (p, flags, mode) => {
        const fd = fs.openSync(p, flags, mode)
        opened.push(String(p))
        fdPaths.set(fd, String(p))
        opts.onOpen?.(String(p), fd)
        return fd
      },
      readSync: (fd, buf, off, len, pos) => {
        const n = fs.readSync(fd, buf, off, len, pos)
        opts.onRead?.(fdPaths.get(fd) ?? null, n)
        return n
      },
      closeSync: (fd) => {
        const p = fdPaths.get(fd) ?? null
        fdPaths.delete(fd)
        const result = fs.closeSync(fd)
        opts.onClose?.(p)
        return result
      },
      realpathSync: opts.realpathSync ?? fs.realpathSync,
      readFileSync: (p, enc) => {
        reads.push(String(p))
        return fs.readFileSync(p, enc)
      },
      copyFileSync: opts.copyFileSync ?? fs.copyFileSync,
    },
    // `freeSpaceFor` lets a test give each probed path its own answer, which is
    // the only way to model work and archive on SEPARATE filesystems — and, by
    // deriving the answer from what is actually on disk, a single SHARED pool.
    freeSpace: (p) => {
      const at = String(p)
      freeSpaceProbes.push(at)
      if (opts.freeSpaceFor)
        return { freeBytes: opts.freeSpaceFor(at), totalBytes: 1_000_000_000_000 }
      return {
        freeBytes: at.startsWith(`${dir}/backing`)
          ? (opts.backingFree ?? 1_000_000_000)
          : (opts.fsFree ?? 1_000_000_000),
        totalBytes: 1_000_000_000_000,
      }
    },
    sha256File: (p) => {
      hashed.push(String(p))
      reads.push(String(p))
      return sha256(fs.readFileSync(p))
    },
  }
  return { deps, reads, hashed, logs, opened, freeSpaceProbes, log: (l) => logs.push(l) }
}

/**
 * Write a producer-shaped artifact triple. Hashes are real, so a "corrupt"
 * fixture is corrupt in exactly the way a damaged transfer would be.
 */
function writeTriple(dir, opts = {}) {
  const base = opts.base ?? BASE
  const names = artifactFileNames(base)
  const body = Buffer.from(opts.body ?? `${AGE_HEADER}\n-> X25519 fake\nciphertext-${base}\n`)
  const hash = sha256(body)
  fs.mkdirSync(dir, { recursive: true })
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    artifact: names.ciphertext,
    run_id: '20260904T180000Z-abcd1234',
    snapshot_ts: opts.snapshotTs ?? SNAPSHOT_ISO,
    produced_at: '2026-09-04T18:00:31Z',
    source: {
      host: 'sierra-november',
      container: 'eanhl-team-website-db-1',
      database: 'eanhl',
      system_identifier: '7412345678901234567',
      server_version: '16.13',
      git_commit: 'a'.repeat(40),
      image_digests: {},
    },
    plaintext: { sha256: sha256(Buffer.from('plain')), bytes: 5 },
    ciphertext: { sha256: hash, bytes: body.length },
    encryption: {
      executable: '/usr/bin/age',
      recipients_file: '/etc/eanhl/recipients.pub',
      recipients_file_sha256: sha256(Buffer.from('recipients')),
      recipient_count: 1,
    },
    validation: { pg_restore_list: 'pass', pg_restore_full_archive_read: 'not_run' },
    counts_snapshot: true,
    counts: { 'public.matches': 204 },
    migrations_max_id: '49',
    extensions: ['plpgsql 1.0'],
    warnings: [],
    ...(opts.manifestPatch ?? {}),
  }
  if (opts.manifestMutate) opts.manifestMutate(manifest)
  const files = {}
  if (opts.omit !== 'ciphertext') {
    fs.writeFileSync(`${dir}/${names.ciphertext}`, body)
    files.ciphertext = `${dir}/${names.ciphertext}`
  }
  if (opts.omit !== 'checksum') {
    fs.writeFileSync(
      `${dir}/${names.checksum}`,
      `${opts.sidecarHash ?? hash}  ${names.ciphertext}\n`,
    )
    files.checksum = `${dir}/${names.checksum}`
  }
  if (opts.omit !== 'manifest') {
    fs.writeFileSync(`${dir}/${names.manifest}`, JSON.stringify(manifest, null, 2) + '\n')
    files.manifest = `${dir}/${names.manifest}`
  }
  if (opts.mtimeMs !== undefined) {
    const t = opts.mtimeMs / 1000
    for (const p of Object.values(files)) fs.utimesSync(p, t, t)
  }
  return { base, names, body, hash, manifest, files }
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const listing = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : null)

/** Bytes actually occupied under a tree. Used to model one shared free pool. */
function usedBytes(root) {
  if (!fs.existsSync(root)) return 0
  let total = 0
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = `${root}/${e.name}`
    if (e.isDirectory()) total += usedBytes(p)
    else total += fs.statSync(p).size
  }
  return total
}

/** The three artifact file names of one base, sorted the way `listing` sorts. */
function artifactFileNamesSorted(base) {
  return Object.values(artifactFileNames(base)).sort()
}

/** The three inbox files of one artifact, as they are on disk right now. */
function inboxTripleBytes(dir, base = BASE) {
  const names = artifactFileNames(base)
  return ['ciphertext', 'checksum', 'manifest'].reduce(
    (n, role) => n + fs.statSync(`${dir}/inbox/${names[role]}`).size,
    0,
  )
}

function sweep(dir, configOverrides = {}, depOpts = {}, options = {}) {
  const config = makeConfig(dir, configOverrides)
  const world = makeDeps(dir, depOpts)
  const report = acceptInboxArtifacts({ config, deps: world.deps, log: world.log, options })
  return { config, report, ...world }
}

function sweepExpectingThrow(dir, configOverrides = {}, depOpts = {}, options = {}) {
  const config = makeConfig(dir, configOverrides)
  const world = makeDeps(dir, depOpts)
  let error = null
  try {
    acceptInboxArtifacts({ config, deps: world.deps, log: world.log, options })
  } catch (err) {
    error = err
  }
  assert.ok(error, 'expected the sweep to fail, but it returned')
  return { config, error, ...world }
}

// ─── names: everything that becomes a path component ─────────────────────────

test('a path component is rejected unless it is one ordinary name', () => {
  assert.equal(assertSafeComponent('eanhl-prod-20260904T180007Z.dump.age', 'x'), BASE + '.dump.age')
  for (const bad of ['..', '.', '', '../etc/passwd', 'a/b', 'a\\b', '.hidden', 'x\0y']) {
    assert.throws(
      () => assertSafeComponent(bad, 'manifest.artifact'),
      (err) => err instanceof AcceptanceError && err.code === 'unsafe_name',
      `expected ${JSON.stringify(bad)} to be refused`,
    )
  }
  assert.throws(() => assertSafeComponent(undefined, 'x'), /non-empty string/)
})

test('inbox entry names are classified only when they are exactly an artifact file', () => {
  assert.deepEqual(parseArtifactEntryName(`${BASE}.dump.age`, PREFIX), {
    base: BASE,
    stamp: STAMP,
    role: 'ciphertext',
  })
  assert.equal(parseArtifactEntryName(`${BASE}.dump.age.sha256`, PREFIX).role, 'checksum')
  assert.equal(parseArtifactEntryName(`${BASE}.manifest.json`, PREFIX).role, 'manifest')
  for (const other of [
    `${BASE}.dump.age.part`,
    `.${BASE}.dump.age.tmp8Kd2`,
    'latest.json',
    'other-20260904T180007Z.dump.age',
    `${PREFIX}-2026090T180007Z.dump.age`,
    `${PREFIX}-20260904T180007Z.dump.age.sha256.bak`,
    `../${BASE}.dump.age`,
  ]) {
    assert.equal(parseArtifactEntryName(other, PREFIX), null, `${other} must not be claimed`)
  }
})

// ─── receipt binding ─────────────────────────────────────────────────────────

test('a receipt is bound to artifact, ciphertext hash and source_snapshot_ts', () => {
  const dir = sandbox()
  const { manifest, hash } = writeTriple(`${dir}/scratch`)
  const identity = validateManifestIdentity({ manifest, base: BASE, stamp: STAMP })
  assert.ok(identity.ok, identity.failures.join('; '))
  const receipt = buildReceipt({
    base: BASE,
    ciphertextSha256: hash,
    ciphertextBytes: 10,
    manifest,
    identity,
    destinationHost: 'hotel-echo',
    archivePath: '/archive/2026/x',
    acceptedAt: '2026-09-04T18:05:00Z',
  })
  assert.equal(receipt.schema_version, RECEIPT_SCHEMA_VERSION)
  assert.equal(receipt.source_snapshot_ts, SNAPSHOT_ISO)
  assert.deepEqual(validateReceiptBinding(receipt, manifest), { valid: true, failures: [] })

  for (const [field, patch] of [
    ['artifact', { artifact: 'something-else.dump.age' }],
    ['ciphertext_sha256', { ciphertext_sha256: 'b'.repeat(64) }],
    ['source_snapshot_ts', { source_snapshot_ts: '2026-09-04T12:00:00Z' }],
    ['schema_version', { schema_version: 99 }],
  ]) {
    const result = validateReceiptBinding({ ...receipt, ...patch }, manifest)
    assert.equal(result.valid, false, `${field} must break the binding`)
    assert.ok(
      result.failures.some((f) => f.includes(field)),
      `expected a failure naming ${field}, got ${result.failures.join('; ')}`,
    )
  }
})

// ─── manifest identity ───────────────────────────────────────────────────────

test('a manifest that does not describe the artifact it arrived as is refused', () => {
  const dir = sandbox()
  const good = writeTriple(`${dir}/scratch`).manifest
  assert.ok(validateManifestIdentity({ manifest: good, base: BASE, stamp: STAMP }).ok)

  const cases = [
    ['traversal in artifact', { artifact: `../../${BASE}.dump.age` }],
    ['artifact naming another file', { artifact: 'eanhl-prod-20250101T000000Z.dump.age' }],
    ['snapshot_ts disagreeing with the name', { snapshot_ts: '2026-09-04T06:00:07Z' }],
    ['snapshot_ts not an instant', { snapshot_ts: '2026-09-04 18:00:07' }],
    ['a schema version nobody knows', { schema_version: 99 }],
    ['counts that were not snapshot-consistent', { counts_snapshot: false }],
    ['a missing run id', { run_id: '' }],
    ['a ciphertext hash that is not a digest', { ciphertext: { sha256: 'nope', bytes: 1 } }],
  ]
  for (const [what, patch] of cases) {
    const result = validateManifestIdentity({
      manifest: { ...good, ...patch },
      base: BASE,
      stamp: STAMP,
    })
    assert.equal(result.ok, false, `${what} must be refused`)
  }
  const missingSource = structuredClone(good)
  delete missingSource.source.host
  assert.equal(
    validateManifestIdentity({ manifest: missingSource, base: BASE, stamp: STAMP }).ok,
    false,
  )
})

test('the archive year comes from a validated stamp, never from free text', () => {
  const dir = sandbox()
  const good = writeTriple(`${dir}/scratch`).manifest
  assert.equal(validateManifestIdentity({ manifest: good, base: BASE, stamp: STAMP }).year, '2026')
  // A snapshot_ts that would produce a path component is rejected before a year
  // is ever derived from it.
  const result = validateManifestIdentity({
    manifest: { ...good, snapshot_ts: '../../../etc' },
    base: BASE,
    stamp: STAMP,
  })
  assert.equal(result.ok, false)
  assert.equal(result.year, null)
})

// ─── configuration ───────────────────────────────────────────────────────────

test('every acceptance configuration key is required, with no defaults', () => {
  const dir = sandbox()
  const required = [
    ['inbox', 'dir'],
    ['inbox', 'incompleteGraceMs'],
    ['work', 'dir'],
    ['work', 'orphanGraceMs'],
    ['archive', 'dir'],
    ['receipts', 'dir'],
    ['quarantine', 'dir'],
    ['capacity', 'minFreeBytes'],
    ['capacity', 'backingVolume'],
    ['acceptance', 'artifactPrefix'],
    ['acceptance', 'lockFile'],
    ['acceptance', 'lockStaleAfterMs'],
    ['acceptance', 'maxCiphertextBytes'],
    ['acceptance', 'maxManifestBytes'],
    ['acceptance', 'maxSidecarBytes'],
    ['acceptance', 'maxArtifactsPerSweep'],
    ['acceptance', 'sweepDeadlineMs'],
  ]
  for (const [section, key] of required) {
    const raw = rawConfig(dir)
    delete raw[section][key]
    assert.throws(
      () => validateAcceptanceConfig(raw, '<t>'),
      (err) => err.name === 'ConfigError' && /config_field_(missing|type|invalid)/.test(err.code),
      `${section}.${key} must be required`,
    )
  }
  for (const section of [
    'inbox',
    'work',
    'archive',
    'receipts',
    'quarantine',
    'capacity',
    'acceptance',
  ]) {
    const raw = rawConfig(dir)
    delete raw[section]
    assert.throws(() => validateAcceptanceConfig(raw, '<t>'), { name: 'ConfigError' })
  }
})

test('backingVolume must be answered explicitly, and null is a real answer', () => {
  const dir = sandbox()
  const raw = rawConfig(dir)
  raw.capacity.backingVolume = null
  assert.equal(validateAcceptanceConfig(raw, '<t>').capacity.backingVolume, null)
  const bad = rawConfig(dir)
  bad.capacity.backingVolume = { mountPoint: 'relative/path', minFreeBytes: 1 }
  assert.throws(() => validateAcceptanceConfig(bad, '<t>'), { code: 'config_field_not_absolute' })
})

test('nothing the destination owns may live inside the transport-writable inbox', () => {
  const dir = sandbox()
  for (const [section, key] of [
    ['work', 'dir'],
    ['archive', 'dir'],
    ['receipts', 'dir'],
    ['quarantine', 'dir'],
    ['acceptance', 'lockFile'],
  ]) {
    const raw = rawConfig(dir)
    raw[section][key] = `${dir}/inbox/${key === 'lockFile' ? 'accept.lock' : section}`
    assert.throws(
      () => validateAcceptanceConfig(raw, '<t>'),
      (err) =>
        err.code === 'config_field_invalid' &&
        /inside the transport-writable inbox/.test(err.message),
      `${section}.${key} inside the inbox must be refused`,
    )
  }
  const nested = rawConfig(dir)
  nested.inbox.dir = `${dir}/private/archive/inbox`
  assert.throws(() => validateAcceptanceConfig(nested, '<t>'), /must be a separate tree/)

  const same = rawConfig(dir)
  same.receipts.dir = same.archive.dir
  assert.throws(() => validateAcceptanceConfig(same, '<t>'), /are the same path/)

  const inWork = rawConfig(dir)
  inWork.archive.dir = `${dir}/private/work/archive`
  assert.throws(() => validateAcceptanceConfig(inWork, '<t>'), /swept for debris/)
})

test('the artifact prefix must be usable as a filename', () => {
  const dir = sandbox()
  for (const bad of ['../x', 'Eanhl', 'a b', '-lead', '']) {
    const raw = rawConfig(dir)
    raw.acceptance.artifactPrefix = bad
    assert.throws(() => validateAcceptanceConfig(raw, '<t>'), { name: 'ConfigError' })
  }
})

test('an unreadable or unparseable acceptance config is a fail-closed refusal', () => {
  assert.throws(
    () =>
      loadAcceptanceConfig('/nope.json', () => {
        throw new Error('ENOENT')
      }),
    { code: 'config_unreadable' },
  )
  assert.throws(() => loadAcceptanceConfig('/x.json', () => '{ not json'), {
    code: 'config_unparseable',
  })
  const dir = sandbox()
  const cfg = loadAcceptanceConfig('/x.json', () => JSON.stringify(rawConfig(dir)))
  assert.equal(cfg.acceptance.artifactPrefix, PREFIX)
  assert.throws(() => {
    cfg.acceptance.maxArtifactsPerSweep = 999
  }, TypeError)
})

// ─── the happy path ──────────────────────────────────────────────────────────

test('a complete triple is accepted into the archive with a binding-valid receipt', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const { config, report } = sweep(dir)

  assert.equal(report.results.length, 1)
  const [result] = report.results
  assert.equal(result.outcome, 'accepted')
  assert.equal(result.ciphertextSha256, written.hash)
  assert.equal(result.sourceSnapshotTs, SNAPSHOT_ISO)
  assert.equal(result.freshnessAdvanced, true)

  const archiveDir = `${config.archive.dir}/2026`
  assert.deepEqual(listing(archiveDir), [
    `${BASE}.dump.age`,
    `${BASE}.dump.age.sha256`,
    `${BASE}.manifest.json`,
  ])
  assert.deepEqual(fs.readFileSync(`${archiveDir}/${BASE}.dump.age`), written.body)

  const receipt = readJson(`${config.receipts.dir}/${receiptFileName(BASE)}`)
  assert.equal(receipt.ciphertext_sha256, written.hash)
  assert.equal(receipt.source_snapshot_ts, SNAPSHOT_ISO)
  assert.equal(receipt.destination_host, 'hotel-echo')
  assert.equal(receipt.archive_path, `${archiveDir}/${BASE}.dump.age`)
  assert.deepEqual(
    validateReceiptBinding(receipt, readJson(`${archiveDir}/${BASE}.manifest.json`)),
    { valid: true, failures: [] },
  )

  // The inbox is drained, the work space is empty, the lock is gone, and no
  // `.part` debris survives.
  assert.deepEqual(listing(config.inbox.dir), [])
  assert.deepEqual(listing(config.work.dir), [])
  assert.equal(fs.existsSync(config.acceptance.lockFile), false)
  assert.deepEqual(listing(config.quarantine.dir), [])
})

test('the verdict is computed from the destination copy, not the inbox', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const inbox = `${dir}/inbox`
  const copiedFromInbox = []
  // Overwrite each inbox file the instant it has been copied out — the worst
  // case the transport key allows, and the reason the copy exists at all. The
  // source descriptor is closed only once that file has been copied in full,
  // so this fires at exactly that instant.
  const onClose = (p) => {
    if (!p || !p.startsWith(inbox + '/')) return
    copiedFromInbox.push(p)
    fs.writeFileSync(p, 'TAMPERED AFTER THE COPY')
  }
  const { config, report, reads } = sweep(dir, {}, { onClose })

  assert.equal(report.results[0].outcome, 'accepted')
  assert.equal(report.results[0].ciphertextSha256, written.hash)
  const archived = `${config.archive.dir}/2026/${BASE}.dump.age`
  assert.deepEqual(fs.readFileSync(archived), written.body, 'the archive holds the copied bytes')
  const receipt = readJson(`${config.receipts.dir}/${receiptFileName(BASE)}`)
  assert.equal(receipt.ciphertext_sha256, written.hash)

  // All three sources were copied out in full, and no decision-making read —
  // no parse, no hash — ever touched the inbox. Every byte the verdict used
  // came out of the work copy.
  assert.deepEqual(
    [...copiedFromInbox].sort(),
    [
      `${inbox}/${BASE}.dump.age`,
      `${inbox}/${BASE}.dump.age.sha256`,
      `${inbox}/${BASE}.manifest.json`,
    ].sort(),
  )
  assert.deepEqual(
    reads.filter((p) => p.startsWith(inbox + '/')),
    [],
  )
})

test('an inbox mutated BEFORE the copy fails verification instead of being accepted', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`, { mtimeMs: NOW - 10_000 })
  // The ciphertext no longer hashes to what its sidecar and manifest say.
  fs.writeFileSync(`${dir}/inbox/${BASE}.dump.age`, 'different bytes entirely')
  fs.utimesSync(`${dir}/inbox/${BASE}.dump.age`, (NOW - 10_000) / 1000, (NOW - 10_000) / 1000)

  const { config, report } = sweep(dir)
  assert.equal(report.results[0].outcome, 'pending_incomplete')
  assert.equal(listing(`${config.archive.dir}`).length, 0)
  assert.deepEqual(listing(config.receipts.dir), [])
})

// ─── corruption ──────────────────────────────────────────────────────────────

test('a triple that never hashes together is quarantined once it is old enough', () => {
  const dir = sandbox()
  const old = NOW - 7_200_000
  writeTriple(`${dir}/inbox`, { sidecarHash: 'f'.repeat(64), mtimeMs: old })

  const { config, report } = sweep(dir)
  const [result] = report.results
  assert.equal(result.outcome, 'quarantined_corrupt')
  assert.equal(result.alert, true)
  assert.match(result.detail, /does not match sidecar/)

  // Moved, not deleted: a refusal that destroys its own evidence cannot be
  // investigated.
  assert.deepEqual(listing(config.inbox.dir), [])
  assert.deepEqual(listing(`${config.quarantine.dir}/${BASE}`), [
    'REASON.txt',
    `${BASE}.dump.age`,
    `${BASE}.dump.age.sha256`,
    `${BASE}.manifest.json`,
  ])
  assert.match(fs.readFileSync(`${config.quarantine.dir}/${BASE}/REASON.txt`, 'utf8'), /sidecar/)
  assert.deepEqual(listing(config.receipts.dir), [])
  assert.deepEqual(listing(config.archive.dir), [])
})

test('a manifest that disagrees with its own artifact is a definitive refusal, not a retry', () => {
  const dir = sandbox()
  // Fresh, so "wait for more bytes" would be the wrong answer: the three files
  // already hash together, so these bytes are exactly what the producer wrote.
  writeTriple(`${dir}/inbox`, { manifestPatch: { snapshot_ts: '2026-01-01T00:00:00Z' } })
  const { config, report } = sweep(dir)
  assert.equal(report.results[0].outcome, 'quarantined_manifest_invalid')
  assert.match(report.results[0].detail, /compacts to/)
  assert.deepEqual(listing(config.archive.dir), [])
  assert.ok(listing(`${config.quarantine.dir}/${BASE}`).includes(`${BASE}.manifest.json`))
})

// ─── partial arrivals ────────────────────────────────────────────────────────

test('a young incomplete triple is left exactly as found', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`, { omit: 'manifest', mtimeMs: NOW - 60_000 })
  const before = listing(`${dir}/inbox`)
  const bytesBefore = fs.readFileSync(`${dir}/inbox/${BASE}.dump.age`)

  const { config, report, reads } = sweep(dir)
  const [result] = report.results
  assert.equal(result.outcome, 'pending_incomplete')
  assert.match(result.detail, /manifest\.json/)

  assert.deepEqual(listing(config.inbox.dir), before, 'nothing may be deleted or moved')
  assert.deepEqual(fs.readFileSync(`${dir}/inbox/${BASE}.dump.age`), bytesBefore)
  assert.deepEqual(listing(config.quarantine.dir), [])
  assert.deepEqual(
    reads.filter((p) => p.startsWith(`${dir}/inbox/`)),
    [],
    'an incomplete arrival is never even read',
  )
})

test('a triple still incomplete after the grace period is moved aside and reported', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`, { omit: 'checksum', mtimeMs: NOW - 7_200_000 })
  const { config, report } = sweep(dir)
  const [result] = report.results
  assert.equal(result.outcome, 'quarantined_stalled')
  assert.equal(result.alert, true)
  assert.deepEqual(listing(config.inbox.dir), [])
  assert.deepEqual(listing(`${config.quarantine.dir}/${BASE}`), [
    'REASON.txt',
    `${BASE}.dump.age`,
    `${BASE}.manifest.json`,
  ])
})

test('a triple whose files keep arriving keeps its grace period', () => {
  const dir = sandbox()
  // Two old parts and one that landed a second ago: the newest mtime is what
  // decides, so an actively-progressing transfer is never aged out.
  writeTriple(`${dir}/inbox`, { omit: 'manifest', mtimeMs: NOW - 7_200_000 })
  fs.writeFileSync(
    `${dir}/inbox/${BASE}.dump.age.sha256`,
    fs.readFileSync(`${dir}/inbox/${BASE}.dump.age.sha256`),
  )
  const { report } = sweep(dir)
  assert.equal(report.results[0].outcome, 'pending_incomplete')
})

// ─── unsafe paths ────────────────────────────────────────────────────────────

test('a symlink named like an artifact is quarantined without its target being read', () => {
  const dir = sandbox()
  const secret = `${dir}/secret.txt`
  fs.writeFileSync(secret, 'a private file the transport must never reach')
  writeTriple(`${dir}/inbox`)
  fs.rmSync(`${dir}/inbox/${BASE}.dump.age`)
  fs.symlinkSync(secret, `${dir}/inbox/${BASE}.dump.age`)

  const { config, report, reads, hashed } = sweep(dir)
  const [result] = report.results
  assert.equal(result.outcome, 'quarantined_unsafe')
  assert.equal(result.alert, true)
  assert.match(result.detail, /symbolic link/)

  assert.equal(reads.includes(secret), false, 'the link target must never be read')
  assert.equal(hashed.includes(secret), false)
  assert.equal(fs.readFileSync(secret, 'utf8'), 'a private file the transport must never reach')
  assert.deepEqual(listing(config.archive.dir), [])
  // The link itself was moved, and it is still a link — nothing followed it.
  assert.ok(fs.lstatSync(`${config.quarantine.dir}/${BASE}/${BASE}.dump.age`).isSymbolicLink())
})

test('a directory wearing an artifact name is quarantined, not descended into', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  fs.rmSync(`${dir}/inbox/${BASE}.manifest.json`)
  fs.mkdirSync(`${dir}/inbox/${BASE}.manifest.json`)
  fs.writeFileSync(`${dir}/inbox/${BASE}.manifest.json/inner`, 'x')

  const { config, report } = sweep(dir)
  assert.equal(report.results[0].outcome, 'quarantined_unsafe')
  assert.match(report.results[0].detail, /directory/)
  assert.deepEqual(listing(config.archive.dir), [])
})

test('an entry that resolves outside the directory it was listed in is refused', () => {
  const dir = sandbox()
  const outside = `${dir}/outside.bin`
  fs.writeFileSync(outside, 'not in the inbox')
  writeTriple(`${dir}/inbox`)
  const { config, report, reads } = sweep(
    dir,
    {},
    {
      // A symlinked ancestor, or an inbox swapped underneath the sweep, both
      // land here: lstat described an ordinary file, and the resolved path is
      // somewhere else entirely.
      realpathSync: (p) => (String(p).endsWith(`${BASE}.dump.age`) ? outside : fs.realpathSync(p)),
    },
  )
  assert.equal(report.results[0].outcome, 'quarantined_unsafe')
  assert.match(report.results[0].detail, /not directly inside/)
  assert.equal(reads.includes(outside), false)
  assert.deepEqual(listing(config.archive.dir), [])
})

test('an entry that vanishes mid-sweep is deferred, not quarantined', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const { config, report } = sweep(
    dir,
    {},
    {
      realpathSync: (p) => {
        if (String(p).endsWith(`${BASE}.manifest.json`)) {
          const err = new Error('ENOENT: no such file or directory')
          err.code = 'ENOENT'
          throw err
        }
        return fs.realpathSync(p)
      },
    },
  )
  assert.equal(report.results[0].outcome, 'pending_incomplete')
  assert.deepEqual(listing(config.quarantine.dir), [], 'a moving inbox is not a refusal')
  assert.equal(listing(config.inbox.dir).length, 3)
})

test('a source swapped for a symlink after every check is refused, never followed', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  // The SAME bytes, outside the inbox. Identical content is what makes this a
  // substitution test rather than a corruption test: a sweep that follows the
  // link gets a triple that verifies perfectly, and accepts bytes it never had
  // the right to read.
  const outside = `${dir}/outside-the-inbox.bin`
  fs.writeFileSync(outside, written.body)
  const ciphertext = `${dir}/inbox/${written.names.ciphertext}`

  let swapped = false
  const { config, report, reads, opened } = sweep(
    dir,
    {},
    {
      // Fires the instant the artifact's private work directory exists: after
      // the lstat type check, after the containment check, after capacity —
      // and immediately before the first byte is copied. Every path-based
      // check has already passed by then, which is exactly why they cannot be
      // what makes the copy safe.
      onMkdir: (p) => {
        if (swapped || !p.endsWith(`/${BASE}`)) return
        swapped = true
        fs.unlinkSync(ciphertext)
        fs.symlinkSync(outside, ciphertext)
      },
    },
  )

  assert.ok(swapped, 'the substitution must actually have happened')
  const [result] = report.results
  assert.equal(result.outcome, 'quarantined_unsafe')
  assert.equal(result.alert, true)
  assert.match(result.detail, /symbolic link/)

  assert.equal(opened.includes(outside), false, 'the link target must never be opened')
  assert.equal(reads.includes(outside), false)
  assert.deepEqual(fs.readFileSync(outside), written.body, 'the target is untouched')
  assert.deepEqual(listing(config.archive.dir), [])
  assert.deepEqual(listing(config.receipts.dir), [])
  // The link itself is preserved as evidence, moved rather than followed.
  assert.ok(fs.lstatSync(`${config.quarantine.dir}/${BASE}/${BASE}.dump.age`).isSymbolicLink())
})

test('a failed publish leaves no temporary of its own behind', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const config = makeConfig(dir)
  const archiveDir = `${config.archive.dir}/2026`
  const { error } = sweepExpectingThrow(
    dir,
    {},
    {
      copyFileSync: (from, to) => {
        if (String(to).startsWith(`${archiveDir}/${written.base}.manifest.json.`)) {
          throw new Error('EIO')
        }
        fs.copyFileSync(from, to)
      },
    },
  )
  assert.equal(error.code, 'archive_publish_failed')
  assert.deepEqual(listing(archiveDir), [], 'neither published files nor .part debris survive')
  assert.deepEqual(listing(config.receipts.dir), [])
})

test('an inbox that is not a directory stops the whole sweep', () => {
  const dir = sandbox()
  fs.rmSync(`${dir}/inbox`, { recursive: true, force: true })
  fs.mkdirSync(`${dir}/elsewhere`, { recursive: true })
  fs.symlinkSync(`${dir}/elsewhere`, `${dir}/inbox`)
  const { error } = sweepExpectingThrow(dir)
  assert.equal(error.code, 'inbox_unsafe')

  fs.unlinkSync(`${dir}/inbox`)
  const missing = sweepExpectingThrow(dir)
  assert.equal(missing.error.code, 'inbox_unreadable')
})

// ─── bounds ──────────────────────────────────────────────────────────────────

test('a file above its configured ceiling is refused before a byte is read', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const { config, report, reads, hashed } = sweep(dir, {
    acceptance: { maxCiphertextBytes: 8 },
  })
  const [result] = report.results
  assert.equal(result.outcome, 'quarantined_oversize')
  assert.match(result.detail, /ceiling is 8/)
  assert.deepEqual(
    hashed.filter((p) => p.includes(BASE)),
    [],
    'an oversized artifact is never hashed',
  )
  assert.deepEqual(
    reads.filter((p) => p.startsWith(`${dir}/inbox/`)),
    [],
  )
  assert.deepEqual(listing(config.archive.dir), [])
})

test('a triple swapped for a larger, consistently hashed one after the checks is refused', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  let swapped = false
  const { config, report, hashed } = sweep(
    dir,
    { acceptance: { maxCiphertextBytes: 128 } },
    {
      onMkdir: (p) => {
        if (swapped || !p.endsWith(`/${BASE}`)) return
        swapped = true
        // A whole new triple: 512 bytes of ciphertext with a sidecar and a
        // manifest that agree with it. It verifies complete, and its manifest
        // describes it correctly. Only the ceiling stands between it and the
        // archive — so a ceiling read once from the pre-copy lstat is no
        // ceiling at all.
        writeTriple(`${dir}/inbox`, { body: 'x'.repeat(512) })
      },
    },
  )

  assert.ok(swapped, 'the substitution must actually have happened')
  const [result] = report.results
  assert.equal(result.outcome, 'quarantined_oversize')
  assert.equal(result.alert, true)
  assert.match(result.detail, /128/)
  assert.deepEqual(listing(config.archive.dir), [])
  assert.deepEqual(listing(config.receipts.dir), [])
  assert.deepEqual(listing(config.work.dir), [], 'no oversized copy is left behind')
  assert.deepEqual(
    hashed.filter((p) => p.includes(BASE)),
    [],
    'an oversized artifact is never hashed',
  )
})

test('a source that grows past its ceiling while it is being copied is refused mid-copy', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`, { body: 'y'.repeat(100) })
  const ciphertext = `${dir}/inbox/${written.names.ciphertext}`
  let grown = false
  const { config, report, hashed } = sweep(
    dir,
    { acceptance: { maxCiphertextBytes: 200 } },
    {
      // Growth DURING the copy, not before it. The acceptor is already reading
      // this file when it gets longer, so nothing derived from the pre-copy
      // lstat can bound what lands on disk; only the copy itself can.
      //
      // Against a copy that is one `copyFileSync` call this never fires at all,
      // and the artifact is simply accepted — which is the same defect stated
      // the other way round.
      onRead: (p) => {
        if (grown || p !== ciphertext) return
        grown = true
        fs.appendFileSync(ciphertext, 'z'.repeat(400))
      },
    },
  )

  assert.ok(grown, 'the source must actually have grown during a read of it')
  const [result] = report.results
  assert.equal(result.outcome, 'quarantined_oversize')
  assert.equal(result.alert, true)
  assert.match(result.detail, /200/)
  assert.deepEqual(listing(config.archive.dir), [])
  assert.deepEqual(listing(config.receipts.dir), [])
  assert.deepEqual(listing(config.work.dir), [], 'the partial oversized copy is removed')
  assert.deepEqual(
    hashed.filter((p) => p.includes(BASE)),
    [],
    'a copy that breached its ceiling is never hashed',
  )
})

test('a sweep accepts at most maxArtifactsPerSweep and leaves the rest untouched', () => {
  const dir = sandbox()
  const bases = ['20260904T180007Z', '20260904T190007Z', '20260904T200007Z'].map((stamp) =>
    writeTriple(`${dir}/inbox`, {
      base: `${PREFIX}-${stamp}`,
      snapshotTs: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
    }),
  )
  const { config, report } = sweep(dir, { acceptance: { maxArtifactsPerSweep: 2 } })
  assert.equal(report.counts.accepted, 2)
  assert.equal(report.counts.deferred_budget, 1)
  const deferred = report.results.find((r) => r.outcome === 'deferred_budget').base
  assert.equal(deferred, bases[2].base)
  assert.deepEqual(listing(config.inbox.dir), [
    `${deferred}.dump.age`,
    `${deferred}.dump.age.sha256`,
    `${deferred}.manifest.json`,
  ])
  // The next sweep picks the remainder up.
  const second = sweep(dir, { acceptance: { maxArtifactsPerSweep: 2 } })
  assert.equal(second.report.counts.accepted, 1)
  assert.deepEqual(listing(config.inbox.dir), [])
})

test('a sweep stops starting artifacts once its deadline has passed', () => {
  const dir = sandbox()
  for (const stamp of ['20260904T180007Z', '20260904T190007Z']) {
    writeTriple(`${dir}/inbox`, {
      base: `${PREFIX}-${stamp}`,
      snapshotTs: `2026-09-04T${stamp.slice(9, 11)}:00:07Z`,
    })
  }
  let clock = NOW
  const { report } = sweep(
    dir,
    { acceptance: { sweepDeadlineMs: 1000 } },
    {
      now: () => {
        const t = clock
        clock += 900 // two calls into the first artifact and the budget is spent
        return t
      },
    },
  )
  assert.ok(report.counts.deferred_deadline >= 1, JSON.stringify(report.counts))
})

test('capacity is checked on both filesystem layers before anything is copied', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const { config, error } = sweepExpectingThrow(dir, {}, { backingFree: 10 })
  assert.equal(error.code, 'insufficient_capacity')
  assert.match(error.message, /backing volume/)
  assert.deepEqual(listing(config.archive.dir), [])
  assert.deepEqual(listing(config.work.dir), [], 'the work directory is removed on every exit path')
  assert.equal(fs.existsSync(config.acceptance.lockFile), false, 'and the lock is released')
  // The inbox is untouched, so the next sweep can try again.
  assert.equal(listing(config.inbox.dir).length, 3)
})

// ─── capacity: what is reserved, when, and on which filesystem ───────────────
//
// Two writes happen per artifact, onto two directories that may or may not
// share a filesystem: the work copy (from the inbox, whose sizes the transport
// can still change) and the archive publish (from the work copy, whose sizes it
// cannot). These tests pin that each write is measured against the volume it
// lands on, with a bound the transport cannot move.

/** Ceilings small enough that a reservation derived from them is assertable. */
const TIGHT_CEILINGS = { maxCiphertextBytes: 4096, maxManifestBytes: 4096, maxSidecarBytes: 512 }
const TIGHT_CEILING_BYTES =
  TIGHT_CEILINGS.maxCiphertextBytes +
  TIGHT_CEILINGS.maxManifestBytes +
  TIGHT_CEILINGS.maxSidecarBytes

test('the work reservation is the configured ceilings, not the inbox sizes a transport can still change', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const observed = inboxTripleBytes(dir)
  const floor = 1000
  // Room for two copies of what `lstat` says is there *now*, and nowhere near
  // room for what the copy loop is actually permitted to write. A source
  // replaced or grown after the check — while staying under its role ceiling —
  // is exactly the difference between these two numbers.
  const fsFree = floor + observed * 2 + 1
  assert.ok(fsFree < floor + TIGHT_CEILING_BYTES, 'fixture must sit between the two bounds')

  const { config, error, opened } = sweepExpectingThrow(
    dir,
    { acceptance: TIGHT_CEILINGS, capacity: { minFreeBytes: floor } },
    { fsFree },
  )
  assert.equal(error.code, 'insufficient_capacity')
  assert.match(error.message, new RegExp(`${TIGHT_CEILING_BYTES}`))
  assert.deepEqual(
    opened.filter((p) => p.startsWith(`${config.inbox.dir}/`)),
    [],
    'no inbox source may be opened once the reservation cannot be met',
  )
  assert.deepEqual(listing(config.archive.dir), [])
  assert.equal(listing(config.inbox.dir).length, 3)
})

test('a work reservation one byte short refuses before any source byte is read', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const floor = 1000
  const { config, error, opened, reads, hashed } = sweepExpectingThrow(
    dir,
    { acceptance: TIGHT_CEILINGS, capacity: { minFreeBytes: floor } },
    { fsFree: floor + TIGHT_CEILING_BYTES - 1 },
  )
  assert.equal(error.code, 'insufficient_capacity')
  assert.match(error.message, /acceptance work/)
  assert.deepEqual(
    opened.filter((p) => p.startsWith(`${config.inbox.dir}/`)),
    [],
  )
  assert.deepEqual(
    reads.filter((p) => p.startsWith(`${config.inbox.dir}/`)),
    [],
  )
  assert.deepEqual(hashed, [], 'nothing is hashed when there is no room to copy it')
  assert.deepEqual(listing(config.work.dir), [])
  assert.equal(listing(config.inbox.dir).length, 3)
  assert.equal(fs.existsSync(config.acceptance.lockFile), false)
})

test('exactly enough room for the reserved ceilings is enough to accept', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const floor = 1000
  const { report, config } = sweep(
    dir,
    { acceptance: TIGHT_CEILINGS, capacity: { minFreeBytes: floor } },
    { fsFree: floor + TIGHT_CEILING_BYTES },
  )
  assert.equal(report.results[0].outcome, 'accepted')
  assert.ok(fs.existsSync(`${config.archive.dir}/2026/${BASE}.dump.age`))
})

test('insufficient archive capacity refuses before the archive is mutated', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const need = inboxTripleBytes(dir)
  const floor = 1000
  // Work has room to spare; the archive volume is one byte short of the floor
  // plus the bytes that are about to be published onto it.
  const { config, error } = sweepExpectingThrow(
    dir,
    { capacity: { minFreeBytes: floor } },
    {
      freeSpaceFor: (p) =>
        p.startsWith(`${dir}/private/archive`) ? floor + need - 1 : 1_000_000_000,
    },
  )
  assert.equal(error.code, 'insufficient_capacity')
  assert.match(error.message, /archive/)
  assert.deepEqual(listing(config.archive.dir), [], 'not even a year directory was created')
  assert.deepEqual(listing(config.receipts.dir), [])
  assert.deepEqual(listing(config.quarantine.dir), [])
  assert.equal(listing(config.inbox.dir).length, 3, 'the inbox is left for the next sweep')
  assert.deepEqual(listing(config.work.dir), [])
})

test('on separate filesystems the archive volume is measured with the bytes that will land on it', () => {
  const dir = sandbox()
  const { body } = writeTriple(`${dir}/inbox`)
  const need = inboxTripleBytes(dir)
  const floor = 1000
  // The archive volume holds its floor plus exactly the published bytes, and
  // nothing more — the work volume's headroom says nothing about it.
  const { report, config } = sweep(
    dir,
    { capacity: { minFreeBytes: floor } },
    {
      freeSpaceFor: (p) => (p.startsWith(`${dir}/private/archive`) ? floor + need : 1_000_000_000),
    },
  )
  assert.equal(report.results[0].outcome, 'accepted')
  assert.deepEqual(fs.readFileSync(`${config.archive.dir}/2026/${BASE}.dump.age`), body)
  assert.ok(fs.existsSync(`${config.receipts.dir}/${receiptFileName(BASE)}`))
})

test('on one shared filesystem the reservation composes and the floor survives the sweep', () => {
  const dir = sandbox()
  for (const stamp of ['20260904T180007Z', '20260904T190007Z']) {
    writeTriple(`${dir}/inbox`, {
      base: `${PREFIX}-${stamp}`,
      snapshotTs: `2026-09-04T${stamp.slice(9, 11)}:00:07Z`,
    })
  }
  const floor = 1000
  // ONE pool behind work, archive and receipts, holding exactly one
  // reservation at the moment the sweep first measures it. Free space is the
  // pool minus everything the sweep has put on it since — so the second
  // artifact is measured against a pool that has already lost the first
  // artifact's work copy, archive copy and receipt.
  const pool = floor + TIGHT_CEILING_BYTES
  let baseline = null
  const sharedFree = () => {
    const used = usedBytes(`${dir}/private`)
    if (baseline === null) baseline = used
    return pool - (used - baseline)
  }
  const { config, error } = sweepExpectingThrow(
    dir,
    { acceptance: TIGHT_CEILINGS, capacity: { minFreeBytes: floor } },
    { freeSpaceFor: (p) => (p.startsWith(`${dir}/backing`) ? 1_000_000_000 : sharedFree()) },
  )
  assert.equal(error.code, 'insufficient_capacity')

  const first = `${PREFIX}-20260904T180007Z`
  const second = `${PREFIX}-20260904T190007Z`
  assert.ok(fs.existsSync(`${config.archive.dir}/2026/${first}.dump.age`), 'the first was accepted')
  assert.ok(fs.existsSync(`${config.receipts.dir}/${receiptFileName(first)}`))
  assert.equal(fs.existsSync(`${config.archive.dir}/2026/${second}.dump.age`), false)
  assert.equal(fs.existsSync(`${config.receipts.dir}/${receiptFileName(second)}`), false)
  assert.deepEqual(
    listing(config.inbox.dir),
    artifactFileNamesSorted(second),
    'only the refused triple is left, and it is left whole',
  )
  assert.ok(sharedFree() >= floor, `the configured floor was consumed: ${sharedFree()} < ${floor}`)
})

test('a capacity refusal leaves the inbox and already-accepted evidence byte-identical', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`, { body: 'the artifact that was already accepted' })
  const first = sweep(dir)
  assert.equal(first.report.results[0].outcome, 'accepted')
  const archivedPath = `${first.config.archive.dir}/2026/${BASE}.dump.age`
  const receiptPath = `${first.config.receipts.dir}/${receiptFileName(BASE)}`
  const archivedBefore = fs.readFileSync(archivedPath)
  const receiptBefore = fs.readFileSync(receiptPath)
  const archiveListingBefore = listing(`${first.config.archive.dir}/2026`)

  const later = `${PREFIX}-20260904T190007Z`
  writeTriple(`${dir}/inbox`, { base: later, snapshotTs: '2026-09-04T19:00:07Z' })
  const { config, error } = sweepExpectingThrow(
    dir,
    {},
    { freeSpaceFor: (p) => (p.startsWith(`${dir}/private/archive`) ? 500 : 1_000_000_000) },
  )
  assert.equal(error.code, 'insufficient_capacity')
  assert.deepEqual(fs.readFileSync(archivedPath), archivedBefore)
  assert.deepEqual(fs.readFileSync(receiptPath), receiptBefore)
  assert.deepEqual(listing(`${config.archive.dir}/2026`), archiveListingBefore)
  assert.deepEqual(listing(config.receipts.dir), [receiptFileName(BASE)])
  assert.deepEqual(listing(config.inbox.dir), artifactFileNamesSorted(later))
  assert.deepEqual(listing(config.quarantine.dir), [])
})

// ─── conflicting identities ──────────────────────────────────────────────────

test('an identity already archived with different content is refused, never overwritten', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`, { body: 'ORIGINAL ciphertext bytes' })
  const first = sweep(dir)
  assert.equal(first.report.results[0].outcome, 'accepted')
  const archiveDir = `${first.config.archive.dir}/2026`
  const archivedBefore = fs.readFileSync(`${archiveDir}/${BASE}.dump.age`)
  const receiptPath = `${first.config.receipts.dir}/${receiptFileName(BASE)}`
  const receiptBefore = fs.readFileSync(receiptPath)

  // A different artifact arrives claiming the same second.
  writeTriple(`${dir}/inbox`, { body: 'A DIFFERENT database entirely' })
  const second = sweep(dir)
  const [result] = second.report.results
  assert.equal(result.outcome, 'rejected_identity_conflict')
  assert.equal(result.alert, true)
  assert.match(result.detail, /ciphertext sha256/)

  assert.deepEqual(fs.readFileSync(`${archiveDir}/${BASE}.dump.age`), archivedBefore)
  assert.deepEqual(fs.readFileSync(receiptPath), receiptBefore)
  assert.deepEqual(listing(second.config.inbox.dir), [])
  assert.ok(listing(`${second.config.quarantine.dir}/${BASE}`).includes(`${BASE}.dump.age`))
})

test('the same bytes under the same name but a different recovery point is still a conflict', () => {
  const dir = sandbox()
  // Both compact to the same second, so they collide as identities while
  // describing different snapshots. Two hosts' clocks are not a coordination
  // mechanism.
  writeTriple(`${dir}/inbox`, { snapshotTs: '2026-09-04T18:00:07Z' })
  assert.equal(sweep(dir).report.results[0].outcome, 'accepted')
  writeTriple(`${dir}/inbox`, { snapshotTs: '2026-09-04T18:00:07.500Z' })
  const { report } = sweep(dir)
  assert.equal(report.results[0].outcome, 'rejected_identity_conflict')
  assert.match(report.results[0].detail, /snapshot_ts/)
})

// ─── idempotent re-delivery ──────────────────────────────────────────────────

test('an identical re-delivery is idempotent and does not touch the receipt', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const first = sweep(dir)
  assert.equal(first.report.results[0].outcome, 'accepted')
  const receiptPath = `${first.config.receipts.dir}/${receiptFileName(BASE)}`
  const receiptBefore = fs.readFileSync(receiptPath)
  const archived = `${first.config.archive.dir}/2026/${BASE}.dump.age`
  const archivedBefore = fs.readFileSync(archived)

  // The same artifact is delivered again, later.
  writeTriple(`${dir}/inbox`, { body: written.body.toString() })
  const second = sweep(dir, {}, { now: () => NOW + 3_600_000 })
  const [result] = second.report.results
  assert.equal(result.outcome, 'duplicate')
  assert.equal(result.freshnessAdvanced, false)

  assert.deepEqual(
    fs.readFileSync(receiptPath),
    receiptBefore,
    'the receipt must be byte-identical — a re-delivery cannot advance freshness',
  )
  assert.deepEqual(fs.readFileSync(archived), archivedBefore)
  assert.deepEqual(listing(second.config.receipts.dir), [receiptFileName(BASE)])
  assert.deepEqual(listing(second.config.inbox.dir), [], 'the re-delivered copy is consumed')
  assert.deepEqual(listing(second.config.quarantine.dir), [])
})

test('a re-delivery completes a receipt that a crash left unwritten', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const first = sweep(dir)
  const receiptPath = `${first.config.receipts.dir}/${receiptFileName(BASE)}`
  const archivedBefore = fs.readFileSync(`${first.config.archive.dir}/2026/${BASE}.dump.age`)
  // Exactly the state a crash between step 8 and step 9 leaves behind.
  fs.rmSync(receiptPath)

  writeTriple(`${dir}/inbox`, { body: written.body.toString() })
  const second = sweep(dir)
  assert.equal(second.report.results[0].outcome, 'receipt_completed')
  const receipt = readJson(receiptPath)
  assert.equal(receipt.ciphertext_sha256, written.hash)
  assert.deepEqual(
    fs.readFileSync(`${first.config.archive.dir}/2026/${BASE}.dump.age`),
    archivedBefore,
    'the archived copy is not rewritten to complete a receipt',
  )
})

test('an archive entry a crash left incomplete, with no receipt, is resumed', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const config = makeConfig(dir)
  // A publish that got as far as the ciphertext and stopped.
  fs.mkdirSync(`${config.archive.dir}/2026`, { recursive: true })
  fs.writeFileSync(`${config.archive.dir}/2026/${BASE}.dump.age`, 'half a file')

  const { report } = sweep(dir)
  assert.equal(report.results[0].outcome, 'accepted')
  assert.deepEqual(
    fs.readFileSync(`${config.archive.dir}/2026/${BASE}.dump.age`),
    written.body,
    'the resumed publish replaced the debris',
  )
  assert.ok(fs.existsSync(`${config.receipts.dir}/${receiptFileName(BASE)}`))
})

test('a damaged archive entry that HAS a receipt is never republished over', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const first = sweep(dir)
  assert.equal(first.report.results[0].outcome, 'accepted')
  const archived = `${first.config.archive.dir}/2026/${BASE}.dump.age`
  fs.writeFileSync(archived, 'silently corrupted on the destination volume')

  writeTriple(`${dir}/inbox`, { body: written.body.toString() })
  const second = sweep(dir)
  const [result] = second.report.results
  assert.equal(result.outcome, 'rejected_archive_damaged')
  assert.equal(result.alert, true)
  assert.equal(
    fs.readFileSync(archived, 'utf8'),
    'silently corrupted on the destination volume',
    'damage to an accepted artifact is reported, not quietly overwritten',
  )
})

test('a receipt whose archive files have ALL vanished still blocks a conflicting publish', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const first = sweep(dir)
  assert.equal(first.report.results[0].outcome, 'accepted')
  const archiveDir = `${first.config.archive.dir}/2026`
  const receiptPath = `${first.config.receipts.dir}/${receiptFileName(BASE)}`
  const receiptBefore = fs.readFileSync(receiptPath)
  // Total loss of the archived triple — a deleted directory, a volume that came
  // back empty. The receipt survives, and it still attests that this identity
  // was accepted.
  for (const name of Object.values(written.names)) fs.unlinkSync(`${archiveDir}/${name}`)

  // A DIFFERENT artifact now arrives under that identity. "No archive file is
  // present" must not read as "nothing was ever accepted here".
  writeTriple(`${dir}/inbox`, { body: 'a different database entirely' })
  const second = sweep(dir)
  const [result] = second.report.results
  assert.equal(result.outcome, 'rejected_archive_damaged')
  assert.equal(result.alert, true)
  assert.deepEqual(
    listing(archiveDir),
    [],
    'not one byte of the conflicting triple may reach the archive',
  )
  assert.deepEqual(fs.readFileSync(receiptPath), receiptBefore, 'the receipt is left for a human')
  assert.equal(
    listing(second.config.inbox.dir).length,
    3,
    'the incoming triple is preserved as evidence, not consumed',
  )
  assert.deepEqual(listing(second.config.quarantine.dir), [])
})

test('an accepted artifact whose archive has vanished is never silently republished', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const first = sweep(dir)
  assert.equal(first.report.results[0].outcome, 'accepted')
  const archiveDir = `${first.config.archive.dir}/2026`
  const receiptPath = `${first.config.receipts.dir}/${receiptFileName(BASE)}`
  const receiptBefore = fs.readFileSync(receiptPath)
  for (const name of Object.values(written.names)) fs.unlinkSync(`${archiveDir}/${name}`)

  // The very same bytes are delivered again. Republishing them would make the
  // receipt true again — and would hide the fact that an accepted artifact was
  // destroyed on the destination. Repair is an operator's decision.
  writeTriple(`${dir}/inbox`, { body: written.body.toString() })
  const second = sweep(dir)
  assert.equal(second.report.results[0].outcome, 'rejected_archive_damaged')
  assert.deepEqual(listing(archiveDir), [])
  assert.deepEqual(fs.readFileSync(receiptPath), receiptBefore)
  assert.equal(listing(second.config.inbox.dir).length, 3)
})

test('an existing receipt that is not bound to the artifact is a refusal', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const first = sweep(dir)
  const receiptPath = `${first.config.receipts.dir}/${receiptFileName(BASE)}`
  const forged = { ...readJson(receiptPath), ciphertext_sha256: 'e'.repeat(64) }
  fs.writeFileSync(receiptPath, JSON.stringify(forged, null, 2) + '\n')

  writeTriple(`${dir}/inbox`, { body: written.body.toString() })
  const second = sweep(dir)
  assert.equal(second.report.results[0].outcome, 'rejected_receipt_conflict')
  assert.equal(readJson(receiptPath).ciphertext_sha256, 'e'.repeat(64), 'left for a human')
})

// ─── exclusion ───────────────────────────────────────────────────────────────

test('a live holder of the acceptance lock stops a second sweep', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  const config = makeConfig(dir)
  fs.mkdirSync(path.dirname(config.acceptance.lockFile), { recursive: true })
  fs.writeFileSync(
    config.acceptance.lockFile,
    JSON.stringify({ sweepId: 'other', pid: 999, host: 'hotel-echo', startedAt: NOW - 1000 }),
  )
  const { error } = sweepExpectingThrow(dir, {}, { processAlive: () => true })
  assert.equal(error.code, 'acceptance_concurrent_run')
  assert.deepEqual(listing(config.inbox.dir).length, 3, 'a refused sweep changes nothing')
})

test('a lock whose holder is gone is reported, never reclaimed', () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.mkdirSync(path.dirname(config.acceptance.lockFile), { recursive: true })
  const payload = JSON.stringify({
    sweepId: 'dead',
    pid: 999,
    host: 'hotel-echo',
    startedAt: NOW - 100_000,
  })
  fs.writeFileSync(config.acceptance.lockFile, payload)
  const { error } = sweepExpectingThrow(dir, {}, { processAlive: () => false })
  assert.equal(error.code, 'acceptance_lock_stale')
  assert.match(error.message, /rm /)
  assert.equal(
    fs.readFileSync(config.acceptance.lockFile, 'utf8'),
    payload,
    'the lock file is left byte-identical for the operator',
  )
})

test('a foreign, hung or unreadable lock each refuse distinctly', () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const lockPath = config.acceptance.lockFile
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const deps = makeDeps(dir, { processAlive: () => true }).deps

  fs.writeFileSync(lockPath, JSON.stringify({ sweepId: 'x', pid: 1, host: 'somewhere-else' }))
  assert.throws(() => acquireAcceptanceLock({ config, deps, sweepId: 'me' }), {
    code: 'acceptance_lock_foreign_host',
  })

  fs.writeFileSync(
    lockPath,
    JSON.stringify({ sweepId: 'x', pid: 1, host: 'hotel-echo', startedAt: NOW - 99_999_999 }),
  )
  assert.throws(() => acquireAcceptanceLock({ config, deps, sweepId: 'me' }), {
    code: 'acceptance_concurrent_run_hung',
  })

  fs.writeFileSync(lockPath, 'not json at all')
  assert.throws(() => acquireAcceptanceLock({ config, deps, sweepId: 'me' }), {
    code: 'acceptance_lock_unreadable',
  })
  assert.equal(fs.readFileSync(lockPath, 'utf8'), 'not json at all')
})

test('a second sweeper interleaved inside the publish leaves one archive and one receipt', () => {
  const dir = sandbox()
  const written = writeTriple(`${dir}/inbox`)
  const config = makeConfig(dir)
  const archiveDir = `${config.archive.dir}/2026`
  let reentered = false
  let innerReport = null
  // Run a whole second sweep from inside the first one's archive publish — the
  // worst interleaving available, and the state a lock that had been cleared by
  // hand would allow.
  const copyFileSync = (from, to) => {
    fs.copyFileSync(from, to)
    if (!reentered && String(to).startsWith(`${archiveDir}/`)) {
      reentered = true
      const inner = makeDeps(dir, { randomToken: () => 'ffff0000' })
      innerReport = acceptInboxArtifacts({
        config: makeConfig(dir, { acceptance: { lockFile: `${dir}/private/accept-2.lock` } }),
        deps: inner.deps,
        log: inner.log,
      })
    }
  }
  const outer = sweep(dir, {}, { copyFileSync })

  assert.ok(reentered, 'the interleaving must actually have happened')
  assert.equal(innerReport.results[0].outcome, 'accepted')
  assert.deepEqual(listing(archiveDir), [
    `${BASE}.dump.age`,
    `${BASE}.dump.age.sha256`,
    `${BASE}.manifest.json`,
  ])
  assert.deepEqual(fs.readFileSync(`${archiveDir}/${BASE}.dump.age`), written.body)
  assert.deepEqual(listing(config.receipts.dir), [receiptFileName(BASE)])
  const receipt = readJson(`${config.receipts.dir}/${receiptFileName(BASE)}`)
  assert.equal(receipt.ciphertext_sha256, written.hash)
  assert.deepEqual(
    validateReceiptBinding(receipt, readJson(`${archiveDir}/${BASE}.manifest.json`)),
    { valid: true, failures: [] },
  )
  assert.ok(['accepted', 'duplicate'].includes(outer.report.results[0].outcome))
  assert.deepEqual(listing(config.inbox.dir), [])
  assert.equal(fs.existsSync(config.acceptance.lockFile), false)
})

// ─── interruption ────────────────────────────────────────────────────────────

test('an abort defers the artifacts it did not reach and writes nothing for them', () => {
  const dir = sandbox()
  const first = writeTriple(`${dir}/inbox`, { base: `${PREFIX}-20260904T180007Z` })
  const second = writeTriple(`${dir}/inbox`, {
    base: `${PREFIX}-20260904T190007Z`,
    snapshotTs: '2026-09-04T19:00:07Z',
  })
  const signal = { aborted: false }
  const config = makeConfig(dir)
  const world = makeDeps(dir, {
    copyFileSync: (from, to) => {
      fs.copyFileSync(from, to)
      // The operator interrupts as soon as the first artifact is archived.
      if (String(to).startsWith(`${config.archive.dir}/`)) signal.aborted = true
    },
  })
  const report = acceptInboxArtifacts({
    config,
    deps: world.deps,
    log: world.log,
    options: { signal },
  })

  assert.equal(report.results.find((r) => r.base === first.base).outcome, 'accepted')
  assert.equal(report.results.find((r) => r.base === second.base).outcome, 'deferred_aborted')
  assert.deepEqual(listing(`${config.archive.dir}/2026`), [
    `${first.base}.dump.age`,
    `${first.base}.dump.age.sha256`,
    `${first.base}.manifest.json`,
  ])
  assert.deepEqual(listing(config.receipts.dir), [receiptFileName(first.base)])
  assert.deepEqual(listing(config.inbox.dir), [
    `${second.base}.dump.age`,
    `${second.base}.dump.age.sha256`,
    `${second.base}.manifest.json`,
  ])
  assert.deepEqual(listing(config.work.dir), [])
  assert.equal(fs.existsSync(config.acceptance.lockFile), false)

  // And the deferred artifact is accepted on the next sweep.
  const resumed = sweep(dir)
  assert.equal(resumed.report.results[0].outcome, 'accepted')
})

test('a failure mid-publish withdraws its own files and leaves earlier acceptances intact', () => {
  const dir = sandbox()
  const first = writeTriple(`${dir}/inbox`, { base: `${PREFIX}-20260904T180007Z` })
  assert.equal(sweep(dir).report.results[0].outcome, 'accepted')
  const config = makeConfig(dir)
  const archiveDir = `${config.archive.dir}/2026`
  const firstBytes = fs.readFileSync(`${archiveDir}/${first.base}.dump.age`)
  const firstReceipt = fs.readFileSync(`${config.receipts.dir}/${receiptFileName(first.base)}`)

  const second = writeTriple(`${dir}/inbox`, {
    base: `${PREFIX}-20260904T190007Z`,
    snapshotTs: '2026-09-04T19:00:07Z',
  })
  const { error, config: cfg } = sweepExpectingThrow(
    dir,
    {},
    {
      copyFileSync: (from, to) => {
        // Die after the ciphertext has landed in the archive, exactly where a
        // crash would hurt most.
        const sidecarTmp = `${archiveDir}/${second.base}.dump.age.sha256.`
        if (String(to).startsWith(sidecarTmp) && String(to).endsWith('.part')) {
          throw new Error('EIO: destination volume went away')
        }
        fs.copyFileSync(from, to)
      },
    },
  )
  assert.equal(error.code, 'archive_publish_failed')

  // The interrupted artifact left nothing that could be mistaken for accepted.
  assert.equal(fs.existsSync(`${archiveDir}/${second.base}.dump.age`), false)
  assert.equal(fs.existsSync(`${cfg.receipts.dir}/${receiptFileName(second.base)}`), false)
  // The artifact accepted earlier is untouched.
  assert.deepEqual(fs.readFileSync(`${archiveDir}/${first.base}.dump.age`), firstBytes)
  assert.deepEqual(
    fs.readFileSync(`${cfg.receipts.dir}/${receiptFileName(first.base)}`),
    firstReceipt,
  )
  assert.deepEqual(listing(cfg.work.dir), [])
  assert.equal(fs.existsSync(cfg.acceptance.lockFile), false)
  // And the interrupted delivery is still in the inbox, ready to be retried.
  assert.equal(listing(cfg.inbox.dir).length, 3)
  assert.equal(sweep(dir).report.results[0].outcome, 'accepted')
})

// ─── housekeeping ────────────────────────────────────────────────────────────

test('entries that are not artifact files are reported and never touched', () => {
  const dir = sandbox()
  writeTriple(`${dir}/inbox`)
  fs.writeFileSync(`${dir}/inbox/.${BASE}.dump.age.tmpAB12`, 'an rsync temporary')
  fs.writeFileSync(`${dir}/inbox/latest.json`, '{}')
  fs.writeFileSync(`${dir}/inbox/README`, 'left by a human')

  const { config, report } = sweep(dir)
  assert.equal(report.results[0].outcome, 'accepted')
  assert.deepEqual(report.unexpectedEntries.sort(), [
    `.${BASE}.dump.age.tmpAB12`,
    'README',
    'latest.json',
  ])
  assert.deepEqual(listing(config.inbox.dir), [
    `.${BASE}.dump.age.tmpAB12`,
    'README',
    'latest.json',
  ])
})

test('work debris is removed only once it is older than the configured grace', () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.mkdirSync(`${config.work.dir}/old-sweep`, { recursive: true })
  fs.mkdirSync(`${config.work.dir}/young-sweep`, { recursive: true })
  fs.writeFileSync(`${config.work.dir}/old-sweep/copy`, 'x')
  fs.writeFileSync(`${config.work.dir}/young-sweep/copy`, 'x')
  const old = (NOW - 7_200_000) / 1000
  fs.utimesSync(`${config.work.dir}/old-sweep`, old, old)
  const young = (NOW - 60_000) / 1000
  fs.utimesSync(`${config.work.dir}/young-sweep`, young, young)

  sweep(dir)
  assert.deepEqual(listing(config.work.dir), ['young-sweep'])
})

test('an empty inbox is a successful, silent sweep', () => {
  const dir = sandbox()
  const { config, report } = sweep(dir)
  assert.deepEqual(report.results, [])
  assert.deepEqual(report.unexpectedEntries, [])
  assert.equal(fs.existsSync(config.acceptance.lockFile), false)
  assert.deepEqual(listing(config.archive.dir), [])
})
