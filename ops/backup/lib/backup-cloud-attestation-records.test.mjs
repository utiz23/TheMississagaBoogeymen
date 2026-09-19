/**
 * Cloud-attempt intent/attestation records — E3J6B.
 *
 * PRODUCTION-route tests exercise the real filesystem through
 * `backup-cloud-attestation-records.mjs`. FACTORY-route tests build a runner
 * from the internal core's `makeAttestationRecords()` with an injected
 * dependency set, for fault-injection cases (a native close failure, a
 * pathname-replacement race) that real-filesystem timing cannot reliably
 * force.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { BackupError } from './backup-artifact-contract.mjs'
import * as production from './backup-cloud-attestation-records.mjs'
import {
  CLOUD_RECORD_CEILING_BYTES,
  REAL_ATTESTATION_RECORDS_DEPS,
  makeAttestationRecords,
} from './internal/backup-cloud-attestation-records-core.mjs'
import {
  buildAttestationFileName,
  buildCloudAttemptIntentFileName,
} from './backup-cloud-naming.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-attestation-records' })

const BASE = 'eanhl-test-20260904T180007Z'
const ATTEMPT_ID = '20260916T123456Z-deadbeef'
const RUN_ID = '20260916T120000Z-0a1b2c3d'
// SHA-256 (64 hex) and SHA-512 (128 hex) are different lengths — never interchange them.
const SHA256_A = '0123456789abcdef'.repeat(4)
const SHA256_B = 'fedcba9876543210'.repeat(4)
const SHA512_A = '0123456789abcdef'.repeat(8)
const SHA512_B = 'fedcba9876543210'.repeat(8)
const STARTED_AT = '2026-09-16T12:34:56.789Z'
const FINISHED_AT = '2026-09-16T12:35:10.000Z'

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

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cloud-records-'))
  sandboxes.push(dir)
  const attestationDir = path.join(dir, 'attest')
  fs.mkdirSync(attestationDir, { mode: 0o700 })
  return { dir, attestationDir }
}

function configFor(sb) {
  return {
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expectedSha512: SHA512_A },
    credentials: { backend: 'pass' },
    remote: { root: '/proton/eanhl-backups' },
    artifact: { sourceDir: path.join(sb.dir, 'artifacts') },
    attestation: { dir: sb.attestationDir },
    readback: {
      dir: path.join(sb.dir, 'readback'),
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: { executable: '/usr/bin/prlimit', expectedSha512: SHA512_B },
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

function names(base = BASE) {
  return {
    ciphertext: `${base}.dump.age`,
    checksum: `${base}.dump.age.sha256`,
    manifest: `${base}.manifest.json`,
  }
}

function validIntentFields({ base = BASE, attemptId = ATTEMPT_ID, refused = false } = {}) {
  const n = names(base)
  const namespace = `/proton/eanhl-backups/${base}.${attemptId}`
  return {
    cloud_run_id: RUN_ID,
    sequence: 0,
    started_at: STARTED_AT,
    artifact: { base, ...n },
    source: refused
      ? {
          evidence: 'unavailable',
          snapshot_ts: null,
          run_id: null,
          ciphertext: null,
          checksum: null,
          manifest: null,
        }
      : {
          evidence: 'captured',
          snapshot_ts: '2026-09-04T18:00:07.000Z',
          run_id: '20260904T180001Z-0a1b2c3d',
          ciphertext: { sha256: SHA256_A, bytes: 1000 },
          checksum: { sha256: SHA256_B, bytes: 89 },
          manifest: { sha256: SHA256_A, bytes: 200 },
        },
    remote: {
      root: '/proton/eanhl-backups',
      namespace,
      ciphertext_path: `${namespace}/${n.ciphertext}`,
      checksum_path: `${namespace}/${n.checksum}`,
      manifest_path: `${namespace}/${n.manifest}`,
    },
    local: {
      source_dir: '/data/eanhl-backups/artifacts',
      ciphertext_path: `/data/eanhl-backups/artifacts/${n.ciphertext}`,
      checksum_path: `/data/eanhl-backups/artifacts/${n.checksum}`,
      manifest_path: `/data/eanhl-backups/artifacts/${n.manifest}`,
    },
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expected_sha512: SHA512_A },
    containment: {
      mechanism: 'rlimit_fsize',
      wrapper_executable: '/usr/bin/prlimit',
      wrapper_expected_sha512: SHA512_B,
      ceilings: { ciphertext: 1_000_000, checksum: 4096, manifest: 65_536 },
    },
    workspace: { planned_path: `/var/eanhl-readback/${base}.${attemptId}` },
    refusal: refused ? { step: 'local_validation', code: 'local_triple_incomplete' } : null,
  }
}

function roleEvidence(overrides = {}) {
  return {
    attempted: true,
    observed: 'active_file',
    boundary_code: null,
    termination: 'confirmed',
    bytes: 1000,
    sha256: SHA256_A,
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

function validAttestationFields({ base = BASE, verified = true } = {}) {
  const n = names(base)
  const namespace = `/proton/eanhl-backups/${base}.${ATTEMPT_ID}`
  return {
    cloud_run_id: RUN_ID,
    sequence: 0,
    started_at: STARTED_AT,
    finished_at: FINISHED_AT,
    finish_time_state: 'captured',
    artifact: { base, ...n },
    source_snapshot_ts: '2026-09-04T18:00:07.000Z',
    source_run_id: '20260904T180001Z-0a1b2c3d',
    remote: {
      root: '/proton/eanhl-backups',
      namespace,
      ciphertext_path: `${namespace}/${n.ciphertext}`,
      checksum_path: `${namespace}/${n.checksum}`,
      manifest_path: `${namespace}/${n.manifest}`,
    },
    verdict: verified ? 'verified' : 'indeterminate',
    stage: verified ? null : 'upload',
    code: verified ? null : 'provider_indeterminate',
    role: null,
    containment: 'valid',
    upload_transfer_state: 'unknown',
    upload_outcome: verified
      ? { code: null, failed_step: null, boundary_code: null }
      : {
          code: 'provider_indeterminate',
          failed_step: 'upload_ciphertext',
          boundary_code: 'provider_timeout',
        },
    termination: 'confirmed',
    readback: {
      performed: verified,
      ciphertext: verified ? roleEvidence() : notAttemptedRole(),
      checksum: verified ? roleEvidence({ sha256: SHA256_B }) : notAttemptedRole(),
      manifest: verified ? roleEvidence({ sha256: SHA256_A, bytes: 200 }) : notAttemptedRole(),
    },
    completion: { checked: verified, ok: verified ? true : null },
    cli: { executable: '/opt/eanhl-cloud/bin/proton-drive', expected_sha512: SHA512_A },
    cleanup_policy: {
      disposition: 'after_attestation',
      workspace_path: `/var/eanhl-readback/${base}.${ATTEMPT_ID}`,
    },
  }
}

// ── session establishment ────────────────────────────────────────────────────

test('establishAttemptRecordSession returns an opaque session over a trusted directory', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.equal(typeof session, 'object')
  assert.throws(() => {
    session.x = 1
  }, TypeError)
})

test('establishAttemptRecordSession refuses a missing attestation.dir', () => {
  const sb = sandbox()
  const cfg = configFor(sb)
  cfg.attestation.dir = path.join(sb.dir, 'does-not-exist')
  assert.throws(
    () =>
      production.establishAttemptRecordSession({
        config: cfg,
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
      }),
    (err) => err instanceof BackupError && err.code === 'attestation_dir_untrusted',
  )
})

test('establishAttemptRecordSession refuses a group/world-readable attestation.dir', () => {
  const sb = sandbox()
  fs.chmodSync(sb.attestationDir, 0o750)
  assert.throws(
    () =>
      production.establishAttemptRecordSession({
        config: configFor(sb),
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
      }),
    (err) => err instanceof BackupError && err.code === 'attestation_dir_untrusted',
  )
})

test('a forged session object (not produced by this module) authorizes nothing', () => {
  const sb = sandbox()
  const fake = Object.freeze({})
  assert.throws(
    () => production.writeAttemptIntent({ session: fake, intentFields: validIntentFields() }),
    (err) => err instanceof BackupError && err.code === 'record_session_invalid',
  )
  void configFor(sb)
})

// ── intent + attestation round trip, and the intent/attestation binding ─────

test('a genuine session writes both records, and the attestation confirms the exact intent bytes', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  const intentResult = production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  assert.equal(intentResult.ok, true)
  assert.equal(
    intentResult.path,
    path.join(
      sb.attestationDir,
      buildCloudAttemptIntentFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
    ),
  )
  assert.match(intentResult.sha256, /^[0-9a-f]{64}$/)
  assert.ok(intentResult.bytes > 0)

  const attResult = production.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields(),
  })
  assert.equal(attResult.ok, true)
  assert.equal(attResult.intentRecordConfirmed, true)

  const attestationPath = path.join(
    sb.attestationDir,
    buildAttestationFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const written = JSON.parse(fs.readFileSync(attestationPath, 'utf8'))
  assert.equal(written.intent_record.state, 'confirmed')
  assert.equal(written.intent_record.sha256, intentResult.sha256)
  assert.equal(written.intent_record.bytes, intentResult.bytes)
  assert.equal(written.verdict, 'verified')
})

test('writeAttemptIntent rejects an artifactBase in the payload that differs from the session', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.throws(
    () =>
      production.writeAttemptIntent({
        session,
        intentFields: validIntentFields({ base: 'eanhl-other-20260904T180007Z' }),
      }),
    (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
  )
})

test('writeAttemptAttestation rejects an artifactBase in the payload that differs from the session', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  assert.throws(
    () =>
      production.writeAttemptAttestation({
        session,
        attestationFields: validAttestationFields({ base: 'eanhl-other-20260904T180007Z' }),
      }),
    (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
  )
})

test('a second intent write for the same session fails EEXIST, leaving the first byte-identical', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  const intentPath = path.join(
    sb.attestationDir,
    buildCloudAttemptIntentFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const before = fs.readFileSync(intentPath)
  assert.throws(
    () => production.writeAttemptIntent({ session, intentFields: validIntentFields() }),
    (err) => err instanceof BackupError && err.code === 'cloud_intent_create_failed',
  )
  const after = fs.readFileSync(intentPath)
  assert.ok(before.equals(after))
})

test('a pre-existing symlink at the intent path is refused untouched', () => {
  const sb = sandbox()
  const intentPath = path.join(
    sb.attestationDir,
    buildCloudAttemptIntentFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const elsewhere = path.join(sb.dir, 'elsewhere.json')
  fs.writeFileSync(elsewhere, 'not-a-record')
  fs.symlinkSync(elsewhere, intentPath)
  const before = fs.lstatSync(intentPath)

  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.throws(
    () => production.writeAttemptIntent({ session, intentFields: validIntentFields() }),
    (err) => err instanceof BackupError && err.code === 'cloud_intent_create_failed',
  )
  const after = fs.lstatSync(intentPath)
  assert.equal(after.isSymbolicLink(), true)
  assert.equal(after.ino, before.ino)
  assert.equal(fs.readFileSync(elsewhere, 'utf8'), 'not-a-record')
})

/**
 * Swap the directory at `dirPath` for a genuinely different inode at the
 * exact same pathname. A plain `rmdir` + `mkdir` is NOT reliable for this on
 * every filesystem — this host's allocator was observed handing the freed
 * inode straight back to the very next `mkdir` at the same path, which would
 * make the test pass for the wrong reason (no real identity change at all).
 * Renaming a separately-allocated replacement directory into place is
 * observed to always carry a different inode.
 */
