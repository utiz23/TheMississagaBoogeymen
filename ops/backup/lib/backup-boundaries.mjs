/**
 * Backup producer — real process, filesystem and clock boundaries.
 *
 * Deliberately thin. Every decision lives in backup-producer.mjs and
 * backup-config.mjs, which are driven by fakes in the test suite; this file is
 * the only place that spawns anything, and it is the only reason a real run
 * needs Docker.
 *
 * Four rules are enforced structurally here rather than by convention:
 *
 *   1. `pg_dump` and `pg_restore` are ALWAYS `docker exec <container> …`. There
 *      is no code path that reaches a host client, so a host/server version
 *      mismatch cannot be introduced by a PATH change.
 *   2. The staged archive is fed to `pg_restore` over **stdin**. Nothing is
 *      copied into the database container, so validation cannot fill the
 *      container's filesystem or leave a plaintext dump inside it.
 *   3. Every stream and every child gets its error handler installed BEFORE any
 *      activity can produce one, and every operation settles exactly once,
 *      after both the child and the file have finished closing. An `error`
 *      event with no listener terminates Node outright — which would skip the
 *      producer's cleanup entirely and leave a lock and a plaintext dump
 *      behind. That must not be reachable from an ordinary ENOSPC.
 *   4. Every spawned child registers a cancellation handle with the caller's
 *      `track` callback, so a run that is aborted can actually stop the work it
 *      started rather than deleting the staging directory out from under it.
 *
 * WHAT CANCELLING A `docker exec` CHILD DOES AND DOES NOT PROVE
 * ------------------------------------------------------------
 * Killing the local `docker` CLI stops the client. It does NOT establish that
 * the `pg_dump` / `pg_restore` process inside the container has ended: without
 * a TTY there is no signal forwarding, and the container-side process may run
 * to completion regardless. Handles therefore report `kind: 'docker-exec'` and
 * `containerSideEnded: null` — unknown, deliberately not claimed. Only a
 * `kind: 'local'` child (the encryption executable) can report `true`.
 */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Statements are separated from their output by a per-query sentinel line. */
let sentinelCounter = 0

// ─────────────────────────────────────────────────────────────────────────────
// Bounded child cancellation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stop a child within `deadlineMs`: SIGTERM, SIGKILL at the halfway point, and
 * `timeout` rather than an unbounded wait if it still has not closed.
 *
 * Bounded on purpose. The run lock is released only after cancellation returns,
 * so an unbounded wait here would block every future backup.
 *
 * @returns {Promise<'exited'|'killed'|'timeout'>}
 */
export function cancelChild(child, deadlineMs) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve('exited')
    let done = false
    let escalate = null
    let expire = null
    const finish = (outcome) => {
      if (done) return
      done = true
      clearTimeout(escalate)
      clearTimeout(expire)
      resolve(outcome)
    }
    child.once('close', () => finish('killed'))
    try {
      child.kill('SIGTERM')
    } catch {
      return finish('exited')
    }
    escalate = setTimeout(
      () => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      },
      Math.max(10, Math.floor(deadlineMs / 2)),
    )
    expire = setTimeout(() => finish('timeout'), Math.max(20, deadlineMs))
    escalate.unref?.()
    expire.unref?.()
  })
}

/**
 * Register `child` with the caller's operation tracker.
 *
 * Returns `{ handle, untrack, markLocalTermination }`. `markLocalTermination`
 * records that THIS module killed the child rather than letting it finish —
 * a byte-ceiling breach, an output-stream failure, or an input failure. That
 * distinction is the whole point: a child that ended on its own is an ordinary
 * completion, while one we killed leaves a `docker exec` client dead and the
 * container-side command's fate unknown.
 *
 * Safe to call with `track === undefined` (the injected-fake tests).
 */
