/**
 * One locked cloud-backup RUN — INTERNAL IMPLEMENTATION CORE (E3J6C).
 *
 * WHAT THIS FILE IS
 * ------------------
 * The run state machine: one explicit artifact, one run lock, ONE containment
 * proof, and a bounded sequence of attested attempts with collision-only
 * automatic retry. `makeCloudRunner(deps)` builds it against a supplied
 * dependency set; `../backup-cloud-run.mjs` is THE production API and binds
 * `REAL_RUN_DEPS` once. This factory is an internal TEST SEAM — the only
 * other importers are the entrypoint core's test harness and the suites, and a
 * static regression blocks any other `ops/**` importer. It performs no
 * filesystem or process work of its own: the lock, the canary, and each
 * attempt are their own audited boundaries.
 *
 * THE SEQUENCE
 * -------------
 *   1. validate inputs (throws before anything exists);
 *   2. generate `cloudRunId` from the injected clock and CRYPTOGRAPHIC
 *      randomness; a failure creates nothing and returns an internal summary;
 *   3. PRE-LOCK CHECKPOINT: `await yieldBeforeLock()` — production is one
 *      `setImmediate` turn, so a signal delivered during the preceding
 *      synchronous config/JSON/validation work (which cannot be interrupted)
 *      has had its listener run — then recheck `signal.aborted`; cancelled ⇒
 *      no lock, no containment, no attempt;
 *   4. acquire the lock (`refused` ⇒ filesystem unchanged; `uncertain` ⇒
 *      residue possible, no handle); a signal arriving after the recheck but
 *      before the synchronous `open` yields a held lock that step 5 releases;
 *   5. held-check and abort check;
 *   6. prove containment ONCE and validate the result STRICTLY; the proof is
 *      reused for every attempt of this run (each attempt re-verifies it);
 *   7. attempts: held-check, `runAttestedAttempt()`, strict report validation,
 *      `decideAfterAttempt()`, abort-aware fixed backoff; never a sleep after
 *      the final permitted attempt;
 *   8. final lock disposition (release or retain) and a DEEPLY FROZEN summary.
 *
 * WHAT IS DURABLE — AND WHAT IS NOT
 * -----------------------------------
 * The lock holds acquisition metadata only; retaining it writes nothing. A
 * retention reason is durable only inside an attempt attestation that was
 * actually written. This run's summary is NOT durable evidence.
 *
 * Totality: after input validation nothing escapes. Any unexpected exception
 * while a lock handle exists retains the lock (`run_internal_error`).
 */

import { randomBytes } from 'node:crypto'

import { BackupError } from '../backup-artifact-contract.mjs'
import {
  CLOUD_ATTEMPT_LOCK_ACTIONS,
  CLOUD_ATTEMPT_RETRY_DISPOSITIONS,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTEMPT_VERDICTS,
  CLOUD_WORKSPACE_CLEANUP_STATES,
  runAttestedAttempt,
} from '../backup-cloud-attempt.mjs'
import {
  CLOUD_ATTEMPT_CODES_BY_STAGE,
  CLOUD_ATTEMPT_REJECTED_CODES,
} from '../backup-cloud-attestation-records.mjs'
import { validateCloudConfig } from '../backup-cloud-config.mjs'
import {
  CONTAINMENT_CLEANUP_STATES,
  CONTAINMENT_REFUSAL_CODES,
  proveReadbackContainment,
  verifyContainmentProof,
} from '../backup-cloud-containment.mjs'
import {
  ATTEMPT_ID_PATTERN,
  RUN_ID_PATTERN,
  assertSafeRemoteComponent,
  assertValidArtifactBase,
  formatAttemptId,
} from '../backup-cloud-naming.mjs'
import {
  CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES,
  CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES,
  CLOUD_RUN_LOCK_HELD_CODES_BY_STATE,
  CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES,
  CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE,
  CLOUD_RUN_LOCK_RETAIN_REASONS,
  acquireRunLock,
  releaseRunLock,
  retainRunLock,
  verifyRunLockHeld,
} from '../backup-cloud-run-lock.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// Closed vocabularies.
// ─────────────────────────────────────────────────────────────────────────────

