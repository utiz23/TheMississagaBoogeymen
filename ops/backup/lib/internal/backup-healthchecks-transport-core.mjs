/**
 * The Healthchecks.io ping transport (E3J8A) — internal core.
 *
 * ONE request per invocation. No retry, no backoff, no second attempt, under
 * any condition. A dead-man's switch tolerates a lost ping: the watcher alarms
 * only after its grace period, so re-sending is never worth the risk of a
 * duplicate or of a second chance to leak.
 *
 * THE ORIGIN IS A MODULE CONSTANT, NOT CONFIGURATION
 * --------------------------------------------------
 * `https://hc-ping.com`, port 443. Nothing an operator edits can redirect this
 * request, because the request PATH carries a bearer credential: a
 * configurable origin would be a configurable place to send that credential.
 * The same reasoning keeps E3J7's approved thresholds out of configuration.
 *
 * THE SECRET SURFACE
 * -------------------
 * The ping key exists in exactly three places, all inside this file, all for
 * the duration of one request: the bytes the reader returned; the `path` string
 * built from them by `buildPingPath()`; and the `options.path` handed to
 * `request()`. It is never assigned to a module-level binding, never cached
 * across invocations, never placed in `process.env` or `argv`, and never
 * interpolated into a message, code, report, or thrown error. The reference is
 * dropped once the request has been issued.
 *
 * `buildPingPath()` is exported HERE and is deliberately NOT re-exported by
 * `lib/backup-healthchecks-transport.mjs`: it is the one function that returns
 * a key-bearing string, so it has no public production surface. Every public
 * result carries `redacted` instead — the literal
 * `https://hc-ping.com/<ping-key>/<slug>[/fail]`, with a placeholder where the
 * key would be.
 *
 * WHAT `delivered` MEANS, AND WHAT IT DOES NOT
 * ---------------------------------------------
 * `delivery: "delivered"` means ONE thing: a complete HTTP response head
 * arrived from the remote peer. It is NOT a claim that Healthchecks recorded,
 * processed, or persisted the heartbeat — a head can come from a proxy, an
 * error page, or a server that rejected the request outright. The only
 * documented provider acknowledgement is `outcome: "accepted"`: status exactly
 * 200 and a body of exactly the bytes `OK`.
 *
 * EXACTLY-ONCE IS NEVER CLAIMED. The design is at-most-one-request per
 * invocation with a possibly-unknown outcome. DNS failure, connect failure, a
 * TLS handshake failure, a write error, a reset, a timeout and a cancellation
 * are ALL `indeterminate` once execution has started: Node's socket events do
 * not reliably establish that zero bytes reached the peer, and byte-level
 * non-delivery is never inferred from them. A ping may have been received even
 * when this returns `indeterminate` and the process exits non-zero.
 *
 * `errorClass` is a DIAGNOSTIC HINT ONLY and is never evidence of
 * non-delivery. `delivery` is unaffected by its value.
 *
 * THE REQUEST-START BOUNDARY
 * ---------------------------
 * Execution starts at the moment `request(options)` is CALLED. Everything
 * strictly before that — a config, key-file, slug, endpoint or body refusal, or
 * a cancellation arriving first — is a local refusal and is the only thing that
 * may report `delivery: "not_sent"`. After the call, `not_sent` is never
 * reported again for any reason, so a synchronous throw from `request()` itself
 * and a synchronous throw from `req.end()` are both `indeterminate`. That is
 * deliberately conservative: the options object is fully validated first, so
 * neither path is expected, and neither is evidence that nothing reached the
 * peer.
 */

import https from 'node:https'
import { types as utilTypes } from 'node:util'

import { SLUG_PATTERN, SLUG_MAX_LENGTH, validateMonitorConfig } from '../backup-monitor-config.mjs'
import {
  PING_KEY_PATTERN,
  REAL_PING_KEY_DEPS,
  makePingKeyReader,
} from './backup-monitor-ping-key-core.mjs'

/** The ping origin. A MODULE CONSTANT — see the docblock. */
export const HEALTHCHECKS_ORIGIN = 'https://hc-ping.com'
const HEALTHCHECKS_HOSTNAME = 'hc-ping.com'
const HEALTHCHECKS_PORT = 443

/** The two endpoints this transport can address, and nothing else. */
export const PING_ENDPOINTS = Object.freeze(['success', 'fail'])

