/**
 * Monitor-export orchestration and the report contract — THE PRODUCTION API
 * (E3J8A).
 *
 * A thin wrapper over `internal/backup-monitor-export-core.mjs`, bound once, at
 * module load, to `REAL_MONITOR_EXPORT_DEPS`. See that file's docblock for the
 * classification rule, the two body kinds, the cloud-side/monitor-side ping
 * asymmetry, and the report's cross-field contract.
 *
 * THE SANITIZED SURFACE
 * ----------------------
 * This file re-exports only closed vocabularies, pure functions over them, and
 * one bound orchestrator. It re-exports **neither the ping-key reader nor
 * `buildPingPath()`** — the two key-bearing seams — and neither a transport
 * factory nor a dependency set, so no caller can rebind the origin, the clock,
 * the config reader, the evaluator or the transport. `internal/` is a
 * CONVENTION, not access control; what that does and does not guarantee is
 * stated in the key reader's docblock.
 *
 * The report `runMonitorExport()` returns is deeply frozen and assembled from
 * string literals and closed codes only, so no path, identifier, host, URL, key
 * or free text can reach it. `validateExportReport()` and
 * `serializeExportReport()` accept ANY value, so neither reads through, nor
 * serializes, the object it is given: both work on a fresh flat projection that
 * refuses Proxies, accessors, symbol keys and extra or missing keys without
 * running any code the candidate owns.
 *
 * NOT ACTIVATED, AND NOTHING IS MONITORED. Nothing schedules, deploys, or
 * invokes this; no Healthchecks account, check, ping key or notification
 * integration exists; and no human has received a test notification. `monitored`
 * is fixed at `false` and the report validator refuses any other value — see
 * `docs/planning/proton-drive-cloud-transport-architecture.md` §5.6 and §5.7.5,
 * and `docs/operations/backup-monitoring-export.md` §9 for the activation
 * checklist this checkpoint deliberately does not run.
 */

import {
  ENDPOINT_FOR_STATUS,
  FALLBACK_FAILURE_BODY,
  MONITOR_BODY_KINDS,
  MONITOR_EXPORT_EXIT_CLASSES,
  MONITOR_EXPORT_FAILURE_KIND,
  MONITOR_EXPORT_FAILURE_SCHEMA_VERSION,
  MONITOR_EXPORT_PROVIDER,
  MONITOR_EXPORT_REPORT_KIND,
  MONITOR_EXPORT_REPORT_SCHEMA_VERSION,
  MONITOR_FAILURE_REASONS,
  REAL_MONITOR_EXPORT_DEPS,
  buildFailureBody,
  classifyFreshnessStatus,
  exitStatusFor,
  makeMonitorExport,
  serializeExportReport,
  validateExportReport,
} from './internal/backup-monitor-export-core.mjs'

export {
  MONITOR_EXPORT_REPORT_KIND,
  MONITOR_EXPORT_REPORT_SCHEMA_VERSION,
  MONITOR_EXPORT_FAILURE_KIND,
  MONITOR_EXPORT_FAILURE_SCHEMA_VERSION,
  MONITOR_EXPORT_PROVIDER,
  MONITOR_BODY_KINDS,
  MONITOR_FAILURE_REASONS,
  MONITOR_EXPORT_EXIT_CLASSES,
  /**
   * The closed status → endpoint table. Every `FRESHNESS_STATUSES` member has an
   * explicit entry, so a status added later can never default to success.
   */
  ENDPOINT_FOR_STATUS,
  /** Pure, no I/O. Anything that is not exactly `fresh` maps to `fail`. */
  classifyFreshnessStatus,
  /** Pure, no I/O. The closed failure body, literals only; never `null`. */
  buildFailureBody,
  /** The fixed compile-time body used only if even that serialization fails. */
  FALLBACK_FAILURE_BODY,
  /** Total. Whether a safe projection of the value exists; runs no accessor or trap. */
  validateExportReport,
  /** Serialize the value's fresh projection, never the value itself. `null` on any doubt. */
  serializeExportReport,
  /** Pure. The exit status, from the report and the ONE signal a process recorded. */
  exitStatusFor,
}

/** Bound ONCE, at module load, to the real dependencies. Never rebuilt, never parameterized. */
const EXPORT = makeMonitorExport(REAL_MONITOR_EXPORT_DEPS)

/**
 * Run ONE export: derive this host's freshness signal, classify it, and send at
 * most ONE ping. There is no retry.
 *
 * A CLOUD-side failure still pings `/fail` — the condition worth alarming on. A
 * MONITOR-side failure (monitor config invalid, ping key unavailable) makes a
 * request path impossible, so **nothing is sent**, `delivery` is `not_sent`, and
 * silence becomes the alarm after the watcher's grace period.
 *
 * @param {object} args
 * @param {string} args.cloudConfigPath
 * @param {string} args.monitorConfigPath
 * @param {AbortSignal} [args.signal] owned by the CALLER; omitted, `undefined`,
 *   or a genuine `AbortSignal`. This module never creates a controller, never
 *   installs a process-signal listener, and never calls `process.exit`
 * @returns {Promise<{report: Readonly<object>, monitorConfigCode: string|null}>}
 *   a deeply frozen, closed-contract report, plus the closed `ConfigError` code
 *   when a monitor-config failure is why nothing was sent. An invalid
 *   invocation REJECTS with one fixed `TypeError` before any I/O.
 */
export function runMonitorExport(args) {
  // Forwarded UNREAD, for the reason given in the transport wrapper: the core
  // projects `args` and proves the signal genuine before anything else runs.
  return EXPORT.runMonitorExport(args)
}
