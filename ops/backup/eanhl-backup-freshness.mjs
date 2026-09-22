/**
 * eanhl-backup-freshness — evaluate cloud-backup freshness from the
 * attestations already on this host and print ONE local health-signal JSON
 * object on stdout (E3J7).
 *
 *   node ops/backup/eanhl-backup-freshness.mjs --config <path>
 *
 * READ-ONLY and NOT ACTIVATED. It writes nothing, spawns nothing, contacts no
 * provider, and reads no credential; nothing schedules, deploys, or invokes
 * it, and it has no shebang, no executable bit, and no package script on
 * purpose.
 *
 * NOT MONITORING. Nothing exports, watches, or alerts on this signal — that is
 * E3J8 / U15. Exit 0 means a signal was produced, NOT that a backup is fresh:
 * the verdict is the JSON object's "status" field, and the absence of the
 * signal altogether is itself a critical condition that only a watcher can
 * notice.
 *
 * This file binds the internal core ONCE to its real dependencies and passes
 * it nothing but the command-line arguments. It reads no environment variable
 * of its own, and no caller can substitute the clock, the filesystem, the
 * config reader, or the evaluator. See
 * `lib/internal/backup-cloud-freshness-core.mjs` for the freshness rule,
 * output, and exit statuses, and
 * `docs/planning/proton-drive-cloud-transport-architecture.md` §5 for the
 * five separate pieces this is one of.
 */

import {
  REAL_FRESHNESS_ENTRYPOINT_DEPS,
  makeFreshnessEntrypoint,
} from './lib/internal/backup-cloud-freshness-core.mjs'

const ENTRYPOINT = makeFreshnessEntrypoint(REAL_FRESHNESS_ENTRYPOINT_DEPS)

process.exitCode = ENTRYPOINT.main(process.argv.slice(2))