/** The response-body ceiling. One byte past this is `body_oversized`. */
export const MAX_RESPONSE_BYTES = 64

/** The request-body ceiling. A larger body is a LOCAL REFUSAL, never a truncation. */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024

/**
 * The DOCUMENTED provider contract: the Healthchecks.io ping-endpoint HTTP API
 * documentation (`healthchecks.io/docs/http_api/`) specifies that a successful
 * ping returns `200 OK` with the body `OK` — 2 bytes, no trailing newline.
 *
 * LIVE COMPATIBILITY IS NOT VERIFIED IN THIS CHECKPOINT: observing deployed
 * behaviour means contacting the provider, which E3J8A forbids. Confirming it
 * is a required step of the later activation test. An observed `OK\n` would NOT
 * automatically widen this constant — it would be a discrepancy between the
 * documented contract and the deployed implementation, resolved by its own
 * operator decision and recorded before any constant changes. The failure mode
 * meanwhile is safe: a mismatch is REJECTED, never falsely accepted.
 */
export const EXPECTED_RESPONSE_BODY = 'OK'

const USER_AGENT = 'eanhl-backup-monitor-export/1'
const CONTENT_TYPE = 'application/json; charset=utf-8'
const HEADER_KEYS = Object.freeze([
  'content-type',
  'content-length',
  'user-agent',
  'accept',
  'connection',
])

/** What the peer's answer was. Closed. */
export const PING_OUTCOME_CODES = Object.freeze([
  'accepted',
  'status_unexpected',
  'body_unexpected',
  'body_oversized',
  'body_truncated',
  'redirect_refused',
  'transport_error',
  'local_refused',
])

/** What is known about whether anything reached the peer. Closed. */
export const PING_DELIVERY_STATES = Object.freeze(['not_sent', 'indeterminate', 'delivered'])

/** A best-effort diagnostic hint. NEVER evidence of non-delivery. Closed. */
export const PING_ERROR_CLASSES = Object.freeze([
  'dns',
  'connect',
  'tls',
  'write',
  'reset',
  'timeout',
  'cancelled',
  'other',
])

const RESULT_KEYS = Object.freeze([
  'delivery',
  'outcome',
  'errorClass',
  'responseStatus',
  'slug',
  'endpoint',
  'redacted',
  'requestStarted',
  'requestWritten',
  'attempts',
])

/**
 * Validate a slug against the same rule the monitor config enforces, reusing
 * that module's pattern rather than restating it. Throws a fixed-message
 * `Error`; the slug is not a credential, so it is safe to echo, but there is no
 * reason to.
 */
export function assertValidSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new Error(
      `a ping slug must be 1 to ${SLUG_MAX_LENGTH} characters of lowercase ASCII letters, ` +
        'digits, underscores and hyphens',
    )
  }
  return slug
}

/**
 * Build the request path and its redacted rendering.
 *
 * `path = '/' + pingKey + '/' + slug` (+ `'/fail'`). NO query string is ever
 * appended, NO `create` or `rid` parameter exists, and the result is used
 * verbatim — the request is issued from an explicit options object, never from
 * a `URL` round-trip, so no normalization can alter it.
 *
 * INTERNAL ONLY. This is the one function that returns a key-bearing string;
 * the public wrapper re-exports it nowhere.
 *
 * @returns {Readonly<{path: string, redacted: string}>}
 */
export function buildPingPath({ pingKey, slug, endpoint } = {}) {
  if (typeof pingKey !== 'string' || !PING_KEY_PATTERN.test(pingKey)) {
    // The value is NOT echoed: it is the credential.
    throw new Error('the ping key is not of the accepted shape')
  }
  assertValidSlug(slug)
  if (!PING_ENDPOINTS.includes(endpoint)) {
    throw new Error('the ping endpoint must be "success" or "fail"')
  }
  const tail = endpoint === 'fail' ? `/${slug}/fail` : `/${slug}`
  return Object.freeze({
    path: `/${pingKey}${tail}`,
    redacted: `${HEALTHCHECKS_ORIGIN}/<ping-key>${tail}`,
  })
}

/** The redacted rendering alone, available without a key — used by local refusals. */
function redactedFor(slug, endpoint) {
  if (typeof slug !== 'string' || !PING_ENDPOINTS.includes(endpoint)) {
    return `${HEALTHCHECKS_ORIGIN}/<ping-key>/<slug>`
  }
  return `${HEALTHCHECKS_ORIGIN}/<ping-key>/${slug}${endpoint === 'fail' ? '/fail' : ''}`
}

