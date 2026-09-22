/**
 * Cloud backup freshness evaluation — E3J7.
 *
 * PRODUCTION-route tests exercise the real filesystem and the real E3J6B
 * record reader through `backup-cloud-freshness.mjs`. FACTORY-route tests
 * build an evaluator from the internal core's `makeCloudFreshness()` with a
 * partly-injected dependency set — a fixed clock (so age boundaries are
 * exact), a synthetic directory handle (so the 20000-entry ceiling is proven
 * without creating 20000 files), and fault injection for a close failure —
 * while keeping the REAL filesystem everywhere else.
 *
 * `buildReceipt()` is imported from the ACCEPTOR here, and only here, for one
 * purpose: to prove that a genuine destination receipt is rejected by
 * `validateCloudAttestationBinding()`. A static test in this file asserts that
 * no freshness SOURCE module imports it.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { buildReceipt } from './backup-acceptance.mjs'
import { BackupError } from './backup-artifact-contract.mjs'
import * as records from './backup-cloud-attestation-records.mjs'
import * as production from './backup-cloud-freshness.mjs'
import {
  CRITICAL_AFTER_SECONDS,
  FRESHNESS_ANOMALY_CODES,
  FRESHNESS_COUNT_KEYS,
  FRESHNESS_SCAN_STATES,
  FRESHNESS_SIGNAL_KIND,
  FRESHNESS_STATUSES,
  LOCAL_MANIFEST_CEILING_BYTES,
  LOOKBACK_SECONDS,
  MAX_ATTESTATIONS_READ,
  MAX_DIRECTORY_ENTRIES,
  REAL_FRESHNESS_DEPS,
  USAGE,
  WARNING_AFTER_SECONDS,
  drainWrite,
  makeCloudFreshness,
  makeFreshnessEntrypoint,
  observeReadableSourceDirIdentity,
  validateFreshnessSignal,
} from './internal/backup-cloud-freshness-core.mjs'
import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-freshness' })

const HERE = path.dirname(new URL(import.meta.url).pathname)

const NOW_MS = Date.parse('2026-09-21T12:00:00.000Z')
const HOUR = 3600 * 1000
const SHA_A = '0123456789abcdef'.repeat(4)
const SHA_B = 'fedcba9876543210'.repeat(4)
const SHA_C = 'abcdef0123456789'.repeat(4)
const SHA512_A = '0123456789abcdef'.repeat(8)
const SHA512_B = 'fedcba9876543210'.repeat(8)
const REMOTE_ROOT = '/proton/eanhl-backups'

/** `2026-09-21T12:00:00.000Z` -> `20260921T120000Z`. */
function stampOf(ms) {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}
function isoOf(ms) {
  return new Date(ms).toISOString()
}
function baseAt(ms) {
  return `eanhl-test-${stampOf(ms)}`
}
function attemptIdAt(ms, n = 1) {
  return `${stampOf(ms)}-${n.toString(16).padStart(8, '0')}`
}
function runIdAt(ms, n = 1) {
  return `${stampOf(ms)}-${n.toString(16).padStart(8, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox.
// ─────────────────────────────────────────────────────────────────────────────

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

function sandbox({ sourceMode = 0o755 } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-freshness-')))
  sandboxes.push(dir)
  const attestationDir = path.join(dir, 'attest')
  const sourceDir = path.join(dir, 'artifacts')
  fs.mkdirSync(attestationDir, { mode: 0o700 })
  fs.mkdirSync(sourceDir, { mode: sourceMode })
  fs.chmodSync(sourceDir, sourceMode)
  return { dir, attestationDir, sourceDir }
}

function configFor(sb, overrides = {}) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: SHA512_A },
    credentials: { backend: 'pass' },
    remote: { root: REMOTE_ROOT },
    artifact: { sourceDir: sb.sourceDir },
    attestation: { dir: sb.attestationDir },
    readback: {
      dir: path.join(sb.dir, 'readback'),
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: { executable: '/usr/bin/prlimit', expectedSha512: SHA512_B },
      ...(overrides.readback ?? {}),
    },
    run: {
      lockFile: path.join(sb.dir, 'run', 'uploader.lock'),
      operationTimeoutMs: 5_000,
      cancelGraceMs: 500,
    },
    retry: { maxAttemptsPerArtifactPerRun: 1, backoffMs: 1, maxTotalAttemptsPerRun: 1 },
    capacity: { minFreeBytes: 1, backingVolume: null },
  }
}

function names(base) {
  return {
    ciphertext: `${base}.dump.age`,
    checksum: `${base}.dump.age.sha256`,
    manifest: `${base}.manifest.json`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Record and manifest fixtures.
// ─────────────────────────────────────────────────────────────────────────────

function roleEvidence(overrides = {}) {
  return {
    attempted: true,
    observed: 'active_file',
    boundary_code: null,
    termination: 'confirmed',
    bytes: 1000,
    sha256: SHA_A,
    matches_source: true,
    ...overrides,
  }
}

function notAttemptedRole() {
  return {
    attempted: false,
    observed: 'not_observed',
    boundary_code: null,
    termination: 'not_applicable',
    bytes: null,
    sha256: null,
    matches_source: null,
  }
}

function intentFields({ base, attemptId, runId, snapshotTs }) {
  const n = names(base)
  const namespace = `${REMOTE_ROOT}/${base}.${attemptId}`
  return {
    cloud_run_id: runId,
    sequence: 0,
    started_at: '2026-09-21T11:00:00.000Z',
    artifact: { base, ...n },
    source: {
      evidence: 'captured',
      snapshot_ts: snapshotTs,
      run_id: runId,
      ciphertext: { sha256: SHA_A, bytes: 1000 },
      checksum: { sha256: SHA_B, bytes: 100 },
      manifest: { sha256: SHA_C, bytes: 200 },
    },
    remote: {
      root: REMOTE_ROOT,
      namespace,
      ciphertext_path: `${namespace}/${n.ciphertext}`,
      checksum_path: `${namespace}/${n.checksum}`,
      manifest_path: `${namespace}/${n.manifest}`,
    },
    local: {
      source_dir: '/var/eanhl-artifacts',
      ciphertext_path: `/var/eanhl-artifacts/${n.ciphertext}`,
      checksum_path: `/var/eanhl-artifacts/${n.checksum}`,
      manifest_path: `/var/eanhl-artifacts/${n.manifest}`,
    },
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expected_sha512: SHA512_A },
    containment: {
      mechanism: 'rlimit_fsize',
      wrapper_executable: '/usr/bin/prlimit',
      wrapper_expected_sha512: SHA512_B,
      ceilings: { ciphertext: 1_000_000, checksum: 4096, manifest: 65_536 },
    },
    workspace: { planned_path: `/var/eanhl-readback/${base}.${attemptId}` },
    refusal: null,
  }
}

/**
 * `verdict` is one of `verified` | `rejected` | `indeterminate`. `sha` is the
 * readback ciphertext hash — the value binding compares against the manifest.
 */
function attestationFields({
  base,
  attemptId,
  runId,
  snapshotTs,
  verdict = 'verified',
  sha = SHA_A,
}) {
  const n = names(base)
  const namespace = `${REMOTE_ROOT}/${base}.${attemptId}`
  const verified = verdict === 'verified'
  const remote = {
    root: REMOTE_ROOT,
    namespace,
    ciphertext_path: `${namespace}/${n.ciphertext}`,
    checksum_path: `${namespace}/${n.checksum}`,
    manifest_path: `${namespace}/${n.manifest}`,
  }
  const common = {
    cloud_run_id: runId,
    sequence: 0,
    started_at: '2026-09-21T11:00:00.000Z',
    finished_at: '2026-09-21T11:05:00.000Z',
    finish_time_state: 'captured',
    artifact: { base, ...n },
    source_snapshot_ts: snapshotTs,
    source_run_id: runId,
    remote,
    role: null,
    containment: 'valid',
    termination: 'confirmed',
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expected_sha512: SHA512_A },
    cleanup_policy: {
      disposition: 'after_attestation',
      workspace_path: `/var/eanhl-readback/${base}.${attemptId}`,
    },
  }
  if (verified) {
    return {
      ...common,
      verdict: 'verified',
      stage: null,
      code: null,
      upload_transfer_state: 'unknown',
      upload_outcome: { code: null, failed_step: null, boundary_code: null },
      readback: {
        performed: true,
        ciphertext: roleEvidence({ sha256: sha }),
        checksum: roleEvidence({ sha256: SHA_B, bytes: 100 }),
        manifest: roleEvidence({ sha256: SHA_C, bytes: 200 }),
      },
      completion: { checked: true, ok: true },
    }
  }
  const rejected = verdict === 'rejected'
  return {
    ...common,
    verdict: rejected ? 'rejected' : 'indeterminate',
    stage: 'upload',
    code: rejected ? 'provider_rejected' : 'provider_indeterminate',
    upload_transfer_state: rejected ? 'definitely_zero' : 'unknown',
    upload_outcome: {
      code: rejected ? 'provider_rejected' : 'provider_indeterminate',
      failed_step: 'upload_ciphertext',
      boundary_code: null,
    },
    readback: {
      performed: false,
      ciphertext: notAttemptedRole(),
      checksum: notAttemptedRole(),
      manifest: notAttemptedRole(),
    },
    completion: { checked: false, ok: null },
  }
}

/** Write a real intent + attestation pair through the production record writer. */
function putAttestation(sb, opts) {
  const config = configFor(sb)
  const session = records.establishAttemptRecordSession({
    config,
    artifactBase: opts.base,
    attemptId: opts.attemptId,
  })
  records.writeAttemptIntent({ session, intentFields: intentFields(opts) })
  return records.writeAttemptAttestation({ session, attestationFields: attestationFields(opts) })
}

function manifestFor({ base, runId, snapshotTs, sha = SHA_A, bytes = 1000 }) {
  return {
    schema_version: 1,
    artifact: names(base).ciphertext,
    run_id: runId,
    snapshot_ts: snapshotTs,
    produced_at: '2026-09-21T11:00:00.000Z',
    source: { host: 'hotel-echo', container: 'db', database: 'eanhl' },
    plaintext: { sha256: SHA_B, bytes: 4000 },
    ciphertext: { sha256: sha, bytes },
    counts_snapshot: true,
    counts: {},
    warnings: [],
  }
}

function putManifest(sb, manifest, { base, mode = 0o600, text = null } = {}) {
  const target = path.join(sb.sourceDir, names(base ?? 'x').manifest)
  fs.writeFileSync(target, text ?? `${JSON.stringify(manifest, null, 2)}\n`, { mode })
  fs.chmodSync(target, mode)
  return target
}

/**
 * The common fixture: one base, one verified attestation, one matching
 * manifest. Returns everything a test may want to perturb.
 */
function seedVerified(sb, { ageMs = HOUR, n = 1, sha = SHA_A } = {}) {
  const snapshotMs = NOW_MS - ageMs
  const base = baseAt(snapshotMs)
  const snapshotTs = isoOf(snapshotMs)
  const runId = runIdAt(snapshotMs, n)
  const attemptId = attemptIdAt(snapshotMs + 60_000, n)
  putAttestation(sb, { base, attemptId, runId, snapshotTs, sha })
  putManifest(sb, manifestFor({ base, runId, snapshotTs, sha }), { base })
  return { base, attemptId, runId, snapshotTs, snapshotMs, sha }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator construction.
// ─────────────────────────────────────────────────────────────────────────────

/** A real-filesystem evaluator with a FIXED clock, so age boundaries are exact. */
function evaluatorAt(nowMs = NOW_MS, overrides = {}) {
  return makeCloudFreshness({ ...REAL_FRESHNESS_DEPS, now: () => nowMs, ...overrides })
}

function evaluate(sb, { nowMs = NOW_MS, overrides = {}, config = null } = {}) {
  return evaluatorAt(nowMs, overrides).evaluateCloudFreshness({ config: config ?? configFor(sb) })
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture self-check — if these fail, every later assertion is meaningless.
// ─────────────────────────────────────────────────────────────────────────────

test('fixture: a verified attestation, its manifest, and a clean evaluation', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const signal = evaluate(sb)
  assert.equal(signal.status, 'fresh')
  assert.equal(signal.newest_verified_source_snapshot_ts, seed.snapshotTs)
  assert.equal(signal.age_seconds, 3600)
  assert.deepEqual(signal.anomalies, [])
  assert.equal(signal.scan, 'complete')
  assert.equal(signal.counts.binding_valid, 1)
})

test('fixture: rejected and indeterminate attestations are writable and readable', () => {
  const sb = sandbox()
  const snapshotMs = NOW_MS - HOUR
  const base = baseAt(snapshotMs)
  const common = { base, runId: runIdAt(snapshotMs), snapshotTs: isoOf(snapshotMs) }
  const a = putAttestation(sb, {
    ...common,
    attemptId: attemptIdAt(snapshotMs, 1),
    verdict: 'rejected',
  })
  const b = putAttestation(sb, {
    ...common,
    attemptId: attemptIdAt(snapshotMs, 2),
    verdict: 'indeterminate',
  })
  assert.equal(a.attestation.verdict, 'rejected')
  assert.equal(b.attestation.verdict, 'indeterminate')
})

// ─────────────────────────────────────────────────────────────────────────────
// validateCloudAttestationBinding — pure, and NOT validateReceiptBinding.
// ─────────────────────────────────────────────────────────────────────────────

const SNAP_MS = NOW_MS - HOUR
const SNAP_TS = isoOf(SNAP_MS)
const SNAP_BASE = baseAt(SNAP_MS)
const SNAP_RUN = runIdAt(SNAP_MS)

function boundAttestation(overrides = {}) {
  const fields = attestationFields({
    base: SNAP_BASE,
    attemptId: attemptIdAt(SNAP_MS),
    runId: SNAP_RUN,
    snapshotTs: SNAP_TS,
  })
  return {
    kind: 'eanhl.cloud-attestation',
    schema_version: 1,
    attempt_id: attemptIdAt(SNAP_MS),
    ...fields,
    ...overrides,
  }
}

function boundManifest(overrides = {}) {
  return { ...manifestFor({ base: SNAP_BASE, runId: SNAP_RUN, snapshotTs: SNAP_TS }), ...overrides }
}

const bind = production.validateCloudAttestationBinding

test('binding: a matching attestation and manifest are bound', () => {
  const r = bind(boundAttestation(), boundManifest())
  assert.deepEqual(r.failures, [])
  assert.equal(r.valid, true)
  assert.equal(Object.isFrozen(r), true)
  assert.equal(Object.isFrozen(r.failures), true)
})

test('binding: a REAL destination receipt is refused by the kind discriminator', () => {
  // The receipt carries a matching artifact / ciphertext_sha256 /
  // source_snapshot_ts triple — the very fields §5.3 names — and still fails,
  // because it has no `kind`. This is the separation C11 requires.
  const manifest = boundManifest()
  const receipt = buildReceipt({
    base: SNAP_BASE,
    ciphertextSha256: manifest.ciphertext.sha256,
    ciphertextBytes: manifest.ciphertext.bytes,
    manifest,
    identity: { snapshotTs: SNAP_TS, runId: SNAP_RUN, sourceHost: 'hotel-echo' },
    destinationHost: 'main-pc',
    archivePath: '/srv/archive',
    acceptedAt: isoOf(NOW_MS),
  })
  assert.equal(receipt.artifact, names(SNAP_BASE).ciphertext)
  assert.equal(receipt.ciphertext_sha256, manifest.ciphertext.sha256)
  assert.equal(receipt.source_snapshot_ts, manifest.snapshot_ts)
  assert.equal(receipt.kind, undefined)

  const r = bind(receipt, manifest)
  assert.equal(r.valid, false)
  assert.deepEqual(r.failures, ['not_a_cloud_attestation'])
})

test('binding: a receipt with `kind` bolted on still fails on shape', () => {
  const manifest = boundManifest()
  const receipt = buildReceipt({
    base: SNAP_BASE,
    ciphertextSha256: manifest.ciphertext.sha256,
    ciphertextBytes: manifest.ciphertext.bytes,
    manifest,
    identity: { snapshotTs: SNAP_TS, runId: SNAP_RUN, sourceHost: 'hotel-echo' },
    destinationHost: 'main-pc',
    archivePath: '/srv/archive',
    acceptedAt: isoOf(NOW_MS),
  })
  const r = bind({ ...receipt, kind: 'eanhl.cloud-attestation' }, manifest)
  assert.equal(r.valid, false)
  assert.ok(r.failures.includes('artifact_names_not_derived'))
  assert.ok(r.failures.includes('readback_evidence_absent'))
})

for (const [label, value] of [
  ['null', null],
  ['an array', []],
  ['a string', 'attestation'],
  ['a wrong kind', { kind: 'eanhl.cloud-attempt-intent' }],
]) {
  test(`binding: ${label} is not a cloud attestation`, () => {
    assert.deepEqual(bind(value, boundManifest()).failures, ['not_a_cloud_attestation'])
  })
}

test('binding: a wrong attestation schema_version fails', () => {
  const r = bind(boundAttestation({ schema_version: 2 }), boundManifest())
  assert.ok(r.failures.includes('attestation_schema_version'))
})

for (const [label, manifest] of [
  ['null', null],
  ['an array', []],
  ['a string', 'manifest'],
]) {
  test(`binding: ${label} is not a manifest`, () => {
    assert.deepEqual(bind(boundAttestation(), manifest).failures, ['manifest_not_an_object'])
  })
}

test('binding: a wrong manifest schema_version fails', () => {
  const r = bind(boundAttestation(), boundManifest({ schema_version: 2 }))
  assert.ok(r.failures.includes('manifest_schema_version'))
})

test('binding: attestation names that do not derive from its own base fail', () => {
  const a = boundAttestation()
  const r = bind(
    { ...a, artifact: { ...a.artifact, checksum: 'somethingelse.sha256' } },
    boundManifest(),
  )
  assert.ok(r.failures.includes('artifact_names_not_derived'))
})

test('binding: manifest.artifact naming a different ciphertext fails', () => {
  const r = bind(
    boundAttestation(),
    boundManifest({ artifact: 'eanhl-other-20260101T000000Z.dump.age' }),
  )
  assert.ok(r.failures.includes('artifact_name_mismatch'))
})

for (const [label, role] of [
  ['not observed as an active file', roleEvidence({ observed: 'other' })],
  ['not matching its source', roleEvidence({ matches_source: false })],
  ['carrying a non-hex hash', roleEvidence({ sha256: 'nope' })],
  ['carrying a null hash', roleEvidence({ sha256: null, matches_source: null })],
]) {
  test(`binding: readback evidence ${label} is absent evidence`, () => {
    const a = boundAttestation()
    const r = bind({ ...a, readback: { ...a.readback, ciphertext: role } }, boundManifest())
    assert.ok(r.failures.includes('readback_evidence_absent'))
    assert.equal(r.valid, false)
  })
}

test('binding: a readback hash that differs from the manifest fails', () => {
  const a = boundAttestation()
  const r = bind(
    { ...a, readback: { ...a.readback, ciphertext: roleEvidence({ sha256: SHA_C }) } },
    boundManifest(),
  )
  assert.deepEqual(r.failures, ['ciphertext_sha256_mismatch'])
})

test('binding: a manifest ciphertext hash that is not 64 hex fails', () => {
  const r = bind(boundAttestation(), boundManifest({ ciphertext: { sha256: 'short', bytes: 1 } }))
  assert.ok(r.failures.includes('ciphertext_sha256_mismatch'))
})

test('binding: a source_snapshot_ts that differs from the manifest fails', () => {
  const r = bind(
    boundAttestation({ source_snapshot_ts: isoOf(NOW_MS - 2 * HOUR) }),
    boundManifest(),
  )
  assert.ok(r.failures.includes('source_snapshot_ts_mismatch'))
})

test('binding: a manifest snapshot_ts that does not compact to the base stamp fails', () => {
  const other = isoOf(NOW_MS - 48 * HOUR)
  const r = bind(
    boundAttestation({ source_snapshot_ts: other }),
    boundManifest({ snapshot_ts: other }),
  )
  assert.ok(r.failures.includes('snapshot_stamp_mismatch'))
})

test('binding: a source_run_id that differs from the manifest fails (the E3J7 strengthening)', () => {
  const r = bind(boundAttestation(), boundManifest({ run_id: runIdAt(SNAP_MS, 99) }))
  assert.deepEqual(r.failures, ['source_run_id_mismatch'])
})

test('binding: every failure code is a member of the closed vocabulary', () => {
  const cases = [
    bind(null, null),
    bind(boundAttestation({ schema_version: 9 }), boundManifest({ schema_version: 9 })),
    bind(boundAttestation({ source_snapshot_ts: 'x' }), boundManifest({ run_id: 'x' })),
    bind(boundAttestation({ artifact: { base: 'nope' } }), boundManifest()),
  ]
  for (const r of cases) {
    assert.ok(r.failures.length > 0)
    for (const code of r.failures) {
      assert.ok(production.CLOUD_BINDING_FAILURE_CODES.includes(code), code)
      // Closed codes, never interpolated text: no value can leak into a signal.
      assert.match(code, /^[a-z0-9_]+$/)
    }
    assert.equal(new Set(r.failures).size, r.failures.length)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// T21 — freshness advances ONLY from verified AND binding-valid attestations.
// ─────────────────────────────────────────────────────────────────────────────

test('T21: a rejected attestation never advances freshness', () => {
  const sb = sandbox()
  const snapshotMs = NOW_MS - HOUR
  const base = baseAt(snapshotMs)
  const runId = runIdAt(snapshotMs)
  const snapshotTs = isoOf(snapshotMs)
  putAttestation(sb, {
    base,
    attemptId: attemptIdAt(snapshotMs),
    runId,
    snapshotTs,
    verdict: 'rejected',
  })
  putManifest(sb, manifestFor({ base, runId, snapshotTs }), { base })

  const signal = evaluate(sb)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(signal.newest_verified_source_snapshot_ts, null)
  assert.equal(signal.age_seconds, null)
  assert.equal(signal.counts.rejected, 1)
  assert.equal(signal.counts.verified, 0)
})

test('T21: an indeterminate attestation never advances freshness', () => {
  const sb = sandbox()
  const snapshotMs = NOW_MS - HOUR
  const base = baseAt(snapshotMs)
  const runId = runIdAt(snapshotMs)
  const snapshotTs = isoOf(snapshotMs)
  putAttestation(sb, {
    base,
    attemptId: attemptIdAt(snapshotMs),
    runId,
    snapshotTs,
    verdict: 'indeterminate',
  })
  putManifest(sb, manifestFor({ base, runId, snapshotTs }), { base })

  const signal = evaluate(sb)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(signal.counts.indeterminate_verdict, 1)
})

test('T21: a binding-invalid verified attestation never advances freshness', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  // Replace the manifest with one whose ciphertext hash disagrees.
  putManifest(
    sb,
    manifestFor({ base: seed.base, runId: seed.runId, snapshotTs: seed.snapshotTs, sha: SHA_C }),
    { base: seed.base },
  )
  const signal = evaluate(sb)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(signal.counts.verified, 1)
  assert.equal(signal.counts.binding_valid, 0)
  assert.equal(signal.counts.binding_invalid, 1)
  assert.ok(signal.anomalies.includes('binding_invalid'))
  assert.ok(signal.anomalies.includes('verified_binding_invalid'))
})

test('T21: a re-delivered OLDER artifact never raises the maximum', () => {
  const sb = sandbox()
  const recent = seedVerified(sb, { ageMs: 2 * HOUR, n: 1 })
  const old = seedVerified(sb, { ageMs: 30 * HOUR, n: 2 })

  // The redelivery: a BRAND NEW attempt id (so it sorts last and is the most
  // recently written record) against the OLD base and its OLD snapshot_ts.
  putAttestation(sb, {
    base: old.base,
    attemptId: attemptIdAt(NOW_MS - 60_000, 7),
    runId: old.runId,
    snapshotTs: old.snapshotTs,
  })

  const signal = evaluate(sb)
  assert.equal(signal.newest_verified_source_snapshot_ts, recent.snapshotTs)
  assert.equal(signal.age_seconds, 2 * 3600)
  assert.equal(signal.status, 'fresh')
  assert.equal(signal.counts.binding_valid, 3)
})

test('T21: the maximum is taken across bases, not the last one read', () => {
  const sb = sandbox()
  const a = seedVerified(sb, { ageMs: 40 * HOUR, n: 1 })
  const b = seedVerified(sb, { ageMs: 3 * HOUR, n: 2 })
  const c = seedVerified(sb, { ageMs: 100 * HOUR, n: 3 })
  assert.notEqual(a.base, b.base)
  assert.notEqual(b.base, c.base)
  const signal = evaluate(sb)
  assert.equal(signal.newest_verified_source_snapshot_ts, b.snapshotTs)
  assert.equal(signal.status, 'fresh')
})

// ─────────────────────────────────────────────────────────────────────────────
// Per-record exclusion, NOT per-base poisoning.
// ─────────────────────────────────────────────────────────────────────────────

test('exclusion: a sibling binding-invalid attempt does not disqualify a valid one on the SAME base', () => {
  const sb = sandbox()
  const snapshotMs = NOW_MS - HOUR
  const base = baseAt(snapshotMs)
  const runId = runIdAt(snapshotMs)
  const snapshotTs = isoOf(snapshotMs)

  // Attempt 1: verified, but its readback hash is NOT the manifest's — a bad
  // attempt, exactly what bounded retry (T18) exists to survive.
  putAttestation(sb, { base, attemptId: attemptIdAt(snapshotMs, 1), runId, snapshotTs, sha: SHA_C })
  // Attempt 2: the clean retry under the same base.
  putAttestation(sb, { base, attemptId: attemptIdAt(snapshotMs, 2), runId, snapshotTs, sha: SHA_A })
  putManifest(sb, manifestFor({ base, runId, snapshotTs, sha: SHA_A }), { base })

  const signal = evaluate(sb)
  assert.equal(signal.status, 'fresh')
  assert.equal(signal.newest_verified_source_snapshot_ts, snapshotTs)
  assert.equal(signal.counts.verified, 2)
  assert.equal(signal.counts.binding_valid, 1)
  assert.equal(signal.counts.binding_invalid, 1)
  // The anomaly is raised and is INFORMATIONAL: it did not change the number.
  assert.ok(signal.anomalies.includes('verified_binding_invalid'))
})

test('exclusion: divergent readback hashes on one base — the matching record still counts', () => {
  const sb = sandbox()
  const snapshotMs = NOW_MS - 10 * HOUR
  const base = baseAt(snapshotMs)
  const runId = runIdAt(snapshotMs)
  const snapshotTs = isoOf(snapshotMs)
  putAttestation(sb, { base, attemptId: attemptIdAt(snapshotMs, 1), runId, snapshotTs, sha: SHA_B })
  putAttestation(sb, { base, attemptId: attemptIdAt(snapshotMs, 2), runId, snapshotTs, sha: SHA_C })
  putAttestation(sb, { base, attemptId: attemptIdAt(snapshotMs, 3), runId, snapshotTs, sha: SHA_A })
  putManifest(sb, manifestFor({ base, runId, snapshotTs, sha: SHA_A }), { base })

  const signal = evaluate(sb)
  // At most one of three divergent hashes can match the immutable manifest;
  // the other two are excluded per-record and the survivor is still anchored.
  assert.equal(signal.status, 'warning')
  assert.equal(signal.counts.binding_valid, 1)
  assert.equal(signal.counts.binding_invalid, 2)
})

test('exclusion: a base whose ONLY verified record is binding-invalid contributes nothing', () => {
  const sb = sandbox()
  const good = seedVerified(sb, { ageMs: 30 * HOUR, n: 1 })
  const bad = seedVerified(sb, { ageMs: 1 * HOUR, n: 2 })
  putManifest(
    sb,
    manifestFor({ base: bad.base, runId: bad.runId, snapshotTs: bad.snapshotTs, sha: SHA_C }),
    { base: bad.base },
  )
  const signal = evaluate(sb)
  assert.equal(signal.newest_verified_source_snapshot_ts, good.snapshotTs)
  assert.equal(signal.status, 'critical')
})

test('exclusion: the signal has no base-level state at all', () => {
  const sb = sandbox()
  seedVerified(sb)
  const signal = evaluate(sb)
  assert.equal('conflicted_bases' in signal.counts, false)
  assert.deepEqual(Object.keys(signal.counts).sort(), [...FRESHNESS_COUNT_KEYS].sort())
  // No identifier of any kind reaches the signal.
  assert.equal(JSON.stringify(signal).includes('eanhl-test-'), false)
})

// ─────────────────────────────────────────────────────────────────────────────
// Empty and no-evidence states — never "fresh".
// ─────────────────────────────────────────────────────────────────────────────

test('no evidence: an empty attestation directory is no_evidence, not fresh', () => {
  const sb = sandbox()
  const signal = evaluate(sb)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(signal.newest_verified_source_snapshot_ts, null)
  assert.equal(signal.age_seconds, null)
  assert.equal(signal.scan, 'complete')
  assert.deepEqual(signal.anomalies, [])
  assert.equal(signal.counts.names_enumerated, 0)
})

test('no evidence: intent records alone are expected company, not an anomaly', () => {
  const sb = sandbox()
  const snapshotMs = NOW_MS - HOUR
  const base = baseAt(snapshotMs)
  const attemptId = attemptIdAt(snapshotMs)
  const session = records.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: base,
    attemptId,
  })
  records.writeAttemptIntent({
    session,
    intentFields: intentFields({
      base,
      attemptId,
      runId: runIdAt(snapshotMs),
      snapshotTs: isoOf(snapshotMs),
    }),
  })

  const signal = evaluate(sb)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(signal.counts.names_enumerated, 1)
  assert.equal(signal.counts.attestations_named, 0)
  assert.equal(signal.counts.name_unrecognized, 0)
  assert.deepEqual(signal.anomalies, [])
})

test('no evidence: unrecognized filenames are counted, flagged, and never read', () => {
  const sb = sandbox()
  for (const name of ['README', 'notes.txt', 'eanhl-test-bad.cloud-attestation.json', '.hidden']) {
    fs.writeFileSync(path.join(sb.attestationDir, name), 'x', { mode: 0o600 })
  }
  const signal = evaluate(sb)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(signal.counts.names_enumerated, 4)
  assert.equal(signal.counts.name_unrecognized, 4)
  assert.equal(signal.counts.considered, 0)
  assert.deepEqual(signal.anomalies, ['record_name_unrecognized'])
})

test('no evidence: a record beyond the lookback window is never considered', () => {
  const sb = sandbox()
  const ageMs = (LOOKBACK_SECONDS + 3600) * 1000
  seedVerified(sb, { ageMs })
  const signal = evaluate(sb)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(signal.counts.attestations_named, 1)
  assert.equal(signal.counts.considered, 0)
  assert.equal(signal.lookback_seconds, LOOKBACK_SECONDS)
})

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds — E1A's approved 8 h / 24 h, exactly.
// ─────────────────────────────────────────────────────────────────────────────

test('thresholds: one second under 8 hours is still fresh', () => {
  const sb = sandbox()
  const seed = seedVerified(sb, { ageMs: WARNING_AFTER_SECONDS * 1000 - 1000 })
  const signal = evaluate(sb)
  assert.equal(signal.age_seconds, WARNING_AFTER_SECONDS - 1)
  assert.equal(signal.status, 'fresh')
  assert.equal(signal.newest_verified_source_snapshot_ts, seed.snapshotTs)
})

test('thresholds: exactly 8 hours is a warning (E1A: "newer than 8 hours")', () => {
  const sb = sandbox()
  seedVerified(sb, { ageMs: WARNING_AFTER_SECONDS * 1000 })
  const signal = evaluate(sb)
  assert.equal(signal.age_seconds, WARNING_AFTER_SECONDS)
  assert.equal(signal.status, 'warning')
})

test('thresholds: one second under 24 hours is still a warning', () => {
  const sb = sandbox()
  seedVerified(sb, { ageMs: CRITICAL_AFTER_SECONDS * 1000 - 1000 })
  assert.equal(evaluate(sb).status, 'warning')
})

test('thresholds: exactly 24 hours is critical', () => {
  const sb = sandbox()
  seedVerified(sb, { ageMs: CRITICAL_AFTER_SECONDS * 1000 })
  const signal = evaluate(sb)
  assert.equal(signal.age_seconds, CRITICAL_AFTER_SECONDS)
  assert.equal(signal.status, 'critical')
})

test('thresholds: the approved values are reported in the signal and are not configurable', () => {
  const sb = sandbox()
  const signal = evaluate(sb)
  assert.equal(signal.thresholds.warning_after_seconds, 8 * 3600)
  assert.equal(signal.thresholds.critical_after_seconds, 24 * 3600)
  assert.equal(WARNING_AFTER_SECONDS, 28800)
  assert.equal(CRITICAL_AFTER_SECONDS, 86400)
})

// ─────────────────────────────────────────────────────────────────────────────
// Clock.
// ─────────────────────────────────────────────────────────────────────────────

for (const [label, now] of [
  ['NaN', () => Number.NaN],
  ['Infinity', () => Number.POSITIVE_INFINITY],
  ['a non-integer', () => 1.5],
  ['a string', () => '2026-09-21T12:00:00.000Z'],
  ['out of Date range', () => 8.7e15],
  [
    'a thrown error',
    () => {
      throw new Error('no clock')
    },
  ],
]) {
  test(`clock: ${label} yields indeterminate, never a number`, () => {
    const sb = sandbox()
    seedVerified(sb)
    const signal = evaluatorAt(NOW_MS, { now }).evaluateCloudFreshness({ config: configFor(sb) })
    assert.equal(signal.status, 'indeterminate')
    assert.deepEqual(signal.anomalies, ['clock_unusable'])
    assert.equal(signal.generated_at, null)
    assert.equal(signal.newest_verified_source_snapshot_ts, null)
    assert.equal(signal.age_seconds, null)
  })
}

test('clock: a future-dated base stamp is excluded and flagged', () => {
  const sb = sandbox()
  const good = seedVerified(sb, { ageMs: 5 * HOUR, n: 1 })
  seedVerified(sb, { ageMs: -2 * HOUR, n: 2 })
  const signal = evaluate(sb)
  assert.equal(signal.newest_verified_source_snapshot_ts, good.snapshotTs)
  assert.equal(signal.counts.future_dated, 1)
  assert.ok(signal.anomalies.includes('snapshot_ts_in_future'))
  // The future record was never read.
  assert.equal(signal.counts.considered, 1)
})

test('clock: a future-dated record cannot make the signal look fresher', () => {
  const sb = sandbox()
  seedVerified(sb, { ageMs: 30 * HOUR, n: 1 })
  seedVerified(sb, { ageMs: -HOUR, n: 2 })
  const signal = evaluate(sb)
  assert.equal(signal.status, 'critical')
})

// ─────────────────────────────────────────────────────────────────────────────
// Bounded STREAMING enumeration. A synthetic directory handle is used so the
// 20000-entry ceiling is proven exactly, without creating 20000 files — and so
// the number of readSync() calls can be counted.
// ─────────────────────────────────────────────────────────────────────────────

/** A handle that yields `names` and then `null`. Counts reads; can fault. */
function fakeHandle(names, { throwAtRead = null, closeThrows = false } = {}) {
  let i = 0
  const state = { reads: 0, closed: 0 }
  const handle = {
    readSync() {
      state.reads++
      if (throwAtRead !== null && state.reads === throwAtRead) throw new Error('readdir failed')
      return i < names.length ? { name: names[i++] } : null
    },
    closeSync() {
      state.closed++
      if (closeThrows) throw new Error('close failed')
    },
  }
  return { handle, state }
}

/** A handle that NEVER ends: only the ceiling can stop the loop. */
function endlessHandle() {
  const state = { reads: 0, closed: 0 }
  const handle = {
    readSync() {
      state.reads++
      return { name: `unrelated-${state.reads}.txt` }
    },
    closeSync() {
      state.closed++
    },
  }
  return { handle, state }
}

test('bounds: an endless directory stops at exactly MAX_DIRECTORY_ENTRIES + 1 reads', () => {
  const sb = sandbox()
  const { handle, state } = endlessHandle()
  const signal = evaluatorAt(NOW_MS, { opendir: () => handle }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  // The extra read IS the detection: one past the ceiling, then stop.
  assert.equal(state.reads, MAX_DIRECTORY_ENTRIES + 1)
  assert.equal(signal.counts.names_enumerated, MAX_DIRECTORY_ENTRIES + 1)
  assert.equal(signal.scan, 'truncated')
  assert.equal(signal.status, 'indeterminate')
  assert.ok(signal.anomalies.includes('scan_truncated'))
  assert.equal(state.closed, 1)
})

test('bounds: exactly MAX_DIRECTORY_ENTRIES entries enumerate completely', () => {
  const sb = sandbox()
  const names = Array.from({ length: MAX_DIRECTORY_ENTRIES }, (_, i) => `unrelated-${i}.txt`)
  const { handle, state } = fakeHandle(names)
  const signal = evaluatorAt(NOW_MS, { opendir: () => handle }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  assert.equal(signal.scan, 'complete')
  assert.equal(signal.counts.names_enumerated, MAX_DIRECTORY_ENTRIES)
  assert.equal(signal.status, 'no_evidence')
  // MAX reads returning entries, plus the one that returns null.
  assert.equal(state.reads, MAX_DIRECTORY_ENTRIES + 1)
})

test('bounds: more than MAX_ATTESTATIONS_READ candidates truncates', () => {
  const sb = sandbox()
  const base = baseAt(NOW_MS - HOUR)
  const names = Array.from(
    { length: MAX_ATTESTATIONS_READ + 1 },
    (_, i) => `${base}.${attemptIdAt(NOW_MS - HOUR, i + 1)}.cloud-attestation.json`,
  )
  const { handle } = fakeHandle(names)
  const signal = evaluatorAt(NOW_MS, {
    opendir: () => handle,
    readAttestation: () => {
      throw new Error('must not be reached')
    },
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.scan, 'truncated')
  assert.equal(signal.status, 'indeterminate')
  assert.equal(signal.counts.considered, 0)
})

test('bounds: a truncated scan yields NO freshness value even with a valid record present', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const good = `${seed.base}.${seed.attemptId}.cloud-attestation.json`
  // The genuinely-verified record is seen FIRST, then the ceiling is breached.
  const names = [good, ...Array.from({ length: MAX_DIRECTORY_ENTRIES }, (_, i) => `pad-${i}.txt`)]
  const { handle } = fakeHandle(names)
  const signal = evaluatorAt(NOW_MS, { opendir: () => handle }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  assert.equal(signal.scan, 'truncated')
  assert.equal(signal.status, 'indeterminate')
  assert.equal(signal.newest_verified_source_snapshot_ts, null)
  assert.equal(signal.age_seconds, null)
  assert.equal(signal.counts.considered, 0)
})

test('bounds: a readSync failure is listing_failed and indeterminate', () => {
  const sb = sandbox()
  seedVerified(sb)
  const { handle, state } = fakeHandle(['a.txt', 'b.txt'], { throwAtRead: 2 })
  const signal = evaluatorAt(NOW_MS, { opendir: () => handle }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  assert.equal(signal.scan, 'unreadable')
  assert.equal(signal.status, 'indeterminate')
  // `a.txt` was enumerated before the fault, so its per-record anomaly stands
  // alongside the fatal one; only the fatal one decides the status.
  assert.ok(signal.anomalies.includes('listing_failed'))
  assert.equal(signal.newest_verified_source_snapshot_ts, null)
  // The handle is still closed on the failure path.
  assert.equal(state.closed, 1)
})

test('bounds: a closeSync failure fails the enumeration', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const { handle } = fakeHandle([`${seed.base}.${seed.attemptId}.cloud-attestation.json`], {
    closeThrows: true,
  })
  const signal = evaluatorAt(NOW_MS, { opendir: () => handle }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  assert.equal(signal.scan, 'unreadable')
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['listing_failed'])
})

test('bounds: an opendir failure is listing_failed, not an empty directory', () => {
  const sb = sandbox()
  const signal = evaluatorAt(NOW_MS, {
    opendir: () => {
      throw new Error('EACCES')
    },
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.scan, 'unreadable')
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['listing_failed'])
})

test('bounds: an opendir result without readSync is refused', () => {
  const sb = sandbox()
  const signal = evaluatorAt(NOW_MS, { opendir: () => ({}) }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['listing_failed'])
})

// ─────────────────────────────────────────────────────────────────────────────
// Directory trust and identity.
// ─────────────────────────────────────────────────────────────────────────────

test('dirs: a missing attestation directory is untrusted and indeterminate', () => {
  const sb = sandbox()
  const cfg = configFor(sb)
  cfg.attestation.dir = path.join(sb.dir, 'does-not-exist')
  const signal = evaluate(sb, { config: cfg })
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['attestation_dir_untrusted'])
  assert.equal(signal.scan, 'unreadable')
})

test('dirs: a group-readable attestation directory is untrusted (owner-only is required there)', () => {
  const sb = sandbox()
  seedVerified(sb)
  fs.chmodSync(sb.attestationDir, 0o750)
  const signal = evaluate(sb)
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['attestation_dir_untrusted'])
})

test('dirs: a 0755 source directory is ACCEPTED — the producer creates it umask-derived', () => {
  // Regression for the finding that drove `observeReadableSourceDirIdentity`:
  // `backup-producer.mjs` does `mkdirSync(destination.dir, {recursive: true})`
  // with no mode, so requiring owner-only bits here would refuse every real
  // deployment. Only WRITABILITY by others is disqualifying.
  const sb = sandbox({ sourceMode: 0o755 })
  seedVerified(sb)
  assert.equal(fs.statSync(sb.sourceDir).mode & 0o777, 0o755)
  const signal = evaluate(sb)
  assert.equal(signal.status, 'fresh')
})

for (const mode of [0o777, 0o757, 0o775]) {
  test(`dirs: a source directory writable by others (0${mode.toString(8)}) is untrusted`, () => {
    const sb = sandbox()
    seedVerified(sb)
    fs.chmodSync(sb.sourceDir, mode)
    const signal = evaluate(sb)
    assert.equal(signal.status, 'indeterminate')
    assert.deepEqual(signal.anomalies, ['source_dir_untrusted'])
  })
}

test('dirs: a symlinked source directory is untrusted', () => {
  const sb = sandbox()
  seedVerified(sb)
  const link = path.join(sb.dir, 'link-artifacts')
  fs.symlinkSync(sb.sourceDir, link)
  const cfg = configFor(sb)
  cfg.artifact.sourceDir = link
  const signal = evaluate(sb, { config: cfg })
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['source_dir_untrusted'])
})

test('dirs: observeReadableSourceDirIdentity refuses a file, a symlink and a missing path', () => {
  const sb = sandbox()
  const file = path.join(sb.dir, 'a-file')
  fs.writeFileSync(file, 'x', { mode: 0o600 })
  const link = path.join(sb.dir, 'a-link')
  fs.symlinkSync(sb.sourceDir, link)
  for (const p of [file, link, path.join(sb.dir, 'nope')]) {
    assert.equal(observeReadableSourceDirIdentity(p, REAL_FRESHNESS_DEPS), null)
  }
  assert.notEqual(observeReadableSourceDirIdentity(sb.sourceDir, REAL_FRESHNESS_DEPS), null)
})

test('dirs: an attestation directory that changes mid-evaluation is indeterminate', () => {
  const sb = sandbox()
  seedVerified(sb)
  // The reader itself reports the change; the evaluator must escalate it to
  // evaluation-wide rather than counting it as one unreadable record.
  const signal = evaluatorAt(NOW_MS, {
    readAttestation: () => {
      throw new BackupError('attestation_dir_untrusted', 'changed')
    },
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.status, 'indeterminate')
  assert.ok(signal.anomalies.includes('attestation_dir_changed'))
  assert.equal(signal.newest_verified_source_snapshot_ts, null)
})

test('dirs: a source directory that changes mid-evaluation is indeterminate', () => {
  const sb = sandbox()
  seedVerified(sb)
  let calls = 0
  const signal = evaluatorAt(NOW_MS, {
    // Flip the observed mode once the manifest read has happened.
    lstat: (p) => {
      const st = fs.lstatSync(p, { bigint: true })
      if (p === sb.sourceDir && ++calls > 1) {
        return { ...stProxy(st), mode: st.mode | 0o002n }
      }
      return st
    },
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.status, 'indeterminate')
  assert.ok(signal.anomalies.includes('source_dir_changed'))
  assert.equal(signal.newest_verified_source_snapshot_ts, null)
})

/** A plain object that keeps the bigint fields and the two predicates a stat needs. */
function stProxy(st) {
  return {
    dev: st.dev,
    ino: st.ino,
    uid: st.uid,
    mode: st.mode,
    size: st.size,
    isSymbolicLink: () => st.isSymbolicLink(),
    isDirectory: () => st.isDirectory(),
    isFile: () => st.isFile(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Malformed and hostile records — counted, never eligible, never fatal.
// ─────────────────────────────────────────────────────────────────────────────

function attestationPath(sb, base, attemptId) {
  return path.join(sb.attestationDir, `${base}.${attemptId}.cloud-attestation.json`)
}

test('records: truncated JSON is unreadable and does not break the evaluation', () => {
  const sb = sandbox()
  const good = seedVerified(sb, { ageMs: 2 * HOUR, n: 1 })
  const bad = seedVerified(sb, { ageMs: 1 * HOUR, n: 2 })
  const p = attestationPath(sb, bad.base, bad.attemptId)
  fs.writeFileSync(p, '{"kind":"eanhl.cloud-atte', { mode: 0o600 })

  const signal = evaluate(sb)
  assert.equal(signal.counts.unreadable, 1)
  assert.ok(signal.anomalies.includes('record_unreadable'))
  // The good record still sets the number: one junk file never breaks the signal.
  assert.equal(signal.newest_verified_source_snapshot_ts, good.snapshotTs)
  assert.equal(signal.status, 'fresh')
})

test('records: a schema-invalid record is counted separately and never advances', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const p = attestationPath(sb, seed.base, seed.attemptId)
  const record = JSON.parse(fs.readFileSync(p, 'utf8'))
  record.verdict = 'not-a-verdict'
  fs.writeFileSync(p, JSON.stringify(record), { mode: 0o600 })

  const signal = evaluate(sb)
  assert.equal(signal.counts.schema_invalid, 1)
  assert.ok(signal.anomalies.includes('record_schema_invalid'))
  assert.equal(signal.status, 'no_evidence')
})

test('records: a record over the 16 KiB reader ceiling is unreadable', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const p = attestationPath(sb, seed.base, seed.attemptId)
  fs.writeFileSync(p, `${' '.repeat(17 * 1024)}{}`, { mode: 0o600 })
  const signal = evaluate(sb)
  assert.equal(signal.counts.unreadable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('records: a symlink in place of a record is unreadable', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const p = attestationPath(sb, seed.base, seed.attemptId)
  const real = path.join(sb.dir, 'elsewhere.json')
  fs.copyFileSync(p, real)
  fs.rmSync(p)
  fs.symlinkSync(real, p)
  const signal = evaluate(sb)
  assert.equal(signal.counts.unreadable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('records: a record with group/world bits is unreadable', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  fs.chmodSync(attestationPath(sb, seed.base, seed.attemptId), 0o644)
  const signal = evaluate(sb)
  assert.equal(signal.counts.unreadable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('records: a record that vanishes between listing and read is unreadable, not fatal', () => {
  const sb = sandbox()
  const good = seedVerified(sb, { ageMs: 3 * HOUR, n: 1 })
  // The real race: the name was in the listing, and the file is gone by the
  // time the reader opens it. A synthetic listing reproduces it exactly.
  const ghostBase = baseAt(NOW_MS - HOUR)
  const { handle } = fakeHandle([
    `${good.base}.${good.attemptId}.cloud-attestation.json`,
    `${ghostBase}.${attemptIdAt(NOW_MS - HOUR, 9)}.cloud-attestation.json`,
  ])
  const signal = evaluatorAt(NOW_MS, { opendir: () => handle }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  assert.equal(signal.counts.considered, 2)
  assert.equal(signal.counts.unreadable, 1)
  assert.ok(signal.anomalies.includes('record_unreadable'))
  assert.equal(signal.newest_verified_source_snapshot_ts, good.snapshotTs)
  assert.equal(signal.status, 'fresh')
})

// ─────────────────────────────────────────────────────────────────────────────
// The bounded, fail-closed local manifest read.
// ─────────────────────────────────────────────────────────────────────────────

function manifestPath(sb, base) {
  return path.join(sb.sourceDir, names(base).manifest)
}

test('manifest: a missing manifest is manifest_unavailable, not a binding failure', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  fs.rmSync(manifestPath(sb, seed.base))
  const signal = evaluate(sb)
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.counts.binding_invalid, 0)
  assert.ok(signal.anomalies.includes('manifest_unavailable'))
  assert.equal(signal.status, 'no_evidence')
})

test('manifest: the effective ceiling is min(config, fixed) — the CONFIG value can bind', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const cfg = configFor(sb, { readback: { maxManifestBytes: 512 } })
  cfg.readback.maxManifestBytes = 512
  assert.ok(fs.statSync(manifestPath(sb, seed.base)).size > 512)
  const signal = evaluate(sb, { config: cfg })
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('manifest: the effective ceiling is min(config, fixed) — the FIXED value can bind', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  // Config permits far more than the fixed ceiling; the fixed one still wins.
  const cfg = configFor(sb)
  cfg.readback.maxManifestBytes = 64 * 1024 * 1024
  const manifest = manifestFor({ base: seed.base, runId: seed.runId, snapshotTs: seed.snapshotTs })
  manifest.warnings = ['x'.repeat(LOCAL_MANIFEST_CEILING_BYTES + 4096)]
  putManifest(sb, manifest, { base: seed.base })
  assert.ok(fs.statSync(manifestPath(sb, seed.base)).size > LOCAL_MANIFEST_CEILING_BYTES)

  const signal = evaluate(sb, { config: cfg })
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('manifest: a manifest just under the ceiling is still read', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const cfg = configFor(sb)
  cfg.readback.maxManifestBytes = 4096
  const manifest = manifestFor({ base: seed.base, runId: seed.runId, snapshotTs: seed.snapshotTs })
  let text = `${JSON.stringify(manifest)}\n`
  manifest.warnings = ['y'.repeat(4096 - text.length - 20)]
  text = `${JSON.stringify(manifest)}\n`
  assert.ok(text.length <= 4096, `fixture too large: ${text.length}`)
  putManifest(sb, manifest, { base: seed.base, text })
  const signal = evaluate(sb, { config: cfg })
  assert.equal(signal.status, 'fresh')
})

test('manifest: a symlinked manifest is refused at open', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const p = manifestPath(sb, seed.base)
  const real = path.join(sb.dir, 'real-manifest.json')
  fs.copyFileSync(p, real)
  fs.rmSync(p)
  fs.symlinkSync(real, p)
  const signal = evaluate(sb)
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('manifest: a manifest with group/world bits is refused', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  fs.chmodSync(manifestPath(sb, seed.base), 0o644)
  const signal = evaluate(sb)
  assert.equal(signal.counts.manifest_unavailable, 1)
})

test('manifest: a directory in place of the manifest is refused', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const p = manifestPath(sb, seed.base)
  fs.rmSync(p)
  fs.mkdirSync(p, { mode: 0o700 })
  const signal = evaluate(sb)
  assert.equal(signal.counts.manifest_unavailable, 1)
})

test('manifest: a close failure yields no manifest', () => {
  const sb = sandbox()
  seedVerified(sb)
  const signal = evaluatorAt(NOW_MS, {
    close: () => {
      throw new Error('EIO on close')
    },
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('manifest: a read failure yields no manifest', () => {
  const sb = sandbox()
  seedVerified(sb)
  const signal = evaluatorAt(NOW_MS, { read: () => -1 }).evaluateCloudFreshness({
    config: configFor(sb),
  })
  assert.equal(signal.counts.manifest_unavailable, 1)
})

test('manifest: a descriptor whose identity differs from the listed file is refused', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const decoy = path.join(sb.dir, 'decoy.json')
  fs.writeFileSync(decoy, '{}', { mode: 0o600 })
  const signal = evaluatorAt(NOW_MS, {
    // The classic swap: lstat sees the real file, open lands on another inode.
    openFile: (p) => REAL_FRESHNESS_DEPS.openFile(p.endsWith('.manifest.json') ? decoy : p),
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.status, 'no_evidence')
  assert.equal(seed.base.length > 0, true)
})

for (const [label, mutate] of [
  ['invalid JSON', (_m, sb, base) => putManifest(sb, null, { base, text: 'not json' })],
  ['a wrong schema_version', (m) => ({ ...m, schema_version: 7 })],
  [
    'an artifact naming another base',
    (m) => ({ ...m, artifact: 'eanhl-x-20200101T000000Z.dump.age' }),
  ],
  ['a run_id of the wrong shape', (m) => ({ ...m, run_id: 'not-a-run-id' })],
  [
    'a snapshot_ts that does not match the base stamp',
    (m) => ({ ...m, snapshot_ts: '2020-01-01T00:00:00.000Z' }),
  ],
  ['a non-hex ciphertext hash', (m) => ({ ...m, ciphertext: { sha256: 'zz', bytes: 1 } })],
  [
    'a non-integer ciphertext byte count',
    (m) => ({ ...m, ciphertext: { sha256: SHA_A, bytes: 1.5 } }),
  ],
  ['an array instead of an object', () => []],
]) {
  test(`manifest: ${label} is manifest_invalid`, () => {
    const sb = sandbox()
    const seed = seedVerified(sb)
    const original = manifestFor({
      base: seed.base,
      runId: seed.runId,
      snapshotTs: seed.snapshotTs,
    })
    const replacement = mutate(original, sb, seed.base)
    if (replacement !== undefined) putManifest(sb, replacement, { base: seed.base })
    const signal = evaluate(sb)
    assert.equal(signal.counts.manifest_invalid, 1)
    assert.equal(signal.counts.binding_invalid, 0)
    assert.ok(signal.anomalies.includes('manifest_invalid'))
    assert.equal(signal.status, 'no_evidence')
  })
}

test('manifest: one manifest read per base, however many attempts it has', () => {
  const sb = sandbox()
  const snapshotMs = NOW_MS - HOUR
  const base = baseAt(snapshotMs)
  const runId = runIdAt(snapshotMs)
  const snapshotTs = isoOf(snapshotMs)
  for (let i = 1; i <= 4; i++) {
    putAttestation(sb, { base, attemptId: attemptIdAt(snapshotMs, i), runId, snapshotTs })
  }
  putManifest(sb, manifestFor({ base, runId, snapshotTs }), { base })

  let opens = 0
  const signal = evaluatorAt(NOW_MS, {
    openFile: (p) => {
      if (p.endsWith('.manifest.json')) opens++
      return REAL_FRESHNESS_DEPS.openFile(p)
    },
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.counts.verified, 4)
  assert.equal(signal.counts.binding_valid, 4)
  assert.equal(opens, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// The signal contract and secret-safe output.
// ─────────────────────────────────────────────────────────────────────────────

/** A representative spread of signals, one per status. */
function everyKindOfSignal() {
  const out = []
  {
    const sb = sandbox()
    seedVerified(sb, { ageMs: HOUR })
    out.push(evaluate(sb))
  }
  {
    const sb = sandbox()
    seedVerified(sb, { ageMs: 9 * HOUR })
    out.push(evaluate(sb))
  }
  {
    const sb = sandbox()
    seedVerified(sb, { ageMs: 40 * HOUR })
    out.push(evaluate(sb))
  }
  {
    const sb = sandbox()
    out.push(evaluate(sb))
  }
  {
    const sb = sandbox()
    seedVerified(sb)
    out.push(
      evaluatorAt(NOW_MS, { now: () => Number.NaN }).evaluateCloudFreshness({
        config: configFor(sb),
      }),
    )
  }
  {
    // Every per-record anomaly at once.
    const sb = sandbox()
    const a = seedVerified(sb, { ageMs: 2 * HOUR, n: 1 })
    const b = seedVerified(sb, { ageMs: 3 * HOUR, n: 2 })
    const c = seedVerified(sb, { ageMs: 4 * HOUR, n: 3 })
    fs.rmSync(path.join(sb.sourceDir, names(b.base).manifest))
    putManifest(sb, null, { base: c.base, text: 'nonsense' })
    fs.writeFileSync(path.join(sb.attestationDir, 'junk.txt'), 'x', { mode: 0o600 })
    fs.writeFileSync(
      path.join(sb.attestationDir, `${a.base}.${attemptIdAt(NOW_MS, 5)}.cloud-attestation.json`),
      '{',
      { mode: 0o600 },
    )
    seedVerified(sb, { ageMs: -HOUR, n: 6 })
    out.push(evaluate(sb))
  }
  return out
}

test('signal: every produced signal passes its own closed contract', () => {
  for (const signal of everyKindOfSignal()) {
    assert.equal(validateFreshnessSignal(signal), true, JSON.stringify(signal))
    assert.ok(FRESHNESS_STATUSES.includes(signal.status))
    assert.ok(FRESHNESS_SCAN_STATES.includes(signal.scan))
    assert.equal(signal.kind, FRESHNESS_SIGNAL_KIND)
  }
})

test('signal: the statuses seen across the representative spread cover the contract', () => {
  const seen = new Set(everyKindOfSignal().map((s) => s.status))
  for (const status of ['fresh', 'warning', 'critical', 'no_evidence', 'indeterminate']) {
    assert.ok(seen.has(status), `never produced: ${status}`)
  }
})

test('signal: it is deeply frozen', () => {
  const sb = sandbox()
  seedVerified(sb)
  const signal = evaluate(sb)
  for (const target of [signal, signal.counts, signal.thresholds, signal.anomalies]) {
    assert.equal(Object.isFrozen(target), true)
  }
  assert.throws(() => {
    signal.status = 'fresh'
  }, TypeError)
})

test('signal: anomalies are sorted, deduplicated, and all from the closed vocabulary', () => {
  for (const signal of everyKindOfSignal()) {
    const sorted = [...signal.anomalies].sort()
    assert.deepEqual(signal.anomalies, sorted)
    assert.equal(new Set(signal.anomalies).size, signal.anomalies.length)
    for (const code of signal.anomalies) {
      assert.ok(FRESHNESS_ANOMALY_CODES.includes(code), code)
    }
  }
})

test('signal: SECRET SAFETY — every string is an allowlist member or an ISO instant', () => {
  const allowed = new Set([
    FRESHNESS_SIGNAL_KIND,
    ...FRESHNESS_STATUSES,
    ...FRESHNESS_SCAN_STATES,
    ...FRESHNESS_ANOMALY_CODES,
  ])
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
  const walk = (value, at) => {
    if (typeof value === 'string') {
      assert.ok(allowed.has(value) || ISO.test(value), `unexpected string at ${at}: ${value}`)
      return
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return
    assert.equal(typeof value, 'object', `unexpected type at ${at}`)
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${at}[${i}]`))
      return
    }
    for (const [k, v] of Object.entries(value)) {
      assert.match(k, /^[a-z0-9_]+$/, `unexpected key at ${at}: ${k}`)
      walk(v, `${at}.${k}`)
    }
  }
  for (const signal of everyKindOfSignal()) walk(signal, '$')
})

