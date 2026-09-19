/**
 * Pure verdict derivation for one E3J6B attempt — no I/O, no factory, no
 * dependency injection of any kind. Every function here is total and
 * deterministic over its plain-object input.
 *
 * INDEPENDENT DERIVATION, NOT A COPY OF `uploadOutcome.status`
 * ---------------------------------------------------------------
 * `classifyUploadOutcome()` re-derives rejected/indeterminate from
 * `uploadOutcome.code` against its OWN closed set of codes upload-core
 * treats as indeterminate — the same five values
 * (`internal/backup-cloud-upload-core.mjs`'s private `INDETERMINATE_CODES`),
 * restated here deliberately rather than imported, because the whole point
 * is a genuine second opinion, not a re-export of the first one. It then
 * cross-checks that independent classification against `uploadOutcome.status`
 * (and, for a clean success, against `uploadOutcome.transferState`). Any
 * disagreement — upload-core's own module changed this set and this module
 * was not updated to match — is `internal_invariant_violated`, never
 * silently trusted either way.
 *
 * THE OBJECT-WRITE-POSSIBLE PREDICATE
 * --------------------------------------
 * `objectWritePossible()` decides whether readback is warranted at all.
 * `info`/`create-folder` calls never count as object-write evidence — only
 * an actual `upload` call does. A prior successful upload triggers readback
 * even if a LATER role then failed (readback is the only way to learn what
 * is actually on the remote). A narrowly proven pre-spawn or definite-zero
 * upload refusal, with no earlier successful upload, does not.
 *
 * THE RETRY DISPOSITION (E3J6C)
 * --------------------------------
 * `deriveRetryDisposition()` decides, from the EFFECTIVE written attestation
 * only, whether an attempt belongs to the one automatically retryable class
 * ("R1"): a definite, zero-transfer NAME COLLISION — a preflight that found
 * the attempt's own namespace or object path occupied, or an upload whose
 * anchored boundary refusal was `name_conflict` — that a fresh attempt id and
 * therefore a fresh remote namespace actually resolves. Every other outcome,
 * including a refusal before spawn and `credential_unavailable`, is
 * `not_eligible`. The attestation schema is unchanged: every input is a field
 * the attestation already records.
 */

export const CLOUD_ATTEMPT_VERDICTS = Object.freeze(['verified', 'rejected', 'indeterminate'])

export const CLOUD_CONTAINMENT_STATES = Object.freeze(['not_checked', 'valid', 'invalid'])

export const CLOUD_ATTEMPT_STAGES = Object.freeze([
  'local_refusal',
  'attestation_dir_trust',
  'intent',
  'containment_proof',
  'capacity',
  'workspace',
  'upload',
  'readback',
  'completion',
  'internal',
  // report-only: the attestation itself could not be durably written
  'attestation',
])

export const CLOUD_ATTEMPT_LOCK_ACTIONS = Object.freeze([
  'release',
  'retain_attestation_unconfirmed',
  'retain_termination_unconfirmed',
  'retain_internal_error',
])

/** E3J6C: the closed retry dispositions an attempt report may carry. */
export const CLOUD_ATTEMPT_RETRY_DISPOSITIONS = Object.freeze([
  'eligible_zero_transfer_collision',
  'not_eligible',
])

/** The preflight steps at which `remote_path_occupied` is a retryable collision. */
const COLLISION_PREFLIGHT_STEPS = Object.freeze([
  'preflight_namespace',
  'preflight_ciphertext',
  'preflight_checksum',
  'preflight_manifest',
])

/** The upload steps at which an anchored `name_conflict` refusal is a retryable collision. */
const COLLISION_UPLOAD_STEPS = Object.freeze([
  'upload_ciphertext',
  'upload_checksum',
  'upload_manifest',
])

/**
 * Restated, not imported — see the module docblock. Matches
 * `internal/backup-cloud-upload-core.mjs`'s private `INDETERMINATE_CODES`
 * exactly, as of E3J6A.
 */
const UPLOAD_INDEPENDENT_INDETERMINATE_CODES = new Set([
  'created_folder_unconfirmed',
  'provider_indeterminate',
  'provider_call_failed',
  'attempt_cancelled',
  'local_source_changed',
])

/**
 * The exact remote-object-write-possible predicate.
 *
 * @param {object} uploadOutcome  the frozen outcome from
 *   `executeUploadAttempt()` — `boundaryCalls`, `furthestUploadSuccessReportedRole`
 * @returns {boolean}
 */
export function objectWritePossible(uploadOutcome) {
  if (uploadOutcome.furthestUploadSuccessReportedRole !== null) return true
  const uploadCalls = uploadOutcome.boundaryCalls.filter((c) => c.operation === 'upload')
  if (uploadCalls.length === 0) return false
  const last = uploadCalls[uploadCalls.length - 1]
  if (last.boundaryResult === 'success') return true // unreachable here; kept for totality
  if (last.boundaryResult === 'rejected' || last.boundaryResult === 'refused_before_spawn')
    return false
  return true // 'indeterminate' or 'failed' — ambiguous/unknown transfer evidence
}

/**
 * Independently classify a STOPPED-AT-UPLOAD outcome (only called when
 * `objectWritePossible()` is false — readback was never attempted). Returns
 * closed evidence for the attestation's `upload_outcome` field plus the
 * cross-checked verdict.
 *
 * @param {object} uploadOutcome
 * @returns {{
 *   verdict: 'rejected'|'indeterminate',
 *   code: string,
 *   failedStep: string|null,
 *   boundaryCode: string|null,
 *   consistent: boolean,
 * }}
 */
