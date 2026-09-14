/**
 * Proton Drive CLI subprocess boundary — E3J4, corrected by E3J4A, E3J4B,
 * and E3J4C.
 *
 * E3J4C CONTEXT: a third independent review found that removing E3J4A's
 * `runOperationForTests()` had closed only the arbitrary-ARGV half of the
 * seam — the four production operations still accepted a caller-supplied
 * `deps` object able to replace the executable hasher, `spawn`, the child
 * environment, local stat evidence, and the capture ceilings. The boundary
 * logic therefore moved to `internal/backup-cloud-cli-core.mjs`, where
 * `makeCloudCliOperations(deps)` is an explicitly internal TEST SEAM (not an
 * access-control boundary), while `backup-cloud-cli.mjs` binds
 * `REAL_CLI_DEPS` once and exposes four operations that accept no dependency
 * at all. E3J4C also required upload to cross-check the provider's byte
 * count against caller-supplied local evidence and to stop promoting a
 * `skippedItems: 1` response to success, bound download's local evidence to
 * the exact immediate child of `localDir` named by the queried remote
 * basename (with a pre-spawn, non-symlink-following absence check and a
 * regular-file-only readback), and replaced `Number.isInteger` with
 * `Number.isSafeInteger` on every provider-derived byte count.
 *
 * E3J4B CONTEXT: a further independent review pass found ten more defects
 * on top of E3J4A's eleven: the credential anchor did not match the
 * AUTHORITATIVE scratch-memo text (it used the architecture memo's
 * shortened paraphrase); not-found classification accepted any name rather
 * than the queried path's own basename; name-conflict classification did
 * not bind to the uploaded file's identity or check stderr was empty; the
 * "test-only" `runOperationForTests()` seam was still a production-
 * reachable way to construct arbitrary argv and has been REMOVED; the
 * environment was built by copying-and-stripping rather than a positive
 * allowlist; operand-validation errors echoed the invalid value; a signal's
 * `.aborted` was checked before it was validated as a real `AbortSignal`;
 * capture-stream errors were silently swallowed; and timeout/local-stat
 * validation was too permissive. All ten are fixed in the module and
 * covered here — see that module's own docblock for the itemized list.
 *
 * Two kinds of test here, deliberately not mixed in the same case:
 *
 *   - FUNCTIONAL tests spawn the REAL fake CLI process
 *     (`testdoubles/fake-proton-drive.mjs`) through the REAL `spawn` boundary
 *     — argv, exit codes, timeouts, SIGTERM/SIGKILL escalation, and
 *     byte-ceiling overflow are all exercised against a real child process.
 *   - UNIT tests build operations from the internal core bound to test deps
 *     (see `boundOperation()` below) — typically a fake `spawn`, an inert
 *     `EventEmitter` standing in for a `ChildProcess` — to assert exactly
 *     what the boundary HANDS to `spawn` (argv, env, stdio) without process
 *     overhead, and to simulate conditions (a stream error, a malformed
 *     `lstat` result) that are impractical to trigger in a real child.
 *   - PRODUCTION-SURFACE tests call the real, unparameterized exports
 *     (`productionRun*`) and prove that a `deps` property handed to them is
 *     inert — the real hash, the real `spawn`, the real environment, the
 *     real `lstat`, and the real capture ceilings are used regardless.
 *
 * WHAT THIS SUITE PROVES, AND WHAT IT DOES NOT
 * ------------------------------------------------
 * Proves: this repository's own logic — argv construction (including
 * rejection of option-like/unsafe operands, with no echoed value on
 * rejection), strict response shape validation with EXACT anchored
 * classification bound to the actual query/upload identity, the closed
 * error-code classification, a positive environment allowlist, non-leakage
 * of unexpected keys/values/provider-authored/native-error free text
 * through this module's own return values and thrown errors, result
 * immutability, bounded process-lifecycle handling including capture-stream
 * failures, and that the production exports honour no injected dependency.
 *
 * Does NOT prove, and this file makes no such claim: real Proton Drive
 * behaviour, real network conditions, real credential lifecycle (including
 * which of the allowlisted environment variables the eventual Hotel-Echo
 * mechanism will actually need, or that an allowlisted variable's INHERITED
 * VALUE is trustworthy — the allowlist bounds key NAMES only), that the
 * acknowledged raw-schema hypotheses (info/create-folder success shape,
 * create-folder's `--json` flag, download's terminal-summary shape) match
 * the real CLI, that hashing closes the post-hash executable-replacement
 * TOCTOU gap, that upload's caller-supplied `expectedLocalSizeBytes` was
 * measured from the right inode or is free of local-file TOCTOU (E3J5 owes
 * its safe derivation), that the gap between download's pre-spawn absence
 * check and its readback is closed, E3J6's hard download containment,
 * descriptor ownership, or content verification, or that a WRITTEN
 * ATTESTATION contains no marker —
 * there is no attestation writer until E3J6. T8 here is scoped to this
 * subprocess boundary's own returned values, thrown errors, and this file's
 * own captured stdio — not to any later component, and an allowlisted
 * opaque provider identifier surviving in a result is EXPECTED provider
 * metadata, not evidence of "sanitization".
 */

import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { after, afterEach, beforeEach, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BackupError } from './backup-artifact-contract.mjs'
import {
  CLOUD_CLI_ERROR_CODES,
  FORBIDDEN_ARGV_TOKENS,
  buildCreateFolderArgv,
  buildDownloadArgv,
  buildInfoArgv,
  buildUploadArgv,
  runCreateFolder as productionRunCreateFolder,
  runDownload as productionRunDownload,
  runInfo as productionRunInfo,
  runUpload as productionRunUpload,
} from './backup-cloud-cli.mjs'
import { REAL_CLI_DEPS, makeCloudCliOperations } from './internal/backup-cloud-cli-core.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

// ── the deps-bound test seam ────────────────────────────────────────────────
//
// E3J4C: the four PRODUCTION operations no longer accept a `deps` argument of
// any kind, so a test that needs a fake spawn, a fixed hash, a synthetic
// environment, crafted local-stat evidence, or a tiny capture ceiling builds
// its operations from the internal core instead, bound to test deps merged
// over `REAL_CLI_DEPS`. This is an explicitly internal test seam, reachable
// only by importing the core module by path — it is NOT reachable through the
// production module and is not an access-control boundary.
//
// The `productionRun*` imports above are the real, unparameterized exports;
// the "production deps injection is inert" section near the end of this file
// calls THOSE, never these wrappers.

function boundOperation(name, { deps: depsOverride = {}, ...params }) {
  return makeCloudCliOperations({ ...REAL_CLI_DEPS, ...depsOverride })[name](params)
}
const runInfo = (params) => boundOperation('runInfo', params)
const runCreateFolder = (params) => boundOperation('runCreateFolder', params)
const runUpload = (params) => boundOperation('runUpload', params)
const runDownload = (params) => boundOperation('runDownload', params)

installTestWatchdog({ label: 'cloud-cli', warnAfterMs: 6_000, intervalMs: 4_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DOUBLE = path.join(HERE, 'testdoubles', 'fake-proton-drive.mjs')

const HASH_A = '0123456789abcdef'.repeat(8)
const HASH_B = 'fedcba9876543210'.repeat(8)

const CLI = Object.freeze({
  executable: '/opt/eanhl-cloud/bin/proton-drive',
  expectedSha512: HASH_A,
})
const CREDENTIALS = Object.freeze({ backend: 'pass' })
const GENEROUS_TIMEOUTS = Object.freeze({ operationTimeoutMs: 5_000, cancelGraceMs: 500 })
const SHORT_TIMEOUTS = Object.freeze({ operationTimeoutMs: 400, cancelGraceMs: 300 })

const isArgvInvalid = (err) => err instanceof BackupError && err.code === 'cloud_cli_argv_invalid'
const isInvalidInput = (err) => err instanceof BackupError && err.code === 'cloud_cli_invalid_input'

// ── real-process sandbox: a per-sandbox launcher pointing at the fake CLI ────
//
// E3J4B: the launcher embeds this sandbox's control directory via a
// SHELL-LEVEL env assignment on its own exec line
// (`FAKE_PROTON_CONTROL_DIR=<dir> exec <node> <double> "$@"`) — NOT
// inherited from whatever the production `env` allowlist passes to
// `spawn()`. This is how the fake CLI receives its response-spec/argv-log/
// marker-dir configuration without the production environment allowlist
// needing to carry any test-only variable. See the double's own docblock.

const sandboxes = []
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cloud-cli-'))
  sandboxes.push(dir)
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'markers'), { recursive: true })
  const launcher = path.join(dir, 'bin', 'proton-drive')
  // Absolute interpreter path, never `#!/usr/bin/env node` — a PATH-resolved
  // shebang fails silently wherever node is not on the child's PATH, which
  // the production environment allowlist may not forward at all.
  fs.writeFileSync(
    launcher,
    `#!/bin/sh\nFAKE_PROTON_CONTROL_DIR=${shellQuote(dir)} exec ${process.execPath} ${DOUBLE} "$@"\n`,
    { mode: 0o755 },
  )
  return dir
}
function writeSpec(dir, obj) {
  fs.writeFileSync(path.join(dir, 'response.json'), JSON.stringify(obj))
}

/** Every real child this file's `spawn` wrapper started, so cleanup can wait for them. */
const liveChildren = new Set()

let sandboxCountAtTestStart = 0
beforeEach(() => {
  sandboxCountAtTestStart = sandboxes.length
})

afterEach(async () => {
  // Terminate ONLY this test's own children, then WAIT for them to actually
  // end before removing their sandbox — never delete a directory a still-
  // running child might still touch.
  const owned = [...liveChildren]
  for (const child of owned) {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
  await Promise.all(
    owned.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve()
          child.once('exit', () => resolve())
          const timer = setTimeout(resolve, 2000) // bounded — never hang the suite's cleanup
          timer.unref?.()
        }),
    ),
  )
  liveChildren.clear()

  // Remove ONLY the sandbox directories THIS test created — an exact,
  // recorded path each time, never a prefix scan of `/tmp`, and never
  // another test's or another run's directory.
  const created = sandboxes.splice(sandboxCountAtTestStart)
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

after(() => {
  for (const dir of sandboxes.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** deps for a FUNCTIONAL test: real spawn (tracked for cleanup), fixed cli hash, minimal env (nothing the double needs is on the allowlist). */
function realDeps(overrides = {}) {
  return {
    sha512File: () => HASH_A,
    spawn: (...args) => {
      const child = nodeSpawn(...args)
      liveChildren.add(child)
      child.on('exit', () => liveChildren.delete(child))
      return child
    },
    env: {},
    ...overrides,
  }
}

function cliFor(dir) {
  return { executable: path.join(dir, 'bin', 'proton-drive'), expectedSha512: HASH_A }
}

/**
 * Local-evidence double modelling the real download sequence (E3J4C): the
 * bound destination is ABSENT when the pre-spawn absence check runs, and
 * PRESENT when the post-command readback runs.
 *
 * The fake `spawn` writes no file, so a test that wants to assert on the
 * downloaded file pre-creates it. Without this wrapper that pre-created file
 * would (correctly) trip the new `download_destination_exists` preflight, so
 * the FIRST lstat reports a definite ENOENT and every later one delegates to
 * `after` — the real `fs.lstatSync` by default, or a crafted stat result.
 *
 * `download_destination_exists` itself is proved separately, by tests that do
 * NOT install this wrapper.
 */
function absentThen(after = (p) => fs.lstatSync(p)) {
  let calls = 0
  return (p) => {
    calls += 1
    if (calls === 1) {
      const err = new Error('no such file or directory')
      err.code = 'ENOENT'
      throw err
    }
    return typeof after === 'function' ? after(p) : after
  }
}

function makeLocalFile(dir, size) {
  const p = path.join(dir, 'downloaded.dump.age')
  fs.writeFileSync(p, Buffer.alloc(size))
  return p
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}
async function waitForFile(p, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
    await sleep(10)
  }
  throw new Error(`timed out waiting for ${p}`)
}
async function waitUntilDead(pid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await sleep(10)
  }
  return false
}

// ── unit-test double: an inert fake ChildProcess, for spawn-spy assertions ────

function makeInertChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  // A well-behaved kill eventually closes — needed so the bounded
  // termination path (used by timeout/overflow/stream-failed) resolves
  // promptly in unit tests instead of waiting out cancelChild's own
  // timeout.
  child.kill = () => {
    setImmediate(() => child.emit('close', null, 'SIGTERM'))
  }
  return child
}

/** A `spawn` replacement that never touches a real process. Records every call. */
function makeSpawnSpy(calls, { stdout = '', stderr = '', code = 0 } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options })
    const child = makeInertChild()
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      if (stderr) child.stderr.emit('data', Buffer.from(stderr))
      setImmediate(() => child.emit('close', code))
    })
    return child
  }
}

