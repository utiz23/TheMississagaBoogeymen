/**
 * Pure verdict derivation — E3J6B. No filesystem, no clock, no network:
 * every test here is a plain function call over a synthetic fixture.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLOUD_ATTEMPT_LOCK_ACTIONS,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTEMPT_VERDICTS,
  CLOUD_CONTAINMENT_STATES,
  classifyUploadOutcome,
  deriveOverallTermination,
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
