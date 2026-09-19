/**
 * One attested cloud-upload attempt, end to end — E3J6B (T13-T17, and the
 * written-attestation halves of T8/T11/T12).
 *
 * FACTORY-route tests build the orchestrator from the internal core with:
 *
 *   - the REAL record session and the REAL readback session (real temporary
 *     directories, real `O_CREAT|O_EXCL` record writes, real workspace
 *     creation, real cleanup);
 *   - the REAL production `prepareUploadAttempt()`/`discardPreparedUploadAttempt()`
 *     — both local-only, making no provider call of any kind — plus a
 *     SCRIPTED execute that consumes the genuine prepared object through the
 *     real one-shot registry and then synthesizes the upload outcome. A
 *     `refused` preparation is executed for real, because that path makes
 *     zero provider calls by construction;
 *   - `testdoubles/fake-cloud-operations.mjs` for the readback boundary;
 *   - a stub for the containment-proof check (the canary's own correctness is
 *     `backup-cloud-containment.test.mjs`'s subject, not this file's).
 *
 * The PRODUCTION-route test drives the real `runAttestedAttempt()` export
 * through the real E3J4/E3J6A subprocess boundary, spawning ONLY
 * `testdoubles/fake-proton-drive.mjs` under the real `/usr/bin/prlimit`
 * wrapper, with a real containment proof from the real canary. It never runs
 * the real Proton Drive CLI, contacts a provider, or reads a credential.
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
import * as production from './backup-cloud-attempt.mjs'
import {
  establishAttemptRecordSession,
  writeAttemptAttestation,
  writeAttemptIntent,
} from './backup-cloud-attestation-records.mjs'
import { proveReadbackContainment } from './backup-cloud-containment.mjs'
import { CLOUD_ATTEMPT_INTENT_SUFFIX, CLOUD_ATTESTATION_SUFFIX } from './backup-cloud-naming.mjs'
import {
  discardPreparedUploadAttempt,
  executeUploadAttempt,
  prepareUploadAttempt,
} from './backup-cloud-upload.mjs'
import { makeAttemptOrchestrator } from './internal/backup-cloud-attempt-orchestrator-core.mjs'
import { REAL_READBACK_DEPS, makeReadbackRunner } from './internal/backup-cloud-readback-core.mjs'
import { makeFakeCloud } from './testdoubles/fake-cloud-operations.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-attempt', warnAfterMs: 6_000, intervalMs: 4_000 })

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

const ROOT = '/proton/eanhl-backups'
const BASE = 'eanhl-test-20260904T180007Z'
const FIXED_FINISH = Date.parse('2026-09-16T12:35:10.000Z')
const RUN_ID = '20260916T120000Z-0a1b2c3d'
/** Upload order: ciphertext, checksum, manifest. Readback order is the reverse. */
const ROLES = ['ciphertext', 'checksum', 'manifest']
const SUFFIX = { ciphertext: '.dump.age', checksum: '.dump.age.sha256', manifest: '.manifest.json' }
const SHA512_A = '0123456789abcdef'.repeat(8)
const SHA512_B = 'fedcba9876543210'.repeat(8)
const SOURCE_RUN_ID = '20260904T180001Z-0a1b2c3d'
const SNAPSHOT_TS = '2026-09-04T18:00:07Z'
const MARKER = 'SECRET-MARKER-e3j6b-9c4f'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sha512 = (p) => createHash('sha512').update(fs.readFileSync(p)).digest('hex')

const sandboxes = []
afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    try {
      fs.chmodSync(dir, 0o700)
      for (const entry of fs.readdirSync(dir)) {
        try {
          fs.chmodSync(path.join(dir, entry), 0o700)
        } catch {
          /* best effort */
        }
      }
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** A sandbox with a real published triple, a real attestation dir, and a real readback dir. */
function sandbox({ ciphertext = Buffer.alloc(1000, 7) } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cloud-attempt-'))
  sandboxes.push(dir)
  const artifacts = path.join(dir, 'artifacts')
  const attestationDir = path.join(dir, 'attest')
  const readbackDir = path.join(dir, 'readback')
  fs.mkdirSync(artifacts, { mode: 0o700 })
  fs.mkdirSync(attestationDir, { mode: 0o700 })
  fs.mkdirSync(readbackDir, { mode: 0o700 })
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
      run_id: SOURCE_RUN_ID,
      snapshot_ts: SNAPSHOT_TS,
      ciphertext: { sha256: hash, bytes: ciphertext.length },
    }),
  )
  return { dir, artifacts, attestationDir, readbackDir, files }
}