test('signal: SECRET SAFETY — no path, identifier, hash, or forbidden term is serialized', () => {
  for (const signal of everyKindOfSignal()) {
    const text = JSON.stringify(signal)
    assert.equal(text.includes('/'), false, 'a path separator reached the signal')
    assert.equal(text.includes('eanhl-test-'), false, 'an artifact base reached the signal')
    assert.equal(text.includes('.json'), false)
    assert.equal(text.includes('.dump.age'), false)
    assert.equal(text.includes(SHA_A), false)
    assert.equal(text.includes(SHA_B), false)
    assert.equal(text.includes(SHA512_A), false)
    assert.equal(text.includes(os.tmpdir()), false)
    for (const forbidden of [
      'token',
      'secret',
      'password',
      'passphrase',
      'credential',
      'cookie',
      'proton',
      'Error',
      'ENOENT',
      'stack',
      '@',
    ]) {
      assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden)
    }
  }
})

test('signal: the count key set is exact and every count is a non-negative integer', () => {
  for (const signal of everyKindOfSignal()) {
    assert.deepEqual(Object.keys(signal.counts).sort(), [...FRESHNESS_COUNT_KEYS].sort())
    for (const v of Object.values(signal.counts)) {
      assert.ok(Number.isSafeInteger(v) && v >= 0)
    }
  }
})