function swapDirectoryIdentity(dirPath) {
  const replacement = `${dirPath}.replacement`
  fs.mkdirSync(replacement, { mode: 0o700 })
  fs.rmSync(dirPath, { recursive: true, force: true })
  fs.renameSync(replacement, dirPath)
}

test('a directory-identity change between session establishment and the first write fails closed', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  const before = fs.lstatSync(sb.attestationDir, { bigint: true })
  swapDirectoryIdentity(sb.attestationDir)
  const after = fs.lstatSync(sb.attestationDir, { bigint: true })
  assert.notEqual(before.ino, after.ino) // confirm the swap actually changed identity
  assert.throws(
    () => production.writeAttemptIntent({ session, intentFields: validIntentFields() }),
    (err) => err instanceof BackupError && err.code === 'attestation_dir_untrusted',
  )
})

test('a directory-identity change between the intent write and the attestation write fails closed', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  const before = fs.lstatSync(sb.attestationDir, { bigint: true })
  swapDirectoryIdentity(sb.attestationDir)
  const after = fs.lstatSync(sb.attestationDir, { bigint: true })
  assert.notEqual(before.ino, after.ino)
  assert.throws(
    () =>
      production.writeAttemptAttestation({ session, attestationFields: validAttestationFields() }),
    (err) => err instanceof BackupError && err.code === 'attestation_dir_untrusted',
  )
})