function configFor(sb, overrides = {}) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: SHA512_A },
    credentials: { backend: 'pass' },
    remote: { root: ROOT },
    artifact: { sourceDir: sb.artifacts },
    attestation: { dir: sb.attestationDir },
    readback: {
      dir: sb.readbackDir,
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: { executable: REAL_PRLIMIT, expectedSha512: SHA512_B },
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

const PROOF = Object.freeze({ kind: 'eanhl.cloud-containment-proof', runId: RUN_ID })

function containmentStub({ valid = true } = {}) {
  return {
    verifyContainmentProof: ({ proof, runId }) => {
      if (!valid)
        throw new BackupError(
          'containment_proof_invalid',
          'the containment proof is not valid here.',
        )
      assert.equal(
        runId,
        RUN_ID,
        'the orchestrator must pass cloudRunId through as the canary runId',
      )
      assert.equal(
        proof,
        PROOF,
        'the orchestrator must pass the caller-supplied proof through unchanged',
      )
      return true
    },
  }
}

const frozenCall = (step, operation, remotePath, boundaryResult, boundaryCode = null) =>
  Object.freeze({
    step,
    operation,
    remotePath,
    boundaryResult,
    boundaryCode,
    reportedFinding: null,
  })

/**
 * Synthesize one upload outcome in the exact shape `executeUploadAttempt()`
 * returns, and land whatever the script says landed on the fake remote.
 */
function synthesizeUploadOutcome(prepared, cloud, sb, script) {
  const {
    uploadedRoles = ROLES,
    code = null,
    status = 'upload_success_reported_pending_readback',
    failedStep = null,
    transferState = 'unknown',
    boundaryCalls = null,
    furthest,
    providerBoundaryCallMade = true,
    writeBoundaryCallMade = true,
    extraOutcomeFields = {},
  } = script

  for (const role of uploadedRoles) {
    cloud.tree.set(prepared.remote[`${role}Path`], {
      nodeKind: 'file',
      state: 'active',
      nodeUid: `obj~${role}`,
      content: fs.readFileSync(sb.files[role]),
    })
  }
  const defaultFurthest =
    uploadedRoles.length === 0 ? null : uploadedRoles[uploadedRoles.length - 1]
  const calls =
    boundaryCalls ??
    uploadedRoles.map((role) =>
      frozenCall(`upload_${role}`, 'upload', prepared.remote[`${role}Path`], 'success'),
    )
  return Object.freeze({
    kind: 'eanhl.cloud-upload-attempt-outcome',
    schemaVersion: 2,
    verification: 'not_performed',
    status,
    code,
    failedStep,
    transferState,
    namespaceState: 'active_folder_confirmed',
    providerBoundaryCallMade,
    writeBoundaryCallMade,
    furthestUploadSuccessReportedRole: furthest === undefined ? defaultFurthest : furthest,
    attempt: Object.freeze({
      ...prepared.attempt,
      finishedAt: new Date(FIXED_FINISH).toISOString(),
    }),
    artifact: prepared.artifact,
    local: prepared.local,
    remote: prepared.remote,
    sourceEvidence: prepared.sourceEvidence,
    boundaryCalls: Object.freeze(calls),
    ...extraOutcomeFields,
  })
}

/**
 * The orchestrator under test: real records + readback sessions, the real
 * one-shot prepared-attempt registry, a scripted upload execute, and a
 * stubbed containment check.
 */
function orchestratorFor(cloud, sb, options = {}) {
  const {
    valid = true,
    now = () => FIXED_FINISH,
    uploadScript = {},
    readbackDeps = {},
    recordsOverrides = {},
    readbackOverrides = () => ({}),
    afterExecuteConsumed = null,
  } = options
  const calls = []
  const captured = { prepared: null }
  const readbackRunner = makeReadbackRunner({
    ...REAL_READBACK_DEPS,
    cloud: cloud.ops,
    ...readbackDeps,
  })
  const orchestrator = makeAttemptOrchestrator({
    upload: {
      prepareUploadAttempt: (a) => {
        calls.push('prepare')
        captured.prepared = prepareUploadAttempt(a)
        return captured.prepared
      },
      executeUploadAttempt: async (a) => {
        calls.push('execute')
        if (a.prepared.disposition === 'refused') return executeUploadAttempt(a) // genuine; zero provider calls
        discardPreparedUploadAttempt({ prepared: a.prepared }) // consume the genuine one-shot entry
        if (afterExecuteConsumed !== null) await afterExecuteConsumed(a.prepared)
        return synthesizeUploadOutcome(a.prepared, cloud, sb, uploadScript)
      },
      discardPreparedUploadAttempt: (a) => {
        calls.push('discard')
        return discardPreparedUploadAttempt(a)
      },
    },
    containment: containmentStub({ valid }),
    records: {
      establishAttemptRecordSession,
      writeAttemptIntent,
      writeAttemptAttestation,
      ...recordsOverrides,
    },
    readback: {
      establishReadbackSession: readbackRunner.establishReadbackSession,
      proveReadbackCapacity: readbackRunner.proveReadbackCapacity,
      setupAttemptWorkspace: readbackRunner.setupAttemptWorkspace,
      readBackAttemptTriple: readbackRunner.readBackAttemptTriple,
      cleanupAttemptWorkspace: readbackRunner.cleanupAttemptWorkspace,
      ...readbackOverrides(readbackRunner),
    },
    now,
  })
  return { orchestrator, calls, captured }
}

/**
 * Exactly-once consumption, proven two ways: the orchestrator made exactly
 * one execute-or-discard call, AND the genuine prepared object is spent in
 * the REAL one-shot registry (a further discard is refused as reused).
 */
function assertConsumedExactlyOnce(wired) {
  const consumptions = wired.calls.filter((c) => c === 'execute' || c === 'discard')
  assert.equal(consumptions.length, 1, `consumed ${consumptions.length} times: ${wired.calls}`)
  assert.throws(
    () => discardPreparedUploadAttempt({ prepared: wired.captured.prepared }),
    (err) => err instanceof BackupError && err.code === 'cloud_upload_prepared_reused',
  )
}

/** The returned report and the durable attestation mean the same thing. */
function assertReportMatchesAttestation(report) {
  assert.equal(report.attestationWritten, true)
  const a = readJson(report.attestationPath)
  assert.equal(report.verdict, a.verdict)
  assert.equal(report.stage, a.stage)
  assert.equal(report.code, a.code)
  assert.equal(report.role, a.role)
  assert.equal(report.termination, a.termination)
  return a
}

/** No injected marker text, stack, or native message reaches any record or the report. */
function assertNoMarker(sb, report) {
  const texts = [JSON.stringify(report)]
  for (const name of fs.readdirSync(sb.attestationDir)) {
    texts.push(fs.readFileSync(path.join(sb.attestationDir, name), 'utf8'))
  }
  for (const t of texts) {
    assert.equal(t.includes(MARKER), false)
    assert.equal(/\bat [\w.<>]+ \(/.test(t), false, 'no stack frame text')
  }
}

const rootOnly = () => makeFakeCloud({ root: ROOT })

function run({ orchestrator }, sb, overrides = {}) {
  return orchestrator.runAttestedAttempt({
    config: configFor(sb),
    artifactBase: BASE,
    cloudRunId: RUN_ID,
    sequence: 0,
    containmentProof: PROOF,
    ...overrides,
  })
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const recordsIn = (sb, suffix) =>
  fs.readdirSync(sb.attestationDir).filter((n) => n.endsWith(suffix))

const REPORT_KEYS = [
  'attemptId',
  'attestationPath',
  'attestationWritten',
  'cleanup',
  'cloudRunId',
  'code',
  'intentPath',
  'intentWritten',
  'kind',
  'lockAction',
  'retryDisposition',
  'role',
  'schemaVersion',
  'sequence',
  'stage',
  'termination',
  'verdict',
]

function assertReportShape(report) {
  assert.deepEqual(Object.keys(report).sort(), REPORT_KEYS)
  assert.equal(report.kind, 'eanhl.cloud-attempt-report')
  assert.match(report.attemptId, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/)
  assert.ok(production.CLOUD_ATTEMPT_RETRY_DISPOSITIONS.includes(report.retryDisposition))
  assert.ok(Object.isFrozen(report))
  assert.ok(Object.isFrozen(report.cleanup))
  assert.throws(() => {
    report.verdict = 'tampered'
  }, TypeError)
}

// ═════════════════════════════════════════════════════════════════════════════
// T13 — the valid round trip
// ═════════════════════════════════════════════════════════════════════════════

test('T13: a valid attempt uploads, reads back, verifies, attests, and cleans up', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb)
  const report = await run(wired, sb)

  assertReportShape(report)
  assert.equal(report.verdict, 'verified')
  assert.equal(report.stage, null)
  assert.equal(report.code, null)
  assert.equal(report.intentWritten, true)
  assert.equal(report.attestationWritten, true)
  assert.equal(report.cleanup.state, 'complete')
  assert.equal(report.lockAction, 'release')
  assert.deepEqual(wired.calls, ['prepare', 'execute']) // never discarded

  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.kind, 'eanhl.cloud-attestation')
  assert.equal(attestation.schema_version, 1)
  assert.equal(attestation.verdict, 'verified')
  assert.equal(attestation.attempt_id, report.attemptId)
  assert.equal(attestation.containment, 'valid')
  assert.equal(attestation.termination, 'confirmed')
  assert.equal(attestation.completion.ok, true)
  assert.equal(attestation.intent_record.state, 'confirmed')
  assert.equal(attestation.cleanup_policy.disposition, 'after_attestation')
  assert.equal(attestation.future_lock_advice, 'release')
  for (const role of ROLES) {
    assert.equal(attestation.readback[role].observed, 'active_file')
    assert.equal(attestation.readback[role].matches_source, true)
    assert.equal(attestation.readback[role].sha256, sha256(fs.readFileSync(sb.files[role])))
    assert.equal(attestation.readback[role].bytes, fs.statSync(sb.files[role]).size)
  }

  const intent = readJson(report.intentPath)
  assert.equal(intent.schema_version, 1)
  assert.equal(intent.source.evidence, 'captured')
  assert.equal(intent.refusal, null)
  assert.equal(intent.attempt_id, report.attemptId)

  // The attestation's binding is the hash of the intent file's own bytes.
  assert.equal(attestation.intent_record.sha256, sha256(fs.readFileSync(report.intentPath)))
  assert.equal(attestation.intent_record.bytes, fs.statSync(report.intentPath).size)
  assert.equal(attestation.intent_record.filename, path.basename(report.intentPath))

  // The workspace is gone; the source triple is untouched.
  assert.equal(fs.existsSync(path.join(sb.readbackDir, `${BASE}.${report.attemptId}`)), false)
  assert.deepEqual(fs.readdirSync(sb.readbackDir), [])
  for (const role of ROLES) assert.ok(fs.existsSync(sb.files[role]))
})

