/**
 * Test-suite diagnostics.
 *
 * WHY THIS EXISTS
 * ---------------
 * A review run of the backup suite hit an outer 35-second deadline and exited
 * 124 with no indication of which test was stuck. That could not be reproduced
 * afterwards — the slowest test in either file measures about one second — so
 * the useful response is not a guess about the cause but a suite that describes
 * its own state when it stalls.
 *
 * THE PART THAT IS EASY TO GET WRONG
 * ----------------------------------
 * `node --test` runs each file in a child process and **buffers that child's
 * stdout and stderr until the file finishes**, re-emitting it as TAP
 * diagnostics. So anything a stalled file writes to stderr is exactly the output
 * you never see — writing the report to stderr alone reproduces the original
 * problem. Verified directly: a deliberately stalling test printed nothing at
 * all before an outer `timeout` killed it.
 *
 * The state is therefore written to a FILE, one per test file, updated as each
 * test starts and finishes. `ops/backup/run-suite.mjs` points
 * `EANHL_TEST_STATE_DIR` at its log directory and reads those files when a
 * per-file deadline fires, so a stall always names the test that was running.
 * stderr still gets the same report, for the case where a file does finish.
 *
 * Everything here is read-only about the system and allocation-light.
 * `process._getActiveHandles` is an internal API, so it is guarded; `/proc` is
 * read directly rather than spawning `ps`, because spawning from inside a stall
 * report would add noise to exactly the thing being measured.
 */

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach } from 'node:test'

/** Active handles, counted by constructor name. Internal API — best effort. */
function handleSummary() {
  try {
    const counts = new Map()
    for (const handle of process._getActiveHandles?.() ?? []) {
      const name = handle?.constructor?.name ?? 'unknown'
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    if (counts.size === 0) return 'none'
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}×${n}`)
      .join(' ')
  } catch (err) {
    return `unavailable (${err?.message ?? String(err)})`
  }
}

/** Direct children of this process, from /proc. Linux only; best effort. */
function childSummary() {
  let pids = []
  try {
    pids = fs
      .readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  } catch {
    return ['  (child list unavailable on this platform)']
  }
  if (pids.length === 0) return ['  (none)']
  return pids.map((pid) => {
    let cmd = '(exited)'
    try {
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim()
    } catch {
      /* raced with exit */
    }
    return `  pid ${pid}: ${cmd.slice(0, 200)}`
  })
}

/**
 * Install the watchdog. Call once at the top of a test file.
 *
 * @param {object} [opts]
 * @param {string} [opts.label]         Names the state file and prefixes report lines.
 * @param {number} [opts.warnAfterMs]   How long one test may run before a stall report.
 * @param {number} [opts.intervalMs]    How often to re-report while it is still stuck.
 * @param {() => string[]} [opts.extra] Extra lines to include (e.g. tracked children).
 */
export function installTestWatchdog({
  label = 'watchdog',
  warnAfterMs = 15_000,
  intervalMs = 10_000,
  extra,
} = {}) {
  const stateDir = process.env.EANHL_TEST_STATE_DIR
  const statePath = stateDir ? path.join(stateDir, `${label}.state`) : null
  let current = null
  let startedAt = 0
  let reported = 0

  /** Overwrite the state file. Cheap, and never allowed to break a test. */
  const writeState = (status) => {
    if (!statePath) return
    try {
      fs.writeFileSync(
        statePath,
        [
          `label=${label}`,
          `pid=${process.pid}`,
          `status=${status}`,
          `test=${current ?? ''}`,
          `startedAt=${startedAt}`,
          `updatedAt=${Date.now()}`,
          '',
        ].join('\n'),
      )
    } catch {
      /* diagnostics must never throw */
    }
  }

  const buildReport = (why) => {
    const elapsed = current === null ? 0 : Date.now() - startedAt
    const lines = [
      '',
      `[${label}] ${why}`,
      `[${label}] active test: ${current ?? '(none — between tests or in a hook)'}`,
      `[${label}] running for: ${elapsed}ms`,
      `[${label}] active handles: ${handleSummary()}`,
      `[${label}] child processes:`,
      ...childSummary(),
    ]
    if (extra) {
      try {
        lines.push(`[${label}] suite state:`, ...extra().map((l) => `  ${l}`))
      } catch {
        /* diagnostics must never throw */
      }
    }
    return lines.join('\n') + '\n'
  }

  const report = (why) => {
    const text = buildReport(why)
    // Both destinations on purpose: stderr for a file that eventually finishes,
    // the stall log for one that does not (see the docblock).
    process.stderr.write(text)
    if (stateDir) {
      try {
        fs.appendFileSync(path.join(stateDir, `${label}.stall.log`), text)
      } catch {
        /* diagnostics must never throw */
      }
    }
  }

  beforeEach((t) => {
    current = t?.name ?? '(unnamed)'
    startedAt = Date.now()
    reported = 0
    writeState('running')
  })
  afterEach(() => {
    current = null
    writeState('idle')
  })
  writeState('starting')

  const timer = setInterval(
    () => {
      if (current === null) return
      const elapsed = Date.now() - startedAt
      if (elapsed < warnAfterMs) return
      if (reported > 0 && elapsed - reported < intervalMs) return
      reported = elapsed
      report(`a test has been running for ${Math.round(elapsed / 1000)}s`)
    },
    Math.min(intervalMs, 5_000),
  )
  // Never let the watchdog itself be the reason the process stays alive.
  timer.unref?.()

  process.on('exit', () => {
    if (current !== null) report('process is exiting while a test is still active')
    writeState(current === null ? 'finished' : 'exited-mid-test')
  })

  return { report }
}
