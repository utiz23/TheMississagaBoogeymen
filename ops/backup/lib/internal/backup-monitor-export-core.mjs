/**
 * Monitor-export orchestration and the export report (E3J8A) — internal core.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------
 * Memo §5.2 **piece 3 only** — the EMITTER. It classifies E3J7's freshness
 * signal into one of two Healthchecks endpoints and posts it as a dead-man's
 * switch heartbeat. Pieces 4 and 5 are provider-side configuration: the watcher
 * is Healthchecks.io's own grace timer, and the notification channels are its
 * integrations. **There is no local watcher code and no local notification
 * code here, and none is planned.**
 *
 * NOTHING IS ACTIVATED. No timer, no cron entry, no systemd unit, no package
 * script, no executable bit, no default config path. Activation waits on backup
 * scheduling, which does not exist. `monitored` stays exactly `false`, in the
 * signal and in the report, and validation refuses any other value.
 *
 * WHICH LOCAL FAILURES STILL PING, AND WHY THE ASYMMETRY IS DELIBERATE
 * ---------------------------------------------------------------------
 * A CLOUD-side failure — the cloud config is unreadable, evaluation threw, the
 * signal is invalid or too large — still produces a `/fail` ping. That is
 * exactly the condition worth alarming on, so the alarm should fire fast rather
 * than wait out a grace period.
 *
 * A MONITOR-side failure — the monitor config is invalid, or the ping key is
 * unavailable — makes a request path impossible, so NO ping is sent at all,
 * `delivery` is `not_sent`, and the process exits 3. That is the dead-man's
 * switch working as designed: silence is itself the alarm, after the grace
 * period.
 *
 * THE REPORT IS ASSEMBLED FROM LITERALS, AND PRINTED ONLY AS A PROJECTION
 * -------------------------------------------------------------------------
 * Every field of the report and of the failure body is a string literal, a
 * closed code, a boolean, a small integer, or a validated ISO instant. The
 * failure body never leaves this module as an object, so it needs no boundary.
 *
 * The REPORT does, and the original E3J8A plan was wrong to assume otherwise.
 * It reasoned that no caller-owned report would ever enter the serializer, but
 * `validateExportReport()` and `serializeExportReport()` are PUBLIC APIs, so any
 * caller can hand them any object — including one whose accessor returns a
 * contract-legal slug to the validator and a different string to
 * `JSON.stringify`. So neither ever serializes, or even reads through, the
 * object it was given. `projectExportReport()` below is a small, FLAT copy of
 * E3J7's projection discipline (Proxy refusal without a trap, accessor refusal
 * without invocation, exact `Reflect.ownKeys()` set, prototype check), and only
 * its fresh, frozen, null-prototype result is validated and printed. It is
 * flat because the report is flat: every field is a primitive, so no nested
 * object, array or `toJSON` can survive into it. What IS shared with E3J7 is
 * the serialize discipline itself, `serializeChecked()` from
 * `internal/backup-signal-serialization.mjs`.
 *
 * The signal body is E3J7's own output, produced by reusing its boundary
 * verbatim: `evaluateCloudFreshness()` → `projectFreshnessSignal()` →
 * `serializeFreshnessSignal()`. No second, weaker boundary is written.
 */

import fs from 'node:fs'
import { types as utilTypes } from 'node:util'

import { loadCloudConfig } from '../backup-cloud-config.mjs'
import {
  MONITOR_CONFIG_ERROR_CODES,
  SLUG_PATTERN,
  loadMonitorConfig,
} from '../backup-monitor-config.mjs'
import {
  MAX_REQUEST_BODY_BYTES,
  PING_DELIVERY_STATES,
  PING_ENDPOINTS,
  PING_ERROR_CLASSES,
  PING_OUTCOME_CODES,
  REAL_TRANSPORT_DEPS,
  isGenuineAbortSignal,
  makeHealthchecksTransport,
  projectCallArgs,
} from './backup-healthchecks-transport-core.mjs'
// E3J7's PUBLIC API, deliberately not its internal core: that core has a static
// regression asserting only its own wrapper, entrypoint and suite import it, and
// the public module is the supported path. `evaluateCloudFreshness` there is
// already bound once to the real dependencies.
import {
  FRESHNESS_STATUSES,
  evaluateCloudFreshness,
  projectFreshnessSignal,
  serializeFreshnessSignal,
} from '../backup-cloud-freshness.mjs'
import { deepFreeze, serializeChecked } from './backup-signal-serialization.mjs'

const ISO_MS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export const MONITOR_EXPORT_REPORT_KIND = 'eanhl.monitor-export-report'
export const MONITOR_EXPORT_REPORT_SCHEMA_VERSION = 1
export const MONITOR_EXPORT_FAILURE_KIND = 'eanhl.monitor-export-failure'
export const MONITOR_EXPORT_FAILURE_SCHEMA_VERSION = 1