// ═════════════════════════════════════════════════════════════════════════════
// The state machine's exits
// ═════════════════════════════════════════════════════════════════════════════

test('EXIT D: a local refusal is consumed through execute(), makes zero provider calls, and attests as local_refusal', async () => {
  const sb = sandbox({ ciphertext: Buffer.alloc(0) }) // empty ciphertext -> prepare refuses
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb)
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'rejected')
  assert.equal(report.stage, 'local_refusal')
  assert.equal(report.code, 'local_file_empty')
  assert.equal(report.intentWritten, true)
  assert.equal(report.attestationWritten, true)
  assert.equal(report.cleanup.state, 'not_started')
  assert.equal(report.lockAction, 'release')
  assert.deepEqual(wired.calls, ['prepare', 'execute']) // execute, never discard
  assert.equal(cloud.log.length, 0) // zero provider calls

  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.containment, 'not_checked') // the proof was never checked
  assert.equal(attestation.termination, 'not_applicable')
  assert.equal(attestation.readback.performed, false)
  assert.equal(attestation.cleanup_policy.disposition, 'not_applicable')
  const intent = readJson(report.intentPath)
  assert.equal(intent.source.evidence, 'unavailable')
  assert.deepEqual(intent.refusal, { step: 'local_validation', code: 'local_file_empty' })
})

test('EXIT E: an invalid containment proof discards the prepared attempt without executing it', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, { valid: false })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'containment_proof')
  assert.equal(report.code, 'containment_proof_invalid')
  assert.deepEqual(wired.calls, ['prepare', 'discard']) // discarded, never executed
  assert.equal(cloud.log.length, 0)
  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.containment, 'invalid')
  assert.equal(attestation.upload_transfer_state, 'definitely_zero')
  assert.equal(attestation.readback.performed, false)
})

test('EXIT F: a capacity failure discards the prepared attempt and attests at the capacity stage', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb)
  const cfg = configFor(sb)
  cfg.capacity.minFreeBytes = Number.MAX_SAFE_INTEGER
  const report = await wired.orchestrator.runAttestedAttempt({
    config: cfg,
    artifactBase: BASE,
    cloudRunId: RUN_ID,
    sequence: 0,
    containmentProof: PROOF,
  })

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'capacity')
  assert.equal(report.code, 'capacity_insufficient')
  assert.deepEqual(wired.calls, ['prepare', 'discard'])
  assert.equal(cloud.log.length, 0)
  assert.equal(readJson(report.attestationPath).containment, 'valid') // the proof WAS checked, and held
})

test('EXIT G: a workspace failure discards the prepared attempt and attests at the workspace stage', async () => {
  const sb = sandbox()
  fs.chmodSync(sb.readbackDir, 0o500) // still trusted (no group/world bits), but not writable
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb)
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'workspace')
  assert.equal(report.code, 'workspace_setup_failed')
  assert.deepEqual(wired.calls, ['prepare', 'discard'])
  assert.equal(cloud.log.length, 0)
})

test('EXIT B: an untrusted attestation.dir leaves no durable record at all, and still consumes the prepared attempt', async () => {
  const sb = sandbox()
  fs.chmodSync(sb.attestationDir, 0o750) // group-readable -> not trusted
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb)
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'attestation_dir_trust')
  assert.equal(report.code, 'attestation_dir_untrusted')
  assert.equal(report.intentWritten, false)
  assert.equal(report.attestationWritten, false)
  assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
  assert.deepEqual(wired.calls, ['prepare', 'discard'])
  assert.equal(cloud.log.length, 0)
  assert.deepEqual(fs.readdirSync(sb.attestationDir), [])
})

test('EXIT C: an intent write failure still attests, truthfully, and retains the lock', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    recordsOverrides: {
      writeAttemptIntent: () => {
        throw new BackupError(
          'cloud_intent_durability_unconfirmed',
          'the record could not be confirmed.',
        )
      },
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'intent')
  assert.equal(report.code, 'cloud_intent_durability_unconfirmed')
  assert.equal(report.intentWritten, false)
  assert.equal(report.intentPath, null)
  assert.equal(report.attestationWritten, true) // the session's directory trust is otherwise fine
  assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
  assert.deepEqual(wired.calls, ['prepare', 'discard'])
  assert.equal(cloud.log.length, 0)

  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.intent_record.state, 'not_confirmed')
  assert.equal(attestation.intent_record.sha256, null)
  assert.equal(attestation.intent_record.filename, null)
  assert.equal(attestation.containment, 'not_checked')
  assert.equal(recordsIn(sb, CLOUD_ATTEMPT_INTENT_SUFFIX).length, 0)
  assert.equal(recordsIn(sb, CLOUD_ATTESTATION_SUFFIX).length, 1)
})

test('EXIT I: an info-only upload failure stops before readback and attests at the upload stage', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    uploadScript: {
      uploadedRoles: [],
      code: 'remote_root_absent',
      status: 'rejected',
      failedStep: 'preflight_root',
      transferState: 'definitely_zero',
      writeBoundaryCallMade: false,
      boundaryCalls: [frozenCall('preflight_root', 'info', ROOT, 'success')],
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'rejected')
  assert.equal(report.stage, 'upload')
  assert.equal(report.code, 'remote_root_absent')
  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.readback.performed, false)
  assert.equal(attestation.upload_outcome.code, 'remote_root_absent')
  assert.equal(attestation.upload_outcome.failed_step, 'preflight_root')
  assert.equal(attestation.upload_transfer_state, 'definitely_zero')
  assert.equal(attestation.termination, 'confirmed')
  assert.equal(cloud.log.length, 0) // no readback download was attempted
})

// ═════════════════════════════════════════════════════════════════════════════
// E3J6C — the derived retry disposition (R1: collision-only)
// ═════════════════════════════════════════════════════════════════════════════

/** An upload outcome that stopped at a namespace/object preflight that FOUND the path. */
function occupiedAt(step, remotePath) {
  const calls = [
    frozenCall('preflight_root', 'info', ROOT, 'success'),
    frozenCall('preflight_namespace', 'info', 'ns', 'success'),
  ]
  if (step !== 'preflight_namespace') {
    calls.push(frozenCall('create_namespace', 'create-folder', 'ns', 'success'))
    calls.push(frozenCall('confirm_namespace', 'info', 'ns', 'success'))
    calls.push(frozenCall(step, 'info', remotePath, 'success'))
  }
  return {
    uploadedRoles: [],
    code: 'remote_path_occupied',
    status: 'rejected',
    failedStep: step,
    transferState: 'definitely_zero',
    furthest: null,
    writeBoundaryCallMade: step !== 'preflight_namespace',
    boundaryCalls: calls,
  }
}

/** An upload outcome that stopped at the ciphertext upload with an anchored rejection. */
function uploadRejected(boundaryCode, boundaryResult = 'rejected') {
  return {
    uploadedRoles: [],
    code: boundaryResult === 'rejected' ? 'provider_rejected' : 'provider_refused_before_spawn',
    status: 'rejected',
    failedStep: 'upload_ciphertext',
    transferState: 'definitely_zero',
    furthest: null,
    boundaryCalls: [frozenCall('upload_ciphertext', 'upload', 'x', boundaryResult, boundaryCode)],
  }
}

