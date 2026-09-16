#!/usr/bin/env node
/**
 * TEST DOUBLE — a fake Proton Drive CLI binary (`proton-drive`).
 *
 * **This is not the real Proton Drive CLI and performs no cloud operation of
 * any kind.** It exists so `ops/backup/lib/backup-cloud-cli.mjs`'s subprocess
 * boundary — argv capture, bounded stdout/stderr, exit codes, and
 * process-lifecycle (timeout / SIGTERM / SIGKILL) behaviour — can be
 * exercised without the real binary, a Proton account, or any network
 * access. Nothing it emits is confidential, and no test using it may be
 * reported as proof of real provider, credential, or network behaviour.
 *
 * EXIT-BEFORE-DRAIN (E3J4A FIX)
 * -------------------------------
 * The E3J4 version wrote to `process.stdout`/`process.stderr` and then called
 * `process.exit(code)` immediately, which can truncate still-buffered output
 * on a pipe. Fixed: every write is followed by its own completion callback,
 * awaited before anything else happens, and the expected/normal exit path
 * sets `process.exitCode` and returns naturally instead of calling
 * `process.exit()`. `process.exit()` is still used on the two paths where
 * nothing needs to drain first: the stdout-error handler (the stream already
 * broke) and the SIGTERM/SIGINT handler (only a synchronous
 * `fs.writeFileSync` precedes it).
 *
 * CONTROL-FILE MECHANISM (E3J4B)
 * ---------------------------------
 * The E3J4/E3J4A versions read their response spec, argv log path, and
 * marker directory from three separate `FAKE_PROTON_*` environment
 * variables passed through the production `spawn()` env. E3J4B replaces the
 * production environment composition with a small POSITIVE allowlist (see
 * `internal/backup-cloud-cli-core.mjs`'s `ENV_ALLOWLIST`) that does not, and must not,
 * carry any test-only variable — extending it for this double's sake would
 * be exactly the kind of production-policy weakening the correction exists
 * to prevent.
 *
 * Instead, this double reads ONE variable, `FAKE_PROTON_CONTROL_DIR`, and
 * every test sandbox's own generated launcher script (`sandbox()` in
 * `backup-cloud-cli.test.mjs`) sets it via a shell-level assignment prefixed
 * onto its own `exec` line — `FAKE_PROTON_CONTROL_DIR=<dir> exec <node> ...`
 * — which is part of the LAUNCHER's own invocation, not something inherited
 * from whatever `env` object the production boundary composed and passed to
 * `spawn()`. The control directory then holds fixed, well-known filenames:
 *
 *   <FAKE_PROTON_CONTROL_DIR>/response.json   the JSON response spec (below)
 *   <FAKE_PROTON_CONTROL_DIR>/argv.log        one JSON-array line appended per invocation
 *   <FAKE_PROTON_CONTROL_DIR>/env-observations.json  see below
 *   <FAKE_PROTON_CONTROL_DIR>/markers/        proton.started / proton.stopped
 *
 * ENVIRONMENT OBSERVATION — KEY NAMES ONLY (E3J4C)
 * --------------------------------------------------
 * This double must NEVER serialize a complete environment dump. Writing one
 * would put inherited `PATH`, `HOME`/`XDG_*` locations, `GNUPGHOME`,
 * `PASSWORD_STORE_DIR`, agent socket addresses, locale, and `TMPDIR` values
 * of whatever machine ran the suite into a file on disk — exactly the
 * ambient deployment detail the production environment allowlist exists to
 * contain. `env-observations.json` therefore records only:
 *
 *   {"envKeys": [...sorted key NAMES...],
 *    "envKeyEquality": {"KEY": true|false}}   // optional, see below
 *
 * `envKeyEquality` appears only when the response spec asks for it by name
 * via `envKeyEqualityChecks: {"KEY": "expected"}`, and carries booleans —
 * never the observed value. Tests that need to assert an inherited VALUE
 * (that an allowlisted key's value survives, that a secret under another
 * name does not) do so against the in-memory `options.env` object handed to
 * a spawn double; nothing is spawned and nothing is written for those.
 *
 * Response spec shape:
 *
 *   {
 *     "stdout": "...",        // written verbatim, then...
 *     "stderr": "...",        // ...written verbatim
 *     "exitCode": 0,          // default 0; ignored if "hang" is true
 *     "hang": false,          // write stdout/stderr, then never exit
 *     "ignoreSigterm": false, // install a SIGTERM handler that does nothing,
 *                             // forcing a caller's SIGTERM->SIGKILL escalation
 *     "delayMs": 0,           // wait this long before writing anything
 *     "envKeyEqualityChecks": {"KEY": "expected"},  // -> booleans only
 *     "chunk": {              // optional: write AFTER "stdout", for
 *       "text": "A",          // exercising a byte-ceiling overflow with
 *       "count": 0,           // output too large to build as one JSON string
 *       "intervalMs": 5
 *     },
 *     "notFoundForQueriedBasename": false  // (E3J5) see below
 *   }
 *
 * MULTI-STEP SEQUENCES (E3J5, ADDITIVE)
 * ---------------------------------------
 * The E3J5 upload-attempt tests drive several invocations through ONE
 * launcher. If `response.json` is instead `{"sequence": [spec, spec, …]}`,
 * the Nth invocation (0-based, counted in `<controlDir>/invocation-count`)
 * uses `sequence[N]`; running past the end is a hard double error (exit 64).
 * A spec without `sequence` behaves exactly as before.
 *
 * `notFoundForQueriedBasename: true` replaces `stdout`/`stderr`/`exitCode`
 * with the evidenced not-found shape for the path this invocation actually
 * queried — stderr `Node not found: <basename of the queried path operand>`,
 * exit 1 — because the attempt folder name contains a random token a test
 * cannot know in advance. It is only meaningful for
 * `filesystem info <path> --json`.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Await a write's OWN completion callback — not its boolean return value. */
