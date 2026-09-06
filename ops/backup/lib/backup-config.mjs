/**
 * Backup producer — configuration contract.
 *
 * WHY THIS FILE IS SEPARATE AND FAIL-CLOSED
 * -----------------------------------------
 * The producer reads a production database and writes a full copy of it to
 * disk. Every value that decides *which* database, *where* the copy lands, and
 * *how much* disk it may consume is therefore stated explicitly in a config
 * file and validated here. There are **no defaults**: a missing key is a
 * validation error, never a silently-chosen value. This mirrors the rule
 * already enforced by apps/worker/scripts/lib/test-db-guard.mjs, and for the
 * same reason — a defaulted container/database name is how a "test" job ends
 * up pointed at production.
 *
 * Two keys are deliberately required-but-nullable, because "not applicable" is
 * a real answer that the operator must give on purpose rather than by omission:
 *
 *   staging.backingVolume / destination.backingVolume
 *       `null` asserts "this filesystem's own free-space report is the truth".
 *       On WSL that is FALSE for anything on the ext4 root: `df /` reports the
 *       sparse VHDX's logical size (~945 GB observed) while the backing NTFS
 *       volume had ~21 GB. See docs/operations/backup-producer.md.
 *
 * This module performs no I/O of its own beyond the injected `readFile`.
 */

/** Error raised by every configuration rejection. Carries a machine-readable `code`. */
export class ConfigError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ConfigError'
    this.code = code
  }
}

/** Manifest schema version. Bump whenever a consumer-visible field changes. */
export const MANIFEST_SCHEMA_VERSION = 1

/** `schema.table`, both plain lowercase identifiers. */
const QUALIFIED_TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/
/** A plain lowercase SQL identifier. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/
/** Docker container name. */
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

// ─────────────────────────────────────────────────────────────────────────────
// Shared validation primitives.
//
// Exported because the destination-side acceptance contract
// (backup-acceptance-config.mjs) has to be fail-closed in exactly the same way
// — no defaults, absolute paths only, "not applicable" stated explicitly — and
// two copies of these rules would be two places for them to drift apart. They
// are validators, not general utilities; nothing outside the backup
// configuration contracts should use them.
// ─────────────────────────────────────────────────────────────────────────────

export function fail(code, message) {
  throw new ConfigError(code, message)
}

export function requireObject(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('config_field_type', `${path} must be an object.`)
  }
  return value
}

export function requireString(obj, key, path) {
  const value = obj[key]
  if (typeof value !== 'string' || value.trim() === '') {
    fail('config_field_missing', `${path}.${key} must be a non-empty string (there is no default).`)
  }
  return value.trim()
}

export function requireAbsolutePath(obj, key, path) {
  const value = requireString(obj, key, path)
  if (!value.startsWith('/')) {
    fail(
      'config_field_not_absolute',
      `${path}.${key} must be an absolute path (got ${JSON.stringify(value)}). Relative paths ` +
        `resolve against whatever cwd a timer happens to give the unit.`,
    )
  }
  return value
}

export function requirePositiveInt(obj, key, path) {
  const value = obj[key]
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(
      'config_field_missing',
      `${path}.${key} must be a positive integer (there is no default). Got ${JSON.stringify(value)}.`,
    )
  }
  return value
}

/**
 * A backing-volume declaration, or an explicit `null`.
 *
 * The key must be PRESENT. Omitting it is an error, because "I did not think
 * about whether df lies here" and "df tells the truth here" must not look the
 * same in a config file.
 */
export function requireBackingVolume(obj, path) {
  if (!Object.prototype.hasOwnProperty.call(obj, 'backingVolume')) {
    fail(
      'config_field_missing',
      `${path}.backingVolume must be present. Use null to assert that this filesystem's own ` +
        `free-space report is authoritative, or {"mountPoint": "...", "minFreeBytes": N} to name ` +
        `the volume that actually backs it. On WSL, "df /" reports a sparse VHDX's logical size, ` +
        `not the free space on the Windows volume holding it.`,
    )
  }
  const value = obj.backingVolume
  if (value === null) return null
  requireObject(value, `${path}.backingVolume`)
  return {
    mountPoint: requireAbsolutePath(value, 'mountPoint', `${path}.backingVolume`),
    minFreeBytes: requirePositiveInt(value, 'minFreeBytes', `${path}.backingVolume`),
  }
}

/**
 * Validate a parsed configuration object and return a frozen, normalised copy.
 *
 * @param {unknown} raw
 * @param {string} sourcePath  Only used to phrase errors.
 */
