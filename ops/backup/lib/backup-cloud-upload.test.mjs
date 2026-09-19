/**
 * Single-attempt upload orchestration — E3J5 (T10, T11/T12 E3J5 halves, T19, T20).
 *
 * Two kinds of test live here:
 *
 *   - ORCHESTRATION tests build the attempt from the internal core's
 *     `makeUploadAttemptRunner()`, with the real read-only local
 *     dependencies over a real temporary artifact triple, and the three
 *     cloud operations replaced by `testdoubles/fake-cloud-operations.mjs`
 *     (in memory, nothing spawned). Every one of them goes through
 *     `attempt()`, which asserts the closed outcome shape, the T19 operation
 *     surface, the T20 write-target scope, and byte-identical source files.
 *   - PRODUCTION-ROUTE tests call the real `runUploadAttempt()` export, which
 *     drives the real E3J4 boundary and really spawns
 *     `testdoubles/fake-proton-drive.mjs` through a per-sandbox launcher.
 *
 * Nothing here runs the real Proton Drive CLI, contacts a provider, or reads
 * a credential. What a fake proves, and what it cannot, is stated in
 * `docs/planning/proton-drive-cloud-transport-architecture.md` §11.2.
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
} from './backup-artifact-contract.mjs'
import {
  CLOUD_CLI_ERROR_CODES,
  runCreateFolder as cliRunCreateFolder,
  runInfo as cliRunInfo,
  runUpload as cliRunUpload,
} from './backup-cloud-cli.mjs'
import * as production from './backup-cloud-upload.mjs'
import {
  CLOUD_ATTEMPT_BOUNDARY_CODES,
  CLOUD_ATTEMPT_CODES_BY_STAGE,
} from './backup-cloud-attestation-records.mjs'
import {
  CLOUD_UPLOAD_BOUNDARY_RESULTS,
  CLOUD_UPLOAD_NAMESPACE_STATES,
  CLOUD_UPLOAD_OUTCOME_CODES,
  CLOUD_UPLOAD_STATUSES,
  CLOUD_UPLOAD_STEPS,
  CLOUD_UPLOAD_TRANSFER_STATES,
  E3J4_PRE_SPAWN_CODES,
  REAL_UPLOAD_DEPS,
  makeUploadAttemptRunner,
} from './internal/backup-cloud-upload-core.mjs'
import {
  FAKE_ROOT_UID,
  createdResult,
  indeterminateResult,
  infoAbsent,
  infoPresent,
  makeFakeCloud,
  rejectedResult,
} from './testdoubles/fake-cloud-operations.mjs'

import { REAL_EVIDENCE_READER } from './internal/backup-cloud-source-evidence.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-upload', warnAfterMs: 6_000, intervalMs: 4_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOUBLE = path.join(HERE, 'testdoubles', 'fake-proton-drive.mjs')

const ROOT = '/proton/eanhl-backups'
const BASE = 'eanhl-test-20260904T180007Z'
const FIXED_NOW = Date.parse('2026-09-16T12:34:56.789Z')
const TOKEN = 'deadbeef'
const ATTEMPT_ID = `20260916T123456Z-${TOKEN}`
const FOLDER = `${BASE}.${ATTEMPT_ID}`
const NAMESPACE = `${ROOT}/${FOLDER}`
const ROLES = ['ciphertext', 'checksum', 'manifest']
const SUFFIX = { ciphertext: '.dump.age', checksum: '.dump.age.sha256', manifest: '.manifest.json' }
const OBJECT = Object.fromEntries(ROLES.map((r) => [r, `${NAMESPACE}/${BASE}${SUFFIX[r]}`]))
const HASH_A = '0123456789abcdef'.repeat(8)
const MARKER = 'SECRET-MARKER-e3j5-7f3a'
const SOURCE_RUN_ID = '20260904T180001Z-0a1b2c3d'
const SNAPSHOT_TS = '2026-09-04T18:00:07Z'
const HASH_B = 'fedcba9876543210'.repeat(8)

const OUTCOME_KEYS = [
  'artifact',
  'attempt',
  'boundaryCalls',
  'code',
  'failedStep',
  'furthestUploadSuccessReportedRole',
  'kind',
  'local',
  'namespaceState',
  'providerBoundaryCallMade',
  'remote',
  'schemaVersion',
  'sourceEvidence',
  'status',
  'transferState',
  'verification',
  'writeBoundaryCallMade',
]
const CALL_KEYS = [
  'boundaryCode',
  'boundaryResult',
  'operation',
  'remotePath',
  'reportedFinding',
  'step',
]

// ── sandboxes ───────────────────────────────────────────────────────────────

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

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * A sandbox with a real, VALID published triple in `<dir>/artifacts`. The
 * three files have distinct, non-zero sizes.
 */
