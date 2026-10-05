/**
 * classify-push.mjs — change-aware pre-push classifier.
 *
 * The heavy scripts/verify-ocr.sh harness (~20 minutes, mostly the video-stats
 * OCR suites and classifier bench) runs only when a push touches video-stats
 * code — see isVideoStatsPath(). Every other push takes the fast path: a
 * committed-range `git diff --check` and nothing else.
 *
 * Still classified `full` (the push could not be read reliably): unparseable
 * or empty stdin, a tag or other non-head ref, a non-fast-forward update, a
 * missing/wrong-type object, or a new branch with no common history with
 * origin/main to compare against.
 *
 * Every git invocation uses execFileSync with an argv array — no ref, oid, or
 * path is ever interpolated into a shell string.
 */

import { execFileSync } from 'node:child_process'

export const ZERO_OID_40 = '0'.repeat(40)
export const ZERO_OID_64 = '0'.repeat(64)

/** A new branch is compared against this remote-tracking ref. */
export const NEW_BRANCH_BASE_REF = 'refs/remotes/origin/main'

const OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/
const VIDEO_STATS_DIRS = ['tools/game_ocr/', 'tools/video_ingest/', 'apps/worker/scripts/']
// "ocr" as a whole path segment: ingest-ocr.ts, ocr-promoters/, verify-ocr.sh,
// docs/ocr/*.txt, research/OCR-SS/ — but not e.g. "procrastinate".
const OCR_SEGMENT_RE = /(^|[/_.\s-])ocr([/_.\s-]|$)/i
const ROOT_MD_RE = /^[^/]+\.md$/
const DOCS_MD_RE = /^docs\/.+\.md$/

/**
 * True when a changed path should trigger the full verification harness:
 * anything under the video-stats tools or the verification-database harness,
 * or any path with an "ocr" segment — except prose notes (root-level *.md and
 * docs/**\/*.md). Markdown elsewhere still counts: research/OCR-SS/*.md is
 * machine input to the match-250 benchmark parity gate.
 */
export function isVideoStatsPath(p) {
  if (VIDEO_STATS_DIRS.some((dir) => p.startsWith(dir))) return true
  if (ROOT_MD_RE.test(p) || DOCS_MD_RE.test(p)) return false
  return OCR_SEGMENT_RE.test(p)
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

function mergeBase(repoRoot, a, b) {
  const res = tryRunGit(repoRoot, ['merge-base', a, b])
  if (!res.ok) return null
  const oid = res.stdout.trim()
  return isValidOid(oid) ? oid : null
}

function changedPaths(repoRoot, fromOid, toOid) {
  const res = tryRunGit(repoRoot, ['diff', '--no-renames', '-z', '--name-only', fromOid, toOid])
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
 *   { ok: true, paths: string[], range: {from, to} | null }   (null for a branch deletion)
 * or
 *   { ok: false, reason: string }                              (full verification)
 */
function classifyUpdate(repoRoot, update) {
  const { localRef, localOid, remoteRef, remoteOid } = update

  if (isZeroOid(localOid)) {
    // Deleting a remote branch pushes no code, so there is nothing to verify.
    if (!remoteRef.startsWith('refs/heads/')) {
      return { ok: false, reason: `non-head ref deletion pushed (${remoteRef}) — always full` }
    }
    return { ok: true, paths: [], range: null }
  }
  const isNewBranch = isZeroOid(remoteOid)
  if (!isValidOid(localOid) || (!isNewBranch && !isValidOid(remoteOid))) {
    return { ok: false, reason: `malformed object id in ref update for ${localRef}` }
  }
  if (!localRef.startsWith('refs/heads/') || !remoteRef.startsWith('refs/heads/')) {
    return {
      ok: false,
      reason: `non-head ref pushed (local=${localRef}, remote=${remoteRef}) — tags/other refs are always full`,
    }
  }

  const localType = objectType(repoRoot, localOid)
  const remoteType = isNewBranch ? 'commit' : objectType(repoRoot, remoteOid)
  if (localType !== 'commit' || remoteType !== 'commit') {
    return {
      ok: false,
      reason: `unexpected or missing object type for ${localRef} (local=${localType ?? 'missing'}, remote=${remoteType ?? 'missing'})`,
    }
  }

  let baseOid = remoteOid
  if (isNewBranch) {
    // A new branch has no remote side; compare it with where it left origin/main.
    baseOid = mergeBase(repoRoot, localOid, NEW_BRANCH_BASE_REF)
    if (baseOid === null) {
      return {
        ok: false,
        reason: `new branch pushed (${localRef}) with no common history with ${NEW_BRANCH_BASE_REF} — always full`,
      }
    }
  } else if (!isAncestor(repoRoot, remoteOid, localOid)) {
    return {
      ok: false,
      reason: `non-fast-forward update on ${localRef} (remote is not an ancestor of local)`,
    }
  }

  const paths = changedPaths(repoRoot, baseOid, localOid)
  if (paths === null) {
    return { ok: false, reason: `failed to compute changed paths for ${localRef}` }
  }

  return { ok: true, paths, range: { from: baseOid, to: localOid } }
}

/**
 * @param {{stdinText: string, repoRoot: string, env: Record<string, string|undefined>}} args
 * @returns {{mode: 'fast'|'full', reason: string, paths: string[], diffCheck?: {ok: boolean, output: string}}}
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
    if (result.range) ranges.push(result.range)
  }

  const paths = [...allPaths].sort()
  const videoStats = paths.filter(isVideoStatsPath)
  if (videoStats.length > 0) {
    return {
      mode: 'full',
      reason: `video-stats path(s) changed: ${videoStats.join(', ')}`,
      paths,
    }
  }

  // Fast path: run whitespace/conflict-marker checks on every committed range.
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
    mode: 'fast',
    reason: 'no video-stats paths changed',
    paths,
    diffCheck: combinedCheck,
  }
}