const frozenList = (values) => Object.freeze([...values])

export const CLOUD_RUN_SUMMARY_KIND = 'eanhl.cloud-run-summary'
export const CLOUD_RUN_SUMMARY_SCHEMA_VERSION = 1

export const CLOUD_RUN_OUTCOMES = frozenList([
  'verified',
  'not_verified',
  'cancelled',
  'lock_refused',
  'lock_unsettled',
])

export const CLOUD_RUN_STOP_REASONS = frozenList([
  'verified',
  'not_retry_eligible',
  'attempt_budget_exhausted',
  'cancelled',
  'attempt_lock_retained',
  'containment_refused',
  'containment_unsettled',
  'run_internal_error',
  'attempt_not_started',
  'lock_not_held',
  'lock_not_acquired',
])

/** Why no lock was ever attempted, beyond an observed cancellation. */
export const CLOUD_RUN_PRELOCK_CODES = frozenList([
  'run_id_generation_failed',
  'pre_lock_checkpoint_failed',
])

export const CLOUD_RUN_LOCK_SUMMARY_STATES = frozenList([
  'not_attempted',
  'refused',
  'acquisition_uncertain',
  'released',
  'release_refused',
  'release_durability_unconfirmed',
  'release_replaced',
  'retained',
  'lost',
  'replaced',
  'unverifiable',
])

/** Exactly which `lock.code` values each summary `lock.state` may carry. */
export const CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE = Object.freeze({
  not_attempted: frozenList([null, ...CLOUD_RUN_PRELOCK_CODES]),
  refused: CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES,
  acquisition_uncertain: frozenList([
    ...CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES,
    'lock_acquire_result_invalid',
  ]),
  released: frozenList([null]),
  release_refused: CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE.release_refused,
  release_durability_unconfirmed: frozenList([
    ...CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE.release_durability_unconfirmed,
    'lock_release_result_invalid',
  ]),
  release_replaced: CLOUD_RUN_LOCK_RELEASE_CODES_BY_STATE.release_replaced,
  retained: CLOUD_RUN_LOCK_RETAIN_REASONS,
  lost: CLOUD_RUN_LOCK_HELD_CODES_BY_STATE.lost,
  replaced: CLOUD_RUN_LOCK_HELD_CODES_BY_STATE.replaced,
  unverifiable: CLOUD_RUN_LOCK_HELD_CODES_BY_STATE.unverifiable,
})

export const CLOUD_RUN_CONTAINMENT_STATES = frozenList([
  'not_attempted',
  'proven',
  'refused',
  'invalid',
])

/** The process exit status for each entrypoint classification. */
export const CLOUD_ENTRYPOINT_EXIT_CLASSES = Object.freeze({
  success: 0,
  not_verified: 1,
  invalid_invocation: 2,
  lock_refused: 3,
  lock_unsettled: 4,
  cancelled_sigint: 130,
  cancelled_sigterm: 143,
})

/** The exact key set of an E3J6B attempt report (with the E3J6C `retryDisposition`). */
const REPORT_KEYS = Object.freeze(
  [
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
  ].sort(),
)

const TERMINATION_STATES = Object.freeze(['confirmed', 'unconfirmed', 'not_applicable'])
const READBACK_ROLES = Object.freeze(['manifest', 'checksum', 'ciphertext'])
const COLLISION_CODES = Object.freeze(['remote_path_occupied', 'provider_rejected'])

