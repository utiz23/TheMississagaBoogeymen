/**
 * Backup producer — snapshot-and-artifact foundation (Phase 1A).
 *
 * WHAT THIS COMPONENT IS
 * ----------------------
 * One run turns the live PostgreSQL database into exactly one **artifact
 * triple** in a destination directory:
 *
 *     <prefix>-<snapshotTs>.dump.age            ciphertext
 *     <prefix>-<snapshotTs>.dump.age.sha256     sidecar hash
 *     <prefix>-<snapshotTs>.manifest.json       plaintext metadata, no secrets
 *
 * plus a `latest.json` pointer. It does NOT transfer, accept, prune, verify
 * remotely, or restore anything — those are later phases and are deliberately
 * absent from this file.
 *
 * THE ONE PROPERTY THAT MAKES THE MANIFEST WORTH ANYTHING
 * ------------------------------------------------------
 * The worker writes every five minutes. Counting rows in a session other than
 * the dump's yields numbers that do not describe the dump. So a single
 * REPEATABLE READ transaction exports a snapshot, `pg_dump --snapshot=<id>`
 * consumes it on a second connection, and the critical-table counts are then
 * taken **inside that same still-open transaction**. Between the dump and the
 * counts the producer re-probes the session's backend pid and its transaction
 * start time; in REPEATABLE READ `now()` is fixed at transaction start, so an
 * unchanged pair proves the transaction — and therefore the snapshot — is the
 * same one the dump read.
 *
 * If any part of that fails, **the run fails**. There is no `counts_snapshot:
 * false` degradation path: a produced artifact either carries counts provably
 * taken from the dump's own snapshot, or it does not exist. (The field is still
 * written, always `true`, so a consumer can assert on it rather than infer.)
 *
 * VERSION MATCHING
 * ----------------
 * `pg_dump` and `pg_restore` are ALWAYS the ones inside the database container,
 * reached by `docker exec`. Never a host client. A host `pg_dump` 18.x will
 * happily dump a 16.x server and produce an archive that `postgres:16-alpine`'s
 * `pg_restore` cannot read — a failure that only surfaces during a recovery.
 * Archive validation pipes the staged file into the container over stdin, so
 * nothing is written inside the container either.
 *
 * BOUNDARIES
 * ----------
 * Every process, filesystem and clock interaction is injected via `deps`, so
 * the whole contract is exercisable without Docker, PostgreSQL, `age`, a key,
 * or production data.
 */

import { MANIFEST_SCHEMA_VERSION } from './backup-config.mjs'

/** Error raised by every producer rejection. Carries a machine-readable `code`. */
export class BackupError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'BackupError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

/** A sane upper bound on how much of the ciphertext we read to check its header. */
const HEADER_PROBE_BYTES = 64

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
    ciphertext: `${base}.dump.age`,
    checksum: `${base}.dump.age.sha256`,
    manifest: `${base}.manifest.json`,
    plaintext: `${base}.dump`,
  })
}

/**
 * The exact argv used to invoke the encryption tool.
 *
 * Exported so the contract is asserted by a test rather than buried in a spawn
 * call. Two properties matter and both are visible here:
 *
 *   - the tool is handed an input path and a **recipients file**, never a
 *     private key, and is never asked to decrypt;
 *   - there is **no `--output`**. The ciphertext comes back on stdout and the
 *     producer owns the file descriptor it lands in. That is what makes the
 *     byte ceiling a bound rather than a measurement (see runEncryption), and
 *     it also means the tool never writes into the staging directory, so a
 *     child that outlives a forced teardown cannot write into a directory
 *     being deleted.
 *
 * `age` supports this natively: with no `-o`/`--output` it writes to standard
 * output. UNVERIFIED against the real binary — `age` is not installed here.
 */
export function buildEncryptionArgv(encryption, { executablePath, inPath }) {
  return [executablePath, '--encrypt', '--recipients-file', encryption.recipientFile, inPath]
}

/** `to_regclass` probe for every table the manifest requires. */
export function buildTableExistenceQuery(tables) {
  const values = tables.map((t) => `('${t}')`).join(',')
  return `SELECT x.t || '|' || (to_regclass(x.t) IS NOT NULL)::text FROM (VALUES ${values}) AS x(t);`
}

