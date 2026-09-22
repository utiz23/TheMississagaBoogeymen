/**
 * Cloud backup FRESHNESS EVALUATION — INTERNAL IMPLEMENTATION CORE (E3J7).
 *
 * WHAT THIS FILE IS
 * ------------------
 * A read-only evaluator that derives ONE number — the newest verified Proton
 * copy's `source_snapshot_ts` — from the attestations the uploader already
 * wrote, plus the minimal local health signal that reports it.
 * `makeCloudFreshness(deps)` and `makeFreshnessEntrypoint(deps)` build both
 * against a supplied dependency set; `backup-cloud-freshness.mjs` and
 * `ops/backup/eanhl-backup-freshness.mjs` bind the real sets ONCE. This
 * factory is an internal TEST SEAM, reachable only by importing this internal
 * path; a static regression allows only those two files and the suite.
 *
 * WHAT IT IS NOT
 * ---------------
 * It writes nothing, deletes nothing, spawns nothing, opens no socket, and
 * touches no provider, credential, host, database, or scheduler. It is
 * piece 2 of the architecture memo's five (§5.2). Pieces 3, 4 and 5 —
 * off-host export, the independent watcher, and the notification channel —
 * are U15/E3J8 operator decisions and are NOT designed or implemented here.
 * Per memo §5.6 the correct description of this system remains "attestations
 * are written; nobody is watching them", and the signal says so in a field
 * (`monitored: false`) rather than in prose a consumer can drop.
 *
 * FRESHNESS
 * ----------
 * `max(source_snapshot_ts)` over attestations that are ALL of: readable,
 * schema-valid, `verdict: "verified"`, and binding-valid against the
 * producer's own manifest for that base. A rejected, indeterminate,
 * unreadable, malformed, or binding-invalid record never advances it, and a
 * re-delivered older artifact produces a new attestation carrying an OLD
 * `source_snapshot_ts`, which cannot raise a maximum.
 *
 * PER-RECORD EXCLUSION, NOT PER-BASE
 * -----------------------------------
 * A verified attestation that fails binding is excluded BY ITSELF. Another
 * verified, schema-valid, binding-valid attestation for the same base stays
 * fully eligible. Attestations are attempt-scoped: each verdict is derived
 * independently by `backup-cloud-attempt-verdict.mjs` from that attempt's own
 * evidence, and attempt B never reads attempt A's record. Bounded retry (T18)
 * makes "a failed attempt and a clean retry under one base" the DESIGNED
 * success path, so discarding B because A is bad would let one unusable
 * record suppress a genuinely verified backup — a false "stale" alarm, which
 * is its own failure mode. Nor is a base-level rule needed to catch a swapped
 * manifest: the producer publishes exactly one manifest per base and refuses
 * to overwrite an identity, and binding anchors every record to it on four
 * fields, so of two verified records carrying different readback hashes at
 * most one can match — the other is already excluded per-record.
 * `verified_binding_invalid` is therefore raised as an INFORMATIONAL anomaly
 * that never changes the number.
 *
 * BOUNDS, FAIL CLOSED
 * --------------------
 * The directory is enumerated as a STREAM (`opendir`/`readSync`), never
 * materialized: the loop performs at most `MAX_DIRECTORY_ENTRIES + 1` reads
 * and stops, so on a ceiling breach `counts.names_enumerated` is exactly
 * `MAX_DIRECTORY_ENTRIES + 1` — the extra read is how the breach is detected,
 * and the true directory size is unknown. Retained state is bounded by
 * `MAX_ATTESTATIONS_READ`, independent of directory size. ANY ceiling breach,
 * enumeration failure, or handle-close failure yields `status:
 * "indeterminate"` with NO freshness value — never a partial result computed
 * from the records that happened to be seen first.
 *
 * WHAT THE IDENTITY CHECKS DO AND DO NOT PROVE
 * ----------------------------------------------
 * Both directories are observed before the work and re-observed after it, and
 * a change fails closed. But `opendir()` resolves `attestation.dir` a second
 * time, and the manifest read resolves its path twice (`lstat`, then `open`),
 * so a swap between two resolutions is NOT excluded, and a swap-and-restore
 * is not detected at all. What IS closed is narrower and worth stating
 * exactly: every record goes through `readCloudAttestation()`, which
 * independently re-establishes directory trust around its own read and
 * cross-checks the reopened descriptor's `dev`/`ino` against the entry it
 * stat'd; and the manifest's bytes come from the inode its descriptor held,
 * cross-checked the same way. Neither establishes anything about what a path
 * names before, between, or after those resolutions.
 */

import fs from 'node:fs'
import { types as utilTypes } from 'node:util'

import {
  BackupError,
  MANIFEST_SCHEMA_VERSION,
  SNAPSHOT_STAMP_PATTERN,
  formatSnapshotStamp,
  publishedTripleNames,
} from '../backup-artifact-contract.mjs'
import {
  CLOUD_ATTESTATION_KIND,
  CLOUD_ATTESTATION_SCHEMA_VERSION,
  readCloudAttestation,
} from '../backup-cloud-attestation-records.mjs'
import { loadCloudConfig, validateCloudConfig } from '../backup-cloud-config.mjs'
import { CLOUD_ATTEMPT_RECORD_FILENAME_PATTERN, RUN_ID_PATTERN } from '../backup-cloud-naming.mjs'
import {
  observeTrustedDirectoryIdentity,
  sameIdentity,
} from './backup-cloud-directory-authority.mjs'
import { REAL_EVIDENCE_READER } from './backup-cloud-source-evidence.mjs'

// ─────────────────────────────────────────────────────────────────────────────
// The signal's identity and the approved thresholds.
// ─────────────────────────────────────────────────────────────────────────────

export const FRESHNESS_SIGNAL_KIND = 'eanhl.cloud-freshness-signal'
export const FRESHNESS_SIGNAL_SCHEMA_VERSION = 1

/**
 * APPROVED POLICY, not a tunable. E1A (2026-09-07, "Recovery and retention
 * targets — approved"): "Warning when no verified Proton copy is newer than 8
 * hours; critical alert when no verified Proton copy is newer than 24 hours."
 * These are deliberately NOT configuration: a config key would let an approved
 * threshold be weakened silently. They supersede the older PROPOSED
 * `WARN > 7 h 30 min` / `ALARM > 9 h` pair in
 * `docs/operations/backup-producer.md` §8 (memo §5.4).
 *
 * E1A's wording is "no verified copy NEWER than 8 hours", so an age of exactly
 * 8 h is already a warning.
 */
export const WARNING_AFTER_SECONDS = 8 * 60 * 60
export const CRITICAL_AFTER_SECONDS = 24 * 60 * 60

/**
 * How far back candidates are considered. An E3J7 bound, NOT a U12/U13
 * production measurement. Any value >= `CRITICAL_AFTER_SECONDS` answers both
 * thresholds exactly; the extra margin only affects how precisely an already-
 * critical age can be reported. Beyond it the evaluator reports `no_evidence`
 * rather than fabricating an age — which is >= critical either way.
 */
