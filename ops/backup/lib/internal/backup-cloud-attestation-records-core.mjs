/**
 * Cloud-attempt intent and attestation records — schema, session, and durable
 * writer/reader — INTERNAL IMPLEMENTATION CORE (E3J6B).
 *
 * WHAT THIS FILE IS
 * ------------------
 * Every line of the record-session and durable-record logic. It does NOT
 * bind its own real dependencies: `makeAttestationRecords(deps)` builds the
 * five production operations against a supplied dependency set.
 * `../backup-cloud-attestation-records.mjs` is THE production API. It binds
 * `REAL_ATTESTATION_RECORDS_DEPS` once at module load and exposes operations
 * whose signatures accept no dependency of any kind.
 *
 * THE RECORD SESSION
 * -------------------
 * `establishAttemptRecordSession({config, artifactBase, attemptId})` binds,
 * once, the complete attempt identity this session may ever write for:
 * `attestation.dir`'s canonical identity (`dev`/`ino`/`uid`/`mode`) AND the
 * exact `artifactBase`/`attemptId` pair. The returned session is an opaque,
 * frozen object; all state that actually authorizes anything lives in a
 * `WeakMap` created INSIDE each `makeAttestationRecords()` call and keyed by
 * that object — a session from any other factory instance, however
 * identical its visible shape, authorizes nothing. `writeAttemptIntent()` and
 * `writeAttemptAttestation()` both read `artifactBase`/`attemptId` from THIS
 * private state — a caller cannot supply a second, different `artifactBase`
 * for the two writes, and a copied `{dev, ino}` object or a session token
 * from a different `makeAttestationRecords()` instance authorizes nothing.
 * Directory identity is reverified before every creation, before the
 * directory fsync, before every record readback, and once more as each
 * operation's final step; any change fails closed.
 *
 * `writeAttemptIntent()` records the exact bytes it wrote and read back
 * (filename, SHA-256, byte count, created `dev`/`ino`) in the session's
 * private state. `writeAttemptAttestation()` NEVER accepts an `intent_record`
 * from its caller — it re-opens and revalidates the exact intent file, under
 * the same session, immediately before constructing the attestation payload.
 * Only a revalidation that matches identity AND bytes exactly yields
 * `intent_record.state: 'confirmed'`; anything else — gone, changed identity,
 * changed bytes, or an intent that was never durably written at all — yields
 * `'not_confirmed'` and forces the recorded verdict away from `'verified'`.
 * A descriptor close failure during that re-read, or a directory identity
 * change observed after it, is also `'not_confirmed'`. The attestation's
 * `future_lock_advice` is DERIVED here (`deriveFutureLockAdvice()`), never
 * accepted, and `writeAttemptAttestation()` returns the effective record
 * exactly as written so a caller's report cannot diverge from it.
 *
 * CLOSED VOCABULARIES. Every finite field is validated by membership —
 * per-stage codes (`CLOUD_ATTEMPT_CODES_BY_STAGE`), upload outcome codes and
 * steps, boundary codes, and every enum — and the validator enforces the
 * cross-field invariants documented in the architecture memo §9.3
 * (code decides verdict; verified needs complete evidence; containment,
 * termination, cleanup, and lock advice agree; readback per-role coherence;
 * canonical remote paths and artifact names).
 *
 * Readers (`readCloudAttemptIntent()`, `readCloudAttestation()`) never accept
 * or produce a session. They independently re-establish `attestation.dir`
 * trust themselves, re-verify it after reading, treat only a definite ENOENT
 * as "not found", sanitize every open/fstat/read/close failure to a closed
 * code, and return a deep-frozen record.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'

import { BackupError, publishedTripleNames } from '../backup-artifact-contract.mjs'
import {
  CLOUD_ATTEMPT_LOCK_ACTIONS,
  CLOUD_ATTEMPT_STAGES as ALL_ATTEMPT_STAGES,
} from '../backup-cloud-attempt-verdict.mjs'
import { CLOUD_CLI_ERROR_CODES } from '../backup-cloud-cli.mjs'
import { validateCloudConfig } from '../backup-cloud-config.mjs'
import {
  ATTEMPT_ID_PATTERN,
  RUN_ID_PATTERN,
  assertSafeRemoteComponent,
  assertValidArtifactBase,
  buildAttestationFileName,
  buildCloudAttemptIntentFileName,
  buildPublishedObjectPaths,
} from '../backup-cloud-naming.mjs'
import { CLOUD_UPLOAD_OUTCOME_CODES, CLOUD_UPLOAD_STEPS } from '../backup-cloud-upload.mjs'
import {
  observeTrustedDirectoryIdentity,
  sameIdentity,
} from './backup-cloud-directory-authority.mjs'
import { CLOUD_READBACK_CODES } from './backup-cloud-readback-core.mjs'

export const CLOUD_ATTEMPT_INTENT_KIND = 'eanhl.cloud-attempt-intent'
export const CLOUD_ATTEMPT_INTENT_SCHEMA_VERSION = 1
export const CLOUD_ATTESTATION_KIND = 'eanhl.cloud-attestation'
export const CLOUD_ATTESTATION_SCHEMA_VERSION = 1

/** Approved security/resource ceilings — not U12/U13 production measurements. */
export const CLOUD_RECORD_CEILING_BYTES = 16 * 1024

const SHA256_HEX = /^[0-9a-f]{64}$/
const SHA512_HEX = /^[0-9a-f]{128}$/
/** Every timestamp this module itself produces (`started_at`/`finished_at`) is a real `Date#toISOString()` value — always exactly this shape. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/**
 * The producer's own `snapshot_ts` is validated by `formatSnapshotStamp()`
 * (`backup-artifact-contract.mjs`) against this exact, looser pattern —
 * fractional seconds optional. Reused here rather than restated, so this
 * field's acceptance can never silently drift from what the producer/upload
 * path already accepts.
 */
const SNAPSHOT_ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

function invalidInput(what) {
  throw new BackupError('cloud_attempt_invalid_input', `${what} is invalid.`)
}

// ─────────────────────────────────────────────────────────────────────────────
// The closed E3J6B code vocabularies. Every `code` an intent, an attestation,
// or an attempt report can carry is a member of exactly one of these sets —
// never a free-form string. A validator checks MEMBERSHIP, per stage.
// ─────────────────────────────────────────────────────────────────────────────

const deepFreezeSet = (values) => Object.freeze([...new Set(values)])

/**
 * A preparation-local refusal (`prepareUploadAttempt()` `'refused'`
 * disposition). `attempt_cancelled` (a signal already aborted before
 * preparation) is the one member that is NOT a definite rejection.
 */
export const CLOUD_LOCAL_REFUSAL_CODES = deepFreezeSet([
  'attempt_cancelled',
  'source_dir_unusable',
  'local_file_missing',
  'local_file_not_regular',
  'local_file_empty',
  'local_file_unmeasurable',
  'local_triple_incomplete',
  'local_triple_changed',
  'local_exceeds_readback_ceiling',
  'local_manifest_identity_invalid',
])

/**
 * The E3J4 pre-spawn `BackupError` codes a `refused_before_spawn` boundary
 * call carries. Restated from `internal/backup-cloud-upload-core.mjs`'s
 * `E3J4_PRE_SPAWN_CODES` (that core may only be imported by its own public
 * wrapper); `backup-cloud-upload.test.mjs` asserts the two stay equal.
 */
const PRE_SPAWN_BOUNDARY_CODES = Object.freeze([
  'cloud_cli_invalid_input',
  'cloud_cli_argv_invalid',
  'cli_executable_unreadable',
  'cli_hash_pin_malformed',
  'cli_hash_observed_malformed',
  'cli_hash_mismatch',
])

/** Every value an `upload_outcome.boundary_code` or a per-role `boundary_code` may hold. */
export const CLOUD_ATTEMPT_BOUNDARY_CODES = deepFreezeSet([
  ...CLOUD_CLI_ERROR_CODES,
  ...PRE_SPAWN_BOUNDARY_CODES,
])

