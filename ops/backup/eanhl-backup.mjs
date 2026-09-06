#!/usr/bin/env node
/**
 * eanhl-backup — produce one encrypted PostgreSQL backup artifact.
 *
 * PHASE 1A SCOPE. This command creates and validates a local artifact triple.
 * It does NOT transfer, accept, prune, alarm or restore, and it is not wired to
 * any timer. See docs/operations/backup-producer.md.
 *
 *   node ops/backup/eanhl-backup.mjs --config <path> [--dry-run]
 *                                    [--full-archive-read] [--keep-staging]
 *                                    [--json]
 *
 * `--config` is mandatory and has no default: the config names the database,
 * the container and the destination, and a defaulted one of those is how a
 * "test" run ends up dumping production somewhere it should not.
 *
 * Exit status: 0 on success, 1 on any refusal or failure. Every refusal is a
 * BackupError with a machine-readable `code` (see the ops doc's table).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fsSync from 'node:fs'

import { ConfigError, loadConfig } from './lib/backup-config.mjs'
import { BackupError, produceBackupArtifact } from './lib/backup-producer.mjs'
import { makeRealDeps } from './lib/backup-boundaries.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')

function parseArgs(argv) {
  const opts = {
    configPath: null,
    dryRun: false,
    fullArchiveRead: undefined,
    keepStaging: false,
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--config') {
      opts.configPath = argv[++i]
    } else if (arg.startsWith('--config=')) {
      opts.configPath = arg.slice('--config='.length)
    } else if (arg === '--dry-run') {
      opts.dryRun = true
    } else if (arg === '--full-archive-read') {
      opts.fullArchiveRead = true
    } else if (arg === '--no-full-archive-read') {
      opts.fullArchiveRead = false
    } else if (arg === '--keep-staging') {
      opts.keepStaging = true
    } else if (arg === '--json') {
      opts.json = true
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  return opts
}

const USAGE = `usage: eanhl-backup.mjs --config <path> [--dry-run] [--full-archive-read]
                        [--no-full-archive-read] [--keep-staging] [--json]

  --config PATH            REQUIRED. Backup configuration (see ops/backup/eanhl-backup.example.json).
  --dry-run                Validate config, preflight capacity and the encryption boundary, open the
                           snapshot transaction and read the critical counts — then commit and stop.
                           No dump, no encryption, nothing written to the destination.
  --full-archive-read      Also read the whole plaintext archive (pg_restore -f /dev/null), not just
                           its table of contents. Overrides run.fullArchiveReadDefault.
  --keep-staging           Leave the staging directory in place for inspection. The staging directory
                           contains an UNENCRYPTED full copy of the database; use only for debugging.
  --json                   Print the run report as JSON on stdout.
`

const opts = (() => {
  try {
    return parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`[eanhl-backup] ERROR: ${err.message}\n\n${USAGE}`)
    process.exit(1)
  }
})()

if (opts.help) {
  process.stdout.write(USAGE)
  process.exit(0)
}
if (!opts.configPath) {
  process.stderr.write(
    `[eanhl-backup] ERROR: --config is required (there is no default).\n\n${USAGE}`,
  )
  process.exit(1)
}

const log = (line) => process.stderr.write(`[eanhl-backup] ${line}\n`)

// ── signal handling ──────────────────────────────────────────────────────────
//
// Three layers, because a SIGINT, a second SIGINT and a SIGKILL need different
// things and only the first can do async work:
//
//   1. First signal   → producer.abort(): cancel the running children (bounded
//                       by run.cancelGraceMs), then let the producer's own
//                       `finally` clean up in order and release the lock LAST.
//                       We do NOT exit here; exiting would skip that ordering.
//   2. Escape timer /  → producer.emergency(): synchronous SIGKILL of whatever
//      second signal     is still tracked, drop staging, release the lock, exit
//                        130. A hung boundary cannot make this process
//                        unkillable.
//   3. process 'exit'  → producer.emergency() once more, for any path that
//                        reaches exit without having run it.
//
// Layer 2 cannot establish that a `docker exec`'s container-side command
// stopped; it only stops the local client. That is stated, not papered over.
let teardown = null
let loadedConfig = null
let signalled = false
let escapeTimer = null

const escapeDeadlineMs = () => (loadedConfig ? loadedConfig.run.cancelGraceMs * 2 + 5000 : 30_000)

function emergencyExit(code) {
  clearTimeout(escapeTimer)
  try {
    teardown?.emergency?.()
  } catch (err) {
    log(`WARN: emergency teardown failed: ${err?.message ?? String(err)}`)
  }
  process.exit(code)
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (signalled) {
      log(`received ${sig} again — killing everything tracked and exiting now`)
      log('NOTE: container-side pg_dump/pg_restore commands may still be running')
      emergencyExit(130)
      return
    }
    signalled = true
    log(`received ${sig} — cancelling active work, then releasing the run lock`)
    if (!teardown) {
      // Nothing started yet (config load / preflight): nothing to unwind.
      process.exit(130)
    }
    escapeTimer = setTimeout(() => {
      log(`teardown did not complete within ${escapeDeadlineMs()}ms — forcing`)
      emergencyExit(130)
    }, escapeDeadlineMs())
    escapeTimer.unref?.()
    Promise.resolve()
      .then(() => teardown.abort('operator signal'))
      .catch((err) => log(`WARN: abort failed: ${err?.message ?? String(err)}`))
  })
}

// Last resort. Only synchronous work runs here.
process.on('exit', () => {
  try {
    teardown?.emergency?.()
  } catch {
    /* nothing more can be done at this point */
  }
})

try {
  const config = loadConfig(path.resolve(opts.configPath), (p) => fsSync.readFileSync(p, 'utf8'))
  loadedConfig = config
  const deps = {
    ...makeRealDeps({ repoRoot: REPO_ROOT }),
    registerCleanup: (handle) => {
      teardown = handle
    },
  }
  const report = await produceBackupArtifact({
    config,
    deps,
    log,
    options: {
      dryRun: opts.dryRun,
      fullArchiveRead: opts.fullArchiveRead,
      keepStaging: opts.keepStaging,
    },
  })
  if (opts.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  for (const w of report.warnings ?? []) log(`WARN: ${w}`)
  log(
    report.dryRun
      ? `DRY RUN ok — artifact identity would be ${report.artifactBase}`
      : `OK — ${report.artifactBase} (${report.ciphertextBytes} bytes, sha256 ${report.ciphertextSha256}) in ${report.durationMs}ms`,
  )
  process.exitCode = 0
} catch (err) {
  const code =
    err instanceof BackupError || err instanceof ConfigError ? err.code : 'unexpected_error'
  log(`FAILED [${code}] ${err?.message ?? String(err)}`)
  if (!(err instanceof BackupError) && !(err instanceof ConfigError) && err?.stack) {
    process.stderr.write(err.stack + '\n')
  }
  // 130 when the operator interrupted us, 1 for a genuine failure. The
  // distinction is what a timer's OnFailure= handler will key on later.
  process.exitCode = signalled || code === 'run_aborted' ? 130 : 1
} finally {
  clearTimeout(escapeTimer)
}
