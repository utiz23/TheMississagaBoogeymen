/**
 * Backup producer — process-lifecycle suite (REAL child processes).
 *
 * Everything here spawns actual processes through the actual boundaries. The
 * only fakes are the executables themselves: `ops/backup/lib/testdoubles/`
 * supplies a `docker` that speaks just enough of the psql session protocol,
 * `pg_dump`, `pg_restore` and `ps -A -o args=`, plus an encryption double. No
 * Docker, no PostgreSQL, no `age`, no key, no network, no production data.
 *
 * That distinction matters when reading the evidence: the injected-fake suite
 * in backup-producer.test.mjs proves what the orchestrator DECIDES; this suite
 * proves what actually happens to real pipes, real signals and real files.
 *
 * What is pinned here:
 *
 *   1. The ciphertext ceiling is a BOUND, not a measurement. A double that
 *      emits 8 MiB in one synchronous burst — finishing before any sampling
 *      timer could fire — must leave a staged file that never exceeded the
 *      permitted byte count at any instant, not merely one rejected afterwards.
 *   2. An output-stream error arriving before the subprocess finishes rejects
 *      through cleanup instead of terminating Node as an unhandled 'error'.
 *   3. Cancellation stops the dump, validation and encryption children, and the
 *      run lock is released only when termination is CONFIRMED. When it is not
 *      — the container still lists our command, the probe cannot answer, or a
 *      forced synchronous teardown could not await anything — the lock is
 *      RETAINED and the next producer is refused.
 *
 * SUITE COMPLETION. A child spawned with piped stdio holds two Socket handles
 * and a ChildProcess handle, so a single leaked child keeps this file's process
 * alive forever — and `node --test` prints nothing for a file until its process
 * exits, which is exactly what "earlier files passed, then no output" looks
 * like. Every test therefore has an explicit timeout, and `afterEach` force-
 * kills everything this file started, whether the test passed, failed or threw.
 */

import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { installTestWatchdog } from './test-diagnostics.mjs'
import { validateConfig } from './backup-config.mjs'
import { produceBackupArtifact } from './backup-producer.mjs'
import {
  cancelChild,
  freeSpace,
  listContainerCommands,
  makeSnapshotSession,
  overwriteFile,
  readFileHead,
  resolveExecutable,
  runDump,
  runEncryption,
  sha256File,
  validateArchive,
} from './backup-boundaries.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOUBLES = path.join(HERE, 'testdoubles')
const CLI = path.resolve(HERE, '../eanhl-backup.mjs')
const AGE_HEADER = 'age-encryption.org/v1'
const T = 40_000 // per-test ceiling: a stuck test must FAIL, never hang the file

// An unhandled rejection here means a boundary settled twice or leaked an error
// path. Fail loudly rather than letting Node print and move on.
const unhandled = []
process.on('unhandledRejection', (err) => unhandled.push(err))

// ── leak containment ─────────────────────────────────────────────────────────
const liveHandles = new Set()
const liveTeardowns = new Set()
const liveProcesses = new Set()
let restoreEnv = null

// If a test ever stalls, say which one and what is still alive rather than
// leaving an outer `timeout` to report nothing at all.
const watchdog = installTestWatchdog({
  // No test here legitimately exceeds ~1.1 s, so 4 s already means something is
  // wrong. The 15 s default is longer than a tight per-file deadline, which is
  // how a real multi-second stall produced no stall report at all.
  label: 'lifecycle',
  warnAfterMs: 4_000,
  intervalMs: 3_000,
  extra: () => [
    `tracked handles: ${liveHandles.size}`,
    `tracked teardowns: ${liveTeardowns.size}`,
    `tracked processes: ${[...liveProcesses].map((c) => c.pid).join(', ') || 'none'}`,
    `sandboxes: ${sandboxes.length}`,
  ],
})

/** `track` callback that also registers with the file-level safety net. */
function trackLive(handle) {
  liveHandles.add(handle)
  return () => liveHandles.delete(handle)
}

function reap() {
  for (const teardown of liveTeardowns) {
    try {
      teardown.emergency?.()
    } catch {
      /* best effort */
    }
  }
  liveTeardowns.clear()
  for (const handle of liveHandles) {
    try {
      handle.killNow?.()
    } catch {
      /* best effort */
    }
  }
  liveHandles.clear()
  for (const child of liveProcesses) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* best effort */
    }
  }
  liveProcesses.clear()
}

afterEach(() => {
  reap()
  restoreEnv?.()
  restoreEnv = null
})

/**
 * Fail immediately if a double cannot actually run.
 *
 * A double that does not start produces no marker, and the tests that wait for
 * one then look merely slow. `docker image inspect …` is answered by the double
 * itself with exit 1, so anything else — 126/127, or a shell complaint about
 * the interpreter — means the launcher is broken, and that is worth one
 * millisecond here instead of twenty seconds later.
 */
function assertDoubleRunnable(dockerPath) {
  const probe = spawnSync(dockerPath, ['image', 'inspect', 'probe'], { encoding: 'utf8' })
  assert.ok(
    probe.status === 1 && !/not found|No such file|Exec format/i.test(probe.stderr ?? ''),
    `the fake docker double at ${dockerPath} does not run ` +
      `(status ${probe.status}, stderr ${JSON.stringify((probe.stderr ?? '').slice(0, 200))}). ` +
      `Every test that waits for one of its markers would otherwise burn its full timeout.`,
  )
}

const sandboxes = []
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-lifecycle-'))
  sandboxes.push(dir)
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'markers'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'staging'), { recursive: true })
  // The doubles are Node programs, but they are launched through a `#!/bin/sh`
  // wrapper that execs THIS process's interpreter by absolute path — never
  // `#!/usr/bin/env node`. A shebang that resolves `node` through PATH silently
  // fails to start wherever node is not on the spawned child's PATH, and the
  // only symptom is a marker file that never appears: every test that waits for
  // one then burns its full `waitForFile` budget (6 s, or 20 s for the CLI
  // tests) and the file looks slow rather than broken. Measured: with node's
  // directory removed from PATH the CLI SIGINT test goes from 235 ms to
  // 19,975 ms, failing on `waiting for …/markers/pg_dump.started`.
  for (const [src, dest] of [
    ['fake-docker.mjs', 'docker'],
    ['fake-encryptor.mjs', 'age-double'],
  ]) {
    const real = path.join(dir, 'bin', `${dest}.mjs`)
    fs.copyFileSync(path.join(DOUBLES, src), real)
    const launcher = path.join(dir, 'bin', dest)
    fs.writeFileSync(launcher, `#!/bin/sh\nexec ${process.execPath} ${real} "$@"\n`, {
      mode: 0o755,
    })
  }
  assertDoubleRunnable(path.join(dir, 'bin', 'docker'))
  fs.writeFileSync(
    path.join(dir, 'recipient.pub'),
    'age1exampledoublerecipient00000000000000000000\n',
  )
  return dir
}

/**
 * Sandboxes whose contents are evidence for a failure and must survive teardown.
 *
 * Only ever this file's OWN `mkdtemp` directories — nothing else on disk is
 * read, moved or removed, so a preserved sandbox cannot disturb another run's
 * evidence tree (under `run-suite.mjs` these live inside that run's root, which
 * the suite already keeps when anything failed).
 */
const preserved = new Set()

