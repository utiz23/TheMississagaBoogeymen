/**
 * A single attested cloud-upload attempt — THE PRODUCTION API (E3J6B).
 *
 * A thin wrapper over `internal/backup-cloud-attempt-orchestrator-core.mjs`,
 * bound once, at module load, to the real bound production functions of the
 * four collaborating modules — the upload attempt
 * (`backup-cloud-upload.mjs`), the containment canary
 * (`backup-cloud-containment.mjs`), the attestation-record session
 * (`backup-cloud-attestation-records.mjs`), and the readback session
 * (`backup-cloud-readback.mjs`) — plus the real clock. See the core's
 * docblock for the exact state machine.
 *
 * `runAttestedAttempt()` accepts only validated domain inputs: `config`,
 * `artifactBase`, `cloudRunId`, `sequence`, `containmentProof`, and an
 * optional `signal`. No `deps`, callback, executable, argv, script, or
 * arbitrary path is accepted anywhere in this module's signatures.
 */

import { verifyContainmentProof } from './backup-cloud-containment.mjs'
import {
  discardPreparedUploadAttempt,
  executeUploadAttempt,
  prepareUploadAttempt,
} from './backup-cloud-upload.mjs'
import {
  establishAttemptRecordSession,
  writeAttemptAttestation,
  writeAttemptIntent,
} from './backup-cloud-attestation-records.mjs'
import {
  cleanupAttemptWorkspace,
  establishReadbackSession,
  proveReadbackCapacity,
  readBackAttemptTriple,
  setupAttemptWorkspace,
} from './backup-cloud-readback.mjs'
import {
  CLOUD_ATTEMPT_LOCK_ACTIONS,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTEMPT_VERDICTS,
  CLOUD_CONTAINMENT_STATES,
} from './backup-cloud-attempt-verdict.mjs'
import { makeAttemptOrchestrator } from './internal/backup-cloud-attempt-orchestrator-core.mjs'

export {
  CLOUD_ATTEMPT_LOCK_ACTIONS,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTEMPT_VERDICTS,
  CLOUD_CONTAINMENT_STATES,
}

export const CLOUD_WORKSPACE_CLEANUP_STATES = Object.freeze([
  'not_started',
  'complete',
  'incomplete',
  'withheld_termination_unconfirmed',
])

/** Bound ONCE, at module load, to the real collaborating modules. Never rebuilt, never parameterized. */
const ORCHESTRATOR = makeAttemptOrchestrator({
  upload: Object.freeze({
    prepareUploadAttempt,
    executeUploadAttempt,
    discardPreparedUploadAttempt,
  }),
  containment: Object.freeze({ verifyContainmentProof }),
  records: Object.freeze({
    establishAttemptRecordSession,
    writeAttemptIntent,
    writeAttemptAttestation,
  }),
  readback: Object.freeze({
    establishReadbackSession,
    proveReadbackCapacity,
    setupAttemptWorkspace,
    readBackAttemptTriple,
    cleanupAttemptWorkspace,
  }),
  now: () => Date.now(),
})

/**
 * Run one complete, attested cloud-upload attempt: prepare, establish
 * intent/attestation durability, validate containment, prove capacity, set
 * up the workspace, execute the upload, read back and independently verify
 * the result, and durably record the outcome.
 *
 * @param {object} args
 * @param {object} args.config            a cloud config; re-validated here
 * @param {string} args.artifactBase      `<artifactPrefix>-<YYYYMMDDTHHMMSSZ>`
 * @param {string} args.cloudRunId        `YYYYMMDDTHHMMSSZ-<8 hex>` — the SAME
 *   id passed to `proveReadbackContainment()` for this run
 * @param {number} args.sequence          this attempt's ordinal within `cloudRunId`
 * @param {object} args.containmentProof  the `proof` from a prior
 *   `proveReadbackContainment()` `'proven'` result
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<object>} the frozen `CloudAttemptReport`
 * @throws {BackupError} `cloud_attempt_invalid_input` before any attempt
 *   identity exists; `cloud_upload_invalid_input` / `cloud_upload_attempt_id_failed`
 *   from `prepareUploadAttempt()` itself, for the same reason.
 */
export async function runAttestedAttempt(args) {
  if (args === null || typeof args !== 'object') return ORCHESTRATOR.runAttestedAttempt(args)
  const { config, artifactBase, cloudRunId, sequence, containmentProof, signal } = args
  return ORCHESTRATOR.runAttestedAttempt({
    config,
    artifactBase,
    cloudRunId,
    sequence,
    containmentProof,
    signal,
  })
}
