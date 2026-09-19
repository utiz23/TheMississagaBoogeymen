/**
 * One locked cloud-backup run — E3J6C (T18, the lock disposition, and the
 * run summary).
 *
 * FACTORY-route tests drive `makeCloudRunner(deps)` with scripted fakes for
 * the lock, the canary, and the attempt, so every decision the run makes —
 * retry, stop, release, retain — is exercised exhaustively and cheaply.
 *
 * PRODUCTION-route tests drive the real `runCloudBackup()` export: the real
 * run lock, the real canary under the real `/usr/bin/prlimit`, and the real
 * attested attempt, spawning ONLY `testdoubles/fake-proton-drive.mjs`. They
 * never run the real Proton Drive CLI, contact a provider, or read a
 * credential.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { getEventListeners } from 'node:events'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { BackupError } from './backup-artifact-contract.mjs'
import * as production from './backup-cloud-run.mjs'
import { projectCloudRunSummary } from './internal/backup-cloud-entrypoint-core.mjs'
import {
  CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE,
  CLOUD_RUN_LOCK_SUMMARY_STATES,
  CLOUD_RUN_OUTCOMES,
  CLOUD_RUN_STOP_REASONS,
  REAL_RUN_DEPS,
  decideAfterAttempt,
  deriveRunOutcome,
  makeCloudRunner,
  projectAttemptReport,
  validateContainmentResult,
} from './internal/backup-cloud-run-core.mjs'
import {
  BASE,
  HAS_REAL_PRLIMIT,
  REAL_PRLIMIT,
  makeCloudRunSandbox,
  objectOccupiedSteps,
  uploadNameConflictSteps,
  verifiedAttemptSteps,
} from './testdoubles/cloud-run-sandbox.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-run', warnAfterMs: 8_000, intervalMs: 4_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MARKER = 'SECRET-MARKER-e3j6c-run-51d0'
const SHA512_A = '0123456789abcdef'.repeat(8)
const SHA512_B = 'fedcba9876543210'.repeat(8)
const FIXED_NOW = Date.parse('2026-09-19T12:00:00.000Z')

const sandboxes = []
afterEach(() => {
  for (const sb of sandboxes.splice(0)) sb.cleanup()
})

/** A syntactically valid config for FACTORY tests (no filesystem is touched by the fakes). */
function configFor(retry = {}) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: SHA512_A },
    credentials: { backend: 'pass' },
    remote: { root: '/proton/eanhl-backups' },
    artifact: { sourceDir: '/data/eanhl/artifacts' },
    attestation: { dir: '/data/eanhl/attest' },
    readback: {
      dir: '/data/eanhl/readback',
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: { executable: '/usr/bin/prlimit', expectedSha512: SHA512_B },
    },
    run: {
      lockFile: '/data/eanhl/run/uploader.lock',
      operationTimeoutMs: 5_000,
      cancelGraceMs: 500,
    },
    retry: { maxAttemptsPerArtifactPerRun: 3, backoffMs: 25, maxTotalAttemptsPerRun: 3, ...retry },
    capacity: { minFreeBytes: 1, backingVolume: null },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scripted fakes.
// ─────────────────────────────────────────────────────────────────────────────

const PROOF = Object.freeze({ kind: 'eanhl.cloud-containment-proof' })
const HANDLE = Object.freeze({})
let idCounter = 0
const freshAttemptId = () =>
  `20260919T12${String(idCounter++ % 60).padStart(2, '0')}00Z-${(0xa0000000 + idCounter).toString(16)}`

/** A frozen E3J6B-shaped attempt report, coherent by default. */
function report(args, overrides = {}) {
  const base = {
    kind: 'eanhl.cloud-attempt-report',
    schemaVersion: 1,
    attemptId: freshAttemptId(),
    cloudRunId: args.cloudRunId,
    sequence: args.sequence,
    verdict: 'verified',
    stage: null,
    code: null,
    role: null,
    termination: 'confirmed',
    intentWritten: true,
    intentPath: '/data/eanhl/attest/intent.json',
    attestationWritten: true,
    attestationPath: '/data/eanhl/attest/attestation.json',
    cleanup: Object.freeze({ state: 'complete', workspacePath: '/data/eanhl/readback/ws' }),
    lockAction: 'release',
    retryDisposition: 'not_eligible',
    ...overrides,
  }
  return Object.freeze(base)
}
const collision = (args, extra = {}) =>
  report(args, {
    verdict: 'rejected',
    stage: 'upload',
    code: 'remote_path_occupied',
    retryDisposition: 'eligible_zero_transfer_collision',
    ...extra,
  })
const verified = (args) => report(args)
const indeterminate = (args, extra = {}) =>
  report(args, {
    verdict: 'indeterminate',
    stage: 'upload',
    code: 'provider_indeterminate',
    ...extra,
  })

/**
 * The runner over scripted fakes. `attempts` is a list of `(args) => report`
 * (or a function that throws), consumed in order. Every call is logged.
 */
function runnerFor(options = {}) {
  const log = []
  const {
    attempts = [verified],
    acquire = () => Object.freeze({ kind: 'acquired', handle: HANDLE }),
    held = () => Object.freeze({ state: 'held', code: null }),
    release = () => Object.freeze({ state: 'released', code: null }),
    retain = ({ reason }) => Object.freeze({ state: 'retained', reason }),
    prove = () => Object.freeze({ kind: 'proven', proof: PROOF, cleanup: 'complete' }),
    verify = ({ proof }) => proof === PROOF,
    now = () => FIXED_NOW,
    randomToken = (n) => 'ab'.repeat(n),
    yieldBeforeLock = async () => {},
    sleep = async () => 'elapsed',
  } = options
  const queue = attempts.slice()
  const state = { overrun: false }
  const runner = makeCloudRunner({
    lock: {
      acquireRunLock: (a) => {
        log.push({ op: 'acquire', a })
        return acquire(a)
      },
      verifyRunLockHeld: (a) => {
        log.push({ op: 'held' })
        return held(a)
      },
      releaseRunLock: (a) => {
        log.push({ op: 'release', handle: a.handle })
        return release(a)
      },
      retainRunLock: (a) => {
        log.push({ op: 'retain', reason: a.reason })
        return retain(a)
      },
    },
    containment: {
      proveReadbackContainment: async (a) => {
        log.push({ op: 'prove', runId: a.runId })
        return prove(a)
      },
      verifyContainmentProof: (a) => {
        log.push({ op: 'verify' })
        return verify(a)
      },
    },
    attempt: {
      runAttestedAttempt: async (a) => {
        log.push({ op: 'attempt', sequence: a.sequence, proof: a.containmentProof })
        const next = queue.shift()
        if (next === undefined) {
          // Recorded, not just thrown: the run converts any throw into
          // `attempt_threw`, which must never mask an over-ask.
          state.overrun = true
          throw new Error('the run asked for more attempts than were scripted')
        }
        return next(a)
      },
    },
    now,
    randomToken,
    yieldBeforeLock: async () => {
      log.push({ op: 'yield' })
      return yieldBeforeLock()
    },
    sleep: async (ms, signal) => {
      log.push({ op: 'sleep', ms })
      return sleep(ms, signal)
    },
  })
  return { runner, log, state, ops: () => log.map((e) => e.op) }
}

