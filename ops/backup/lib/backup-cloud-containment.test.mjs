/**
 * Readback containment canary — E3J6A.
 *
 * Two kinds of test:
 *
 *   - FACTORY tests build the canary from the internal core's
 *     `makeContainmentCanary()` with the real filesystem dependencies and a
 *     scripted `spawn` double that emulates what an enforcing (or lying)
 *     wrapper would leave behind. They prove this repository's
 *     classification, cleanup, and proof logic.
 *   - PRODUCTION tests call the real `proveReadbackContainment()` export,
 *     which really spawns a wrapper over the module-owned Node writer. With
 *     the local `/usr/bin/prlimit` they show the kernel enforcing the limit
 *     on a DISPOSABLE local probe; they are skipped, and reported as
 *     skipped, where that binary is absent. A pass-through stand-in shows the
 *     canary refusing a wrapper that does not enforce.
 *
 * Nothing here runs the Proton Drive CLI or touches a provider. A passing
 * canary is never evidence about the Proton CLI (E3J10).
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { BackupError } from './backup-artifact-contract.mjs'
import * as production from './backup-cloud-containment.mjs'
import {
  CANARY_SCRIPT,
  CANARY_WRITER_EXIT_FILE_TOO_LARGE,
  REAL_CANARY_DEPS,
  buildCanaryArgv,
  makeContainmentCanary,
} from './internal/backup-cloud-cli-core.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-containment', warnAfterMs: 6_000, intervalMs: 4_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REAL_PRLIMIT = '/usr/bin/prlimit'
const HAS_REAL_PRLIMIT = (() => {
  try {
    fs.accessSync(REAL_PRLIMIT, fs.constants.X_OK)
    return fs.statSync(REAL_PRLIMIT).isFile()
  } catch {
    return false
  }
})()
const PRLIMIT_SKIP = HAS_REAL_PRLIMIT ? false : `${REAL_PRLIMIT} is not present on this host`

const RUN_ID = '20260916T120000Z-0a1b2c3d'
const OTHER_RUN_ID = '20260916T120000Z-ffffffff'
const HASH_A = '0123456789abcdef'.repeat(8)
const HASH_B = 'fedcba9876543210'.repeat(8)
const LIMIT = 4096 // the smallest of the three ceilings below
const MARKER = 'SECRET-MARKER-e3j6a-canary'
const TMP = fs.realpathSync(os.tmpdir())

const sha512 = (p) => createHash('sha512').update(fs.readFileSync(p)).digest('hex')

// ── sandboxes ───────────────────────────────────────────────────────────────

const sandboxes = []
afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    try {
      fs.chmodSync(dir, 0o700)
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** A sandbox with a trusted (0700, owned, canonical) readback directory. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(TMP, 'eanhl-cloud-containment-'))
  sandboxes.push(dir)
  fs.mkdirSync(path.join(dir, 'bin'))
  const readback = path.join(dir, 'readback')
  fs.mkdirSync(readback, { mode: 0o700 })
  fs.chmodSync(readback, 0o700)
  return { dir, readback, canaryDir: path.join(readback, `${RUN_ID}.containment-canary`) }
}

function configFor(sb, wrapper, overrides = {}) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: HASH_A },
    credentials: { backend: 'pass' },
    remote: { root: '/proton/eanhl-backups' },
    artifact: { sourceDir: path.join(sb.dir, 'artifacts') },
    attestation: { dir: path.join(sb.dir, 'attest') },
    readback: {
      dir: sb.readback,
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: LIMIT,
      containment: 'rlimit_fsize',
      rlimitWrapper: wrapper,
      ...overrides.readback,
    },
    run: {
      lockFile: path.join(sb.dir, 'run', 'uploader.lock'),
      operationTimeoutMs: 5_000,
      cancelGraceMs: 500,
      ...overrides.run,
    },
    retry: { maxAttemptsPerArtifactPerRun: 1, backoffMs: 1, maxTotalAttemptsPerRun: 1 },
    capacity: { minFreeBytes: 1, backingVolume: null },
  }
}

const realWrapper = () => ({ executable: REAL_PRLIMIT, expectedSha512: sha512(REAL_PRLIMIT) })

/** A stand-in for prlimit that checks the prefix and `exec`s WITHOUT applying a limit. */
function lyingWrapper(sb) {
  const p = path.join(sb.dir, 'bin', 'lying-prlimit')
  fs.writeFileSync(
    p,
    [
      '#!/bin/sh',
      'case "$1" in --fsize=*) ;; *) exit 64 ;; esac',
      '[ "$2" = "--" ] || exit 64',
      'shift 2',
      'exec "$@"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
  return { executable: p, expectedSha512: sha512(p) }
}

const listDir = (p) => {
  try {
    return fs.readdirSync(p).sort()
  } catch {
    return null
  }
}

function assertRefused(result, code, cleanup) {
  assert.deepEqual(Object.keys(result).sort(), ['cleanup', 'code', 'kind'])
  assert.ok(Object.isFrozen(result))
  assert.equal(result.kind, 'refused')
  assert.equal(result.code, code)
  assert.ok(production.CONTAINMENT_REFUSAL_CODES.includes(result.code))
  assert.ok(production.CONTAINMENT_CLEANUP_STATES.includes(result.cleanup))
  if (cleanup !== undefined) assert.equal(result.cleanup, cleanup)
  assert.equal(JSON.stringify(result).includes(MARKER), false)
}

// ── factory doubles ─────────────────────────────────────────────────────────

/**
 * A `spawn` double. `act(probe, total)` runs synchronously at spawn time to
 * emulate what the child left on disk, and `close` is `{code, signal}` — or
 * `'hang'` for a child that ends only when killed, or `'never'` for one whose
 * end is never observed.
 */
function spawnDouble(
  calls,
  { act = () => {}, close = { code: 0, signal: null }, stdout = '' } = {},
) {
  return (command, args, options) => {
    calls.push({ command, args, options })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.exitCode = null
    child.signalCode = null
    child.pid = 90000 + calls.length
    const probe = args[args.length - 2]
    const total = Number(args[args.length - 1])
    act(probe, total)
    if (close === 'never') {
      child.kill = () => true
      return child
    }
    if (close === 'exited-never-closes') {
      // Exit status already known, stdio never closes (e.g. a descendant holds it).
      child.exitCode = CANARY_WRITER_EXIT_FILE_TOO_LARGE
      child.kill = () => false
      return child
    }
    if (close === 'exited-closes-after-kill') {
      child.exitCode = CANARY_WRITER_EXIT_FILE_TOO_LARGE
      child.kill = () => {
        setTimeout(() => child.emit('close', CANARY_WRITER_EXIT_FILE_TOO_LARGE, null), 5)
        return false
      }
      return child
    }
    child.kill = () => {
      setImmediate(() => {
        child.signalCode = 'SIGTERM'
        child.emit('close', null, 'SIGTERM')
      })
      return true
    }
    if (close === 'hang') return child
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      setImmediate(() => child.emit('close', close.code, close.signal))
    })
    return child
  }
}

