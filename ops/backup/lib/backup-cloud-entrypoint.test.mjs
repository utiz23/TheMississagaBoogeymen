/**
 * `eanhl-backup-cloud` entrypoint — E3J6C (REAL subprocesses and REAL signals).
 *
 * The production executable `ops/backup/eanhl-backup-cloud.mjs` is spawned
 * with `node`, exactly as an operator would invoke it, against a disposable
 * sandbox whose Proton CLI is `testdoubles/fake-proton-drive.mjs` and whose
 * readback wrapper is the host's own `/usr/bin/prlimit`. No test runs the
 * real Proton Drive CLI, contacts a provider, or reads a credential.
 *
 * The one pre-lock signal test that must stop a real process at a precise
 * point uses `testdoubles/cloud-entrypoint-harness.mjs`, which differs from
 * the executable ONLY in its pre-lock checkpoint (a stdin gate). In-process
 * tests drive the internal entrypoint core with a fake emitter for listener
 * hygiene and the forced-exit ordering.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  REAL_ENTRYPOINT_DEPS,
  USAGE,
  exitStatusFor,
  makeCloudEntrypoint,
  projectCloudRunSummary,
} from './internal/backup-cloud-entrypoint-core.mjs'
import { makeCloudRunner } from './internal/backup-cloud-run-core.mjs'
import {
  BASE,
  HAS_REAL_PRLIMIT,
  NOT_FOUND,
  REAL_PRLIMIT,
  makeCloudRunSandbox,
  objectOccupiedSteps,
  rawInfo,
  verifiedAttemptSteps,
} from './testdoubles/cloud-run-sandbox.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-entrypoint', warnAfterMs: 10_000, intervalMs: 5_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ENTRYPOINT = path.resolve(HERE, '..', 'eanhl-backup-cloud.mjs')
const HARNESS = path.join(HERE, 'testdoubles', 'cloud-entrypoint-harness.mjs')
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const MARKER = 'SECRET-MARKER-e3j6c-entry-3f9a'
const T = 60_000
const skipNoPrlimit = {
  timeout: T,
  skip: HAS_REAL_PRLIMIT ? false : `${REAL_PRLIMIT} is not present`,
}

// ── process and sandbox hygiene ──────────────────────────────────────────────

const sandboxes = []
const liveChildren = new Set()
const orphanPids = new Set()
afterEach(() => {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* gone */
    }
  }
  liveChildren.clear()
  for (const pid of orphanPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* gone */
    }
  }
  orphanPids.clear()
  for (const sb of sandboxes.splice(0)) sb.cleanup()
})
after(() => {
  for (const child of liveChildren) child.kill('SIGKILL')
})

function sandbox(opts) {
  const sb = makeCloudRunSandbox(opts)
  sandboxes.push(sb)
  return sb
}

/** Spawn a script with node; collect stdout/stderr; resolve `{code, signal}` on close. */
function launch(script, args, { env = process.env, stdin = 'ignore' } = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    env,
    stdio: [stdin, 'pipe', 'pipe'],
  })
  liveChildren.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  const closed = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      liveChildren.delete(child)
      resolve({ code, signal })
    })
  })
  return { child, closed, stdout: () => stdout, stderr: () => stderr }
}

const entry = (args, opts) => launch(ENTRYPOINT, args, opts)
const runArgs = (sb, base = BASE) => ['--config', sb.configPath, '--artifact-base', base]