/** Recursively scans a value (including a thrown error's own enumerable properties, message, and cause) for a marker substring. */
function scanForMarker(value, marker, seen = new Set()) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.includes(marker)
  if (typeof value !== 'object' && typeof value !== 'function') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((v) => scanForMarker(v, marker, seen))
  for (const key of Object.getOwnPropertyNames(value)) {
    let v
    try {
      v = value[key]
    } catch {
      continue
    }
    if (scanForMarker(v, marker, seen)) return true
  }
  return false
}

// ── valid raw provider-response fixtures (see the module docblock's evidence note) ─

const validInfoRaw = () => ({
  nodeUid: 'sSJMCqlrUzr4LDaYtT9f_A~L2FnBYCbCxdyuQjZGnu2GA',
  nodeKind: 'file',
  state: 'active',
  activeRevisionUid: 'rEvIsIoN~uid-1234',
  claimedSize: 8388608,
  claimedDigests: { sha1: 'a'.repeat(40) },
  sha1Verified: false,
})
const validCreateFolderRaw = () => ({ created: true, folderUid: 'fOlDeR~uid-5678' })
const validUploadSuccessRaw = () => ({
  transferredItems: 1,
  transferredBytes: 8388608,
  skippedItems: 0,
  failedItems: 0,
  failures: [],
})
const validDownloadSummaryRaw = (bytes) => ({
  transferredItems: 1,
  transferredBytes: bytes,
  skippedItems: 0,
  failedItems: 0,
  failures: [],
})
/** `localFilePath`'s basename must equal both `name` and the quoted name in `error` for this to classify as name_conflict. */
const nameConflictRawFor = (localFilePath) => {
  const basename = localFilePath.split('/').pop()
  return {
    transferredItems: 0,
    transferredBytes: 0,
    skippedItems: 0,
    failedItems: 1,
    failures: [
      {
        name: basename,
        error: `ValidationError: Name conflict on "${basename}" (file) already exists`,
      },
    ],
  }
}

/** The EXACT authoritative two-line text from `proton-drive-scratch-experiment.md` §8.2/§8.3. */
const CREDENTIAL_UNAVAILABLE_TEXT =
  'Failed to load session in pass: gpg: public key decryption failed: No such file or directory\ngpg: decryption failed: No such file or directory'
/** The architecture memo's SHORTENED paraphrase — must NOT be treated as the anchor. */
const CREDENTIAL_UNAVAILABLE_SHORTENED =
  'Failed to load session in pass: gpg: public key decryption failed\ngpg: decryption failed'

async function infoWithRaw(raw, code = 0) {
  return runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stdout: JSON.stringify(raw), code }),
    },
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// T3 — exact argv array, no shell; spaces/quotes/* arrive verbatim.
// ═════════════════════════════════════════════════════════════════════════════

test('T3: info argv is constructed as a plain array with the exact path segments', () => {
  const argv = buildInfoArgv({ executable: '/bin/proton-drive', remotePath: '/x/y' })
  assert.deepEqual(argv, ['/bin/proton-drive', 'filesystem', 'info', '/x/y', '--json'])
})

test('T3: upload/download argv put --json immediately after the subcommand', () => {
  assert.deepEqual(
    buildUploadArgv({
      executable: '/bin/proton-drive',
      localFilePath: '/local/a',
      remoteParentPath: '/remote/b',
    }),
    ['/bin/proton-drive', 'filesystem', 'upload', '--json', '/local/a', '/remote/b'],
  )
  assert.deepEqual(
    buildDownloadArgv({
      executable: '/bin/proton-drive',
      remotePath: '/remote/a',
      localDir: '/local/b',
    }),
    ['/bin/proton-drive', 'filesystem', 'download', '--json', '/remote/a', '/local/b'],
  )
})

test('T3: a remote path containing spaces, quotes, and * arrives at the real child verbatim (no shell)', async () => {
  const dir = sandbox()
  const weird = '/proton/backups/eanhl/weird "quoted" * path'
  const basename = 'weird "quoted" * path'
  writeSpec(dir, { stdout: `Node not found: ${basename}\n`, exitCode: 1 })
  const result = await runInfo({
    remotePath: weird,
    cli: cliFor(dir),
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: realDeps(),
  })
  assert.deepEqual(result, { kind: 'success', operation: 'info', present: false })
  const argvLog = path.join(dir, 'argv.log')
  const logged = JSON.parse((await waitForFile(argvLog)).trim())
  assert.deepEqual(logged, ['filesystem', 'info', weird, '--json'])
})

test('T3: spawn is invoked with an argv array, shell:false explicitly, and stdin ignored', async () => {
  const calls = []
  await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy(calls, { stdout: '', stderr: 'Node not found: x', code: 1 }),
    },
  })
  assert.equal(calls.length, 1)
  assert.ok(Array.isArray(calls[0].args))
  assert.equal(calls[0].options.shell, false)
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe'])
})

// ═════════════════════════════════════════════════════════════════════════════
// T4 / T5 — forbidden argv tokens and option-injection safety.
// ═════════════════════════════════════════════════════════════════════════════

test('T4/T5: forbidden tokens are absent from representative argv fixtures (exact-element, not substring)', () => {
  const fixtures = [
    buildInfoArgv({ executable: '/bin/proton-drive', remotePath: '/a/b list c' }),
    buildCreateFolderArgv({
      executable: '/bin/proton-drive',
      parentPath: '/a',
      name: 'replace-me',
    }),
    buildUploadArgv({
      executable: '/bin/proton-drive',
      localFilePath: '/local/auth-notes.txt',
      remoteParentPath: '/a',
    }),
    buildDownloadArgv({
      executable: '/bin/proton-drive',
      remotePath: '/a/skip-this.dump.age',
      localDir: '/local',
    }),
  ]
  for (const argv of fixtures) {
    for (const token of FORBIDDEN_ARGV_TOKENS) {
      assert.ok(
        !argv.includes(token),
        `argv ${JSON.stringify(argv)} must not contain the exact token ${token}`,
      )
    }
  }
})

test('T4/T5: the operation word is always exactly one of the four allowed operations', () => {
  const argvs = [
    buildInfoArgv({ executable: '/bin/proton-drive', remotePath: '/a' }),
    buildCreateFolderArgv({ executable: '/bin/proton-drive', parentPath: '/a', name: 'b' }),
    buildUploadArgv({
      executable: '/bin/proton-drive',
      localFilePath: '/local/a',
      remoteParentPath: '/b',
    }),
    buildDownloadArgv({ executable: '/bin/proton-drive', remotePath: '/a', localDir: '/local/b' }),
  ]
  const allowed = new Set(['info', 'create-folder', 'upload', 'download'])
  for (const argv of argvs) {
    assert.equal(argv[1], 'filesystem')
    assert.ok(allowed.has(argv[2]), `unexpected operation word ${argv[2]}`)
  }
})

const GOOD_LOCAL = '/opt/eanhl-cloud/bin/proton-drive'
const GOOD_REMOTE = '/proton/backups/eanhl'

test('T5b: a bare option-like value is rejected in the create-folder name position', () => {
  for (const bad of ['-f', '--conflict-strategy', '--version', '-']) {
    assert.throws(
      () => buildCreateFolderArgv({ executable: GOOD_LOCAL, parentPath: GOOD_REMOTE, name: bad }),
      isArgvInvalid,
    )
  }
})

test('T5b: a path segment beginning with "-" is rejected for every local and remote path operand', () => {
  const localWithDashSegment = '/opt/eanhl-cloud/-bin/proton-drive'
  const remoteWithDashSegment = '/proton/backups/-eanhl'
  assert.throws(
    () => buildInfoArgv({ executable: GOOD_LOCAL, remotePath: remoteWithDashSegment }),
    isArgvInvalid,
  )
  assert.throws(
    () => buildInfoArgv({ executable: localWithDashSegment, remotePath: GOOD_REMOTE }),
    isArgvInvalid,
  )
  assert.throws(
    () =>
      buildUploadArgv({
        executable: GOOD_LOCAL,
        localFilePath: localWithDashSegment,
        remoteParentPath: GOOD_REMOTE,
      }),
    isArgvInvalid,
  )
  assert.throws(
    () =>
      buildDownloadArgv({
        executable: GOOD_LOCAL,
        remotePath: GOOD_REMOTE,
        localDir: localWithDashSegment,
      }),
    isArgvInvalid,
  )
})

test('T5b: non-canonical paths (.., //, trailing /, ./) are rejected outright — never silently normalized into accepted input', () => {
  for (const bad of ['/a/../b', '/a//b', '/a/b/', '/a/./b']) {
    assert.throws(() => buildInfoArgv({ executable: GOOD_LOCAL, remotePath: bad }), isArgvInvalid)
    assert.throws(
      () =>
        buildUploadArgv({
          executable: bad,
          localFilePath: GOOD_LOCAL,
          remoteParentPath: GOOD_REMOTE,
        }),
      isArgvInvalid,
    )
  }
})

test('T5b: spaces, quotes, and * inside an otherwise-valid path component still arrive verbatim — not rejected as unsafe', () => {
  const weird = '/proton/backups/eanhl/weird "quoted" * path/here'
  assert.deepEqual(buildInfoArgv({ executable: GOOD_LOCAL, remotePath: weird }), [
    GOOD_LOCAL,
    'filesystem',
    'info',
    weird,
    '--json',
  ])
})

// ═════════════════════════════════════════════════════════════════════════════
// Operand-error sanitization: no invalid value, imported message, or cause
// ever escapes a rejection.
// ═════════════════════════════════════════════════════════════════════════════

test('operand errors: marker-bearing invalid local path, remote path, folder-name, executable, NUL, repeated-separator, dot-segment, and option-like values never echo the value', () => {
  const marker = 'operand-secret-marker-xyz'
  const attempts = [
    () => buildInfoArgv({ executable: `/opt/${marker}\0/proton-drive`, remotePath: '/a' }),
    () => buildInfoArgv({ executable: GOOD_LOCAL, remotePath: `/proton/${marker}//x` }),
    () => buildInfoArgv({ executable: GOOD_LOCAL, remotePath: `/proton/${marker}/../x` }),
    () => buildInfoArgv({ executable: GOOD_LOCAL, remotePath: `/proton/-${marker}` }),
    () =>
      buildCreateFolderArgv({
        executable: GOOD_LOCAL,
        parentPath: GOOD_REMOTE,
        name: `-${marker}`,
      }),
    () =>
      buildUploadArgv({
        executable: marker,
        localFilePath: GOOD_LOCAL,
        remoteParentPath: GOOD_REMOTE,
      }),
  ]
  for (const attempt of attempts) {
    let caught = null
    try {
      attempt()
    } catch (err) {
      caught = err
    }
    assert.ok(caught instanceof BackupError, 'must throw a BackupError')
    assert.equal(caught.code, 'cloud_cli_argv_invalid')
    assert.equal(caught.cause, undefined)
    assert.ok(
      !scanForMarker(caught, marker),
      `error leaked the marker: ${caught.message} / ${JSON.stringify(Object.getOwnPropertyNames(caught))}`,
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// T6 — each operation's success result is EXACTLY the allowlisted key set.
// ═════════════════════════════════════════════════════════════════════════════

test('T6: info success key set is exact', async () => {
  const result = await infoWithRaw(validInfoRaw())
  assert.deepEqual(Object.keys(result).sort(), [
    'activeRevisionUid',
    'claimedSha1',
    'claimedSizeBytes',
    'kind',
    'nodeKind',
    'nodeUid',
    'operation',
    'present',
    'sha1Verified',
    'state',
  ])
  assert.equal(result.kind, 'success')
})

test('T6: create-folder success key set is exact', async () => {
  const result = await runCreateFolder({
    parentPath: '/a',
    name: 'b',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stdout: JSON.stringify(validCreateFolderRaw()), code: 0 }),
    },
  })
  assert.deepEqual(Object.keys(result).sort(), ['created', 'folderUid', 'kind', 'operation'])
})

test('T6: upload success key set is exact', async () => {
  const result = await runUpload({
    localFilePath: '/local/a',
    remoteParentPath: '/b',
    expectedLocalSizeBytes: 8388608,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stdout: JSON.stringify(validUploadSuccessRaw()), code: 0 }),
    },
  })
  assert.deepEqual(Object.keys(result).sort(), [
    'failedItems',
    'failureCodes',
    'kind',
    'operation',
    'skippedItems',
    'transferredBytes',
    'transferredItems',
  ])
})

test('T6: download success key set is exact, and no provider-derived field appears even from a well-formed report', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const result = await runDownload({
    remotePath: '/a/downloaded.dump.age',
    localDir: dir,
    expectedLocalPath: localPath,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stdout: JSON.stringify(validDownloadSummaryRaw(42)), code: 0 }),
      lstatSync: absentThen(),
    },
  })
  assert.deepEqual(Object.keys(result).sort(), [
    'bytesWritten',
    'completed',
    'kind',
    'localPath',
    'operation',
  ])
  assert.equal(result.localPath, localPath)
  assert.equal(result.bytesWritten, 42)
})