export const LOOKBACK_SECONDS = 7 * 24 * 60 * 60

/**
 * Resource ceilings chosen by E3J7 — like `CLOUD_RECORD_CEILING_BYTES` at
 * E3J6B these are security/resource bounds, NOT production measurements.
 * Sizing: a 6 h cadence over a 7-day lookback is 28 bases; with retries, of
 * order 84 attestations. 20000 directory entries is roughly six years of
 * unpruned intent+attestation pairs. A breach never truncates silently.
 */
export const MAX_DIRECTORY_ENTRIES = 20_000
export const MAX_ATTESTATIONS_READ = 4_000

/**
 * The FIXED upper bound on a local manifest read. The effective ceiling is
 * `min(this, config.readback.maxManifestBytes)`, so raising the configured
 * value cannot raise the local read above this line.
 */
export const LOCAL_MANIFEST_CEILING_BYTES = 1024 * 1024

const freeze = (values) => Object.freeze([...values])

export const FRESHNESS_STATUSES = freeze([
  'fresh',
  'warning',
  'critical',
  'no_evidence',
  'indeterminate',
])

/**
 * `complete` — the directory was enumerated to its end.
 * `truncated` — a ceiling was breached; the true size is unknown.
 * `unreadable` — enumeration failed, or never ran because an earlier
 * evaluation-wide check failed. Either way there is no usable listing.
 */
export const FRESHNESS_SCAN_STATES = freeze(['complete', 'truncated', 'unreadable'])

/** Evaluation-wide anomalies. Any one of these forces `status: "indeterminate"`. */
export const FRESHNESS_FATAL_ANOMALY_CODES = freeze([
  'attestation_dir_changed',
  'attestation_dir_untrusted',
  'clock_unusable',
  'listing_failed',
  'scan_truncated',
  'source_dir_changed',
  'source_dir_untrusted',
])

/** Per-record anomalies. These exclude a record and never change the status by themselves. */
export const FRESHNESS_RECORD_ANOMALY_CODES = freeze([
  'binding_invalid',
  'manifest_invalid',
  'manifest_unavailable',
  'record_name_unrecognized',
  'record_schema_invalid',
  'record_unreadable',
  'snapshot_ts_in_future',
  'verified_binding_invalid',
])

export const FRESHNESS_ANOMALY_CODES = freeze(
  [...FRESHNESS_FATAL_ANOMALY_CODES, ...FRESHNESS_RECORD_ANOMALY_CODES].sort(),
)

/** Closed binding-failure codes. Never interpolated text — the signal must stay printable. */
export const CLOUD_BINDING_FAILURE_CODES = freeze([
  'artifact_name_mismatch',
  'artifact_names_not_derived',
  'attestation_schema_version',
  'ciphertext_sha256_mismatch',
  'manifest_not_an_object',
  'manifest_schema_version',
  'not_a_cloud_attestation',
  'readback_evidence_absent',
  'snapshot_stamp_mismatch',
  'source_run_id_mismatch',
  'source_snapshot_ts_mismatch',
])

export const FRESHNESS_COUNT_KEYS = freeze([
  'names_enumerated',
  'attestations_named',
  'considered',
  'verified',
  'binding_valid',
  'rejected',
  'indeterminate_verdict',
  'unreadable',
  'schema_invalid',
  'name_unrecognized',
  'manifest_unavailable',
  'manifest_invalid',
  'binding_invalid',
  'future_dated',
])

const SHA256_HEX = /^[0-9a-f]{64}$/
const ISO_MS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/** A snapshot instant, as the attestation schema admits it: seconds, with optional fraction. */
const SNAPSHOT_ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

function invalidInput(what) {
  throw new BackupError('cloud_freshness_invalid_input', `${what} is not valid.`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding — a CLOUD attestation against the producer's manifest.
//
// This is NOT `validateReceiptBinding()` and never delegates to it. A
// destination receipt is not a Proton attestation: the schemas differ, the
// authors differ, and C11 forbids letting one satisfy the other's rules by
// analogy. Nothing in this file imports `backup-acceptance.mjs`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this cloud attestation bound to this producer manifest?
 *
 * The three fields memo §5.3 names — `artifact`, `ciphertext_sha256` and
 * `source_snapshot_ts` — plus three guards and one E3J7 strengthening:
 *
 *   - `kind` is checked FIRST and is the discriminator. A destination receipt
 *     has no `kind` field at all, so it is rejected before any other field is
 *     read and can never satisfy cloud binding by carrying a matching
 *     artifact / ciphertext-hash / snapshot triple.
 *   - The attestation's own three filenames must derive from its own
 *     `artifact.base`, and the manifest's `snapshot_ts` must compact to that
 *     base's stamp — so the record, its names and its timestamp are one
 *     consistent identity, not three independently-supplied strings.
 *   - `source_run_id` vs `manifest.run_id` is an E3J7 STRENGTHENING beyond the
 *     memo's three. Both values originate from the same producer manifest, so
 *     a disagreement is a real inconsistency; checking it can only reject.
 *
 * The cloud analogue of the receipt's destination-computed hash is
 * `readback.ciphertext.sha256`: the hash the uploader computed from bytes it
 * DOWNLOADED BACK from Proton, not a value copied out of the manifest. It
 * counts only when the role was actually observed as an active file and
 * matched its source.
 *
 * `failures` holds CLOSED CODES, never interpolated text — deliberately unlike
 * `validateReceiptBinding()`, whose failure strings embed values and so could
 * never be printed into a health signal.
 *
 * @returns {{valid: boolean, failures: readonly string[]}} frozen
 */
export function validateCloudAttestationBinding(attestation, manifest) {
  const failures = []
  const fail = (code) => {
    if (!failures.includes(code)) failures.push(code)
  }
  const done = () => Object.freeze({ valid: failures.length === 0, failures: freeze(failures) })

  // 1. The discriminator. A destination receipt stops here.
  if (
    attestation === null ||
    typeof attestation !== 'object' ||
    Array.isArray(attestation) ||
    attestation.kind !== CLOUD_ATTESTATION_KIND
  ) {
    fail('not_a_cloud_attestation')
    return done()
  }
  if (attestation.schema_version !== CLOUD_ATTESTATION_SCHEMA_VERSION) {
    fail('attestation_schema_version')
  }

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('manifest_not_an_object')
    return done()
  }
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) fail('manifest_schema_version')

  // 2. The attestation's own names derive from its own base.
  const art = attestation.artifact
  let base = null
  let names = null
  if (
    art !== null &&
    typeof art === 'object' &&
    !Array.isArray(art) &&
    typeof art.base === 'string'
  ) {
    base = art.base
    names = publishedTripleNames(base)
    if (
      art.ciphertext !== names.ciphertext ||
      art.checksum !== names.checksum ||
      art.manifest !== names.manifest
    ) {
      names = null
    }
  }
  if (names === null) fail('artifact_names_not_derived')

  // 3. §5.3 `artifact`.
  if (names === null || manifest.artifact !== names.ciphertext) fail('artifact_name_mismatch')

  // 4. §5.3 `ciphertext_sha256`, from the readback the uploader performed.
  const readback = attestation.readback
  const role =
    readback !== null && typeof readback === 'object' && !Array.isArray(readback)
      ? readback.ciphertext
      : null
  let observedSha = null
  if (
    role === null ||
    typeof role !== 'object' ||
    Array.isArray(role) ||
    role.observed !== 'active_file' ||
    role.matches_source !== true ||
    typeof role.sha256 !== 'string' ||
    !SHA256_HEX.test(role.sha256)
  ) {
    fail('readback_evidence_absent')
  } else {
    observedSha = role.sha256
  }
  const ct = manifest.ciphertext
  const manifestSha =
    ct !== null && typeof ct === 'object' && !Array.isArray(ct) ? ct.sha256 : undefined
  if (typeof manifestSha !== 'string' || !SHA256_HEX.test(manifestSha)) {
    fail('ciphertext_sha256_mismatch')
  } else if (observedSha !== null && observedSha !== manifestSha) {
    fail('ciphertext_sha256_mismatch')
  }

  // 5. §5.3 `source_snapshot_ts`, and the stamp it must compact to.
  const snapshotTs = attestation.source_snapshot_ts
  if (typeof snapshotTs !== 'string' || snapshotTs !== manifest.snapshot_ts) {
    fail('source_snapshot_ts_mismatch')
  }
  const stamp =
    typeof manifest.snapshot_ts === 'string' ? formatSnapshotStampSafe(manifest.snapshot_ts) : null
  if (stamp === null || base === null || base.slice(-16) !== stamp) fail('snapshot_stamp_mismatch')

  // 6. The E3J7 strengthening.
  if (
    typeof attestation.source_run_id !== 'string' ||
    attestation.source_run_id !== manifest.run_id
  ) {
    fail('source_run_id_mismatch')
  }

  return done()
}

