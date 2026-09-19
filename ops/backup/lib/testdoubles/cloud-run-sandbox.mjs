/**
 * TEST SUPPORT — a disposable, real-filesystem sandbox for E3J6C run and
 * entrypoint tests: a real published artifact triple, trusted (0700) run-lock,
 * attestation, and readback directories, a launcher for the FAKE Proton CLI
 * (`fake-proton-drive.mjs`, never the real CLI), and a config whose CLI and
 * wrapper pins are the real SHA-512 of those local files.
 *
 * **Nothing here contacts a provider, reads a credential, or runs the real
 * Proton Drive CLI.** The readback wrapper is the host's own `/usr/bin/prlimit`
 * when present; callers skip real-wrapper tests when it is not.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MANIFEST_SCHEMA_VERSION, formatChecksumSidecar } from '../backup-artifact-contract.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FAKE_PROTON = path.join(HERE, 'fake-proton-drive.mjs')
export const REAL_PRLIMIT = '/usr/bin/prlimit'
export const HAS_REAL_PRLIMIT = (() => {
  try {
    fs.accessSync(REAL_PRLIMIT, fs.constants.X_OK)
    return fs.statSync(REAL_PRLIMIT).isFile()
  } catch {
    return false
  }
})()

export const ROOT = '/proton/eanhl-backups'
export const BASE = 'eanhl-test-20260904T180007Z'
export const ROLES = Object.freeze(['ciphertext', 'checksum', 'manifest'])
export const SUFFIX = Object.freeze({
  ciphertext: '.dump.age',
  checksum: '.dump.age.sha256',
  manifest: '.manifest.json',
})
const SOURCE_RUN_ID = '20260904T180001Z-0a1b2c3d'
const SNAPSHOT_TS = '2026-09-04T18:00:07Z'

export const sha512File = (p) => createHash('sha512').update(fs.readFileSync(p)).digest('hex')
const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`

/** A trusted directory: created 0700 and chmod'ed so umask cannot widen it. */
function trustedDir(p) {
  fs.mkdirSync(p, { mode: 0o700 })
  fs.chmodSync(p, 0o700)
  return p
}

/**
 * @param {object} [opts]
 * @param {Buffer} [opts.ciphertext]
 * @param {object} [opts.retry]      overrides for `retry`
 * @param {object} [opts.run]        overrides for `run` timings
 * @param {string} [opts.wrapper]    an alternative pinned readback wrapper executable
 */