// ═════════════════════════════════════════════════════════════════════════════
// T7 — missing, renamed, extra, or wrongly-typed fields become indeterminate.
// ═════════════════════════════════════════════════════════════════════════════

test('T7: info — a missing field is indeterminate, never a defaulted success', async () => {
  const raw = validInfoRaw()
  delete raw.state
  const result = await infoWithRaw(raw)
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_unexpected_shape')
})

test('T7: info — a renamed field is indeterminate', async () => {
  const raw = validInfoRaw()
  raw.node_uid = raw.nodeUid
  delete raw.nodeUid
  const result = await infoWithRaw(raw)
  assert.equal(result.kind, 'indeterminate')
})

test('T7: info — an extra unexpected top-level field is indeterminate', async () => {
  const raw = validInfoRaw()
  raw.unexpectedField = 'anything'
  const result = await infoWithRaw(raw)
  assert.equal(result.kind, 'indeterminate')
})

test('T7: info — a wrongly-typed field is indeterminate', async () => {
  const raw = validInfoRaw()
  raw.claimedSize = '8388608' // string, not number
  const result = await infoWithRaw(raw)
  assert.equal(result.kind, 'indeterminate')
})

test('T7: info — an unrecognised nodeKind/state enum value is indeterminate', async () => {
  const a = validInfoRaw()
  a.nodeKind = 'symlink'
  assert.equal((await infoWithRaw(a)).kind, 'indeterminate')
  const b = validInfoRaw()
  b.state = 'deleted'
  assert.equal((await infoWithRaw(b)).kind, 'indeterminate')
})

test('T7: create-folder — created:false, extra field, or malformed folderUid is indeterminate, never rejected', async () => {
  async function withRaw(raw) {
    return runCreateFolder({
      parentPath: '/a',
      name: 'b',
      cli: CLI,
      credentials: CREDENTIALS,
      timeouts: GENEROUS_TIMEOUTS,
      deps: {
        sha512File: () => HASH_A,
        spawn: makeSpawnSpy([], { stdout: JSON.stringify(raw), code: 0 }),
      },
    })
  }
  const r1 = await withRaw({ created: false, folderUid: 'x' })
  assert.equal(r1.kind, 'indeterminate')
  const r2 = await withRaw({ created: true, folderUid: 'x', extra: 1 })
  assert.equal(r2.kind, 'indeterminate')
  const r3 = await withRaw({ created: true, folderUid: 'has a space' })
  assert.equal(r3.kind, 'indeterminate')
})

test('T7: upload — a wrongly-typed count or a malformed failures entry is indeterminate', async () => {
  async function withRaw(raw, code = 0) {
    return runUpload({
      localFilePath: '/local/a',
      remoteParentPath: '/b',
      expectedLocalSizeBytes: 8388608,
      cli: CLI,
      credentials: CREDENTIALS,
      timeouts: GENEROUS_TIMEOUTS,
      deps: {
        sha512File: () => HASH_A,
        spawn: makeSpawnSpy([], { stdout: JSON.stringify(raw), code }),
      },
    })
  }
  const r1 = await withRaw({ ...validUploadSuccessRaw(), transferredItems: 2 })
  assert.equal(r1.kind, 'indeterminate')
  const r2 = await withRaw({ ...validUploadSuccessRaw(), transferredBytes: '8388608' })
  assert.equal(r2.kind, 'indeterminate')
  const r3 = await withRaw({ ...nameConflictRawFor('/local/a'), failures: [{ name: 'x' }] }, 1)
  assert.equal(r3.kind, 'indeterminate')
})

// ═════════════════════════════════════════════════════════════════════════════
// T8 — recursive containment. Allowlisted opaque provider identifiers
// (nodeUid/folderUid/activeRevisionUid) surviving validation are EXPECTED
// provider metadata, not evidence of "sanitization" — T8 proves an
// unexpected key, value shape, or provider-authored free text cannot escape.
// ═════════════════════════════════════════════════════════════════════════════

const SECRET_MARKERS = [
  'token-9f8e7d6c5b4a',
  'session-abc123def456',
  'p@ssw0rd-marker',
  'passphrase-marker-xyz',
  'cookie-marker=abc123',
  'recovery-phrase-marker',
  'operator@example.com',
  'https://account.proton.me/auth?token=marker-leak-check',
]

function assertNoLeak(value, label) {
  const serialized = JSON.stringify(value)
  for (const marker of SECRET_MARKERS) {
    assert.ok(
      !serialized.includes(marker),
      `${label} leaked marker ${JSON.stringify(marker)}: ${serialized}`,
    )
  }
}

test('T8: markers injected as extra/renamed keys and as field values never survive info/create-folder/upload', async () => {
  const mutations = [
    (raw) => ({ ...raw, [SECRET_MARKERS[0]]: 'x' }),
    (raw) => ({ ...raw, state: SECRET_MARKERS[1] }),
  ]
  for (const mutate of mutations) {
    const info = await infoWithRaw(mutate(validInfoRaw()))
    assert.equal(info.kind, 'indeterminate')
    assertNoLeak(info, 'info result')

    const folder = await runCreateFolder({
      parentPath: '/a',
      name: 'b',
      cli: CLI,
      credentials: CREDENTIALS,
      timeouts: GENEROUS_TIMEOUTS,
      deps: {
        sha512File: () => HASH_A,
        spawn: makeSpawnSpy([], {
          stdout: JSON.stringify(mutate(validCreateFolderRaw())),
          code: 0,
        }),
      },
    })
    assert.equal(folder.kind, 'indeterminate')
    assertNoLeak(folder, 'create-folder result')
  }
})

test('T8: markers injected into upload failures[].error, and into raw stderr/stdout text, never survive', async () => {
  for (const marker of SECRET_MARKERS) {
    const raw = {
      ...nameConflictRawFor('/local/a'),
      failures: [{ name: 'x', error: `ValidationError: ${marker}` }],
    }
    const upload = await runUpload({
      localFilePath: '/local/a',
      remoteParentPath: '/b',
      expectedLocalSizeBytes: 8388608,
      cli: CLI,
      credentials: CREDENTIALS,
      timeouts: GENEROUS_TIMEOUTS,
      deps: {
        sha512File: () => HASH_A,
        spawn: makeSpawnSpy([], { stdout: JSON.stringify(raw), code: 1 }),
      },
    })
    assert.equal(upload.kind, 'indeterminate')
    assertNoLeak(upload, 'upload result')

    const info = await runInfo({
      remotePath: '/x',
      cli: CLI,
      credentials: CREDENTIALS,
      timeouts: GENEROUS_TIMEOUTS,
      deps: {
        sha512File: () => HASH_A,
        spawn: makeSpawnSpy([], { stdout: '', stderr: `noise ${marker} noise`, code: 1 }),
      },
    })
    assert.equal(info.kind, 'indeterminate')
    assertNoLeak(info, 'info result (stderr marker)')
  }
})

test('T8: the exact credential-unavailable classification never echoes any raw stream text (nothing to leak, by construction)', async () => {
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 1 }),
    },
  })
  assert.deepEqual(result, {
    kind: 'rejected',
    operation: 'info',
    code: 'credential_unavailable',
    transferState: 'definitely_zero',
  })
  assertNoLeak(result, 'credential_unavailable result')
})

// ═════════════════════════════════════════════════════════════════════════════
// T9 — malformed, truncated, empty, oversized, and valid-but-wrong-shape
// output all produce indeterminate, never success or a thrown error.
// ═════════════════════════════════════════════════════════════════════════════

test('T9: malformed JSON is indeterminate (provider_response_malformed)', async () => {
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, spawn: makeSpawnSpy([], { stdout: '{not json', code: 0 }) },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_malformed')
})

test('T9: truncated JSON is indeterminate', async () => {
  const result = await runCreateFolder({
    parentPath: '/a',
    name: 'b',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stdout: '{"created":true,', code: 0 }),
    },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_malformed')
})

test('T9: empty stdout is indeterminate', async () => {
  const result = await runUpload({
    localFilePath: '/local/a',
    remoteParentPath: '/b',
    expectedLocalSizeBytes: 8388608,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, spawn: makeSpawnSpy([], { stdout: '', code: 0 }) },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_malformed')
})

test('T9: valid JSON of a completely different shape is indeterminate, never success', async () => {
  const result = await infoWithRaw({ ok: true, totallyDifferent: 'shape' })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_unexpected_shape')
})

test('T9: oversized stdout is contained and indeterminate — see the output-limit-termination test below', () => {
  assert.ok(true)
})

// ═════════════════════════════════════════════════════════════════════════════
// Name-conflict classification, bound to the uploaded file's own identity.
// ═════════════════════════════════════════════════════════════════════════════

async function uploadWith({
  localFilePath = '/local/probe-1MiB.bin',
  expectedLocalSizeBytes = 1_048_576,
  stdout,
  stderr = '',
  code,
}) {
  return runUpload({
    localFilePath,
    remoteParentPath: '/b',
    expectedLocalSizeBytes,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, spawn: makeSpawnSpy([], { stdout, stderr, code }) },
  })
}

test('definite zero-transfer: the exact anchored Name-conflict shape, bound to the uploaded file, is rejected/name_conflict', async () => {
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(nameConflictRawFor('/local/probe-1MiB.bin')),
    code: 1,
  })
  assert.deepEqual(result, {
    kind: 'rejected',
    operation: 'upload',
    code: 'name_conflict',
    transferState: 'definitely_zero',
  })
})

test('name-conflict near-miss: contradictory nonempty stderr alongside an otherwise-matching conflict body is indeterminate', async () => {
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(nameConflictRawFor('/local/probe-1MiB.bin')),
    stderr: 'unexpected diagnostic text',
    code: 1,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.notEqual(result.code, 'name_conflict')
})

test('name-conflict near-miss: a failure entry whose "name" does not match the uploaded file is indeterminate', async () => {
  const raw = nameConflictRawFor('/local/probe-1MiB.bin')
  raw.failures[0].name = 'unrelated-file.bin' // error text still correctly names probe-1MiB.bin
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(raw),
    code: 1,
  })
  assert.equal(result.kind, 'indeterminate')
})

test('name-conflict near-miss: a different name embedded in the error text is indeterminate', async () => {
  const raw = nameConflictRawFor('/local/probe-1MiB.bin')
  raw.failures[0].error =
    'ValidationError: Name conflict on "unrelated-file.bin" (file) already exists'
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(raw),
    code: 1,
  })
  assert.equal(result.kind, 'indeterminate')
})

test('name-conflict near-miss: extra failure entries (even if the first matches) are indeterminate', async () => {
  const raw = nameConflictRawFor('/local/probe-1MiB.bin')
  raw.failures.push({ name: 'probe-1MiB.bin', error: raw.failures[0].error })
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(raw),
    code: 1,
  })
  assert.equal(result.kind, 'indeterminate')
})

test('name-conflict near-miss: otherwise-valid conflict data reported for a DIFFERENT local file is indeterminate', async () => {
  const raw = nameConflictRawFor('/local/probe-1MiB.bin') // conflict is about probe-1MiB.bin
  const result = await uploadWith({
    localFilePath: '/local/some-other-file.bin',
    stdout: JSON.stringify(raw),
    code: 1,
  })
  assert.equal(result.kind, 'indeterminate')
})

test('ambiguous failure: a DIFFERENT nonzero-exit failure text is indeterminate, never name_conflict', async () => {
  const raw = {
    transferredItems: 0,
    transferredBytes: 0,
    skippedItems: 0,
    failedItems: 1,
    failures: [{ name: 'probe-1MiB.bin', error: 'NetworkError: request timed out' }],
  }
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(raw),
    code: 1,
  })
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'upload',
    code: 'provider_error_unrecognised',
    transferState: 'unknown',
  })
})

test('the anchored shape on exit 0 (inconsistent) is indeterminate, not rejected — exit code is part of the anchor', async () => {
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(nameConflictRawFor('/local/probe-1MiB.bin')),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
})

test('an all-zero response on exit 0 (nothing transferred, nothing skipped, nothing failed) is indeterminate, not a false success', async () => {
  const raw = {
    transferredItems: 0,
    transferredBytes: 0,
    skippedItems: 0,
    failedItems: 0,
    failures: [],
  }
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(raw),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_error_unrecognised')
})

// ═════════════════════════════════════════════════════════════════════════════
// Not-found classification, bound to the queried path's basename.
// ═════════════════════════════════════════════════════════════════════════════

async function infoAt(remotePath, { stdout = '', stderr = '', code = 1 } = {}) {
  return runInfo({
    remotePath,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, spawn: makeSpawnSpy([], { stdout, stderr, code }) },
  })
}