/** The one provider this emitter speaks to. Mirrors the config's closed enum. */
export const MONITOR_EXPORT_PROVIDER = 'healthchecks_io'

/** Which body was posted. Closed. */
export const MONITOR_BODY_KINDS = Object.freeze(['signal', 'failure'])

/** Why a failure body was posted instead of the signal. Closed. */
export const MONITOR_FAILURE_REASONS = Object.freeze([
  'cloud_config_invalid',
  'signal_unavailable',
  'signal_invalid',
  'signal_oversized',
  'internal_error',
])

/**
 * THE CLASSIFICATION, CLOSED AND EXHAUSTIVE.
 *
 * Every member of E3J7's `FRESHNESS_STATUSES` has an explicit entry, and a
 * static test asserts that, so a status added later can never DEFAULT to the
 * success endpoint. Failing to produce a valid signal at all also maps to
 * `fail`.
 */
export const ENDPOINT_FOR_STATUS = Object.freeze({
  fresh: 'success',
  warning: 'fail',
  critical: 'fail',
  no_evidence: 'fail',
  indeterminate: 'fail',
})

/** Anything that is not exactly `fresh` — including `null` — is `fail`. */
export function classifyFreshnessStatus(status) {
  if (typeof status !== 'string') return 'fail'
  const endpoint = Object.prototype.hasOwnProperty.call(ENDPOINT_FOR_STATUS, status)
    ? ENDPOINT_FOR_STATUS[status]
    : 'fail'
  return endpoint === 'success' ? 'success' : 'fail'
}

const REPORT_KEYS = Object.freeze([
  'kind',
  'schema_version',
  'generated_at',
  'provider',
  'slug',
  'endpoint',
  'signal_status',
  'body',
  'failure_reason',
  'attempts',
  'request_started',
  'request_written',
  'delivery',
  'outcome',
  'error_class',
  'response_status',
  'monitored',
])

/**
 * The LAST-LINE check that a report is exactly the closed contract — so no
 * path, identifier, key or free text can have reached stdout — AND that its
 * fields do not contradict one another. A self-contradictory report is worse
 * than no report, because an operator would act on it.
 *
 * INTERNAL: it reads fields directly, so it is only ever handed data this
 * module owns — the fresh projection, or the `JSON.parse` result of the
 * projection's own text. A caller-owned object reaches it only through
 * `projectExportReport()`.
 */
function validateReportData(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return false
  const keys = Object.keys(report)
  if (keys.length !== REPORT_KEYS.length) return false
  if (!REPORT_KEYS.every((k) => keys.includes(k))) return false

  if (report.kind !== MONITOR_EXPORT_REPORT_KIND) return false
  if (report.schema_version !== MONITOR_EXPORT_REPORT_SCHEMA_VERSION) return false
  if (report.generated_at !== null && !ISO_MS_UTC.test(String(report.generated_at))) return false
  if (report.provider !== MONITOR_EXPORT_PROVIDER) return false
  // `monitored` is FIXED. See memo §5.6: it may only become true in a later,
  // separately authorized session, and only once a human has received a test
  // notification from a deliberately failed ping.
  if (report.monitored !== false) return false

  if (!PING_ENDPOINTS.includes(report.endpoint)) return false
  if (!MONITOR_BODY_KINDS.includes(report.body)) return false
  if (!PING_DELIVERY_STATES.includes(report.delivery)) return false
  if (!PING_OUTCOME_CODES.includes(report.outcome)) return false
  if (report.error_class !== null && !PING_ERROR_CLASSES.includes(report.error_class)) return false
  if (report.signal_status !== null && !FRESHNESS_STATUSES.includes(report.signal_status)) {
    return false
  }
  if (report.failure_reason !== null && !MONITOR_FAILURE_REASONS.includes(report.failure_reason)) {
    return false
  }
  // `slug` is null ONLY when no valid monitor config was loaded, which means no
  // request path could exist and therefore nothing was sent. Otherwise it must
  // satisfy the config's own canonical slug grammar — being a string is not
  // enough, or a path, URL or free text could reach stdout.
  if (report.slug !== null) {
    if (typeof report.slug !== 'string' || !SLUG_PATTERN.test(report.slug)) return false
  }
  if (report.slug === null && report.delivery !== 'not_sent') return false

  if (report.attempts !== 0 && report.attempts !== 1) return false
  if (typeof report.request_started !== 'boolean') return false
  if (typeof report.request_written !== 'boolean') return false
  if (report.response_status !== null && !Number.isSafeInteger(report.response_status)) {
    return false
  }

  // ── Cross-field rules.
  // Nothing was sent, so nothing was started and nothing was attempted.
  if (report.delivery === 'not_sent') {
    if (report.request_started !== false) return false
    if (report.attempts !== 0) return false
    if (report.request_written !== false) return false
    if (report.response_status !== null) return false
    if (report.outcome !== 'local_refused') return false
  } else {
    if (report.request_started !== true) return false
    if (report.attempts !== 1) return false
    if (report.outcome === 'local_refused') return false
  }
  // A head arrived, so there is a status; and `delivered` alone never means the
  // provider recorded anything — only `accepted` does.
  if (report.delivery === 'delivered' && report.response_status === null) return false
  if (report.delivery === 'indeterminate' && report.response_status !== null) return false
  if (report.outcome === 'accepted') {
    if (report.response_status !== 200) return false
    if (report.delivery !== 'delivered') return false
  }
  // The body and the reason describe the same decision.
  if (report.body === 'signal') {
    if (report.failure_reason !== null) return false
  } else if (report.failure_reason === null) {
    return false
  }
  // Only a `fresh` signal may address the success endpoint.
  if (report.endpoint === 'success') {
    if (report.body !== 'signal') return false
    if (report.signal_status !== 'fresh') return false
  }
  return true
}

