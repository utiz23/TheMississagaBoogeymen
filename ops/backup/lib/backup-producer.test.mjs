/**
 * Backup producer — behavioural suite.
 *
 * These tests drive the REAL producer over a REAL temporary filesystem, with
 * only the process boundaries faked: the psql session, `pg_dump`,
 * `pg_restore`, the free-space probe, and (in most cases) the encryption
 * subprocess. What is asserted is what an operator would observe — which files
 * exist afterwards, what the manifest says, which refusal code came back — not
 * the shape of the code that produced it.
 *
 * Three properties get the most attention, because they are the ones a wrong
 * implementation would still "pass" a superficial test on:
 *
 *   1. Counts must come from the dump's own snapshot, and a run that cannot
 *      prove that must produce NO artifact. There is no downgraded manifest.
 *   2. Capacity must be judged on the volume that actually backs the staging
 *      directory. A test pins that a config which only looks at the Linux
 *      filesystem would have proceeded where the backed-volume check refuses.
 *   3. A published artifact is "complete" only if its bytes hash to what its
 *      sidecar and manifest claim. Presence of three files is not completion.
 *
 * No Docker, no PostgreSQL, no `age`, no key, no network, no production data.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateConfig } from './backup-config.mjs'
import {
  BackupError,
  acquireRunLock,
  buildArtifactNames,
  buildCountsQuery,
  buildEncryptionArgv,
  buildTableExistenceQuery,
  formatChecksumSidecar,
  formatSnapshotStamp,
  parseChecksumSidecar,
  preflightEncryption,
  produceBackupArtifact,
  verifyArtifactCompletion,
} from './backup-producer.mjs'
import { resolveExecutable, runEncryption, sha256File } from './backup-boundaries.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

// Report the active test and what is still alive if anything stalls.
installTestWatchdog({ label: 'producer' })

const SNAPSHOT_ID = '00000003-0000B219-1'
const SNAPSHOT_ISO = '2026-09-04T18:00:07Z'
const BACKEND_PID = '4242'
const TX_EPOCH = '1788577207.879956'
const SYSTEM_ID = '7412345678901234567'
const TABLES = ['public.matches', 'public.players']
const MIG_TABLE = 'drizzle.__drizzle_migrations'
const AGE_HEADER = 'age-encryption.org/v1'
const DUMP_MAGIC = 'PGDMP\x00\x01\x0e\x00'

const sandboxes = []
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-backup-test-'))
  sandboxes.push(dir)
  return dir
}
test.after(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true })
})

// ─── the world ───────────────────────────────────────────────────────────────

function makeConfig(dir, overrides = {}) {
  const base = {
    source: { container: 'eanhl-fake-db-1', database: 'eanhl_scratch_x', user: 'eanhl_test' },
    manifest: {
      criticalTables: TABLES,
      migrations: { schema: 'drizzle', table: '__drizzle_migrations', idColumn: 'id' },
      imageRefs: null,
    },
    encryption: {
      executable: `${dir}/bin/fake-age`,
      recipientFile: `${dir}/recipient.pub`,
      expectedHeader: AGE_HEADER,
    },
    staging: {
      root: `${dir}/staging`,
      minFreeBytes: 1000,
      backingVolume: { mountPoint: `${dir}/backing`, minFreeBytes: 1000 },
      maxPlaintextBytes: 100_000,
      maxStagingBytes: 500_000,
      shredPlaintext: true,
    },
    destination: { dir: `${dir}/dest`, minFreeBytes: 1000, backingVolume: null },
    run: {
      lockFile: `${dir}/producer.lock`,
      lockStaleAfterMs: 3_600_000,
      operationTimeoutMs: 5_000,
      cancelGraceMs: 500,
      containerProbeTimeoutMs: 500,
      artifactPrefix: 'eanhl-prod',
      fullArchiveReadDefault: false,
    },
  }
  const merged = structuredClone(base)
  for (const [section, patch] of Object.entries(overrides)) {
    merged[section] = { ...merged[section], ...patch }
  }
  return validateConfig(merged, '<test>')
}

/**
 * A session that models the real thing: a REPEATABLE READ transaction whose
 * `now()` is frozen at BEGIN, on a backend with a stable pid.
 */
function makeFakeSession(opts = {}) {
  const seen = []
  let killed = false
  const rows = (...lines) => [...lines, '']
  const counts = opts.counts ?? { 'public.matches': 204, 'public.players': 11 }
  const present = opts.present ?? new Set([...TABLES, MIG_TABLE])
  const session = {
    seen,
    killedRef: () => killed,
    async query(sql) {
      seen.push(sql)
      if (killed) throw new Error('psql session already exit 1. stderr: (empty)')
      if (opts.failOn && opts.failOn(sql, seen.length)) {
        throw new Error('psql session exited (exit 1) before completing the statement.')
      }
      if (sql.includes('pg_export_snapshot')) {
        return rows(
          `${opts.snapshotId ?? SNAPSHOT_ID}|${SNAPSHOT_ISO}|${TX_EPOCH}|${BACKEND_PID}|16.13|${SYSTEM_ID}`,
        )
      }
      if (sql.startsWith('SELECT pg_backend_pid()::text')) {
        return rows(opts.livenessRow ?? `${BACKEND_PID}|${TX_EPOCH}`)
      }
      if (sql.includes('to_regclass')) {
        const asked = [...sql.matchAll(/\('([a-z_.]+)'\)/g)].map((m) => m[1])
        return rows(...asked.map((t) => `${t}|${present.has(t) ? 'true' : 'false'}`))
      }
      if (sql.includes('count(*)')) {
        return rows(
          ...Object.entries(counts)
            .filter(([t]) => !(opts.omitCountFor ?? []).includes(t))
            .map(([t, n]) => `${t}|${n}`),
        )
      }
      if (sql.includes('pg_extension')) return rows('fuzzystrmatch 1.2', 'plpgsql 1.0')
      if (sql.includes('__drizzle_migrations')) return rows(opts.migrationsMaxId ?? '49')
      if (sql.startsWith('COMMIT') || sql.startsWith('ROLLBACK')) return rows()
      throw new Error(`fake session got an unexpected statement: ${sql}`)
    },
    identityToken: 'eanhl_run=test-run',
    async close() {
      return 'exited'
    },
    kill() {
      killed = true
    },
  }
  return session
}

