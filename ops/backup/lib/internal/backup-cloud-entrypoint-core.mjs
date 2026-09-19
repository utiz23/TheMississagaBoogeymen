/**
 * `eanhl-backup-cloud` entrypoint — INTERNAL IMPLEMENTATION CORE (E3J6C).
 *
 * WHAT THIS FILE IS
 * ------------------
 * Everything the executable `ops/backup/eanhl-backup-cloud.mjs` does:
 * argument parsing, config loading, the ONE process-signal owner, fixed
 * diagnostics, the summary on stdout, and the exit status.
 * `makeCloudEntrypoint(deps)` builds it against a supplied dependency set;
 * the executable binds `REAL_ENTRYPOINT_DEPS` ONCE and passes only
 * `process.argv.slice(2)`. This factory — and its `proc` emitter, writers,
 * config reader, and run operation — is an internal TEST SEAM, reachable only
 * by importing this internal path; a static regression allows only the
 * executable, its test harness, and the suites. No library export installs a
 * signal listener.
 *
 * SIGNALS
 * --------
 * SIGINT and SIGTERM listeners are installed BEFORE any synchronous parsing
 * and removed after the summary is written. Synchronous config reading,
 * JSON parsing, and validation cannot be interrupted: a signal delivered
 * then is dispatched at the run's explicit pre-lock checkpoint (one
 * event-loop turn), which rechecks cancellation before any lock exists.
 *
 *   first signal  → abort the run's `AbortSignal`, write one fixed line, and
 *                   WAIT: the run finalizes its attempt (children terminated
 *                   within the configured grace, attestation written) and
 *                   disposes of the lock itself. Nothing exits early.
 *   second signal → one fixed line (under PIPE_BUF) through a bounded
 *                   synchronous write — an error is not retried, so on a
 *                   non-blocking or broken stream it may not be delivered —
 *                   then `exit(4)` immediately; no asynchronous drain is ever
 *                   awaited. The run
 *                   lock, if acquired, is NOT released — retained by
 *                   omission. Child processes may still be alive.
 *
 * No text written here says or implies that a provider request or a remote
 * write stopped. Cancellation stops local processes only.
 *
 * OUTPUT
 * -------
 * The summary a run returns is UNTRUSTED at this boundary. It is projected
 * ONCE by `projectCloudRunSummary()` into a fresh, deeply frozen,
 * null-prototype, closed plain-data object — exact own-key sets at every
 * level, data properties only (an accessor is refused without being
 * invoked), no Proxy, every value a closed-vocabulary member or a validated
 * identifier, and the run's cross-field relationships re-checked — and the
 * original is never read again. Anything else prints no summary, only the
 * fixed `summaryInvalid` line, and exits 4.
 *
 * stdout: exactly one line, the projection as JSON.
 * stderr: fixed templates filled only with the projection's closed values
 * and validated identifiers. No path, config value, argument, native error
 * text, record or lock content, provider output, or secret is ever written. A configuration error is reported by its closed `ConfigError`
 * code only — the error MESSAGE is never printed (it can echo values).
 *
 * EXIT STATUS — `CLOUD_ENTRYPOINT_EXIT_CLASSES`
 * ----------------------------------------------
 *   0   verified, lock released           1   not verified, lock released
 *   2   invalid invocation (no lock)      3   lock refused, filesystem unchanged
 *   4   lock unsettled or internal: retained, residue, release not confirmed,
 *       lost/replaced, identity generation failure, second signal
 *   130 / 143  cancelled by SIGINT / SIGTERM, lock released (or never taken)
 */

import fs from 'node:fs'
import path from 'node:path'
import { types as utilTypes } from 'node:util'

