/**
 * pnpm --filter @eanhl/worker decoder-runs <subcommand> [args...]
 *
 * DB-atomic operations on `ocr_decoder_runs`. The Python
 * `video_ingest reprocess` orchestrator (Tasks 8/9) shells out to this
 * CLI for run lifecycle ops because Drizzle is the schema source of
 * truth — TypeScript owns the transaction boundaries.
 *
 * Subcommands:
 *   create-candidate  --match-id N --decoder-version V --weights-hash WH \
 *                     --config-hash CH [--video-sha256 SHA]
 *     Inserts a new `ocr_decoder_runs` row with is_active=false.
 *     Prints `{"run_id": N, "is_active": false}` on stdout (JSON, one line)
 *     so the Python orchestrator can capture the new run id with a simple
 *     `JSON.parse`.
 *
 *   validate          --run-id N [--min-loadout K] [--min-lobby K]
 *     Runs `validateCandidateRun(N)` and prints its full result as JSON
 *     on stdout. Exit 0 when ok=true; exit 2 when ok=false (fail-soft
 *     so callers can decide to abort or continue).
 *
 *   activate          --run-id N [--dry-run]
 *     Atomic flip from any existing active run for the same match to the
 *     target run, then rebuild canonical snapshot tables from the now-
 *     active run's evidence. All three steps (deactivate prior, activate
 *     target, rebuildCanonicalsFromActiveRun) run inside a single Drizzle
 *     transaction. `applyMatchColors` runs after the tx commits because
 *     it's idempotent and opens its own transaction. With --dry-run, no
 *     rows are written — the CLI just prints the would-be flip as JSON.
 *
 *   undo              --match-id N [--dry-run]
 *     Reverts a prior activation. Finds the most recent inactive run for
 *     the match (MAX(completed_at) WHERE is_active=false AND completed_at
 *     IS NOT NULL) and delegates to `activate` so the same atomic flip +
 *     canonical rebuild applies. Exits non-zero when no prior inactive
 *     run exists. With --dry-run, the underlying activate dry-run output
 *     is printed.
 *
 * Exit codes:
 *   0 — success
 *   1 — argument validation error, unknown subcommand, or DB error
 *   2 — `validate` returned ok=false (fail-soft)
 */
import {
  db,
  sql as sqlTag,
  ocrDecoderRuns,
} from '@eanhl/db'
import { and, desc, eq, sql } from 'drizzle-orm'

import { rebuildCanonicalsFromActiveRun } from './lib/rebuild-canonicals-from-active-run.js'
import { validateCandidateRun } from './lib/validate-candidate-run.js'
import { applyMatchColors } from './lib/match-color-aggregator.js'

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

async function createCandidate(argv: string[]): Promise<void> {
  const matchIdRaw = getFlag(argv, 'match-id')
  if (!matchIdRaw) {
    throw new Error('create-candidate requires --match-id <positive integer>')
  }
  const matchId = Number(matchIdRaw)
  if (!Number.isFinite(matchId) || !Number.isInteger(matchId) || matchId <= 0) {
    throw new Error(
      `create-candidate requires --match-id <positive integer>; got: ${matchIdRaw}`,
    )
  }

  const decoderVersion = getFlag(argv, 'decoder-version')
  const weightsHash = getFlag(argv, 'weights-hash')
  const configHash = getFlag(argv, 'config-hash')
  const videoSha256 = getFlag(argv, 'video-sha256') ?? null

  if (!decoderVersion) {
    throw new Error('create-candidate requires --decoder-version <string>')
  }
  if (!weightsHash) {
    throw new Error('create-candidate requires --weights-hash <string>')
  }
  if (!configHash) {
    throw new Error('create-candidate requires --config-hash <string>')
  }

  const [row] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256,
      decoderVersion,
      weightsHash,
      configHash,
      isActive: false,
    })
    .returning({ id: ocrDecoderRuns.id, isActive: ocrDecoderRuns.isActive })

  if (!row) {
    throw new Error('create-candidate: insert returned no row')
  }

  process.stdout.write(
    JSON.stringify({ run_id: row.id, is_active: row.isActive }) + '\n',
  )
}

/**
 * Parse a numeric --flag. Returns `undefined` if absent. Throws when the
 * value is present but not a finite non-negative integer (rejecting
 * `'abc'`, `'-3'`, `'4.5'`, etc.).
 */
function parseOptionalNonNegativeInt(
  argv: string[],
  name: string,
): number | undefined {
  const raw = getFlag(argv, name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(
      `--${name} must be a non-negative integer; got: ${raw}`,
    )
  }
  return n
}

async function validate(argv: string[]): Promise<void> {
  const runIdRaw = getFlag(argv, 'run-id')
  if (!runIdRaw) {
    throw new Error('validate requires --run-id <positive integer>')
  }
  const runId = Number(runIdRaw)
  if (!Number.isFinite(runId) || !Number.isInteger(runId) || runId <= 0) {
    throw new Error(
      `validate requires --run-id <positive integer>; got: ${runIdRaw}`,
    )
  }

  const minLoadout = parseOptionalNonNegativeInt(argv, 'min-loadout')
  const minLobby = parseOptionalNonNegativeInt(argv, 'min-lobby')

  const result = await validateCandidateRun(runId, {
    ...(minLoadout !== undefined ? { minLoadoutSnapshots: minLoadout } : {}),
    ...(minLobby !== undefined ? { minLobbySnapshots: minLobby } : {}),
  })

  process.stdout.write(JSON.stringify(result) + '\n')

  // Fail-soft: ok=false → exit 2. Caller (Python orchestrator) decides
  // whether to abort the reprocess. The success exit (0) propagates
  // through the main() Promise chain.
  if (!result.ok) {
    // Flush + ensure DB pool is closed before exiting so the JSON line
    // lands on stdout. main()'s finally() runs sqlTag.end() — duplicate
    // it here because we bypass main()'s normal `.then(() => exit(0))`.
    await sqlTag.end()
    process.exit(2)
  }
}

