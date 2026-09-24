/**
 * The Healthchecks ping-key file reader (E3J8A) — INTERNAL, no public wrapper.
 *
 * WHAT THIS FILE HOLDS
 * ---------------------
 * The one place in this repository that reads a bearer credential from disk.
 * It returns the key to exactly one caller,
 * `internal/backup-healthchecks-transport-core.mjs`, which builds a request
 * path from it and drops its reference once `https.request()` has been called.
 *
 * THERE IS DELIBERATELY NO PUBLIC WRAPPER FOR THIS MODULE. Every other core in
 * `ops/backup/lib/internal/` has a thin `lib/<name>.mjs` in front of it; this
 * one does not, and `backup-healthchecks-transport.mjs` re-exports nothing from
 * here. A production module that wants the key has to reach into `internal/`
 * by name, which a static import-graph test in
 * `backup-monitor-export.test.mjs` refuses.
 *
 * `internal/` IS A CONVENTION, NOT ACCESS CONTROL. Any file in this repository
 * can import this path; the directory name prevents nothing. What is actually
 * guaranteed is narrower and worth stating plainly:
 *
 *   1. no supported public wrapper re-exports this reader;
 *   2. a static test proves that, among production modules, only the transport
 *      core imports it;
 *   3. tests import it directly on purpose — that is what the seam is for;
 *   4. malicious or later-modified local repository code is out of scope; and
 *   5. the load-bearing evidence is the RUNTIME unique-marker leak tests, not
 *      the directory name.
 *
 * WHAT IS CHECKED, AND WHY EACH CHECK IS THERE
 * ---------------------------------------------
 * The file must be a regular file, not a symlink, owned by the effective uid,
 * mode EXACTLY `0600`, between 1 and `PING_KEY_MAX_BYTES` bytes, strict UTF-8,
 * ASCII-only, NUL-free, at most one trailing newline, and shaped like
 * `PING_KEY_PATTERN`. Every one of those is re-checked on the DESCRIPTOR after
 * the open, and the descriptor's `dev`/`ino`/`uid`/`mode`/`size` must equal
 * what `lstat` reported, so a path swapped between the two calls is refused
 * rather than read.
 *
 * MODE IS EXACTLY `0600` — ONE COMPARISON, NO MASK
 * -------------------------------------------------
 * `(mode & 0o7777) === 0o600`. That single comparison rejects every group and
 * world bit, the owner execute bit, AND the setuid/setgid/sticky bits. No
 * weaker mask appears anywhere in this module or in the operator documentation:
 * the documented requirement and the enforced requirement are the same
 * sentence.
 *
 * OPEN FLAGS, AND AN HONEST STATEMENT ABOUT CLOSE-ON-EXEC
 * --------------------------------------------------------
 * `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`.
 *
 *   - `O_NOFOLLOW` makes the kernel refuse a symlink at the final component
 *     (`ELOOP`), closing the window between `lstat` and `open`.
 *   - `O_NONBLOCK` means that if the path was swapped for a FIFO or a device
 *     between `lstat` and `open`, the open cannot block the process; the
 *     `fstat` regular-file check then rejects it. On a regular file it does not
 *     change read semantics, and an `EAGAIN` from any read is treated as a read
 *     failure, never as end-of-file.
 *   - `O_CLOEXEC` is NOT specified, and no numeric constant is manufactured in
 *     its place: on this repository's runtime (Node v22.22.2, verified)
 *     `fs.constants.O_CLOEXEC` is `undefined`, so putting it in the flag
 *     expression would produce `NaN` rather than a flag. The accurate
 *     statement is therefore: **close-on-exec for this descriptor is supplied
 *     by Node/libuv's own fs implementation; this module neither controls it
 *     explicitly nor proves it independently.** That is acceptable here
 *     because this reader spawns no subprocess and closes the descriptor within
 *     the same invocation. It is deliberately not turned into a native
 *     dependency or a subprocess test (plan unknown 3).
 *
 * WHAT NEVER LEAVES THIS MODULE
 * ------------------------------
 * A failure returns one closed code from `PING_KEY_FAILURE_CODES` and nothing
 * else: no path, no file content, no native error, no `errno`, no message. The
 * key itself is read fresh per invocation, never cached, never assigned to a
 * module-level binding, never placed in `process.env` or `argv`, and never
 * interpolated into any diagnostic.
 */