import {
  CLOUD_ATTEMPT_LOCK_ACTIONS,
  CLOUD_ATTEMPT_RETRY_DISPOSITIONS,
  CLOUD_ATTEMPT_STAGES,
  CLOUD_ATTEMPT_VERDICTS,
  CLOUD_WORKSPACE_CLEANUP_STATES,
} from '../backup-cloud-attempt.mjs'
import {
  CLOUD_ATTEMPT_CODES_BY_STAGE,
  CLOUD_ATTEMPT_REJECTED_CODES,
} from '../backup-cloud-attestation-records.mjs'
import { loadCloudConfig } from '../backup-cloud-config.mjs'
import { CONTAINMENT_REFUSAL_CODES } from '../backup-cloud-containment.mjs'
import {
  ATTEMPT_ID_PATTERN,
  RUN_ID_PATTERN,
  assertSafeRemoteComponent,
  assertValidArtifactBase,
} from '../backup-cloud-naming.mjs'
import {
  CLOUD_ENTRYPOINT_EXIT_CLASSES,
  CLOUD_RUN_CONTAINMENT_STATES,
  CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE,
  CLOUD_RUN_LOCK_SUMMARY_STATES,
  CLOUD_RUN_OUTCOMES,
  CLOUD_RUN_PRELOCK_CODES,
  CLOUD_RUN_STOP_REASONS,
  CLOUD_RUN_SUMMARY_KIND,
  CLOUD_RUN_SUMMARY_SCHEMA_VERSION,
  runCloudBackup,
} from '../backup-cloud-run.mjs'
import { CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES } from '../backup-cloud-run-lock.mjs'

const TAG = '[eanhl-backup-cloud]'

/** The closed `ConfigError` codes a config failure may be reported by; anything else is `config_invalid`. */
const CONFIG_ERROR_CODES = Object.freeze([
  'config_unreadable',
  'config_unparseable',
  'config_field_missing',
  'config_field_type',
  'config_field_invalid',
  'config_field_not_absolute',
  'config_field_not_canonical',
  'config_secret_shaped_key',
])

export const USAGE = `usage: node ops/backup/eanhl-backup-cloud.mjs --config <path> --artifact-base <base>

  Upload ONE explicitly named, already-produced backup artifact to the configured
  cloud destination, read it back, verify it independently, and attest every attempt.
  NOT ACTIVATED: nothing schedules, deploys, or invokes this command.

  --config PATH          REQUIRED. Cloud configuration (see ops/backup/eanhl-backup-cloud.example.json).
  --artifact-base BASE   REQUIRED. <artifactPrefix>-<YYYYMMDDTHHMMSSZ>. No directory is scanned.

  Exit: 0 verified; 1 not verified; 2 invalid invocation; 3 run lock refused;
        4 run lock not released / internal error (operator reconciliation required);
        130 / 143 cancelled by SIGINT / SIGTERM.
`

const LINES = Object.freeze({
  usage: `${TAG} invalid invocation: --config and --artifact-base are each required exactly once; no other argument is accepted.\n`,
  artifactBase: `${TAG} invalid invocation: --artifact-base is not a valid artifact identity.\n`,
  cancel:
    `${TAG} cancellation requested; waiting for the current step to settle. ` +
    'Cancellation stops local processes only; it does not establish anything about remote state.\n',
  forced:
    `${TAG} second signal: exiting now. The run lock, if acquired, is not released. ` +
    'Child processes may still be running; nothing is known about remote state.\n',
  runThrew: `${TAG} internal error: the run did not return a summary. The run lock, if acquired, was not released by this process.\n`,
  summaryInvalid: `${TAG} internal error: the run summary failed validation and is not printed. Treat the run lock as unsettled.\n`,
  unsettled:
    `${TAG} the run lock was NOT released cleanly. An operator must correlate this run's id with ` +
    'any intent/attestation records before removing the lock. No durable reason exists beyond written attestations.\n',
  cancelNote: `${TAG} note: cancellation stops local processes only; nothing here establishes anything about remote state.\n`,
})

/** A bounded synchronous write of the whole buffer; gives up after a few short writes. */
function writeAllSync(fd, buf) {
  let offset = 0
  for (let i = 0; i < 16 && offset < buf.length; i++) {
    const n = fs.writeSync(fd, buf, offset, buf.length - offset)
    if (!Number.isSafeInteger(n) || n <= 0) break
    offset += n
  }
}

/** The REAL dependency set, bound once by `ops/backup/eanhl-backup-cloud.mjs`. */
export const REAL_ENTRYPOINT_DEPS = Object.freeze({
  proc: Object.freeze({
    on: (signal, listener) => {
      process.on(signal, listener)
    },
    off: (signal, listener) => {
      process.removeListener(signal, listener)
    },
    exit: (code) => process.exit(code),
  }),
  writeStderr: (buf) => writeAllSync(2, buf),
  writeStdout: (buf) => writeAllSync(1, buf),
  readConfigFile: (p) => fs.readFileSync(p, 'utf8'),
  runCloudBackup,
})