function makeDeps(dir, config, opts = {}) {
  const logs = []
  const calls = { dump: [], validate: [], encrypt: [] }
  const session = opts.session ?? makeFakeSession(opts.sessionOpts)
  fs.mkdirSync(`${dir}/backing`, { recursive: true })
  fs.mkdirSync(`${dir}/bin`, { recursive: true })
  fs.writeFileSync(
    config.encryption.recipientFile,
    'age1qqqqqqqqzzzzzzzzexamplerecipientnotarealkey\n',
  )

  const deps = {
    now: opts.now ?? (() => 1_788_577_200_000),
    pid: opts.pid ?? 31337,
    hostname: () => 'test-host',
    randomToken: opts.randomToken ?? (() => 'abcd1234'),
    processAlive: opts.processAlive ?? (() => false),
    fs: {
      mkdirSync: fs.mkdirSync,
      readFileSync: fs.readFileSync,
      readdirSync: fs.readdirSync,
      writeFileSync: fs.writeFileSync,
      openSync: fs.openSync,
      closeSync: fs.closeSync,
      writeSync: fs.writeSync,
      existsSync: fs.existsSync,
      statSync: fs.statSync,
      renameSync: fs.renameSync,
      rmSync: fs.rmSync,
      unlinkSync: fs.unlinkSync,
      copyFileSync: opts.copyFileSync ?? fs.copyFileSync,
    },
    freeSpace: (p) => ({
      freeBytes: p.startsWith(`${dir}/backing`)
        ? (opts.backingFree ?? 1_000_000_000)
        : (opts.fsFree ?? 1_000_000_000),
      totalBytes: 1_000_000_000_000,
    }),
    resolveExecutable:
      opts.resolveExecutable ?? ((name) => (name.includes('missing') ? null : name)),
    startSnapshotSession: async (args) => {
      calls.session = args
      return session
    },
    runDump:
      opts.runDump ??
      (async ({ outPath, maxBytes }) => {
        calls.dump.push({ outPath, maxBytes })
        const body = DUMP_MAGIC + 'x'.repeat(opts.dumpBytes ?? 512)
        fs.writeFileSync(outPath, body)
        return { bytes: body.length, truncated: false }
      }),
    validateArchive:
      opts.validateArchive ??
      (async ({ mode, archivePath }) => {
        calls.validate.push({ mode, archivePath })
        return { code: 0, stdout: ';\n', stderr: '' }
      }),
    runEncryption:
      opts.runEncryption ??
      (async ({ argv, outPath, maxOutputBytes }) => {
        calls.encrypt.push({ argv, outPath, maxOutputBytes })
        const inPath = argv[argv.length - 1]
        const body = `${AGE_HEADER}\n-> X25519 fake\n` + fs.readFileSync(inPath, 'latin1')
        if (body.length > maxOutputBytes) {
          return { code: 0, stderr: '', exceeded: true, bytes: maxOutputBytes }
        }
        fs.writeFileSync(outPath, body, 'latin1')
        return { code: 0, stdout: '', stderr: '', exceeded: false, bytes: body.length }
      }),
    // Nothing of this run is left running in the container, so cancellations
    // resolve to "confirmed ended" and the lock is released.
    listContainerCommands:
      opts.listContainerCommands ?? (async () => ['postgres', 'ps -A -o args=']),
    sha256File,
    readFileHead: (p, n) => fs.readFileSync(p, 'latin1').slice(0, n),
    overwriteFile: (p, bytes) => fs.writeFileSync(p, Buffer.alloc(bytes, 0)),
    gitCommit: opts.gitCommit ?? (() => 'a'.repeat(40)),
    imageDigest: opts.imageDigest ?? (() => 'sha256:deadbeef'),
    registerCleanup: opts.registerCleanup,
  }
  return { deps, logs, calls, session, log: (l) => logs.push(l) }
}

async function run(dir, configOverrides = {}, depOpts = {}, runOptions = {}) {
  const config = makeConfig(dir, configOverrides)
  const world = makeDeps(dir, config, depOpts)
  const report = await produceBackupArtifact({
    config,
    deps: world.deps,
    log: world.log,
    options: runOptions,
  })
  return { config, report, ...world }
}

async function runExpectingFailure(dir, configOverrides = {}, depOpts = {}, runOptions = {}) {
  const config = makeConfig(dir, configOverrides)
  const world = makeDeps(dir, config, depOpts)
  let error = null
  try {
    await produceBackupArtifact({ config, deps: world.deps, log: world.log, options: runOptions })
  } catch (err) {
    error = err
  }
  assert.ok(error, 'expected the run to fail, but it succeeded')
  return { config, error, ...world }
}

// ─── pure contract ───────────────────────────────────────────────────────────

test('the snapshot stamp is the UTC snapshot instant, compacted', () => {
  assert.equal(formatSnapshotStamp('2026-09-04T18:00:07Z'), '20260904T180007Z')
  assert.equal(formatSnapshotStamp('2026-09-04T18:00:07.123456Z'), '20260904T180007Z')
  assert.throws(
    () => formatSnapshotStamp('2026-09-04 18:00:07'),
    /snapshot_timestamp_malformed|not an ISO/,
  )
})

test('artifact names all derive from one identity', () => {
  const n = buildArtifactNames('eanhl-prod', '20260904T180007Z')
  assert.equal(n.base, 'eanhl-prod-20260904T180007Z')
  assert.equal(n.ciphertext, 'eanhl-prod-20260904T180007Z.dump.age')
  assert.equal(n.checksum, 'eanhl-prod-20260904T180007Z.dump.age.sha256')
  assert.equal(n.manifest, 'eanhl-prod-20260904T180007Z.manifest.json')
})

test('the encryption argv names a RECIPIENTS file, never an identity, and no --output', () => {
  const argv = buildEncryptionArgv(
    { recipientFile: '/k/recipient.pub' },
    { executablePath: '/usr/bin/age', inPath: '/s/a.dump' },
  )
  assert.deepEqual(argv, [
    '/usr/bin/age',
    '--encrypt',
    '--recipients-file',
    '/k/recipient.pub',
    '/s/a.dump',
  ])
  assert.ok(!argv.some((a) => /identity|--decrypt|-d$/.test(a)), 'producer must never decrypt')
  assert.ok(
    !argv.includes('--output') && !argv.includes('-o'),
    'the ciphertext must come back on stdout — the producer owns the output descriptor, which is ' +
      'what makes the byte ceiling a bound rather than a measurement',
  )
})

test('count and existence queries name every required relation exactly once', () => {
  const counts = buildCountsQuery(TABLES)
  for (const t of TABLES) assert.ok(counts.includes(`'${t}'`), `${t} missing from counts query`)
  assert.equal(counts.split('UNION ALL').length, TABLES.length)
  const exist = buildTableExistenceQuery([...TABLES, MIG_TABLE])
  for (const t of [...TABLES, MIG_TABLE]) assert.ok(exist.includes(`('${t}')`))
})

test('checksum sidecars round-trip and reject anything else', () => {
  const text = formatChecksumSidecar('a'.repeat(64), 'x.dump.age')
  assert.deepEqual(parseChecksumSidecar(text), { hash: 'a'.repeat(64), filename: 'x.dump.age' })
  assert.throws(() => parseChecksumSidecar('not a checksum\n'), /checksum_sidecar_malformed|not a/)
  assert.throws(() => parseChecksumSidecar(''), /not a/)
})

// ─── the happy path, and what it proves ──────────────────────────────────────

