#!/usr/bin/env node
/**
 * Backup-producer suite runner.
 *
 * Runs each test file as its OWN `node --test` process, sequentially, under its
 * own deadline, streaming and capturing the output.
 *
 * WHY NOT JUST `node --test file1 file2 …`
 * ----------------------------------------
 * A review run hit an outer deadline and exited 124 having reported only the
 * fastest files. With the default runner that is all the evidence there is:
 * files execute in parallel, a file's TAP output is emitted only when that
 * file's process finishes, and an outer `timeout` kills the parent while the
 * children keep running. Nothing says which file, which test, or what was still
 * alive.
 *
 * OWNERSHIP
 * ---------
 * Every invocation gets its own run root:
 *
 *   <tmpdir>/eanhl-backup-suite-<id>/
 *     owner            pid + start time of the runner that owns this tree
 *     logs/            one captured log per test file, written SYNCHRONOUSLY
 *     state/           the in-file watchdogs' current-test state files
 *     sandboxes/       TMPDIR for the child test processes
 *
 * `TMPDIR` is pointed at `sandboxes/` for the children, so every temporary
 * directory the test files create lands inside this run's own tree. Ownership is
 * then structural rather than inferred, which matters because the previous
 * version swept `/tmp` by filename prefix and SIGKILLed anything whose command
 * line mentioned one — including the children of a concurrent invocation. This
 * one never scans `/proc`, never matches on prefixes, and only ever signals its
 * own descendants, each re-identified by command line immediately before being
 * signalled so a recycled pid cannot be hit.
 *
 * Stale roots from earlier runs are never touched implicitly. `--list-runs`
 * reports them and whether their owner is still alive; `--reap-stale` deletes
 * only those whose owner pid is gone, and signals nothing, ever.
 *
 * BOUNDED TERMINATION
 * -------------------
 * A per-file result resolves on the child's `exit`, not its `close`: `close`
 * waits for every stdio pipe to drain, and a surviving grandchild holding an
 * inherited pipe open can delay it indefinitely. After `exit` the pipes get a
 * short grace and are then abandoned.
 *
 * CHOOSING A DEADLINE
 * -------------------
 * Measured on this machine: config ~0.13 s, producer ~0.92 s, boundaries
 * ~0.21 s, lifecycle ~6.9 s. The lifecycle file is dominated by deliberate
 * waits — two `operationTimeoutMs` expiries, a SIGTERM→SIGKILL escalation, two
 * CLI subprocesses — so it does not get much faster on faster hardware. A
 * per-file deadline below ~30 s will eventually fire on a busy machine for no
 * reason; the default is 120 s.
 *
 * Usage:
 *   node ops/backup/run-suite.mjs [--file-timeout-ms N] [--keep-logs]
 *                                 [--list-runs] [--reap-stale] [file …]
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.join(HERE, 'lib')
const RUN_PREFIX = 'eanhl-backup-suite-'

const DEFAULT_FILES = [
  'backup-config.test.mjs',
  'backup-producer.test.mjs',
  'backup-boundaries.test.mjs',
  'backup-acceptance.test.mjs',
  'backup-lifecycle.test.mjs',
]

/** How long to wait for stdio pipes after the child has already exited. */
const PIPE_GRACE_MS = 2_000
/** How long a SIGTERM gets before the runner escalates to SIGKILL. */
const TERM_GRACE_MS = 3_000

function parseArgs(argv) {
  const opts = {
    fileTimeoutMs: 120_000,
    keepLogs: false,
    listRuns: false,
    reapStale: false,
    files: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--file-timeout-ms') opts.fileTimeoutMs = Number(argv[++i])
    else if (arg.startsWith('--file-timeout-ms=')) opts.fileTimeoutMs = Number(arg.split('=')[1])
    else if (arg === '--keep-logs') opts.keepLogs = true
    else if (arg === '--list-runs') opts.listRuns = true
    else if (arg === '--reap-stale') opts.reapStale = true
    else if (arg.startsWith('-')) throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    else opts.files.push(arg)
  }
  if (!Number.isFinite(opts.fileTimeoutMs) || opts.fileTimeoutMs <= 0) {
    throw new Error('--file-timeout-ms must be a positive number of milliseconds')
  }
  if (opts.files.length === 0) opts.files = DEFAULT_FILES.map((f) => path.join(LIB, f))
  return opts
}