for (const step of [
  'preflight_namespace',
  'preflight_ciphertext',
  'preflight_checksum',
  'preflight_manifest',
]) {
  test(`R1: remote_path_occupied at ${step} is eligible_zero_transfer_collision`, async () => {
    const sb = sandbox()
    const cloud = rootOnly()
    const wired = orchestratorFor(cloud, sb, { uploadScript: occupiedAt(step, 'obj') })
    const report = await run(wired, sb)

    assertReportShape(report)
    assert.equal(report.verdict, 'rejected')
    assert.equal(report.stage, 'upload')
    assert.equal(report.code, 'remote_path_occupied')
    assert.equal(report.lockAction, 'release')
    assert.equal(report.cleanup.state, 'complete')
    assert.equal(report.retryDisposition, 'eligible_zero_transfer_collision')
    const a = assertReportMatchesAttestation(report)
    assert.equal(a.upload_transfer_state, 'definitely_zero')
    assert.equal(a.upload_outcome.failed_step, step)
    assert.equal(a.upload_outcome.boundary_code, null)
  })
}

test('R1: an anchored upload name_conflict is eligible_zero_transfer_collision', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, { uploadScript: uploadRejected('name_conflict') })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'rejected')
  assert.equal(report.code, 'provider_rejected')
  assert.equal(report.retryDisposition, 'eligible_zero_transfer_collision')
  const a = assertReportMatchesAttestation(report)
  assert.equal(a.upload_outcome.boundary_code, 'name_conflict')
})

test('R1: credential_unavailable is the same report code as name_conflict but is NOT eligible', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    uploadScript: uploadRejected('credential_unavailable'),
  })
  const report = await run(wired, sb)

  assert.equal(report.code, 'provider_rejected') // indistinguishable at the report's code level
  assert.equal(report.lockAction, 'release')
  assert.equal(report.retryDisposition, 'not_eligible')
})

for (const boundaryCode of [
  'cli_hash_mismatch',
  'cloud_cli_argv_invalid',
  'cli_executable_unreadable',
]) {
  test(`R1: provider_refused_before_spawn (${boundaryCode}) is NOT eligible`, async () => {
    const sb = sandbox()
    const cloud = rootOnly()
    const wired = orchestratorFor(cloud, sb, {
      uploadScript: uploadRejected(boundaryCode, 'refused_before_spawn'),
    })
    const report = await run(wired, sb)

    assert.equal(report.verdict, 'rejected')
    assert.equal(report.code, 'provider_refused_before_spawn')
    assert.equal(report.lockAction, 'release')
    assert.equal(report.retryDisposition, 'not_eligible')
  })
}

test('R1: a non-collision zero-transfer rejection (remote_root_absent) and a verified attempt are NOT eligible', async () => {
  const sb1 = sandbox()
  const wired1 = orchestratorFor(rootOnly(), sb1, {
    uploadScript: {
      uploadedRoles: [],
      code: 'remote_root_absent',
      status: 'rejected',
      failedStep: 'preflight_root',
      transferState: 'definitely_zero',
      writeBoundaryCallMade: false,
      boundaryCalls: [frozenCall('preflight_root', 'info', ROOT, 'success')],
    },
  })
  const r1 = await run(wired1, sb1)
  assert.equal(r1.verdict, 'rejected')
  assert.equal(r1.retryDisposition, 'not_eligible')

  const sb2 = sandbox()
  const r2 = await run(orchestratorFor(rootOnly(), sb2), sb2)
  assert.equal(r2.verdict, 'verified')
  assert.equal(r2.retryDisposition, 'not_eligible')
})

test('R1: a collision whose workspace cleanup returns incomplete NORMALLY is not eligible, and the lock is still released', async () => {
  const sb = sandbox()
  const wired = orchestratorFor(rootOnly(), sb, {
    uploadScript: occupiedAt('preflight_namespace', 'ns'),
    readbackOverrides: () => ({
      cleanupAttemptWorkspace: async () => Object.freeze({ state: 'incomplete' }),
    }),
  })
  const report = await run(wired, sb)

  assert.equal(report.cleanup.state, 'incomplete')
  assert.equal(report.lockAction, 'release') // E3J6B does not escalate a normal incomplete
  assert.equal(report.retryDisposition, 'not_eligible')
})

test('R1: a collision whose workspace cleanup THROWS escalates the lock and is not eligible', async () => {
  const sb = sandbox()
  const wired = orchestratorFor(rootOnly(), sb, {
    uploadScript: occupiedAt('preflight_namespace', 'ns'),
    readbackOverrides: () => ({
      cleanupAttemptWorkspace: async () => {
        throw new Error(MARKER)
      },
    }),
  })
  const report = await run(wired, sb)

  assert.equal(report.lockAction, 'retain_internal_error')
  assert.equal(report.retryDisposition, 'not_eligible')
  assertNoMarker(sb, report)
})