const GROUP_OR_WORLD_WRITE = 0o022n
const GROUP_OR_WORLD_ANY = 0o077n
const MODE_MASK = 0o7777n

/**
 * `artifact.sourceDir` CANNOT use `observeTrustedDirectoryIdentity()`: that
 * predicate requires no group or world permission bits, and the producer
 * creates its `destination.dir` with `mkdirSync(dir, {recursive: true})` and
 * NO explicit mode (`backup-producer.mjs`), so in practice it is umask-derived
 * — typically `0755`. Requiring owner-only bits there would refuse every real
 * deployment, which is not failing closed, it is being broken.
 *
 * WRITABILITY is the property that matters: the directory holds age-encrypted
 * ciphertext plus a manifest that is plaintext and secret-free by contract,
 * and the producer writes every file in it `0600`. So this observes exactly:
 * not a symlink, is a directory, owned by the effective uid, NOT group- or
 * world-writable, and already canonical (the cloud config enforces that
 * lexically; this re-confirms it against the live filesystem).
 *
 * The shared primitive is deliberately not widened to mean two things.
 *
 * @returns {{dev: bigint, ino: bigint, uid: bigint, mode: bigint} | null}
 */
export function observeReadableSourceDirIdentity(dir, deps) {
  try {
    const st = deps.lstat(dir)
    if (st === null || typeof st !== 'object') return null
    if (st.isSymbolicLink() !== false || st.isDirectory() !== true) return null
    if (typeof st.uid !== 'bigint' || typeof st.mode !== 'bigint') return null
    if (typeof st.dev !== 'bigint' || typeof st.ino !== 'bigint') return null
    if (st.uid !== BigInt(deps.geteuid())) return null
    if ((st.mode & GROUP_OR_WORLD_WRITE) !== 0n) return null
    if (deps.realpath(dir) !== dir) return null
    return Object.freeze({ dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode & MODE_MASK })
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Clock and stamp parsing.
// ─────────────────────────────────────────────────────────────────────────────

function formatSnapshotStampSafe(iso) {
  try {
    return formatSnapshotStamp(iso)
  } catch {
    return null
  }
}

/** `null` unless the clock yields a safe integer that round-trips through an ISO-with-ms UTC string. */
function readClock(deps) {
  let ms
  try {
    ms = deps.now()
  } catch {
    return null
  }
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms)) return null
  let iso
  try {
    iso = new Date(ms).toISOString()
  } catch {
    return null
  }
  if (typeof iso !== 'string' || !ISO_MS_UTC.test(iso)) return null
  return { ms, iso }
}

/** A compact `YYYYMMDDTHHMMSSZ` stamp to epoch ms, or `null`. Round-tripped, so `20260931…` is refused. */
function parseStampMs(stamp) {
  if (typeof stamp !== 'string') return null
  const m = SNAPSHOT_STAMP_PATTERN.exec(stamp)
  if (m === null) return null
  const ms = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  )
  if (!Number.isSafeInteger(ms)) return null
  let iso
  try {
    iso = new Date(ms).toISOString()
  } catch {
    return null
  }
  return formatSnapshotStampSafe(iso) === stamp ? ms : null
}

