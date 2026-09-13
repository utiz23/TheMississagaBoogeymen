/**
 * Cloud-transport configuration — E3J3, T22/T23.
 *
 * T22 here covers only the E3J3 portion: the config validator requires and
 * format-checks `cli.expectedSha512`, and `verifyCliHashPin()` is a pure
 * local comparison that fails closed on a malformed or mismatched observed
 * value. It does NOT and cannot prove that hash verification runs before any
 * provider-command construction — there is no provider-command constructor
 * yet (that integration assertion belongs to E3J4; see the corrected split
 * recorded in `docs/planning/proton-drive-cloud-transport-architecture.md`
 * §11.1/§13).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { BackupError } from './backup-artifact-contract.mjs'
import { loadCloudConfig, validateCloudConfig, verifyCliHashPin } from './backup-cloud-config.mjs'
import { ConfigError } from './backup-config.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-config' })

// Mixed digits-and-letters, deliberately NOT all-numeric: an all-numeric
// fixture would make `.toUpperCase()` a no-op and silently defeat the
// case-sensitivity assertions below.
const HASH_A = '0123456789abcdef'.repeat(8)
const HASH_B = 'fedcba9876543210'.repeat(8)

const VALID = {
  cli: {
    executable: '/opt/eanhl-cloud/bin/proton-drive',
    expectedSha512: HASH_A,
  },
  credentials: { backend: 'pass' },
  remote: { root: '/proton/backups/eanhl' },
  artifact: { sourceDir: '/var/eanhl/artifacts' },
  attestation: { dir: '/var/eanhl/cloud-attestations' },
  readback: {
    dir: '/var/eanhl/cloud-readback',
    maxCiphertextBytes: 5_368_709_120,
    maxManifestBytes: 1_048_576,
    maxSidecarBytes: 4_096,
    containment: 'rlimit_fsize',
  },
  run: {
    lockFile: '/var/eanhl/cloud-run/uploader.lock',
    operationTimeoutMs: 1_800_000,
    cancelGraceMs: 20_000,
  },
  retry: {
    maxAttemptsPerArtifactPerRun: 3,
    backoffMs: 30_000,
    maxTotalAttemptsPerRun: 9,
  },
  capacity: {
    minFreeBytes: 5_368_709_120,
    backingVolume: null,
  },
}

const clone = () => structuredClone(VALID)

function rejects(mutate, code) {
  const cfg = clone()
  mutate(cfg)
  let err = null
  try {
    validateCloudConfig(cfg)
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof ConfigError, `expected a ConfigError, got ${err}`)
  assert.equal(err.code, code, err.message)
  return err
}

test('a fully specified cloud config validates and is frozen', () => {
  const cfg = validateCloudConfig(clone())
  assert.equal(cfg.credentials.backend, 'pass')
  assert.equal(cfg.remote.root, '/proton/backups/eanhl')
  assert.throws(() => {
    cfg.credentials.backend = 'unsafe_file'
  }, TypeError)
})

test('every top-level section is mandatory', () => {
  for (const section of [
    'cli',
    'credentials',
    'remote',
    'artifact',
    'attestation',
    'readback',
    'run',
    'retry',
    'capacity',
  ]) {
    rejects((c) => delete c[section], 'config_field_type')
  }
})

// ── T22 (E3J3 portion): expectedSha512 ───────────────────────────────────────

test('T22: expectedSha512 missing, malformed, uppercase, short, or non-hex is rejected', () => {
  rejects((c) => delete c.cli.expectedSha512, 'config_field_missing')
  rejects((c) => (c.cli.expectedSha512 = ''), 'config_field_missing')
  rejects((c) => (c.cli.expectedSha512 = HASH_A.toUpperCase()), 'config_field_invalid')
  rejects((c) => (c.cli.expectedSha512 = HASH_A.slice(0, 127)), 'config_field_invalid')
  rejects((c) => (c.cli.expectedSha512 = HASH_A.slice(0, 126) + 'gg'), 'config_field_invalid')
  rejects((c) => (c.cli.expectedSha512 = HASH_A + '0'), 'config_field_invalid')
  rejects((c) => (c.cli.expectedSha512 = 12345), 'config_field_missing')
})

test('T22: a well-formed 128-character lowercase hex pin is accepted', () => {
  const cfg = validateCloudConfig(clone())
  assert.equal(cfg.cli.expectedSha512, HASH_A)
  assert.equal(cfg.cli.expectedSha512.length, 128)
})

test('T22: verifyCliHashPin passes on an exact match', () => {
  assert.equal(verifyCliHashPin({ expectedSha512: HASH_A, observedSha512: HASH_A }), true)
})

test('T22: verifyCliHashPin fails closed on a mismatch with the intended code', () => {
  assert.throws(
    () => verifyCliHashPin({ expectedSha512: HASH_A, observedSha512: HASH_B }),
    (err) => err instanceof BackupError && err.code === 'cli_hash_mismatch',
  )
})

test('T22: verifyCliHashPin fails closed on a malformed observed value with the intended code', () => {
  for (const bad of [
    '',
    HASH_A.toUpperCase(),
    HASH_A.slice(0, 10),
    'not-hex-at-all',
    null,
    undefined,
  ]) {
    assert.throws(
      () => verifyCliHashPin({ expectedSha512: HASH_A, observedSha512: bad }),
      (err) => err instanceof BackupError && err.code === 'cli_hash_observed_malformed',
      `expected ${JSON.stringify(bad)} to be rejected`,
    )
  }
})

test('T22: verifyCliHashPin fails closed on a malformed configured pin with the intended code', () => {
  assert.throws(
    () => verifyCliHashPin({ expectedSha512: 'not-hex', observedSha512: HASH_A }),
    (err) => err instanceof BackupError && err.code === 'cli_hash_pin_malformed',
  )
})

test('T22: verifyCliHashPin is a pure local comparison — it never invokes a CLI or provider', () => {
  // There is no `deps`, no spawn, no network argument this function could
  // even accept — its signature is exactly {expectedSha512, observedSha512}.
  // This test documents the boundary rather than mocking anything: the
  // integration assertion that hash verification precedes provider-command
  // construction belongs to E3J4, once a provider-command constructor
  // exists. Not proven here, and not claimed here.
  assert.equal(verifyCliHashPin.length, 1)
})

// ── T23: credentials, secret-shaped keys, path separation, numeric fields ────

test('T23: credentials.backend rejects "unsafe_file" and every other value', () => {
  rejects((c) => (c.credentials.backend = 'unsafe_file'), 'config_field_invalid')
  rejects((c) => (c.credentials.backend = 'plaintext'), 'config_field_invalid')
  rejects((c) => (c.credentials.backend = ''), 'config_field_missing')
  rejects((c) => delete c.credentials.backend, 'config_field_missing')
})

test('T23: credentials.backend accepts exactly "pass" and "keychain"', () => {
  for (const backend of ['pass', 'keychain']) {
    const cfg = clone()
    cfg.credentials.backend = backend
    assert.equal(validateCloudConfig(cfg).credentials.backend, backend)
  }
})

test('T23: recursive secret-shaped keys are rejected at multiple nesting depths', () => {
  const shapes = [
    (c) => (c.token = 'x'),
    (c) => (c.cli.secret = 'x'),
    (c) => (c.credentials.password = 'x'),
    (c) => (c.credentials.passphrase = 'x'),
    (c) => (c.remote.sessionCookie = 'x'),
    (c) => (c.artifact.recoveryPhrase = 'x'),
    (c) => (c.attestation.accountEmail = 'x'),
    (c) => (c.readback.authUrl = 'x'),
    (c) => (c.run.nested = { deeply: { nested: { authToken: 'x' } } }),
    (c) => (c.capacity.backingVolume = { mountPoint: '/mnt/c', minFreeBytes: 1, cookieJar: 'x' }),
  ]
  for (const mutate of shapes) {
    rejects(mutate, 'config_secret_shaped_key')
  }
})

test('Correction 3: a rejected secret-shaped key is never echoed in the error, even when the key itself carries a marker', () => {
  const MARKER = 'UNIQUE_SECRET_MARKER_9f3a7c1e'
  for (const mutate of [
    (c) => (c[`token_${MARKER}`] = 'x'),
    (c) => (c.cli[`${MARKER}_secret`] = 'x'),
    (c) => (c.run.nested = { deeply: { [`password_${MARKER}`]: 'x' } }),
  ]) {
    const cfg = clone()
    mutate(cfg)
    let err = null
    try {
      validateCloudConfig(cfg)
    } catch (e) {
      err = e
    }
    assert.ok(err instanceof ConfigError, `expected a ConfigError, got ${err}`)
    assert.equal(err.code, 'config_secret_shaped_key')
    assert.equal(err.message.includes(MARKER), false, 'err.message must not echo the marker')
    for (const propName of Object.getOwnPropertyNames(err)) {
      const value = err[propName]
      if (typeof value === 'string') {
        assert.equal(value.includes(MARKER), false, `err.${propName} must not echo the marker`)
      }
    }
  }
})

test('T23: the authorized credentials object and its backend selector are never rejected as secret-shaped', () => {
  // Sanity: a config with ONLY the authorized shape validates cleanly.
  const cfg = validateCloudConfig(clone())
  assert.equal(cfg.credentials.backend, 'pass')
})

test('T23: secret-shaped rejection is a key-name check, not a value-content check', () => {
  const cfg = clone()
  cfg.remote.root = '/proton/backups/token-shaped-value-but-fine'
  // "token" appears in the VALUE, not a key name — must not be rejected.
  const validated = validateCloudConfig(cfg)
  assert.equal(validated.remote.root, '/proton/backups/token-shaped-value-but-fine')
})

test('T23: all path-separation rules are enforced', () => {
  rejects((c) => (c.attestation.dir = c.artifact.sourceDir), 'config_field_invalid')
  rejects((c) => (c.readback.dir = c.artifact.sourceDir), 'config_field_invalid')
  rejects((c) => (c.readback.dir = c.attestation.dir), 'config_field_invalid')
  rejects((c) => (c.attestation.dir = `${c.artifact.sourceDir}/nested`), 'config_field_invalid')
  rejects((c) => (c.artifact.sourceDir = `${c.readback.dir}/nested`), 'config_field_invalid')
  rejects((c) => (c.run.lockFile = `${c.artifact.sourceDir}/uploader.lock`), 'config_field_invalid')
  rejects((c) => (c.run.lockFile = `${c.readback.dir}/uploader.lock`), 'config_field_invalid')
  rejects((c) => (c.run.lockFile = c.artifact.sourceDir), 'config_field_invalid')
  rejects((c) => (c.run.lockFile = c.attestation.dir), 'config_field_invalid')
  rejects((c) => (c.run.lockFile = c.readback.dir), 'config_field_invalid')

  // A naive string-prefix check would wrongly treat this as "inside".
  const cfg = clone()
  cfg.readback.dir = `${cfg.artifact.sourceDir}-sibling`
  const validated = validateCloudConfig(cfg)
  assert.equal(validated.readback.dir, `${VALID.artifact.sourceDir}-sibling`)
})

// ── Correction 1 (independent review): canonical local paths before containment ──

test('Correction 1: dot-segment and repeated-separator aliases into artifact.sourceDir are rejected, not normalized', () => {
  rejects((c) => {
    c.artifact.sourceDir = '/data/artifacts'
    c.readback.dir = '/data/x/../artifacts/readback'
  }, 'config_field_not_canonical')
  rejects((c) => {
    c.artifact.sourceDir = '/data/artifacts'
    c.readback.dir = '/data//artifacts/readback'
  }, 'config_field_not_canonical')
  rejects((c) => {
    c.artifact.sourceDir = '/data/artifacts'
    c.run.lockFile = '/data/x/../artifacts/uploader.lock'
  }, 'config_field_not_canonical')
})

test('Correction 1: the reverse alias — the OTHER side non-canonical — is equally rejected', () => {
  rejects((c) => {
    c.readback.dir = '/data/readback'
    c.artifact.sourceDir = '/data/readback/../artifacts'
  }, 'config_field_not_canonical')
  rejects((c) => {
    c.artifact.sourceDir = '/data/artifacts'
    c.attestation.dir = '/data/artifacts/../attestations'
  }, 'config_field_not_canonical')
})

test('Correction 1: backingVolume.mountPoint aliases are rejected the same way', () => {
  rejects(
    (c) => (c.capacity.backingVolume = { mountPoint: '/mnt/c/../c', minFreeBytes: 1 }),
    'config_field_not_canonical',
  )
  rejects(
    (c) => (c.capacity.backingVolume = { mountPoint: '/mnt//c', minFreeBytes: 1 }),
    'config_field_not_canonical',
  )
  rejects(
    (c) => (c.capacity.backingVolume = { mountPoint: '/mnt/c/', minFreeBytes: 1 }),
    'config_field_not_canonical',
  )
  // A canonical mountPoint still validates cleanly.
  const cfg = clone()
  cfg.capacity.backingVolume = { mountPoint: '/mnt/c', minFreeBytes: 1 }
  assert.equal(validateCloudConfig(cfg).capacity.backingVolume.mountPoint, '/mnt/c')
})

test('Correction 1: cli.executable must also be canonical', () => {
  rejects((c) => (c.cli.executable = '/opt/../opt/bin/proton-drive'), 'config_field_not_canonical')
  rejects((c) => (c.cli.executable = '/opt//bin/proton-drive'), 'config_field_not_canonical')
  rejects((c) => (c.cli.executable = '/opt/bin/proton-drive/'), 'config_field_not_canonical')
})

test('Correction 1: trailing separators are rejected on every local path field', () => {
  rejects((c) => (c.artifact.sourceDir = `${c.artifact.sourceDir}/`), 'config_field_not_canonical')
  rejects((c) => (c.attestation.dir = `${c.attestation.dir}/`), 'config_field_not_canonical')
  rejects((c) => (c.readback.dir = `${c.readback.dir}/`), 'config_field_not_canonical')
  rejects((c) => (c.run.lockFile = `${c.run.lockFile}/`), 'config_field_not_canonical')
})

test('Correction 1: a canonical sibling directory remains valid — whole-component behavior preserved', () => {
  const cfg = clone()
  cfg.artifact.sourceDir = '/data/artifacts'
  cfg.readback.dir = '/data/artifacts-2'
  const validated = validateCloudConfig(cfg)
  assert.equal(validated.artifact.sourceDir, '/data/artifacts')
  assert.equal(validated.readback.dir, '/data/artifacts-2')
})

test('T23: run.cancelGraceMs must be strictly smaller than operationTimeoutMs', () => {
  rejects((c) => (c.run.cancelGraceMs = c.run.operationTimeoutMs), 'config_field_invalid')
  rejects((c) => (c.run.cancelGraceMs = c.run.operationTimeoutMs + 1), 'config_field_invalid')
})

test('T23: retry.maxTotalAttemptsPerRun must not be smaller than maxAttemptsPerArtifactPerRun', () => {
  rejects(
    (c) => (c.retry.maxTotalAttemptsPerRun = c.retry.maxAttemptsPerArtifactPerRun - 1),
    'config_field_invalid',
  )
  // Equality is explicitly valid.
  const cfg = clone()
  cfg.retry.maxTotalAttemptsPerRun = cfg.retry.maxAttemptsPerArtifactPerRun
  const validated = validateCloudConfig(cfg)
  assert.equal(validated.retry.maxTotalAttemptsPerRun, validated.retry.maxAttemptsPerArtifactPerRun)
})

test('T23: all required numeric fields have no defaults and require positive safe integers', () => {
  const numericFields = [
    ['readback', 'maxCiphertextBytes'],
    ['readback', 'maxManifestBytes'],
    ['readback', 'maxSidecarBytes'],
    ['run', 'operationTimeoutMs'],
    ['run', 'cancelGraceMs'],
    ['retry', 'maxAttemptsPerArtifactPerRun'],
    ['retry', 'backoffMs'],
    ['retry', 'maxTotalAttemptsPerRun'],
    ['capacity', 'minFreeBytes'],
  ]
  for (const [section, key] of numericFields) {
    rejects((c) => delete c[section][key], 'config_field_missing')
    rejects((c) => (c[section][key] = 0), 'config_field_missing')
    rejects((c) => (c[section][key] = -1), 'config_field_missing')
    rejects((c) => (c[section][key] = 1.5), 'config_field_missing')
    rejects((c) => (c[section][key] = `${c[section][key]}`), 'config_field_missing')
  }
})

test('T23: readback.containment accepts only "rlimit_fsize" or "quota_mount"', () => {
  rejects((c) => (c.readback.containment = 'none'), 'config_field_invalid')
  rejects((c) => (c.readback.containment = 'RLIMIT_FSIZE'), 'config_field_invalid')
  for (const containment of ['rlimit_fsize', 'quota_mount']) {
    const cfg = clone()
    cfg.readback.containment = containment
    assert.equal(validateCloudConfig(cfg).readback.containment, containment)
  }
})

test('T23: capacity.backingVolume is required-but-nullable, same as the producer/acceptor contract', () => {
  rejects((c) => delete c.capacity.backingVolume, 'config_field_missing')
  const cfg = clone()
  cfg.capacity.backingVolume = { mountPoint: '/mnt/c', minFreeBytes: 1 }
  assert.deepEqual(validateCloudConfig(cfg).capacity.backingVolume, {
    mountPoint: '/mnt/c',
    minFreeBytes: 1,
  })
})

test('Correction 4: a non-null capacity.backingVolume result is itself frozen', () => {
  const cfg = clone()
  cfg.capacity.backingVolume = { mountPoint: '/mnt/c', minFreeBytes: 1 }
  const validated = validateCloudConfig(cfg)
  assert.throws(() => {
    validated.capacity.backingVolume.mountPoint = 'tampered'
  }, TypeError)
  assert.throws(() => {
    validated.capacity.backingVolume.minFreeBytes = 999
  }, TypeError)
  assert.equal(validated.capacity.backingVolume.mountPoint, '/mnt/c')
  // null stays a valid, trivially-immutable value.
  const nullCfg = clone()
  assert.equal(validateCloudConfig(nullCfg).capacity.backingVolume, null)
})

test('T23: remote.root is validated component-by-component and non-canonical roots are rejected', () => {
  rejects((c) => (c.remote.root = 'relative/root'), 'config_field_invalid')
  rejects((c) => (c.remote.root = '/a//b'), 'config_field_invalid')
  rejects((c) => (c.remote.root = '/a/'), 'config_field_invalid')
  rejects((c) => (c.remote.root = '/'), 'config_field_invalid')
  rejects((c) => (c.remote.root = '/a/../b'), 'config_field_invalid')
})

test('T23: all local path fields must be absolute', () => {
  rejects((c) => (c.cli.executable = 'proton-drive'), 'config_field_not_absolute')
  rejects((c) => (c.artifact.sourceDir = 'relative/artifacts'), 'config_field_not_absolute')
  rejects((c) => (c.attestation.dir = './attestations'), 'config_field_not_absolute')
  rejects((c) => (c.readback.dir = 'readback'), 'config_field_not_absolute')
  rejects((c) => (c.run.lockFile = 'uploader.lock'), 'config_field_not_absolute')
})

test('loadCloudConfig reports unreadable and unparseable files distinctly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cloud-cfg-'))
  try {
    assert.throws(
      () => loadCloudConfig(`${dir}/nope.json`, (p) => fs.readFileSync(p, 'utf8')),
      (e) => e.code === 'config_unreadable',
    )
    fs.writeFileSync(`${dir}/bad.json`, '{ not json')
    assert.throws(
      () => loadCloudConfig(`${dir}/bad.json`, (p) => fs.readFileSync(p, 'utf8')),
      (e) => e.code === 'config_unparseable',
    )
    fs.writeFileSync(`${dir}/ok.json`, JSON.stringify(VALID))
    const cfg = loadCloudConfig(`${dir}/ok.json`, (p) => fs.readFileSync(p, 'utf8'))
    assert.equal(cfg.remote.root, '/proton/backups/eanhl')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('T23: the checked-in example configuration loads and validates', () => {
  const p = new URL('../eanhl-backup-cloud.example.json', import.meta.url)
  const cfg = validateCloudConfig(
    JSON.parse(fs.readFileSync(p, 'utf8')),
    'eanhl-backup-cloud.example.json',
  )
  assert.equal(cfg.credentials.backend, 'pass')
  assert.equal(cfg.cli.expectedSha512.length, 128)
  assert.match(cfg.cli.expectedSha512, /^[0-9a-f]{128}$/)
  assert.equal(cfg.readback.containment, 'rlimit_fsize')
  assert.equal(cfg.run.cancelGraceMs < cfg.run.operationTimeoutMs, true)
  assert.equal(cfg.retry.maxTotalAttemptsPerRun >= cfg.retry.maxAttemptsPerArtifactPerRun, true)
})
