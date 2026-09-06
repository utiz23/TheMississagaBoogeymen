/**
 * Backup producer — configuration suite.
 *
 * The property under test is that the configuration has NO defaults. Every
 * rejection below is a case where a defaulting implementation would have
 * silently picked a value — and the values in question decide which database
 * gets dumped, where a full copy of it is written, and how much disk it may
 * consume.
 *
 * The `backingVolume` cases are the WSL correction: a config that simply omits
 * the key must be rejected, because "I did not think about whether df lies
 * here" and "df tells the truth here" must not be indistinguishable.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ConfigError,
  MANIFEST_SCHEMA_VERSION,
  loadConfig,
  validateConfig,
} from './backup-config.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

// Report the active test and what is still alive if anything stalls.
installTestWatchdog({ label: 'config' })

const VALID = {
  source: { container: 'eanhl-verify-test-db-test-1', database: 'eanhl_test', user: 'eanhl_test' },
  manifest: {
    criticalTables: ['public.matches', 'public.players'],
    migrations: { schema: 'drizzle', table: '__drizzle_migrations', idColumn: 'id' },
    imageRefs: { db: 'postgres:16-alpine' },
  },
  encryption: {
    executable: 'age',
    recipientFile: '/home/x/.config/eanhl/backup-recipient.pub',
    expectedHeader: 'age-encryption.org/v1',
  },
  staging: {
    root: '/var/tmp/eanhl-backup',
    minFreeBytes: 2_147_483_648,
    backingVolume: { mountPoint: '/mnt/c', minFreeBytes: 5_368_709_120 },
    maxPlaintextBytes: 2_147_483_648,
    maxStagingBytes: 5_368_709_120,
    shredPlaintext: true,
  },
  destination: {
    dir: '/mnt/k/eanhl-backups/prod',
    minFreeBytes: 21_474_836_480,
    backingVolume: null,
  },
  run: {
    lockFile: '/var/tmp/eanhl-backup/producer.lock',
    lockStaleAfterMs: 3_600_000,
    operationTimeoutMs: 1_800_000,
    cancelGraceMs: 20_000,
    containerProbeTimeoutMs: 15_000,
    artifactPrefix: 'eanhl-prod',
    fullArchiveReadDefault: false,
  },
}

const clone = () => structuredClone(VALID)

function rejects(mutate, code) {
  const cfg = clone()
  mutate(cfg)
  let err = null
  try {
    validateConfig(cfg)
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof ConfigError, `expected a ConfigError, got ${err}`)
  assert.equal(err.code, code, err.message)
  return err
}

test('a fully specified config validates and is frozen', () => {
  const cfg = validateConfig(clone())
  assert.equal(cfg.source.container, 'eanhl-verify-test-db-test-1')
  assert.equal(cfg.manifest.criticalTables.length, 2)
  assert.throws(() => {
    cfg.source.database = 'eanhl'
  }, TypeError)
  assert.equal(MANIFEST_SCHEMA_VERSION, 1)
})

test('every top-level section is mandatory', () => {
  for (const section of ['source', 'manifest', 'encryption', 'staging', 'destination', 'run']) {
    rejects((c) => delete c[section], 'config_field_type')
  }
})

test('the database, container and user have no defaults', () => {
  rejects((c) => delete c.source.container, 'config_field_missing')
  rejects((c) => delete c.source.database, 'config_field_missing')
  rejects((c) => delete c.source.user, 'config_field_missing')
  rejects((c) => (c.source.container = 'not a container name'), 'config_field_invalid')
  rejects((c) => (c.source.database = 'Eanhl; DROP DATABASE eanhl'), 'config_field_invalid')
})

test('backingVolume must be stated explicitly, including when it is null', () => {
  // Omitted entirely — the case that matters on WSL.
  const err = rejects((c) => delete c.staging.backingVolume, 'config_field_missing')
  assert.match(err.message, /sparse VHDX/)
  rejects((c) => delete c.destination.backingVolume, 'config_field_missing')

  // Explicit null is accepted.
  const cfg = clone()
  cfg.staging.backingVolume = null
  assert.equal(validateConfig(cfg).staging.backingVolume, null)

  // A half-specified backing volume is not.
  rejects((c) => (c.staging.backingVolume = { mountPoint: '/mnt/c' }), 'config_field_missing')
  rejects((c) => (c.staging.backingVolume = { minFreeBytes: 1 }), 'config_field_missing')
  rejects(
    (c) => (c.staging.backingVolume = { mountPoint: 'mnt/c', minFreeBytes: 1 }),
    'config_field_not_absolute',
  )
})

test('staging bounds must be coherent: ciphertext and plaintext coexist', () => {
  rejects((c) => (c.staging.maxStagingBytes = c.staging.maxPlaintextBytes), 'config_field_invalid')
  rejects((c) => (c.staging.maxStagingBytes = 1), 'config_field_invalid')
  rejects((c) => (c.staging.maxPlaintextBytes = 0), 'config_field_missing')
  rejects((c) => (c.staging.maxPlaintextBytes = 1.5), 'config_field_missing')
})

test('the lifecycle budgets are mandatory and mutually coherent', () => {
  rejects((c) => delete c.run.operationTimeoutMs, 'config_field_missing')
  rejects((c) => delete c.run.cancelGraceMs, 'config_field_missing')
  rejects((c) => delete c.run.containerProbeTimeoutMs, 'config_field_missing')
  // Cancelling a timed-out operation has to fit inside the budget that
  // declared it timed out; the probe runs after that budget is already spent.
  rejects((c) => (c.run.cancelGraceMs = c.run.operationTimeoutMs), 'config_field_invalid')
  rejects(
    (c) => (c.run.containerProbeTimeoutMs = c.run.operationTimeoutMs + 1),
    'config_field_invalid',
  )
})

test('shredPlaintext and fullArchiveReadDefault must be stated, not inferred', () => {
  rejects((c) => delete c.staging.shredPlaintext, 'config_field_missing')
  rejects((c) => (c.staging.shredPlaintext = 'yes'), 'config_field_missing')
  rejects((c) => delete c.run.fullArchiveReadDefault, 'config_field_missing')
})

test('paths must be absolute — a timer supplies no useful cwd', () => {
  rejects((c) => (c.staging.root = 'var/tmp/eanhl-backup'), 'config_field_not_absolute')
  rejects((c) => (c.destination.dir = './backups'), 'config_field_not_absolute')
  rejects((c) => (c.run.lockFile = 'producer.lock'), 'config_field_not_absolute')
  rejects((c) => (c.encryption.recipientFile = '~/recipient.pub'), 'config_field_not_absolute')
})

test('staging and destination must not be the same directory', () => {
  rejects((c) => (c.destination.dir = c.staging.root), 'config_field_invalid')
})

test('critical tables must be a non-empty, unique, schema-qualified list', () => {
  rejects((c) => (c.manifest.criticalTables = []), 'config_field_missing')
  rejects((c) => delete c.manifest.criticalTables, 'config_field_missing')
  rejects((c) => (c.manifest.criticalTables = ['matches']), 'config_field_invalid')
  rejects(
    (c) => (c.manifest.criticalTables = ['public.matches; DROP TABLE x']),
    'config_field_invalid',
  )
  rejects((c) => (c.manifest.criticalTables = ["public.matches'"]), 'config_field_invalid')
  const dup = rejects(
    (c) => (c.manifest.criticalTables = ['public.matches', 'public.matches']),
    'config_field_invalid',
  )
  assert.match(dup.message, /twice/)
})

test('the migration journal location is configurable but must be real identifiers', () => {
  rejects((c) => delete c.manifest.migrations, 'config_field_type')
  rejects((c) => (c.manifest.migrations.table = '__drizzle migrations'), 'config_field_invalid')
  const cfg = clone()
  cfg.manifest.migrations = { schema: 'public', table: 'schema_version', idColumn: 'version' }
  assert.equal(validateConfig(cfg).manifest.migrations.table, 'schema_version')
})

test('the encryption boundary must name an executable, a recipients file and an expected header', () => {
  rejects((c) => delete c.encryption.executable, 'config_field_missing')
  rejects((c) => delete c.encryption.recipientFile, 'config_field_missing')
  const err = rejects((c) => delete c.encryption.expectedHeader, 'config_field_missing')
  assert.match(err.message, /expectedHeader/)
  rejects((c) => (c.encryption.expectedHeader = ''), 'config_field_missing')
})

test('the artifact prefix becomes a filename and is constrained accordingly', () => {
  rejects((c) => (c.run.artifactPrefix = '../escape'), 'config_field_invalid')
  rejects((c) => (c.run.artifactPrefix = 'EANHL_PROD'), 'config_field_invalid')
  rejects((c) => (c.run.artifactPrefix = 'eanhl prod'), 'config_field_invalid')
})

test('loadConfig reports unreadable and unparseable files distinctly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cfg-'))
  try {
    assert.throws(
      () => loadConfig(`${dir}/nope.json`, (p) => fs.readFileSync(p, 'utf8')),
      (e) => e.code === 'config_unreadable',
    )
    fs.writeFileSync(`${dir}/bad.json`, '{ not json')
    assert.throws(
      () => loadConfig(`${dir}/bad.json`, (p) => fs.readFileSync(p, 'utf8')),
      (e) => e.code === 'config_unparseable',
    )
    fs.writeFileSync(`${dir}/ok.json`, JSON.stringify(VALID))
    const cfg = loadConfig(`${dir}/ok.json`, (p) => fs.readFileSync(p, 'utf8'))
    assert.equal(cfg.destination.dir, '/mnt/k/eanhl-backups/prod')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the shipped example configuration is itself valid', () => {
  const p = new URL('../eanhl-backup.example.json', import.meta.url)
  const cfg = validateConfig(JSON.parse(fs.readFileSync(p, 'utf8')), 'eanhl-backup.example.json')
  assert.equal(cfg.manifest.criticalTables.length, 17)
  assert.equal(cfg.source.container, 'eanhl-team-website-db-1')
  assert.equal(cfg.encryption.expectedHeader, 'age-encryption.org/v1')
})
