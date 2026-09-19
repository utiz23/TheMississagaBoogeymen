/**
 * Single attested cloud-upload attempt — orchestration — INTERNAL
 * IMPLEMENTATION CORE (E3J6B).
 *
 * WHAT THIS FILE IS
 * ------------------
 * The state machine that wires together the four other E3J6B modules — the
 * upload attempt (E3J5/E3J6A), the attestation-record session
 * (`backup-cloud-attestation-records.mjs`), the readback session
 * (`backup-cloud-readback.mjs`), and pure verdict derivation
 * (`backup-cloud-attempt-verdict.mjs`) — into one call. It performs NO
 * filesystem or process work of its own: every access to a directory, a
 * file, or a provider goes through one of those four collaborators, each
 * already independently audited and each with its own non-forgeable
 * authority (a `RecordSession`, a `ReadbackSession`, or the prepared-upload
 * registry).
 *
 * `makeAttemptOrchestrator(deps)` builds the runner against a supplied
 * dependency set (the four collaborators' bound production functions, plus
 * a clock). `../backup-cloud-attempt.mjs` is THE production API: it binds
 * `REAL_ATTEMPT_ORCHESTRATOR_DEPS` once, at module load.
 *
 * THE STATE MACHINE
 * -------------------
 *   1. validate public inputs;
 *   2. prepareUploadAttempt() — assigns the attempt identity or throws
 *      before one exists;
 *   3. establish the record session (attestation.dir identity) — on
 *      failure, consume the prepared object and return a report with NO
 *      durable record of any kind (there is nowhere to write one);
 *   4. durably write the intent, from the SAME session — on failure,
 *      consume the prepared object, still attempt an attestation (the
 *      session's directory trust is otherwise fine), and force
 *      `retain_attestation_unconfirmed`;
 *   5. a `refused` disposition is ALWAYS consumed through
 *      `executeUploadAttempt()` (zero provider calls, by construction) and
 *      finishes here;
 *   6. validate the genuine containment proof — a `ready` disposition that
 *      fails this is DISCARDED, never executed;
 *   7. establish the readback session — which SEALS the readback's whole
 *      operational authority (CLI, credentials, timeouts, canonical remote
 *      paths, source evidence) — and prove capacity; same discard rule;
 *   8. create and authenticate the workspace (each object tracked the moment
 *      it is authenticated) — same discard rule;
 *   9. execute the ready upload EXACTLY ONCE;
 *   10-11. readback runs only if `objectWritePossible()` AND no upload child
 *       has unconfirmed termination (a possibly-live writer is never read
 *       back, and never yields a definite rejection);
 *   12. derive the verdict independently (never copying `uploadOutcome.status`
 *       directly — see `backup-cloud-attempt-verdict.mjs`);
 *   13. durably write the attestation, from the SAME record session;
 *   14. clean up the workspace ONLY if the attestation is durable AND
 *       termination is confirmed — including a workspace left by a PARTIAL
 *       setup failure;
 *   15. return the frozen report, including the lock action E3J6C consumes
 *       and (E3J6C) the retry disposition derived from the effective written
 *       attestation (`deriveRetryDisposition()`; `not_eligible` whenever no
 *       attestation was written).
 *
 * TOTALITY. From step 2 onward nothing escapes: every classified
 * `BackupError` becomes its stage's closed code (membership-checked against
 * `CLOUD_ATTEMPT_CODES_BY_STAGE`), and every other exception — from capacity,
 * workspace setup, upload execution, readback, verdict derivation, record
 * writing, or cleanup — becomes the one closed `internal`/
 * `internal_invariant_violated` outcome, with no message, stack, cause, or
 * path surviving. An exception while a child may be alive (upload execution,
 * readback) is recorded as termination `unconfirmed`, withholding cleanup.
 * The prepared object is consumed exactly once on every path through
 * `consume()`, the single choke point.
 *
 * REPORT = DURABLE RECORD. The returned report's verdict, stage, code, role,
 * termination, and lock action are copied from the EFFECTIVE attestation the
 * record session actually wrote (which may differ from the proposal — e.g. a
 * verified proposal whose intent could not be revalidated). With no durable
 * attestation the report never claims `verified`. The lock action may only
 * ESCALATE beyond the attestation's advice: to `retain_attestation_unconfirmed`
 * when nothing durable exists, or to `retain_internal_error` when the
 * post-attestation cleanup itself failed unexpectedly.
 */

