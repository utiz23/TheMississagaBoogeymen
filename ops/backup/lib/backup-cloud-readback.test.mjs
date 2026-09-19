/**
 * Contained readback, workspace, capacity, and cleanup — E3J6B.
 *
 * FACTORY-route tests build the runner from the internal core's
 * `makeReadbackRunner()`, with the real filesystem dependencies and the
 * cloud operations (`runInfo`/`runContainedDownload`) replaced by
 * `testdoubles/fake-cloud-operations.mjs` (in memory, nothing spawned).
 * PRODUCTION-route tests exercise the closed export surface and static
 * absence properties against the real dependency binding.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BackupError,
  MANIFEST_SCHEMA_VERSION,
  formatChecksumSidecar,
  publishedTripleNames,
} from './backup-artifact-contract.mjs'
import * as production from './backup-cloud-readback.mjs'
import {
  REAL_READBACK_DEPS,
  ROLES,
  makeReadbackRunner,
  runCompletionAdapter,
} from './internal/backup-cloud-readback-core.mjs'
import { makeFakeCloud } from './testdoubles/fake-cloud-operations.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-readback' })

const BASE = 'eanhl-test-20260904T180007Z'
const ATTEMPT_ID = '20260916T123456Z-deadbeef'
const ROOT = '/proton/eanhl-backups'
const NAMESPACE = `${ROOT}/${BASE}.${ATTEMPT_ID}`
const SOURCE_RUN_ID = '20260904T180001Z-0a1b2c3d'
const SNAPSHOT_TS = '2026-09-04T18:00:07Z'
const SHA512_A = '0123456789abcdef'.repeat(8)
const SHA512_B = 'fedcba9876543210'.repeat(8)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sha512 = (p) => createHash('sha512').update(fs.readFileSync(p)).digest('hex')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOUBLE = path.join(HERE, 'testdoubles', 'fake-proton-drive.mjs')
const REAL_PRLIMIT = '/usr/bin/prlimit'
const HAS_REAL_PRLIMIT = (() => {
  try {
    fs.accessSync(REAL_PRLIMIT, fs.constants.X_OK)
    return fs.statSync(REAL_PRLIMIT).isFile()
  } catch {
    return false
  }
})()
const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`

const sandboxes = []
afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    try {
      fs.chmodSync(dir, 0o700)
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cloud-readback-'))
  sandboxes.push(dir)
  const readbackDir = path.join(dir, 'readback')
  fs.mkdirSync(readbackDir, { mode: 0o700 })
  return { dir, readbackDir }
}

function configFor(sb, overrides = {}) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: SHA512_A },
    credentials: { backend: 'pass' },
    remote: { root: ROOT },
    artifact: { sourceDir: path.join(sb.dir, 'artifacts') },
    attestation: { dir: path.join(sb.dir, 'attest') },
    readback: {
      dir: sb.readbackDir,
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: { executable: '/usr/bin/prlimit', expectedSha512: SHA512_B },
    },
    run: {
      lockFile: path.join(sb.dir, 'run', 'uploader.lock'),
      operationTimeoutMs: 5_000,
      cancelGraceMs: 500,
    },
    retry: { maxAttemptsPerArtifactPerRun: 1, backoffMs: 1, maxTotalAttemptsPerRun: 1 },
    capacity: { minFreeBytes: 1, backingVolume: null },
    ...overrides,
  }
}

function buildTriple({ base = BASE, ciphertext = Buffer.alloc(500, 9) } = {}) {
  const names = publishedTripleNames(base)
  const ciphertextHash = sha256(ciphertext)
  const checksumBuf = Buffer.from(formatChecksumSidecar(ciphertextHash, names.ciphertext), 'utf8')
  const manifestBuf = Buffer.from(
    JSON.stringify({
      schema_version: MANIFEST_SCHEMA_VERSION,
      artifact: names.ciphertext,
      run_id: SOURCE_RUN_ID,
      snapshot_ts: SNAPSHOT_TS,
      ciphertext: { sha256: ciphertextHash, bytes: ciphertext.length },
    }),
    'utf8',
  )
  // Exactly the shape a READY prepared attempt carries (E3J6A `sourceEvidence`).
  const sourceEvidence = {
    ciphertext: { sha256: ciphertextHash, bytes: ciphertext.length },
    checksum: { sha256: sha256(checksumBuf), bytes: checksumBuf.length },
    manifest: { sha256: sha256(manifestBuf), bytes: manifestBuf.length },
    snapshotTs: SNAPSHOT_TS,
    runId: SOURCE_RUN_ID,
  }
  return { names, ciphertext, checksumBuf, manifestBuf, sourceEvidence }
}

function publish(cloud, triple, { namespace = NAMESPACE, prefix = 'obj' } = {}) {
  const paths = {
    ciphertext: `${namespace}/${triple.names.ciphertext}`,
    checksum: `${namespace}/${triple.names.checksum}`,
    manifest: `${namespace}/${triple.names.manifest}`,
  }
  cloud.tree.set(paths.ciphertext, {
    nodeKind: 'file',
    state: 'active',
    nodeUid: `${prefix}-ct`,
    content: triple.ciphertext,
  })
  cloud.tree.set(paths.checksum, {
    nodeKind: 'file',
    state: 'active',
    nodeUid: `${prefix}-cs`,
    content: triple.checksumBuf,
  })
  cloud.tree.set(paths.manifest, {
    nodeKind: 'file',
    state: 'active',
    nodeUid: `${prefix}-mf`,
    content: triple.manifestBuf,
  })
  return paths
}

function makeRunner(cloud, deps = {}) {
  return makeReadbackRunner({ ...REAL_READBACK_DEPS, cloud: cloud.ops, ...deps })
}

const DEFAULT_EVIDENCE = buildTriple().sourceEvidence

async function readySession(
  sb,
  runner,
  { config = configFor(sb), sourceEvidence = DEFAULT_EVIDENCE } = {},
) {
  const session = runner.establishReadbackSession({
    config,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence,
  })
  const cap = await runner.proveReadbackCapacity({ session })
  assert.equal(cap.ok, true)
  const ws = await runner.setupAttemptWorkspace({ session })
  assert.equal(ws.ok, true)
  return session
}

// ── session + capacity ──────────────────────────────────────────────────────

test('establishReadbackSession refuses an untrusted readback.dir', () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const runner = makeRunner(cloud)
  const cfg = configFor(sb)
  cfg.readback.dir = path.join(sb.dir, 'missing')
  assert.throws(
    () =>
      runner.establishReadbackSession({
        config: cfg,
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
        sourceEvidence: DEFAULT_EVIDENCE,
      }),
    (err) => err instanceof BackupError && err.code === 'readback_dir_untrusted',
  )
})

test('proveReadbackCapacity: sufficient filesystem free space, no backing volume', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const session = runner.establishReadbackSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  const result = await runner.proveReadbackCapacity({ session })
  assert.equal(result.ok, true)
})

test('proveReadbackCapacity: an unreachable ceiling sum is capacity_insufficient', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const cfg = configFor(sb)
  cfg.capacity.minFreeBytes = Number.MAX_SAFE_INTEGER
  const session = runner.establishReadbackSession({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  const result = await runner.proveReadbackCapacity({ session })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'capacity_insufficient')
})

test('proveReadbackCapacity: a statfs failure is capacity_unprovable, never insufficient', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud(), {
    statfs: () => {
      throw new Error('native statfs detail')
    },
  })
  const session = runner.establishReadbackSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  const result = await runner.proveReadbackCapacity({ session })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'capacity_unprovable')
})

test('proveReadbackCapacity: a configured backingVolume that does not lexically contain readback.dir fails closed', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const cfg = configFor(sb, {
    capacity: {
      minFreeBytes: 1,
      backingVolume: { mountPoint: '/some/unrelated/mount', minFreeBytes: 1 },
    },
  })
  const session = runner.establishReadbackSession({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  const result = await runner.proveReadbackCapacity({ session })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'capacity_unprovable')
})

test('proveReadbackCapacity: a containing backingVolume on the SAME device with enough space succeeds', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  // sb.dir is a real ancestor of sb.readbackDir and is on the same device.
  const cfg = configFor(sb, {
    capacity: { minFreeBytes: 1, backingVolume: { mountPoint: sb.dir, minFreeBytes: 1 } },
  })
  const session = runner.establishReadbackSession({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  const result = await runner.proveReadbackCapacity({ session })
  assert.equal(result.ok, true)
})

// ── workspace setup ──────────────────────────────────────────────────────────

test('setupAttemptWorkspace requires capacity to have been proven first', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const session = runner.establishReadbackSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  await assert.rejects(
    () => runner.setupAttemptWorkspace({ session }),
    (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
  )
})

test('setupAttemptWorkspace creates the workspace and three role directories, mode 0700', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const session = await readySession(sb, runner)
  const workspacePath = path.join(sb.readbackDir, `${BASE}.${ATTEMPT_ID}`)
  const wsStat = fs.lstatSync(workspacePath)
  assert.equal(wsStat.mode & 0o777, 0o700)
  for (const role of ROLES) {
    const roleStat = fs.lstatSync(path.join(workspacePath, role))
    assert.equal(roleStat.mode & 0o777, 0o700)
  }
})

test('setupAttemptWorkspace fails EEXIST on a repeated call for the same session', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const session = await readySession(sb, runner)
  const second = await runner.setupAttemptWorkspace({ session })
  assert.equal(second.ok, false)
  assert.equal(second.code, 'workspace_collision')
})

test('a readback.dir identity change between capacity and workspace setup fails closed', async () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const session = runner.establishReadbackSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  const cap = await runner.proveReadbackCapacity({ session })
  assert.equal(cap.ok, true)

  const replacement = `${sb.readbackDir}.replacement`
  fs.mkdirSync(replacement, { mode: 0o700 })
  fs.rmSync(sb.readbackDir, { recursive: true, force: true })
  fs.renameSync(replacement, sb.readbackDir)

  await assert.rejects(
    () => runner.setupAttemptWorkspace({ session }),
    (err) => err instanceof BackupError && err.code === 'readback_dir_identity_changed',
  )
})

// ── readback: happy path, stopping order, and classification ───────────────

test('a valid round trip through readBackAttemptTriple: all three roles verify, completion ok', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })

  const result = await runner.readBackAttemptTriple({ session })

  assert.equal(result.performed, true)
  assert.equal(result.stoppedAtRole, null)
  assert.equal(result.overallCode, null)
  assert.equal(result.overallVerdict, null)
  assert.equal(result.terminationConfirmed, true)
  assert.equal(result.completion.checked, true)
  assert.equal(result.completion.ok, true)
  for (const role of ROLES) {
    assert.equal(result.roles[role].attempted, true)
    assert.equal(result.roles[role].observed, 'active_file')
    assert.equal(result.roles[role].matchesSource, true)
    assert.equal(result.roles[role].bytes, triple.sourceEvidence[role].bytes)
    assert.equal(result.roles[role].sha256, triple.sourceEvidence[role].sha256)
  }
})

test('readback order is manifest -> checksum -> ciphertext, and stops at the first absent role', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  cloud.tree.delete(remotePaths.manifest) // manifest absent on the remote

  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })

  assert.equal(result.stoppedAtRole, 'manifest')
  assert.equal(result.overallCode, 'remote_object_absent')
  assert.equal(result.overallVerdict, 'rejected')
  assert.equal(result.roles.manifest.observed, 'absent')
  assert.equal(result.roles.checksum.attempted, false) // checksum/ciphertext never reached
  assert.equal(result.roles.ciphertext.attempted, false)
  // Confirm the actual call ORDER was manifest first, before any absence:
  const infoCalls = cloud.log.filter((l) => l.operation === 'info').map((l) => l.remotePath)
  assert.deepEqual(infoCalls, [remotePaths.manifest])
})

test('T16: an internally consistent but substituted triple is rejected by the source-hash check, never parsed', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const real = buildTriple({ ciphertext: Buffer.alloc(500, 9) })
  const substituted = buildTriple({ ciphertext: Buffer.alloc(500, 42) }) // different, but fully self-consistent
  const remotePaths = publish(cloud, substituted)

  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: real.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })

  assert.equal(result.stoppedAtRole, 'manifest') // manifest bytes differ first (different snapshot content)
  assert.equal(result.overallVerdict, 'rejected')
  assert.ok(['role_hash_mismatch', 'role_size_mismatch'].includes(result.overallCode))
  assert.equal(result.completion.checked, false) // never reached; nothing was parsed
})

test('T15: a role that hash-matches size but not content is rejected before parsing', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  // Corrupt the ciphertext on the remote in a way that preserves byte length but changes content.
  const corrupted = Buffer.from(triple.ciphertext)
  corrupted[0] ^= 0xff
  cloud.tree.get(remotePaths.ciphertext).content = corrupted

  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })
  assert.equal(result.stoppedAtRole, 'ciphertext') // manifest and checksum still matched
  assert.equal(result.overallCode, 'role_hash_mismatch')
  assert.equal(result.overallVerdict, 'rejected')
})

test('T14: a role of exactly the ceiling verifies; one byte over trips containment (indeterminate)', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const ceiling = 4096 // maxSidecarBytes in configFor()
  // Build a checksum sidecar whose text is exactly `ceiling` bytes by padding a comment-free line;
  // simplest is to construct the ciphertext/manifest normally and only assert on the CIPHERTEXT
  // ceiling instead, which is easy to hit exactly.
  const ciphertext = Buffer.alloc(1_000_000, 7) // exactly maxCiphertextBytes
  const triple = buildTriple({ ciphertext })
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })
  assert.equal(result.roles.ciphertext.matchesSource, true)
  assert.equal(result.overallVerdict, null) // fully verified

  // Now one byte OVER the ceiling ON THE REMOTE. The bound source evidence is
  // the genuine in-ceiling triple (a ready preparation can never carry
  // over-ceiling evidence — see below); the remote ciphertext was replaced by
  // an oversized object, so manifest and checksum still match and the
  // ciphertext download itself must trip containment.
  const overCiphertext = Buffer.alloc(1_000_001, 7)
  const cloud2 = makeFakeCloud()
  const remotePaths2 = publish(cloud2, triple)
  cloud2.tree.get(remotePaths2.ciphertext).content = overCiphertext
  const runner2 = makeRunner(cloud2)
  const session2 = await readySession(sandbox(), runner2, {
    sourceEvidence: triple.sourceEvidence,
  })
  const result2 = await runner2.readBackAttemptTriple({ session: session2 })
  assert.equal(result2.roles.manifest.matchesSource, true)
  assert.equal(result2.roles.checksum.matchesSource, true)
  assert.equal(result2.stoppedAtRole, 'ciphertext')
  assert.equal(result2.overallCode, 'download_containment_violated')
  assert.equal(result2.overallVerdict, 'indeterminate')

  // Over-ceiling SOURCE evidence is refused before any session exists.
  const overTriple = buildTriple({ ciphertext: overCiphertext })
  const sb3 = sandbox()
  assert.throws(
    () =>
      makeRunner(makeFakeCloud()).establishReadbackSession({
        config: configFor(sb3),
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
        sourceEvidence: overTriple.sourceEvidence,
      }),
    (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
  )
})

test('provider_termination_unconfirmed stops the sequence immediately and withholds cleanup', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({
    respond: (call) => {
      if (call.operation === 'info' && call.index === 0) {
        return Object.freeze({
          kind: 'indeterminate',
          operation: 'info',
          code: 'provider_termination_unconfirmed',
          transferState: 'unknown',
        })
      }
      return undefined
    },
  })
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })
  assert.equal(result.stoppedAtRole, 'manifest')
  assert.equal(result.overallCode, 'provider_termination_unconfirmed')
  assert.equal(result.overallVerdict, 'indeterminate')
  assert.equal(result.terminationConfirmed, false)

  const cleanup = await runner.cleanupAttemptWorkspace({ session })
  assert.equal(cleanup.state, 'withheld_termination_unconfirmed')
  // Nothing was removed.
  assert.equal(fs.existsSync(path.join(sb.readbackDir, `${BASE}.${ATTEMPT_ID}`)), true)
})

test('credential_unavailable during readback is indeterminate, never rejected', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({
    respond: (call) => {
      if (call.operation === 'info' && call.index === 0) {
        return Object.freeze({
          kind: 'rejected',
          operation: 'info',
          code: 'credential_unavailable',
          transferState: 'definitely_zero',
        })
      }
      return undefined
    },
  })
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })
  assert.equal(result.overallCode, 'credential_unavailable')
  assert.equal(result.overallVerdict, 'indeterminate') // never rejected, per the readback override
})

test('an operation-inapplicable boundary code (e.g. an upload-only code) is internal_invariant_violated, never silently accepted', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({
    respond: (call) => {
      if (call.operation === 'download') {
        return Object.freeze({
          kind: 'rejected',
          operation: 'download',
          code: 'name_conflict',
          transferState: 'definitely_zero',
        })
      }
      return undefined
    },
  })
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })
  assert.equal(result.overallCode, 'internal_invariant_violated')
  assert.equal(result.overallVerdict, 'indeterminate')
})

// ── the completion adapter, independently and injected ──────────────────────

test('runCompletionAdapter: independent synthetic-input unit tests', () => {
  const triple = buildTriple()
  const ok = runCompletionAdapter({
    artifactBase: BASE,
    manifestText: triple.manifestBuf.toString('utf8'),
    checksumText: triple.checksumBuf.toString('utf8'),
    ciphertextSha256: triple.sourceEvidence.ciphertext.sha256,
    ciphertextBytes: triple.sourceEvidence.ciphertext.bytes,
  })
  assert.equal(ok.ok, true)

  const broken = runCompletionAdapter({
    artifactBase: BASE,
    manifestText: triple.manifestBuf.toString('utf8'),
    checksumText: 'not-a-sidecar-line',
    ciphertextSha256: triple.sourceEvidence.ciphertext.sha256,
    ciphertextBytes: triple.sourceEvidence.ciphertext.bytes,
  })
  assert.equal(broken.ok, false)

  const wrongSize = runCompletionAdapter({
    artifactBase: BASE,
    manifestText: triple.manifestBuf.toString('utf8'),
    checksumText: triple.checksumBuf.toString('utf8'),
    ciphertextSha256: triple.sourceEvidence.ciphertext.sha256,
    ciphertextBytes: triple.sourceEvidence.ciphertext.bytes + 1,
  })
  assert.equal(wrongSize.ok, false)
})

test('an injected faulty completion adapter, after every role already matched, is completion_adapter_internal_contradiction / indeterminate', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud, { verifyCompletion: () => ({ ok: false }) })
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  const result = await runner.readBackAttemptTriple({ session })
  for (const role of ROLES) assert.equal(result.roles[role].matchesSource, true)
  assert.equal(result.completion.checked, true)
  assert.equal(result.completion.ok, false)
  assert.equal(result.overallCode, 'completion_adapter_internal_contradiction')
  assert.equal(result.overallVerdict, 'indeterminate')
})

// ── cleanup ──────────────────────────────────────────────────────────────────

test('cleanupAttemptWorkspace removes exactly the downloaded files and the workspace, after a verified readback', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  await runner.readBackAttemptTriple({ session })

  const workspacePath = path.join(sb.readbackDir, `${BASE}.${ATTEMPT_ID}`)
  assert.equal(fs.existsSync(workspacePath), true)
  const cleanup = await runner.cleanupAttemptWorkspace({ session })
  assert.equal(cleanup.state, 'complete')
  assert.equal(fs.existsSync(workspacePath), false)
})

test('cleanupAttemptWorkspace refuses to unlink a downloaded file whose inode changed after readback', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  await runner.readBackAttemptTriple({ session })

  // Replace the downloaded ciphertext with a DIFFERENT inode at the same
  // path (same bytes). Allocating the replacement elsewhere first and
  // renaming it in is what guarantees a different inode on this filesystem.
  const workspacePath = path.join(sb.readbackDir, `${BASE}.${ATTEMPT_ID}`)
  const filePath = path.join(workspacePath, 'ciphertext', triple.names.ciphertext)
  const before = fs.lstatSync(filePath, { bigint: true })
  const replacement = `${filePath}.replacement`
  fs.writeFileSync(replacement, fs.readFileSync(filePath), { mode: 0o600 })
  fs.rmSync(filePath)
  fs.renameSync(replacement, filePath)
  const after = fs.lstatSync(filePath, { bigint: true })
  assert.notEqual(before.ino, after.ino)

  const cleanup = await runner.cleanupAttemptWorkspace({ session })
  assert.equal(cleanup.state, 'incomplete')
  assert.equal(fs.existsSync(filePath), true) // the unrecognised inode was left alone
  // The other two roles, whose identities still match, were cleaned normally.
  assert.equal(fs.existsSync(path.join(workspacePath, 'manifest')), false)
  assert.equal(fs.existsSync(path.join(workspacePath, 'checksum')), false)
})

test('cleanupAttemptWorkspace leaves an unexpected sibling untouched and reports incomplete', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  await runner.readBackAttemptTriple({ session })

  const workspacePath = path.join(sb.readbackDir, `${BASE}.${ATTEMPT_ID}`)
  const intruderPath = path.join(workspacePath, 'ciphertext', 'unexpected-file')
  fs.writeFileSync(intruderPath, 'surprise')

  const cleanup = await runner.cleanupAttemptWorkspace({ session })
  assert.equal(cleanup.state, 'incomplete')
  assert.equal(fs.readFileSync(intruderPath, 'utf8'), 'surprise') // untouched
})

test('cleanupAttemptWorkspace never removes anything before it is called (no cleanup on a mid-run failure)', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const remotePaths = publish(cloud, triple)
  cloud.tree.delete(remotePaths.manifest)
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
  await runner.readBackAttemptTriple({ session })
  const workspacePath = path.join(sb.readbackDir, `${BASE}.${ATTEMPT_ID}`)
  assert.equal(fs.existsSync(workspacePath), true) // readback itself never cleans up
})

test('the production cleanup signature accepts no downloadedIdentity or terminationConfirmed override', async () => {
  const sb = sandbox()
  // A GENUINE production session: sessions are factory-private, so the
  // production module accepts only its own.
  const session = production.establishReadbackSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  assert.equal((await production.proveReadbackCapacity({ session })).ok, true)
  assert.equal((await production.setupAttemptWorkspace({ session })).ok, true)

  const result = await production.cleanupAttemptWorkspace({
    session,
    downloadedIdentity: { manifest: { dev: 0n, ino: 0n } }, // forged — must be ignored
    terminationConfirmed: false, // forged — must be ignored
  })
  // The forged terminationConfirmed:false must NOT force a withheld cleanup:
  // only the session's own private state decides this.
  assert.notEqual(result.state, 'withheld_termination_unconfirmed')
  assert.equal(result.state, 'complete')
  assert.deepEqual(fs.readdirSync(sb.readbackDir), [])

  // A session from ANY other factory instance is refused by the production module.
  const foreign = await readySession(sandbox(), makeRunner(makeFakeCloud()))
  await assert.rejects(
    () => production.cleanupAttemptWorkspace({ session: foreign }),
    (err) => err instanceof BackupError && err.code === 'record_session_invalid',
  )
})

// ── factory-private sessions ─────────────────────────────────────────────────

test('a readback session from one factory instance is refused by another, even with an identical visible shape', async () => {
  const cloud = makeFakeCloud()
  const a = makeRunner(cloud)
  const b = makeRunner(cloud)
  const sbA = sandbox()
  const sessionA = await readySession(sbA, a)
  const sessionB = b.establishReadbackSession({
    config: configFor(sandbox()),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  assert.deepEqual(Object.keys(sessionA), Object.keys(sessionB))
  assert.equal(Object.isFrozen(sessionA), Object.isFrozen(sessionB))

  const refused = (err) => err instanceof BackupError && err.code === 'record_session_invalid'
  await assert.rejects(() => b.proveReadbackCapacity({ session: sessionA }), refused)
  await assert.rejects(() => b.setupAttemptWorkspace({ session: sessionA }), refused)
  await assert.rejects(() => b.readBackAttemptTriple({ session: sessionA }), refused)
  await assert.rejects(() => b.cleanupAttemptWorkspace({ session: sessionA }), refused)
  await assert.rejects(() => production.readBackAttemptTriple({ session: sessionA }), refused)
  assert.equal(cloud.log.length, 0) // no provider call under a foreign session
  assert.deepEqual(fs.readdirSync(sbA.readbackDir), [`${BASE}.${ATTEMPT_ID}`]) // untouched
})

// ── sealed operational authority ─────────────────────────────────────────────

test('SEALED (factory): substituted cli/credentials/timeouts/remotePaths/sourceEvidence are never read or honoured', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const triple = buildTriple()
  const canonical = publish(cloud, triple)
  const seen = []
  const record = (op) => (params) => {
    seen.push({ op, ...params })
    return cloud.ops[op](params)
  }
  const runner = makeRunner(cloud, {
    cloud: { runInfo: record('runInfo'), runContainedDownload: record('runContainedDownload') },
  })
  const evidence = structuredClone(triple.sourceEvidence)
  const session = await readySession(sb, runner, { sourceEvidence: evidence })
  // Mutating the caller's evidence object AFTER establishment changes nothing.
  evidence.ciphertext.sha256 = 'f'.repeat(64)

  const other = buildTriple({ ciphertext: Buffer.alloc(500, 1) })
  const touched = []
  const trap = (name, value) =>
    new Proxy(value, {
      get(target, key) {
        touched.push(name)
        return target[key]
      },
    })
  const result = await runner.readBackAttemptTriple({
    session,
    cli: trap('cli', { executable: '/tmp/evil', expectedSha512: SHA512_B }),
    credentials: trap('credentials', { backend: 'evil-store' }),
    timeouts: trap('timeouts', { operationTimeoutMs: 1, cancelGraceMs: 1 }),
    remotePaths: trap('remotePaths', {
      manifest: '/proton/evil/m',
      checksum: '/proton/evil/c',
      ciphertext: '/proton/evil/x',
    }),
    sourceEvidence: trap('sourceEvidence', other.sourceEvidence),
  })

  assert.deepEqual(touched, []) // not one substituted property was even read
  assert.equal(result.overallVerdict, null)
  assert.equal(result.completion.ok, true)
  assert.equal(seen.length, 6)
  const expectedOrder = ['manifest', 'manifest', 'checksum', 'checksum', 'ciphertext', 'ciphertext']
  seen.forEach((call, i) => {
    assert.equal(call.remotePath, canonical[expectedOrder[i]])
    assert.deepEqual(call.cli, {
      executable: '/opt/eanhl-cloud/bin/proton-drive',
      expectedSha512: SHA512_A,
    })
    assert.deepEqual(call.credentials, { backend: 'pass' })
    assert.deepEqual(call.timeouts, { operationTimeoutMs: 5_000, cancelGraceMs: 500 })
  })
})

test('SEALED: malformed or over-ceiling source evidence is refused at establishment', () => {
  const sb = sandbox()
  const runner = makeRunner(makeFakeCloud())
  const bad = [
    null,
    {},
    { ...DEFAULT_EVIDENCE, extra: 1 },
    { ...DEFAULT_EVIDENCE, snapshotTs: '' },
    { ...DEFAULT_EVIDENCE, runId: undefined },
    { ...DEFAULT_EVIDENCE, manifest: { sha256: 'A'.repeat(64), bytes: 10 } },
    { ...DEFAULT_EVIDENCE, manifest: { sha256: 'a'.repeat(64), bytes: 0 } },
    { ...DEFAULT_EVIDENCE, checksum: { sha256: 'a'.repeat(64), bytes: 4097 } },
    { ...DEFAULT_EVIDENCE, ciphertext: { sha256: 'a'.repeat(64), bytes: 1, extra: true } },
  ]
  for (const sourceEvidence of bad) {
    assert.throws(
      () =>
        runner.establishReadbackSession({
          config: configFor(sb),
          artifactBase: BASE,
          attemptId: ATTEMPT_ID,
          sourceEvidence,
        }),
      (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
    )
  }
})

test(
  'SEALED (production surface, real subprocess): executable, credential, timeout, remote-path, and source-evidence substitution is impossible',
  { skip: HAS_REAL_PRLIMIT ? false : `${REAL_PRLIMIT} is not present on this host` },
  async () => {
    const sb = sandbox()
    const triple = buildTriple()
    const mkLauncher = (name) => {
      const control = path.join(sb.dir, `${name}-control`)
      fs.mkdirSync(path.join(control, 'markers'), { recursive: true })
      const launcher = path.join(sb.dir, `${name}-bin`)
      fs.writeFileSync(
        launcher,
        `#!/bin/sh\nFAKE_PROTON_CONTROL_DIR=${shellQuote(control)} exec ${process.execPath} ${DOUBLE} "$@"\n`,
        { mode: 0o755 },
      )
      return { control, launcher }
    }
    const genuine = mkLauncher('genuine')
    const evil = mkLauncher('evil')
    const env = { envKeyEqualityChecks: { PROTON_DRIVE_CREDENTIALS_STORE: 'pass' } }
    const info = (uid) => ({
      ...env,
      stdout: JSON.stringify({
        nodeUid: uid,
        nodeKind: 'file',
        state: 'active',
        activeRevisionUid: null,
        claimedSize: null,
        claimedDigests: { sha1: null },
        sha1Verified: null,
      }),
    })
    const download = (buf) => ({
      ...env,
      downloadWrite: { base64: buf.toString('base64') },
      stdout: JSON.stringify({
        transferredItems: 1,
        transferredBytes: buf.length,
        skippedItems: 0,
        failedItems: 0,
        failures: [],
      }),
    })
    fs.writeFileSync(
      path.join(genuine.control, 'response.json'),
      JSON.stringify({
        sequence: [
          info('mf'),
          download(triple.manifestBuf),
          info('cs'),
          download(triple.checksumBuf),
          info('ct'),
          download(triple.ciphertext),
        ],
      }),
    )
    // The evil launcher would answer anything — it must simply never run.
    fs.writeFileSync(path.join(evil.control, 'response.json'), JSON.stringify({ stdout: '{}' }))

    const config = configFor(sb, {
      cli: { executable: genuine.launcher, expectedSha512: sha512(genuine.launcher) },
      readback: {
        dir: sb.readbackDir,
        maxCiphertextBytes: 1_000_000,
        maxManifestBytes: 65_536,
        maxSidecarBytes: 4096,
        containment: 'rlimit_fsize',
        rlimitWrapper: { executable: REAL_PRLIMIT, expectedSha512: sha512(REAL_PRLIMIT) },
      },
    })
    const session = production.establishReadbackSession({
      config,
      artifactBase: BASE,
      attemptId: ATTEMPT_ID,
      sourceEvidence: triple.sourceEvidence,
    })
    assert.equal((await production.proveReadbackCapacity({ session })).ok, true)
    assert.equal((await production.setupAttemptWorkspace({ session })).ok, true)

    const other = buildTriple({ ciphertext: Buffer.alloc(500, 1) })
    const result = await production.readBackAttemptTriple({
      session,
      cli: { executable: evil.launcher, expectedSha512: sha512(evil.launcher) },
      credentials: { backend: 'evil-store' },
      timeouts: { operationTimeoutMs: 1, cancelGraceMs: 1 }, // would time every call out
      remotePaths: { manifest: '/proton/evil/m', checksum: '/proton/evil/c', ciphertext: '/x/y' },
      sourceEvidence: other.sourceEvidence, // would reject every role
      wrapper: { executable: evil.launcher, expectedSha512: sha512(evil.launcher) },
    })

    assert.equal(result.overallVerdict, null, `unexpected ${result.overallCode}`)
    assert.equal(result.completion.ok, true)
    assert.equal(fs.existsSync(path.join(evil.control, 'argv.log')), false) // evil never ran
    const argv = fs
      .readFileSync(path.join(genuine.control, 'argv.log'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    assert.equal(argv.length, 6)
    // `filesystem info <remote> --json` / `filesystem download --json <remote> <dir>`
    const remotes = argv.map((a) => (a[1] === 'info' ? a[2] : a[3]))
    assert.deepEqual(
      argv.map((a) => a[1]),
      ['info', 'download', 'info', 'download', 'info', 'download'],
    )
    const canonical = {
      manifest: `${NAMESPACE}/${triple.names.manifest}`,
      checksum: `${NAMESPACE}/${triple.names.checksum}`,
      ciphertext: `${NAMESPACE}/${triple.names.ciphertext}`,
    }
    assert.deepEqual(remotes, [
      canonical.manifest,
      canonical.manifest,
      canonical.checksum,
      canonical.checksum,
      canonical.ciphertext,
      canonical.ciphertext,
    ])
    const envObs = JSON.parse(
      fs.readFileSync(path.join(genuine.control, 'env-observations.json'), 'utf8'),
    )
    assert.deepEqual(envObs.envKeyEquality, { PROTON_DRIVE_CREDENTIALS_STORE: true })
    assert.equal((await production.cleanupAttemptWorkspace({ session })).state, 'complete')
  },
)

test('a readback session runs readback at most once', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  publish(cloud, buildTriple())
  const runner = makeRunner(cloud)
  const session = await readySession(sb, runner)
  await runner.readBackAttemptTriple({ session })
  await assert.rejects(
    () => runner.readBackAttemptTriple({ session }),
    (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
  )
})

test('a readback.dir identity change before readback stops at the first role, indeterminate, with no provider call', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  publish(cloud, buildTriple())
  let swapped = false
  const runner = makeRunner(cloud, {
    lstat: (p) => {
      const st = REAL_READBACK_DEPS.lstat(p)
      return swapped && p === sb.readbackDir
        ? Object.create(st, { ino: { value: st.ino + 1n } })
        : st
    },
  })
  const session = await readySession(sb, runner)
  swapped = true
  const result = await runner.readBackAttemptTriple({ session })
  assert.equal(result.stoppedAtRole, 'manifest')
  assert.equal(result.overallCode, 'readback_dir_identity_changed')
  assert.equal(result.overallVerdict, 'indeterminate')
  assert.equal(cloud.log.length, 0)
})

test('a THROWING completion adapter is completion_adapter_internal_contradiction, never an escaping exception', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  publish(cloud, buildTriple())
  const runner = makeRunner(cloud, {
    verifyCompletion: () => {
      throw new Error('adapter exploded /private/detail')
    },
  })
  const session = await readySession(sb, runner)
  const result = await runner.readBackAttemptTriple({ session })
  assert.deepEqual({ ...result.completion }, { checked: true, ok: false })
  assert.equal(result.overallCode, 'completion_adapter_internal_contradiction')
  assert.equal(result.overallVerdict, 'indeterminate')
})

// ── partial workspace creation: tracked immediately, cleaned exactly ────────

const WS = (sb) => path.join(sb.readbackDir, `${BASE}.${ATTEMPT_ID}`)

/** Every path beneath readback.dir, sorted — the complete residue. */
function residue(sb) {
  const out = []
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      out.push(r)
      if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), r)
    }
  }
  walk(sb.readbackDir, '')
  return out.sort()
}