function assertValidDeps(deps) {
  const bad = () => {
    throw new TypeError('invalid entrypoint dependencies')
  }
  if (deps === null || typeof deps !== 'object') return bad()
  const proc = deps.proc
  if (proc === null || typeof proc !== 'object') return bad()
  for (const name of ['on', 'off', 'exit']) if (typeof proc[name] !== 'function') return bad()
  for (const name of ['writeStderr', 'writeStdout', 'readConfigFile', 'runCloudBackup']) {
    if (typeof deps[name] !== 'function') return bad()
  }
}

/** Strict: each flag exactly once, nothing else. Never echoes an argument. */
function parseArgs(argv) {
  if (!Array.isArray(argv)) return { kind: 'invalid' }
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { kind: 'help' }
  let configPath = null
  let artifactBase = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--config' && configPath === null && typeof value === 'string' && value !== '') {
      configPath = value
      i++
    } else if (
      arg === '--artifact-base' &&
      artifactBase === null &&
      typeof value === 'string' &&
      value !== ''
    ) {
      artifactBase = value
      i++
    } else {
      return { kind: 'invalid' }
    }
  }
  if (configPath === null || artifactBase === null) return { kind: 'invalid' }
  return { kind: 'run', configPath, artifactBase }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SUMMARY PROJECTION BOUNDARY.
//
// The value `runCloudBackup()` returns is UNTRUSTED here. It is never
// serialized, interpolated, or read again after `projectCloudRunSummary()`:
// every printed or serialized byte comes from the fresh projection that
// function builds.
//
//   - A Proxy is refused first, by `util.types.isProxy()`, which runs no trap.
//   - Every object must be a plain `Object.prototype` object and every array a
//     plain `Array.prototype` array, both frozen, whose OWN keys
//     (`Reflect.ownKeys`: enumerable or not, strings and symbols) are EXACTLY
//     the expected set. An extra secret-bearing field, a non-enumerable
//     `toJSON`, or a symbol key is refused, never skipped.
//   - Every value is read exactly once, through its own property descriptor,
//     and must be an enumerable DATA property. An accessor is refused without
//     being invoked, so a throwing or stateful getter can neither escape nor
//     make validation and serialization disagree.
//   - Every value is a primitive checked against its closed vocabulary or
//     identifier pattern, and the cross-field relationships the run produces
//     are re-checked independently (a genuine second opinion, not a re-export
//     of the run core's own derivation).
//   - The result is built from `Object.create(null)` objects and a fresh
//     null-prototype array, deeply frozen, so no `toJSON` — own, inherited,
//     or from a polluted global prototype — can reach `JSON.stringify`.
//
// Any failure returns `null`; the caller prints the fixed `summaryInvalid`
// line only, with no summary, and exits 4. Nothing from the rejected value —
// no field, marker, native error, path, or stack — is ever written.
// ─────────────────────────────────────────────────────────────────────────────

/** Private unwinding sentinel — never escapes `projectCloudRunSummary()`. */
const PROJECTION_REFUSED = Object.freeze(Object.create(null))
function refuse() {
  throw PROJECTION_REFUSED
}