export function validateConfig(raw, sourcePath = '<config>') {
  requireObject(raw, sourcePath)

  // ── source database ────────────────────────────────────────────────────────
  const src = requireObject(raw.source, `${sourcePath}.source`)
  const container = requireString(src, 'container', `${sourcePath}.source`)
  if (!CONTAINER_NAME.test(container)) {
    fail('config_field_invalid', `${sourcePath}.source.container is not a valid container name.`)
  }
  const database = requireString(src, 'database', `${sourcePath}.source`)
  const user = requireString(src, 'user', `${sourcePath}.source`)
  for (const [key, value] of [
    ['database', database],
    ['user', user],
  ]) {
    if (!IDENTIFIER.test(value)) {
      fail(
        'config_field_invalid',
        `${sourcePath}.source.${key} must be a plain lowercase SQL identifier (got ${JSON.stringify(value)}).`,
      )
    }
  }

  // ── manifest content ───────────────────────────────────────────────────────
  const manifest = requireObject(raw.manifest, `${sourcePath}.manifest`)
  const criticalTables = manifest.criticalTables
  if (!Array.isArray(criticalTables) || criticalTables.length === 0) {
    fail(
      'config_field_missing',
      `${sourcePath}.manifest.criticalTables must be a non-empty array of "schema.table" names. ` +
        `Every one of them is REQUIRED to count successfully inside the dump's snapshot; a count ` +
        `that cannot be taken fails the backup rather than downgrading the manifest.`,
    )
  }
  const seenTables = new Set()
  for (const entry of criticalTables) {
    if (typeof entry !== 'string' || !QUALIFIED_TABLE.test(entry)) {
      fail(
        'config_field_invalid',
        `${sourcePath}.manifest.criticalTables entries must be "schema.table" with plain lowercase ` +
          `identifiers (got ${JSON.stringify(entry)}).`,
      )
    }
    if (seenTables.has(entry)) {
      fail('config_field_invalid', `${sourcePath}.manifest.criticalTables lists "${entry}" twice.`)
    }
    seenTables.add(entry)
  }

  const mig = requireObject(manifest.migrations, `${sourcePath}.manifest.migrations`)
  const migrations = {
    schema: requireString(mig, 'schema', `${sourcePath}.manifest.migrations`),
    table: requireString(mig, 'table', `${sourcePath}.manifest.migrations`),
    idColumn: requireString(mig, 'idColumn', `${sourcePath}.manifest.migrations`),
  }
  for (const [key, value] of Object.entries(migrations)) {
    if (!IDENTIFIER.test(value)) {
      fail(
        'config_field_invalid',
        `${sourcePath}.manifest.migrations.${key} must be a plain lowercase SQL identifier ` +
          `(got ${JSON.stringify(value)}).`,
      )
    }
  }

  const imageRefs = manifest.imageRefs
  if (imageRefs !== null && (typeof imageRefs !== 'object' || Array.isArray(imageRefs))) {
    fail(
      'config_field_type',
      `${sourcePath}.manifest.imageRefs must be an object of {label: "image:tag"} or null.`,
    )
  }
  if (imageRefs) {
    for (const [label, ref] of Object.entries(imageRefs)) {
      if (typeof ref !== 'string' || ref.trim() === '') {
        fail(
          'config_field_invalid',
          `${sourcePath}.manifest.imageRefs["${label}"] must be a non-empty string.`,
        )
      }
    }
  }

  // ── encryption boundary ────────────────────────────────────────────────────
  const enc = requireObject(raw.encryption, `${sourcePath}.encryption`)
  const encryption = {
    executable: requireString(enc, 'executable', `${sourcePath}.encryption`),
    recipientFile: requireAbsolutePath(enc, 'recipientFile', `${sourcePath}.encryption`),
    // The literal bytes the ciphertext must start with. Stated in config rather
    // than hardcoded so the contract is auditable and so a different tool can
    // be substituted without editing code. It is a format assertion, NOT a
    // cryptographic verification.
    expectedHeader: requireString(enc, 'expectedHeader', `${sourcePath}.encryption`),
  }

  // ── staging (bounded, cleaned up, capacity-checked on BOTH layers) ─────────
  const stg = requireObject(raw.staging, `${sourcePath}.staging`)
  const staging = {
    root: requireAbsolutePath(stg, 'root', `${sourcePath}.staging`),
    minFreeBytes: requirePositiveInt(stg, 'minFreeBytes', `${sourcePath}.staging`),
    backingVolume: requireBackingVolume(stg, `${sourcePath}.staging`),
    maxPlaintextBytes: requirePositiveInt(stg, 'maxPlaintextBytes', `${sourcePath}.staging`),
    maxStagingBytes: requirePositiveInt(stg, 'maxStagingBytes', `${sourcePath}.staging`),
    // Best-effort overwrite of the plaintext dump before unlinking it. See the
    // limitation note in docs/operations/backup-producer.md — on a journalling
    // filesystem over flash this is a reduction in exposure, not erasure.
    shredPlaintext: stg.shredPlaintext,
  }
  if (typeof staging.shredPlaintext !== 'boolean') {
    fail(
      'config_field_missing',
      `${sourcePath}.staging.shredPlaintext must be true or false (there is no default).`,
    )
  }
  if (staging.maxStagingBytes <= staging.maxPlaintextBytes) {
    fail(
      'config_field_invalid',
      `${sourcePath}.staging.maxStagingBytes (${staging.maxStagingBytes}) must exceed ` +
        `maxPlaintextBytes (${staging.maxPlaintextBytes}) — plaintext and ciphertext coexist in ` +
        `the staging directory between encryption and cleanup.`,
    )
  }

  // ── destination (retained artifacts) ───────────────────────────────────────
  const dst = requireObject(raw.destination, `${sourcePath}.destination`)
  const destination = {
    dir: requireAbsolutePath(dst, 'dir', `${sourcePath}.destination`),
    minFreeBytes: requirePositiveInt(dst, 'minFreeBytes', `${sourcePath}.destination`),
    backingVolume: requireBackingVolume(dst, `${sourcePath}.destination`),
  }
  if (destination.dir === staging.root) {
    fail(
      'config_field_invalid',
      `${sourcePath}.destination.dir and staging.root must differ; staging is deleted on every ` +
        `exit path, including failures.`,
    )
  }

  // ── run exclusion ──────────────────────────────────────────────────────────
  const run = requireObject(raw.run, `${sourcePath}.run`)
  const runCfg = {
    lockFile: requireAbsolutePath(run, 'lockFile', `${sourcePath}.run`),
    lockStaleAfterMs: requirePositiveInt(run, 'lockStaleAfterMs', `${sourcePath}.run`),
    artifactPrefix: requireString(run, 'artifactPrefix', `${sourcePath}.run`),
    // Wall-clock ceiling for ONE boundary operation (dump, archive validation,
    // encryption). This is not a performance knob: the run lock is never
    // reclaimed automatically (see acquireRunLock), so without a deadline a
    // hung `age` or a wedged `docker exec` would hold the lock — and therefore
    // block every future backup — until an operator noticed.
    operationTimeoutMs: requirePositiveInt(run, 'operationTimeoutMs', `${sourcePath}.run`),
    // Ceiling on cancellation ITSELF. SIGTERM, then SIGKILL at the halfway
    // point, then give up and report `timeout` rather than waiting forever.
    cancelGraceMs: requirePositiveInt(run, 'cancelGraceMs', `${sourcePath}.run`),
    // Ceiling on the read-only `ps` probe the producer uses to decide whether
    // its OWN container-side command has ended after a cancellation. If the
    // probe cannot answer inside this budget the run lock is retained rather
    // than released — uncertainty must never be resolved in favour of
    // availability. See docs/operations/backup-producer.md §2.7a.
    containerProbeTimeoutMs: requirePositiveInt(
      run,
      'containerProbeTimeoutMs',
      `${sourcePath}.run`,
    ),
    // `pg_restore --list` runs on every cycle; the full archive read is the
    // deeper check and is expensive, so the caller opts into it per run.
    fullArchiveReadDefault: run.fullArchiveReadDefault,
  }
  if (runCfg.cancelGraceMs >= runCfg.operationTimeoutMs) {
    fail(
      'config_field_invalid',
      `${sourcePath}.run.cancelGraceMs (${runCfg.cancelGraceMs}) must be smaller than ` +
        `operationTimeoutMs (${runCfg.operationTimeoutMs}): cancelling a timed-out operation has to ` +
        `fit inside the budget that declared it timed out.`,
    )
  }
  if (runCfg.containerProbeTimeoutMs >= runCfg.operationTimeoutMs) {
    fail(
      'config_field_invalid',
      `${sourcePath}.run.containerProbeTimeoutMs (${runCfg.containerProbeTimeoutMs}) must be smaller ` +
        `than operationTimeoutMs (${runCfg.operationTimeoutMs}): the probe runs during teardown, ` +
        `after an operation has already been given its full budget.`,
    )
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(runCfg.artifactPrefix)) {
    fail(
      'config_field_invalid',
      `${sourcePath}.run.artifactPrefix must match /^[a-z0-9][a-z0-9-]*$/ (it becomes a filename).`,
    )
  }
  if (typeof runCfg.fullArchiveReadDefault !== 'boolean') {
    fail(
      'config_field_missing',
      `${sourcePath}.run.fullArchiveReadDefault must be true or false (there is no default).`,
    )
  }

  return Object.freeze({
    source: Object.freeze({ container, database, user }),
    manifest: Object.freeze({
      criticalTables: Object.freeze([...criticalTables]),
      migrations: Object.freeze(migrations),
      imageRefs: imageRefs ? Object.freeze({ ...imageRefs }) : null,
    }),
    encryption: Object.freeze(encryption),
    staging: Object.freeze(staging),
    destination: Object.freeze(destination),
    run: Object.freeze(runCfg),
  })
}

/**
 * Read and validate a configuration file.
 *
 * @param {string} path
 * @param {(p: string) => string} readFile
 */
export function loadConfig(path, readFile) {
  let text
  try {
    text = readFile(path)
  } catch (err) {
    throw new ConfigError(
      'config_unreadable',
      `could not read backup config ${path}: ${err?.message ?? String(err)}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(
      'config_unparseable',
      `backup config ${path} is not valid JSON: ${err?.message ?? String(err)}`,
    )
  }
  return validateConfig(parsed, path)
}
