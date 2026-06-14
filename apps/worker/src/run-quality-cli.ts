/**
 * pnpm --filter @eanhl/worker run-quality [--run-id N | --match-id M] [--json | --emit-row | --all-runs] [--force] [--stage-runtimes PATH]
 *
 * Phase-3 CLI of the Run-Level Quality Reporting workstream
 * (plan `/home/michal/.claude/plans/ok-plan-this-run-level-nifty-comet.md`).
 *
 * The report-body assembly + upsert core lives in `lib/run-quality-report.ts`
 * (extracted in Tier 0 WS0.1A so the `decoder-runs activate` quality gate shares
 * exactly the same `buildReportBody`). This file owns argv parsing, the
 * stage-runtimes file loader, the stderr human summary, and the three modes.
 *
 * Modes (mutually exclusive top-level intent):
 *
 *   --json (default)
 *     Read-only. Emits the assembled report body for one run as a single JSON
 *     line on stdout. A brief human-readable summary is printed to stderr.
 *
 *   --emit-row
 *     Writes the body via `upsertRunQualityReport`. Without `--force`, a second
 *     emit for the same run_id exits 1 with a "row already exists" message.
 *     Stdout receives `{"run_id": N, "report_id": M, "written": true}` on success.
 *
 *   --all-runs
 *     Backfill mode: iterates every `ocr_decoder_runs.id`. With `--emit-row`,
 *     writes a row per run; without, prints one JSON-line body per run on stdout.
 *     Skips runs that already have a row (unless `--force`).
 *
 * Run selection:
 *   --run-id N         single-run mode (required unless --match-id or --all-runs)
 *   --match-id M       convenience; resolves to the active run via getActiveRunIdForMatch
 *
 * Runtime input:
 *   --stage-runtimes PATH  optional JSON file written by `reprocess.py` (Phase 4)
 *                          carrying per-stage and total wall times. When omitted,
 *                          runtime is null and `captured_from = 'backfill'`.
 *
 * Exit codes:
 *   0 — success
 *   1 — argument validation, conflict without --force, missing run, malformed input
 */

import { readFileSync } from 'node:fs'
import { db, sql as dbSql, ocrDecoderRuns } from '@eanhl/db'
import { getActiveRunIdForMatch } from '@eanhl/db/queries'
import { asc, isNotNull } from 'drizzle-orm'
import {
  buildReportBody,
  emitRow,
  loadRunRow,
  type ReportBody,
  type StageRuntimes,
  type StageRuntimesFile,
} from './lib/run-quality-report.js'

// ── argv parsing (mirrors decoder-runs-cli.getFlag) ──────────────────────────

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function parsePositiveInt(raw: string, flagName: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`--${flagName} must be a positive integer; got: ${raw}`)
  }
  return n
}

// ── stage-runtimes file loader ───────────────────────────────────────────────

const STAGE_KEYS: ReadonlyArray<keyof StageRuntimes> = [
  'create_candidate_ms',
  'ingest_ms',
  'repromote_loadout_ms',
  'repromote_lobby_ms',
  'validate_ms',
  'activate_ms',
  'consolidate_loadouts_ms',
  'backfill_event_actor_resolution_ms',
  'run_quality_emit_ms',
  'pass1_ms',
  'pass2_ms',
  'pass1_decode_ms',
  'pass1_classify_ms',
  'pass1_viterbi_ms',
  'prefilter_frames_scanned',
  'prefilter_frames_selected',
  'prefilter_selection_ms',
]

function emptyStages(): StageRuntimes {
  return {
    create_candidate_ms: null,
    ingest_ms: null,
    repromote_loadout_ms: null,
    repromote_lobby_ms: null,
    validate_ms: null,
    activate_ms: null,
    consolidate_loadouts_ms: null,
    backfill_event_actor_resolution_ms: null,
    run_quality_emit_ms: null,
    pass1_ms: null,
    pass2_ms: null,
    pass1_decode_ms: null,
    pass1_classify_ms: null,
    pass1_viterbi_ms: null,
    prefilter_frames_scanned: null,
    prefilter_frames_selected: null,
    prefilter_selection_ms: null,
  }
}