test('a successful run publishes a complete artifact whose counts came from the dump snapshot', async () => {
  const dir = sandbox()
  const { report, config, calls } = await run(dir)

  const base = 'eanhl-prod-20260904T180007Z'
  assert.equal(report.artifactBase, base)
  assert.equal(report.snapshotTs, SNAPSHOT_ISO)

  // pg_dump was asked for the exported snapshot, not "whatever is current".
  assert.equal(calls.dump.length, 1)

  // The three files, plus latest.json, and nothing else.
  const listed = fs.readdirSync(config.destination.dir).sort()
  assert.deepEqual(listed, [
    `${base}.dump.age`,
    `${base}.dump.age.sha256`,
    `${base}.manifest.json`,
    'latest.json',
  ])

  const m = JSON.parse(fs.readFileSync(`${config.destination.dir}/${base}.manifest.json`, 'utf8'))
  assert.equal(m.counts_snapshot, true)
  assert.deepEqual(m.counts, { 'public.matches': 204, 'public.players': 11 })
  assert.equal(m.migrations_max_id, '49')
  assert.deepEqual(m.extensions, ['fuzzystrmatch 1.2', 'plpgsql 1.0'])
  assert.equal(m.source.system_identifier, SYSTEM_ID)
  assert.equal(m.source.server_version, '16.13')
  assert.equal(m.validation.pg_restore_list, 'pass')
  assert.equal(m.validation.pg_restore_full_archive_read, 'not_run')

  // No secret material anywhere in the manifest.
  const text = JSON.stringify(m)
  assert.ok(!/AGE-SECRET-KEY|PRIVATE KEY|password/i.test(text))

  // Completion is genuinely verifiable by an independent consumer.
  const verdict = verifyArtifactCompletion({
    dir: config.destination.dir,
    base,
    deps: { fs, sha256File },
  })
  assert.deepEqual(verdict.failures, [])
  assert.equal(verdict.complete, true)

  // latest.json points at the artifact BY HASH, so it can be checked not trusted.
  const latest = JSON.parse(fs.readFileSync(`${config.destination.dir}/latest.json`, 'utf8'))
  assert.equal(latest.ciphertext_sha256, m.ciphertext.sha256)
  assert.equal(latest.artifact, m.artifact)

  // Staging is gone; the lock is gone.
  assert.deepEqual(fs.readdirSync(config.staging.root), [])
  assert.equal(fs.existsSync(config.run.lockFile), false)
})

test('--full-archive-read runs the deeper check and records it', async () => {
  const dir = sandbox()
  const { calls, config } = await run(dir, {}, {}, { fullArchiveRead: true })
  assert.deepEqual(
    calls.validate.map((c) => c.mode),
    ['list', 'full'],
  )
  const base = 'eanhl-prod-20260904T180007Z'
  const m = JSON.parse(fs.readFileSync(`${config.destination.dir}/${base}.manifest.json`, 'utf8'))
  assert.equal(m.validation.pg_restore_full_archive_read, 'pass')
})

test('a rejected archive stops the run before anything is encrypted or published', async () => {
  const dir = sandbox()
  const { error, config, calls } = await runExpectingFailure(
    dir,
    {},
    {
      validateArchive: async () => ({
        code: 1,
        stdout: '',
        stderr: 'pg_restore: error: did not find magic string',
      }),
    },
  )
  assert.equal(error.code, 'archive_validation_failed')
  assert.equal(calls.encrypt.length, 0)
  assert.equal(fs.existsSync(config.destination.dir), false)
})

// ─── snapshot sharing: the property, and its refusal ─────────────────────────

test('losing the snapshot transaction during the dump fails the run and publishes nothing', async () => {
  const dir = sandbox()
  const { error, config, calls } = await runExpectingFailure(
    dir,
    {},
    {
      // A restarted backend: different pid, and a `now()` that moved.
      sessionOpts: { livenessRow: '9999|1788577999.111111' },
    },
  )
  assert.equal(error.code, 'snapshot_transaction_lost')
  assert.equal(calls.encrypt.length, 0)
  assert.equal(fs.existsSync(config.destination.dir), false)
  assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging must be cleaned up')
  assert.equal(fs.existsSync(config.run.lockFile), false, 'lock must be released')
})

test('the session dying mid-run fails the run rather than downgrading the manifest', async () => {
  const dir = sandbox()
  const { error, config } = await runExpectingFailure(
    dir,
    {},
    {
      sessionOpts: { failOn: (sql) => sql.includes('count(*)') },
    },
  )
  assert.equal(error.code, 'snapshot_session_failed')
  assert.equal(fs.existsSync(config.destination.dir), false)
})

test('a required relation that is absent fails the run — counts are not optional', async () => {
  const dir = sandbox()
  const { error } = await runExpectingFailure(
    dir,
    {},
    {
      sessionOpts: { present: new Set(['public.matches', MIG_TABLE]) },
    },
  )
  assert.equal(error.code, 'required_relation_missing')
  assert.match(error.message, /public\.players/)
})

test('a required count that does not come back fails the run', async () => {
  const dir = sandbox()
  const { error } = await runExpectingFailure(
    dir,
    {},
    {
      sessionOpts: { omitCountFor: ['public.players'] },
    },
  )
  assert.equal(error.code, 'required_count_missing')
  assert.match(error.message, /public\.players/)
})

test('no failure path can produce an artifact carrying counts_snapshot:false', async () => {
  const dir = sandbox()
  for (const [label, depOpts] of [
    ['liveness lost', { sessionOpts: { livenessRow: '9999|1' } }],
    ['session died', { sessionOpts: { failOn: (sql) => sql.includes('pg_extension') } }],
    ['relation missing', { sessionOpts: { present: new Set(['public.matches']) } }],
  ]) {
    const sub = fs.mkdtempSync(path.join(dir, 'case-'))
    const { config } = await runExpectingFailure(sub, {}, depOpts)
    const produced = fs.existsSync(config.destination.dir)
      ? fs.readdirSync(config.destination.dir)
      : []
    assert.deepEqual(produced, [], `${label} produced files at the destination`)
  }
})

// ─── capacity: BOTH layers ───────────────────────────────────────────────────

test('a full backing volume refuses the run even when the Linux filesystem looks empty', async () => {
  const dir = sandbox()
  const depOpts = { fsFree: 1_000_000_000, backingFree: 10 }

  // Same numbers, backing volume declared: refused.
  const { error, config } = await runExpectingFailure(dir, {}, depOpts)
  assert.equal(error.code, 'insufficient_capacity')
  assert.match(error.message, /backing volume/)
  assert.equal(fs.existsSync(config.destination.dir), false)

  // Same numbers, backing volume declared as null: proceeds. This is the whole
  // point of the WSL correction — `df /` on a sparse VHDX is not the truth, and
  // only the declaration makes the difference.
  const sub = fs.mkdtempSync(path.join(dir, 'nullbacking-'))
  const { report } = await run(sub, { staging: { backingVolume: null } }, depOpts)
  assert.equal(report.artifactBase, 'eanhl-prod-20260904T180007Z')
})

test('capacity is re-checked with the real artifact size before the ciphertext is written', async () => {
  const dir = sandbox()
  // Enough headroom for the preflight floor, not enough to hold plaintext twice.
  const { error, calls } = await runExpectingFailure(
    dir,
    {},
    {
      fsFree: 1500,
      backingFree: 1_000_000_000,
      dumpBytes: 900,
    },
  )
  assert.equal(error.code, 'insufficient_capacity')
  assert.match(error.message, /ciphertext beside the plaintext/)
  assert.equal(calls.encrypt.length, 0)
})

test('a dump larger than the configured ceiling is stopped and fails the run', async () => {
  const dir = sandbox()
  const { error, config } = await runExpectingFailure(
    dir,
    {},
    {
      runDump: async ({ outPath }) => {
        fs.writeFileSync(outPath, 'x'.repeat(1024))
        return { bytes: 10_000_000, truncated: true }
      },
    },
  )
  assert.equal(error.code, 'staging_budget_exceeded')
  assert.match(error.message, /not a guarantee/)
  assert.deepEqual(fs.readdirSync(config.staging.root), [])
})