const SUMMARY_KEYS = Object.freeze(
  [
    'kind',
    'schemaVersion',
    'cloudRunId',
    'artifactBase',
    'outcome',
    'stopReason',
    'verifiedAttemptId',
    'cancellationRequested',
    'lock',
    'containment',
    'attempts',
  ].sort(),
)
const PAIR_KEYS = Object.freeze(['code', 'state'])
const ATTEMPT_KEYS = Object.freeze(
  [
    'sequence',
    'attemptId',
    'verdict',
    'stage',
    'code',
    'role',
    'termination',
    'attestationWritten',
    'cleanupState',
    'lockAction',
    'retryDisposition',
  ].sort(),
)
const TERMINATION_STATES = Object.freeze(['confirmed', 'unconfirmed', 'not_applicable'])
const READBACK_ROLES = Object.freeze(['manifest', 'checksum', 'ciphertext'])
const COLLISION_CODES = Object.freeze(['remote_path_occupied', 'provider_rejected'])
const RELEASE_STATES = Object.freeze([
  'released',
  'release_refused',
  'release_durability_unconfirmed',
  'release_replaced',
])
const RELEASING_STOPS = Object.freeze([
  'verified',
  'not_retry_eligible',
  'attempt_budget_exhausted',
  'cancelled',
  'containment_refused',
  'attempt_not_started',
])
const RETAINING_STOPS = Object.freeze([
  'attempt_lock_retained',
  'containment_unsettled',
  'run_internal_error',
])
const ATTEMPT_RETAIN_ACTIONS = Object.freeze(
  CLOUD_ATTEMPT_LOCK_ACTIONS.filter((a) => a !== 'release'),
)
const RUN_INTERNAL_RETAIN_REASONS = Object.freeze([
  'containment_result_invalid',
  'attempt_report_invalid',
  'attempt_threw',
  'run_internal_error',
])

const isSortedEqual = (actual, expected) =>
  actual.length === expected.length && actual.every((k, i) => k === expected[i])

/** A plain, frozen, non-Proxy object whose own keys are exactly `keys`; each value read ONCE as a data property. */
function readRecord(value, keys) {
  if (value === null || typeof value !== 'object') refuse()
  if (utilTypes.isProxy(value) || Array.isArray(value)) refuse()
  if (Object.getPrototypeOf(value) !== Object.prototype || !Object.isFrozen(value)) refuse()
  const own = Reflect.ownKeys(value)
  if (!own.every((k) => typeof k === 'string')) refuse()
  if (!isSortedEqual([...own].sort(), keys)) refuse()
  const raw = Object.create(null)
  for (const key of keys) {
    const d = Reflect.getOwnPropertyDescriptor(value, key)
    if (d === undefined || !Object.hasOwn(d, 'value') || d.enumerable !== true) refuse()
    raw[key] = d.value
  }
  return raw
}

/** A plain, frozen, non-Proxy array of at most `max` elements; each element read ONCE as a data property. */
function readArray(value, max) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) refuse()
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) refuse()
  if (!Object.isFrozen(value)) refuse()
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length')
  const length = lengthDescriptor?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > max) refuse()
  const own = Reflect.ownKeys(value)
  const expected = [...Array.from({ length }, (_, i) => String(i)), 'length']
  if (own.length !== expected.length || !own.every((k, i) => k === expected[i])) refuse()
  const raw = []
  for (let i = 0; i < length; i++) {
    const d = Reflect.getOwnPropertyDescriptor(value, String(i))
    if (d === undefined || !Object.hasOwn(d, 'value') || d.enumerable !== true) refuse()
    raw.push(d.value)
  }
  return raw
}

const member = (list, v) => list.includes(v)
const isNullableMember = (list, v) => v === null || list.includes(v)
const frozenRecord = (entries) => Object.freeze(Object.assign(Object.create(null), entries))