/** An ISO-8601 UTC instant to epoch ms, or `null`. */
function parseIsoMs(iso) {
  if (typeof iso !== 'string') return null
  const ms = Date.parse(iso)
  return Number.isSafeInteger(ms) ? ms : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies.
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_DEPS = Object.freeze([
  'now',
  'lstat',
  'realpath',
  'geteuid',
  'opendir',
  'openFile',
  'fstat',
  'read',
  'close',
  'readAttestation',
])

function assertValidDeps(deps) {
  if (deps === null || typeof deps !== 'object') return invalidInput('deps')
  for (const name of REQUIRED_DEPS)
    if (typeof deps[name] !== 'function') return invalidInput('deps')
}

/** The REAL dependency set. Read-only: no write, truncate, unlink, rename, or spawn capability is reachable. */
export const REAL_FRESHNESS_DEPS = Object.freeze({
  now: () => Date.now(),
  lstat: (p) => fs.lstatSync(p, { bigint: true }),
  realpath: (p) => fs.realpathSync(p),
  geteuid: () => process.geteuid(),
  opendir: (p) => fs.opendirSync(p),
  openFile: REAL_EVIDENCE_READER.open,
  fstat: REAL_EVIDENCE_READER.fstat,
  read: REAL_EVIDENCE_READER.read,
  close: REAL_EVIDENCE_READER.close,
  /** The E3J6B reader, reused verbatim. E3J7 writes no attestation reader of its own. */
  readAttestation: (args) => readCloudAttestation(args),
})

// ─────────────────────────────────────────────────────────────────────────────
// The evaluator.
// ─────────────────────────────────────────────────────────────────────────────

const MANIFEST_UNAVAILABLE = Object.freeze({ state: 'unavailable' })
const MANIFEST_INVALID = Object.freeze({ state: 'invalid' })
const MANIFEST_DIR_CHANGED = Object.freeze({ state: 'dir_changed' })

export function makeCloudFreshness(deps) {
  assertValidDeps(deps)

  /**
   * Stream the attestation directory. At most `MAX_DIRECTORY_ENTRIES + 1`
   * reads are performed: the (N+1)th read is how a breach is DETECTED, so on
   * overflow `counts.names_enumerated === MAX_DIRECTORY_ENTRIES + 1` exactly
   * and the real directory size is unknown.
   */
  function enumerateCandidates({ dir, nowMs, counts, anomalies }) {
    const candidates = []
    const minStampMs = nowMs - LOOKBACK_SECONDS * 1000
    let handle
    try {
      handle = deps.opendir(dir)
    } catch {
      return { state: 'unreadable', candidates: [] }
    }
    if (handle === null || typeof handle !== 'object' || typeof handle.readSync !== 'function') {
      return { state: 'unreadable', candidates: [] }
    }
    let state = 'complete'
    try {
      for (;;) {
        let entry
        try {
          entry = handle.readSync()
        } catch {
          state = 'unreadable'
          break
        }
        if (entry === null || entry === undefined) break

        counts.names_enumerated++
        if (counts.names_enumerated > MAX_DIRECTORY_ENTRIES) {
          state = 'truncated'
          break
        }

        const name = entry.name
        if (typeof name !== 'string') {
          counts.name_unrecognized++
          anomalies.add('record_name_unrecognized')
          continue
        }
        // Dirent type flags are NOT consulted: they can be UNKNOWN on some
        // filesystems, and the per-record reader's own `lstat` is authoritative.
        const m = CLOUD_ATTEMPT_RECORD_FILENAME_PATTERN.exec(name)
        if (m === null) {
          counts.name_unrecognized++
          anomalies.add('record_name_unrecognized')
          continue
        }
        // Intent records are expected company in this directory, never an anomaly.
        if (m[3] !== 'cloud-attestation') continue

        counts.attestations_named++
        const base = m[1]
        const attemptId = m[2]
        const stampMs = parseStampMs(base.slice(-16))
        if (stampMs === null) {
          counts.name_unrecognized++
          anomalies.add('record_name_unrecognized')
          continue
        }
        if (stampMs > nowMs) {
          counts.future_dated++
          anomalies.add('snapshot_ts_in_future')
          continue
        }
        if (stampMs < minStampMs) continue

        if (candidates.length >= MAX_ATTESTATIONS_READ) {
          state = 'truncated'
          break
        }
        candidates.push(Object.freeze({ base, attemptId }))
      }
    } finally {
      try {
        handle.closeSync()
      } catch {
        // A close failure is a failure of this enumeration: it never yields a
        // trustworthy listing, and the result is indeterminate either way.
        if (state === 'complete') state = 'unreadable'
      }
    }
    return { state, candidates }
  }

  /**
   * Read and validate the producer's manifest for one base, bounded by
   * `min(readback.maxManifestBytes, LOCAL_MANIFEST_CEILING_BYTES)`.
   *
   * Fails closed at every step. Does NOT eliminate path-swap races: the path
   * is resolved twice. `O_NOFOLLOW` makes opening a symlink fail in the
   * kernel, `O_NONBLOCK` keeps a FIFO from hanging the open, and the
   * `dev`/`ino` cross-check refuses a different inode — so the bytes parsed
   * are the bytes of the inode the descriptor held, and nothing more.
   */
  function readLocalManifest({ cfg, base, sourceDirId }) {
    const ceiling = Math.min(cfg.readback.maxManifestBytes, LOCAL_MANIFEST_CEILING_BYTES)
    if (!Number.isSafeInteger(ceiling) || ceiling <= 0) return MANIFEST_UNAVAILABLE

    const names = publishedTripleNames(base)
    const path = `${cfg.artifact.sourceDir}/${names.manifest}`
    const euid = BigInt(deps.geteuid())

    let lst
    try {
      lst = deps.lstat(path)
    } catch {
      return MANIFEST_UNAVAILABLE
    }
    try {
      if (lst.isFile() !== true || lst.isSymbolicLink() !== false) return MANIFEST_UNAVAILABLE
      if (typeof lst.uid !== 'bigint' || lst.uid !== euid) return MANIFEST_UNAVAILABLE
      if (typeof lst.mode !== 'bigint' || (lst.mode & GROUP_OR_WORLD_ANY) !== 0n) {
        return MANIFEST_UNAVAILABLE
      }
      if (typeof lst.size !== 'bigint' || lst.size > BigInt(ceiling)) return MANIFEST_UNAVAILABLE
      if (typeof lst.dev !== 'bigint' || typeof lst.ino !== 'bigint') return MANIFEST_UNAVAILABLE
    } catch {
      return MANIFEST_UNAVAILABLE
    }

    let fd
    let failed = false
    let text = null
    try {
      fd = deps.openFile(path)
      const fst = deps.fstat(fd)
      if (fst.isFile() !== true) throw new Error('not a regular file')
      if (fst.dev !== lst.dev || fst.ino !== lst.ino) throw new Error('identity changed')
      if (typeof fst.uid !== 'bigint' || fst.uid !== euid) throw new Error('owner')
      if (typeof fst.mode !== 'bigint' || (fst.mode & GROUP_OR_WORLD_ANY) !== 0n) {
        throw new Error('mode')
      }
      if (typeof fst.size !== 'bigint' || fst.size > BigInt(ceiling)) throw new Error('size')

      const buf = Buffer.alloc(ceiling + 1)
      let total = 0
      for (;;) {
        const n = deps.read(fd, buf.subarray(total))
        if (!Number.isSafeInteger(n) || n < 0) throw new Error('read failed')
        if (n === 0) break
        total += n
        if (total > ceiling) throw new Error('exceeds the ceiling')
      }
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, total))
    } catch {
      failed = true
    } finally {
      if (fd !== undefined) {
        try {
          deps.close(fd)
        } catch {
          // A close failure is a failure of this read.
          failed = true
        }
      }
    }
    if (failed || text === null) return MANIFEST_UNAVAILABLE

    // The anchor must still be the directory this evaluation trusted.
    if (
      !sameIdentity(observeReadableSourceDirIdentity(cfg.artifact.sourceDir, deps), sourceDirId)
    ) {
      return MANIFEST_DIR_CHANGED
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return MANIFEST_INVALID
    }
    if (!validManifestShape(parsed, base, names)) return MANIFEST_INVALID
    return { state: 'ok', value: parsed }
  }

  /**
   * Evaluate cloud-backup freshness. Read-only.
   *
   * @param {object} args
   * @param {object} args.config a cloud config; re-validated here
   * @returns {object} the deeply frozen health signal
   * @throws {BackupError} `cloud_freshness_invalid_input`
   */
  function evaluateCloudFreshness(args) {
    if (args === null || typeof args !== 'object') return invalidInput('arguments')
    let cfg
    try {
      cfg = validateCloudConfig(args.config)
    } catch {
      return invalidInput('config')
    }

    const counts = {}
    for (const key of FRESHNESS_COUNT_KEYS) counts[key] = 0
    const anomalies = new Set()

    // 1. The clock. Without it no age can be computed and no lookback applied.
    const clock = readClock(deps)
    if (clock === null) {
      anomalies.add('clock_unusable')
      return buildSignal({ generatedAt: null, counts, anomalies, scan: 'unreadable' })
    }

    // 2/3. Both anchors, before any work.
    const attestationDirId = observeTrustedDirectoryIdentity(cfg.attestation.dir, deps)
    if (attestationDirId === null) {
      anomalies.add('attestation_dir_untrusted')
      return buildSignal({ generatedAt: clock.iso, counts, anomalies, scan: 'unreadable' })
    }
    const sourceDirId = observeReadableSourceDirIdentity(cfg.artifact.sourceDir, deps)
    if (sourceDirId === null) {
      anomalies.add('source_dir_untrusted')
      return buildSignal({ generatedAt: clock.iso, counts, anomalies, scan: 'unreadable' })
    }

    // 4. Bounded streaming enumeration. A breach or failure ends the evaluation
    //    here: a partial freshness result is never produced.
    const enumeration = enumerateCandidates({
      dir: cfg.attestation.dir,
      nowMs: clock.ms,
      counts,
      anomalies,
    })
    if (enumeration.state !== 'complete') {
      anomalies.add(enumeration.state === 'truncated' ? 'scan_truncated' : 'listing_failed')
      return buildSignal({ generatedAt: clock.iso, counts, anomalies, scan: enumeration.state })
    }

    // 5. Per-record evaluation.
    const manifests = new Map()
    let newestMs = null
    let newestTs = null
    let fatal = false

    for (const candidate of enumeration.candidates) {
      counts.considered++

      let record
      try {
        record = deps.readAttestation({
          config: cfg,
          artifactBase: candidate.base,
          attemptId: candidate.attemptId,
        })
      } catch (err) {
        const code = err?.code
        if (code === 'attestation_dir_untrusted') {
          anomalies.add('attestation_dir_changed')
          fatal = true
          break
        }
        if (code === 'cloud_attestation_schema_invalid') {
          counts.schema_invalid++
          anomalies.add('record_schema_invalid')
          continue
        }
        // `cloud_record_not_found` (a race against a sweeper), and every other
        // failure, are closed as unreadable. One junk record never breaks the
        // signal: the resulting number can only be too pessimistic.
        counts.unreadable++
        anomalies.add('record_unreadable')
        continue
      }

      if (record === null || typeof record !== 'object') {
        counts.unreadable++
        anomalies.add('record_unreadable')
        continue
      }

      if (record.verdict !== 'verified') {
        if (record.verdict === 'rejected') counts.rejected++
        else counts.indeterminate_verdict++
        continue
      }
      counts.verified++

      // Before any manifest work: a timestamp this host's clock says has not
      // happened yet can never be evidence of a completed backup. Checked here
      // rather than after binding, because only BINDING ties a record's
      // `source_snapshot_ts` to its base stamp — an unbound record can carry a
      // future timestamp under a past-stamped base.
      const ms = parseIsoMs(record.source_snapshot_ts)
      if (ms === null) {
        counts.schema_invalid++
        anomalies.add('record_schema_invalid')
        continue
      }
      if (ms > clock.ms) {
        counts.future_dated++
        anomalies.add('snapshot_ts_in_future')
        continue
      }

      const base = record.artifact?.base
      if (typeof base !== 'string' || base !== candidate.base) {
        counts.schema_invalid++
        anomalies.add('record_schema_invalid')
        continue
      }

      let manifest = manifests.get(base)
      if (manifest === undefined) {
        manifest = readLocalManifest({ cfg, base, sourceDirId })
        if (manifest.state !== 'dir_changed') manifests.set(base, manifest)
      }
      if (manifest.state === 'dir_changed') {
        anomalies.add('source_dir_changed')
        fatal = true
        break
      }
      if (manifest.state === 'unavailable') {
        counts.manifest_unavailable++
        anomalies.add('manifest_unavailable')
        continue
      }
      if (manifest.state === 'invalid') {
        counts.manifest_invalid++
        anomalies.add('manifest_invalid')
        continue
      }

      const binding = validateCloudAttestationBinding(record, manifest.value)
      if (!binding.valid) {
        // PER-RECORD ONLY. Another verified, binding-valid attestation for this
        // same base stays eligible — see the module docblock.
        counts.binding_invalid++
        anomalies.add('binding_invalid')
        anomalies.add('verified_binding_invalid')
        continue
      }
      counts.binding_valid++

      if (newestMs === null || ms > newestMs) {
        newestMs = ms
        newestTs = record.source_snapshot_ts
      }
    }

    // 6. Both anchors again. A change invalidates everything read above.
    if (!fatal) {
      if (
        !sameIdentity(observeTrustedDirectoryIdentity(cfg.attestation.dir, deps), attestationDirId)
      ) {
        anomalies.add('attestation_dir_changed')
        fatal = true
      }
      if (
        !sameIdentity(observeReadableSourceDirIdentity(cfg.artifact.sourceDir, deps), sourceDirId)
      ) {
        anomalies.add('source_dir_changed')
        fatal = true
      }
    }

    return buildSignal({
      generatedAt: clock.iso,
      counts,
      anomalies,
      scan: 'complete',
      newest: fatal ? null : newestTs,
      ageSeconds: fatal || newestMs === null ? null : Math.floor((clock.ms - newestMs) / 1000),
    })
  }

  return Object.freeze({ evaluateCloudFreshness })
}

