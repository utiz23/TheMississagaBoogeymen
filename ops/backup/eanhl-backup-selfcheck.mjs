#!/usr/bin/env node
/**
 * eanhl-backup-selfcheck — prove the producer's snapshot property against a
 * REAL PostgreSQL server, in an attested disposable database, using synthetic
 * data only.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE UNIT SUITE
 * ----------------------------------------------
 * The unit suite (ops/backup/lib/*.test.mjs) fakes the psql session, so it can
 * prove what the producer DOES with a snapshot but not that the snapshot
 * mechanism works. Three things can only be established against a real server:
 *
 *   A. `pg_dump --snapshot=<id>` really sees the exporting transaction's
 *      snapshot, so the manifest counts describe the dump even while another
 *      connection is committing rows throughout.
 *   B. That transaction's lifetime is load-bearing: once it commits or its
 *      session dies, the snapshot id is rejected by the server.
 *   C. The produced archive restores, and the restored database matches the
 *      manifest's counts, migration high-water mark and extension set.
 *
 * SAFETY
 * ------
 *   - `DATABASE_URL` is deleted from this process's environment as its first
 *     action, before any import that might read it.
 *   - Nothing destructive happens until `attestNonProductionTarget()` from
 *     apps/worker/scripts/lib/test-db-guard.mjs resolves. That is the same
 *     guard the verification harness uses: exact Compose labels, an explicit
 *     `eanhl.nonproduction=true` label, and the cluster `system_identifier`
 *     read both over the DSN and through `docker exec` and required to match.
 *   - Two databases are created, both freshly named in the approved
 *     `eanhl_scratch_*` namespace, and both dropped on every exit path. The
 *     shared `eanhl_test` seed is read for nothing and written for nothing.
 *   - All data is synthetic, generated here.
 *
 * ENCRYPTION IS SIMULATED. `age` is not installed and no keypair exists. The
 * encryption executable used below is an explicit TEST DOUBLE that prepends the
 * age header and copies the bytes. It exercises the subprocess contract —
 * argv, exit codes, output handling — and NOTHING cryptographic. Real `age`
 * integration is unverified and remains a Phase 2 item.
 *
 * Usage:
 *   set -a && . ~/.config/eanhl/verify.env && set +a
 *   node ops/backup/eanhl-backup-selfcheck.mjs
 */

// FIRST ACTION, before anything else can read it.
delete process.env.DATABASE_URL

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertApprovedDatabaseName,
  attestNonProductionTarget,
  quoteIdentifier,
} from '../../apps/worker/scripts/lib/test-db-guard.mjs'
import {
  dockerExec,
  makeNetworkSystemIdentifier,
} from '../../apps/worker/scripts/lib/real-deps.mjs'
import { validateConfig } from './lib/backup-config.mjs'
import { produceBackupArtifact, verifyArtifactCompletion } from './lib/backup-producer.mjs'
import { listContainerCommands, makeRealDeps, sha256File } from './lib/backup-boundaries.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const AGE_HEADER = 'age-encryption.org/v1'
const SEED_ROWS = 200_000

