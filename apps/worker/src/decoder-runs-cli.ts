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
 *   activate          --run-id N [--dry-run] [--force --reason "<text>"]
 *     Atomic flip from any existing active run for the same match to the
 *     target run, rebuild canonical snapshot tables, run cross-frame
 *     consolidation, then evaluate the quality gate — all inside ONE Drizzle
 *     transaction. Sequence:
 *       1. (outside tx) cheap structural pre-check via validateCandidateRun.
 *       2. (in tx) deactivate prior, activate target, rebuildCanonicals,
 *          consolidateLoadouts (sets review_status='reviewed' on anchors),
 *          then computeLayers → overall_pass on the consolidated state.
 *       3. Fail CLOSED: unless overall_pass === true (any compute error,
 *          not-computed, or false → fail), THROW to roll the whole tx back,
 *          leaving the prior active run + its canonicals intact, and exit 2.
 *     consolidate runs INSIDE the tx (Tier 0 WS0.1A) because L2.5/L3 filter on
 *     review_status='reviewed', which would otherwise not exist yet at gate
 *     time and fail every activation. `applyMatchColors` + the run-quality
 *     report emit run after the tx commits. With --dry-run, no rows are
 *     written and the gate is not evaluated. `--force --reason "<text>"`
 *     bypasses BOTH the pre-check and the gate, commits anyway, and persists
 *     `{overridden, reason, at}` into the run-quality report jsonb for audit.
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
 *   2 — `validate` returned ok=false (fail-soft), OR `activate` was blocked by
 *       the structural pre-check / quality gate and rolled back (no --force)
 */
import { db, sql as sqlTag, ocrDecoderRuns } from '@eanhl/db'
import { getMatchById } from '@eanhl/db/queries'
import { and, desc, eq, sql } from 'drizzle-orm'

import { rebuildCanonicalsFromActiveRun } from './lib/rebuild-canonicals-from-active-run.js'
import { validateCandidateRun } from './lib/validate-candidate-run.js'
import { applyMatchColors } from './lib/match-color-aggregator.js'
import { consolidateLoadouts } from './lib/consolidate-loadouts.js'
import { buildDownstreamCounts, buildQualityFlags } from './lib/quality-inputs.js'
import { computeLayers, type LayerScores } from './lib/quality-layers.js'
import { buildReportBody, emitRow, loadRunRow } from './lib/run-quality-report.js'
import type { DbOrTx } from './ocr-promoters/index.js'

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
    throw new Error(`create-candidate requires --match-id <positive integer>; got: ${matchIdRaw}`)
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

  process.stdout.write(JSON.stringify({ run_id: row.id, is_active: row.isActive }) + '\n')
}

/**
 * Parse a numeric --flag. Returns `undefined` if absent. Throws when the
 * value is present but not a finite non-negative integer (rejecting
 * `'abc'`, `'-3'`, `'4.5'`, etc.).
 */
