/**
 * Cloud-attempt intent/attestation records — THE PRODUCTION API (E3J6B).
 *
 * A thin wrapper over `internal/backup-cloud-attestation-records-core.mjs`,
 * bound once, at module load, to `REAL_ATTESTATION_RECORDS_DEPS`. See that
 * file's docblock for the record-session model, the durable-writer algorithm,
 * and the reader contract. The caller supplies no filesystem dependency,
 * spawn implementation, or directory identity of any kind; a `deps` property
 * on an argument object is inert.
 *
 * `establishAttemptRecordSession({config, artifactBase, attemptId})` binds the
 * complete attempt identity once. `writeAttemptIntent()`/`writeAttemptAttestation()`
 * both read `artifactBase`/`attemptId` from that same session's private state —
 * a caller cannot supply a second, different `artifactBase` for the two writes,
 * and a session from a different module instance (a test double, for example)
 * authorizes nothing here.
 */

import {
  CLOUD_ATTEMPT_BOUNDARY_CODES,
  CLOUD_ATTEMPT_CODES,
  CLOUD_ATTEMPT_CODES_BY_STAGE,
  CLOUD_ATTEMPT_INTENT_KIND,
  CLOUD_ATTEMPT_INTENT_SCHEMA_VERSION,
  CLOUD_ATTEMPT_REJECTED_CODES,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTESTATION_KIND,
  CLOUD_ATTESTATION_SCHEMA_VERSION,
  CLOUD_RECORD_CEILING_BYTES,
  REAL_ATTESTATION_RECORDS_DEPS,
  makeAttestationRecords,
} from './internal/backup-cloud-attestation-records-core.mjs'

export {
  CLOUD_ATTEMPT_BOUNDARY_CODES,
  CLOUD_ATTEMPT_CODES,
  CLOUD_ATTEMPT_CODES_BY_STAGE,
  CLOUD_ATTEMPT_INTENT_KIND,
  CLOUD_ATTEMPT_INTENT_SCHEMA_VERSION,
  CLOUD_ATTEMPT_REJECTED_CODES,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTESTATION_KIND,
  CLOUD_ATTESTATION_SCHEMA_VERSION,
  CLOUD_RECORD_CEILING_BYTES,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const RECORDS = makeAttestationRecords(REAL_ATTESTATION_RECORDS_DEPS)

/**
 * @param {object} args
 * @param {object} args.config       a cloud config; re-validated here
 * @param {string} args.artifactBase
 * @param {string} args.attemptId
 * @returns {object} an opaque, frozen record session
 * @throws {BackupError} `cloud_attempt_invalid_input` / `attestation_dir_untrusted`
 */
export function establishAttemptRecordSession(args) {
  if (args === null || typeof args !== 'object') return RECORDS.establishAttemptRecordSession(args)
  const { config, artifactBase, attemptId } = args
  return RECORDS.establishAttemptRecordSession({ config, artifactBase, attemptId })
}

/**
 * @param {object} args
 * @param {object} args.session       from `establishAttemptRecordSession()` of THIS module
 * @param {object} args.intentFields
 * @throws {BackupError} `record_session_invalid` / `cloud_intent_create_failed` /
 *   `cloud_intent_durability_unconfirmed` / `cloud_intent_schema_invalid`
 */
export function writeAttemptIntent(args) {
  if (args === null || typeof args !== 'object') return RECORDS.writeAttemptIntent(args)
  const { session, intentFields } = args
  return RECORDS.writeAttemptIntent({ session, intentFields })
}

/**
 * @param {object} args
 * @param {object} args.session
 * @param {object} args.attestationFields  the proposal; `intent_record` and
 *   `future_lock_advice` are never accepted — both are derived here
 * @returns {{ok: true, path: string, intentRecordConfirmed: boolean, attestation: object}}
 *   `attestation` is the deep-frozen EFFECTIVE record exactly as written — the
 *   only thing a report may be built from
 * @throws {BackupError} `record_session_invalid` / `attestation_dir_untrusted` /
 *   `cloud_attestation_create_failed` / `cloud_attestation_durability_unconfirmed` /
 *   `cloud_attestation_schema_invalid`
 */
export function writeAttemptAttestation(args) {
  if (args === null || typeof args !== 'object') return RECORDS.writeAttemptAttestation(args)
  const { session, attestationFields } = args
  return RECORDS.writeAttemptAttestation({ session, attestationFields })
}

/** @throws {BackupError} `cloud_attempt_invalid_input` / `attestation_dir_untrusted` / `cloud_record_not_found` / `cloud_record_unreadable` / `cloud_intent_schema_invalid` */
export function readCloudAttemptIntent(args) {
  if (args === null || typeof args !== 'object') return RECORDS.readCloudAttemptIntent(args)
  const { config, artifactBase, attemptId } = args
  return RECORDS.readCloudAttemptIntent({ config, artifactBase, attemptId })
}

/** @throws {BackupError} `cloud_attempt_invalid_input` / `attestation_dir_untrusted` / `cloud_record_not_found` / `cloud_record_unreadable` / `cloud_attestation_schema_invalid` */
export function readCloudAttestation(args) {
  if (args === null || typeof args !== 'object') return RECORDS.readCloudAttestation(args)
  const { config, artifactBase, attemptId } = args
  return RECORDS.readCloudAttestation({ config, artifactBase, attemptId })
}