export function classifyUploadOutcome(uploadOutcome) {
  const lastCall =
    uploadOutcome.boundaryCalls.length > 0
      ? uploadOutcome.boundaryCalls[uploadOutcome.boundaryCalls.length - 1]
      : null
  const boundaryCode = lastCall ? lastCall.boundaryCode : null
  const failedStep = uploadOutcome.failedStep

  if (uploadOutcome.code === null) {
    // A clean success reaching this function would itself be an invariant
    // violation: objectWritePossible() is true for every code===null case,
    // so the caller should never route a success here.
    const consistent =
      uploadOutcome.status === 'upload_success_reported_pending_readback' &&
      uploadOutcome.transferState === 'unknown'
    return {
      verdict: 'indeterminate',
      code: 'internal_invariant_violated',
      failedStep,
      boundaryCode,
      consistent,
    }
  }

  const independentlyIndeterminate = UPLOAD_INDEPENDENT_INDETERMINATE_CODES.has(uploadOutcome.code)
  const expectedStatus = independentlyIndeterminate ? 'indeterminate' : 'rejected'
  const consistent = uploadOutcome.status === expectedStatus
  if (!consistent) {
    return {
      verdict: 'indeterminate',
      code: 'internal_invariant_violated',
      failedStep,
      boundaryCode,
      consistent: false,
    }
  }
  return {
    verdict: independentlyIndeterminate ? 'indeterminate' : 'rejected',
    code: uploadOutcome.code,
    failedStep,
    boundaryCode,
    consistent: true,
  }
}

/**
 * Derive the overall termination state conservatively from every invoked
 * child: the upload boundary's own calls, plus the readback result (if
 * readback ran at all).
 *
 * @param {object} args
 * @param {object} args.uploadOutcome
 * @param {object|null} args.readbackResult  from `readBackAttemptTriple()`, or null
 * @returns {'confirmed'|'unconfirmed'|'not_applicable'}
 */
export function deriveOverallTermination({ uploadOutcome, readbackResult }) {
  const uploadInvokedChild = uploadOutcome.providerBoundaryCallMade === true
  const uploadUnconfirmed = uploadOutcome.boundaryCalls.some(
    (c) => c.boundaryCode === 'provider_termination_unconfirmed',
  )
  const readbackInvokedChild = readbackResult !== null && readbackResult.performed === true
  const readbackUnconfirmed =
    readbackResult !== null && readbackResult.terminationConfirmed === false

  if (uploadUnconfirmed || readbackUnconfirmed) return 'unconfirmed'
  if (uploadInvokedChild || readbackInvokedChild) return 'confirmed'
  return 'not_applicable'
}

/**
 * The retry disposition of one finished attempt (E3J6C) — `R1`, the
 * collision-only class, and nothing else.
 *
 * ELIGIBLE only when EVERY condition holds, all read from the EFFECTIVE
 * durable attestation (never from a proposal, never from free text):
 *
 *   - the intent record is `confirmed`;
 *   - `verdict: 'rejected'`, `stage: 'upload'`,
 *     `upload_transfer_state: 'definitely_zero'`;
 *   - no readback was performed, containment is `valid`, termination is
 *     `confirmed`, and the attestation's own lock advice is `release`;
 *   - the caller's report says `lockAction: 'release'` and cleanup `complete`;
 *   - AND the stop is exactly one of the two collision shapes:
 *       · `remote_path_occupied` at a namespace/object preflight step, whose
 *         last boundary call carried no boundary code (a successful `info`
 *         that FOUND the path), or
 *       · `provider_rejected` at an upload step whose anchored boundary code
 *         is `name_conflict`.
 *
 * Anything else — including `provider_refused_before_spawn`,
 * `credential_unavailable`, every indeterminate outcome, every readback or
 * internal finding, a missing attestation, or a malformed input — is
 * `not_eligible`. Total: never throws.
 *
 * @param {object} args
 * @param {object|null} args.attestation  the effective written attestation, or null
 * @param {string} args.lockAction         the report's (possibly escalated) lock action
 * @param {string} args.cleanupState       the report's cleanup state
 * @returns {'eligible_zero_transfer_collision'|'not_eligible'}
 */
export function deriveRetryDisposition(args) {
  try {
    if (args === null || typeof args !== 'object') return 'not_eligible'
    const { attestation: a, lockAction, cleanupState } = args
    if (a === null || typeof a !== 'object') return 'not_eligible'
    if (lockAction !== 'release' || cleanupState !== 'complete') return 'not_eligible'
    if (a.future_lock_advice !== 'release') return 'not_eligible'
    if (a.intent_record === null || typeof a.intent_record !== 'object') return 'not_eligible'
    if (a.intent_record.state !== 'confirmed') return 'not_eligible'
    if (a.verdict !== 'rejected' || a.stage !== 'upload') return 'not_eligible'
    if (a.upload_transfer_state !== 'definitely_zero') return 'not_eligible'
    if (a.containment !== 'valid' || a.termination !== 'confirmed') return 'not_eligible'
    if (a.readback === null || typeof a.readback !== 'object') return 'not_eligible'
    if (a.readback.performed !== false) return 'not_eligible'
    const u = a.upload_outcome
    if (u === null || typeof u !== 'object') return 'not_eligible'
    if (u.code !== a.code) return 'not_eligible'
    if (
      a.code === 'remote_path_occupied' &&
      COLLISION_PREFLIGHT_STEPS.includes(u.failed_step) &&
      u.boundary_code === null
    ) {
      return 'eligible_zero_transfer_collision'
    }
    if (
      a.code === 'provider_rejected' &&
      COLLISION_UPLOAD_STEPS.includes(u.failed_step) &&
      u.boundary_code === 'name_conflict'
    ) {
      return 'eligible_zero_transfer_collision'
    }
    return 'not_eligible'
  } catch {
    return 'not_eligible'
  }
}