/**
 * THE REPORT PROJECTION BOUNDARY. A fresh, frozen, null-prototype copy of a
 * candidate report, or `null`. Total: it never throws, and it never runs code
 * the candidate owns.
 *
 *   - A Proxy is refused first, by `util.types.isProxy()`, which runs no trap.
 *     Only after that are `Object.getPrototypeOf()` and `Reflect.ownKeys()`
 *     called, and on a non-Proxy ordinary object neither runs user code.
 *   - The prototype must be `Object.prototype` or `null`.
 *   - `Reflect.ownKeys()` (enumerable or not, strings and symbols) must be
 *     EXACTLY the report's key set. A symbol key, a non-enumerable extra (an
 *     own `toJSON` included) or a missing key is refused, never skipped. An
 *     inherited `toJSON` cannot matter: nothing inherited is ever read, and
 *     the projection has no prototype.
 *   - Every field is read through its own property descriptor and must be an
 *     enumerable DATA property holding a primitive. An accessor is refused
 *     WITHOUT being invoked, so a stateful or throwing getter can neither leak
 *     nor crash.
 *   - The copied primitives then pass the full closed-vocabulary and
 *     cross-field check, `validateReportData()`.
 */
function projectExportReport(candidate) {
  try {
    if (candidate === null || typeof candidate !== 'object') return null
    if (utilTypes.isProxy(candidate)) return null
    if (Array.isArray(candidate)) return null
    const proto = Object.getPrototypeOf(candidate)
    if (proto !== Object.prototype && proto !== null) return null
    const keys = Reflect.ownKeys(candidate)
    if (keys.length !== REPORT_KEYS.length) return null
    for (const k of keys) if (typeof k !== 'string' || !REPORT_KEYS.includes(k)) return null

    const out = Object.create(null)
    for (const key of REPORT_KEYS) {
      const d = Object.getOwnPropertyDescriptor(candidate, key)
      if (d === undefined || !Object.hasOwn(d, 'value') || d.enumerable !== true) return null
      const v = d.value
      if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        return null
      }
      out[key] = v
    }
    if (!validateReportData(out)) return null
    return deepFreeze(out)
  } catch {
    return null
  }
}

/**
 * PUBLIC. Whether a safe projection of `candidate` exists. Total: never
 * throws, never invokes an accessor or a Proxy trap.
 */
export function validateExportReport(candidate) {
  return projectExportReport(candidate) !== null
}

/** Structural equality over the report's fixed shape: projection vs. reparse. */
function sameReport(a, b) {
  for (const key of REPORT_KEYS) if (a[key] !== b[key]) return false
  return true
}

/** The checked text of an ALREADY-PROJECTED report. */
function serializeProjection(projection) {
  return serializeChecked(projection, validateReportData, sameReport)
}

/**
 * PUBLIC. Serialize a candidate report, or `null` on any doubt. The caller's
 * object is never serialized: only its fresh projection is.
 */
export function serializeExportReport(candidate) {
  const projection = projectExportReport(candidate)
  return projection === null ? null : serializeProjection(projection)
}

const FAILURE_KEYS = Object.freeze([
  'kind',
  'schema_version',
  'generated_at',
  'reason',
  'monitored',
])

function validateFailureBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false
  const keys = Object.keys(body)
  if (keys.length !== FAILURE_KEYS.length) return false
  if (!FAILURE_KEYS.every((k) => keys.includes(k))) return false
  if (body.kind !== MONITOR_EXPORT_FAILURE_KIND) return false
  if (body.schema_version !== MONITOR_EXPORT_FAILURE_SCHEMA_VERSION) return false
  if (body.generated_at !== null && !ISO_MS_UTC.test(String(body.generated_at))) return false
  if (!MONITOR_FAILURE_REASONS.includes(body.reason)) return false
  if (body.monitored !== false) return false
  return true
}

