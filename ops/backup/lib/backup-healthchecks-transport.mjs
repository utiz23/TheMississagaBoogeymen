/**
 * Healthchecks.io ping transport — THE PRODUCTION API (E3J8A).
 *
 * A thin wrapper over `internal/backup-healthchecks-transport-core.mjs`, bound
 * once, at module load, to `REAL_TRANSPORT_DEPS`. See that file's docblock for
 * the request-start boundary, the conservative delivery-evidence model, the
 * acceptance rule, the one-shot settlement discipline, and an honest statement
 * of what `delivered` does and does not mean.
 *
 * THE SANITIZED SURFACE
 * ----------------------
 * This file deliberately re-exports NEITHER the ping-key reader NOR
 * `buildPingPath()`. `buildPingPath()` is the one function that returns a
 * key-bearing string, and `internal/backup-monitor-ping-key-core.mjs` has no
 * public wrapper file at all. There is therefore no supported production import
 * path to a key-bearing value. `internal/` is a CONVENTION, not access control —
 * see the reader's docblock for exactly what that does and does not guarantee.
 *
 * Every result `pingHealthchecks()` returns is a frozen, prototype-free record
 * of closed codes, booleans, one small integer and two safe strings (the slug,
 * and `redacted` — the literal `https://hc-ping.com/<ping-key>/<slug>[/fail]`
 * with a placeholder where the key would be). No public production API here
 * returns a key-bearing value.
 *
 * NOT ACTIVATED. Nothing schedules, deploys, or invokes this. One request per
 * invocation, no retry, and no local watcher or notification code exists or is
 * planned — the watcher is Healthchecks.io's own grace timer and the channels
 * are its integrations (memo §5.2 pieces 4-5).
 */

import {
  EXPECTED_RESPONSE_BODY,
  HEALTHCHECKS_ORIGIN,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  PING_DELIVERY_STATES,
  PING_ENDPOINTS,
  PING_ERROR_CLASSES,
  PING_OUTCOME_CODES,
  REAL_TRANSPORT_DEPS,
  assertValidSlug,
  classifyResponse,
  makeHealthchecksTransport,
} from './internal/backup-healthchecks-transport-core.mjs'

export {
  HEALTHCHECKS_ORIGIN,
  PING_ENDPOINTS,
  MAX_RESPONSE_BYTES,
  MAX_REQUEST_BODY_BYTES,
  EXPECTED_RESPONSE_BODY,
  PING_OUTCOME_CODES,
  PING_DELIVERY_STATES,
  PING_ERROR_CLASSES,
  /** Pure, no I/O. The same slug rule the monitor config enforces. */
  assertValidSlug,
  /**
   * Pure, no I/O. Status and body to one closed outcome. `accepted` requires
   * status exactly 200 AND a body of exactly the bytes `OK`.
   */
  classifyResponse,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const TRANSPORT = makeHealthchecksTransport(REAL_TRANSPORT_DEPS)

/**
 * Send ONE ping, and return a frozen sanitized result.
 *
 * Reads the key file, builds the secret request path, issues at most one HTTPS
 * request, and drops the key. There is no retry and no backoff.
 *
 * `delivery: "delivered"` means only that a complete HTTP response head
 * arrived — NOT that Healthchecks recorded the heartbeat. Only
 * `outcome: "accepted"` carries that meaning, and even then exactly-once is
 * never claimed.
 *
 * @param {object} args
 * @param {object} args.monitorConfig a monitor config; re-validated inside
 * @param {'success'|'fail'} args.endpoint
 * @param {string} args.body the exact request body, already serialized
 * @param {AbortSignal} [args.signal] owned by the caller; omitted, `undefined`,
 *   or a genuine `AbortSignal`. The transport never creates one, never installs
 *   a process-signal listener, and never calls `process.exit`
 * @returns {Promise<Readonly<object>>}
 */
export function pingHealthchecks(args) {
  // `args` is caller-owned, so it is forwarded UNREAD: destructuring here would
  // run the caller's accessors and Proxy traps before any boundary. The core
  // projects it (`projectCallArgs()`) and proves the signal genuine
  // (`isGenuineAbortSignal()`) first, and turns any doubt into the sanitized
  // `local_refused` result.
  return TRANSPORT.pingHealthchecks(args)
}