test('staging is removed and the lock released on every failure path', async () => {
  const dir = sandbox()
  const cases = [
    [
      'dump failure',
      {
        runDump: async () => {
          throw new Error('pg_dump exited 1: connection lost')
        },
      },
    ],
    [
      'encryption failure',
      { runEncryption: async () => ({ code: 2, stdout: '', stderr: 'boom' }) },
    ],
    [
      'validation failure',
      { validateArchive: async () => ({ code: 1, stdout: '', stderr: 'bad magic' }) },
    ],
  ]
  for (const [label, depOpts] of cases) {
    const sub = fs.mkdtempSync(path.join(dir, 'cleanup-'))
    const { config } = await runExpectingFailure(sub, {}, depOpts)
    assert.deepEqual(fs.readdirSync(config.staging.root), [], `${label}: staging not cleaned`)
    assert.equal(fs.existsSync(config.run.lockFile), false, `${label}: lock not released`)
  }
})

test('the forced synchronous teardown retains the lock, because it can confirm nothing', async () => {
  const dir = sandbox()
  let handle = null
  const config = makeConfig(dir)
  const world = makeDeps(dir, config, {
    registerCleanup: (h) => {
      handle = h
    },
    // Hang the run at the dump, the way a signal would arrive mid-dump.
    runDump: () => new Promise(() => {}),
  })
  const pending = produceBackupArtifact({ config, deps: world.deps, log: world.log })
  pending.catch(() => {})
  await new Promise((r) => setTimeout(r, 30))

  assert.ok(fs.existsSync(config.run.lockFile), 'lock should be held mid-run')
  assert.ok(fs.readdirSync(config.staging.root).length > 0, 'staging should exist mid-run')

  assert.equal(typeof handle?.abort, 'function', 'producer must register an async abort')
  assert.equal(typeof handle?.emergency, 'function', 'producer must register a sync teardown')

  // The synchronous path is the SIGKILL / `process.on("exit")` last resort. It
  // cannot await anything and cannot run the container probe, so it must NOT
  // give up exclusion: the snapshot session is a docker-exec child whose
  // container-side fate is unknown.
  handle.emergency()
  assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging must be dropped')
  assert.equal(world.session.killedRef(), true, 'the snapshot session must be killed')

  assert.ok(fs.existsSync(config.run.lockFile), 'the lock must be RETAINED, not released')
  const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
  assert.equal(held.retained, true)
  assert.match(held.reason, /forced synchronous teardown/)
  assert.match(held.recovery, /rm /)
  assert.ok(
    held.unconfirmed.some((u) => u.kind === 'docker-exec'),
    `expected a docker-exec entry, got ${JSON.stringify(held.unconfirmed)}`,
  )
})

test('a retained lock refuses the next producer with the recorded reason', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.writeFileSync(
    config.run.lockFile,
    JSON.stringify({
      runId: 'earlier',
      pid: 4242,
      host: 'test-host',
      startedAt: 1_788_570_000_000,
      retained: true,
      retainedAt: '2026-09-05T04:00:00.000Z',
      reason: 'could not confirm that 1 operation(s) this run started had stopped',
      unconfirmed: [
        { label: 'pg_dump', kind: 'docker-exec', outcome: 'killed, probe unavailable' },
      ],
      recovery: 'RECOVERY: ... rm /tmp/x.lock',
    }),
  )
  // Alive or dead, a retained lock is refused the same way: the recorded
  // uncertainty is about the WORK, not about the process that started it.
  for (const alive of [true, false]) {
    const { error } = await runExpectingFailure(dir, {}, { processAlive: () => alive })
    assert.equal(error.code, 'lock_retained_uncertain')
    assert.match(error.message, /could not confirm/)
    assert.match(error.message, /pg_dump \[docker-exec\]/)
    assert.match(error.message, /RECOVERY/)
  }
})

test('an aborted run reports run_aborted rather than the symptom cancellation produced', async () => {
  const dir = sandbox()
  let handle = null
  const config = makeConfig(dir)
  let rejectDump = null
  const world = makeDeps(dir, config, {
    registerCleanup: (h) => {
      handle = h
    },
    runDump: () =>
      new Promise((_, rej) => {
        rejectDump = rej
      }),
  })
  const pending = produceBackupArtifact({ config, deps: world.deps, log: world.log })
  let error = null
  pending.catch((err) => {
    error = err
  })
  await new Promise((r) => setTimeout(r, 30))

  await handle.abort('test signal')
  rejectDump(new Error('pg_dump killed'))
  await new Promise((r) => setTimeout(r, 40))

  assert.equal(error?.code, 'run_aborted', `got ${error?.code}: ${error?.message}`)
  assert.match(error.message, /pg_dump killed/, 'the underlying cause must still be visible')
  assert.equal(fs.existsSync(config.run.lockFile), false)
  assert.deepEqual(fs.readdirSync(config.staging.root), [])
})

// ─── encryption boundary ─────────────────────────────────────────────────────

test('a missing encryption executable refuses the run — there is no plaintext fallback', async () => {
  const dir = sandbox()
  const { error, config, calls } = await runExpectingFailure(dir, {
    encryption: { executable: 'age-that-is-missing' },
  })
  assert.equal(error.code, 'encryption_executable_missing')
  assert.equal(calls.dump.length, 0, 'nothing should be dumped before the boundary is proven')
  assert.equal(fs.existsSync(config.destination.dir), false)
})

test('a missing, empty or non-key recipients file refuses the run', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const { deps } = makeDeps(dir, config)

  fs.rmSync(config.encryption.recipientFile)
  assert.throws(
    () => preflightEncryption({ config, deps }),
    (e) => e.code === 'recipient_file_unreadable',
  )

  fs.writeFileSync(config.encryption.recipientFile, '# only a comment\n\n')
  assert.throws(
    () => preflightEncryption({ config, deps }),
    (e) => e.code === 'recipient_file_empty',
  )

  fs.writeFileSync(config.encryption.recipientFile, 'AGE-SECRET-KEY-1EXAMPLE\n')
  assert.throws(
    () => preflightEncryption({ config, deps }),
    (e) => e.code === 'recipient_file_malformed',
    'a private key pasted where a recipient belongs must be refused',
  )

  fs.writeFileSync(config.encryption.recipientFile, 'age1abcdef\nssh-ed25519 AAAAC3Nz user@host\n')
  const ok = preflightEncryption({ config, deps })
  assert.equal(ok.recipientCount, 2)
  assert.match(ok.recipientFingerprint, /^[0-9a-f]{64}$/)
})

test('a non-zero exit from the encryption tool refuses the run', async () => {
  const dir = sandbox()
  const { error, config } = await runExpectingFailure(
    dir,
    {},
    {
      runEncryption: async () => ({ code: 1, stdout: '', stderr: 'age: error: no recipients' }),
    },
  )
  assert.equal(error.code, 'encryption_failed')
  assert.match(error.message, /no recipients/)
  assert.equal(fs.existsSync(config.destination.dir), false)
})

test('an encryption tool that exits 0 but writes nothing refuses the run', async () => {
  const dir = sandbox()
  const { error } = await runExpectingFailure(
    dir,
    {},
    {
      runEncryption: async () => ({ code: 0, stdout: '', stderr: '' }),
    },
  )
  assert.equal(error.code, 'encryption_produced_no_output')
})