function sameFailureBody(a, b) {
  for (const key of FAILURE_KEYS) if (a[key] !== b[key]) return false
  return true
}

/**
 * The fixed, compile-time fallback body, used only if even the literal-only
 * failure body somehow fails its own serialize check. A `/fail` ping therefore
 * ALWAYS has a body.
 */
export const FALLBACK_FAILURE_BODY =
  '{"kind":"eanhl.monitor-export-failure","schema_version":1,' +
  '"generated_at":null,"reason":"internal_error","monitored":false}'

/**
 * Build the closed failure body. Literals and one closed code only.
 *
 * @param {object} args
 * @param {string|null} args.generatedAt an ISO-ms-UTC instant, or null
 * @param {string} args.reason one of `MONITOR_FAILURE_REASONS`
 * @returns {string} serialized JSON; the fixed fallback if anything is off
 */
export function buildFailureBody({ generatedAt = null, reason } = {}) {
  const body = Object.create(null)
  body.kind = MONITOR_EXPORT_FAILURE_KIND
  body.schema_version = MONITOR_EXPORT_FAILURE_SCHEMA_VERSION
  body.generated_at =
    typeof generatedAt === 'string' && ISO_MS_UTC.test(generatedAt) ? generatedAt : null
  body.reason = MONITOR_FAILURE_REASONS.includes(reason) ? reason : 'internal_error'
  body.monitored = false
  const text = serializeChecked(body, validateFailureBody, sameFailureBody)
  return text === null ? FALLBACK_FAILURE_BODY : text
}

/**
 * Build the report. Every value is copied from a closed vocabulary, a boolean,
 * a small integer, or a validated instant — never from an object a caller owns.
 */
function buildReport(fields) {
  const out = Object.create(null)
  out.kind = MONITOR_EXPORT_REPORT_KIND
  out.schema_version = MONITOR_EXPORT_REPORT_SCHEMA_VERSION
  out.generated_at = fields.generatedAt
  out.provider = MONITOR_EXPORT_PROVIDER
  out.slug = fields.slug
  out.endpoint = fields.endpoint
  out.signal_status = fields.signalStatus
  out.body = fields.body
  out.failure_reason = fields.failureReason
  out.attempts = fields.attempts
  out.request_started = fields.requestStarted
  out.request_written = fields.requestWritten
  out.delivery = fields.delivery
  out.outcome = fields.outcome
  out.error_class = fields.errorClass
  out.response_status = fields.responseStatus
  out.monitored = false
  return deepFreeze(out)
}

// ─────────────────────────────────────────────────────────────────────────────
// The orchestrator.
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_DEP_NAMES = Object.freeze([
  'now',
  'readConfigFile',
  'evaluateCloudFreshness',
  'pingHealthchecks',
])

/** The REAL dependency set for the orchestrator. */
export const REAL_MONITOR_EXPORT_DEPS = Object.freeze({
  now: () => Date.now(),
  readConfigFile: (p) => fs.readFileSync(p, 'utf8'),
  evaluateCloudFreshness,
  pingHealthchecks: makeHealthchecksTransport(REAL_TRANSPORT_DEPS).pingHealthchecks,
})

const RUN_ARG_KEYS = Object.freeze(['cloudConfigPath', 'monitorConfigPath'])
const RUN_OPTIONAL_ARG_KEYS = Object.freeze(['signal'])
const INVALID_RUN_ARGS = 'invalid monitor export arguments'

/** An ISO-ms-UTC instant, or null when the clock is unusable. */
function readClock(now) {
  try {
    const ms = now()
    if (!Number.isSafeInteger(ms)) return null
    const iso = new Date(ms).toISOString()
    return ISO_MS_UTC.test(iso) ? iso : null
  } catch {
    return null
  }
}