/** One statement, one snapshot, one count per critical table. */
export function buildCountsQuery(tables) {
  return (
    tables
      .map((t) => {
        const [schema, table] = t.split('.')
        return `SELECT '${t}' || '|' || count(*)::text FROM "${schema}"."${table}"`
      })
      .join('\nUNION ALL\n') + ';'
  )
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
    ciphertext: `${dir}/${base}.dump.age`,
    checksum: `${dir}/${base}.dump.age.sha256`,
    manifest: `${dir}/${base}.manifest.json`,
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
  if (manifest?.artifact !== `${base}.dump.age`) {
    failures.push(
      `manifest.artifact ${JSON.stringify(manifest?.artifact)} does not name ${base}.dump.age`,
    )
  }

  let sidecar = null
  try {
    sidecar = parseChecksumSidecar(deps.fs.readFileSync(files.checksum, 'utf8'), files.checksum)
  } catch (err) {
    failures.push(err.message)
  }
  if (sidecar && sidecar.filename !== `${base}.dump.age`) {
    failures.push(`sidecar names ${sidecar.filename}, expected ${base}.dump.age`)
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

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent-run exclusion.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take the run lock, or refuse.
 *
 * `O_CREAT|O_EXCL` is the whole mechanism, and it is the ONLY mutation this
 * function performs on an existing lock file: nothing here ever unlinks a lock
 * it did not create.
 *
 * WHY THERE IS NO AUTOMATIC STALE-LOCK RECOVERY
 * ---------------------------------------------
 * An earlier version broke a lock whose recorded holder was provably gone —
 * read the holder, `kill(pid,0)` fails, unlink, re-create. That is a
 * check-then-unlink race with a concrete two-winner interleaving:
 *
 *   A reads the dead holder H.
 *   B reads the dead holder H.
 *   A unlinks H and creates A's lock — A now holds the lock.
 *   B unlinks *A's live lock* and creates B's lock — B now also holds it.
 *
 * Both producers then dump, stage and publish concurrently. No variant of
 * "check, then unlink" fixes this, because the unlink is unconditional by the
 * time it runs; and re-checking after the unlink only narrows the window.
 *
 * So reclamation is gone. A lock whose holder is gone is reported as
 * `lock_stale` and left exactly where it is, for a human to remove after
 * confirming no producer is running. The cost — a SIGKILLed or power-cut run
 * blocks later runs until someone looks — is bounded by
 * `run.operationTimeoutMs`, which stops any single boundary operation from
 * holding the lock indefinitely, and is paid deliberately: two concurrent
 * producers publishing into the same destination is the worse failure.
 *
 * Returns `{ release(), warnings }`.
 */
export function acquireRunLock({ config, deps, runId, log }) {
  const path = config.run.lockFile
  const host = deps.hostname()
  const payload = JSON.stringify({ runId, pid: deps.pid, host, startedAt: deps.now() }) + '\n'
  const warnings = []

  const tryCreate = () => {
    const fd = deps.fs.openSync(path, 'wx', 0o600)
    try {
      deps.fs.writeSync(fd, payload)
    } finally {
      deps.fs.closeSync(fd)
    }
  }

  try {
    tryCreate()
  } catch (err) {
    if (err?.code !== 'EEXIST') {
      throw new BackupError(
        'lock_unwritable',
        `could not create run lock ${path}: ${err?.message ?? String(err)}`,
        err,
      )
    }
    let holder
    try {
      holder = JSON.parse(deps.fs.readFileSync(path, 'utf8'))
    } catch (parseErr) {
      throw new BackupError(
        'lock_unreadable',
        `run lock ${path} exists but is not readable JSON (${parseErr?.message ?? String(parseErr)}). ` +
          `Refusing to guess whether a run is in flight — inspect and remove it deliberately.`,
      )
    }
    if (holder?.retained === true) {
      // A previous run could not confirm that the work it started had stopped,
      // so it deliberately kept the lock. Availability must not silently
      // override mutual exclusion: only an operator clears this.
      throw new BackupError(
        'lock_retained_uncertain',
        `run lock ${path} was RETAINED by run ${JSON.stringify(holder.runId)} (pid ${holder.pid}) at ` +
          `${holder.retainedAt ?? 'an unrecorded time'} because it could not confirm its own work had ` +
          `stopped. Reason: ${holder.reason ?? '(none recorded)'}. Unconfirmed: ` +
          `${(holder.unconfirmed ?? []).map((u) => `${u.label} [${u.kind}] ${u.outcome}`).join('; ') || '(none listed)'}. ` +
          `${holder.recovery ?? ''}`.trim(),
      )
    }
    if (holder?.host !== host) {
      throw new BackupError(
        'lock_foreign_host',
        `run lock ${path} is held by host ${JSON.stringify(holder?.host)}, not ${host}. ` +
          `A lock from another host is never broken automatically.`,
      )
    }
    const ageMs = deps.now() - (Number(holder.startedAt) || 0)
    const ageText = Number.isFinite(ageMs) ? `${Math.round(ageMs / 1000)}s` : 'unknown'
    if (typeof holder?.pid !== 'number' || deps.processAlive(holder.pid)) {
      // A live holder is ALWAYS a refusal. `lockStaleAfterMs` only changes how
      // loudly it is reported: past that age a live holder is a probable hang,
      // which is a different operational problem from a normal overlap.
      const hung = Number.isFinite(ageMs) && ageMs > config.run.lockStaleAfterMs
      throw new BackupError(
        hung ? 'concurrent_run_hung' : 'concurrent_run',
        `run lock ${path} is held by pid ${JSON.stringify(holder?.pid)} (run ${JSON.stringify(holder?.runId)}) ` +
          `on this host, age ${ageText}. Refusing to run two producers against the ` +
          `same database and destination.` +
          (hung
            ? ` That holder has been running longer than run.lockStaleAfterMs ` +
              `(${config.run.lockStaleAfterMs}ms) and is probably hung — investigate it rather than ` +
              `waiting for the next cycle.`
            : ''),
      )
    }
    // The holder is gone. The lock is NOT reclaimed — see the docblock. It is
    // reported, left untouched, and cleared by a human.
    throw new BackupError(
      'lock_stale',
      `run lock ${path} is held by pid ${holder.pid} (run ${JSON.stringify(holder.runId)}, age ${ageText}) ` +
        `which is no longer running. Stale locks are NEVER reclaimed automatically: doing so is a ` +
        `check-then-unlink race that lets two producers both believe they hold the lock. ` +
        `Confirm no producer is running (e.g. "pgrep -af eanhl-backup"), then remove it deliberately: ` +
        `rm ${path}`,
    )
  }

  let settled = false
  /** Read the lock back and confirm it is still ours before touching it. */
  const stillOurs = () => {
    try {
      return JSON.parse(deps.fs.readFileSync(path, 'utf8'))?.runId === runId
    } catch {
      return false // already removed or replaced; not ours to touch
    }
  }
  return {
    warnings,
    /** Give the lock up. Only legitimate once the work is CONFIRMED stopped. */
    release() {
      if (settled) return
      settled = true
      if (!stillOurs()) return
      try {
        deps.fs.unlinkSync(path)
      } catch (err) {
        log(`WARN: could not remove run lock ${path}: ${err?.message ?? String(err)}`)
      }
    },
    /**
     * Keep the lock and record why, so the next producer refuses with an
     * explanation instead of racing work that may still be running.
     *
     * Synchronous, so the forced-exit path can call it too.
     */
    retain({ reason, unconfirmed = [] }) {
      if (settled) return false
      settled = true
      if (!stillOurs()) return false
      const payload = {
        runId,
        pid: deps.pid,
        host,
        startedAt: deps.now(),
        retained: true,
        retainedAt: new Date(deps.now()).toISOString(),
        reason,
        unconfirmed,
        recovery:
          `RECOVERY: this lock is intentional. Confirm that nothing this run started is still ` +
          `running — on this host ("pgrep -af eanhl-backup"), and, for any docker-exec entry above, ` +
          `inside the database container ("docker exec <container> ps -A -o args="). Do NOT kill ` +
          `processes you did not identify as this run's. When you are satisfied, remove the lock: ` +
          `rm ${path}`,
      }
      try {
        deps.fs.writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })
        log(`RETAINED run lock ${path}: ${reason}`)
        return true
      } catch (err) {
        log(`WARN: could not mark run lock ${path} retained: ${err?.message ?? String(err)}`)
        return false
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Capacity preflight — both layers.
// ─────────────────────────────────────────────────────────────────────────────

/** Nearest existing ancestor of `path`, so a not-yet-created dir can be measured. */
function existingAncestor(path, deps) {
  let p = path
  for (;;) {
    if (deps.fs.existsSync(p)) return p
    const parent = p.slice(0, p.lastIndexOf('/')) || '/'
    if (parent === p) return '/'
    p = parent
  }
}

/**
 * Check a directory's own filesystem AND, when declared, the volume that
 * actually backs it.
 *
 * On WSL the second check is the load-bearing one. `df /` reports the sparse
 * ext4 VHDX's logical size; the real headroom is whatever is free on the
 * Windows volume holding that image. A preflight that only reads `df /` will
 * cheerfully start a dump onto a full disk.
 */
export function checkCapacity({ label, dir, minFreeBytes, backingVolume, needBytes = 0, deps }) {
  const problems = []
  const measured = []
  const probe = (what, target, floor) => {
    let info
    try {
      info = deps.freeSpace(existingAncestor(target, deps))
    } catch (err) {
      problems.push(
        `${what}: could not read free space for ${target}: ${err?.message ?? String(err)}`,
      )
      return
    }
    const required = floor + needBytes
    measured.push({ what, path: target, freeBytes: info.freeBytes, requiredBytes: required })
    if (info.freeBytes < required) {
      problems.push(
        `${what}: ${target} has ${info.freeBytes} bytes free, needs at least ${required} ` +
          `(floor ${floor}${needBytes ? ` + ${needBytes} for this artifact` : ''})`,
      )
    }
  }
  probe(`${label} filesystem`, dir, minFreeBytes)
  if (backingVolume) {
    probe(`${label} backing volume`, backingVolume.mountPoint, backingVolume.minFreeBytes)
  }
  return { ok: problems.length === 0, problems, measured }
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption preflight.
// ─────────────────────────────────────────────────────────────────────────────

/** An age recipient line: an `age1…` public key, or an SSH public key. */
const RECIPIENT_LINE =
  /^(age1[0-9a-z]+|(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+/=]+.*)$/

/**
 * Resolve the encryption executable and sanity-check the recipients file.
 *
 * This proves the *boundary* is wired up. It proves nothing cryptographic: it
 * does not verify the key, and it cannot — the producer never holds an
 * identity, by design.
 */
export function preflightEncryption({ config, deps }) {
  const executablePath = deps.resolveExecutable(config.encryption.executable)
  if (!executablePath) {
    throw new BackupError(
      'encryption_executable_missing',
      `encryption executable ${JSON.stringify(config.encryption.executable)} was not found. ` +
        `The producer will not fall back to writing an unencrypted artifact.`,
    )
  }
  let recipients
  try {
    recipients = deps.fs.readFileSync(config.encryption.recipientFile, 'utf8')
  } catch (err) {
    throw new BackupError(
      'recipient_file_unreadable',
      `could not read recipients file ${config.encryption.recipientFile}: ${err?.message ?? String(err)}`,
      err,
    )
  }
  const lines = recipients
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  if (lines.length === 0) {
    throw new BackupError(
      'recipient_file_empty',
      `recipients file ${config.encryption.recipientFile} contains no recipient lines.`,
    )
  }
  for (const line of lines) {
    if (!RECIPIENT_LINE.test(line)) {
      throw new BackupError(
        'recipient_file_malformed',
        `recipients file ${config.encryption.recipientFile} contains a line that is not an age or ` +
          `SSH public key. Refusing to encrypt to an unrecognised recipient.`,
      )
    }
  }
  return {
    executablePath,
    recipientCount: lines.length,
    // A public key is not a secret, but its hash is the stable way to tie an
    // artifact to a key without printing the key into a manifest.
    recipientFingerprint: deps.sha256File(config.encryption.recipientFile),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The snapshot-owning transaction.
// ─────────────────────────────────────────────────────────────────────────────

/** psql `-t -A` emits one row per line; drop the trailing blank. */
const nonEmptyRows = (lines) => lines.filter((l) => l !== '')

async function ask(session, sql, what) {
  let lines
  try {
    lines = await session.query(sql)
  } catch (err) {
    throw new BackupError(
      'snapshot_session_failed',
      `the snapshot-owning session failed while ${what}: ${err?.message ?? String(err)}`,
      err,
    )
  }
  return nonEmptyRows(lines)
}

/**
 * `BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_export_snapshot();`
 *
 * Captures, in one row, everything needed both to share the snapshot and to
 * prove later that the transaction is still the same one:
 * the snapshot id, the transaction's `now()` (fixed for the life of a
 * REPEATABLE READ transaction), the backend pid, the server version and the
 * cluster system identifier.
 */
export async function openSnapshot(session) {
  const rows = await ask(
    session,
    'BEGIN ISOLATION LEVEL REPEATABLE READ;\n' +
      "SELECT pg_export_snapshot() || '|' ||\n" +
      "       to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') || '|' ||\n" +
      "       extract(epoch from now())::text || '|' ||\n" +
      "       pg_backend_pid()::text || '|' ||\n" +
      "       current_setting('server_version') || '|' ||\n" +
      '       (SELECT system_identifier::text FROM pg_control_system());',
    'exporting the snapshot',
  )
  if (rows.length !== 1) {
    throw new BackupError(
      'snapshot_export_failed',
      `expected exactly one row from pg_export_snapshot(), got ${rows.length}.`,
    )
  }
  const parts = rows[0].split('|')
  if (parts.length !== 6 || parts.some((p) => p === '')) {
    throw new BackupError(
      'snapshot_export_failed',
      `could not parse the snapshot row: ${JSON.stringify(rows[0])}`,
    )
  }
  const [snapshotId, snapshotIso, txEpoch, backendPid, serverVersion, systemIdentifier] = parts
  if (!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-\d+$/.test(snapshotId)) {
    throw new BackupError(
      'snapshot_export_failed',
      `pg_export_snapshot() returned an unrecognised identifier: ${JSON.stringify(snapshotId)}`,
    )
  }
  return { snapshotId, snapshotIso, txEpoch, backendPid, serverVersion, systemIdentifier }
}

/**
 * Prove the snapshot-owning transaction survived the dump.
 *
 * In REPEATABLE READ `now()` is the transaction's start time and does not
 * advance. Same backend pid + identical `now()` ⇒ same backend, same
 * transaction, therefore the same snapshot `pg_dump` read. A different pid or a
 * moved `now()` means the session was restarted underneath us and the counts
 * would describe a different database state than the dump.
 */
export async function assertSnapshotStillHeld(session, opened) {
  const rows = await ask(
    session,
    "SELECT pg_backend_pid()::text || '|' || extract(epoch from now())::text;",
    'confirming the snapshot transaction was still open after pg_dump',
  )
  const actual = rows[0] ?? ''
  const expected = `${opened.backendPid}|${opened.txEpoch}`
  if (actual !== expected) {
    throw new BackupError(
      'snapshot_transaction_lost',
      `the snapshot-owning transaction did not survive pg_dump (expected backend|now ${expected}, ` +
        `got ${JSON.stringify(actual)}). The dump and the counts would not describe the same ` +
        `database state, so this backup does not qualify.`,
    )
  }
}

/** Counts, extensions and migration state — all inside the dump's snapshot. */
export async function readSnapshotFacts(session, config) {
  const tables = [...config.manifest.criticalTables]
  const migrationsTable = `${config.manifest.migrations.schema}.${config.manifest.migrations.table}`
  const probeTargets = [...tables, migrationsTable]

  const presence = await ask(
    session,
    buildTableExistenceQuery(probeTargets),
    'probing that every required relation exists',
  )
  const present = new Map(
    presence.map((l) => [l.slice(0, l.lastIndexOf('|')), l.slice(l.lastIndexOf('|') + 1)]),
  )
  const missing = probeTargets.filter((t) => present.get(t) !== 'true')
  if (missing.length > 0) {
    throw new BackupError(
      'required_relation_missing',
      `these relations are required by the manifest but do not exist (or are not visible to the ` +
        `backup role) in the source database: ${missing.join(', ')}. A backup whose critical counts ` +
        `cannot be taken does not qualify.`,
    )
  }

  const countRows = await ask(session, buildCountsQuery(tables), 'counting the critical tables')
  const counts = {}
  for (const row of countRows) {
    const i = row.lastIndexOf('|')
    counts[row.slice(0, i)] = Number(row.slice(i + 1))
  }
  for (const t of tables) {
    if (!Number.isSafeInteger(counts[t])) {
      throw new BackupError(
        'required_count_missing',
        `no usable count came back for required table ${t} (got ${JSON.stringify(counts[t])}).`,
      )
    }
  }

  const extRows = await ask(
    session,
    "SELECT extname || ' ' || extversion FROM pg_extension ORDER BY extname;",
    'reading the installed extension set',
  )

  const { schema, table, idColumn } = config.manifest.migrations
  const migRows = await ask(
    session,
    `SELECT coalesce(max("${idColumn}")::text, '') FROM "${schema}"."${table}";`,
    'reading the migration journal high-water mark',
  )
  const migrationsMaxId = migRows[0] ?? ''

  return {
    counts,
    extensions: extRows,
    migrationsMaxId: migrationsMaxId === '' ? null : migrationsMaxId,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The run.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Produce one artifact.
 *
 * @param {object} args
 * @param {ReturnType<import('./backup-config.mjs').validateConfig>} args.config
 * @param {object} args.deps    injected process/fs/clock boundaries (see the module docblock)
 * @param {(line: string) => void} [args.log]
 * @param {{dryRun?: boolean, fullArchiveRead?: boolean, keepStaging?: boolean}} [args.options]
 * @returns {Promise<object>} the run report (and, on a real run, the manifest)
 */
export async function produceBackupArtifact({ config, deps, log = () => {}, options = {} }) {
  const dryRun = options.dryRun === true
  const fullArchiveRead = options.fullArchiveRead ?? config.run.fullArchiveReadDefault
  const startedAt = deps.now()
  const runId = `${new Date(startedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}-${deps.randomToken(4)}`
  const warnings = []
  const wouldWrite = []

  log(`run ${runId} starting${dryRun ? ' (DRY RUN — no dump, no encryption, no publish)' : ''}`)

  const lock = acquireRunLock({ config, deps, runId, log })
  warnings.push(...lock.warnings)

  const stagingDir = `${config.staging.root}/${runId}`
  let stagingCreated = false
  let session = null
  let sessionOpen = false
  let sessionEnded = false
  let aborted = false
  const publishedPaths = []

  const removeStaging = () => {
    if (!stagingCreated || options.keepStaging) {
      if (stagingCreated && options.keepStaging) log(`kept staging directory ${stagingDir}`)
      return
    }
    try {
      deps.fs.rmSync(stagingDir, { recursive: true, force: true })
      log(`removed staging directory ${stagingDir}`)
    } catch (err) {
      log(`WARN: could not remove staging directory ${stagingDir}: ${err?.message ?? String(err)}`)
    }
  }

  // ── active-operation registry ──────────────────────────────────────────────
  //
  // Every boundary that spawns a child registers a handle here for as long as
  // that child is alive. Without this, an aborted run deleted its staging
  // directory and released its lock while `pg_dump` was still writing into it
  // and a second producer was free to start.
  //
  // A handle is `{label, kind, cancel(deadlineMs), killNow()}`. `kind` matters:
  // stopping a `docker exec` client does NOT establish that the container-side
  // command ended, and the reporting below never pretends otherwise.
  const activeOperations = new Set()
  const track = (handle) => {
    activeOperations.add(handle)
    return () => activeOperations.delete(handle)
  }

  // Operations whose termination could NOT be established. Non-empty at
  // teardown means the run lock is retained rather than released.
  const unconfirmed = []
  const noteUnconfirmed = (entry) => {
    if (!unconfirmed.some((u) => u.label === entry.label && u.outcome === entry.outcome)) {
      unconfirmed.push(entry)
    }
  }

  /**
   * Stop everything still running, bounded by `run.cancelGraceMs`, and then
   * establish — or fail to establish — that it actually stopped.
   *
   * A cancelled handle is NOT dropped from the registry on the strength of the
   * cancel call returning. For a local child, a closed process is proof. For a
   * `docker exec` child it is not: stopping the client says nothing about the
   * command inside the container, so the producer asks the container directly,
   * read-only, whether its own command is still listed. Anything it cannot
   * answer becomes an `unconfirmed` entry.
   */
  const cancelActiveOperations = async (reason) => {
    const handles = [...activeOperations]
    if (handles.length === 0) return []
    log(`cancelling ${handles.length} active operation(s): ${reason}`)
    const outcomes = await Promise.all(
      handles.map((h) =>
        Promise.resolve()
          .then(() => h.cancel(config.run.cancelGraceMs))
          .then((r) => ({ ...r, identityToken: h.identityToken }))
          .catch((err) => ({
            label: h.label,
            kind: h.kind,
            identityToken: h.identityToken,
            outcome: 'error',
            containerSideEnded: null,
            error: err?.message ?? String(err),
          })),
      ),
    )
    // A handle is dropped from the registry ONLY when its child is known to
    // have closed. Discarding a timed-out or errored handle would both lose the
    // exclusion signal and leak the child: a process spawned with piped stdio
    // keeps two Socket handles and a ChildProcess handle referenced, so it also
    // keeps this process (and, in tests, the whole test file) from ever exiting.
    for (const h of handles) {
      const o = outcomes.find((x) => x.label === h.label)
      if (o && (o.outcome === 'exited' || o.outcome === 'killed')) activeOperations.delete(h)
    }

    // A local child that closed is genuinely stopped. Anything else is not.
    const needContainerProof = []
    for (const o of outcomes) {
      if (o.kind === 'local') {
        if (o.outcome === 'exited' || o.outcome === 'killed') {
          log(`  ${o.label} (local): ${o.outcome} — process confirmed ended`)
        } else {
          log(`  ${o.label} (local): ${o.outcome} — NOT confirmed stopped`)
          noteUnconfirmed({ label: o.label, kind: o.kind, outcome: o.outcome })
        }
        continue
      }
      log(
        `  ${o.label} (docker-exec): ` +
          (o.locallyTerminated
            ? `the client was terminated by this run (byte ceiling or output/input failure), then ${o.outcome}`
            : `docker client ${o.outcome}`) +
          ` — this says nothing about the container-side command`,
      )
      needContainerProof.push(o)
    }
    if (needContainerProof.length > 0) {
      await establishContainerSideEnded(needContainerProof)
    }
    return outcomes
  }

  /**
   * Ask the container, read-only, whether the commands this run started are
   * still listed. Never signals anything, and only ever matches a token taken
   * from the producer's own argv.
   *
   * Three outcomes per operation:
   *   - the probe answered and the token is absent   → confirmed ended
   *   - the probe answered and the token is present  → still running, unconfirmed
   *   - the probe could not answer (missing, failed, timed out, or the operation
   *     carries no usable token)                      → unconfirmed
   *
   * Uncertainty always lands on `unconfirmed`, which retains the lock.
   */
  const establishContainerSideEnded = async (operations) => {
    let inventory = null
    if (typeof deps.listContainerCommands === 'function') {
      try {
        inventory = await deps.listContainerCommands({
          container: config.source.container,
          timeoutMs: config.run.containerProbeTimeoutMs,
        })
      } catch (err) {
        log(`WARN: container command probe failed: ${err?.message ?? String(err)}`)
        inventory = null
      }
    }
    if (!Array.isArray(inventory)) {
      log(
        `container command probe could not answer within run.containerProbeTimeoutMs ` +
          `(${config.run.containerProbeTimeoutMs}ms); termination of the container-side commands is NOT established`,
      )
      for (const o of operations) {
        noteUnconfirmed({
          label: o.label,
          kind: o.kind,
          outcome: `${o.outcome}, probe unavailable`,
        })
      }
      return
    }
    for (const o of operations) {
      if (typeof o.identityToken !== 'string' || o.identityToken === '') {
        noteUnconfirmed({
          label: o.label,
          kind: o.kind,
          outcome: `${o.outcome}, no identity token`,
        })
        continue
      }
      const matches = inventory.filter((line) => line.includes(o.identityToken))
      if (matches.length === 0) {
        log(`  ${o.label}: container-side command confirmed gone (no "${o.identityToken}" in ps)`)
        continue
      }
      log(
        `  ${o.label}: STILL RUNNING inside ${config.source.container} — ` +
          `${matches.length} line(s) match "${o.identityToken}"`,
      )
      noteUnconfirmed({
        label: o.label,
        kind: o.kind,
        outcome: `${o.outcome}, container-side command still listed`,
        identityToken: o.identityToken,
      })
    }
  }

  /**
   * Run one boundary operation under a wall-clock deadline.
   *
   * On expiry the operation's children are cancelled immediately rather than
   * left running: the run lock is not reclaimable, so a hung boundary would
   * otherwise block every future backup.
   */
  const withDeadline = async (label, fn) => {
    const ms = config.run.operationTimeoutMs
    let expired = false
    let timer = null
    const timeoutError = () =>
      new BackupError(
        'operation_timeout',
        `${label} did not finish within run.operationTimeoutMs (${ms}ms) and was cancelled.`,
      )
    const expiry = new Promise((_, rejectExpiry) => {
      timer = setTimeout(() => {
        expired = true
        rejectExpiry(timeoutError())
      }, ms)
      timer.unref?.()
    })
    try {
      return await Promise.race([Promise.resolve().then(fn), expiry])
    } catch (err) {
      // Once the deadline has fired, the run reports the TIMEOUT — never
      // whatever symptom the cancellation produced. Cancelling a child makes
      // its operation reject too, and which rejection wins the race is a
      // scheduling detail; without this the same hung dump reported
      // `operation_timeout` or `dump_failed` depending on timing.
      if (expired) {
        await cancelActiveOperations(`${label} timed out`)
        throw err?.code === 'operation_timeout' ? err : timeoutError()
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  // ── teardown handles handed to the caller ──────────────────────────────────
  //
  // Two of them, because a signal and a SIGKILL need different things:
  //
  //   abort()     asynchronous and bounded — stops the children, kills the
  //               session, and lets the run's own `finally` do the cleanup in
  //               the right order (lock LAST). This is what a SIGINT uses.
  //   emergency() synchronous last resort for `process.on('exit')`, where no
  //               async work can run. It SIGKILLs what it can and clears the
  //               staging directory and lock. It cannot wait, so it cannot
  //               establish that anything actually stopped.
  let emergencyDone = false
  const emergency = () => {
    if (emergencyDone) return
    emergencyDone = true
    // Synchronous only. SIGKILL is issued, nothing can be awaited, and no probe
    // can run — so nothing here may claim a container-side command ended.
    const forced = []
    for (const h of activeOperations) {
      try {
        h.killNow?.()
      } catch {
        /* already gone */
      }
      forced.push({
        label: h.label,
        kind: h.kind,
        identityToken: h.identityToken ?? null,
        outcome: 'SIGKILL issued by the forced synchronous teardown; not awaited',
      })
    }
    const sessionForced = sessionKillNeeded()
    if (sessionForced) forced.push(sessionForced)
    try {
      session?.kill?.()
    } catch {
      /* already gone */
    }
    removeStaging()
    // ISSUING SIGKILL IS NOT CONFIRMATION OF TERMINATION. This path cannot
    // await a single `close` event and cannot run the container probe, so it
    // establishes nothing about ANY child — local or docker-exec. Exclusion is
    // therefore retained whenever work was in flight.
    //
    // A local child poses no data risk (it writes to a pipe this process owns,
    // never into staging), but "poses no risk" and "is confirmed stopped" are
    // different claims, and only the second one justifies giving up the lock.
    const uncertain = [...unconfirmed, ...forced]
    if (uncertain.length === 0) {
      lock.release()
      return
    }
    lock.retain({
      reason:
        'forced synchronous teardown (second signal or process exit): SIGKILL was issued but not ' +
        'awaited, and the container probe could not run, so no termination was established',
      unconfirmed: uncertain,
    })
  }

  /**
   * End the snapshot session within `run.cancelGraceMs`.
   *
   * An orderly close is confirmation — psql sees EOF, exits, and the docker
   * client reports its status. A SIGKILL is not, so it goes through the same
   * container-side probe as any other cancelled `docker exec` operation, and
   * anything the probe cannot answer retains the lock.
   */
  const endSnapshotSession = async (why) => {
    if (!session || sessionEnded) return
    sessionEnded = true
    let how = 'exited'
    try {
      how = (await session.close(config.run.cancelGraceMs)) ?? 'exited'
    } catch (err) {
      log(`WARN: snapshot session did not close cleanly (${why}): ${err?.message ?? String(err)}`)
      how = 'killed'
    }
    if (how !== 'killed') return
    try {
      session.kill()
    } catch {
      /* already gone */
    }
    await establishContainerSideEnded([
      {
        label: 'snapshot psql session',
        kind: 'docker-exec',
        outcome: 'killed after close timed out',
        identityToken: session.identityToken ?? null,
      },
    ])
  }

  /** The snapshot session is a `docker exec` child too; killing it proves nothing. */
  const sessionKillNeeded = () =>
    session && sessionOpen
      ? {
          label: 'snapshot psql session',
          kind: 'docker-exec',
          outcome: 'SIGKILL issued by the forced synchronous teardown; not awaited',
          identityToken: session.identityToken ?? null,
        }
      : null
  let abortPromise = null
  const abort = (reason = 'abort requested') => {
    if (abortPromise) return abortPromise
    aborted = true
    abortPromise = (async () => {
      await cancelActiveOperations(reason)
      // The session is ended the same bounded way the normal teardown uses, so
      // its container-side psql sees EOF and exits rather than being orphaned.
      // Only if that does not work is it killed — and then it is unconfirmed.
      if (session) await endSnapshotSession('abort')
    })()
    return abortPromise
  }
  deps.registerCleanup?.({ abort, emergency })

  try {
    // ── preflight ─────────────────────────────────────────────────────────────
    const encPreflight = preflightEncryption({ config, deps })
    log(
      `encryption boundary: ${encPreflight.executablePath} → ${encPreflight.recipientCount} recipient(s), ` +
        `recipients-file sha256 ${encPreflight.recipientFingerprint}`,
    )

    const stagingCapacity = checkCapacity({
      label: 'staging',
      dir: config.staging.root,
      minFreeBytes: config.staging.minFreeBytes,
      backingVolume: config.staging.backingVolume,
      deps,
    })
    const destCapacity = checkCapacity({
      label: 'destination',
      dir: config.destination.dir,
      minFreeBytes: config.destination.minFreeBytes,
      backingVolume: config.destination.backingVolume,
      deps,
    })
    const capacityProblems = [...stagingCapacity.problems, ...destCapacity.problems]
    if (capacityProblems.length > 0) {
      throw new BackupError(
        'insufficient_capacity',
        `capacity preflight failed:\n  ${capacityProblems.join('\n  ')}`,
      )
    }
    for (const m of [...stagingCapacity.measured, ...destCapacity.measured]) {
      log(`capacity ok — ${m.what} ${m.path}: ${m.freeBytes} free ≥ ${m.requiredBytes} required`)
    }

    deps.fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 })
    stagingCreated = true

    // ── the snapshot-owning transaction ───────────────────────────────────────
    session = await deps.startSnapshotSession({
      container: config.source.container,
      database: config.source.database,
      user: config.source.user,
      runId,
    })
    sessionOpen = true
    const opened = await openSnapshot(session)
    const stamp = formatSnapshotStamp(opened.snapshotIso)
    const names = buildArtifactNames(config.run.artifactPrefix, stamp)
    log(
      `snapshot ${opened.snapshotId} exported at ${opened.snapshotIso} ` +
        `(backend ${opened.backendPid}, server ${opened.serverVersion}, cluster ${opened.systemIdentifier})`,
    )

    // ── artifact identity: unique, and never silently overwritten ─────────────
    const destPaths = {
      ciphertext: `${config.destination.dir}/${names.ciphertext}`,
      checksum: `${config.destination.dir}/${names.checksum}`,
      manifest: `${config.destination.dir}/${names.manifest}`,
    }
    const collisions = Object.values(destPaths).filter((p) => deps.fs.existsSync(p))
    if (collisions.length > 0) {
      throw new BackupError(
        'artifact_identity_collision',
        `artifact identity ${names.base} already exists at the destination ` +
          `(${collisions.join(', ')}). Refusing to overwrite a retained artifact.`,
      )
    }
    wouldWrite.push(...Object.values(destPaths), `${config.destination.dir}/latest.json`)

    // ── facts from inside the snapshot ────────────────────────────────────────
    // In a dry run these are read and the transaction committed immediately; no
    // dump, no encryption, nothing published.
    if (dryRun) {
      const facts = await readSnapshotFacts(session, config)
      await session.query('COMMIT;')
      sessionOpen = false
      await session.close()
      session = null
      const report = {
        runId,
        dryRun: true,
        artifactBase: names.base,
        snapshotTs: opened.snapshotIso,
        snapshotId: opened.snapshotId,
        serverVersion: opened.serverVersion,
        systemIdentifier: opened.systemIdentifier,
        migrationsMaxId: facts.migrationsMaxId,
        extensions: facts.extensions,
        counts: facts.counts,
        countsSnapshot: true,
        encryption: {
          executable: encPreflight.executablePath,
          recipientFingerprint: encPreflight.recipientFingerprint,
        },
        capacity: [...stagingCapacity.measured, ...destCapacity.measured],
        wouldWrite,
        warnings,
      }
      log(`DRY RUN complete — would write:\n  ${wouldWrite.join('\n  ')}`)
      return report
    }

    // ── the dump, on a second connection, reading the shared snapshot ─────────
    const plaintextPart = `${stagingDir}/${names.plaintext}.part`
    const plaintextPath = `${stagingDir}/${names.plaintext}`
    log(
      `dumping via docker exec ${config.source.container} pg_dump --snapshot=${opened.snapshotId}`,
    )
    let dumped
    try {
      dumped = await withDeadline('pg_dump', () =>
        deps.runDump({
          container: config.source.container,
          database: config.source.database,
          user: config.source.user,
          snapshotId: opened.snapshotId,
          outPath: plaintextPart,
          maxBytes: config.staging.maxPlaintextBytes,
          track,
          // Slightly inside the operation deadline, so a wedged output is
          // reported as the specific thing it is rather than as a generic
          // timeout — and so the boundary's promise actually settles instead of
          // dangling past the run.
          stallTimeoutMs: Math.max(1_000, Math.floor(config.run.operationTimeoutMs * 0.8)),
        }),
      )
    } catch (err) {
      if (err instanceof BackupError) throw err
      throw new BackupError('dump_failed', `pg_dump failed: ${err?.message ?? String(err)}`, err)
    }
    if (dumped.truncated) {
      throw new BackupError(
        'staging_budget_exceeded',
        `pg_dump exceeded staging.maxPlaintextBytes (${config.staging.maxPlaintextBytes}) and was ` +
          `stopped. Raise the bound deliberately after checking real free space — the historical ` +
          `~27 MB dump size is an observation, not a guarantee.`,
      )
    }
    log(`dump complete: ${dumped.bytes} bytes`)

    // ── the proof that the counts describe THIS dump ─────────────────────────
    await assertSnapshotStillHeld(session, opened)
    const facts = await readSnapshotFacts(session, config)
    await session.query('COMMIT;')
    sessionOpen = false
    await session.close()
    session = null
    log(
      `snapshot facts read inside the dump's transaction — ` +
        `${Object.keys(facts.counts).length} critical tables, migration id ${facts.migrationsMaxId}`,
    )

    // Same-filesystem rename on ext4 is atomic; this is what makes the staged
    // plaintext either whole or absent before anything reads it.
    deps.fs.renameSync(plaintextPart, plaintextPath)

    // ── validation A: the plaintext archive is readable, no key involved ──────
    const listResult = await withDeadline('pg_restore --list', () =>
      deps.validateArchive({
        container: config.source.container,
        archivePath: plaintextPath,
        mode: 'list',
        track,
      }),
    )
    if (listResult.code !== 0) {
      throw new BackupError(
        'archive_validation_failed',
        `pg_restore --list rejected the archive (exit ${listResult.code}): ${String(listResult.stderr).trim()}`,
      )
    }
    let fullReadResult = null
    if (fullArchiveRead) {
      fullReadResult = await withDeadline('pg_restore full archive read', () =>
        deps.validateArchive({
          container: config.source.container,
          archivePath: plaintextPath,
          mode: 'full',
          track,
        }),
      )
      if (fullReadResult.code !== 0) {
        throw new BackupError(
          'archive_validation_failed',
          `full pg_restore archive read failed (exit ${fullReadResult.code}): ${String(fullReadResult.stderr).trim()}`,
        )
      }
    }
    log(`validation A passed (list${fullArchiveRead ? ' + full archive read' : ''})`)

    const plaintextBytes = deps.fs.statSync(plaintextPath).size
    if (plaintextBytes > config.staging.maxPlaintextBytes) {
      throw new BackupError(
        'staging_budget_exceeded',
        `plaintext dump is ${plaintextBytes} bytes, over staging.maxPlaintextBytes ` +
          `(${config.staging.maxPlaintextBytes}).`,
      )
    }
    const plaintextSha = deps.sha256File(plaintextPath)

    // Encryption roughly doubles peak staging usage. Re-check both layers with
    // the now-known artifact size before committing to it.
    const encCapacity = checkCapacity({
      label: 'staging (pre-encryption)',
      dir: config.staging.root,
      minFreeBytes: config.staging.minFreeBytes,
      backingVolume: config.staging.backingVolume,
      needBytes: plaintextBytes,
      deps,
    })
    if (!encCapacity.ok) {
      throw new BackupError(
        'insufficient_capacity',
        `not enough room to write the ciphertext beside the plaintext:\n  ${encCapacity.problems.join('\n  ')}`,
      )
    }

    // ── encryption, through an explicit executable boundary ──────────────────
    const ciphertextPath = `${stagingDir}/${names.ciphertext}`
    const argv = buildEncryptionArgv(config.encryption, {
      executablePath: encPreflight.executablePath,
      inPath: plaintextPath,
    })
    // The permitted ciphertext budget: what `staging.maxStagingBytes` still
    // allows once the plaintext is on disk. It is handed to the boundary and
    // enforced WHILE the tool writes, because a post-write size check is a
    // report of how much disk was already consumed, not a bound on it.
    const ciphertextBudget = config.staging.maxStagingBytes - plaintextBytes
    if (ciphertextBudget <= 0) {
      throw new BackupError(
        'staging_budget_exceeded',
        `the plaintext dump (${plaintextBytes} bytes) already fills staging.maxStagingBytes ` +
          `(${config.staging.maxStagingBytes}); there is no budget left for a ciphertext.`,
      )
    }
    log(`encrypting: ${argv.join(' ')} > ${ciphertextPath}`)
    log(`ciphertext ceiling: ${ciphertextBudget} bytes, enforced on the stream`)
    const encResult = await withDeadline('encryption', () =>
      deps.runEncryption({
        argv,
        outPath: ciphertextPath,
        maxOutputBytes: ciphertextBudget,
        track,
        stallTimeoutMs: Math.max(1_000, Math.floor(config.run.operationTimeoutMs * 0.8)),
      }),
    )
    if (encResult.exceeded) {
      throw new BackupError(
        'staging_budget_exceeded',
        `the encryption executable tried to emit more than the permitted ciphertext budget ` +
          `(${ciphertextBudget} bytes). The stream was cut at the ceiling — the staged file never ` +
          `exceeded it — and the partial output was removed. Raise staging.maxStagingBytes ` +
          `deliberately, together with the free-space floors.`,
      )
    }
    if (encResult.code !== 0) {
      throw new BackupError(
        'encryption_failed',
        `the encryption executable exited ${encResult.code}: ${String(encResult.stderr).trim()}`,
      )
    }
    if (!deps.fs.existsSync(ciphertextPath)) {
      throw new BackupError(
        'encryption_produced_no_output',
        `the encryption executable exited 0 but wrote no file at ${ciphertextPath}.`,
      )
    }
    const ciphertextBytes = deps.fs.statSync(ciphertextPath).size
    if (ciphertextBytes === 0) {
      throw new BackupError('encryption_produced_no_output', `${ciphertextPath} is empty.`)
    }
    // Defence in depth. The stream ceiling above makes this unreachable by
    // construction — the producer owns the descriptor and drops the crossing
    // chunk — so reaching it means an invariant broke, not that a tool
    // misbehaved.
    if (plaintextBytes + ciphertextBytes > config.staging.maxStagingBytes) {
      throw new BackupError(
        'staging_budget_exceeded',
        `staging holds ${plaintextBytes + ciphertextBytes} bytes, over staging.maxStagingBytes ` +
          `(${config.staging.maxStagingBytes}), despite the stream ceiling. This should be ` +
          `unreachable; treat it as a defect in the bounded writer.`,
      )
    }
    const header = String(deps.readFileHead(ciphertextPath, HEADER_PROBE_BYTES))
    if (!header.startsWith(config.encryption.expectedHeader)) {
      throw new BackupError(
        'ciphertext_header_unexpected',
        `the output does not begin with the configured encryption.expectedHeader ` +
          `(${JSON.stringify(config.encryption.expectedHeader)}). Refusing to publish an artifact ` +
          `that may not be encrypted.`,
      )
    }
    const ciphertextSha = deps.sha256File(ciphertextPath)
    if (ciphertextSha === plaintextSha) {
      throw new BackupError(
        'ciphertext_equals_plaintext',
        `the encryption step produced bytes identical to the plaintext dump. Refusing to publish.`,
      )
    }
    log(`ciphertext ${ciphertextBytes} bytes, sha256 ${ciphertextSha}`)

    // ── manifest ─────────────────────────────────────────────────────────────
    const gitCommit = deps.gitCommit()
    if (!gitCommit) warnings.push('source git commit could not be read; recorded as null')
    const imageDigests = {}
    for (const [label, ref] of Object.entries(config.manifest.imageRefs ?? {})) {
      const digest = deps.imageDigest(ref)
      if (!digest)
        warnings.push(`image digest for ${label} (${ref}) could not be read; recorded as null`)
      imageDigests[label] = digest ?? null
    }

    const manifest = {
      schema_version: MANIFEST_SCHEMA_VERSION,
      artifact: names.ciphertext,
      run_id: runId,
      snapshot_ts: opened.snapshotIso,
      produced_at: new Date(deps.now()).toISOString(),
      source: {
        host: deps.hostname(),
        container: config.source.container,
        database: config.source.database,
        system_identifier: opened.systemIdentifier,
        server_version: opened.serverVersion,
        git_commit: gitCommit,
        image_digests: imageDigests,
      },
      plaintext: { sha256: plaintextSha, bytes: plaintextBytes },
      ciphertext: { sha256: ciphertextSha, bytes: ciphertextBytes },
      encryption: {
        executable: encPreflight.executablePath,
        recipients_file: config.encryption.recipientFile,
        recipients_file_sha256: encPreflight.recipientFingerprint,
        recipient_count: encPreflight.recipientCount,
      },
      validation: {
        pg_restore_list: 'pass',
        pg_restore_full_archive_read: fullArchiveRead ? 'pass' : 'not_run',
      },
      // Always true in a published artifact. The producer fails rather than
      // publishing counts that did not come from the dump's own snapshot.
      counts_snapshot: true,
      counts: facts.counts,
      migrations_max_id: facts.migrationsMaxId,
      extensions: facts.extensions,
      warnings,
    }

    const stagedManifest = `${stagingDir}/${names.manifest}`
    const stagedChecksum = `${stagingDir}/${names.checksum}`
    deps.fs.writeFileSync(stagedManifest, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    deps.fs.writeFileSync(stagedChecksum, formatChecksumSidecar(ciphertextSha, names.ciphertext), {
      mode: 0o600,
    })

    // ── publish ──────────────────────────────────────────────────────────────
    //
    // Ciphertext first, then the hash sidecar, manifest LAST. Rename atomicity
    // is NOT assumed at the destination (it may be drvfs over NTFS); what makes
    // a partial copy harmless is verifyArtifactCompletion's hash check, not the
    // ordering. The ordering only shortens the window in which a naive consumer
    // could see a manifest without its artifact.
    deps.fs.mkdirSync(config.destination.dir, { recursive: true })
    const publish = (from, to) => {
      const tmp = `${to}.part`
      deps.fs.copyFileSync(from, tmp)
      deps.fs.renameSync(tmp, to)
      publishedPaths.push(to)
    }
    publish(ciphertextPath, destPaths.ciphertext)
    publish(stagedChecksum, destPaths.checksum)
    publish(stagedManifest, destPaths.manifest)

    const completion = verifyArtifactCompletion({
      dir: config.destination.dir,
      base: names.base,
      deps,
    })
    if (!completion.complete) {
      for (const p of publishedPaths) {
        try {
          deps.fs.rmSync(p, { force: true })
        } catch {
          /* best effort; the artifact is already reported incomplete */
        }
      }
      throw new BackupError(
        'artifact_incomplete',
        `the published artifact did not verify as complete and was withdrawn:\n  ${completion.failures.join('\n  ')}`,
      )
    }
    log(`artifact ${names.base} published and verified complete`)

    // `latest.json` is a pointer, not a source of truth: it carries the hash so
    // a reader can check the artifact it names rather than trusting the name.
    const latestTmp = `${config.destination.dir}/latest.json.part`
    deps.fs.writeFileSync(
      latestTmp,
      JSON.stringify(
        {
          schema_version: MANIFEST_SCHEMA_VERSION,
          artifact: names.ciphertext,
          base: names.base,
          run_id: runId,
          snapshot_ts: opened.snapshotIso,
          ciphertext_sha256: ciphertextSha,
          produced_at: manifest.produced_at,
        },
        null,
        2,
      ) + '\n',
    )
    deps.fs.renameSync(latestTmp, `${config.destination.dir}/latest.json`)

    return {
      runId,
      dryRun: false,
      artifactBase: names.base,
      artifactPath: destPaths.ciphertext,
      snapshotTs: opened.snapshotIso,
      snapshotId: opened.snapshotId,
      plaintextBytes,
      ciphertextBytes,
      ciphertextSha256: ciphertextSha,
      countsSnapshot: true,
      counts: facts.counts,
      manifest,
      warnings,
      durationMs: deps.now() - startedAt,
    }
  } catch (err) {
    // A run that was asked to stop reports that, rather than reporting whatever
    // symptom the cancellation happened to produce first (usually a killed
    // pg_dump). The caller needs this to choose a signal exit status.
    if (aborted && !(err instanceof BackupError && err.code === 'run_aborted')) {
      throw new BackupError(
        'run_aborted',
        `the run was aborted before completing: ${err?.message ?? String(err)}`,
        err,
      )
    }
    throw err
  } finally {
    // TEARDOWN ORDER IS LOAD-BEARING. Exclusion is held until the work has
    // actually stopped:
    //   1. cancel every still-running child (bounded by run.cancelGraceMs)
    //   2. end the snapshot transaction and close its session (bounded)
    //   3. overwrite and delete the staging directory
    //   4. release the run lock — LAST
    // Releasing the lock before (1) would let the next producer start while
    // this one's pg_dump was still writing into a directory about to be
    // deleted.
    //
    // An abort already in flight must finish FIRST. Cancelling a child makes
    // its operation reject immediately, so the main promise reaches this
    // `finally` while the abort is still establishing whether the
    // container-side command ended — and deciding release-vs-retain on a
    // half-finished probe is exactly the silent availability-over-exclusion
    // trade this is meant to prevent.
    if (abortPromise) {
      try {
        await abortPromise
      } catch (err) {
        log(`WARN: abort did not complete cleanly: ${err?.message ?? String(err)}`)
      }
    }
    await cancelActiveOperations('run ending')

    if (session) {
      try {
        if (sessionOpen) await session.query('ROLLBACK;')
      } catch {
        /* the session is already gone; endSnapshotSession still runs */
      }
      await endSnapshotSession('run ending')
    }
    if (stagingCreated && config.staging.shredPlaintext && !options.keepStaging) {
      // Best effort only. See docs/operations/backup-producer.md: on a
      // journalling filesystem over flash this reduces exposure, it does not
      // erase. The real mitigation is that the plaintext exists for seconds.
      try {
        for (const name of deps.fs.readdirSync(stagingDir)) {
          if (!name.endsWith('.dump') && !name.endsWith('.dump.part')) continue
          const p = `${stagingDir}/${name}`
          try {
            deps.overwriteFile(p, deps.fs.statSync(p).size)
          } catch (err) {
            log(`WARN: could not overwrite plaintext ${p}: ${err?.message ?? String(err)}`)
          }
        }
      } catch {
        /* staging dir already gone */
      }
    }
    removeStaging()

    // LAST, and CONDITIONAL. Exclusion is given up only when every operation
    // this run started is confirmed stopped. If anything is unconfirmed the
    // lock is kept and annotated, so the next producer refuses with an
    // explanation instead of racing work that may still be running.
    if (unconfirmed.length === 0) {
      lock.release()
    } else {
      lock.retain({
        reason: `could not confirm that ${unconfirmed.length} operation(s) this run started had stopped`,
        unconfirmed,
      })
      log(
        `EXCLUSION RETAINED — the run lock ${config.run.lockFile} was deliberately kept. ` +
          `Unconfirmed: ${unconfirmed.map((u) => `${u.label} [${u.kind}] ${u.outcome}`).join('; ')}. ` +
          `The next producer will refuse until an operator clears it.`,
      )
    }
    // Disarm the late exit handler ONLY if there is genuinely nothing left. An
    // operation that could not be stopped stays in the registry so a
    // `process.on('exit')` teardown can still SIGKILL it — leaving it behind
    // both loses the exclusion signal and leaks a child whose piped stdio would
    // keep this process alive.
    if (activeOperations.size === 0 && unconfirmed.length === 0) emergencyDone = true
  }
}
