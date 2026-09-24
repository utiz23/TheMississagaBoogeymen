/**
 * eanhl-backup-monitor-export — classify this host's cloud-backup freshness
 * signal and POST it to ONE hosted Healthchecks.io slug check as a dead-man's
 * switch heartbeat, then print ONE report JSON object on stdout (E3J8A).
 *
 *   node ops/backup/eanhl-backup-monitor-export.mjs \
 *        --cloud-config <path> --monitor-config <path>
 *
 * NOT ACTIVATED, AND NOTHING IS MONITORED. Nothing schedules, deploys, or
 * invokes this command; it has no shebang, no executable bit, and no package
 * script on purpose, and there is no timer, cron entry or systemd unit anywhere
 * in this repository that references it. No Healthchecks account, check, ping
 * key, Pushover integration or e-mail integration has been created, and no
 * human has received a test notification — so memo §5.6 still stands in full:
 * "attestations are written; nobody is watching them". Both the signal and the
 * report carry a fixed `monitored: false` field that says so.
 *
 * AT MOST ONE HTTPS REQUEST PER INVOCATION. There is no retry and no backoff.
 * `delivery: "delivered"` in the report means only that a complete HTTP
 * response head arrived; it is NOT a claim that Healthchecks recorded the
 * heartbeat. Only `outcome: "accepted"` — status exactly 200 with the exact body
 * `OK` — carries that meaning, and exactly-once is never claimed.
 *
 * EXIT 0 MEANS THE PING WAS ACCEPTED, NOT THAT THE BACKUP IS FRESH. The verdict
 * is the report's `signal_status` field. See the core's `USAGE` for every code,
 * and `docs/operations/backup-monitoring-export.md` for the key-file contract,
 * the accepted ping-key risk, and the activation checklist that this checkpoint
 * deliberately does NOT run.
 *
 * This file binds the internal core ONCE to its real dependencies and passes it
 * nothing but the command-line arguments. It reads no environment variable of
 * its own, and no caller can substitute the process signal owner, the clock,
 * the config reader, the freshness evaluator, or the transport. It is the SOLE
 * owner of the one `AbortController` and of the SIGINT/SIGTERM listeners; the
 * transport creates neither and never calls `process.exit`.
 */

import {
  REAL_MONITOR_EXPORT_ENTRYPOINT_DEPS,
  makeMonitorExportEntrypoint,
} from './lib/internal/backup-monitor-export-core.mjs'

const ENTRYPOINT = makeMonitorExportEntrypoint(REAL_MONITOR_EXPORT_ENTRYPOINT_DEPS)

process.exitCode = await ENTRYPOINT.main(process.argv.slice(2))
