/**
 * Backup artifact contract — shared definitions (E3J2 extraction).
 *
 * WHAT THIS MODULE IS
 * --------------------
 * The producer, the acceptor, and (eventually) an uploader all have to agree
 * on the same things: how an artifact triple is named, what its sidecar looks
 * like, and what "complete" means. Before this module existed that knowledge
 * was spread across `backup-producer.mjs` and `backup-acceptance.mjs`, with
 * the acceptor importing straight from a module named after the producer just
 * to reuse it. This module is the one place the contract lives; the producer
 * and the acceptor both import from it instead of defining or duplicating any
 * part of it.
 *
 * This is a **behaviour-preserving extraction** (E3J2): every symbol below
 * already existed, unchanged, in `backup-producer.mjs` or `backup-config.mjs`,
 * or (for `ARTIFACT_SUFFIXES` and `SNAPSHOT_STAMP_PATTERN`) collapses an
 * identical duplicate literal that already existed in `backup-acceptance.mjs`
 * onto one constant. No error code, message, return value, filename, accepted
 * input, or rejected input changed as part of this move. See
 * `docs/planning/proton-drive-cloud-transport-architecture.md` §1.3.
 *
 * **E3J3 addition:** `publishedTripleNames()` and `ARTIFACT_PREFIX_PATTERN`.
 * `publishedTripleNames()` is the accessor §1.2 point 3 of the memo asked
 * for: it hands a caller (the eventual uploader) the three *published* names
 * derived from `ARTIFACT_SUFFIXES` and cannot structurally return the
 * plaintext `.dump` name the way `buildArtifactNames()` does, because there
 * is no key on its return object that could carry it. `ARTIFACT_PREFIX_PATTERN`
 * collapses the identical `/^[a-z0-9][a-z0-9-]*$/` literal that was
 * duplicated in `backup-config.mjs` (`run.artifactPrefix`) and
 * `backup-acceptance-config.mjs` (`acceptance.artifactPrefix`) onto one
 * constant, for the same reason `ARTIFACT_SUFFIXES` did in E3J2: leaving it
 * duplicated in exactly two places is how it would end up duplicated in a
 * third the next time a config surface needs to validate an artifact-prefix
 * shaped string. No accepted or rejected input changes for either existing
 * site.
 *
 * BOUNDARIES
 * ----------
 * This module imports nothing from `backup-producer.mjs`, `backup-acceptance.mjs`,
 * `backup-boundaries.mjs`, or any configuration module — that would recreate
 * the dependency this extraction removes. Filesystem and hashing access come
 * through the same injected `deps` bundle those modules already use
 * (`makeRealDeps()` in `backup-boundaries.mjs`).
 */

/** Error raised by artifact-contract violations. Carries a machine-readable `code`. */
export class BackupError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'BackupError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** Manifest schema version. Bump whenever a consumer-visible field changes. */
export const MANIFEST_SCHEMA_VERSION = 1

/** The three suffixes a published artifact triple's files carry. */
export const ARTIFACT_SUFFIXES = Object.freeze({
  ciphertext: '.dump.age',
  checksum: '.dump.age.sha256',
  manifest: '.manifest.json',
})

/** A compacted UTC snapshot stamp, `YYYYMMDDTHHMMSSZ`. */
export const SNAPSHOT_STAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/

/**
 * The producer's `run.artifactPrefix` and the acceptor's
 * `acceptance.artifactPrefix` rule: it becomes part of a filename, so it is
 * constrained to plain lowercase-and-hyphen identifiers. Centralized here
 * (E3J3) from the identical literal each config module carried separately.
 */
export const ARTIFACT_PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]*$/

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — the parts of the contract a reader should be able to check by
// eye, and a test can pin without any environment at all.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `2026-09-04T18:00:07Z` → `20260904T180007Z`.
 *
 * Second granularity is deliberate: the stamp is the recovery point, and it is
 * the artifact's human-facing identity. Sub-second uniqueness is provided by
 * the run id and enforced by the destination collision check, not by making
 * filenames unreadable.
 */
