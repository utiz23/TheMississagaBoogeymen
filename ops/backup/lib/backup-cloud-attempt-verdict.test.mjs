/**
 * Pure verdict derivation — E3J6B. No filesystem, no clock, no network:
 * every test here is a plain function call over a synthetic fixture.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLOUD_ATTEMPT_LOCK_ACTIONS,
  CLOUD_ATTEMPT_RETRY_DISPOSITIONS,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTEMPT_VERDICTS,
  CLOUD_CONTAINMENT_STATES,
  classifyUploadOutcome,
  deriveOverallTermination,
  deriveRetryDisposition,
  objectWritePossible,
} from './backup-cloud-attempt-verdict.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-attempt-verdict' })

function call({ operation, boundaryResult, boundaryCode = null, remotePath = '/x' }) {
  return Object.freeze({
    step: operation,
    operation,
    remotePath,
    boundaryResult,
    boundaryCode,
    reportedFinding: null,
  })
}

function outcome(overrides = {}) {
  return {
    code: null,
    status: 'upload_success_reported_pending_readback',
    transferState: 'unknown',
    failedStep: null,
    boundaryCalls: [],
    furthestUploadSuccessReportedRole: null,
    providerBoundaryCallMade: false,
    ...overrides,
  }
}

// ── vocabularies ─────────────────────────────────────────────────────────────

test('closed vocabularies are frozen and exact', () => {
  assert.deepEqual(CLOUD_ATTEMPT_VERDICTS, ['verified', 'rejected', 'indeterminate'])
  assert.deepEqual(CLOUD_CONTAINMENT_STATES, ['not_checked', 'valid', 'invalid'])
  assert.deepEqual(CLOUD_ATTEMPT_LOCK_ACTIONS, [
    'release',
    'retain_attestation_unconfirmed',
    'retain_termination_unconfirmed',
    'retain_internal_error',
  ])
  assert.ok(CLOUD_ATTEMPT_STAGES.includes('local_refusal'))
  assert.ok(CLOUD_ATTEMPT_STAGES.includes('completion'))
  for (const v of [
    CLOUD_ATTEMPT_VERDICTS,
    CLOUD_CONTAINMENT_STATES,
    CLOUD_ATTEMPT_LOCK_ACTIONS,
    CLOUD_ATTEMPT_STAGES,
  ]) {
    assert.ok(Object.isFrozen(v))
  }
})

// ── objectWritePossible — the seven branches ────────────────────────────────

test('objectWritePossible: no upload call at all (info/create-folder only, including a successful create-folder) -> false', () => {
  const o = outcome({
    code: 'remote_path_occupied',
    status: 'rejected',
    boundaryCalls: [
      call({ operation: 'info', boundaryResult: 'success' }),
      call({ operation: 'create-folder', boundaryResult: 'success' }),
      call({ operation: 'info', boundaryResult: 'success' }),
    ],
  })
  assert.equal(objectWritePossible(o), false)
})

test('objectWritePossible: ciphertext upload succeeds, checksum upload later fails -> true', () => {
  const o = outcome({
    code: 'provider_rejected',
    status: 'rejected',
    furthestUploadSuccessReportedRole: 'ciphertext',
    boundaryCalls: [
      call({ operation: 'upload', boundaryResult: 'success' }),
      call({ operation: 'upload', boundaryResult: 'rejected', boundaryCode: 'name_conflict' }),
    ],
  })
  assert.equal(objectWritePossible(o), true)
})

test('objectWritePossible: exactly one upload call, rejected (definite zero) -> false', () => {
  const o = outcome({
    code: 'provider_rejected',
    status: 'rejected',
    boundaryCalls: [
      call({ operation: 'upload', boundaryResult: 'rejected', boundaryCode: 'name_conflict' }),
    ],
  })
  assert.equal(objectWritePossible(o), false)
})

test('objectWritePossible: exactly one upload call, refused_before_spawn -> false', () => {
  const o = outcome({
    code: 'provider_refused_before_spawn',
    status: 'rejected',
    boundaryCalls: [
      call({
        operation: 'upload',
        boundaryResult: 'refused_before_spawn',
        boundaryCode: 'cli_hash_mismatch',
      }),
    ],
  })
  assert.equal(objectWritePossible(o), false)
})

test('objectWritePossible: exactly one upload call, indeterminate (e.g. timeout) -> true', () => {
  const o = outcome({
    code: 'provider_indeterminate',
    status: 'indeterminate',
    boundaryCalls: [
      call({
        operation: 'upload',
        boundaryResult: 'indeterminate',
        boundaryCode: 'provider_timeout',
      }),
    ],
  })
  assert.equal(objectWritePossible(o), true)
})

test('objectWritePossible: exactly one upload call, an unclassified boundary throw ("failed") -> true', () => {
  const o = outcome({
    code: 'provider_call_failed',
    status: 'indeterminate',
    boundaryCalls: [call({ operation: 'upload', boundaryResult: 'failed' })],
  })
  assert.equal(objectWritePossible(o), true)
})

test('objectWritePossible: furthestUploadSuccessReportedRole set even though the most recent call is a later, unrelated info -> true', () => {
  const o = outcome({
    code: null,
    status: 'upload_success_reported_pending_readback',
    furthestUploadSuccessReportedRole: 'manifest',
    boundaryCalls: [
      call({ operation: 'upload', boundaryResult: 'success' }),
      call({ operation: 'upload', boundaryResult: 'success' }),
      call({ operation: 'upload', boundaryResult: 'success' }),
    ],
  })
  assert.equal(objectWritePossible(o), true)
})

// ── classifyUploadOutcome — independent derivation + cross-check ───────────

test('classifyUploadOutcome: every independently-indeterminate code cross-checks clean and stays indeterminate', () => {
  for (const code of [
    'created_folder_unconfirmed',
    'provider_indeterminate',
    'provider_call_failed',
    'attempt_cancelled',
    'local_source_changed',
  ]) {
    const o = outcome({
      code,
      status: 'indeterminate',
      failedStep: 'preflight_root',
      boundaryCalls: [
        call({
          operation: 'info',
          boundaryResult: 'indeterminate',
          boundaryCode: 'provider_timeout',
        }),
      ],
    })
    const result = classifyUploadOutcome(o)
    assert.equal(result.verdict, 'indeterminate', code)
    assert.equal(result.code, code)
    assert.equal(result.consistent, true)
    assert.equal(result.boundaryCode, 'provider_timeout')
    assert.equal(result.failedStep, 'preflight_root')
  }
})

test('classifyUploadOutcome: every other outcome code cross-checks clean and is rejected', () => {
  for (const code of [
    'source_dir_unusable',
    'local_file_missing',
    'local_triple_incomplete',
    'remote_root_absent',
    'remote_root_not_active_folder',
    'remote_path_occupied',
    'provider_rejected',
    'provider_refused_before_spawn',
  ]) {
    const o = outcome({ code, status: 'rejected', boundaryCalls: [] })
    const result = classifyUploadOutcome(o)
    assert.equal(result.verdict, 'rejected', code)
    assert.equal(result.code, code)
    assert.equal(result.consistent, true)
  }
})

test('classifyUploadOutcome: a manufactured disagreement with uploadOutcome.status is internal_invariant_violated', () => {
  // A rejected-class code paired with a status the module itself would never
  // produce for it -- simulating upload-core's own classification drifting
  // out of sync with this independent derivation.
  const o = outcome({ code: 'remote_root_absent', status: 'indeterminate', boundaryCalls: [] })
  const result = classifyUploadOutcome(o)
  assert.equal(result.verdict, 'indeterminate')
  assert.equal(result.code, 'internal_invariant_violated')
  assert.equal(result.consistent, false)
})

test('classifyUploadOutcome: a success (code: null) reaching this function at all is flagged inconsistent if status/transferState disagree', () => {
  const inconsistent = outcome({ code: null, status: 'rejected', transferState: 'unknown' })
  const result = classifyUploadOutcome(inconsistent)
  assert.equal(result.code, 'internal_invariant_violated')
  assert.equal(result.consistent, false)

  const consistent = outcome({
    code: null,
    status: 'upload_success_reported_pending_readback',
    transferState: 'unknown',
  })
  const result2 = classifyUploadOutcome(consistent)
  assert.equal(result2.consistent, true)
})

test('classifyUploadOutcome: boundaryCode is taken from the LAST boundary call only', () => {
  const o = outcome({
    code: 'provider_rejected',
    status: 'rejected',
    boundaryCalls: [
      call({ operation: 'info', boundaryResult: 'success' }),
      call({ operation: 'upload', boundaryResult: 'rejected', boundaryCode: 'name_conflict' }),
    ],
  })
  assert.equal(classifyUploadOutcome(o).boundaryCode, 'name_conflict')
})

test('classifyUploadOutcome: no boundary calls at all yields a null boundaryCode', () => {
  const o = outcome({ code: 'source_dir_unusable', status: 'rejected', boundaryCalls: [] })
  assert.equal(classifyUploadOutcome(o).boundaryCode, null)
})

// ── deriveOverallTermination ─────────────────────────────────────────────────

test('deriveOverallTermination: no child ever invoked -> not_applicable', () => {
  const term = deriveOverallTermination({
    uploadOutcome: outcome({ providerBoundaryCallMade: false }),
    readbackResult: null,
  })
  assert.equal(term, 'not_applicable')
})

test('deriveOverallTermination: upload invoked a child, readback never ran -> confirmed', () => {
  const term = deriveOverallTermination({
    uploadOutcome: outcome({
      providerBoundaryCallMade: true,
      boundaryCalls: [call({ operation: 'info', boundaryResult: 'success' })],
    }),
    readbackResult: null,
  })
  assert.equal(term, 'confirmed')
})

test('deriveOverallTermination: an unconfirmed upload boundary call forces unconfirmed, even if readback later ran cleanly', () => {
  const term = deriveOverallTermination({
    uploadOutcome: outcome({
      providerBoundaryCallMade: true,
      boundaryCalls: [
        call({
          operation: 'upload',
          boundaryResult: 'indeterminate',
          boundaryCode: 'provider_termination_unconfirmed',
        }),
      ],
    }),
    readbackResult: { performed: true, terminationConfirmed: true },
  })
  assert.equal(term, 'unconfirmed')
})

test('deriveOverallTermination: readback itself reports unconfirmed termination -> unconfirmed', () => {
  const term = deriveOverallTermination({
    uploadOutcome: outcome({
      providerBoundaryCallMade: true,
      boundaryCalls: [call({ operation: 'upload', boundaryResult: 'success' })],
    }),
    readbackResult: { performed: true, terminationConfirmed: false },
  })
  assert.equal(term, 'unconfirmed')
})

test('deriveOverallTermination: upload and readback both confirmed -> confirmed', () => {
  const term = deriveOverallTermination({
    uploadOutcome: outcome({
      providerBoundaryCallMade: true,
      boundaryCalls: [call({ operation: 'upload', boundaryResult: 'success' })],
    }),
    readbackResult: { performed: true, terminationConfirmed: true },
  })
  assert.equal(term, 'confirmed')
})

// ── deriveRetryDisposition — R1, the collision-only class (E3J6C) ─────────────

const ELIGIBLE = 'eligible_zero_transfer_collision'

function r1Attestation(overrides = {}) {
  return {
    verdict: 'rejected',
    stage: 'upload',
    code: 'remote_path_occupied',
    containment: 'valid',
    termination: 'confirmed',
    upload_transfer_state: 'definitely_zero',
    upload_outcome: {
      code: 'remote_path_occupied',
      failed_step: 'preflight_namespace',
      boundary_code: null,
    },
    intent_record: { state: 'confirmed' },
    readback: { performed: false },
    future_lock_advice: 'release',
    ...overrides,
  }
}

const r1 = (attestation, extra = {}) =>
  deriveRetryDisposition({ attestation, lockAction: 'release', cleanupState: 'complete', ...extra })

test('deriveRetryDisposition: the vocabulary is closed and frozen', () => {
  assert.deepEqual(CLOUD_ATTEMPT_RETRY_DISPOSITIONS, [ELIGIBLE, 'not_eligible'])
  assert.ok(Object.isFrozen(CLOUD_ATTEMPT_RETRY_DISPOSITIONS))
})

test('deriveRetryDisposition: both collision shapes, at every named step, are eligible', () => {
  for (const step of [
    'preflight_namespace',
    'preflight_ciphertext',
    'preflight_checksum',
    'preflight_manifest',
  ]) {
    const a = r1Attestation({
      upload_outcome: { code: 'remote_path_occupied', failed_step: step, boundary_code: null },
    })
    assert.equal(r1(a), ELIGIBLE, step)
  }
  for (const step of ['upload_ciphertext', 'upload_checksum', 'upload_manifest']) {
    const a = r1Attestation({
      code: 'provider_rejected',
      upload_outcome: {
        code: 'provider_rejected',
        failed_step: step,
        boundary_code: 'name_conflict',
      },
    })
    assert.equal(r1(a), ELIGIBLE, step)
  }
})

test('deriveRetryDisposition: flipping ANY single condition makes it not_eligible', () => {
  const flips = [
    ['verdict', { verdict: 'indeterminate' }],
    ['stage readback', { stage: 'readback' }],
    ['stage local_refusal', { stage: 'local_refusal' }],
    ['transfer unknown', { upload_transfer_state: 'unknown' }],
    ['containment invalid', { containment: 'invalid' }],
    ['containment not_checked', { containment: 'not_checked' }],
    ['termination unconfirmed', { termination: 'unconfirmed' }],
    ['termination not_applicable', { termination: 'not_applicable' }],
    ['intent not confirmed', { intent_record: { state: 'not_confirmed' } }],
    ['intent missing', { intent_record: null }],
    ['readback performed', { readback: { performed: true } }],
    ['readback missing', { readback: null }],
    ['advice retain', { future_lock_advice: 'retain_internal_error' }],
    [
      'outcome code disagrees',
      {
        upload_outcome: {
          code: 'remote_root_absent',
          failed_step: 'preflight_namespace',
          boundary_code: null,
        },
      },
    ],
    [
      'preflight_root is not a collision step',
      {
        upload_outcome: {
          code: 'remote_path_occupied',
          failed_step: 'preflight_root',
          boundary_code: null,
        },
      },
    ],
    [
      'occupied with a boundary code',
      {
        upload_outcome: {
          code: 'remote_path_occupied',
          failed_step: 'preflight_namespace',
          boundary_code: 'provider_timeout',
        },
      },
    ],
    ['upload outcome missing', { upload_outcome: null }],
  ]
  assert.equal(r1(r1Attestation()), ELIGIBLE, 'baseline')
  for (const [label, override] of flips) {
    assert.equal(r1(r1Attestation(override)), 'not_eligible', label)
  }
  assert.equal(r1(r1Attestation(), { lockAction: 'retain_internal_error' }), 'not_eligible')
  assert.equal(
    r1(r1Attestation(), { lockAction: 'retain_termination_unconfirmed' }),
    'not_eligible',
  )
  assert.equal(
    r1(r1Attestation(), { lockAction: 'retain_attestation_unconfirmed' }),
    'not_eligible',
  )
  for (const cleanupState of [
    'incomplete',
    'not_started',
    'withheld_termination_unconfirmed',
    undefined,
  ]) {
    assert.equal(r1(r1Attestation(), { cleanupState }), 'not_eligible', String(cleanupState))
  }
})

test('deriveRetryDisposition: every prohibited class is not_eligible', () => {
  const rejectedAtUpload = (boundaryCode, code = 'provider_rejected') =>
    r1Attestation({
      code,
      upload_outcome: { code, failed_step: 'upload_ciphertext', boundary_code: boundaryCode },
    })
  assert.equal(r1(rejectedAtUpload('credential_unavailable')), 'not_eligible')
  for (const pre of [
    'cloud_cli_invalid_input',
    'cloud_cli_argv_invalid',
    'cli_executable_unreadable',
    'cli_hash_pin_malformed',
    'cli_hash_observed_malformed',
    'cli_hash_mismatch',
  ]) {
    assert.equal(r1(rejectedAtUpload(pre, 'provider_refused_before_spawn')), 'not_eligible', pre)
    // even a (malformed) name_conflict boundary code under a pre-spawn code is not eligible
  }
  assert.equal(
    r1(rejectedAtUpload('name_conflict', 'provider_refused_before_spawn')),
    'not_eligible',
  )
  // name_conflict at a preflight step (not an upload step) is not the anchored shape
  assert.equal(
    r1(
      r1Attestation({
        code: 'provider_rejected',
        upload_outcome: {
          code: 'provider_rejected',
          failed_step: 'preflight_namespace',
          boundary_code: 'name_conflict',
        },
      }),
    ),
    'not_eligible',
  )
  for (const code of [
    'remote_root_absent',
    'remote_root_not_active_folder',
    'local_file_empty',
    'provider_indeterminate',
    'attempt_cancelled',
    'created_folder_unconfirmed',
  ]) {
    assert.equal(
      r1(
        r1Attestation({
          code,
          upload_outcome: { code, failed_step: 'preflight_root', boundary_code: null },
        }),
      ),
      'not_eligible',
      code,
    )
  }
  for (const [stage, code] of [
    ['readback', 'role_hash_mismatch'],
    ['readback', 'remote_object_absent'],
    ['completion', 'completion_adapter_internal_contradiction'],
    ['internal', 'internal_invariant_violated'],
    ['internal', 'clock_unusable'],
    ['internal', 'intent_record_lost'],
  ]) {
    assert.equal(r1(r1Attestation({ stage, code, verdict: 'indeterminate' })), 'not_eligible', code)
  }
})

test('deriveRetryDisposition: total — malformed input never throws and is not_eligible', () => {
  const hostile = {}
  Object.defineProperty(hostile, 'verdict', {
    get() {
      throw new Error('boom')
    },
  })
  for (const input of [
    undefined,
    null,
    42,
    'x',
    {},
    { attestation: null, lockAction: 'release', cleanupState: 'complete' },
    { attestation: hostile, lockAction: 'release', cleanupState: 'complete' },
  ]) {
    assert.equal(deriveRetryDisposition(input), 'not_eligible')
  }
})