/**
 * Classify a response head and body into one closed outcome. PURE.
 *
 * Ordering is deliberate. A redirect is refused first, before any body is
 * considered, because the `Location` header is never read at all. A non-200
 * status is then reported as `status_unexpected` even if its body also breached
 * the ceiling — a 429 is a 429, and saying so is more useful than saying its
 * error page was long. Only for a 200 do the body rules apply.
 *
 * @param {object} args
 * @param {number} args.status
 * @param {string} [args.body] the decoded body, when it was read completely
 * @param {'complete'|'oversized'|'truncated'} [args.bodyState]
 * @returns {string} one of `PING_OUTCOME_CODES`
 */
export function classifyResponse({ status, body = '', bodyState = 'complete' } = {}) {
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) return 'status_unexpected'
  if (status >= 300 && status <= 399) return 'redirect_refused'
  if (status !== 200) return 'status_unexpected'
  if (bodyState === 'oversized') return 'body_oversized'
  if (bodyState === 'truncated') return 'body_truncated'
  if (typeof body !== 'string' || body !== EXPECTED_RESPONSE_BODY) return 'body_unexpected'
  return 'accepted'
}

/**
 * Map a native error code to a closed `errorClass`. BEST EFFORT ONLY: Node's
 * codes vary by platform and TLS stack (plan unknown 4), and this value never
 * affects `delivery`.
 */
function classifyErrorCode(code) {
  if (typeof code !== 'string' || code === '') return 'other'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns'
  if (code === 'ABORT_ERR' || code === 'ERR_CANCELED') return 'cancelled'
  if (code === 'ETIMEDOUT' || code === 'ERR_SOCKET_CONNECTION_TIMEOUT') return 'timeout'
  if (code === 'ECONNRESET') return 'reset'
  if (code === 'EPIPE') return 'write'
  if (
    code === 'ECONNREFUSED' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EADDRNOTAVAIL' ||
    code === 'EACCES'
  ) {
    return 'connect'
  }
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || code.startsWith('CERT_')) {
    return 'tls'
  }
  if (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID'
  ) {
    return 'tls'
  }
  return 'other'
}

// ─────────────────────────────────────────────────────────────────────────────
// Caller-owned call arguments and signals.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE CALL-ARGUMENT PROJECTION BOUNDARY. A fresh null-prototype copy of a flat
 * argument object holding every key in `requiredKeys` and any of
 * `optionalKeys`, or `null`. Total: it never throws, and it never runs code the
 * caller owns — the same discipline as the report projection in
 * `backup-monitor-export-core.mjs`.
 *
 *   - A Proxy (revoked or live) is refused first, by `util.types.isProxy()`,
 *     which runs no trap. Only then are `Object.getPrototypeOf()`,
 *     `Reflect.ownKeys()` and `Object.getOwnPropertyDescriptor()` called, and
 *     on a non-Proxy ordinary object none of them runs user code.
 *   - The prototype must be `Object.prototype` or `null`.
 *   - Every own key must be a documented string key; a symbol or extra key is
 *     refused, never skipped. A missing required key is refused.
 *   - Every present key must be an enumerable DATA property. An accessor is
 *     refused WITHOUT being invoked.
 *
 * Only the copied values are used afterwards; the caller's object is never
 * read again. INTERNAL — shared with the export orchestrator only.
 */
export function projectCallArgs(args, requiredKeys, optionalKeys) {
  try {
    if (args === null || typeof args !== 'object') return null
    if (utilTypes.isProxy(args)) return null
    const proto = Object.getPrototypeOf(args)
    if (proto !== Object.prototype && proto !== null) return null
    for (const k of Reflect.ownKeys(args)) {
      if (typeof k !== 'string') return null
      if (!requiredKeys.includes(k) && !optionalKeys.includes(k)) return null
    }
    const out = Object.create(null)
    for (const key of [...requiredKeys, ...optionalKeys]) {
      const d = Object.getOwnPropertyDescriptor(args, key)
      if (d === undefined) {
        if (requiredKeys.includes(key)) return null
        continue
      }
      if (!Object.hasOwn(d, 'value') || d.enumerable !== true) return null
      out[key] = d.value
    }
    return out
  } catch {
    return null
  }
}