/** One attempt projection: exact keys, closed values, and per-attempt coherence. */
function projectAttempt(value, index, seenIds) {
  const r = readRecord(value, ATTEMPT_KEYS)
  if (r.sequence !== index) refuse()
  if (typeof r.attemptId !== 'string' || !ATTEMPT_ID_PATTERN.test(r.attemptId)) refuse()
  if (seenIds.has(r.attemptId)) refuse()
  if (!member(CLOUD_ATTEMPT_VERDICTS, r.verdict)) refuse()
  if (r.verdict === 'verified') {
    if (r.stage !== null || r.code !== null || r.role !== null) refuse()
    if (r.attestationWritten !== true || r.termination !== 'confirmed') refuse()
  } else {
    if (!member(CLOUD_ATTEMPT_STAGES, r.stage)) refuse()
    if (!member(CLOUD_ATTEMPT_CODES_BY_STAGE[r.stage], r.code)) refuse()
    if ((r.verdict === 'rejected') !== member(CLOUD_ATTEMPT_REJECTED_CODES, r.code)) refuse()
    if (!isNullableMember(READBACK_ROLES, r.role)) refuse()
    if ((r.role !== null) !== (r.stage === 'readback')) refuse()
  }
  if (!member(TERMINATION_STATES, r.termination)) refuse()
  if (typeof r.attestationWritten !== 'boolean') refuse()
  if (!member(CLOUD_WORKSPACE_CLEANUP_STATES, r.cleanupState)) refuse()
  if (!member(CLOUD_ATTEMPT_LOCK_ACTIONS, r.lockAction)) refuse()
  if (!member(CLOUD_ATTEMPT_RETRY_DISPOSITIONS, r.retryDisposition)) refuse()
  if (!r.attestationWritten && r.lockAction === 'release') refuse()
  if (r.termination === 'unconfirmed' && r.lockAction === 'release') refuse()
  if (r.retryDisposition === 'eligible_zero_transfer_collision') {
    const coherent =
      r.verdict === 'rejected' &&
      r.stage === 'upload' &&
      member(COLLISION_CODES, r.code) &&
      r.attestationWritten === true &&
      r.lockAction === 'release' &&
      r.cleanupState === 'complete' &&
      r.termination === 'confirmed'
    if (!coherent) refuse()
  }
  seenIds.add(r.attemptId)
  return frozenRecord({
    sequence: r.sequence,
    attemptId: r.attemptId,
    verdict: r.verdict,
    stage: r.stage,
    code: r.code,
    role: r.role,
    termination: r.termination,
    attestationWritten: r.attestationWritten,
    cleanupState: r.cleanupState,
    lockAction: r.lockAction,
    retryDisposition: r.retryDisposition,
  })
}

/** The outcome the run MUST have reported for these facts — restated independently. */
function expectedOutcome({ lock, verifiedAttemptId, cancellationRequested }) {
  if (lock.state === 'not_attempted') {
    return lock.code === null && cancellationRequested ? 'cancelled' : 'lock_unsettled'
  }
  if (lock.state === 'refused') {
    return member(CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES, lock.code)
      ? 'lock_unsettled'
      : 'lock_refused'
  }
  if (lock.state !== 'released') return 'lock_unsettled'
  if (verifiedAttemptId !== null) return 'verified'
  if (cancellationRequested) return 'cancelled'
  return 'not_verified'
}