test('R1: the disposition is derived from the EFFECTIVE written attestation, never from the proposal', async () => {
  const sb = sandbox()
  const wired = orchestratorFor(rootOnly(), sb, {
    uploadScript: occupiedAt('preflight_namespace', 'ns'),
    recordsOverrides: {
      // The real writer runs and writes; the EFFECTIVE record it returns is
      // then made to disagree with the proposal in exactly one R1 field.
      writeAttemptAttestation: (args) => {
        const r = writeAttemptAttestation(args)
        return Object.freeze({
          ...r,
          attestation: Object.freeze({ ...r.attestation, upload_transfer_state: 'unknown' }),
        })
      },
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.lockAction, 'release')
  assert.equal(report.retryDisposition, 'not_eligible')
})

test('R1: with no durable attestation a collision is never eligible', async () => {
  const sb = sandbox()
  const wired = orchestratorFor(rootOnly(), sb, {
    uploadScript: occupiedAt('preflight_namespace', 'ns'),
    recordsOverrides: {
      writeAttemptAttestation: () => {
        throw new BackupError(
          'cloud_attestation_create_failed',
          'the record file could not be created.',
        )
      },
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.attestationWritten, false)
  assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
  assert.equal(report.retryDisposition, 'not_eligible')
})

// ═════════════════════════════════════════════════════════════════════════════
// T11 / T12 — the written-attestation halves
// ═════════════════════════════════════════════════════════════════════════════

test('T11 (written half): a partial upload attests, names all three intended remote paths, and deletes nothing', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    uploadScript: {
      uploadedRoles: ['ciphertext'], // the checksum upload failed; the manifest never ran
      code: 'provider_indeterminate',
      status: 'indeterminate',
      failedStep: 'upload_checksum',
      furthest: 'ciphertext',
      boundaryCalls: [
        frozenCall('upload_ciphertext', 'upload', 'x', 'success'),
        frozenCall('upload_checksum', 'upload', 'y', 'indeterminate', 'provider_timeout'),
      ],
    },
  })
  const report = await run(wired, sb)

  assert.notEqual(report.verdict, 'verified')
  assert.equal(report.attestationWritten, true)
  const attestation = readJson(report.attestationPath)
  const namespace = `${ROOT}/${BASE}.${report.attemptId}`
  assert.equal(attestation.remote.namespace, namespace)
  assert.equal(attestation.remote.ciphertext_path, `${namespace}/${BASE}${SUFFIX.ciphertext}`)
  assert.equal(attestation.remote.checksum_path, `${namespace}/${BASE}${SUFFIX.checksum}`)
  assert.equal(attestation.remote.manifest_path, `${namespace}/${BASE}${SUFFIX.manifest}`)
  // Readback WAS warranted (a prior upload succeeded). It runs manifest-first,
  // and the manifest was never uploaded, so that is where it stops.
  assert.equal(attestation.readback.performed, true)
  assert.equal(attestation.verdict, 'rejected')
  assert.equal(attestation.stage, 'readback')
  assert.equal(attestation.role, 'manifest')
  assert.equal(attestation.code, 'remote_object_absent')
  assert.equal(attestation.readback.manifest.observed, 'absent')
  assert.equal(attestation.readback.checksum.attempted, false)
  assert.equal(attestation.readback.ciphertext.attempted, false)
  // The upload's own evidence survives alongside the readback verdict.
  assert.equal(attestation.upload_outcome.failed_step, 'upload_checksum')
  assert.equal(attestation.upload_outcome.boundary_code, 'provider_timeout')
  assert.equal(attestation.upload_transfer_state, 'unknown')
  // No deletion of any kind was requested, locally or remotely.
  assert.equal(
    cloud.log.some((c) => c.operation === 'delete' || c.operation === 'trash'),
    false,
  )
  for (const role of ROLES) assert.ok(fs.existsSync(sb.files[role]))
})

test('T12 (written half): a cancelled upload leaves transfer UNKNOWN, and readback resolves it by observation', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    uploadScript: {
      uploadedRoles: [],
      code: 'provider_indeterminate',
      status: 'indeterminate',
      failedStep: 'upload_ciphertext',
      furthest: null,
      boundaryCalls: [
        frozenCall('upload_ciphertext', 'upload', 'x', 'indeterminate', 'provider_cancelled'),
      ],
    },
  })
  const report = await run(wired, sb)

  // An ambiguous cancellation warrants readback; readback then finds the
  // object definitively absent. That rejection is earned by independent
  // observation, never copied from the cancellation's own framing.
  assert.equal(report.verdict, 'rejected')
  assert.equal(report.stage, 'readback')
  assert.equal(report.code, 'remote_object_absent')
  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.upload_transfer_state, 'unknown') // never downgraded to definitely_zero
  assert.equal(attestation.upload_outcome.boundary_code, 'provider_cancelled')
  assert.equal(attestation.termination, 'confirmed')
  const serialized = JSON.stringify(attestation)
  for (const forbidden of ['stopped', 'aborted the remote', 'cancelled the upload']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('T12 (written half): a cancellation BEFORE any upload call is indeterminate, never rejected', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const controller = new AbortController()
  controller.abort() // aborted before the attempt even starts
  const wired = orchestratorFor(cloud, sb)
  const report = await run(wired, sb, { signal: controller.signal })

  assert.equal(report.stage, 'local_refusal')
  assert.equal(report.code, 'attempt_cancelled')
  assert.equal(report.verdict, 'indeterminate') // attempt_cancelled is NEVER rejected
  assert.equal(cloud.log.length, 0)
  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.verdict, 'indeterminate')
  assert.equal(attestation.readback.performed, false)
  assert.equal(attestation.containment, 'not_checked')
})

test('T12 (written half): unconfirmed termination withholds cleanup and retains the lock', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({
    root: ROOT,
    respond: (call) => {
      if (call.operation === 'download') {
        return Object.freeze({
          kind: 'indeterminate',
          operation: 'download',
          code: 'provider_termination_unconfirmed',
          transferState: 'unknown',
        })
      }
      return undefined
    },
  })
  const wired = orchestratorFor(cloud, sb)
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.code, 'provider_termination_unconfirmed')
  assert.equal(report.cleanup.state, 'withheld_termination_unconfirmed')
  assert.equal(report.lockAction, 'retain_termination_unconfirmed')

  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.termination, 'unconfirmed')
  assert.equal(attestation.cleanup_policy.disposition, 'withheld_termination_unconfirmed')
  assert.equal(attestation.future_lock_advice, 'retain_termination_unconfirmed')
  // The workspace is still there — nothing was removed.
  assert.equal(fs.existsSync(path.join(sb.readbackDir, `${BASE}.${report.attemptId}`)), true)
})

// ═════════════════════════════════════════════════════════════════════════════
// T16 / T17 / intent binding / clock
// ═════════════════════════════════════════════════════════════════════════════

test('T16: a substituted remote triple is rejected by the independent source-hash comparison', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const substituted = Buffer.alloc(1000, 42) // a different body of the same length
  const wired = orchestratorFor(cloud, sb, {
    readbackDeps: {
      cloud: {
        runInfo: (p) => cloud.ops.runInfo(p),
        runContainedDownload: (params) => {
          if (params.remotePath.endsWith(SUFFIX.ciphertext)) {
            const node = cloud.tree.get(params.remotePath)
            if (node) node.content = substituted
          }
          return cloud.ops.runContainedDownload(params)
        },
      },
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'rejected')
  assert.equal(report.stage, 'readback')
  assert.equal(report.code, 'role_hash_mismatch')
  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.role, 'ciphertext')
  assert.equal(attestation.readback.ciphertext.matches_source, false)
  assert.equal(attestation.readback.manifest.matches_source, true) // the small roles matched first
  assert.equal(attestation.completion.checked, false) // never reached; nothing was parsed
})

test('T17: two attempts for one artifact produce two distinct, immutable record pairs', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const first = await run(orchestratorFor(cloud, sb), sb)
  assert.equal(first.verdict, 'verified')
  const firstBytes = fs.readFileSync(first.attestationPath)

  const second = await run(orchestratorFor(cloud, sb), sb, { sequence: 1 })
  assert.notEqual(second.attemptId, first.attemptId)

  assert.equal(recordsIn(sb, CLOUD_ATTEMPT_INTENT_SUFFIX).length, 2)
  assert.equal(recordsIn(sb, CLOUD_ATTESTATION_SUFFIX).length, 2)
  assert.notEqual(second.attestationPath, first.attestationPath)
  // The first attempt's record is byte-identical to what it wrote.
  assert.ok(fs.readFileSync(first.attestationPath).equals(firstBytes))
  assert.equal(readJson(first.attestationPath).sequence, 0)
  assert.equal(readJson(second.attestationPath).sequence, 1)
})

test('an intent tampered with between its own write and the attestation is never claimed as confirmed', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackDeps: {
      cloud: {
        runInfo: (p) => cloud.ops.runInfo(p),
        runContainedDownload: (params) => {
          // Tamper with the durably written intent, mid-attempt.
          const [name] = recordsIn(sb, CLOUD_ATTEMPT_INTENT_SUFFIX)
          if (name) {
            const p = path.join(sb.attestationDir, name)
            const original = fs.readFileSync(p, 'utf8')
            if (!original.includes('"sequence":9')) {
              fs.rmSync(p)
              fs.writeFileSync(p, original.replace('"sequence":0', '"sequence":9'), { mode: 0o600 })
            }
          }
          return cloud.ops.runContainedDownload(params)
        },
      },
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.attestationWritten, true)
  assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.intent_record.state, 'not_confirmed')
  assert.equal(attestation.verdict, 'indeterminate')
  assert.equal(attestation.code, 'intent_record_lost')
})

test('an unusable finishing clock is recorded explicitly and forces indeterminate', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    now: () => {
      throw new Error(`clock exploded ${MARKER}`)
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'internal')
  assert.equal(report.code, 'clock_unusable')
  assert.equal(report.attestationWritten, true)
  const attestation = readJson(report.attestationPath)
  assert.equal(attestation.finished_at, null)
  assert.equal(attestation.finish_time_state, 'unavailable')
  assert.match(attestation.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) // still required
  assert.equal(JSON.stringify(attestation).includes(MARKER), false)
})