async function setupWith(sb, mkdir) {
  const runner = makeRunner(makeFakeCloud(), { mkdir })
  const session = runner.establishReadbackSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
    sourceEvidence: DEFAULT_EVIDENCE,
  })
  assert.equal((await runner.proveReadbackCapacity({ session })).ok, true)
  const ws = await runner.setupAttemptWorkspace({ session })
  return { runner, session, ws }
}

const realMkdir = (p, mode) => fs.mkdirSync(p, { mode })
const failingMkdirAt = (suffix) => (p, mode) => {
  if (p.endsWith(suffix)) throw Object.assign(new Error('EIO detail'), { code: 'EIO' })
  return realMkdir(p, mode)
}
/** mkdir SUCCEEDS but leaves an object that cannot be authenticated (mode 0755, not 0700). */
const unauthenticatedMkdirAt = (suffix) => (p, mode) => {
  realMkdir(p, mode)
  if (p.endsWith(suffix)) fs.chmodSync(p, 0o755)
}

test('PARTIAL SETUP: a failure after each creation step leaves only exactly-tracked objects, all cleaned', async () => {
  const steps = [
    // [label, mkdir, expected setup code, expected cleanup state, expected residue]
    [
      'workspace mkdir fails',
      failingMkdirAt(`${BASE}.${ATTEMPT_ID}`),
      'workspace_setup_failed',
      'not_started',
      [],
    ],
    ['manifest mkdir fails', failingMkdirAt('/manifest'), 'workspace_setup_failed', 'complete', []],
    ['checksum mkdir fails', failingMkdirAt('/checksum'), 'workspace_setup_failed', 'complete', []],
    [
      'ciphertext mkdir fails',
      failingMkdirAt('/ciphertext'),
      'workspace_setup_failed',
      'complete',
      [],
    ],
  ]
  for (const [label, mkdir, code, cleanupState, expectedResidue] of steps) {
    const sb = sandbox()
    const { runner, session, ws } = await setupWith(sb, mkdir)
    assert.equal(ws.ok, false, label)
    assert.equal(ws.code, code, label)
    const c = await runner.cleanupAttemptWorkspace({ session })
    assert.equal(c.state, cleanupState, label)
    assert.deepEqual(residue(sb), expectedResidue, label)
  }
})