/** Cross-field relationships between lock, containment, attempts, stop reason, and outcome. */
function assertCoherent(p, maxAttempts) {
  const { lock, containment, attempts, stopReason: stop } = p
  const count = attempts.length
  const last = count > 0 ? attempts[count - 1] : null
  const noWork = () => {
    if (count !== 0 || containment.state !== 'not_attempted') refuse()
  }

  // run identity
  const idFailed = lock.state === 'not_attempted' && lock.code === 'run_id_generation_failed'
  if ((p.cloudRunId === null) !== idFailed) refuse()

  // lock state ↔ stop reason
  switch (lock.state) {
    case 'not_attempted':
      noWork()
      if (lock.code === null) {
        if (stop !== 'cancelled' || p.cancellationRequested !== true) refuse()
      } else if (!member(CLOUD_RUN_PRELOCK_CODES, lock.code) || stop !== 'run_internal_error') {
        refuse()
      }
      break
    case 'refused':
      noWork()
      if (
        stop !==
        (member(CLOUD_RUN_LOCK_IDENTITY_REFUSAL_CODES, lock.code)
          ? 'run_internal_error'
          : 'lock_not_acquired')
      )
        refuse()
      break
    case 'acquisition_uncertain':
      noWork()
      if (stop !== 'lock_not_acquired') refuse()
      break
    case 'lost':
    case 'replaced':
      if (stop !== 'lock_not_held') refuse()
      break
    case 'unverifiable':
      if (stop !== 'lock_not_held' && !member(RETAINING_STOPS, stop)) refuse()
      break
    case 'retained':
      if (!member(RETAINING_STOPS, stop)) refuse()
      if (stop === 'attempt_lock_retained') {
        if (!member(ATTEMPT_RETAIN_ACTIONS, lock.code) || last?.lockAction !== lock.code) refuse()
      } else if (stop === 'containment_unsettled') {
        if (lock.code !== 'containment_termination_unconfirmed') refuse()
      } else if (!member(RUN_INTERNAL_RETAIN_REASONS, lock.code)) {
        refuse()
      }
      break
    default:
      if (!member(RELEASE_STATES, lock.state) || !member(RELEASING_STOPS, stop)) refuse()
  }

  // containment state ↔ code, work, and stop reason
  if (containment.state === 'refused') {
    if (!member(CONTAINMENT_REFUSAL_CODES, containment.code)) refuse()
  } else if (containment.code !== null) {
    refuse()
  }
  if (containment.state !== 'proven' && count !== 0) refuse()
  if (containment.state === 'invalid' && stop !== 'run_internal_error') refuse()
  if (containment.state === 'refused') {
    const unsettled = containment.code === 'termination_unconfirmed'
    if (unsettled !== (stop === 'containment_unsettled')) refuse()
    if (stop === 'cancelled' && containment.code !== 'canary_cancelled') refuse()
    if (!['containment_refused', 'containment_unsettled', 'cancelled'].includes(stop)) refuse()
  }
  if (stop === 'containment_refused') {
    if (containment.state !== 'refused') refuse()
    if (['termination_unconfirmed', 'canary_cancelled'].includes(containment.code)) refuse()
  }
  if (stop === 'containment_unsettled' && containment.state !== 'refused') refuse()
  if (stop === 'attempt_not_started' && containment.state !== 'proven') refuse()
  if (stop === 'lock_not_acquired' && !['refused', 'acquisition_uncertain'].includes(lock.state))
    refuse()
  if (stop === 'lock_not_held' && !['lost', 'replaced', 'unverifiable'].includes(lock.state))
    refuse()

  // attempts: only the last may be anything other than a retried collision
  if (count > maxAttempts) refuse()
  for (let i = 0; i < count - 1; i++) {
    const a = attempts[i]
    if (a.verdict !== 'rejected' || a.lockAction !== 'release') refuse()
    if (a.retryDisposition !== 'eligible_zero_transfer_collision') refuse()
  }
  const verifiedId = last !== null && last.verdict === 'verified' ? last.attemptId : null
  if (p.verifiedAttemptId !== verifiedId) refuse()
  if (verifiedId !== null && !['verified', 'attempt_lock_retained'].includes(stop)) refuse()

  // stop reason ↔ the last attempt
  if (stop === 'verified' && (verifiedId === null || last.lockAction !== 'release')) refuse()
  if (stop === 'attempt_lock_retained' && (last === null || last.lockAction === 'release')) refuse()
  if (stop === 'not_retry_eligible') {
    if (last === null || last.verdict === 'verified' || last.lockAction !== 'release') refuse()
    if (last.retryDisposition !== 'not_eligible') refuse()
  }
  if (stop === 'attempt_budget_exhausted') {
    if (last === null || count !== maxAttempts || last.lockAction !== 'release') refuse()
    if (last.retryDisposition !== 'eligible_zero_transfer_collision') refuse()
  }
  if (stop === 'cancelled') {
    if (p.cancellationRequested !== true) refuse()
    if (last !== null && (last.verdict === 'verified' || last.lockAction !== 'release')) refuse()
  }

  if (p.outcome !== expectedOutcome(p)) refuse()
}