export function makeMonitorExport(deps) {
  if (deps === null || typeof deps !== 'object') {
    throw new TypeError('invalid monitor export dependencies')
  }
  for (const name of EXPORT_DEP_NAMES) {
    if (typeof deps[name] !== 'function') {
      throw new TypeError('invalid monitor export dependencies')
    }
  }

  /**
   * Decide the body and the endpoint. The CLOUD side only: this never touches
   * the monitor config, the key file, or the network.
   *
   * @returns {{endpoint: string, body: string, bodyKind: string,
   *   signalStatus: string|null, failureReason: string|null}}
   */
  function buildBody({ cloudConfigPath, generatedAt }) {
    const fail = (reason) => ({
      endpoint: 'fail',
      body: buildFailureBody({ generatedAt, reason }),
      bodyKind: 'failure',
      signalStatus: null,
      failureReason: reason,
    })

    let cloudConfig
    try {
      cloudConfig = loadCloudConfig(cloudConfigPath, deps.readConfigFile)
    } catch {
      // The ConfigError's message can echo configuration values; it is
      // discarded, and only the closed reason survives.
      return fail('cloud_config_invalid')
    }

    let signal
    try {
      signal = deps.evaluateCloudFreshness({ config: cloudConfig })
    } catch {
      return fail('signal_unavailable')
    }

    // E3J7's own boundary, verbatim: nothing the evaluator returned is
    // serialized — a fresh prototype-free projection is, and only after it has
    // been validated.
    let projection
    let text
    try {
      projection = projectFreshnessSignal(signal)
      text = projection === null ? null : serializeFreshnessSignal(projection)
    } catch {
      return fail('internal_error')
    }
    if (projection === null || text === null) return fail('signal_invalid')

    const status = typeof projection.status === 'string' ? projection.status : null
    if (status === null || !FRESHNESS_STATUSES.includes(status)) return fail('signal_invalid')

    if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BODY_BYTES) {
      // Discarded, not truncated: a partial signal is not a signal.
      return { ...fail('signal_oversized'), signalStatus: status }
    }

    return {
      endpoint: classifyFreshnessStatus(status),
      body: text,
      bodyKind: 'signal',
      signalStatus: status,
      failureReason: null,
    }
  }

  /**
   * Run one export.
   *
   * @param {object} args
   * @param {string} args.cloudConfigPath
   * @param {string} args.monitorConfigPath
   * @param {AbortSignal} [args.signal] owned by the ENTRYPOINT; omitted,
   *   `undefined`, or a genuine `AbortSignal`
   * @returns {Promise<{report: Readonly<object>, monitorConfigCode: string|null}>}
   * @throws {TypeError} one fixed message, before ANY I/O, when `args` is not a
   *   plain flat object of exactly those keys (no Proxy, no accessor), a path is
   *   not a string, or the signal is not genuine. Nothing the caller supplied
   *   is echoed. The entrypoint never produces such a call.
   */
  async function runMonitorExport(args) {
    const a = projectCallArgs(args, RUN_ARG_KEYS, RUN_OPTIONAL_ARG_KEYS)
    if (
      a === null ||
      typeof a.cloudConfigPath !== 'string' ||
      typeof a.monitorConfigPath !== 'string' ||
      (a.signal !== undefined && !isGenuineAbortSignal(a.signal))
    ) {
      throw new TypeError(INVALID_RUN_ARGS)
    }
    const { cloudConfigPath, monitorConfigPath, signal } = a

    const generatedAt = readClock(deps.now)

    // The CLOUD side first, so a monitor-side failure still yields a report
    // that records what the local verdict WAS, even though nothing was sent.
    let decided
    try {
      decided = buildBody({ cloudConfigPath, generatedAt })
    } catch {
      decided = {
        endpoint: 'fail',
        body: buildFailureBody({ generatedAt, reason: 'internal_error' }),
        bodyKind: 'failure',
        signalStatus: null,
        failureReason: 'internal_error',
      }
    }

    const notSent = (slug) =>
      buildReport({
        generatedAt,
        slug,
        endpoint: decided.endpoint,
        signalStatus: decided.signalStatus,
        body: decided.bodyKind,
        failureReason: decided.failureReason,
        attempts: 0,
        requestStarted: false,
        requestWritten: false,
        delivery: 'not_sent',
        outcome: 'local_refused',
        errorClass: null,
        responseStatus: null,
      })

    // ── The MONITOR side. A failure here makes a request path impossible, so
    //    no ping is sent and silence becomes the alarm (see the docblock).
    let monitorConfig
    try {
      monitorConfig = loadMonitorConfig(monitorConfigPath, deps.readConfigFile)
    } catch (err) {
      let code = 'config_invalid'
      try {
        if (MONITOR_CONFIG_ERROR_CODES.includes(err?.code)) code = err.code
      } catch {
        code = 'config_invalid'
      }
      return { report: notSent(null), monitorConfigCode: code }
    }

    let result
    try {
      result = await deps.pingHealthchecks({
        monitorConfig,
        endpoint: decided.endpoint,
        body: decided.body,
        signal,
      })
    } catch {
      // The transport never throws by contract; if it somehow does, nothing is
      // known about whether bytes reached the peer, so this is NOT `not_sent`.
      return {
        report: buildReport({
          generatedAt,
          slug: monitorConfig.watcher.slug,
          endpoint: decided.endpoint,
          signalStatus: decided.signalStatus,
          body: decided.bodyKind,
          failureReason: decided.failureReason,
          attempts: 1,
          requestStarted: true,
          requestWritten: false,
          delivery: 'indeterminate',
          outcome: 'transport_error',
          errorClass: 'other',
          responseStatus: null,
        }),
        monitorConfigCode: null,
      }
    }

    // The transport's result is already sanitized and closed; each field is
    // re-checked against its own vocabulary before it enters the report, so a
    // transport that returned something unexpected produces a refused report
    // rather than an unvalidated line.
    const delivery = PING_DELIVERY_STATES.includes(result?.delivery) ? result.delivery : null
    const outcome = PING_OUTCOME_CODES.includes(result?.outcome) ? result.outcome : null
    const errorClass = PING_ERROR_CLASSES.includes(result?.errorClass) ? result.errorClass : null
    const responseStatus = Number.isSafeInteger(result?.responseStatus)
      ? result.responseStatus
      : null

    // A result that fell outside the closed vocabulary is normalised to
    // `indeterminate`: a request WAS handed to the transport, so claiming
    // `not_sent` would assert something unknown. `request_started` and
    // `attempts` then follow the normalised delivery rather than the
    // untrusted result, so a misbehaving transport cannot produce a
    // self-contradictory report that the validator would refuse to print.
    const finalDelivery = delivery === null ? 'indeterminate' : delivery
    const sent = finalDelivery !== 'not_sent'
    return {
      report: buildReport({
        generatedAt,
        slug: monitorConfig.watcher.slug,
        endpoint: decided.endpoint,
        signalStatus: decided.signalStatus,
        body: decided.bodyKind,
        failureReason: decided.failureReason,
        attempts: sent ? 1 : 0,
        requestStarted: sent,
        requestWritten: sent && result?.requestWritten === true,
        delivery: finalDelivery,
        outcome: sent
          ? outcome === null || outcome === 'local_refused'
            ? 'transport_error'
            : outcome
          : 'local_refused',
        errorClass,
        responseStatus: sent ? responseStatus : null,
      }),
      monitorConfigCode: null,
    }
  }

  return Object.freeze({ runMonitorExport, buildBody })
}