const writeProbe = (bytes) => (probe) =>
  fs.writeFileSync(probe, Buffer.alloc(bytes, 0x5a), { flag: 'wx', mode: 0o600 })

function factory(overrides = {}) {
  return makeContainmentCanary({ ...REAL_CANARY_DEPS, sha512File: () => HASH_B, ...overrides })
}
const FACTORY_WRAPPER = { executable: '/usr/bin/prlimit', expectedSha512: HASH_B }

async function withKeepAlive(fn) {
  const keep = setInterval(() => {}, 1_000)
  try {
    return await fn()
  } finally {
    clearInterval(keep)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Surface
// ═════════════════════════════════════════════════════════════════════════════

test('surface: the production module exports exactly the canary API and frozen vocabularies', () => {
  assert.deepEqual(Object.keys(production).sort(), [
    'CONTAINMENT_CLEANUP_STATES',
    'CONTAINMENT_PROOF_KIND',
    'CONTAINMENT_REFUSAL_CODES',
    'proveReadbackContainment',
    'verifyContainmentProof',
  ])
  assert.ok(Object.isFrozen(production.CONTAINMENT_REFUSAL_CODES))
  assert.ok(Object.isFrozen(production.CONTAINMENT_CLEANUP_STATES))
  assert.equal(production.CONTAINMENT_PROOF_KIND, 'eanhl.cloud-containment-proof')
})

test('surface: the real canary dependency set is frozen and exactly the fixed capabilities', () => {
  assert.ok(Object.isFrozen(REAL_CANARY_DEPS))
  assert.deepEqual(Object.keys(REAL_CANARY_DEPS).sort(), [
    'chmod',
    'geteuid',
    'lstat',
    'mkdir',
    'nodeExecutable',
    'now',
    'realpath',
    'rmdir',
    'sha512File',
    'spawn',
    'unlink',
  ])
  assert.equal(REAL_CANARY_DEPS.nodeExecutable, process.execPath)
})

test('surface: the core exports no generic runner — only fixed-purpose builders and factories', async () => {
  const core = await import('./internal/backup-cloud-cli-core.mjs')
  const fns = Object.keys(core)
    .filter((k) => typeof core[k] === 'function')
    .sort()
  assert.deepEqual(fns, [
    'buildCanaryArgv',
    'buildContainedDownloadArgv',
    'buildCreateFolderArgv',
    'buildDownloadArgv',
    'buildInfoArgv',
    'buildUploadArgv',
    'makeCloudCliOperations',
    'makeContainmentCanary',
  ])
  const canary = factory()
  assert.deepEqual(Object.keys(canary).sort(), [
    'proveReadbackContainment',
    'verifyContainmentProof',
  ])
})

test('surface: the writer script is a module constant with no interpolated input', () => {
  assert.equal(typeof CANARY_SCRIPT, 'string')
  assert.equal(CANARY_SCRIPT.includes('${'), false)
  assert.match(CANARY_SCRIPT, /O_EXCL/)
  assert.match(CANARY_SCRIPT, /O_NOFOLLOW/)
  assert.match(CANARY_SCRIPT, /EFBIG/)
  assert.equal(CANARY_WRITER_EXIT_FILE_TOO_LARGE, 3)
})

test('argv: the canary argv is the exact wrapper prefix over the module-owned writer', () => {
  assert.deepEqual(
    buildCanaryArgv({
      wrapperExecutable: '/usr/bin/prlimit',
      limitBytes: 4096,
      nodeExecutable: '/usr/bin/node',
      probePath: '/r/x.containment-canary/probe.bin',
    }),
    [
      '/usr/bin/prlimit',
      '--fsize=4096:4096',
      '--',
      '/usr/bin/node',
      '--input-type=commonjs',
      '-e',
      CANARY_SCRIPT,
      '/r/x.containment-canary/probe.bin',
      String(4096 + 65536),
    ],
  )
  for (const bad of [
    { limitBytes: 0 },
    { limitBytes: 1.5 },
    { limitBytes: Number.MAX_SAFE_INTEGER },
    { wrapperExecutable: 'prlimit' },
    { probePath: '/r/../probe.bin' },
    { nodeExecutable: '-e' },
  ]) {
    assert.throws(
      () =>
        buildCanaryArgv({
          wrapperExecutable: '/usr/bin/prlimit',
          limitBytes: 4096,
          nodeExecutable: '/usr/bin/node',
          probePath: '/r/probe.bin',
          ...bad,
        }),
      (err) => err instanceof BackupError && err.code === 'cloud_cli_argv_invalid',
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Real enforcement (disposable local probes only)
// ═════════════════════════════════════════════════════════════════════════════

test(
  'REAL prlimit: the canary is proven at exactly L, leaves nothing behind, and binds its proof',
  { skip: PRLIMIT_SKIP },
  async () => {
    const sb = sandbox()
    const config = configFor(sb, realWrapper())
    const result = await production.proveReadbackContainment({ config, runId: RUN_ID })
    assert.equal(result.kind, 'proven', JSON.stringify(result))
    assert.equal(result.cleanup, 'complete')
    assert.deepEqual(Object.keys(result).sort(), ['cleanup', 'kind', 'proof'])
    const { proof } = result
    assert.ok(Object.isFrozen(proof) && Object.isFrozen(proof.ceilings))
    assert.deepEqual(
      { ...proof, provenAt: typeof proof.provenAt },
      {
        kind: 'eanhl.cloud-containment-proof',
        runId: RUN_ID,
        mechanism: 'rlimit_fsize',
        readbackDir: sb.readback,
        wrapperExecutable: REAL_PRLIMIT,
        wrapperExpectedSha512: config.readback.rlimitWrapper.expectedSha512,
        ceilings: { ciphertext: 1_000_000, checksum: LIMIT, manifest: 65_536 },
        limitBytes: LIMIT,
        provenAt: 'string',
      },
    )
    assert.deepEqual(listDir(sb.readback), [], 'every canary-owned path was removed')
    assert.equal(production.verifyContainmentProof({ proof, config, runId: RUN_ID }), true)
  },
)

test(
  'REAL prlimit: a proof is refused for any other run, configuration, or directory identity',
  { skip: PRLIMIT_SKIP },
  async () => {
    const sb = sandbox()
    const config = configFor(sb, realWrapper())
    const { proof } = await production.proveReadbackContainment({ config, runId: RUN_ID })
    const refuses = (args) =>
      assert.throws(
        () => production.verifyContainmentProof(args),
        (err) =>
          err instanceof BackupError &&
          err.code === 'containment_proof_invalid' &&
          err.cause === undefined,
      )
    refuses({ proof, config, runId: OTHER_RUN_ID })
    refuses({
      proof,
      config: configFor(sb, realWrapper(), { readback: { maxSidecarBytes: LIMIT + 1 } }),
      runId: RUN_ID,
    })
    refuses({
      proof,
      config: configFor(sb, realWrapper(), { readback: { maxManifestBytes: 65_537 } }),
      runId: RUN_ID,
    })
    refuses({
      proof,
      config: configFor(sb, realWrapper(), { readback: { maxCiphertextBytes: 999_999 } }),
      runId: RUN_ID,
    })
    refuses({
      proof,
      config: configFor(sb, { executable: REAL_PRLIMIT, expectedSha512: HASH_B }),
      runId: RUN_ID,
    })
    const other = sandbox()
    refuses({ proof, config: configFor(other, realWrapper()), runId: RUN_ID })
    refuses({
      proof,
      config: {
        ...config,
        readback: { ...config.readback, containment: 'quota_mount', rlimitWrapper: null },
      },
      runId: RUN_ID,
    })
    refuses({ proof, config: { not: 'a config' }, runId: RUN_ID })
    // A structurally identical copy is not the proof.
    refuses({ proof: { ...proof }, config, runId: RUN_ID })
    refuses({ proof: JSON.parse(JSON.stringify(proof)), config, runId: RUN_ID })
    refuses(null)
    refuses({ proof: null, config, runId: RUN_ID })
    // The readback directory replaced at the same path → a different identity.
    // (Renamed away, not removed, so the old inode number cannot be reused.)
    fs.renameSync(sb.readback, `${sb.readback}-previous`)
    fs.mkdirSync(sb.readback, { mode: 0o700 })
    fs.chmodSync(sb.readback, 0o700)
    refuses({ proof, config, runId: RUN_ID })
    // ... and a now-untrusted directory at the original path as well.
    fs.chmodSync(sb.readback, 0o750)
    refuses({ proof, config, runId: RUN_ID })
  },
)

test(
  'REAL prlimit: a proof made by another canary instance is not accepted by the production verifier, and vice versa',
  { skip: PRLIMIT_SKIP },
  async () => {
    const sb = sandbox()
    const config = configFor(sb, realWrapper())
    const local = makeContainmentCanary(REAL_CANARY_DEPS)
    const localResult = await local.proveReadbackContainment({ config, runId: RUN_ID })
    assert.equal(localResult.kind, 'proven')
    assert.throws(
      () => production.verifyContainmentProof({ proof: localResult.proof, config, runId: RUN_ID }),
      (err) => err.code === 'containment_proof_invalid',
    )
    const prodResult = await production.proveReadbackContainment({ config, runId: OTHER_RUN_ID })
    assert.equal(prodResult.kind, 'proven')
    assert.throws(
      () => local.verifyContainmentProof({ proof: prodResult.proof, config, runId: OTHER_RUN_ID }),
      (err) => err.code === 'containment_proof_invalid',
    )
  },
)

test('production: a lying (non-enforcing) wrapper is refused, and the canary removes its own paths', async () => {
  const sb = sandbox()
  const config = configFor(sb, lyingWrapper(sb))
  const result = await production.proveReadbackContainment({ config, runId: RUN_ID })
  // The writer wrote its full L + 64 KiB and reported a clean complete write.
  assertRefused(result, 'containment_violated', 'complete')
  assert.deepEqual(listDir(sb.readback), [])
})

test('production: caller-supplied executables, argv, scripts, environments, spawns, deps, and directory identities are inert', async () => {
  const sb = sandbox()
  const config = configFor(sb, lyingWrapper(sb))
  const poison = () => {
    throw new Error(MARKER)
  }
  const result = await production.proveReadbackContainment({
    config,
    runId: RUN_ID,
    executable: '/bin/true',
    argv: ['/bin/true'],
    script: 'process.exit(3)',
    env: { NODE_OPTIONS: `--require=${MARKER}` },
    spawn: poison,
    deps: { spawn: poison, sha512File: () => 'x', lstat: poison, geteuid: () => -1 },
    readbackDirIdentity: { dev: 0n, ino: 0n },
  })
  // Only the REAL spawn of the REAL writer through the configured wrapper
  // could have produced this specific refusal.
  assertRefused(result, 'containment_violated', 'complete')
})

test('production: a hand-built proof object is never accepted', () => {
  const sb = sandbox()
  const config = configFor(sb, { executable: REAL_PRLIMIT, expectedSha512: HASH_B })
  const forged = Object.freeze({
    kind: 'eanhl.cloud-containment-proof',
    runId: RUN_ID,
    mechanism: 'rlimit_fsize',
    readbackDir: sb.readback,
    wrapperExecutable: REAL_PRLIMIT,
    wrapperExpectedSha512: HASH_B,
    ceilings: Object.freeze({ ciphertext: 1_000_000, checksum: LIMIT, manifest: 65_536 }),
    limitBytes: LIMIT,
    provenAt: new Date().toISOString(),
  })
  assert.throws(
    () => production.verifyContainmentProof({ proof: forged, config, runId: RUN_ID }),
    (err) => err instanceof BackupError && err.code === 'containment_proof_invalid',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// Refusals before anything is created
// ═════════════════════════════════════════════════════════════════════════════

test('refusal: a wrapper hash mismatch or an unreadable wrapper spawns nothing and creates nothing', async () => {
  const sb = sandbox()
  const wrapper = lyingWrapper(sb)
  for (const cfgWrapper of [
    { executable: wrapper.executable, expectedSha512: HASH_B },
    { executable: path.join(sb.dir, 'bin', `missing-${MARKER}`), expectedSha512: HASH_B },
  ]) {
    const result = await production.proveReadbackContainment({
      config: configFor(sb, cfgWrapper),
      runId: RUN_ID,
    })
    assertRefused(result, 'rlimit_wrapper_unverified', 'not_started')
    assert.deepEqual(listDir(sb.readback), [])
  }
})

test('refusal: quota_mount is accepted configuration but refused at runtime, touching nothing', async () => {
  const sb = sandbox()
  const calls = []
  const result = await factory({ spawn: spawnDouble(calls) }).proveReadbackContainment({
    config: configFor(sb, null, { readback: { containment: 'quota_mount' } }),
    runId: RUN_ID,
  })
  assertRefused(result, 'containment_unsupported', 'not_started')
  assert.equal(calls.length, 0)
  assert.deepEqual(listDir(sb.readback), [])
})

test('refusal: an untrusted readback directory is refused before anything is created', async () => {
  const cases = [
    (sb) => {
      fs.rmdirSync(sb.readback) // missing
      return {}
    },
    (sb) => {
      fs.chmodSync(sb.readback, 0o750) // group bits
      return {}
    },
    (sb) => {
      fs.chmodSync(sb.readback, 0o701) // world bit
      return {}
    },
    (sb) => {
      const real = path.join(sb.dir, 'real-readback')
      fs.renameSync(sb.readback, real)
      fs.symlinkSync(real, sb.readback) // a symlink
      return {}
    },
    (sb) => {
      fs.rmdirSync(sb.readback)
      fs.writeFileSync(sb.readback, 'not a directory') // a file
      return {}
    },
    (sb) => {
      // Reached through a symlinked parent: realpath differs.
      const linkParent = path.join(sb.dir, 'linked')
      fs.symlinkSync(sb.dir, linkParent)
      return { readbackPath: path.join(linkParent, 'readback') }
    },
    () => ({ deps: { geteuid: () => process.geteuid() + 1 } }), // not ours
  ]
  for (const arrange of cases) {
    const sb = sandbox()
    const { readbackPath, deps = {} } = arrange(sb)
    const calls = []
    const config = configFor(
      sb,
      FACTORY_WRAPPER,
      readbackPath ? { readback: { dir: readbackPath } } : {},
    )
    const result = await factory({ spawn: spawnDouble(calls), ...deps }).proveReadbackContainment({
      config,
      runId: RUN_ID,
    })
    assertRefused(result, 'readback_dir_untrusted', 'not_started')
    assert.equal(calls.length, 0)
    assert.equal(fs.existsSync(sb.canaryDir), false)
  }
})

test('refusal: an existing canary directory is a collision — refused, and left exactly as found', async () => {
  const sb = sandbox()
  fs.mkdirSync(sb.canaryDir, { mode: 0o700 })
  fs.writeFileSync(path.join(sb.canaryDir, 'probe.bin'), MARKER)
  const calls = []
  const result = await factory({ spawn: spawnDouble(calls) }).proveReadbackContainment({
    config: configFor(sb, FACTORY_WRAPPER),
    runId: RUN_ID,
  })
  assertRefused(result, 'canary_collision', 'not_started')
  assert.equal(calls.length, 0)
  assert.equal(fs.readFileSync(path.join(sb.canaryDir, 'probe.bin'), 'utf8'), MARKER)
})

test('refusal: an already-aborted signal creates and spawns nothing', async () => {
  const sb = sandbox()
  const controller = new AbortController()
  controller.abort()
  const calls = []
  const result = await factory({ spawn: spawnDouble(calls) }).proveReadbackContainment({
    config: configFor(sb, FACTORY_WRAPPER),
    runId: RUN_ID,
    signal: controller.signal,
  })
  assertRefused(result, 'canary_cancelled', 'not_started')
  assert.equal(calls.length, 0)
  assert.deepEqual(listDir(sb.readback), [])
})

test('inputs: malformed arguments throw a generic error before any filesystem effect', async () => {
  const sb = sandbox()
  const calls = []
  const canary = factory({ spawn: spawnDouble(calls) })
  for (const args of [
    undefined,
    null,
    { config: configFor(sb, FACTORY_WRAPPER), runId: `../${MARKER}` },
    { config: configFor(sb, FACTORY_WRAPPER), runId: RUN_ID.toUpperCase() },
    { config: { readback: { dir: sb.readback } }, runId: RUN_ID },
    { config: configFor(sb, FACTORY_WRAPPER), runId: RUN_ID, signal: { aborted: true } },
  ]) {
    await assert.rejects(
      () => canary.proveReadbackContainment(args),
      (err) =>
        err instanceof BackupError &&
        err.code === 'cloud_cli_invalid_input' &&
        !String(err.message).includes(MARKER),
    )
  }
  assert.equal(calls.length, 0)
  assert.deepEqual(listDir(sb.readback), [])
})

// ═════════════════════════════════════════════════════════════════════════════
// Classification (scripted child outcomes)
// ═════════════════════════════════════════════════════════════════════════════

async function classify(close, act, extra = {}) {
  const sb = sandbox()
  const calls = []
  const canary = factory({ spawn: spawnDouble(calls, { act, close, ...extra }) })
  const config = configFor(sb, FACTORY_WRAPPER)
  const result = await canary.proveReadbackContainment({ config, runId: RUN_ID })
  return { sb, calls, canary, config, result }
}

test('classification: the exact spawn — wrapper, exact limit, module-owned writer, EMPTY environment, no shell', async () => {
  const { sb, calls } = await classify({ code: 3, signal: null }, writeProbe(LIMIT))
  assert.equal(calls.length, 1)
  const [{ command, args, options }] = calls
  assert.equal(command, '/usr/bin/prlimit')
  assert.deepEqual(args, [
    `--fsize=${LIMIT}:${LIMIT}`,
    '--',
    process.execPath,
    '--input-type=commonjs',
    '-e',
    CANARY_SCRIPT,
    path.join(sb.canaryDir, 'probe.bin'),
    String(LIMIT + 65536),
  ])
  assert.deepEqual(options, { stdio: ['ignore', 'pipe', 'pipe'], env: {}, shell: false })
  assert.equal(Object.keys(options.env).length, 0)
})

test('classification: an EFBIG report (exit 3) with a probe of exactly L is proven', async () => {
  const { sb, result, canary, config } = await classify(
    { code: 3, signal: null },
    writeProbe(LIMIT),
  )
  assert.equal(result.kind, 'proven')
  assert.equal(result.proof.limitBytes, LIMIT)
  assert.deepEqual(listDir(sb.readback), [])
  assert.equal(canary.verifyContainmentProof({ proof: result.proof, config, runId: RUN_ID }), true)
})

test('classification: SIGXFSZ is accepted as supporting evidence but never required', async () => {
  const bySignal = await classify({ code: null, signal: 'SIGXFSZ' }, writeProbe(LIMIT))
  assert.equal(bySignal.result.kind, 'proven')
  const byExit = await classify({ code: 3, signal: null }, writeProbe(LIMIT))
  assert.equal(byExit.result.kind, 'proven')
})

test('classification: every weaker outcome is refused, and the canary still cleans up after itself', async () => {
  const cases = [
    // a clean, complete write report — even with a probe of exactly L
    [{ code: 0, signal: null }, writeProbe(LIMIT), 'containment_unproven'],
    // some other failure
    [{ code: 4, signal: null }, writeProbe(LIMIT), 'containment_unproven'],
    [{ code: 1, signal: null }, writeProbe(LIMIT), 'containment_unproven'],
    [{ code: null, signal: 'SIGKILL' }, writeProbe(LIMIT), 'containment_unproven'],
    // refused, but short of the limit: the writer never reached it
    [{ code: 3, signal: null }, writeProbe(LIMIT - 1), 'containment_unproven'],
    [{ code: 3, signal: null }, writeProbe(0), 'containment_unproven'],
    // refused, but no probe at all
    [{ code: 3, signal: null }, () => {}, 'containment_unproven'],
    // larger than the limit: the bound did not hold
    [{ code: 3, signal: null }, writeProbe(LIMIT + 1), 'containment_violated'],
    [{ code: 0, signal: null }, writeProbe(LIMIT + 65536), 'containment_violated'],
    [{ code: null, signal: 'SIGXFSZ' }, writeProbe(LIMIT + 1), 'containment_violated'],
  ]
  for (const [close, act, code] of cases) {
    const { sb, result } = await classify(close, act)
    assertRefused(result, code, 'complete')
    assert.deepEqual(listDir(sb.readback), [], `${code} ${JSON.stringify(close)}`)
  }
})

test('classification: a probe that is not a regular file is unproven and is NOT removed', async () => {
  const { sb, result } = await classify({ code: 3, signal: null }, (probe) => {
    fs.symlinkSync('/etc/hostname', probe)
  })
  assertRefused(result, 'containment_unproven', 'incomplete')
  assert.ok(fs.lstatSync(path.join(sb.canaryDir, 'probe.bin')).isSymbolicLink())
})

test('classification: output beyond the capture cap is contained and unproven, with nothing echoed', async () => {
  const { sb, result } = await classify({ code: 3, signal: null }, writeProbe(LIMIT), {
    stdout: `${MARKER}${'A'.repeat(5000)}`,
  })
  assertRefused(result, 'containment_unproven', 'complete')
  assert.deepEqual(listDir(sb.readback), [])
})

test('classification: a confirmed timeout is unproven and cleaned up', async () => {
  const sb = sandbox()
  const calls = []
  const result = await withKeepAlive(() =>
    factory({
      spawn: spawnDouble(calls, { act: writeProbe(LIMIT), close: 'hang' }),
    }).proveReadbackContainment({
      config: configFor(sb, FACTORY_WRAPPER, {
        run: { operationTimeoutMs: 80, cancelGraceMs: 60 },
      }),
      runId: RUN_ID,
    }),
  )
  assertRefused(result, 'containment_unproven', 'complete')
  assert.deepEqual(listDir(sb.readback), [])
})

test('classification: a confirmed cancellation mid-run is canary_cancelled and cleaned up', async () => {
  const sb = sandbox()
  const calls = []
  const controller = new AbortController()
  const promise = factory({
    spawn: spawnDouble(calls, { act: writeProbe(LIMIT), close: 'hang' }),
  }).proveReadbackContainment({
    config: configFor(sb, FACTORY_WRAPPER),
    runId: RUN_ID,
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 20)
  const result = await withKeepAlive(() => promise)
  assertRefused(result, 'canary_cancelled', 'complete')
  assert.deepEqual(listDir(sb.readback), [])
})

// ═════════════════════════════════════════════════════════════════════════════
// Unconfirmed termination: touch nothing
// ═════════════════════════════════════════════════════════════════════════════

test('termination unconfirmed: nothing is removed — not the probe, not the canary directory', async () => {
  const sb = sandbox()
  const calls = []
  const unlinks = []
  const rmdirs = []
  const result = await withKeepAlive(() =>
    factory({
      spawn: spawnDouble(calls, { act: writeProbe(LIMIT), close: 'never' }),
      unlink: (p) => unlinks.push(p),
      rmdir: (p) => rmdirs.push(p),
    }).proveReadbackContainment({
      config: configFor(sb, FACTORY_WRAPPER, {
        run: { operationTimeoutMs: 60, cancelGraceMs: 40 },
      }),
      runId: RUN_ID,
    }),
  )
  assertRefused(result, 'termination_unconfirmed', 'withheld_termination_unconfirmed')
  assert.deepEqual(unlinks, [])
  assert.deepEqual(rmdirs, [])
  assert.equal(fs.statSync(path.join(sb.canaryDir, 'probe.bin')).size, LIMIT)
})

// ═════════════════════════════════════════════════════════════════════════════
// Cleanup: exact identity, never recursive, failure refuses the proof
// ═════════════════════════════════════════════════════════════════════════════

test('cleanup: a failed removal refuses an otherwise-proven canary', async () => {
  for (const override of [
    {
      unlink: () => {
        throw new Error(MARKER)
      },
    },
    {
      rmdir: () => {
        throw new Error(MARKER)
      },
    },
  ]) {
    const sb = sandbox()
    const calls = []
    const result = await factory({
      spawn: spawnDouble(calls, { act: writeProbe(LIMIT), close: { code: 3, signal: null } }),
      ...override,
    }).proveReadbackContainment({ config: configFor(sb, FACTORY_WRAPPER), runId: RUN_ID })
    assertRefused(result, 'canary_cleanup_failed', 'incomplete')
  }
})

test('cleanup: a probe replaced after classification is not removed', async () => {
  const sb = sandbox()
  const probe = path.join(sb.canaryDir, 'probe.bin')
  const unlinks = []
  let probeObservations = 0
  const lstat = (p) => {
    const real = fs.lstatSync(p, { bigint: true })
    if (p !== probe) return real
    probeObservations += 1
    // 1 = classification, 2 = cleanup: report a different inode at cleanup.
    if (probeObservations < 2) return real
    return new Proxy(real, {
      get: (target, key) =>
        key === 'ino'
          ? target.ino + 1n
          : typeof target[key] === 'function'
            ? target[key].bind(target)
            : target[key],
    })
  }
  const result = await factory({
    spawn: spawnDouble([], { act: writeProbe(LIMIT), close: { code: 3, signal: null } }),
    lstat,
    unlink: (p) => unlinks.push(p),
  }).proveReadbackContainment({ config: configFor(sb, FACTORY_WRAPPER), runId: RUN_ID })
  assertRefused(result, 'canary_cleanup_failed', 'incomplete')
  assert.deepEqual(unlinks, [])
  assert.equal(fs.statSync(probe).size, LIMIT)
})

test('cleanup: a readback directory whose identity changes is never removed from', async () => {
  const sb = sandbox()
  const unlinks = []
  const rmdirs = []
  let dirObservations = 0
  const lstat = (p) => {
    const real = fs.lstatSync(p, { bigint: true })
    if (p !== sb.readback) return real
    dirObservations += 1
    // 1 = initial trust, 2 = before mkdir, 3 = after absence check; 4+ = cleanup.
    if (dirObservations < 4) return real
    return new Proxy(real, {
      get: (target, key) =>
        key === 'dev'
          ? target.dev + 1n
          : typeof target[key] === 'function'
            ? target[key].bind(target)
            : target[key],
    })
  }
  const result = await factory({
    spawn: spawnDouble([], { act: writeProbe(LIMIT), close: { code: 3, signal: null } }),
    lstat,
    unlink: (p) => unlinks.push(p),
    rmdir: (p) => rmdirs.push(p),
  }).proveReadbackContainment({ config: configFor(sb, FACTORY_WRAPPER), runId: RUN_ID })
  assertRefused(result, 'canary_cleanup_failed', 'incomplete')
  assert.deepEqual(unlinks, [])
  assert.deepEqual(rmdirs, [])
})

test('cleanup: an unexpected extra entry in the canary directory leaves it in place (no recursive removal)', async () => {
  const sb = sandbox()
  const result = await factory({
    spawn: spawnDouble([], {
      act: (probe) => {
        writeProbe(LIMIT)(probe)
        fs.writeFileSync(path.join(path.dirname(probe), 'stray'), MARKER)
      },
      close: { code: 3, signal: null },
    }),
  }).proveReadbackContainment({ config: configFor(sb, FACTORY_WRAPPER), runId: RUN_ID })
  assertRefused(result, 'canary_cleanup_failed', 'incomplete')
  assert.deepEqual(listDir(sb.canaryDir), ['stray'])
  assert.equal(fs.readFileSync(path.join(sb.canaryDir, 'stray'), 'utf8'), MARKER)
})

test('setup: a created directory whose identity cannot be confirmed is left alone', async () => {
  const sb = sandbox()
  const rmdirs = []
  const calls = []
  const result = await factory({
    spawn: spawnDouble(calls),
    chmod: () => {
      throw new Error(MARKER)
    },
    rmdir: (p) => rmdirs.push(p),
  }).proveReadbackContainment({ config: configFor(sb, FACTORY_WRAPPER), runId: RUN_ID })
  assertRefused(result, 'canary_setup_failed', 'incomplete')
  assert.equal(calls.length, 0)
  assert.deepEqual(rmdirs, [])
})

test('static: the containment wrapper imports only the core and passes no caller value through except config, runId, signal, proof', () => {
  const src = fs.readFileSync(path.join(HERE, 'backup-cloud-containment.mjs'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./internal/backup-cloud-cli-core.mjs'])
  assert.equal(/\bdeps\b/.test(code), false)
  assert.equal(/readbackDirIdentity/.test(code), false)
})

// ═════════════════════════════════════════════════════════════════════════════
// E3J6A correction — close confirmation, and valid configurations that cannot
// be canaried.
// ═════════════════════════════════════════════════════════════════════════════

test('close race: a canary child that has an exit status but never closes is UNCONFIRMED and nothing is touched', async () => {
  const sb = sandbox()
  const unlinks = []
  const rmdirs = []
  const result = await withKeepAlive(() =>
    factory({
      spawn: spawnDouble([], { act: writeProbe(LIMIT), close: 'exited-never-closes' }),
      unlink: (p) => unlinks.push(p),
      rmdir: (p) => rmdirs.push(p),
    }).proveReadbackContainment({
      config: configFor(sb, FACTORY_WRAPPER, {
        run: { operationTimeoutMs: 60, cancelGraceMs: 40 },
      }),
      runId: RUN_ID,
    }),
  )
  assertRefused(result, 'termination_unconfirmed', 'withheld_termination_unconfirmed')
  assert.deepEqual(unlinks, [])
  assert.deepEqual(rmdirs, [])
  assert.equal(fs.statSync(path.join(sb.canaryDir, 'probe.bin')).size, LIMIT)
})

test('close race: a canary child whose close arrives within the grace period is a CONFIRMED timeout and is cleaned up', async () => {
  const sb = sandbox()
  const result = await withKeepAlive(() =>
    factory({
      spawn: spawnDouble([], { act: writeProbe(LIMIT), close: 'exited-closes-after-kill' }),
    }).proveReadbackContainment({
      config: configFor(sb, FACTORY_WRAPPER, {
        run: { operationTimeoutMs: 60, cancelGraceMs: 40 },
      }),
      runId: RUN_ID,
    }),
  )
  assertRefused(result, 'containment_unproven', 'complete')
  assert.deepEqual(listDir(sb.readback), [])
})

/** A wrapper that records any invocation, so "nothing was spawned" is observable end to end. */
function recordingWrapper(sb) {
  const p = path.join(sb.dir, 'bin', 'recording-prlimit')
  const log = path.join(sb.dir, 'wrapper-invoked')
  fs.writeFileSync(p, ['#!/bin/sh', `: > '${log}'`, 'shift 2', 'exec "$@"', ''].join('\n'), {
    mode: 0o755,
  })
  return { wrapper: { executable: p, expectedSha512: sha512(p) }, log }
}

test('valid config: ceilings at or near MAX_SAFE_INTEGER are a closed refusal — nothing created, nothing spawned', async () => {
  for (const ceiling of [
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER - 65_535,
  ]) {
    const sb = sandbox()
    const { wrapper, log } = recordingWrapper(sb)
    const config = configFor(sb, wrapper, {
      readback: {
        maxCiphertextBytes: ceiling,
        maxManifestBytes: ceiling,
        maxSidecarBytes: ceiling,
      },
    })
    const result = await production.proveReadbackContainment({ config, runId: RUN_ID })
    assertRefused(result, 'containment_unproven', 'not_started')
    assert.equal(JSON.stringify(result).includes(String(ceiling)), false)
    assert.deepEqual(listDir(sb.readback), [], 'no canary path was created')
    assert.equal(fs.existsSync(log), false, 'the wrapper was never executed')
  }
})

test('valid config: an overshoot that is still representable is attempted normally', async () => {
  const sb = sandbox()
  const calls = []
  const ceiling = Number.MAX_SAFE_INTEGER - 65_536
  const result = await factory({
    spawn: spawnDouble(calls, { close: { code: 0, signal: null } }),
  }).proveReadbackContainment({
    config: configFor(sb, FACTORY_WRAPPER, {
      readback: {
        maxCiphertextBytes: ceiling,
        maxManifestBytes: ceiling,
        maxSidecarBytes: ceiling,
      },
    }),
    runId: RUN_ID,
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args[0], `--fsize=${ceiling}:${ceiling}`)
  assert.equal(calls[0].args.at(-1), String(Number.MAX_SAFE_INTEGER))
  assertRefused(result, 'containment_unproven', 'complete')
})

test('valid config: a readback path the argv validator refuses is a closed refusal, not a thrown argv error', async () => {
  const sb = sandbox()
  const dashed = path.join(sb.dir, '-readback')
  fs.mkdirSync(dashed, { mode: 0o700 })
  fs.chmodSync(dashed, 0o700)
  const { wrapper, log } = recordingWrapper(sb)
  const result = await production.proveReadbackContainment({
    config: configFor(sb, wrapper, { readback: { dir: dashed } }),
    runId: RUN_ID,
  })
  assertRefused(result, 'containment_unproven', 'not_started')
  assert.deepEqual(listDir(dashed), [])
  assert.equal(fs.existsSync(log), false)
})
