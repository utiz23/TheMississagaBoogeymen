/**
 * Destination-owned acceptance and receipts (Phase 1B, first slice).
 *
 * WHAT THIS COMPONENT IS
 * ----------------------
 * One sweep of a transport-writable **inbox**. For each artifact triple it
 * finds there it decides, entirely on its own, whether that artifact is real —
 * and if it is, it copies the bytes somewhere the transport cannot reach and
 * writes a receipt saying so.
 *
 *     inbox/      written by the transport key; NOTHING here is trusted
 *     work/<id>/  destination-owned, private, one sweep's lifetime
 *     archive/YYYY/  accepted artifacts; no transport key can write here
 *     receipts/   what the destination attests to; the producer reads it read-only
 *     quarantine/ evidence of a refusal, kept, never deleted by this component
 *
 * It transfers nothing, prunes nothing, evaluates no freshness metric and
 * restores nothing. Those are the rest of Phase 1B.
 *
 * THE PROPERTY THAT MAKES A RECEIPT WORTH ANYTHING
 * ------------------------------------------------
 * The inbox is writable by the same party that produced the artifact, and it
 * stays writable while this sweep is running. So the sweep never decides
 * anything about the bytes in the inbox. It:
 *
 *   1. checks names, file types and sizes, structurally, on the inbox;
 *   2. COPIES the triple into a directory only the destination can write;
 *   3. re-derives sha256 from the COPY and checks it against both the copy's
 *      sidecar and the copy's manifest;
 *   4. publishes the COPY, and verifies the published artifact again;
 *   5. writes a receipt bound to the hash it computed itself.
 *
 * A mutation of the inbox after step 2 can no longer change what is accepted,
 * and a mutation before step 2 fails step 3. `verifyArtifactCompletion` from
 * the producer is deliberately reused verbatim, so "complete" means the same
 * thing at both ends of the pipe (docs/operations/backup-producer.md §2.5).
 *
 * WHAT COUNTS AS DONE, AND WHAT A CRASH LEAVES BEHIND
 * ---------------------------------------------------
 * Acceptance of one artifact is complete **iff** the archive triple verifies
 * complete AND a binding-valid receipt exists for it. Neither a rename nor a
 * file's presence is ever taken as evidence: the destination filesystems in
 * play offer no assertable rename atomicity, so every publish is followed by a
 * fresh verification of what actually landed, and a publish that does not
 * verify is withdrawn.
 *
 * That definition makes every crash point recoverable by simply sweeping again:
 *
 *   | crash after…                | next sweep sees                        | it does                        |
 *   | --------------------------- | -------------------------------------- | ------------------------------ |
 *   | copying to work             | inbox triple intact, no archive entry  | redoes the whole artifact      |
 *   | a partial archive publish   | archive triple INCOMPLETE, no receipt  | republishes over it (resume)   |
 *   | a complete archive publish  | archive complete, receipt missing      | writes the missing receipt     |
 *   | writing the receipt         | archive complete, receipt valid        | removes the inbox copy         |
 *
 * The resume rule has exactly one form, and it is the only circumstance in
 * which anything under `archive/` is ever overwritten: **an archived triple may
 * be republished only while it does NOT verify complete and no binding-valid
 * receipt names it.** An artifact that was ever accepted is immutable here.
 *
 * BOUNDARIES
 * ----------
 * Every filesystem, clock and identity interaction is injected via `deps`, the
 * same bundle `makeRealDeps` builds for the producer. Nothing in this file
 * spawns a process, opens a socket, or holds a key.
 */

import { RECEIPT_SCHEMA_VERSION, isInside } from './backup-acceptance-config.mjs'
import {
  ARTIFACT_SUFFIXES,
  MANIFEST_SCHEMA_VERSION,
  SNAPSHOT_STAMP_PATTERN,
  formatSnapshotStamp,
  verifyArtifactCompletion,
} from './backup-artifact-contract.mjs'
import { checkCapacity } from './backup-producer.mjs'

/** Error raised by every sweep-level rejection. Carries a machine-readable `code`. */
export class AcceptanceError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'AcceptanceError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Names. Everything that becomes a path component goes through here first.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refuse anything that is not a single, ordinary path component.
 *
 * `readdir` cannot hand back a name containing `/`, but a *manifest* can: the
 * `artifact` field and the year derived from `snapshot_ts` both come from a
 * file the transport wrote, and both are used to build paths. This is the check
 * that keeps `../../.ssh/authorized_keys` out of them.
 */
export function assertSafeComponent(name, what) {
  if (typeof name !== 'string' || name === '') {
    throw new AcceptanceError('unsafe_name', `${what} must be a non-empty string.`)
  }
  if (name === '.' || name === '..') {
    throw new AcceptanceError('unsafe_name', `${what} may not be ${JSON.stringify(name)}.`)
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new AcceptanceError(
      'unsafe_name',
      `${what} may not contain a path separator (got ${JSON.stringify(name)}).`,
    )
  }
  if (name.includes('\0')) {
    throw new AcceptanceError('unsafe_name', `${what} may not contain a NUL byte.`)
  }
  if (name.startsWith('.')) {
    throw new AcceptanceError(
      'unsafe_name',
      `${what} may not start with a dot (got ${JSON.stringify(name)}).`,
    )
  }
  return name
}

/**
 * Classify one inbox entry name.
 *
 * Returns `{ base, stamp, role }` for a name that is exactly one of this
 * prefix's three artifact files, and `null` for everything else. Anything that
 * returns `null` is reported and then left completely alone — an unrecognised
 * name may well be an rsync temporary for a transfer still in flight, and
 * tidying the inbox is not this component's job.
 */