function sandbox({ ciphertext = Buffer.alloc(1000, 7), manifestExtra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cloud-upload-'))
  sandboxes.push(dir)
  const artifacts = path.join(dir, 'artifacts')
  fs.mkdirSync(artifacts)
  const files = Object.fromEntries(
    ROLES.map((r) => [r, path.join(artifacts, `${BASE}${SUFFIX[r]}`)]),
  )
  const hash = sha256(ciphertext)
  fs.writeFileSync(files.ciphertext, ciphertext)
  fs.writeFileSync(files.checksum, formatChecksumSidecar(hash, `${BASE}.dump.age`))
  fs.writeFileSync(
    files.manifest,
    JSON.stringify({
      schema_version: MANIFEST_SCHEMA_VERSION,
      artifact: `${BASE}.dump.age`,
      // E3J6A: prepare validates these identity fields from the captured bytes.
      run_id: SOURCE_RUN_ID,
      snapshot_ts: SNAPSHOT_TS,
      ciphertext: { sha256: hash, bytes: ciphertext.length },
      ...manifestExtra,
    }),
  )
  return { dir, artifacts, files }
}

function configFor(sb, overrides = {}) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: HASH_A },
    credentials: { backend: 'pass' },
    remote: { root: ROOT },
    artifact: { sourceDir: sb.artifacts },
    attestation: { dir: path.join(sb.dir, 'attest') },
    readback: {
      dir: path.join(sb.dir, 'readback'),
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: { executable: '/usr/bin/prlimit', expectedSha512: HASH_B },
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

function makeRunner(cloud, deps = {}) {
  return makeUploadAttemptRunner({
    ...REAL_UPLOAD_DEPS,
    now: () => FIXED_NOW,
    randomToken: () => TOKEN,
    cloud: cloud.ops,
    ...deps,
  })
}

const snapshot = (sb) => Object.fromEntries(ROLES.map((r) => [r, readIfFile(sb.files[r])]))
function readIfFile(p) {
  try {
    return fs.lstatSync(p).isFile() ? sha256(fs.readFileSync(p)) : 'not-a-file'
  } catch {
    return 'absent'
  }
}

// ── the closed-shape, T19 and T20 checks every orchestration test gets ──────

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function assertDeepFrozen(value, where = 'outcome') {
  if (value === null || typeof value !== 'object') return
  assert.ok(Object.isFrozen(value), `${where} must be frozen`)
  for (const [k, v] of Object.entries(value)) assertDeepFrozen(v, `${where}.${k}`)
}

function assertOutcomeShape(o, sb) {
  assert.deepEqual(Object.keys(o).sort(), OUTCOME_KEYS)
  assertDeepFrozen(o)
  assert.equal(o.kind, 'eanhl.cloud-upload-attempt-outcome')
  assert.equal(o.schemaVersion, 2) // E3J6A: v2 adds sourceEvidence
  assert.equal(o.verification, 'not_performed')
  assert.ok(CLOUD_UPLOAD_STATUSES.includes(o.status))
  assert.ok(CLOUD_UPLOAD_TRANSFER_STATES.includes(o.transferState))
  assert.ok(CLOUD_UPLOAD_NAMESPACE_STATES.includes(o.namespaceState))
  assert.equal(typeof o.providerBoundaryCallMade, 'boolean')
  assert.equal(typeof o.writeBoundaryCallMade, 'boolean')
  if (o.status === 'upload_success_reported_pending_readback') {
    assert.equal(o.code, null)
    assert.equal(o.failedStep, null)
  } else {
    assert.ok(CLOUD_UPLOAD_OUTCOME_CODES.includes(o.code), `closed code: ${o.code}`)
    assert.ok(CLOUD_UPLOAD_STEPS.includes(o.failedStep))
  }
  assert.ok([null, ...ROLES].includes(o.furthestUploadSuccessReportedRole))
  // Never a verdict, never "verified".
  assert.equal('verdict' in o, false)
  assert.equal(JSON.stringify(o).includes('"verified"'), false)
  // Exact nested key sets and locally constructed values only.
  assert.deepEqual(Object.keys(o.attempt).sort(), ['attemptId', 'finishedAt', 'startedAt'])
  assert.match(o.attempt.startedAt, ISO)
  assert.ok(o.attempt.finishedAt === null || ISO.test(o.attempt.finishedAt))
  assert.deepEqual(o.artifact, {
    base: BASE,
    ciphertext: `${BASE}.dump.age`,
    checksum: `${BASE}.dump.age.sha256`,
    manifest: `${BASE}.manifest.json`,
  })
  assert.deepEqual(Object.keys(o.local).sort(), ['checksum', 'ciphertext', 'manifest', 'sourceDir'])
  for (const role of ROLES) {
    assert.deepEqual(Object.keys(o.local[role]).sort(), ['expectedBytes', 'path'])
    if (sb) assert.equal(o.local[role].path, sb.files[role])
    const b = o.local[role].expectedBytes
    assert.ok(b === null || (Number.isSafeInteger(b) && b > 0))
  }
  const folder = `${BASE}.${o.attempt.attemptId}`
  assert.deepEqual(o.remote, {
    root: ROOT,
    attemptFolderName: folder,
    namespace: `${ROOT}/${folder}`,
    ciphertextPath: `${ROOT}/${folder}/${BASE}.dump.age`,
    checksumPath: `${ROOT}/${folder}/${BASE}.dump.age.sha256`,
    manifestPath: `${ROOT}/${folder}/${BASE}.manifest.json`,
  })
  // E3J6A: evidence is all-or-nothing, and present exactly when the local
  // triple passed (which is exactly when expectedBytes were recorded).
  const hasBytes = ROLES.every((r) => o.local[r].expectedBytes !== null)
  assert.equal(o.sourceEvidence !== null, hasBytes)
  if (o.status === 'upload_success_reported_pending_readback') assert.ok(o.sourceEvidence)
  if (o.sourceEvidence !== null) {
    assert.deepEqual(Object.keys(o.sourceEvidence).sort(), [
      'checksum',
      'ciphertext',
      'manifest',
      'runId',
      'snapshotTs',
    ])
    for (const role of ROLES) {
      assert.deepEqual(Object.keys(o.sourceEvidence[role]).sort(), ['bytes', 'sha256'])
      assert.match(o.sourceEvidence[role].sha256, /^[0-9a-f]{64}$/)
      assert.equal(o.sourceEvidence[role].bytes, o.local[role].expectedBytes)
      if (sb) assert.equal(o.sourceEvidence[role].sha256, sha256(fs.readFileSync(sb.files[role])))
    }
  }
  assert.ok(Array.isArray(o.boundaryCalls))
  for (const c of o.boundaryCalls) {
    assert.deepEqual(Object.keys(c).sort(), CALL_KEYS)
    assert.ok(CLOUD_UPLOAD_STEPS.includes(c.step))
    assert.ok(['info', 'create-folder', 'upload'].includes(c.operation))
    assert.ok(CLOUD_UPLOAD_BOUNDARY_RESULTS.includes(c.boundaryResult))
    assert.ok(
      c.boundaryCode === null ||
        CLOUD_CLI_ERROR_CODES.includes(c.boundaryCode) ||
        E3J4_PRE_SPAWN_CODES.includes(c.boundaryCode),
    )
    assert.ok([null, 'absent', 'present'].includes(c.reportedFinding))
    assert.ok(
      [ROOT, o.remote.namespace, ...ROLES.map((r) => o.remote[`${r}Path`])].includes(c.remotePath),
    )
  }
  assert.equal(o.providerBoundaryCallMade, o.boundaryCalls.length > 0)
  assert.equal(
    o.writeBoundaryCallMade,
    o.boundaryCalls.some((c) => c.operation !== 'info'),
  )
  assert.equal(JSON.stringify(o).includes(MARKER), false, 'no injected marker may survive')
}

/** T19 + T20 over one attempt's fake request log. */
function assertRequestScope(cloud, o, sb) {
  const locals = sb ? ROLES.map((r) => sb.files[r]) : []
  for (const entry of cloud.log) {
    assert.ok(['info', 'create-folder', 'upload'].includes(entry.operation), 'T19 surface')
    if (entry.operation === 'create-folder') {
      assert.equal(entry.parentPath, ROOT, 'T20: the only root-level write')
      assert.equal(entry.name, o.remote.attemptFolderName)
    }
    if (entry.operation === 'upload') {
      assert.equal(
        entry.remoteParentPath,
        o.remote.namespace,
        'T20: uploads only into the namespace',
      )
      if (sb) assert.ok(locals.includes(entry.localFilePath))
    }
  }
  assert.equal(cloud.log.length, o.boundaryCalls.length)
}

async function attempt({ sb = sandbox(), cloud = makeFakeCloud(), deps = {}, args = {} } = {}) {
  const before = snapshot(sb)
  const outcome = await makeRunner(cloud, deps).runUploadAttempt({
    config: configFor(sb),
    artifactBase: BASE,
    ...args,
  })
  assertOutcomeShape(outcome, sb)
  assertRequestScope(cloud, outcome, sb)
  assert.deepEqual(snapshot(sb), before, 'T19: source files are untouched')
  return { outcome, cloud, sb }
}

const ops = (cloud) => cloud.log.map((e) => e.operation)
const uploads = (cloud) => cloud.log.filter((e) => e.operation === 'upload')
const uploadedRoles = (cloud, sb) =>
  uploads(cloud).map((e) => ROLES.find((r) => sb.files[r] === e.localFilePath))

/** respond() helper: override the call whose (operation, path) matches. */
function on(match, result) {
  return (call) => {
    const p = call.params
    const target =
      call.operation === 'info'
        ? p.remotePath
        : call.operation === 'create-folder'
          ? `${p.parentPath}/${p.name}`
          : `${p.remoteParentPath}/${path.posix.basename(p.localFilePath)}`
    if (call.operation === match.operation && (match.path === undefined || match.path === target)) {
      return typeof result === 'function' ? result(call) : result
    }
    return undefined
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Happy path, order, sizes, identity (T10, T11 shape)
// ═════════════════════════════════════════════════════════════════════════════

test('T10: the happy path requests exactly root → namespace → create → confirm → 3 preflights → 3 uploads', async () => {
  const { outcome, cloud, sb } = await attempt()
  assert.deepEqual(
    cloud.log.map((e) => [
      e.operation,
      e.remotePath ?? e.name ?? path.posix.basename(e.localFilePath),
    ]),
    [
      ['info', ROOT],
      ['info', NAMESPACE],
      ['create-folder', FOLDER],
      ['info', NAMESPACE],
      ['info', OBJECT.ciphertext],
      ['info', OBJECT.checksum],
      ['info', OBJECT.manifest],
      ['upload', `${BASE}.dump.age`],
      ['upload', `${BASE}.dump.age.sha256`],
      ['upload', `${BASE}.manifest.json`],
    ],
  )
  assert.deepEqual(uploadedRoles(cloud, sb), ROLES)
  assert.deepEqual(
    outcome.boundaryCalls.map((c) => c.step),
    CLOUD_UPLOAD_STEPS.filter((s) => s !== 'local_validation'),
  )
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
  assert.equal(outcome.code, null)
  assert.equal(outcome.failedStep, null)
  assert.equal(outcome.namespaceState, 'active_folder_confirmed')
  assert.equal(outcome.furthestUploadSuccessReportedRole, 'manifest')
  assert.equal(outcome.providerBoundaryCallMade, true)
  assert.equal(outcome.writeBoundaryCallMade, true)
  assert.equal(outcome.remote.namespace, NAMESPACE)
  // Every upload request carries the signal-free boundary options the config names.
  for (const e of cloud.log) assert.equal(e.hadSignal, false)
})

test('T11 (E3J5 half): all three boundary-reported successes are still transferState unknown and not verified', async () => {
  const { outcome } = await attempt()
  assert.equal(outcome.transferState, 'unknown')
  assert.equal(outcome.verification, 'not_performed')
  assert.equal('verdict' in outcome, false)
})

test('sizes: three real, distinct, valid artifact sizes are each passed to the matching upload', async () => {
  const sb = sandbox({ ciphertext: Buffer.alloc(4321, 1) })
  const { outcome, cloud } = await attempt({ sb })
  const actual = Object.fromEntries(ROLES.map((r) => [r, fs.statSync(sb.files[r]).size]))
  assert.equal(new Set(Object.values(actual)).size, 3, 'premise: three distinct sizes')
  for (const role of ROLES) assert.ok(actual[role] > 0)
  const byRole = Object.fromEntries(
    uploads(cloud).map((e) => [
      ROLES.find((r) => sb.files[r] === e.localFilePath),
      e.expectedLocalSizeBytes,
    ]),
  )
  assert.deepEqual(byRole, actual)
  for (const role of ROLES) assert.equal(outcome.local[role].expectedBytes, actual[role])
})

test('identity: one clock reading produces both the attemptId stamp and startedAt', async () => {
  let clockCalls = 0
  const tokenCalls = []
  const readings = [Date.parse('2026-09-16T01:02:03.456Z'), Date.parse('2026-09-16T09:09:09.000Z')]
  const { outcome } = await attempt({
    deps: {
      now: () => readings[Math.min(clockCalls++, readings.length - 1)],
      randomToken: (n) => {
        tokenCalls.push(n)
        return 'cafef00d'
      },
    },
  })
  assert.equal(outcome.attempt.attemptId, '20260916T010203Z-cafef00d')
  assert.equal(outcome.attempt.startedAt, '2026-09-16T01:02:03.456Z')
  assert.equal(outcome.attempt.finishedAt, '2026-09-16T09:09:09.000Z')
  assert.equal(clockCalls, 2, 'one reading at start, one at finish')
  assert.deepEqual(tokenCalls, [4])
})

test('identity: a clock that fails at finish still yields an outcome, with finishedAt null', async () => {
  let calls = 0
  const { outcome } = await attempt({
    deps: {
      now: () => {
        calls += 1
        if (calls === 1) return FIXED_NOW
        throw new Error(MARKER)
      },
    },
  })
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
  assert.equal(outcome.attempt.finishedAt, null)
})

// ═════════════════════════════════════════════════════════════════════════════
// T10: stop after the first upload failure, at every position
// ═════════════════════════════════════════════════════════════════════════════

const UPLOAD_FAILURES = [
  {
    label: 'anchored rejection (name_conflict)',
    act: () => rejectedResult('upload', 'name_conflict'),
    result: 'rejected',
    boundaryCode: 'name_conflict',
    code: 'provider_rejected',
    status: 'rejected',
    definiteZero: true,
  },
  {
    label: 'indeterminate provider error',
    act: () => indeterminateResult('upload', 'provider_error_unrecognised'),
    result: 'indeterminate',
    boundaryCode: 'provider_error_unrecognised',
    code: 'provider_indeterminate',
    status: 'indeterminate',
  },
  {
    label: 'upload_size_mismatch',
    act: () => indeterminateResult('upload', 'upload_size_mismatch'),
    result: 'indeterminate',
    boundaryCode: 'upload_size_mismatch',
    code: 'provider_indeterminate',
    status: 'indeterminate',
  },
  {
    label: 'a pre-spawn E3J4 refusal (thrown cli_hash_mismatch)',
    act: () => {
      throw new BackupError('cli_hash_mismatch', 'x')
    },
    result: 'refused_before_spawn',
    boundaryCode: 'cli_hash_mismatch',
    code: 'provider_refused_before_spawn',
    status: 'rejected',
    definiteZero: true,
  },
  {
    label: 'an unrecognised throw',
    act: () => {
      throw new Error(`boom ${MARKER}`)
    },
    result: 'failed',
    boundaryCode: null,
    code: 'provider_call_failed',
    status: 'indeterminate',
  },
  {
    label: 'a BackupError with a post-spawn-possible code',
    act: () => {
      throw new BackupError('something_else', MARKER)
    },
    result: 'failed',
    boundaryCode: null,
    code: 'provider_call_failed',
    status: 'indeterminate',
  },
  {
    label: 'a malformed boundary result',
    act: () => Object.freeze({ kind: 'success', transferredItems: 1 }), // no `operation`
    result: 'failed',
    boundaryCode: null,
    code: 'provider_call_failed',
    status: 'indeterminate',
  },
  {
    label: 'a rejected result carrying an out-of-enum code',
    act: () =>
      Object.freeze({
        kind: 'rejected',
        operation: 'upload',
        code: MARKER,
        transferState: 'definitely_zero',
      }),
    result: 'failed',
    boundaryCode: null,
    code: 'provider_call_failed',
    status: 'indeterminate',
  },
]

for (const failure of UPLOAD_FAILURES) {
  test(`T10: ${failure.label} at each upload position stops every later upload`, async () => {
    for (const [n, role] of ROLES.entries()) {
      const sb = sandbox()
      const cloud = makeFakeCloud({
        respond: on({ operation: 'upload', path: OBJECT[role] }, failure.act),
      })
      const { outcome } = await attempt({ sb, cloud })
      // Uploads requested: exactly roles 0..n, in order — nothing after the failure.
      assert.deepEqual(uploadedRoles(cloud, sb), ROLES.slice(0, n + 1), `${role}`)
      assert.equal(ops(cloud).at(-1), 'upload', 'the failed upload is the last request')
      if (role !== 'manifest') {
        assert.equal(uploadedRoles(cloud, sb).includes('manifest'), false, 'no manifest upload')
      } else {
        // A manifest failure necessarily means the manifest upload WAS requested — once, last.
        assert.equal(uploadedRoles(cloud, sb).filter((r) => r === 'manifest').length, 1)
      }
      const last = outcome.boundaryCalls.at(-1)
      assert.equal(last.step, `upload_${role}`)
      assert.equal(last.boundaryResult, failure.result)
      assert.equal(last.boundaryCode, failure.boundaryCode)
      assert.equal(outcome.code, failure.code)
      assert.equal(outcome.status, failure.status)
      assert.equal(outcome.failedStep, `upload_${role}`)
      assert.equal(outcome.furthestUploadSuccessReportedRole, n === 0 ? null : ROLES[n - 1])
      assert.equal(
        outcome.transferState,
        n === 0 && failure.definiteZero ? 'definitely_zero' : 'unknown',
      )
      assert.equal(outcome.namespaceState, 'active_folder_confirmed')
      assert.equal(outcome.writeBoundaryCallMade, true)
    }
  })
}

test('T11 (E3J5 half): ciphertext reported, sidecar failed — non-verified outcome naming all intended paths, no deletion', async () => {
  const cloud = makeFakeCloud({
    respond: on(
      { operation: 'upload', path: OBJECT.checksum },
      indeterminateResult('upload', 'provider_error_unrecognised'),
    ),
  })
  const { outcome } = await attempt({ cloud })
  assert.equal(outcome.status, 'indeterminate')
  assert.equal(outcome.furthestUploadSuccessReportedRole, 'ciphertext')
  assert.equal(outcome.transferState, 'unknown')
  assert.equal(outcome.remote.ciphertextPath, OBJECT.ciphertext)
  assert.equal(outcome.remote.checksumPath, OBJECT.checksum)
  assert.equal(outcome.remote.manifestPath, OBJECT.manifest)
  // The fake's tree still holds what the attempt put there — nothing was removed.
  assert.ok(cloud.tree.has(NAMESPACE))
  assert.ok(cloud.tree.has(OBJECT.ciphertext))
})

test('race: an object appearing after its preflight fails closed at the upload boundary', async () => {
  let fake
  fake = makeFakeCloud({
    respond: (call) => {
      if (call.operation === 'upload' && call.params.localFilePath.endsWith('.dump.age.sha256')) {
        fake.tree.set(OBJECT.checksum, { nodeKind: 'file', state: 'active', nodeUid: 'intruder' })
      }
      return undefined // default model: the now-present target → name_conflict
    },
  })
  const { outcome } = await attempt({ cloud: fake })
  assert.equal(outcome.code, 'provider_rejected')
  assert.equal(outcome.boundaryCalls.at(-1).boundaryCode, 'name_conflict')
  assert.equal(outcome.failedStep, 'upload_checksum')
  assert.equal(outcome.transferState, 'unknown', 'ciphertext was already reported uploaded')
})

// ═════════════════════════════════════════════════════════════════════════════
// T12: timeout and cancellation stay indeterminate, never claim the remote stopped
// ═════════════════════════════════════════════════════════════════════════════

test('T12: an already-aborted signal makes no boundary call at all', async () => {
  const controller = new AbortController()
  controller.abort()
  const { outcome, cloud } = await attempt({ args: { signal: controller.signal } })
  assert.equal(cloud.log.length, 0)
  assert.equal(outcome.status, 'indeterminate')
  assert.equal(outcome.code, 'attempt_cancelled')
  assert.equal(outcome.failedStep, 'local_validation')
  assert.equal(outcome.transferState, 'definitely_zero')
  assert.equal(outcome.namespaceState, 'no_namespace_write_evidence')
  assert.equal(outcome.providerBoundaryCallMade, false)
  for (const role of ROLES) assert.equal(outcome.local[role].expectedBytes, null)
})

test('T12: cancellation during an in-flight upload is indeterminate/unknown and requests nothing more', async () => {
  const controller = new AbortController()
  const cloud = makeFakeCloud({
    respond: on({ operation: 'upload', path: OBJECT.checksum }, async (call) => {
      assert.equal(call.params.signal, controller.signal, 'the attempt signal reaches the boundary')
      controller.abort()
      return indeterminateResult('upload', 'provider_cancelled')
    }),
  })
  const { outcome, sb } = await attempt({ cloud, args: { signal: controller.signal } })
  assert.deepEqual(uploadedRoles(cloud, sb), ['ciphertext', 'checksum'])
  assert.equal(outcome.status, 'indeterminate')
  assert.equal(outcome.code, 'provider_indeterminate')
  assert.equal(outcome.boundaryCalls.at(-1).boundaryCode, 'provider_cancelled')
  assert.equal(outcome.transferState, 'unknown')
  assert.equal(outcome.furthestUploadSuccessReportedRole, 'ciphertext')
})

test('T12: cancellation observed between steps stops before the next request', async () => {
  // (a) after the create call, before confirmation: namespace evidence is unknown.
  const c1 = new AbortController()
  const cloud1 = makeFakeCloud({
    respond: (call) => {
      if (call.operation === 'create-folder') c1.abort()
      return undefined
    },
  })
  const r1 = await attempt({ cloud: cloud1, args: { signal: c1.signal } })
  assert.deepEqual(ops(cloud1), ['info', 'info', 'create-folder'])
  assert.equal(r1.outcome.code, 'attempt_cancelled')
  assert.equal(r1.outcome.failedStep, 'confirm_namespace')
  assert.equal(r1.outcome.namespaceState, 'unknown')
  assert.equal(r1.outcome.transferState, 'definitely_zero', 'no upload call was made')

  // (b) after a reported ciphertext success: transfer is unknown.
  const c2 = new AbortController()
  const cloud2 = makeFakeCloud({
    respond: (call) => {
      if (call.operation === 'upload') c2.abort()
      return undefined
    },
  })
  const r2 = await attempt({ cloud: cloud2, args: { signal: c2.signal } })
  assert.equal(uploads(cloud2).length, 1)
  assert.equal(r2.outcome.code, 'attempt_cancelled')
  assert.equal(r2.outcome.failedStep, 'upload_checksum')
  assert.equal(r2.outcome.status, 'indeterminate')
  assert.equal(r2.outcome.transferState, 'unknown')
  assert.equal(r2.outcome.furthestUploadSuccessReportedRole, 'ciphertext')
})

test('T12: a timed-out upload is indeterminate/unknown', async () => {
  const cloud = makeFakeCloud({
    respond: on(
      { operation: 'upload', path: OBJECT.ciphertext },
      indeterminateResult('upload', 'provider_timeout'),
    ),
  })
  const { outcome } = await attempt({ cloud })
  assert.equal(outcome.status, 'indeterminate')
  assert.equal(outcome.transferState, 'unknown')
  assert.equal(outcome.boundaryCalls.at(-1).boundaryCode, 'provider_timeout')
  assert.equal(uploads(cloud).length, 1)
})

// ═════════════════════════════════════════════════════════════════════════════
// Local triple — every failure stops before any boundary call
// ═════════════════════════════════════════════════════════════════════════════

async function expectLocalRefusal(sb, code, deps = {}, config) {
  const cloud = makeFakeCloud()
  const before = snapshot(sb)
  const outcome = await makeRunner(cloud, deps).runUploadAttempt({
    config: config ?? configFor(sb),
    artifactBase: BASE,
  })
  assertOutcomeShape(outcome, config ? undefined : sb)
  assert.deepEqual(snapshot(sb), before)
  assert.equal(cloud.log.length, 0, `${code}: no boundary call`)
  assert.equal(outcome.code, code)
  assert.equal(outcome.status, 'rejected')
  assert.equal(outcome.failedStep, 'local_validation')
  assert.equal(outcome.transferState, 'definitely_zero')
  assert.equal(outcome.namespaceState, 'no_namespace_write_evidence')
  assert.equal(outcome.providerBoundaryCallMade, false)
  assert.equal(outcome.writeBoundaryCallMade, false)
  return outcome
}

test('local: a missing role is local_file_missing', async () => {
  for (const role of ROLES) {
    const sb = sandbox()
    fs.rmSync(sb.files[role])
    await expectLocalRefusal(sb, 'local_file_missing')
  }
})

test('local: a symlinked role is local_file_not_regular even when its target is valid', async () => {
  for (const role of ROLES) {
    const sb = sandbox()
    const real = path.join(sb.dir, `real-${role}`)
    fs.renameSync(sb.files[role], real)
    fs.symlinkSync(real, sb.files[role])
    await expectLocalRefusal(sb, 'local_file_not_regular')
  }
})

test('local: a directory at a role path is local_file_not_regular', async () => {
  const sb = sandbox()
  fs.rmSync(sb.files.checksum)
  fs.mkdirSync(sb.files.checksum)
  await expectLocalRefusal(sb, 'local_file_not_regular')
})

test('local: a symlinked or missing sourceDir is source_dir_unusable', async () => {
  const sb = sandbox()
  const link = path.join(sb.dir, 'linked-artifacts')
  fs.symlinkSync(sb.artifacts, link)
  await expectLocalRefusal(
    sb,
    'source_dir_unusable',
    {},
    configFor(sb, { artifact: { sourceDir: link } }),
  )
  const missing = path.join(sb.dir, 'nope')
  await expectLocalRefusal(
    sb,
    'source_dir_unusable',
    {},
    configFor(sb, { artifact: { sourceDir: missing } }),
  )
})

test('local: a zero-byte role fails local validation before any provider activity', async () => {
  // Zero-byte ciphertext with a self-consistent manifest would PASS
  // verifyArtifactCompletion(); the explicit non-empty rule is what refuses it.
  await expectLocalRefusal(sandbox({ ciphertext: Buffer.alloc(0) }), 'local_file_empty')
  for (const role of ['checksum', 'manifest']) {
    const sb = sandbox()
    fs.writeFileSync(sb.files[role], '')
    await expectLocalRefusal(sb, 'local_file_empty')
  }
})

test('local: a corrupt or inconsistent triple is local_triple_incomplete, and its failure text never leaks', async () => {
  const wrongHash = sandbox()
  fs.writeFileSync(
    wrongHash.files.checksum,
    formatChecksumSidecar('0'.repeat(64), `${BASE}.dump.age`),
  )
  await expectLocalRefusal(wrongHash, 'local_triple_incomplete')

  const badJson = sandbox()
  fs.writeFileSync(badJson.files.manifest, `{not json ${MARKER}`)
  await expectLocalRefusal(badJson, 'local_triple_incomplete')

  const wrongSchema = sandbox({ manifestExtra: { schema_version: 999 } })
  await expectLocalRefusal(wrongSchema, 'local_triple_incomplete')

  // The completion checker WILL quote this value in its failure text.
  const marked = sandbox({ manifestExtra: { artifact: MARKER } })
  await expectLocalRefusal(marked, 'local_triple_incomplete')
})

test('local: a throwing completion dependency is local_triple_incomplete, with nothing leaked', async () => {
  const sb = sandbox()
  const throwingFs = {
    ...REAL_UPLOAD_DEPS.completionDeps.fs,
    existsSync: () => {
      throw new Error(MARKER)
    },
  }
  await expectLocalRefusal(sb, 'local_triple_incomplete', {
    completionDeps: { ...REAL_UPLOAD_DEPS.completionDeps, fs: throwingFs },
  })
})

test('local: a manifest byte count that disagrees with the measured ciphertext size is local_triple_changed', async () => {
  // A completion view that is self-consistent at 999 bytes while lstat measured 1000.
  const sb = sandbox({ manifestExtra: {} })
  const manifest = JSON.parse(fs.readFileSync(sb.files.manifest, 'utf8'))
  manifest.ciphertext.bytes = 999
  fs.writeFileSync(sb.files.manifest, JSON.stringify(manifest))
  const lyingFs = {
    ...REAL_UPLOAD_DEPS.completionDeps.fs,
    statSync: (p) => (p === sb.files.ciphertext ? { size: 999 } : fs.statSync(p)),
  }
  await expectLocalRefusal(sb, 'local_triple_changed', {
    completionDeps: { ...REAL_UPLOAD_DEPS.completionDeps, fs: lyingFs },
  })
})

/** An lstat wrapper that rewrites the Nth observation of one path. */
function lstatTampering(target, nth, mutate) {
  let seen = 0
  return (p) => {
    const real = fs.lstatSync(p, { bigint: true })
    if (p !== target) return real
    seen += 1
    return seen === nth ? mutate(real) : real
  }
}
const withIno = (real, ino) => ({
  isFile: () => real.isFile(),
  isDirectory: () => real.isDirectory(),
  dev: real.dev,
  ino,
  size: real.size,
  mtimeNs: real.mtimeNs,
  ctimeNs: real.ctimeNs,
})

test('local: unmeasurable lstat evidence is local_file_unmeasurable', async () => {
  const cases = [
    (real) => ({ ...withIno(real, real.ino), size: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
    (real) => ({ ...withIno(real, real.ino), size: 1000 }), // a Number, not a bigint
    () => ({
      isFile: () => {
        throw new Error(MARKER)
      },
    }),
    () => null,
    () => {
      const err = new Error(MARKER)
      err.code = 'EACCES'
      throw err
    },
  ]
  for (const mutate of cases) {
    const sb = sandbox()
    await expectLocalRefusal(sb, 'local_file_unmeasurable', {
      lstat: lstatTampering(sb.files.ciphertext, 1, mutate),
    })
  }
})

test('local: an identity change between measurement and the post-completion check is local_triple_changed', async () => {
  const sb = sandbox()
  await expectLocalRefusal(sb, 'local_triple_changed', {
    lstat: lstatTampering(sb.files.manifest, 2, (real) => withIno(real, real.ino + 1n)),
  })
})

test('local: an identity change just before an upload stops before that upload is requested', async () => {
  const sb = sandbox()
  // checksum observations: 1 = measure, 2 = post-completion, 3 = pre-upload.
  const { outcome, cloud } = await attempt({
    sb,
    deps: { lstat: lstatTampering(sb.files.checksum, 3, (real) => withIno(real, real.ino + 1n)) },
  })
  assert.deepEqual(uploadedRoles(cloud, sb), ['ciphertext'])
  assert.equal(outcome.code, 'local_triple_changed')
  assert.equal(outcome.status, 'rejected')
  assert.equal(outcome.failedStep, 'upload_checksum')
  assert.equal(outcome.transferState, 'unknown', 'ciphertext was already reported uploaded')
})

test('local: an identity change after a reported upload is local_source_changed (indeterminate) and stops', async () => {
  const sb = sandbox()
  // ciphertext observations: 1 = measure, 2 = post-completion, 3 = pre-upload, 4 = post-upload.
  const { outcome, cloud } = await attempt({
    sb,
    deps: { lstat: lstatTampering(sb.files.ciphertext, 4, (real) => withIno(real, real.ino + 1n)) },
  })
  assert.deepEqual(uploadedRoles(cloud, sb), ['ciphertext'])
  assert.equal(outcome.code, 'local_source_changed')
  assert.equal(outcome.status, 'indeterminate')
  assert.equal(outcome.failedStep, 'upload_ciphertext')
  assert.equal(outcome.furthestUploadSuccessReportedRole, 'ciphertext')
  assert.equal(outcome.transferState, 'unknown')
})

// ═════════════════════════════════════════════════════════════════════════════
// Inputs and identity — thrown before any attempt exists
// ═════════════════════════════════════════════════════════════════════════════

async function expectThrow(run, code, cloud) {
  await assert.rejects(run, (err) => {
    assert.ok(err instanceof BackupError)
    assert.equal(err.code, code)
    assert.equal(err.cause, undefined)
    assert.equal(String(err.message).includes(MARKER), false)
    return true
  })
  assert.equal(cloud.log.length, 0)
}

test('inputs: an unsafe or malformed artifactBase throws a generic error and requests nothing', async () => {
  const sb = sandbox()
  for (const artifactBase of [
    '',
    '..',
    '../x',
    'a/b',
    'not-a-stamped-artifact',
    `${MARKER}-20260904T180007Z`,
    `eanhl-20260904T180007Z/${MARKER}`,
    '-eanhl-20260904T180007Z',
    'EANHL-20260904T180007Z',
    123,
    undefined,
  ]) {
    const cloud = makeFakeCloud()
    await expectThrow(
      () => makeRunner(cloud).runUploadAttempt({ config: configFor(sb), artifactBase }),
      'cloud_upload_invalid_input',
      cloud,
    )
  }
})

test('inputs: an invalid config, a /trash root, a fake signal, or no arguments throw generically', async () => {
  const sb = sandbox()
  const good = configFor(sb)
  const bads = [
    undefined,
    null,
    { ...good, cli: undefined },
    { ...good, artifact: { sourceDir: 'relative/dir' } },
    { ...good, remote: { root: `/x/../${MARKER}` } },
    { ...good, credentials: { backend: 'pass', [`${MARKER}_token`]: 'x' } },
    { ...good, remote: { root: '/trash' } },
    { ...good, remote: { root: '/trash/eanhl' } },
  ]
  for (const config of bads) {
    const cloud = makeFakeCloud()
    await expectThrow(
      () => makeRunner(cloud).runUploadAttempt({ config, artifactBase: BASE }),
      'cloud_upload_invalid_input',
      cloud,
    )
  }
  const cloud = makeFakeCloud()
  await expectThrow(
    () =>
      makeRunner(cloud).runUploadAttempt({
        config: good,
        artifactBase: BASE,
        signal: { aborted: true },
      }),
    'cloud_upload_invalid_input',
    cloud,
  )
  for (const args of [undefined, null, 'x']) {
    await expectThrow(
      () => makeRunner(cloud).runUploadAttempt(args),
      'cloud_upload_invalid_input',
      cloud,
    )
  }
})

test('inputs: an already-validated frozen config is accepted unchanged (re-validation is idempotent)', async () => {
  const { validateCloudConfig } = await import('./backup-cloud-config.mjs')
  const sb = sandbox()
  const frozen = validateCloudConfig(configFor(sb))
  const cloud = makeFakeCloud()
  const outcome = await makeRunner(cloud).runUploadAttempt({ config: frozen, artifactBase: BASE })
  assertOutcomeShape(outcome, sb)
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
})

test('identity: a misbehaving random source or clock throws cloud_upload_attempt_id_failed before any request', async () => {
  const sb = sandbox()
  for (const deps of [
    { randomToken: () => '../BAD1' },
    { randomToken: () => 'DEADBEEF' },
    { randomToken: () => MARKER },
    { now: () => Number.NaN },
    {
      now: () => {
        throw new Error(MARKER)
      },
    },
  ]) {
    const cloud = makeFakeCloud()
    await expectThrow(
      () => makeRunner(cloud, deps).runUploadAttempt({ config: configFor(sb), artifactBase: BASE }),
      'cloud_upload_attempt_id_failed',
      cloud,
    )
  }
})

test('factory: an incomplete dependency set is refused', () => {
  for (const deps of [
    null,
    {},
    { ...REAL_UPLOAD_DEPS, cloud: { runInfo() {}, runCreateFolder() {} } },
    { ...REAL_UPLOAD_DEPS, lstat: undefined },
    { ...REAL_UPLOAD_DEPS, completionDeps: { fs: {}, sha256File() {} } },
  ]) {
    assert.throws(
      () => makeUploadAttemptRunner(deps),
      (err) => err instanceof BackupError && err.code === 'cloud_upload_invalid_input',
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Remote root, namespace, create/confirm, object preflights
// ═════════════════════════════════════════════════════════════════════════════

function expectNoWrite(outcome, cloud) {
  assert.equal(uploads(cloud).length, 0)
  assert.equal(ops(cloud).includes('create-folder'), false)
  assert.equal(outcome.writeBoundaryCallMade, false)
  assert.equal(outcome.transferState, 'definitely_zero')
  assert.equal(outcome.namespaceState, 'no_namespace_write_evidence')
}

test('root: absent, a file, or trashed is a definite refusal with no write', async () => {
  const absent = await attempt({ cloud: makeFakeCloud({ root: null }) })
  assert.equal(absent.outcome.code, 'remote_root_absent')
  assert.equal(absent.outcome.status, 'rejected')
  assert.equal(absent.outcome.failedStep, 'preflight_root')
  assert.deepEqual(ops(absent.cloud), ['info'])
  expectNoWrite(absent.outcome, absent.cloud)

  for (const node of [
    { nodeKind: 'file', state: 'active' },
    { nodeKind: 'folder', state: 'trashed' },
  ]) {
    const cloud = makeFakeCloud({
      respond: on({ operation: 'info', path: ROOT }, infoPresent(node)),
    })
    const { outcome } = await attempt({ cloud })
    assert.equal(outcome.code, 'remote_root_not_active_folder')
    assert.equal(outcome.status, 'rejected')
    assert.deepEqual(ops(cloud), ['info'])
    expectNoWrite(outcome, cloud)
  }
})

test('root: boundary rejection, indeterminacy, malformed results and pre-spawn refusals stop with no write', async () => {
  const cases = [
    [rejectedResult('info', 'credential_unavailable'), 'provider_rejected', 'rejected', 'rejected'],
    [
      indeterminateResult('info', 'provider_timeout'),
      'provider_indeterminate',
      'indeterminate',
      'indeterminate',
    ],
    [
      Object.freeze({ kind: 'success', operation: 'info', present: 'yes' }),
      'provider_call_failed',
      'indeterminate',
      'failed',
    ],
    [
      () => {
        throw new BackupError('cli_hash_mismatch', MARKER)
      },
      'provider_refused_before_spawn',
      'rejected',
      'refused_before_spawn',
    ],
  ]
  for (const [act, code, status, boundaryResult] of cases) {
    const cloud = makeFakeCloud({ respond: on({ operation: 'info', path: ROOT }, act) })
    const { outcome } = await attempt({ cloud })
    assert.equal(outcome.code, code)
    assert.equal(outcome.status, status)
    assert.equal(outcome.failedStep, 'preflight_root')
    assert.equal(outcome.boundaryCalls[0].boundaryResult, boundaryResult)
    assert.deepEqual(ops(cloud), ['info'])
    expectNoWrite(outcome, cloud)
  }
})

test('namespace: an occupied namespace (folder, file, or trashed node) is refused before the create', async () => {
  for (const node of [
    { nodeKind: 'folder', state: 'active' },
    { nodeKind: 'file', state: 'active' },
    { nodeKind: 'folder', state: 'trashed' },
  ]) {
    const cloud = makeFakeCloud({ nodes: { [NAMESPACE]: node } })
    const { outcome } = await attempt({ cloud })
    assert.equal(outcome.code, 'remote_path_occupied')
    assert.equal(outcome.status, 'rejected')
    assert.equal(outcome.failedStep, 'preflight_namespace')
    assert.equal(outcome.boundaryCalls[1].reportedFinding, 'present')
    assert.deepEqual(ops(cloud), ['info', 'info'])
    expectNoWrite(outcome, cloud)
  }
})

test('namespace: an indeterminate namespace preflight stops before the create', async () => {
  const cloud = makeFakeCloud({
    respond: on(
      { operation: 'info', path: NAMESPACE },
      indeterminateResult('info', 'provider_error_unrecognised'),
    ),
  })
  const { outcome } = await attempt({ cloud })
  assert.equal(outcome.code, 'provider_indeterminate')
  assert.equal(outcome.failedStep, 'preflight_namespace')
  assert.deepEqual(ops(cloud), ['info', 'info'])
  expectNoWrite(outcome, cloud)
})

test('collision: a deterministic (defective) random source reusing a namespace fails closed', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const first = await makeRunner(cloud).runUploadAttempt({
    config: configFor(sb),
    artifactBase: BASE,
  })
  assert.equal(first.status, 'upload_success_reported_pending_readback')
  const before = cloud.log.length
  const second = await makeRunner(cloud).runUploadAttempt({
    config: configFor(sb),
    artifactBase: BASE,
  })
  assertOutcomeShape(second, sb)
  assert.equal(second.remote.namespace, first.remote.namespace, 'premise: same token, same second')
  assert.equal(second.code, 'remote_path_occupied')
  assert.equal(second.failedStep, 'preflight_namespace')
  assert.deepEqual(
    cloud.log.slice(before).map((e) => e.operation),
    ['info', 'info'],
  )
})

test('create: an anchored rejection or a pre-spawn refusal is a boundary call with no namespace write evidence', async () => {
  const cases = [
    [rejectedResult('create-folder', 'credential_unavailable'), 'provider_rejected', 'rejected'],
    [
      () => {
        throw new BackupError('cloud_cli_argv_invalid', MARKER)
      },
      'provider_refused_before_spawn',
      'refused_before_spawn',
    ],
  ]
  for (const [act, code, boundaryResult] of cases) {
    const cloud = makeFakeCloud({ respond: on({ operation: 'create-folder' }, act) })
    const { outcome } = await attempt({ cloud })
    assert.equal(outcome.code, code)
    assert.equal(outcome.status, 'rejected')
    assert.equal(outcome.failedStep, 'create_namespace')
    assert.equal(outcome.boundaryCalls.at(-1).boundaryResult, boundaryResult)
    // The call DID happen — it is recorded as a write boundary call ...
    assert.equal(outcome.writeBoundaryCallMade, true)
    // ... but the only evidence about it is definite zero.
    assert.equal(outcome.namespaceState, 'no_namespace_write_evidence')
    assert.equal(outcome.transferState, 'definitely_zero')
    assert.deepEqual(ops(cloud), ['info', 'info', 'create-folder'])
  }
})

test('create: an indeterminate, thrown, or malformed create leaves namespace evidence unknown and stops', async () => {
  const cases = [
    [indeterminateResult('create-folder', 'provider_timeout'), 'provider_indeterminate'],
    [
      () => {
        throw new Error(MARKER)
      },
      'provider_call_failed',
    ],
    [
      Object.freeze({
        kind: 'success',
        operation: 'create-folder',
        created: false,
        folderUid: 'x',
      }),
      'provider_call_failed',
    ],
    [
      Object.freeze({ kind: 'success', operation: 'info', created: true, folderUid: 'x' }),
      'provider_call_failed',
    ],
  ]
  for (const [act, code] of cases) {
    const cloud = makeFakeCloud({ respond: on({ operation: 'create-folder' }, act) })
    const { outcome } = await attempt({ cloud })
    assert.equal(outcome.code, code)
    assert.equal(outcome.status, 'indeterminate')
    assert.equal(outcome.failedStep, 'create_namespace')
    assert.equal(outcome.namespaceState, 'unknown')
    assert.equal(outcome.writeBoundaryCallMade, true)
    assert.equal(outcome.transferState, 'definitely_zero')
    assert.deepEqual(ops(cloud), ['info', 'info', 'create-folder'])
  }
})

test('confirm: anything but the matching active folder is created_folder_unconfirmed and stops', async () => {
  const cases = [
    infoAbsent(),
    infoPresent({ nodeKind: 'file', nodeUid: 'folder~1' }),
    infoPresent({ state: 'trashed', nodeUid: 'folder~1' }),
    infoPresent({ nodeUid: 'someone~else' }),
    infoPresent({ nodeUid: FAKE_ROOT_UID }),
    indeterminateResult('info', 'provider_error_unrecognised'),
    rejectedResult('info', 'credential_unavailable'),
    () => {
      throw new BackupError('cli_hash_mismatch', MARKER)
    },
  ]
  for (const act of cases) {
    let infoOnNamespace = 0
    const cloud = makeFakeCloud({
      respond: (call) => {
        if (call.operation === 'info' && call.params.remotePath === NAMESPACE) {
          infoOnNamespace += 1
          if (infoOnNamespace === 2) return typeof act === 'function' ? act() : act
        }
        return undefined
      },
    })
    const { outcome } = await attempt({ cloud })
    assert.equal(outcome.code, 'created_folder_unconfirmed')
    assert.equal(outcome.status, 'indeterminate')
    assert.equal(outcome.failedStep, 'confirm_namespace')
    assert.equal(outcome.namespaceState, 'unknown')
    assert.equal(outcome.transferState, 'definitely_zero')
    assert.deepEqual(ops(cloud), ['info', 'info', 'create-folder', 'info'])
  }
})

test('create: the confirmation binds to the uid the create reported, not merely to "some folder"', async () => {
  const cloud = makeFakeCloud({
    respond: on({ operation: 'create-folder' }, (call) => {
      // The fake model still creates the node (folder~1) but reports another uid.
      cloud.tree.set(`${call.params.parentPath}/${call.params.name}`, {
        nodeKind: 'folder',
        state: 'active',
        nodeUid: 'folder~1',
      })
      return createdResult('folder~reported-differently')
    }),
  })
  const { outcome } = await attempt({ cloud })
  assert.equal(outcome.code, 'created_folder_unconfirmed')
})

test('objects: all three object paths are checked, under the confirmed parent, before any upload', async () => {
  for (const role of ROLES) {
    for (const node of [
      { nodeKind: 'file', state: 'active' },
      { nodeKind: 'folder', state: 'active' },
    ]) {
      const cloud = makeFakeCloud({
        respond: on({ operation: 'info', path: OBJECT[role] }, infoPresent(node)),
      })
      const { outcome } = await attempt({ cloud })
      assert.equal(outcome.code, 'remote_path_occupied')
      assert.equal(outcome.status, 'rejected')
      assert.equal(outcome.failedStep, `preflight_${role}`)
      assert.equal(uploads(cloud).length, 0, 'no upload before every object preflight passed')
      assert.equal(outcome.namespaceState, 'active_folder_confirmed')
      assert.equal(outcome.transferState, 'definitely_zero')
    }
    const cloud = makeFakeCloud({
      respond: on(
        { operation: 'info', path: OBJECT[role] },
        indeterminateResult('info', 'provider_stream_failed'),
      ),
    })
    const { outcome } = await attempt({ cloud })
    assert.equal(outcome.code, 'provider_indeterminate')
    assert.equal(outcome.failedStep, `preflight_${role}`)
    assert.equal(uploads(cloud).length, 0)
  }
})

test('retirement: after an indeterminate create, a later attempt uses a new namespace and never touches the old one', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({
    respond: (call) =>
      call.operation === 'create-folder' && call.params.name === FOLDER
        ? indeterminateResult('create-folder', 'provider_timeout')
        : undefined,
  })
  const first = await makeRunner(cloud).runUploadAttempt({
    config: configFor(sb),
    artifactBase: BASE,
  })
  assert.equal(first.namespaceState, 'unknown')
  const before = cloud.log.length
  const second = await makeRunner(cloud, { randomToken: () => 'feedface' }).runUploadAttempt({
    config: configFor(sb),
    artifactBase: BASE,
  })
  assertOutcomeShape(second, sb)
  assert.notEqual(second.remote.namespace, first.remote.namespace)
  assert.equal(second.status, 'upload_success_reported_pending_readback')
  for (const entry of cloud.log.slice(before)) {
    const touched =
      entry.remotePath ?? entry.remoteParentPath ?? `${entry.parentPath}/${entry.name}`
    assert.equal(touched.startsWith(first.remote.namespace), false)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// T19: the dependency surface itself — static
// ═════════════════════════════════════════════════════════════════════════════

test('T19: the real dependency bundle is deep-frozen, minimal, and has no write/delete/download capability', () => {
  assertDeepFrozen(REAL_UPLOAD_DEPS, 'REAL_UPLOAD_DEPS')
  assert.deepEqual(Object.keys(REAL_UPLOAD_DEPS).sort(), [
    'cloud',
    'completionDeps',
    'evidence', // E3J6A: the read-only no-follow descriptor reader
    'lstat',
    'now',
    'randomToken',
  ])
  assert.equal(REAL_UPLOAD_DEPS.evidence, REAL_EVIDENCE_READER)
  assert.deepEqual(Object.keys(REAL_UPLOAD_DEPS.evidence).sort(), [
    'close',
    'fstat',
    'open',
    'read',
  ])
  assert.deepEqual(Object.keys(REAL_UPLOAD_DEPS.completionDeps).sort(), ['fs', 'sha256File'])
  assert.deepEqual(Object.keys(REAL_UPLOAD_DEPS.completionDeps.fs).sort(), [
    'existsSync',
    'readFileSync',
    'statSync',
  ])
  assert.deepEqual(Object.keys(REAL_UPLOAD_DEPS.cloud).sort(), [
    'runCreateFolder',
    'runInfo',
    'runUpload',
  ])
  // Exactly the PUBLIC E3J4 operations — not the internal core's factory output.
  assert.equal(REAL_UPLOAD_DEPS.cloud.runInfo, cliRunInfo)
  assert.equal(REAL_UPLOAD_DEPS.cloud.runCreateFolder, cliRunCreateFolder)
  assert.equal(REAL_UPLOAD_DEPS.cloud.runUpload, cliRunUpload)
  assert.match(REAL_UPLOAD_DEPS.randomToken(4), /^[0-9a-f]{8}$/)
})

test('T19: the upload core source constructs no deletion, write, download, spawn, or listing call', () => {
  const src = fs.readFileSync(path.join(HERE, 'internal', 'backup-cloud-upload-core.mjs'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const forbidden of [
    /\bunlinkSync\b/,
    /\brmSync\b/,
    /\brmdirSync\b/,
    /\brenameSync\b/,
    /\bwriteFileSync\b/,
    /\bopenSync\b/,
    /\brunDownload\b/,
    /\bspawn\b/,
    /child_process/,
    /backup-cloud-cli-core/,
    /makeRealDeps/,
    /\btrash\(|\bdelete\(/,
  ]) {
    assert.equal(forbidden.test(code), false, `forbidden construct ${forbidden}`)
  }
})

test('E3J5: no ops/** module other than backup-cloud-upload.mjs and this suite imports the upload core', () => {
  const opsRoot = path.resolve(HERE, '..', '..')
  const allowed = new Set([
    path.join(HERE, 'backup-cloud-upload.mjs'),
    path.join(HERE, 'backup-cloud-upload.test.mjs'),
    path.join(HERE, 'internal', 'backup-cloud-upload-core.mjs'),
  ])
  const IMPORTS_CORE =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-cloud-upload-core\.mjs['"]/
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

test('E3J6B parity: the attempt-record vocabularies cover every upload code, step-local refusal, and boundary code', () => {
  // The record schema restates E3J4_PRE_SPAWN_CODES (it may not import this
  // core); a drift here would make a genuine outcome unrecordable.
  for (const code of [...CLOUD_CLI_ERROR_CODES, ...E3J4_PRE_SPAWN_CODES]) {
    assert.ok(CLOUD_ATTEMPT_BOUNDARY_CODES.includes(code), code)
  }
  assert.equal(
    CLOUD_ATTEMPT_BOUNDARY_CODES.length,
    new Set([...CLOUD_CLI_ERROR_CODES, ...E3J4_PRE_SPAWN_CODES]).size,
  )
  for (const code of CLOUD_UPLOAD_OUTCOME_CODES) {
    assert.ok(CLOUD_ATTEMPT_CODES_BY_STAGE.upload.includes(code), code)
  }
  for (const code of CLOUD_ATTEMPT_CODES_BY_STAGE.local_refusal) {
    if (code !== 'internal_invariant_violated')
      assert.ok(CLOUD_UPLOAD_OUTCOME_CODES.includes(code), code)
  }
})

test('production API: the closed export surface', () => {
  // E3J6A: prepareUploadAttempt and executeUploadAttempt added.
  // E3J6B: discardPreparedUploadAttempt added (the only authorized change to
  // this expectation — every pre-existing name and behavior is unchanged).
  assert.deepEqual(Object.keys(production).sort(), [
    'CLOUD_UPLOAD_NAMESPACE_STATES',
    'CLOUD_UPLOAD_OUTCOME_CODES',
    'CLOUD_UPLOAD_STATUSES',
    'CLOUD_UPLOAD_STEPS',
    'CLOUD_UPLOAD_TRANSFER_STATES',
    'discardPreparedUploadAttempt',
    'executeUploadAttempt',
    'prepareUploadAttempt',
    'runUploadAttempt',
  ])
  for (const name of Object.keys(production)) {
    if (typeof production[name] !== 'function') assert.ok(Object.isFrozen(production[name]))
  }
})

// ── E3J6B: discardPreparedUploadAttempt ─────────────────────────────────────

test('E3J6B: discardPreparedUploadAttempt releases a ready prepared attempt with zero provider calls', () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({ nodes: { [NAMESPACE]: { nodeKind: 'folder', state: 'active' } } })
  const runner = makeRunner(cloud)
  const prepared = runner.prepareUploadAttempt({ config: configFor(sb), artifactBase: BASE })
  assert.equal(prepared.disposition, 'ready')

  const ack = runner.discardPreparedUploadAttempt({ prepared })
  assert.deepEqual(Object.keys(ack).sort(), ['attemptId', 'kind', 'schemaVersion'])
  assert.equal(ack.kind, 'eanhl.cloud-upload-discard-ack')
  assert.equal(ack.schemaVersion, 1)
  assert.equal(ack.attemptId, prepared.attempt.attemptId)
  assert.throws(() => {
    ack.attemptId = 'tampered'
  }, TypeError)
  assert.equal(cloud.log.length, 0) // no provider call of any kind
})

test('E3J6B: discardPreparedUploadAttempt and executeUploadAttempt are mutually exclusive', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({ nodes: { [NAMESPACE]: { nodeKind: 'folder', state: 'active' } } })
  const runner = makeRunner(cloud)

  const preparedA = runner.prepareUploadAttempt({ config: configFor(sb), artifactBase: BASE })
  runner.discardPreparedUploadAttempt({ prepared: preparedA })
  assert.throws(
    () => runner.discardPreparedUploadAttempt({ prepared: preparedA }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_reused',
  )
  await assert.rejects(
    () => runner.executeUploadAttempt({ prepared: preparedA }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_reused',
  )
})

test('E3J6B: a discarded-then-executed ordering fails the same way in reverse', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({ nodes: { [NAMESPACE]: { nodeKind: 'folder', state: 'active' } } })
  const runner = makeRunner(cloud)

  const prepared = runner.prepareUploadAttempt({ config: configFor(sb), artifactBase: BASE })
  const executed = runner.executeUploadAttempt({ prepared })
  assert.throws(
    () => runner.discardPreparedUploadAttempt({ prepared }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_reused',
  )
  await executed // let the in-flight execution finish before the sandbox is cleaned up
})

test('E3J6B: a discard issued while an executeUploadAttempt call is still in flight is rejected', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({ nodes: { [NAMESPACE]: { nodeKind: 'folder', state: 'active' } } })
  const runner = makeRunner(cloud)

  const prepared = runner.prepareUploadAttempt({ config: configFor(sb), artifactBase: BASE })
  // executeUploadAttempt() consumes the registry entry SYNCHRONOUSLY before
  // its first `await` (per the module's own documented invariant), so a
  // discard issued immediately afterward — even before the returned promise
  // settles — must already see the entry as consumed.
  const executePromise = runner.executeUploadAttempt({ prepared })
  assert.throws(
    () => runner.discardPreparedUploadAttempt({ prepared }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_reused',
  )
  await executePromise
})

test('E3J6B: discardPreparedUploadAttempt refuses forged, foreign, and reused prepared objects', () => {
  const sb = sandbox()
  const cloud = makeFakeCloud()
  const runner = makeRunner(cloud)
  const otherRunner = makeRunner(makeFakeCloud())

  assert.throws(
    () => runner.discardPreparedUploadAttempt({ prepared: Object.freeze({}) }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_invalid',
  )

  const foreignPrepared = otherRunner.prepareUploadAttempt({
    config: configFor(sb),
    artifactBase: BASE,
  })
  assert.throws(
    () => runner.discardPreparedUploadAttempt({ prepared: foreignPrepared }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_invalid',
  )
})

test('E3J6B: a refused prepared attempt must be consumed through executeUploadAttempt(), never discarded', async () => {
  const sb = sandbox({ ciphertext: Buffer.alloc(0) }) // an empty ciphertext refuses at prepare time
  const cloud = makeFakeCloud()
  const runner = makeRunner(cloud)
  const prepared = runner.prepareUploadAttempt({ config: configFor(sb), artifactBase: BASE })
  assert.equal(prepared.disposition, 'refused')

  assert.throws(
    () => runner.discardPreparedUploadAttempt({ prepared }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_reused',
  )
  const outcome = await runner.executeUploadAttempt({ prepared })
  assert.equal(outcome.status, 'rejected')
  assert.equal(cloud.log.length, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
// PRODUCTION ROUTE — the real E3J4 boundary, really spawning the fake CLI
// ═════════════════════════════════════════════════════════════════════════════

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** A sandbox whose config points at a real launcher for the fake CLI, pinned to its real SHA-512. */
function productionSandbox({ sequence, pin } = {}) {
  const sb = sandbox()
  const control = path.join(sb.dir, 'control')
  fs.mkdirSync(path.join(control, 'markers'), { recursive: true })
  fs.mkdirSync(path.join(sb.dir, 'bin'))
  const launcher = path.join(sb.dir, 'bin', 'proton-drive')
  fs.writeFileSync(
    launcher,
    `#!/bin/sh\nFAKE_PROTON_CONTROL_DIR=${shellQuote(control)} exec ${process.execPath} ${DOUBLE} "$@"\n`,
    { mode: 0o755 },
  )
  fs.writeFileSync(path.join(control, 'response.json'), JSON.stringify({ sequence }))
  const realPin = createHash('sha512').update(fs.readFileSync(launcher)).digest('hex')
  const config = configFor(sb, {
    cli: { executable: launcher, expectedSha512: pin ?? realPin },
  })
  const argvLog = () => {
    try {
      return fs
        .readFileSync(path.join(control, 'argv.log'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    } catch {
      return null
    }
  }
  return { sb, config, argvLog }
}

const rawInfo = (nodeKind, nodeUid) =>
  JSON.stringify({
    nodeUid,
    nodeKind,
    state: 'active',
    activeRevisionUid: null,
    claimedSize: null,
    claimedDigests: { sha1: null },
    sha1Verified: null,
  })
const rawUpload = (bytes) =>
  JSON.stringify({
    transferredItems: 1,
    transferredBytes: bytes,
    skippedItems: 0,
    failedItems: 0,
    failures: [],
  })
const NOT_FOUND = { notFoundForQueriedBasename: true }

function happySequence(sb) {
  const size = (r) => fs.statSync(sb.files[r]).size
  return [
    { stdout: rawInfo('folder', 'root~uid') },
    NOT_FOUND,
    { stdout: JSON.stringify({ created: true, folderUid: 'ns~uid' }) },
    { stdout: rawInfo('folder', 'ns~uid') },
    NOT_FOUND,
    NOT_FOUND,
    NOT_FOUND,
    ...ROLES.map((r) => ({ stdout: rawUpload(size(r)) })),
  ]
}

test('production route: a full attempt through the real E3J4 boundary, with injected deps inert', async () => {
  const shell = productionSandbox({ sequence: [] })
  // Rewrite the sequence now that the triple's real sizes are known.
  const control = path.join(shell.sb.dir, 'control')
  fs.writeFileSync(
    path.join(control, 'response.json'),
    JSON.stringify({ sequence: happySequence(shell.sb) }),
  )
  const poison = () => {
    throw new Error(`poisoned ${MARKER}`)
  }
  const outcome = await production.runUploadAttempt({
    config: shell.config,
    artifactBase: BASE,
    deps: {
      lstat: poison,
      now: poison,
      randomToken: () => '../x',
      completionDeps: { fs: { existsSync: poison } },
      cloud: { runInfo: poison, runCreateFolder: poison, runUpload: poison },
    },
  })
  assertOutcomeShape(outcome, shell.sb)
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
  assert.equal(outcome.transferState, 'unknown')
  assert.equal(outcome.namespaceState, 'active_folder_confirmed')
  assert.match(outcome.attempt.attemptId, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/)
  const ns = outcome.remote.namespace
  const folder = outcome.remote.attemptFolderName
  assert.deepEqual(shell.argvLog(), [
    ['filesystem', 'info', ROOT, '--json'],
    ['filesystem', 'info', ns, '--json'],
    ['filesystem', 'create-folder', ROOT, folder, '--json'],
    ['filesystem', 'info', ns, '--json'],
    ['filesystem', 'info', outcome.remote.ciphertextPath, '--json'],
    ['filesystem', 'info', outcome.remote.checksumPath, '--json'],
    ['filesystem', 'info', outcome.remote.manifestPath, '--json'],
    ['filesystem', 'upload', '--json', shell.sb.files.ciphertext, ns],
    ['filesystem', 'upload', '--json', shell.sb.files.checksum, ns],
    ['filesystem', 'upload', '--json', shell.sb.files.manifest, ns],
  ])
})

test('production route: a real byte-count disagreement at the checksum upload stops before the manifest', async () => {
  const shell = productionSandbox({ sequence: [] })
  const seq = happySequence(shell.sb)
  seq[8] = { stdout: rawUpload(1) } // the checksum upload reports the wrong size
  fs.writeFileSync(
    path.join(shell.sb.dir, 'control', 'response.json'),
    JSON.stringify({ sequence: seq }),
  )
  const outcome = await production.runUploadAttempt({ config: shell.config, artifactBase: BASE })
  assertOutcomeShape(outcome, shell.sb)
  assert.equal(outcome.code, 'provider_indeterminate')
  assert.equal(outcome.boundaryCalls.at(-1).boundaryCode, 'upload_size_mismatch')
  assert.equal(outcome.failedStep, 'upload_checksum')
  assert.equal(outcome.furthestUploadSuccessReportedRole, 'ciphertext')
  assert.equal(shell.argvLog().length, 9, 'no manifest upload was spawned')
})

test('production route T12: a real upload timeout is indeterminate/unknown and nothing follows it', async () => {
  const shell = productionSandbox({ sequence: [] })
  const seq = happySequence(shell.sb).slice(0, 7)
  seq.push({ hang: true })
  fs.writeFileSync(
    path.join(shell.sb.dir, 'control', 'response.json'),
    JSON.stringify({ sequence: seq }),
  )
  const config = {
    ...shell.config,
    run: { ...shell.config.run, operationTimeoutMs: 400, cancelGraceMs: 300 },
  }
  const outcome = await production.runUploadAttempt({ config, artifactBase: BASE })
  assertOutcomeShape(outcome, shell.sb)
  assert.equal(outcome.status, 'indeterminate')
  assert.equal(outcome.code, 'provider_indeterminate')
  assert.equal(outcome.boundaryCalls.at(-1).boundaryCode, 'provider_timeout')
  assert.equal(outcome.transferState, 'unknown')
  assert.equal(outcome.furthestUploadSuccessReportedRole, null)
  assert.equal(shell.argvLog().length, 8, 'no request after the timed-out upload')
})

test('production route: a hash mismatch refuses before any spawn, with definite-zero evidence', async () => {
  const shell = productionSandbox({ sequence: [NOT_FOUND], pin: 'a'.repeat(128) })
  const outcome = await production.runUploadAttempt({ config: shell.config, artifactBase: BASE })
  assertOutcomeShape(outcome, shell.sb)
  assert.equal(outcome.code, 'provider_refused_before_spawn')
  assert.equal(outcome.status, 'rejected')
  assert.equal(outcome.failedStep, 'preflight_root')
  assert.equal(outcome.boundaryCalls[0].boundaryCode, 'cli_hash_mismatch')
  assert.equal(outcome.providerBoundaryCallMade, true, 'the boundary was called ...')
  assert.equal(shell.argvLog(), null, '... but nothing was spawned')
  assert.equal(outcome.transferState, 'definitely_zero')
  assert.equal(outcome.writeBoundaryCallMade, false)
})

test('production route: invalid input throws before any spawn', async () => {
  const shell = productionSandbox({ sequence: [NOT_FOUND] })
  for (const args of [
    undefined,
    { config: shell.config, artifactBase: '../x' },
    { config: { ...shell.config, remote: { root: '/trash' } }, artifactBase: BASE },
  ]) {
    await assert.rejects(
      () => production.runUploadAttempt(args),
      (err) => err instanceof BackupError && err.code === 'cloud_upload_invalid_input',
    )
  }
  assert.equal(shell.argvLog(), null)
})

// ═════════════════════════════════════════════════════════════════════════════
// E3J6A — one-shot preparation, and source evidence captured before any
// boundary call. Descriptor evidence makes a later readback comparable with
// PRE-UPLOAD bytes; it does not close the CLI's path-based upload TOCTOU.
// ═════════════════════════════════════════════════════════════════════════════

const PREPARED_KEYS = [
  'artifact',
  'attempt',
  'disposition',
  'kind',
  'local',
  'refusal',
  'remote',
  'schemaVersion',
  'sourceEvidence',
]

function assertPreparedShape(p, sb) {
  assert.deepEqual(Object.keys(p).sort(), PREPARED_KEYS)
  assertDeepFrozen(p, 'prepared')
  assert.equal(p.kind, 'eanhl.cloud-upload-prepared')
  assert.equal(p.schemaVersion, 1)
  assert.ok(['ready', 'refused'].includes(p.disposition))
  assert.deepEqual(Object.keys(p.attempt).sort(), ['attemptId', 'startedAt'])
  assert.deepEqual(Object.keys(p.local).sort(), [
    'checksumPath',
    'ciphertextPath',
    'manifestPath',
    'sourceDir',
  ])
  if (sb) for (const r of ROLES) assert.equal(p.local[`${r}Path`], sb.files[r])
  assert.equal(p.remote.namespace, `${ROOT}/${BASE}.${p.attempt.attemptId}`)
  if (p.disposition === 'ready') {
    assert.equal(p.refusal, null)
    assert.ok(p.sourceEvidence !== null)
  } else {
    assert.deepEqual(Object.keys(p.refusal).sort(), ['code', 'step'])
    assert.equal(p.refusal.step, 'local_validation')
    assert.ok(CLOUD_UPLOAD_OUTCOME_CODES.includes(p.refusal.code))
    // Partial evidence never escapes a refusal: no digest anywhere.
    assert.equal(p.sourceEvidence, null)
    assert.equal(/[0-9a-f]{64}/.test(JSON.stringify(p)), false)
  }
  assert.equal(JSON.stringify(p).includes(MARKER), false)
}

function prepareWith(sb, { cloud = makeFakeCloud(), deps = {}, config } = {}) {
  const runner = makeRunner(cloud, deps)
  const prepared = runner.prepareUploadAttempt({
    config: config ?? configFor(sb),
    artifactBase: BASE,
  })
  return { runner, prepared, cloud }
}

test('E3J6A prepare: local only — a ready object with exact evidence and no boundary call', () => {
  const sb = sandbox()
  const { prepared, cloud } = prepareWith(sb)
  assertPreparedShape(prepared, sb)
  assert.equal(prepared.disposition, 'ready')
  assert.equal(cloud.log.length, 0)
  assert.deepEqual(prepared.sourceEvidence, {
    ciphertext: {
      sha256: sha256(fs.readFileSync(sb.files.ciphertext)),
      bytes: fs.statSync(sb.files.ciphertext).size,
    },
    checksum: {
      sha256: sha256(fs.readFileSync(sb.files.checksum)),
      bytes: fs.statSync(sb.files.checksum).size,
    },
    manifest: {
      sha256: sha256(fs.readFileSync(sb.files.manifest)),
      bytes: fs.statSync(sb.files.manifest).size,
    },
    snapshotTs: SNAPSHOT_TS,
    runId: SOURCE_RUN_ID,
  })
  assert.equal(prepared.attempt.attemptId, ATTEMPT_ID)
})

test('E3J6A prepare: every evidence read happens before the first boundary call, and the outcome carries it', async () => {
  const sb = sandbox()
  const events = []
  const evidence = {
    ...REAL_EVIDENCE_READER,
    open: (p) => {
      events.push(`open:${path.basename(p)}`)
      return REAL_EVIDENCE_READER.open(p)
    },
  }
  const cloud = makeFakeCloud({
    respond: (call) => {
      events.push(`call:${call.operation}`)
      return undefined
    },
  })
  const { outcome } = await attempt({ sb, cloud, deps: { evidence } })
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
  const firstCall = events.findIndex((e) => e.startsWith('call:'))
  const opens = events.filter((e) => e.startsWith('open:'))
  assert.equal(opens.length, 3)
  assert.ok(events.lastIndexOf(opens.at(-1)) < firstCall, JSON.stringify(events))
  assert.deepEqual(outcome.sourceEvidence, {
    ciphertext: { sha256: sha256(fs.readFileSync(sb.files.ciphertext)), bytes: 1000 },
    checksum: {
      sha256: sha256(fs.readFileSync(sb.files.checksum)),
      bytes: fs.statSync(sb.files.checksum).size,
    },
    manifest: {
      sha256: sha256(fs.readFileSync(sb.files.manifest)),
      bytes: fs.statSync(sb.files.manifest).size,
    },
    snapshotTs: SNAPSHOT_TS,
    runId: SOURCE_RUN_ID,
  })
})

test('E3J6A prepare: evidence is the PRE-UPLOAD content — a same-size rewrite after preparation neither changes it nor gets uploaded', async () => {
  const sb = sandbox()
  const original = sha256(fs.readFileSync(sb.files.ciphertext))
  const { runner, prepared, cloud } = prepareWith(sb)
  // Replace the ciphertext with different bytes of the same size, as a NEW
  // inode. (An in-place same-size rewrite inside the filesystem's timestamp
  // granularity keeps dev/ino/size/mtime/ctime identical and is NOT
  // detectable here — that case is what E3J6B's readback hash comparison
  // against this pre-upload evidence exists to catch.)
  const replacement = `${sb.files.ciphertext}.replacement`
  fs.writeFileSync(replacement, Buffer.alloc(1000, 9))
  fs.renameSync(replacement, sb.files.ciphertext)
  const outcome = await runner.executeUploadAttempt({ prepared })
  assert.equal(outcome.sourceEvidence.ciphertext.sha256, original)
  assert.notEqual(sha256(fs.readFileSync(sb.files.ciphertext)), original)
  assert.equal(outcome.code, 'local_triple_changed')
  assert.equal(outcome.failedStep, 'upload_ciphertext')
  assert.equal(uploads(cloud).length, 0, 'the changed file was never handed to the boundary')
})

test('E3J6A ceilings: each role is accepted at EXACTLY its ceiling (inclusive)', async () => {
  const sb = sandbox()
  const size = (r) => fs.statSync(sb.files[r]).size
  const config = configFor(sb, {
    readback: {
      ...configFor(sb).readback,
      maxCiphertextBytes: size('ciphertext'),
      maxSidecarBytes: size('checksum'),
      maxManifestBytes: size('manifest'),
    },
  })
  const { prepared } = prepareWith(sb, { config })
  assertPreparedShape(prepared, sb)
  assert.equal(prepared.disposition, 'ready')
  const outcome = await makeRunner(makeFakeCloud()).runUploadAttempt({ config, artifactBase: BASE })
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
})

test('E3J6A ceilings: one byte over any role ceiling is local_exceeds_readback_ceiling, before any content read', () => {
  for (const [role, key] of [
    ['ciphertext', 'maxCiphertextBytes'],
    ['checksum', 'maxSidecarBytes'],
    ['manifest', 'maxManifestBytes'],
  ]) {
    const sb = sandbox()
    const opens = []
    const completionReads = []
    const config = configFor(sb, {
      readback: { ...configFor(sb).readback, [key]: fs.statSync(sb.files[role]).size - 1 },
    })
    const { prepared, cloud } = prepareWith(sb, {
      config,
      deps: {
        evidence: {
          ...REAL_EVIDENCE_READER,
          open: (p) => (opens.push(p), REAL_EVIDENCE_READER.open(p)),
        },
        completionDeps: {
          ...REAL_UPLOAD_DEPS.completionDeps,
          fs: {
            ...REAL_UPLOAD_DEPS.completionDeps.fs,
            readFileSync: (...a) => (completionReads.push(a[0]), fs.readFileSync(...a)),
          },
        },
      },
    })
    assertPreparedShape(prepared, sb)
    assert.equal(prepared.refusal.code, 'local_exceeds_readback_ceiling', role)
    assert.deepEqual(opens, [])
    assert.deepEqual(completionReads, [])
    assert.equal(cloud.log.length, 0)
  }
})

test('E3J6A identity: triples that pass completion but not the strict identity checks are local_manifest_identity_invalid, with nothing leaked', async () => {
  const cases = [
    (sb) => rewriteManifest(sb, (m) => delete m.run_id),
    (sb) => rewriteManifest(sb, (m) => (m.run_id = SOURCE_RUN_ID.toUpperCase())),
    (sb) => rewriteManifest(sb, (m) => (m.run_id = `${MARKER}`)),
    (sb) => rewriteManifest(sb, (m) => delete m.snapshot_ts),
    (sb) => rewriteManifest(sb, (m) => (m.snapshot_ts = 42)),
    (sb) => rewriteManifest(sb, (m) => (m.snapshot_ts = '2026-09-04T18:00:08Z')), // stamp mismatch
    (sb) => rewriteManifest(sb, (m) => (m.snapshot_ts = `${MARKER}`)),
    (sb) => {
      // Accepted by the lenient sidecar parser, but not the producer's exact line.
      const hash = sha256(fs.readFileSync(sb.files.ciphertext))
      fs.writeFileSync(sb.files.checksum, `${hash} *${BASE}.dump.age\n`)
    },
    (sb) => {
      const hash = sha256(fs.readFileSync(sb.files.ciphertext))
      fs.writeFileSync(sb.files.checksum, `${hash}  ${BASE}.dump.age`) // no newline
    },
    (sb) => {
      const hash = sha256(fs.readFileSync(sb.files.ciphertext))
      fs.writeFileSync(sb.files.checksum, `${hash}  ${BASE}.dump.age\n${MARKER}\n`)
    },
    (sb) => {
      // Invalid UTF-8 inside a JSON string: completion's lenient decode passes it.
      const text = fs.readFileSync(sb.files.manifest, 'utf8')
      const marked = text.replace('"schema_version"', '"x":"�","schema_version"')
      const bytes = Buffer.from(marked, 'utf8')
      const at = bytes.indexOf(Buffer.from('�', 'utf8'))
      fs.writeFileSync(
        sb.files.manifest,
        Buffer.concat([bytes.subarray(0, at), Buffer.from([0xff]), bytes.subarray(at + 3)]),
      )
    },
  ]
  for (const arrange of cases) {
    const sb = sandbox()
    arrange(sb)
    const { prepared, cloud } = prepareWith(sb)
    assertPreparedShape(prepared, sb)
    assert.equal(prepared.disposition, 'refused')
    assert.equal(prepared.refusal.code, 'local_manifest_identity_invalid', arrange.toString())
    assert.equal(cloud.log.length, 0)
  }
})

function rewriteManifest(sb, mutate) {
  const m = JSON.parse(fs.readFileSync(sb.files.manifest, 'utf8'))
  mutate(m)
  fs.writeFileSync(sb.files.manifest, JSON.stringify(m))
}

test('E3J6A evidence: tampered or failing descriptor evidence refuses with a closed code and no native text', () => {
  const real = REAL_EVIDENCE_READER
  const bump = (st) =>
    new Proxy(st, {
      get: (t, k) => (k === 'ino' ? t.ino + 1n : typeof t[k] === 'function' ? t[k].bind(t) : t[k]),
    })
  const nativeError = (code) => Object.assign(new Error(`${code} ${MARKER}`), { code })
  const cases = [
    [
      'local_triple_changed',
      {
        open: () => {
          throw nativeError('ELOOP')
        },
      },
    ],
    [
      'local_triple_changed',
      {
        open: () => {
          throw nativeError('ENOENT')
        },
      },
    ],
    [
      'local_file_unmeasurable',
      {
        open: () => {
          throw nativeError('EACCES')
        },
      },
    ],
    [
      'local_file_unmeasurable',
      {
        open: () => {
          throw MARKER
        },
      },
    ],
    ['local_triple_changed', { fstat: (fd) => bump(real.fstat(fd)) }],
    [
      'local_triple_changed',
      (() => {
        let n = 0
        return { fstat: (fd) => (++n === 2 ? bump(real.fstat(fd)) : real.fstat(fd)) }
      })(),
    ],
    ['local_file_unmeasurable', { fstat: () => ({ isFile: () => false }) }],
    [
      'local_file_unmeasurable',
      {
        fstat: () => {
          throw nativeError('EIO')
        },
      },
    ],
    [
      'local_file_unmeasurable',
      {
        read: () => {
          throw nativeError('EIO')
        },
      },
    ],
    ['local_file_unmeasurable', { read: () => -1 }],
    ['local_file_unmeasurable', { read: () => Number.NaN }],
    ['local_file_unmeasurable', { read: (fd, buf) => buf.length + 1 }],
    ['local_triple_changed', { read: () => 0 }], // short read
    [
      'local_triple_changed',
      (() => {
        // reports one byte more than the file holds
        let done = false
        return {
          read: (fd, buf) => {
            const n = real.read(fd, buf)
            if (n === 0 && !done) {
              done = true
              return 1
            }
            return n
          },
        }
      })(),
    ],
  ]
  for (const [code, override] of cases) {
    const sb = sandbox()
    const { prepared, cloud } = prepareWith(sb, { deps: { evidence: { ...real, ...override } } })
    assertPreparedShape(prepared, sb)
    assert.equal(prepared.refusal?.code, code, String(Object.values(override)[0]))
    assert.equal(cloud.log.length, 0)
  }
})

test('E3J6A evidence: a symlink swapped in between measurement and the descriptor open is refused by the kernel', () => {
  const sb = sandbox()
  const real = path.join(sb.dir, 'real-manifest')
  const evidence = {
    ...REAL_EVIDENCE_READER,
    open: (p) => {
      if (p === sb.files.manifest && !fs.lstatSync(p).isSymbolicLink()) {
        fs.renameSync(p, real)
        fs.symlinkSync(real, p)
      }
      return REAL_EVIDENCE_READER.open(p)
    },
  }
  const { prepared } = prepareWith(sb, { deps: { evidence } })
  assert.equal(prepared.refusal.code, 'local_triple_changed')
  assert.equal(prepared.sourceEvidence, null)
})

test('E3J6A evidence: a failing close of a read-only descriptor does not change the result', () => {
  const sb = sandbox()
  const { prepared } = prepareWith(sb, {
    deps: {
      evidence: {
        ...REAL_EVIDENCE_READER,
        close: (fd) => {
          REAL_EVIDENCE_READER.close(fd)
          throw new Error(MARKER)
        },
      },
    },
  })
  assertPreparedShape(prepared, sb)
  assert.equal(prepared.disposition, 'ready')
})

test('E3J6A one-shot: a prepared attempt executes exactly once; reuse fails locally with no boundary call', async () => {
  const sb = sandbox()
  const { runner, prepared, cloud } = prepareWith(sb)
  const first = await runner.executeUploadAttempt({ prepared })
  assertOutcomeShape(first, sb)
  assert.equal(first.status, 'upload_success_reported_pending_readback')
  const callsAfterFirst = cloud.log.length
  await expectThrow(
    () => runner.executeUploadAttempt({ prepared }),
    'cloud_upload_prepared_reused',
    { log: cloud.log.slice(callsAfterFirst) },
  )
  assert.equal(cloud.log.length, callsAfterFirst)
})

test('E3J6A one-shot: of two CONCURRENT executions exactly one proceeds; the other fails before any boundary call', async () => {
  const sb = sandbox()
  const { runner, prepared, cloud } = prepareWith(sb)
  const settled = await Promise.allSettled([
    runner.executeUploadAttempt({ prepared }),
    runner.executeUploadAttempt({ prepared }),
  ])
  const fulfilled = settled.filter((s) => s.status === 'fulfilled')
  const rejected = settled.filter((s) => s.status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(rejected[0].reason.code, 'cloud_upload_prepared_reused')
  assert.equal(fulfilled[0].value.status, 'upload_success_reported_pending_readback')
  // Exactly ONE attempt's requests: root, namespace, create, confirm, 3 checks, 3 uploads.
  assert.equal(cloud.log.length, 10)
  assert.equal(uploads(cloud).length, 3)
  assert.equal(cloud.log.filter((e) => e.operation === 'create-folder').length, 1)
})

test('E3J6A one-shot: forged copies and objects from another runner are refused, and a refusal does not consume the genuine object', async () => {
  const sb = sandbox()
  const { runner, prepared, cloud } = prepareWith(sb)
  const other = makeRunner(cloud)
  for (const forged of [
    { ...prepared },
    JSON.parse(JSON.stringify(prepared)),
    Object.freeze({ ...prepared, disposition: 'ready' }),
    null,
    undefined,
    'prepared',
  ]) {
    await expectThrow(
      () => runner.executeUploadAttempt({ prepared: forged }),
      'cloud_upload_prepared_invalid',
      cloud,
    )
  }
  await expectThrow(
    () => other.executeUploadAttempt({ prepared }),
    'cloud_upload_prepared_invalid',
    cloud,
  )
  // An invalid signal is refused WITHOUT consuming the object.
  await expectThrow(
    () => runner.executeUploadAttempt({ prepared, signal: { aborted: true } }),
    'cloud_upload_invalid_input',
    cloud,
  )
  await expectThrow(() => runner.executeUploadAttempt(null), 'cloud_upload_invalid_input', cloud)
  const outcome = await runner.executeUploadAttempt({ prepared })
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
})

test('E3J6A one-shot: a refused preparation keeps its identity, is consumed once, and makes no boundary call', async () => {
  const sb = sandbox()
  fs.rmSync(sb.files.checksum)
  const { runner, prepared, cloud } = prepareWith(sb)
  assertPreparedShape(prepared, sb)
  assert.equal(prepared.disposition, 'refused')
  assert.equal(prepared.refusal.code, 'local_file_missing')
  assert.equal(prepared.attempt.attemptId, ATTEMPT_ID)
  const outcome = await runner.executeUploadAttempt({ prepared })
  assertOutcomeShape(outcome)
  assert.equal(outcome.code, 'local_file_missing')
  assert.equal(outcome.failedStep, 'local_validation')
  assert.equal(outcome.sourceEvidence, null)
  assert.equal(outcome.attempt.attemptId, prepared.attempt.attemptId)
  assert.equal(cloud.log.length, 0)
  await expectThrow(
    () => runner.executeUploadAttempt({ prepared }),
    'cloud_upload_prepared_reused',
    cloud,
  )
})

test('E3J6A one-shot: execution uses the configuration captured at preparation; a config passed to execute is inert', async () => {
  const sb = sandbox()
  const { runner, prepared, cloud } = prepareWith(sb)
  await runner.executeUploadAttempt({
    prepared,
    config: configFor(sb, { remote: { root: '/elsewhere' } }),
  })
  assert.ok(cloud.log.every((e) => !JSON.stringify(e).includes('/elsewhere')))
  assert.equal(cloud.log[0].remotePath, ROOT)
})

test('E3J6A one-shot: a cancelled preparation is a refused attempt with its identity and no evidence', async () => {
  const sb = sandbox()
  const controller = new AbortController()
  controller.abort()
  const runner = makeRunner(makeFakeCloud())
  const prepared = runner.prepareUploadAttempt({
    config: configFor(sb),
    artifactBase: BASE,
    signal: controller.signal,
  })
  assertPreparedShape(prepared, sb)
  assert.equal(prepared.refusal.code, 'attempt_cancelled')
  const outcome = await runner.executeUploadAttempt({ prepared })
  assert.equal(outcome.status, 'indeterminate')
  assert.equal(outcome.transferState, 'definitely_zero')
})

test('E3J6A production: prepare/execute through the real module, and objects never cross module instances', async () => {
  const shell = productionSandbox({ sequence: [] })
  fs.writeFileSync(
    path.join(shell.sb.dir, 'control', 'response.json'),
    JSON.stringify({ sequence: happySequence(shell.sb) }),
  )
  const poison = () => {
    throw new Error(`poisoned ${MARKER}`)
  }
  const prepared = production.prepareUploadAttempt({
    config: shell.config,
    artifactBase: BASE,
    deps: { evidence: { open: poison, fstat: poison, read: poison, close: poison }, lstat: poison },
  })
  assertPreparedShape(prepared, shell.sb)
  assert.equal(prepared.disposition, 'ready')
  assert.equal(shell.argvLog(), null, 'preparation spawns nothing')

  // A test-runner object is not executable by the production module, and vice versa.
  const testPrepared = makeRunner(makeFakeCloud()).prepareUploadAttempt({
    config: configFor(shell.sb),
    artifactBase: BASE,
  })
  await assert.rejects(
    () => production.executeUploadAttempt({ prepared: testPrepared }),
    (err) => err.code === 'cloud_upload_prepared_invalid',
  )
  await assert.rejects(
    () => makeRunner(makeFakeCloud()).executeUploadAttempt({ prepared }),
    (err) => err.code === 'cloud_upload_prepared_invalid',
  )
  assert.equal(shell.argvLog(), null)

  const outcome = await production.executeUploadAttempt({
    prepared,
    deps: { cloud: { runInfo: poison, runCreateFolder: poison, runUpload: poison } },
  })
  assertOutcomeShape(outcome, shell.sb)
  assert.equal(outcome.status, 'upload_success_reported_pending_readback')
  assert.equal(shell.argvLog().length, 10)
  await assert.rejects(
    () => production.executeUploadAttempt({ prepared }),
    (err) => err.code === 'cloud_upload_prepared_reused',
  )
  assert.equal(shell.argvLog().length, 10)
})

test('E3J6A static: the evidence reader is read-only, no-follow, and the upload core itself still opens nothing', () => {
  const src = fs.readFileSync(
    path.join(HERE, 'internal', 'backup-cloud-source-evidence.mjs'),
    'utf8',
  )
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal((code.match(/\bopenSync\(/g) ?? []).length, 1)
  assert.match(
    code,
    /const READ_NO_FOLLOW = C\.O_RDONLY \| C\.O_NOFOLLOW \| \(C\.O_NONBLOCK \?\? 0\)/,
  )
  assert.match(code, /fs\.openSync\(p, READ_NO_FOLLOW\)/)
  for (const forbidden of [
    /O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND/,
    /\bwrite\w*\(/,
    /\bunlink\w*\(|\brm\w*\(|\brename\w*\(|\btruncate\w*\(|\bmkdir\w*\(/,
    /child_process|\bspawn\b/,
  ]) {
    assert.equal(forbidden.test(code), false, `forbidden construct ${forbidden}`)
  }
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(imports, ['node:fs'])
  assert.ok(Object.isFrozen(REAL_EVIDENCE_READER))
  // The read-only reader really refuses a symlink.
  const sb = sandbox()
  const link = path.join(sb.dir, 'link')
  fs.symlinkSync(sb.files.manifest, link)
  assert.throws(
    () => REAL_EVIDENCE_READER.open(link),
    (err) => err.code === 'ELOOP',
  )
})