test('an intent tampered with after its own write is never confirmed, and forces a verified verdict to indeterminate', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  const intentPath = path.join(
    sb.attestationDir,
    buildCloudAttemptIntentFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const original = fs.readFileSync(intentPath, 'utf8')
  fs.chmodSync(intentPath, 0o600)
  fs.rmSync(intentPath)
  fs.writeFileSync(intentPath, original.replace('"sequence":0', '"sequence":1'), { mode: 0o600 })

  const result = production.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields({ verified: true }),
  })
  assert.equal(result.intentRecordConfirmed, false)
  const attestationPath = path.join(
    sb.attestationDir,
    buildAttestationFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const written = JSON.parse(fs.readFileSync(attestationPath, 'utf8'))
  assert.equal(written.intent_record.state, 'not_confirmed')
  assert.equal(written.intent_record.filename, null)
  assert.equal(written.verdict, 'indeterminate')
  assert.equal(written.stage, 'internal')
  assert.equal(written.code, 'intent_record_lost')
  assert.equal(written.future_lock_advice, 'retain_attestation_unconfirmed')
})

test('a disappeared intent (never confirmed) still allows a truthful, indeterminate attestation', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  // No writeAttemptIntent call at all — confirmedIntent stays null.
  const result = production.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields({ verified: true }),
  })
  assert.equal(result.intentRecordConfirmed, false)
})

test('an attestation whose own verdict was already non-verified is not rewritten by an unconfirmed intent', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  const result = production.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields({ verified: false }),
  })
  const attestationPath = path.join(
    sb.attestationDir,
    buildAttestationFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const written = JSON.parse(fs.readFileSync(attestationPath, 'utf8'))
  assert.equal(written.verdict, 'indeterminate')
  assert.equal(written.stage, 'upload') // preserved — not overwritten to 'internal'
  assert.equal(result.intentRecordConfirmed, false)
})

// ── readers ──────────────────────────────────────────────────────────────────