import fs from 'node:fs'

import { assertCanonicalAbsolutePath } from '../backup-cloud-config.mjs'

/**
 * A hard ceiling on the key file, well above any plausible key. It bounds the
 * read before the read happens, so an operator who points this at a large file
 * gets a refusal rather than a 1 GiB allocation.
 */
export const PING_KEY_MAX_BYTES = 256

/**
 * A CONSERVATIVE URL-PATH-SAFE SHAPE BOUND, not a claim about the provider's
 * key grammar (plan unknown 2). A real key outside this shape fails closed
 * here, at read time, before any request is constructed — which is the safe
 * direction to be wrong in.
 */
export const PING_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

/** Exactly `0600`, including the setuid/setgid/sticky bits. */
const REQUIRED_MODE = 0o600n
const MODE_MASK = 0o7777n

/**
 * The ONLY accepted character range: printable ASCII plus the newline.
 *
 * `TextDecoder` accepts a NUL byte and every valid non-ASCII sequence, so
 * neither is covered by decoding alone. A control character other than `\n` —
 * a `\r`, a tab, a vertical tab — is refused here as an ENCODING failure
 * rather than surviving into the shape check, because "these bytes are not text
 * of the accepted kind" is the more accurate statement about them. Whitespace
 * that IS printable (a space) passes here and is refused by the shape check.
 */
const ASCII_ONLY = /^[\x20-\x7e\n]*$/

/**
 * The closed failure vocabulary. A caller may branch on these; it may never
 * see anything else, and none of them carries a location or a value.
 */
export const PING_KEY_FAILURE_CODES = Object.freeze([
  'key_file_unreadable',
  'key_file_not_regular',
  'key_file_symlink',
  'key_file_owner',
  'key_file_mode',
  'key_file_size',
  'key_file_identity_changed',
  'key_file_encoding',
  'key_file_shape',
])

const REQUIRED_DEPS = Object.freeze(['lstat', 'open', 'fstat', 'read', 'close', 'geteuid'])

const READ_NO_FOLLOW = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK

/**
 * The REAL dependency set. Read-only: no write, truncate, create, unlink,
 * rename, directory or process capability is reachable from here.
 *
 * `open` fails closed if this platform cannot refuse a symlink at open time —
 * a reader that silently follows symlinks to a bearer credential is worse than
 * no reader.
 */
export const REAL_PING_KEY_DEPS = Object.freeze({
  lstat: (p) => fs.lstatSync(p, { bigint: true }),
  open: (p) => {
    if (typeof fs.constants.O_NOFOLLOW !== 'number') {
      const err = new Error('no O_NOFOLLOW on this platform')
      err.code = 'ENOTSUP'
      throw err
    }
    return fs.openSync(p, READ_NO_FOLLOW)
  },
  fstat: (fd) => fs.fstatSync(fd, { bigint: true }),
  read: (fd, buffer) => fs.readSync(fd, buffer, 0, buffer.length, null),
  close: (fd) => fs.closeSync(fd),
  geteuid: () => process.geteuid(),
})

const failed = (code) => Object.freeze({ state: 'failed', code })

/**
 * Build the reader.
 *
 * @param {typeof REAL_PING_KEY_DEPS} deps
 * @returns {Readonly<{readPingKey: (path: string) =>
 *   Readonly<{state: 'ok', key: string} | {state: 'failed', code: string}>}>}
 */