/** Why the durable intent could not be established — kept distinct, never flattened. */
export const CLOUD_INTENT_FAILURE_CODES = deepFreezeSet([
  'cloud_intent_create_failed',
  'cloud_intent_durability_unconfirmed',
  'cloud_intent_schema_invalid',
  'attestation_dir_untrusted',
])

/** Why the durable attestation could not be established (report-only: nothing was written). */
export const CLOUD_ATTESTATION_FAILURE_CODES = deepFreezeSet([
  'cloud_attestation_create_failed',
  'cloud_attestation_durability_unconfirmed',
  'cloud_attestation_schema_invalid',
  'attestation_dir_untrusted',
  'internal_invariant_violated',
])

const READBACK_ROLE_STAGE_CODES = CLOUD_READBACK_CODES.filter(
  (c) =>
    ![
      'readback_dir_untrusted',
      'capacity_unprovable',
      'capacity_insufficient',
      'workspace_setup_failed',
      'workspace_collision',
      'completion_adapter_internal_contradiction',
    ].includes(c),
)

/**
 * The allowed `code` values for each stage. `attestation_dir_trust` and
 * `attestation` are report-only stages: they describe a failure to write any
 * attestation at all, so no durable record can carry them.
 */
export const CLOUD_ATTEMPT_CODES_BY_STAGE = Object.freeze({
  local_refusal: deepFreezeSet([...CLOUD_LOCAL_REFUSAL_CODES, 'internal_invariant_violated']),
  attestation_dir_trust: deepFreezeSet([
    'attestation_dir_untrusted',
    'internal_invariant_violated',
  ]),
  intent: CLOUD_INTENT_FAILURE_CODES,
  containment_proof: deepFreezeSet(['containment_proof_invalid']),
  capacity: deepFreezeSet([
    'readback_dir_untrusted',
    'readback_dir_identity_changed',
    'capacity_unprovable',
    'capacity_insufficient',
  ]),
  workspace: deepFreezeSet([
    'readback_dir_identity_changed',
    'workspace_setup_failed',
    'workspace_collision',
  ]),
  upload: deepFreezeSet([...CLOUD_UPLOAD_OUTCOME_CODES, 'internal_invariant_violated']),
  readback: deepFreezeSet(READBACK_ROLE_STAGE_CODES),
  completion: deepFreezeSet(['completion_adapter_internal_contradiction']),
  internal: deepFreezeSet(['internal_invariant_violated', 'clock_unusable', 'intent_record_lost']),
  attestation: CLOUD_ATTESTATION_FAILURE_CODES,
})

/** The complete closed set of top-level attempt codes, across every stage. */
export const CLOUD_ATTEMPT_CODES = deepFreezeSet(Object.values(CLOUD_ATTEMPT_CODES_BY_STAGE).flat())

/**
 * The ONLY codes that may carry `verdict: 'rejected'` — narrowly anchored,
 * definite findings. Every other code is `indeterminate`: a cancellation, a
 * timeout, an ambiguous transfer, or any internal failure is never a definite
 * rejection. The verdict is a function of the code, and the validator
 * enforces it in both directions.
 */
export const CLOUD_ATTEMPT_REJECTED_CODES = deepFreezeSet([
  ...CLOUD_LOCAL_REFUSAL_CODES.filter((c) => c !== 'attempt_cancelled'),
  'remote_root_absent',
  'remote_root_not_active_folder',
  'remote_path_occupied',
  'provider_rejected',
  'provider_refused_before_spawn',
  'remote_object_absent',
  'remote_object_not_active_file',
  'role_hash_mismatch',
  'role_size_mismatch',
])

/** Stages a durable attestation may record (the report-only two are excluded). */
const WRITABLE_STAGES = Object.freeze(
  ALL_ATTEMPT_STAGES.filter((s) => s !== 'attestation_dir_trust' && s !== 'attestation'),
)

/**
 * The lock advice an attestation carries is DERIVED here, never accepted from
 * a caller — one ordered rule, so a report built from the written record can
 * never disagree with it. Most conservative first.
 */
export function deriveFutureLockAdvice({ intentRecordState, termination, code }) {
  if (intentRecordState !== 'confirmed') return 'retain_attestation_unconfirmed'
  if (termination === 'unconfirmed') return 'retain_termination_unconfirmed'
  if (code === 'internal_invariant_violated') return 'retain_internal_error'
  return 'release'
}

function isNonNegSafeInt(v) {
  return Number.isSafeInteger(v) && v >= 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Small schema-validation helpers. Every failure is one stable code with a
// locally-authored, non-secret diagnostic — these are our own structured
// records, never attacker- or provider-controlled text.
// ─────────────────────────────────────────────────────────────────────────────

function schemaFail(code, what) {
  throw new BackupError(code, `${what} does not match the required schema.`)
}

function exactKeys(obj, keys, code, what) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) schemaFail(code, what)
  const actual = Object.keys(obj).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    schemaFail(code, what)
  }
}

function requireEnum(value, allowed, code, what) {
  if (!allowed.includes(value)) schemaFail(code, what)
  return value
}

function requireIso(value, code, what) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) schemaFail(code, what)
  return value
}

function requireIsoOrNull(value, code, what) {
  if (value === null) return null
  return requireIso(value, code, what)
}

function requireSnapshotIso(value, code, what) {
  if (typeof value !== 'string' || !SNAPSHOT_ISO_UTC.test(value)) schemaFail(code, what)
  return value
}

function requireSnapshotIsoOrNull(value, code, what) {
  if (value === null) return null
  return requireSnapshotIso(value, code, what)
}

function requireHex(value, pattern, code, what) {
  if (typeof value !== 'string' || !pattern.test(value)) schemaFail(code, what)
  return value
}

function requireHexOrNull(value, pattern, code, what) {
  if (value === null) return null
  return requireHex(value, pattern, code, what)
}

function requireNonEmptyString(value, code, what) {
  if (typeof value !== 'string' || value === '') schemaFail(code, what)
  return value
}

function requireCount(value, code, what) {
  if (!isNonNegSafeInt(value)) schemaFail(code, what)
  return value
}

function requireCountOrNull(value, code, what) {
  if (value === null) return null
  return requireCount(value, code, what)
}

function requireBool(value, code, what) {
  if (typeof value !== 'boolean') schemaFail(code, what)
  return value
}