test('readCloudAttemptIntent/readCloudAttestation round-trip what a session wrote, requiring both artifactBase and attemptId', () => {
  const sb = sandbox()
  const cfg = configFor(sb)
  const session = production.establishAttemptRecordSession({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  production.writeAttemptAttestation({ session, attestationFields: validAttestationFields() })

  const intent = production.readCloudAttemptIntent({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.equal(intent.attempt_id, ATTEMPT_ID)
  assert.equal(intent.artifact.base, BASE)

  const attestation = production.readCloudAttestation({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.equal(attestation.verdict, 'verified')

  assert.throws(
    () =>
      production.readCloudAttemptIntent({
        config: cfg,
        artifactBase: BASE,
        attemptId: '20260916T999999Z-ffffffff',
      }),
    (err) => err instanceof BackupError && err.code === 'cloud_record_not_found',
  )
  assert.throws(
    () =>
      production.readCloudAttestation({
        config: cfg,
        artifactBase: 'not-an-identity',
        attemptId: ATTEMPT_ID,
      }),
    (err) => err instanceof BackupError && err.code === 'cloud_attempt_invalid_input',
  )
})

test('a reader refuses a record path that is a symlink, without following it', () => {
  const sb = sandbox()
  const cfg = configFor(sb)
  const session = production.establishAttemptRecordSession({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  production.writeAttemptAttestation({ session, attestationFields: validAttestationFields() })

  // Replace the attestation with a symlink pointing at a perfectly valid
  // record living OUTSIDE the trusted directory.
  const attestationPath = path.join(
    sb.attestationDir,
    buildAttestationFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const outside = path.join(sb.dir, 'outside-attestation.json')
  fs.writeFileSync(outside, fs.readFileSync(attestationPath), { mode: 0o600 })
  fs.rmSync(attestationPath)
  fs.symlinkSync(outside, attestationPath)

  assert.throws(
    () =>
      production.readCloudAttestation({ config: cfg, artifactBase: BASE, attemptId: ATTEMPT_ID }),
    (err) => err instanceof BackupError && err.code === 'cloud_record_unreadable',
  )
  assert.equal(fs.lstatSync(attestationPath).isSymbolicLink(), true) // left exactly as found
})

test('a reader refuses a record whose mode or owner is not what a record writer produces', () => {
  const sb = sandbox()
  const cfg = configFor(sb)
  const session = production.establishAttemptRecordSession({
    config: cfg,
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  production.writeAttemptIntent({ session, intentFields: validIntentFields() })
  const intentPath = path.join(
    sb.attestationDir,
    buildCloudAttemptIntentFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  fs.chmodSync(intentPath, 0o640)
  assert.throws(
    () =>
      production.readCloudAttemptIntent({ config: cfg, artifactBase: BASE, attemptId: ATTEMPT_ID }),
    (err) => err instanceof BackupError && err.code === 'cloud_record_unreadable',
  )
})

// ── FACTORY-route fault injection ───────────────────────────────────────────

function realDepsWith(overrides) {
  return { ...REAL_ATTESTATION_RECORDS_DEPS, ...overrides }
}

test('a native close failure on the create descriptor is sanitized and never masks a real error', () => {
  const sb = sandbox()
  let closeCalls = 0
  const deps = realDepsWith({
    close: (fd) => {
      closeCalls += 1
      if (closeCalls === 1) throw new Error('native close detail that must never escape')
      return REAL_ATTESTATION_RECORDS_DEPS.close(fd)
    },
  })
  const records = makeAttestationRecords(deps)
  const session = records.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  let caught = null
  try {
    records.writeAttemptIntent({ session, intentFields: validIntentFields() })
  } catch (err) {
    caught = err
  }
  assert.ok(caught instanceof BackupError)
  assert.equal(caught.code, 'cloud_intent_durability_unconfirmed')
  assert.equal(caught.message.includes('native close detail'), false)
})

test('a close failure never overrides an already-pending classified error', () => {
  const sb = sandbox()
  const deps = realDepsWith({
    fstat: (fd) => {
      const st = REAL_ATTESTATION_RECORDS_DEPS.fstat(fd)
      // Force the post-write identity check to fail (wrong size), so a
      // classified error is already pending before this call's own `finally`
      // attempts to close.
      return { ...st, size: st.size + 999n }
    },
    close: () => {
      throw new Error('a close failure that must not replace the pending error')
    },
  })
  const records = makeAttestationRecords(deps)
  const session = records.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.throws(
    () => records.writeAttemptIntent({ session, intentFields: validIntentFields() }),
    (err) => err instanceof BackupError && err.code === 'cloud_intent_durability_unconfirmed',
  )
})

test('a created-file pathname replacement is detected by dev/ino comparison, not just size', () => {
  const sb = sandbox()
  let swapped = false
  const intentPath = path.join(
    sb.attestationDir,
    buildCloudAttemptIntentFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  const deps = realDepsWith({
    lstat: (p) => {
      if (!swapped && p === intentPath) {
        swapped = true
        // Same bytes, but a genuinely different inode: writing straight back
        // to the same path was observed to reuse the just-freed inode on
        // this filesystem, which would silently defeat the test. Allocating
        // the replacement at a separate path first, then renaming it into
        // place, is observed to always carry a different inode.
        const payload = fs.readFileSync(p)
        const replacement = `${p}.replacement`
        fs.writeFileSync(replacement, payload, { mode: 0o600 })
        fs.rmSync(p)
        fs.renameSync(replacement, p)
      }
      return REAL_ATTESTATION_RECORDS_DEPS.lstat(p)
    },
  })
  const records = makeAttestationRecords(deps)
  const session = records.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.throws(
    () => records.writeAttemptIntent({ session, intentFields: validIntentFields() }),
    (err) => err instanceof BackupError && err.code === 'cloud_intent_durability_unconfirmed',
  )
  assert.equal(swapped, true)
})

test('the serialized-size ceiling is enforced before anything is created', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  const fields = validIntentFields()
  fields.local.source_dir = '/x'.repeat(CLOUD_RECORD_CEILING_BYTES)
  assert.throws(
    () => production.writeAttemptIntent({ session, intentFields: fields }),
    (err) => err instanceof BackupError && err.code === 'cloud_intent_create_failed',
  )
  const intentPath = path.join(
    sb.attestationDir,
    buildCloudAttemptIntentFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )
  assert.equal(fs.existsSync(intentPath), false)
})

// ── factory-private sessions ─────────────────────────────────────────────────

test('a session from one factory instance is refused by another, even with an identical visible shape', () => {
  const sb = sandbox()
  const a = makeAttestationRecords(REAL_ATTESTATION_RECORDS_DEPS)
  const b = makeAttestationRecords(REAL_ATTESTATION_RECORDS_DEPS)
  const args = { config: configFor(sb), artifactBase: BASE, attemptId: ATTEMPT_ID }
  const sessionA = a.establishAttemptRecordSession(args)
  const sessionB = b.establishAttemptRecordSession(args)
  // Identical visible shape: both are empty frozen objects.
  assert.deepEqual(Object.keys(sessionA), Object.keys(sessionB))
  assert.equal(Object.isFrozen(sessionA), Object.isFrozen(sessionB))

  const refused = (err) => err instanceof BackupError && err.code === 'record_session_invalid'
  assert.throws(
    () => b.writeAttemptIntent({ session: sessionA, intentFields: validIntentFields() }),
    refused,
  )
  assert.throws(
    () =>
      b.writeAttemptAttestation({ session: sessionA, attestationFields: validAttestationFields() }),
    refused,
  )
  assert.throws(
    () => production.writeAttemptIntent({ session: sessionA, intentFields: validIntentFields() }),
    refused,
  )
  assert.deepEqual(fs.readdirSync(sb.attestationDir), []) // nothing written by a refused session
  // …while each instance still honours its OWN session.
  assert.equal(
    b.writeAttemptIntent({ session: sessionB, intentFields: validIntentFields() }).ok,
    true,
  )
})

// ── closed vocabularies and cross-field coherence ────────────────────────────

/** A valid, NON-verified attestation that stopped at readback (manifest timed out). */
function readbackStoppedFields() {
  const f = validAttestationFields({ verified: true })
  return {
    ...f,
    verdict: 'indeterminate',
    stage: 'readback',
    code: 'provider_timeout',
    role: 'manifest',
    readback: {
      performed: true,
      manifest: roleEvidence({
        observed: 'active_file',
        boundary_code: 'provider_timeout',
        bytes: null,
        sha256: null,
        matches_source: null,
      }),
      checksum: notAttemptedRole(),
      ciphertext: notAttemptedRole(),
    },
    completion: { checked: false, ok: null },
  }
}

function sessionWithIntent(sb, records = production) {
  const session = records.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  records.writeAttemptIntent({ session, intentFields: validIntentFields() })
  return session
}

const attestationPathFor = (sb) =>
  path.join(
    sb.attestationDir,
    buildAttestationFileName({ artifactBase: BASE, attemptId: ATTEMPT_ID }),
  )

function assertAttestationRefused(fields, label) {
  const sb = sandbox()
  const session = sessionWithIntent(sb)
  assert.throws(
    () => production.writeAttemptAttestation({ session, attestationFields: fields }),
    (err) => err instanceof BackupError && err.code === 'cloud_attestation_schema_invalid',
    label,
  )
  assert.equal(fs.existsSync(attestationPathFor(sb)), false, `${label}: nothing written`)
}

function mutate(base, fn) {
  const copy = JSON.parse(JSON.stringify(base))
  fn(copy)
  return copy
}

test('the readback-stopped fixture is itself a valid record (control for the adversarial cases)', () => {
  const sb = sandbox()
  const session = sessionWithIntent(sb)
  const r = production.writeAttemptAttestation({
    session,
    attestationFields: readbackStoppedFields(),
  })
  assert.equal(r.attestation.stage, 'readback')
  assert.equal(r.attestation.future_lock_advice, 'release')
})

test('SCHEMA: a non-member of any closed vocabulary is refused, and nothing is written', () => {
  const V = () => validAttestationFields({ verified: false }) // indeterminate at upload
  const R = readbackStoppedFields
  const cases = [
    ['top-level code', mutate(V(), (f) => (f.code = 'provider_indeterminate_x'))],
    ['a code from another stage', mutate(V(), (f) => (f.code = 'capacity_insufficient'))],
    ['upload_outcome.code', mutate(V(), (f) => (f.upload_outcome.code = 'made_up'))],
    [
      'upload_outcome.failed_step',
      mutate(V(), (f) => (f.upload_outcome.failed_step = 'upload_all')),
    ],
    [
      'upload_outcome.boundary_code',
      mutate(V(), (f) => (f.upload_outcome.boundary_code = 'said_so')),
    ],
    ['per-role boundary_code', mutate(R(), (f) => (f.readback.manifest.boundary_code = 'said_so'))],
    ['per-role observed', mutate(R(), (f) => (f.readback.manifest.observed = 'kinda'))],
    ['per-role termination', mutate(R(), (f) => (f.readback.manifest.termination = 'probably'))],
    ['verdict', mutate(V(), (f) => (f.verdict = 'maybe'))],
    ['stage', mutate(V(), (f) => (f.stage = 'somewhere'))],
    ['report-only stage attestation', mutate(V(), (f) => (f.stage = 'attestation'))],
    [
      'report-only stage attestation_dir_trust',
      mutate(V(), (f) => (f.stage = 'attestation_dir_trust')),
    ],
    ['finish_time_state', mutate(V(), (f) => (f.finish_time_state = 'later'))],
    ['containment', mutate(V(), (f) => (f.containment = 'sort_of'))],
    ['termination', mutate(V(), (f) => (f.termination = 'probably'))],
    ['upload_transfer_state', mutate(V(), (f) => (f.upload_transfer_state = 'some'))],
    ['cleanup disposition', mutate(V(), (f) => (f.cleanup_policy.disposition = 'eventually'))],
    ['role', mutate(R(), (f) => (f.role = 'sidecar'))],
  ]
  for (const [label, fields] of cases) assertAttestationRefused(fields, label)
})

test('SCHEMA: contradictory combinations are refused, and nothing is written', () => {
  const V = () => validAttestationFields({ verified: false })
  const OK = () => validAttestationFields({ verified: true })
  const R = readbackStoppedFields
  const cases = [
    // finish time
    [
      'unavailable finish time without clock_unusable',
      mutate(V(), (f) => {
        f.finish_time_state = 'unavailable'
        f.finished_at = null
      }),
    ],
    [
      'clock_unusable with a captured finish time',
      mutate(V(), (f) => {
        f.stage = 'internal'
        f.code = 'clock_unusable'
      }),
    ],
    // verified requires complete, successful evidence
    [
      'verified with an unmatched role',
      mutate(OK(), (f) => (f.readback.checksum.matches_source = false)),
    ],
    ['verified with a failed completion check', mutate(OK(), (f) => (f.completion.ok = false))],
    [
      'verified with definitely-zero transfer',
      mutate(OK(), (f) => (f.upload_transfer_state = 'definitely_zero')),
    ],
    ['verified with containment not valid', mutate(OK(), (f) => (f.containment = 'not_checked'))],
    [
      'verified without source identity',
      mutate(OK(), (f) => {
        f.source_snapshot_ts = null
        f.source_run_id = null
      }),
    ],
    [
      'verified with no cleanup policy',
      mutate(OK(), (f) => {
        f.cleanup_policy.disposition = 'not_applicable'
        f.cleanup_policy.workspace_path = null
      }),
    ],
    // rejection must be definite
    [
      'cancellation recorded as rejected',
      mutate(V(), (f) => {
        f.verdict = 'rejected'
        f.code = 'attempt_cancelled'
        f.upload_outcome.code = 'attempt_cancelled'
        f.upload_transfer_state = 'definitely_zero'
      }),
    ],
    [
      'a rejection code recorded as indeterminate',
      mutate(V(), (f) => {
        f.code = 'remote_root_absent'
        f.upload_outcome.code = 'remote_root_absent'
      }),
    ],
    [
      'an upload rejection with ambiguous (unknown) transfer',
      mutate(V(), (f) => {
        f.verdict = 'rejected'
        f.code = 'provider_rejected'
        f.upload_outcome.code = 'provider_rejected'
        f.upload_transfer_state = 'unknown'
      }),
    ],
    [
      'a definite rejection while a child may be alive',
      mutate(R(), (f) => {
        f.verdict = 'rejected'
        f.code = 'remote_object_absent'
        f.readback.manifest = roleEvidence({
          observed: 'absent',
          bytes: null,
          sha256: null,
          matches_source: null,
        })
        f.termination = 'unconfirmed'
        f.cleanup_policy.disposition = 'withheld_termination_unconfirmed'
      }),
    ],
    // containment / termination / cleanup / lock agreement
    [
      'containment checked at the intent stage',
      mutate(V(), (f) => {
        f.stage = 'intent'
        f.code = 'cloud_intent_create_failed'
        f.upload_outcome = { code: null, failed_step: null, boundary_code: null }
        f.upload_transfer_state = 'definitely_zero'
        f.termination = 'not_applicable'
        f.cleanup_policy = { disposition: 'not_applicable', workspace_path: null }
      }),
    ],
    [
      'withheld cleanup with confirmed termination',
      mutate(V(), (f) => (f.cleanup_policy.disposition = 'withheld_termination_unconfirmed')),
    ],
    [
      'unconfirmed termination without withheld cleanup',
      mutate(V(), (f) => (f.termination = 'unconfirmed')),
    ],
    [
      'no cleanup policy although a workspace may exist',
      mutate(V(), (f) => {
        f.cleanup_policy.disposition = 'not_applicable'
        f.cleanup_policy.workspace_path = null
      }),
    ],
    [
      'a cleanup policy with no workspace path',
      mutate(V(), (f) => (f.cleanup_policy.workspace_path = null)),
    ],
    [
      'a workspace path for a different attempt',
      mutate(
        V(),
        (f) =>
          (f.cleanup_policy.workspace_path = `/var/eanhl-readback/${BASE}.20260916T000000Z-00000000`),
      ),
    ],
    [
      'a role reports unconfirmed termination but the record says confirmed',
      mutate(R(), (f) => {
        f.code = 'provider_termination_unconfirmed'
        f.readback.manifest.boundary_code = 'provider_termination_unconfirmed'
        f.readback.manifest.termination = 'unconfirmed'
      }),
    ],
    [
      'a role termination unconfirmed without its boundary code',
      mutate(R(), (f) => (f.readback.manifest.termination = 'unconfirmed')),
    ],
    // readback performed ⇔ per-role attempts
    [
      'readback not performed but a role attempted',
      mutate(V(), (f) => (f.readback.manifest = roleEvidence())),
    ],
    [
      'roles out of order',
      mutate(R(), (f) => {
        f.readback.manifest = notAttemptedRole()
        f.readback.checksum = roleEvidence({
          boundary_code: 'provider_timeout',
          bytes: null,
          sha256: null,
          matches_source: null,
        })
      }),
    ],
    ['the stop role disagrees with role', mutate(R(), (f) => (f.role = 'ciphertext'))],
    ['a role attempted after the stop', mutate(R(), (f) => (f.readback.checksum = roleEvidence()))],
    [
      'completion checked though a role stopped',
      mutate(R(), (f) => (f.completion = { checked: true, ok: false })),
    ],
    ['a measured role without a hash', mutate(OK(), (f) => (f.readback.manifest.sha256 = null))],
    [
      'stage readback without performing it',
      mutate(R(), (f) => {
        f.readback.performed = false
        f.readback.manifest = notAttemptedRole()
      }),
    ],
    // top-level vs nested upload outcome
    [
      'top code differs from the upload outcome code',
      mutate(V(), (f) => (f.upload_outcome.code = 'provider_call_failed')),
    ],
    [
      'an upload outcome code without its failed step',
      mutate(V(), (f) => (f.upload_outcome.failed_step = null)),
    ],
    [
      'an upload-stage record with no upload outcome',
      mutate(
        V(),
        (f) => (f.upload_outcome = { code: null, failed_step: null, boundary_code: null }),
      ),
    ],
    ['a role at a non-readback stage', mutate(V(), (f) => (f.role = 'manifest'))],
    [
      'a pre-upload stage carrying upload evidence',
      mutate(V(), (f) => {
        f.stage = 'capacity'
        f.code = 'capacity_insufficient'
        f.termination = 'not_applicable'
        f.cleanup_policy = { disposition: 'not_applicable', workspace_path: null }
      }),
    ],
    // identity coherence
    [
      'a non-canonical remote namespace',
      mutate(V(), (f) => (f.remote.namespace = '/proton/eanhl-backups/elsewhere')),
    ],
    [
      'an artifact name not derived from its base',
      mutate(V(), (f) => (f.artifact.checksum = 'other.sha256')),
    ],
    [
      'a local refusal carrying source evidence',
      mutate(V(), (f) => {
        f.stage = 'local_refusal'
        f.code = 'local_file_empty'
        f.verdict = 'rejected'
        f.upload_outcome = {
          code: 'local_file_empty',
          failed_step: 'local_validation',
          boundary_code: null,
        }
        f.upload_transfer_state = 'definitely_zero'
        f.containment = 'not_checked'
        f.termination = 'not_applicable'
        f.cleanup_policy = { disposition: 'not_applicable', workspace_path: null }
      }),
    ],
  ]
  for (const [label, fields] of cases) assertAttestationRefused(fields, label)
})

test('SCHEMA: an intent with a non-member or contradictory field is refused, and nothing is written', () => {
  const I = () => validIntentFields({ refused: true })
  const C = () => validIntentFields()
  const cases = [
    [
      'refusal code that is not a local refusal',
      mutate(I(), (f) => (f.refusal.code = 'provider_rejected')),
    ],
    [
      'refusal step that is not local validation',
      mutate(I(), (f) => (f.refusal.step = 'upload_manifest')),
    ],
    ['captured source over its role ceiling', mutate(C(), (f) => (f.source.checksum.bytes = 4097))],
    ['captured source of zero bytes', mutate(C(), (f) => (f.source.ciphertext.bytes = 0))],
    [
      'a non-canonical remote path',
      mutate(C(), (f) => (f.remote.manifest_path = '/proton/eanhl-backups/x.json')),
    ],
    [
      'a workspace path for another attempt',
      mutate(C(), (f) => (f.workspace.planned_path = '/var/x')),
    ],
    ['an unknown containment mechanism', mutate(C(), (f) => (f.containment.mechanism = 'hope'))],
  ]
  for (const [label, fields] of cases) {
    const sb = sandbox()
    const session = production.establishAttemptRecordSession({
      config: configFor(sb),
      artifactBase: BASE,
      attemptId: ATTEMPT_ID,
    })
    assert.throws(
      () => production.writeAttemptIntent({ session, intentFields: fields }),
      (err) => err instanceof BackupError && err.code === 'cloud_intent_schema_invalid',
      label,
    )
    assert.deepEqual(fs.readdirSync(sb.attestationDir), [], label)
  }
})

test('SCHEMA: the lock advice is DERIVED — a caller-supplied future_lock_advice is never honoured', () => {
  const sb = sandbox()
  const session = sessionWithIntent(sb)
  const r = production.writeAttemptAttestation({
    session,
    attestationFields: {
      ...validAttestationFields({ verified: false }),
      future_lock_advice: 'retain_internal_error',
    },
  })
  assert.equal(r.attestation.future_lock_advice, 'release')
  assert.equal(JSON.parse(fs.readFileSync(r.path, 'utf8')).future_lock_advice, 'release')
})

test('the returned attestation is the deep-frozen effective record, byte-for-byte what is on disk', () => {
  const sb = sandbox()
  const session = sessionWithIntent(sb)
  const r = production.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields(),
  })
  assert.deepEqual(r.attestation, JSON.parse(fs.readFileSync(r.path, 'utf8')))
  assert.ok(Object.isFrozen(r.attestation))
  assert.ok(Object.isFrozen(r.attestation.readback.manifest))
  assert.ok(Object.isFrozen(r))
})

test('a record file holding a contradictory attestation is refused by the reader', () => {
  const sb = sandbox()
  const session = sessionWithIntent(sb)
  const r = production.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields(),
  })
  const tampered = JSON.parse(fs.readFileSync(r.path, 'utf8'))
  tampered.completion.ok = false // verified, yet completion failed
  fs.rmSync(r.path)
  fs.writeFileSync(r.path, JSON.stringify(tampered), { mode: 0o600 })
  assert.throws(
    () =>
      production.readCloudAttestation({
        config: configFor(sb),
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
      }),
    (err) => err instanceof BackupError && err.code === 'cloud_attestation_schema_invalid',
  )
})

// ── resource handling: revalidation and readers ─────────────────────────────

test('REVALIDATION: a close failure on the intent re-read never yields a confirmed intent', () => {
  const sb = sandbox()
  let failNextClose = false
  const records = makeAttestationRecords(
    realDepsWith({
      close: (fd) => {
        REAL_ATTESTATION_RECORDS_DEPS.close(fd) // the descriptor IS released…
        if (failNextClose) {
          failNextClose = false
          throw new Error(`native close detail ${SHA512_A}`) // …but the close reports failure
        }
      },
    }),
  )
  const session = sessionWithIntent(sb, records)
  failNextClose = true // the FIRST close inside writeAttemptAttestation is the revalidation read's
  const r = records.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields(),
  })
  assert.equal(r.intentRecordConfirmed, false)
  assert.equal(r.attestation.intent_record.state, 'not_confirmed')
  assert.equal(r.attestation.verdict, 'indeterminate')
  assert.equal(r.attestation.code, 'intent_record_lost')
  assert.equal(fs.readFileSync(r.path, 'utf8').includes('native close detail'), false)
})

test('REVALIDATION: a directory identity change observed AFTER the intent re-read is never confirmed', () => {
  const sb = sandbox()
  let armed = false
  let spoofNextDirLstat = false
  const records = makeAttestationRecords(
    realDepsWith({
      read: (fd, buf, offset) => {
        const n = REAL_ATTESTATION_RECORDS_DEPS.read(fd, buf, offset)
        if (armed && n === 0) {
          armed = false
          spoofNextDirLstat = true // the read finished; now the directory "changes"
        }
        return n
      },
      lstat: (p) => {
        const st = REAL_ATTESTATION_RECORDS_DEPS.lstat(p)
        if (spoofNextDirLstat && p === sb.attestationDir) {
          spoofNextDirLstat = false
          return Object.create(st, { ino: { value: st.ino + 1n } })
        }
        return st
      },
    }),
  )
  const session = sessionWithIntent(sb, records)
  armed = true
  const r = records.writeAttemptAttestation({
    session,
    attestationFields: validAttestationFields(),
  })
  assert.equal(r.intentRecordConfirmed, false)
  assert.equal(r.attestation.intent_record.state, 'not_confirmed')
  assert.equal(r.attestation.code, 'intent_record_lost')
})

test('READER: open/fstat/read/close/lstat failures are sanitized closed codes, never native text', () => {
  const NATIVE = 'native-reader-detail-7f3a'
  const nativeError = (code) => Object.assign(new Error(`${NATIVE} /secret/path`), { code })
  for (const [label, overrides, expectedCode] of [
    [
      'open',
      {
        open: () => {
          throw nativeError('EACCES')
        },
      },
      'cloud_record_unreadable',
    ],
    [
      'fstat',
      {
        fstat: () => {
          throw nativeError('EIO')
        },
      },
      'cloud_record_unreadable',
    ],
    [
      'read',
      {
        read: () => {
          throw nativeError('EIO')
        },
      },
      'cloud_record_unreadable',
    ],
    [
      'close',
      {
        close: (fd) => {
          REAL_ATTESTATION_RECORDS_DEPS.close(fd)
          throw nativeError('EIO')
        },
      },
      'cloud_record_unreadable',
    ],
    [
      'lstat (not ENOENT)',
      {
        lstat: (p) =>
          p.endsWith('.json')
            ? (() => {
                throw nativeError('EACCES')
              })()
            : REAL_ATTESTATION_RECORDS_DEPS.lstat(p),
      },
      'cloud_record_unreadable',
    ],
  ]) {
    const sb = sandbox()
    // Write with REAL deps, then read through a reader whose dependency fails.
    const writer = makeAttestationRecords(REAL_ATTESTATION_RECORDS_DEPS)
    sessionWithIntent(sb, writer)
    const reader = makeAttestationRecords(realDepsWith(overrides))
    let caught = null
    try {
      reader.readCloudAttemptIntent({
        config: configFor(sb),
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
      })
    } catch (err) {
      caught = err
    }
    assert.ok(caught instanceof BackupError, label)
    assert.equal(caught.code, expectedCode, label)
    assert.equal(caught.message.includes(NATIVE), false, label)
    assert.equal(caught.cause, undefined, label)
  }
})

test('READER: a missing record is not_found only on a definite ENOENT', () => {
  const sb = sandbox()
  const reader = makeAttestationRecords(REAL_ATTESTATION_RECORDS_DEPS)
  assert.throws(
    () =>
      reader.readCloudAttestation({
        config: configFor(sb),
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
      }),
    (err) => err instanceof BackupError && err.code === 'cloud_record_not_found',
  )
})

test('READER: a directory identity change during the read is refused after reading', () => {
  const sb = sandbox()
  sessionWithIntent(sb, makeAttestationRecords(REAL_ATTESTATION_RECORDS_DEPS))
  let reads = 0
  let dirLstats = 0
  const reader = makeAttestationRecords(
    realDepsWith({
      read: (fd, buf, offset) => {
        reads += 1
        return REAL_ATTESTATION_RECORDS_DEPS.read(fd, buf, offset)
      },
      lstat: (p) => {
        const st = REAL_ATTESTATION_RECORDS_DEPS.lstat(p)
        if (p === sb.attestationDir) {
          dirLstats += 1
          if (reads > 0) return Object.create(st, { ino: { value: st.ino + 1n } })
        }
        return st
      },
    }),
  )
  assert.throws(
    () =>
      reader.readCloudAttemptIntent({
        config: configFor(sb),
        artifactBase: BASE,
        attemptId: ATTEMPT_ID,
      }),
    (err) => err instanceof BackupError && err.code === 'attestation_dir_untrusted',
  )
  assert.ok(reads > 0)
  assert.ok(dirLstats >= 2) // trusted before, re-verified after
})

test('READER: a returned record is deeply frozen', () => {
  const sb = sandbox()
  sessionWithIntent(sb)
  const intent = production.readCloudAttemptIntent({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  assert.ok(Object.isFrozen(intent))
  assert.ok(Object.isFrozen(intent.source.ciphertext))
})

// ── deep freeze / closed export surface ─────────────────────────────────────

test('production API: the closed export surface', () => {
  assert.deepEqual(Object.keys(production).sort(), [
    'CLOUD_ATTEMPT_BOUNDARY_CODES',
    'CLOUD_ATTEMPT_CODES',
    'CLOUD_ATTEMPT_CODES_BY_STAGE',
    'CLOUD_ATTEMPT_INTENT_KIND',
    'CLOUD_ATTEMPT_INTENT_SCHEMA_VERSION',
    'CLOUD_ATTEMPT_REJECTED_CODES',
    'CLOUD_ATTEMPT_STAGES',
    'CLOUD_ATTESTATION_KIND',
    'CLOUD_ATTESTATION_SCHEMA_VERSION',
    'CLOUD_RECORD_CEILING_BYTES',
    'establishAttemptRecordSession',
    'readCloudAttemptIntent',
    'readCloudAttestation',
    'writeAttemptAttestation',
    'writeAttemptIntent',
  ])
  assert.equal(production.CLOUD_ATTEMPT_INTENT_SCHEMA_VERSION, 1)
  assert.equal(production.CLOUD_ATTESTATION_SCHEMA_VERSION, 1)
  assert.equal(production.CLOUD_RECORD_CEILING_BYTES, 16 * 1024)
})

test('a session passed to the production wrapper accepts no deps override', () => {
  const sb = sandbox()
  const session = production.establishAttemptRecordSession({
    config: configFor(sb),
    artifactBase: BASE,
    attemptId: ATTEMPT_ID,
  })
  // A `deps` property on the argument object must be inert.
  const result = production.writeAttemptIntent({
    session,
    intentFields: validIntentFields(),
    deps: { open: () => 999999 },
  })
  assert.equal(result.ok, true)
})