export function makePingKeyReader(deps) {
  if (deps === null || typeof deps !== 'object') {
    throw new TypeError('invalid ping-key reader dependencies')
  }
  for (const name of REQUIRED_DEPS) {
    if (typeof deps[name] !== 'function') {
      throw new TypeError('invalid ping-key reader dependencies')
    }
  }

  /**
   * Read the ping key at `path`. Read FRESH on every call; nothing is cached.
   *
   * @param {string} path an absolute, lexically canonical path
   */
  function readPingKey(path) {
    if (typeof path !== 'string' || path === '' || !path.startsWith('/')) {
      return failed('key_file_unreadable')
    }
    try {
      assertCanonicalAbsolutePath(path, 'pingKeyFile')
    } catch {
      // The ConfigError's message echoes the path; it is discarded here, and a
      // closed code is returned in its place.
      return failed('key_file_unreadable')
    }

    let euid
    try {
      euid = BigInt(deps.geteuid())
    } catch {
      return failed('key_file_unreadable')
    }

    let lst
    try {
      lst = deps.lstat(path)
    } catch {
      return failed('key_file_unreadable')
    }

    // ── Pre-open checks, on the PATH. Each one is re-made on the descriptor.
    try {
      if (lst.isSymbolicLink() === true) return failed('key_file_symlink')
      if (lst.isFile() !== true) return failed('key_file_not_regular')
      if (typeof lst.uid !== 'bigint' || lst.uid !== euid) return failed('key_file_owner')
      if (typeof lst.mode !== 'bigint' || (lst.mode & MODE_MASK) !== REQUIRED_MODE) {
        return failed('key_file_mode')
      }
      if (typeof lst.size !== 'bigint' || lst.size < 1n || lst.size > BigInt(PING_KEY_MAX_BYTES)) {
        return failed('key_file_size')
      }
      if (typeof lst.dev !== 'bigint' || typeof lst.ino !== 'bigint') {
        return failed('key_file_unreadable')
      }
    } catch {
      return failed('key_file_unreadable')
    }

    const size = Number(lst.size)
    let fd
    let code = null
    let text = null
    try {
      fd = deps.open(path)
      const fst = deps.fstat(fd)

      // ── The same checks again, on the descriptor actually held.
      if (fst.isFile() !== true) {
        code = 'key_file_not_regular'
      } else if (typeof fst.uid !== 'bigint' || fst.uid !== euid) {
        code = 'key_file_owner'
      } else if (typeof fst.mode !== 'bigint' || (fst.mode & MODE_MASK) !== REQUIRED_MODE) {
        code = 'key_file_mode'
      } else if (
        typeof fst.size !== 'bigint' ||
        fst.size < 1n ||
        fst.size > BigInt(PING_KEY_MAX_BYTES)
      ) {
        code = 'key_file_size'
      } else if (
        typeof fst.dev !== 'bigint' ||
        typeof fst.ino !== 'bigint' ||
        fst.dev !== lst.dev ||
        fst.ino !== lst.ino ||
        fst.uid !== lst.uid ||
        fst.mode !== lst.mode ||
        fst.size !== lst.size
      ) {
        // The path named a different object, or the same object changed, between
        // `lstat` and `open`. Either way the bytes below would not be the bytes
        // that were vetted.
        code = 'key_file_identity_changed'
      } else {
        // Read `size + 1` bytes: more than `size` arriving means the file grew
        // under the descriptor, which is a refusal, not a truncation.
        const buf = Buffer.alloc(size + 1)
        let total = 0
        for (;;) {
          const n = deps.read(fd, buf.subarray(total))
          if (!Number.isSafeInteger(n) || n < 0) {
            code = 'key_file_unreadable'
            break
          }
          if (n === 0) break
          total += n
          if (total > size) {
            code = 'key_file_size'
            break
          }
        }
        if (code === null) {
          if (total !== size) {
            code = 'key_file_size'
          } else {
            try {
              text = new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, total))
            } catch {
              code = 'key_file_encoding'
            }
          }
        }
      }
    } catch {
      // An `EAGAIN`, an `ELOOP` from `O_NOFOLLOW`, a permission failure, or any
      // other native error. The native error is never inspected or surfaced.
      if (code === null) code = 'key_file_unreadable'
    } finally {
      if (fd !== undefined) {
        try {
          deps.close(fd)
        } catch {
          // A close failure is a failure of the read (the E3J7 manifest rule):
          // a descriptor that would not close is not evidence of anything.
          code = 'key_file_unreadable'
        }
      }
    }

    if (code !== null) return failed(code)
    if (typeof text !== 'string') return failed('key_file_unreadable')

    // ── Encoding: printable ASCII plus at most a newline (see `ASCII_ONLY`).
    if (!ASCII_ONLY.test(text)) return failed('key_file_encoding')

    // ── Newline: at most ONE trailing `\n` is stripped. Everything else — a
    //    `\r`, a second newline, leading or interior whitespace, any other
    //    trailing whitespace — survives into the shape check and fails it.
    const key = text.endsWith('\n') ? text.slice(0, -1) : text
    if (!PING_KEY_PATTERN.test(key)) return failed('key_file_shape')

    return Object.freeze({ state: 'ok', key })
  }

  return Object.freeze({ readPingKey })
}