after(() => {
  reap()
  for (const dir of sandboxes) {
    if (preserved.has(dir)) continue
    fs.rmSync(dir, { recursive: true, force: true })
  }
  for (const dir of preserved) {
    process.stderr.write(`[lifecycle] evidence preserved at ${dir}\n`)
  }
  assert.deepEqual(
    unhandled.map((e) => e?.message ?? String(e)),
    [],
    'a boundary leaked an unhandled rejection',
  )
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

/**
 * Poll for a file, up to `timeoutMs`.
 *
 * `signal` abandons the poll early. That matters when this wait is RACED
 * against something that makes the file impossible — a child that has already
 * exited, say. Without it the losing poll keeps scheduling 10 ms timers until
 * its full deadline, and since those timers are live handles the test FILE
 * cannot exit until then: the test fails in milliseconds and the run still
 * takes the whole 20 s, which reads from outside exactly like the slow wait
 * that was supposedly fixed.
 */
async function waitForFile(p, timeoutMs = 6000, signal) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
    if (signal?.aborted) throw new Error(`abandoned the wait for ${p}: ${signal.reason}`)
    await sleep(10)
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${p}`)
}

/** `/proc/<pid>/stat` process state letter (R/S/D/Z/…), or 'gone'. */
function procState(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
  } catch {
    return 'gone'
  }
}

/** `/proc/<pid>/cmdline`, or null. Used to tell OUR child from a reused pid. */
function procCmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
  } catch {
    return null
  }
}

/**
 * Prove no child of `<label>` is left running.
 *
 * The internal-failure teardown paths SIGKILL immediately, so there is no
 * `.stopped` marker to wait for — SIGKILL cannot run the double's own handler.
 * Two acceptable outcomes: the child was killed so fast it never recorded a
 * start, or it recorded a pid and that pid no longer belongs to it. The grace
 * period only has to outrun a double that DID get to write its marker, which is
 * measured at ~60 ms; it is dead time whenever the child was killed first.
 *
 * IDENTITY, NOT JUST LIVENESS. `kill(pid, 0)` succeeds for a zombie and for a
 * completely unrelated process that has since been given the same pid — and pid
 * reuse is fast inside a small PID namespace, where pids are allocated in the
 * low hundreds. So the pid only counts as "still ours" while `/proc/<pid>/cmdline`
 * still names this sandbox's double. Anything else is reported with its process
 * state and command line rather than silently polled to a timeout.
 */
async function assertChildNotRunning(dir, label, { graceMs = 300, timeoutMs = 3000 } = {}) {
  const marker = path.join(dir, 'markers', `${label}.started`)
  const graceDeadline = Date.now() + graceMs
  while (Date.now() < graceDeadline && !fs.existsSync(marker)) await sleep(20)
  if (!fs.existsSync(marker)) return 'never-started'
  const pid = Number(fs.readFileSync(marker, 'utf8').split(' ')[0])
  assert.ok(Number.isFinite(pid) && pid > 0, `no pid in ${label}.started`)
  const ours = (cmd) => cmd !== null && cmd.includes(dir)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const cmd = procCmdline(pid)
    if (!alive(pid)) return `killed:${pid}`
    if (!ours(cmd)) return `reused:${pid}` // the pid moved on; not our child
    if (procState(pid) === 'Z') return `zombie:${pid}` // dead, awaiting reap
    await sleep(20)
  }
  throw new Error(
    `${label} child ${pid} was still running after ${timeoutMs}ms ` +
      `(state=${procState(pid)}, cmdline=${JSON.stringify(procCmdline(pid))})`,
  )
}

/**
 * Assert that this environment can express a mid-stream write failure — on the
 * code path the test actually uses.
 *
 * `/dev/full` is the only portable way to get a real ENOSPC on an already-open
 * descriptor. But `fs.writeSync` and `fs.createWriteStream` are DIFFERENT code
 * paths: the stream writes through the libuv threadpool. In one container a
 * synchronous 4 KiB write to /dev/full returned ENOSPC while a *streamed* write
 * to the same device neither completed nor failed — the stream never drained,
 * never errored, and the dump child sat paused after its first chunk for 29
 * seconds. Probing the synchronous path would have declared that environment
 * fit; probing the stream catches it in milliseconds.
 */
async function requireEnospcStreamWrites() {
  const outcome = await new Promise((resolve) => {
    let done = false
    let stream = null
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        stream?.destroy()
      } catch {
        /* already gone */
      }
      resolve(value)
    }
    const timer = setTimeout(() => finish('neither errored nor completed within 2000ms'), 2000)
    timer.unref?.()
    try {
      stream = fs.createWriteStream('/dev/full')
    } catch (err) {
      return finish(err?.code ?? String(err))
    }
    stream.on('error', (err) => finish(err?.code ?? String(err)))
    stream.write(Buffer.alloc(65536), (err) =>
      finish(err ? (err.code ?? String(err)) : 'accepted the write'),
    )
  })
  assert.equal(
    outcome,
    'ENOSPC',
    `this environment's /dev/full does not report ENOSPC on a STREAMED write (got: ${outcome}); ` +
      `the mid-stream write-failure test cannot be expressed here`,
  )
}

const FAKE_KEYS = [
  'PATH',
  'FAKE_MARKER_DIR',
  'FAKE_DUMP_MODE',
  'FAKE_RESTORE_MODE',
  'FAKE_PS_MODE',
  'FAKE_DUMP_BYTES',
  'FAKE_ENC_MODE',
]