function loadStageRuntimes(path: string): StageRuntimesFile {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`--stage-runtimes file not readable at ${path}: ${msg}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`--stage-runtimes file is not valid JSON (${path}): ${msg}`)
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`--stage-runtimes file must be an object (got ${typeof raw})`)
  }
  const obj = raw as Record<string, unknown>
  const stagesRaw = obj['stages']
  if (!stagesRaw || typeof stagesRaw !== 'object') {
    throw new Error(`--stage-runtimes: 'stages' must be an object`)
  }
  const stagesObj = stagesRaw as Record<string, unknown>
  const stages = emptyStages()
  for (const k of STAGE_KEYS) {
    const v = stagesObj[k]
    if (v === undefined || v === null) {
      stages[k] = null
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      stages[k] = v
    } else {
      throw new Error(`--stage-runtimes: stages.${k} must be number or null; got ${typeof v}`)
    }
  }
  const totalWallRaw = obj['total_wall_ms']
  const total_wall_ms =
    totalWallRaw === null || totalWallRaw === undefined
      ? null
      : typeof totalWallRaw === 'number' && Number.isFinite(totalWallRaw)
        ? totalWallRaw
        : (() => {
            throw new Error(`--stage-runtimes: total_wall_ms must be number or null`)
          })()
  const capturedAtRaw = obj['captured_at']
  const captured_at =
    capturedAtRaw === null || capturedAtRaw === undefined
      ? null
      : typeof capturedAtRaw === 'string'
        ? capturedAtRaw
        : (() => {
            throw new Error(`--stage-runtimes: captured_at must be string or null`)
          })()
  const capturedFromRaw = obj['captured_from']
  const captured_from =
    capturedFromRaw === 'reprocess.py' || capturedFromRaw === 'backfill'
      ? capturedFromRaw
      : (() => {
          throw new Error(`--stage-runtimes: captured_from must be 'reprocess.py' or 'backfill'`)
        })()
  const cacheHitRaw = obj['pass1_cache_hit']
  const pass1_cache_hit =
    cacheHitRaw === null || cacheHitRaw === undefined
      ? null
      : typeof cacheHitRaw === 'boolean'
        ? cacheHitRaw
        : (() => {
            throw new Error(`--stage-runtimes: pass1_cache_hit must be boolean or null`)
          })()
  return { stages, total_wall_ms, captured_at, captured_from, pass1_cache_hit }
}

// ── stderr human summary ─────────────────────────────────────────────────────

function renderHumanSummary(body: ReportBody): string {
  const lines: string[] = []
  lines.push(
    `── run ${body.run.run_id} (match ${body.run.match_id}) ${body.run.is_active ? '[ACTIVE]' : '[inactive]'}`,
  )
  lines.push(
    `   decoder=${body.run.decoder_version}  weights=${body.run.weights_hash}  config=${body.run.config_hash}`,
  )
  lines.push(`   started=${body.run.started_at}  completed=${body.run.completed_at ?? 'n/a'}`)
  lines.push(
    `   runtime: total_wall_ms=${body.runtime.total_wall_ms ?? 'n/a'}  source=${body.runtime.captured_from}`,
  )
  lines.push(
    `   screens: frames=${body.screens.totals.frames} ok=${body.screens.totals.ok} err=${body.screens.totals.err} reviewed=${body.screens.totals.reviewed} pending=${body.screens.totals.pending_review}`,
  )
  lines.push(
    `   promotions: rows=${body.promotions.totals.rows} promoted=${body.promotions.totals.promoted} blocked=${body.promotions.totals.blocked}`,
  )
  lines.push(
    `   defense: is_cpu=${body.defense_layers.is_cpu_demotions} hard_field_blocks=${body.defense_layers.hard_field_blocks} junk_ts=${body.defense_layers.junk_gamertag_blocks_ts} or_fold=${body.defense_layers.or_fold_inferences}`,
  )
  lines.push(
    `   unresolved: gamertags=${body.unresolved.gamertags} personas=${body.unresolved.personas} actor_bindings=${body.unresolved.actor_bindings_for_side} total=${body.unresolved.totals.all}`,
  )
  const fmtPct = (v: number | null): string => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`)
  const fmtPass = (v: boolean | null): string => (v === null ? 'SKIP' : v ? 'PASS' : 'FAIL')
  if (body.layers.computed) {
    lines.push(
      `   layers: L2=${fmtPct(body.layers.l2.score)} (${fmtPass(body.layers.l2.pass)})  L2.5=${fmtPct(body.layers.l2_lineup.score)} (${fmtPass(body.layers.l2_lineup.pass)})  L3=${fmtPct(body.layers.l3.score)} (${fmtPass(body.layers.l3.pass)})`,
    )
    lines.push(`   overall: ${body.layers.overall_pass ? '[ PASS ]' : '[ FAIL ]'}`)
  } else {
    lines.push(`   layers: not computed (run not active for match)`)
    lines.push(`   overall: [ SKIP ]`)
  }
  if (body.errors.length > 0) {
    lines.push(`   errors: ${body.errors.length} partial-section failure(s)`)
    for (const e of body.errors.slice(0, 5)) {
      lines.push(`     - ${e.section}: ${e.message}`)
    }
  }
  return lines.join('\n')
}

// ── single-run resolution ────────────────────────────────────────────────────

