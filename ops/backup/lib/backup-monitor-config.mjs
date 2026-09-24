/**
 * Monitor-export configuration contract (E3J8A).
 *
 * WHOSE CONFIGURATION THIS IS
 * ---------------------------
 * This describes the off-host health-signal EMITTER's configuration — memo
 * §5.2 piece 3. It is not the producer's (`backup-config.mjs`), not the
 * destination acceptor's (`backup-acceptance-config.mjs`), and deliberately
 * not the uploader's (`backup-cloud-config.mjs`).
 *
 * It is its own file, its own validator and its own closed error vocabulary for
 * the same reasons §10.1 of
 * `docs/planning/proton-drive-cloud-transport-architecture.md` gives for
 * splitting the cloud config off in the first place: a different owner, a
 * different lifetime, and a different failure domain. A malformed monitor
 * config must never be able to stop the uploader from making or attesting a
 * backup, and a malformed cloud config must never be able to redirect a ping.
 * The entrypoint therefore takes the two paths as two separate required flags,
 * and NEITHER config surface references the other.
 *
 * SECRETS ARE KEPT OUT STRUCTURALLY, NOT BY GUESSING AT VALUES
 * -------------------------------------------------------------
 * The Healthchecks project ping key is a bearer credential. It is NEVER in
 * this file. What is in this file is the absolute path OF a file that contains
 * it, and the schema below is exactly closed — two top-level keys, three under
 * `watcher`, two under `ping`, and any unknown key at any depth rejected
 * (`config_field_unknown`). There is therefore no field an inline secret could
 * occupy. The inherited key-NAME check (`assertNoSecretShapedKeys()`, shared
 * verbatim with the cloud config) still runs, and none of the seven accepted
 * key names contains a forbidden substring.
 *
 * There is deliberately NO value-shape heuristic. "This value looks like a
 * secret" would collide with legitimate values — the slug is exactly the same
 * alphabet a key would be — and a heuristic that cannot be relied on is worse
 * than a closed schema that can.
 *
 * NO ORIGIN, HOST, PORT, SCHEME, PATH, QUERY OR THRESHOLD KEY IS ACCEPTED
 * -----------------------------------------------------------------------
 * If configuration could name the request's destination, a malformed or
 * hostile config could point the ping — and therefore the bearer key in its
 * path — at an attacker's host. So the origin is a module constant in
 * `internal/backup-healthchecks-transport-core.mjs`, exactly as E3J7's
 * approved 8 h / 24 h thresholds are module constants rather than
 * configuration: what must not be weakened silently does not live in a file an
 * operator edits.
 *
 * This module performs no I/O of its own beyond the injected `readFile`, reads
 * no environment variable, opens no socket, and never reads the key file whose
 * path it validates.
 */

import {
  ConfigError,
  fail,
  requireAbsolutePath,
  requireObject,
  requirePositiveInt,
  requireString,
} from './backup-config.mjs'
import { assertCanonicalAbsolutePath, assertNoSecretShapedKeys } from './backup-cloud-config.mjs'

/**
 * The closed provider vocabulary — one member. A second watcher provider is a
 * separate operator decision (memo §5.2 pieces 4-5) and a separate session,
 * not a configuration value someone can invent.
 */
export const MONITOR_PROVIDERS = Object.freeze(['healthchecks_io'])

/**
 * The slug alphabet Healthchecks DOCUMENTS for slug ping URLs: lowercase ASCII
 * letters, digits, underscores and hyphens. Underscores are accepted, a
 * one-character slug is accepted, and there is no first- or last-character
 * restriction — all three are part of the documented grammar.
 *
 * The `{1,64}` upper bound is NOT part of that grammar: see
 * `SLUG_MAX_LENGTH`.
 *
 * Path safety follows from the alphabet alone. It contains no `/`, `.`, `%`,
 * `?`, `#`, `@`, `:`, whitespace, NUL or uppercase character, so a `.` or `..`
 * segment is impossible, percent-encoding is never needed, and no accepted
 * slug can introduce a second path segment.
 */
export const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/

/**
 * A DELIBERATE LOCAL PROJECT RESTRICTION, not the provider's documented
 * maximum — Healthchecks publishes no slug length limit this reproduces. It
 * exists so a request path stays small and bounded; a longer legitimate slug
 * would be a local policy change, made here, not a provider incompatibility.
 */
export const SLUG_MAX_LENGTH = 64

/** Whole-exchange deadline bounds. Both ends are local policy, not provider limits. */
export const REQUEST_TIMEOUT_MS_BOUNDS = Object.freeze({ min: 1_000, max: 60_000 })

/** Connect/TLS-handshake deadline bounds. Must be strictly below the request deadline. */
export const CONNECT_TIMEOUT_MS_BOUNDS = Object.freeze({ min: 1_000, max: 30_000 })

/** The closed `ConfigError` codes a monitor-config failure may be reported by. */
export const MONITOR_CONFIG_ERROR_CODES = Object.freeze([
  'config_unreadable',
  'config_unparseable',
  'config_field_missing',
  'config_field_type',
  'config_field_invalid',
  'config_field_not_absolute',
  'config_field_not_canonical',
  'config_field_unknown',
  'config_secret_shaped_key',
])

const TOP_KEYS = Object.freeze(['watcher', 'ping'])
const WATCHER_KEYS = Object.freeze(['provider', 'slug', 'pingKeyFile'])
const PING_KEYS = Object.freeze(['requestTimeoutMs', 'connectTimeoutMs'])

/**
 * Reject any key the schema does not name, at this level.
 *
 * The offending key name IS echoed here, unlike the secret-shaped-key check —
 * and that is safe for exactly the reason the other check is not: a key name
 * that looks secret-shaped has already been rejected, generically, before this
 * runs. What is left is a plain typo an operator needs to see.
 */