function requireBoolOrNull(value, code, what) {
  if (value === null) return null
  return requireBool(value, code, what)
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent schema (schema_version 1).
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_TOP_KEYS = [
  'kind',
  'schema_version',
  'attempt_id',
  'cloud_run_id',
  'sequence',
  'started_at',
  'artifact',
  'source',
  'remote',
  'local',
  'cli',
  'containment',
  'workspace',
  'refusal',
]
const ARTIFACT_KEYS = ['base', 'ciphertext', 'checksum', 'manifest']
const HASH_BYTES_KEYS = ['sha256', 'bytes']
const REMOTE_KEYS = ['root', 'namespace', 'ciphertext_path', 'checksum_path', 'manifest_path']
const LOCAL_KEYS = ['source_dir', 'ciphertext_path', 'checksum_path', 'manifest_path']
const CLI_KEYS = ['executable', 'expected_sha512']
const CONTAINMENT_INTENT_KEYS = [
  'mechanism',
  'wrapper_executable',
  'wrapper_expected_sha512',
  'ceilings',
]
const CEILING_KEYS = ['ciphertext', 'checksum', 'manifest']
const SOURCE_KEYS = ['evidence', 'snapshot_ts', 'run_id', 'ciphertext', 'checksum', 'manifest']
const REFUSAL_KEYS = ['step', 'code']

/** Readback order; every per-role structure is keyed by exactly these. */
const RECORD_ROLES = Object.freeze(['manifest', 'checksum', 'ciphertext'])
const TERMINATION_STATES = Object.freeze(['confirmed', 'unconfirmed', 'not_applicable'])
const OBSERVED_STATES = Object.freeze(['not_observed', 'absent', 'active_file', 'other'])

function validateArtifactObject(v, code, what) {
  exactKeys(v, ARTIFACT_KEYS, code, what)
  requireNonEmptyString(v.base, code, `${what}.base`)
  let expected
  try {
    assertSafeRemoteComponent(v.base, 'artifactBase')
    assertValidArtifactBase(v.base)
    expected = publishedTripleNames(v.base)
  } catch {
    schemaFail(code, `${what}.base`)
  }
  for (const k of ['ciphertext', 'checksum', 'manifest']) {
    if (v[k] !== expected[k]) schemaFail(code, `${what}.${k}`)
  }
  return v
}

/** The remote block must be EXACTLY the canonical attempt paths for this base/attempt. */
function validateRemoteObject(v, { artifactBase, attemptId }, code, what) {
  exactKeys(v, REMOTE_KEYS, code, what)
  for (const k of REMOTE_KEYS) requireNonEmptyString(v[k], code, `${what}.${k}`)
  let expected
  try {
    expected = buildPublishedObjectPaths({ remoteRoot: v.root, artifactBase, attemptId })
  } catch {
    schemaFail(code, `${what}.root`)
  }
  if (
    v.namespace !== expected.namespace ||
    v.ciphertext_path !== expected.ciphertextPath ||
    v.checksum_path !== expected.checksumPath ||
    v.manifest_path !== expected.manifestPath
  ) {
    schemaFail(code, `${what} (must be the canonical attempt paths)`)
  }
  return v
}

function requireWorkspacePath(value, { artifactBase, attemptId }, code, what) {
  requireNonEmptyString(value, code, what)
  if (!value.startsWith('/') || !value.endsWith(`/${artifactBase}.${attemptId}`)) {
    schemaFail(code, what)
  }
  return value
}

function validateHashBytesOrNull(v, code, what) {
  if (v === null) return null
  exactKeys(v, HASH_BYTES_KEYS, code, what)
  requireHex(v.sha256, SHA256_HEX, code, `${what}.sha256`)
  requireCount(v.bytes, code, `${what}.bytes`)
  return v
}

function validateIntentPayload(payload) {
  const CODE = 'cloud_intent_schema_invalid'
  exactKeys(payload, INTENT_TOP_KEYS, CODE, 'intent')
  if (payload.kind !== CLOUD_ATTEMPT_INTENT_KIND) schemaFail(CODE, 'intent.kind')
  if (payload.schema_version !== CLOUD_ATTEMPT_INTENT_SCHEMA_VERSION)
    schemaFail(CODE, 'intent.schema_version')
  requireHex(payload.attempt_id, ATTEMPT_ID_PATTERN, CODE, 'intent.attempt_id')
  requireHex(payload.cloud_run_id, RUN_ID_PATTERN, CODE, 'intent.cloud_run_id')
  requireCount(payload.sequence, CODE, 'intent.sequence')
  requireIso(payload.started_at, CODE, 'intent.started_at')
  validateArtifactObject(payload.artifact, CODE, 'intent.artifact')
  const ids = { artifactBase: payload.artifact.base, attemptId: payload.attempt_id }

  const src = payload.source
  exactKeys(src, SOURCE_KEYS, CODE, 'intent.source')
  requireEnum(src.evidence, ['captured', 'unavailable'], CODE, 'intent.source.evidence')
  const captured = src.evidence === 'captured'
  if (captured) {
    requireSnapshotIso(src.snapshot_ts, CODE, 'intent.source.snapshot_ts')
    requireNonEmptyString(src.run_id, CODE, 'intent.source.run_id')
    for (const role of CEILING_KEYS) {
      validateHashBytesOrNull(src[role], CODE, `intent.source.${role}`)
      if (src[role] === null) {
        schemaFail(CODE, 'intent.source.* (captured requires all three non-null)')
      }
    }
  } else {
    if (src.snapshot_ts !== null || src.run_id !== null)
      schemaFail(CODE, 'intent.source.* (unavailable)')
    if (src.ciphertext !== null || src.checksum !== null || src.manifest !== null) {
      schemaFail(CODE, 'intent.source.* (unavailable)')
    }
  }

  validateRemoteObject(payload.remote, ids, CODE, 'intent.remote')
  exactKeys(payload.local, LOCAL_KEYS, CODE, 'intent.local')
  for (const k of LOCAL_KEYS) requireNonEmptyString(payload.local[k], CODE, `intent.local.${k}`)

  exactKeys(payload.cli, CLI_KEYS, CODE, 'intent.cli')
  requireNonEmptyString(payload.cli.executable, CODE, 'intent.cli.executable')
  requireHex(payload.cli.expected_sha512, SHA512_HEX, CODE, 'intent.cli.expected_sha512')

  const cont = payload.containment
  exactKeys(cont, CONTAINMENT_INTENT_KEYS, CODE, 'intent.containment')
  requireEnum(cont.mechanism, ['rlimit_fsize', 'quota_mount'], CODE, 'intent.containment.mechanism')
  exactKeys(cont.ceilings, CEILING_KEYS, CODE, 'intent.containment.ceilings')
  for (const k of CEILING_KEYS) {
    if (!Number.isSafeInteger(cont.ceilings[k]) || cont.ceilings[k] <= 0) {
      schemaFail(CODE, `intent.containment.ceilings.${k}`)
    }
  }
  if (cont.mechanism === 'rlimit_fsize') {
    requireNonEmptyString(cont.wrapper_executable, CODE, 'intent.containment.wrapper_executable')
    requireHex(
      cont.wrapper_expected_sha512,
      SHA512_HEX,
      CODE,
      'intent.containment.wrapper_expected_sha512',
    )
  } else {
    if (cont.wrapper_executable !== null || cont.wrapper_expected_sha512 !== null) {
      schemaFail(CODE, 'intent.containment.wrapper_* (quota_mount)')
    }
  }
  if (captured) {
    // Captured source evidence is what a READY preparation measured: every
    // role is non-empty and within its own readback ceiling.
    for (const k of CEILING_KEYS) {
      if (src[k].bytes < 1 || src[k].bytes > cont.ceilings[k]) {
        schemaFail(CODE, `intent.source.${k}.bytes (outside the role ceiling)`)
      }
    }
  }

  exactKeys(payload.workspace, ['planned_path'], CODE, 'intent.workspace')
  requireWorkspacePath(payload.workspace.planned_path, ids, CODE, 'intent.workspace.planned_path')

  if (payload.refusal === null) {
    if (captured !== true)
      schemaFail(CODE, 'intent.refusal (must be set when source is unavailable)')
  } else {
    if (captured) schemaFail(CODE, 'intent.refusal (must be null when source is captured)')
    exactKeys(payload.refusal, REFUSAL_KEYS, CODE, 'intent.refusal')
    requireEnum(payload.refusal.step, ['local_validation'], CODE, 'intent.refusal.step')
    requireEnum(payload.refusal.code, CLOUD_LOCAL_REFUSAL_CODES, CODE, 'intent.refusal.code')
  }
  return payload
}

// ─────────────────────────────────────────────────────────────────────────────
// Attestation schema (schema_version 1).
// ─────────────────────────────────────────────────────────────────────────────

const ATTESTATION_TOP_KEYS = [
  'kind',
  'schema_version',
  'attempt_id',
  'cloud_run_id',
  'sequence',
  'started_at',
  'finished_at',
  'finish_time_state',
  'artifact',
  'source_snapshot_ts',
  'source_run_id',
  'remote',
  'verdict',
  'stage',
  'code',
  'role',
  'containment',
  'upload_transfer_state',
  'upload_outcome',
  'termination',
  'intent_record',
  'readback',
  'completion',
  'cli',
  'cleanup_policy',
  'future_lock_advice',
]

/** The stages an attestation may record — `CLOUD_ATTEMPT_STAGES` minus the two report-only ones. */
const CLOUD_ATTEMPT_STAGES = WRITABLE_STAGES

/** Stages reached strictly before the upload was executed (and not a local refusal). */
const PRE_UPLOAD_STAGES = new Set(['intent', 'containment_proof', 'capacity', 'workspace'])
/** Stages that are reached only once the readback workspace has been set up. */
const WORKSPACE_STAGES = new Set(['workspace', 'upload', 'readback', 'completion'])

const UPLOAD_OUTCOME_KEYS = ['code', 'failed_step', 'boundary_code']
const INTENT_RECORD_KEYS = ['state', 'filename', 'sha256', 'bytes']
const ROLE_KEYS = [
  'attempted',
  'observed',
  'boundary_code',
  'termination',
  'bytes',
  'sha256',
  'matches_source',
]
const COMPLETION_KEYS = ['checked', 'ok']
const CLEANUP_POLICY_KEYS = ['disposition', 'workspace_path']

/** Shape AND internal coherence of one role's readback evidence. */
function validateRoleEvidence(v, role, code) {
  const what = `attestation.readback.${role}`
  exactKeys(v, ROLE_KEYS, code, what)
  requireBool(v.attempted, code, `${what}.attempted`)
  requireEnum(v.observed, OBSERVED_STATES, code, `${what}.observed`)
  if (v.boundary_code !== null) {
    requireEnum(v.boundary_code, CLOUD_ATTEMPT_BOUNDARY_CODES, code, `${what}.boundary_code`)
  }
  requireEnum(v.termination, TERMINATION_STATES, code, `${what}.termination`)
  requireCountOrNull(v.bytes, code, `${what}.bytes`)
  requireHexOrNull(v.sha256, SHA256_HEX, code, `${what}.sha256`)
  requireBoolOrNull(v.matches_source, code, `${what}.matches_source`)

  const measured = v.bytes !== null
  if ((v.sha256 !== null) !== measured || (v.matches_source !== null) !== measured) {
    schemaFail(code, `${what} (bytes/sha256/matches_source are all set or all null)`)
  }
  if (
    (v.boundary_code === 'provider_termination_unconfirmed') !==
    (v.termination === 'unconfirmed')
  ) {
    schemaFail(code, `${what}.termination (unconfirmed iff the boundary said so)`)
  }
  if (!v.attempted) {
    if (
      v.observed !== 'not_observed' ||
      v.boundary_code !== null ||
      v.termination !== 'not_applicable' ||
      measured
    ) {
      schemaFail(code, `${what} (a role never attempted carries no evidence)`)
    }
    return v
  }
  switch (v.observed) {
    case 'not_observed':
      // attempted, but stopped before any child ran for this role
      if (v.boundary_code !== null || v.termination !== 'not_applicable' || measured)
        schemaFail(code, `${what} (not_observed)`)
      break
    case 'absent':
      if (v.boundary_code !== null || v.termination !== 'confirmed' || measured)
        schemaFail(code, `${what} (absent)`)
      break
    case 'other':
      if (v.termination === 'not_applicable' || measured) schemaFail(code, `${what} (other)`)
      break
    case 'active_file':
      if (v.termination === 'not_applicable') schemaFail(code, `${what} (active_file)`)
      if (measured && (v.boundary_code !== null || v.termination !== 'confirmed'))
        schemaFail(code, `${what} (a measured role came from a clean download)`)
      break
  }
  return v
}

const matched = (r) => r.observed === 'active_file' && r.matches_source === true

/**
 * Coherence across the three roles and `completion`. Returns the role the
 * sequence stopped at (`null` if it never stopped, or never ran).
 */
function validateReadbackCoherence(rb, completion, code) {
  if (!rb.performed) {
    for (const role of RECORD_ROLES) {
      if (rb[role].attempted) schemaFail(code, 'attestation.readback (not performed)')
    }
    if (completion.checked !== false || completion.ok !== null)
      schemaFail(code, 'attestation.completion (readback not performed)')
    return null
  }
  if (!rb.manifest.attempted) schemaFail(code, 'attestation.readback.manifest (always first)')
  let stoppedAt = null
  for (const role of RECORD_ROLES) {
    const r = rb[role]
    if (stoppedAt !== null) {
      if (r.attempted) schemaFail(code, `attestation.readback.${role} (after the stop)`)
      continue
    }
    if (!r.attempted) schemaFail(code, `attestation.readback.${role} (roles run in order)`)
    if (!matched(r)) stoppedAt = role
  }
  if ((completion.ok === null) !== (completion.checked === false))
    schemaFail(code, 'attestation.completion (ok is null iff not checked)')
  if (completion.checked !== (stoppedAt === null))
    schemaFail(code, 'attestation.completion.checked (iff every role matched)')
  return stoppedAt
}

function validateAttestationPayload(payload) {
  const CODE = 'cloud_attestation_schema_invalid'
  exactKeys(payload, ATTESTATION_TOP_KEYS, CODE, 'attestation')
  if (payload.kind !== CLOUD_ATTESTATION_KIND) schemaFail(CODE, 'attestation.kind')
  if (payload.schema_version !== CLOUD_ATTESTATION_SCHEMA_VERSION)
    schemaFail(CODE, 'attestation.schema_version')
  requireHex(payload.attempt_id, ATTEMPT_ID_PATTERN, CODE, 'attestation.attempt_id')
  requireHex(payload.cloud_run_id, RUN_ID_PATTERN, CODE, 'attestation.cloud_run_id')
  requireCount(payload.sequence, CODE, 'attestation.sequence')
  requireIso(payload.started_at, CODE, 'attestation.started_at')
  validateArtifactObject(payload.artifact, CODE, 'attestation.artifact')
  const ids = { artifactBase: payload.artifact.base, attemptId: payload.attempt_id }
  validateRemoteObject(payload.remote, ids, CODE, 'attestation.remote')

  // ── verdict / stage / code / role: closed membership, code decides verdict ──
  requireEnum(
    payload.verdict,
    ['verified', 'rejected', 'indeterminate'],
    CODE,
    'attestation.verdict',
  )
  const verified = payload.verdict === 'verified'
  const stage = payload.stage
  if (verified) {
    if (stage !== null || payload.code !== null || payload.role !== null) {
      schemaFail(CODE, 'attestation.stage/code/role (must be null when verified)')
    }
  } else {
    requireEnum(stage, CLOUD_ATTEMPT_STAGES, CODE, 'attestation.stage')
    requireEnum(payload.code, CLOUD_ATTEMPT_CODES_BY_STAGE[stage], CODE, 'attestation.code')
    const expectedVerdict = CLOUD_ATTEMPT_REJECTED_CODES.includes(payload.code)
      ? 'rejected'
      : 'indeterminate'
    if (payload.verdict !== expectedVerdict)
      schemaFail(CODE, 'attestation.verdict (does not match its code)')
  }
  if (payload.role !== null) requireEnum(payload.role, RECORD_ROLES, CODE, 'attestation.role')
  if ((payload.role !== null) !== (stage === 'readback'))
    schemaFail(CODE, 'attestation.role (set iff stage is readback)')

  // ── finish time ──
  requireEnum(
    payload.finish_time_state,
    ['captured', 'unavailable'],
    CODE,
    'attestation.finish_time_state',
  )
  if (payload.finish_time_state === 'captured') {
    requireIso(payload.finished_at, CODE, 'attestation.finished_at')
  } else if (payload.finished_at !== null) {
    schemaFail(CODE, 'attestation.finished_at (must be null when unavailable)')
  }
  if ((payload.finish_time_state === 'unavailable') !== (payload.code === 'clock_unusable'))
    schemaFail(CODE, 'attestation.finish_time_state (unavailable iff clock_unusable)')

  // ── source identity ──
  requireSnapshotIsoOrNull(payload.source_snapshot_ts, CODE, 'attestation.source_snapshot_ts')
  if (payload.source_run_id !== null)
    requireNonEmptyString(payload.source_run_id, CODE, 'attestation.source_run_id')
  const sourceKnown = payload.source_snapshot_ts !== null
  if (sourceKnown !== (payload.source_run_id !== null))
    schemaFail(CODE, 'attestation.source_* (both set or both null)')
  if (stage === 'local_refusal' && sourceKnown)
    schemaFail(CODE, 'attestation.source_* (a local refusal has no source evidence)')
  // Every stage from the containment proof onward is reached only by a READY
  // preparation, which always captured its source identity.
  const readyOnlyStage = verified || !['intent', 'internal', 'local_refusal'].includes(stage)
  if (readyOnlyStage && !sourceKnown) schemaFail(CODE, 'attestation.source_* (required)')

  // ── containment ──
  requireEnum(
    payload.containment,
    ['not_checked', 'valid', 'invalid'],
    CODE,
    'attestation.containment',
  )
  const expectContainment = verified
    ? 'valid'
    : stage === 'local_refusal' || stage === 'intent'
      ? 'not_checked'
      : stage === 'containment_proof'
        ? 'invalid'
        : stage === 'internal'
          ? null
          : 'valid'
  if (expectContainment !== null && payload.containment !== expectContainment)
    schemaFail(CODE, `attestation.containment (expected ${expectContainment})`)

  // ── upload outcome: both layers, closed, and coherent with the stage ──
  requireEnum(
    payload.upload_transfer_state,
    ['definitely_zero', 'unknown'],
    CODE,
    'attestation.upload_transfer_state',
  )
  const uo = payload.upload_outcome
  exactKeys(uo, UPLOAD_OUTCOME_KEYS, CODE, 'attestation.upload_outcome')
  if (uo.code !== null)
    requireEnum(uo.code, CLOUD_UPLOAD_OUTCOME_CODES, CODE, 'attestation.upload_outcome.code')
  if (uo.failed_step !== null)
    requireEnum(uo.failed_step, CLOUD_UPLOAD_STEPS, CODE, 'attestation.upload_outcome.failed_step')
  if (uo.boundary_code !== null) {
    requireEnum(
      uo.boundary_code,
      CLOUD_ATTEMPT_BOUNDARY_CODES,
      CODE,
      'attestation.upload_outcome.boundary_code',
    )
  }
  if ((uo.code === null) !== (uo.failed_step === null))
    schemaFail(CODE, 'attestation.upload_outcome (code and failed_step set together)')
  const uploadEmpty = uo.code === null && uo.boundary_code === null
  if (PRE_UPLOAD_STAGES.has(stage)) {
    if (!uploadEmpty || payload.upload_transfer_state !== 'definitely_zero')
      schemaFail(CODE, 'attestation.upload_outcome (the upload never ran)')
  }
  if (stage === 'local_refusal') {
    if (
      !CLOUD_LOCAL_REFUSAL_CODES.includes(uo.code) ||
      uo.failed_step !== 'local_validation' ||
      uo.boundary_code !== null ||
      payload.upload_transfer_state !== 'definitely_zero'
    ) {
      schemaFail(CODE, 'attestation.upload_outcome (local refusal)')
    }
  }
  if (stage === 'local_refusal' || stage === 'upload') {
    if (uo.code === null) schemaFail(CODE, 'attestation.upload_outcome.code (required here)')
    if (payload.code !== uo.code && payload.code !== 'internal_invariant_violated')
      schemaFail(CODE, 'attestation.code (must be the upload outcome code)')
  }
  if (payload.verdict === 'rejected' && (stage === 'upload' || stage === 'local_refusal')) {
    if (payload.upload_transfer_state !== 'definitely_zero')
      schemaFail(CODE, 'attestation.verdict (a rejection proves zero transfer)')
  }
  if (
    (verified || stage === 'readback' || stage === 'completion') &&
    payload.upload_transfer_state !== 'unknown'
  )
    schemaFail(CODE, 'attestation.upload_transfer_state (an upload was attempted)')

  // ── termination ──
  requireEnum(payload.termination, TERMINATION_STATES, CODE, 'attestation.termination')

  // ── intent binding ──
  const ir = payload.intent_record
  exactKeys(ir, INTENT_RECORD_KEYS, CODE, 'attestation.intent_record')
  requireEnum(ir.state, ['confirmed', 'not_confirmed'], CODE, 'attestation.intent_record.state')
  if (ir.state === 'confirmed') {
    requireEnum(
      ir.filename,
      [buildCloudAttemptIntentFileName(ids)],
      CODE,
      'attestation.intent_record.filename',
    )
    requireHex(ir.sha256, SHA256_HEX, CODE, 'attestation.intent_record.sha256')
    requireCount(ir.bytes, CODE, 'attestation.intent_record.bytes')
    if (stage === 'intent' || payload.code === 'intent_record_lost')
      schemaFail(CODE, 'attestation.intent_record (cannot be confirmed here)')
  } else {
    if (ir.filename !== null || ir.sha256 !== null || ir.bytes !== null) {
      schemaFail(CODE, 'attestation.intent_record (must be null fields when not_confirmed)')
    }
    if (verified)
      schemaFail(CODE, 'attestation.verdict (verified requires a confirmed intent_record)')
  }

  // ── readback + completion ──
  const rb = payload.readback
  exactKeys(rb, ['performed', 'ciphertext', 'checksum', 'manifest'], CODE, 'attestation.readback')
  requireBool(rb.performed, CODE, 'attestation.readback.performed')
  for (const role of RECORD_ROLES) validateRoleEvidence(rb[role], role, CODE)
  exactKeys(payload.completion, COMPLETION_KEYS, CODE, 'attestation.completion')
  requireBool(payload.completion.checked, CODE, 'attestation.completion.checked')
  requireBoolOrNull(payload.completion.ok, CODE, 'attestation.completion.ok')
  const stoppedAt = validateReadbackCoherence(rb, payload.completion, CODE)

  const readbackStage = stage === 'readback' || stage === 'completion'
  if ((verified || readbackStage) && !rb.performed)
    schemaFail(CODE, 'attestation.readback.performed (required here)')
  if (rb.performed && !verified && !readbackStage && stage !== 'internal')
    schemaFail(CODE, 'attestation.readback.performed (never reached at this stage)')
  if (stage === 'readback' && payload.role !== stoppedAt)
    schemaFail(CODE, 'attestation.role (must be the role the readback stopped at)')
  if (stage === 'completion' && payload.completion.ok !== false)
    schemaFail(CODE, 'attestation.completion (stage completion means the adapter disagreed)')
  if (verified && payload.completion.ok !== true)
    schemaFail(CODE, 'attestation.completion.ok (verified requires true)')
  if (!verified && stage !== 'internal' && payload.completion.ok === true)
    schemaFail(CODE, 'attestation.completion.ok (a complete readback is verified)')

  const anyRoleUnconfirmed = RECORD_ROLES.some((r) => rb[r].termination === 'unconfirmed')
  if (anyRoleUnconfirmed && payload.termination !== 'unconfirmed')
    schemaFail(CODE, 'attestation.termination (a role reported unconfirmed termination)')
  if (verified && payload.termination !== 'confirmed')
    schemaFail(CODE, 'attestation.termination (verified requires confirmed)')
  if (payload.verdict === 'rejected' && payload.termination === 'unconfirmed')
    schemaFail(CODE, 'attestation.verdict (never a definite rejection with a child possibly alive)')
  if (
    (PRE_UPLOAD_STAGES.has(stage) || stage === 'local_refusal') &&
    payload.termination !== 'not_applicable'
  )
    schemaFail(CODE, 'attestation.termination (no child was invoked)')
  if ((verified || readbackStage) && payload.termination === 'not_applicable')
    schemaFail(CODE, 'attestation.termination (children were invoked)')

  exactKeys(payload.cli, CLI_KEYS, CODE, 'attestation.cli')
  requireNonEmptyString(payload.cli.executable, CODE, 'attestation.cli.executable')
  requireHex(payload.cli.expected_sha512, SHA512_HEX, CODE, 'attestation.cli.expected_sha512')

  // ── cleanup policy ──
  const cp = payload.cleanup_policy
  exactKeys(cp, CLEANUP_POLICY_KEYS, CODE, 'attestation.cleanup_policy')
  requireEnum(
    cp.disposition,
    ['after_attestation', 'withheld_termination_unconfirmed', 'not_applicable'],
    CODE,
    'attestation.cleanup_policy.disposition',
  )
  if (
    (cp.disposition === 'withheld_termination_unconfirmed') !==
    (payload.termination === 'unconfirmed')
  )
    schemaFail(
      CODE,
      'attestation.cleanup_policy.disposition (withheld iff termination unconfirmed)',
    )
  if ((cp.workspace_path === null) !== (cp.disposition === 'not_applicable'))
    schemaFail(CODE, 'attestation.cleanup_policy.workspace_path (null iff not_applicable)')
  if (cp.workspace_path !== null)
    requireWorkspacePath(cp.workspace_path, ids, CODE, 'attestation.cleanup_policy.workspace_path')
  if ((verified || WORKSPACE_STAGES.has(stage)) && cp.disposition === 'not_applicable')
    schemaFail(CODE, 'attestation.cleanup_policy.disposition (a workspace may exist)')
  if (
    (stage === 'local_refusal' ||
      stage === 'intent' ||
      stage === 'containment_proof' ||
      stage === 'capacity') &&
    cp.disposition !== 'not_applicable'
  ) {
    schemaFail(CODE, 'attestation.cleanup_policy.disposition (no workspace was created)')
  }

  // ── derived lock advice ──
  requireEnum(
    payload.future_lock_advice,
    CLOUD_ATTEMPT_LOCK_ACTIONS,
    CODE,
    'attestation.future_lock_advice',
  )
  const advice = deriveFutureLockAdvice({
    intentRecordState: ir.state,
    termination: payload.termination,
    code: payload.code,
  })
  if (payload.future_lock_advice !== advice)
    schemaFail(CODE, 'attestation.future_lock_advice (must be the derived advice)')
  return payload
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic serialization.
// ─────────────────────────────────────────────────────────────────────────────

/** Compact single-line JSON, UTF-8, NO trailing newline — the one chosen policy. */
function serialize(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8')
}

function deepEqual(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual(a[k], b[k])) return false
  }
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Close handling with explicit pending-error state (constraint: no native
// close exception may escape or mask an already-classified error).
// ─────────────────────────────────────────────────────────────────────────────

function makePendingState(fallbackCode) {
  return { pending: null, fallbackCode }
}

function classify(err, fallbackCode) {
  if (err instanceof BackupError) return err
  return new BackupError(fallbackCode, 'a durable-record operation failed.')
}

function noteFailure(state, err) {
  if (state.pending === null) state.pending = classify(err, state.fallbackCode)
}

function safeCloseFd(deps, fd, state) {
  if (fd === undefined) return
  try {
    deps.close(fd)
  } catch (err) {
    noteFailure(state, err)
  }
}

function throwIfPending(state) {
  if (state.pending !== null) throw state.pending
}

// ─────────────────────────────────────────────────────────────────────────────
// The durable writer — shared by writeAttemptIntent()/writeAttemptAttestation().
// ─────────────────────────────────────────────────────────────────────────────

const O = fs.constants
const READ_NO_FOLLOW = O.O_RDONLY | O.O_NOFOLLOW
const DIR_READ_NO_FOLLOW = O.O_RDONLY | (O.O_DIRECTORY ?? 0) | (O.O_NOFOLLOW ?? 0)

function reobserveDirIdentity(entry, deps) {
  return observeTrustedDirectoryIdentity(entry.dir, deps)
}

function assertDirStillTrusted(entry, deps) {
  const now = reobserveDirIdentity(entry, deps)
  if (!sameIdentity(now, { dev: entry.dev, ino: entry.ino, uid: entry.uid, mode: entry.mode })) {
    throw new BackupError(
      'attestation_dir_untrusted',
      'the attestation directory identity has changed.',
    )
  }
}

/**
 * @param {object} args
 * @param {object} args.entry     the session's private state (dir/dev/ino/uid/mode)
 * @param {string} args.filename
 * @param {object} args.payload   already schema-validated
 * @param {string} args.createFailCode
 * @param {string} args.durabilityCode
 * @param {object} deps
 */
function writeDurableRecord({ entry, filename, payload, createFailCode, durabilityCode }, deps) {
  assertDirStillTrusted(entry, deps) // before creation
  const buf = serialize(payload)
  if (buf.length > CLOUD_RECORD_CEILING_BYTES) {
    throw new BackupError(
      createFailCode,
      'the serialized record exceeds the approved size ceiling.',
    )
  }
  const path = `${entry.dir}/${filename}`

  let fd
  try {
    fd = deps.open(path, O.O_WRONLY | O.O_CREAT | O.O_EXCL | O.O_NOFOLLOW, 0o600)
  } catch {
    // EEXIST (including a pre-existing symlink, refused by O_NOFOLLOW without
    // ever touching its target), or any other open failure. Nothing created.
    throw new BackupError(createFailCode, 'the record file could not be created.')
  }

  const createState = makePendingState(durabilityCode)
  let createdId = null
  try {
    let written = 0
    while (written < buf.length) written += deps.write(fd, buf, written)
    deps.fchmod(fd, 0o600)
    deps.fsync(fd)
    const st = deps.fstat(fd)
    const ok =
      st.isFile() === true &&
      st.uid === BigInt(deps.geteuid()) &&
      (st.mode & 0o7777n) === 0o600n &&
      st.size === BigInt(buf.length)
    if (!ok)
      throw new BackupError(durabilityCode, 'the created record file failed identity validation.')
    createdId = { dev: st.dev, ino: st.ino }
  } catch (err) {
    noteFailure(createState, err)
  } finally {
    safeCloseFd(deps, fd, createState)
  }
  throwIfPending(createState)

  assertDirStillTrusted(entry, deps) // before the directory fsync

  const dirState = makePendingState(durabilityCode)
  let dirFd
  try {
    dirFd = deps.openDir(entry.dir, DIR_READ_NO_FOLLOW)
    const pst = deps.fstat(dirFd)
    if (pst.dev !== entry.dev || pst.ino !== entry.ino) {
      throw new BackupError(
        durabilityCode,
        'the directory descriptor did not match the trusted identity.',
      )
    }
    // Only now — after the descriptor's identity is confirmed — fsync it.
    deps.fsync(dirFd)
  } catch (err) {
    noteFailure(dirState, err)
  } finally {
    safeCloseFd(deps, dirFd, dirState)
  }
  throwIfPending(dirState)

  // lstat the exact pathname — detects a pathname-replacement race even
  // though no descriptor is held across this check.
  let lst
  try {
    lst = deps.lstat(path)
  } catch (err) {
    throw classify(err, durabilityCode)
  }
  const lstOk =
    lst.isFile() === true &&
    lst.isSymbolicLink() === false &&
    lst.uid === BigInt(deps.geteuid()) &&
    (lst.mode & 0o7777n) === 0o600n &&
    lst.size === BigInt(buf.length) &&
    lst.dev === createdId.dev &&
    lst.ino === createdId.ino
  if (!lstOk)
    throw new BackupError(durabilityCode, 'the record pathname no longer names the created file.')

  assertDirStillTrusted(entry, deps) // before record readback

  const readState = makePendingState(durabilityCode)
  let readFd
  let sha256Hex = null
  try {
    readFd = deps.open(path, READ_NO_FOLLOW)
    const rst = deps.fstat(readFd)
    if (rst.dev !== createdId.dev || rst.ino !== createdId.ino) {
      throw new BackupError(
        durabilityCode,
        'the reopened descriptor does not match the created file.',
      )
    }
    const readBuf = Buffer.alloc(CLOUD_RECORD_CEILING_BYTES + 1)
    let total = 0
    for (;;) {
      const n = deps.read(readFd, readBuf, total)
      if (n === 0) break
      total += n
      if (total > CLOUD_RECORD_CEILING_BYTES) {
        throw new BackupError(durabilityCode, 'the record readback exceeded the size ceiling.')
      }
    }
    const readSlice = readBuf.subarray(0, total)
    if (total !== buf.length || !readSlice.equals(buf)) {
      throw new BackupError(durabilityCode, 'the record readback did not match the bytes written.')
    }
    let parsed
    try {
      parsed = JSON.parse(readSlice.toString('utf8'))
    } catch {
      throw new BackupError(durabilityCode, 'the record readback did not parse as JSON.')
    }
    if (!deepEqual(parsed, payload)) {
      throw new BackupError(
        durabilityCode,
        'the parsed readback did not match the intended record.',
      )
    }
    sha256Hex = createHash('sha256').update(buf).digest('hex')
  } catch (err) {
    noteFailure(readState, err)
  } finally {
    safeCloseFd(deps, readFd, readState)
  }
  throwIfPending(readState)

  assertDirStillTrusted(entry, deps) // final operation

  return Object.freeze({
    path,
    filename,
    sha256: sha256Hex,
    bytes: buf.length,
    dev: createdId.dev,
    ino: createdId.ino,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent revalidation (immediately before constructing an attestation).
// ─────────────────────────────────────────────────────────────────────────────

const NOT_CONFIRMED = Object.freeze({
  state: 'not_confirmed',
  filename: null,
  sha256: null,
  bytes: null,
})

/**
 * Measure the intent file again, under the same session. Total: every
 * failure — including a descriptor close failure, which leaves the
 * measurement's own resource handling unproven — yields `NOT_CONFIRMED`,
 * never a native error. The directory identity is re-verified both before
 * and AFTER the read, so a directory swapped mid-measurement is never
 * confirmed.
 */
function revalidateIntent(entry, deps) {
  const ci = entry.confirmedIntent
  if (ci === null || ci === undefined || ci.failed === true) return NOT_CONFIRMED
  let fd
  let measuredOk = false
  try {
    assertDirStillTrusted(entry, deps)
    const path = `${entry.dir}/${ci.filename}`
    const lst = deps.lstat(path)
    const lstOk =
      lst.isFile() === true &&
      lst.isSymbolicLink() === false &&
      lst.uid === BigInt(deps.geteuid()) &&
      (lst.mode & 0o7777n) === 0o600n &&
      lst.size === BigInt(ci.bytes) &&
      lst.dev === ci.dev &&
      lst.ino === ci.ino
    if (lstOk) {
      fd = deps.open(path, READ_NO_FOLLOW)
      const rst = deps.fstat(fd)
      if (rst.isFile() === true && rst.dev === ci.dev && rst.ino === ci.ino) {
        const readBuf = Buffer.alloc(ci.bytes + 1)
        let total = 0
        let over = false
        for (;;) {
          const n = deps.read(fd, readBuf, total)
          if (!Number.isSafeInteger(n) || n < 0) {
            over = true
            break
          }
          if (n === 0) break
          total += n
          if (total > ci.bytes) {
            over = true
            break
          }
        }
        if (!over && total === ci.bytes) {
          const sha = createHash('sha256').update(readBuf.subarray(0, total)).digest('hex')
          measuredOk = sha === ci.sha256
        }
      }
    }
  } catch {
    measuredOk = false
  }
  if (fd !== undefined) {
    try {
      deps.close(fd)
    } catch {
      measuredOk = false
    }
  }
  if (!measuredOk) return NOT_CONFIRMED
  try {
    assertDirStillTrusted(entry, deps) // final: the directory did not change underneath the read
  } catch {
    return NOT_CONFIRMED
  }
  return Object.freeze({
    state: 'confirmed',
    filename: ci.filename,
    sha256: ci.sha256,
    bytes: ci.bytes,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Readers — independent trust re-establishment, never a session.
// ─────────────────────────────────────────────────────────────────────────────

function readRecord(
  { config, artifactBase, attemptId, buildFilename, validate, notFoundCode },
  deps,
) {
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
  if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId))
    return invalidInput('attemptId')

  const dirId = observeTrustedDirectoryIdentity(cfg.attestation.dir, deps)
  if (dirId === null)
    throw new BackupError('attestation_dir_untrusted', 'the attestation directory is not trusted.')

  const filename = buildFilename({ artifactBase, attemptId })
  const path = `${cfg.attestation.dir}/${filename}`

  const unreadable = (what) => new BackupError('cloud_record_unreadable', what)

  let lst
  try {
    lst = deps.lstat(path)
  } catch (err) {
    // Only a definite ENOENT is "not found"; every other failure is closed as unreadable.
    if (err?.code === 'ENOENT') {
      throw new BackupError(notFoundCode, 'the requested record does not exist.')
    }
    throw unreadable('the requested record could not be observed.')
  }
  let identityOk = false
  try {
    identityOk =
      lst.isFile() === true &&
      lst.isSymbolicLink() === false &&
      lst.uid === BigInt(deps.geteuid()) &&
      (lst.mode & 0o7777n) === 0o600n &&
      lst.size <= BigInt(CLOUD_RECORD_CEILING_BYTES)
  } catch {
    identityOk = false
  }
  if (!identityOk) throw unreadable('the requested record failed identity validation.')

  const state = makePendingState('cloud_record_unreadable')
  let fd
  let text = null
  try {
    fd = deps.open(path, READ_NO_FOLLOW)
    const rst = deps.fstat(fd)
    if (rst.isFile() !== true || rst.dev !== lst.dev || rst.ino !== lst.ino) {
      throw unreadable('the reopened descriptor does not match the listed file.')
    }
    const readBuf = Buffer.alloc(CLOUD_RECORD_CEILING_BYTES + 1)
    let total = 0
    for (;;) {
      const n = deps.read(fd, readBuf, total)
      if (!Number.isSafeInteger(n) || n < 0) throw unreadable('the record read failed.')
      if (n === 0) break
      total += n
      if (total > CLOUD_RECORD_CEILING_BYTES) {
        throw unreadable('the record exceeds the size ceiling.')
      }
    }
    text = readBuf.subarray(0, total).toString('utf8')
  } catch (err) {
    noteFailure(state, err)
  } finally {
    // A close failure is a failure of this read: it never yields a record.
    safeCloseFd(deps, fd, state)
  }
  throwIfPending(state)

  // Final: the directory this record was read from is still the one trusted above.
  if (!sameIdentity(observeTrustedDirectoryIdentity(cfg.attestation.dir, deps), dirId)) {
    throw new BackupError(
      'attestation_dir_untrusted',
      'the attestation directory identity has changed.',
    )
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw unreadable('the record is not valid JSON.')
  }
  try {
    return deepFreeze(validate(parsed))
  } catch (err) {
    throw classify(err, 'cloud_record_unreadable')
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

// ─────────────────────────────────────────────────────────────────────────────
// The factory.
// ─────────────────────────────────────────────────────────────────────────────

function assertValidDeps(deps) {
  const fns = [
    'lstat',
    'realpath',
    'geteuid',
    'open',
    'openDir',
    'write',
    'fchmod',
    'fsync',
    'fstat',
    'close',
    'read',
  ]
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')
  for (const name of fns) if (typeof deps[name] !== 'function') return invalidInput('deps')
}

export function makeAttestationRecords(deps) {
  assertValidDeps(deps)

  // FACTORY-PRIVATE: each `makeAttestationRecords()` instance owns its own
  // registry, so a session from any other instance — even one bound to the
  // identical dependency set, with an identical visible shape — authorizes
  // nothing here.
  const SESSIONS = new WeakMap()

  function establishAttemptRecordSession(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { config, artifactBase, attemptId } = args
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
    if (typeof attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(attemptId))
      return invalidInput('attemptId')

    const dirId = observeTrustedDirectoryIdentity(cfg.attestation.dir, deps)
    if (dirId === null) {
      throw new BackupError(
        'attestation_dir_untrusted',
        'the attestation directory is not trusted.',
      )
    }
    const session = Object.freeze({})
    SESSIONS.set(session, {
      dir: cfg.attestation.dir,
      dev: dirId.dev,
      ino: dirId.ino,
      uid: dirId.uid,
      mode: dirId.mode,
      artifactBase,
      attemptId,
      confirmedIntent: null,
    })
    return session
  }

  function getEntry(session) {
    const entry =
      session !== null && typeof session === 'object' ? SESSIONS.get(session) : undefined
    if (entry === undefined) {
      throw new BackupError(
        'record_session_invalid',
        'the record session was not produced by this module.',
      )
    }
    return entry
  }

  function writeAttemptIntent(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { session, intentFields } = args
    const entry = getEntry(session)
    if (intentFields === null || typeof intentFields !== 'object')
      return invalidInput('intentFields')
    if (intentFields.artifact?.base !== entry.artifactBase)
      return invalidInput('intentFields.artifact.base')

    const payload = {
      kind: CLOUD_ATTEMPT_INTENT_KIND,
      schema_version: CLOUD_ATTEMPT_INTENT_SCHEMA_VERSION,
      attempt_id: entry.attemptId,
      cloud_run_id: intentFields.cloud_run_id,
      sequence: intentFields.sequence,
      started_at: intentFields.started_at,
      artifact: intentFields.artifact,
      source: intentFields.source,
      remote: intentFields.remote,
      local: intentFields.local,
      cli: intentFields.cli,
      containment: intentFields.containment,
      workspace: intentFields.workspace,
      refusal: intentFields.refusal,
    }
    validateIntentPayload(payload)

    const filename = buildCloudAttemptIntentFileName({
      artifactBase: entry.artifactBase,
      attemptId: entry.attemptId,
    })
    try {
      const result = writeDurableRecord(
        {
          entry,
          filename,
          payload,
          createFailCode: 'cloud_intent_create_failed',
          durabilityCode: 'cloud_intent_durability_unconfirmed',
        },
        deps,
      )
      entry.confirmedIntent = {
        filename: result.filename,
        sha256: result.sha256,
        bytes: result.bytes,
        dev: result.dev,
        ino: result.ino,
      }
      return { ok: true, path: result.path, sha256: result.sha256, bytes: result.bytes }
    } catch (err) {
      entry.confirmedIntent = { failed: true }
      throw err
    }
  }

  function writeAttemptAttestation(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    const { session, attestationFields } = args
    const entry = getEntry(session)
    if (attestationFields === null || typeof attestationFields !== 'object')
      return invalidInput('attestationFields')
    if (attestationFields.artifact?.base !== entry.artifactBase)
      return invalidInput('attestationFields.artifact.base')

    assertDirStillTrusted(entry, deps)
    const intentRecord = revalidateIntent(entry, deps)

    let fields = attestationFields
    if (intentRecord.state !== 'confirmed' && fields.verdict === 'verified') {
      fields = {
        ...fields,
        verdict: 'indeterminate',
        stage: 'internal',
        code: 'intent_record_lost',
        role: null,
      }
    }

    const payload = {
      kind: CLOUD_ATTESTATION_KIND,
      schema_version: CLOUD_ATTESTATION_SCHEMA_VERSION,
      attempt_id: entry.attemptId,
      cloud_run_id: fields.cloud_run_id,
      sequence: fields.sequence,
      started_at: fields.started_at,
      finished_at: fields.finished_at,
      finish_time_state: fields.finish_time_state,
      artifact: fields.artifact,
      source_snapshot_ts: fields.source_snapshot_ts,
      source_run_id: fields.source_run_id,
      remote: fields.remote,
      verdict: fields.verdict,
      stage: fields.stage,
      code: fields.code,
      role: fields.role,
      containment: fields.containment,
      upload_transfer_state: fields.upload_transfer_state,
      upload_outcome: fields.upload_outcome,
      termination: fields.termination,
      intent_record: intentRecord,
      readback: fields.readback,
      completion: fields.completion,
      cli: fields.cli,
      cleanup_policy: fields.cleanup_policy,
      // DERIVED here, never accepted from the caller — see deriveFutureLockAdvice().
      future_lock_advice: deriveFutureLockAdvice({
        intentRecordState: intentRecord.state,
        termination: fields.termination,
        code: fields.code,
      }),
    }
    validateAttestationPayload(payload)

    const filename = buildAttestationFileName({
      artifactBase: entry.artifactBase,
      attemptId: entry.attemptId,
    })
    const result = writeDurableRecord(
      {
        entry,
        filename,
        payload,
        createFailCode: 'cloud_attestation_create_failed',
        durabilityCode: 'cloud_attestation_durability_unconfirmed',
      },
      deps,
    )
    // The EFFECTIVE record — exactly what was written and read back, which may
    // differ from the proposal (a verified proposal whose intent could not be
    // revalidated is recorded as indeterminate). A caller builds its report
    // from this, never from its own proposal.
    return Object.freeze({
      ok: true,
      path: result.path,
      intentRecordConfirmed: intentRecord.state === 'confirmed',
      attestation: deepFreeze(JSON.parse(serialize(payload).toString('utf8'))),
    })
  }

  function readCloudAttemptIntent(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    return readRecord(
      {
        config: args.config,
        artifactBase: args.artifactBase,
        attemptId: args.attemptId,
        buildFilename: buildCloudAttemptIntentFileName,
        validate: validateIntentPayload,
        notFoundCode: 'cloud_record_not_found',
      },
      deps,
    )
  }

  function readCloudAttestation(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    return readRecord(
      {
        config: args.config,
        artifactBase: args.artifactBase,
        attemptId: args.attemptId,
        buildFilename: buildAttestationFileName,
        validate: validateAttestationPayload,
        notFoundCode: 'cloud_record_not_found',
      },
      deps,
    )
  }

  return Object.freeze({
    establishAttemptRecordSession,
    writeAttemptIntent,
    writeAttemptAttestation,
    readCloudAttemptIntent,
    readCloudAttestation,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// The real dependency set. `../backup-cloud-attestation-records.mjs` binds
// exactly this object, once, at module load.
// ─────────────────────────────────────────────────────────────────────────────

export const REAL_ATTESTATION_RECORDS_DEPS = Object.freeze({
  lstat: (p) => fs.lstatSync(p, { bigint: true }),
  realpath: (p) => fs.realpathSync(p),
  geteuid: () => process.geteuid(),
  open: (p, flags, mode) => fs.openSync(p, flags, mode),
  openDir: (p, flags) => fs.openSync(p, flags),
  write: (fd, buf, offset) => fs.writeSync(fd, buf, offset, buf.length - offset),
  fchmod: (fd, mode) => fs.fchmodSync(fd, mode),
  fsync: (fd) => fs.fsyncSync(fd),
  fstat: (fd) => fs.fstatSync(fd, { bigint: true }),
  close: (fd) => fs.closeSync(fd),
  read: (fd, buf, offset) => fs.readSync(fd, buf, offset, buf.length - offset, null),
})

export { CLOUD_ATTEMPT_STAGES }