export function parseArtifactEntryName(name, prefix) {
  if (typeof name !== 'string') return null
  // Longest suffix first: `.dump.age.sha256` must not be read as `.dump.age`
  // followed by stray text.
  const suffixes = ['.dump.age.sha256', '.dump.age', '.manifest.json'].map(escapeRegExp).join('|')
  const re = new RegExp(`^(${escapeRegExp(prefix)}-(\\d{8}T\\d{6}Z))(${suffixes})$`)
  const m = re.exec(name)
  if (!m) return null
  const role = Object.entries(ARTIFACT_SUFFIXES).find(([, suffix]) => suffix === m[3])?.[0]
  if (!role) return null
  if (!SNAPSHOT_STAMP_PATTERN.test(m[2])) return null
  return { base: m[1], stamp: m[2], role }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The three file names an artifact base owns. */
export function artifactFileNames(base) {
  return Object.freeze({
    ciphertext: `${base}${ARTIFACT_SUFFIXES.ciphertext}`,
    checksum: `${base}${ARTIFACT_SUFFIXES.checksum}`,
    manifest: `${base}${ARTIFACT_SUFFIXES.manifest}`,
  })
}

/** `<base>.receipt.json`. */
export function receiptFileName(base) {
  return `${base}.receipt.json`
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifest identity — the fields acceptance and receipts are bound to.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check that a manifest describes the artifact it arrived as.
 *
 * `verifyArtifactCompletion` already proves the three files hash together. This
 * proves the resulting object is the artifact its FILENAME claims, and that
 * every field a receipt will be bound to is present and well-formed. It is run
 * only against a manifest that has already passed completion on a copy the
 * destination owns, so a failure here can never be "the transfer is not
 * finished": the bytes are exactly what the producer wrote.
 *
 * Returns `{ ok, failures, snapshotTs, year, runId, sourceHost }`.
 */
export function validateManifestIdentity({ manifest, base, stamp }) {
  const failures = []
  const names = artifactFileNames(base)

  if (manifest?.schema_version !== MANIFEST_SCHEMA_VERSION) {
    failures.push(
      `manifest schema_version ${JSON.stringify(manifest?.schema_version)} is not the expected ` +
        `${MANIFEST_SCHEMA_VERSION}`,
    )
  }
  try {
    assertSafeComponent(manifest?.artifact, 'manifest.artifact')
  } catch (err) {
    failures.push(err.message)
  }
  if (manifest?.artifact !== names.ciphertext) {
    failures.push(
      `manifest.artifact ${JSON.stringify(manifest?.artifact)} does not name ${names.ciphertext}`,
    )
  }

  let snapshotTs = null
  let year = null
  if (typeof manifest?.snapshot_ts !== 'string') {
    failures.push(`manifest.snapshot_ts is ${JSON.stringify(manifest?.snapshot_ts)}, not a string`)
  } else {
    let derived = null
    try {
      derived = formatSnapshotStamp(manifest.snapshot_ts)
    } catch (err) {
      failures.push(err.message)
    }
    if (derived !== null && derived !== stamp) {
      failures.push(
        `manifest.snapshot_ts ${JSON.stringify(manifest.snapshot_ts)} compacts to ${derived}, but ` +
          `the artifact is named ${stamp}`,
      )
    }
    if (derived !== null && derived === stamp) {
      snapshotTs = manifest.snapshot_ts
      year = derived.slice(0, 4)
      try {
        assertSafeComponent(year, 'archive year')
      } catch (err) {
        failures.push(err.message)
        year = null
      }
    }
  }

  if (
    typeof manifest?.ciphertext?.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(manifest.ciphertext.sha256)
  ) {
    failures.push(
      `manifest.ciphertext.sha256 ${JSON.stringify(manifest?.ciphertext?.sha256)} is not a sha256 hex digest`,
    )
  }
  if (!Number.isSafeInteger(manifest?.ciphertext?.bytes) || manifest.ciphertext.bytes < 0) {
    failures.push(
      `manifest.ciphertext.bytes ${JSON.stringify(manifest?.ciphertext?.bytes)} is not a byte count`,
    )
  }
  // The producer fails rather than publishing counts that did not come from the
  // dump's own snapshot, and always writes this field. A published artifact
  // without it did not come from this producer.
  if (manifest?.counts_snapshot !== true) {
    failures.push(
      `manifest.counts_snapshot is ${JSON.stringify(manifest?.counts_snapshot)}; a published ` +
        `artifact always records it as true`,
    )
  }
  for (const [path, value] of [
    ['run_id', manifest?.run_id],
    ['source.host', manifest?.source?.host],
    ['source.database', manifest?.source?.database],
  ]) {
    if (typeof value !== 'string' || value.trim() === '') {
      failures.push(`manifest.${path} ${JSON.stringify(value)} is not a non-empty string`)
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    snapshotTs,
    year,
    runId: typeof manifest?.run_id === 'string' ? manifest.run_id : null,
    sourceHost: typeof manifest?.source?.host === 'string' ? manifest.source.host : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Receipts.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The receipt the destination authors, and the only thing the producer is ever
 * asked to believe.
 *
 * `ciphertext_sha256` is the hash the DESTINATION computed from bytes it owned,
 * not a value copied out of the manifest.
 */
export function buildReceipt({
  base,
  ciphertextSha256,
  ciphertextBytes,
  manifest,
  identity,
  destinationHost,
  archivePath,
  acceptedAt,
}) {
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    artifact: artifactFileNames(base).ciphertext,
    base,
    ciphertext_sha256: ciphertextSha256,
    ciphertext_bytes: ciphertextBytes,
    // The recovery point. Freshness is max(source_snapshot_ts) over
    // binding-valid receipts, so this — not accepted_at — is what a freshness
    // evaluator may ever read as "how old is the newest verified backup".
    source_snapshot_ts: identity.snapshotTs,
    source_run_id: identity.runId,
    source_host: identity.sourceHost,
    manifest_schema_version: manifest.schema_version,
    destination_host: destinationHost,
    archive_path: archivePath,
    // Liveness of the pipeline only. Re-delivering an old artifact does not
    // rewrite an existing receipt at all, so this cannot be used to make an old
    // snapshot look new.
    accepted_at: acceptedAt,
  }
}

/**
 * Is this receipt bound to this manifest?
 *
 * The three binding fields are `artifact`, `ciphertext_sha256` and
 * `source_snapshot_ts` (docs/operations/backup-producer.md §7.6). A receipt
 * that does not match the manifest for the artifact it names is not evidence of
 * anything — it is either a bug or a replay, and both are reported rather than
 * accepted.
 *
 * Exported and tested here because it is one contract with two users: this
 * component uses it to decide whether an existing receipt may be left alone,
 * and the producer-side freshness evaluator (not in this slice) will use it to
 * decide whether a receipt may advance the metric.
 */
export function validateReceiptBinding(receipt, manifest) {
  const failures = []
  if (receipt?.schema_version !== RECEIPT_SCHEMA_VERSION) {
    failures.push(
      `receipt schema_version ${JSON.stringify(receipt?.schema_version)} is not the expected ` +
        `${RECEIPT_SCHEMA_VERSION}`,
    )
  }
  if (receipt?.artifact !== manifest?.artifact) {
    failures.push(
      `receipt.artifact ${JSON.stringify(receipt?.artifact)} does not match manifest.artifact ` +
        `${JSON.stringify(manifest?.artifact)}`,
    )
  }
  if (receipt?.ciphertext_sha256 !== manifest?.ciphertext?.sha256) {
    failures.push(
      `receipt.ciphertext_sha256 ${JSON.stringify(receipt?.ciphertext_sha256)} does not match ` +
        `manifest ${JSON.stringify(manifest?.ciphertext?.sha256)}`,
    )
  }
  if (receipt?.source_snapshot_ts !== manifest?.snapshot_ts) {
    failures.push(
      `receipt.source_snapshot_ts ${JSON.stringify(receipt?.source_snapshot_ts)} does not match ` +
        `manifest.snapshot_ts ${JSON.stringify(manifest?.snapshot_ts)}`,
    )
  }
  return { valid: failures.length === 0, failures }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exclusion.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take the acceptance lock, or refuse.
 *
 * Same discipline as the producer's run lock: `O_CREAT|O_EXCL` is the whole
 * mechanism, and **nothing here ever unlinks a lock it did not create**, because
 * "read the holder, check it is dead, unlink, re-create" is a check-then-unlink
 * race that lets two sweepers both believe they hold the lock.
 *
 * Unlike the producer there is no `retain` path and no uncertainty to record:
 * this component spawns nothing, so when a sweep returns — normally, by
 * refusal, or by abort — everything it started has demonstrably stopped, and
 * releasing the lock is justified. Only a process that dies outright leaves a
 * stale lock, and that needs an operator.
 */
export function acquireAcceptanceLock({ config, deps, sweepId, log = () => {} }) {
  const path = config.acceptance.lockFile
  const host = deps.hostname()
  const payload = JSON.stringify({ sweepId, pid: deps.pid, host, startedAt: deps.now() }) + '\n'

  try {
    const fd = deps.fs.openSync(path, 'wx', 0o600)
    try {
      deps.fs.writeSync(fd, payload)
    } finally {
      deps.fs.closeSync(fd)
    }
  } catch (err) {
    if (err?.code !== 'EEXIST') {
      throw new AcceptanceError(
        'acceptance_lock_unwritable',
        `could not create acceptance lock ${path}: ${err?.message ?? String(err)}`,
        err,
      )
    }
    let holder
    try {
      holder = JSON.parse(deps.fs.readFileSync(path, 'utf8'))
    } catch (parseErr) {
      throw new AcceptanceError(
        'acceptance_lock_unreadable',
        `acceptance lock ${path} exists but is not readable JSON ` +
          `(${parseErr?.message ?? String(parseErr)}). Refusing to guess whether a sweep is in ` +
          `flight — inspect and remove it deliberately.`,
      )
    }
    if (holder?.host !== host) {
      throw new AcceptanceError(
        'acceptance_lock_foreign_host',
        `acceptance lock ${path} is held by host ${JSON.stringify(holder?.host)}, not ${host}. ` +
          `A lock from another host is never broken automatically.`,
      )
    }
    const ageMs = deps.now() - (Number(holder.startedAt) || 0)
    const ageText = Number.isFinite(ageMs) ? `${Math.round(ageMs / 1000)}s` : 'unknown'
    if (typeof holder?.pid !== 'number' || deps.processAlive(holder.pid)) {
      const hung = Number.isFinite(ageMs) && ageMs > config.acceptance.lockStaleAfterMs
      throw new AcceptanceError(
        hung ? 'acceptance_concurrent_run_hung' : 'acceptance_concurrent_run',
        `acceptance lock ${path} is held by pid ${JSON.stringify(holder?.pid)} ` +
          `(sweep ${JSON.stringify(holder?.sweepId)}) on this host, age ${ageText}. Refusing to run ` +
          `two sweeps against the same inbox and archive.` +
          (hung
            ? ` That holder has been running longer than acceptance.lockStaleAfterMs ` +
              `(${config.acceptance.lockStaleAfterMs}ms) and is probably hung.`
            : ''),
      )
    }
    throw new AcceptanceError(
      'acceptance_lock_stale',
      `acceptance lock ${path} is held by pid ${holder.pid} (sweep ${JSON.stringify(holder.sweepId)}, ` +
        `age ${ageText}) which is no longer running. Stale locks are NEVER reclaimed ` +
        `automatically: doing so is a check-then-unlink race that lets two sweeps both believe they ` +
        `hold the lock. Confirm no sweep is running, then remove it deliberately: rm ${path}`,
    )
  }

  let settled = false
  const stillOurs = () => {
    try {
      return JSON.parse(deps.fs.readFileSync(path, 'utf8'))?.sweepId === sweepId
    } catch {
      return false
    }
  }
  return {
    release() {
      if (settled) return
      settled = true
      if (!stillOurs()) return
      try {
        deps.fs.unlinkSync(path)
      } catch (err) {
        log(`WARN: could not remove acceptance lock ${path}: ${err?.message ?? String(err)}`)
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem helpers, all fail-closed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `lstat`, never `stat`.
 *
 * The difference is the whole point: `stat` follows symlinks, so a symlink in
 * the inbox named like an artifact would be reported as a perfectly ordinary
 * file whose contents live wherever the link points. `lstat` describes the
 * entry itself, which is what a decision about the inbox has to be made on.
 */
function describeEntry(path, deps) {
  let st
  try {
    st = deps.fs.lstatSync(path)
  } catch (err) {
    if (err?.code === 'ENOENT') return { exists: false }
    return { exists: false, error: err?.message ?? String(err) }
  }
  return {
    exists: true,
    isFile: st.isFile(),
    isSymbolicLink: st.isSymbolicLink(),
    isDirectory: st.isDirectory(),
    size: st.size,
    mtimeMs: Number(st.mtimeMs),
    kind: st.isSymbolicLink()
      ? 'symbolic link'
      : st.isDirectory()
        ? 'directory'
        : st.isFile()
          ? 'file'
          : 'special file',
  }
}

/**
 * Second line of defence behind the `lstat` type check: resolve the entry and
 * insist it still lives directly inside the directory we listed.
 *
 * `lstat` already rejects a symlink entry; this also rejects one reached
 * through a symlinked *parent*, which is how an inbox that was itself replaced
 * would leak reads and writes somewhere else entirely.
 */
function assertContained({ path, dir, deps, what }) {
  let realPath
  let realDir
  try {
    realPath = deps.fs.realpathSync(path)
    realDir = deps.fs.realpathSync(dir)
  } catch (err) {
    throw new AcceptanceError(
      'unsafe_path',
      `could not resolve ${what} ${path}: ${err?.message ?? String(err)}`,
      err,
    )
  }
  const parent = realPath.slice(0, realPath.lastIndexOf('/')) || '/'
  if (parent !== realDir || !isInside(realPath, realDir)) {
    throw new AcceptanceError(
      'unsafe_path',
      `${what} ${path} resolves to ${realPath}, which is not directly inside ${realDir}. ` +
        `Refusing to read or move anything reached through a link out of the directory it was ` +
        `listed in.`,
    )
  }
  return realPath
}

/** How much of a source is read at a time. Nothing is ever held whole in memory. */
const COPY_CHUNK_BYTES = 1 << 20

/**
 * Copy one inbox file into the work space and report what landed.
 *
 * WHY THIS IS NOT `copyFileSync`
 * ------------------------------
 * `copyFileSync` resolves its source **by path, at the moment it runs**. Every
 * check made before it — `lstat` said "regular file", `realpath` said "inside
 * the inbox", `lstat` said "under the ceiling" — describes whatever was at that
 * path *then*. The inbox is writable by the transport for the whole sweep, so
 * the entry can be unlinked and replaced with a symlink to anywhere on the host
 * in the window between the last check and the copy, and `copyFileSync` will
 * follow it. That was reproduced: an external file was read and its bytes
 * accepted. Path-based checks cannot close that window, because the thing they
 * checked is not the thing the copy opens.
 *
 * So the copy opens the source ONCE, `O_NOFOLLOW`, and every payload byte is
 * then read only from that held descriptor. The path IS used once more, on
 * purpose — after the open, to re-prove containment and to bind the descriptor
 * to the resolved path by device+inode. What no longer happens is reading
 * payload bytes by name:
 *
 *   1. `O_NOFOLLOW` makes "open a symlink" fail in the kernel, atomically.
 *      There is no window: either the final component is a real file or the
 *      open fails with `ELOOP`.
 *   2. `O_NONBLOCK` keeps an entry swapped for a FIFO or a device from hanging
 *      the sweep in `open()`; `fstat` on the descriptor then rejects anything
 *      that is not a regular file. Both are decided on the OPENED object, not
 *      on a name.
 *   3. Containment is re-proved AFTER the open, and the descriptor is bound to
 *      it by comparing `fstat`'s device and inode against `lstat` of the
 *      resolved path. That is what covers a symlinked *parent*: a path that
 *      resolved elsewhere, or an entry swapped underneath a resolved parent, is
 *      a different inode from the one being held.
 *   4. Every byte is then read from that descriptor. A source replaced after
 *      this point cannot change what is copied — the descriptor still refers to
 *      the inode that passed the checks — and a source that GROWS is seen,
 *      because the read loop counts what it actually reads.
 *
 * The per-role ceiling is enforced by that counter, not by the earlier `lstat`,
 * and the loop stops BEFORE writing the byte that would breach it. That is what
 * bounds disk consumption: a post-copy size check happens after an unbounded
 * file has already been written.
 *
 * It deliberately does NOT compare the copy against the source afterwards. The
 * source may legitimately change at any instant; a mismatch would say only that
 * the inbox moved on, which is not a fact about the artifact. Worse, making the
 * copy's validity depend on the inbox's later state is precisely the trust this
 * component exists to remove: a writer could fail every acceptance simply by
 * touching the file afterwards.
 *
 * What proves the copy is good is the completion check that follows — the
 * copied ciphertext hashing to what the copied sidecar and the copied manifest
 * both say. A copy torn by a concurrent rewrite fails that check and is treated
 * as an arrival still in progress.
 */
function copyIntoWork({ from, to, dir, ceiling, what, deps }) {
  const C = deps.fs.constants ?? {}
  if (typeof C.O_NOFOLLOW !== 'number') {
    // Fail closed. Without O_NOFOLLOW the open is exactly the path-resolving
    // copy this function exists to replace, and it would be silently so.
    throw new AcceptanceError(
      'unsafe_path',
      `cannot copy ${what} safely: this platform's fs.constants has no O_NOFOLLOW, so a source ` +
        `cannot be opened without following a symbolic link.`,
    )
  }
  let fd
  try {
    fd = deps.fs.openSync(
      from,
      C.O_RDONLY | C.O_NOFOLLOW | (C.O_NONBLOCK ?? 0) | (C.O_CLOEXEC ?? 0),
    )
  } catch (err) {
    // ELOOP is what O_NOFOLLOW reports when the final component IS a symbolic
    // link, and it is the whole defence: the kernel refused, so nothing was
    // read through it and there was never a window in which it could have been.
    // ENOTDIR is the same refusal one component earlier.
    if (err?.code === 'ELOOP' || err?.code === 'ENOTDIR') {
      throw new AcceptanceError(
        'unsafe_path',
        `${what} could not be opened without following a symbolic link (${err.code}). It was a ` +
          `regular file when it was checked and is not one now. Nothing was read through it.`,
        err,
      )
    }
    throw err
  }
  try {
    const st = deps.fs.fstatSync(fd)
    if (!st.isFile()) {
      throw new AcceptanceError(
        'unsafe_path',
        `${what} is not a regular file once opened. Nothing was read through it.`,
      )
    }
    if (st.size > ceiling) {
      throw new AcceptanceError(
        'oversize',
        `${what} is ${st.size} bytes when opened, above the configured ceiling of ${ceiling}. ` +
          `Nothing was copied.`,
      )
    }
    // Containment, re-proved on the object actually held. `assertContained`
    // rejects a path that resolves out of the directory it was listed in; the
    // identity comparison then rejects the case where the path still resolves
    // inside but no longer names the inode this descriptor refers to.
    const realPath = assertContained({ path: from, dir, deps, what })
    const seen = deps.fs.lstatSync(realPath)
    if (seen.dev !== st.dev || seen.ino !== st.ino) {
      throw new AcceptanceError(
        'unsafe_path',
        `${what} was substituted while it was being opened: the descriptor holds inode ` +
          `${st.dev}:${st.ino} but ${realPath} now names ${seen.dev}:${seen.ino}. Nothing was ` +
          `read through it.`,
      )
    }

    const outFd = deps.fs.openSync(to, 'wx', 0o600)
    let copied = 0
    let breached = false
    try {
      const buf = Buffer.allocUnsafe(Math.min(COPY_CHUNK_BYTES, ceiling + 1))
      for (;;) {
        // Never ask for more than one byte past the ceiling: that single byte
        // is enough to know the source is too big, and it is never written.
        // Unreachable while the check below holds `copied <= ceiling`; kept
        // fail-closed rather than as a bare `break`, so a future change that
        // breaks that invariant refuses instead of accepting silently.
        const want = Math.min(buf.length, ceiling + 1 - copied)
        if (want <= 0) {
          breached = true
          break
        }
        const read = deps.fs.readSync(fd, buf, 0, want, null)
        if (read === 0) break
        if (copied + read > ceiling) {
          breached = true
          break
        }
        let offset = 0
        while (offset < read) {
          offset += deps.fs.writeSync(outFd, buf, offset, read - offset)
        }
        copied += read
      }
    } finally {
      deps.fs.closeSync(outFd)
    }
    if (breached) {
      // The partial copy is removed here rather than left for the work-debris
      // sweeper: a refused artifact must not occupy the work volume until its
      // orphan grace expires.
      try {
        deps.fs.rmSync(to, { force: true })
      } catch {
        /* reported as oversize regardless; the work directory is removed anyway */
      }
      throw new AcceptanceError(
        'oversize',
        `${what} exceeded the configured ceiling of ${ceiling} bytes while it was being copied ` +
          `(it grew or was replaced under the sweep). The partial copy was removed.`,
      )
    }

    // The destination is destination-owned, so this is defence in depth, not a
    // trust boundary: it catches a short write that reported success.
    const landed = deps.fs.statSync(to)
    if (landed.size !== copied) {
      throw new AcceptanceError(
        'copy_verification_failed',
        `${what} copied ${copied} bytes but ${to} is ${landed.size} bytes.`,
      )
    }
    return copied
  } finally {
    deps.fs.closeSync(fd)
  }
}

/**
 * Re-check every copy in the work space against its role ceiling before a single
 * byte of it is parsed or hashed.
 *
 * The copy loop already bounds what can be written, so reaching a failure here
 * means the work space is not what this sweep wrote. It runs anyway, because the
 * next thing to touch these files is `verifyArtifactCompletion`, which parses
 * the manifest and hashes the ciphertext — and neither of those should ever be
 * the first thing to discover a file's size.
 */
function assertWorkCopiesBounded({ artifactWork, roles, present, config, deps }) {
  for (const role of roles) {
    const path = `${artifactWork}/${present[role].name}`
    const info = describeEntry(path, deps)
    if (!info.exists || !info.isFile || info.isSymbolicLink) {
      throw new AcceptanceError(
        'copy_verification_failed',
        `work copy ${path} is ${info.exists ? info.kind : 'missing'}, not a regular file.`,
      )
    }
    const ceiling = roleCeiling(role, config)
    if (info.size > ceiling) {
      throw new AcceptanceError(
        'oversize',
        `work copy ${path} is ${info.size} bytes, above the configured ceiling of ${ceiling}. ` +
          `It was not parsed or hashed.`,
      )
    }
  }
}

/**
 * Write a file through a `.part` and a rename, then read it back and confirm.
 *
 * The rename is a convenience, not a guarantee: nothing here assumes it is
 * atomic. The read-back is what establishes the file is the file.
 */
function writeFileVerified({ path, text, mode, deps, tmpTag }) {
  // The temporary name carries the sweep id. Two sweeps that somehow ran at
  // once would otherwise share `<path>.part`, and one's rename would carry off
  // the other's half-written file — observed, and the reason this is not just
  // `.part`.
  const tmp = `${path}.${tmpTag}.part`
  deps.fs.writeFileSync(tmp, text, { mode })
  deps.fs.renameSync(tmp, path)
  const readBack = deps.fs.readFileSync(path, 'utf8')
  if (readBack !== text) {
    throw new AcceptanceError(
      'write_verification_failed',
      `${path} does not read back as what was written (${readBack.length} vs ${text.length} bytes)`,
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One acceptance sweep.
 *
 * Synchronous on purpose. Everything it does is a filesystem operation, and a
 * synchronous sweep has no interleaving points of its own — which means the
 * only concurrency it has to survive is another *process*, and that is exactly
 * what the tests can then reproduce deliberately.
 *
 * @param {object}   args
 * @param {object}   args.config    from validateAcceptanceConfig
 * @param {object}   args.deps      the injected boundary bundle
 * @param {Function} [args.log]
 * @param {object}   [args.options]
 * @param {{aborted: boolean}} [args.options.signal]
 *   Checked before each artifact is started and before the archive publish. An
 *   abort never interrupts a publish half-way: the publish either completes and
 *   is verified, or is withdrawn.
 * @returns {{sweepId, results, counts, unexpectedEntries, warnings, durationMs}}
 */
export function acceptInboxArtifacts({ config, deps, log = () => {}, options = {} }) {
  const startedAt = deps.now()
  const sweepId = `${new Date(startedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}-${deps.randomToken(4)}`
  const signal = options.signal ?? { aborted: false }
  const warnings = []
  const results = []
  const log2 = (line) => log(line)

  log2(`acceptance sweep ${sweepId} starting on ${config.inbox.dir}`)

  // The inbox is the one directory this component does not own. If it is not a
  // real directory — replaced by a symlink, or missing — nothing about the
  // sweep is safe, so it refuses rather than creating it.
  const inboxInfo = describeEntry(config.inbox.dir, deps)
  if (!inboxInfo.exists) {
    throw new AcceptanceError(
      'inbox_unreadable',
      `inbox ${config.inbox.dir} does not exist. The destination does not create the ` +
        `transport-writable directory; deployment does.`,
    )
  }
  if (inboxInfo.isSymbolicLink || !inboxInfo.isDirectory) {
    throw new AcceptanceError(
      'inbox_unsafe',
      `inbox ${config.inbox.dir} is a ${inboxInfo.kind}, not a directory.`,
    )
  }

  for (const dir of [
    config.work.dir,
    config.archive.dir,
    config.receipts.dir,
    config.quarantine.dir,
  ]) {
    deps.fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  const lock = acquireAcceptanceLock({ config, deps, sweepId, log: log2 })
  const workDir = `${config.work.dir}/${sweepId}`

  try {
    removeWorkDebris({ config, deps, sweepId, log: log2, warnings })
    deps.fs.mkdirSync(workDir, { recursive: true, mode: 0o700 })

    const { bases, unexpectedEntries } = groupInboxEntries({ config, deps })
    if (unexpectedEntries.length > 0) {
      log2(
        `${unexpectedEntries.length} inbox entr(ies) are not artifact files for prefix ` +
          `"${config.acceptance.artifactPrefix}"; reported and left untouched: ` +
          unexpectedEntries.slice(0, 10).join(', '),
      )
    }

    let started = 0
    for (const base of [...bases.keys()].sort()) {
      const entry = bases.get(base)
      if (signal.aborted) {
        results.push({ base, outcome: 'deferred_aborted' })
        continue
      }
      if (started >= config.acceptance.maxArtifactsPerSweep) {
        results.push({ base, outcome: 'deferred_budget' })
        continue
      }
      if (deps.now() - startedAt >= config.acceptance.sweepDeadlineMs) {
        results.push({ base, outcome: 'deferred_deadline' })
        continue
      }
      started++
      results.push(
        acceptOneArtifact({ config, deps, log: log2, signal, base, entry, workDir, sweepId }),
      )
    }

    const counts = {}
    for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1
    log2(
      `acceptance sweep ${sweepId} finished: ` +
        (Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ') || 'nothing to do'),
    )
    return {
      sweepId,
      results,
      counts,
      unexpectedEntries,
      warnings,
      durationMs: deps.now() - startedAt,
    }
  } finally {
    try {
      deps.fs.rmSync(workDir, { recursive: true, force: true })
    } catch (err) {
      log2(`WARN: could not remove work directory ${workDir}: ${err?.message ?? String(err)}`)
    }
    lock.release()
  }
}

/**
 * Delete work directories left by a sweep that died mid-copy.
 *
 * Only directories this sweep does not own, and only ones older than
 * `work.orphanGraceMs`. The work space is destination-owned and holds nothing
 * but copies, so removing debris loses nothing — but a sweep that somehow
 * defeated the lock would still be using its own directory, and the age bound
 * keeps this from being the thing that breaks it.
 */
function removeWorkDebris({ config, deps, sweepId, log, warnings }) {
  let entries
  try {
    entries = deps.fs.readdirSync(config.work.dir)
  } catch (err) {
    warnings.push(`could not list work directory: ${err?.message ?? String(err)}`)
    return
  }
  for (const name of entries) {
    if (name === sweepId) continue
    const path = `${config.work.dir}/${name}`
    const info = describeEntry(path, deps)
    if (!info.exists) continue
    const ageMs = deps.now() - info.mtimeMs
    if (!(ageMs >= config.work.orphanGraceMs)) continue
    try {
      deps.fs.rmSync(path, { recursive: true, force: true })
      log(`removed work debris ${path} (age ${Math.round(ageMs / 1000)}s)`)
    } catch (err) {
      warnings.push(`could not remove work debris ${path}: ${err?.message ?? String(err)}`)
    }
  }
}

/** Group the inbox listing by artifact base. Never follows or reads anything. */
function groupInboxEntries({ config, deps }) {
  let names
  try {
    names = deps.fs.readdirSync(config.inbox.dir)
  } catch (err) {
    throw new AcceptanceError(
      'inbox_unreadable',
      `could not list inbox ${config.inbox.dir}: ${err?.message ?? String(err)}`,
      err,
    )
  }
  const bases = new Map()
  const unexpectedEntries = []
  for (const name of names) {
    const parsed = parseArtifactEntryName(name, config.acceptance.artifactPrefix)
    if (!parsed) {
      unexpectedEntries.push(name)
      continue
    }
    if (!bases.has(parsed.base)) bases.set(parsed.base, { stamp: parsed.stamp, roles: {} })
    bases.get(parsed.base).roles[parsed.role] = name
  }
  return { bases, unexpectedEntries }
}

/** How large a per-role file may be, from configuration. */
function roleCeiling(role, config) {
  return {
    ciphertext: config.acceptance.maxCiphertextBytes,
    checksum: config.acceptance.maxSidecarBytes,
    manifest: config.acceptance.maxManifestBytes,
  }[role]
}

/**
 * Move a triple out of the inbox and into quarantine, preserving whatever is
 * there as evidence.
 *
 * A move, never a delete: a refusal that destroys the thing it refused cannot
 * be investigated. Quarantine lives outside the inbox (enforced in
 * configuration) so the party that wrote the inbox cannot tamper with it after
 * the fact.
 */
function quarantineTriple({ config, deps, base, entry, reason, log, sweepId }) {
  const dir = `${config.quarantine.dir}/${base}`
  const moved = []
  const failures = []
  try {
    deps.fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileVerified({
      path: `${dir}/REASON.txt`,
      text: `${new Date(deps.now()).toISOString()}\n${reason}\n`,
      mode: 0o600,
      deps,
      tmpTag: sweepId,
    })
  } catch (err) {
    failures.push(`could not prepare ${dir}: ${err?.message ?? String(err)}`)
  }
  for (const name of Object.values(entry.roles)) {
    const from = `${config.inbox.dir}/${name}`
    try {
      // rename() acts on the link itself, so a symlink entry is moved, not
      // followed — which is exactly what makes it safe to quarantine one.
      deps.fs.renameSync(from, `${dir}/${name}`)
      moved.push(name)
    } catch (err) {
      failures.push(`could not move ${name}: ${err?.message ?? String(err)}`)
    }
  }
  log(`QUARANTINED ${base} → ${dir}: ${reason}`)
  return { quarantineDir: dir, moved, failures }
}

/**
 * Accept — or refuse, or defer — one artifact.
 *
 * The step order is load-bearing and is the reason each decision is safe:
 *
 *   1. structural checks on the inbox (names, types, sizes). These are the only
 *      judgements made about the inbox, and none of them reads a byte.
 *   2. all three files present? If not, this is an arrival in progress until it
 *      is older than `inbox.incompleteGraceMs`.
 *   3. work capacity, on both filesystem layers, reserving the sum of the
 *      configured role CEILINGS — not the inbox sizes, which the transport can
 *      still change after they are read.
 *   4. copy the triple into the sweep's private work directory.
 *   5. completion, computed on the COPY. A failure here is still ambiguous —
 *      partial transfer or corruption look identical — so the same grace rule
 *      applies.
 *   6. manifest identity, on the copy. NOT ambiguous: the three files already
 *      hash together, so the bytes are exactly what the producer wrote and a
 *      bad manifest is a definitive refusal.
 *   7. conflict with an existing archived identity.
 *   8. archive capacity, on both filesystem layers, reserving the ACTUAL sizes
 *      of the work copies — then publish, then verify what landed.
 *   9. receipt.
 *  10. remove the inbox copy — last, and only once 8 and 9 both hold.
 */
function acceptOneArtifact({ config, deps, log, signal, base, entry, workDir, sweepId }) {
  const names = artifactFileNames(base)
  const roles = ['ciphertext', 'checksum', 'manifest']

  // ── 1. structural checks, on the inbox, reading nothing ───────────────────
  const present = {}
  const missing = []
  let newestMtimeMs = 0
  for (const role of roles) {
    const name = names[role]
    const path = `${config.inbox.dir}/${name}`
    const info = describeEntry(path, deps)
    if (!info.exists) {
      missing.push(name)
      continue
    }
    if (!info.isFile || info.isSymbolicLink) {
      return {
        base,
        outcome: 'quarantined_unsafe',
        alert: true,
        detail: `inbox entry ${name} is a ${info.kind}, not a regular file`,
        ...quarantineTriple({
          config,
          deps,
          sweepId,
          base,
          entry,
          reason:
            `inbox entry ${name} is a ${info.kind}, not a regular file. Nothing was read ` +
            `through it.`,
          log,
        }),
      }
    }
    const ceiling = roleCeiling(role, config)
    if (info.size > ceiling) {
      return {
        base,
        outcome: 'quarantined_oversize',
        alert: true,
        detail: `${name} is ${info.size} bytes, ceiling is ${ceiling}`,
        ...quarantineTriple({
          config,
          deps,
          sweepId,
          base,
          entry,
          reason:
            `${name} is ${info.size} bytes, above the configured ceiling of ${ceiling}. ` +
            `Nothing was read.`,
          log,
        }),
      }
    }
    present[role] = { path, name, size: info.size }
    newestMtimeMs = Math.max(newestMtimeMs, info.mtimeMs)
  }

  const ageMs = deps.now() - newestMtimeMs
  const agedOut = newestMtimeMs > 0 && ageMs >= config.inbox.incompleteGraceMs

  // ── 2. incomplete arrivals ────────────────────────────────────────────────
  if (missing.length > 0) {
    if (!agedOut) {
      // A young incomplete triple is indistinguishable from a transfer in
      // flight. It is left EXACTLY as found — not read, not moved, not deleted.
      log(
        `${base}: incomplete (missing ${missing.join(', ')}), newest part is ` +
          `${Math.round(ageMs / 1000)}s old — leaving it alone`,
      )
      return {
        base,
        outcome: 'pending_incomplete',
        detail: `missing ${missing.join(', ')}`,
        ageMs,
      }
    }
    return {
      base,
      outcome: 'quarantined_stalled',
      alert: true,
      detail: `still missing ${missing.join(', ')} after ${Math.round(ageMs / 1000)}s`,
      ageMs,
      ...quarantineTriple({
        config,
        deps,
        sweepId,
        base,
        entry,
        reason:
          `incomplete after ${Math.round(ageMs / 1000)}s (inbox.incompleteGraceMs is ` +
          `${config.inbox.incompleteGraceMs}ms); missing ${missing.join(', ')}`,
        log,
      }),
    }
  }

  // Reject anything reached through a symlinked parent before touching it.
  try {
    for (const role of roles) {
      assertContained({
        path: present[role].path,
        dir: config.inbox.dir,
        deps,
        what: `inbox entry ${present[role].name}`,
      })
    }
  } catch (err) {
    if (err?.cause?.code === 'ENOENT') {
      // The entry disappeared between being listed and being resolved. That is
      // the transport moving, not an unsafe path; the next sweep will see
      // whatever it settles on.
      log(
        `${base}: an inbox entry vanished mid-sweep (${err.message}) — leaving it for the next sweep`,
      )
      return { base, outcome: 'pending_incomplete', detail: err.message }
    }
    return {
      base,
      outcome: 'quarantined_unsafe',
      alert: true,
      detail: err.message,
      ...quarantineTriple({ config, deps, sweepId, base, entry, reason: err.message, log }),
    }
  }

  // ── 3. work capacity, reserved from the CEILINGS ──────────────────────────
  //
  // The sizes gathered in step 1 came from `lstat` on the inbox, and the inbox
  // stays writable for the whole sweep. A source can be replaced or grown after
  // that `lstat` and still be copied in full, as long as it stays under its
  // role ceiling — that is exactly what the copy loop permits, and it is the
  // only bound the copy actually enforces. So a reservation derived from those
  // `lstat` sizes bounds nothing: the accepted work copy can legitimately be
  // far larger than the number that was reserved for it.
  //
  // The reservation is therefore the sum of the configured role ceilings. It is
  // the worst case the copy can produce, it is stated in configuration rather
  // than read from the inbox, and nothing the transport does afterwards can
  // move it. Ceilings much larger than real artifacts make this refuse early;
  // that is the operator's dial, and refusing early is the safe direction.
  //
  // This measures the WORK filesystem only, because the work copy is the only
  // thing about to be written. The archive is measured separately, later, with
  // the bytes that will actually land on it (step 8's preamble) — the two
  // targets are never conflated, and neither is assumed to back the other.
  const reservedWorkBytes = roles.reduce((n, r) => n + roleCeiling(r, config), 0)
  const capacity = checkCapacity({
    label: 'acceptance work',
    dir: config.work.dir,
    minFreeBytes: config.capacity.minFreeBytes,
    backingVolume: config.capacity.backingVolume,
    needBytes: reservedWorkBytes,
    deps,
  })
  if (!capacity.ok) {
    throw new AcceptanceError(
      'insufficient_capacity',
      `work capacity check failed before copying ${base} out of the inbox:\n  ` +
        capacity.problems.join('\n  '),
    )
  }

  // ── 4. copy into the destination's own space ──────────────────────────────
  //
  // Everything from here on reads ONLY this copy. The inbox may change under
  // us at any moment; after this point it cannot change what is accepted.
  const artifactWork = `${workDir}/${base}`
  deps.fs.mkdirSync(artifactWork, { recursive: true, mode: 0o700 })
  try {
    for (const role of roles) {
      copyIntoWork({
        from: present[role].path,
        to: `${artifactWork}/${present[role].name}`,
        dir: config.inbox.dir,
        ceiling: roleCeiling(role, config),
        what: `inbox entry ${present[role].name}`,
        deps,
      })
    }
    assertWorkCopiesBounded({ artifactWork, roles, present, config, deps })
  } catch (err) {
    // An entry that vanished between the listing and the copy is the transport
    // moving, not a verdict: the next sweep sees whatever it settles on.
    if (err?.code === 'ENOENT' || err?.cause?.code === 'ENOENT') {
      log(`${base}: an inbox entry vanished during the copy (${err.message}) — leaving it alone`)
      return { base, outcome: 'pending_incomplete', detail: err.message }
    }
    // A ceiling breach and a substituted source are both definitive refusals,
    // and both are decided WITHOUT the source having been read as a whole: the
    // triple is moved aside as evidence and a human is told.
    if (err instanceof AcceptanceError && (err.code === 'oversize' || err.code === 'unsafe_path')) {
      return {
        base,
        outcome: err.code === 'oversize' ? 'quarantined_oversize' : 'quarantined_unsafe',
        alert: true,
        detail: err.message,
        ...quarantineTriple({ config, deps, sweepId, base, entry, reason: err.message, log }),
      }
    }
    // Anything else — ENOSPC, EIO, a permission change — is not a verdict on
    // the artifact.
    log(`${base}: could not copy into the work space: ${err?.message ?? String(err)}`)
    return { base, outcome: 'pending_copy_failed', detail: err?.message ?? String(err) }
  }

  // ── 5. completion, on the copy ────────────────────────────────────────────
  const completion = verifyArtifactCompletion({ dir: artifactWork, base, deps })
  if (!completion.complete) {
    if (!agedOut) {
      log(
        `${base}: the copy does not verify complete yet (${completion.failures.length} failure(s)), ` +
          `newest inbox part is ${Math.round(ageMs / 1000)}s old — leaving it alone`,
      )
      return {
        base,
        outcome: 'pending_incomplete',
        detail: completion.failures.join('; '),
        ageMs,
      }
    }
    return {
      base,
      outcome: 'quarantined_corrupt',
      alert: true,
      detail: completion.failures.join('; '),
      ageMs,
      ...quarantineTriple({
        config,
        deps,
        sweepId,
        base,
        entry,
        reason:
          `did not verify complete after ${Math.round(ageMs / 1000)}s:\n  ` +
          completion.failures.join('\n  '),
        log,
      }),
    }
  }

  const ciphertextSha256 = deps.sha256File(`${artifactWork}/${names.ciphertext}`)
  const ciphertextBytes = deps.fs.statSync(`${artifactWork}/${names.ciphertext}`).size
  const manifest = completion.manifest

  // ── 6. manifest identity ──────────────────────────────────────────────────
  const identity = validateManifestIdentity({ manifest, base, stamp: entry.stamp })
  if (!identity.ok) {
    return {
      base,
      outcome: 'quarantined_manifest_invalid',
      alert: true,
      detail: identity.failures.join('; '),
      ...quarantineTriple({
        config,
        deps,
        sweepId,
        base,
        entry,
        reason:
          `the triple hashes together but its manifest does not describe this artifact:\n  ` +
          identity.failures.join('\n  '),
        log,
      }),
    }
  }

  const archiveDir = `${config.archive.dir}/${identity.year}`
  const archivePath = `${archiveDir}/${names.ciphertext}`
  const receiptPath = `${config.receipts.dir}/${receiptFileName(base)}`

  // ── 7. an identity that already exists ────────────────────────────────────
  const existing = inspectArchived({ config, deps, base, archiveDir, receiptPath })
  if (existing.complete) {
    const sameHash = existing.ciphertextSha256 === ciphertextSha256
    const sameSnapshot = existing.manifest?.snapshot_ts === manifest.snapshot_ts
    if (!sameHash || !sameSnapshot) {
      // Two hosts' clocks are not a coordination mechanism. A second artifact
      // claiming an identity that is already archived with different content is
      // a hard refusal and an alert — never an overwrite.
      const reason =
        `identity ${base} is already archived at ${archivePath} with ` +
        (sameHash
          ? `snapshot_ts ${JSON.stringify(existing.manifest?.snapshot_ts)}, but the incoming ` +
            `manifest says ${JSON.stringify(manifest.snapshot_ts)}`
          : `ciphertext sha256 ${existing.ciphertextSha256}, but the incoming artifact hashes to ` +
            `${ciphertextSha256}`) +
        `. The archived copy was NOT touched.`
      return {
        base,
        outcome: 'rejected_identity_conflict',
        alert: true,
        detail: reason,
        archivePath,
        ...quarantineTriple({ config, deps, sweepId, base, entry, reason, log }),
      }
    }
    // Same name, same hash, same recovery point: a benign re-delivery.
    const finished = ensureReceipt({
      deps,
      log,
      sweepId,
      base,
      receiptPath,
      manifest: existing.manifest,
      identity: validateManifestIdentity({
        manifest: existing.manifest,
        base,
        stamp: entry.stamp,
      }),
      ciphertextSha256: existing.ciphertextSha256,
      ciphertextBytes: existing.ciphertextBytes,
      archivePath,
    })
    if (finished.outcome === 'receipt_binding_invalid') {
      const reason =
        `identity ${base} is already archived and the incoming copy is identical, but the ` +
        `existing receipt ${receiptPath} is not bound to it: ${finished.failures.join('; ')}. ` +
        `Neither the archive nor the receipt was modified.`
      return {
        base,
        outcome: 'rejected_receipt_conflict',
        alert: true,
        detail: reason,
        archivePath,
      }
    }
    removeInboxTriple({ config, deps, base, entry, log })
    log(
      `${base}: identical re-delivery of an already-accepted artifact — ` +
        `${finished.outcome === 'receipt_written' ? 'wrote the missing receipt' : 'receipt left unchanged'}`,
    )
    return {
      base,
      outcome: finished.outcome === 'receipt_written' ? 'receipt_completed' : 'duplicate',
      archivePath,
      receiptPath,
      ciphertextSha256,
      sourceSnapshotTs: manifest.snapshot_ts,
      // A re-delivery never rewrites an existing receipt, so nothing about it
      // can make an old snapshot look newer than it is.
      freshnessAdvanced: false,
    }
  }
  // A receipt is the destination's own attestation that this identity WAS
  // accepted and archived. If one exists and the archive does not verify
  // complete, the two disagree, and that is damage to accepted state rather
  // than a delivery problem.
  //
  // This is checked before anything under `archive/` is touched, and it is
  // deliberately not conditioned on an archive file being present. "Every file
  // is missing" is the WORST version of this state, not an exemption from it:
  // treating it as "nothing was ever accepted here" made the sweep republish
  // over it — with bytes that may not be the ones the receipt names — and only
  // then notice the receipt. Republishing would also silently repair a loss a
  // human has to see. So the archive is left as found, the receipt is left as
  // found, and the incoming triple is left in the inbox as evidence.
  if (existing.receipt) {
    const bound = validateReceiptBinding(existing.receipt, manifest)
    const reason =
      `identity ${base} has a receipt at ${receiptPath} but its archived copy does not verify ` +
      `complete (${existing.failures.join('; ')}). That is damage to an accepted artifact, not a ` +
      `delivery problem; refusing to republish over it. The incoming triple ` +
      (bound.valid
        ? `is the artifact that receipt names, so republishing it would quietly repair a loss ` +
          `that has to be investigated.`
        : `is NOT the artifact that receipt names (${bound.failures.join('; ')}).`) +
      ` Nothing under archive/, receipts/ or the inbox was modified.`
    return {
      base,
      outcome: 'rejected_archive_damaged',
      alert: true,
      detail: reason,
      archivePath,
      receiptPath,
    }
  }
  if (existing.anyFilePresent) {
    // Debris from a sweep that died mid-publish. It was never accepted — no
    // receipt names it — so republishing over it is the resume path.
    log(
      `${base}: an incomplete archive entry with no receipt is present; resuming the publish ` +
        `(${existing.failures.join('; ')})`,
    )
  }

  if (signal.aborted) {
    log(`${base}: aborted before publishing; nothing was written`)
    return { base, outcome: 'deferred_aborted' }
  }

  // ── 8. archive capacity, then publish, then verify what actually landed ───
  //
  // Measured HERE, immediately before the first thing that mutates anything
  // under `archive/`, and measured on the work copies rather than on the inbox.
  // Those copies are destination-owned and bounded: `copyIntoWork` stopped
  // before the ceiling-breaching byte and `assertWorkCopiesBounded` re-checked
  // the result, so these sizes are exactly what the publish will write and the
  // transport cannot change them any more.
  //
  // When work and archive share a filesystem this composes without any
  // assumption being made about it: the free space read here has ALREADY lost
  // the work copies (and every earlier artifact this sweep archived), so the
  // floor is preserved for both writes. When they are separate filesystems,
  // each has been asked for its own room. The component never probes which of
  // the two it is, and never needs to.
  const publishBytes = roles.reduce(
    (n, role) => n + deps.fs.statSync(`${artifactWork}/${names[role]}`).size,
    0,
  )
  const archiveCapacity = checkCapacity({
    label: 'acceptance archive',
    dir: config.archive.dir,
    minFreeBytes: config.capacity.minFreeBytes,
    backingVolume: config.capacity.backingVolume,
    needBytes: publishBytes,
    deps,
  })
  if (!archiveCapacity.ok) {
    // Nothing under archive/, receipts/ or the inbox has been touched for this
    // artifact. A full destination is a host condition, not a verdict about the
    // artifact, so the triple is left in the inbox for the next sweep.
    throw new AcceptanceError(
      'insufficient_capacity',
      `archive capacity check failed before publishing ${base}:\n  ` +
        archiveCapacity.problems.join('\n  '),
    )
  }

  deps.fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 })
  const publishedPaths = []
  const tempPaths = []
  try {
    // Ciphertext, sidecar, manifest LAST — the same order the producer uses,
    // and for the same reason: it shortens the window in which a naive reader
    // could see a manifest without its artifact. It is not the safety property.
    for (const role of roles) {
      const to = `${archiveDir}/${names[role]}`
      const tmp = `${to}.${sweepId}.part`
      tempPaths.push(tmp)
      deps.fs.copyFileSync(`${artifactWork}/${names[role]}`, tmp)
      deps.fs.renameSync(tmp, to)
      publishedPaths.push(to)
    }
  } catch (err) {
    withdraw({ publishedPaths: [...publishedPaths, ...tempPaths], deps })
    throw new AcceptanceError(
      'archive_publish_failed',
      `could not publish ${base} into ${archiveDir}: ${err?.message ?? String(err)}`,
      err,
    )
  }

  const published = verifyArtifactCompletion({ dir: archiveDir, base, deps })
  const publishedSha = published.complete ? deps.sha256File(archivePath) : null
  if (!published.complete || publishedSha !== ciphertextSha256) {
    withdraw({ publishedPaths: [...publishedPaths, ...tempPaths], deps })
    return {
      base,
      outcome: 'publish_withdrawn',
      alert: true,
      detail: published.complete
        ? `the published ciphertext hashes to ${publishedSha}, not ${ciphertextSha256}`
        : published.failures.join('; '),
    }
  }

  // ── 9. the receipt ────────────────────────────────────────────────────────
  const finished = ensureReceipt({
    deps,
    log,
    sweepId,
    base,
    receiptPath,
    manifest,
    identity,
    ciphertextSha256,
    ciphertextBytes,
    archivePath,
  })
  if (finished.outcome === 'receipt_binding_invalid') {
    return {
      base,
      outcome: 'rejected_receipt_conflict',
      alert: true,
      detail:
        `an existing receipt at ${receiptPath} is not bound to this artifact: ` +
        finished.failures.join('; '),
      archivePath,
    }
  }

  // ── 10. the inbox copy, last ──────────────────────────────────────────────
  removeInboxTriple({ config, deps, base, entry, log })

  log(`${base}: ACCEPTED → ${archivePath}, receipt ${receiptPath}`)
  return {
    base,
    outcome: 'accepted',
    archivePath,
    receiptPath,
    ciphertextSha256,
    ciphertextBytes,
    sourceSnapshotTs: manifest.snapshot_ts,
    sweepId,
    freshnessAdvanced: true,
  }
}

/** Remove files this sweep published, after deciding they do not verify. */
function withdraw({ publishedPaths, deps }) {
  for (const p of publishedPaths) {
    try {
      deps.fs.rmSync(p, { force: true })
    } catch {
      /* best effort; the artifact is already being reported as not published */
    }
  }
}

/** What, if anything, is already archived and receipted under this identity. */
function inspectArchived({ config, deps, base, archiveDir, receiptPath }) {
  const names = artifactFileNames(base)
  const anyFilePresent = Object.values(names).some((n) => deps.fs.existsSync(`${archiveDir}/${n}`))
  const receipt = readReceipt({ deps, receiptPath })
  if (!anyFilePresent) {
    return { complete: false, anyFilePresent: false, failures: ['nothing archived'], receipt }
  }
  const completion = verifyArtifactCompletion({ dir: archiveDir, base, deps })
  return {
    complete: completion.complete,
    anyFilePresent: true,
    failures: completion.failures,
    manifest: completion.manifest,
    receipt,
    ciphertextSha256: completion.complete
      ? deps.sha256File(`${archiveDir}/${names.ciphertext}`)
      : null,
    ciphertextBytes: completion.complete
      ? deps.fs.statSync(`${archiveDir}/${names.ciphertext}`).size
      : null,
  }
}

/** Parse a receipt file, or `null` if it is not there. Unreadable is not absent. */
function readReceipt({ deps, receiptPath }) {
  if (!deps.fs.existsSync(receiptPath)) return null
  try {
    return JSON.parse(deps.fs.readFileSync(receiptPath, 'utf8'))
  } catch (err) {
    // Present but unusable. It will fail binding validation, which is a
    // refusal — never an overwrite.
    return { __unreadable: err?.message ?? String(err) }
  }
}

/**
 * Write the receipt if there is not already a binding-valid one.
 *
 * An existing, binding-valid receipt is left **byte-identical**. That is what
 * makes a re-delivery unable to move a freshness metric: the metric is a max
 * over `source_snapshot_ts`, and re-delivering an old artifact neither adds a
 * receipt nor changes one.
 */
function ensureReceipt({
  deps,
  log,
  sweepId,
  base,
  receiptPath,
  manifest,
  identity,
  ciphertextSha256,
  ciphertextBytes,
  archivePath,
}) {
  // Read the receipt HERE rather than reusing the one the earlier inspection
  // saw. Between then and now another sweeper — one that somehow held no lock —
  // could have written it, and overwriting a valid receipt with an equivalent
  // one would still rewrite `accepted_at`, which is the one field a re-delivery
  // must never be able to move.
  const existingReceipt = readReceipt({ deps, receiptPath })
  if (existingReceipt) {
    const binding = validateReceiptBinding(existingReceipt, manifest)
    if (!binding.valid) return { outcome: 'receipt_binding_invalid', failures: binding.failures }
    if (existingReceipt.ciphertext_sha256 !== ciphertextSha256) {
      return {
        outcome: 'receipt_binding_invalid',
        failures: [
          `receipt.ciphertext_sha256 ${JSON.stringify(existingReceipt.ciphertext_sha256)} does not ` +
            `match the hash the destination computed (${ciphertextSha256})`,
        ],
      }
    }
    return { outcome: 'receipt_unchanged' }
  }
  const receipt = buildReceipt({
    base,
    ciphertextSha256,
    ciphertextBytes,
    manifest,
    identity,
    destinationHost: deps.hostname(),
    archivePath,
    acceptedAt: new Date(deps.now()).toISOString(),
  })
  const binding = validateReceiptBinding(receipt, manifest)
  if (!binding.valid) {
    // Unreachable unless the builder and the validator disagree. Refusing here
    // is cheaper than publishing a receipt nobody will accept.
    throw new AcceptanceError(
      'receipt_binding_invalid',
      `refusing to write a receipt for ${base} that does not bind to its own manifest: ` +
        binding.failures.join('; '),
    )
  }
  writeFileVerified({
    path: receiptPath,
    text: JSON.stringify(receipt, null, 2) + '\n',
    mode: 0o644,
    deps,
    tmpTag: sweepId,
  })
  log(`${base}: receipt written to ${receiptPath}`)
  return { outcome: 'receipt_written' }
}

/** Remove the inbox triple. Only ever called once the artifact is accepted. */
function removeInboxTriple({ config, deps, base, entry, log }) {
  // The manifest goes first: from that instant the triple reads as incomplete
  // to anything else looking at the inbox, which is the state that is left
  // alone rather than acted on.
  const order = ['manifest', 'checksum', 'ciphertext']
  for (const role of order) {
    const name = entry.roles[role]
    if (!name) continue
    try {
      deps.fs.unlinkSync(`${config.inbox.dir}/${name}`)
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        log(`WARN: could not remove accepted inbox file ${name}: ${err?.message ?? String(err)}`)
      }
    }
  }
}