// ─────────────────────────────────────────────────────────────────────────────
// Real dependencies.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed production pre-lock checkpoint: exactly one event-loop turn. */
function yieldOneTurn() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Fixed production backoff: resolves `'elapsed'` or `'aborted'`; never leaves a timer or listener behind. */
function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve('aborted')
      return
    }
    let timer = null
    const onAbort = () => {
      clearTimeout(timer)
      resolve('aborted')
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve('elapsed')
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** The REAL dependency set, bound once by `../backup-cloud-run.mjs`. */
export const REAL_RUN_DEPS = Object.freeze({
  lock: Object.freeze({ acquireRunLock, verifyRunLockHeld, releaseRunLock, retainRunLock }),
  containment: Object.freeze({ proveReadbackContainment, verifyContainmentProof }),
  attempt: Object.freeze({ runAttestedAttempt }),
  now: () => Date.now(),
  randomToken: (n) => randomBytes(n).toString('hex'),
  yieldBeforeLock: yieldOneTurn,
  sleep: abortableSleep,
})

function invalidInput(what) {
  throw new BackupError('cloud_run_invalid_input', `${what} is invalid.`)
}

function assertValidDeps(deps) {
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')
  const groups = {
    lock: ['acquireRunLock', 'verifyRunLockHeld', 'releaseRunLock', 'retainRunLock'],
    containment: ['proveReadbackContainment', 'verifyContainmentProof'],
    attempt: ['runAttestedAttempt'],
  }
  for (const [group, names] of Object.entries(groups)) {
    const g = deps[group]
    if (g === null || typeof g !== 'object') return invalidInput('deps')
    for (const name of names) if (typeof g[name] !== 'function') return invalidInput('deps')
  }
  for (const name of ['now', 'randomToken', 'yieldBeforeLock', 'sleep']) {
    if (typeof deps[name] !== 'function') return invalidInput('deps')
  }
}

const sortedKeys = (o) => Object.keys(o).sort()
const sameKeys = (o, keys) => {
  const k = sortedKeys(o)
  return k.length === keys.length && k.every((v, i) => v === keys[i])
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure decisions — exported for the suites; the production API does not
// re-export them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a containment result STRICTLY before acting on it.
 *
 * @returns {{kind: 'proven', proof: object} | {kind: 'refused', code: string,
 *   cleanup: string} | {kind: 'invalid'}}
 */
export function validateContainmentResult(result, { config, cloudRunId, verify }) {
  const invalid = Object.freeze({ kind: 'invalid' })
  try {
    if (result === null || typeof result !== 'object' || !Object.isFrozen(result)) return invalid
    if (result.kind === 'proven') {
      if (!sameKeys(result, ['cleanup', 'kind', 'proof'])) return invalid
      if (result.cleanup !== 'complete') return invalid
      const proof = result.proof
      if (proof === null || typeof proof !== 'object' || !Object.isFrozen(proof)) return invalid
      if (verify({ proof, config, runId: cloudRunId }) !== true) return invalid
      return Object.freeze({ kind: 'proven', proof })
    }
    if (result.kind === 'refused') {
      if (!sameKeys(result, ['cleanup', 'code', 'kind'])) return invalid
      const { code, cleanup } = result
      if (!CONTAINMENT_REFUSAL_CODES.includes(code)) return invalid
      if (!CONTAINMENT_CLEANUP_STATES.includes(cleanup)) return invalid
      // Coherence, per the canary's own code paths.
      const allowed = {
        containment_unsupported: ['not_started'],
        rlimit_wrapper_unverified: ['not_started'],
        readback_dir_untrusted: ['not_started'],
        canary_collision: ['not_started'],
        canary_setup_failed: ['not_started', 'complete', 'incomplete'],
        canary_cancelled: ['not_started', 'complete', 'incomplete'],
        containment_unproven: ['not_started', 'complete', 'incomplete'],
        containment_violated: ['complete', 'incomplete'],
        canary_cleanup_failed: ['incomplete'],
        termination_unconfirmed: ['withheld_termination_unconfirmed'],
      }[code]
      if (allowed === undefined || !allowed.includes(cleanup)) return invalid
      return Object.freeze({ kind: 'refused', code, cleanup })
    }
    return invalid
  } catch {
    return invalid
  }
}

/**
 * Validate an attempt report STRICTLY and project the summary fields. Returns
 * the frozen projection, or `null` for anything malformed, incoherent,
 * unfrozen, foreign to this run, or repeating an earlier attempt id.
 */
export function projectAttemptReport(report, { cloudRunId, sequence, seenAttemptIds }) {
  try {
    if (report === null || typeof report !== 'object' || !Object.isFrozen(report)) return null
    if (!sameKeys(report, REPORT_KEYS)) return null
    if (report.kind !== 'eanhl.cloud-attempt-report' || report.schemaVersion !== 1) return null
    const {
      attemptId,
      verdict,
      stage,
      code,
      role,
      termination,
      intentWritten,
      intentPath,
      attestationWritten,
      attestationPath,
      cleanup,
      lockAction,
      retryDisposition,
    } = report
    if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId)) return null
    if (seenAttemptIds.has(attemptId)) return null
    if (report.cloudRunId !== cloudRunId || report.sequence !== sequence) return null
    if (!CLOUD_ATTEMPT_VERDICTS.includes(verdict)) return null
    if (verdict === 'verified') {
      if (stage !== null || code !== null || role !== null) return null
      if (attestationWritten !== true || termination !== 'confirmed') return null
    } else {
      if (!CLOUD_ATTEMPT_STAGES.includes(stage)) return null
      if (!CLOUD_ATTEMPT_CODES_BY_STAGE[stage].includes(code)) return null
      if ((verdict === 'rejected') !== CLOUD_ATTEMPT_REJECTED_CODES.includes(code)) return null
      if (role !== null && !READBACK_ROLES.includes(role)) return null
      if ((role !== null) !== (stage === 'readback')) return null
    }
    if (!TERMINATION_STATES.includes(termination)) return null
    if (typeof intentWritten !== 'boolean' || typeof attestationWritten !== 'boolean') return null
    if (intentWritten !== (typeof intentPath === 'string')) return null
    if (!intentWritten && intentPath !== null) return null
    if (attestationWritten !== (typeof attestationPath === 'string')) return null
    if (!attestationWritten && attestationPath !== null) return null
    if (cleanup === null || typeof cleanup !== 'object' || !Object.isFrozen(cleanup)) return null
    if (!sameKeys(cleanup, ['state', 'workspacePath'])) return null
    if (!CLOUD_WORKSPACE_CLEANUP_STATES.includes(cleanup.state)) return null
    if (cleanup.workspacePath !== null && typeof cleanup.workspacePath !== 'string') return null
    if (!CLOUD_ATTEMPT_LOCK_ACTIONS.includes(lockAction)) return null
    if (!attestationWritten && lockAction === 'release') return null
    if (termination === 'unconfirmed' && lockAction === 'release') return null
    if (!CLOUD_ATTEMPT_RETRY_DISPOSITIONS.includes(retryDisposition)) return null
    if (retryDisposition === 'eligible_zero_transfer_collision') {
      const coherent =
        verdict === 'rejected' &&
        stage === 'upload' &&
        COLLISION_CODES.includes(code) &&
        attestationWritten === true &&
        intentWritten === true &&
        lockAction === 'release' &&
        cleanup.state === 'complete' &&
        termination === 'confirmed'
      if (!coherent) return null
    }
    return Object.freeze({
      sequence,
      attemptId,
      verdict,
      stage,
      code,
      role,
      termination,
      attestationWritten,
      cleanupState: cleanup.state,
      lockAction,
      retryDisposition,
    })
  } catch {
    return null
  }
}

