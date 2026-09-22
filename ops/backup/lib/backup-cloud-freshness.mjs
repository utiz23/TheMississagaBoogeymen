/**
 * Cloud backup freshness evaluation — THE PRODUCTION API (E3J7).
 *
 * A thin wrapper over `internal/backup-cloud-freshness-core.mjs`, bound once,
 * at module load, to `REAL_FRESHNESS_DEPS`. See that file's docblock for the
 * freshness rule, the per-record exclusion rule, the bounded streaming
 * enumeration, the bounded manifest read, and an honest statement of which
 * races are narrowed rather than closed.
 *
 * The caller supplies no filesystem dependency, clock, or directory identity
 * of any kind; a `deps` property on an argument object is inert.
 *
 * READ-ONLY. Nothing here writes, deletes, spawns, or opens a socket, and
 * nothing here contacts a provider, a credential store, a host, a database, or
 * a scheduler. This is memo §5.2 piece 2 only: the off-host export, the
 * independent watcher, and the notification channel remain U15/E3J8 operator
 * decisions. Per §5.6, until those exist the correct description is
 * "attestations are written; nobody is watching them" — which the signal
 * states as `monitored: false`.
 */

import {
  CLOUD_BINDING_FAILURE_CODES,
  CRITICAL_AFTER_SECONDS,
  FRESHNESS_ANOMALY_CODES,
  FRESHNESS_COUNT_KEYS,
  FRESHNESS_FATAL_ANOMALY_CODES,
  FRESHNESS_RECORD_ANOMALY_CODES,
  FRESHNESS_SCAN_STATES,
  FRESHNESS_SIGNAL_KIND,
  FRESHNESS_SIGNAL_SCHEMA_VERSION,
  FRESHNESS_STATUSES,
  LOCAL_MANIFEST_CEILING_BYTES,
  LOOKBACK_SECONDS,
  MAX_ATTESTATIONS_READ,
  MAX_DIRECTORY_ENTRIES,
  REAL_FRESHNESS_DEPS,
  WARNING_AFTER_SECONDS,
  drainWrite,
  makeCloudFreshness,
  projectFreshnessSignal,
  serializeFreshnessSignal,
  validateCloudAttestationBinding,
  validateFreshnessSignal,
} from './internal/backup-cloud-freshness-core.mjs'

export {
  CLOUD_BINDING_FAILURE_CODES,
  CRITICAL_AFTER_SECONDS,
  FRESHNESS_ANOMALY_CODES,
  FRESHNESS_COUNT_KEYS,
  FRESHNESS_FATAL_ANOMALY_CODES,
  FRESHNESS_RECORD_ANOMALY_CODES,
  FRESHNESS_SCAN_STATES,
  FRESHNESS_SIGNAL_KIND,
  FRESHNESS_SIGNAL_SCHEMA_VERSION,
  FRESHNESS_STATUSES,
  LOCAL_MANIFEST_CEILING_BYTES,
  LOOKBACK_SECONDS,
  MAX_ATTESTATIONS_READ,
  MAX_DIRECTORY_ENTRIES,
  WARNING_AFTER_SECONDS,
  /**
   * Pure, no I/O. The CLOUD binding rule — never `validateReceiptBinding()`,
   * never satisfied by a destination receipt (its first check is the
   * `kind` discriminator, which a receipt does not carry).
   */
  validateCloudAttestationBinding,
  /**
   * A fresh, prototype-free copy of a signal, or `null`. Nothing a caller owns
   * is ever serialized — see the core's output-projection boundary.
   */
  projectFreshnessSignal,
  /** Serialize a PROJECTION, re-checking the text it produced. `null` on any doubt. */
  serializeFreshnessSignal,
  /** The bounded write-drain loop; `true` only when every byte landed. */
  drainWrite,
  /** The closed-contract and cross-field check both of the above rely on. */
  validateFreshnessSignal,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const FRESHNESS = makeCloudFreshness(REAL_FRESHNESS_DEPS)

/**
 * Derive the local cloud-backup health signal from this host's attestations.
 *
 * Freshness is `max(source_snapshot_ts)` over attestations that are readable,
 * schema-valid, `verdict: "verified"`, and binding-valid against the
 * producer's manifest for that base. Nothing else can advance it.
 *
 * @param {object} args
 * @param {object} args.config a cloud config; re-validated inside
 * @returns {object} the deeply frozen health signal (see `FRESHNESS_STATUSES`)
 * @throws {BackupError} `cloud_freshness_invalid_input`
 */
export function evaluateCloudFreshness(args) {
  if (args === null || typeof args !== 'object') return FRESHNESS.evaluateCloudFreshness(args)
  const { config } = args
  return FRESHNESS.evaluateCloudFreshness({ config })
}