function buildProjection(value, artifactBase, retry) {
  const maxAttempts = Math.min(retry.maxAttemptsPerArtifactPerRun, retry.maxTotalAttemptsPerRun)
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) refuse()
  if (typeof artifactBase !== 'string') refuse()

  const top = readRecord(value, SUMMARY_KEYS)
  if (top.kind !== CLOUD_RUN_SUMMARY_KIND) refuse()
  if (top.schemaVersion !== CLOUD_RUN_SUMMARY_SCHEMA_VERSION) refuse()
  if (top.artifactBase !== artifactBase) refuse()
  if (top.cloudRunId !== null) {
    if (typeof top.cloudRunId !== 'string' || !RUN_ID_PATTERN.test(top.cloudRunId)) refuse()
  }
  if (!member(CLOUD_RUN_OUTCOMES, top.outcome)) refuse()
  if (!member(CLOUD_RUN_STOP_REASONS, top.stopReason)) refuse()
  if (top.verifiedAttemptId !== null) {
    const v = top.verifiedAttemptId
    if (typeof v !== 'string' || !ATTEMPT_ID_PATTERN.test(v)) refuse()
  }
  if (typeof top.cancellationRequested !== 'boolean') refuse()

  const lockRaw = readRecord(top.lock, PAIR_KEYS)
  if (!member(CLOUD_RUN_LOCK_SUMMARY_STATES, lockRaw.state)) refuse()
  if (!member(CLOUD_RUN_LOCK_SUMMARY_CODES_BY_STATE[lockRaw.state], lockRaw.code)) refuse()
  const lock = frozenRecord({ state: lockRaw.state, code: lockRaw.code })

  const containmentRaw = readRecord(top.containment, PAIR_KEYS)
  if (!member(CLOUD_RUN_CONTAINMENT_STATES, containmentRaw.state)) refuse()
  if (!isNullableMember(CONTAINMENT_REFUSAL_CODES, containmentRaw.code)) refuse()
  const containment = frozenRecord({ state: containmentRaw.state, code: containmentRaw.code })

  const seenIds = new Set()
  const rawAttempts = readArray(top.attempts, maxAttempts)
  const list = []
  for (let i = 0; i < rawAttempts.length; i++) list.push(projectAttempt(rawAttempts[i], i, seenIds))
  // A real Array (so JSON serializes it as one) with NO prototype, so nothing
  // inherited is ever consulted for it.
  const attempts = Object.freeze(Object.setPrototypeOf(list, null))

  const projection = frozenRecord({
    kind: top.kind,
    schemaVersion: top.schemaVersion,
    cloudRunId: top.cloudRunId,
    artifactBase: top.artifactBase,
    outcome: top.outcome,
    stopReason: top.stopReason,
    verifiedAttemptId: top.verifiedAttemptId,
    cancellationRequested: top.cancellationRequested,
    lock,
    containment,
    attempts,
  })
  assertCoherent(projection, maxAttempts)
  return projection
}

/**
 * Project the UNTRUSTED value a run returned into a fresh, deeply frozen,
 * closed, plain-data summary — or `null` if anything about it is not exactly
 * what the run produces. See the section comment above.
 *
 * @param {unknown} value
 * @param {{artifactBase: string, retry: {maxAttemptsPerArtifactPerRun: number,
 *   maxTotalAttemptsPerRun: number}}} context  from THIS invocation's own
 *   validated arguments and configuration, never from `value`
 * @returns {object|null}
 */
export function projectCloudRunSummary(value, { artifactBase, retry }) {
  try {
    return buildProjection(value, artifactBase, retry)
  } catch {
    return null
  }
}

/** The exit status, from the PROJECTION's outcome and the ONE signal this process recorded. */
export function exitStatusFor(projection, receivedSignal) {
  const X = CLOUD_ENTRYPOINT_EXIT_CLASSES
  switch (projection.outcome) {
    case 'verified':
      return X.success
    case 'not_verified':
      return X.not_verified
    case 'lock_refused':
      return X.lock_refused
    case 'lock_unsettled':
      return X.lock_unsettled
    case 'cancelled':
      if (receivedSignal === 'SIGINT') return X.cancelled_sigint
      if (receivedSignal === 'SIGTERM') return X.cancelled_sigterm
      return X.lock_unsettled // cancelled without a recorded signal: incoherent
    default:
      return X.lock_unsettled
  }
}

const orDash = (v) => (v === null ? '-' : v)

/** Fixed stderr lines built ONLY from the safe projection's closed values and validated identifiers. */
function summaryLines(s) {
  const lines = []
  const lock = s.lock.code === null ? s.lock.state : `${s.lock.state}/${s.lock.code}`
  const containment =
    s.containment.code === null
      ? s.containment.state
      : `${s.containment.state}/${s.containment.code}`
  lines.push(
    `${TAG} run ${orDash(s.cloudRunId)}: outcome=${s.outcome} stop=${s.stopReason} ` +
      `lock=${lock} containment=${containment} attempts=${s.attempts.length}\n`,
  )
  // The projection's attempts array has no prototype: index it, never iterate it.
  for (let i = 0; i < s.attempts.length; i++) {
    const a = s.attempts[i]
    lines.push(
      `${TAG} attempt ${a.sequence} ${a.attemptId}: verdict=${a.verdict} stage=${orDash(a.stage)} ` +
        `code=${orDash(a.code)} retry=${a.retryDisposition} lock=${a.lockAction} cleanup=${a.cleanupState}\n`,
    )
  }
  if (!['released', 'not_attempted', 'refused'].includes(s.lock.state)) lines.push(LINES.unsettled)
  if (s.cancellationRequested) lines.push(LINES.cancelNote)
  return lines
}