// The intrinsics a genuine signal is read through, captured once at module
// load. A signal's own or inherited `aborted`, `addEventListener` and
// `removeEventListener` are therefore never consulted.
const ABORT_SIGNAL_PROTOTYPE = AbortSignal.prototype
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener

/**
 * Whether `value` is a GENUINE `AbortSignal`, decided without running code the
 * caller owns. Total: it never throws.
 *
 *   - A Proxy is refused by `util.types.isProxy()` before anything else, so no
 *     `instanceof`, prototype read or property read can reach a trap.
 *   - The prototype must be exactly `AbortSignal.prototype` — true of every
 *     `AbortController().signal`, `AbortSignal.abort()`, `.timeout()` and
 *     `.any()` result — so the chain is intrinsics only.
 *   - Every OWN property must be a data property. A real signal carries only
 *     internal symbol-keyed data slots, so an accessor anywhere — including
 *     one planted under a slot's symbol — is refused WITHOUT being invoked.
 *   - Finally Node's native `aborted` getter brand-checks the object: it
 *     throws `ERR_INVALID_THIS` for anything that is not a real signal, such as
 *     `Object.create(AbortSignal.prototype)`.
 */
export function isGenuineAbortSignal(value) {
  try {
    if (value === null || typeof value !== 'object') return false
    if (utilTypes.isProxy(value)) return false
    if (Object.getPrototypeOf(value) !== ABORT_SIGNAL_PROTOTYPE) return false
    for (const k of Reflect.ownKeys(value)) {
      if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value')) return false
    }
    Reflect.apply(ABORTED_GETTER, value, [])
    return true
  } catch {
    return false
  }
}

/** `aborted`, read through the native getter. Only for an already-proven signal. */
function signalAborted(signal) {
  return Reflect.apply(ABORTED_GETTER, signal, []) === true
}

const PING_ARG_KEYS = Object.freeze(['monitorConfig', 'endpoint', 'body'])
const PING_OPTIONAL_ARG_KEYS = Object.freeze(['signal'])

const REQUIRED_DEPS = Object.freeze(['request', 'readPingKey', 'setTimer', 'clearTimer'])

/** The REAL dependency set. `node:https` only — no `node:http`, no `fetch`, no agent reuse. */
export const REAL_TRANSPORT_DEPS = Object.freeze({
  request: (options) => https.request(options),
  readPingKey: makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
})

/** Every result is a frozen record over exactly `RESULT_KEYS`. */
function sanitizedResult(fields) {
  const out = Object.create(null)
  for (const key of RESULT_KEYS) out[key] = fields[key]
  return Object.freeze(out)
}

/**
 * Validate the options object COMPLETELY before `request()` is called, so a
 * synchronous throw from it is not an expected path. Throws on any deviation.
 */
function assertValidRequestOptions(options, expectedBodyLength) {
  if (options === null || typeof options !== 'object') throw new Error('bad request options')
  if (options.protocol !== 'https:') throw new Error('bad request options')
  if (options.hostname !== HEALTHCHECKS_HOSTNAME) throw new Error('bad request options')
  if (options.port !== HEALTHCHECKS_PORT) throw new Error('bad request options')
  if (options.method !== 'POST') throw new Error('bad request options')
  if (options.agent !== false) throw new Error('bad request options')
  if (typeof options.path !== 'string' || !options.path.startsWith('/')) {
    throw new Error('bad request options')
  }
  const headers = options.headers
  if (headers === null || typeof headers !== 'object') throw new Error('bad request options')
  const keys = Object.keys(headers)
  if (keys.length !== HEADER_KEYS.length) throw new Error('bad request options')
  for (const key of HEADER_KEYS) if (!keys.includes(key)) throw new Error('bad request options')
  if (headers['content-type'] !== CONTENT_TYPE) throw new Error('bad request options')
  if (headers['content-length'] !== String(expectedBodyLength)) {
    throw new Error('bad request options')
  }
  if (headers['user-agent'] !== USER_AGENT) throw new Error('bad request options')
  if (headers.accept !== 'text/plain') throw new Error('bad request options')
  if (headers.connection !== 'close') throw new Error('bad request options')
}