function parseOptionalNonNegativeInt(argv: string[], name: string): number | undefined {
  const raw = getFlag(argv, name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`--${name} must be a non-negative integer; got: ${raw}`)
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
    throw new Error(`validate requires --run-id <positive integer>; got: ${runIdRaw}`)
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

/** Thrown inside the activation tx to roll the whole flip+rebuild+consolidate
 *  back when the quality gate fails (and --force was not passed). */
class QualityGateFailure extends Error {
  constructor(public readonly detail: string) {
    super(`quality gate failed: ${detail}`)
    this.name = 'QualityGateFailure'
  }
}

interface GateResult {
  pass: boolean
  layers: LayerScores | null
  detail: string
}

/**
 * Evaluate the quality gate on the in-tx, post-consolidation canonical state.
 *
 * FAIL CLOSED: the gate passes ONLY when `computeLayers().overall.pass === true`.
 * Any thrown error (missing match row, query failure, etc.) is caught and
 * reported as a failure with `pass: false` — a scoring failure must never let
 * a run activate. `getMatchById` reads the EA-sourced `matches` row, which the
 * activation tx does not modify, so it stays on the module connection; the
 * three score builders read canonical tables the tx rebuilt + consolidated, so
 * they receive `tx`.
 */
async function computeQualityGate(matchId: number, tx: DbOrTx): Promise<GateResult> {
  try {
    const match = await getMatchById(matchId)
    if (!match) {
      return { pass: false, layers: null, detail: `match ${matchId} row not found` }
    }
    const downstream = await buildDownstreamCounts(matchId, match, tx)
    const flags = await buildQualityFlags(matchId, match, tx)
    const layers = await computeLayers(matchId, downstream, flags, tx)
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
    const flag = (p: boolean): string => (p ? 'pass' : 'FAIL')
    const detail =
      `L2=${pct(layers.l2.score)} (${flag(layers.l2.pass)}) ` +
      `L2.5=${pct(layers.l2_lineup.score)} (${flag(layers.l2_lineup.pass)}) ` +
      `L3=${pct(layers.l3.score)} (${flag(layers.l3.pass)})`
    return { pass: layers.overall.pass === true, layers, detail }
  } catch (e) {
    return {
      pass: false,
      layers: null,
      detail: `compute error: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

/**
 * Emit the run-quality report row for the just-activated run on the COMMITTED
 * canonical state (force-overwrite). Because it runs the same `buildReportBody`
 * → `computeLayers` over the same committed data the gate scored, the persisted
 * `overall_pass` matches the gate decision. Best-effort: a report-emit failure
 * never undoes the (already-committed) activation. When `override` is set the
 * audit block is injected into the report jsonb.
 */
async function emitActivateReport(runId: number, override?: { reason: string }): Promise<void> {
  try {
    const runRow = await loadRunRow(runId)
    if (!runRow) {
      process.stderr.write(`activate: report emit skipped — run ${runId} not found after commit\n`)
      return
    }
    const body = await buildReportBody(runRow, { runtime: null })
    if (override) {
      body.override = { overridden: true, reason: override.reason, at: new Date().toISOString() }
    }
    const { written, reportId } = await emitRow(runId, body, true)
    process.stderr.write(
      `activate: run-quality report ${written ? `written (id=${reportId ?? 'n/a'})` : 'not written'} for run ${runId}\n`,
    )
  } catch (e) {
    process.stderr.write(
      `activate: run-quality report emit failed (non-fatal): ${e instanceof Error ? e.message : String(e)}\n`,
    )
  }
}

async function activate(argv: string[]): Promise<void> {
  const runIdRaw = getFlag(argv, 'run-id')
  if (!runIdRaw) {
    throw new Error('activate requires --run-id <positive integer>')
  }
  const runId = Number(runIdRaw)
  if (!Number.isFinite(runId) || !Number.isInteger(runId) || runId <= 0) {
    throw new Error(`activate requires --run-id <positive integer>; got: ${runIdRaw}`)
  }
  const dryRun = argv.includes('--dry-run')
  const force = argv.includes('--force')
  const reason = getFlag(argv, 'reason')
  if (force && (!reason || reason.trim().length === 0)) {
    throw new Error(
      'activate --force requires --reason "<text>" (the override is persisted for audit)',
    )
  }

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
      .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
      .limit(1)
    process.stdout.write(
      JSON.stringify({
        would_deactivate_run_id: prior?.id ?? null,
        would_activate_run_id: runId,
        would_rebuild_canonicals_for_match: matchId,
        would_consolidate_loadouts_for_match: matchId,
        gate_evaluated: false,
        dry_run: true,
      }) + '\n',
    )
    return
  }

  // 1. Cheap structural pre-check OUTSIDE the tx — catches empty/error runs
  //    before touching canonicals. Run-scoped (promotions / extractor errors),
  //    so it reads already-committed ingest state.
  const validation = await validateCandidateRun(runId)
  if (!validation.ok) {
    if (!force) {
      process.stderr.write(`activate: structural pre-check FAILED for run ${runId}:\n`)
      for (const r of validation.details.failureReasons) process.stderr.write(`  - ${r}\n`)
      process.stderr.write(`  (re-run with --force --reason "<text>" to override)\n`)
      process.stdout.write(
        JSON.stringify({
          activated: false,
          gate: 'validate',
          run_id: runId,
          match_id: matchId,
          failure_reasons: validation.details.failureReasons,
        }) + '\n',
      )
      await sqlTag.end()
      process.exit(2)
    }
    process.stderr.write(
      `activate: --force bypassing FAILED structural pre-check (${validation.details.failureReasons.join('; ')})\n`,
    )
  }

  // 2. Atomic flip + rebuild + consolidate + quality gate in ONE transaction.
  //    rebuildCanonicalsFromActiveRun + consolidateLoadouts both accept a
  //    `db: DbOrTx`, so they join the outer tx (consolidate's per-anchor
  //    transactions become savepoints). The gate scores the resulting
  //    consolidated, reviewed-anchor state. A QualityGateFailure throw rolls
  //    the entire tx back, restoring the prior active run + its canonicals.
  let loadoutSnapshotsWritten = 0
  let lobbySnapshotsWritten = 0
  let gate: GateResult = { pass: false, layers: null, detail: 'not evaluated' }
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(ocrDecoderRuns)
        .set({ isActive: false })
        .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
      await tx
        .update(ocrDecoderRuns)
        .set({ isActive: true, completedAt: new Date() })
        .where(eq(ocrDecoderRuns.id, runId))
      const rebuildResult = await rebuildCanonicalsFromActiveRun(matchId, { db: tx })
      loadoutSnapshotsWritten = rebuildResult.loadoutSnapshotsWritten
      lobbySnapshotsWritten = rebuildResult.lobbySnapshotsWritten
      // Consolidate INSIDE the tx so the gate sees reviewed anchors (L2.5/L3
      // filter on review_status='reviewed'). Logs go to stderr so activate's
      // stdout stays a single machine-readable JSON line.
      await consolidateLoadouts(matchId, {
        db: tx,
        log: (m) => process.stderr.write(m + '\n'),
      })
      gate = await computeQualityGate(matchId, tx)
      if (!gate.pass && !force) {
        throw new QualityGateFailure(gate.detail)
      }
    })
  } catch (e) {
    if (e instanceof QualityGateFailure) {
      // tx rolled back: prior active run + its canonicals are intact.
      process.stderr.write(
        `activate: QUALITY GATE FAILED for run ${runId} (match ${matchId}); activation rolled back.\n`,
      )
      process.stderr.write(`  ${e.detail}\n`)
      process.stderr.write(
        `  (re-run with --force --reason "<text>" to override + persist audit)\n`,
      )
      process.stdout.write(
        JSON.stringify({
          activated: false,
          gate: 'quality',
          run_id: runId,
          match_id: matchId,
          overall_pass: false,
          detail: e.detail,
        }) + '\n',
      )
      await sqlTag.end()
      process.exit(2)
    }
    throw e
  }

  // Committed (gate passed, or --force). applyMatchColors is idempotent + opens
  // its own tx; safe post-commit.
  await applyMatchColors(matchId)

  const overrideForced = force && !gate.pass
  if (overrideForced) {
    process.stderr.write(
      `activate: --force OVERRIDE — run ${runId} activated despite a FAILED quality gate.\n` +
        `  reason: ${reason}\n  ${gate.detail}\n`,
    )
  }

  // Emit the run-quality report row on the committed state (best-effort).
  await emitActivateReport(runId, overrideForced ? { reason: reason! } : undefined)

  process.stdout.write(
    JSON.stringify({
      activated_run_id: runId,
      match_id: matchId,
      loadout_snapshots_written: loadoutSnapshotsWritten,
      lobby_snapshots_written: lobbySnapshotsWritten,
      overall_pass: gate.pass,
      forced_override: overrideForced,
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
    throw new Error(`undo requires --match-id <positive integer>; got: ${matchIdRaw}`)
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
  // Delegate to activate. Same atomic flip + canonical rebuild + consolidate
  // applies. undo is a deliberate recovery operation that restores a
  // previously-active run, so it bypasses the quality gate via --force (the
  // override audit block is only persisted if that prior run actually fails
  // the gate — a clean revert leaves no override marker).
  await activate([
    '--run-id',
    String(prior[0]!.id),
    '--force',
    '--reason',
    'undo: revert to prior active run',
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
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    console.error(msg)
    process.exit(1)
  })
  .finally(() => {
    void sqlTag.end()
  })
