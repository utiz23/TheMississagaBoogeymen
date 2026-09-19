/**
 * eanhl-backup-cloud — upload ONE explicitly named, already-produced backup
 * artifact to the configured cloud destination, read it back, verify it
 * independently, and durably attest every attempt (E3J6C).
 *
 *   node ops/backup/eanhl-backup-cloud.mjs --config <path> --artifact-base <base>
 *
 * NOT ACTIVATED. Nothing schedules, deploys, or invokes this command; it has
 * no shebang, no executable bit, and no package script on purpose. It has
 * only ever been exercised against a local fake Proton CLI.
 *
 * This file binds the internal entrypoint core ONCE to its real dependencies
 * and passes it nothing but the command-line arguments. It reads no
 * environment variable of its own, and no caller can substitute the process
 * signal owner, the clock, the randomness source, the pre-lock checkpoint,
 * or any other dependency. See `lib/internal/backup-cloud-entrypoint-core.mjs`
 * for signal handling, output, and the exit statuses, and
 * `docs/planning/proton-drive-cloud-transport-architecture.md` §4.7 for the
 * run lock and operator reconciliation.
 */

import {
  REAL_ENTRYPOINT_DEPS,
  makeCloudEntrypoint,
} from './lib/internal/backup-cloud-entrypoint-core.mjs'

const ENTRYPOINT = makeCloudEntrypoint(REAL_ENTRYPOINT_DEPS)

process.exitCode = await ENTRYPOINT.main(process.argv.slice(2))
