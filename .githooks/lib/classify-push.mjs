/**
 * classify-push.mjs — conservative, change-aware pre-push classifier.
 *
 * Decides whether a push touches ONLY the documentation-only allowlist
 * (root-level *.md, docs/**\/*.md) and can therefore skip the heavy
 * scripts/verify-ocr.sh harness and verification-database credentials, or
 * whether it must go through full verification.
 *
 * Fails closed: anything unparseable, ambiguous, structurally unusual (branch
 * create/delete, non-head ref, non-fast-forward, missing/wrong-type object),
 * or outside the explicit allowlist is classified `full`. Only an exact match
 * against the allowlist for every changed path across every pushed ref
 * classifies `docs-only`.
 *
 * Every git invocation uses execFileSync with an argv array — no ref, oid, or
 * path is ever interpolated into a shell string.
 */

import { execFileSync } from 'node:child_process'

export const ZERO_OID_40 = '0'.repeat(40)
export const ZERO_OID_64 = '0'.repeat(64)

const OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/
const ROOT_MD_RE = /^[^/]+\.md$/
const DOCS_MD_RE = /^docs\/.+\.md$/

export function isAllowedDocPath(p) {
  return ROOT_MD_RE.test(p) || DOCS_MD_RE.test(p)
}

function isZeroOid(oid) {
  return oid === ZERO_OID_40 || oid === ZERO_OID_64
}

function isValidOid(oid) {
  return OID_RE.test(oid)
}

function runGit(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function tryRunGit(repoRoot, args) {
  try {
    return { ok: true, stdout: runGit(repoRoot, args) }
  } catch (err) {
    return { ok: false, error: err }
  }
}

function objectType(repoRoot, oid) {
  const res = tryRunGit(repoRoot, ['cat-file', '-t', oid])
  if (!res.ok) return null
  return res.stdout.trim()
}

function isAncestor(repoRoot, ancestorOid, descendantOid) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestorOid, descendantOid], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch (err) {
    // exit code 1 = not an ancestor; anything else (missing object, etc.) is
    // ambiguous and must not be read as "fast-forward".
    if (err.status === 1) return false
    return false
  }
}

function changedPaths(repoRoot, fromOid, toOid) {
  const res = tryRunGit(repoRoot, [
    'diff',
    '--no-renames',
    '-z',
    '--name-only',
    fromOid,
    toOid,
  ])
  if (!res.ok) return null
  return res.stdout.split('\0').filter((p) => p.length > 0)
}

function diffCheck(repoRoot, fromOid, toOid) {
  try {
    execFileSync('git', ['diff', '--no-renames', '--check', fromOid, toOid], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, output: '' }
  } catch (err) {
    return { ok: false, output: String(err.stdout ?? '') || String(err.message ?? '') }
  }
}

function parseStdin(stdinText) {
  const lines = stdinText.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) {
    return { ok: false, reason: 'empty stdin: no ref updates were provided to the hook' }
  }
  const updates = []
  for (const line of lines) {
    const parts = line.split(' ').filter((p) => p.length > 0)
    if (parts.length !== 4) {
      return {
        ok: false,
        reason: `malformed stdin line (expected 4 fields, got ${parts.length}): ${JSON.stringify(line)}`,
      }
    }
    const [localRef, localOid, remoteRef, remoteOid] = parts
    updates.push({ localRef, localOid, remoteRef, remoteOid })
  }
  return { ok: true, updates }
}

/**
 * Classify a single pushed ref update. Returns either
 *   { ok: true, paths: string[] }
 * or
 *   { ok: false, reason: string }
 */
function classifyUpdate(repoRoot, update) {
  const { localRef, localOid, remoteRef, remoteOid } = update

  if (isZeroOid(localOid)) {
    return { ok: false, reason: `branch deletion pushed (${remoteRef}) — always full` }
  }
  if (isZeroOid(remoteOid)) {
    return { ok: false, reason: `new branch pushed (${localRef}) — always full` }
  }
  if (!isValidOid(localOid) || !isValidOid(remoteOid)) {
    return { ok: false, reason: `malformed object id in ref update for ${localRef}` }
  }
  if (!localRef.startsWith('refs/heads/') || !remoteRef.startsWith('refs/heads/')) {
    return {
      ok: false,
      reason: `non-head ref pushed (local=${localRef}, remote=${remoteRef}) — tags/other refs are always full`,
    }
  }

  const localType = objectType(repoRoot, localOid)
  const remoteType = objectType(repoRoot, remoteOid)
  if (localType !== 'commit' || remoteType !== 'commit') {
    return {
      ok: false,
      reason: `unexpected or missing object type for ${localRef} (local=${localType ?? 'missing'}, remote=${remoteType ?? 'missing'})`,
    }
  }

  if (!isAncestor(repoRoot, remoteOid, localOid)) {
    return {
      ok: false,
      reason: `non-fast-forward update on ${localRef} (remote is not an ancestor of local)`,
    }
  }

  const paths = changedPaths(repoRoot, remoteOid, localOid)
  if (paths === null) {
    return { ok: false, reason: `failed to compute changed paths for ${localRef}` }
  }

  return { ok: true, paths, remoteOid, localOid }
}

/**
 * @param {{stdinText: string, repoRoot: string, env: Record<string, string|undefined>}} args
 * @returns {{mode: 'docs-only'|'full', reason: string, paths: string[], diffCheck?: {ok: boolean, output: string}}}
 */
export function classifyPush({ stdinText, repoRoot, env = {} }) {
  if (env.EANHL_PRE_PUSH_FULL) {
    return { mode: 'full', reason: 'override: EANHL_PRE_PUSH_FULL is set', paths: [] }
  }

  const parsed = parseStdin(stdinText ?? '')
  if (!parsed.ok) {
    return { mode: 'full', reason: parsed.reason, paths: [] }
  }

  const allPaths = new Set()
  const ranges = []
  for (const update of parsed.updates) {
    const result = classifyUpdate(repoRoot, update)
    if (!result.ok) {
      return { mode: 'full', reason: result.reason, paths: [] }
    }
    for (const p of result.paths) allPaths.add(p)
    ranges.push({ from: result.remoteOid, to: result.localOid })
  }

  const paths = [...allPaths].sort()
  const nonDoc = paths.filter((p) => !isAllowedDocPath(p))
  if (nonDoc.length > 0) {
    return {
      mode: 'full',
      reason: `non-doc path(s) outside the allowlist: ${nonDoc.join(', ')}`,
      paths,
    }
  }

  // docs-only candidate: run whitespace/error checks on every committed range.
  let combinedCheck = { ok: true, output: '' }
  for (const range of ranges) {
    const check = diffCheck(repoRoot, range.from, range.to)
    if (!check.ok) {
      combinedCheck = {
        ok: false,
        output: [combinedCheck.output, check.output].filter(Boolean).join('\n'),
      }
    }
  }

  return {
    mode: 'docs-only',
    reason: 'every changed path matched the documentation-only allowlist',
    paths,
    diffCheck: combinedCheck,
  }
}