import { BackupError } from '../backup-artifact-contract.mjs'
import { validateCloudConfig } from '../backup-cloud-config.mjs'
import { RUN_ID_PATTERN } from '../backup-cloud-naming.mjs'
import { CLOUD_UPLOAD_OUTCOME_CODES, CLOUD_UPLOAD_STEPS } from '../backup-cloud-upload.mjs'
import {
  classifyUploadOutcome,
  deriveOverallTermination,
  deriveRetryDisposition,
  objectWritePossible,
} from '../backup-cloud-attempt-verdict.mjs'
import {
  CLOUD_ATTEMPT_BOUNDARY_CODES,
  CLOUD_ATTEMPT_CODES_BY_STAGE,
  CLOUD_ATTEMPT_REJECTED_CODES,
  CLOUD_ATTESTATION_FAILURE_CODES,
  CLOUD_INTENT_FAILURE_CODES,
} from './backup-cloud-attestation-records-core.mjs'

function invalidInput(what) {
  throw new BackupError('cloud_attempt_invalid_input', `${what} is invalid.`)
}

function assertValidDeps(deps) {
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')
  const { upload, containment, records, readback, now } = deps
  if (upload === null || typeof upload !== 'object') return invalidInput('deps')
  for (const name of [
    'prepareUploadAttempt',
    'executeUploadAttempt',
    'discardPreparedUploadAttempt',
  ]) {
    if (typeof upload[name] !== 'function') return invalidInput('deps')
  }
  if (containment === null || typeof containment !== 'object') return invalidInput('deps')
  if (typeof containment.verifyContainmentProof !== 'function') return invalidInput('deps')
  if (records === null || typeof records !== 'object') return invalidInput('deps')
  for (const name of [
    'establishAttemptRecordSession',
    'writeAttemptIntent',
    'writeAttemptAttestation',
  ]) {
    if (typeof records[name] !== 'function') return invalidInput('deps')
  }
  if (readback === null || typeof readback !== 'object') return invalidInput('deps')
  for (const name of [
    'establishReadbackSession',
    'proveReadbackCapacity',
    'setupAttemptWorkspace',
    'readBackAttemptTriple',
    'cleanupAttemptWorkspace',
  ]) {
    if (typeof readback[name] !== 'function') return invalidInput('deps')
  }
  if (typeof now !== 'function') return invalidInput('deps')
}

function notObservedRoleAttestation() {
  return {
    attempted: false,
    observed: 'not_observed',
    boundary_code: null,
    termination: 'not_applicable',
    bytes: null,
    sha256: null,
    matches_source: null,
  }
}

function roleFromReadback(evidence) {
  return {
    attempted: evidence.attempted,
    observed: evidence.observed,
    boundary_code: evidence.boundaryCode,
    termination: evidence.termination,
    bytes: evidence.bytes,
    sha256: evidence.sha256,
    matches_source: evidence.matchesSource,
  }
}

/** `null` only if the clock itself is unusable — never partially trusted. */
function readFinishedAt(deps) {
  try {
    const ms = deps.now()
    if (!Number.isFinite(ms)) return { finished_at: null, finish_time_state: 'unavailable' }
    const iso = new Date(ms).toISOString()
    return { finished_at: iso, finish_time_state: 'captured' }
  } catch {
    return { finished_at: null, finish_time_state: 'unavailable' }
  }
}