test('an encryption tool that just copies the plaintext through refuses the run', async () => {
  const dir = sandbox()
  const { error } = await runExpectingFailure(
    dir,
    {},
    {
      runEncryption: async ({ argv, outPath }) => {
        fs.copyFileSync(argv[argv.length - 1], outPath)
        return { code: 0, stdout: '', stderr: '', exceeded: false, bytes: 0 }
      },
    },
  )
  // The header check fires first; either refusal is correct, neither publishes.
  assert.ok(
    ['ciphertext_header_unexpected', 'ciphertext_equals_plaintext'].includes(error.code),
    error.code,
  )
})

test('output that does not carry the configured header refuses the run', async () => {
  const dir = sandbox()
  const { error } = await runExpectingFailure(
    dir,
    {},
    {
      runEncryption: async ({ outPath }) => {
        fs.writeFileSync(outPath, 'NOT-AGE\nsome bytes')
        return { code: 0, stdout: '', stderr: '', exceeded: false, bytes: 0 }
      },
    },
  )
  assert.equal(error.code, 'ciphertext_header_unexpected')
})

// ─── the SUBPROCESS contract, driven through the real boundary ───────────────
//
// `age` is not installed and no key exists in this environment, so these use an
// explicit test double invoked through the REAL spawn boundary. That exercises
// argv, exit codes and output handling. It is NOT a cryptographic verification
// and must never be reported as one.

function writeDouble(dir, name, body) {
  const p = path.join(dir, 'bin', name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return p
}

test('the real spawn boundary hands the double exactly the argv the producer built', async () => {
  const dir = sandbox()
  const recordPath = `${dir}/argv.txt`
  const exe = writeDouble(
    dir,
    'recording-age',
    `printf '%s\\n' "$@" > ${recordPath}\n` +
      `printf '${AGE_HEADER}\\n-> X25519 double\\n'\n` +
      `for last; do :; done\n` +
      `cat "$last"`,
  )
  fs.writeFileSync(`${dir}/plain.dump`, 'PGDMP payload')
  const argv = buildEncryptionArgv(
    { recipientFile: `${dir}/r.pub` },
    { executablePath: exe, inPath: `${dir}/plain.dump` },
  )
  const outPath = `${dir}/out.age`
  const result = await runEncryption({ argv, outPath, maxOutputBytes: 1_000_000 })
  assert.equal(result.code, 0)
  assert.equal(result.exceeded, false)
  assert.deepEqual(fs.readFileSync(recordPath, 'utf8').trim().split('\n'), [
    '--encrypt',
    '--recipients-file',
    `${dir}/r.pub`,
    `${dir}/plain.dump`,
  ])
  // The producer, not the tool, created the file.
  assert.ok(fs.readFileSync(outPath, 'utf8').startsWith(AGE_HEADER))
  assert.match(fs.readFileSync(outPath, 'utf8'), /PGDMP payload/)
})

test('the real spawn boundary reports a double that fails, and resolveExecutable finds/misses honestly', async () => {
  const dir = sandbox()
  const exe = writeDouble(
    dir,
    'failing-age',
    'echo "age: error: failed to open recipient file" >&2; exit 3',
  )
  const result = await runEncryption({
    argv: [exe, '--encrypt'],
    outPath: `${dir}/out.age`,
    maxOutputBytes: 1000,
  })
  assert.equal(result.code, 3)
  assert.match(result.stderr, /failed to open recipient file/)

  assert.equal(resolveExecutable(exe), exe)
  assert.equal(resolveExecutable(`${dir}/bin/not-here`), null)
  assert.equal(resolveExecutable('a-command-that-does-not-exist-eanhl'), null)
  // A non-executable file must not resolve; a bad mode is a real misconfiguration.
  fs.writeFileSync(`${dir}/bin/not-exec`, 'x', { mode: 0o644 })
  assert.equal(resolveExecutable(`${dir}/bin/not-exec`), null)
})

test('a real double drives a complete run end to end through the spawn boundary', async () => {
  const dir = sandbox()
  const exe = writeDouble(
    dir,
    'fake-age',
    `printf '${AGE_HEADER}\\n-> X25519 double\\n'\nfor last; do :; done\ncat "$last"`,
  )
  const config = makeConfig(dir, { encryption: { executable: exe } })
  const world = makeDeps(dir, config, { resolveExecutable, runEncryption })
  const report = await produceBackupArtifact({ config, deps: world.deps, log: world.log })
  const verdict = verifyArtifactCompletion({
    dir: config.destination.dir,
    base: report.artifactBase,
    deps: { fs, sha256File },
  })
  assert.equal(verdict.complete, true, verdict.failures.join('; '))
  assert.notEqual(report.manifest.ciphertext.sha256, report.manifest.plaintext.sha256)
})

// ─── duplicate runs ──────────────────────────────────────────────────────────

test('a live lock holder blocks a second producer', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.writeFileSync(
    config.run.lockFile,
    JSON.stringify({ runId: 'other', pid: 777, host: 'test-host', startedAt: 1_788_577_190_000 }),
  )
  const { error } = await runExpectingFailure(dir, {}, { processAlive: () => true })
  assert.equal(error.code, 'concurrent_run')
  assert.match(error.message, /pid 777/)
  // The other run's lock is left exactly as it was.
  assert.equal(JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8')).runId, 'other')
})

test('a live holder older than lockStaleAfterMs is reported as a probable hang, still refused', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.writeFileSync(
    config.run.lockFile,
    JSON.stringify({ runId: 'stuck', pid: 777, host: 'test-host', startedAt: 1_788_500_000_000 }),
  )
  const { error } = await runExpectingFailure(dir, {}, { processAlive: () => true })
  assert.equal(error.code, 'concurrent_run_hung')
  assert.match(error.message, /probably hung/)
})

test('a lock whose holder is gone is REFUSED, never reclaimed', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const stale = JSON.stringify({
    runId: 'crashed',
    pid: 4242,
    host: 'test-host',
    startedAt: 1_788_570_000_000,
  })
  fs.writeFileSync(config.run.lockFile, stale)

  const { error } = await runExpectingFailure(dir, {}, { processAlive: () => false })
  assert.equal(error.code, 'lock_stale')
  assert.match(error.message, /NEVER reclaimed automatically/)
  assert.ok(
    error.message.includes(`rm ${config.run.lockFile}`),
    'must tell the operator what to do',
  )
  assert.equal(
    fs.readFileSync(config.run.lockFile, 'utf8'),
    stale,
    'a stale lock must be left byte-identical for the operator to inspect',
  )
})

