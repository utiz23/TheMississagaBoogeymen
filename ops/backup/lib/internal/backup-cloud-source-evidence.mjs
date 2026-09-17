/**
 * Read-only, no-follow descriptor primitives for source evidence (E3J6A).
 *
 * WHAT THIS FILE IS
 * ------------------
 * The four filesystem calls `internal/backup-cloud-upload-core.mjs` needs to
 * hash the three published source files through a descriptor it holds,
 * instead of by path. Nothing else. Kept in its own file so the upload core
 * itself still contains no `open` call of any kind (its static T19 test), and
 * so the one `open` that does exist is visibly read-only:
 *
 *   `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`
 *
 *   - `O_NOFOLLOW` makes opening a symlink fail in the kernel (`ELOOP`);
 *   - `O_NONBLOCK` keeps a path swapped for a FIFO from hanging the open, and
 *     the caller then refuses anything `fstat` does not call a regular file;
 *   - Node opens every descriptor close-on-exec already (`fs.constants` has
 *     no `O_CLOEXEC` to add), so no child process inherits it.
 *
 * No write, truncate, unlink, rename, directory, or process capability is
 * reachable from here. Only an error's `code` is ever consulted by callers.
 *
 * WHAT DESCRIPTOR EVIDENCE DOES NOT PROVE
 * -----------------------------------------
 * The bytes hashed are the bytes of the inode this descriptor held, bracketed
 * by identity checks. The Proton CLI later opens the same file BY PATH, so
 * this does not close the upload TOCTOU window; it makes a later readback
 * comparable against pre-upload bytes rather than against whatever the path
 * names afterwards.
 */

import fs from 'node:fs'

const C = fs.constants
const READ_NO_FOLLOW = C.O_RDONLY | C.O_NOFOLLOW | (C.O_NONBLOCK ?? 0)

export const REAL_EVIDENCE_READER = Object.freeze({
  /** Fails closed if this platform cannot refuse a symlink at open time. */
  open: (p) => {
    if (typeof C.O_NOFOLLOW !== 'number') {
      const err = new Error('no O_NOFOLLOW on this platform')
      err.code = 'ENOTSUP'
      throw err
    }
    return fs.openSync(p, READ_NO_FOLLOW)
  },
  fstat: (fd) => fs.fstatSync(fd, { bigint: true }),
  read: (fd, buffer) => fs.readSync(fd, buffer, 0, buffer.length, null),
  close: (fd) => fs.closeSync(fd),
})