function trackChild(track, { label, kind, child, identityToken = null }) {
  if (typeof track !== 'function') {
    return { handle: null, untrack: null, markLocalTermination: () => {} }
  }
  const handle = {
    label,
    kind,
    // A fragment of THIS operation's own container-side command line. The
    // producer matches it against a read-only `ps` inventory to decide whether
    // its own work has ended. It is never used to signal anything, and a token
    // that could match an unrelated process must only ever cause a
    // conservative "cannot confirm" — never an action.
    identityToken,
    /** Synchronous last resort for a `process.on('exit')` handler. */
    killNow() {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    },
    async cancel(deadlineMs) {
      const outcome = await cancelChild(child, deadlineMs)
      return {
        label,
        kind,
        identityToken,
        locallyTerminated: handle.locallyTerminated,
        outcome,
        // Stopping the docker CLI is not evidence about the container-side
        // command. Never claim otherwise.
        containerSideEnded: kind === 'local' ? outcome !== 'timeout' : null,
      }
    },
  }
  // Set when this module kills the child itself; see the docblock.
  handle.locallyTerminated = false
  const untrack = track(handle)
  return {
    handle,
    untrack,
    markLocalTermination() {
      handle.locallyTerminated = true
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The snapshot-owning psql session.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A long-lived `psql` session inside the database container.
 *
 * This is what holds the snapshot-owning REPEATABLE READ transaction open
 * while `pg_dump` runs on a *second* connection. If this process dies, the
 * transaction ends and the exported snapshot becomes invalid — which is
 * exactly the failure the producer's liveness re-probe is designed to catch.
 *
 * `ON_ERROR_STOP=1` means any SQL error terminates psql. A query pending at
 * that moment rejects with the collected stderr rather than hanging: silently
 * continuing inside an aborted transaction is the one outcome that must not be
 * possible.
 */
export function makeSnapshotSession() {
  return async function startSnapshotSession({ container, database, user, runId }) {
    // `-v eanhl_run=<runId>` is inert to psql and unique to this run. It exists
    // so the session is identifiable in a read-only container `ps` inventory
    // when the producer needs to decide whether its own work has ended.
    const identityToken = `eanhl_run=${runId ?? 'unknown'}`
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        user,
        '-d',
        database,
        '-qAtX',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        identityToken,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let stdout = ''
    let stderr = ''
    let exited = null
    const waiters = []

    const settle = () => {
      for (const w of waiters.slice()) {
        const idx = stdout.indexOf(w.sentinel)
        if (idx !== -1) {
          const chunk = stdout.slice(0, idx)
          stdout = stdout.slice(idx + w.sentinel.length).replace(/^\n/, '')
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(chunk.split('\n').map((l) => l.replace(/\r$/, '')))
          continue
        }
        if (exited !== null) {
          waiters.splice(waiters.indexOf(w), 1)
          w.reject(
            new Error(
              `psql session exited (${exited}) before completing the statement. stderr: ${stderr.trim() || '(empty)'}`,
            ),
          )
        }
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      stdout += d
      settle()
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    // Installed BEFORE the first write. When psql dies, our next write to its
    // stdin raises EPIPE on the socket; without a listener that is an unhandled
    // 'error' event and terminates the process.
    child.stdin.on('error', (err) => {
      if (exited === null) exited = `stdin error: ${err?.code ?? err?.message ?? String(err)}`
      settle()
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('error', () => {
        /* the exit/close handlers below carry the real outcome */
      })
    }
    child.on('error', (err) => {
      exited = `spawn error: ${err.message}`
      settle()
    })
    child.on('exit', (code, signal) => {
      exited = signal ? `signal ${signal}` : `exit ${code}`
      settle()
    })

    return {
      /** Run one or more statements; resolve with the emitted output lines. */
      query(sql) {
        if (exited !== null) {
          return Promise.reject(
            new Error(`psql session already ${exited}. stderr: ${stderr.trim() || '(empty)'}`),
          )
        }
        const sentinel = `<<eanhl-backup-${++sentinelCounter}>>`
        return new Promise((resolve, reject) => {
          waiters.push({ sentinel, resolve, reject })
          child.stdin.write(
            `${sql.endsWith('\n') ? sql : sql + '\n'}\\echo ${sentinel}\n`,
            (err) => {
              if (err) reject(err)
            },
          )
          settle()
        })
      },
      /**
       * End the session within `timeoutMs`, then SIGKILL. Safe to call twice.
       * Bounded because the producer releases the run lock only afterwards.
       */
      close(timeoutMs = 10_000) {
        return new Promise((resolve) => {
          if (exited !== null) return resolve()
          let done = false
          const finish = () => {
            if (done) return
            done = true
            clearTimeout(timer)
            resolve()
          }
          child.on('exit', finish)
          child.on('close', finish)
          try {
            child.stdin.end()
          } catch {
            /* already closed */
          }
          const timer = setTimeout(
            () => {
              try {
                child.kill('SIGKILL')
              } catch {
                /* gone */
              }
              finish()
            },
            Math.max(10, timeoutMs),
          )
          timer.unref?.()
        })
      },
      /** The session's own argv fragment, for the container-side probe. */
      identityToken,
      /** Kill the session immediately. Synchronous; safe from an exit handler. */
      kill() {
        try {
          child.kill('SIGKILL')
        } catch {
          /* gone */
        }
      },
      get stderr() {
        return stderr
      },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The shared bounded writer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawn a child, stream its stdout into a file, and STOP at `maxBytes`.
 *
 * This is the only mechanism in the producer that bounds how much disk an
 * external tool can consume, and it is deliberately the same one for the dump
 * and for encryption. The bound is structural: the producer owns the file
 * descriptor, counts bytes itself, and DROPS the chunk that would cross the
 * ceiling rather than writing it. The staged file therefore cannot exceed
 * `maxBytes` — not "usually", not "within a sampling interval".
 *
 * The rejected alternative was sampling the tool's own output file on a timer.
 * That is detection, not a bound: an executable that writes 8 MB in one burst
 * before the first tick finishes with the file already 32× over a 256 KB limit
 * and nothing to report. Measured, reproduced, and the reason this function
 * exists.
 *
 * Settles exactly once, and only after BOTH the child and the output file have
 * closed — so a rejection never leaves a live child or an open descriptor for
 * the caller's cleanup to trip over. Every stream handler is installed before
 * any activity can produce an event: an unhandled 'error' terminates Node and
 * would skip the producer's teardown entirely.
 */
function spawnCapturingToFile({
  command,
  args,
  outPath,
  maxBytes,
  label,
  kind,
  track,
  identityToken = null,
  fileMode = 0o600,
  // Ceiling on how long this operation may make NO progress at all. A write
  // that neither completes nor fails leaves the stream un-drained, the child
  // paused, and this promise pending forever — observed in a container where a
  // streamed write to /dev/full wedged even though a synchronous write to the
  // same device returned ENOSPC. Generous by default; callers that know their
  // own budget pass it in.
  stallTimeoutMs = 120_000,
}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let failure = null
    let truncated = false
    let bytes = 0
    let stderr = ''
    // OBSERVED closure only. Neither of these is ever set by this module to make
    // a promise settle — that is the difference between "the resource closed"
    // and "we stopped waiting for it", and conflating the two is how a stalled
    // local child got untracked while it was still running.
    let childDone = false
    let streamDone = false
    // Set when the operation is given up on without observing closure. The
    // promise settles, but nothing is claimed about the child or the file.
    let abandoned = false
    let exitCode = null
    let tracker = { handle: null, untrack: null, markLocalTermination: () => {} }
    let child = null

    /**
     * Kill the child because THIS module decided to, and record that fact.
     *
     * Only counts as a local termination if the child actually spawned and was
     * still running: a spawn failure never started a container-side command,
     * and a child that had already exited ended on its own.
     */
    const killLocally = () => {
      if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        tracker.markLocalTermination()
      }
      try {
        child?.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }

    // ── stall detection ──────────────────────────────────────────────────────
    //
    // "Progress" is any byte accepted, any stream event, or the child ending.
    // If none of those happens for `stallTimeoutMs` the operation is wedged:
    // report WHICH side is stuck rather than hanging on a promise that will
    // never settle.
    let lastProgress = Date.now()
    const progress = () => {
      lastProgress = Date.now()
    }
    const stallTimer = setInterval(
      () => {
        if (settled) return
        const idleMs = Date.now() - lastProgress
        if (idleMs < stallTimeoutMs) return
        const err = new Error(
          `${label} made no progress for ${idleMs}ms: ${bytes} byte(s) written to ${outPath}, ` +
            `child ${childDone ? 'closed' : 'still running'}, ` +
            `output stream ${streamDone ? 'closed' : 'neither drained nor errored'}. ` +
            `The output is not accepting writes and is not reporting an error.`,
        )
        err.code = 'output_stalled'
        fail(err)
      },
      Math.max(50, Math.min(stallTimeoutMs, 1_000)),
    )
    stallTimer.unref?.()

    const settle = () => {
      // Settle either because both resources were observed to close, or because
      // the operation was deliberately abandoned. Those are different facts and
      // the untracking decision below depends on which one happened.
      if (settled) return
      if (!abandoned && (!childDone || !streamDone)) return
      settled = true
      clearInterval(stallTimer)

      // The handle is released ONLY when this operation is finished with the
      // work, in the sense that something is known to have stopped:
      //
      //   ordinary completion  child ended on its own, file closed → release,
      //                        so a normal run never leaks a handle;
      //   locally killed, but  the child closed → for a LOCAL process that is
      //   observed to close    proof it stopped, so release; for a `docker exec`
      //                        client it proves only the client is gone, so keep
      //                        it for the caller to probe the container;
      //   abandoned            nothing was observed to close, of either kind →
      //                        KEEP it. The caller still owns unconfirmed work
      //                        and must retain exclusion until something
      //                        actually confirms the process stopped.
      const confirmedClosed = childDone && streamDone && !abandoned
      const keepForContainerProof =
        tracker.handle?.locallyTerminated === true && kind === 'docker-exec'
      if (confirmedClosed && !keepForContainerProof) tracker.untrack?.()

      if (failure) return reject(failure)
      resolve({
        code: exitCode,
        bytes,
        truncated,
        stderr,
        abandoned,
        locallyTerminated: tracker.handle?.locallyTerminated === true,
      })
    }

    /**
     * Record the first failure and tear both sides down before settling.
     *
     * A stalled output stream may never emit 'close' after `destroy()`, so a
     * stall has to be able to settle without one. It does that by marking the
     * operation ABANDONED — not by asserting that the child and the file closed.
     * The promise rejects promptly; the handle stays registered, because
     * abandoning work is not the same as observing it stop.
     */
    const fail = (err) => {
      if (!failure) failure = err
      killLocally()
      try {
        child?.stdout?.destroy()
      } catch {
        /* already destroyed */
      }
      try {
        out.destroy()
      } catch {
        /* already destroyed */
      }
      if (failure?.code === 'output_stalled') {
        // Give up waiting — WITHOUT claiming either side closed. SIGKILL has
        // been issued and the streams destroyed, but neither has been observed
        // to finish, so the operation stays the caller's problem.
        abandoned = true
      }
      settle()
    }

    // ── the output file FIRST, with its handlers installed synchronously ──────
    //
    // `createWriteStream` opens asynchronously: ENOENT on a missing staging
    // directory, EACCES, or ENOSPC all arrive as an 'error' event, and the open
    // can fail before the child has produced a single byte.
    const out = fs.createWriteStream(outPath, { mode: fileMode })
    let outEnded = false
    const endOut = () => {
      if (outEnded) return
      outEnded = true
      out.end()
    }
    out.on('error', (err) => {
      streamDone = true
      const wrapped = new Error(`${label} output ${outPath} failed: ${err?.message ?? String(err)}`)
      wrapped.code = err?.code ?? 'output_stream_error'
      fail(wrapped)
    })
    out.on('close', () => {
      streamDone = true
      progress()
      settle()
    })

    // ── the child ────────────────────────────────────────────────────────────
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      childDone = true
      fail(err)
      return
    }
    tracker = trackChild(track, { label, kind, child, identityToken })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.stderr.on('error', () => {
      /* the close handler carries the real outcome */
    })
    child.stdout.on('error', (err) => {
      // A destroy() during intentional teardown is not a new failure.
      if (truncated || failure) return
      fail(err)
    })
    child.on('error', (err) => {
      childDone = true
      fail(err)
    })
    child.on('close', (code) => {
      exitCode = code
      childDone = true
      progress()
      endOut()
      settle()
    })

    // Written by hand rather than with `.pipe()`: the ceiling has to be able to
    // DROP the chunk that would cross it. A piped stream has already handed the
    // data to the writer by the time a `data` listener could react, so an
    // oversized payload would land on disk in full before anything killed it.
    child.stdout.on('data', (chunk) => {
      if (truncated || outEnded || failure) return
      if (bytes + chunk.length > maxBytes) {
        truncated = true
        // A byte-ceiling breach is an internally initiated termination, exactly
        // like an output failure. It must be accounted for the same way.
        killLocally()
        child.stdout.destroy()
        endOut()
        return
      }
      bytes += chunk.length
      progress()
      if (!out.write(chunk)) child.stdout.pause()
    })
    out.on('drain', () => {
      progress()
      child.stdout.resume()
    })
    child.stdout.on('end', endOut)
    child.stdout.on('close', endOut)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// The dump.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `docker exec <container> pg_dump --snapshot=<id> --format=custom` into a
 * host file, with a hard byte ceiling (see {@link spawnCapturingToFile}).
 *
 * `--snapshot=<id>` is also the unique, argv-visible token that lets the
 * producer ask the container, read-only, whether THIS dump is still running
 * after a cancellation (see {@link listContainerCommands}).
 */
export async function runDump({
  container,
  database,
  user,
  snapshotId,
  outPath,
  maxBytes,
  track,
  label = 'pg_dump',
  stallTimeoutMs,
}) {
  const result = await spawnCapturingToFile({
    command: 'docker',
    args: [
      'exec',
      container,
      'pg_dump',
      '-U',
      user,
      '-d',
      database,
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--snapshot=${snapshotId}`,
    ],
    outPath,
    maxBytes,
    label,
    kind: 'docker-exec',
    track,
    stallTimeoutMs,
    // Unique per run: no other process can carry this snapshot id.
    identityToken: `--snapshot=${snapshotId}`,
  })

  if (result.truncated) return { bytes: result.bytes, truncated: true, stderr: result.stderr }
  if (result.code !== 0) {
    const err = new Error(`pg_dump exited ${result.code}: ${result.stderr.trim() || '(no stderr)'}`)
    err.code = 'pg_dump_nonzero'
    throw err
  }
  if (result.stderr.trim() !== '') {
    const err = new Error(`pg_dump wrote to stderr despite exit 0: ${result.stderr.trim()}`)
    err.code = 'pg_dump_stderr'
    throw err
  }
  return { bytes: fs.statSync(outPath).size, truncated: false, stderr: result.stderr }
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive validation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validation A — read the PLAINTEXT archive with the container's own
 * `pg_restore`. No key is involved and nothing is restored.
 *
 *   mode 'list'  → `pg_restore --list`      (every cycle; cheap)
 *   mode 'full'  → `pg_restore -f /dev/null` (reads and decodes every block)
 */
export function validateArchive({ container, archivePath, mode, track }) {
  const args = mode === 'full' ? ['-f', '/dev/null'] : mode === 'list' ? ['--list'] : null
  if (!args) throw new Error(`unknown archive validation mode ${JSON.stringify(mode)}`)
  return new Promise((resolve, reject) => {
    let settled = false
    let failure = null
    let stdout = ''
    let stderr = ''
    let tracker = { handle: null, untrack: null, markLocalTermination: () => {} }
    let src = null

    const settle = (code) => {
      if (settled) return
      settled = true
      // Same rule as the bounded writer: an ordinary completion releases the
      // handle; a `docker exec` client THIS module killed stays registered so
      // the caller can probe the container or retain exclusion.
      const keepForContainerProof = tracker.handle?.locallyTerminated === true
      if (!keepForContainerProof) tracker.untrack?.()
      try {
        src?.destroy()
      } catch {
        /* already destroyed */
      }
      if (failure) return reject(failure)
      resolve({ code, stdout, stderr })
    }
    const fail = (err) => {
      if (!failure) failure = err
      // An input failure (an unreadable archive, a broken stdin that is not the
      // expected EPIPE) is an internally initiated termination.
      if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        tracker.markLocalTermination()
      }
      try {
        child.kill('SIGKILL')
      } catch {
        /* gone */
      }
      // Settle only once the child has closed, so no live child outlives the
      // rejection. `close` is guaranteed after a kill.
    }

    const child = spawn('docker', ['exec', '-i', container, 'pg_restore', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    tracker = trackChild(track, {
      label: `pg_restore --${mode}`,
      kind: 'docker-exec',
      child,
      // Deliberately BROAD: pg_restore takes no inert argv slot to carry a
      // unique token. A concurrent unrelated pg_restore in this container would
      // therefore make the probe inconclusive — which retains the lock. Erring
      // toward over-retention is the safe direction; it never signals anything.
      identityToken: 'pg_restore',
    })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('error', () => {
        /* the close handler carries the real outcome */
      })
    }
    // `pg_restore --list` reads the header and the table of contents and then
    // stops; it does not consume the rest of a piped archive. The resulting
    // EPIPE on our side is expected and is NOT a validation failure — the exit
    // code is. (This is also why `--list` alone cannot detect a truncated
    // archive whose TOC survived: that is what mode 'full' is for.)
    child.stdin.on('error', (err) => {
      if (err?.code !== 'EPIPE') fail(err)
    })
    child.on('error', (err) => {
      failure = failure ?? err
      settle(null)
    })
    child.on('close', (code) => settle(code))

    src = fs.createReadStream(archivePath)
    src.on('error', (err) => fail(err))
    src.pipe(child.stdin)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the encryption executable, capturing its ciphertext from STDOUT into a
 * file the producer owns, under a hard byte ceiling.
 *
 * THE CONTRACT CHANGED, AND WHY
 * -----------------------------
 * The tool used to be handed `--output <path>` and left to write the file
 * itself, with the budget enforced by sampling that file's size on a timer.
 * That was detection, not a bound: an executable that emitted 8 MB in one burst
 * before the first tick finished with the file 32× over a 256 KB limit and
 * `exceeded: false`. Reproduced exactly, which is why the tool now writes to
 * stdout and the producer owns the descriptor.
 *
 * Consequences, all deliberate:
 *   - the ceiling is structural — the crossing chunk is dropped, never written,
 *     so the staged ciphertext cannot exceed the permitted byte count;
 *   - the tool never touches the staging directory, so a child that outlives a
 *     forced teardown cannot write into a directory being deleted;
 *   - `age` supports this natively: with no `-o`/`--output` it writes the
 *     encrypted output to standard output, and refuses only when stdout is a
 *     terminal — it is a pipe here.
 *
 * stdin is closed: this tool is handed a path, never piped secrets, and it is
 * never given an identity.
 *
 * Returns `{ code, stderr, exceeded, bytes }`. `exceeded` means the ceiling
 * stopped it; the partial ciphertext has already been removed.
 */
export async function runEncryption({ argv, outPath, maxOutputBytes, track, stallTimeoutMs }) {
  const limit = Number.isFinite(maxOutputBytes) && maxOutputBytes > 0 ? maxOutputBytes : 0
  if (limit <= 0) {
    const err = new Error('runEncryption requires a positive maxOutputBytes ceiling')
    err.code = 'encryption_no_budget'
    throw err
  }
  const result = await spawnCapturingToFile({
    command: argv[0],
    args: argv.slice(1),
    outPath,
    maxBytes: limit,
    label: 'encryption',
    kind: 'local',
    track,
    stallTimeoutMs,
  })
  if (result.truncated) {
    // Cleanup on limit breach: the partial ciphertext is the thing that was
    // consuming the disk, so it goes before anything else runs.
    try {
      fs.rmSync(outPath, { force: true })
    } catch {
      /* the caller's staging teardown will retry */
    }
    return { code: result.code, stderr: result.stderr, exceeded: true, bytes: result.bytes }
  }
  return { code: result.code, stderr: result.stderr, exceeded: false, bytes: result.bytes }
}

/**
 * Read-only inventory of the command lines running inside a container.
 *
 * Used ONLY to answer "is the operation I started still running?" after a
 * cancellation. It never signals anything, and it never touches a process it
 * did not start — the caller matches on a token from its own argv.
 *
 * Bounded by `timeoutMs`; a failure, a timeout, or unreadable output resolves
 * to `null`, which the caller must treat as "cannot confirm", never as "gone".
 */
export function listContainerCommands({ container, timeoutMs }) {
  return new Promise((resolve) => {
    let child
    try {
      // BusyBox and procps both accept this form; verified against
      // postgres:16-alpine, which links /bin/ps to busybox.
      child = spawn('docker', ['exec', container, 'ps', '-A', '-o', 'args='], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      return resolve(null)
    }
    let stdout = ''
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      resolve(value)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      stdout += d
    })
    for (const stream of [child.stdout, child.stderr]) stream.on('error', () => {})
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code !== 0) return finish(null)
      finish(
        stdout
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      )
    })
    const timer = setTimeout(() => finish(null), Math.max(50, timeoutMs))
    timer.unref?.()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure filesystem helpers.
// ─────────────────────────────────────────────────────────────────────────────

/** Streaming sha256 — the artifact must never be held in memory in one piece. */
export function sha256File(filePath) {
  const hash = createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.allocUnsafe(1 << 20)
    for (;;) {
      const read = fs.readSync(fd, buf, 0, buf.length, null)
      if (read === 0) break
      hash.update(buf.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

/** First `n` bytes, as a latin1 string (header probing only). */
export function readFileHead(filePath, n) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(n)
    const read = fs.readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, read).toString('latin1')
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Best-effort overwrite before unlinking the plaintext dump.
 *
 * NOT erasure. On ext4 (journalled) over flash (wear-levelled, and here inside
 * a sparse VHDX on NTFS) the original blocks may survive. It narrows exposure;
 * the real control is that the plaintext exists for seconds and only inside a
 * 0700 staging directory.
 */
export function overwriteFile(filePath, bytes) {
  const fd = fs.openSync(filePath, 'r+')
  try {
    const chunk = Buffer.alloc(1 << 20, 0)
    let written = 0
    while (written < bytes) {
      const n = Math.min(chunk.length, bytes - written)
      fs.writeSync(fd, chunk, 0, n, written)
      written += n
    }
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Free space on the filesystem containing `p`.
 *
 * `bavail` (space available to an unprivileged process), not `bfree` — the
 * reserved blocks are not usable by the backup unit.
 */
export function freeSpace(p) {
  const st = fs.statfsSync(p)
  return {
    freeBytes: Number(st.bavail) * Number(st.bsize),
    totalBytes: Number(st.blocks) * Number(st.bsize),
  }
}

/** Resolve an executable name against PATH, or accept an explicit path. */
export function resolveExecutable(name) {
  const isExecutable = (p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  }
  if (name.includes('/')) return isExecutable(name) ? name : null
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue
    const candidate = path.join(dir, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/** `kill(pid, 0)`: true if the pid exists (EPERM counts — it exists). */
export function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

/** Source commit of the checkout the producer was launched from, or null. */
export function makeGitCommit(repoRoot) {
  return function gitCommit() {
    const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    if (r.status !== 0) return null
    const out = String(r.stdout ?? '').trim()
    return /^[0-9a-f]{40}$/.test(out) ? out : null
  }
}

/** `RepoDigests[0]` (or the image id) for an image reference, or null. */
export function imageDigest(ref) {
  const r = spawnSync(
    'docker',
    [
      'image',
      'inspect',
      '--format',
      '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}',
      ref,
    ],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) return null
  const out = String(r.stdout ?? '').trim()
  return out === '' ? null : out
}

/** The `deps` bundle produceBackupArtifact expects, wired to the real world. */
export function makeRealDeps({ repoRoot }) {
  return {
    now: () => Date.now(),
    pid: process.pid,
    hostname: () => os.hostname(),
    randomToken: (bytes) =>
      createHash('sha256')
        .update(`${process.pid}:${process.hrtime.bigint()}:${Math.random()}`)
        .digest('hex')
        .slice(0, bytes * 2),
    processAlive,
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
      // lstat and realpath are the destination acceptor's; it must be able to
      // describe an inbox entry WITHOUT following it, and to prove a path it is
      // about to read still resolves inside the directory it listed.
      lstatSync: fs.lstatSync,
      realpathSync: fs.realpathSync,
      // read/fstat and the open-flag constants are the acceptor's too: it copies
      // an inbox source out of a descriptor it opened O_NOFOLLOW, and decides
      // the file's type, identity and size from THAT descriptor rather than from
      // the path — which a writer with access to the inbox can re-point between
      // any check and any use.
      readSync: fs.readSync,
      fstatSync: fs.fstatSync,
      constants: fs.constants,
      renameSync: fs.renameSync,
      rmSync: fs.rmSync,
      unlinkSync: fs.unlinkSync,
      copyFileSync: fs.copyFileSync,
    },
    freeSpace,
    resolveExecutable,
    startSnapshotSession: makeSnapshotSession(),
    runDump,
    validateArchive,
    runEncryption,
    listContainerCommands,
    sha256File,
    readFileHead,
    overwriteFile,
    gitCommit: makeGitCommit(repoRoot),
    imageDigest,
  }
}