async function activate(argv: string[]): Promise<void> {
  const runIdRaw = getFlag(argv, 'run-id')
  if (!runIdRaw) {
    throw new Error('activate requires --run-id <positive integer>')
  }
  const runId = Number(runIdRaw)
  if (!Number.isFinite(runId) || !Number.isInteger(runId) || runId <= 0) {
    throw new Error(
      `activate requires --run-id <positive integer>; got: ${runIdRaw}`,
    )
  }
  const dryRun = argv.includes('--dry-run')

  // Look up the target run. Must exist + not already be active.
  const [target] = await db
    .select()
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
  if (!target) {
    throw new Error(`activate: run ${runId} not found`)
  }
  if (target.isActive) {
    throw new Error(`activate: run ${runId} is already active`)
  }
  const matchId = target.matchId

  if (dryRun) {
    const [prior] = await db
      .select({ id: ocrDecoderRuns.id })
      .from(ocrDecoderRuns)
      .where(
        and(
          eq(ocrDecoderRuns.matchId, matchId),
          eq(ocrDecoderRuns.isActive, true),
        ),
      )
      .limit(1)
    process.stdout.write(
      JSON.stringify({
        would_deactivate_run_id: prior?.id ?? null,
        would_activate_run_id: runId,
        would_rebuild_canonicals_for_match: matchId,
        dry_run: true,
      }) + '\n',
    )
    return
  }

  // Atomic flip + rebuild in one outer transaction.
  // 1. Deactivate any current active run for the match.
  // 2. Activate the target run + stamp completed_at.
  // 3. Rebuild canonicals from the now-active run.
  // rebuildCanonicalsFromActiveRun accepts a `db: DbOrTx`, so it joins
  // the outer transaction.
  let loadoutSnapshotsWritten = 0
  let lobbySnapshotsWritten = 0
  await db.transaction(async (tx) => {
    await tx
      .update(ocrDecoderRuns)
      .set({ isActive: false })
      .where(
        and(
          eq(ocrDecoderRuns.matchId, matchId),
          eq(ocrDecoderRuns.isActive, true),
        ),
      )
    await tx
      .update(ocrDecoderRuns)
      .set({ isActive: true, completedAt: new Date() })
      .where(eq(ocrDecoderRuns.id, runId))
    const rebuildResult = await rebuildCanonicalsFromActiveRun(matchId, {
      db: tx,
    })
    loadoutSnapshotsWritten = rebuildResult.loadoutSnapshotsWritten
    lobbySnapshotsWritten = rebuildResult.lobbySnapshotsWritten
  })

  // applyMatchColors is idempotent + opens its own transaction internally;
  // safe to run outside the activation tx. If it throws, the flip already
  // committed — operator can re-run colour aggregation later without
  // re-triggering the flip.
  await applyMatchColors(matchId)

  process.stdout.write(
    JSON.stringify({
      activated_run_id: runId,
      match_id: matchId,
      loadout_snapshots_written: loadoutSnapshotsWritten,
      lobby_snapshots_written: lobbySnapshotsWritten,
    }) + '\n',
  )
}

async function undo(argv: string[]): Promise<void> {
  const matchIdRaw = getFlag(argv, 'match-id')
  if (!matchIdRaw) {
    throw new Error('undo requires --match-id <positive integer>')
  }
  const matchId = Number(matchIdRaw)
  if (!Number.isFinite(matchId) || !Number.isInteger(matchId) || matchId <= 0) {
    throw new Error(
      `undo requires --match-id <positive integer>; got: ${matchIdRaw}`,
    )
  }
  const dryRun = argv.includes('--dry-run')

  // Find the prior inactive run for the match (latest completed_at).
  // We only consider inactive runs with a completed_at stamp — runs that
  // never finished (completed_at IS NULL) aren't valid revert targets.
  const prior = await db
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(
      and(
        eq(ocrDecoderRuns.matchId, matchId),
        eq(ocrDecoderRuns.isActive, false),
        sql`${ocrDecoderRuns.completedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(ocrDecoderRuns.completedAt))
    .limit(1)
  if (prior.length === 0) {
    throw new Error(`undo: no prior inactive run found for match ${matchId}`)
  }
  // Delegate to activate. Same atomic flip + canonical rebuild applies.
  await activate([
    '--run-id',
    String(prior[0]!.id),
    ...(dryRun ? ['--dry-run'] : []),
  ])
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2)
  switch (subcommand) {
    case 'create-candidate':
      await createCandidate(rest)
      break
    case 'validate':
      await validate(rest)
      break
    case 'activate':
      await activate(rest)
      break
    case 'undo':
      await undo(rest)
      break
    default:
      throw new Error(
        `unknown subcommand: ${subcommand ?? '(none)'}; expected create-candidate | validate | activate | undo`,
      )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg =
      err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    console.error(msg)
    process.exit(1)
  })
  .finally(() => {
    void sqlTag.end()
  })