// ═════════════════════════════════════════════════════════════════════════════
// T8 (written half) — recursive marker containment
// ═════════════════════════════════════════════════════════════════════════════

test('T8 (written half): no injected marker reaches the intent bytes, the attestation bytes, the report, or a thrown error', async () => {
  const sb = sandbox()
  const cloud = makeFakeCloud({
    root: ROOT,
    respond: (call) => {
      if (call.operation === 'download') {
        // A provider-shaped result carrying marker material at several depths.
        return Object.freeze({
          kind: 'indeterminate',
          operation: 'download',
          code: 'provider_error_unrecognised',
          transferState: 'unknown',
          token: MARKER,
          session: { password: MARKER, nested: { recovery: `https://auth.example/${MARKER}` } },
          email: `${MARKER}@example.com`,
        })
      }
      return undefined
    },
  })
  const wired = orchestratorFor(cloud, sb, {
    uploadScript: {
      // The upload outcome itself also carries marker-shaped extra fields.
      extraOutcomeFields: {
        token: MARKER,
        credentials: { passphrase: MARKER },
      },
    },
  })
  const report = await run(wired, sb)

  for (const [what, text] of [
    ['intent', fs.readFileSync(report.intentPath, 'utf8')],
    ['attestation', fs.readFileSync(report.attestationPath, 'utf8')],
    ['report', JSON.stringify(report)],
  ]) {
    assert.equal(text.includes(MARKER), false, `${what} leaked the marker`)
    assert.equal(
      /token|password|passphrase|recovery|@example\.com/i.test(text),
      false,
      `${what} leaked a secret-shaped key`,
    )
  }

  // A thrown error on the same path leaks nothing either.
  await assert.rejects(
    () =>
      orchestratorFor(cloud, sb).orchestrator.runAttestedAttempt({
        config: configFor(sb),
        artifactBase: `${MARKER}-20260904T180007Z`,
        cloudRunId: RUN_ID,
        sequence: 0,
        containmentProof: PROOF,
      }),
    (err) => {
      assert.ok(err instanceof BackupError)
      assert.equal(String(err.message).includes(MARKER), false)
      assert.equal(err.cause, undefined)
      return true
    },
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// Totality after preparation — every exit consumes exactly once, no exception escapes
// ═════════════════════════════════════════════════════════════════════════════

const markerError = () => new Error(`native detail ${MARKER} /private/path/${MARKER}`)
const workspaceOf = (sb, report) => path.join(sb.readbackDir, `${BASE}.${report.attemptId}`)

test('TOTALITY: a THROWN capacity proof becomes a closed internal outcome, discards once, attests, and leaks nothing', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackOverrides: () => ({
      proveReadbackCapacity: async () => {
        throw markerError()
      },
    }),
  })
  const report = await run(wired, sb)

  assertReportShape(report)
  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'internal')
  assert.equal(report.code, 'internal_invariant_violated')
  assert.equal(report.lockAction, 'retain_internal_error')
  assert.equal(report.cleanup.state, 'not_started')
  assert.deepEqual(wired.calls, ['prepare', 'discard'])
  assertConsumedExactlyOnce(wired)
  const a = assertReportMatchesAttestation(report)
  assert.equal(a.future_lock_advice, report.lockAction)
  assert.equal(a.cleanup_policy.disposition, 'not_applicable')
  assert.equal(cloud.log.length, 0)
  assertNoMarker(sb, report)
})

test('TOTALITY: a classified capacity BackupError keeps its closed code at the capacity stage', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackOverrides: () => ({
      proveReadbackCapacity: async () => {
        throw new BackupError('readback_dir_identity_changed', `changed ${MARKER}`)
      },
    }),
  })
  const report = await run(wired, sb)
  assert.equal(report.stage, 'capacity')
  assert.equal(report.code, 'readback_dir_identity_changed')
  assertConsumedExactlyOnce(wired)
  assertReportMatchesAttestation(report)
  assertNoMarker(sb, report)
})

test('TOTALITY: a THROWN workspace setup AFTER partial creation still attests first, then cleans exactly what was created', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackOverrides: (runner) => ({
      setupAttemptWorkspace: async (a) => {
        await runner.setupAttemptWorkspace(a) // really creates the workspace + role dirs
        throw markerError()
      },
    }),
  })
  const report = await run(wired, sb)

  assert.equal(report.stage, 'internal')
  assert.equal(report.code, 'internal_invariant_violated')
  assert.deepEqual(wired.calls, ['prepare', 'discard'])
  assertConsumedExactlyOnce(wired)
  const a = assertReportMatchesAttestation(report)
  assert.equal(a.cleanup_policy.disposition, 'after_attestation')
  assert.equal(report.cleanup.state, 'complete')
  assert.equal(report.lockAction, 'retain_internal_error')
  assert.deepEqual(fs.readdirSync(sb.readbackDir), []) // nothing authenticated left behind
  assertNoMarker(sb, report)
})

test('TOTALITY: a mkdir failure part-way through setup is workspace_setup_failed, attested, and fully cleaned', async () => {
  for (const failAt of ['manifest', 'checksum', 'ciphertext']) {
    const sb = sandbox()
    const cloud = rootOnly()
    const wired = orchestratorFor(cloud, sb, {
      readbackDeps: {
        mkdir: (p, mode) => {
          if (p.endsWith(`/${failAt}`)) throw Object.assign(markerError(), { code: 'EIO' })
          return fs.mkdirSync(p, { mode })
        },
      },
    })
    const report = await run(wired, sb)
    assert.equal(report.stage, 'workspace', failAt)
    assert.equal(report.code, 'workspace_setup_failed', failAt)
    assertConsumedExactlyOnce(wired)
    assertReportMatchesAttestation(report)
    assert.equal(report.cleanup.state, 'complete', failAt)
    assert.equal(report.lockAction, 'release', failAt)
    assert.deepEqual(fs.readdirSync(sb.readbackDir), [], failAt)
    assertNoMarker(sb, report)
  }
})

test('TOTALITY: a THROWN upload execution is internal, termination UNCONFIRMED, cleanup withheld, consumed exactly once', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    afterExecuteConsumed: async () => {
      throw markerError()
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'internal')
  assert.equal(report.termination, 'unconfirmed')
  assert.equal(report.cleanup.state, 'withheld_termination_unconfirmed')
  assert.equal(report.lockAction, 'retain_termination_unconfirmed')
  assert.deepEqual(wired.calls, ['prepare', 'execute']) // never also discarded
  assertConsumedExactlyOnce(wired)
  const a = assertReportMatchesAttestation(report)
  assert.equal(a.upload_transfer_state, 'unknown')
  assert.equal(fs.existsSync(workspaceOf(sb, report)), true) // withheld: nothing removed
  assertNoMarker(sb, report)
})

test('TOTALITY: a THROWN readback is internal, termination UNCONFIRMED, cleanup withheld', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackOverrides: () => ({
      readBackAttemptTriple: async () => {
        throw markerError()
      },
    }),
  })
  const report = await run(wired, sb)

  assert.equal(report.stage, 'internal')
  assert.equal(report.termination, 'unconfirmed')
  assert.equal(report.cleanup.state, 'withheld_termination_unconfirmed')
  assert.equal(report.lockAction, 'retain_termination_unconfirmed')
  assertConsumedExactlyOnce(wired)
  assertReportMatchesAttestation(report)
  assertNoMarker(sb, report)
})

