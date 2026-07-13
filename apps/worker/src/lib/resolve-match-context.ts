/**
 * Pure arg→context resolution for `resolve-match propose` (Milestone ② step (2), A1).
 *
 * Decouples `propose` from a single-match `run_id`. There are two modes:
 *   - `run`    — `--run-id N` present: the reprocess / single-match path. The
 *                caller SELECTs the run to derive `video_sha256` / `game_title_id`
 *                (both overridable via the optional flags carried here).
 *   - `direct` — `--run-id` absent: a fresh multi-reel video whose reels map to
 *                *different* matches has no single run to point at, so the reels
 *                are associated directly from `--video-sha256` + `--game-title-id`,
 *                and proposals are inserted with `run_id = null`.
 *
 * Kept in its own side-effect-free module (no DB, no `main()`) so the arg
 * validation is unit-testable without a live decoder-run row — the CLI
 * entrypoint invokes `main()` on import, which a test must not trigger.
 */

export interface ProposeContextRun {
  mode: 'run'
  runId: number
  identitiesPath: string
  /** Optional overrides; the DB run row fills these when absent. */
  videoSha256Override: string | undefined
  gameTitleIdOverride: number | undefined
}
export interface ProposeContextDirect {
  mode: 'direct'
  runId: null
  identitiesPath: string
  videoSha256: string
  gameTitleId: number
}
export type ProposeContext = ProposeContextRun | ProposeContextDirect

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

function parsePositiveInt(raw: string, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer; got: ${raw}`)
  }
  return n
}

/**
 * Parse `propose` argv into a resolved context. Throws on missing/invalid
 * required flags. Does NOT touch the DB — the `run` mode's run lookup is the
 * caller's job (it needs a live connection).
 */
export function resolveProposeContext(argv: string[]): ProposeContext {
  const identitiesPath = getFlag(argv, 'identities')
  if (!identitiesPath) throw new Error('propose requires --identities <path>')

  const videoSha = getFlag(argv, 'video-sha256')
  const gameTitleRaw = getFlag(argv, 'game-title-id')
  const gameTitleId =
    gameTitleRaw === undefined
      ? undefined
      : parsePositiveInt(gameTitleRaw, 'propose --game-title-id')

  const runIdRaw = getFlag(argv, 'run-id')
  if (runIdRaw !== undefined) {
    const runId = parsePositiveInt(runIdRaw, 'propose --run-id')
    return {
      mode: 'run',
      runId,
      identitiesPath,
      videoSha256Override: videoSha,
      gameTitleIdOverride: gameTitleId,
    }
  }

  // No run row to derive context from: associate the reels directly.
  if (!videoSha) {
    throw new Error(
      'propose without --run-id requires --video-sha256 <sha> and --game-title-id <G>',
    )
  }
  if (gameTitleId === undefined) {
    throw new Error(
      'propose without --run-id requires --game-title-id <G> and --video-sha256 <sha>',
    )
  }
  return {
    mode: 'direct',
    runId: null,
    identitiesPath,
    videoSha256: videoSha,
    gameTitleId,
  }
}