/** Shape validation for a producer manifest, cloud-side. Mirrors — never imports — the acceptor's rules. */
function validManifestShape(m, base, names) {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return false
  if (m.schema_version !== MANIFEST_SCHEMA_VERSION) return false
  if (m.artifact !== names.ciphertext) return false
  if (typeof m.snapshot_ts !== 'string') return false
  if (formatSnapshotStampSafe(m.snapshot_ts) !== base.slice(-16)) return false
  if (typeof m.run_id !== 'string' || !RUN_ID_PATTERN.test(m.run_id)) return false
  const ct = m.ciphertext
  if (ct === null || typeof ct !== 'object' || Array.isArray(ct)) return false
  if (typeof ct.sha256 !== 'string' || !SHA256_HEX.test(ct.sha256)) return false
  if (!Number.isSafeInteger(ct.bytes) || ct.bytes < 0) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// The signal.
// ─────────────────────────────────────────────────────────────────────────────

function buildSignal({ generatedAt, counts, anomalies, scan, newest = null, ageSeconds = null }) {
  const codes = [...anomalies].sort()
  const isFatal = codes.some((code) => FRESHNESS_FATAL_ANOMALY_CODES.includes(code))

  let status
  let snapshotTs = null
  let age = null
  if (isFatal || generatedAt === null) {
    status = 'indeterminate'
  } else if (newest === null || ageSeconds === null) {
    status = 'no_evidence'
  } else {
    snapshotTs = newest
    age = ageSeconds
    status =
      age >= CRITICAL_AFTER_SECONDS
        ? 'critical'
        : age >= WARNING_AFTER_SECONDS
          ? 'warning'
          : 'fresh'
  }

  const out = {
    kind: FRESHNESS_SIGNAL_KIND,
    schema_version: FRESHNESS_SIGNAL_SCHEMA_VERSION,
    generated_at: generatedAt,
    status,
    newest_verified_source_snapshot_ts: snapshotTs,
    age_seconds: age,
    thresholds: {
      warning_after_seconds: WARNING_AFTER_SECONDS,
      critical_after_seconds: CRITICAL_AFTER_SECONDS,
    },
    lookback_seconds: LOOKBACK_SECONDS,
    scan,
    counts: {},
    anomalies: codes,
    // Fixed until memo §5.6's conditions are met: an off-host watcher exists
    // AND a human has received a test notification. E3J7 builds neither.
    monitored: false,
  }
  for (const key of FRESHNESS_COUNT_KEYS) out.counts[key] = counts[key]
  return deepFreeze(out)
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

const SIGNAL_TOP_KEYS = Object.freeze([
  'kind',
  'schema_version',
  'generated_at',
  'status',
  'newest_verified_source_snapshot_ts',
  'age_seconds',
  'thresholds',
  'lookback_seconds',
  'scan',
  'counts',
  'anomalies',
  'monitored',
])

const THRESHOLD_KEYS = Object.freeze(['warning_after_seconds', 'critical_after_seconds'])

// ─────────────────────────────────────────────────────────────────────────────
// THE OUTPUT PROJECTION BOUNDARY.
//
// Validating an object and then serializing THAT SAME object is unsound: the
// value between the two steps can be stateful. A getter can return a
// contract-legal value to the validator and something else to
// `JSON.stringify`; a `toJSON` inherited from a prototype is invisible to
// `Object.keys()` yet replaces the serialized output wholesale. So nothing the
// caller supplied is ever serialized. `projectFreshnessSignal()` builds a
// FRESH, null-prototype object holding only copied primitives and
// closed-vocabulary members, and it is that projection which is validated and
// printed.
//
//   - A Proxy is refused first, by `util.types.isProxy()`, which runs no trap.
//   - Every value is read through its own property descriptor and must be a
//     DATA property: an accessor is refused WITHOUT being invoked, so a
//     throwing or stateful getter can neither leak nor crash.
//   - Every object must have `Object.prototype` or a null prototype, and its
//     `Reflect.ownKeys()` (enumerable or not, strings and symbols) must be
//     EXACTLY the expected set. An inherited `toJSON`, a non-enumerable extra
//     field, or a symbol key is refused, never skipped.
//   - Every leaf is a primitive of the expected type, and every string is a
//     member of a closed vocabulary or a validated ISO instant. No object the
//     caller owns survives into the projection, so no nested `toJSON` remains.
//   - Refusal is silent: `null` is returned, never a message and never a
//     native error, because both can echo values.
// ─────────────────────────────────────────────────────────────────────────────

const PROJECTION_REFUSED = Object.freeze(Object.create(null))
function refuse() {
  throw PROJECTION_REFUSED
}

/** The value of an OWN DATA property. An accessor is refused without being called. */
function ownValue(obj, key) {
  const d = Object.getOwnPropertyDescriptor(obj, key)
  if (d === undefined || !('value' in d)) refuse()
  return d.value
}

function plainObject(value, expectedKeys) {
  if (value === null || typeof value !== 'object') refuse()
  if (utilTypes.isProxy(value)) refuse()
  if (Array.isArray(value)) refuse()
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) refuse()
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expectedKeys.length) refuse()
  for (const k of expectedKeys) if (!keys.includes(k)) refuse()
  return value
}