test('PARTIAL SETUP: an object created but NOT authenticated is never deleted; everything authenticated is', async () => {
  const cases = [
    // workspace itself unauthenticated -> nothing is trusted, nothing removed
    [`${BASE}.${ATTEMPT_ID}`, [`${BASE}.${ATTEMPT_ID}`]],
    // manifest unauthenticated -> workspace cannot be emptied, both stay
    ['/manifest', [`${BASE}.${ATTEMPT_ID}`, `${BASE}.${ATTEMPT_ID}/manifest`]],
    // checksum unauthenticated -> the authenticated manifest dir IS removed
    ['/checksum', [`${BASE}.${ATTEMPT_ID}`, `${BASE}.${ATTEMPT_ID}/checksum`]],
    // ciphertext unauthenticated -> manifest and checksum removed, ciphertext kept
    ['/ciphertext', [`${BASE}.${ATTEMPT_ID}`, `${BASE}.${ATTEMPT_ID}/ciphertext`]],
  ]
  for (const [suffix, expectedResidue] of cases) {
    const sb = sandbox()
    const { runner, session, ws } = await setupWith(sb, unauthenticatedMkdirAt(suffix))
    assert.equal(ws.ok, false, suffix)
    assert.equal(ws.code, 'workspace_setup_failed', suffix)
    const c = await runner.cleanupAttemptWorkspace({ session })
    assert.equal(c.state, 'incomplete', suffix)
    assert.deepEqual(residue(sb), expectedResidue, suffix)
  }
})