test('REGRESSION: two producers facing one stale lock both refuse, and nothing is unlinked', () => {
  // The defect this pins: A reads the dead holder, B reads the dead holder, A
  // unlinks it and creates A's lock, B then unlinks *A's live lock* and creates
  // B's. Both believe they hold it. The fix removes reclamation entirely, so
  // the structural evidence is that ZERO unlinks happen on any refusal path —
  // there is no window left for an interleaving to exploit.
  const dir = sandbox()
  const config = makeConfig(dir)
  const stale = JSON.stringify({
    runId: 'crashed',
    pid: 4242,
    host: 'test-host',
    startedAt: 1_788_570_000_000,
  })
  fs.writeFileSync(config.run.lockFile, stale)

  const unlinked = []
  const attempt = (runId) => {
    const { deps } = makeDeps(dir, config, { processAlive: () => false })
    const spy = {
      ...deps,
      fs: {
        ...deps.fs,
        unlinkSync: (target) => {
          unlinked.push(target)
          return fs.unlinkSync(target)
        },
      },
    }
    try {
      acquireRunLock({ config, deps: spy, runId, log: () => {} })
      return 'acquired'
    } catch (err) {
      return err.code
    }
  }

  const a = attempt('producer-a')
  const b = attempt('producer-b')

  assert.deepEqual([a, b], ['lock_stale', 'lock_stale'], 'neither producer may win a stale lock')
  assert.deepEqual(unlinked, [], 'no refusal path may unlink a lock file')
  assert.equal(fs.readFileSync(config.run.lockFile, 'utf8'), stale)
})

test('REGRESSION: a live lock is never removed by a second producer', () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const { deps } = makeDeps(dir, config, { processAlive: () => false })

  const lockA = acquireRunLock({ config, deps, runId: 'producer-a', log: () => {} })
  const liveLock = fs.readFileSync(config.run.lockFile, 'utf8')
  assert.match(liveLock, /producer-a/)

  // B arrives while A is alive, then again believing A is gone. Neither may
  // touch the file — the second case is exactly the interleaving that let the
  // old reclamation delete a live lock.
  const unlinked = []
  const spy = (alive) => {
    const d = makeDeps(dir, config, { processAlive: () => alive }).deps
    return {
      ...d,
      fs: {
        ...d.fs,
        unlinkSync: (target) => {
          unlinked.push(target)
          return fs.unlinkSync(target)
        },
      },
    }
  }
  for (const [alive, expected] of [
    [true, 'concurrent_run'],
    [false, 'lock_stale'],
  ]) {
    let code = 'acquired'
    try {
      acquireRunLock({ config, deps: spy(alive), runId: 'producer-b', log: () => {} })
    } catch (err) {
      code = err.code
    }
    assert.equal(code, expected)
    assert.equal(fs.readFileSync(config.run.lockFile, 'utf8'), liveLock, "A's lock was modified")
  }
  assert.deepEqual(unlinked, [])

  lockA.release()
  assert.equal(fs.existsSync(config.run.lockFile), false, 'the owner must be able to release')
})

test('a lock from another host is never broken automatically', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.writeFileSync(
    config.run.lockFile,
    JSON.stringify({ runId: 'x', pid: 1, host: 'some-other-host', startedAt: 1 }),
  )
  const { error } = await runExpectingFailure(dir, {}, { processAlive: () => false })
  assert.equal(error.code, 'lock_foreign_host')
})

test('an unreadable lock is a refusal, not a guess', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.writeFileSync(config.run.lockFile, 'this is not json')
  const { error } = await runExpectingFailure(dir)
  assert.equal(error.code, 'lock_unreadable')
  assert.equal(fs.readFileSync(config.run.lockFile, 'utf8'), 'this is not json')
})

test('releasing a lock that another run has taken over does not delete theirs', () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const { deps } = makeDeps(dir, config)
  const lock = acquireRunLock({ config, deps, runId: 'mine', log: () => {} })
  fs.writeFileSync(
    config.run.lockFile,
    JSON.stringify({ runId: 'theirs', pid: 9, host: 'test-host', startedAt: 1 }),
  )
  lock.release()
  assert.equal(JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8')).runId, 'theirs')
})

// ─── artifact identity and completion ────────────────────────────────────────

test('an artifact identity that already exists is never overwritten', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const base = 'eanhl-prod-20260904T180007Z'
  fs.mkdirSync(config.destination.dir, { recursive: true })
  fs.writeFileSync(`${config.destination.dir}/${base}.dump.age`, 'PRECIOUS EXISTING ARTIFACT')

  const { error } = await runExpectingFailure(dir)
  assert.equal(error.code, 'artifact_identity_collision')
  assert.equal(
    fs.readFileSync(`${config.destination.dir}/${base}.dump.age`, 'utf8'),
    'PRECIOUS EXISTING ARTIFACT',
  )
})

test('every run gets its own run id, and the id names its own staging directory', async () => {
  const dir = sandbox()
  const seenStaging = []
  const spy = (label) => ({
    randomToken: () => label,
    runDump: async ({ outPath }) => {
      seenStaging.push(path.dirname(outPath))
      const body = DUMP_MAGIC + 'x'.repeat(64)
      fs.writeFileSync(outPath, body)
      return { bytes: body.length, truncated: false }
    },
  })
  // Same frozen clock: the random component alone must separate the two runs.
  const a = await run(fs.mkdtempSync(path.join(dir, 'a-')), {}, spy('aaaa1111'))
  const b = await run(fs.mkdtempSync(path.join(dir, 'b-')), {}, spy('bbbb2222'))
  assert.notEqual(a.report.runId, b.report.runId, 'run ids must be unique per run')
  assert.match(a.report.runId, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/)
  assert.equal(seenStaging.length, 2)
  assert.notEqual(seenStaging[0], seenStaging[1], 'each run must stage in its own directory')
  assert.ok(seenStaging[0].endsWith(a.report.runId))
  assert.ok(seenStaging[1].endsWith(b.report.runId))

  // A differing clock alone must also separate them.
  const c = await run(fs.mkdtempSync(path.join(dir, 'c-')), {}, { now: () => 1_788_577_260_000 })
  assert.notEqual(c.report.runId, a.report.runId)
})

test('an artifact that does not hash to its own sidecar is incomplete, however present its files', () => {
  const dir = sandbox()
  const base = 'eanhl-prod-20260904T180007Z'
  const deps = { fs, sha256File }
  const write = (suffix, body) => fs.writeFileSync(`${dir}/${base}${suffix}`, body)

  write('.dump.age', `${AGE_HEADER}\nbody`)
  const good = sha256File(`${dir}/${base}.dump.age`)
  const bytes = fs.statSync(`${dir}/${base}.dump.age`).size
  const manifest = (over = {}) =>
    JSON.stringify({
      schema_version: 1,
      artifact: `${base}.dump.age`,
      ciphertext: { sha256: good, bytes },
      ...over,
    })

  write('.dump.age.sha256', formatChecksumSidecar(good, `${base}.dump.age`))
  write('.manifest.json', manifest())
  assert.equal(verifyArtifactCompletion({ dir, base, deps }).complete, true)

  // 1. Missing sidecar.
  fs.rmSync(`${dir}/${base}.dump.age.sha256`)
  let v = verifyArtifactCompletion({ dir, base, deps })
  assert.equal(v.complete, false)
  assert.match(v.failures.join(' '), /missing checksum/)

  // 2. Sidecar hash that does not match the bytes.
  write('.dump.age.sha256', formatChecksumSidecar('b'.repeat(64), `${base}.dump.age`))
  v = verifyArtifactCompletion({ dir, base, deps })
  assert.equal(v.complete, false)
  assert.match(v.failures.join(' '), /does not match sidecar/)

  // 3. Truncated ciphertext with correct-looking sidecars: length AND hash fail.
  write('.dump.age.sha256', formatChecksumSidecar(good, `${base}.dump.age`))
  write('.dump.age', `${AGE_HEADER}`)
  v = verifyArtifactCompletion({ dir, base, deps })
  assert.equal(v.complete, false)
  assert.match(v.failures.join(' '), /does not match sidecar/)
  assert.match(v.failures.join(' '), /manifest says/)

  // 4. A manifest from a different artifact.
  write('.dump.age', `${AGE_HEADER}\nbody`)
  write('.manifest.json', manifest({ artifact: 'some-other-artifact.dump.age' }))
  v = verifyArtifactCompletion({ dir, base, deps })
  assert.equal(v.complete, false)
  assert.match(v.failures.join(' '), /does not name/)

  // 5. An unrecognised manifest schema version.
  write('.manifest.json', manifest({ schema_version: 99 }))
  v = verifyArtifactCompletion({ dir, base, deps })
  assert.equal(v.complete, false)
  assert.match(v.failures.join(' '), /schema_version/)

  // 6. Unparseable manifest.
  write('.manifest.json', '{ nope')
  v = verifyArtifactCompletion({ dir, base, deps })
  assert.equal(v.complete, false)
  assert.match(v.failures.join(' '), /not valid JSON/)
})