function writeAndDrain(stream, text) {
  if (typeof text !== 'string' || text === '') return Promise.resolve()
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => (err ? reject(err) : resolve()))
  })
}

const controlDir = process.env.FAKE_PROTON_CONTROL_DIR
const mark = (name, body = '') => {
  if (!controlDir) return
  try {
    fs.writeFileSync(path.join(controlDir, 'markers', name), body)
  } catch {
    /* the test may already have torn the directory down */
  }
}

async function main() {
  if (!controlDir) {
    await writeAndDrain(process.stderr, 'fake-proton-drive: FAKE_PROTON_CONTROL_DIR is required\n')
    process.exitCode = 64
    return
  }

  let spec
  try {
    spec = JSON.parse(fs.readFileSync(path.join(controlDir, 'response.json'), 'utf8'))
  } catch (err) {
    await writeAndDrain(
      process.stderr,
      `fake-proton-drive: could not read response spec: ${err?.message}\n`,
    )
    process.exitCode = 64
    return
  }

  if (Array.isArray(spec?.sequence)) {
    const counterPath = path.join(controlDir, 'invocation-count')
    let index = 0
    try {
      index = Number(fs.readFileSync(counterPath, 'utf8')) || 0
    } catch {
      index = 0
    }
    fs.writeFileSync(counterPath, String(index + 1))
    if (index >= spec.sequence.length) {
      await writeAndDrain(process.stderr, `fake-proton-drive: sequence exhausted at ${index}\n`)
      process.exitCode = 64
      return
    }
    spec = spec.sequence[index]
  }

  if (spec?.notFoundForQueriedBasename) {
    const queried = String(process.argv[4] ?? '')
    spec = {
      ...spec,
      stdout: '',
      stderr: `Node not found: ${path.posix.basename(queried)}\n`,
      exitCode: 1,
    }
  }

  try {
    fs.appendFileSync(
      path.join(controlDir, 'argv.log'),
      JSON.stringify(process.argv.slice(2)) + '\n',
    )
  } catch {
    /* the test may already have torn the directory down */
  }

  // Key NAMES only, plus any boolean equality checks the spec asked for by
  // name. No inherited environment VALUE is ever serialized here.
  try {
    const observations = { envKeys: Object.keys(process.env).sort() }
    const checks = spec.envKeyEqualityChecks
    if (checks !== null && typeof checks === 'object') {
      const equality = {}
      for (const [key, expected] of Object.entries(checks)) {
        equality[key] = process.env[key] === expected
      }
      observations.envKeyEquality = equality
    }
    fs.writeFileSync(
      path.join(controlDir, 'env-observations.json'),
      JSON.stringify(observations) + '\n',
    )
  } catch {
    /* the test may already have torn the directory down */
  }

  mark('proton.started', `${process.pid}`)

  if (spec.ignoreSigterm) {
    process.on('SIGTERM', () => {
      /* deliberately ignored — the caller must escalate to SIGKILL */
    })
  } else {
    for (const sig of ['SIGTERM', 'SIGINT']) {
      process.on(sig, () => {
        mark('proton.stopped', sig)
        // Only a synchronous fs write precedes this — nothing pending to drain.
        process.exit(143)
      })
    }
  }

  // stdout/stderr may be destroyed out from under this process the moment a
  // caller's byte ceiling fires. Nothing to drain at that point either.
  process.stdout.on('error', () => process.exit(141))
  process.stderr.on('error', () => {})

  if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs))
  await writeAndDrain(process.stdout, spec.stdout)
  await writeAndDrain(process.stderr, spec.stderr)
  if (spec.chunk) {
    const { text, count = 0, intervalMs = 5 } = spec.chunk
    for (let i = 0; i < count; i++) {
      // eslint-disable-next-line no-await-in-loop -- deliberately paced, drained writes
      await writeAndDrain(process.stdout, text)
      // eslint-disable-next-line no-await-in-loop -- deliberately paced writes
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  if (spec.hang) {
    setInterval(() => {}, 1000)
    return
  }
  // Preferred over process.exit(): lets the event loop — and any I/O this
  // function already awaited — finish completely naturally, with no risk of
  // truncating output that has not yet reached the OS.
  process.exitCode = Number.isInteger(spec.exitCode) ? spec.exitCode : 0
}

main().catch((err) => {
  try {
    process.stderr.write(`fake-proton-drive: unexpected error: ${err?.message ?? String(err)}\n`)
  } catch {
    /* stderr gone */
  }
  process.exitCode = 70
})