test('PARTIAL SETUP: a REPLACEMENT of an authenticated object is never removed', async () => {
  const sb = sandbox()
  const { runner, session, ws } = await setupWith(sb, failingMkdirAt('/ciphertext'))
  assert.equal(ws.ok, false)
  // Replace the authenticated checksum directory with a different directory.
  const checksumDir = path.join(WS(sb), 'checksum')
  fs.renameSync(checksumDir, path.join(sb.dir, 'moved-away'))
  fs.mkdirSync(checksumDir, { mode: 0o700 })
  fs.writeFileSync(path.join(checksumDir, 'foreign'), 'x')

  const c = await runner.cleanupAttemptWorkspace({ session })
  assert.equal(c.state, 'incomplete')
  assert.deepEqual(residue(sb), [
    `${BASE}.${ATTEMPT_ID}`,
    `${BASE}.${ATTEMPT_ID}/checksum`,
    `${BASE}.${ATTEMPT_ID}/checksum/foreign`,
  ])
  assert.equal(fs.existsSync(path.join(sb.dir, 'moved-away')), true) // never followed or touched
})

// ── cleanup revalidates the COMPLETE captured identity before unlink ────────

test('cleanup refuses to unlink a downloaded file whose mode, size, or type changed after measurement', async () => {
  const cases = [
    ['mode', (p) => fs.chmodSync(p, 0o640)],
    ['size', (p) => fs.appendFileSync(p, 'x')],
    [
      'symlink',
      (p) => {
        const target = `${p}.target`
        fs.renameSync(p, target)
        fs.symlinkSync(target, p)
      },
    ],
  ]
  for (const [label, change] of cases) {
    const sb = sandbox()
    const cloud = makeFakeCloud()
    const triple = buildTriple()
    publish(cloud, triple)
    const runner = makeRunner(cloud)
    const session = await readySession(sb, runner, { sourceEvidence: triple.sourceEvidence })
    await runner.readBackAttemptTriple({ session })
    const manifestFile = path.join(WS(sb), 'manifest', triple.names.manifest)
    change(manifestFile)

    const c = await runner.cleanupAttemptWorkspace({ session })
    assert.equal(c.state, 'incomplete', label)
    assert.doesNotThrow(() => fs.lstatSync(manifestFile), label) // left in place
    // The other two roles' exact files and directories were removed.
    assert.equal(fs.existsSync(path.join(WS(sb), 'checksum')), false, label)
    assert.equal(fs.existsSync(path.join(WS(sb), 'ciphertext')), false, label)
  }
})

// ── closed export surface / static absence ──────────────────────────────────

test('production API: the closed export surface', () => {
  assert.deepEqual(Object.keys(production).sort(), [
    'CLOUD_READBACK_CODES',
    'cleanupAttemptWorkspace',
    'establishReadbackSession',
    'proveReadbackCapacity',
    'readBackAttemptTriple',
    'setupAttemptWorkspace',
  ])
})

test('static: the readback core never constructs a recursive removal, a directory listing, or an import of the producer/acceptor/makeRealDeps', () => {
  const src = fs.readFileSync(
    new URL('./internal/backup-cloud-readback-core.mjs', import.meta.url),
    'utf8',
  )
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const forbidden of [
    /\brecursive:\s*true/,
    /\breaddirSync\b/,
    /\breaddir\b/,
    /backup-producer\.mjs/,
    /backup-acceptance\.mjs/,
    /\bmakeRealDeps\b/,
    /\brmSync\b/,
  ]) {
    assert.equal(forbidden.test(code), false, `forbidden construct ${forbidden}`)
  }
})
