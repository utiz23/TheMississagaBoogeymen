/**
 * Destination acceptance — configuration contract (Phase 1B, first slice).
 *
 * WHOSE CONFIGURATION THIS IS
 * ---------------------------
 * This file describes the configuration of the **destination host**, not the
 * producer's. Acceptance is decided solely by the destination
 * (docs/operations/backup-producer.md §7.1), so the destination states its own
 * directories, its own bounds and its own grace periods, and never reads the
 * producer's config.
 *
 * The rules are the producer's rules, for the producer's reasons:
 *
 *   - **No defaults.** A missing key is a validation error. A defaulted
 *     directory name is how a sweep ends up moving files somewhere nobody
 *     intended.
 *   - **Absolute paths only.** A timer's cwd is not a contract.
 *   - **`backingVolume` is required-but-nullable**, because "df tells the truth
 *     on this filesystem" and "I did not think about it" must not look the same.
 *
 * One rule is specific to acceptance, and it is the reason this component
 * exists at all:
 *
 *   **The inbox is transport-writable; nothing else may be.** The archive, the
 *   receipts, the private work space, the quarantine and the lock file must all
 *   live OUTSIDE the inbox tree, and the inbox must not live inside any of
 *   them. This is checked here, in configuration, because it is the single
 *   property that makes an accepted artifact safe from the host that produced
 *   it. Configuration cannot enforce it at the filesystem level — see
 *   docs/operations/backup-acceptance.md §6 for what still needs deployment
 *   proof.
 *
 * This module performs no I/O of its own beyond the injected `readFile`.
 */

import { ARTIFACT_PREFIX_PATTERN } from './backup-artifact-contract.mjs'
import {
  ConfigError,
  fail,
  requireAbsolutePath,
  requireBackingVolume,
  requireObject,
  requirePositiveInt,
  requireString,
} from './backup-config.mjs'

/** Receipt schema version. Bump whenever a consumer-visible receipt field changes. */
export const RECEIPT_SCHEMA_VERSION = 1

/** `true` when `child` is `parent` or lies beneath it, comparing whole path components. */
export function isInside(child, parent) {
  const c = child.replace(/\/+$/, '')
  const p = parent.replace(/\/+$/, '')
  return c === p || c.startsWith(p + '/')
}

/**
 * Validate a parsed acceptance configuration and return a frozen, normalised copy.
 *
 * @param {unknown} raw
 * @param {string} sourcePath  Only used to phrase errors.
 */