export function formatSnapshotStamp(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(String(iso))
  if (!m) {
    throw new BackupError(
      'snapshot_timestamp_malformed',
      `snapshot timestamp is not an ISO-8601 UTC instant: ${JSON.stringify(iso)}`,
    )
  }
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`
}

/** The four names a run owns. `base` is the artifact identity. */
export function buildArtifactNames(prefix, stamp) {
  const base = `${prefix}-${stamp}`
  return Object.freeze({
    base,
    ciphertext: `${base}${ARTIFACT_SUFFIXES.ciphertext}`,
    checksum: `${base}${ARTIFACT_SUFFIXES.checksum}`,
    manifest: `${base}${ARTIFACT_SUFFIXES.manifest}`,
    plaintext: `${base}.dump`,
  })
}

/**
 * The three names a *published* artifact triple owns — deliberately never
 * the plaintext dump.
 *
 * `buildArtifactNames()` returns a `plaintext` key because the producer's
 * staging directory legitimately holds that file before encryption; a
 * consumer that only ever deals with published objects (the acceptor's
 * inbox/archive, and the eventual cloud uploader) should not have to remember
 * to ignore it. This accessor's return object has no key that could carry the
 * plaintext name, so a caller cannot pass it into a remote or transport path
 * by mistake — the guarantee lives in the function's shape, not in a
 * reviewer's attention (§1.4 point 2 of the E3J1 memo).
 */
export function publishedTripleNames(base) {
  return Object.freeze({
    ciphertext: `${base}${ARTIFACT_SUFFIXES.ciphertext}`,
    checksum: `${base}${ARTIFACT_SUFFIXES.checksum}`,
    manifest: `${base}${ARTIFACT_SUFFIXES.manifest}`,
  })
}

/**
 * Parse `sha256sum`-style sidecar text: `<64 hex>  <filename>`.
 * Returns `{ hash, filename }` or throws.
 */
export function parseChecksumSidecar(text, path = '<sidecar>') {
  const line = String(text)
    .split('\n')
    .find((l) => l.trim() !== '')
  const m = line ? /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line.trim()) : null
  if (!m) {
    throw new BackupError(
      'checksum_sidecar_malformed',
      `${path} is not a "<sha256>  <filename>" line.`,
    )
  }
  return { hash: m[1], filename: m[2] }
}

/** The sidecar text this producer writes. */
export function formatChecksumSidecar(hash, filename) {
  return `${hash}  ${filename}\n`
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact completion — the definition, and the checker that decides it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An artifact is COMPLETE at a location if and only if all of the following
 * hold. Nothing weaker counts, and in particular the *presence* of the three
 * files does not: the destination may be a drvfs mount where rename atomicity
 * is not assertable, so a partially-copied file can appear under its final
 * name. The hash equality, not the rename, is what makes that harmless.
 *
 *   1. all three files exist: ciphertext, `.sha256` sidecar, manifest;
 *   2. the manifest parses, and its `schema_version` is recognised;
 *   3. `manifest.artifact` names the ciphertext file;
 *   4. the sidecar names the ciphertext file;
 *   5. sha256(ciphertext) equals the sidecar hash;
 *   6. sha256(ciphertext) equals `manifest.ciphertext.sha256`;
 *   7. the ciphertext's byte length equals `manifest.ciphertext.bytes`.
 *
 * Returns `{ complete, failures: string[], manifest|null }` — it never throws
 * for an incomplete artifact, because "incomplete" is an ordinary answer that
 * transport and acceptance will need to act on.
 */
export function verifyArtifactCompletion({ dir, base, deps }) {
  const files = {
    ciphertext: `${dir}/${base}${ARTIFACT_SUFFIXES.ciphertext}`,
    checksum: `${dir}/${base}${ARTIFACT_SUFFIXES.checksum}`,
    manifest: `${dir}/${base}${ARTIFACT_SUFFIXES.manifest}`,
  }
  const failures = []
  for (const [label, path] of Object.entries(files)) {
    if (!deps.fs.existsSync(path)) failures.push(`missing ${label}: ${path}`)
  }
  if (failures.length > 0) return { complete: false, failures, manifest: null }

  let manifest = null
  try {
    manifest = JSON.parse(deps.fs.readFileSync(files.manifest, 'utf8'))
  } catch (err) {
    failures.push(`manifest is not valid JSON: ${err?.message ?? String(err)}`)
    return { complete: false, failures, manifest: null }
  }
  if (manifest?.schema_version !== MANIFEST_SCHEMA_VERSION) {
    failures.push(
      `manifest schema_version ${JSON.stringify(manifest?.schema_version)} is not the expected ${MANIFEST_SCHEMA_VERSION}`,
    )
  }
  if (manifest?.artifact !== `${base}${ARTIFACT_SUFFIXES.ciphertext}`) {
    failures.push(
      `manifest.artifact ${JSON.stringify(manifest?.artifact)} does not name ${base}${ARTIFACT_SUFFIXES.ciphertext}`,
    )
  }

  let sidecar = null
  try {
    sidecar = parseChecksumSidecar(deps.fs.readFileSync(files.checksum, 'utf8'), files.checksum)
  } catch (err) {
    failures.push(err.message)
  }
  if (sidecar && sidecar.filename !== `${base}${ARTIFACT_SUFFIXES.ciphertext}`) {
    failures.push(
      `sidecar names ${sidecar.filename}, expected ${base}${ARTIFACT_SUFFIXES.ciphertext}`,
    )
  }

  let actualHash = null
  let actualBytes = null
  try {
    actualHash = deps.sha256File(files.ciphertext)
    actualBytes = deps.fs.statSync(files.ciphertext).size
  } catch (err) {
    failures.push(`could not read ciphertext: ${err?.message ?? String(err)}`)
  }
  if (sidecar && actualHash && sidecar.hash !== actualHash) {
    failures.push(`ciphertext sha256 ${actualHash} does not match sidecar ${sidecar.hash}`)
  }
  if (actualHash && manifest?.ciphertext?.sha256 !== actualHash) {
    failures.push(
      `ciphertext sha256 ${actualHash} does not match manifest ${JSON.stringify(manifest?.ciphertext?.sha256)}`,
    )
  }
  if (actualBytes !== null && manifest?.ciphertext?.bytes !== actualBytes) {
    failures.push(
      `ciphertext is ${actualBytes} bytes, manifest says ${JSON.stringify(manifest?.ciphertext?.bytes)}`,
    )
  }
  return { complete: failures.length === 0, failures, manifest }
}