test("not-found: the sentinel naming the QUERIED path's own basename is present:false", async () => {
  const result = await infoAt('/my-files/eanhl-e3-scratch-20260911T192651Z', {
    stderr: 'Node not found: eanhl-e3-scratch-20260911T192651Z',
  })
  assert.deepEqual(result, { kind: 'success', operation: 'info', present: false })
})

test('not-found near-miss: a sentinel naming a DIFFERENT basename than the one queried is indeterminate', async () => {
  const result = await infoAt('/my-files/target', { stderr: 'Node not found: other' })
  assert.notEqual(result.present, false)
  assert.equal(result.kind, 'indeterminate')
})

test('not-found near-miss: the exact sentinel text is correct for a DIFFERENT query than the one actually made', async () => {
  // The response would be a valid not-found sentinel for "/my-files/right-name",
  // but this call queried "/my-files/wrong-name" — must not be reused.
  const result = await infoAt('/my-files/wrong-name', { stderr: 'Node not found: right-name' })
  assert.notEqual(result.present, false)
})

test('not-found near-miss: an ACTIVE (non-trash) path receiving the trash-only sentinel is indeterminate, never present:false', async () => {
  const result = await infoAt('/my-files/target', { stderr: 'Trashed node not found' })
  assert.notEqual(result.present, false)
  assert.equal(result.kind, 'indeterminate')
})

test('not-found: a trash-namespace query receiving "Trashed node not found" is present:false', async () => {
  const result = await infoAt('/trash/target', { stdout: 'Trashed node not found' })
  assert.deepEqual(result, { kind: 'success', operation: 'info', present: false })
})

test('not-found adversarial near-miss: preceding text, following text, extra lines, JSON-embedded, wrong exit, both streams — all indeterminate', async () => {
  const cases = [
    { label: 'preceding text', stderr: 'warning: retrying\nNode not found: target' },
    { label: 'following text', stderr: 'Node not found: target\nextra line' },
    { label: 'extra lines', stderr: 'Node not found: target\nsecond\nthird' },
    { label: 'embedded in JSON', stdout: '{"note":"Node not found: target"}' },
    { label: 'wrong exit code', stderr: 'Node not found: target', code: 0 },
    { label: 'content in both streams', stdout: 'unrelated', stderr: 'Node not found: target' },
  ]
  for (const { label, ...spec } of cases) {
    const result = await infoAt('/my-files/target', spec)
    assert.notEqual(result.present, false, `${label}: must not be classified present:false`)
    assert.notEqual(result.kind, 'rejected', `${label}: must not be a rejection`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Credential-unavailable classification: the AUTHORITATIVE full two-line
// text, and its adversarial near-miss suite.
// ═════════════════════════════════════════════════════════════════════════════

test("credential_unavailable requires the AUTHORITATIVE full text — the architecture memo's shortened two-line variant is indeterminate, not the anchor", async () => {
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_SHORTENED, code: 1 }),
    },
  })
  assert.notEqual(result.code, 'credential_unavailable')
  assert.equal(result.kind, 'indeterminate')
})

test('credential_unavailable: the exact authoritative two-line text is the anchor', async () => {
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 1 }),
    },
  })
  assert.deepEqual(result, {
    kind: 'rejected',
    operation: 'info',
    code: 'credential_unavailable',
    transferState: 'definitely_zero',
  })
})

test('adversarial near-miss (credential_unavailable): preceding/following text, extra lines, JSON-embedded, wrong exit, both streams, partial-success-then-credential-text — all indeterminate, never credential_unavailable', async () => {
  async function infoWith({ stdout = '', stderr = '', code = 1 }) {
    return runInfo({
      remotePath: '/x',
      cli: CLI,
      credentials: CREDENTIALS,
      timeouts: GENEROUS_TIMEOUTS,
      deps: { sha512File: () => HASH_A, spawn: makeSpawnSpy([], { stdout, stderr, code }) },
    })
  }
  const cases = [
    { label: 'preceding text', stderr: `warning\n${CREDENTIAL_UNAVAILABLE_TEXT}` },
    { label: 'following text', stderr: `${CREDENTIAL_UNAVAILABLE_TEXT}\nextra` },
    {
      label: 'extra line inserted mid-text',
      stderr:
        'Failed to load session in pass: gpg: public key decryption failed: No such file or directory\nextra\ngpg: decryption failed: No such file or directory',
    },
    {
      label: 'embedded in JSON',
      stdout: JSON.stringify({
        error:
          'Failed to load session in pass: gpg: public key decryption failed: No such file or directory',
      }),
    },
    { label: 'wrong exit code', stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 0 },
    { label: 'content in both streams', stdout: 'unrelated', stderr: CREDENTIAL_UNAVAILABLE_TEXT },
    {
      label: 'credential text following an apparent partial-success response',
      stdout: JSON.stringify(validInfoRaw()),
      stderr: CREDENTIAL_UNAVAILABLE_TEXT,
    },
  ]
  for (const { label, ...spec } of cases) {
    const result = await infoWith(spec)
    assert.notEqual(
      result.code,
      'credential_unavailable',
      `${label}: must not be classified credential_unavailable`,
    )
    assertNoLeak(result, `near-miss result (${label})`)
  }
})

test('credential_unavailable requires backend "pass" — the same exact text under "keychain" is indeterminate, never rejected', async () => {
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: { backend: 'keychain' },
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 1 }),
    },
  })
  assert.notEqual(result.code, 'credential_unavailable')
})

test('credential_unavailable is anchored and shared across all four operations', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 1)
  const runners = [
    () =>
      runInfo({
        remotePath: '/x',
        cli: CLI,
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: {
          sha512File: () => HASH_A,
          spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 1 }),
        },
      }),
    () =>
      runCreateFolder({
        parentPath: '/a',
        name: 'b',
        cli: CLI,
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: {
          sha512File: () => HASH_A,
          spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 1 }),
        },
      }),
    () =>
      runUpload({
        localFilePath: '/local/a',
        remoteParentPath: '/b',
        expectedLocalSizeBytes: 8388608,
        cli: CLI,
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: {
          sha512File: () => HASH_A,
          spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 1 }),
        },
      }),
    () =>
      runDownload({
        remotePath: '/a/downloaded.dump.age',
        localDir: dir,
        expectedLocalPath: localPath,
        cli: CLI,
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: {
          sha512File: () => HASH_A,
          spawn: makeSpawnSpy([], { stderr: CREDENTIAL_UNAVAILABLE_TEXT, code: 1 }),
          lstatSync: absentThen(),
        },
      }),
  ]
  for (const run of runners) {
    const result = await run()
    assert.equal(result.kind, 'rejected')
    assert.equal(result.code, 'credential_unavailable')
    assert.equal(result.transferState, 'definitely_zero')
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Nonempty stderr on an apparent success — required for info, create-folder,
// upload, and download.
// ═════════════════════════════════════════════════════════════════════════════

test('nonempty stderr on success: info — a zero exit with valid stdout but nonempty stderr is indeterminate, never success', async () => {
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], {
        stdout: JSON.stringify(validInfoRaw()),
        stderr: 'unexpected warning text',
        code: 0,
      }),
    },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_stderr_on_success')
})

test('nonempty stderr on success: create-folder — same rule', async () => {
  const result = await runCreateFolder({
    parentPath: '/a',
    name: 'b',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], {
        stdout: JSON.stringify(validCreateFolderRaw()),
        stderr: 'unexpected warning text',
        code: 0,
      }),
    },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_stderr_on_success')
})

test('nonempty stderr on success: upload — same rule', async () => {
  const result = await runUpload({
    localFilePath: '/local/a',
    remoteParentPath: '/b',
    expectedLocalSizeBytes: 8388608,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], {
        stdout: JSON.stringify(validUploadSuccessRaw()),
        stderr: 'unexpected warning text',
        code: 0,
      }),
    },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_stderr_on_success')
})

test('nonempty stderr on success: download — same rule', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const result = await runDownload({
    remotePath: '/a/downloaded.dump.age',
    localDir: dir,
    expectedLocalPath: localPath,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], {
        stdout: JSON.stringify(validDownloadSummaryRaw(42)),
        stderr: 'unexpected warning text',
        code: 0,
      }),
      lstatSync: absentThen(),
    },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_stderr_on_success')
})

// ═════════════════════════════════════════════════════════════════════════════
// Download response validation and local-stat evidence hardening.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `remotePath` is derived from `localPath`'s basename, because E3J4C binds
 * `expectedLocalPath` to exactly `<localDir>/<remote basename>`. Local
 * evidence defaults to `absentThen()` — absent at the preflight, real
 * `fs.lstatSync` at the readback; `readbackStat` replaces only the readback.
 */
async function downloadWith({ dir, localPath, stdout, stderr = '', code = 0, readbackStat }) {
  return runDownload({
    remotePath: `/a/${localPath.split('/').pop()}`,
    localDir: dir,
    expectedLocalPath: localPath,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stdout, stderr, code }),
      lstatSync: absentThen(readbackStat),
    },
  })
}

test('download: malformed JSON is indeterminate, even though the local file exists (closes the E3J4 vulnerability)', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const result = await downloadWith({ dir, localPath, stdout: '{not json', code: 0 })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_malformed')
})

test('download: empty stdout is indeterminate, even though the local file exists', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const result = await downloadWith({ dir, localPath, stdout: '', code: 0 })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_malformed')
})

test('download: the exact E3J4-vulnerable attacker-controlled shape ({localPath, bytesWritten}) is now indeterminate, never success', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const result = await downloadWith({
    dir,
    localPath,
    stdout: JSON.stringify({ localPath: '/attacker-controlled', bytesWritten: 999999 }),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_unexpected_shape')
})

test('download: an extra unexpected key in the summary is indeterminate', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const raw = { ...validDownloadSummaryRaw(42), extra: 1 }
  const result = await downloadWith({ dir, localPath, stdout: JSON.stringify(raw), code: 0 })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_unexpected_shape')
})

test('download: a wrongly-typed field is indeterminate', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const raw = { ...validDownloadSummaryRaw(42), transferredBytes: '42' }
  const result = await downloadWith({ dir, localPath, stdout: JSON.stringify(raw), code: 0 })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_response_unexpected_shape')
})

test('download: failedItems:1 is indeterminate, never success', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const raw = {
    transferredItems: 0,
    transferredBytes: 0,
    skippedItems: 0,
    failedItems: 1,
    failures: [{ name: 'x', error: 'boom' }],
  }
  const result = await downloadWith({ dir, localPath, stdout: JSON.stringify(raw), code: 1 })
  assert.equal(result.kind, 'indeterminate')
})

test('download: skippedItems:1 (nothing transferred) is indeterminate, never success', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const raw = {
    transferredItems: 0,
    transferredBytes: 0,
    skippedItems: 1,
    failedItems: 0,
    failures: [],
  }
  const result = await downloadWith({ dir, localPath, stdout: JSON.stringify(raw), code: 0 })
  assert.equal(result.kind, 'indeterminate')
})

test('download: a reported byte count that disagrees with the local file size is indeterminate/download_size_mismatch, never success', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const raw = validDownloadSummaryRaw(999) // local file is actually 42 bytes
  const result = await downloadWith({ dir, localPath, stdout: JSON.stringify(raw), code: 0 })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'download_size_mismatch')
  assert.ok(!('bytesWritten' in result))
})

test('download: a clean, well-formed success summary whose byte count matches the local file is success', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const raw = validDownloadSummaryRaw(42)
  const result = await downloadWith({ dir, localPath, stdout: JSON.stringify(raw), code: 0 })
  assert.deepEqual(result, {
    kind: 'success',
    operation: 'download',
    localPath,
    bytesWritten: 42,
    completed: true,
  })
})