test('a publish that lands corrupt bytes is detected and withdrawn, not left behind', async () => {
  const dir = sandbox()
  // Corrupt exactly the ciphertext copy, the way a bad drvfs write would.
  const { error, config } = await runExpectingFailure(
    dir,
    {},
    {
      copyFileSync: (from, to) => {
        if (to.includes('.dump.age.part') && !to.includes('.sha256')) {
          fs.writeFileSync(to, `${AGE_HEADER}\nTRUNCATED`)
          return
        }
        fs.copyFileSync(from, to)
      },
    },
  )
  assert.equal(error.code, 'artifact_incomplete')
  assert.match(error.message, /withdrawn/)
  const left = fs.readdirSync(config.destination.dir)
  assert.deepEqual(left, [], `withdrawal must remove every published file, saw ${left.join(', ')}`)
})

// ─── dry run ─────────────────────────────────────────────────────────────────

test('a dry run proves the snapshot and the counts but writes nothing anywhere', async () => {
  const dir = sandbox()
  const { report, config, calls } = await run(dir, {}, {}, { dryRun: true })

  assert.equal(report.dryRun, true)
  assert.equal(report.artifactBase, 'eanhl-prod-20260904T180007Z')
  assert.deepEqual(report.counts, { 'public.matches': 204, 'public.players': 11 })
  assert.equal(report.countsSnapshot, true)
  assert.ok(report.wouldWrite.some((p) => p.endsWith('.dump.age')))

  assert.equal(calls.dump.length, 0, 'a dry run must not dump')
  assert.equal(calls.encrypt.length, 0, 'a dry run must not encrypt')
  assert.equal(calls.validate.length, 0)
  assert.equal(
    fs.existsSync(config.destination.dir),
    false,
    'a dry run must not create the destination',
  )
  assert.deepEqual(fs.readdirSync(config.staging.root), [])
  assert.equal(fs.existsSync(config.run.lockFile), false)
})

test('a dry run still takes the run lock, so it cannot race a real run', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  fs.writeFileSync(
    config.run.lockFile,
    JSON.stringify({ runId: 'real', pid: 777, host: 'test-host', startedAt: 1_788_577_190_000 }),
  )
  const { error } = await runExpectingFailure(
    dir,
    {},
    { processAlive: () => true },
    { dryRun: true },
  )
  assert.equal(error.code, 'concurrent_run')
})

test('a dry run commits the snapshot transaction rather than leaving it open', async () => {
  const dir = sandbox()
  const { session } = await run(dir, {}, {}, { dryRun: true })
  assert.ok(
    session.seen.some((s) => s.startsWith('COMMIT')),
    'dry run must close its transaction',
  )
})

// ─── provenance degradation is a warning, never a silent gap ─────────────────

test('unreadable provenance is recorded as an explicit warning, not omitted', async () => {
  const dir = sandbox()
  const { report } = await run(
    dir,
    {
      manifest: {
        criticalTables: TABLES,
        migrations: { schema: 'drizzle', table: '__drizzle_migrations', idColumn: 'id' },
        imageRefs: { db: 'postgres:16-alpine' },
      },
    },
    { gitCommit: () => null, imageDigest: () => null },
  )
  assert.equal(report.manifest.source.git_commit, null)
  assert.deepEqual(report.manifest.source.image_digests, { db: null })
  assert.ok(report.manifest.warnings.some((w) => /git commit/.test(w)))
  assert.ok(report.manifest.warnings.some((w) => /image digest for db/.test(w)))
})

// ─── exclusion is retained whenever termination is not established ───────────
//
// These branches are driven with injected handles rather than real processes:
// a genuinely un-SIGKILL-able child cannot be created on demand, and the
// producer's decision — not the kernel's behaviour — is what is under test.
// The real-process counterparts (an orphaned container-side command, a probe
// that fails, a probe that hangs, a forced teardown) live in
// backup-lifecycle.test.mjs.

/** A `runDump` fake that registers a handle with a scripted `cancel`. */
function dumpWithHandle({ kind = 'docker-exec', identityToken = null, cancel, onHandle }) {
  return ({ track }) =>
    new Promise((_, reject) => {
      const handle = {
        label: 'pg_dump',
        kind,
        identityToken,
        killNow() {
          handle.killed = true
        },
        cancel,
      }
      onHandle?.(handle)
      track?.(handle)
      // Cancellation makes the operation fail, as a real killed child would.
      setTimeout(() => reject(new Error('pg_dump killed')), 40)
    })
}

test('a cancellation that times out retains the lock', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const world = makeDeps(dir, config, {
    runDump: dumpWithHandle({
      kind: 'local',
      cancel: async () => ({
        label: 'pg_dump',
        kind: 'local',
        outcome: 'timeout',
        containerSideEnded: false,
      }),
    }),
  })
  await assert.rejects(produceBackupArtifact({ config, deps: world.deps, log: world.log }))

  assert.ok(fs.existsSync(config.run.lockFile), 'a timed-out cancellation must retain the lock')
  const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
  assert.equal(held.retained, true)
  assert.ok(
    held.unconfirmed.some((u) => u.outcome === 'timeout'),
    JSON.stringify(held.unconfirmed),
  )
  assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging is still cleaned up')
})

test('a cancellation that throws retains the lock', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const world = makeDeps(dir, config, {
    runDump: dumpWithHandle({
      kind: 'local',
      cancel: async () => {
        throw new Error('kill(2) failed: EPERM')
      },
    }),
  })
  await assert.rejects(produceBackupArtifact({ config, deps: world.deps, log: world.log }))
  const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
  assert.equal(held.retained, true)
  assert.ok(
    held.unconfirmed.some((u) => u.outcome === 'error'),
    JSON.stringify(held.unconfirmed),
  )
})