async function resolveRunId(argv: string[]): Promise<number> {
  const runIdRaw = getFlag(argv, 'run-id')
  const matchIdRaw = getFlag(argv, 'match-id')

  if (runIdRaw && matchIdRaw) {
    throw new Error('--run-id and --match-id are mutually exclusive; pass exactly one')
  }
  if (runIdRaw) return parsePositiveInt(runIdRaw, 'run-id')
  if (matchIdRaw) {
    const matchId = parsePositiveInt(matchIdRaw, 'match-id')
    const runId = await getActiveRunIdForMatch(matchId)
    if (runId === null) {
      throw new Error(`no active run found for match-id ${matchId}`)
    }
    return runId
  }
  throw new Error('one of --run-id, --match-id, or --all-runs is required')
}

// ── modes ────────────────────────────────────────────────────────────────────

async function runSingle(argv: string[]): Promise<void> {
  const emitMode = hasFlag(argv, 'emit-row')
  const force = hasFlag(argv, 'force')

  const stagePath = getFlag(argv, 'stage-runtimes')
  const runtime = stagePath ? loadStageRuntimes(stagePath) : null

  const runId = await resolveRunId(argv)
  const runRow = await loadRunRow(runId)
  if (!runRow) {
    throw new Error(`run ${runId} not found in ocr_decoder_runs`)
  }

  const body = await buildReportBody(runRow, { runtime })

  // Always print the human summary on stderr for visibility.
  process.stderr.write(renderHumanSummary(body) + '\n')

  if (emitMode) {
    const { written, reportId, alreadyExists } = await emitRow(runId, body, force)
    if (!written && alreadyExists) {
      process.stderr.write(
        `run-quality: row already exists for run_id=${runId} (pass --force to overwrite)\n`,
      )
      await dbSql.end()
      process.exit(1)
    }
    process.stdout.write(JSON.stringify({ run_id: runId, report_id: reportId, written }) + '\n')
    return
  }

  // Default --json mode (read-only).
  process.stdout.write(JSON.stringify(body) + '\n')
}

async function runAll(argv: string[]): Promise<void> {
  // Codex round 3 P2: --stage-runtimes carries per-run measured data. Combining
  // it with --all-runs would load the file once and apply the same runtime to
  // every iteration — and with --force, that one accidental invocation stamps
  // the same measurement onto thousands of unrelated reports. The flag
  // combination has no sensible use case, so we reject it at argv level before
  // any DB query runs.
  if (hasFlag(argv, 'stage-runtimes')) {
    process.stderr.write(
      '--stage-runtimes is not allowed with --all-runs.\n' +
        'The stage-runtimes file is per-run; applying one file to every run would\n' +
        'stamp the same measurement onto unrelated reports. Use --run-id N\n' +
        '--stage-runtimes <path> --emit-row instead.\n',
    )
    process.exit(1)
  }

  const emitMode = hasFlag(argv, 'emit-row')
  const force = hasFlag(argv, 'force')

  // Skip runs with completed_at IS NULL — those are mid-pipeline reprocess
  // candidates. Including them creates a race with reprocess.py's final emit:
  // the backfill could win first (runtime=null), then reprocess's --force-less
  // final emit hits ON CONFLICT and fails best-effort-silently, leaving the
  // run permanently stuck on the content-only backfill row. See Codex P1-1.
  const runs = await db
    .select({
      id: ocrDecoderRuns.id,
      matchId: ocrDecoderRuns.matchId,
      decoderVersion: ocrDecoderRuns.decoderVersion,
      weightsHash: ocrDecoderRuns.weightsHash,
      configHash: ocrDecoderRuns.configHash,
      isActive: ocrDecoderRuns.isActive,
      startedAt: ocrDecoderRuns.startedAt,
      completedAt: ocrDecoderRuns.completedAt,
    })
    .from(ocrDecoderRuns)
    .where(isNotNull(ocrDecoderRuns.completedAt))
    .orderBy(asc(ocrDecoderRuns.id))

  process.stderr.write(
    `run-quality: --all-runs iterating ${runs.length} completed run(s) (incomplete runs skipped)\n`,
  )

  let written = 0
  let skipped = 0
  for (const runRow of runs) {
    try {
      const body = await buildReportBody(runRow, { runtime: null })

      if (emitMode) {
        const res = await emitRow(runRow.id, body, force)
        if (res.alreadyExists) {
          process.stderr.write(
            `run-quality: run ${runRow.id} already has a report (skipped — pass --force to overwrite)\n`,
          )
          skipped += 1
          continue
        }
        written += 1
        process.stderr.write(
          `run-quality: run ${runRow.id} → report ${res.reportId ?? 'n/a'} written\n`,
        )
      } else {
        process.stdout.write(JSON.stringify(body) + '\n')
        process.stderr.write(`run-quality: run ${runRow.id} body emitted\n`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      process.stderr.write(`run-quality: run ${runRow.id} ERROR — ${msg}\n`)
    }
  }

  if (emitMode) {
    process.stdout.write(
      JSON.stringify({ all_runs: true, total: runs.length, written, skipped }) + '\n',
    )
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  if (hasFlag(argv, 'all-runs')) {
    await runAll(argv)
    return
  }
  await runSingle(argv)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    process.stderr.write(`run-quality: ${msg}\n`)
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