/** A plain array whose own keys are exactly its indices plus `length`. */
function plainArray(value, max) {
  if (!Array.isArray(value)) refuse()
  if (utilTypes.isProxy(value)) refuse()
  if (Object.getPrototypeOf(value) !== Array.prototype) refuse()
  const n = ownValue(value, 'length')
  if (!Number.isSafeInteger(n) || n < 0 || n > max) refuse()
  const keys = Reflect.ownKeys(value)
  if (keys.length !== n + 1) refuse()
  if (!keys.includes('length')) refuse()
  for (let i = 0; i < n; i++) if (!keys.includes(String(i))) refuse()
  return { value, length: n }
}

function closedString(value, vocabulary) {
  if (typeof value !== 'string' || !vocabulary.includes(value)) refuse()
  return value
}

function exactNumber(value, expected) {
  if (typeof value !== 'number' || value !== expected) refuse()
  return value
}

function countValue(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) refuse()
  return value
}

function countOrNullValue(value) {
  return value === null ? null : countValue(value)
}

function isoOrNullValue(value, pattern) {
  if (value === null) return null
  if (typeof value !== 'string' || !pattern.test(value)) refuse()
  return value
}

function buildProjection(signal) {
  plainObject(signal, SIGNAL_TOP_KEYS)
  const out = Object.create(null)
  out.kind = closedString(ownValue(signal, 'kind'), [FRESHNESS_SIGNAL_KIND])
  out.schema_version = exactNumber(
    ownValue(signal, 'schema_version'),
    FRESHNESS_SIGNAL_SCHEMA_VERSION,
  )
  out.generated_at = isoOrNullValue(ownValue(signal, 'generated_at'), ISO_MS_UTC)
  out.status = closedString(ownValue(signal, 'status'), FRESHNESS_STATUSES)
  out.newest_verified_source_snapshot_ts = isoOrNullValue(
    ownValue(signal, 'newest_verified_source_snapshot_ts'),
    SNAPSHOT_ISO_UTC,
  )
  out.age_seconds = countOrNullValue(ownValue(signal, 'age_seconds'))

  const t = plainObject(ownValue(signal, 'thresholds'), THRESHOLD_KEYS)
  const thresholds = Object.create(null)
  thresholds.warning_after_seconds = exactNumber(
    ownValue(t, 'warning_after_seconds'),
    WARNING_AFTER_SECONDS,
  )
  thresholds.critical_after_seconds = exactNumber(
    ownValue(t, 'critical_after_seconds'),
    CRITICAL_AFTER_SECONDS,
  )
  out.thresholds = thresholds

  out.lookback_seconds = exactNumber(ownValue(signal, 'lookback_seconds'), LOOKBACK_SECONDS)
  out.scan = closedString(ownValue(signal, 'scan'), FRESHNESS_SCAN_STATES)

  const c = plainObject(ownValue(signal, 'counts'), FRESHNESS_COUNT_KEYS)
  const counts = Object.create(null)
  for (const key of FRESHNESS_COUNT_KEYS) counts[key] = countValue(ownValue(c, key))
  out.counts = counts

  const a = plainArray(ownValue(signal, 'anomalies'), FRESHNESS_ANOMALY_CODES.length)
  const anomalies = []
  for (let i = 0; i < a.length; i++) {
    anomalies.push(closedString(ownValue(a.value, String(i)), FRESHNESS_ANOMALY_CODES))
  }
  out.anomalies = anomalies

  if (ownValue(signal, 'monitored') !== false) refuse()
  out.monitored = false

  return out
}