const results = []
let failures = 0
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}\n`)
  if (!ok) failures++
}
const log = (line) => process.stderr.write(`[selfcheck] ${line}\n`)

// ── attest, then and only then create anything ───────────────────────────────

const attestation = await attestNonProductionTarget({
  env: process.env,
  deps: {
    dockerExec,
    networkSystemIdentifier: makeNetworkSystemIdentifier(REPO_ROOT),
    now: () => Date.now(),
    pid: process.pid,
  },
})
log(
  `attested: container=${attestation.container} project=${attestation.project} ` +
    `service=${attestation.service} source=${attestation.sourceDatabase} ` +
    `system_identifier=${attestation.systemIdentifier}`,
)
check(
  'nonproduction attestation resolves before any mutation',
  true,
  `container ${attestation.container}`,
)

const stamp = Date.now().toString(36)
const SRC_DB = assertApprovedDatabaseName(`eanhl_scratch_bkp_${process.pid}_${stamp}`, 'clone')
const RESTORE_DB = assertApprovedDatabaseName(
  `eanhl_scratch_bkprst_${process.pid}_${stamp}`,
  'clone',
)

function psql(database, statement, { input } = {}) {
  return execFileSync(
    'docker',
    [
      'exec',
      ...(input === undefined ? [] : ['-i']),
      attestation.container,
      'psql',
      '-U',
      attestation.user,
      '-d',
      database,
      '-qAtX',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      statement,
    ],
    { encoding: 'utf8', input, maxBuffer: 1 << 28 },
  )
}
function ddl(verb, database) {
  assertApprovedDatabaseName(database, 'clone')
  const ident = quoteIdentifier(database)
  return psql(
    attestation.sourceDatabase,
    verb === 'create'
      ? `CREATE DATABASE ${ident}`
      : `DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`,
  )
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-backup-selfcheck-'))
const created = []
let writer = null

function teardown() {
  if (writer) {
    try {
      writer.kill('SIGKILL')
    } catch {
      /* gone */
    }
    writer = null
  }
  for (const db of created.splice(0)) {
    try {
      ddl('drop', db)
      log(`dropped ${db}`)
    } catch (err) {
      log(`WARN: could not drop ${db}: ${err?.message ?? String(err)}`)
    }
  }
  try {
    fs.rmSync(workDir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`received ${sig} — tearing down`)
    teardown()
    process.exit(130)
  })
}
// A stream 'error' event with no listener terminates the process outright and
// would skip the `finally` below, leaking a scratch database. Catch both.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    log(`${event}: ${err?.stack ?? String(err)}`)
    teardown()
    process.exit(1)
  })
}

/**
 * Drop scratch databases leaked by a previously hard-killed selfcheck.
 *
 * Only names this script could have produced, only in the approved namespace,
 * only with no connections, and only older than 30 minutes — so a concurrent
 * run's databases are never taken. Runs AFTER attestation, like every other
 * destructive step.
 */
const SCRATCH_NAME = /^eanhl_scratch_bkp(?:rst)?_\d+_([0-9a-z]+)$/
function sweepStaleScratch() {
  let names
  try {
    names = psql(
      attestation.sourceDatabase,
      "SELECT datname FROM pg_database d WHERE datname LIKE 'eanhl_scratch_bkp%' " +
        'AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)',
    )
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
  } catch {
    return
  }
  for (const name of names) {
    const m = SCRATCH_NAME.exec(name)
    if (!m) continue
    const created = parseInt(m[1], 36)
    if (!Number.isFinite(created) || Date.now() - created < 30 * 60 * 1000) continue
    try {
      ddl('drop', name)
      log(`swept stale scratch database ${name}`)
    } catch {
      /* leave it */
    }
  }
}

try {
  sweepStaleScratch()

  // ── synthetic fixture ──────────────────────────────────────────────────────
  ddl('drop', SRC_DB)
  ddl('create', SRC_DB)
  created.push(SRC_DB)
  psql(
    SRC_DB,
    'CREATE SCHEMA drizzle;' +
      'CREATE TABLE drizzle.__drizzle_migrations (id bigserial PRIMARY KEY, hash text NOT NULL);' +
      "INSERT INTO drizzle.__drizzle_migrations (hash) SELECT 'synthetic-' || g FROM generate_series(1, 49) g;" +
      'CREATE TABLE public.synthetic_matches (id bigserial PRIMARY KEY, game_title_id int NOT NULL, ' +
      'ea_match_id text NOT NULL, payload text NOT NULL, UNIQUE (game_title_id, ea_match_id));' +
      'CREATE TABLE public.synthetic_players (id bigserial PRIMARY KEY, gamertag text NOT NULL);' +
      'INSERT INTO public.synthetic_matches (game_title_id, ea_match_id, payload) ' +
      `SELECT 1, 'seed-' || g, repeat('x', 40) FROM generate_series(1, ${SEED_ROWS}) g;` +
      "INSERT INTO public.synthetic_players (gamertag) SELECT 'player-' || g FROM generate_series(1, 100) g;",
  )
  const seededMatches = Number(psql(SRC_DB, 'SELECT count(*) FROM public.synthetic_matches').trim())
  check(
    'synthetic fixture created in the attested disposable database',
    seededMatches === SEED_ROWS,
    `${SRC_DB}: ${seededMatches} rows`,
  )

  // ── the encryption TEST DOUBLE ─────────────────────────────────────────────
  const doublePath = path.join(workDir, 'age-test-double')
  fs.writeFileSync(
    doublePath,
    '#!/bin/sh\n' +
      '# TEST DOUBLE — not age, not encryption. Records nothing secret; copies bytes.\n' +
      '# Contract: ciphertext goes to STDOUT; the producer owns the output file.\n' +
      'for last; do :; done\n' +
      `printf '${AGE_HEADER}\\n-> X25519 test-double\\n'\n` +
      'cat "$last"\n',
    { mode: 0o755 },
  )
  const recipientFile = path.join(workDir, 'recipient.pub')
  fs.writeFileSync(recipientFile, 'age1exampledoublenotarealrecipientkey000000000000000000000000\n')

  const config = validateConfig({
    source: { container: attestation.container, database: SRC_DB, user: attestation.user },
    manifest: {
      criticalTables: ['public.synthetic_matches', 'public.synthetic_players'],
      migrations: { schema: 'drizzle', table: '__drizzle_migrations', idColumn: 'id' },
      imageRefs: null,
    },
    encryption: { executable: doublePath, recipientFile, expectedHeader: AGE_HEADER },
    staging: {
      root: path.join(workDir, 'staging'),
      minFreeBytes: 1_048_576,
      backingVolume: null,
      maxPlaintextBytes: 512 * 1024 * 1024,
      maxStagingBytes: 1024 * 1024 * 1024,
      shredPlaintext: true,
    },
    destination: { dir: path.join(workDir, 'dest'), minFreeBytes: 1_048_576, backingVolume: null },
    run: {
      lockFile: path.join(workDir, 'producer.lock'),
      lockStaleAfterMs: 600_000,
      operationTimeoutMs: 300_000,
      cancelGraceMs: 10_000,
      containerProbeTimeoutMs: 10_000,
      artifactPrefix: 'eanhl-selfcheck',
      fullArchiveReadDefault: true,
    },
  })
  const deps = makeRealDeps({ repoRoot: REPO_ROOT })

  // ── A. a concurrent writer, committing throughout the dump ────────────────
  const { spawn } = await import('node:child_process')
  writer = spawn(
    'docker',
    ['exec', '-i', attestation.container, 'psql', '-U', attestation.user, '-d', SRC_DB, '-qAtX'],
    { stdio: ['pipe', 'ignore', 'ignore'] },
  )
  // The writer is torn down abruptly on the failure paths below; an EPIPE from
  // a late interval tick is expected, not a check failure.
  writer.stdin.on('error', () => {})
  let writerRows = 0
  const pump = setInterval(() => {
    if (!writer || writer.exitCode !== null) return
    writerRows += 50
    writer.stdin.write(
      'INSERT INTO public.synthetic_matches (game_title_id, ea_match_id, payload) ' +
        `SELECT 2, 'concurrent-${writerRows}-' || g, repeat('y', 40) FROM generate_series(1, 50) g;\n`,
    )
  }, 5)

  const report = await produceBackupArtifact({
    config,
    deps,
    log,
    options: { fullArchiveRead: true },
  })

  clearInterval(pump)
  writer.stdin.end()
  await new Promise((r) => writer.on('exit', r))
  writer = null
  const finalMatches = Number(psql(SRC_DB, 'SELECT count(*) FROM public.synthetic_matches').trim())

  const snapshotCount = report.manifest.counts['public.synthetic_matches']
  check(
    'the concurrent writer actually committed during the run (otherwise the next check is vacuous)',
    finalMatches > snapshotCount,
    `snapshot count ${snapshotCount}, count after the run ${finalMatches} (+${finalMatches - snapshotCount})`,
  )
  check(
    'counts_snapshot is asserted true in the manifest',
    report.manifest.counts_snapshot === true,
  )
  check(
    'the artifact verifies as complete at the destination',
    verifyArtifactCompletion({
      dir: config.destination.dir,
      base: report.artifactBase,
      deps: { fs, sha256File },
    }).complete,
  )

  // ── C. restore the artifact and compare against its own manifest ──────────
  const cipherPath = path.join(config.destination.dir, `${report.artifactBase}.dump.age`)
  const plainPath = path.join(workDir, 'restored.dump')
  // Undo the test double: strip its two header lines. This is NOT decryption.
  const cipher = fs.readFileSync(cipherPath)
  let cut = 0
  for (let seen = 0; cut < cipher.length && seen < 2; cut++) if (cipher[cut] === 0x0a) seen++
  fs.writeFileSync(plainPath, cipher.subarray(cut))

  ddl('drop', RESTORE_DB)
  ddl('create', RESTORE_DB)
  created.push(RESTORE_DB)
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      attestation.container,
      'pg_restore',
      '-U',
      attestation.user,
      '-d',
      RESTORE_DB,
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
    ],
    { input: fs.readFileSync(plainPath), maxBuffer: 1 << 28, stdio: ['pipe', 'ignore', 'pipe'] },
  )

  const restoredMatches = Number(
    psql(RESTORE_DB, 'SELECT count(*) FROM public.synthetic_matches').trim(),
  )
  const restoredPlayers = Number(
    psql(RESTORE_DB, 'SELECT count(*) FROM public.synthetic_players').trim(),
  )
  const restoredMig = psql(
    RESTORE_DB,
    'SELECT max(id)::text FROM drizzle.__drizzle_migrations',
  ).trim()
  const restoredExt = psql(
    RESTORE_DB,
    "SELECT coalesce(string_agg(extname || ' ' || extversion, ',' ORDER BY extname), '') FROM pg_extension",
  ).trim()

  check(
    'the restored database matches the manifest count EXACTLY, not the live count',
    restoredMatches === snapshotCount && restoredMatches !== finalMatches,
    `restored ${restoredMatches}, manifest ${snapshotCount}, live at end ${finalMatches}`,
  )
  check(
    'every other critical count matches',
    restoredPlayers === report.manifest.counts['public.synthetic_players'],
    `restored ${restoredPlayers}, manifest ${report.manifest.counts['public.synthetic_players']}`,
  )
  check(
    'the migration high-water mark matches',
    restoredMig === report.manifest.migrations_max_id,
    `restored ${restoredMig}, manifest ${report.manifest.migrations_max_id}`,
  )
  check(
    'the extension set matches',
    restoredExt === report.manifest.extensions.join(','),
    `restored "${restoredExt}", manifest "${report.manifest.extensions.join(',')}"`,
  )

  // ── B. the exporting transaction's lifetime is load-bearing ───────────────
  //
  // Export a snapshot, commit, then ask pg_dump for it. The server must refuse.
  // This is what makes the producer's post-dump liveness re-probe meaningful
  // rather than decorative.
  const session = await deps.startSnapshotSession({
    container: attestation.container,
    database: SRC_DB,
    user: attestation.user,
  })
  const rows = await session.query(
    'BEGIN ISOLATION LEVEL REPEATABLE READ;\nSELECT pg_export_snapshot();',
  )
  const staleSnapshot = rows.find((r) => r !== '')
  const whileOpen = execFileSync(
    'docker',
    [
      'exec',
      attestation.container,
      'pg_dump',
      '-U',
      attestation.user,
      '-d',
      SRC_DB,
      '--format=custom',
      '--schema-only',
      `--snapshot=${staleSnapshot}`,
    ],
    { maxBuffer: 1 << 28 },
  )
  check(
    'a snapshot is usable while its transaction is open',
    whileOpen.length > 0,
    `${whileOpen.length} bytes`,
  )

  await session.query('COMMIT;')
  await session.close()
  let refused = ''
  try {
    execFileSync(
      'docker',
      [
        'exec',
        attestation.container,
        'pg_dump',
        '-U',
        attestation.user,
        '-d',
        SRC_DB,
        '--format=custom',
        '--schema-only',
        `--snapshot=${staleSnapshot}`,
      ],
      { maxBuffer: 1 << 28, stdio: ['ignore', 'ignore', 'pipe'] },
    )
  } catch (err) {
    refused = String(err?.stderr ?? '')
  }
  check(
    'the same snapshot is REJECTED once its transaction has ended',
    /invalid snapshot identifier/.test(refused),
    refused.trim().split('\n')[0] ?? '(no stderr)',
  )

  // ── failure path: a dump that fails leaves nothing behind ─────────────────
  const failDir = path.join(workDir, 'failcase')
  fs.mkdirSync(failDir, { recursive: true })
  const failConfig = validateConfig({
    source: { ...config.source },
    manifest: {
      criticalTables: [...config.manifest.criticalTables],
      migrations: { ...config.manifest.migrations },
      imageRefs: null,
    },
    encryption: { ...config.encryption },
    staging: { ...config.staging, root: path.join(failDir, 'staging'), backingVolume: null },
    destination: { ...config.destination, dir: path.join(failDir, 'dest'), backingVolume: null },
    run: { ...config.run, lockFile: path.join(failDir, 'producer.lock') },
  })
  let failCode = null
  try {
    await produceBackupArtifact({
      config: failConfig,
      log,
      deps: {
        ...deps,
        // Kill the snapshot-owning session, then let the real pg_dump try to use
        // its snapshot. The server refuses; the producer must fail and clean up.
        startSnapshotSession: async (args) => {
          const s = await deps.startSnapshotSession(args)
          const original = s.query.bind(s)
          let killedAfterExport = false
          return {
            ...s,
            query: async (sql) => {
              const out = await original(sql)
              if (!killedAfterExport && sql.includes('pg_export_snapshot')) {
                killedAfterExport = true
                s.kill()
              }
              return out
            },
            close: () => s.close(),
            kill: () => s.kill(),
          }
        },
      },
    })
  } catch (err) {
    failCode = err.code
  }
  check(
    'killing the snapshot session makes pg_dump fail rather than silently dumping a fresh snapshot',
    failCode === 'dump_failed',
    `refusal code ${failCode}`,
  )
  check(
    'the failed run left no staging directory and no lock',
    (!fs.existsSync(failConfig.staging.root) ||
      fs.readdirSync(failConfig.staging.root).length === 0) &&
      !fs.existsSync(failConfig.run.lockFile),
  )
  check(
    'the failed run published nothing',
    !fs.existsSync(failConfig.destination.dir) ||
      fs.readdirSync(failConfig.destination.dir).length === 0,
  )

  // ── the read-only container probe, against a REAL container ──────────────
  //
  // This is the mechanism that decides whether a cancelled container-side
  // command has ended. It must work against the real image (busybox `ps` in
  // postgres:16-alpine), it must never signal anything, and an operation whose
  // token is absent must read as gone.
  const inventory = await listContainerCommands({
    container: attestation.container,
    timeoutMs: 10_000,
  })
  check(
    'the read-only container probe answers against a real postgres:16-alpine container',
    Array.isArray(inventory) && inventory.some((l) => l.includes('postgres')),
    Array.isArray(inventory) ? `${inventory.length} command line(s) listed` : 'probe returned null',
  )
  check(
    'a token from a finished operation reads as gone',
    Array.isArray(inventory) && !inventory.some((l) => l.includes('--snapshot=')),
    'no pg_dump --snapshot= line remains after the runs above completed',
  )
  const missingContainerProbe = await listContainerCommands({
    container: 'eanhl-container-that-does-not-exist',
    timeoutMs: 5_000,
  })
  check(
    'a probe that cannot answer returns null (which the producer treats as "cannot confirm")',
    missingContainerProbe === null,
    `got ${JSON.stringify(missingContainerProbe)}`,
  )

  // ── the CLI, end to end, through a real config file ──────────────────────
  const cliConfigPath = path.join(workDir, 'cli-config.json')
  fs.writeFileSync(
    cliConfigPath,
    JSON.stringify({
      source: { container: attestation.container, database: SRC_DB, user: attestation.user },
      manifest: {
        criticalTables: ['public.synthetic_matches', 'public.synthetic_players'],
        migrations: { schema: 'drizzle', table: '__drizzle_migrations', idColumn: 'id' },
        imageRefs: null,
      },
      encryption: { executable: doublePath, recipientFile, expectedHeader: AGE_HEADER },
      staging: {
        root: path.join(workDir, 'cli-staging'),
        minFreeBytes: 1048576,
        backingVolume: null,
        maxPlaintextBytes: 536870912,
        maxStagingBytes: 1073741824,
        shredPlaintext: true,
      },
      destination: {
        dir: path.join(workDir, 'cli-dest'),
        minFreeBytes: 1048576,
        backingVolume: null,
      },
      run: {
        lockFile: path.join(workDir, 'cli-producer.lock'),
        lockStaleAfterMs: 600000,
        operationTimeoutMs: 300000,
        cancelGraceMs: 10000,
        containerProbeTimeoutMs: 10_000,
        artifactPrefix: 'eanhl-cli',
        fullArchiveReadDefault: false,
      },
    }),
  )
  const cli = (args) =>
    execFileSync(process.execPath, [path.join(HERE, 'eanhl-backup.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: undefined },
    })
  const dryReport = JSON.parse(cli(['--config', cliConfigPath, '--dry-run', '--json']))
  check(
    'the CLI dry run reads live counts and writes nothing',
    dryReport.dryRun === true &&
      dryReport.counts['public.synthetic_matches'] === finalMatches &&
      !fs.existsSync(path.join(workDir, 'cli-dest')) &&
      !fs.existsSync(path.join(workDir, 'cli-producer.lock')),
    `dry-run counted ${dryReport.counts['public.synthetic_matches']} (live ${finalMatches}); ` +
      `would write ${dryReport.wouldWrite.length} files`,
  )

  process.stdout.write(
    `\n${results.filter((r) => r.ok).length}/${results.length} checks passed against ${SRC_DB} ` +
      `on ${attestation.container} (system_identifier ${attestation.systemIdentifier}).\n` +
      `ENCRYPTION WAS SIMULATED WITH A TEST DOUBLE — no cryptographic property was verified.\n`,
  )
} catch (err) {
  check('selfcheck completed without an unexpected error', false, err?.stack ?? String(err))
} finally {
  teardown()
}

process.exitCode = failures === 0 ? 0 : 1