function assertExactKeys(obj, expected, path) {
  for (const key of Object.keys(obj)) {
    if (!expected.includes(key)) {
      fail(
        'config_field_unknown',
        `${path} has no ${JSON.stringify(key)} key. This schema is exactly closed — it accepts ` +
          `${expected.map((k) => JSON.stringify(k)).join(', ')} and nothing else — so that no ` +
          `field exists for an inline secret, an origin, a host, a port, a scheme, a request ` +
          `path, or a threshold to occupy.`,
      )
    }
  }
}

/**
 * Validate a slug against the documented alphabet and the local length bound.
 * Throws `ConfigError`; the value IS echoed, because a slug is a check name,
 * not a credential.
 */
function requireSlug(obj, key, path) {
  const value = requireString(obj, key, path)
  if (!SLUG_PATTERN.test(value)) {
    fail(
      'config_field_invalid',
      `${path}.${key} must be 1 to ${SLUG_MAX_LENGTH} characters of lowercase ASCII letters, ` +
        `digits, underscores and hyphens (got ${JSON.stringify(value)}). The alphabet is the one ` +
        `Healthchecks documents for slug ping URLs; the ${SLUG_MAX_LENGTH}-character maximum is a ` +
        `local project restriction, not part of that documented grammar.`,
    )
  }
  return value
}

function requireBoundedMs(obj, key, path, bounds) {
  const value = requirePositiveInt(obj, key, path)
  if (value < bounds.min || value > bounds.max) {
    fail(
      'config_field_invalid',
      `${path}.${key} must be between ${bounds.min} and ${bounds.max} milliseconds inclusive ` +
        `(got ${JSON.stringify(value)}).`,
    )
  }
  return value
}

/**
 * Validate a parsed monitor-export configuration and return a frozen copy.
 *
 * @param {unknown} raw
 * @param {string} sourcePath only used to phrase errors
 * @returns {Readonly<{watcher: Readonly<{provider: string, slug: string, pingKeyFile: string}>,
 *   ping: Readonly<{requestTimeoutMs: number, connectTimeoutMs: number}>}>}
 * @throws {ConfigError} one of `MONITOR_CONFIG_ERROR_CODES`
 */
export function validateMonitorConfig(raw, sourcePath = '<monitor-config>') {
  requireObject(raw, sourcePath)
  // The generic, location-free key-NAME check first, before any field is read
  // or any value is echoed by a later diagnostic.
  assertNoSecretShapedKeys(raw)
  assertExactKeys(raw, TOP_KEYS, sourcePath)

  const watcher = requireObject(raw.watcher, `${sourcePath}.watcher`)
  assertExactKeys(watcher, WATCHER_KEYS, `${sourcePath}.watcher`)

  const provider = requireString(watcher, 'provider', `${sourcePath}.watcher`)
  if (!MONITOR_PROVIDERS.includes(provider)) {
    fail(
      'config_field_invalid',
      `${sourcePath}.watcher.provider must be one of ${MONITOR_PROVIDERS.join(', ')} ` +
        `(got ${JSON.stringify(provider)}). There is no default and no fallback provider.`,
    )
  }
  const slug = requireSlug(watcher, 'slug', `${sourcePath}.watcher`)

  // A PATH, never the key. Its contents are never read here, and nothing in
  // this module opens it. Absolute first, then the shared LEXICAL canonicality
  // rule — the same two-step order the cloud config uses, so a relative value
  // is reported as relative rather than as non-canonical. The reader that does
  // open it (`internal/backup-monitor-ping-key-core.mjs`) re-checks the path
  // itself and then re-checks the descriptor it actually got.
  const pingKeyFile = assertCanonicalAbsolutePath(
    requireAbsolutePath(watcher, 'pingKeyFile', `${sourcePath}.watcher`),
    `${sourcePath}.watcher.pingKeyFile`,
  )

  const ping = requireObject(raw.ping, `${sourcePath}.ping`)
  assertExactKeys(ping, PING_KEYS, `${sourcePath}.ping`)
  const requestTimeoutMs = requireBoundedMs(
    ping,
    'requestTimeoutMs',
    `${sourcePath}.ping`,
    REQUEST_TIMEOUT_MS_BOUNDS,
  )
  const connectTimeoutMs = requireBoundedMs(
    ping,
    'connectTimeoutMs',
    `${sourcePath}.ping`,
    CONNECT_TIMEOUT_MS_BOUNDS,
  )
  if (connectTimeoutMs >= requestTimeoutMs) {
    fail(
      'config_field_invalid',
      `${sourcePath}.ping.connectTimeoutMs (${connectTimeoutMs}) must be strictly less than ` +
        `${sourcePath}.ping.requestTimeoutMs (${requestTimeoutMs}). A connect deadline at or ` +
        `beyond the whole-exchange deadline can never fire first, so it would silently stop ` +
        `distinguishing "never connected" from "connected and then stalled".`,
    )
  }

  return Object.freeze({
    watcher: Object.freeze({ provider, slug, pingKeyFile }),
    ping: Object.freeze({ requestTimeoutMs, connectTimeoutMs }),
  })
}

/**
 * Read and validate a monitor-export configuration file.
 *
 * @param {string} path
 * @param {(p: string) => string} readFile
 */
export function loadMonitorConfig(path, readFile) {
  let text
  try {
    text = readFile(path)
  } catch (err) {
    throw new ConfigError(
      'config_unreadable',
      `could not read monitor config ${path}: ${err?.message ?? String(err)}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(
      'config_unparseable',
      `monitor config ${path} is not valid JSON: ${err?.message ?? String(err)}`,
    )
  }
  return validateMonitorConfig(parsed, path)
}