export function makeHealthchecksTransport(deps) {
  if (deps === null || typeof deps !== 'object') {
    throw new TypeError('invalid healthchecks transport dependencies')
  }
  for (const name of REQUIRED_DEPS) {
    if (typeof deps[name] !== 'function') {
      throw new TypeError('invalid healthchecks transport dependencies')
    }
  }

  /**
   * Send ONE ping.
   *
   * @param {object} args
   * @param {object} args.monitorConfig re-validated inside
   * @param {'success'|'fail'} args.endpoint
   * @param {string} args.body the exact request body, already serialized
   * @param {AbortSignal} [args.signal] owned by the ENTRYPOINT, never created here;
   *   omitted, `undefined`, or a genuine `AbortSignal` — anything else is refused
   * @returns {Promise<Readonly<object>>} a frozen, sanitized result
   */
  async function pingHealthchecks(args) {
    // ── 0. The caller's argument object is projected, never read through; the
    //       signal is proven genuine before any of its members is touched. A
    //       refusal here precedes the key read, every timer and the request.
    const a = projectCallArgs(args, PING_ARG_KEYS, PING_OPTIONAL_ARG_KEYS)
    let slug = null
    let endpoint = a !== null && PING_ENDPOINTS.includes(a.endpoint) ? a.endpoint : null

    /** A refusal STRICTLY BEFORE `request()` — the only path that may say `not_sent`. */
    const refuse = (errorClass) =>
      sanitizedResult({
        delivery: 'not_sent',
        outcome: 'local_refused',
        errorClass,
        responseStatus: null,
        slug,
        endpoint,
        redacted: redactedFor(slug, endpoint),
        requestStarted: false,
        requestWritten: false,
        attempts: 0,
      })

    if (a === null) return refuse('other')
    // Omitted or `undefined` means "no signal"; anything else — `null` included
    // — must be a genuine `AbortSignal`. `signal` is `null` below iff absent.
    if (a.signal !== undefined && !isGenuineAbortSignal(a.signal)) return refuse('other')
    const signal = a.signal === undefined ? null : a.signal

    // ── 1. Configuration. Re-validated here: a caller cannot hand in a shape
    //       the validator would have refused.
    let cfg
    try {
      cfg = validateMonitorConfig(a.monitorConfig)
    } catch {
      return refuse('other')
    }
    slug = cfg.watcher.slug
    try {
      assertValidSlug(slug)
    } catch {
      return refuse('other')
    }
    if (endpoint === null) return refuse('other')

    // ── 2. The body, and its ceiling. Checked BEFORE the request is
    //       constructed: an oversized body is refused locally, never truncated
    //       and sent.
    if (typeof a.body !== 'string') return refuse('other')
    let buf
    try {
      buf = Buffer.from(a.body, 'utf8')
    } catch {
      return refuse('other')
    }
    if (buf.length === 0 || buf.length > MAX_REQUEST_BODY_BYTES) return refuse('other')

    // ── 3. Cancellation arriving FIRST is a local refusal.
    if (signal !== null && signalAborted(signal)) return refuse('cancelled')

    // ── 4. The key, and the secret path. Read fresh; never cached.
    let keyResult
    try {
      keyResult = deps.readPingKey(cfg.watcher.pingKeyFile)
    } catch {
      return refuse('other')
    }
    if (keyResult === null || typeof keyResult !== 'object' || keyResult.state !== 'ok') {
      return refuse('other')
    }

    let built
    try {
      built = buildPingPath({ pingKey: keyResult.key, slug, endpoint })
    } catch {
      return refuse('other')
    }
    // Only `redacted` escapes this function. `built.path` and `keyResult.key`
    // are dropped below, once the request has been issued.
    const redacted = built.redacted

    const options = {
      protocol: 'https:',
      hostname: HEALTHCHECKS_HOSTNAME,
      port: HEALTHCHECKS_PORT,
      path: built.path,
      method: 'POST',
      agent: false,
      headers: {
        'content-type': CONTENT_TYPE,
        'content-length': String(buf.length),
        'user-agent': USER_AGENT,
        accept: 'text/plain',
        connection: 'close',
      },
    }
    try {
      assertValidRequestOptions(options, buf.length)
    } catch {
      return refuse('other')
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Past this point NOTHING may report `not_sent`.
    // ═════════════════════════════════════════════════════════════════════════
    return await new Promise((resolve) => {
      let settled = false
      let requestStarted = false
      let requestWritten = false
      let headReceived = false
      let responseStatus = null
      let issued = false
      let req = null
      let connectTimer = null
      let requestTimer = null
      let cancelled = false
      let expectedLength = null
      const chunks = Buffer.alloc(MAX_RESPONSE_BYTES + 1)
      let bodyBytes = 0
      let bodyState = 'complete'
      /** Every listener installed, so settlement can remove all of them. */
      const installed = []

      const on = (emitter, event, listener) => {
        emitter.on(event, listener)
        installed.push([emitter, event, listener])
      }

      /**
       * A PERMANENT no-op `'error'` absorber, deliberately NOT in `installed`
       * and therefore never removed.
       *
       * Settlement destroys the request, and a destroyed `ClientRequest` (or its
       * `IncomingMessage`) routinely emits a further `'error'` — "socket hang
       * up", `ECONNRESET` — afterwards. An `EventEmitter` with NO `'error'`
       * listener THROWS on such an emission, which in a process would surface as
       * an `uncaughtException` and take the entrypoint down after a perfectly
       * good ping. So one listener that does nothing stays subscribed. It cannot
       * change a settled result, because it does nothing at all; the listener
       * that classifies an error is a separate one, and that one IS removed.
       */
      const absorbLateEvent = () => {}

      /**
       * ONE-SHOT settlement: clears both timers, unsubscribes every listener it
       * installed (the caller's `'abort'` listener included), destroys the
       * request once, and resolves. Late `'error'`, `'close'`, `'timeout'`,
       * `'response'` and `'abort'` events are therefore unsubscribed, and
       * cannot change a settled result.
       */
      const settle = (delivery, outcome, errorClass) => {
        if (settled) return
        settled = true
        try {
          if (connectTimer !== null) deps.clearTimer(connectTimer)
        } catch {
          /* a timer that will not clear cannot change a settled result */
        }
        try {
          if (requestTimer !== null) deps.clearTimer(requestTimer)
        } catch {
          /* as above */
        }
        connectTimer = null
        requestTimer = null
        for (const [emitter, event, listener] of installed) {
          try {
            emitter.removeListener(event, listener)
          } catch {
            /* best effort */
          }
        }
        installed.length = 0
        // The ABORT listener is removed on EVERY settlement path. The signal
        // belongs to the caller and may be long-lived and never aborted, and
        // `{ once: true }` only removes the listener if abort actually fires —
        // so without this, each invocation would leave a listener (and the
        // whole request closure) attached to that signal for its lifetime.
        // Removing a listener that was never added (a settlement before
        // installation) is a no-op, so this is idempotent.
        if (signal !== null) {
          try {
            Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', onAbort])
          } catch {
            /* a signal that will not unsubscribe cannot change a settled result */
          }
        }
        try {
          if (req !== null) req.destroy()
        } catch {
          /* already gone */
        }
        resolve(
          sanitizedResult({
            delivery,
            outcome,
            errorClass,
            responseStatus,
            slug,
            endpoint,
            redacted,
            requestStarted,
            requestWritten,
            attempts: 1,
          }),
        )
      }

      /** A head arrived, so `delivered` stands; otherwise nothing is known. */
      const settleFromState = (errorClass) => {
        if (headReceived) settle('delivered', 'body_truncated', errorClass)
        else settle('indeterminate', 'transport_error', errorClass)
      }

      function onAbort() {
        cancelled = true
        settleFromState('cancelled')
      }

      // ── Request start. `requestStarted` is set BEFORE the call, so even a
      //    synchronous throw from `request()` is after the boundary.
      requestStarted = true
      try {
        if (issued) throw new Error('one request per invocation')
        issued = true
        req = deps.request(options)
      } catch {
        return settle('indeterminate', 'transport_error', 'other')
      }
      if (req === null || typeof req !== 'object' || typeof req.on !== 'function') {
        return settle('indeterminate', 'transport_error', 'other')
      }

      // Installed only NOW: everything from the pre-start `signal.aborted`
      // check to this line is one synchronous stretch, so no abort can be
      // dispatched inside it, and a cancellation that arrives before the start
      // has already been reported as `not_sent` by `refuse('cancelled')`. If the
      // listener were installed earlier it could settle a result that claims one
      // attempt while `requestStarted` is still false — an incoherent record.
      req.on('error', absorbLateEvent)
      if (signal !== null) {
        try {
          Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', onAbort, { once: true }])
        } catch {
          return settle('indeterminate', 'transport_error', 'other')
        }
      }

      // The key and the secret path are no longer needed. Nothing below reads
      // either binding.
      built = null
      keyResult = null

      // ── The whole-exchange deadline, armed at request start.
      try {
        requestTimer = deps.setTimer(() => {
          if (settled) return
          settleFromState('timeout')
        }, cfg.ping.requestTimeoutMs)
      } catch {
        return settle('indeterminate', 'transport_error', 'other')
      }

      // ── The connect deadline, attached through `'socket'` and disarmed on
      //    `'secureConnect'`. `agent: false` guarantees a fresh socket, so
      //    `secureConnect` is always reached on a successful TLS connection. If
      //    `'socket'` never fires, the request deadline still covers the
      //    invocation.
      on(req, 'socket', (s) => {
        if (settled) return
        try {
          connectTimer = deps.setTimer(() => {
            if (settled) return
            settleFromState('timeout')
          }, cfg.ping.connectTimeoutMs)
        } catch {
          settle('indeterminate', 'transport_error', 'other')
          return
        }
        if (s !== null && typeof s === 'object' && typeof s.once === 'function') {
          const disarm = () => {
            if (connectTimer === null) return
            try {
              deps.clearTimer(connectTimer)
            } catch {
              /* best effort */
            }
            connectTimer = null
          }
          s.once('secureConnect', disarm)
          installed.push([s, 'secureConnect', disarm])
        }
      })

      on(req, 'error', (err) => {
        if (settled) return
        const cls = cancelled ? 'cancelled' : classifyErrorCode(err?.code)
        settleFromState(cls)
      })

      // Node emits `'timeout'` only when a socket timeout is configured, which
      // this transport does not do — its own two timers own every deadline. The
      // listener exists so a late or unexpected emission is guarded rather than
      // silently changing state.
      on(req, 'timeout', () => {
        if (settled) return
        settleFromState('timeout')
      })

      on(req, 'close', () => {
        if (settled) return
        settleFromState(cancelled ? 'cancelled' : 'other')
      })

      on(req, 'response', (res) => {
        if (settled) return
        headReceived = true
        const status = res?.statusCode
        responseStatus = Number.isSafeInteger(status) ? status : null

        // A redirect is refused WITHOUT reading `Location`, and without reading
        // the body at all.
        if (Number.isSafeInteger(status) && status >= 300 && status <= 399) {
          settle('delivered', 'redirect_refused', null)
          return
        }
        if (responseStatus === null) {
          settle('delivered', 'status_unexpected', null)
          return
        }

        const declared = Number(res?.headers?.['content-length'])
        expectedLength = Number.isSafeInteger(declared) && declared >= 0 ? declared : null

        const finish = () => {
          if (settled) return
          if (bodyState === 'complete' && expectedLength !== null && bodyBytes !== expectedLength) {
            bodyState = 'truncated'
          }
          // `latin1` is a byte-exact decode: it cannot introduce a replacement
          // character, so the comparison against the 2 documented bytes `OK` is
          // a comparison of bytes, not of a lossily-decoded string.
          const text =
            bodyState === 'complete' ? chunks.subarray(0, bodyBytes).toString('latin1') : ''
          settle(
            'delivered',
            classifyResponse({ status: responseStatus, body: text, bodyState }),
            null,
          )
        }

        on(res, 'data', (chunk) => {
          if (settled) return
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
          const room = MAX_RESPONSE_BYTES + 1 - bodyBytes
          if (room > 0) {
            const copied = b.copy(chunks, bodyBytes, 0, Math.min(room, b.length))
            bodyBytes += copied
          }
          if (bodyBytes > MAX_RESPONSE_BYTES) {
            // The full body is never buffered, never decoded past the ceiling,
            // and never logged.
            bodyState = 'oversized'
            settle(
              'delivered',
              classifyResponse({ status: responseStatus, bodyState: 'oversized' }),
              null,
            )
          }
        })
        res.on('error', absorbLateEvent)
        on(res, 'aborted', () => {
          if (settled) return
          bodyState = 'truncated'
          finish()
        })
        on(res, 'error', () => {
          if (settled) return
          bodyState = 'truncated'
          finish()
        })
        on(res, 'end', finish)
      })

      // ── Write the body. `'finish'` is registered before `end()`, so the
      //    completion record cannot be missed. It is RECORDED only; it never
      //    upgrades `delivery`.
      on(req, 'finish', () => {
        requestWritten = true
      })
      try {
        req.end(buf)
      } catch {
        settle('indeterminate', 'transport_error', 'other')
      }
    })
  }

  return Object.freeze({ pingHealthchecks })
}