test('signal: monitored is always false — nothing watches this', () => {
  for (const signal of everyKindOfSignal()) assert.equal(signal.monitored, false)
})

test('signal: a non-indeterminate status never carries a fatal anomaly, and vice versa', () => {
  for (const signal of everyKindOfSignal()) {
    const fatal = signal.anomalies.some((c) => production.FRESHNESS_FATAL_ANOMALY_CODES.includes(c))
    assert.equal(fatal, signal.status === 'indeterminate')
  }
})

test('signal: validateFreshnessSignal rejects tampered shapes', () => {
  const sb = sandbox()
  seedVerified(sb)
  const good = evaluate(sb)
  assert.equal(validateFreshnessSignal(good), true)
  const clone = () => JSON.parse(JSON.stringify(good))
  const mutations = [
    (s) => delete s.monitored,
    (s) => (s.monitored = true),
    (s) => (s.extra = 1),
    (s) => (s.kind = 'eanhl.cloud-attestation'),
    (s) => (s.status = 'ok'),
    (s) => (s.scan = 'partial'),
    (s) => (s.thresholds.warning_after_seconds = 1),
    (s) => (s.lookback_seconds = 1),
    (s) => (s.age_seconds = -1),
    (s) => (s.anomalies = ['not_a_code']),
    (s) => (s.anomalies = ['record_unreadable', 'binding_invalid']),
    (s) => delete s.counts.verified,
    (s) => (s.counts.verified = -1),
    (s) => (s.generated_at = 'yesterday'),
    (s) => (s.newest_verified_source_snapshot_ts = null),
  ]
  for (const mutate of mutations) {
    const s = clone()
    mutate(s)
    assert.equal(validateFreshnessSignal(s), false, JSON.stringify(s).slice(0, 120))
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// The production API surface.
// ─────────────────────────────────────────────────────────────────────────────

test('api: the production evaluator uses the real clock and the real filesystem', () => {
  const sb = sandbox()
  const ageMs = Date.now() - Date.parse('2026-01-01T00:00:00.000Z')
  assert.ok(ageMs > 0)
  const signal = production.evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(validateFreshnessSignal(signal), true)
  assert.equal(signal.status, 'no_evidence')
})

for (const bad of [null, undefined, 'config', 42]) {
  test(`api: ${JSON.stringify(bad) ?? 'undefined'} is refused as arguments`, () => {
    assert.throws(
      () => production.evaluateCloudFreshness(bad),
      (err) => err instanceof BackupError && err.code === 'cloud_freshness_invalid_input',
    )
  })
}

test('api: an invalid config is refused, and a `deps` property is inert', () => {
  const sb = sandbox()
  assert.throws(
    () => production.evaluateCloudFreshness({ config: { nope: true } }),
    (err) => err instanceof BackupError && err.code === 'cloud_freshness_invalid_input',
  )
  const signal = production.evaluateCloudFreshness({
    config: configFor(sb),
    deps: {
      now: () => {
        throw new Error('a caller must not be able to supply this')
      },
    },
  })
  assert.equal(validateFreshnessSignal(signal), true)
})

// ─────────────────────────────────────────────────────────────────────────────
// The entrypoint. Status lives in the JSON; the exit code never encodes it.
// ─────────────────────────────────────────────────────────────────────────────

function harness(overrides = {}) {
  const out = []
  const errs = []
  const entry = makeFreshnessEntrypoint({
    // A stdout writer must AFFIRM a complete write by returning `true`; the
    // entrypoint treats anything else as a failed line.
    writeStdout: (buf) => {
      out.push(buf.toString('utf8'))
      return true
    },
    writeStderr: (buf) => {
      errs.push(buf.toString('utf8'))
      return true
    },
    readConfigFile: (p) => fs.readFileSync(p, 'utf8'),
    evaluateCloudFreshness: ({ config }) => evaluatorAt(NOW_MS).evaluateCloudFreshness({ config }),
    ...overrides,
  })
  return { entry, stdout: () => out.join(''), stderr: () => errs.join('') }
}

function writeConfigFile(sb, config = null) {
  const p = path.join(sb.dir, 'cloud.json')
  fs.writeFileSync(p, JSON.stringify(config ?? configFor(sb), null, 2), { mode: 0o600 })
  return p
}

for (const argv of [
  [],
  ['--config'],
  ['--config', ''],
  ['--config', '/a', '--config', '/b'],
  ['--config', '/a', '--artifact-base', 'x'],
  ['--unknown'],
  ['/a'],
  ['--help', '--config', '/a'],
]) {
  test(`entrypoint: ${JSON.stringify(argv)} is an invalid invocation (exit 2)`, () => {
    const h = harness()
    assert.equal(h.entry.main(argv), 2)
    assert.equal(h.stdout(), '')
    assert.ok(h.stderr().includes('invalid invocation'))
  })
}

test('entrypoint: an invalid invocation never echoes the argument', () => {
  const h = harness()
  h.entry.main(['--config', '/etc/eanhl/secret-looking-path', '--rogue'])
  assert.equal(h.stderr().includes('secret-looking-path'), false)
})

test('entrypoint: a non-array argv is an invalid invocation', () => {
  const h = harness()
  assert.equal(h.entry.main('--config /a'), 2)
})

test('entrypoint: --help prints the usage on stdout and exits 0', () => {
  const h = harness()
  assert.equal(h.entry.main(['--help']), 0)
  assert.equal(h.stdout(), USAGE)
  assert.ok(USAGE.includes('NOT ACTIVATED'))
  assert.ok(USAGE.includes('0 does not mean fresh'))
})

test('entrypoint: a configuration error prints a CLOSED code and never the message', () => {
  const sb = sandbox()
  const p = path.join(sb.dir, 'broken.json')
  fs.writeFileSync(p, '{"cli":{"executable":"relative/path"}}', { mode: 0o600 })
  const h = harness()
  assert.equal(h.entry.main(['--config', p]), 3)
  assert.equal(h.stdout(), '')
  assert.match(h.stderr(), /configuration error: config_[a-z_]+\n$/)
  assert.equal(h.stderr().includes('relative/path'), false)
})

test('entrypoint: an unreadable config file is exit 3 with a closed code', () => {
  const sb = sandbox()
  const h = harness()
  assert.equal(h.entry.main(['--config', path.join(sb.dir, 'absent.json')]), 3)
  assert.match(h.stderr(), /configuration error: config_/)
})

test('entrypoint: an evaluator throw is exit 3 and prints no signal', () => {
  const sb = sandbox()
  const h = harness({
    evaluateCloudFreshness: () => {
      throw new Error('boom with a /secret/path inside')
    },
  })
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 3)
  assert.equal(h.stdout(), '')
  assert.ok(h.stderr().includes('no signal could be produced'))
  assert.equal(h.stderr().includes('/secret/path'), false)
})

test('entrypoint: a signal that fails its own contract is never printed', () => {
  const sb = sandbox()
  const h = harness({
    evaluateCloudFreshness: () => ({ kind: 'eanhl.cloud-freshness-signal', leaked: '/etc/shadow' }),
  })
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 3)
  assert.equal(h.stdout(), '')
  assert.equal(h.stderr().includes('/etc/shadow'), false)
  assert.ok(h.stderr().includes('failed its own contract'))
})

test('entrypoint: success prints exactly one JSON line and exits 0', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const h = harness()
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 0)
  const stdout = h.stdout()
  assert.equal(stdout.endsWith('\n'), true)
  assert.equal(stdout.trimEnd().split('\n').length, 1)
  const signal = JSON.parse(stdout)
  assert.equal(validateFreshnessSignal(signal), true)
  assert.equal(signal.status, 'fresh')
  assert.equal(signal.newest_verified_source_snapshot_ts, seed.snapshotTs)
})