/** The one closed outcome every unexpected exception becomes — no message, stack, or cause survives. */
const INTERNAL = Object.freeze({
  verdict: 'indeterminate',
  stage: 'internal',
  code: 'internal_invariant_violated',
  role: null,
})

const CLEANUP_STATES = Object.freeze([
  'not_started',
  'complete',
  'incomplete',
  'withheld_termination_unconfirmed',
])

/** `err.code` if `err` is a classified `BackupError` whose code is in `allowed`; otherwise `null`. */
function classifiedCode(err, allowed) {
  return err instanceof BackupError && allowed.includes(err.code) ? err.code : null
}

/** A stage decision, or `INTERNAL` if the code is not in that stage's closed set. */
function atStage(stage, code, { verdict, role = null } = {}) {
  if (!CLOUD_ATTEMPT_CODES_BY_STAGE[stage].includes(code)) return INTERNAL
  const expected = CLOUD_ATTEMPT_REJECTED_CODES.includes(code) ? 'rejected' : 'indeterminate'
  if (verdict !== undefined && verdict !== expected) return INTERNAL
  return Object.freeze({ verdict: expected, stage, code, role })
}

function uploadTerminationUnconfirmed(uploadOutcome) {
  return uploadOutcome.boundaryCalls.some(
    (c) => c.boundaryCode === 'provider_termination_unconfirmed',
  )
}