// ─────────────────────────────────────────────────────────────────────────────
// The entrypoint.
// ─────────────────────────────────────────────────────────────────────────────

const TAG = '[eanhl-backup-monitor-export]'

/**
 * Ping state and report writability are encoded INDEPENDENTLY, so every code is
 * truthful about both. Exit 0 means the ping was ACCEPTED — not that the backup
 * is fresh; the verdict is `signal_status` in the report.
 */
export const MONITOR_EXPORT_EXIT_CLASSES = Object.freeze({
  accepted: 0,
  invalid_invocation: 2,
  not_sent: 3,
  delivered_unaccepted: 4,
  indeterminate: 5,
  report_unwritten_after_attempt: 6,
  report_unwritten_after_refusal: 7,
  cancelled_sigint: 130,
  cancelled_sigterm: 143,
})

export const USAGE = `usage: node ops/backup/eanhl-backup-monitor-export.mjs --cloud-config <path> --monitor-config <path>

  Classify this host's cloud-backup freshness signal and POST it to ONE hosted
  Healthchecks.io slug check as a dead-man's-switch heartbeat. At most ONE HTTPS
  request per invocation; no retry, ever.

  NOT ACTIVATED. Nothing schedules, deploys, or invokes this command; it has no
  shebang, no executable bit, and no package script on purpose. No Healthchecks
  account, check, ping key, or notification integration has been created, and no
  human has received a test notification — so NOTHING IS MONITORED yet, and the
  signal and the report both say so in a fixed "monitored": false field.

  --cloud-config PATH     REQUIRED. Cloud configuration (see ops/backup/eanhl-backup-cloud.example.json).
  --monitor-config PATH   REQUIRED. Monitor configuration (see ops/backup/eanhl-backup-monitor.example.json).

  The two configurations are separate surfaces with separate owners and separate
  failure domains, and neither references the other.

  Exit: 0 the ping was ACCEPTED (status 200 and the exact body OK) and the whole
          report line reached stdout. READ THE REPORT'S "signal_status" FIELD —
          0 does not mean the backup is fresh;
        2 no ping attempted: invalid invocation, or --help;
        3 no ping attempted (a local refusal before the request began) — report written;
        4 ping attempted, a response head arrived, NOT accepted — report written;
        5 ping attempted, delivery INDETERMINATE (a ping may still have been
          received; exactly-once is never claimed) — report written;
        6 ping attempted, but the report line could not be written in full;
        7 no ping attempted, and the report line could not be written in full;
        130 / 143 cancelled by SIGINT / SIGTERM.

  Exits 6 and 7 mean this host has no machine-readable record of the invocation.
  The watcher is unaffected: what it observes is the ping, not the report.
`