test('entrypoint: exit 0 is produced for a CRITICAL signal too — the code is not the verdict', () => {
  const sb = sandbox()
  seedVerified(sb, { ageMs: 40 * HOUR })
  const h = harness()
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 0)
  assert.equal(JSON.parse(h.stdout()).status, 'critical')
})

test('entrypoint: exit 0 is produced for an INDETERMINATE signal too', () => {
  const sb = sandbox()
  const cfg = configFor(sb)
  cfg.attestation.dir = path.join(sb.dir, 'gone')
  const p = writeConfigFile(sb, cfg)
  const h = harness()
  assert.equal(h.entry.main(['--config', p]), 0)
  assert.equal(JSON.parse(h.stdout()).status, 'indeterminate')
})

test('entrypoint: stderr carries the not-monitored note on success', () => {
  const sb = sandbox()
  const h = harness()
  h.entry.main(['--config', writeConfigFile(sb)])
  assert.ok(h.stderr().includes('Nothing exports, watches, or alerts on it'))
  assert.ok(h.stderr().includes('not that a backup is fresh'))
})

for (const bad of [null, {}, { writeStdout: () => {} }]) {
  test(`entrypoint: incomplete dependencies (${JSON.stringify(bad)}) are refused`, () => {
    assert.throws(() => makeFreshnessEntrypoint(bad), TypeError)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Static regressions — the boundaries, enforced mechanically.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Source with comments removed. These modules DOCUMENT the things they must
 * not do — "this is not `validateReceiptBinding()`", "the producer uses
 * `mkdirSync`" — so a scan of the raw text would flag its own explanations.
 * Every comment in these files is either a JSDoc block or a whole-line `//`.
 */
function codeOf(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
}

const CORE_PATH = path.join(HERE, 'internal', 'backup-cloud-freshness-core.mjs')
const PUBLIC_PATH = path.join(HERE, 'backup-cloud-freshness.mjs')
const ENTRY_PATH = path.join(HERE, '..', 'eanhl-backup-freshness.mjs')
const SOURCE_PATHS = [CORE_PATH, PUBLIC_PATH, ENTRY_PATH]

test('static: no ops/** module other than the API, the entrypoint and this suite imports the core', () => {
  const opsRoot = path.resolve(HERE, '..', '..')
  const allowed = new Set([
    CORE_PATH,
    PUBLIC_PATH,
    path.resolve(ENTRY_PATH),
    path.join(HERE, 'backup-cloud-freshness.test.mjs'),
  ])
  const IMPORTS_CORE =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-cloud-freshness-core\.mjs['"]/
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

test('static: no freshness SOURCE module touches the acceptor or its receipt vocabulary', () => {
  // C11: a destination receipt is not a Proton attestation, and cloud binding
  // must never be satisfied by reusing the acceptor's rules. This suite is
  // deliberately excluded — it imports `buildReceipt` to prove the rejection.
  for (const file of SOURCE_PATHS) {
    const code = codeOf(file)
    for (const forbidden of [
      /from\s+['"][^'"]*backup-acceptance/,
      /\bvalidateReceiptBinding\b/,
      /\bbuildReceipt\b/,
      /\bvalidateManifestIdentity\b/,
      /\breceiptFileName\b/,
    ]) {
      assert.equal(forbidden.test(code), false, `${path.basename(file)}: ${forbidden}`)
    }
  }
})

test('static: the core enumerates by streaming and never materializes a listing', () => {
  const code = codeOf(CORE_PATH)
  assert.equal(/\breaddirSync\b/.test(code), false)
  assert.equal(/\breaddir\b/.test(code), false)
  assert.ok(/\bopendir\b/.test(code))
  assert.ok(/\breadSync\b/.test(code))
})

test('static: the freshness modules hold no write, delete, or spawn capability', () => {
  for (const file of [CORE_PATH, PUBLIC_PATH]) {
    const code = codeOf(file)
    for (const forbidden of [
      /\bwriteFileSync\b/,
      /\bunlinkSync\b/,
      /\brmSync\b/,
      /\brenameSync\b/,
      /\bmkdirSync\b/,
      /\bchmodSync\b/,
      /\bspawn\b/,
      /\bexecSync\b/,
      /child_process/,
      /node:net/,
      /node:http/,
      /\bfetch\b/,
      /O_CREAT/,
      /O_WRONLY/,
      /\bO_TRUNC\b/,
    ]) {
      assert.equal(forbidden.test(code), false, `${path.basename(file)}: ${forbidden}`)
    }
  }
})

test('static: the core installs no signal listener and reads no environment variable', () => {
  const code = codeOf(CORE_PATH)
  assert.equal(/process\.on\(/.test(code), false)
  assert.equal(/process\.env/.test(code), false)
  assert.equal(/process\.exit\(/.test(code), false)
})

test('static: the entrypoint has no shebang and no executable bit — it is NOT activated', () => {
  const code = fs.readFileSync(ENTRY_PATH, 'utf8')
  assert.equal(code.startsWith('#!'), false)
  const mode = fs.statSync(ENTRY_PATH).mode
  assert.equal(mode & 0o111, 0, 'the entrypoint must not be executable')
})

test('static: no package.json script invokes the freshness entrypoint', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(HERE, '..', '..', '..', 'package.json'), 'utf8'),
  )
  for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
    assert.equal(String(script).includes('eanhl-backup-freshness'), false, name)
  }
})

test('static: the entrypoint imports only the core and binds it once', () => {
  const code = fs.readFileSync(ENTRY_PATH, 'utf8')
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./lib/internal/backup-cloud-freshness-core.mjs'])
})

test('static: the approved thresholds are literal in the core, not read from config', () => {
  const code = fs.readFileSync(CORE_PATH, 'utf8')
  assert.ok(code.includes('export const WARNING_AFTER_SECONDS = 8 * 60 * 60'))
  assert.ok(code.includes('export const CRITICAL_AFTER_SECONDS = 24 * 60 * 60'))
  // No configuration key may supply either one.
  assert.equal(/config\.[a-zA-Z.]*warning/i.test(code), false)
  assert.equal(/config\.[a-zA-Z.]*critical/i.test(code), false)
})

test('static: the anomaly vocabularies are disjoint and jointly exhaustive', () => {
  const fatal = new Set(production.FRESHNESS_FATAL_ANOMALY_CODES)
  const perRecord = new Set(production.FRESHNESS_RECORD_ANOMALY_CODES)
  for (const code of fatal) assert.equal(perRecord.has(code), false, code)
  assert.equal(fatal.size + perRecord.size, FRESHNESS_ANOMALY_CODES.length)
  for (const code of FRESHNESS_ANOMALY_CODES) {
    assert.ok(fatal.has(code) || perRecord.has(code), code)
  }
  assert.deepEqual([...FRESHNESS_ANOMALY_CODES], [...FRESHNESS_ANOMALY_CODES].sort())
})

test('static: every anomaly code the core can raise is declared in the vocabulary', () => {
  const code = fs.readFileSync(CORE_PATH, 'utf8')
  const raised = new Set([...code.matchAll(/anomalies\.add\('([a-z_]+)'\)/g)].map((m) => m[1]))
  assert.ok(raised.size >= 10, `only found ${raised.size}`)
  for (const name of raised) {
    assert.ok(FRESHNESS_ANOMALY_CODES.includes(name), `undeclared anomaly: ${name}`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Layered guards, each made INDIVIDUALLY observable.
//
// Several checks here are deliberately duplicated across the `lstat` and the
// `fstat` of the same file, or across the in-read and end-of-run directory
// rechecks. Without these tests a mutation could delete the outer half of a
// pair and every other test would still pass, which would make the redundancy
// unverifiable rather than defensive.
// ─────────────────────────────────────────────────────────────────────────────

/** Wrap `lstat` so one path's reported stat can be perturbed on chosen calls. */
function perturbingLstat(targetPath, perturb, onCalls) {
  let n = 0
  return (p) => {
    const st = fs.lstatSync(p, { bigint: true })
    if (p !== targetPath) return st
    n++
    return onCalls.includes(n) ? perturb(stProxy(st)) : st
  }
}

test('guards: the manifest lstat mode check is load-bearing (not just the fstat one)', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const signal = evaluatorAt(NOW_MS, {
    lstat: perturbingLstat(
      manifestPath(sb, seed.base),
      (st) => ({ ...st, mode: st.mode | 0o044n }),
      [1],
    ),
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('guards: the manifest lstat size ceiling is load-bearing (not just the fstat one)', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const signal = evaluatorAt(NOW_MS, {
    lstat: perturbingLstat(
      manifestPath(sb, seed.base),
      (st) => ({ ...st, size: BigInt(LOCAL_MANIFEST_CEILING_BYTES) + 1n }),
      [1],
    ),
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.counts.manifest_unavailable, 1)
})

test('guards: the manifest read-loop overflow guard is load-bearing', () => {
  const sb = sandbox()
  seedVerified(sb)
  const cfg = configFor(sb)
  cfg.readback.maxManifestBytes = 4096
  // A read that reports more bytes than the file could hold — the descriptor
  // checks passed, so only the loop's own accumulator can refuse this.
  let first = true
  const signal = evaluatorAt(NOW_MS, {
    read: (fd, buffer) => {
      if (!first) return 0
      first = false
      return buffer.length
    },
  }).evaluateCloudFreshness({ config: cfg })
  assert.equal(signal.counts.manifest_unavailable, 1)
  assert.equal(signal.status, 'no_evidence')
})

test('guards: the post-read source-dir recheck STOPS the run at the first bad manifest', () => {
  const sb = sandbox()
  seedVerified(sb, { ageMs: 2 * HOUR, n: 1 })
  seedVerified(sb, { ageMs: 3 * HOUR, n: 2 })
  seedVerified(sb, { ageMs: 4 * HOUR, n: 3 })

  // Armed the moment the first manifest descriptor closes; fires on the very
  // next observation of the source directory. The end-of-run recheck would
  // reach the same verdict, so the distinguishing evidence is WHERE it stops:
  // with the in-read recheck, exactly one record is considered.
  let armed = false
  let fired = false
  const signal = evaluatorAt(NOW_MS, {
    close: (fd) => {
      const r = REAL_FRESHNESS_DEPS.close(fd)
      armed = true
      return r
    },
    lstat: (p) => {
      const st = fs.lstatSync(p, { bigint: true })
      if (p === sb.sourceDir && armed && !fired) {
        fired = true
        return { ...stProxy(st), mode: st.mode | 0o002n }
      }
      return st
    },
  }).evaluateCloudFreshness({ config: configFor(sb) })

  assert.equal(signal.status, 'indeterminate')
  assert.ok(signal.anomalies.includes('source_dir_changed'))
  assert.equal(signal.newest_verified_source_snapshot_ts, null)
  assert.equal(signal.counts.considered, 1)
  assert.equal(signal.counts.binding_valid, 0)
})

test('guards: the end-of-run source-dir recheck fires when no manifest was ever read', () => {
  const sb = sandbox()
  // No attestations at all, so no manifest read happens and the in-read
  // recheck never runs. The source directory is observed exactly twice.
  const signal = evaluatorAt(NOW_MS, {
    lstat: perturbingLstat(sb.sourceDir, (st) => ({ ...st, ino: st.ino + 1n }), [2]),
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['source_dir_changed'])
})

test('guards: the end-of-run attestation-dir recheck is load-bearing', () => {
  const sb = sandbox()
  // An EMPTY directory, so it is observed exactly twice: once up front, once at
  // the end. Perturbing only the second observation isolates the final recheck.
  const signal = evaluatorAt(NOW_MS, {
    lstat: perturbingLstat(sb.attestationDir, (st) => ({ ...st, ino: st.ino + 1n }), [2]),
  }).evaluateCloudFreshness({ config: configFor(sb) })
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['attestation_dir_changed'])
})

test('guards: the source-dir realpath check catches a symlinked PARENT', () => {
  const sb = sandbox()
  seedVerified(sb)
  // The final component is a real directory, so `isSymbolicLink()` is false —
  // only the realpath comparison notices the path was reached through a link.
  const parent = path.join(sb.dir, 'parent')
  fs.mkdirSync(parent, { mode: 0o755 })
  fs.renameSync(sb.sourceDir, path.join(parent, 'artifacts'))
  fs.symlinkSync(parent, path.join(sb.dir, 'plink'))
  const viaLink = path.join(sb.dir, 'plink', 'artifacts')
  assert.equal(fs.lstatSync(viaLink).isSymbolicLink(), false)

  const cfg = configFor(sb)
  cfg.artifact.sourceDir = viaLink
  const signal = evaluate(sb, { config: cfg })
  assert.equal(signal.status, 'indeterminate')
  assert.deepEqual(signal.anomalies, ['source_dir_untrusted'])
})

test('guards: a verified record whose own timestamp is in the future is excluded before binding', () => {
  const sb = sandbox()
  const good = seedVerified(sb, { ageMs: 3 * HOUR, n: 1 })
  // A PAST base stamp carrying a FUTURE source_snapshot_ts. Only binding ties
  // those two together, so this record reaches the evaluator looking ordinary.
  const snapshotMs = NOW_MS - 2 * HOUR
  const base = baseAt(snapshotMs)
  const runId = runIdAt(snapshotMs)
  putAttestation(sb, {
    base,
    attemptId: attemptIdAt(snapshotMs, 4),
    runId,
    snapshotTs: isoOf(NOW_MS + 6 * HOUR),
  })
  putManifest(sb, manifestFor({ base, runId, snapshotTs: isoOf(NOW_MS + 6 * HOUR) }), { base })

  const signal = evaluate(sb)
  assert.equal(signal.counts.future_dated, 1)
  assert.ok(signal.anomalies.includes('snapshot_ts_in_future'))
  // It was excluded BEFORE the manifest was ever opened for it.
  assert.equal(signal.counts.manifest_unavailable, 0)
  assert.equal(signal.counts.manifest_invalid, 0)
  assert.equal(signal.newest_verified_source_snapshot_ts, good.snapshotTs)
  assert.equal(signal.status, 'fresh')
})

test('static: the only write primitive in the core is bound to stdout and stderr', () => {
  // `fs.writeSync` IS a write capability, and the earlier capability scan
  // deliberately permits it — printing the signal is the point. What must hold
  // is that no file path can ever reach it: every call site passes a literal
  // fd 1 or 2. Reviewed once is not enough; pin it.
  const code = codeOf(CORE_PATH)
  const writeSites = [...code.matchAll(/fs\.write[A-Za-z]*\(/g)].map((m) => m[0])
  assert.deepEqual(writeSites, ['fs.writeSync('], 'unexpected fs write call in the core')
  const uses = [...code.matchAll(/(?<!function )writeAllSync\(([^),]*),/g)].map((m) => m[1].trim())
  assert.deepEqual(uses.sort(), ['1', '2'], 'writeAllSync is called with a non-literal fd')
})

test('static: the read-only library path holds no write capability at all', () => {
  // `REAL_FRESHNESS_DEPS` is what `evaluateCloudFreshness()` runs on. It must
  // expose observation and reading only — the entrypoint's writers live in a
  // separate dependency set that the evaluator never receives.
  assert.deepEqual(Object.keys(REAL_FRESHNESS_DEPS).sort(), [
    'close',
    'fstat',
    'geteuid',
    'lstat',
    'now',
    'openFile',
    'opendir',
    'read',
    'readAttestation',
    'realpath',
  ])
  for (const name of ['writeStdout', 'writeStderr', 'readConfigFile', 'write', 'unlink']) {
    assert.equal(name in REAL_FRESHNESS_DEPS, false, name)
  }
})

test('static: the manifest descriptor is opened read-only and no-follow', () => {
  // The evaluator does not open files itself; it borrows E3J6A's reader, whose
  // flags are O_RDONLY | O_NOFOLLOW | O_NONBLOCK. Pin the wiring so a future
  // edit cannot quietly substitute a writable opener.
  const code = codeOf(CORE_PATH)
  const openFileBindings = [...code.matchAll(/openFile:\s*([^,\n]+)/g)].map((m) => m[1].trim())
  assert.deepEqual(openFileBindings, ['REAL_EVIDENCE_READER.open'])
  const reader = fs.readFileSync(
    path.join(HERE, 'internal', 'backup-cloud-source-evidence.mjs'),
    'utf8',
  )
  assert.ok(reader.includes('C.O_RDONLY | C.O_NOFOLLOW'))
})

// ─────────────────────────────────────────────────────────────────────────────
// The output projection boundary.
//
// Validating one object and then serializing THAT object is unsound. These
// tests pin the three ways the gap was exploitable: an inherited `toJSON`
// invisible to `Object.keys()`, a getter that answers the validator and the
// serializer differently, and a getter that throws.
// ─────────────────────────────────────────────────────────────────────────────

/** A contract-legal signal as a plain mutable object. */
function legalSignalFields(overrides = {}) {
  const sb = sandbox()
  seedVerified(sb, { ageMs: 2 * HOUR })
  return { ...JSON.parse(JSON.stringify(evaluate(sb))), ...overrides }
}

test('projection: an INHERITED toJSON is refused — it would serialize unrelated data', () => {
  const fields = legalSignalFields()
  const rogue = Object.create({ toJSON: () => ({ leaked: '/etc/shadow', token: 'abc' }) })
  Object.assign(rogue, fields)

  // The exploit precondition: own enumerable keys look exactly right, so a
  // key-set check alone passes...
  assert.deepEqual(Object.keys(rogue).sort(), Object.keys(fields).sort())
  assert.equal(validateFreshnessSignal(rogue), true)
  // ...while serializing the SAME object emits something else entirely.
  assert.equal(JSON.stringify(rogue), '{"leaked":"/etc/shadow","token":"abc"}')

  // The projection refuses it on the prototype, and nothing is serialized.
  assert.equal(production.projectFreshnessSignal(rogue), null)

  const h = harness({ evaluateCloudFreshness: () => rogue })
  const sb = sandbox()
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 3)
  assert.equal(h.stdout(), '')
  assert.equal(h.stderr().includes('/etc/shadow'), false)
  assert.equal(h.stderr().includes('token'), false)
})

test('projection: a NESTED inherited toJSON is refused', () => {
  const fields = legalSignalFields()
  fields.counts = Object.assign(
    Object.create({ toJSON: () => ({ leaked: '/srv/secret' }) }),
    fields.counts,
  )
  assert.equal(validateFreshnessSignal(fields), true)
  assert.ok(JSON.stringify(fields).includes('/srv/secret'))
  assert.equal(production.projectFreshnessSignal(fields), null)
})

test('projection: an OWN non-enumerable toJSON is refused, not skipped', () => {
  const fields = legalSignalFields()
  Object.defineProperty(fields, 'toJSON', {
    value: () => ({ leaked: 'x' }),
    enumerable: false,
  })
  assert.equal(validateFreshnessSignal(fields), true)
  assert.equal(production.projectFreshnessSignal(fields), null)
})

test('projection: a STATEFUL getter cannot answer the validator and the serializer differently', () => {
  const fields = legalSignalFields()
  let reads = 0
  const rogue = { ...fields }
  delete rogue.status
  Object.defineProperty(rogue, 'status', {
    enumerable: true,
    get() {
      reads++
      return reads === 1 ? 'fresh' : 'critical'
    },
  })
  // The projection refuses the accessor WITHOUT invoking it.
  assert.equal(production.projectFreshnessSignal(rogue), null)
  assert.equal(reads, 0, 'the getter must never be called')
})

test('projection: a THROWING getter is refused silently, and never crashes the entrypoint', () => {
  const fields = legalSignalFields()
  const rogue = { ...fields }
  delete rogue.age_seconds
  Object.defineProperty(rogue, 'age_seconds', {
    enumerable: true,
    get() {
      throw new Error('boom from /var/secret/path')
    },
  })
  assert.equal(production.projectFreshnessSignal(rogue), null)

  const h = harness({ evaluateCloudFreshness: () => rogue })
  const sb = sandbox()
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 3)
  assert.equal(h.stdout(), '')
  assert.equal(h.stderr().includes('/var/secret/path'), false)
  assert.equal(h.stderr().includes('boom'), false)
})

test('projection: a Proxy is refused without running a trap', () => {
  const fields = legalSignalFields()
  let trapped = 0
  const rogue = new Proxy(fields, {
    get(t, k) {
      trapped++
      return t[k]
    },
    ownKeys(t) {
      trapped++
      return Reflect.ownKeys(t)
    },
  })
  assert.equal(production.projectFreshnessSignal(rogue), null)
  assert.equal(trapped, 0)
})

test('projection: a symbol key, an extra field, and a missing field are each refused', () => {
  const withSymbol = legalSignalFields()
  withSymbol[Symbol('x')] = 1
  assert.equal(production.projectFreshnessSignal(withSymbol), null)

  const withExtra = legalSignalFields({ extra: 1 })
  assert.equal(production.projectFreshnessSignal(withExtra), null)

  const missing = legalSignalFields()
  delete missing.monitored
  assert.equal(production.projectFreshnessSignal(missing), null)
})

test('projection: an anomalies array with a hole or an extra own key is refused', () => {
  const holed = legalSignalFields({ anomalies: ['binding_invalid'] })
  holed.anomalies.length = 3
  assert.equal(production.projectFreshnessSignal(holed), null)

  const tagged = legalSignalFields({ anomalies: ['binding_invalid'] })
  tagged.anomalies.note = '/etc/passwd'
  assert.equal(production.projectFreshnessSignal(tagged), null)
})

test('projection: a legal signal projects to a fresh prototype-free copy', () => {
  const sb = sandbox()
  const seed = seedVerified(sb, { ageMs: 2 * HOUR })
  const signal = evaluate(sb)
  const projection = production.projectFreshnessSignal(signal)

  assert.notEqual(projection, null)
  assert.notEqual(projection, signal, 'the projection must be a NEW object')
  assert.equal(Object.getPrototypeOf(projection), null)
  assert.equal(Object.getPrototypeOf(projection.counts), null)
  assert.equal(Object.getPrototypeOf(projection.thresholds), null)
  assert.notEqual(projection.counts, signal.counts)
  assert.equal(validateFreshnessSignal(projection), true)
  assert.equal(projection.newest_verified_source_snapshot_ts, seed.snapshotTs)
  assert.deepEqual(JSON.parse(JSON.stringify(projection)), JSON.parse(JSON.stringify(signal)))
})

test('projection: serializeFreshnessSignal re-checks the text it produced', () => {
  const sb = sandbox()
  seedVerified(sb)
  const projection = production.projectFreshnessSignal(evaluate(sb))
  const text = production.serializeFreshnessSignal(projection)
  assert.equal(typeof text, 'string')
  assert.equal(text.includes('\n'), false)
  assert.equal(validateFreshnessSignal(JSON.parse(text)), true)
  // It refuses anything that is not already a valid projection.
  assert.equal(production.serializeFreshnessSignal({ kind: 'x' }), null)
  assert.equal(production.serializeFreshnessSignal(null), null)
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-field contract. Each field below is individually legal; the
// COMBINATION asserts something the evaluator can never have observed. A
// contradictory signal is worse than no signal — a watcher would act on it.
// ─────────────────────────────────────────────────────────────────────────────

test('cross-field: a truncated or unreadable scan cannot claim fresh, warning or critical', () => {
  for (const scan of ['truncated', 'unreadable']) {
    for (const status of ['fresh', 'warning', 'critical']) {
      const s = legalSignalFields({ scan })
      s.status = status
      s.age_seconds =
        status === 'fresh'
          ? 3600
          : status === 'warning'
            ? WARNING_AFTER_SECONDS
            : CRITICAL_AFTER_SECONDS
      s.newest_verified_source_snapshot_ts = isoOf(
        Date.parse(s.generated_at) - s.age_seconds * 1000,
      )
      assert.equal(validateFreshnessSignal(s), false, `${scan}/${status}`)
      assert.equal(production.projectFreshnessSignal(s) === null, false, 'shape alone is legal')
      assert.equal(production.serializeFreshnessSignal(production.projectFreshnessSignal(s)), null)
    }
  }
})

test('cross-field: a truncated scan is still legal when the status is indeterminate', () => {
  const s = legalSignalFields({ scan: 'truncated', status: 'indeterminate' })
  s.anomalies = ['scan_truncated']
  s.newest_verified_source_snapshot_ts = null
  s.age_seconds = null
  assert.equal(validateFreshnessSignal(s), true)
})

test('cross-field: a value-bearing status requires a usable generated_at', () => {
  const s = legalSignalFields({ generated_at: null })
  assert.equal(validateFreshnessSignal(s), false)
  // A null clock reading is legal only for indeterminate.
  const ok = legalSignalFields({ generated_at: null, status: 'indeterminate' })
  ok.anomalies = ['clock_unusable']
  ok.newest_verified_source_snapshot_ts = null
  ok.age_seconds = null
  assert.equal(validateFreshnessSignal(ok), true)
})

test('cross-field: no_evidence with a null clock is refused — only indeterminate may have one', () => {
  const s = legalSignalFields({ generated_at: null, status: 'no_evidence' })
  s.newest_verified_source_snapshot_ts = null
  s.age_seconds = null
  assert.equal(validateFreshnessSignal(s), false)
})

test('cross-field: the status must match what the APPROVED thresholds assign to the age', () => {
  const cases = [
    [WARNING_AFTER_SECONDS - 1, 'fresh', true],
    [WARNING_AFTER_SECONDS - 1, 'warning', false],
    [WARNING_AFTER_SECONDS, 'warning', true],
    [WARNING_AFTER_SECONDS, 'fresh', false],
    [CRITICAL_AFTER_SECONDS - 1, 'warning', true],
    [CRITICAL_AFTER_SECONDS - 1, 'critical', false],
    [CRITICAL_AFTER_SECONDS, 'critical', true],
    [CRITICAL_AFTER_SECONDS, 'warning', false],
    // The headline contradiction: a two-day-old copy announced as fresh.
    [48 * 3600, 'fresh', false],
  ]
  for (const [age, status, expected] of cases) {
    const s = legalSignalFields({ status })
    s.age_seconds = age
    s.newest_verified_source_snapshot_ts = isoOf(Date.parse(s.generated_at) - age * 1000)
    assert.equal(validateFreshnessSignal(s), expected, `age ${age} as ${status}`)
  }
})

test('cross-field: age_seconds must be the distance between the two timestamps', () => {
  const s = legalSignalFields()
  // The timestamps say 30 hours; the age claims one hour, which would read as
  // `fresh` to anything that trusted the number.
  s.status = 'fresh'
  s.age_seconds = 3600
  s.newest_verified_source_snapshot_ts = isoOf(Date.parse(s.generated_at) - 30 * HOUR)
  assert.equal(validateFreshnessSignal(s), false)

  const consistent = legalSignalFields({ status: 'critical' })
  consistent.age_seconds = 30 * 3600
  consistent.newest_verified_source_snapshot_ts = isoOf(
    Date.parse(consistent.generated_at) - 30 * HOUR,
  )
  assert.equal(validateFreshnessSignal(consistent), true)
})

test('cross-field: a snapshot newer than generated_at is refused', () => {
  const s = legalSignalFields({ status: 'fresh' })
  s.age_seconds = 0
  s.newest_verified_source_snapshot_ts = isoOf(Date.parse(s.generated_at) + HOUR)
  assert.equal(validateFreshnessSignal(s), false)
})

test('cross-field: sub-second snapshot precision still validates', () => {
  const s = legalSignalFields({ status: 'fresh' })
  const nowMs = Date.parse(s.generated_at)
  s.newest_verified_source_snapshot_ts = new Date(nowMs - 3600_500).toISOString()
  s.age_seconds = 3600
  assert.equal(validateFreshnessSignal(s), true)
})

test('cross-field: every signal the evaluator itself produces still validates', () => {
  // The rules above must be statements the producer path cannot violate.
  for (const signal of everyKindOfSignal()) {
    assert.equal(validateFreshnessSignal(signal), true, JSON.stringify(signal))
    const projection = production.projectFreshnessSignal(signal)
    assert.notEqual(projection, null)
    assert.equal(typeof production.serializeFreshnessSignal(projection), 'string')
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// The stdout write must be AFFIRMED. A partial line cannot be retracted.
// ─────────────────────────────────────────────────────────────────────────────

test('stdout: a writer that reports failure gives exit 3 and no second stdout line', () => {
  const sb = sandbox()
  seedVerified(sb)
  const writes = []
  const h = harness({
    writeStdout: (buf) => {
      writes.push(buf.toString('utf8'))
      return false
    },
  })
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 3)
  assert.equal(writes.length, 1, 'no second stdout line may be attempted')
  assert.ok(h.stderr().includes('could not be written in full'))
  assert.equal(h.stderr().includes('note: this is a local signal only'), false)
})

for (const [label, ret] of [
  ['undefined', undefined],
  ['null', null],
  ['a byte count', 42],
  ['a truthy non-true value', 'ok'],
]) {
  test(`stdout: a writer returning ${label} is not an affirmed write (exit 3)`, () => {
    const sb = sandbox()
    seedVerified(sb)
    const h = harness({ writeStdout: () => ret })
    assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 3)
    assert.ok(h.stderr().includes('could not be written in full'))
  })
}

test('stdout: a throwing writer gives exit 3 and never leaks the native error', () => {
  const sb = sandbox()
  seedVerified(sb)
  const h = harness({
    writeStdout: () => {
      throw new Error('EPIPE on /dev/stdout')
    },
  })
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 3)
  assert.equal(h.stderr().includes('EPIPE'), false)
  assert.equal(h.stderr().includes('/dev/stdout'), false)
  assert.ok(h.stderr().includes('could not be written in full'))
})

test('stdout: a failed --help write is exit 3, not a silent 0', () => {
  const h = harness({ writeStdout: () => false })
  assert.equal(h.entry.main(['--help']), 3)
})

test('stdout: a throwing stderr never changes a successful exit 0', () => {
  const sb = sandbox()
  seedVerified(sb)
  const out = []
  const entry = makeFreshnessEntrypoint({
    writeStdout: (buf) => {
      out.push(buf.toString('utf8'))
      return true
    },
    writeStderr: () => {
      throw new Error('stderr closed')
    },
    readConfigFile: (p) => fs.readFileSync(p, 'utf8'),
    evaluateCloudFreshness: ({ config }) => evaluatorAt(NOW_MS).evaluateCloudFreshness({ config }),
  })
  assert.equal(entry.main(['--config', writeConfigFile(sb)]), 0)
  assert.equal(out.length, 1)
})

test('stdout: a successful write is exactly one complete JSON line and exit 0', () => {
  const sb = sandbox()
  const seed = seedVerified(sb)
  const h = harness()
  assert.equal(h.entry.main(['--config', writeConfigFile(sb)]), 0)
  const stdout = h.stdout()
  assert.equal(stdout.endsWith('\n'), true)
  assert.equal(stdout.split('\n').length, 2)
  const parsed = JSON.parse(stdout)
  assert.equal(validateFreshnessSignal(parsed), true)
  assert.equal(parsed.newest_verified_source_snapshot_ts, seed.snapshotTs)
})

test('stdout: the REAL writer affirms a good write and reports a broken descriptor', async () => {
  // `writeAllSync` is module-private, so exercise it through the REAL
  // dependency set in a child process whose stdout is closed underneath it.
  const { spawnSync } = await import('node:child_process')
  const core = path.join(HERE, 'internal', 'backup-cloud-freshness-core.mjs')
  const script = [
    `import { REAL_FRESHNESS_ENTRYPOINT_DEPS as D } from ${JSON.stringify(core)}`,
    "import fs from 'node:fs'",
    'const emptyBuffer = D.writeStdout(Buffer.alloc(0))',
    "const realWrite = D.writeStdout(Buffer.from('hello\\n', 'utf8'))",
    'fs.closeSync(1)',
    "const afterClose = D.writeStdout(Buffer.from('must not be counted', 'utf8'))",
    'fs.writeSync(2, JSON.stringify({ emptyBuffer, realWrite, afterClose }))',
  ].join('\n')

  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(r.status, 0, r.stderr)
  const result = JSON.parse(r.stderr)
  assert.equal(result.emptyBuffer, true, 'an empty buffer is trivially complete')
  assert.equal(result.realWrite, true, 'a good write must be affirmed with true')
  assert.equal(result.afterClose, false, 'a write to a closed descriptor must report failure')
  assert.equal(r.stdout, 'hello\n')
})

test('static: the entrypoint serializes only a projection, never the caller object', () => {
  const code = codeOf(CORE_PATH)
  // Exactly one JSON.stringify in the module, inside serializeFreshnessSignal,
  // and its argument is the projection.
  const stringifies = [...code.matchAll(/JSON\.stringify\(([^)]*)\)/g)].map((m) => m[1].trim())
  assert.deepEqual(stringifies, ['projection'])
  // `main` must never hand the evaluator's own value to the serializer.
  const main = code.slice(code.indexOf('function main(argv)'))
  assert.equal(/JSON\.stringify/.test(main), false)
  assert.ok(main.includes('projectFreshnessSignal(signal)'))
  assert.ok(main.includes('serializeFreshnessSignal(projection)'))
  // The validated value and the serialized value are the same projection.
  assert.ok(code.includes('if (!validateFreshnessSignal(projection)) return null'))
})

test('static: the stdout result is never ignored', () => {
  const code = codeOf(CORE_PATH)
  // Every writeStdout call goes through `wroteFully`, whose result is branched on.
  const direct = [...code.matchAll(/deps\.writeStdout\(/g)]
  assert.deepEqual(direct, [], 'writeStdout must only be reached through wroteFully')
  assert.ok(code.includes('if (!wroteFully(deps.writeStdout, `${text}\\n`)) {'))
  assert.ok(code.includes('return wroteFully(deps.writeStdout, USAGE) ? 0 : 3'))
  assert.ok(code.includes('return result === true'), 'only an explicit true is an affirmed write')
})

test('drainWrite: a complete write in one call is affirmed', () => {
  const calls = []
  const ok = drainWrite(Buffer.from('hello'), (b, off, len) => {
    calls.push([off, len])
    return len
  })
  assert.equal(ok, true)
  assert.deepEqual(calls, [[0, 5]])
})

test('drainWrite: several short writes that finish are affirmed', () => {
  const calls = []
  const ok = drainWrite(Buffer.from('abcdefgh'), (b, off, len) => {
    calls.push([off, len])
    return Math.min(3, len)
  })
  assert.equal(ok, true)
  assert.deepEqual(calls, [
    [0, 8],
    [3, 5],
    [6, 2],
  ])
})

test('drainWrite: a write that STALLS short of the end reports failure', () => {
  // 16 attempts of one byte cannot drain 40 bytes: the loop must give up and
  // say so rather than leave a truncated line looking successful.
  let calls = 0
  const ok = drainWrite(Buffer.alloc(40, 0x61), (b, off, len) => {
    calls++
    return Math.min(1, len)
  })
  assert.equal(ok, false)
  assert.equal(calls, 16, 'the loop stays bounded')
})

for (const [label, ret] of [
  ['zero', 0],
  ['negative', -1],
  ['a non-integer', 2.5],
  ['NaN', Number.NaN],
  ['undefined', undefined],
]) {
  test(`drainWrite: a write returning ${label} reports failure`, () => {
    assert.equal(
      drainWrite(Buffer.from('abc'), () => ret),
      false,
    )
  })
}

test('drainWrite: a throwing write reports failure and does not propagate', () => {
  assert.equal(
    drainWrite(Buffer.from('abc'), () => {
      throw new Error('EPIPE')
    }),
    false,
  )
})

test('drainWrite: a throw AFTER partial progress still reports failure', () => {
  let n = 0
  const ok = drainWrite(Buffer.from('abcdef'), (b, off, len) => {
    if (n++ === 0) return 2
    throw new Error('EIO')
  })
  assert.equal(ok, false)
})

test('drainWrite: an empty buffer is trivially complete and writes nothing', () => {
  let called = 0
  assert.equal(
    drainWrite(Buffer.alloc(0), () => {
      called++
      return 0
    }),
    true,
  )
  assert.equal(called, 0)
})

test('projection: monitored must already be false — a true value is refused, not corrected', () => {
  const s = legalSignalFields({ monitored: true })
  assert.equal(production.projectFreshnessSignal(s), null)
})

test('serialize: a polluted Array.prototype.toJSON cannot change what is printed', () => {
  // The one toJSON route a fresh null-prototype object cannot rule out by
  // construction. The round-trip re-check is what catches it.
  const sb = sandbox()
  seedVerified(sb)
  const projection = production.projectFreshnessSignal(evaluate(sb))
  assert.equal(typeof production.serializeFreshnessSignal(projection), 'string')

  const had = Object.prototype.hasOwnProperty.call(Array.prototype, 'toJSON')
  const previous = Array.prototype.toJSON
  try {
    Object.defineProperty(Array.prototype, 'toJSON', {
      value: () => '/etc/shadow',
      configurable: true,
      writable: true,
      enumerable: false,
    })
    assert.ok(JSON.stringify(projection).includes('/etc/shadow'), 'precondition')
    assert.equal(production.serializeFreshnessSignal(projection), null)
  } finally {
    if (had) Array.prototype.toJSON = previous
    else delete Array.prototype.toJSON
  }
  assert.equal(Object.prototype.hasOwnProperty.call(Array.prototype, 'toJSON'), had)
  // And the boundary works normally again afterwards.
  assert.equal(typeof production.serializeFreshnessSignal(projection), 'string')
})

test('drainWrite: a bad return stops at once — no out-of-range offset is ever passed on', () => {
  // Without the explicit guard the loop keeps going on a bogus return value
  // and hands the NEXT write a corrupted offset/length pair (negative offset,
  // or a length past the end of the buffer). Reaching `false` eventually is
  // not enough; it must stop before calling write again.
  for (const bad of [0, -1, 2.5, Number.NaN, undefined]) {
    const calls = []
    const ok = drainWrite(Buffer.from('abcdef'), (b, off, len) => {
      calls.push([off, len])
      return bad
    })
    assert.equal(ok, false, String(bad))
    assert.deepEqual(calls, [[0, 6]], `stopped after one call for ${String(bad)}`)
  }
})