/**
 * The one closed after-attempt decision. `report` is a validated projection
 * (or `null`). Checked in this exact order; `'retry'` is the only non-stop.
 *
 * @returns {'retry' | 'run_internal_error' | 'attempt_lock_retained' | 'verified' |
 *   'cancelled' | 'not_retry_eligible' | 'attempt_budget_exhausted'}
 */
export function decideAfterAttempt({ report, perArtifactCount, runCount, retry, aborted }) {
  if (report === null || typeof report !== 'object') return 'run_internal_error'
  if (report.lockAction !== 'release') return 'attempt_lock_retained'
  if (report.verdict === 'verified') return 'verified'
  if (aborted === true) return 'cancelled'
  if (report.retryDisposition !== 'eligible_zero_transfer_collision') return 'not_retry_eligible'
  if (
    !Number.isSafeInteger(perArtifactCount) ||
    !Number.isSafeInteger(runCount) ||
    perArtifactCount >= retry.maxAttemptsPerArtifactPerRun ||
    runCount >= retry.maxTotalAttemptsPerRun
  ) {
    return 'attempt_budget_exhausted'
  }
  return 'retry'
}

/**
 * The run outcome, derived ONLY from the final lock state/code, whether an
 * attempt verified, and whether cancellation was requested — never supplied.
 */