const say = (line) => {
  try {
    fs.writeSync(2, `[run-suite] ${line}\n`)
  } catch {
    /* stderr gone; nothing useful left to do */
  }
}

// ── process helpers: identity first, never a bare pid ────────────────────────

/** Read a pid's command line from /proc. Linux only; null if unavailable. */
function cmdlineOf(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
  } catch {
    return null
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

/**
 * Every descendant of `pid`, each recorded WITH the command line it had at
 * enumeration time.
 *
 * Enumerated before anything is signalled: killing a parent reparents its
 * children away, which would lose the ownership link at the moment it is needed.
 */
function descendantsOf(pid) {
  const out = []
  const queue = [pid]
  const seen = new Set([pid])
  while (queue.length > 0) {
    const current = queue.shift()
    let kids = []
    try {
      kids = fs
        .readFileSync(`/proc/${current}/task/${current}/children`, 'utf8')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
    } catch {
      continue
    }
    for (const kid of kids) {
      if (seen.has(kid)) continue
      seen.add(kid)
      out.push({ pid: kid, cmd: cmdlineOf(kid) ?? '(exited)' })
      queue.push(kid)
    }
  }
  return out
}

/**
 * Signal a pid only if it is still the process that was enumerated.
 *
 * A pid that has exited and been recycled — which happens quickly inside a
 * small PID namespace — must never be signalled on the strength of a stale
 * record.
 */
function signalIfStillSame(entry, signal) {
  if (entry.cmd === '(exited)') return false
  const now = cmdlineOf(entry.pid)
  if (now === null || now !== entry.cmd) return false
  try {
    process.kill(entry.pid, signal)
    return true
  } catch {
    return false
  }
}

const opts = (() => {
  try {
    return parseArgs(process.argv.slice(2))
  } catch (err) {
    say(`ERROR: ${err.message}`)
    process.exit(1)
  }
})()

/** Other invocations' roots. Reported, never touched implicitly. */
function otherRuns() {
  const tmp = os.tmpdir()
  let entries = []
  try {
    entries = fs.readdirSync(tmp)
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (!entry.startsWith(RUN_PREFIX)) continue
    const root = path.join(tmp, entry)
    let owner = null
    try {
      owner = Object.fromEntries(
        fs
          .readFileSync(path.join(root, 'owner'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    } catch {
      /* an older layout, or a partially created root */
    }
    const pid = Number(owner?.pid)
    found.push({
      root,
      pid: Number.isFinite(pid) ? pid : null,
      startedAt: owner?.startedAt ?? null,
      alive: Number.isFinite(pid) ? pidAlive(pid) : null,
    })
  }
  return found
}

if (opts.listRuns || opts.reapStale) {
  const runs = otherRuns()
  if (runs.length === 0) say('no suite run directories found')
  for (const run of runs) {
    const owner =
      run.pid === null
        ? 'owner unknown (no owner file)'
        : `owner pid ${run.pid} ${run.alive ? 'ALIVE' : 'gone'}`
    if (opts.reapStale && run.pid !== null && run.alive === false) {
      try {
        fs.rmSync(run.root, { recursive: true, force: true })
        say(`reaped ${run.root} (${owner})`)
      } catch (err) {
        say(`could not reap ${run.root}: ${err?.message ?? String(err)}`)
      }
    } else if (opts.reapStale) {
      say(
        `kept ${run.root} (${owner}) — only roots with a dead owner are reaped, ` +
          `and no process is ever signalled`,
      )
    } else {
      say(`${run.root} (${owner})`)
    }
  }
  process.exit(0)
}

const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), RUN_PREFIX))
const logDir = path.join(runRoot, 'logs')
const stateDir = path.join(runRoot, 'state')
const sandboxDir = path.join(runRoot, 'sandboxes')
for (const dir of [logDir, stateDir, sandboxDir]) fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(
  path.join(runRoot, 'owner'),
  `pid=${process.pid}\nstartedAt=${new Date().toISOString()}\n`,
)
say(`run root: ${runRoot}`)

// Everything this run spawns, so a signal path can stop exactly its own work.
const liveChildren = new Set()

/** Stop one child and its descendants, bounded. Returns what was signalled. */
function terminateOwned(child, why) {
  if (!child || child.exitCode !== null) return []
  const owned = descendantsOf(child.pid)
  say(`${why}: stopping pid ${child.pid} and ${owned.length} descendant(s)`)
  for (const entry of owned.slice().reverse()) signalIfStillSame(entry, 'SIGTERM')
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
  const escalate = setTimeout(() => {
    for (const entry of owned.slice().reverse()) signalIfStillSame(entry, 'SIGKILL')
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }, TERM_GRACE_MS)
  escalate.unref?.()
  return owned
}

let interrupted = false
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interrupted) process.exit(130)
    interrupted = true
    say(`received ${sig} — stopping owned children; logs preserved at ${runRoot}`)
    for (const child of liveChildren) terminateOwned(child, sig)
    setTimeout(() => process.exit(130), TERM_GRACE_MS + 500).unref?.()
  })
}