test('a handle that could not be stopped is KEPT, so a forced teardown can still kill it', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  let handle = null
  let teardown = null
  const world = makeDeps(dir, config, {
    registerCleanup: (h) => (teardown = h),
    runDump: dumpWithHandle({
      kind: 'local',
      onHandle: (h) => (handle = h),
      cancel: async () => ({
        label: 'pg_dump',
        kind: 'local',
        outcome: 'timeout',
        containerSideEnded: false,
      }),
    }),
  })
  await assert.rejects(produceBackupArtifact({ config, deps: world.deps, log: world.log }))
  // Discarding it would both lose the exclusion signal and leak the child:
  // a piped-stdio child keeps two Sockets and a ChildProcess referenced, which
  // is enough to stop the owning process from ever exiting.
  teardown.emergency()
  assert.equal(handle.killed, true, 'the unstopped handle must still be reachable for a SIGKILL')
})

test('a docker-exec operation with no identity token cannot be confirmed, so the lock is kept', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const world = makeDeps(dir, config, {
    runDump: dumpWithHandle({
      identityToken: null,
      cancel: async () => ({
        label: 'pg_dump',
        kind: 'docker-exec',
        outcome: 'killed',
        containerSideEnded: null,
      }),
    }),
  })
  await assert.rejects(produceBackupArtifact({ config, deps: world.deps, log: world.log }))
  const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
  assert.equal(held.retained, true)
  assert.ok(held.unconfirmed.some((u) => /no identity token/.test(u.outcome)))
})

test('a probe that still lists our command keeps the lock; one that does not releases it', async () => {
  for (const [inventory, shouldRetain] of [
    [['postgres', 'pg_dump --snapshot=SNAP-9'], true],
    [['postgres', 'pg_dump --snapshot=SOMEONE-ELSE'], false],
  ]) {
    const dir = sandbox()
    const config = makeConfig(dir)
    const world = makeDeps(dir, config, {
      listContainerCommands: async () => inventory,
      runDump: dumpWithHandle({
        identityToken: '--snapshot=SNAP-9',
        cancel: async () => ({
          label: 'pg_dump',
          kind: 'docker-exec',
          outcome: 'killed',
          containerSideEnded: null,
        }),
      }),
    })
    await assert.rejects(produceBackupArtifact({ config, deps: world.deps, log: world.log }))
    assert.equal(
      fs.existsSync(config.run.lockFile),
      shouldRetain,
      `inventory ${JSON.stringify(inventory)} should ${shouldRetain ? 'retain' : 'release'} the lock`,
    )
  }
})

test('the probe is never used to signal anything — it only ever reads', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const probeCalls = []
  const world = makeDeps(dir, config, {
    listContainerCommands: async (args) => {
      probeCalls.push(args)
      return ['postgres']
    },
    runDump: dumpWithHandle({
      identityToken: '--snapshot=SNAP-9',
      cancel: async () => ({
        label: 'pg_dump',
        kind: 'docker-exec',
        outcome: 'killed',
        containerSideEnded: null,
      }),
    }),
  })
  await assert.rejects(produceBackupArtifact({ config, deps: world.deps, log: world.log }))
  assert.equal(probeCalls.length, 1)
  assert.deepEqual(probeCalls[0], {
    container: config.source.container,
    timeoutMs: config.run.containerProbeTimeoutMs,
  })
})

// ─── an ABANDONED operation is not a stopped one ─────────────────────────────
//
// When a boundary gives up on a wedged output it rejects promptly but keeps the
// handle registered, because nothing was observed to close. These pin what the
// producer must then do with that handle: retain exclusion until something
// actually confirms the process stopped — and release it when something does.

/** A `runEncryption` fake that abandons a wedged output, keeping its handle. */
function stalledEncryption({ cancel, onHandle }) {
  return ({ track }) =>
    new Promise((_, reject) => {
      const handle = {
        label: 'encryption',
        kind: 'local',
        identityToken: null,
        locallyTerminated: true,
        killNow() {
          handle.killed = true
        },
        cancel,
      }
      onHandle?.(handle)
      // Deliberately tracked and NEVER untracked: that is the boundary's
      // contract for abandoned work.
      track?.(handle)
      setTimeout(() => {
        const err = new Error(
          'encryption made no progress for 1500ms: output stream neither drained nor errored',
        )
        err.code = 'output_stalled'
        reject(err)
      }, 40)
    })
}

test('a stalled local encryptor whose stopping cannot be confirmed RETAINS the lock', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  const world = makeDeps(dir, config, {
    runEncryption: stalledEncryption({
      cancel: async () => ({
        label: 'encryption',
        kind: 'local',
        outcome: 'timeout',
        containerSideEnded: false,
      }),
    }),
  })

  const started = Date.now()
  let error = null
  try {
    await produceBackupArtifact({ config, deps: world.deps, log: world.log })
  } catch (err) {
    error = err
  }
  const elapsed = Date.now() - started

  // 1. The rejection is bounded and names the stall.
  assert.equal(error?.code, 'output_stalled', `${error?.code}: ${error?.message}`)
  assert.ok(elapsed < 5_000, `run took ${elapsed}ms — the rejection must be bounded`)

  // 2. Exclusion is retained, because nothing confirmed the encryptor stopped.
  assert.ok(fs.existsSync(config.run.lockFile), 'the lock MUST be retained')
  const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
  assert.equal(held.retained, true)
  assert.ok(
    held.unconfirmed.some((u) => u.label === 'encryption' && u.outcome === 'timeout'),
    JSON.stringify(held.unconfirmed),
  )
  assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging is still cleaned up')

  // 3. And the next producer is refused because of it.
  const next = makeConfig(dir)
  const nextWorld = makeDeps(dir, next)
  let nextError = null
  try {
    await produceBackupArtifact({ config: next, deps: nextWorld.deps, log: nextWorld.log })
  } catch (err) {
    nextError = err
  }
  assert.equal(nextError?.code, 'lock_retained_uncertain')
  assert.match(nextError.message, /encryption/)
})

test('a stalled local encryptor that IS confirmed stopped releases the lock', async () => {
  // The rule is "retain unless stopping is confirmed", not "always retain after
  // a stall": once the child is observed to have closed, exclusion is given up.
  const dir = sandbox()
  const config = makeConfig(dir)
  let handle = null
  const world = makeDeps(dir, config, {
    runEncryption: stalledEncryption({
      onHandle: (h) => (handle = h),
      cancel: async () => ({
        label: 'encryption',
        kind: 'local',
        outcome: 'killed',
        containerSideEnded: true,
      }),
    }),
  })

  let error = null
  try {
    await produceBackupArtifact({ config, deps: world.deps, log: world.log })
  } catch (err) {
    error = err
  }
  assert.equal(error?.code, 'output_stalled')
  assert.equal(fs.existsSync(config.run.lockFile), false, 'confirmed stopped ⇒ lock released')
  assert.ok(handle, 'the abandoned handle must have been registered in the first place')
})

test('an abandoned handle is still reachable for a forced teardown', async () => {
  const dir = sandbox()
  const config = makeConfig(dir)
  let handle = null
  let teardown = null
  const world = makeDeps(dir, config, {
    registerCleanup: (h) => (teardown = h),
    runEncryption: stalledEncryption({
      onHandle: (h) => (handle = h),
      cancel: async () => ({
        label: 'encryption',
        kind: 'local',
        outcome: 'timeout',
        containerSideEnded: false,
      }),
    }),
  })
  await assert.rejects(produceBackupArtifact({ config, deps: world.deps, log: world.log }))
  teardown.emergency()
  assert.equal(handle.killed, true, 'the abandoned child must still be reachable for a SIGKILL')
})