test('TOTALITY: a THROWING completion adapter is completion_adapter_internal_contradiction, never verified', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackDeps: {
      verifyCompletion: () => {
        throw markerError()
      },
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'completion')
  assert.equal(report.code, 'completion_adapter_internal_contradiction')
  assert.equal(report.cleanup.state, 'complete')
  assertConsumedExactlyOnce(wired)
  const a = assertReportMatchesAttestation(report)
  assert.deepEqual(a.completion, { checked: true, ok: false })
  assertNoMarker(sb, report)
})

test('TOTALITY: a malformed upload outcome that breaks verdict derivation is internal, never verified', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    uploadScript: { extraOutcomeFields: { boundaryCalls: null } },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'internal')
  assert.equal(report.termination, 'unconfirmed') // the evidence cannot prove every child ended
  assertConsumedExactlyOnce(wired)
  assertReportMatchesAttestation(report)
})

test('TOTALITY: a THROWN attestation write never reports verified, and nothing is cleaned without a durable record', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    recordsOverrides: {
      writeAttemptAttestation: () => {
        throw markerError()
      },
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.attestationWritten, false)
  assert.equal(report.verdict, 'indeterminate') // the readback verified — but it is not durable
  assert.equal(report.stage, 'attestation')
  assert.equal(report.code, 'internal_invariant_violated')
  assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
  assert.equal(report.cleanup.state, 'not_started')
  assert.equal(fs.existsSync(workspaceOf(sb, report)), true)
  assertConsumedExactlyOnce(wired)
  assertNoMarker(sb, report)
})

test('TOTALITY: a classified attestation durability failure is reported by its closed code', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    recordsOverrides: {
      writeAttemptAttestation: () => {
        throw new BackupError('cloud_attestation_durability_unconfirmed', `x ${MARKER}`)
      },
    },
  })
  const report = await run(wired, sb)
  assert.equal(report.stage, 'attestation')
  assert.equal(report.code, 'cloud_attestation_durability_unconfirmed')
  assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
  assertNoMarker(sb, report)
})

test('TOTALITY: a THROWN cleanup is incomplete and escalates the lock to retain_internal_error', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackOverrides: () => ({
      cleanupAttemptWorkspace: async () => {
        throw markerError()
      },
    }),
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'verified') // the durable record is genuinely verified…
  assert.equal(report.cleanup.state, 'incomplete') // …but cleanup is uncertain
  assert.equal(report.lockAction, 'retain_internal_error')
  const a = assertReportMatchesAttestation(report)
  assert.equal(a.future_lock_advice, 'release') // advice at attestation time; the report escalates
  assertConsumedExactlyOnce(wired)
  assertNoMarker(sb, report)
})

test('TOTALITY: an unconfirmed UPLOAD child stops before readback — no download while a writer may be alive', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    uploadScript: {
      uploadedRoles: ['ciphertext'],
      code: 'provider_indeterminate',
      status: 'indeterminate',
      failedStep: 'upload_checksum',
      furthest: 'ciphertext',
      boundaryCalls: [
        frozenCall('upload_ciphertext', 'upload', '/x', 'success'),
        frozenCall(
          'upload_checksum',
          'upload',
          '/y',
          'indeterminate',
          'provider_termination_unconfirmed',
        ),
      ],
    },
  })
  const report = await run(wired, sb)

  assert.equal(report.verdict, 'indeterminate')
  assert.equal(report.stage, 'upload')
  assert.equal(report.code, 'provider_indeterminate')
  assert.equal(report.termination, 'unconfirmed')
  assert.equal(report.lockAction, 'retain_termination_unconfirmed')
  assert.equal(report.cleanup.state, 'withheld_termination_unconfirmed')
  assert.equal(cloud.log.filter((c) => c.operation === 'download').length, 0)
  const a = assertReportMatchesAttestation(report)
  assert.equal(a.readback.performed, false)
  assert.equal(a.upload_outcome.boundary_code, 'provider_termination_unconfirmed')
})

// ═════════════════════════════════════════════════════════════════════════════
// Report ⇔ durable attestation, and closed intent-failure codes
// ═════════════════════════════════════════════════════════════════════════════

test('INTENT LOSS: the returned report is built from the effective attestation, never the verified proposal', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const wired = orchestratorFor(cloud, sb, {
    readbackDeps: {
      cloud: {
        runInfo: (p) => cloud.ops.runInfo(p),
        runContainedDownload: (params) => {
          const [name] = recordsIn(sb, CLOUD_ATTEMPT_INTENT_SUFFIX)
          if (name) fs.rmSync(path.join(sb.attestationDir, name), { force: true }) // intent lost
          return cloud.ops.runContainedDownload(params)
        },
      },
    },
  })
  const report = await run(wired, sb)

  const a = assertReportMatchesAttestation(report)
  assert.equal(a.intent_record.state, 'not_confirmed')
  assert.equal(report.verdict, 'indeterminate') // NOT the verified proposal
  assert.equal(report.stage, 'internal')
  assert.equal(report.code, 'intent_record_lost')
  assert.equal(report.role, null)
  assert.equal(report.lockAction, a.future_lock_advice)
  assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
  assertConsumedExactlyOnce(wired)
})

test('INTENT CODES: every closed intent failure keeps its own code; anything else is internal', async () => {
  for (const [thrown, stage, code] of [
    [new BackupError('cloud_intent_create_failed', 'x'), 'intent', 'cloud_intent_create_failed'],
    [
      new BackupError('cloud_intent_durability_unconfirmed', 'x'),
      'intent',
      'cloud_intent_durability_unconfirmed',
    ],
    [new BackupError('cloud_intent_schema_invalid', 'x'), 'intent', 'cloud_intent_schema_invalid'],
    [new BackupError('attestation_dir_untrusted', 'x'), 'intent', 'attestation_dir_untrusted'],
    [new BackupError('some_unlisted_code', MARKER), 'internal', 'internal_invariant_violated'],
    [markerError(), 'internal', 'internal_invariant_violated'],
  ]) {
    const sb = sandbox()
    const cloud = rootOnly()
    const wired = orchestratorFor(cloud, sb, {
      recordsOverrides: {
        writeAttemptIntent: () => {
          throw thrown
        },
      },
    })
    const report = await run(wired, sb)
    assert.equal(report.stage, stage, code)
    assert.equal(report.code, code)
    assert.equal(report.intentWritten, false)
    assert.equal(report.lockAction, 'retain_attestation_unconfirmed')
    assertConsumedExactlyOnce(wired)
    assertReportMatchesAttestation(report)
    assertNoMarker(sb, report)
  }
})

test('INTENT CODES: a real pre-existing intent file is cloud_intent_create_failed, and the existing file is untouched', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  let occupied = null
  const wired = orchestratorFor(cloud, sb, {
    recordsOverrides: {
      writeAttemptIntent: (a) => {
        // Occupy the exact intent path first, then let the REAL writer run.
        const name = `${a.intentFields.artifact.base}.${wired.captured.prepared.attempt.attemptId}${CLOUD_ATTEMPT_INTENT_SUFFIX}`
        occupied = path.join(sb.attestationDir, name)
        fs.writeFileSync(occupied, 'occupied', { mode: 0o600 })
        return writeAttemptIntent(a)
      },
    },
  })
  const report = await run(wired, sb)
  assert.equal(report.stage, 'intent')
  assert.equal(report.code, 'cloud_intent_create_failed')
  assert.equal(fs.readFileSync(occupied, 'utf8'), 'occupied')
  assertConsumedExactlyOnce(wired)
})