export function makeAttemptOrchestrator(deps) {
  assertValidDeps(deps)

  async function runAttestedAttempt(args) {
    // ── STEP 1: validate public inputs ──────────────────────────────────────
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { config, artifactBase, cloudRunId, sequence, containmentProof, signal } = args
    let cfg
    try {
      cfg = validateCloudConfig(config)
    } catch {
      return invalidInput('config')
    }
    if (typeof cloudRunId !== 'string' || !RUN_ID_PATTERN.test(cloudRunId))
      return invalidInput('cloudRunId')
    if (!Number.isSafeInteger(sequence) || sequence < 0) return invalidInput('sequence')
    if (containmentProof === null || typeof containmentProof !== 'object')
      return invalidInput('containmentProof')
    if (signal !== undefined && !(signal instanceof AbortSignal)) return invalidInput('signal')

    // ── STEP 2: prepare — assigns the identity, or throws before one exists ──
    const prepared = deps.upload.prepareUploadAttempt({ config, artifactBase, signal })

    // ── From here on, EVERY path is total: the prepared attempt is consumed
    // exactly once and a frozen report is returned; no exception escapes. ──
    const st = {
      consumed: false,
      session: null,
      readbackSession: null,
      intentWritten: false,
      intentPath: null,
      containment: 'not_checked',
      setupAttempted: false,
      readyUploadExecuted: false,
      uploadOutcome: null,
      readbackResult: null,
      // true while a child may have been spawned and its outcome is not in hand
      childStateUnknown: false,
    }
    let attemptId = null
    try {
      attemptId = prepared.attempt.attemptId
    } catch {
      attemptId = null
    }

    /** The single consumption choke point: at most one execute-or-discard, ever. */
    async function consume(kind) {
      if (st.consumed) throw new BackupError('internal_invariant_violated', 'already consumed.')
      st.consumed = true
      if (kind === 'execute') return deps.upload.executeUploadAttempt({ prepared, signal })
      if (prepared.disposition === 'ready') {
        deps.upload.discardPreparedUploadAttempt({ prepared })
      } else {
        // A refused preparation is never discarded — it is consumed through
        // execute(), which makes zero provider calls for it by construction.
        await deps.upload.executeUploadAttempt({ prepared, signal })
      }
      return null
    }

    function buildIntentFields() {
      return {
        cloud_run_id: cloudRunId,
        sequence,
        started_at: prepared.attempt.startedAt,
        artifact: {
          base: artifactBase,
          ciphertext: prepared.artifact.ciphertext,
          checksum: prepared.artifact.checksum,
          manifest: prepared.artifact.manifest,
        },
        source:
          prepared.disposition === 'ready'
            ? {
                evidence: 'captured',
                snapshot_ts: prepared.sourceEvidence.snapshotTs,
                run_id: prepared.sourceEvidence.runId,
                ciphertext: { ...prepared.sourceEvidence.ciphertext },
                checksum: { ...prepared.sourceEvidence.checksum },
                manifest: { ...prepared.sourceEvidence.manifest },
              }
            : {
                evidence: 'unavailable',
                snapshot_ts: null,
                run_id: null,
                ciphertext: null,
                checksum: null,
                manifest: null,
              },
        remote: remoteFields(),
        local: {
          source_dir: prepared.local.sourceDir,
          ciphertext_path: prepared.local.ciphertextPath,
          checksum_path: prepared.local.checksumPath,
          manifest_path: prepared.local.manifestPath,
        },
        cli: { executable: cfg.cli.executable, expected_sha512: cfg.cli.expectedSha512 },
        containment: {
          mechanism: cfg.readback.containment,
          wrapper_executable:
            cfg.readback.containment === 'rlimit_fsize'
              ? cfg.readback.rlimitWrapper.executable
              : null,
          wrapper_expected_sha512:
            cfg.readback.containment === 'rlimit_fsize'
              ? cfg.readback.rlimitWrapper.expectedSha512
              : null,
          ceilings: {
            ciphertext: cfg.readback.maxCiphertextBytes,
            checksum: cfg.readback.maxSidecarBytes,
            manifest: cfg.readback.maxManifestBytes,
          },
        },
        workspace: { planned_path: plannedWorkspacePath() },
        refusal: prepared.disposition === 'refused' ? { ...prepared.refusal } : null,
      }
    }

    function remoteFields() {
      return {
        root: prepared.remote.root,
        namespace: prepared.remote.namespace,
        ciphertext_path: prepared.remote.ciphertextPath,
        checksum_path: prepared.remote.checksumPath,
        manifest_path: prepared.remote.manifestPath,
      }
    }

    function plannedWorkspacePath() {
      return `${cfg.readback.dir}/${artifactBase}.${attemptId}`
    }

    /**
     * Steps 3-12. Returns the proposed decision; a classified failure at any
     * stage becomes that stage's closed code, and ANY exception escaping this
     * function becomes `INTERNAL` in the caller.
     */
    async function advance() {
      // ── STEP 3: establish the record session ──────────────────────────────
      try {
        st.session = deps.records.establishAttemptRecordSession({
          config,
          artifactBase,
          attemptId,
        })
      } catch (err) {
        return atStage(
          'attestation_dir_trust',
          classifiedCode(err, ['attestation_dir_untrusted']) ?? 'internal_invariant_violated',
        )
      }

      // ── STEP 4: durably write the intent, from THIS session ──────────────
      const intentFields = buildIntentFields()
      try {
        const r = deps.records.writeAttemptIntent({ session: st.session, intentFields })
        st.intentWritten = true
        st.intentPath = typeof r?.path === 'string' ? r.path : null
      } catch (err) {
        // The closed distinction survives: create failure, durability
        // unconfirmed, schema invalid, or directory trust lost — never flattened.
        const code = classifiedCode(err, CLOUD_INTENT_FAILURE_CODES)
        return code === null ? INTERNAL : atStage('intent', code)
      }

      // ── STEP 5: a local refusal is ALWAYS consumed through execute() ─────
      if (prepared.disposition === 'refused') {
        st.uploadOutcome = await consume('execute')
        const classified = classifyUploadOutcome(st.uploadOutcome)
        return atStage('local_refusal', classified.code, { verdict: classified.verdict })
      }

      // ── STEP 6: validate the genuine containment proof ───────────────────
      try {
        deps.containment.verifyContainmentProof({
          proof: containmentProof,
          config,
          runId: cloudRunId,
        })
      } catch (err) {
        if (!(err instanceof BackupError)) return INTERNAL
        st.containment = 'invalid'
        return atStage('containment_proof', 'containment_proof_invalid')
      }
      st.containment = 'valid'

      // ── STEP 7: readback session (sealed authority) + capacity ───────────
      try {
        st.readbackSession = deps.readback.establishReadbackSession({
          config,
          artifactBase,
          attemptId,
          sourceEvidence: prepared.sourceEvidence,
        })
      } catch (err) {
        const code = classifiedCode(err, ['readback_dir_untrusted'])
        return code === null ? INTERNAL : atStage('capacity', code)
      }
      let capacity
      try {
        capacity = await deps.readback.proveReadbackCapacity({ session: st.readbackSession })
      } catch (err) {
        const code = classifiedCode(err, CLOUD_ATTEMPT_CODES_BY_STAGE.capacity)
        return code === null ? INTERNAL : atStage('capacity', code)
      }
      if (capacity?.ok !== true) return atStage('capacity', capacity?.code)

      // ── STEP 8: workspace — from this point something may exist on disk ──
      st.setupAttempted = true
      let workspace
      try {
        workspace = await deps.readback.setupAttemptWorkspace({ session: st.readbackSession })
      } catch (err) {
        const code = classifiedCode(err, CLOUD_ATTEMPT_CODES_BY_STAGE.workspace)
        return code === null ? INTERNAL : atStage('workspace', code)
      }
      if (workspace?.ok !== true) return atStage('workspace', workspace?.code)

      // ── STEP 9: execute the ready upload EXACTLY ONCE ────────────────────
      st.readyUploadExecuted = true
      st.childStateUnknown = true
      st.uploadOutcome = await consume('execute')
      st.childStateUnknown = false
      const outcome = st.uploadOutcome

      // ── STEP 10-11: is object-level readback warranted AND safe? ─────────
      // An upload child whose termination is unconfirmed may still be
      // writing: no readback runs, and nothing can be a definite rejection.
      if (uploadTerminationUnconfirmed(outcome) || !objectWritePossible(outcome)) {
        const classified = classifyUploadOutcome(outcome)
        if (uploadTerminationUnconfirmed(outcome) && classified.verdict !== 'indeterminate') {
          return atStage('upload', 'internal_invariant_violated')
        }
        return atStage('upload', classified.code, { verdict: classified.verdict })
      }

      st.childStateUnknown = true
      st.readbackResult = await deps.readback.readBackAttemptTriple({
        session: st.readbackSession,
        signal,
      })
      st.childStateUnknown = false

      // ── STEP 12: derive the verdict independently ────────────────────────
      const rb = st.readbackResult
      if (rb.stoppedAtRole !== null) {
        return atStage('readback', rb.overallCode, {
          verdict: rb.overallVerdict,
          role: rb.stoppedAtRole,
        })
      }
      if (rb.overallCode === 'completion_adapter_internal_contradiction') {
        return atStage('completion', rb.overallCode)
      }
      if (rb.overallCode !== null || rb.completion?.ok !== true) return INTERNAL
      return Object.freeze({ verdict: 'verified', stage: null, code: null, role: null })
    }

    /** Termination across every child, conservatively; never throws. */
    function overallTermination() {
      if (st.childStateUnknown) return 'unconfirmed'
      try {
        if (st.uploadOutcome === null) return 'not_applicable'
        return deriveOverallTermination({
          uploadOutcome: st.uploadOutcome,
          readbackResult: st.readbackResult,
        })
      } catch {
        return st.readyUploadExecuted ? 'unconfirmed' : 'not_applicable'
      }
    }

    /** Closed upload-outcome evidence; any non-member value is recorded as null. */
    function uploadOutcomeFields() {
      const o = st.uploadOutcome
      if (o === null) return { code: null, failed_step: null, boundary_code: null }
      const code = CLOUD_UPLOAD_OUTCOME_CODES.includes(o.code) ? o.code : null
      const failedStep = CLOUD_UPLOAD_STEPS.includes(o.failedStep) ? o.failedStep : null
      const calls = Array.isArray(o.boundaryCalls) ? o.boundaryCalls : []
      const last = calls.length > 0 ? calls[calls.length - 1] : null
      const boundary =
        last !== null &&
        typeof last === 'object' &&
        CLOUD_ATTEMPT_BOUNDARY_CODES.includes(last.boundaryCode)
          ? last.boundaryCode
          : null
      return code === null || failedStep === null
        ? { code: null, failed_step: null, boundary_code: boundary }
        : { code, failed_step: failedStep, boundary_code: boundary }
    }

    function transferState() {
      const t = st.uploadOutcome?.transferState
      if (t === 'definitely_zero' || t === 'unknown') return t
      return st.readyUploadExecuted ? 'unknown' : 'definitely_zero'
    }

    function buildAttestationFields(proposal, termination, disposition, finish) {
      const rb = st.readbackResult
      return {
        cloud_run_id: cloudRunId,
        sequence,
        started_at: prepared.attempt.startedAt,
        finished_at: finish.finished_at,
        finish_time_state: finish.finish_time_state,
        artifact: {
          base: artifactBase,
          ciphertext: prepared.artifact.ciphertext,
          checksum: prepared.artifact.checksum,
          manifest: prepared.artifact.manifest,
        },
        source_snapshot_ts: prepared.sourceEvidence ? prepared.sourceEvidence.snapshotTs : null,
        source_run_id: prepared.sourceEvidence ? prepared.sourceEvidence.runId : null,
        remote: remoteFields(),
        verdict: proposal.verdict,
        stage: proposal.stage,
        code: proposal.code,
        role: proposal.role,
        containment: st.containment,
        upload_transfer_state: transferState(),
        upload_outcome: uploadOutcomeFields(),
        termination,
        readback: rb
          ? {
              performed: rb.performed,
              ciphertext: roleFromReadback(rb.roles.ciphertext),
              checksum: roleFromReadback(rb.roles.checksum),
              manifest: roleFromReadback(rb.roles.manifest),
            }
          : {
              performed: false,
              ciphertext: notObservedRoleAttestation(),
              checksum: notObservedRoleAttestation(),
              manifest: notObservedRoleAttestation(),
            },
        completion: rb ? { ...rb.completion } : { checked: false, ok: null },
        cli: { executable: cfg.cli.executable, expected_sha512: cfg.cli.expectedSha512 },
        cleanup_policy: {
          disposition,
          workspace_path: disposition === 'not_applicable' ? null : plannedWorkspacePath(),
        },
      }
    }

    /**
     * Steps 13-15: attestation, cleanup, report. The report's verdict, stage,
     * code, role, termination, and lock action are copied from the EFFECTIVE
     * attestation actually written — never from the proposal — so the two
     * can never disagree. With no durable attestation, `verified` is never
     * reported.
     */
    async function finalize(decided) {
      const finish = readFinishedAt(deps)
      let proposal = decided
      if (finish.finish_time_state === 'unavailable') {
        proposal = Object.freeze({ ...INTERNAL, code: 'clock_unusable' })
      }
      const termination = overallTermination()
      if (termination === 'unconfirmed' && proposal.verdict !== 'indeterminate') {
        // Never a definite finding while a child may still be alive.
        proposal = INTERNAL
      }
      const disposition =
        termination === 'unconfirmed'
          ? 'withheld_termination_unconfirmed'
          : st.setupAttempted
            ? 'after_attestation'
            : 'not_applicable'

      let written = null
      let attestationError = 'internal_invariant_violated'
      if (st.session !== null) {
        try {
          const fields = buildAttestationFields(proposal, termination, disposition, finish)
          const r = deps.records.writeAttemptAttestation({
            session: st.session,
            attestationFields: fields,
          })
          if (r !== null && typeof r === 'object' && typeof r.path === 'string' && r.attestation) {
            written = r
          }
        } catch (err) {
          attestationError =
            classifiedCode(err, CLOUD_ATTESTATION_FAILURE_CODES) ?? 'internal_invariant_violated'
        }
      }

      let view
      if (written !== null) {
        const a = written.attestation
        view = {
          verdict: a.verdict,
          stage: a.stage,
          code: a.code,
          role: a.role,
          termination: a.termination,
          lockAction: a.future_lock_advice,
          disposition: a.cleanup_policy.disposition,
        }
      } else {
        view = {
          ...proposal,
          termination,
          lockAction: 'retain_attestation_unconfirmed',
          disposition,
        }
        if (view.verdict === 'verified') {
          view.verdict = 'indeterminate'
          view.stage = 'attestation'
          view.code = attestationError
          view.role = null
        }
      }

      // ── cleanup: only after a durable attestation, never with termination unconfirmed ──
      let cleanupState = 'not_started'
      let cleanupUncertain = false
      if (view.disposition === 'withheld_termination_unconfirmed') {
        cleanupState = 'withheld_termination_unconfirmed'
      } else if (
        view.disposition === 'after_attestation' &&
        written !== null &&
        st.readbackSession !== null
      ) {
        try {
          const c = await deps.readback.cleanupAttemptWorkspace({ session: st.readbackSession })
          if (
            !CLEANUP_STATES.includes(c?.state) ||
            c.state === 'withheld_termination_unconfirmed'
          ) {
            throw new BackupError('internal_invariant_violated', 'cleanup state is not coherent.')
          }
          cleanupState = c.state
        } catch {
          cleanupState = 'incomplete'
          cleanupUncertain = true
        }
      }
      let lockAction = view.lockAction
      if (cleanupUncertain && lockAction === 'release') lockAction = 'retain_internal_error'

      // E3J6C: derived ONLY from the effective written attestation; with no
      // durable attestation nothing is ever retry-eligible.
      const retryDisposition =
        written !== null
          ? deriveRetryDisposition({
              attestation: written.attestation,
              lockAction,
              cleanupState,
            })
          : 'not_eligible'

      return Object.freeze({
        kind: 'eanhl.cloud-attempt-report',
        schemaVersion: 1,
        attemptId,
        cloudRunId,
        sequence,
        verdict: view.verdict,
        stage: view.stage,
        code: view.code,
        role: view.role,
        termination: view.termination,
        intentWritten: st.intentWritten,
        intentPath: st.intentPath,
        attestationWritten: written !== null,
        attestationPath: written !== null ? written.path : null,
        cleanup: Object.freeze({
          state: cleanupState,
          workspacePath: view.disposition === 'not_applicable' ? null : plannedWorkspacePath(),
        }),
        lockAction,
        retryDisposition,
      })
    }

    let decided
    try {
      decided = await advance()
    } catch {
      decided = INTERNAL
    }
    if (!st.consumed) {
      try {
        await consume('discard')
      } catch {
        decided = INTERNAL
      }
    }
    try {
      return await finalize(decided)
    } catch {
      // Last resort — finalize() is itself total; this is unreachable by
      // construction, and still returns a closed, conservative report.
      return Object.freeze({
        kind: 'eanhl.cloud-attempt-report',
        schemaVersion: 1,
        attemptId,
        cloudRunId,
        sequence,
        ...INTERNAL,
        termination: 'unconfirmed',
        intentWritten: st.intentWritten,
        intentPath: st.intentPath,
        attestationWritten: false,
        attestationPath: null,
        cleanup: Object.freeze({ state: 'not_started', workspacePath: null }),
        lockAction: 'retain_internal_error',
        retryDisposition: 'not_eligible',
      })
    }
  }

  return Object.freeze({ runAttestedAttempt })
}