const LINES = Object.freeze({
  usage: `${TAG} invalid invocation: --cloud-config and --monitor-config are each required exactly once; no other argument is accepted.\n`,
  cancel:
    `${TAG} cancellation requested; waiting for the ping to settle. Cancellation stops local ` +
    'work only; it does not establish that nothing reached the provider.\n',
  forced: `${TAG} second signal: exiting now. No report is written, and nothing is known about whether a ping was received.\n`,
  reportInvalid: `${TAG} internal error: the report failed its own contract and is not printed.\n`,
  stdoutFailed:
    `${TAG} internal error: the report line could not be written in full to stdout. Any bytes ` +
    'already written cannot be retracted, so no second line is attempted; treat the output as ' +
    'absent, not as a report.\n',
  notMonitored:
    `${TAG} note: nothing is monitored yet. No Healthchecks check, ping key, or notification ` +
    'integration is configured, nothing schedules this command, and no human has received a ' +
    'test notification.\n',
  cancelIncoherent: `${TAG} internal error: a cancelled ping was reported without a recorded signal name.\n`,
  orchestratorThrew:
    `${TAG} internal error: the export did not return a report. Whether a request was issued is ` +
    'unknown, and no report is written; treat this invocation as unrecorded.\n',
})

/** A bounded synchronous write of the WHOLE buffer. `true` only if every byte landed. */
function writeAllSync(fd, buf) {
  if (buf.length === 0) return true
  let offset = 0
  for (let i = 0; i < 16 && offset < buf.length; i++) {
    let n
    try {
      n = fs.writeSync(fd, buf, offset, buf.length - offset)
    } catch {
      return false
    }
    if (!Number.isSafeInteger(n) || n <= 0) return false
    offset += n
  }
  return offset === buf.length
}

export const REAL_MONITOR_EXPORT_ENTRYPOINT_DEPS = Object.freeze({
  proc: Object.freeze({
    on: (signal, listener) => {
      process.on(signal, listener)
    },
    off: (signal, listener) => {
      process.removeListener(signal, listener)
    },
    exit: (code) => process.exit(code),
  }),
  writeStdout: (buf) => writeAllSync(1, buf),
  writeStderr: (buf) => writeAllSync(2, buf),
  runMonitorExport: makeMonitorExport(REAL_MONITOR_EXPORT_DEPS).runMonitorExport,
})

/** Strict: each flag exactly once, nothing else. Never echoes an argument. */
export function parseArgs(argv) {
  if (!Array.isArray(argv)) return { kind: 'invalid' }
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { kind: 'help' }
  let cloudConfigPath = null
  let monitorConfigPath = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = argv[i + 1]
    const usable = typeof value === 'string' && value !== ''
    if (arg === '--cloud-config' && cloudConfigPath === null && usable) {
      cloudConfigPath = value
      i++
    } else if (arg === '--monitor-config' && monitorConfigPath === null && usable) {
      monitorConfigPath = value
      i++
    } else {
      return { kind: 'invalid' }
    }
  }
  if (cloudConfigPath === null || monitorConfigPath === null) return { kind: 'invalid' }
  return { kind: 'run', cloudConfigPath, monitorConfigPath }
}

/**
 * The exit status, from the REPORT and the ONE signal this process recorded.
 *
 * A recorded signal dominates the ping outcome: the operator asked for this to
 * stop, and saying "accepted" would bury that.
 */
export function exitStatusFor(report, receivedSignal) {
  const X = MONITOR_EXPORT_EXIT_CLASSES
  if (receivedSignal === 'SIGINT') return X.cancelled_sigint
  if (receivedSignal === 'SIGTERM') return X.cancelled_sigterm
  if (report.delivery === 'not_sent') return X.not_sent
  if (report.outcome === 'accepted') return X.accepted
  if (report.delivery === 'delivered') return X.delivered_unaccepted
  return X.indeterminate
}

const ENTRYPOINT_DEP_NAMES = Object.freeze(['writeStdout', 'writeStderr', 'runMonitorExport'])