export function validateAcceptanceConfig(raw, sourcePath = '<acceptance-config>') {
  requireObject(raw, sourcePath)

  // ── the transport-writable inbox ───────────────────────────────────────────
  const inb = requireObject(raw.inbox, `${sourcePath}.inbox`)
  const inbox = {
    dir: requireAbsolutePath(inb, 'dir', `${sourcePath}.inbox`),
    // How long a triple may sit incomplete — missing a file, or present but not
    // hashing to what it claims — before it is moved aside. Below this age it is
    // LEFT ALONE, because an incomplete triple is indistinguishable from a
    // transfer in progress and deleting a young partial upload destroys a
    // backup that was about to arrive.
    incompleteGraceMs: requirePositiveInt(inb, 'incompleteGraceMs', `${sourcePath}.inbox`),
  }

  // ── destination-owned private work space ───────────────────────────────────
  const wrk = requireObject(raw.work, `${sourcePath}.work`)
  const work = {
    dir: requireAbsolutePath(wrk, 'dir', `${sourcePath}.work`),
    // Debris from a sweep that died mid-copy. Only directories older than this
    // are removed, and only ones this sweep does not own.
    orphanGraceMs: requirePositiveInt(wrk, 'orphanGraceMs', `${sourcePath}.work`),
  }

  // ── accepted artifacts, receipts, quarantine ───────────────────────────────
  const archive = {
    dir: requireAbsolutePath(
      requireObject(raw.archive, `${sourcePath}.archive`),
      'dir',
      `${sourcePath}.archive`,
    ),
  }
  const receipts = {
    dir: requireAbsolutePath(
      requireObject(raw.receipts, `${sourcePath}.receipts`),
      'dir',
      `${sourcePath}.receipts`,
    ),
  }
  const quarantine = {
    dir: requireAbsolutePath(
      requireObject(raw.quarantine, `${sourcePath}.quarantine`),
      'dir',
      `${sourcePath}.quarantine`,
    ),
  }

  // ── capacity, on both filesystem layers ────────────────────────────────────
  const cap = requireObject(raw.capacity, `${sourcePath}.capacity`)
  const capacity = {
    minFreeBytes: requirePositiveInt(cap, 'minFreeBytes', `${sourcePath}.capacity`),
    backingVolume: requireBackingVolume(cap, `${sourcePath}.capacity`),
  }

  // ── the sweep itself ───────────────────────────────────────────────────────
  const acc = requireObject(raw.acceptance, `${sourcePath}.acceptance`)
  const acceptance = {
    artifactPrefix: requireString(acc, 'artifactPrefix', `${sourcePath}.acceptance`),
    lockFile: requireAbsolutePath(acc, 'lockFile', `${sourcePath}.acceptance`),
    lockStaleAfterMs: requirePositiveInt(acc, 'lockStaleAfterMs', `${sourcePath}.acceptance`),
    // Per-file ceilings. Nothing is read into memory before its size has been
    // checked against these, and the ciphertext is only ever streamed.
    maxCiphertextBytes: requirePositiveInt(acc, 'maxCiphertextBytes', `${sourcePath}.acceptance`),
    maxManifestBytes: requirePositiveInt(acc, 'maxManifestBytes', `${sourcePath}.acceptance`),
    maxSidecarBytes: requirePositiveInt(acc, 'maxSidecarBytes', `${sourcePath}.acceptance`),
    // Bounded work per sweep: a backlog is drained over several sweeps rather
    // than in one unbounded run holding the lock.
    maxArtifactsPerSweep: requirePositiveInt(
      acc,
      'maxArtifactsPerSweep',
      `${sourcePath}.acceptance`,
    ),
    // No new artifact is STARTED after this much elapsed time. An artifact
    // already being published always finishes or is withdrawn; the deadline
    // never interrupts a publish.
    sweepDeadlineMs: requirePositiveInt(acc, 'sweepDeadlineMs', `${sourcePath}.acceptance`),
  }
  if (!ARTIFACT_PREFIX_PATTERN.test(acceptance.artifactPrefix)) {
    fail(
      'config_field_invalid',
      `${sourcePath}.acceptance.artifactPrefix must match /^[a-z0-9][a-z0-9-]*$/ (it becomes part ` +
        `of a filename, and it is what the sweep matches inbox entries against).`,
    )
  }

  // ── the separation that makes acceptance mean anything ────────────────────
  //
  // Anything reachable by the transport key can be overwritten by whoever holds
  // that key. Accepted artifacts, their receipts, the bytes being verified and
  // the quarantine evidence must therefore all be somewhere that key cannot
  // write. Configuration is the only place this repository can check it.
  const protectedDirs = [
    ['work.dir', work.dir],
    ['archive.dir', archive.dir],
    ['receipts.dir', receipts.dir],
    ['quarantine.dir', quarantine.dir],
    ['acceptance.lockFile', acceptance.lockFile],
  ]
  for (const [label, dir] of protectedDirs) {
    if (isInside(dir, inbox.dir)) {
      fail(
        'config_field_invalid',
        `${sourcePath}.${label} (${dir}) is inside the transport-writable inbox ` +
          `(${inbox.dir}). Acceptance only means something if what it produces is out of reach ` +
          `of the key that writes the inbox.`,
      )
    }
    if (isInside(inbox.dir, dir)) {
      fail(
        'config_field_invalid',
        `${sourcePath}.inbox.dir (${inbox.dir}) is inside ${label} (${dir}). The inbox must be a ` +
          `separate tree, not a subdirectory of one the destination owns.`,
      )
    }
  }
  const distinct = [['inbox.dir', inbox.dir], ...protectedDirs]
  for (let i = 0; i < distinct.length; i++) {
    for (let j = i + 1; j < distinct.length; j++) {
      if (distinct[i][1] === distinct[j][1]) {
        fail(
          'config_field_invalid',
          `${sourcePath}.${distinct[i][0]} and ${sourcePath}.${distinct[j][0]} are the same path ` +
            `(${distinct[i][1]}); each has a different owner and a different lifetime.`,
        )
      }
    }
  }
  // The work space is emptied of debris on every sweep, so it must not contain
  // anything with a longer life than one sweep.
  for (const [label, dir] of [
    ['archive.dir', archive.dir],
    ['receipts.dir', receipts.dir],
    ['quarantine.dir', quarantine.dir],
  ]) {
    if (isInside(dir, work.dir)) {
      fail(
        'config_field_invalid',
        `${sourcePath}.${label} (${dir}) is inside work.dir (${work.dir}), which is swept for ` +
          `debris on every run.`,
      )
    }
  }

  return Object.freeze({
    inbox: Object.freeze(inbox),
    work: Object.freeze(work),
    archive: Object.freeze(archive),
    receipts: Object.freeze(receipts),
    quarantine: Object.freeze(quarantine),
    capacity: Object.freeze(capacity),
    acceptance: Object.freeze(acceptance),
  })
}

/**
 * Read and validate an acceptance configuration file.
 *
 * @param {string} path
 * @param {(p: string) => string} readFile
 */
export function loadAcceptanceConfig(path, readFile) {
  let text
  try {
    text = readFile(path)
  } catch (err) {
    throw new ConfigError(
      'config_unreadable',
      `could not read acceptance config ${path}: ${err?.message ?? String(err)}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError(
      'config_unparseable',
      `acceptance config ${path} is not valid JSON: ${err?.message ?? String(err)}`,
    )
  }
  return validateAcceptanceConfig(parsed, path)
}