test('download: a throwing isFile accessor with a marker message is sanitized to local_readback_missing, no leak', async () => {
  const marker = 'stat-native-marker-xyz'
  const result = await downloadWith({
    dir: '/irrelevant',
    localPath: '/irrelevant/x',
    stdout: JSON.stringify(validDownloadSummaryRaw(42)),
    code: 0,
    readbackStat: () => ({
      isFile: () => {
        throw new Error(`ENOENT: ${marker}`)
      },
      size: 42,
    }),
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'local_readback_missing')
  assert.ok(!JSON.stringify(result).includes(marker))
})

test('download: a non-function isFile, a non-boolean isFile, or a non-safe-integer/negative size is local_readback_missing', async () => {
  const badStats = [
    { isFile: true, size: 42 },
    { isFile: () => 'yes', size: 42 },
    { isFile: () => true, size: '42' },
    { isFile: () => true, size: -1 },
    { isFile: () => true, size: 1.5 },
    { isFile: () => true, size: Number.MAX_SAFE_INTEGER + 1 },
    null,
  ]
  for (const badStat of badStats) {
    const result = await downloadWith({
      dir: '/irrelevant',
      localPath: '/irrelevant/x',
      stdout: JSON.stringify(validDownloadSummaryRaw(42)),
      code: 0,
      readbackStat: () => badStat,
    })
    assert.equal(result.kind, 'indeterminate')
    assert.equal(result.code, 'local_readback_missing')
  }
})

test('download: a throwing size accessor with a marker message is sanitized to local_readback_missing, no leak', async () => {
  const marker = 'stat-size-native-marker-xyz'
  const result = await downloadWith({
    dir: '/irrelevant',
    localPath: '/irrelevant/x',
    stdout: JSON.stringify(validDownloadSummaryRaw(42)),
    code: 0,
    readbackStat: () => ({
      isFile: () => true,
      get size() {
        throw new Error(`EIO: ${marker}`)
      },
    }),
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'local_readback_missing')
  assert.equal(result.transferState, 'unknown')
  assert.ok(!scanForMarker(result, marker), 'no native accessor text may reach the result')
  assert.ok(!('bytesWritten' in result))
})

test('download: the size accessor is read exactly once — a stateful getter cannot pass validation and then return something else', async () => {
  // Reads: 1st = 42 (valid), every later read = a DIFFERENT value. If the
  // module read `size` more than once, the returned `bytesWritten` would be
  // 99 (or the size comparison would use a value the validator never saw).
  let reads = 0
  const drifting = await downloadWith({
    dir: '/irrelevant',
    localPath: '/irrelevant/x',
    stdout: JSON.stringify(validDownloadSummaryRaw(42)),
    code: 0,
    readbackStat: () => ({
      isFile: () => true,
      get size() {
        reads += 1
        return reads === 1 ? 42 : 99
      },
    }),
  })
  assert.equal(reads, 1, 'size must be observed exactly once')
  assert.equal(drifting.kind, 'success')
  assert.equal(drifting.bytesWritten, 42)

  // Same shape, but every read after the first THROWS. Reading twice would
  // let a native error escape instead of producing a closed result.
  const marker = 'second-read-marker-xyz'
  let throwingReads = 0
  const poisoned = await downloadWith({
    dir: '/irrelevant',
    localPath: '/irrelevant/x',
    stdout: JSON.stringify(validDownloadSummaryRaw(42)),
    code: 0,
    readbackStat: () => ({
      isFile: () => true,
      get size() {
        throwingReads += 1
        if (throwingReads === 1) return 42
        throw new Error(`EIO: ${marker}`)
      },
    }),
  })
  assert.equal(throwingReads, 1, 'size must be observed exactly once')
  assert.equal(poisoned.kind, 'success')
  assert.equal(poisoned.bytesWritten, 42)
  assert.ok(!scanForMarker(poisoned, marker))
})

test('download: local evidence that is not a REGULAR file (symlink, directory, socket) is local_readback_not_regular_file, never success', async () => {
  for (const notRegular of [
    { isFile: () => false, size: 42 }, // what lstat() reports for a symlink
    { isFile: () => false, size: 4096 }, // a directory
    { isFile: () => false, size: 0 }, // a socket/fifo
  ]) {
    const result = await downloadWith({
      dir: '/irrelevant',
      localPath: '/irrelevant/x',
      stdout: JSON.stringify(validDownloadSummaryRaw(42)),
      code: 0,
      readbackStat: () => notRegular,
    })
    assert.equal(result.kind, 'indeterminate')
    assert.equal(result.code, 'local_readback_not_regular_file')
  }
})

test('download: a REAL symlink pointing at a real correctly-sized file is refused — lstat does not follow it', async () => {
  const dir = sandbox()
  const target = path.join(dir, 'real-target.bin')
  fs.writeFileSync(target, Buffer.alloc(42))
  const linkPath = path.join(dir, 'downloaded.dump.age')
  fs.symlinkSync(target, linkPath)
  // `absentThen()` hides the link from the PREFLIGHT only; the readback below
  // is the real `fs.lstatSync`, which reports the LINK, not its target.
  const result = await downloadWith({
    dir,
    localPath: linkPath,
    stdout: JSON.stringify(validDownloadSummaryRaw(42)),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'local_readback_not_regular_file')
})

// ═════════════════════════════════════════════════════════════════════════════
// Environment composition: a positive allowlist.
// ═════════════════════════════════════════════════════════════════════════════

test('env: only the positive allowlist plus PROTON_DRIVE_CREDENTIALS_STORE is forwarded — secret markers and execution-control variables are dropped', async () => {
  const calls = []
  const marker = 'leak-marker-should-not-forward'
  await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: { backend: 'keychain' },
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      env: {
        // allowed — must survive
        PATH: '/usr/bin:/bin',
        HOME: '/home/operator',
        XDG_DATA_HOME: '/home/operator/.local/share',
        XDG_CONFIG_HOME: '/home/operator/.config',
        XDG_CACHE_HOME: '/home/operator/.cache',
        XDG_RUNTIME_DIR: '/run/user/1000',
        GNUPGHOME: '/home/operator/.gnupg',
        GPG_AGENT_INFO: '/run/gpg-agent:0:1',
        PASSWORD_STORE_DIR: '/home/operator/.password-store',
        DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        LC_CTYPE: 'en_US.UTF-8',
        TMPDIR: '/tmp',
        // must NOT survive — secrets/tokens
        AWS_SECRET_ACCESS_KEY: marker,
        API_TOKEN: marker,
        GITHUB_TOKEN: marker,
        HTTPS_PROXY: `http://user:${marker}@proxy.example:8080`,
        // must NOT survive — execution-control / injection vectors
        LD_PRELOAD: '/tmp/evil.so',
        LD_LIBRARY_PATH: '/tmp/evil-libs',
        NODE_OPTIONS: `--require /tmp/${marker}.js`,
        BUN_OPTIONS: marker,
        // must NOT survive — an inherited PROTON_DRIVE_* variable
        PROTON_DRIVE_SOMETHING: marker,
        PROTON_DRIVE_CREDENTIALS_STORE: 'pass', // must be OVERWRITTEN by the validated selector, not merely allowed through
      },
      spawn: makeSpawnSpy(calls, { stderr: 'Node not found: x', code: 1 }),
    },
  })
  const env = calls[0].options.env
  assert.deepEqual(env, {
    PATH: '/usr/bin:/bin',
    HOME: '/home/operator',
    XDG_DATA_HOME: '/home/operator/.local/share',
    XDG_CONFIG_HOME: '/home/operator/.config',
    XDG_CACHE_HOME: '/home/operator/.cache',
    XDG_RUNTIME_DIR: '/run/user/1000',
    GNUPGHOME: '/home/operator/.gnupg',
    GPG_AGENT_INFO: '/run/gpg-agent:0:1',
    PASSWORD_STORE_DIR: '/home/operator/.password-store',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LC_CTYPE: 'en_US.UTF-8',
    TMPDIR: '/tmp',
    PROTON_DRIVE_CREDENTIALS_STORE: 'keychain',
  })
  assert.ok(!JSON.stringify(env).includes(marker), 'no marker may survive into the child env')
})