async function waitFor(predicate, what, timeoutMs = 20_000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const summaryOf = (out) => JSON.parse(out.trim().split('\n').at(-1))

/** No output may claim that a provider request or a remote write stopped. */
function assertHonest(text) {
  assert.equal(/remote[^\n]*\bstop/i.test(text), false, 'claims a remote stop')
  assert.equal(/write[^\n]*\b(stopped|cancelled|prevented|aborted)\b/i.test(text), false)
  assert.equal(/provider request[^\n]*\b(stopped|cancelled)\b/i.test(text), false)
}

function assertNoLeak(...texts) {
  for (const t of texts) {
    assert.equal(t.includes(MARKER), false, 'marker leaked')
    assert.equal(/\bat [\w.<>]+ \(/.test(t), false, 'stack text leaked')
    assert.equal(t.includes(os.tmpdir()), false, 'a local path leaked')
  }
}

/** A readback wrapper that hangs (the containment canary's child), pinned by hash. */
function hangingWrapper() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-hang-wrapper-'))
  const marker = path.join(dir, 'wrapper.started')
  const exe = path.join(dir, 'hang-wrapper')
  fs.writeFileSync(exe, `#!/bin/sh\n: > '${marker}'\nexec /bin/sleep 30\n`, { mode: 0o755 })
  return {
    exe,
    marker,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Exit-code matrix — the production executable
// ═════════════════════════════════════════════════════════════════════════════

test(
  'exit 0: a verified run prints one closed summary line, releases the lock, and runs only the four provider operations',
  skipNoPrlimit,
  async () => {
    const sb = sandbox()
    sb.respond(verifiedAttemptSteps(sb.bodies))
    const r = entry(runArgs(sb))
    const { code } = await r.closed
    assert.equal(code, 0, r.stderr())
    const lines = r.stdout().trim().split('\n')
    assert.equal(lines.length, 1)
    const s = summaryOf(r.stdout())
    assert.equal(s.outcome, 'verified')
    assert.equal(s.lock.state, 'released')
    assert.equal(fs.existsSync(sb.lockFile), false)
    for (const a of sb.argvLog()) {
      assert.ok(['info', 'create-folder', 'upload', 'download'].includes(a[1]), a.join(' '))
      for (const forbidden of [
        '-f',
        '--conflict-strategy',
        'trash',
        'delete',
        'empty-trash',
        'list',
        'auth',
        'login',
        'logout',
        'rename',
        'move',
        'copy',
        'share',
      ]) {
        assert.equal(a.includes(forbidden), false, forbidden)
      }
    }
    assertHonest(r.stderr())
    assertNoLeak(r.stdout(), r.stderr())
  },
)

test(
  'exit 1: a definite non-collision rejection is not retried and releases the lock',
  skipNoPrlimit,
  async () => {
    const sb = sandbox()
    sb.respond([NOT_FOUND]) // the pre-provisioned root is absent
    const r = entry(runArgs(sb))
    const { code } = await r.closed
    assert.equal(code, 1, r.stderr())
    const s = summaryOf(r.stdout())
    assert.equal(s.outcome, 'not_verified')
    assert.equal(s.attempts[0].code, 'remote_root_absent')
    assert.equal(s.attempts.length, 1)
    assert.equal(fs.existsSync(sb.lockFile), false)
  },
)

test(
  'exit 2: invalid invocations never echo their input and never create a lock',
  { timeout: T },
  async () => {
    const sb = sandbox()
    const unparseable = path.join(sb.dir, 'bad.json')
    fs.writeFileSync(unparseable, `{"cli": ${MARKER}`)
    const secretKey = path.join(sb.dir, 'secret.json')
    fs.writeFileSync(secretKey, JSON.stringify({ ...sb.config, [`token_${MARKER}`]: 'x' }))
    const cases = [
      [[], 'invalid invocation'],
      [[`--${MARKER}`], 'invalid invocation'],
      [['--config', sb.configPath], 'invalid invocation'],
      [
        ['--config', sb.configPath, '--config', sb.configPath, '--artifact-base', BASE],
        'invalid invocation',
      ],
      [
        ['--config', sb.configPath, '--artifact-base', `${MARKER}-20260904T180007Z`],
        'not a valid artifact identity',
      ],
      [
        ['--config', sb.configPath, '--artifact-base', '../escape'],
        'not a valid artifact identity',
      ],
      [['--config', unparseable, '--artifact-base', BASE], '[config_unparseable]'],
      [['--config', secretKey, '--artifact-base', BASE], '[config_secret_shaped_key]'],
      [
        ['--config', path.join(sb.dir, `missing-${MARKER}.json`), '--artifact-base', BASE],
        '[config_unreadable]',
      ],
    ]
    for (const [args, expected] of cases) {
      const r = entry(args)
      const { code } = await r.closed
      assert.equal(code, 2, `${args.join(' ')}: ${r.stderr()}`)
      assert.ok(r.stderr().includes(expected), r.stderr())
      assert.equal(r.stdout(), '')
      assertNoLeak(r.stderr())
    }
    assert.deepEqual(fs.readdirSync(sb.lockDir), [])
    const help = entry(['--help'])
    assert.equal((await help.closed).code, 0)
    assert.equal(help.stdout(), USAGE)
  },
)

test(
  'exit 3: a pre-existing lock is refused before any containment or provider work, byte-identical, never echoed',
  skipNoPrlimit,
  async () => {
    const sb = sandbox()
    fs.writeFileSync(sb.lockFile, `held by someone ${MARKER}\n`, { mode: 0o600 })
    const before = fs.readFileSync(sb.lockFile)
    const ino = fs.statSync(sb.lockFile).ino
    sb.respond(verifiedAttemptSteps(sb.bodies))
    const r = entry(runArgs(sb))
    const { code } = await r.closed
    assert.equal(code, 3, r.stderr())
    const s = summaryOf(r.stdout())
    assert.deepEqual(s.lock, { state: 'refused', code: 'lock_malformed' })
    assert.ok(fs.readFileSync(sb.lockFile).equals(before), 'lock bytes unchanged')
    assert.equal(fs.statSync(sb.lockFile).ino, ino)
    assert.equal(sb.invocations(), 0)
    assert.deepEqual(fs.readdirSync(sb.readbackDir), [])
    assert.deepEqual(fs.readdirSync(sb.attestationDir), [])
    assertNoLeak(r.stdout(), r.stderr())
  },
)

test(
  'exit 4: an attempt whose lock action is retain leaves the lock in place and says so',
  skipNoPrlimit,
  async () => {
    const sb = sandbox()
    fs.chmodSync(sb.attestationDir, 0o750) // untrusted -> no durable record -> retain_attestation_unconfirmed
    sb.respond(verifiedAttemptSteps(sb.bodies))
    const r = entry(runArgs(sb))
    const { code } = await r.closed
    assert.equal(code, 4, r.stderr())
    const s = summaryOf(r.stdout())
    assert.deepEqual(s.lock, { state: 'retained', code: 'retain_attestation_unconfirmed' })
    assert.equal(s.outcome, 'lock_unsettled')
    assert.ok(fs.existsSync(sb.lockFile), 'the lock is retained')
    assert.match(r.stderr(), /run lock was NOT released cleanly/)
    assert.equal(sb.invocations(), 0, 'no attestation directory, no provider call')
  },
)

test(
  'leaks: markers in provider output and in the environment never reach stdout or stderr',
  skipNoPrlimit,
  async () => {
    const sb = sandbox()
    sb.respond([
      { stdout: rawInfo('folder', `root-${MARKER}`), stderr: `${MARKER} provider says hi\n` },
    ])
    const r = entry(runArgs(sb), {
      env: { ...process.env, PROTON_TOKEN: MARKER, EANHL_NOTE: MARKER },
    })
    const { code } = await r.closed
    assert.equal(code, 1, r.stderr())
    assertNoLeak(r.stdout(), r.stderr())
    assert.equal(fs.existsSync(sb.lockFile), false)
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// Concurrency
// ═════════════════════════════════════════════════════════════════════════════

test(
  'concurrency: of two entrypoints only one reaches containment and provider work; the other exits 3',
  skipNoPrlimit,
  async () => {
    const sb = sandbox()
    const steps = verifiedAttemptSteps(sb.bodies).slice(0, 7)
    sb.respond([...steps, { hang: true }]) // the winner hangs in its ciphertext upload
    const winner = entry(runArgs(sb))
    await waitFor(() => sb.invocations() >= 8, 'the winner to reach its upload')
    await new Promise((r) => setTimeout(r, 200))
    const readbackBefore = fs.readdirSync(sb.readbackDir).sort()
    const recordsBefore = fs.readdirSync(sb.attestationDir).sort()
    const lockBefore = fs.readFileSync(sb.lockFile)

    const loser = entry(runArgs(sb))
    const lost = await loser.closed
    assert.equal(lost.code, 3, loser.stderr())
    assert.equal(summaryOf(loser.stdout()).lock.code, 'lock_held_live')
    assert.equal(sb.invocations(), 8, 'the loser made no provider call')
    assert.deepEqual(
      fs.readdirSync(sb.readbackDir).sort(),
      readbackBefore,
      'the loser ran no canary',
    )
    assert.deepEqual(
      fs.readdirSync(sb.attestationDir).sort(),
      recordsBefore,
      'the loser wrote no record',
    )
    assert.ok(fs.readFileSync(sb.lockFile).equals(lockBefore), 'lock bytes unchanged')

    winner.child.kill('SIGTERM')
    const won = await winner.closed
    assert.equal(won.code, 143, winner.stderr())
    assert.equal(fs.existsSync(sb.lockFile), false)
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// Signals — first signal at each stage
// ═════════════════════════════════════════════════════════════════════════════

test(
  'signal before lock: a REAL signal after the readiness marker and before acquisition -> no lock, no canary, no attempt (143 / 130)',
  skipNoPrlimit,
  async () => {
    for (const [sig, expected] of [
      ['SIGTERM', 143],
      ['SIGINT', 130],
    ]) {
      const sb = sandbox()
      sb.respond(verifiedAttemptSteps(sb.bodies))
      const r = launch(HARNESS, runArgs(sb), { stdin: 'pipe' })
      await waitFor(() => r.stderr().includes('HARNESS-PRE-LOCK-READY'), 'the pre-lock gate')
      assert.equal(fs.existsSync(sb.lockFile), false)
      r.child.kill(sig)
      await waitFor(() => r.stderr().includes('cancellation requested'), 'the signal listener')
      r.child.stdin.end('go\n')
      const { code } = await r.closed
      assert.equal(code, expected, r.stderr())
      const s = summaryOf(r.stdout())
      assert.deepEqual(s.lock, { state: 'not_attempted', code: null })
      assert.equal(s.outcome, 'cancelled')
      assert.equal(fs.existsSync(sb.lockFile), false)
      assert.deepEqual(fs.readdirSync(sb.readbackDir), [], 'no containment canary')
      assert.deepEqual(fs.readdirSync(sb.attestationDir), [], 'no attempt')
      assert.equal(sb.invocations(), 0)
      assertHonest(r.stderr())
    }
  },
)

test(
  'signal during containment: the canary child is stopped and confirmed, the lock is released, no attempt starts',
  { timeout: T },
  async () => {
    for (const [sig, expected] of [
      ['SIGTERM', 143],
      ['SIGINT', 130],
    ]) {
      const wrapper = hangingWrapper()
      try {
        const sb = sandbox({ wrapper: wrapper.exe })
        sb.respond(verifiedAttemptSteps(sb.bodies))
        const r = entry(runArgs(sb))
        await waitFor(() => fs.existsSync(wrapper.marker), 'the canary child')
        assert.ok(fs.existsSync(sb.lockFile), 'the lock is held during containment')
        r.child.kill(sig)
        const { code } = await r.closed
        assert.equal(code, expected, r.stderr())
        const s = summaryOf(r.stdout())
        assert.deepEqual(s.containment, { state: 'refused', code: 'canary_cancelled' })
        assert.equal(s.lock.state, 'released')
        assert.equal(s.attempts.length, 0)
        assert.equal(fs.existsSync(sb.lockFile), false)
        assert.deepEqual(fs.readdirSync(sb.attestationDir), [])
        assert.deepEqual(fs.readdirSync(sb.readbackDir), [], 'canary directory removed')
        assertHonest(r.stderr())
      } finally {
        wrapper.cleanup()
      }
    }
  },
)

test(
  'signal during an upload: the attempt is attested indeterminate, nothing further starts, the lock is released (143)',
  skipNoPrlimit,
  async () => {
    const sb = sandbox()
    sb.respond([...verifiedAttemptSteps(sb.bodies).slice(0, 7), { hang: true }])
    const r = entry(runArgs(sb))
    await waitFor(() => sb.invocations() >= 8, 'the upload child')
    await new Promise((res) => setTimeout(res, 200))
    r.child.kill('SIGTERM')
    const { code } = await r.closed
    assert.equal(code, 143, r.stderr())
    const s = summaryOf(r.stdout())
    assert.equal(s.attempts.length, 1)
    assert.equal(s.attempts[0].verdict, 'indeterminate')
    assert.equal(s.attempts[0].termination, 'confirmed')
    assert.equal(s.lock.state, 'released')
    assert.equal(s.outcome, 'cancelled')
    assert.equal(sb.records('.cloud-attestation.json').length, 1)
    const a = JSON.parse(
      fs.readFileSync(
        path.join(sb.attestationDir, sb.records('.cloud-attestation.json')[0]),
        'utf8',
      ),
    )
    assert.equal(a.upload_transfer_state, 'unknown')
    assert.equal(fs.existsSync(sb.lockFile), false)
    assertHonest(r.stderr())
    assertHonest(JSON.stringify(a))
  },
)

test(
  'signal during backoff: no further attempt, the lock is released (143)',
  skipNoPrlimit,
  async () => {
    const sb = sandbox({
      retry: { maxAttemptsPerArtifactPerRun: 2, maxTotalAttemptsPerRun: 2, backoffMs: 60_000 },
    })
    sb.respond([...objectOccupiedSteps(), ...verifiedAttemptSteps(sb.bodies)])
    const r = entry(runArgs(sb))
    await waitFor(() => sb.records('.cloud-attestation.json').length === 1, 'the first attestation')
    await new Promise((res) => setTimeout(res, 300))
    const started = Date.now()
    r.child.kill('SIGTERM')
    const { code } = await r.closed
    assert.ok(Date.now() - started < 15_000, 'the backoff was interrupted, not waited out')
    assert.equal(code, 143, r.stderr())
    const s = summaryOf(r.stdout())
    assert.equal(s.attempts.length, 1)
    assert.equal(s.attempts[0].retryDisposition, 'eligible_zero_transfer_collision')
    assert.equal(s.stopReason, 'cancelled')
    assert.equal(sb.invocations(), 5, 'only the first attempt called the provider')
    assert.equal(sb.records('.cloud-attempt-intent.json').length, 1)
    assert.equal(fs.existsSync(sb.lockFile), false)
  },
)

test(
  'second signal: exit 4 at once, the lock is retained by omission, the diagnostic is complete or absent',
  skipNoPrlimit,
  async () => {
    const sb = sandbox({ run: { operationTimeoutMs: 30_000, cancelGraceMs: 10_000 } })
    sb.respond([
      ...verifiedAttemptSteps(sb.bodies).slice(0, 7),
      { hang: true, ignoreSigterm: true },
    ])
    const r = entry(runArgs(sb))
    await waitFor(() => sb.invocations() >= 8, 'the upload child')
    await waitFor(
      () => fs.existsSync(path.join(sb.control, 'markers', 'proton.started')),
      'the child marker',
    )
    await new Promise((res) => setTimeout(res, 200))
    const childPid = Number(
      fs.readFileSync(path.join(sb.control, 'markers', 'proton.started'), 'utf8'),
    )
    if (Number.isSafeInteger(childPid) && childPid > 0) orphanPids.add(childPid)
    r.child.kill('SIGTERM')
    await waitFor(() => r.stderr().includes('cancellation requested'), 'the first signal')
    const started = Date.now()
    r.child.kill('SIGTERM')
    const { code } = await r.closed
    assert.ok(Date.now() - started < 3_000, 'the second signal exits at once')
    assert.equal(code, 4, r.stderr())
    assert.ok(fs.existsSync(sb.lockFile), 'the lock is retained by omission')
    const forced =
      '[eanhl-backup-cloud] second signal: exiting now. The run lock, if acquired, is not released. ' +
      'Child processes may still be running; nothing is known about remote state.\n'
    const err = r.stderr()
    assert.ok(
      err.includes(forced) || !err.includes('second signal'),
      'complete or absent, never partial',
    )
    assertHonest(err)
    assert.equal(r.stdout(), '', 'no summary on a forced exit')
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// In-process: the internal entrypoint core
// ═════════════════════════════════════════════════════════════════════════════

function fakeProc() {
  const emitter = new EventEmitter()
  const exits = []
  return {
    emitter,
    exits,
    proc: {
      on: (s, l) => emitter.on(s, l),
      off: (s, l) => emitter.off(s, l),
      exit: (c) => exits.push(c),
    },
  }
}

const tinyConfig = (sb) => fs.readFileSync(sb.configPath, 'utf8')

test(
  'listeners: SIGINT/SIGTERM listeners are installed once and removed on every path, across runs',
  { timeout: T },
  async () => {
    const sb = sandbox()
    const f = fakeProc()
    const summaries = [
      async () => {
        throw new Error(MARKER)
      },
      async () => ({ not: 'frozen' }),
    ]
    const seen = []
    const ep = makeCloudEntrypoint({
      proc: f.proc,
      writeStderr: () => {},
      writeStdout: () => {},
      readConfigFile: () => {
        seen.push([f.emitter.listenerCount('SIGINT'), f.emitter.listenerCount('SIGTERM')])
        return tinyConfig(sb)
      },
      runCloudBackup: (a) => (summaries.shift() ?? (async () => ({})))(a),
    })
    for (const argv of [runArgs(sb), runArgs(sb), [], ['--help'], runArgs(sb)]) {
      await ep.main(argv)
      assert.equal(f.emitter.listenerCount('SIGINT'), 0)
      assert.equal(f.emitter.listenerCount('SIGTERM'), 0)
    }
    assert.ok(
      seen.every(([a, b]) => a === 1 && b === 1),
      'installed BEFORE config parsing',
    )

    // The REAL process emitter too.
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
    const during = []
    const real = makeCloudEntrypoint({
      ...REAL_ENTRYPOINT_DEPS,
      writeStderr: () => {},
      writeStdout: () => {},
      runCloudBackup: async () => {
        during.push([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')])
        throw new Error(MARKER)
      },
    })
    assert.equal(await real.main(runArgs(sb)), 4)
    assert.equal(await real.main(['--nope']), 2)
    assert.equal(await real.main(runArgs(sb)), 4)
    assert.deepEqual(during, [
      [before[0] + 1, before[1] + 1],
      [before[0] + 1, before[1] + 1],
    ])
    assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before)
  },
)

test(
  'pre-lock: a signal dispatched DURING synchronous config parsing is observed at the checkpoint — no lock, 143',
  { timeout: T },
  async () => {
    const sb = sandbox()
    const f = fakeProc()
    const lockCalls = []
    const runner = makeCloudRunner({
      lock: {
        acquireRunLock: () => {
          lockCalls.push('acquire')
          return Object.freeze({ kind: 'refused', code: 'lock_held_live' })
        },
        verifyRunLockHeld: () => lockCalls.push('held'),
        releaseRunLock: () => lockCalls.push('release'),
        retainRunLock: () => lockCalls.push('retain'),
      },
      containment: {
        proveReadbackContainment: async () => lockCalls.push('prove'),
        verifyContainmentProof: () => true,
      },
      attempt: { runAttestedAttempt: async () => lockCalls.push('attempt') },
      now: () => Date.parse('2026-09-19T12:00:00.000Z'),
      randomToken: (n) => 'cd'.repeat(n),
      yieldBeforeLock: () => new Promise((r) => setImmediate(r)),
      sleep: async () => 'elapsed',
    })
    const out = []
    const ep = makeCloudEntrypoint({
      proc: f.proc,
      writeStderr: (b) => out.push(b.toString()),
      writeStdout: (b) => out.push(b.toString()),
      readConfigFile: () => {
        f.emitter.emit('SIGTERM') // the listener runs; parsing continues synchronously
        return tinyConfig(sb)
      },
      runCloudBackup: runner.runCloudBackup,
    })
    const code = await ep.main(runArgs(sb))
    assert.equal(code, 143)
    assert.deepEqual(
      f.exits,
      [],
      'a FIRST signal never exits early; the status is returned after the run settles',
    )
    assert.deepEqual(lockCalls, [], 'no lock, no containment, no attempt')
    const s = JSON.parse(out.find((l) => l.startsWith('{')))
    assert.deepEqual(s.lock, { state: 'not_attempted', code: null })
  },
)

test(
  'second signal (in-process): the fixed line is written SYNCHRONOUSLY before exit(4), with no await in between',
  { timeout: T },
  async () => {
    const sb = sandbox()
    const f = fakeProc()
    const order = []
    let release
    const pending = new Promise((r) => (release = r))
    const ep = makeCloudEntrypoint({
      proc: { ...f.proc, exit: (c) => order.push(`exit:${c}`) },
      writeStderr: (b) =>
        order.push(b.toString().includes('second signal') ? 'stderr:forced' : 'stderr:other'),
      writeStdout: () => {},
      readConfigFile: () => tinyConfig(sb),
      runCloudBackup: () => pending,
    })
    const running = ep.main(runArgs(sb))
    await new Promise((r) => setImmediate(r))
    f.emitter.emit('SIGINT')
    f.emitter.emit('SIGTERM')
    assert.deepEqual(
      order,
      ['stderr:other', 'stderr:forced', 'exit:4'],
      'synchronous, in this order',
    )
    release(null)
    await running
  },
)

test('exit mapping: outcome x recorded signal', () => {
  const s = (outcome) => ({ outcome })
  assert.equal(exitStatusFor(s('verified'), 'SIGTERM'), 0)
  assert.equal(exitStatusFor(s('not_verified'), null), 1)
  assert.equal(exitStatusFor(s('lock_refused'), 'SIGINT'), 3)
  assert.equal(exitStatusFor(s('lock_unsettled'), 'SIGTERM'), 4)
  assert.equal(exitStatusFor(s('cancelled'), 'SIGINT'), 130)
  assert.equal(exitStatusFor(s('cancelled'), 'SIGTERM'), 143)
  assert.equal(
    exitStatusFor(s('cancelled'), null),
    4,
    'cancelled with no recorded signal is incoherent',
  )
  assert.equal(exitStatusFor(s('mystery'), null), 4)
})

// ═════════════════════════════════════════════════════════════════════════════
// The summary projection boundary — the run's return value is UNTRUSTED here
// ═════════════════════════════════════════════════════════════════════════════

const SUMMARY_INVALID =
  '[eanhl-backup-cloud] internal error: the run summary failed validation and is not printed. ' +
  'Treat the run lock as unsettled.\n'
const P_RUN = '20260919T120000Z-0a1b2c3d'
const P_A0 = '20260919T120001Z-1a2b3c4d'
const P_A1 = '20260919T120002Z-2a3b4c5d'
const P_RETRY = Object.freeze({ maxAttemptsPerArtifactPerRun: 2, maxTotalAttemptsPerRun: 2 })

/** A coherent summary exactly as the run produces it: a collision, then a verified retry. */
function verifiedRunPlain() {
  return {
    kind: 'eanhl.cloud-run-summary',
    schemaVersion: 1,
    cloudRunId: P_RUN,
    artifactBase: BASE,
    outcome: 'verified',
    stopReason: 'verified',
    verifiedAttemptId: P_A1,
    cancellationRequested: false,
    lock: { state: 'released', code: null },
    containment: { state: 'proven', code: null },
    attempts: [
      {
        sequence: 0,
        attemptId: P_A0,
        verdict: 'rejected',
        stage: 'upload',
        code: 'remote_path_occupied',
        role: null,
        termination: 'confirmed',
        attestationWritten: true,
        cleanupState: 'complete',
        lockAction: 'release',
        retryDisposition: 'eligible_zero_transfer_collision',
      },
      {
        sequence: 1,
        attemptId: P_A1,
        verdict: 'verified',
        stage: null,
        code: null,
        role: null,
        termination: 'confirmed',
        attestationWritten: true,
        cleanupState: 'complete',
        lockAction: 'release',
        retryDisposition: 'not_eligible',
      },
    ],
  }
}

/** Deep-freeze through DATA properties only (never invokes a getter); `skip` objects stay unfrozen. */
function deepFreeze(v, skip = new Set()) {
  if (v === null || typeof v !== 'object' || skip.has(v) || Object.isFrozen(v)) return v
  for (const key of Reflect.ownKeys(v)) {
    const d = Object.getOwnPropertyDescriptor(v, key)
    if (Object.hasOwn(d, 'value')) deepFreeze(d.value, skip)
  }
  return Object.freeze(v)
}

/** Build a summary: start from the coherent plain one, mutate it, then deep-freeze. */
const summaryWith = (mutate = () => {}, skip) => {
  const plain = verifiedRunPlain()
  mutate(plain)
  return deepFreeze(plain, skip === undefined ? undefined : skip(plain))
}

/** Drive the REAL entrypoint core with a run that returns `value`; capture everything. */
async function probe(value, sb = sandbox()) {
  const out = { stdout: '', stderr: '' }
  const f = fakeProc()
  const ep = makeCloudEntrypoint({
    proc: f.proc,
    writeStderr: (b) => (out.stderr += b.toString('utf8')),
    writeStdout: (b) => (out.stdout += b.toString('utf8')),
    readConfigFile: () => fs.readFileSync(sb.configPath, 'utf8'),
    runCloudBackup: async () => value,
  })
  const code = await ep.main(runArgs(sb))
  return { code, ...out, exits: f.exits }
}

/** Refused: no summary, ONLY the fixed diagnostic, exit 4, and nothing attacker-controlled. */
function assertRefused(r, label) {
  assert.equal(r.code, 4, label)
  assert.equal(r.stdout, '', `${label}: no summary is printed`)
  assert.equal(r.stderr, SUMMARY_INVALID, `${label}: only the fixed diagnostic`)
  assert.deepEqual(r.exits, [])
  assert.equal((r.stdout + r.stderr).includes(MARKER), false, `${label}: marker leaked`)
}

const project = (v, retry = P_RETRY) => projectCloudRunSummary(v, { artifactBase: BASE, retry })

test('projection: a coherent summary prints exactly once, from a FRESH, deeply frozen, prototype-free copy', async () => {
  const original = summaryWith()
  const p = project(original)
  assert.notEqual(p, null)
  assert.notEqual(p, original)
  for (const obj of [p, p.lock, p.containment, p.attempts, p.attempts[0], p.attempts[1]]) {
    assert.ok(Object.isFrozen(obj))
    assert.equal(Object.getPrototypeOf(obj), null)
  }
  assert.ok(Array.isArray(p.attempts))
  assert.notEqual(p.lock, original.lock)
  assert.notEqual(p.attempts, original.attempts)
  assert.equal(JSON.stringify(p), JSON.stringify(original))

  const r = await probe(original)
  assert.equal(r.code, 0)
  const lines = r.stdout.split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  assert.deepEqual(JSON.parse(lines[0]), JSON.parse(JSON.stringify(original)))
  assert.equal(r.stderr.includes('failed validation'), false)
  assert.match(r.stderr, /attempt 1 20260919T120002Z-2a3b4c5d: verdict=verified/)
})

test('projection: other coherent outcomes keep their existing exit statuses and still print', async () => {
  const notVerified = summaryWith((s) => {
    s.outcome = 'not_verified'
    s.stopReason = 'not_retry_eligible'
    s.verifiedAttemptId = null
    s.attempts = [
      { ...s.attempts[0], code: 'remote_root_absent', retryDisposition: 'not_eligible' },
    ]
  })
  const refused = summaryWith((s) => {
    s.outcome = 'lock_refused'
    s.stopReason = 'lock_not_acquired'
    s.verifiedAttemptId = null
    s.lock = { state: 'refused', code: 'lock_held_live' }
    s.containment = { state: 'not_attempted', code: null }
    s.attempts = []
  })
  const retained = summaryWith((s) => {
    s.outcome = 'lock_unsettled'
    s.stopReason = 'attempt_lock_retained'
    s.lock = { state: 'retained', code: 'retain_internal_error' }
    s.attempts[1] = { ...s.attempts[1], lockAction: 'retain_internal_error' }
  })
  for (const [summary, code] of [
    [notVerified, 1],
    [refused, 3],
    [retained, 4],
  ]) {
    const r = await probe(summary)
    assert.equal(r.code, code)
    assert.equal(r.stdout.split('\n').filter(Boolean).length, 1, 'the summary IS printed')
    assert.equal(r.stderr.includes('failed validation'), false)
  }
})

test('projection: an extra enumerable secret-bearing property at ANY level cannot escape', async () => {
  const cases = [
    summaryWith((s) => (s.secret = MARKER)),
    summaryWith((s) => (s.lock.secret = MARKER)),
    summaryWith((s) => (s.containment.note = MARKER)),
    summaryWith((s) => (s.attempts[0].stderr = MARKER)),
    summaryWith((s) => (s.attempts.extra = MARKER)),
    summaryWith((s) => (s[Symbol('hidden')] = MARKER)),
  ]
  for (const [i, v] of cases.entries()) assertRefused(await probe(v), `extra key #${i}`)
})

test('projection: a hostile toJSON — own non-enumerable, nested, or inherited — never runs and never affects output', async () => {
  let calls = 0
  const hostile = () => {
    calls++
    return { leaked: MARKER }
  }
  const nonEnumerable = (obj) =>
    Object.defineProperty(obj, 'toJSON', { value: hostile, enumerable: false })
  const cases = [
    summaryWith((s) => nonEnumerable(s)),
    summaryWith((s) => nonEnumerable(s.lock)),
    summaryWith((s) => nonEnumerable(s.containment)),
    summaryWith((s) => nonEnumerable(s.attempts[1])),
    summaryWith((s) => nonEnumerable(s.attempts)),
    // an inherited toJSON on a custom prototype
    summaryWith((s) => Object.setPrototypeOf(s, { toJSON: hostile })),
    summaryWith((s) => Object.setPrototypeOf(s.lock, { toJSON: hostile })),
  ]
  for (const [i, v] of cases.entries()) assertRefused(await probe(v), `toJSON #${i}`)
  assert.equal(calls, 0, 'no hostile toJSON was ever invoked')

  // Even a polluted GLOBAL prototype cannot reach the prototype-free projection.
  const p = project(summaryWith())
  const clean = JSON.stringify(p)
  Object.defineProperty(Object.prototype, 'toJSON', { value: hostile, configurable: true })
  Object.defineProperty(Array.prototype, 'toJSON', { value: hostile, configurable: true })
  let polluted
  try {
    polluted = JSON.stringify(p)
  } finally {
    delete Object.prototype.toJSON
    delete Array.prototype.toJSON
  }
  assert.equal(polluted, clean)
  assert.equal(calls, 0)

  // ...and through the entrypoint itself: what reaches stdout is the
  // projection's serialization, never the untrusted original's.
  const valid = summaryWith()
  const baseline = await probe(valid)
  assert.equal(baseline.code, 0)
  const prepared = sandbox() // its config file is written BEFORE the pollution
  Object.defineProperty(Object.prototype, 'toJSON', { value: hostile, configurable: true })
  Object.defineProperty(Array.prototype, 'toJSON', { value: hostile, configurable: true })
  let underPollution
  try {
    underPollution = await probe(valid, prepared)
  } finally {
    delete Object.prototype.toJSON
    delete Array.prototype.toJSON
  }
  assert.equal(underPollution.code, 0)
  assert.equal(underPollution.stdout, baseline.stdout)
  assert.equal(underPollution.stdout.includes(MARKER), false)
  assert.equal(calls, 0)
})

test('projection: marker-bearing values in the summary, lock, containment, or an attempt are refused without leakage', async () => {
  const cases = [
    (s) => (s.outcome = MARKER),
    (s) => (s.stopReason = MARKER),
    (s) => (s.cloudRunId = `20260919T120000Z-${MARKER}`),
    (s) => (s.artifactBase = `${MARKER}-20260904T180007Z`),
    (s) => (s.verifiedAttemptId = MARKER),
    (s) => (s.kind = MARKER),
    (s) => (s.lock.state = MARKER),
    (s) => (s.lock.code = MARKER),
    (s) => (s.containment.state = MARKER),
    (s) => (s.containment.code = MARKER),
    (s) => (s.attempts[0].attemptId = MARKER),
    (s) => (s.attempts[0].code = MARKER),
    (s) => (s.attempts[0].stage = MARKER),
    (s) => (s.attempts[0].role = MARKER),
    (s) => (s.attempts[0].termination = MARKER),
    (s) => (s.attempts[0].cleanupState = MARKER),
    (s) => (s.attempts[0].lockAction = MARKER),
    (s) => (s.attempts[0].retryDisposition = MARKER),
    (s) => (s.attempts[1].verdict = MARKER),
    (s) => (s.lock = { toString: () => MARKER }),
    (s) => (s.attempts[1] = MARKER),
  ]
  for (const [i, mutate] of cases.entries())
    assertRefused(await probe(summaryWith(mutate)), `marker #${i}`)
})

test('projection: throwing and stateful getters are refused WITHOUT being invoked; a Proxy runs no trap', async () => {
  let getterCalls = 0
  const throwing = {
    enumerable: true,
    get() {
      getterCalls++
      throw new Error(MARKER)
    },
  }
  let reads = 0
  const stateful = {
    enumerable: true,
    get() {
      getterCalls++
      reads++
      return reads === 1 ? 'verified' : MARKER // valid while validated, hostile when serialized
    },
  }
  const withAccessor = (target, key, descriptor) => {
    delete target[key]
    Object.defineProperty(target, key, descriptor)
  }
  const cases = [
    summaryWith((s) => withAccessor(s, 'outcome', throwing)),
    summaryWith((s) => withAccessor(s, 'outcome', stateful)),
    summaryWith((s) => withAccessor(s.lock, 'code', throwing)),
    summaryWith((s) => withAccessor(s.containment, 'state', stateful)),
    summaryWith((s) => withAccessor(s.attempts[1], 'verdict', stateful)),
    summaryWith((s) => withAccessor(s.attempts, '0', throwing)),
    summaryWith((s) => withAccessor(s, 'attempts', { enumerable: true, get: throwing.get })),
  ]
  for (const [i, v] of cases.entries()) assertRefused(await probe(v), `accessor #${i}`)
  assert.equal(getterCalls, 0, 'no getter was ever invoked')

  // Every trap is recorded; the log is cleared after setup, immediately
  // before each probe, so it holds only what the ENTRYPOINT triggered.
  const trapLog = []
  const handler = new Proxy(
    {},
    {
      get:
        (_t, trap) =>
        (...args) => {
          trapLog.push(trap === 'get' ? `get:${String(args[1])}` : trap)
          return Reflect[trap](...args)
        },
    },
  )
  const proxiedSummary = new Proxy(summaryWith(), handler)
  const s2 = verifiedRunPlain()
  const proxiedLock = new Proxy(Object.freeze({ state: 'released', code: null }), handler)
  s2.lock = proxiedLock
  deepFreeze(s2, new Set([proxiedLock]))
  const s3 = verifiedRunPlain()
  const proxiedAttempts = new Proxy(deepFreeze(s3.attempts), handler)
  s3.attempts = proxiedAttempts
  deepFreeze(s3, new Set([proxiedAttempts]))
  for (const [label, v] of [
    ['proxied summary', proxiedSummary],
    ['proxied lock', s2],
    ['proxied attempts', s3],
  ]) {
    // The projection itself runs NO trap.
    trapLog.length = 0
    assert.equal(project(v), null)
    assert.deepEqual(trapLog, [], `${label}: the projection ran no Proxy trap`)
    // Through the entrypoint, the only access is JavaScript's own promise
    // resolution looking up `then` on the value an async run returned — before
    // the boundary, and never a read of a summary field.
    trapLog.length = 0
    assertRefused(await probe(v), label)
    assert.deepEqual(
      trapLog,
      label === 'proxied summary' ? ['get:then'] : [],
      `${label}: nothing but the promise-resolution \`then\` lookup`,
    )
  }
})

test('projection: a hostile thenable cannot bypass the boundary — what it resolves is projected, what it throws is a fixed line', async () => {
  let thenCalls = 0
  const resolvesHostile = summaryWith((s) => {
    Object.defineProperty(s, 'then', {
      enumerable: false,
      value: (resolve) => {
        thenCalls++
        resolve(Object.freeze({ secret: MARKER }))
      },
    })
  })
  assertRefused(await probe(resolvesHostile), 'thenable resolving a hostile value')
  assert.equal(thenCalls, 1, 'JavaScript promise resolution invoked the thenable once')

  const throwsMarker = summaryWith((s) => {
    Object.defineProperty(s, 'then', {
      enumerable: false,
      value: () => {
        throw new Error(MARKER)
      },
    })
  })
  const r = await probe(throwsMarker)
  assert.equal(r.code, 4)
  assert.equal(r.stdout, '')
  assert.equal(
    r.stderr,
    '[eanhl-backup-cloud] internal error: the run did not return a summary. ' +
      'The run lock, if acquired, was not released by this process.\n',
  )
  assert.equal(r.stderr.includes(MARKER), false)

  // A `then` that is merely DATA (not callable) is not a thenable: the value
  // reaches the boundary and its extra key is refused.
  assertRefused(await probe(summaryWith((s) => (s.then = MARKER))), 'non-callable then')
})

test('projection: wrong, missing, or extra keys, schema versions, prototypes, and unfrozen levels fail closed', async () => {
  const cases = [
    summaryWith((s) => delete s.attempts),
    summaryWith((s) => delete s.cancellationRequested),
    summaryWith((s) => delete s.lock.code),
    summaryWith((s) => delete s.attempts[1].retryDisposition),
    summaryWith((s) => (s.schemaVersion = 2)),
    summaryWith((s) => (s.schemaVersion = '1')),
    summaryWith((s) => (s.kind = 'eanhl.cloud-attempt-report')),
    summaryWith((s) => (s.cancellationRequested = 'false')),
    summaryWith((s) => (s.attempts = { 0: s.attempts[0], 1: s.attempts[1], length: 2 })),
    summaryWith((s) => Object.setPrototypeOf(s.containment, null)),
    summaryWith(
      () => {},
      (s) => new Set([s]),
    ), // top level unfrozen
    summaryWith(
      () => {},
      (s) => new Set([s.lock]),
    ),
    summaryWith(
      () => {},
      (s) => new Set([s.attempts]),
    ),
    summaryWith(
      () => {},
      (s) => new Set([s.attempts[0]]),
    ),
    null,
    undefined,
    'summary',
    Object.freeze([]),
  ]
  for (const [i, v] of cases.entries()) assertRefused(await probe(v), `shape #${i}`)
})

test('projection: incoherent lock and containment state/code combinations fail closed', async () => {
  const cases = [
    (s) => (s.lock = { state: 'released', code: 'lock_held_live' }),
    (s) => (s.lock = { state: 'retained', code: null }),
    (s) => (s.lock = { state: 'retained', code: 'maybe' }),
    (s) => (s.lock = { state: 'retained', code: 'retain_internal_error' }), // with stop 'verified'
    (s) => (s.lock = { state: 'refused', code: null }),
    (s) => (s.lock = { state: 'lost', code: 'lock_path_absent' }), // with stop 'verified'
    (s) => (s.containment = { state: 'proven', code: 'containment_unproven' }),
    (s) => (s.containment = { state: 'refused', code: null }),
    (s) => (s.containment = { state: 'refused', code: 'made_up' }),
    (s) => (s.containment = { state: 'not_attempted', code: null }), // attempts exist
    (s) => (s.containment = { state: 'invalid', code: null }),
    (s) => {
      s.containment = { state: 'refused', code: 'termination_unconfirmed' }
      s.stopReason = 'containment_refused'
      s.outcome = 'not_verified'
      s.verifiedAttemptId = null
      s.attempts = []
    },
    (s) => {
      s.containment = { state: 'refused', code: 'canary_cancelled' }
      s.stopReason = 'containment_refused'
      s.outcome = 'not_verified'
      s.verifiedAttemptId = null
      s.attempts = []
    },
    (s) => {
      s.lock = { state: 'refused', code: 'lock_nonce_unavailable' } // identity refusal
      s.stopReason = 'lock_not_acquired'
      s.outcome = 'lock_refused'
      s.verifiedAttemptId = null
      s.containment = { state: 'not_attempted', code: null }
      s.attempts = []
    },
  ]
  for (const [i, mutate] of cases.entries())
    assertRefused(await probe(summaryWith(mutate)), `lock/containment #${i}`)
})

test('projection: malformed or incoherent attempt projections fail closed', async () => {
  const cases = [
    (s) => (s.attempts[1].sequence = 2), // gap
    (s) => (s.attempts[1].sequence = '1'),
    (s) => (s.attempts[1].attemptId = P_A0), // duplicate
    (s) => (s.attempts[1].code = 'remote_path_occupied'), // verified with a code
    (s) => (s.attempts[1].termination = 'unconfirmed'),
    (s) => (s.attempts[0].code = 'provider_indeterminate'), // rejected with an indeterminate code
    (s) => (s.attempts[0].verdict = 'indeterminate'), // indeterminate but eligible
    (s) => (s.attempts[0].role = 'manifest'), // a role outside readback
    (s) => (s.attempts[0].attestationWritten = 'yes'),
    (s) => (s.attempts[0].retryDisposition = 'not_eligible'), // a non-final attempt that was not a retried collision
    (s) => (s.attempts[0].cleanupState = 'incomplete'), // eligible with incomplete cleanup
    (s) => (s.attempts[1].lockAction = 'release') && (s.attempts[1].attestationWritten = false),
    (s) => (s.verifiedAttemptId = P_A0), // points at the wrong attempt
    (s) => (s.verifiedAttemptId = null),
    (s) => s.attempts.reverse(), // verified attempt not last
    (s) =>
      s.attempts.push({ ...s.attempts[1], sequence: 2, attemptId: '20260919T120003Z-3a4b5c6d' }), // > max
  ]
  for (const [i, mutate] of cases.entries())
    assertRefused(await probe(summaryWith(mutate)), `attempt #${i}`)
})

test('projection: outcome, stop reason, cancellation, identity, and invocation relationships are re-checked', async () => {
  const cases = [
    (s) => (s.outcome = 'not_verified'),
    (s) => (s.outcome = 'cancelled'),
    (s) => (s.stopReason = 'not_retry_eligible'),
    (s) => (s.stopReason = 'run_internal_error'),
    (s) => (s.stopReason = 'cancelled'), // cancelled without cancellationRequested
    (s) => (s.cloudRunId = null), // null id without run_id_generation_failed
    (s) => (s.artifactBase = 'eanhl-test-20260101T000000Z'), // valid, but not THIS invocation's
    (s) => {
      s.lock = { state: 'not_attempted', code: 'run_id_generation_failed' } // id failed but an id is present
      s.stopReason = 'run_internal_error'
      s.outcome = 'lock_unsettled'
      s.verifiedAttemptId = null
      s.containment = { state: 'not_attempted', code: null }
      s.attempts = []
    },
  ]
  for (const [i, mutate] of cases.entries())
    assertRefused(await probe(summaryWith(mutate)), `relationship #${i}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// Static surface
// ═════════════════════════════════════════════════════════════════════════════

test('static: the executable has no shebang, no executable bit, no package script, reads no environment, and binds only the internal core', () => {
  const src = fs.readFileSync(ENTRYPOINT, 'utf8')
  assert.equal(src.startsWith('#!'), false)
  assert.equal(fs.statSync(ENTRYPOINT).mode & 0o111, 0)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./lib/internal/backup-cloud-entrypoint-core.mjs'])
  assert.equal(/process\.env/.test(code), false)
  const pkg = fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
  assert.equal(pkg.includes('eanhl-backup-cloud'), false)
  const core = fs
    .readFileSync(path.join(HERE, 'internal', 'backup-cloud-entrypoint-core.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert.equal(/process\.env/.test(core), false)
  for (const forbidden of ['backup-cloud-cli.mjs', 'backup-cloud-upload.mjs', 'child_process']) {
    assert.equal(core.includes(forbidden), false, forbidden)
  }
})

test('static: no public cloud module installs a signal listener; only the executable, its harness, and this suite import the entrypoint core', () => {
  for (const name of fs.readdirSync(HERE)) {
    if (!/^backup-cloud-.*\.mjs$/.test(name) || name.endsWith('.test.mjs')) continue
    const code = fs
      .readFileSync(path.join(HERE, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    assert.equal(/process\.(on|once|addListener)\s*\(/.test(code), false, name)
  }
  const opsRoot = path.resolve(HERE, '..', '..')
  const allowed = new Set([
    ENTRYPOINT,
    HARNESS,
    path.join(HERE, 'backup-cloud-entrypoint.test.mjs'),
    path.join(HERE, 'backup-cloud-run.test.mjs'), // cross-checks every real run summary against the projection
    path.join(HERE, 'internal', 'backup-cloud-entrypoint-core.mjs'),
  ])
  const IMPORTS_CORE =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-cloud-entrypoint-core\.mjs['"]/
  const offenders = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
        continue
      }
      if (!entry.name.endsWith('.mjs') || allowed.has(full)) continue
      if (IMPORTS_CORE.test(fs.readFileSync(full, 'utf8'))) offenders.push(full)
    }
  }
  walk(opsRoot)
  assert.deepEqual(offenders, [])
})
