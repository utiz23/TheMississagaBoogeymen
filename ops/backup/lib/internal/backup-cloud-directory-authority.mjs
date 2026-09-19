/**
 * Directory-identity primitives shared by the two E3J6B record/readback session
 * cores (`backup-cloud-attestation-records-core.mjs`,
 * `backup-cloud-readback-core.mjs`).
 *
 * WHAT THIS FILE IS, AND WHAT IT IS NOT
 * --------------------------------------
 * Two pure observation functions and a comparison helper. Nothing here
 * constructs a session, a token, or a WeakMap — each of the two consumer
 * cores owns its OWN private session type and its OWN private registry, built
 * on top of these primitives, so a `RecordSession` and a `ReadbackSession`
 * (and a future E3J6C reader's independently-established trust) are never
 * fungible with one another. This module has no state of its own.
 *
 * Both checks are lexical/ownership/mode observations, not proof that the
 * deployed filesystem enforces those semantics — the same caveat every other
 * directory-trust check in this codebase already states (see the containment
 * canary's `observeTrustedDir()`/`observeOwnedDir()`, which this module
 * generalizes into a shared primitive rather than duplicating a third time).
 */

const NO_GROUP_OR_WORLD_BITS = 0o077n
const OWNED_DIR_MODE = 0o700n
const MODE_MASK = 0o7777n

/**
 * Identity of an EXISTING, operator-provisioned directory (e.g.
 * `attestation.dir`, `readback.dir`): not a symlink, owned by the effective
 * uid, no group/world permission bits, and its real path is itself (already
 * canonical — `backup-cloud-config.mjs` requires this lexically at
 * configuration time; this re-confirms it against the live filesystem).
 *
 * @returns {{dev: bigint, ino: bigint, uid: bigint, mode: bigint} | null}
 */
export function observeTrustedDirectoryIdentity(dir, deps) {
  try {
    const st = deps.lstat(dir)
    if (st === null || typeof st !== 'object') return null
    if (st.isSymbolicLink() !== false || st.isDirectory() !== true) return null
    if (typeof st.uid !== 'bigint' || typeof st.mode !== 'bigint') return null
    if (typeof st.dev !== 'bigint' || typeof st.ino !== 'bigint') return null
    const euid = BigInt(deps.geteuid())
    if (st.uid !== euid) return null
    if ((st.mode & NO_GROUP_OR_WORLD_BITS) !== 0n) return null
    if (deps.realpath(dir) !== dir) return null
    return Object.freeze({ dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode & MODE_MASK })
  } catch {
    return null
  }
}

/**
 * Identity of a directory THIS run created itself directly beneath a
 * trusted parent: mode exactly `0700`, owned by the effective uid, and on
 * the same device as the parent it was created under.
 *
 * @param {string} dir
 * @param {bigint} parentDev
 * @returns {{dev: bigint, ino: bigint} | null}
 */
export function observeOwnedDirectoryIdentity(dir, parentDev, deps) {
  try {
    const st = deps.lstat(dir)
    if (st === null || typeof st !== 'object') return null
    if (st.isSymbolicLink() !== false || st.isDirectory() !== true) return null
    if (typeof st.uid !== 'bigint' || typeof st.mode !== 'bigint') return null
    if (typeof st.dev !== 'bigint' || typeof st.ino !== 'bigint') return null
    const euid = BigInt(deps.geteuid())
    if (st.uid !== euid) return null
    if ((st.mode & MODE_MASK) !== OWNED_DIR_MODE) return null
    if (st.dev !== parentDev) return null
    return Object.freeze({ dev: st.dev, ino: st.ino })
  } catch {
    return null
  }
}

/** `true` only when every field present in `expected` matches `observed` exactly. */
export function sameIdentity(observed, expected) {
  if (observed === null || expected === null) return false
  for (const key of Object.keys(expected)) {
    if (observed[key] !== expected[key]) return false
  }
  return true
}