test('credentials.backend is validated again at this boundary — arbitrary values and "unsafe_file" are rejected', async () => {
  for (const backend of ['unsafe_file', 'anything', '']) {
    await assert.rejects(
      () =>
        runInfo({
          remotePath: '/x',
          cli: CLI,
          credentials: { backend },
          timeouts: GENEROUS_TIMEOUTS,
          deps: {
            sha512File: () => HASH_A,
            spawn: () => {
              throw new Error('must not spawn')
            },
          },
        }),
      isInvalidInput,
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// T22 — call ordering.
//
// Each operation: (1) validate local call inputs and cancellation state;
// (2) compute and verify the REAL executable hash; (3) only then validate
// operands, build argv, and spawn. Hashing is not the literal first action —
// step 1 precedes it — but no operand is inspected, no argv constructed, and
// no child spawned until the hash gate passes.
//
// Proved WITHOUT any injectable argv builder and without a builder spy: a
// deliberately invalid operand paired with a mismatched hash must fail with
// the HASH error, and spawn must not be reached; the SAME invalid operand
// under a matching hash reaches and fails the fixed builder.
// ═════════════════════════════════════════════════════════════════════════════

test('T22: hash gate runs before argv construction — a mismatched hash reports cli_hash_mismatch even when the operand is invalid', async () => {
  const spawnCalls = []
  await assert.rejects(
    () =>
      runInfo({
        remotePath: '-f', // invalid operand: would fail buildInfoArgv's validator if ever reached
        cli: CLI, // expectedSha512 = HASH_A
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: {
          sha512File: () => HASH_B, // mismatched
          spawn: (...args) => {
            spawnCalls.push(args)
            throw new Error('spawn must not be called')
          },
        },
      }),
    (err) => err instanceof BackupError && err.code === 'cli_hash_mismatch',
  )
  assert.equal(spawnCalls.length, 0)
})

test('T22: once the hash gate passes, the same invalid operand reaches and fails the fixed argv builder', async () => {
  const spawnCalls = []
  await assert.rejects(
    () =>
      runInfo({
        remotePath: '-f', // the SAME invalid operand as the previous test
        cli: CLI,
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: {
          sha512File: () => HASH_A, // matches this time
          spawn: (...args) => {
            spawnCalls.push(args)
            throw new Error('spawn must not be called')
          },
        },
      }),
    isArgvInvalid,
  )
  assert.equal(spawnCalls.length, 0)
})

test('T22: a malformed configured pin or a malformed observed hash also refuses before argv construction', async () => {
  for (const sha512File of [() => 'not-a-hex-hash', () => HASH_A.toUpperCase()]) {
    const spawnCalls = []
    await assert.rejects(
      () =>
        runCreateFolder({
          parentPath: '/a',
          name: '-f', // deliberately invalid operand
          cli: CLI,
          credentials: CREDENTIALS,
          timeouts: GENEROUS_TIMEOUTS,
          deps: {
            sha512File,
            spawn: (...args) => {
              spawnCalls.push(args)
              throw new Error('must not spawn')
            },
          },
        }),
      (err) => err instanceof BackupError && err.code.startsWith('cli_hash_'),
    )
    assert.equal(spawnCalls.length, 0)
  }
})

test('T22: on a matching hash and valid operands, the gate passes and argv/spawn proceed with the expected argv', async () => {
  const calls = []
  const result = await runUpload({
    localFilePath: '/local/x.dump.age',
    remoteParentPath: '/remote/base/attempt',
    expectedLocalSizeBytes: 8388608,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy(calls, {
        stdout: JSON.stringify(nameConflictRawFor('/local/x.dump.age')),
        code: 1,
      }),
    },
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, [
    'filesystem',
    'upload',
    '--json',
    '/local/x.dump.age',
    '/remote/base/attempt',
  ])
  assert.equal(result.kind, 'rejected')
  assert.equal(result.code, 'name_conflict')
})

test('T22: no --version command is ever invoked by any operation', () => {
  for (const argv of [
    buildInfoArgv({ executable: '/x', remotePath: '/a' }),
    buildCreateFolderArgv({ executable: '/x', parentPath: '/a', name: 'b' }),
    buildUploadArgv({ executable: '/x', localFilePath: '/local/a', remoteParentPath: '/b' }),
    buildDownloadArgv({ executable: '/x', remotePath: '/a', localDir: '/local/b' }),
  ]) {
    assert.ok(!argv.includes('--version'))
  }
})

test('T22: the real local SHA-512 hash of the executable is what gates the run (end to end, no injected hasher)', async () => {
  const dir = sandbox()
  const launcherPath = path.join(dir, 'bin', 'proton-drive')
  const realSha512 = createHash('sha512').update(fs.readFileSync(launcherPath)).digest('hex')
  writeSpec(dir, { stderr: 'Node not found: x', exitCode: 1 })
  // deliberately does NOT override sha512File — exercises the module's own
  // real streaming-hash implementation against the real launcher file.
  const { sha512File: _unused, ...deps } = realDeps()
  const result = await runInfo({
    remotePath: '/x',
    cli: { executable: launcherPath, expectedSha512: realSha512 },
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps,
  })
  assert.deepEqual(result, { kind: 'success', operation: 'info', present: false })
})

test('preflight: a missing CLI executable is sanitized to one stable BackupError with no native path/error text', async () => {
  const marker = 'super-secret-native-path-marker-xyz'
  const missingPath = `/nonexistent/${marker}/proton-drive`
  await assert.rejects(
    () =>
      runInfo({
        remotePath: '/x',
        cli: { executable: missingPath, expectedSha512: HASH_A },
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: {}, // real sha512File, real fs — the executable genuinely does not exist
      }),
    (err) => {
      assert.ok(err instanceof BackupError)
      assert.equal(err.code, 'cli_executable_unreadable')
      assert.ok(!scanForMarker(err, marker))
      assert.equal(err.cause, undefined)
      return true
    },
  )
})

test('preflight: malformed cli/credentials/timeouts inputs are validated without echoing the invalid value', async () => {
  const marker = 'injected-marker-should-not-echo'
  const noSpawn = () => {
    throw new Error('must not spawn')
  }
  await assert.rejects(
    () =>
      runInfo({
        remotePath: '/x',
        cli: null,
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        deps: { sha512File: () => HASH_A, spawn: noSpawn },
      }),
    isInvalidInput,
  )
  await assert.rejects(
    () =>
      runInfo({
        remotePath: '/x',
        cli: CLI,
        credentials: { backend: marker },
        timeouts: GENEROUS_TIMEOUTS,
        deps: { sha512File: () => HASH_A, spawn: noSpawn },
      }),
    (err) => {
      assert.ok(isInvalidInput(err))
      assert.ok(!scanForMarker(err, marker))
      return true
    },
  )
  await assert.rejects(
    () =>
      runInfo({
        remotePath: '/x',
        cli: CLI,
        credentials: CREDENTIALS,
        timeouts: { operationTimeoutMs: NaN, cancelGraceMs: 100 },
        deps: { sha512File: () => HASH_A, spawn: noSpawn },
      }),
    isInvalidInput,
  )
})

test('timeouts: non-integer, zero, or negative values are rejected', async () => {
  const noSpawn = () => {
    throw new Error('must not spawn')
  }
  for (const timeouts of [
    { operationTimeoutMs: 100.5, cancelGraceMs: 50 },
    { operationTimeoutMs: 0, cancelGraceMs: 50 },
    { operationTimeoutMs: -100, cancelGraceMs: 50 },
    { operationTimeoutMs: 100, cancelGraceMs: 50.5 },
    { operationTimeoutMs: 100, cancelGraceMs: 0 },
  ]) {
    await assert.rejects(
      () =>
        runInfo({
          remotePath: '/x',
          cli: CLI,
          credentials: CREDENTIALS,
          timeouts,
          deps: { sha512File: () => HASH_A, spawn: noSpawn },
        }),
      isInvalidInput,
    )
  }
})

test('timeouts: cancelGraceMs must be strictly less than operationTimeoutMs', async () => {
  const noSpawn = () => {
    throw new Error('must not spawn')
  }
  for (const timeouts of [
    { operationTimeoutMs: 100, cancelGraceMs: 100 },
    { operationTimeoutMs: 100, cancelGraceMs: 200 },
  ]) {
    await assert.rejects(
      () =>
        runInfo({
          remotePath: '/x',
          cli: CLI,
          credentials: CREDENTIALS,
          timeouts,
          deps: { sha512File: () => HASH_A, spawn: noSpawn },
        }),
      isInvalidInput,
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Immutability: every returned result is frozen, including any array-valued
// field.
// ═════════════════════════════════════════════════════════════════════════════

test('immutability: success, rejected, and indeterminate results are all frozen and refuse mutation', async () => {
  const success = await infoWithRaw(validInfoRaw())
  assert.equal(success.kind, 'success')
  assert.ok(Object.isFrozen(success))
  assert.throws(() => {
    success.kind = 'tampered'
  }, TypeError)

  const rejected = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    stdout: JSON.stringify(nameConflictRawFor('/local/probe-1MiB.bin')),
    code: 1,
  })
  assert.equal(rejected.kind, 'rejected')
  assert.ok(Object.isFrozen(rejected))
  assert.throws(() => {
    rejected.code = 'tampered'
  }, TypeError)

  const indeterminateResult = await infoWithRaw({ ok: true })
  assert.equal(indeterminateResult.kind, 'indeterminate')
  assert.ok(Object.isFrozen(indeterminateResult))
  assert.throws(() => {
    indeterminateResult.code = 'tampered'
  }, TypeError)
})

test('immutability: a nested array field (upload failureCodes) is frozen too', async () => {
  const result = await runUpload({
    localFilePath: '/local/a',
    remoteParentPath: '/b',
    expectedLocalSizeBytes: 8388608,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: makeSpawnSpy([], { stdout: JSON.stringify(validUploadSuccessRaw()), code: 0 }),
    },
  })
  assert.ok(Object.isFrozen(result.failureCodes))
  assert.throws(() => {
    result.failureCodes.push('tampered')
  }, TypeError)
})

test('capture limits: Infinity, 0, a negative number, and an absurdly large override are all rejected', async () => {
  for (const bad of [Infinity, 0, -1, 100 * 1024 * 1024]) {
    await assert.rejects(
      () =>
        runInfo({
          remotePath: '/x',
          cli: CLI,
          credentials: CREDENTIALS,
          timeouts: GENEROUS_TIMEOUTS,
          deps: {
            sha512File: () => HASH_A,
            maxStdoutBytes: bad,
            spawn: () => {
              throw new Error('must not spawn')
            },
          },
        }),
      isInvalidInput,
      `maxStdoutBytes=${bad} must be rejected`,
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Signal validation order: validated BEFORE `.aborted` is ever checked.
// ═════════════════════════════════════════════════════════════════════════════

test('signal validation runs before the abort check — a plain object is rejected, never silently treated as cancellation', async () => {
  const hashCalls = []
  await assert.rejects(
    () =>
      runInfo({
        remotePath: '/x',
        cli: CLI,
        credentials: CREDENTIALS,
        timeouts: GENEROUS_TIMEOUTS,
        signal: { aborted: true }, // NOT a real AbortSignal
        deps: {
          sha512File: () => {
            hashCalls.push(1)
            return HASH_A
          },
          spawn: () => {
            throw new Error('must not spawn')
          },
        },
      }),
    isInvalidInput,
  )
  assert.equal(hashCalls.length, 0, 'must not hash either — validated before anything else runs')
})

test('cancellation: an already-aborted REAL signal at entry skips hashing, argv construction, and spawn entirely', async () => {
  const controller = new AbortController()
  controller.abort()
  const hashCalls = []
  const spawnCalls = []
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    signal: controller.signal,
    deps: {
      sha512File: () => {
        hashCalls.push(1)
        return HASH_A
      },
      spawn: (...args) => {
        spawnCalls.push(args)
        throw new Error('must not spawn')
      },
    },
  })
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_cancelled',
    transferState: 'unknown',
  })
  assert.equal(hashCalls.length, 0)
  assert.equal(spawnCalls.length, 0)
})

test('cancellation: a signal aborted after the hash step is still caught by the recheck immediately before spawn', async () => {
  const controller = new AbortController()
  const spawnCalls = []
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    signal: controller.signal,
    deps: {
      sha512File: () => {
        controller.abort() // simulates the signal firing in the gap between hashing and spawning
        return HASH_A
      },
      spawn: (...args) => {
        spawnCalls.push(args)
        throw new Error('must not spawn')
      },
    },
  })
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_cancelled',
    transferState: 'unknown',
  })
  assert.equal(spawnCalls.length, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
// Capture-stream error handling: terminated through the same bounded path as
// timeout/overflow, never silently swallowed.
// ═════════════════════════════════════════════════════════════════════════════

test('stream error: a stdout capture-stream failure is sanitized to indeterminate/provider_stream_failed, with no native error text', async () => {
  const marker = 'native-stdout-error-marker'
  const spawnImpl = () => {
    const child = makeInertChild()
    setImmediate(() => child.stdout.emit('error', new Error(`ENOBUFS: ${marker}`)))
    return child
  }
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, spawn: spawnImpl },
  })
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_stream_failed',
    transferState: 'unknown',
  })
  assert.ok(!JSON.stringify(result).includes(marker))
})

test('stream error: a stderr capture-stream failure is sanitized the same way', async () => {
  const marker = 'native-stderr-error-marker'
  const spawnImpl = () => {
    const child = makeInertChild()
    setImmediate(() => child.stderr.emit('error', new Error(`EPIPE: ${marker}`)))
    return child
  }
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, spawn: spawnImpl },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_stream_failed')
  assert.ok(!JSON.stringify(result).includes(marker))
})

test('stream error: a race against a later close carrying a superficially valid response still yields provider_stream_failed', async () => {
  const spawnImpl = () => {
    const child = makeInertChild()
    setImmediate(() => {
      child.stdout.emit('error', new Error('boom'))
      // A straggling 'close' with seemingly fine data arriving right after —
      // must not overwrite the stream-failure outcome.
      child.stdout.emit('data', Buffer.from(JSON.stringify(validInfoRaw())))
      setImmediate(() => child.emit('close', 0))
    })
    return child
  }
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, spawn: spawnImpl },
  })
  assert.equal(result.code, 'provider_stream_failed')
  assert.notEqual(result.kind, 'success')
})

// ═════════════════════════════════════════════════════════════════════════════
// Process lifecycle: spawn failure, timeout, SIGTERM->SIGKILL escalation,
// output-limit termination, and cooperative cancellation — all against REAL
// child processes, all bounded, none leaking raw output or an orphan.
// ═════════════════════════════════════════════════════════════════════════════

test('lifecycle: a spawn failure is sanitized to indeterminate/provider_spawn_failed', async () => {
  const result = await runInfo({
    remotePath: '/x',
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: () => {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      },
    },
  })
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_spawn_failed',
    transferState: 'unknown',
  })
})

test('lifecycle: a hanging real CLI is timed out, SIGTERM-stopped, and never left running', async () => {
  const dir = sandbox()
  const markerDir = path.join(dir, 'markers')
  writeSpec(dir, { hang: true })
  const result = await runInfo({
    remotePath: '/x',
    cli: cliFor(dir),
    credentials: CREDENTIALS,
    timeouts: SHORT_TIMEOUTS,
    deps: realDeps(),
  })
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_timeout',
    transferState: 'unknown',
  })
  const startedText = await waitForFile(path.join(markerDir, 'proton.started'))
  const pid = Number(startedText.trim())
  assert.ok(await waitUntilDead(pid), `the timed-out child (pid ${pid}) must not still be running`)
})

test('lifecycle: SIGTERM->SIGKILL escalation stops a CLI that ignores SIGTERM, within the configured grace', async () => {
  const dir = sandbox()
  const markerDir = path.join(dir, 'markers')
  writeSpec(dir, { hang: true, ignoreSigterm: true })
  const startedAt = Date.now()
  const result = await runInfo({
    remotePath: '/x',
    cli: cliFor(dir),
    credentials: CREDENTIALS,
    timeouts: SHORT_TIMEOUTS,
    deps: realDeps(),
  })
  const elapsedMs = Date.now() - startedAt
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_timeout',
    transferState: 'unknown',
  })
  assert.ok(
    elapsedMs < SHORT_TIMEOUTS.operationTimeoutMs + SHORT_TIMEOUTS.cancelGraceMs + 2000,
    `took ${elapsedMs}ms`,
  )
  const pid = Number((await waitForFile(path.join(markerDir, 'proton.started'))).trim())
  assert.ok(
    await waitUntilDead(pid),
    'a SIGTERM-ignoring child must still be stopped (via SIGKILL)',
  )
  assert.ok(!fs.existsSync(path.join(markerDir, 'proton.stopped')))
})

test('lifecycle: output-limit termination stops the child and returns a sanitized indeterminate result with no captured text', async () => {
  const dir = sandbox()
  const markerDir = path.join(dir, 'markers')
  writeSpec(dir, { chunk: { text: 'A'.repeat(64), count: 200, intervalMs: 5 } })
  const result = await runInfo({
    remotePath: '/x',
    cli: cliFor(dir),
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: realDeps({ maxStdoutBytes: 256 }),
  })
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_output_overflow',
    transferState: 'unknown',
  })
  assert.ok(!JSON.stringify(result).includes('A'.repeat(64)))
  const pid = Number((await waitForFile(path.join(markerDir, 'proton.started'))).trim())
  assert.ok(await waitUntilDead(pid), 'the overflowing child must be terminated, not left running')
})