export function makeCloudEntrypoint(deps) {
  assertValidDeps(deps)
  const say = (text) => {
    try {
      deps.writeStderr(Buffer.from(text, 'utf8'))
    } catch {
      /* diagnostics are best effort; they never change the outcome */
    }
  }

  async function main(argv) {
    const controller = new AbortController()
    let received = null

    const onSignal = (name) => {
      if (received !== null) {
        // Second signal: one synchronous bounded write, then exit. The lock,
        // if acquired, is retained by omission.
        say(LINES.forced)
        deps.proc.exit(CLOUD_ENTRYPOINT_EXIT_CLASSES.lock_unsettled)
        return
      }
      received = name
      controller.abort()
      say(LINES.cancel)
    }
    const listeners = Object.freeze({
      SIGINT: () => onSignal('SIGINT'),
      SIGTERM: () => onSignal('SIGTERM'),
    })
    // Installed BEFORE any synchronous parsing.
    for (const [name, listener] of Object.entries(listeners)) deps.proc.on(name, listener)
    try {
      const parsed = parseArgs(argv)
      if (parsed.kind === 'help') {
        try {
          deps.writeStdout(Buffer.from(USAGE, 'utf8'))
        } catch {
          /* best effort */
        }
        return CLOUD_ENTRYPOINT_EXIT_CLASSES.success
      }
      if (parsed.kind !== 'run') {
        say(LINES.usage)
        return CLOUD_ENTRYPOINT_EXIT_CLASSES.invalid_invocation
      }

      let config
      try {
        config = loadCloudConfig(path.resolve(parsed.configPath), deps.readConfigFile)
      } catch (err) {
        let code = 'config_invalid'
        try {
          if (CONFIG_ERROR_CODES.includes(err?.code)) code = err.code
        } catch {
          code = 'config_invalid'
        }
        say(`${TAG} invalid invocation: configuration refused [${code}].\n`)
        return CLOUD_ENTRYPOINT_EXIT_CLASSES.invalid_invocation
      }
      try {
        assertSafeRemoteComponent(parsed.artifactBase, 'artifactBase')
        assertValidArtifactBase(parsed.artifactBase)
      } catch {
        say(LINES.artifactBase)
        return CLOUD_ENTRYPOINT_EXIT_CLASSES.invalid_invocation
      }

      let summary
      try {
        summary = await deps.runCloudBackup({
          config,
          artifactBase: parsed.artifactBase,
          signal: controller.signal,
        })
      } catch {
        say(LINES.runThrew)
        return CLOUD_ENTRYPOINT_EXIT_CLASSES.lock_unsettled
      }
      // The returned value is untrusted: project it ONCE, then drop it. Only
      // the projection is ever serialized, interpolated, or mapped to a status.
      const projected = projectCloudRunSummary(summary, {
        artifactBase: parsed.artifactBase,
        retry: config.retry,
      })
      summary = undefined
      if (projected === null) {
        say(LINES.summaryInvalid)
        return CLOUD_ENTRYPOINT_EXIT_CLASSES.lock_unsettled
      }
      let line
      try {
        line = JSON.stringify(projected) + '\n'
      } catch {
        say(LINES.summaryInvalid)
        return CLOUD_ENTRYPOINT_EXIT_CLASSES.lock_unsettled
      }
      try {
        deps.writeStdout(Buffer.from(line, 'utf8'))
      } catch {
        /* best effort; the exit status still carries the outcome */
      }
      for (const text of summaryLines(projected)) say(text)
      return exitStatusFor(projected, received)
    } finally {
      for (const [name, listener] of Object.entries(listeners)) deps.proc.off(name, listener)
    }
  }

  return Object.freeze({ main })
}