export function makeCloudRunSandbox(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-cloud-run-'))
  fs.chmodSync(dir, 0o700)
  const artifacts = trustedDir(path.join(dir, 'artifacts'))
  const attestationDir = trustedDir(path.join(dir, 'attest'))
  const readbackDir = trustedDir(path.join(dir, 'readback'))
  const lockDir = trustedDir(path.join(dir, 'run'))
  const lockFile = path.join(lockDir, 'uploader.lock')
  const bin = trustedDir(path.join(dir, 'bin'))
  const control = path.join(dir, 'control')
  fs.mkdirSync(path.join(control, 'markers'), { recursive: true })

  const ciphertext = opts.ciphertext ?? Buffer.alloc(1000, 7)
  const files = Object.fromEntries(
    ROLES.map((r) => [r, path.join(artifacts, `${BASE}${SUFFIX[r]}`)]),
  )
  const hash = createHash('sha256').update(ciphertext).digest('hex')
  fs.writeFileSync(files.ciphertext, ciphertext)
  fs.writeFileSync(files.checksum, formatChecksumSidecar(hash, `${BASE}.dump.age`))
  fs.writeFileSync(
    files.manifest,
    JSON.stringify({
      schema_version: MANIFEST_SCHEMA_VERSION,
      artifact: `${BASE}.dump.age`,
      run_id: SOURCE_RUN_ID,
      snapshot_ts: SNAPSHOT_TS,
      ciphertext: { sha256: hash, bytes: ciphertext.length },
    }),
  )
  const bodies = Object.fromEntries(ROLES.map((r) => [r, fs.readFileSync(files[r])]))

  const launcher = path.join(bin, 'proton-drive')
  fs.writeFileSync(
    launcher,
    `#!/bin/sh\nFAKE_PROTON_CONTROL_DIR=${shellQuote(control)} exec ${process.execPath} ${FAKE_PROTON} "$@"\n`,
    { mode: 0o755 },
  )
  const wrapper = opts.wrapper ?? REAL_PRLIMIT
  const config = {
    cli: { executable: launcher, expectedSha512: sha512File(launcher) },
    credentials: { backend: 'pass' },
    remote: { root: ROOT },
    artifact: { sourceDir: artifacts },
    attestation: { dir: attestationDir },
    readback: {
      dir: readbackDir,
      maxCiphertextBytes: 1_000_000,
      maxManifestBytes: 65_536,
      maxSidecarBytes: 4096,
      containment: 'rlimit_fsize',
      rlimitWrapper: {
        executable: wrapper,
        expectedSha512: fs.existsSync(wrapper) ? sha512File(wrapper) : '0'.repeat(128),
      },
    },
    run: { lockFile, operationTimeoutMs: 10_000, cancelGraceMs: 1_000, ...(opts.run ?? {}) },
    retry: {
      maxAttemptsPerArtifactPerRun: 2,
      backoffMs: 1,
      maxTotalAttemptsPerRun: 2,
      ...(opts.retry ?? {}),
    },
    capacity: { minFreeBytes: 1, backingVolume: null },
  }
  const configPath = path.join(dir, 'cloud.json')
  const writeConfig = (cfg = config) => {
    fs.writeFileSync(configPath, JSON.stringify(cfg), { mode: 0o600 })
    return configPath
  }
  writeConfig()

  const respond = (sequence) =>
    fs.writeFileSync(path.join(control, 'response.json'), JSON.stringify({ sequence }))
  const argvLog = () => {
    try {
      return fs
        .readFileSync(path.join(control, 'argv.log'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }
  const invocations = () => {
    try {
      return Number(fs.readFileSync(path.join(control, 'invocation-count'), 'utf8')) || 0
    } catch {
      return 0
    }
  }
  const records = (suffix) =>
    fs
      .readdirSync(attestationDir)
      .filter((n) => n.endsWith(suffix))
      .sort()
  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }

  return {
    dir,
    artifacts,
    attestationDir,
    readbackDir,
    lockDir,
    lockFile,
    bin,
    control,
    files,
    bodies,
    launcher,
    config,
    configPath,
    writeConfig,
    respond,
    argvLog,
    invocations,
    records,
    cleanup,
  }
}

// ── raw fake-CLI response shapes (the evidenced/hypothesized CLI JSON) ────────

export const rawInfo = (nodeKind, nodeUid) =>
  JSON.stringify({
    nodeUid,
    nodeKind,
    state: 'active',
    activeRevisionUid: null,
    claimedSize: null,
    claimedDigests: { sha1: null },
    sha1Verified: null,
  })

export const rawTransfer = (bytes) =>
  JSON.stringify({
    transferredItems: 1,
    transferredBytes: bytes,
    skippedItems: 0,
    failedItems: 0,
    failures: [],
  })

export const NOT_FOUND = Object.freeze({ notFoundForQueriedBasename: true })

/** The anchored, definite-zero-transfer upload refusal for `basename`. */
export function nameConflictStep(basename) {
  return {
    stdout: JSON.stringify({
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
    }),
    exitCode: 1,
  }
}

/** The full scripted sequence of one VERIFIED attempt: the E3J5 upload flow, then E3J6B readback. */
export function verifiedAttemptSteps(bodies) {
  const size = (r) => bodies[r].length
  const downloadStep = (r) => ({
    downloadWrite: { base64: bodies[r].toString('base64') },
    stdout: rawTransfer(size(r)),
  })
  return [
    { stdout: rawInfo('folder', 'root~uid') }, // info root
    NOT_FOUND, // info namespace
    { stdout: JSON.stringify({ created: true, folderUid: 'ns~uid' }) }, // create-folder
    { stdout: rawInfo('folder', 'ns~uid') }, // confirm namespace
    NOT_FOUND,
    NOT_FOUND,
    NOT_FOUND, // the three object preflights
    { stdout: rawTransfer(size('ciphertext')) },
    { stdout: rawTransfer(size('checksum')) },
    { stdout: rawTransfer(size('manifest')) },
    { stdout: rawInfo('file', 'mf~uid') },
    downloadStep('manifest'),
    { stdout: rawInfo('file', 'cs~uid') },
    downloadStep('checksum'),
    { stdout: rawInfo('file', 'ct~uid') },
    downloadStep('ciphertext'),
  ]
}

/** An attempt that stops at the ciphertext OBJECT preflight: the path is occupied (R1 collision). */
export function objectOccupiedSteps() {
  return [
    { stdout: rawInfo('folder', 'root~uid') },
    NOT_FOUND,
    { stdout: JSON.stringify({ created: true, folderUid: 'ns1~uid' }) },
    { stdout: rawInfo('folder', 'ns1~uid') },
    { stdout: rawInfo('file', 'squatter~uid') }, // ciphertext path already present
  ]
}

/** An attempt whose ciphertext upload is refused with the anchored name conflict (R1 collision). */
export function uploadNameConflictSteps() {
  return [
    { stdout: rawInfo('folder', 'root~uid') },
    NOT_FOUND,
    { stdout: JSON.stringify({ created: true, folderUid: 'ns1~uid' }) },
    { stdout: rawInfo('folder', 'ns1~uid') },
    NOT_FOUND,
    NOT_FOUND,
    NOT_FOUND,
    nameConflictStep(`${BASE}${SUFFIX.ciphertext}`),
  ]
}