/**
 * A fresh, prototype-free copy of `signal`, or `null` if it is not exactly the
 * contract. Never throws, never prints, never invokes an accessor.
 */
export function projectFreshnessSignal(signal) {
  try {
    return buildProjection(signal)
  } catch {
    // Includes PROJECTION_REFUSED and anything a hostile object threw. Neither
    // the value nor the native error is ever surfaced.
    return null
  }
}

/**
 * Serialize a PROJECTION. The text is re-parsed and re-checked before it is
 * returned, so even a globally-polluted `Array.prototype.toJSON` — the one
 * `toJSON` route a fresh null-prototype object cannot rule out by
 * construction — cannot change what is printed. Returns `null` on any doubt.
 */
export function serializeFreshnessSignal(projection) {
  try {
    if (!validateFreshnessSignal(projection)) return null
    const text = JSON.stringify(projection)
    if (typeof text !== 'string' || text.length === 0) return null
    const reparsed = JSON.parse(text)
    if (!validateFreshnessSignal(reparsed)) return null
    if (!sameSignal(projection, reparsed)) return null
    return text
  } catch {
    return null
  }
}

/** Structural equality over the contract's fixed shape. */
function sameSignal(a, b) {
  for (const key of SIGNAL_TOP_KEYS) {
    if (key === 'thresholds' || key === 'counts' || key === 'anomalies') continue
    if (a[key] !== b[key]) return false
  }
  for (const key of THRESHOLD_KEYS) {
    if (a.thresholds[key] !== b.thresholds[key]) return false
  }
  for (const key of FRESHNESS_COUNT_KEYS) {
    if (a.counts[key] !== b.counts[key]) return false
  }
  if (a.anomalies.length !== b.anomalies.length) return false
  for (let i = 0; i < a.anomalies.length; i++) {
    if (a.anomalies[i] !== b.anomalies[i]) return false
  }
  return true
}

/**
 * A last-line check that the object about to be printed is exactly the closed
 * contract — so no path, identifier, or free text can have reached stdout —
 * AND that its fields do not contradict one another.
 */