// ═════════════════════════════════════════════════════════════════════════════
// Input validation, export surface, static absence
// ═════════════════════════════════════════════════════════════════════════════

test('public inputs are validated before any attempt identity exists', async () => {
  const sb = sandbox()
  const cloud = rootOnly()
  const { orchestrator } = orchestratorFor(cloud, sb)
  const base = {
    config: configFor(sb),
    artifactBase: BASE,
    cloudRunId: RUN_ID,
    sequence: 0,
    containmentProof: PROOF,
  }

  for (const [field, value] of [
    ['cloudRunId', 'not-a-run-id'],
    ['cloudRunId', undefined],
    ['sequence', -1],
    ['sequence', 1.5],
    ['sequence', '0'],
    ['containmentProof', null],
    ['containmentProof', 'proof'],
    ['signal', { aborted: false }],
  ]) {
    await assert.rejects(
      () => orchestrator.runAttestedAttempt({ ...base, [field]: value }),
      (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
      `${field}=${String(value)}`,
    )
  }
  assert.equal(cloud.log.length, 0)
  assert.deepEqual(fs.readdirSync(sb.attestationDir), []) // no record for a non-existent identity
})

test('production API: the closed export surface, with no dependency injection', () => {
  assert.deepEqual(Object.keys(production).sort(), [
    'CLOUD_ATTEMPT_LOCK_ACTIONS',
    'CLOUD_ATTEMPT_RETRY_DISPOSITIONS',
    'CLOUD_ATTEMPT_STAGES',
    'CLOUD_ATTEMPT_VERDICTS',
    'CLOUD_CONTAINMENT_STATES',
    'CLOUD_WORKSPACE_CLEANUP_STATES',
    'runAttestedAttempt',
  ])
  for (const name of Object.keys(production)) {
    if (typeof production[name] !== 'function') assert.ok(Object.isFrozen(production[name]))
  }
  const src = fs.readFileSync(path.join(HERE, 'backup-cloud-attempt.mjs'), 'utf8')
  const signature = /export async function runAttestedAttempt\(args\)[\s\S]*?\n}/.exec(src)[0]
  assert.equal(/\bdeps\b/.test(signature), false)
})

test('static: no ops/** module other than backup-cloud-attempt.mjs and this suite imports the orchestrator core', () => {
  const opsRoot = path.resolve(HERE, '..', '..')
  const allowed = new Set([
    path.join(HERE, 'backup-cloud-attempt.mjs'),
    path.join(HERE, 'backup-cloud-attempt.test.mjs'),
    path.join(HERE, 'internal', 'backup-cloud-attempt-orchestrator-core.mjs'),
  ])
  const IMPORTS_CORE =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-cloud-attempt-orchestrator-core\.mjs['"]/
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

test('static: the orchestrator core performs no filesystem or process work of its own', () => {
  const src = fs.readFileSync(
    path.join(HERE, 'internal', 'backup-cloud-attempt-orchestrator-core.mjs'),
    'utf8',
  )
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const forbidden of [
    /\bfrom 'node:fs'/,
    /\bchild_process\b/,
    /\bspawn\b/,
    /\bunlinkSync\b/,
    /\brmSync\b/,
    /\bmkdirSync\b/,
    /\bopenSync\b/,
    /\bmakeRealDeps\b/,
  ]) {
    assert.equal(forbidden.test(code), false, `forbidden construct ${forbidden}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// PRODUCTION ROUTE — the real boundary, the real canary, the fake executable
// ═════════════════════════════════════════════════════════════════════════════

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
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
const rawTransfer = (bytes) =>
  JSON.stringify({
    transferredItems: 1,
    transferredBytes: bytes,
    skippedItems: 0,
    failedItems: 0,
    failures: [],
  })
const NOT_FOUND = { notFoundForQueriedBasename: true }

test(
  'production route: a full verified attempt through the real boundary, the real prlimit wrapper, and the real canary',
  { skip: HAS_REAL_PRLIMIT ? false : `${REAL_PRLIMIT} is not present on this host` },
  async () => {
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

    const config = configFor(sb, {
      cli: { executable: launcher, expectedSha512: sha512(launcher) },
      readback: {
        dir: sb.readbackDir,
        maxCiphertextBytes: 1_000_000,
        maxManifestBytes: 65_536,
        maxSidecarBytes: 4096,
        containment: 'rlimit_fsize',
        rlimitWrapper: { executable: REAL_PRLIMIT, expectedSha512: sha512(REAL_PRLIMIT) },
      },
    })

    // A REAL containment proof, from the real canary, under the real prlimit.
    const canary = await proveReadbackContainment({ config, runId: RUN_ID })
    assert.equal(canary.kind, 'proven', `canary refused: ${canary.code ?? ''}`)

    // The scripted sequence: the E3J5 upload flow, then E3J6B's readback —
    // three `info` calls and three contained downloads, in readback order
    // (manifest, checksum, ciphertext), each writing back the EXACT source
    // bytes so the independent hash comparison can succeed.
    const bodies = Object.fromEntries(ROLES.map((r) => [r, fs.readFileSync(sb.files[r])]))
    const size = (r) => bodies[r].length
    const downloadStep = (r) => ({
      downloadWrite: { base64: bodies[r].toString('base64') },
      stdout: rawTransfer(size(r)),
    })
    fs.writeFileSync(
      path.join(control, 'response.json'),
      JSON.stringify({
        sequence: [
          { stdout: rawInfo('folder', 'root~uid') }, // info root
          NOT_FOUND, // info namespace (absent)
          { stdout: JSON.stringify({ created: true, folderUid: 'ns~uid' }) }, // create-folder
          { stdout: rawInfo('folder', 'ns~uid') }, // confirm namespace
          NOT_FOUND, // info ciphertext
          NOT_FOUND, // info checksum
          NOT_FOUND, // info manifest
          { stdout: rawTransfer(size('ciphertext')) },
          { stdout: rawTransfer(size('checksum')) },
          { stdout: rawTransfer(size('manifest')) },
          // readback, in manifest -> checksum -> ciphertext order
          { stdout: rawInfo('file', 'mf~uid') },
          downloadStep('manifest'),
          { stdout: rawInfo('file', 'cs~uid') },
          downloadStep('checksum'),
          { stdout: rawInfo('file', 'ct~uid') },
          downloadStep('ciphertext'),
        ],
      }),
    )

    const report = await production.runAttestedAttempt({
      config,
      artifactBase: BASE,
      cloudRunId: RUN_ID,
      sequence: 0,
      containmentProof: canary.proof,
    })

    assertReportShape(report)
    assert.equal(
      report.verdict,
      'verified',
      `unexpected: ${report.stage ?? ''}/${report.code ?? ''}`,
    )
    assert.equal(report.attestationWritten, true)
    assert.equal(report.cleanup.state, 'complete')
    assert.equal(report.lockAction, 'release')

    const attestation = readJson(report.attestationPath)
    assert.equal(attestation.verdict, 'verified')
    assert.equal(attestation.intent_record.state, 'confirmed')
    assert.equal(attestation.containment, 'valid')
    for (const role of ROLES) {
      assert.equal(attestation.readback[role].matches_source, true)
      assert.equal(attestation.readback[role].sha256, sha256(bodies[role]))
    }

    // The contained downloads really ran, through the pinned wrapper.
    const argv = fs
      .readFileSync(path.join(control, 'argv.log'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    assert.equal(argv.filter((a) => a[1] === 'download').length, 3)
    assert.equal(argv.filter((a) => a[1] === 'upload').length, 3)
  },
)