/**
 * The entrypoint treats a run's summary as UNTRUSTED and re-projects it. Every
 * summary the real run core produces must pass that projection unchanged —
 * the guard against the entrypoint's validation being stricter than the run.
 */
function assertEntrypointAccepts(s, retry) {
  const p = projectCloudRunSummary(s, { artifactBase: BASE, retry })
  assert.notEqual(p, null, `the entrypoint projection refused a real run summary: ${s.stopReason}`)
  assert.equal(JSON.stringify(p), JSON.stringify(s))
}

async function go({ runner, state }, extra = {}) {
  const config = configFor(extra.retry)
  const s = await runner.runCloudBackup({
    config,
    artifactBase: BASE,
    ...extra.args,
  })
  assert.equal(state.overrun, false, 'the run asked for more attempts than were scripted')
  assertEntrypointAccepts(s, config.retry)
  return s
}

/** Every level of the summary is frozen, its keys are exact, and nothing leaked. */
function assertSummaryShape(s) {
  assert.ok(Object.isFrozen(s))
  assert.deepEqual(Object.keys(s).sort(), [
    'artifactBase',
    'attempts',
    'cancellationRequested',
    'cloudRunId',
    'containment',
    'kind',
    'lock',
    'outcome',
    'schemaVersion',
    'stopReason',
    'verifiedAttemptId',
  ])
  assert.equal(s.kind, 'eanhl.cloud-run-summary')
  assert.equal(s.schemaVersion, 1)
  assert.ok(Object.isFrozen(s.lock))
  assert.deepEqual(Object.keys(s.lock).sort(), ['code', 'state'])
  assert.ok(Object.isFrozen(s.containment))
  assert.ok(Object.isFrozen(s.attempts))
  for (const a of s.attempts) {
    assert.ok(Object.isFrozen(a))
    assert.deepEqual(Object.keys(a).sort(), [
      'attemptId',
      'attestationWritten',
      'cleanupState',
      'code',
      'lockAction',
      'retryDisposition',
      'role',
      'sequence',
      'stage',
      'termination',
      'verdict',
    ])
  }
  assert.ok(CLOUD_RUN_OUTCOMES.includes(s.outcome))
  assert.ok(CLOUD_RUN_STOP_REASONS.includes(s.stopReason))
  assert.ok(CLOUD_RUN_LOCK_SUMMARY_STATES.includes(s.lock.state))
  assert.ok(CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE[s.lock.state].includes(s.lock.code))
  assert.equal(
    s.outcome,
    deriveRunOutcome({
      lockState: s.lock.state,
      lockCode: s.lock.code,
      verifiedAttemptId: s.verifiedAttemptId,
      cancellationRequested: s.cancellationRequested,
    }),
  )
  const text = JSON.stringify(s)
  assert.equal(text.includes(MARKER), false)
  assert.equal(/\bat [\w.<>]+ \(/.test(text), false)
  assert.equal(text.includes('/data/'), false, 'no path enters the summary')
  assert.throws(() => {
    s.outcome = 'x'
  }, TypeError)
  if (s.attempts.length > 0) {
    assert.throws(() => {
      s.attempts[0].verdict = 'x'
    }, TypeError)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// T18 — collision-only retry, factory route
// ═════════════════════════════════════════════════════════════════════════════

test('T18: an eligible collision retries with a new attempt id and sequence, after exactly one backoff, and verifies', async () => {
  const wired = runnerFor({ attempts: [collision, verified] })
  const s = await go(wired)
  assertSummaryShape(s)
  assert.equal(s.outcome, 'verified')
  assert.equal(s.stopReason, 'verified')
  assert.equal(s.lock.state, 'released')
  assert.equal(s.attempts.length, 2)
  assert.deepEqual(
    s.attempts.map((a) => a.sequence),
    [0, 1],
  )
  assert.notEqual(s.attempts[0].attemptId, s.attempts[1].attemptId)
  assert.equal(s.verifiedAttemptId, s.attempts[1].attemptId)
  assert.deepEqual(wired.ops(), [
    'yield',
    'acquire',
    'held',
    'prove',
    'verify',
    'held',
    'attempt',
    'sleep',
    'held',
    'attempt',
    'release',
  ])
  assert.equal(wired.log.find((e) => e.op === 'sleep').ms, 25)
  const proofs = wired.log.filter((e) => e.op === 'attempt').map((e) => e.proof)
  assert.ok(
    proofs.every((p) => p === PROOF),
    'ONE containment proof reused by every attempt',
  )
  assert.equal(wired.log.filter((e) => e.op === 'prove').length, 1)
})

test('T18: an indeterminate failure is never retried in-run', async () => {
  for (const code of [
    'provider_indeterminate',
    'attempt_cancelled',
    'created_folder_unconfirmed',
  ]) {
    const wired = runnerFor({
      attempts: [
        (a) =>
          indeterminate(a, {
            code,
            stage: code === 'attempt_cancelled' ? 'local_refusal' : 'upload',
          }),
      ],
    })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.equal(s.stopReason, 'not_retry_eligible', code)
    assert.equal(s.outcome, 'not_verified')
    assert.equal(s.attempts.length, 1)
    assert.equal(wired.ops().includes('sleep'), false)
    assert.equal(s.lock.state, 'released')
  }
})

test('T18: every prohibited class carries not_eligible and is never retried', async () => {
  const prohibited = [
    (a) => report(a, { verdict: 'rejected', stage: 'upload', code: 'provider_rejected' }), // credential_unavailable
    (a) =>
      report(a, { verdict: 'rejected', stage: 'upload', code: 'provider_refused_before_spawn' }),
    (a) => report(a, { verdict: 'rejected', stage: 'upload', code: 'remote_root_absent' }),
    (a) =>
      report(a, {
        verdict: 'rejected',
        stage: 'readback',
        code: 'role_hash_mismatch',
        role: 'manifest',
      }),
    (a) =>
      report(a, {
        verdict: 'indeterminate',
        stage: 'completion',
        code: 'completion_adapter_internal_contradiction',
      }),
    (a) =>
      report(a, {
        verdict: 'indeterminate',
        stage: 'internal',
        code: 'internal_invariant_violated',
        lockAction: 'retain_internal_error',
      }),
    (a) =>
      report(a, {
        verdict: 'rejected',
        stage: 'upload',
        code: 'remote_path_occupied',
        cleanup: Object.freeze({ state: 'incomplete', workspacePath: null }),
      }),
  ]
  for (const make of prohibited) {
    const wired = runnerFor({ attempts: [make] })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.equal(s.attempts.length, 1)
    assert.equal(wired.ops().includes('sleep'), false)
    assert.ok(['not_retry_eligible', 'attempt_lock_retained'].includes(s.stopReason), s.stopReason)
  }
})

test('T18: the run never infers eligibility — a report CLAIMING eligibility for a prohibited shape is invalid and retains the lock', async () => {
  const lies = [
    (a) =>
      report(a, {
        verdict: 'rejected',
        stage: 'upload',
        code: 'provider_refused_before_spawn',
        retryDisposition: 'eligible_zero_transfer_collision',
      }),
    (a) =>
      report(a, {
        verdict: 'indeterminate',
        stage: 'upload',
        code: 'provider_indeterminate',
        retryDisposition: 'eligible_zero_transfer_collision',
      }),
    (a) =>
      report(a, {
        verdict: 'rejected',
        stage: 'readback',
        role: 'manifest',
        code: 'remote_object_absent',
        retryDisposition: 'eligible_zero_transfer_collision',
      }),
    (a) => collision(a, { cleanup: Object.freeze({ state: 'incomplete', workspacePath: null }) }),
    (a) => collision(a, { termination: 'not_applicable' }),
  ]
  for (const make of lies) {
    const wired = runnerFor({ attempts: [make] })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.equal(s.stopReason, 'run_internal_error')
    assert.equal(s.outcome, 'lock_unsettled')
    assert.deepEqual(s.lock, { state: 'retained', code: 'attempt_report_invalid' })
    assert.equal(wired.ops().includes('sleep'), false)
    assert.equal(wired.ops().includes('release'), false)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Bounds
// ═════════════════════════════════════════════════════════════════════════════

test('bounds: exactly maxAttemptsPerArtifactPerRun attempts, n-1 backoffs, never a sleep after the last', async () => {
  for (const max of [1, 2, 3]) {
    const wired = runnerFor({ attempts: Array.from({ length: max }, () => collision) })
    const s = await go(wired, {
      retry: { maxAttemptsPerArtifactPerRun: max, maxTotalAttemptsPerRun: max },
    })
    assertSummaryShape(s)
    assert.equal(s.attempts.length, max)
    assert.equal(wired.ops().filter((o) => o === 'sleep').length, max - 1)
    assert.equal(wired.ops().at(-1), 'release')
    assert.equal(s.stopReason, 'attempt_budget_exhausted')
    assert.equal(s.outcome, 'not_verified')
    assert.equal(s.attempts.at(-1).verdict, 'rejected', 'the last attempt keeps its own outcome')
    assert.ok(s.attempts.length <= max)
  }
  // A run ceiling larger than the per-artifact ceiling: the per-artifact one binds.
  const wired = runnerFor({ attempts: [collision, collision] })
  const s = await go(wired, {
    retry: { maxAttemptsPerArtifactPerRun: 2, maxTotalAttemptsPerRun: 5 },
  })
  assert.equal(s.attempts.length, 2)
})

test('bounds: decideAfterAttempt is one closed, ordered decision with independent counters', () => {
  const retry = { maxAttemptsPerArtifactPerRun: 3, maxTotalAttemptsPerRun: 5 }
  const eligible = Object.freeze({
    lockAction: 'release',
    verdict: 'rejected',
    retryDisposition: 'eligible_zero_transfer_collision',
  })
  const d = (over, counts = {}) =>
    decideAfterAttempt({
      report: { ...eligible, ...over },
      perArtifactCount: 1,
      runCount: 1,
      retry,
      aborted: false,
      ...counts,
    })
  assert.equal(d({}), 'retry')
  assert.equal(
    decideAfterAttempt({ report: null, perArtifactCount: 1, runCount: 1, retry, aborted: false }),
    'run_internal_error',
  )
  assert.equal(
    d({ lockAction: 'retain_internal_error', verdict: 'verified' }),
    'attempt_lock_retained',
  )
  assert.equal(d({ verdict: 'verified' }, { perArtifactCount: 99, runCount: 99 }), 'verified')
  assert.equal(d({}, { aborted: true }), 'cancelled')
  assert.equal(
    d({ retryDisposition: 'not_eligible' }, { perArtifactCount: 99 }),
    'not_retry_eligible',
  )
  // per-artifact ceiling alone
  assert.equal(d({}, { perArtifactCount: 3, runCount: 1 }), 'attempt_budget_exhausted')
  assert.equal(d({}, { perArtifactCount: 2, runCount: 1 }), 'retry')
  // run ceiling alone (independent of the per-artifact count)
  assert.equal(d({}, { perArtifactCount: 1, runCount: 5 }), 'attempt_budget_exhausted')
  assert.equal(d({}, { perArtifactCount: 1, runCount: 4 }), 'retry')
  assert.equal(d({}, { perArtifactCount: 1.5 }), 'attempt_budget_exhausted')
})

// ═════════════════════════════════════════════════════════════════════════════
// Backoff and cancellation
// ═════════════════════════════════════════════════════════════════════════════

test('backoff: an abort during the backoff starts no further attempt and releases the lock', async () => {
  const controller = new AbortController()
  const wired = runnerFor({
    attempts: [collision],
    sleep: async () => {
      controller.abort()
      return 'aborted'
    },
  })
  const s = await go(wired, { args: { signal: controller.signal } })
  assertSummaryShape(s)
  assert.equal(s.attempts.length, 1)
  assert.equal(s.stopReason, 'cancelled')
  assert.equal(s.outcome, 'cancelled')
  assert.equal(s.lock.state, 'released')
  assert.deepEqual(wired.ops().slice(-2), ['sleep', 'release'])
})

test('backoff: the production sleep is abort-aware and leaves no timer or listener behind', async () => {
  const sleep = REAL_RUN_DEPS.sleep
  const pre = new AbortController()
  pre.abort()
  assert.equal(await sleep(60_000, pre.signal), 'aborted')

  const during = new AbortController()
  const started = Date.now()
  const p = sleep(60_000, during.signal)
  assert.equal(getEventListeners(during.signal, 'abort').length, 1)
  setTimeout(() => during.abort(), 20)
  assert.equal(await p, 'aborted')
  assert.ok(Date.now() - started < 5_000)
  assert.equal(getEventListeners(during.signal, 'abort').length, 0)

  const quiet = new AbortController()
  assert.equal(await sleep(5, quiet.signal), 'elapsed')
  assert.equal(getEventListeners(quiet.signal, 'abort').length, 0)
  assert.equal(await sleep(5, undefined), 'elapsed')
})

test('backoff: a sleep that fails or returns an unknown value retains the lock', async () => {
  for (const sleep of [
    async () => {
      throw new Error(MARKER)
    },
    async () => 'maybe',
  ]) {
    const wired = runnerFor({ attempts: [collision], sleep })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.deepEqual(s.lock, { state: 'retained', code: 'run_internal_error' })
    assert.equal(s.outcome, 'lock_unsettled')
  }
})

test('cancellation during an attempt: the attempt finalizes, nothing further starts, and its lock action is honoured', async () => {
  const controller = new AbortController()
  const wired = runnerFor({
    attempts: [
      (a) => {
        controller.abort()
        return collision(a) // even an eligible collision is not retried once cancelled
      },
    ],
  })
  const s = await go(wired, { args: { signal: controller.signal } })
  assert.equal(s.stopReason, 'cancelled')
  assert.equal(s.outcome, 'cancelled')
  assert.equal(s.lock.state, 'released')
  assert.equal(wired.ops().includes('sleep'), false)
})

// ═════════════════════════════════════════════════════════════════════════════
// Lock actions and lock outcomes
// ═════════════════════════════════════════════════════════════════════════════

test('lock actions: every retain action stops the run and retains with the SAME reason; nothing is released', async () => {
  for (const lockAction of [
    'retain_attestation_unconfirmed',
    'retain_termination_unconfirmed',
    'retain_internal_error',
  ]) {
    const extra =
      lockAction === 'retain_attestation_unconfirmed'
        ? { attestationWritten: false, attestationPath: null }
        : lockAction === 'retain_termination_unconfirmed'
          ? {
              termination: 'unconfirmed',
              cleanup: Object.freeze({
                state: 'withheld_termination_unconfirmed',
                workspacePath: null,
              }),
            }
          : {}
    const wired = runnerFor({ attempts: [(a) => indeterminate(a, { lockAction, ...extra })] })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.deepEqual(s.lock, { state: 'retained', code: lockAction })
    assert.equal(s.stopReason, 'attempt_lock_retained')
    assert.equal(s.outcome, 'lock_unsettled')
    assert.equal(wired.ops().includes('release'), false)
  }
})

test('lock actions: a verified attempt whose lock action is retain is still lock_unsettled, with the verified id reported', async () => {
  const wired = runnerFor({ attempts: [(a) => report(a, { lockAction: 'retain_internal_error' })] })
  const s = await go(wired)
  assert.equal(s.outcome, 'lock_unsettled')
  assert.notEqual(s.verifiedAttemptId, null)
  assert.deepEqual(s.lock, { state: 'retained', code: 'retain_internal_error' })
})

test('lock actions: cleanup incomplete returned normally is honoured as release, and never retried', async () => {
  const wired = runnerFor({
    attempts: [
      (a) => report(a, { cleanup: Object.freeze({ state: 'incomplete', workspacePath: '/w' }) }),
    ],
  })
  const s = await go(wired)
  assert.equal(s.outcome, 'verified')
  assert.equal(s.lock.state, 'released')
  assert.equal(s.attempts[0].cleanupState, 'incomplete')
})

test('lock outcomes: every release result is reported exactly; anything but released is lock_unsettled', async () => {
  const cases = [
    [{ state: 'release_refused', code: 'lock_content_changed' }, 'release_refused'],
    [
      { state: 'release_durability_unconfirmed', code: 'lock_dir_fsync_failed' },
      'release_durability_unconfirmed',
    ],
    [{ state: 'release_replaced', code: 'lock_path_replaced_after_unlink' }, 'release_replaced'],
  ]
  for (const [result, state] of cases) {
    const wired = runnerFor({ release: () => Object.freeze(result) })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.deepEqual(s.lock, result)
    assert.equal(s.lock.state, state)
    assert.equal(s.outcome, 'lock_unsettled')
    assert.notEqual(s.verifiedAttemptId, null)
  }
  for (const release of [
    () => {
      throw new Error(MARKER)
    },
    () => ({ state: 'released', code: MARKER }),
    () => null,
  ]) {
    const wired = runnerFor({ release })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.deepEqual(s.lock, {
      state: 'release_durability_unconfirmed',
      code: 'lock_release_result_invalid',
    })
    assert.equal(s.outcome, 'lock_unsettled')
  }
})

test('lock outcomes: a lock found lost or replaced before an attempt stops the run without any release', async () => {
  let n = 0
  const wired = runnerFor({
    attempts: [collision, verified],
    held: () =>
      ++n >= 3
        ? Object.freeze({ state: 'lost', code: 'lock_path_absent' })
        : Object.freeze({ state: 'held', code: null }),
  })
  const s = await go(wired)
  assertSummaryShape(s)
  assert.deepEqual(s.lock, { state: 'lost', code: 'lock_path_absent' })
  assert.equal(s.stopReason, 'lock_not_held')
  assert.equal(s.attempts.length, 1, 'no attempt starts without the lock')
  assert.equal(wired.ops().includes('release'), false)
  assert.equal(s.outcome, 'lock_unsettled')

  const w2 = runnerFor({
    held: () => Object.freeze({ state: 'replaced', code: 'lock_identity_changed' }),
  })
  const s2 = await go(w2)
  assert.deepEqual(s2.lock, { state: 'replaced', code: 'lock_identity_changed' })
  assert.equal(w2.ops().includes('prove'), false, 'no containment without the lock')
})

// ═════════════════════════════════════════════════════════════════════════════
// Acquisition, identity, and the pre-lock checkpoint
// ═════════════════════════════════════════════════════════════════════════════

test('acquisition: refused (filesystem unchanged) vs identity refusal vs uncertain residue vs an invalid result', async () => {
  const cases = [
    [
      () => Object.freeze({ kind: 'refused', code: 'lock_held_live' }),
      { state: 'refused', code: 'lock_held_live' },
      'lock_refused',
      'lock_not_acquired',
    ],
    [
      () => Object.freeze({ kind: 'refused', code: 'lock_nonce_unavailable' }),
      { state: 'refused', code: 'lock_nonce_unavailable' },
      'lock_unsettled',
      'run_internal_error',
    ],
    [
      () => Object.freeze({ kind: 'uncertain', code: 'lock_write_incomplete' }),
      { state: 'acquisition_uncertain', code: 'lock_write_incomplete' },
      'lock_unsettled',
      'lock_not_acquired',
    ],
    [
      () => ({ kind: 'acquired', handle: HANDLE }),
      { state: 'acquisition_uncertain', code: 'lock_acquire_result_invalid' },
      'lock_unsettled',
      'lock_not_acquired',
    ],
    [
      () => Object.freeze({ kind: 'mystery' }),
      { state: 'acquisition_uncertain', code: 'lock_acquire_result_invalid' },
      'lock_unsettled',
      'lock_not_acquired',
    ],
    [
      () => {
        throw new Error(MARKER)
      },
      { state: 'acquisition_uncertain', code: 'lock_acquire_result_invalid' },
      'lock_unsettled',
      'lock_not_acquired',
    ],
  ]
  for (const [acquire, lock, outcome, stopReason] of cases) {
    const wired = runnerFor({ acquire })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.deepEqual(s.lock, lock)
    assert.equal(s.outcome, outcome)
    assert.equal(s.stopReason, stopReason)
    assert.equal(wired.ops().includes('prove'), false)
    assert.equal(wired.ops().includes('attempt'), false)
  }
})

test('identity: a clock or randomness failure creates no lock and returns an internal summary with cloudRunId null', async () => {
  for (const [now, randomToken] of [
    [
      () => {
        throw new Error(MARKER)
      },
      undefined,
    ],
    [() => NaN, undefined],
    [() => 1e20, undefined],
    [
      undefined,
      () => {
        throw new Error(MARKER)
      },
    ],
    [undefined, () => `zz${MARKER}`],
    [undefined, () => 'ABCDEF01'],
    [undefined, () => 'abc'],
  ]) {
    const wired = runnerFor({ ...(now ? { now } : {}), ...(randomToken ? { randomToken } : {}) })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.equal(s.cloudRunId, null)
    assert.deepEqual(s.lock, { state: 'not_attempted', code: 'run_id_generation_failed' })
    assert.equal(s.stopReason, 'run_internal_error')
    assert.equal(s.outcome, 'lock_unsettled')
    assert.deepEqual(wired.ops(), [], 'no checkpoint, no lock, no containment, no attempt')
  }
})

test('identity: the production run id is clock-stamped with 4 cryptographic random bytes', () => {
  const seen = new Set()
  for (let i = 0; i < 50; i++) {
    const token = REAL_RUN_DEPS.randomToken(4)
    assert.match(token, /^[0-9a-f]{8}$/)
    seen.add(token)
  }
  assert.ok(seen.size > 45, 'tokens are not repeating')
})

test('pre-lock: a signal already recorded before the checkpoint creates no lock and starts nothing', async () => {
  const controller = new AbortController()
  controller.abort()
  const wired = runnerFor()
  const s = await go(wired, { args: { signal: controller.signal } })
  assertSummaryShape(s)
  assert.deepEqual(wired.ops(), ['yield'])
  assert.deepEqual(s.lock, { state: 'not_attempted', code: null })
  assert.equal(s.stopReason, 'cancelled')
  assert.equal(s.outcome, 'cancelled')
  assert.equal(s.containment.state, 'not_attempted')
})

test('pre-lock: a signal dispatched AT the checkpoint (pending before the yield) is observed by the recheck', async () => {
  const controller = new AbortController()
  const wired = runnerFor({ yieldBeforeLock: async () => controller.abort() })
  const s = await go(wired, { args: { signal: controller.signal } })
  assert.deepEqual(wired.ops(), ['yield'])
  assert.equal(s.outcome, 'cancelled')
  assert.equal(s.lock.state, 'not_attempted')
})

test('pre-lock: a failing checkpoint creates no lock and is an internal error', async () => {
  const wired = runnerFor({
    yieldBeforeLock: async () => {
      throw new Error(MARKER)
    },
  })
  const s = await go(wired)
  assertSummaryShape(s)
  assert.deepEqual(s.lock, { state: 'not_attempted', code: 'pre_lock_checkpoint_failed' })
  assert.equal(s.outcome, 'lock_unsettled')
  assert.equal(wired.ops().includes('acquire'), false)
})

test('pre-lock: the production checkpoint yields a full event-loop turn, so a pending signal listener has already run', async () => {
  let observed = false
  const controller = new AbortController()
  setImmediate(() => controller.abort()) // stands in for a dispatched signal listener
  controller.signal.addEventListener('abort', () => {
    observed = true
  })
  await REAL_RUN_DEPS.yieldBeforeLock()
  assert.equal(observed, true)
})

test('a signal after the pre-lock recheck but before containment: the lock is taken, then released, and nothing else runs', async () => {
  const controller = new AbortController()
  const wired = runnerFor({
    acquire: () => {
      controller.abort()
      return Object.freeze({ kind: 'acquired', handle: HANDLE })
    },
  })
  const s = await go(wired, { args: { signal: controller.signal } })
  assert.deepEqual(wired.ops(), ['yield', 'acquire', 'held', 'release'])
  assert.equal(s.outcome, 'cancelled')
  assert.equal(s.lock.state, 'released')
})

// ═════════════════════════════════════════════════════════════════════════════
// Containment results — validated as strictly as an attempt report
// ═════════════════════════════════════════════════════════════════════════════

test('containment: malformed, contradictory, or unfrozen results start no attempt, retain the lock, and are lock_unsettled', async () => {
  const bad = [
    () => ({ kind: 'proven', proof: PROOF, cleanup: 'complete' }), // unfrozen
    () => Object.freeze({ kind: 'proven', proof: PROOF, cleanup: 'complete', extra: 1 }),
    () => Object.freeze({ kind: 'proven', proof: PROOF }),
    () => Object.freeze({ kind: 'proven', proof: PROOF, cleanup: 'incomplete' }),
    () => Object.freeze({ kind: 'proven', proof: { ...PROOF }, cleanup: 'complete' }), // unfrozen/copied proof
    () =>
      Object.freeze({ kind: 'proven', proof: Object.freeze({ ...PROOF }), cleanup: 'complete' }), // unregistered
    () => Object.freeze({ kind: 'proven', proof: null, cleanup: 'complete' }),
    () => Object.freeze({ kind: 'proved', proof: PROOF, cleanup: 'complete' }),
    () => Object.freeze({ kind: 'refused', code: `made_up ${MARKER}`, cleanup: 'not_started' }),
    () => Object.freeze({ kind: 'refused', code: 'containment_unproven', cleanup: 'mystery' }),
    () =>
      Object.freeze({
        kind: 'refused',
        code: 'containment_unproven',
        cleanup: 'complete',
        proof: PROOF,
      }),
    () => Object.freeze({ kind: 'refused', code: 'termination_unconfirmed', cleanup: 'complete' }),
    () => Object.freeze({ kind: 'refused', code: 'containment_unsupported', cleanup: 'complete' }),
    () => Object.freeze({ kind: 'refused', code: 'canary_cleanup_failed', cleanup: 'complete' }),
    () => Object.freeze({ kind: 'refused', code: 'containment_violated', cleanup: 'not_started' }),
    () =>
      Object.freeze({
        kind: 'refused',
        code: 'containment_unproven',
        cleanup: 'withheld_termination_unconfirmed',
      }),
    () => null,
    () => {
      throw new Error(MARKER)
    },
  ]
  for (const prove of bad) {
    const wired = runnerFor({ prove })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.deepEqual(s.containment, { state: 'invalid', code: null })
    assert.deepEqual(s.lock, { state: 'retained', code: 'containment_result_invalid' })
    assert.equal(s.stopReason, 'run_internal_error')
    assert.equal(s.outcome, 'lock_unsettled')
    assert.equal(wired.ops().includes('attempt'), false)
    assert.equal(wired.ops().includes('release'), false)
  }
  // A proof whose verification throws is invalid too.
  const w = runnerFor({
    verify: () => {
      throw new Error(MARKER)
    },
  })
  const s = await go(w)
  assert.deepEqual(s.lock, { state: 'retained', code: 'containment_result_invalid' })
})

test('containment: a valid termination_unconfirmed refusal retains; any other valid refusal releases', async () => {
  const unsettled = runnerFor({
    prove: () =>
      Object.freeze({
        kind: 'refused',
        code: 'termination_unconfirmed',
        cleanup: 'withheld_termination_unconfirmed',
      }),
  })
  const s1 = await go(unsettled)
  assertSummaryShape(s1)
  assert.deepEqual(s1.lock, { state: 'retained', code: 'containment_termination_unconfirmed' })
  assert.equal(s1.stopReason, 'containment_unsettled')
  assert.equal(s1.outcome, 'lock_unsettled')

  for (const [code, cleanup] of [
    ['containment_unproven', 'complete'],
    ['containment_violated', 'incomplete'],
    ['rlimit_wrapper_unverified', 'not_started'],
    ['canary_cleanup_failed', 'incomplete'],
  ]) {
    const w = runnerFor({ prove: () => Object.freeze({ kind: 'refused', code, cleanup }) })
    const s = await go(w)
    assertSummaryShape(s)
    assert.deepEqual(s.containment, { state: 'refused', code })
    assert.equal(s.lock.state, 'released')
    assert.equal(s.stopReason, 'containment_refused')
    assert.equal(s.outcome, 'not_verified')
    assert.equal(w.ops().includes('attempt'), false)
  }

  const controller = new AbortController()
  const w = runnerFor({
    prove: () => {
      controller.abort()
      return Object.freeze({ kind: 'refused', code: 'canary_cancelled', cleanup: 'complete' })
    },
  })
  const s = await go(w, { args: { signal: controller.signal } })
  assert.equal(s.stopReason, 'cancelled')
  assert.equal(s.outcome, 'cancelled')
  assert.equal(s.lock.state, 'released')
})

test('containment: validateContainmentResult passes through only a verified proof or a coherent refusal', () => {
  const ctx = { config: configFor(), cloudRunId: 'x', verify: ({ proof }) => proof === PROOF }
  assert.equal(
    validateContainmentResult(
      Object.freeze({ kind: 'proven', proof: PROOF, cleanup: 'complete' }),
      ctx,
    ).kind,
    'proven',
  )
  assert.equal(
    validateContainmentResult(
      Object.freeze({ kind: 'refused', code: 'canary_collision', cleanup: 'not_started' }),
      ctx,
    ).kind,
    'refused',
  )
  assert.equal(validateContainmentResult(undefined, ctx).kind, 'invalid')
})

// ═════════════════════════════════════════════════════════════════════════════
// Attempt reports — consumed only as closed, validated results
// ═════════════════════════════════════════════════════════════════════════════

test('reports: malformed, incoherent, unfrozen, foreign, or repeated reports retain the lock and stop the run', async () => {
  let repeatedId = null
  const bad = [
    (a) => ({ ...verified(a) }), // unfrozen
    (a) => Object.freeze({ ...verified(a), extra: MARKER }),
    (a) => {
      const { retryDisposition: _drop, ...rest } = verified(a)
      return Object.freeze(rest)
    },
    (a) => report(a, { verdict: 'maybe' }),
    (a) => report(a, { code: 'remote_path_occupied' }), // verified with a code
    (a) => report(a, { verdict: 'rejected', stage: 'upload', code: 'provider_indeterminate' }), // verdict/code mismatch
    (a) => report(a, { verdict: 'indeterminate', stage: 'upload', code: `nope ${MARKER}` }),
    (a) => report(a, { cloudRunId: '20200101T000000Z-00000000' }),
    (a) => report(a, { sequence: a.sequence + 1 }),
    (a) => report(a, { attemptId: 'not-an-id' }),
    (a) => indeterminate(a, { termination: 'unconfirmed' }), // unconfirmed but release
    (a) => indeterminate(a, { attestationWritten: false, attestationPath: null }), // no attestation but release
    (a) => report(a, { cleanup: { state: 'complete', workspacePath: null } }), // unfrozen nested
    (a) => report(a, { lockAction: 'maybe' }),
    (a) => report(a, { retryDisposition: 'eligible' }),
    (a) =>
      report(a, {
        verdict: 'indeterminate',
        stage: 'readback',
        code: 'download_size_mismatch',
        role: null,
      }),
  ]
  for (const make of bad) {
    const wired = runnerFor({ attempts: [make] })
    const s = await go(wired)
    assertSummaryShape(s)
    assert.deepEqual(s.lock, { state: 'retained', code: 'attempt_report_invalid' })
    assert.equal(s.stopReason, 'run_internal_error')
    assert.equal(s.attempts.length, 0, 'an invalid report is never projected')
  }
  // A second attempt that repeats the first attempt's id.
  const wired = runnerFor({
    attempts: [
      (a) => {
        const r = collision(a)
        repeatedId = r.attemptId
        return r
      },
      (a) => report(a, { attemptId: repeatedId }),
    ],
  })
  const s = await go(wired)
  assert.deepEqual(s.lock, { state: 'retained', code: 'attempt_report_invalid' })
  assert.equal(s.attempts.length, 1)
  assert.equal(
    projectAttemptReport(null, { cloudRunId: 'x', sequence: 0, seenAttemptIds: new Set() }),
    null,
  )
})

test('reports: a pre-identity attempt-id failure releases; any other throw retains and leaks nothing', async () => {
  const idFail = runnerFor({
    attempts: [
      () => {
        throw new BackupError(
          'cloud_upload_attempt_id_failed',
          'the attempt id could not be formed.',
        )
      },
    ],
  })
  const s1 = await go(idFail)
  assertSummaryShape(s1)
  assert.equal(s1.lock.state, 'released')
  assert.equal(s1.stopReason, 'attempt_not_started')
  assert.equal(s1.outcome, 'not_verified')

  for (const thrown of [
    new Error(MARKER),
    new BackupError('cloud_upload_invalid_input', MARKER),
    new BackupError('cloud_attempt_invalid_input', MARKER),
  ]) {
    const w = runnerFor({
      attempts: [
        () => {
          throw thrown
        },
      ],
    })
    const s = await go(w)
    assertSummaryShape(s)
    assert.deepEqual(s.lock, { state: 'retained', code: 'attempt_threw' })
    assert.equal(s.stopReason, 'run_internal_error')
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// The summary relationship table
// ═════════════════════════════════════════════════════════════════════════════

test('summary: deriveRunOutcome is exhaustive over every lock state and code', () => {
  for (const state of CLOUD_RUN_LOCK_SUMMARY_STATES) {
    for (const code of CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE[state]) {
      for (const verifiedAttemptId of [null, '20260919T120000Z-0a1b2c3d']) {
        for (const cancellationRequested of [false, true]) {
          const o = deriveRunOutcome({
            lockState: state,
            lockCode: code,
            verifiedAttemptId,
            cancellationRequested,
          })
          assert.ok(CLOUD_RUN_OUTCOMES.includes(o))
          if (state === 'refused') {
            const identity = [
              'lock_identity_invalid',
              'lock_clock_unusable',
              'lock_nonce_unavailable',
            ]
            assert.equal(o, identity.includes(code) ? 'lock_unsettled' : 'lock_refused')
          } else if (state === 'not_attempted') {
            assert.equal(o, code === null && cancellationRequested ? 'cancelled' : 'lock_unsettled')
          } else if (state !== 'released') {
            assert.equal(o, 'lock_unsettled', `${state}/${code}`)
          } else if (verifiedAttemptId !== null) {
            assert.equal(o, 'verified')
          } else {
            assert.equal(o, cancellationRequested ? 'cancelled' : 'not_verified')
          }
        }
      }
    }
  }
})

test('summary: the vocabularies are closed and frozen at every level', () => {
  for (const v of [
    production.CLOUD_RUN_OUTCOMES,
    production.CLOUD_RUN_STOP_REASONS,
    production.CLOUD_RUN_LOCK_SUMMARY_STATES,
    production.CLOUD_RUN_CONTAINMENT_STATES,
    production.CLOUD_RUN_PRELOCK_CODES,
    production.CLOUD_ENTRYPOINT_EXIT_CLASSES,
    production.CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE,
  ]) {
    assert.ok(Object.isFrozen(v))
  }
  for (const codes of Object.values(production.CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE)) {
    assert.ok(Object.isFrozen(codes))
  }
  assert.deepEqual(production.CLOUD_ENTRYPOINT_EXIT_CLASSES, {
    success: 0,
    not_verified: 1,
    invalid_invocation: 2,
    lock_refused: 3,
    lock_unsettled: 4,
    cancelled_sigint: 130,
    cancelled_sigterm: 143,
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Surface
// ═════════════════════════════════════════════════════════════════════════════

test('production API: runCloudBackup plus frozen vocabularies only — no signal installer, no dependency seam', async () => {
  assert.deepEqual(Object.keys(production).sort(), [
    'CLOUD_ENTRYPOINT_EXIT_CLASSES',
    'CLOUD_RUN_CONTAINMENT_STATES',
    'CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE',
    'CLOUD_RUN_LOCK_SUMMARY_STATES',
    'CLOUD_RUN_OUTCOMES',
    'CLOUD_RUN_PRELOCK_CODES',
    'CLOUD_RUN_STOP_REASONS',
    'CLOUD_RUN_SUMMARY_KIND',
    'CLOUD_RUN_SUMMARY_SCHEMA_VERSION',
    'runCloudBackup',
  ])
  const functions = Object.entries(production).filter(([, v]) => typeof v === 'function')
  assert.deepEqual(
    functions.map(([k]) => k),
    ['runCloudBackup'],
  )
  for (const file of [
    'backup-cloud-run.mjs',
    'internal/backup-cloud-run-core.mjs',
    'backup-cloud-run-lock.mjs',
  ]) {
    const code = fs
      .readFileSync(path.join(HERE, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const forbidden of [
      /process\.on\b/,
      /process\.once\b/,
      /['"]SIGINT['"]/,
      /['"]SIGTERM['"]/,
      /process\.exit\b/,
    ]) {
      assert.equal(forbidden.test(code), false, `${file}: ${forbidden}`)
    }
  }
  const src = fs.readFileSync(path.join(HERE, 'backup-cloud-run.mjs'), 'utf8')
  const signature = /export async function runCloudBackup\(args\)[\s\S]*?\n}/.exec(src)[0]
  assert.equal(/\bdeps\b/.test(signature), false)
  await assert.rejects(
    () => production.runCloudBackup({ config: { [MARKER]: 1 }, artifactBase: BASE }),
    (err) =>
      err instanceof BackupError &&
      err.code === 'cloud_run_invalid_input' &&
      !err.message.includes(MARKER),
  )
})

test('static: only the run API, the entrypoint harness, and the suites import the run core', () => {
  const opsRoot = path.resolve(HERE, '..', '..')
  const allowed = new Set([
    path.join(HERE, 'backup-cloud-run.mjs'),
    path.join(HERE, 'backup-cloud-run.test.mjs'),
    path.join(HERE, 'backup-cloud-entrypoint.test.mjs'),
    path.join(HERE, 'testdoubles', 'cloud-entrypoint-harness.mjs'),
    path.join(HERE, 'internal', 'backup-cloud-run-core.mjs'),
  ])
  const IMPORTS_CORE =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-cloud-run-core\.mjs['"]/
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

// ═════════════════════════════════════════════════════════════════════════════
// PRODUCTION ROUTE — the real lock, the real canary, the real attempt, the fake CLI
// ═════════════════════════════════════════════════════════════════════════════

const skipNoPrlimit = {
  skip: HAS_REAL_PRLIMIT ? false : `${REAL_PRLIMIT} is not present on this host`,
}

async function productionRun(sb, sequence) {
  sb.respond(sequence)
  const s = await production.runCloudBackup({ config: sb.config, artifactBase: BASE })
  assertEntrypointAccepts(s, sb.config.retry)
  return s
}

for (const [label, firstAttempt, firstCode] of [
  ['an occupied object path at preflight', objectOccupiedSteps, 'remote_path_occupied'],
  ['an anchored upload name_conflict', uploadNameConflictSteps, 'provider_rejected'],
]) {
  test(
    `T18 production route: ${label}, then a fresh attempt id and a fresh namespace verify`,
    skipNoPrlimit,
    async () => {
      const sb = makeCloudRunSandbox()
      sandboxes.push(sb)
      const s = await productionRun(sb, [...firstAttempt(), ...verifiedAttemptSteps(sb.bodies)])
      assertSummaryShape(s)
      assert.equal(s.outcome, 'verified', `${s.stopReason} ${JSON.stringify(s.attempts)}`)
      assert.equal(s.attempts.length, 2)
      assert.equal(s.attempts[0].code, firstCode)
      assert.equal(s.attempts[0].retryDisposition, 'eligible_zero_transfer_collision')
      assert.equal(s.attempts[1].verdict, 'verified')
      assert.notEqual(s.attempts[0].attemptId, s.attempts[1].attemptId)
      assert.equal(s.lock.state, 'released')
      assert.equal(fs.existsSync(sb.lockFile), false)
      assert.deepEqual(fs.readdirSync(sb.readbackDir), [], 'canary and workspaces are gone')

      // Two attempts, two intents, two attestations — the first names its own namespace.
      assert.equal(sb.records('.cloud-attempt-intent.json').length, 2)
      const attestations = sb.records('.cloud-attestation.json')
      assert.equal(attestations.length, 2)
      const first = JSON.parse(
        fs.readFileSync(
          path.join(sb.attestationDir, `${BASE}.${s.attempts[0].attemptId}.cloud-attestation.json`),
          'utf8',
        ),
      )
      assert.equal(first.verdict, 'rejected')
      assert.equal(first.upload_transfer_state, 'definitely_zero')
      assert.equal(
        first.remote.namespace,
        `/proton/eanhl-backups/${BASE}.${s.attempts[0].attemptId}`,
      )

      // Two DIFFERENT create-folder names; every write is inside its own attempt namespace.
      const argv = sb.argvLog()
      const creates = argv.filter((a) => a.includes('create-folder'))
      assert.equal(creates.length, 2)
      assert.notDeepEqual(creates[0], creates[1])
      for (const a of argv) {
        assert.ok(['info', 'create-folder', 'upload', 'download'].includes(a[1]), a.join(' '))
        for (const forbidden of [
          '-f',
          '--conflict-strategy',
          'trash',
          'delete',
          'list',
          'auth',
          'rename',
          'move',
          'copy',
        ]) {
          assert.equal(a.includes(forbidden), false)
        }
      }
    },
  )
}

test(
  'T18 production route: an indeterminate first attempt is NOT retried',
  skipNoPrlimit,
  async () => {
    const sb = makeCloudRunSandbox()
    sandboxes.push(sb)
    // info root answers with unexpected stderr on success -> indeterminate, nothing written
    const s = await productionRun(sb, [{ stdout: '{}', stderr: `${MARKER}\n` }])
    assertSummaryShape(s)
    assert.equal(s.attempts.length, 1)
    assert.equal(s.attempts[0].verdict, 'indeterminate')
    assert.equal(s.attempts[0].retryDisposition, 'not_eligible')
    assert.equal(s.stopReason, 'not_retry_eligible')
    assert.equal(s.outcome, 'not_verified')
    assert.equal(sb.invocations(), 1)
    assert.equal(fs.existsSync(sb.lockFile), false)
  },
)

test(
  'production route: a pre-existing lock is refused before containment or any provider call, and left identical',
  skipNoPrlimit,
  async () => {
    const sb = makeCloudRunSandbox()
    sandboxes.push(sb)
    fs.writeFileSync(sb.lockFile, `someone else ${MARKER}\n`, { mode: 0o600 })
    const before = fs.readFileSync(sb.lockFile)
    const s = await productionRun(sb, verifiedAttemptSteps(sb.bodies))
    assertSummaryShape(s)
    assert.deepEqual(s.lock, { state: 'refused', code: 'lock_malformed' })
    assert.equal(s.outcome, 'lock_refused')
    assert.equal(sb.invocations(), 0)
    assert.deepEqual(fs.readdirSync(sb.readbackDir), [], 'no canary ran')
    assert.ok(fs.readFileSync(sb.lockFile).equals(before), 'lock bytes unchanged')
  },
)