/** Put the doubles on PATH and set their modes; restored by `afterEach`. */
function withDoubles(dir, modes = {}) {
  const saved = { ...process.env }
  process.env.PATH = `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`
  process.env.FAKE_MARKER_DIR = path.join(dir, 'markers')
  for (const [key, value] of Object.entries(modes)) process.env[key] = String(value)
  restoreEnv = () => {
    for (const key of FAKE_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

function makeConfig(dir, overrides = {}) {
  const base = {
    source: { container: 'eanhl-fake-db-1', database: 'eanhl_scratch_x', user: 'eanhl_test' },
    manifest: {
      criticalTables: ['public.matches', 'public.players'],
      migrations: { schema: 'drizzle', table: '__drizzle_migrations', idColumn: 'id' },
      imageRefs: null,
    },
    encryption: {
      executable: path.join(dir, 'bin', 'age-double'),
      recipientFile: path.join(dir, 'recipient.pub'),
      expectedHeader: AGE_HEADER,
    },
    staging: {
      root: path.join(dir, 'staging'),
      minFreeBytes: 1024,
      backingVolume: null,
      maxPlaintextBytes: 4 * 1024 * 1024,
      maxStagingBytes: 8 * 1024 * 1024,
      maxCiphertextBytes: 8 * 1024 * 1024,
      shredPlaintext: true,
    },
    destination: { dir: path.join(dir, 'dest'), minFreeBytes: 1024, backingVolume: null },
    run: {
      lockFile: path.join(dir, 'producer.lock'),
      lockStaleAfterMs: 600_000,
      operationTimeoutMs: 10_000,
      cancelGraceMs: 400,
      containerProbeTimeoutMs: 3_000,
      artifactPrefix: 'eanhl-life',
      fullArchiveReadDefault: false,
    },
  }
  const merged = structuredClone(base)
  for (const [section, patch] of Object.entries(overrides)) {
    merged[section] = { ...merged[section], ...patch }
  }
  return validateConfig(merged, '<lifecycle-test>')
}

/**
 * Real boundaries, plus a spy on the lock file's unlink so teardown ORDER can
 * be asserted against the doubles' own stop timestamps.
 */
function realDeps(config, { lockReleasedAt, registerCleanup, probeCalls } = {}) {
  return {
    now: () => Date.now(),
    pid: process.pid,
    hostname: () => 'lifecycle-test-host',
    randomToken: () => Math.random().toString(16).slice(2, 10).padEnd(8, '0'),
    processAlive: () => false,
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
      unlinkSync: (p) => {
        if (p === config.run.lockFile && lockReleasedAt) lockReleasedAt.push(Date.now())
        return fs.unlinkSync(p)
      },
      copyFileSync: fs.copyFileSync,
    },
    freeSpace,
    resolveExecutable,
    startSnapshotSession: makeSnapshotSession(),
    runDump,
    validateArchive,
    runEncryption,
    listContainerCommands: (args) => {
      probeCalls?.push(args)
      return listContainerCommands(args)
    },
    sha256File,
    readFileHead,
    overwriteFile,
    gitCommit: () => null,
    imageDigest: () => null,
    registerCleanup: (h) => {
      liveTeardowns.add(h)
      registerCleanup?.(h)
    },
  }
}

/** Sample a path's size as fast as the loop allows; returns the max seen. */
function sizeSampler(target) {
  let max = 0
  let stop = false
  const tick = () => {
    if (stop) return
    try {
      max = Math.max(max, fs.statSync(target).size)
    } catch {
      /* not created yet, or already gone */
    }
    setImmediate(tick)
  }
  setImmediate(tick)
  return {
    stop() {
      stop = true
      return max
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The ciphertext ceiling is a BOUND.
// ─────────────────────────────────────────────────────────────────────────────

test(
  'a synchronous 8 MiB burst never puts more than the permitted bytes on disk',
  { timeout: T },
  async () => {
    // The reproduction that killed the sampling design: the double writes its
    // whole payload in one go and exits before any timer could fire. A poller
    // reported `exceeded: false` with 8388608 bytes on disk against a 262144
    // limit. The producer now owns the descriptor, so the ceiling holds.
    const dir = sandbox()
    withDoubles(dir, { FAKE_ENC_MODE: 'burst' })
    const limit = 262_144
    const outPath = path.join(dir, 'burst.age')
    fs.writeFileSync(path.join(dir, 'in.dump'), 'PGDMP payload')

    const sampler = sizeSampler(outPath)
    const result = await runEncryption({
      argv: [path.join(dir, 'bin', 'age-double'), '--encrypt', path.join(dir, 'in.dump')],
      outPath,
      maxOutputBytes: limit,
      track: trackLive,
    })
    const maxObserved = sampler.stop()

    assert.equal(result.exceeded, true, 'the ceiling must fire on a burst, not miss it')
    assert.ok(
      result.bytes <= limit,
      `accepted ${result.bytes} bytes against a ${limit} ceiling — the bound leaked`,
    )
    assert.ok(
      maxObserved <= limit,
      `the staged file reached ${maxObserved} bytes at some instant, over the ${limit} ceiling`,
    )
    assert.equal(fs.existsSync(outPath), false, 'the partial ciphertext must be removed')
  },
)

/**
 * A path whose writes fill and then block forever: a FIFO with a reader that
 * opens it and never reads. The kernel blocks the writer once the pipe buffer
 * is full, which is the shape of an output that neither completes nor fails.
 *
 * Returns the path; the reader is registered for teardown by the caller's reap.
 */
function wedgedOutput(dir) {
  const fifo = path.join(dir, 'wedged.fifo')
  const made = spawnSync('mkfifo', [fifo])
  assert.equal(made.status, 0, `mkfifo failed: ${made.stderr}`)
  // The reader is a plain non-blocking fd in THIS process, not a child:
  // O_RDONLY|O_NONBLOCK on a FIFO returns immediately, holds the pipe open, and
  // adds no libuv handle. A spawned `sleep` would work too, but it keeps the
  // test file alive until it is reaped — and a blocked write(2) already holds an
  // outstanding threadpool request (`FSReqCallback`) that only clears when the
  // last reader closes, so the fd has to be closed deterministically.
  const rd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK)
  let closed = false
  return {
    path: fifo,
    close() {
      if (closed) return
      closed = true
      try {
        fs.closeSync(rd)
      } catch {
        /* already closed */
      }
    },
  }
}

test(
  'a STALLED LOCAL encryptor rejects promptly but stays tracked — abandoning is not stopping',
  { timeout: T },
  async () => {
    // The defect this pins: on `output_stalled` the boundary used to set
    // childDone/streamDone itself so the promise could settle, and `settle()`
    // then untracked the handle because the child was `local` rather than
    // `docker-exec`. Nothing had been observed to close. The caller lost the
    // only signal that unconfirmed work was still out there.
    const dir = sandbox()
    withDoubles(dir, { FAKE_ENC_MODE: 'oversized' })
    fs.writeFileSync(path.join(dir, 'in.dump'), 'PGDMP payload')
    const wedged = wedgedOutput(dir)

    const started = Date.now()
    let error = null
    try {
      await runEncryption({
        argv: [path.join(dir, 'bin', 'age-double'), '--encrypt', path.join(dir, 'in.dump')],
        outPath: wedged.path,
        maxOutputBytes: 8 * 1024 * 1024,
        track: trackLive,
        stallTimeoutMs: 1_500,
      })
    } catch (err) {
      error = err
    } finally {
      // Releases the blocked write(2); without this the outstanding threadpool
      // request keeps this process alive after every assertion has passed.
      wedged.close()
    }
    const elapsed = Date.now() - started

    // 1. The rejection is bounded.
    assert.equal(error?.code, 'output_stalled', `${error?.code}: ${error?.message}`)
    assert.ok(elapsed < 10_000, `rejection took ${elapsed}ms — it must be bounded`)
    assert.match(error.message, /neither drained nor errored/)

    // 2. Termination uncertainty remains TRACKED, even though this is a local
    //    child. Untracking here is exactly the accounting bug.
    assert.equal(liveHandles.size, 1, 'an abandoned operation must stay registered')
    const [kept] = liveHandles
    assert.equal(kept.kind, 'local', 'and the rule must not depend on it being docker-exec')
    assert.equal(kept.locallyTerminated, true)
  },
)

test('runEncryption refuses to run without a positive ceiling', { timeout: T }, async () => {
  const dir = sandbox()
  withDoubles(dir, { FAKE_ENC_MODE: 'ok' })
  fs.writeFileSync(path.join(dir, 'in.dump'), 'PGDMP payload')
  await assert.rejects(
    runEncryption({
      argv: [path.join(dir, 'bin', 'age-double'), path.join(dir, 'in.dump')],
      outPath: path.join(dir, 'out.age'),
      maxOutputBytes: 0,
    }),
    /positive maxOutputBytes ceiling/,
  )
})

test(
  'the double rejects --output: the producer, not the tool, owns the file',
  { timeout: T },
  () => {
    const dir = sandbox()
    const r = spawnSync(
      path.join(dir, 'bin', 'age-double'),
      ['--output', '/tmp/x', '/etc/hostname'],
      { encoding: 'utf8' },
    )
    assert.equal(r.status, 64)
    assert.match(r.stderr, /ciphertext goes to stdout/)
  },
)

test(
  'a runaway encryptor is cut at the ceiling mid-run and the artifact is refused',
  { timeout: T },
  async () => {
    const dir = sandbox()
    withDoubles(dir, {
      FAKE_DUMP_MODE: 'ok',
      FAKE_DUMP_BYTES: '512',
      FAKE_RESTORE_MODE: 'ok',
      FAKE_ENC_MODE: 'oversized',
    })
    // The double intends 400 × 64 KiB = 25 MiB. The budget leaves ~300 KB.
    const config = makeConfig(dir, {
      staging: {
        maxPlaintextBytes: 65_536,
        maxStagingBytes: 65_536 + 300_000,
        maxCiphertextBytes: 65_536 + 300_000,
      },
    })
    const deps = realDeps(config)

    let error = null
    try {
      await produceBackupArtifact({ config, deps, log: () => {}, options: {} })
    } catch (err) {
      error = err
    }

    assert.ok(error, 'a runaway encryptor must fail the run')
    assert.equal(error.code, 'staging_budget_exceeded', `${error.code}: ${error.message}`)
    assert.match(error.message, /the staged file never exceeded it/)
    assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging must be cleaned up')
    assert.equal(
      fs.existsSync(config.destination.dir) ? fs.readdirSync(config.destination.dir).length : 0,
      0,
    )
    assert.equal(fs.existsSync(config.run.lockFile), false, 'nothing was left running, so release')
  },
)

test('a well-behaved run publishes through the stdout contract', { timeout: T }, async () => {
  const dir = sandbox()
  withDoubles(dir, {
    FAKE_DUMP_MODE: 'ok',
    FAKE_DUMP_BYTES: '4096',
    FAKE_RESTORE_MODE: 'ok',
    FAKE_ENC_MODE: 'ok',
  })
  const config = makeConfig(dir)
  const report = await produceBackupArtifact({
    config,
    deps: realDeps(config),
    log: () => {},
    options: {},
  })
  assert.equal(report.countsSnapshot, true)
  assert.deepEqual(report.counts, { 'public.matches': 7, 'public.players': 7 })
  const artifact = path.join(config.destination.dir, `${report.artifactBase}.dump.age`)
  assert.ok(fs.existsSync(artifact))
  assert.ok(fs.readFileSync(artifact, 'latin1').startsWith(AGE_HEADER))
  assert.deepEqual(fs.readdirSync(config.staging.root), [])
  assert.equal(fs.existsSync(config.run.lockFile), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Output-stream errors in runDump.
// ─────────────────────────────────────────────────────────────────────────────

test(
  'an output file that cannot be opened rejects, and stops the dump child',
  { timeout: T },
  async () => {
    const dir = sandbox()
    withDoubles(dir, { FAKE_DUMP_MODE: 'hang' })
    await assert.rejects(
      runDump({
        container: 'c',
        database: 'd',
        user: 'u',
        snapshotId: 's',
        outPath: path.join(dir, 'no-such-dir', 'a.dump'),
        maxBytes: 1_000_000,
        track: trackLive,
      }),
      /pg_dump output .* failed: ENOENT/,
    )
    await assertChildNotRunning(dir, 'pg_dump')
    // The client is dead, but this was an INTERNALLY initiated termination of a
    // `docker exec` operation, so the handle must survive for the producer to
    // probe the container or retain exclusion. Dropping it here is the defect
    // that let an internally-killed dump vanish before teardown could account
    // for it.
    assert.equal(liveHandles.size, 1, 'a locally terminated docker-exec handle must be kept')
    const [kept] = liveHandles
    assert.equal(kept.locallyTerminated, true)
    assert.equal(kept.kind, 'docker-exec')
  },
)

test(
  'REGRESSION (subprocess): an early output error does not terminate Node',
  { timeout: T },
  async () => {
    // The defect: `fs.createWriteStream` got its 'error' handler only after
    // `await`ing the child, so an ENOENT/EACCES/ENOSPC on open was an unhandled
    // 'error' event — which kills the process outright and skips every bit of
    // the producer's cleanup. An in-process assertion cannot tell a caught
    // rejection apart from a crash the runner absorbed, so this runs in its own
    // process and asserts on the exit status.
    const dir = sandbox()
    const script = path.join(dir, 'probe.mjs')
    fs.writeFileSync(
      script,
      [
        `import { runDump } from ${JSON.stringify(path.join(HERE, 'backup-boundaries.mjs'))}`,
        'try {',
        '  await runDump({',
        "    container: 'c', database: 'd', user: 'u', snapshotId: 's',",
        `    outPath: ${JSON.stringify(path.join(dir, 'missing', 'a.dump'))},`,
        '    maxBytes: 1000000,',
        '  })',
        "  console.log('RESOLVED')",
        '} catch (err) {',
        "  console.log('REJECTED:' + (err && err.code))",
        '}',
        'process.exit(0)',
      ].join('\n'),
    )
    withDoubles(dir, { FAKE_DUMP_MODE: 'ok' })
    const r = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      timeout: 20_000,
      env: process.env,
    })
    assert.equal(r.status, 0, `probe exited ${r.status}; stderr:\n${r.stderr}`)
    assert.doesNotMatch(
      r.stderr ?? '',
      /Unhandled .?error.? event/,
      'the stream error was unhandled',
    )
    assert.match(r.stdout.trim(), /^REJECTED:ENOENT$/, `stdout was ${JSON.stringify(r.stdout)}`)
  },
)

test(
  'a mid-stream write error (ENOSPC) rejects and stops the dump child',
  { timeout: T },
  async () => {
    // /dev/full opens successfully and fails ENOSPC on the first write — a real
    // mid-stream output failure, the shape a full staging disk takes.
    await requireEnospcStreamWrites()
    const dir = sandbox()
    withDoubles(dir, { FAKE_DUMP_MODE: 'big' })
    // The ceiling is a BACKSTOP here, not the mechanism: ENOSPC must arrive
    // first. It is 8 MiB rather than 64 MiB so that if this environment ever
    // does swallow the write error, the run ends in well under a second with a
    // "missing expected rejection" failure — instead of spending ten seconds
    // filling a ceiling while a live child looks like a hang. Local margin:
    // ENOSPC lands at ~40 ms, by which time the double has produced ~1 MiB.
    await assert.rejects(
      runDump({
        container: 'c',
        database: 'd',
        user: 'u',
        snapshotId: 's',
        outPath: '/dev/full',
        maxBytes: 8 * 1024 * 1024,
        track: trackLive,
        // Belt and braces: if the stream ever wedges despite the precondition,
        // fail in ~2 s with `output_stalled` naming the blocked side, rather
        // than hanging until the file's deadline reports only the test's name.
        stallTimeoutMs: 2_000,
      }),
      /pg_dump output \/dev\/full failed: ENOSPC/,
    )
    await assertChildNotRunning(dir, 'pg_dump')
    assert.equal(liveHandles.size, 1, 'an output failure is an internal termination, so keep it')
    assert.equal([...liveHandles][0].locallyTerminated, true)
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cancellation semantics.
// ─────────────────────────────────────────────────────────────────────────────

test(
  'cancelChild escalates SIGTERM to SIGKILL and returns inside its deadline',
  { timeout: T },
  async () => {
    const dir = sandbox()
    const stubborn = path.join(dir, 'bin', 'stubborn')
    const ready = path.join(dir, 'markers', 'stubborn.ready')
    fs.writeFileSync(
      stubborn,
      '#!/bin/sh\ntrap \'\' TERM\n: > "$1"\nwhile true; do sleep 0.05; done\n',
      { mode: 0o755 },
    )
    const child = spawn(stubborn, [ready], { stdio: 'ignore' })
    liveProcesses.add(child)
    // Wait until the trap is installed; signalling before that would measure
    // the default disposition, not the escalation.
    await waitForFile(ready)
    const started = Date.now()
    const outcome = await cancelChild(child, 600)
    const elapsed = Date.now() - started
    assert.equal(outcome, 'killed', 'a SIGTERM-ignoring child must still be stopped')
    assert.ok(elapsed < 3000, `cancellation took ${elapsed}ms — it must stay bounded`)
    assert.ok(elapsed >= 250, `escalation should wait for the halfway point, took ${elapsed}ms`)
  },
)

test('cancelChild reports an already-exited child without waiting', { timeout: T }, async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  liveProcesses.add(child)
  await new Promise((r) => child.on('close', r))
  const started = Date.now()
  assert.equal(await cancelChild(child, 5000), 'exited')
  const elapsed = Date.now() - started
  // The point is that it does not wait out the 5000ms deadline. The bound is
  // deliberately loose so a busy machine cannot turn this into a flake.
  assert.ok(elapsed < 1000, `took ${elapsed}ms — it must not wait for the deadline`)
})

test(
  'cancelling a docker-exec child never claims the container-side command ended',
  { timeout: T },
  async () => {
    const dir = sandbox()
    withDoubles(dir, { FAKE_DUMP_MODE: 'hang' })
    const pending = runDump({
      container: 'c',
      database: 'd',
      user: 'u',
      snapshotId: 'SNAP-1',
      outPath: path.join(dir, 'a.dump'),
      maxBytes: 1_000_000,
      track: trackLive,
    })
    pending.catch(() => {})
    await waitForFile(path.join(dir, 'markers', 'pg_dump.started'))

    const [handle] = liveHandles
    assert.equal(handle.kind, 'docker-exec')
    assert.equal(handle.identityToken, '--snapshot=SNAP-1', 'the handle must carry its own token')
    const result = await handle.cancel(600)
    assert.equal(result.outcome, 'killed')
    assert.equal(
      result.containerSideEnded,
      null,
      'stopping the docker client says nothing about the container-side process',
    )
    await assert.rejects(pending)
  },
)

test('cancelling a local child does confirm the process ended', { timeout: T }, async () => {
  const dir = sandbox()
  withDoubles(dir, { FAKE_ENC_MODE: 'hang' })
  fs.writeFileSync(path.join(dir, 'in.dump'), 'PGDMP payload')
  const pending = runEncryption({
    argv: [path.join(dir, 'bin', 'age-double'), path.join(dir, 'in.dump')],
    outPath: path.join(dir, 'out.age'),
    maxOutputBytes: 1_000_000,
    track: trackLive,
  })
  pending.catch(() => {})
  await waitForFile(path.join(dir, 'markers', 'encryption.started'))

  const [handle] = liveHandles
  assert.equal(handle.kind, 'local')
  const result = await handle.cancel(600)
  assert.equal(result.containerSideEnded, true, 'a local process CAN be confirmed stopped')
  await pending
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Confirmed stop → lock released. Uncertain → lock RETAINED.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Drive a real run to the point where `markerName` shows the stage's child is
 * live, abort it, and return everything a test needs to judge the outcome.
 */
async function abortDuring({ dir, modes, markerName, configOverrides = {} }) {
  withDoubles(dir, modes)
  const config = makeConfig(dir, configOverrides)
  const lockReleasedAt = []
  let handle = null
  const deps = realDeps(config, { lockReleasedAt, registerCleanup: (h) => (handle = h) })
  const logs = []
  const pending = produceBackupArtifact({ config, deps, log: (l) => logs.push(l), options: {} })
  let error = null
  pending.catch((err) => {
    error = err
  })

  await waitForFile(path.join(dir, 'markers', `${markerName}.started`))
  assert.ok(fs.existsSync(config.run.lockFile), 'the lock must be held while work is in flight')

  await handle.abort('lifecycle test')
  const deadline = Date.now() + 20_000
  while (error === null && Date.now() < deadline) await sleep(10)
  assert.ok(error, 'the aborted run must settle')
  assert.equal(
    error.code,
    'run_aborted',
    `expected run_aborted, got ${error.code}: ${error.message}`,
  )
  assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging must be removed')
  assert.equal(
    fs.existsSync(config.destination.dir) ? fs.readdirSync(config.destination.dir).length : 0,
    0,
    'an aborted run must publish nothing',
  )
  return { logs, config, lockReleasedAt, error }
}

test(
  'aborting during the dump: the probe confirms the command is gone, so the lock is released',
  { timeout: T },
  async () => {
    const dir = sandbox()
    const { logs, config, lockReleasedAt } = await abortDuring({
      dir,
      modes: { FAKE_DUMP_MODE: 'hang' },
      markerName: 'pg_dump',
    })
    assert.ok(
      logs.some((l) => /this says nothing about the container-side command/.test(l)),
      'the docker-exec caveat must be reported, not glossed over',
    )
    assert.ok(
      logs.some((l) => /container-side command confirmed gone/.test(l)),
      `expected a confirmation line, got:\n${logs.join('\n')}`,
    )
    const stoppedRaw = await waitForFile(path.join(dir, 'markers', 'pg_dump.stopped'))
    const stoppedAt = Number(stoppedRaw.split(' ')[1])
    assert.equal(lockReleasedAt.length, 1, 'the lock must be released exactly once')
    assert.ok(
      stoppedAt <= lockReleasedAt[0],
      `the child stopped at ${stoppedAt} but the lock went at ${lockReleasedAt[0]} — ` +
        `exclusion must be held until the work has stopped`,
    )
    assert.equal(fs.existsSync(config.run.lockFile), false)
  },
)

test(
  'aborting during archive validation releases the lock once pg_restore is confirmed gone',
  { timeout: T },
  async () => {
    const dir = sandbox()
    const { config } = await abortDuring({
      dir,
      modes: { FAKE_DUMP_MODE: 'ok', FAKE_RESTORE_MODE: 'hang' },
      markerName: 'pg_restore',
    })
    assert.equal(fs.existsSync(config.run.lockFile), false)
  },
)

test(
  'aborting during encryption releases the lock — a local child can be confirmed stopped',
  { timeout: T },
  async () => {
    const dir = sandbox()
    const { config } = await abortDuring({
      dir,
      modes: { FAKE_DUMP_MODE: 'ok', FAKE_RESTORE_MODE: 'ok', FAKE_ENC_MODE: 'hang' },
      markerName: 'encryption',
    })
    assert.equal(fs.existsSync(config.run.lockFile), false)
  },
)

test(
  'a container-side command that OUTLIVES the docker client retains the lock',
  { timeout: T },
  async () => {
    // The double ignores SIGTERM, so only SIGKILL stops the client and its `ps`
    // entry survives — exactly what an orphaned container-side pg_dump looks
    // like. Exclusion must not be given up on the strength of the client dying.
    const dir = sandbox()
    const { logs, config } = await abortDuring({
      dir,
      modes: { FAKE_DUMP_MODE: 'hang-ignore-term' },
      markerName: 'pg_dump',
    })
    assert.ok(
      logs.some((l) => /STILL RUNNING inside/.test(l)),
      `expected the probe to report the command still listed:\n${logs.join('\n')}`,
    )
    assert.ok(
      logs.some((l) => /EXCLUSION RETAINED/.test(l)),
      `expected an explicit retention line:\n${logs.join('\n')}`,
    )
    assert.ok(fs.existsSync(config.run.lockFile), 'the lock MUST be retained')
    const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
    assert.equal(held.retained, true)
    assert.match(held.reason, /could not confirm/)
    assert.ok(
      held.unconfirmed.some((u) => /still listed/.test(u.outcome)),
      JSON.stringify(held.unconfirmed),
    )
    assert.match(held.recovery, /Do NOT kill/)

    // And the next producer is refused because of it.
    const next = makeConfig(dir)
    let nextError = null
    try {
      await produceBackupArtifact({
        config: next,
        deps: realDeps(next),
        log: () => {},
        options: {},
      })
    } catch (err) {
      nextError = err
    }
    assert.equal(nextError?.code, 'lock_retained_uncertain')
    assert.match(nextError.message, /still listed/)
  },
)

test('a container probe that cannot answer retains the lock', { timeout: T }, async () => {
  const dir = sandbox()
  const { logs, config } = await abortDuring({
    dir,
    modes: { FAKE_DUMP_MODE: 'hang', FAKE_PS_MODE: 'fail' },
    markerName: 'pg_dump',
  })
  assert.ok(
    logs.some((l) => /probe could not answer/.test(l)),
    `expected the probe to report failure:\n${logs.join('\n')}`,
  )
  assert.ok(fs.existsSync(config.run.lockFile), 'an unanswerable probe must retain the lock')
  const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
  assert.ok(held.unconfirmed.some((u) => /probe unavailable/.test(u.outcome)))
})

test(
  'a container probe that hangs is bounded, and still retains the lock',
  { timeout: T },
  async () => {
    const dir = sandbox()
    const started = Date.now()
    const { config } = await abortDuring({
      dir,
      modes: { FAKE_DUMP_MODE: 'hang', FAKE_PS_MODE: 'hang' },
      markerName: 'pg_dump',
      configOverrides: { run: { containerProbeTimeoutMs: 700 } },
    })
    const elapsed = Date.now() - started
    assert.ok(elapsed < 25_000, `teardown took ${elapsed}ms — the probe must be bounded`)
    assert.ok(fs.existsSync(config.run.lockFile), 'a timed-out probe must retain the lock')
  },
)

test(
  'the forced synchronous teardown retains the lock and records recovery steps',
  { timeout: T },
  async () => {
    const dir = sandbox()
    withDoubles(dir, { FAKE_DUMP_MODE: 'hang' })
    const config = makeConfig(dir)
    let handle = null
    const deps = realDeps(config, { registerCleanup: (h) => (handle = h) })
    const pending = produceBackupArtifact({ config, deps, log: () => {}, options: {} })
    pending.catch(() => {})
    await waitForFile(path.join(dir, 'markers', 'pg_dump.started'))

    // The second-signal / `process.on('exit')` path: SIGKILL, no awaiting, no
    // probe. It cannot establish anything, so it must not release exclusion.
    handle.emergency()

    assert.ok(fs.existsSync(config.run.lockFile), 'a forced teardown must retain the lock')
    const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
    assert.equal(held.retained, true)
    assert.match(held.reason, /forced synchronous teardown/)
    assert.ok(held.unconfirmed.some((u) => u.kind === 'docker-exec'))
    assert.match(held.recovery, /ps -A -o args=/)
    assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging is still dropped')
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// 5. Bounded deadlines.
// ─────────────────────────────────────────────────────────────────────────────

async function expectTimeout({ dir, modes, markerName }) {
  withDoubles(dir, modes)
  const config = makeConfig(dir, {
    run: { operationTimeoutMs: 900, cancelGraceMs: 300, containerProbeTimeoutMs: 500 },
  })
  const deps = realDeps(config)
  let error = null
  try {
    await produceBackupArtifact({ config, deps, log: () => {}, options: {} })
  } catch (err) {
    error = err
  }
  assert.ok(error, 'a hung boundary must not hang the run')
  assert.equal(error.code, 'operation_timeout', `${error.code}: ${error.message}`)
  await waitForFile(path.join(dir, 'markers', `${markerName}.stopped`))
  assert.deepEqual(fs.readdirSync(config.staging.root), [], 'a timed-out run must clean up staging')
  return config
}

test(
  'a hung pg_dump hits run.operationTimeoutMs, is cancelled, and frees the lock once confirmed',
  { timeout: T },
  async () => {
    const config = await expectTimeout({
      dir: sandbox(),
      modes: { FAKE_DUMP_MODE: 'hang' },
      markerName: 'pg_dump',
    })
    assert.equal(fs.existsSync(config.run.lockFile), false)
  },
)

test(
  'a hung encryption tool hits run.operationTimeoutMs, is cancelled, and frees the lock',
  { timeout: T },
  async () => {
    const config = await expectTimeout({
      dir: sandbox(),
      modes: { FAKE_DUMP_MODE: 'ok', FAKE_RESTORE_MODE: 'ok', FAKE_ENC_MODE: 'hang' },
      markerName: 'encryption',
    })
    assert.equal(fs.existsSync(config.run.lockFile), false)
  },
)

test(
  'a lock left by a process that died outright is refused, not reclaimed',
  { timeout: T },
  async () => {
    const dir = sandbox()
    const config = makeConfig(dir)
    fs.writeFileSync(
      config.run.lockFile,
      JSON.stringify({
        runId: 'killed-9',
        pid: 999_999,
        host: 'lifecycle-test-host',
        startedAt: 1,
      }),
    )
    withDoubles(dir, { FAKE_DUMP_MODE: 'ok' })
    let error = null
    try {
      await produceBackupArtifact({ config, deps: realDeps(config), log: () => {}, options: {} })
    } catch (err) {
      error = err
    }
    assert.equal(error?.code, 'lock_stale')
    assert.ok(fs.existsSync(config.run.lockFile), 'the stale lock must be left for the operator')
  },
)

test('a dump that fails outright is reported with its stderr', { timeout: T }, async () => {
  const dir = sandbox()
  withDoubles(dir, { FAKE_DUMP_MODE: 'fail' })
  const config = makeConfig(dir)
  let error = null
  try {
    await produceBackupArtifact({ config, deps: realDeps(config), log: () => {}, options: {} })
  } catch (err) {
    error = err
  }
  assert.equal(error?.code, 'dump_failed')
  assert.match(error.message, /connection to server was lost/)
  assert.deepEqual(fs.readdirSync(config.staging.root), [])
  assert.equal(fs.existsSync(config.run.lockFile), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. The CLI, interrupted for real.
// ─────────────────────────────────────────────────────────────────────────────

function writeCliConfig(dir) {
  const configPath = path.join(dir, 'config.json')
  const config = {
    source: { container: 'eanhl-fake-db-1', database: 'eanhl_scratch_x', user: 'eanhl_test' },
    manifest: {
      criticalTables: ['public.matches'],
      migrations: { schema: 'drizzle', table: '__drizzle_migrations', idColumn: 'id' },
      imageRefs: null,
    },
    encryption: {
      executable: path.join(dir, 'bin', 'age-double'),
      recipientFile: path.join(dir, 'recipient.pub'),
      expectedHeader: AGE_HEADER,
    },
    staging: {
      root: path.join(dir, 'staging'),
      minFreeBytes: 1024,
      backingVolume: null,
      maxPlaintextBytes: 4194304,
      maxStagingBytes: 8388608,
      maxCiphertextBytes: 8388608,
      shredPlaintext: true,
    },
    destination: { dir: path.join(dir, 'dest'), minFreeBytes: 1024, backingVolume: null },
    run: {
      lockFile: path.join(dir, 'producer.lock'),
      lockStaleAfterMs: 600000,
      operationTimeoutMs: 30000,
      cancelGraceMs: 500,
      containerProbeTimeoutMs: 3000,
      artifactPrefix: 'eanhl-cli',
      fullArchiveReadDefault: false,
    },
  }
  fs.writeFileSync(configPath, JSON.stringify(config))
  return { configPath, config }
}

/**
 * Launch the CLI and wait until its dump child has actually started.
 *
 * WHY THIS IS MORE THAN A `waitForFile`
 * -------------------------------------
 * There are three ways this wait can end and only one of them used to be
 * visible. The marker can appear (the run is live and can be signalled); the
 * marker deadline can expire while the CLI is still running (something is slow
 * or stuck); or the CLI can DIE before ever getting as far as `pg_dump` — a
 * rejected config, an executable it could not resolve, an unhandled throw. In
 * that third case the CLI's own stderr already says exactly what went wrong,
 * and the old code discarded it: it polled a marker that could no longer be
 * written by anybody, burned the full 20 s, and then failed on
 * `timed out … waiting for …/markers/pg_dump.started` — a message about the
 * symptom that names none of the cause. A reviewer seeing that has no way to
 * tell an early exit from a slow start.
 *
 * So spawn failure and process exit are observed from the moment of launch and
 * raced against the marker. Whichever happens first decides the outcome, and an
 * early exit fails PROMPTLY with the exit code, the signal and the child's own
 * bounded output.
 *
 * EVENT SAFETY. `close` is recorded once, the instant it fires, and handed back
 * as an already-settled promise. Attaching a `close` listener later — after the
 * marker wait, as the callers used to — misses an exit that already happened
 * and hangs to the per-test ceiling instead. Neither side of the race rejects:
 * the loser stays pending and quiet, so no unhandled rejection can reach the
 * `after` assertion.
 */

/** Keep a bounded tail of a child's output: enough to diagnose, never unbounded. */
const CAPTURE_BYTES = 262_144
const REPORT_BYTES = 4_000

function reportSlice(text, label) {
  if (text.length === 0) return `${label}: (empty)`
  const tail = text.slice(-REPORT_BYTES)
  const elided = text.length > REPORT_BYTES ? ` (last ${REPORT_BYTES} of ${text.length} chars)` : ''
  return `${label}${elided}:\n${tail}`
}

async function runCliUntilDump(dir, configPath, childEnv) {
  const marker = path.join(dir, 'markers', 'pg_dump.started')
  const child = spawn(process.execPath, [CLI, '--config', configPath], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  liveProcesses.add(child)

  let stderr = ''
  let stdout = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (d) => {
    stderr = (stderr + d).slice(-CAPTURE_BYTES)
  })
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (d) => {
    stdout = (stdout + d).slice(-CAPTURE_BYTES)
  })
  // A broken pipe after the child is gone is not a test failure.
  for (const stream of [child.stdout, child.stderr]) stream?.on('error', () => {})

  /** @type {{code: number|null, signal: string|null, spawnError: Error|null}|null} */
  let ended = null
  let announceEnd = () => {}
  const closed = new Promise((resolve) => {
    announceEnd = resolve
  })
  const finish = (outcome) => {
    if (ended) return
    ended = outcome
    announceEnd(outcome)
  }
  // 'error' means the spawn itself failed (ENOENT/EACCES on the interpreter);
  // 'close' means the process ended and its pipes are drained. Either can come
  // first, and after an 'error' both may arrive — `finish` keeps the first.
  child.on('error', (err) => finish({ code: null, signal: null, spawnError: err }))
  child.on('close', (code, signal) => finish({ code, signal, spawnError: null }))

  const launchedAt = Date.now()
  // Abandoning the poll the moment the child is gone is what keeps a fast
  // failure fast: a still-polling `waitForFile` holds this file's process open
  // for the rest of its deadline even after the test itself has failed.
  const abandon = new AbortController()
  const outcome = await Promise.race([
    waitForFile(marker, 20_000, abandon.signal).then(
      () => ({ kind: 'marker' }),
      (err) => ({ kind: 'marker-timeout', err }),
    ),
    closed.then(() => {
      abandon.abort('the CLI exited before the marker appeared')
      return { kind: 'ended' }
    }),
  ])

  if (outcome.kind === 'marker') return { child, stderr: () => stderr, closed }

  const elapsed = Date.now() - launchedAt
  const markerExists = fs.existsSync(marker)
  const header =
    outcome.kind === 'ended'
      ? ended.spawnError
        ? `the backup CLI could not be spawned: ${ended.spawnError.code ?? ''} ${ended.spawnError.message}`
        : `the backup CLI EXITED after ${elapsed}ms without reaching pg_dump ` +
          `(exit code ${ended.code}, signal ${ended.signal})`
      : `the backup CLI is still running but produced no ${path.basename(marker)} marker ` +
        `within ${elapsed}ms (pid ${child.pid}, state ${procState(child.pid)})`

  let markerDir = '(unreadable)'
  let binDir = '(unreadable)'
  try {
    markerDir = JSON.stringify(fs.readdirSync(path.join(dir, 'markers')))
  } catch (err) {
    markerDir = `(${err?.code ?? err?.message})`
  }
  try {
    binDir = JSON.stringify(fs.readdirSync(path.join(dir, 'bin')))
  } catch (err) {
    binDir = `(${err?.code ?? err?.message})`
  }

  const details = [
    header,
    `sandbox: ${dir}`,
    `interpreter: ${process.execPath}`,
    `PATH given to the CLI: ${childEnv.PATH}`,
    `marker awaited: ${marker} (exists now: ${markerExists})`,
    `markers dir: ${markerDir}`,
    `bin dir: ${binDir}`,
    reportSlice(stderr, 'CLI stderr'),
    reportSlice(stdout, 'CLI stdout'),
  ].join('\n')

  // Three destinations on purpose. The thrown message reaches TAP; the direct
  // stderr write and the watchdog's stall log reach a reporter that shows only
  // a file-level failure; the sandbox copy survives even if both are truncated.
  preserved.add(dir)
  try {
    fs.writeFileSync(path.join(dir, 'cli-diagnostics.txt'), details + '\n')
  } catch {
    /* diagnostics must never throw */
  }
  try {
    watchdog.report(`runCliUntilDump failed — ${header} (evidence: ${dir}/cli-diagnostics.txt)`)
  } catch {
    /* diagnostics must never throw */
  }

  if (outcome.kind === 'marker-timeout') {
    throw new Error(`${details}\noriginal wait error: ${outcome.err?.message}`)
  }
  throw new Error(details)
}

test(
  'SIGINT to the CLI stops the child, confirms it, releases the lock, and exits 130',
  { timeout: T },
  async () => {
    const dir = sandbox()
    const { configPath, config } = writeCliConfig(dir)
    const childEnv = {
      ...process.env,
      PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
      FAKE_MARKER_DIR: path.join(dir, 'markers'),
      FAKE_DUMP_MODE: 'hang',
    }
    const { child, stderr, closed } = await runCliUntilDump(dir, configPath, childEnv)
    assert.ok(fs.existsSync(config.run.lockFile), 'the CLI must hold the lock while dumping')

    child.kill('SIGINT')
    const { code, signal } = await closed

    assert.equal(
      code,
      130,
      `expected exit 130 for an operator signal, got code ${code} signal ${signal}\n${stderr()}`,
    )
    await waitForFile(path.join(dir, 'markers', 'pg_dump.stopped'))
    assert.match(stderr(), /cancelling 1 active operation/)
    assert.match(stderr(), /FAILED \[run_aborted\]/)
    assert.equal(fs.existsSync(config.run.lockFile), false, `lock survived the signal\n${stderr()}`)
    assert.deepEqual(fs.readdirSync(config.staging.root), [], `staging survived\n${stderr()}`)
  },
)

test(
  'SIGINT with an orphaned container-side command exits 130 AND retains the lock',
  { timeout: T },
  async () => {
    // Bounded exit and retained exclusion are compatible: the CLI still stops
    // promptly, but it does not trade mutual exclusion for that promptness.
    const dir = sandbox()
    const { configPath, config } = writeCliConfig(dir)
    const childEnv = {
      ...process.env,
      PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`,
      FAKE_MARKER_DIR: path.join(dir, 'markers'),
      FAKE_DUMP_MODE: 'hang-ignore-term',
    }
    const { child, stderr, closed } = await runCliUntilDump(dir, configPath, childEnv)

    const signalledAt = Date.now()
    child.kill('SIGINT')
    const { code, signal } = await closed
    const elapsed = Date.now() - signalledAt

    assert.equal(code, 130, `expected 130, got code ${code} signal ${signal}\n${stderr()}`)
    assert.ok(elapsed < 25_000, `the CLI took ${elapsed}ms to exit — it must stay bounded`)
    assert.match(stderr(), /EXCLUSION RETAINED/)
    assert.ok(fs.existsSync(config.run.lockFile), `the lock must be retained\n${stderr()}`)
    const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
    assert.equal(held.retained, true)
    assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging is still dropped')

    // A subsequent CLI run is refused, with the reason, and does not run.
    const again = spawnSync(process.execPath, [CLI, '--config', configPath], {
      env: childEnv,
      encoding: 'utf8',
      timeout: 20_000,
    })
    assert.equal(again.status, 1)
    assert.match(again.stderr, /FAILED \[lock_retained_uncertain\]/)
    assert.match(again.stderr, /RECOVERY/)
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// 7. Internally initiated terminations are accounted for end to end.
//
// The defect these pin: the bounded writer SIGKILLs the docker client on a byte
// ceiling breach or an output failure, and `settle()` then untracked the handle
// unconditionally. By the time teardown ran the operation had disappeared, so
// no container probe happened and exclusion was released on no evidence at all.
// Reproduced as: one handle registered, zero remaining after the call.
// ─────────────────────────────────────────────────────────────────────────────

test(
  'an oversized dump whose container command is still listed retains the lock',
  { timeout: T },
  async () => {
    const dir = sandbox()
    // `big` writes forever and publishes a container-visible command line; the
    // byte ceiling SIGKILLs the client, so the double's exit handler never runs
    // and its `ps` entry survives — an orphaned container-side dump.
    withDoubles(dir, { FAKE_DUMP_MODE: 'big', FAKE_PS_MODE: 'ok' })
    const config = makeConfig(dir, { staging: { maxPlaintextBytes: 65_536 } })
    const probeCalls = []
    const logs = []
    let error = null
    try {
      await produceBackupArtifact({
        config,
        deps: realDeps(config, { probeCalls }),
        log: (l) => logs.push(l),
        options: {},
      })
    } catch (err) {
      error = err
    }

    assert.equal(error?.code, 'staging_budget_exceeded', `${error?.code}: ${error?.message}`)
    assert.equal(probeCalls.length, 1, 'the internally killed dump must still be probed')
    assert.ok(
      logs.some((l) => /terminated by this run \(byte ceiling/.test(l)),
      `teardown must name the internal termination:\n${logs.join('\n')}`,
    )
    assert.ok(
      logs.some((l) => /STILL RUNNING inside/.test(l)),
      `the probe must report the surviving command:\n${logs.join('\n')}`,
    )
    assert.ok(fs.existsSync(config.run.lockFile), 'the lock MUST be retained')
    const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
    assert.equal(held.retained, true)
    assert.ok(held.unconfirmed.some((u) => /still listed/.test(u.outcome)))
    assert.deepEqual(fs.readdirSync(config.staging.root), [], 'staging is still cleaned up')

    // 4. The next producer refuses because termination stayed uncertain.
    const next = makeConfig(dir)
    let nextError = null
    try {
      await produceBackupArtifact({
        config: next,
        deps: realDeps(next),
        log: () => {},
        options: {},
      })
    } catch (err) {
      nextError = err
    }
    assert.equal(nextError?.code, 'lock_retained_uncertain')
    assert.match(nextError.message, /pg_dump/)
  },
)

test(
  'an output-write failure with an unavailable container probe retains the lock',
  { timeout: T },
  async () => {
    const dir = sandbox()
    // A real dump child, a real ENOSPC on a real write, and a probe that cannot
    // answer. Only the output PATH is substituted (`/dev/full`), because the
    // producer picks the staging path itself and a full filesystem cannot be
    // conjured inside a test.
    withDoubles(dir, { FAKE_DUMP_MODE: 'big', FAKE_PS_MODE: 'fail' })
    const config = makeConfig(dir)
    const probeCalls = []
    const logs = []
    const deps = realDeps(config, { probeCalls })
    const base = deps.runDump
    deps.runDump = (args) => base({ ...args, outPath: '/dev/full' })

    let error = null
    try {
      await produceBackupArtifact({ config, deps, log: (l) => logs.push(l), options: {} })
    } catch (err) {
      error = err
    }

    assert.equal(error?.code, 'dump_failed', `${error?.code}: ${error?.message}`)
    assert.match(error.message, /ENOSPC/)
    assert.equal(probeCalls.length, 1, 'an output failure must still be probed')
    assert.ok(
      logs.some((l) => /probe could not answer/.test(l)),
      `the unavailable probe must be reported:\n${logs.join('\n')}`,
    )
    assert.ok(fs.existsSync(config.run.lockFile), 'an unanswerable probe must retain the lock')
    const held = JSON.parse(fs.readFileSync(config.run.lockFile, 'utf8'))
    assert.ok(held.unconfirmed.some((u) => /probe unavailable/.test(u.outcome)))
    assert.deepEqual(fs.readdirSync(config.staging.root), [])
  },
)

test(
  'an internally killed dump whose container command IS gone cleans up and releases',
  { timeout: T },
  async () => {
    const dir = sandbox()
    // Same internal termination, but the container answers and does not list
    // our command: termination is established, so exclusion is given up.
    withDoubles(dir, { FAKE_DUMP_MODE: 'big', FAKE_PS_MODE: 'empty' })
    const config = makeConfig(dir, { staging: { maxPlaintextBytes: 65_536 } })
    const probeCalls = []
    const logs = []
    let error = null
    try {
      await produceBackupArtifact({
        config,
        deps: realDeps(config, { probeCalls }),
        log: (l) => logs.push(l),
        options: {},
      })
    } catch (err) {
      error = err
    }

    assert.equal(error?.code, 'staging_budget_exceeded')
    assert.equal(probeCalls.length, 1)
    assert.ok(
      logs.some((l) => /container-side command confirmed gone/.test(l)),
      `expected a confirmation line:\n${logs.join('\n')}`,
    )
    assert.equal(fs.existsSync(config.run.lockFile), false, 'confirmed ⇒ the lock is released')
    assert.deepEqual(fs.readdirSync(config.staging.root), [])

    // And the next producer is free to run.
    const next = makeConfig(dir, { staging: { maxPlaintextBytes: 65_536 } })
    let nextError = null
    try {
      await produceBackupArtifact({
        config: next,
        deps: realDeps(next),
        log: () => {},
        options: {},
      })
    } catch (err) {
      nextError = err
    }
    assert.equal(nextError?.code, 'staging_budget_exceeded', 'it ran, rather than being refused')
  },
)

test('an ordinary completed run leaks no handle and is never probed', { timeout: T }, async () => {
  const dir = sandbox()
  withDoubles(dir, {
    FAKE_DUMP_MODE: 'ok',
    FAKE_DUMP_BYTES: '4096',
    FAKE_RESTORE_MODE: 'ok',
    FAKE_ENC_MODE: 'ok',
  })
  const config = makeConfig(dir)
  const probeCalls = []
  const report = await produceBackupArtifact({
    config,
    deps: realDeps(config, { probeCalls }),
    log: () => {},
    options: { fullArchiveRead: true },
  })
  assert.ok(report.artifactBase)
  // Children that ended on their own are ordinary completions: no probe, no
  // retained handle, no retained lock.
  assert.equal(probeCalls.length, 0, 'a clean run must not probe the container')
  assert.equal(fs.existsSync(config.run.lockFile), false)
  assert.deepEqual(fs.readdirSync(config.staging.root), [])
})

test(
  'a pg_dump that exits non-zero on its own is an ordinary completion, not an internal kill',
  { timeout: T },
  async () => {
    const dir = sandbox()
    withDoubles(dir, { FAKE_DUMP_MODE: 'fail' })
    const config = makeConfig(dir)
    const probeCalls = []
    let error = null
    try {
      await produceBackupArtifact({
        config,
        deps: realDeps(config, { probeCalls }),
        log: () => {},
        options: {},
      })
    } catch (err) {
      error = err
    }
    assert.equal(error?.code, 'dump_failed')
    assert.equal(probeCalls.length, 0, 'the container-side command ended by itself')
    assert.equal(fs.existsSync(config.run.lockFile), false)
  },
)