/** Whatever the in-file watchdogs have recorded about their current test. */
function readWatchdogState() {
  const lines = []
  let entries = []
  try {
    entries = fs.readdirSync(stateDir)
  } catch {
    return ['watchdog state: unavailable']
  }
  for (const entry of entries.filter((e) => e.endsWith('.state'))) {
    try {
      const state = Object.fromEntries(
        fs
          .readFileSync(path.join(stateDir, entry), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
      const age = state.startedAt ? Date.now() - Number(state.startedAt) : null
      lines.push(
        `watchdog[${state.label}] status=${state.status} pid=${state.pid} ` +
          `thisTestRunningFor=${age === null ? 'unknown' : `${age}ms`} ` +
          `test=${state.test || '(none)'}`,
      )
    } catch {
      /* a partially written state file is not worth failing over */
    }
  }
  for (const entry of entries.filter((e) => e.endsWith('.stall.log'))) {
    lines.push(`watchdog stall log: ${path.join(stateDir, entry)}`)
  }
  return lines.length > 0 ? lines : ['watchdog state: none recorded']
}

/** Run one file under its own deadline; resolve with a result record. */
function runFile(file) {
  return new Promise((resolve) => {
    const name = path.basename(file)
    const logPath = path.join(logDir, `${name}.log`)
    // Synchronous appends: a buffered stream loses everything if an outer
    // `timeout` kills this process, which is how a previous investigation ended
    // up with four zero-byte logs and no evidence at all.
    const logFd = fs.openSync(logPath, 'a')

    const child = spawn(
      process.execPath,
      ['--test', '--test-timeout=120000', '--test-reporter=tap', file],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Children create their sandboxes inside THIS run's tree, which is
          // what makes ownership structural instead of prefix-guessed.
          TMPDIR: sandboxDir,
          EANHL_TEST_STATE_DIR: stateDir,
        },
      },
    )
    liveChildren.add(child)

    let lastTest = null
    let tail = ''
    let timedOut = false
    let settled = false
    let owned = []
    let pipeGrace = null
    const started = Date.now()

    const absorb = (chunk) => {
      const text = chunk.toString()
      try {
        fs.writeSync(1, text)
      } catch {
        /* stdout gone */
      }
      try {
        fs.writeSync(logFd, text)
      } catch {
        /* log gone */
      }
      tail = (tail + text).slice(-8192)
      for (const m of text.matchAll(/^# Subtest: (.*)$/gm)) lastTest = m[1]
    }
    child.stdout.on('data', absorb)
    child.stderr.on('data', absorb)
    for (const stream of [child.stdout, child.stderr]) stream.on('error', () => {})

    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(pipeGrace)
      liveChildren.delete(child)
      try {
        fs.closeSync(logFd)
      } catch {
        /* already closed */
      }
      const summary = /^# pass (\d+)[\s\S]*?^# fail (\d+)/m.exec(tail)
      resolve({
        name,
        code,
        error,
        timedOut,
        ms: Date.now() - started,
        logPath,
        lastTest,
        owned,
        pass: summary?.[1],
        fail: summary?.[2],
      })
    }

    const deadline = setTimeout(() => {
      timedOut = true
      say(`DEADLINE: ${name} exceeded ${opts.fileTimeoutMs}ms`)
      // The watchdog state names the test that is RUNNING and how long it has
      // been running. TAP only announces a subtest once it has COMPLETED, so on
      // a stall that is always the previous one — and a short
      // `thisTestRunningFor` means the FILE ran out of budget rather than this
      // test hanging.
      for (const line of readWatchdogState()) say(`  ${line}`)
      say(`  last COMPLETED subtest: ${lastTest ?? '(none)'}`)
      owned = terminateOwned(child, 'deadline')
      for (const entry of owned) say(`  owned: pid ${entry.pid}: ${entry.cmd.slice(0, 160)}`)
      say(`  captured log: ${logPath}`)
    }, opts.fileTimeoutMs)

    child.on('error', (err) => finish(null, err.message))
    // `exit`, not `close`: `close` waits for every inherited pipe to drain, and
    // a surviving grandchild can hold one open indefinitely.
    child.on('exit', (code, signal) => {
      const status = code ?? (signal ? 128 : null)
      child.once('close', () => finish(status))
      pipeGrace = setTimeout(() => {
        say(`${name}: pipes still open ${PIPE_GRACE_MS}ms after exit — abandoning them`)
        try {
          child.stdout.destroy()
          child.stderr.destroy()
        } catch {
          /* already destroyed */
        }
        finish(status)
      }, PIPE_GRACE_MS)
      pipeGrace.unref?.()
    })
  })
}

const results = []
for (const file of opts.files) {
  results.push(await runFile(file))
}

say('')
say('summary:')
let failed = 0
for (const r of results) {
  const verdict = r.timedOut
    ? 'TIMED OUT'
    : r.error
      ? `SPAWN ERROR: ${r.error}`
      : r.code === 0
        ? 'ok'
        : `FAILED (exit ${r.code})`
  if (verdict !== 'ok') failed++
  say(
    `  ${r.name.padEnd(28)} ${String(r.ms).padStart(6)}ms  ${verdict}` +
      (r.pass !== undefined ? `  pass ${r.pass} fail ${r.fail}` : ''),
  )
}

// Anything still alive under this run's own tree is a defect in the suite.
// Only this run's own children are ever considered.
const stillAlive = results.flatMap((r) =>
  (r.owned ?? []).filter((e) => e.cmd !== '(exited)' && cmdlineOf(e.pid) === e.cmd),
)
if (stillAlive.length > 0) {
  failed++
  say(`LEAKED ${stillAlive.length} owned process(es):`)
  for (const entry of stillAlive) {
    say(`  pid ${entry.pid}: ${entry.cmd.slice(0, 160)}`)
    signalIfStillSame(entry, 'SIGKILL')
  }
}

const others = otherRuns().filter((r) => r.root !== runRoot)
if (others.length > 0) {
  say(
    `note: ${others.length} other suite run director${others.length === 1 ? 'y' : 'ies'} present ` +
      `(--list-runs to inspect, --reap-stale to remove only dead-owner ones). None was touched.`,
  )
}

if (failed === 0 && !opts.keepLogs) {
  fs.rmSync(runRoot, { recursive: true, force: true })
} else {
  say(`run root preserved at ${runRoot}`)
}
process.exitCode = failed === 0 ? 0 : 1