test('lifecycle: cooperative cancellation via AbortSignal yields indeterminate/provider_cancelled and never claims the remote op stopped', async () => {
  const dir = sandbox()
  const markerDir = path.join(dir, 'markers')
  writeSpec(dir, { hang: true })
  const controller = new AbortController()
  const promise = runInfo({
    remotePath: '/x',
    cli: cliFor(dir),
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: realDeps(),
    signal: controller.signal,
  })
  await waitForFile(path.join(markerDir, 'proton.started'))
  controller.abort()
  const result = await promise
  assert.deepEqual(result, {
    kind: 'indeterminate',
    operation: 'info',
    code: 'provider_cancelled',
    transferState: 'unknown',
  })
  for (const value of Object.values(result)) {
    assert.ok(
      typeof value !== 'string' || !/stopped|cancelled remote|remote.*(stop|abort)/i.test(value),
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Closed export surface: exactly the fixed four-operation API, no
// arbitrary-operation or argv-builder seam.
// ═════════════════════════════════════════════════════════════════════════════

test('closed export surface: exactly the fixed four-operation API, no test-only argv-builder seam', async () => {
  const mod = await import('./backup-cloud-cli.mjs')
  assert.deepEqual(Object.keys(mod).sort(), [
    'CLOUD_CLI_ERROR_CODES',
    'FORBIDDEN_ARGV_TOKENS',
    'buildCreateFolderArgv',
    'buildDownloadArgv',
    'buildInfoArgv',
    'buildUploadArgv',
    'runCreateFolder',
    'runDownload',
    'runInfo',
    'runUpload',
  ])
})

test('CLOUD_CLI_ERROR_CODES is frozen and non-empty, and includes every code this module can produce', () => {
  assert.ok(Object.isFrozen(CLOUD_CLI_ERROR_CODES))
  assert.ok(CLOUD_CLI_ERROR_CODES.length > 0)
  for (const code of [
    'name_conflict',
    'credential_unavailable',
    'provider_spawn_failed',
    'provider_timeout',
    'provider_cancelled',
    'provider_output_overflow',
    'provider_stream_failed',
    'provider_response_malformed',
    'provider_response_unexpected_shape',
    'provider_stderr_on_success',
    'provider_error_unrecognised',
    'upload_size_mismatch',
    'upload_skipped_unverified',
    'download_destination_exists',
    'local_preflight_failed',
    'local_readback_missing',
    'local_readback_not_regular_file',
    'download_size_mismatch',
  ]) {
    assert.ok(CLOUD_CLI_ERROR_CODES.includes(code), `missing code ${code}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// E3J4C — the PRODUCTION exports honour no injected dependency.
//
// These call `productionRun*` (the real exports of `backup-cloud-cli.mjs`),
// never the `boundOperation()` wrappers, and hand each one a `deps` property
// poisoning every dependency E3J4/E3J4A/E3J4B used to honour. Each test proves
// the REAL one was used instead.
//
// What this proves: an ordinary production caller cannot, through the call
// signature, substitute the executable hash, the process implementation, the
// child environment, the local filesystem evidence, or the capture bounds.
// What it does NOT claim: that repository code able to add an import cannot
// reach the internal factory. Such code already has arbitrary execution and is
// outside this boundary's threat model.
// ═════════════════════════════════════════════════════════════════════════════

const POISON_MARKER_KEY = 'EANHL_E3J4C_INJECTED_MARKER_KEY'

/** Every dependency the old `deps` seam accepted, all poisoned at once. */
function poisonedDeps(spawnCalls, statCalls) {
  return {
    sha512File: () => HASH_A, // would mask a real hash mismatch
    spawn: (...args) => {
      spawnCalls.push(args)
      throw new Error('production must never use an injected spawn')
    },
    lstatSync: (...args) => {
      statCalls.push(args)
      return { isFile: () => true, size: 999_999 } // fabricated local evidence
    },
    env: { [POISON_MARKER_KEY]: 'injected' },
    maxStdoutBytes: 1, // would turn any real response into an overflow
    maxStderrBytes: 1,
  }
}

function realSha512Of(filePath) {
  return createHash('sha512').update(fs.readFileSync(filePath)).digest('hex')
}

/** The four production operations, each with valid operands, over one sandbox. */
function productionCallers(dir, deps) {
  const launcherPath = path.join(dir, 'bin', 'proton-drive')
  const cli = { executable: launcherPath, expectedSha512: HASH_A } // deliberately WRONG pin
  const common = { cli, credentials: CREDENTIALS, timeouts: GENEROUS_TIMEOUTS, deps }
  return [
    () => productionRunInfo({ remotePath: '/a/x.dump.age', ...common }),
    () => productionRunCreateFolder({ parentPath: '/a', name: 'attempt', ...common }),
    () =>
      productionRunUpload({
        localFilePath: '/local/x.dump.age',
        remoteParentPath: '/remote/base',
        expectedLocalSizeBytes: 42,
        ...common,
      }),
    () =>
      productionRunDownload({
        remotePath: '/a/x.dump.age',
        localDir: dir,
        expectedLocalPath: path.join(dir, 'x.dump.age'),
        ...common,
      }),
  ]
}

test('E3J4C: an injected deps.sha512File cannot satisfy the pin for any of the four production operations', async () => {
  const dir = sandbox()
  const spawnCalls = []
  const statCalls = []
  // The pin is HASH_A and the poisoned hasher returns HASH_A, so honouring it
  // would let every one of these through. The launcher's REAL hash is not
  // HASH_A, so the real gate must refuse all four.
  for (const call of productionCallers(dir, poisonedDeps(spawnCalls, statCalls))) {
    await assert.rejects(call, (err) => {
      assert.ok(err instanceof BackupError)
      assert.equal(err.code, 'cli_hash_mismatch')
      return true
    })
  }
  assert.equal(spawnCalls.length, 0, 'an injected spawn must never be called')
})

test('E3J4C: an injected deps.spawn/env/maxStdoutBytes is inert — the real process, environment, and bounds are used', async () => {
  const dir = sandbox()
  const launcherPath = path.join(dir, 'bin', 'proton-drive')
  writeSpec(dir, { stdout: JSON.stringify(validInfoRaw()), exitCode: 0 })
  const spawnCalls = []
  const statCalls = []
  const result = await productionRunInfo({
    remotePath: '/a/x.dump.age',
    cli: { executable: launcherPath, expectedSha512: realSha512Of(launcherPath) },
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: poisonedDeps(spawnCalls, statCalls),
  })
  // Real spawn: the fake CLI actually ran and its response was projected.
  assert.equal(result.kind, 'success')
  assert.equal(result.present, true)
  assert.equal(spawnCalls.length, 0, 'an injected spawn must never be called')
  // Real argv: the fixed constructor's output reached the real child.
  const loggedArgv = JSON.parse((await waitForFile(path.join(dir, 'argv.log'))).trim())
  assert.deepEqual(loggedArgv, ['filesystem', 'info', '/a/x.dump.age', '--json'])
  // Real capture bounds: `maxStdoutBytes: 1` would have overflowed this
  // ~200-byte response into indeterminate/provider_output_overflow.
  assert.notEqual(result.kind, 'indeterminate')
  // Real environment: the injected marker KEY never reaches the child. (Only
  // key names are ever recorded — see the double's docblock.)
  const observed = JSON.parse(await waitForFile(path.join(dir, 'env-observations.json')))
  assert.ok(Array.isArray(observed.envKeys))
  assert.ok(
    !observed.envKeys.includes(POISON_MARKER_KEY),
    'an injected env key must never reach the child',
  )
  assert.ok(
    observed.envKeys.includes('PROTON_DRIVE_CREDENTIALS_STORE'),
    'the real composed environment still carries the validated backend selector',
  )
})

test('E3J4C: an injected deps.spawn is inert for create-folder and upload too — real argv reaches the real child', async () => {
  const dir = sandbox()
  const launcherPath = path.join(dir, 'bin', 'proton-drive')
  const cli = { executable: launcherPath, expectedSha512: realSha512Of(launcherPath) }
  const spawnCalls = []
  const statCalls = []

  writeSpec(dir, { stdout: JSON.stringify(validCreateFolderRaw()), exitCode: 0 })
  const created = await productionRunCreateFolder({
    parentPath: '/a',
    name: 'attempt',
    cli,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: poisonedDeps(spawnCalls, statCalls),
  })
  assert.equal(created.kind, 'success')

  writeSpec(dir, {
    stdout: JSON.stringify(nameConflictRawFor('/local/x.dump.age')),
    exitCode: 1,
  })
  const uploaded = await productionRunUpload({
    localFilePath: '/local/x.dump.age',
    remoteParentPath: '/remote/base',
    expectedLocalSizeBytes: 42,
    cli,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: poisonedDeps(spawnCalls, statCalls),
  })
  assert.equal(uploaded.kind, 'rejected')
  assert.equal(uploaded.code, 'name_conflict')

  assert.equal(spawnCalls.length, 0, 'an injected spawn must never be called')
  const logged = (await waitForFile(path.join(dir, 'argv.log'))).trim().split('\n').map(JSON.parse)
  assert.deepEqual(logged, [
    ['filesystem', 'create-folder', '/a', 'attempt', '--json'],
    ['filesystem', 'upload', '--json', '/local/x.dump.age', '/remote/base'],
  ])
})

test('E3J4C: an injected deps.lstatSync cannot fabricate or hide local download evidence', async () => {
  const dir = sandbox()
  const launcherPath = path.join(dir, 'bin', 'proton-drive')
  const cli = { executable: launcherPath, expectedSha512: realSha512Of(launcherPath) }
  const expectedLocalPath = path.join(dir, 'x.dump.age')
  writeSpec(dir, { stdout: JSON.stringify(validDownloadSummaryRaw(42)), exitCode: 0 })

  // (a) The poisoned lstat fabricates a 999_999-byte regular file. The real
  //     one finds nothing (the fake CLI writes no file), so the only honest
  //     answer is that the readback evidence is missing.
  const spawnCalls = []
  const statCalls = []
  const fabricated = await productionRunDownload({
    remotePath: '/a/x.dump.age',
    localDir: dir,
    expectedLocalPath,
    cli,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: poisonedDeps(spawnCalls, statCalls),
  })
  assert.equal(fabricated.kind, 'indeterminate')
  assert.equal(fabricated.code, 'local_readback_missing')
  assert.equal(statCalls.length, 0, 'an injected lstatSync must never be called')

  // (b) The destination really exists; the poisoned lstat claims ENOENT, which
  //     would let the command run. The real preflight must still refuse, and
  //     nothing may be spawned.
  fs.writeFileSync(expectedLocalPath, Buffer.alloc(42))
  const hidingDeps = {
    ...poisonedDeps(spawnCalls, statCalls),
    lstatSync: () => {
      const err = new Error('no such file or directory')
      err.code = 'ENOENT'
      throw err
    },
  }
  const blocked = await productionRunDownload({
    remotePath: '/a/x.dump.age',
    localDir: dir,
    expectedLocalPath,
    cli,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: hidingDeps,
  })
  assert.equal(blocked.kind, 'indeterminate')
  assert.equal(blocked.code, 'download_destination_exists')
  assert.equal(spawnCalls.length, 0)
})

test('E3J4C: no ops/** module other than backup-cloud-cli.mjs and this suite imports the internal core', () => {
  const opsRoot = path.resolve(HERE, '..', '..')
  const allowed = new Set([
    path.join(HERE, 'backup-cloud-cli.mjs'),
    path.join(HERE, 'backup-cloud-cli.test.mjs'),
    path.join(HERE, 'internal', 'backup-cloud-cli-core.mjs'),
  ])
  const IMPORTS_CORE =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-cloud-cli-core\.mjs['"]/
  const offenders = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.mjs')) continue
      if (allowed.has(full)) continue
      // An actual module specifier, not a prose mention in a comment.
      if (IMPORTS_CORE.test(fs.readFileSync(full, 'utf8'))) offenders.push(full)
    }
  }
  walk(opsRoot)
  assert.deepEqual(offenders, [], 'the internal test seam must have no other importer')
})

// ═════════════════════════════════════════════════════════════════════════════
// E3J4C — upload evidence: the provider's byte count is cross-checked against
// caller-supplied local evidence, and a skipped item is never a success.
//
// `expectedLocalSizeBytes` is the CALLER's own measurement. These tests prove
// this boundary validates it and compares it; they prove nothing about whether
// the caller measured the right inode, and nothing about local-file TOCTOU.
// E3J5 owes that derivation for the ciphertext, sidecar, and manifest.
// ═════════════════════════════════════════════════════════════════════════════

test('E3J4C upload: a transfer whose reported byte count disagrees with the local size is indeterminate/upload_size_mismatch, never success', async () => {
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    expectedLocalSizeBytes: 1_048_576,
    stdout: JSON.stringify({ ...validUploadSuccessRaw(), transferredBytes: 8388608 }),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'upload_size_mismatch')
  assert.ok(!('transferredBytes' in result))
})

test('E3J4C upload: an agreeing byte count is success, and it is exactly the local measurement', async () => {
  const result = await uploadWith({
    localFilePath: '/local/probe-1MiB.bin',
    expectedLocalSizeBytes: 8388608,
    stdout: JSON.stringify(validUploadSuccessRaw()),
    code: 0,
  })
  assert.equal(result.kind, 'success')
  assert.equal(result.transferredItems, 1)
  assert.equal(result.skippedItems, 0)
  assert.equal(result.transferredBytes, 8388608)
})

test('E3J4C upload: an off-by-one reported count is still a mismatch — the comparison is exact', async () => {
  for (const reported of [8388607, 8388609, 0]) {
    const result = await uploadWith({
      expectedLocalSizeBytes: 8388608,
      stdout: JSON.stringify({ ...validUploadSuccessRaw(), transferredBytes: reported }),
      code: 0,
    })
    assert.equal(result.kind, 'indeterminate')
    assert.equal(result.code, 'upload_size_mismatch')
  }
})

test('E3J4C upload: an otherwise-clean skippedItems:1 response is indeterminate/upload_skipped_unverified, never transport success', async () => {
  const result = await uploadWith({
    expectedLocalSizeBytes: 8388608,
    stdout: JSON.stringify({
      transferredItems: 0,
      transferredBytes: 0,
      skippedItems: 1,
      failedItems: 0,
      failures: [],
    }),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'upload_skipped_unverified')
  assert.equal(result.transferState, 'unknown')
})

test('E3J4C upload: a skip reporting the full local byte count is STILL not success — bytes do not establish skip semantics or identity', async () => {
  const result = await uploadWith({
    expectedLocalSizeBytes: 8388608,
    stdout: JSON.stringify({
      transferredItems: 0,
      transferredBytes: 8388608,
      skippedItems: 1,
      failedItems: 0,
      failures: [],
    }),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'upload_skipped_unverified')
})

test('E3J4C upload: a transfer AND a skip reported together is neither success nor a skip classification', async () => {
  const result = await uploadWith({
    expectedLocalSizeBytes: 8388608,
    stdout: JSON.stringify({
      transferredItems: 1,
      transferredBytes: 8388608,
      skippedItems: 1,
      failedItems: 0,
      failures: [],
    }),
    code: 0,
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'provider_error_unrecognised')
})

test('E3J4C upload: expectedLocalSizeBytes is required and must be a non-negative safe integer, with no echoed value', async () => {
  const marker = 'expected-size-marker-xyz'
  const bad = [
    undefined,
    null,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Infinity,
    NaN,
    '8388608',
    marker,
  ]
  for (const expectedLocalSizeBytes of bad) {
    const spawnCalls = []
    await assert.rejects(
      () =>
        runUpload({
          localFilePath: '/local/a',
          remoteParentPath: '/b',
          expectedLocalSizeBytes,
          cli: CLI,
          credentials: CREDENTIALS,
          timeouts: GENEROUS_TIMEOUTS,
          deps: {
            sha512File: () => HASH_A,
            spawn: (...args) => {
              spawnCalls.push(args)
              throw new Error('must not spawn')
            },
          },
        }),
      (err) => {
        assert.ok(isInvalidInput(err))
        assert.ok(!scanForMarker(err, marker))
        return true
      },
    )
    assert.equal(spawnCalls.length, 0)
  }
})

test('E3J4C upload: zero bytes is a legitimate local size, not a validation failure', async () => {
  const result = await uploadWith({
    expectedLocalSizeBytes: 0,
    stdout: JSON.stringify({ ...validUploadSuccessRaw(), transferredBytes: 0 }),
    code: 0,
  })
  assert.equal(result.kind, 'success')
  assert.equal(result.transferredBytes, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
// E3J4C — download destination binding and the pre-spawn absence check.
//
// Identity/evidence binding only. NOT proved here and not claimed anywhere:
// that the gap between the absence check and the readback is closed, any byte
// ceiling during the transfer, descriptor ownership, or content verification
// (all E3J6).
// ═════════════════════════════════════════════════════════════════════════════

function downloadOperands({ remotePath, localDir, expectedLocalPath, deps = {} }) {
  return runDownload({
    remotePath,
    localDir,
    expectedLocalPath,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: { sha512File: () => HASH_A, ...deps },
  })
}

test('E3J4C download: expectedLocalPath must be the immediate child of localDir named by the remote basename — a mismatched basename, sibling, descendant, or outside path is refused before any spawn', async () => {
  const cases = [
    { localDir: '/local/dl', expectedLocalPath: '/local/dl/other.bin' }, // wrong basename
    { localDir: '/local/dl', expectedLocalPath: '/local/x.dump.age' }, // parent, not child
    { localDir: '/local/dl', expectedLocalPath: '/local/dl/nested/x.dump.age' }, // descendant
    { localDir: '/local/dl', expectedLocalPath: '/elsewhere/x.dump.age' }, // outside
    { localDir: '/local/dl', expectedLocalPath: '/local/dlx/x.dump.age' }, // prefix sibling dir
  ]
  for (const { localDir, expectedLocalPath } of cases) {
    const spawnCalls = []
    await assert.rejects(
      () =>
        downloadOperands({
          remotePath: '/a/x.dump.age',
          localDir,
          expectedLocalPath,
          deps: {
            spawn: (...args) => {
              spawnCalls.push(args)
              throw new Error('must not spawn')
            },
          },
        }),
      isArgvInvalid,
    )
    assert.equal(spawnCalls.length, 0, 'binding is checked before any child exists')
  }
})

test('E3J4C download: the correctly bound immediate child is accepted, including under a root localDir', async () => {
  for (const { localDir, expectedLocalPath } of [
    { localDir: '/local/dl', expectedLocalPath: '/local/dl/x.dump.age' },
    { localDir: '/', expectedLocalPath: '/x.dump.age' },
  ]) {
    const result = await downloadOperands({
      remotePath: '/a/x.dump.age',
      localDir,
      expectedLocalPath,
      deps: {
        spawn: makeSpawnSpy([], { stdout: JSON.stringify(validDownloadSummaryRaw(42)), code: 0 }),
        lstatSync: absentThen(() => ({ isFile: () => true, size: 42 })),
      },
    })
    assert.equal(result.kind, 'success')
    assert.equal(result.localPath, expectedLocalPath)
  }
})

test('E3J4C download: a destination that already exists is indeterminate/download_destination_exists, with nothing spawned', async () => {
  for (const existing of [
    { isFile: () => true, size: 42 }, // a pre-existing regular file
    { isFile: () => false, size: 4096 }, // a directory
    { isFile: () => false, size: 12 }, // a symlink, dangling or not
  ]) {
    const spawnCalls = []
    const result = await downloadOperands({
      remotePath: '/a/x.dump.age',
      localDir: '/local/dl',
      expectedLocalPath: '/local/dl/x.dump.age',
      deps: {
        spawn: (...args) => {
          spawnCalls.push(args)
          throw new Error('must not spawn')
        },
        lstatSync: () => existing,
      },
    })
    assert.equal(result.kind, 'indeterminate')
    assert.equal(result.code, 'download_destination_exists')
    assert.equal(result.transferState, 'unknown')
    assert.equal(spawnCalls.length, 0)
  }
})

test('E3J4C download: a REAL pre-existing file at the bound path blocks the command', async () => {
  const dir = sandbox()
  const localPath = makeLocalFile(dir, 42)
  const spawnCalls = []
  const result = await runDownload({
    remotePath: '/a/downloaded.dump.age',
    localDir: dir,
    expectedLocalPath: localPath,
    cli: CLI,
    credentials: CREDENTIALS,
    timeouts: GENEROUS_TIMEOUTS,
    deps: {
      sha512File: () => HASH_A,
      spawn: (...args) => {
        spawnCalls.push(args)
        throw new Error('must not spawn')
      },
    },
  })
  assert.equal(result.kind, 'indeterminate')
  assert.equal(result.code, 'download_destination_exists')
  assert.equal(spawnCalls.length, 0)
})

test('E3J4C download: any other inability to establish absence is indeterminate/local_preflight_failed, with nothing spawned and no native text', async () => {
  const marker = 'preflight-native-marker-xyz'
  const failures = [
    Object.assign(new Error(`EACCES: ${marker}`), { code: 'EACCES' }),
    Object.assign(new Error(`ELOOP: ${marker}`), { code: 'ELOOP' }),
    Object.assign(new Error(`ENOTDIR: ${marker}`), { code: 'ENOTDIR' }),
    new Error(`no code at all: ${marker}`),
    marker, // a thrown non-Error
  ]
  for (const failure of failures) {
    const spawnCalls = []
    const result = await downloadOperands({
      remotePath: '/a/x.dump.age',
      localDir: '/local/dl',
      expectedLocalPath: '/local/dl/x.dump.age',
      deps: {
        spawn: (...args) => {
          spawnCalls.push(args)
          throw new Error('must not spawn')
        },
        lstatSync: () => {
          throw failure
        },
      },
    })
    assert.equal(result.kind, 'indeterminate')
    assert.equal(result.code, 'local_preflight_failed')
    assert.ok(!scanForMarker(result, marker))
    assert.equal(spawnCalls.length, 0)
  }
  // A preflight that returns a non-object cannot establish absence either.
  const spawnCalls = []
  const malformed = await downloadOperands({
    remotePath: '/a/x.dump.age',
    localDir: '/local/dl',
    expectedLocalPath: '/local/dl/x.dump.age',
    deps: {
      spawn: (...args) => {
        spawnCalls.push(args)
        throw new Error('must not spawn')
      },
      lstatSync: () => 'not a stat object',
    },
  })
  assert.equal(malformed.code, 'local_preflight_failed')
  assert.equal(spawnCalls.length, 0)
})

test('E3J4C download: only a definite ENOENT permits the command to run', async () => {
  const calls = []
  const result = await downloadOperands({
    remotePath: '/a/x.dump.age',
    localDir: '/local/dl',
    expectedLocalPath: '/local/dl/x.dump.age',
    deps: {
      spawn: makeSpawnSpy(calls, {
        stdout: JSON.stringify(validDownloadSummaryRaw(42)),
        code: 0,
      }),
      lstatSync: absentThen(() => ({ isFile: () => true, size: 42 })),
    },
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, [
    'filesystem',
    'download',
    '--json',
    '/a/x.dump.age',
    '/local/dl',
  ])
  assert.equal(result.kind, 'success')
  assert.equal(result.bytesWritten, 42)
})

// ═════════════════════════════════════════════════════════════════════════════
// E3J4C — SAFE integers for every provider-derived byte count.
//
// `Number.isInteger` accepts values above 2^53-1, which `JSON.parse` cannot
// represent exactly; comparing or echoing one would compare a rounded value.
// ═════════════════════════════════════════════════════════════════════════════

const ABOVE_SAFE = Number.MAX_SAFE_INTEGER + 1

test('E3J4C safe integers: info claimedSize is accepted at MAX_SAFE_INTEGER and refused immediately above it', async () => {
  const atBoundary = await infoWithRaw({ ...validInfoRaw(), claimedSize: Number.MAX_SAFE_INTEGER })
  assert.equal(atBoundary.kind, 'success')
  assert.equal(atBoundary.claimedSizeBytes, Number.MAX_SAFE_INTEGER)

  const aboveBoundary = await infoWithRaw({ ...validInfoRaw(), claimedSize: ABOVE_SAFE })
  assert.equal(aboveBoundary.kind, 'indeterminate')
  assert.equal(aboveBoundary.code, 'provider_response_unexpected_shape')
})

test('E3J4C safe integers: upload transferredBytes is accepted at MAX_SAFE_INTEGER and refused immediately above it', async () => {
  const atBoundary = await uploadWith({
    expectedLocalSizeBytes: Number.MAX_SAFE_INTEGER,
    stdout: JSON.stringify({
      ...validUploadSuccessRaw(),
      transferredBytes: Number.MAX_SAFE_INTEGER,
    }),
    code: 0,
  })
  assert.equal(atBoundary.kind, 'success')
  assert.equal(atBoundary.transferredBytes, Number.MAX_SAFE_INTEGER)

  const aboveBoundary = await uploadWith({
    expectedLocalSizeBytes: Number.MAX_SAFE_INTEGER,
    stdout: JSON.stringify({ ...validUploadSuccessRaw(), transferredBytes: ABOVE_SAFE }),
    code: 0,
  })
  assert.equal(aboveBoundary.kind, 'indeterminate')
  assert.equal(aboveBoundary.code, 'provider_response_unexpected_shape')
})

test('E3J4C safe integers: download transferredBytes is accepted at MAX_SAFE_INTEGER and refused immediately above it', async () => {
  const atBoundary = await downloadOperands({
    remotePath: '/a/x.dump.age',
    localDir: '/local/dl',
    expectedLocalPath: '/local/dl/x.dump.age',
    deps: {
      spawn: makeSpawnSpy([], {
        stdout: JSON.stringify(validDownloadSummaryRaw(Number.MAX_SAFE_INTEGER)),
        code: 0,
      }),
      lstatSync: absentThen(() => ({ isFile: () => true, size: Number.MAX_SAFE_INTEGER })),
    },
  })
  assert.equal(atBoundary.kind, 'success')
  assert.equal(atBoundary.bytesWritten, Number.MAX_SAFE_INTEGER)

  const aboveBoundary = await downloadOperands({
    remotePath: '/a/x.dump.age',
    localDir: '/local/dl',
    expectedLocalPath: '/local/dl/x.dump.age',
    deps: {
      spawn: makeSpawnSpy([], {
        stdout: JSON.stringify(validDownloadSummaryRaw(ABOVE_SAFE)),
        code: 0,
      }),
      lstatSync: absentThen(() => ({ isFile: () => true, size: 42 })),
    },
  })
  assert.equal(aboveBoundary.kind, 'indeterminate')
  assert.equal(aboveBoundary.code, 'provider_response_unexpected_shape')
})