export function deriveRunOutcome({
  lockState,
  lockCode,
  verifiedAttemptId,
  cancellationRequested,
}) {
  if (lockState === 'not_attempted') {
    if (lockCode !== null) return 'lock_unsettled'
    return cancellationRequested === true ? 'cancelled' : 'lock_unsettled'
  }
  if (lockState === 'refused') {
    return CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES.includes(lockCode)
      ? 'lock_unsettled'
      : 'lock_refused'
  }
  if (lockState !== 'released') return 'lock_unsettled'
  if (verifiedAttemptId !== null) return 'verified'
  if (cancellationRequested === true) return 'cancelled'
  return 'not_verified'
}

// ─────────────────────────────────────────────────────────────────────────────
// The runner.
// ─────────────────────────────────────────────────────────────────────────────

export function makeCloudRunner(deps) {
  assertValidDeps(deps)

  async function runCloudBackup(args) {
    // ── 1. inputs — throws before anything exists ──
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { config, artifactBase, signal } = args
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
    if (signal !== undefined && !(signal instanceof AbortSignal)) return invalidInput('signal')
    const aborted = () => signal?.aborted === true

    const run = {
      cloudRunId: null,
      lock: { state: 'not_attempted', code: null },
      containment: { state: 'not_attempted', code: null },
      attempts: [],
      stopReason: null,
      verifiedAttemptId: null,
    }
    let handle = null

    const summary = () => {
      const outcome = deriveRunOutcome({
        lockState: run.lock.state,
        lockCode: run.lock.code,
        verifiedAttemptId: run.verifiedAttemptId,
        cancellationRequested: aborted(),
      })
      return Object.freeze({
        kind: CLOUD_RUN_SUMMARY_KIND,
        schemaVersion: CLOUD_RUN_SUMMARY_SCHEMA_VERSION,
        cloudRunId: run.cloudRunId,
        artifactBase,
        outcome,
        stopReason: run.stopReason,
        verifiedAttemptId: run.verifiedAttemptId,
        cancellationRequested: aborted(),
        lock: Object.freeze({ state: run.lock.state, code: run.lock.code }),
        containment: Object.freeze({ state: run.containment.state, code: run.containment.code }),
        attempts: Object.freeze(run.attempts.slice()),
      })
    }

    /** Give the lock up; records the exact release outcome. */
    const release = () => {
      const h = handle
      handle = null
      let r
      try {
        r = deps.lock.releaseRunLock({ handle: h })
      } catch {
        run.lock = { state: 'release_durability_unconfirmed', code: 'lock_release_result_invalid' }
        return
      }
      const codes =
        r !== null && typeof r === 'object'
          ? CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE[r.state]
          : undefined
      if (
        ![
          'released',
          'release_refused',
          'release_durability_unconfirmed',
          'release_replaced',
        ].includes(r?.state) ||
        codes === undefined ||
        !codes.includes(r.code)
      ) {
        run.lock = { state: 'release_durability_unconfirmed', code: 'lock_release_result_invalid' }
        return
      }
      run.lock = { state: r.state, code: r.code }
    }

    /** Keep the lock; writes nothing, and the reason is a closed constant. */
    const retain = (reason) => {
      const h = handle
      handle = null
      let r
      try {
        r = deps.lock.retainRunLock({ handle: h, reason })
      } catch {
        r = null
      }
      if (r !== null && typeof r === 'object' && r.state === 'retained' && r.reason === reason) {
        run.lock = { state: 'retained', code: reason }
      } else {
        const code = ['lock_handle_invalid', 'lock_already_settled'].includes(r?.code)
          ? r.code
          : 'lock_handle_invalid'
        run.lock = { state: 'unverifiable', code }
      }
    }

    /** `true` while the lock is provably ours; otherwise records why and drops the handle. */
    const stillHeld = () => {
      let r
      try {
        r = deps.lock.verifyRunLockHeld({ handle })
      } catch {
        r = null
      }
      if (r !== null && typeof r === 'object' && r.state === 'held' && r.code === null) return true
      const state = ['lost', 'replaced', 'unverifiable'].includes(r?.state)
        ? r.state
        : 'unverifiable'
      const code = CLOUD_RUN_LOCK_HELD_CODES_BY_STATE[state].includes(r?.code)
        ? r.code
        : 'lock_unobservable'
      handle = null
      run.lock = { state, code }
      run.stopReason = 'lock_not_held'
      return false
    }

    try {
      // ── 2. run identity: clock + cryptographic randomness, validated ──
      let cloudRunId = null
      try {
        const id = formatAttemptId({ now: deps.now, randomToken: deps.randomToken })
        if (typeof id === 'string' && RUN_ID_PATTERN.test(id)) cloudRunId = id
      } catch {
        cloudRunId = null
      }
      if (cloudRunId === null) {
        run.lock = { state: 'not_attempted', code: 'run_id_generation_failed' }
        run.stopReason = 'run_internal_error'
        return summary()
      }
      run.cloudRunId = cloudRunId

      // ── 3. pre-lock checkpoint: one turn, then recheck ──
      try {
        await deps.yieldBeforeLock()
      } catch {
        run.lock = { state: 'not_attempted', code: 'pre_lock_checkpoint_failed' }
        run.stopReason = 'run_internal_error'
        return summary()
      }
      if (aborted()) {
        run.stopReason = 'cancelled'
        return summary()
      }

      // ── 4. acquire ──
      let acq
      try {
        acq = deps.lock.acquireRunLock({ config: cfg, cloudRunId, artifactBase })
      } catch {
        acq = null
      }
      if (
        acq !== null &&
        typeof acq === 'object' &&
        Object.isFrozen(acq) &&
        acq.kind === 'acquired' &&
        acq.handle !== null &&
        typeof acq.handle === 'object'
      ) {
        handle = acq.handle
      } else if (
        acq?.kind === 'refused' &&
        CLOUD_RUN_LOCK_ACQUIRE_REFUSAL_CODES.includes(acq.code)
      ) {
        run.lock = { state: 'refused', code: acq.code }
        run.stopReason = CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES.includes(acq.code)
          ? 'run_internal_error'
          : 'lock_not_acquired'
        return summary()
      } else {
        const code =
          acq?.kind === 'uncertain' && CLOUD_RUN_LOCK_ACQUIRE_UNCERTAIN_CODES.includes(acq.code)
            ? acq.code
            : 'lock_acquire_result_invalid'
        run.lock = { state: 'acquisition_uncertain', code }
        run.stopReason = 'lock_not_acquired'
        return summary()
      }

      // ── 5. held and not cancelled ──
      if (!stillHeld()) return summary()
      if (aborted()) {
        run.stopReason = 'cancelled'
        release()
        return summary()
      }

      // ── 6. ONE containment proof for this locked run, strictly validated ──
      let containment
      try {
        containment = await deps.containment.proveReadbackContainment({
          config: cfg,
          runId: cloudRunId,
          signal,
        })
      } catch {
        containment = null
      }
      const checked = validateContainmentResult(containment, {
        config: cfg,
        cloudRunId,
        verify: deps.containment.verifyContainmentProof,
      })
      if (checked.kind === 'invalid') {
        run.containment = { state: 'invalid', code: null }
        run.stopReason = 'run_internal_error'
        retain('containment_result_invalid')
        return summary()
      }
      if (checked.kind === 'refused') {
        run.containment = { state: 'refused', code: checked.code }
        if (checked.code === 'termination_unconfirmed') {
          run.stopReason = 'containment_unsettled'
          retain('containment_termination_unconfirmed')
          return summary()
        }
        run.stopReason = checked.code === 'canary_cancelled' ? 'cancelled' : 'containment_refused'
        release()
        return summary()
      }
      run.containment = { state: 'proven', code: null }
      const proof = checked.proof

      // ── 7. bounded attempts ──
      const retry = cfg.retry
      const seen = new Set()
      let perArtifactCount = 0
      let runCount = 0
      for (;;) {
        if (aborted()) {
          run.stopReason = 'cancelled'
          release()
          return summary()
        }
        if (
          perArtifactCount >= retry.maxAttemptsPerArtifactPerRun ||
          runCount >= retry.maxTotalAttemptsPerRun
        ) {
          run.stopReason = 'attempt_budget_exhausted'
          release()
          return summary()
        }
        if (!stillHeld()) return summary()

        const sequence = runCount
        let report
        try {
          report = await deps.attempt.runAttestedAttempt({
            config: cfg,
            artifactBase,
            cloudRunId,
            sequence,
            containmentProof: proof,
            signal,
          })
        } catch (err) {
          if (err instanceof BackupError && err.code === 'cloud_upload_attempt_id_failed') {
            // Thrown strictly before any attempt identity, intent, or boundary call.
            run.stopReason = 'attempt_not_started'
            release()
            return summary()
          }
          run.stopReason = 'run_internal_error'
          retain('attempt_threw')
          return summary()
        }
        perArtifactCount += 1
        runCount += 1

        const projected = projectAttemptReport(report, {
          cloudRunId,
          sequence,
          seenAttemptIds: seen,
        })
        if (projected === null) {
          run.stopReason = 'run_internal_error'
          retain('attempt_report_invalid')
          return summary()
        }
        seen.add(projected.attemptId)
        run.attempts.push(projected)
        if (projected.verdict === 'verified') run.verifiedAttemptId = projected.attemptId

        const decision = decideAfterAttempt({
          report: projected,
          perArtifactCount,
          runCount,
          retry,
          aborted: aborted(),
        })
        if (decision === 'attempt_lock_retained') {
          run.stopReason = 'attempt_lock_retained'
          retain(projected.lockAction)
          return summary()
        }
        if (decision !== 'retry') {
          run.stopReason = decision
          release()
          return summary()
        }

        // ── fixed, abort-aware backoff — only because another attempt IS permitted ──
        let slept
        try {
          slept = await deps.sleep(retry.backoffMs, signal)
        } catch {
          slept = null
        }
        if (slept === 'aborted') {
          run.stopReason = 'cancelled'
          release()
          return summary()
        }
        if (slept !== 'elapsed') {
          run.stopReason = 'run_internal_error'
          retain('run_internal_error')
          return summary()
        }
      }
    } catch {
      // Unreachable by construction. While a handle exists the lock is kept.
      run.stopReason = 'run_internal_error'
      if (handle !== null) retain('run_internal_error')
      return summary()
    }
  }

  return Object.freeze({ runCloudBackup })
}