export function validateFreshnessSignal(signal) {
  if (signal === null || typeof signal !== 'object' || Array.isArray(signal)) return false
  const keys = Object.keys(signal)
  if (keys.length !== SIGNAL_TOP_KEYS.length) return false
  if (!SIGNAL_TOP_KEYS.every((k) => keys.includes(k))) return false
  if (signal.kind !== FRESHNESS_SIGNAL_KIND) return false
  if (signal.schema_version !== FRESHNESS_SIGNAL_SCHEMA_VERSION) return false
  if (signal.generated_at !== null && !ISO_MS_UTC.test(String(signal.generated_at))) return false
  if (!FRESHNESS_STATUSES.includes(signal.status)) return false
  if (!FRESHNESS_SCAN_STATES.includes(signal.scan)) return false
  if (signal.monitored !== false) return false
  if (signal.lookback_seconds !== LOOKBACK_SECONDS) return false

  const t = signal.thresholds
  if (t === null || typeof t !== 'object' || Array.isArray(t)) return false
  if (Object.keys(t).length !== 2) return false
  if (t.warning_after_seconds !== WARNING_AFTER_SECONDS) return false
  if (t.critical_after_seconds !== CRITICAL_AFTER_SECONDS) return false

  const ts = signal.newest_verified_source_snapshot_ts
  const age = signal.age_seconds
  const hasValue =
    signal.status === 'fresh' || signal.status === 'warning' || signal.status === 'critical'

  // ── Cross-field contract. Each field can be individually legal while the
  //    combination asserts something the evaluator can never have observed,
  //    and a contradictory signal is worse than no signal: a watcher would
  //    act on it. Every rule below is a statement the producer path cannot
  //    violate, so none of them can reject a signal this module built.

  // A scan that stopped early or failed observed only part of the evidence, so
  // it cannot support any claim about how fresh the newest copy is.
  if (signal.scan !== 'complete' && signal.status !== 'indeterminate') return false
  // The only path that yields a null timestamp is an unusable clock, which is
  // evaluation-wide fatal.
  if (signal.generated_at === null && signal.status !== 'indeterminate') return false

  if (hasValue) {
    if (typeof ts !== 'string' || !SNAPSHOT_ISO_UTC.test(ts)) return false
    if (!Number.isSafeInteger(age) || age < 0) return false
    // A value-bearing status needs a usable clock reading to have been taken.
    if (typeof signal.generated_at !== 'string') return false

    const nowMs = parseIsoMs(signal.generated_at)
    const tsMs = parseIsoMs(ts)
    if (nowMs === null || tsMs === null) return false
    // The reported age must be the distance between the two timestamps it is
    // derived from — not an independently-supplied number. With `age >= 0`
    // above, this also excludes a snapshot dated after `generated_at`: a
    // future copy yields a negative distance, which no valid age can equal.
    if (Math.floor((nowMs - tsMs) / 1000) !== age) return false

    // The status must be the one the APPROVED thresholds assign to that age.
    const expected =
      age >= CRITICAL_AFTER_SECONDS
        ? 'critical'
        : age >= WARNING_AFTER_SECONDS
          ? 'warning'
          : 'fresh'
    if (signal.status !== expected) return false
  } else if (ts !== null || age !== null) {
    return false
  }

  const c = signal.counts
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return false
  if (Object.keys(c).length !== FRESHNESS_COUNT_KEYS.length) return false
  for (const key of FRESHNESS_COUNT_KEYS) {
    if (!Number.isSafeInteger(c[key]) || c[key] < 0) return false
  }

  if (!Array.isArray(signal.anomalies)) return false
  for (let i = 0; i < signal.anomalies.length; i++) {
    if (!FRESHNESS_ANOMALY_CODES.includes(signal.anomalies[i])) return false
    if (i > 0 && signal.anomalies[i - 1] >= signal.anomalies[i]) return false
  }
  const fatalPresent = signal.anomalies.some((code) => FRESHNESS_FATAL_ANOMALY_CODES.includes(code))
  if (fatalPresent !== (signal.status === 'indeterminate')) return false
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// The entrypoint.
// ─────────────────────────────────────────────────────────────────────────────

const TAG = '[eanhl-backup-freshness]'

export const USAGE = `usage: node ops/backup/eanhl-backup-freshness.mjs --config <path>

  Evaluate cloud-backup freshness from the attestations already on this host and
  print one local health-signal JSON object on stdout. Read-only: it writes
  nothing, contacts no provider, and reads no credential.

  NOT ACTIVATED, and NOT MONITORING. Nothing schedules, exports, watches, or
  alerts on this signal; that is E3J8 / U15. Absence of the signal is itself a
  critical condition, and deciding that is a watcher's job, not this command's.

  --config PATH   REQUIRED. Cloud configuration (see ops/backup/eanhl-backup-cloud.example.json).

  Exit: 0 a signal was produced AND its whole JSON line reached stdout (READ ITS
          "status" FIELD — 0 does not mean fresh);
        2 invalid invocation;
        3 no signal could be produced, or its line could not be written in full.
`

/** The closed `ConfigError` codes a config failure may be reported by; anything else is `config_invalid`. */
const CONFIG_ERROR_CODES = Object.freeze([
  'config_unreadable',
  'config_unparseable',
  'config_field_missing',
  'config_field_type',
  'config_field_invalid',
  'config_field_not_absolute',
  'config_field_not_canonical',
  'config_secret_shaped_key',
])

const LINES = Object.freeze({
  usage: `${TAG} invalid invocation: --config is required exactly once; no other argument is accepted.\n`,
  evaluateFailed: `${TAG} no signal could be produced.\n`,
  signalInvalid: `${TAG} internal error: the signal failed its own contract and is not printed.\n`,
  stdoutFailed:
    `${TAG} internal error: the signal line could not be written in full to stdout. ` +
    'Any bytes already written cannot be retracted, so no second line is attempted; ' +
    'treat the output as absent, not as a signal.\n',
  notMonitored:
    `${TAG} note: this is a local signal only. Nothing exports, watches, or alerts on it, ` +
    'and exit 0 means a signal was produced, not that a backup is fresh.\n',
})

/**
 * A bounded synchronous write of the WHOLE buffer.
 *
 * Returns `true` only when every byte was written. A short write that stalls,
 * a zero-byte return, an `EAGAIN` on a non-blocking pipe, or a native failure
 * all return `false` — the caller must not treat a partial line as output. It
 * never throws, so a broken stdout cannot become an unhandled error carrying
 * a native message.
 */
function writeAllSync(fd, buf) {
  return drainWrite(buf, (b, offset, length) => fs.writeSync(fd, b, offset, length))
}

/**
 * The drain loop, pure and exported so short, zero and throwing writes can be
 * exercised directly — `writeAllSync` itself takes no injectable dependency,
 * so the production path cannot be redirected at a call site.
 */
export function drainWrite(buf, write) {
  if (buf.length === 0) return true
  let offset = 0
  for (let i = 0; i < 16 && offset < buf.length; i++) {
    let n
    try {
      n = write(buf, offset, buf.length - offset)
    } catch {
      return false
    }
    if (!Number.isSafeInteger(n) || n <= 0) return false
    offset += n
  }
  return offset === buf.length
}

export const REAL_FRESHNESS_ENTRYPOINT_DEPS = Object.freeze({
  writeStdout: (buf) => writeAllSync(1, buf),
  writeStderr: (buf) => writeAllSync(2, buf),
  readConfigFile: (p) => fs.readFileSync(p, 'utf8'),
  evaluateCloudFreshness: makeCloudFreshness(REAL_FRESHNESS_DEPS).evaluateCloudFreshness,
})

/** Strict: `--config` exactly once, nothing else. Never echoes an argument. */
function parseArgs(argv) {
  if (!Array.isArray(argv)) return { kind: 'invalid' }
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { kind: 'help' }
  let configPath = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--config' && configPath === null && typeof value === 'string' && value !== '') {
      configPath = value
      i++
    } else {
      return { kind: 'invalid' }
    }
  }
  if (configPath === null) return { kind: 'invalid' }
  return { kind: 'run', configPath }
}

/**
 * Write `text` to a stdout writer and report whether it definitely all landed.
 *
 * Only an explicit `true` counts. A writer that returns `false`, returns
 * nothing, or throws is treated as a FAILURE: for the signal line the caller
 * must then exit non-zero rather than let a truncated or absent line be read
 * as output.
 */
function wroteFully(write, text) {
  let result
  try {
    result = write(Buffer.from(text, 'utf8'))
  } catch {
    return false
  }
  return result === true
}

const ENTRYPOINT_DEP_NAMES = Object.freeze([
  'writeStdout',
  'writeStderr',
  'readConfigFile',
  'evaluateCloudFreshness',
])

export function makeFreshnessEntrypoint(deps) {
  const bad = () => {
    throw new TypeError('invalid freshness entrypoint dependencies')
  }
  if (deps === null || typeof deps !== 'object') return bad()
  for (const name of ENTRYPOINT_DEP_NAMES) if (typeof deps[name] !== 'function') return bad()

  // stderr is best-effort: a diagnostic that cannot be delivered changes nothing.
  const err = (text) => {
    try {
      deps.writeStderr(Buffer.from(text, 'utf8'))
    } catch {
      /* a diagnostic is never worth failing over */
    }
  }

  function main(argv) {
    const parsed = parseArgs(argv)
    if (parsed.kind === 'help') {
      return wroteFully(deps.writeStdout, USAGE) ? 0 : 3
    }
    if (parsed.kind === 'invalid') {
      err(LINES.usage)
      err(USAGE)
      return 2
    }

    let config
    try {
      config = loadCloudConfig(parsed.configPath, deps.readConfigFile)
    } catch (e) {
      // The MESSAGE is never printed: it can echo configuration values.
      const code = CONFIG_ERROR_CODES.includes(e?.code) ? e.code : 'config_invalid'
      err(`${TAG} configuration error: ${code}\n`)
      return 3
    }

    let signal
    try {
      signal = deps.evaluateCloudFreshness({ config })
    } catch {
      err(LINES.evaluateFailed)
      return 3
    }

    // Nothing the evaluator returned is ever serialized. A fresh
    // prototype-free projection is built, and IT is validated and printed.
    const projection = projectFreshnessSignal(signal)
    if (projection === null) {
      err(LINES.signalInvalid)
      return 3
    }
    const text = serializeFreshnessSignal(projection)
    if (text === null) {
      err(LINES.signalInvalid)
      return 3
    }

    // A partial write cannot be retracted, so a failure here is reported on
    // stderr and NO second stdout line is attempted.
    if (!wroteFully(deps.writeStdout, `${text}\n`)) {
      err(LINES.stdoutFailed)
      return 3
    }
    err(LINES.notMonitored)
    return 0
  }

  return Object.freeze({ main })
}