export function makeMonitorExportEntrypoint(deps) {
  const bad = () => {
    throw new TypeError('invalid monitor export entrypoint dependencies')
  }
  if (deps === null || typeof deps !== 'object') return bad()
  const proc = deps.proc
  if (proc === null || typeof proc !== 'object') return bad()
  for (const name of ['on', 'off', 'exit']) if (typeof proc[name] !== 'function') return bad()
  for (const name of ENTRYPOINT_DEP_NAMES) if (typeof deps[name] !== 'function') return bad()

  // stderr is best-effort: a diagnostic that cannot be delivered changes nothing.
  const say = (text) => {
    try {
      deps.writeStderr(Buffer.from(text, 'utf8'))
    } catch {
      /* a diagnostic is never worth failing over */
    }
  }

  /** Only an explicit `true` counts as "every byte landed". */
  const wroteFully = (text) => {
    let result
    try {
      result = deps.writeStdout(Buffer.from(text, 'utf8'))
    } catch {
      return false
    }
    return result === true
  }

  async function main(argv) {
    // THE ENTRYPOINT OWNS THE ONE AbortController. The transport never creates
    // one, never installs a process-signal listener, and never calls
    // process.exit.
    const controller = new AbortController()
    let received = null

    const onSignal = (name) => {
      if (received !== null) {
        // Second signal: one synchronous bounded stderr line (well under
        // PIPE_BUF), then immediate exit. NO stdout report is attempted. The
        // code comes from the FIRST recorded signal — the process was cancelled
        // by a signal, and that is the one thing certainly known here.
        say(LINES.forced)
        deps.proc.exit(
          received === 'SIGINT'
            ? MONITOR_EXPORT_EXIT_CLASSES.cancelled_sigint
            : MONITOR_EXPORT_EXIT_CLASSES.cancelled_sigterm,
        )
        return
      }
      received = name
      controller.abort()
      // First signal: the settled result still drives the report, so this does
      // NOT exit.
      say(LINES.cancel)
    }
    const listeners = Object.freeze({
      SIGINT: () => onSignal('SIGINT'),
      SIGTERM: () => onSignal('SIGTERM'),
    })
    // Installed BEFORE any synchronous parsing, config loading, JSON parsing or
    // validation, so none of that work can be uninterruptible.
    for (const [name, listener] of Object.entries(listeners)) deps.proc.on(name, listener)
    try {
      const parsed = parseArgs(argv)
      if (parsed.kind === 'help') {
        // Usage goes to stdout, but the status is NOT 0: exit 0 is reserved for
        // an accepted ping, and --help attempts none.
        wroteFully(USAGE)
        return MONITOR_EXPORT_EXIT_CLASSES.invalid_invocation
      }
      if (parsed.kind !== 'run') {
        say(LINES.usage)
        say(USAGE)
        return MONITOR_EXPORT_EXIT_CLASSES.invalid_invocation
      }

      let outcome
      try {
        outcome = await deps.runMonitorExport({
          cloudConfigPath: parsed.cloudConfigPath,
          monitorConfigPath: parsed.monitorConfigPath,
          signal: controller.signal,
        })
      } catch {
        // The orchestrator is contracted not to throw — it catches a failing
        // config load, a throwing evaluator, a rejecting transport and a
        // breached body ceiling itself. If it throws anyway, the attempt state
        // is genuinely unknown, so 6 is chosen over 7 precisely because it does
        // NOT assert that no request was issued. It asserts only that this host
        // has no machine-readable record of the invocation.
        say(LINES.orchestratorThrew)
        return MONITOR_EXPORT_EXIT_CLASSES.report_unwritten_after_attempt
      }

      // Everything below reads the PROJECTION, never the returned object: the
      // printed line, the stdout-failure code and the exit status all come
      // from the same frozen copy that was validated.
      const report = projectExportReport(outcome?.report)
      const text = report === null ? null : serializeProjection(report)
      if (text === null) {
        say(LINES.reportInvalid)
        return MONITOR_EXPORT_EXIT_CLASSES.report_unwritten_after_attempt
      }
      if (outcome.monitorConfigCode !== null && outcome.monitorConfigCode !== undefined) {
        say(
          `${TAG} monitor configuration refused [${outcome.monitorConfigCode}]; no ping was sent.\n`,
        )
      }

      // A partial write cannot be retracted, so a failure here is reported on
      // stderr and NO SECOND STDOUT LINE IS EVER ATTEMPTED. The two codes keep
      // "a ping was attempted" and "the report survived" independent.
      if (!wroteFully(`${text}\n`)) {
        say(LINES.stdoutFailed)
        return report.delivery === 'not_sent'
          ? MONITOR_EXPORT_EXIT_CLASSES.report_unwritten_after_refusal
          : MONITOR_EXPORT_EXIT_CLASSES.report_unwritten_after_attempt
      }
      if (report.error_class === 'cancelled' && received === null) {
        // Incoherent: abort() is raised only from the signal handler, so a
        // cancelled result always carries a recorded name. The exit still comes
        // from `delivery`, which is what is actually known.
        say(LINES.cancelIncoherent)
      }
      say(LINES.notMonitored)
      return exitStatusFor(report, received)
    } finally {
      for (const [name, listener] of Object.entries(listeners)) deps.proc.off(name, listener)
    }
  }

  return Object.freeze({ main })
}
