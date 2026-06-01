/**
 * pnpm --filter @eanhl/worker run-quality [--run-id N | --match-id M] [--json | --emit-row | --all-runs] [--force] [--stage-runtimes PATH]
 *
 * Phase-3 CLI of the Run-Level Quality Reporting workstream
 * (plan `/home/michal/.claude/plans/ok-plan-this-run-level-nifty-comet.md`).
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
 * Body shape — `layers` section (Codex P1-2):
 *   The body's `layers.computed` boolean discriminates two cases:
 *
 *     - `computed: true`  → run was active for its match; L2/L2.5/L3 scores
 *       reflect the run's actual contribution. l2/l2_lineup/l3 fields are
 *       non-null. The hot columns mirror these values.
 *     - `computed: false` → run was inactive (superseded / backfill candidate).
 *       `computeLayers` would have read match-scoped DB state (match_events,
 *       player_loadout_snapshots) that reflects the CURRENT canonical run,
 *       not this row's, so layer compute is skipped. l2/l2_lineup/l3 score
 *       + pass + overall_pass are NULL. The hot columns are NULL too.
 *
 *   The l1 sub-section is always `{score: null, pass: null, notes: …}` (L1
 *   ground-truth fixtures pending); orthogonal to the computed/not-computed
 *   discriminator.
 *
 * Exit codes:
 *   0 — success
 *   1 — argument validation, conflict without --force, missing run, malformed input
 */

import { readFileSync } from 'node:fs'
import { db, sql as dbSql, ocrDecoderRuns } from '@eanhl/db'
import {
  buildScreenTableByRun,
  buildPromotionDistribution,
  buildDefenseLayerCounters,
  buildUnresolvedCounts,
  countSegmentsByRun,
  upsertRunQualityReport,
  getActiveRunIdForMatch,
  getMatchById,
  type ScreenRowByRun,
  type PromotionDistribution,
  type DefenseLayerCounters,
  type UnresolvedCounts,
} from '@eanhl/db/queries'
import { asc, eq, isNotNull } from 'drizzle-orm'
import { computeLayers, type LayerScores } from './lib/quality-layers.js'
import { buildDownstreamCounts, buildQualityFlags } from './lib/quality-inputs.js'

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

// ── stage-runtimes file shape ────────────────────────────────────────────────

interface StageRuntimes {
  create_candidate_ms: number | null
  ingest_ms: number | null
  repromote_loadout_ms: number | null
  repromote_lobby_ms: number | null
  validate_ms: number | null
  activate_ms: number | null
  consolidate_loadouts_ms: number | null
  backfill_event_actor_resolution_ms: number | null
  run_quality_emit_ms: number | null
  // Phase 4 Part B — Pass-1 sub-phase + Pass-2 wall-time fields sourced
  // from the orchestrator's per-run ingest_timings.json sidecar via
  // reprocess.py. All null when the sidecar is missing (older
  // orchestrator, write failure, or --all-runs --emit-row backfill
  // path which doesn't run the ingest pipeline). Aggregations across
  // runs should filter on `report.runtime.pass1_cache_hit IS NOT TRUE`
  // when computing materiality trends — see the analytics query
  // template in HANDOFF.
  pass1_ms: number | null
  pass2_ms: number | null
  pass1_decode_ms: number | null
  pass1_classify_ms: number | null
  pass1_viterbi_ms: number | null
  // WS1b — Visual-Prefilter Pass-2 selection telemetry, sourced from the
  // same ingest_timings.json sidecar (run-level aggregate of the per-segment
  // Pass2Result.prefilter_* fields). null when the prefilter was disabled for
  // the run. Same number | null contract — timing/count only.
  prefilter_frames_scanned: number | null
  prefilter_frames_selected: number | null
  prefilter_selection_ms: number | null
}

interface StageRuntimesFile {
  stages: StageRuntimes
  total_wall_ms: number | null
  captured_at: string | null
  captured_from: 'reprocess.py' | 'backfill'
  // Phase 4 Part B — top-level (NOT in stages) because stages is
  // contractually timing-only (number | null) and the STAGE_KEYS loop
  // would reject a boolean. Lands in JSONB as report.runtime.pass1_cache_hit.
  pass1_cache_hit: boolean | null
}

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
  // Phase 4 Part B keys — same number | null contract as the rest.
  'pass1_ms',
  'pass2_ms',
  'pass1_decode_ms',
  'pass1_classify_ms',
  'pass1_viterbi_ms',
  // WS1b prefilter keys — same number | null contract.
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
  // Phase 4 Part B: pass1_cache_hit lives top-level (separate validator
  // because boolean values would fail the stages STAGE_KEYS loop). Older
  // stage-runtimes files (pre-Part-B) lack the key entirely → null.
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

// ── body assembly ────────────────────────────────────────────────────────────

interface ReportRun {
  run_id: number
  match_id: number
  decoder_version: string
  weights_hash: string
  config_hash: string
  is_active: boolean
  started_at: string
  completed_at: string | null
}

interface ReportRuntime {
  total_wall_ms: number | null
  stages: StageRuntimes | null
  captured_at: string | null
  captured_from: 'reprocess.py' | 'backfill'
  // Phase 4 Part B — top-level (NOT in stages). Lands in JSONB as
  // report.runtime.pass1_cache_hit. Analytics filter on `IS NOT TRUE`
  // when computing across-run Pass-1 cost trends.
  pass1_cache_hit: boolean | null
}

interface ReportScreens {
  by_screen_type: ScreenRowByRun[]
  /**
   * `frames` counts `ocr_extractions` rows (per-frame).
   * `segments` counts `ocr_segments` rows (per-segment) — added in the Codex
   * P3 fix so the hot column `ocr_run_quality_reports.total_segments` reflects
   * the segment layer it's named after rather than the frame layer.
   */
  totals: {
    frames: number
    segments: number
    ok: number
    err: number
    reviewed: number
    pending_review: number
  }
}

interface ReportLayersSerialized {
  /**
   * Codex P1-2 discriminator. `true` when this run was the active run for
   * its match and layer compute reflects the run's contribution; `false`
   * when the run was inactive and compute was skipped to avoid attributing
   * canonical-state metrics to a superseded run. All l2/l2_lineup/l3
   * score+pass fields and overall_pass are null when `computed === false`.
   */
  computed: boolean
  l1: { score: null; pass: null; notes: string }
  l2: {
    score: number | null
    pass: boolean | null
    bgm_events: number | null
    bgm_resolved: number | null
    deductions: number | null
    notes: string
  }
  l2_lineup: {
    score: number | null
    pass: boolean | null
    populated: number | null
    expected: number | null
    notes: string
  }
  l3: { score: number | null; pass: boolean | null; notes: string }
  overall_pass: boolean | null
}

interface ReportBody {
  schema_version: 1
  run: ReportRun
  runtime: ReportRuntime
  screens: ReportScreens
  promotions: PromotionDistribution
  defense_layers: DefenseLayerCounters
  unresolved: UnresolvedCounts
  layers: ReportLayersSerialized
  errors: Array<{ section: string; message: string }>
}

function serializeComputedLayers(layers: LayerScores): ReportLayersSerialized {
  return {
    computed: true,
    l1: {
      score: null,
      pass: null,
      notes: layers.l1.notes,
    },
    l2: {
      score: layers.l2.score,
      pass: layers.l2.pass,
      bgm_events: layers.l2.bgmEvents,
      bgm_resolved: layers.l2.bgmResolved,
      deductions: layers.l2.deductions,
      notes: layers.l2.notes,
    },
    l2_lineup: {
      score: layers.l2_lineup.score,
      pass: layers.l2_lineup.pass,
      populated: layers.l2_lineup.populated,
      expected: layers.l2_lineup.expected,
      notes: layers.l2_lineup.notes,
    },
    l3: {
      score: layers.l3.score,
      pass: layers.l3.pass,
      notes: layers.l3.notes,
    },
    overall_pass: layers.overall.pass,
  }
}

/**
 * Produce a `computed: false` layers section for inactive runs. Codex P1-2:
 * `computeLayers` queries match-scoped DB state (match_events,
 * player_loadout_snapshots) that only belongs to the active run — running
 * it against an inactive run would attribute canonical metrics to a
 * superseded row. Skip the compute and store NULLs so trend dashboards
 * can tell "not computed" apart from "computed = 0".
 */
function notComputedLayers(matchId: number, l1Note: string): ReportLayersSerialized {
  const note = `not computed: run is not active for match ${matchId} (layers reflect canonical state)`
  return {
    computed: false,
    l1: { score: null, pass: null, notes: l1Note },
    l2: {
      score: null,
      pass: null,
      bgm_events: null,
      bgm_resolved: null,
      deductions: null,
      notes: note,
    },
    l2_lineup: {
      score: null,
      pass: null,
      populated: null,
      expected: null,
      notes: note,
    },
    l3: { score: null, pass: null, notes: note },
    overall_pass: null,
  }
}

interface DecoderRunRow {
  id: number
  matchId: number
  decoderVersion: string
  weightsHash: string
  configHash: string
  isActive: boolean
  startedAt: Date
  completedAt: Date | null
}

async function loadRunRow(runId: number): Promise<DecoderRunRow | null> {
  const rows = await db
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
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
  return rows[0] ?? null
}

interface BuildReportOptions {
  runtime: StageRuntimesFile | null
}

async function buildReportBody(run: DecoderRunRow, opts: BuildReportOptions): Promise<ReportBody> {
  const errors: Array<{ section: string; message: string }> = []

  const safeCall = async <T>(section: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      errors.push({
        section,
        message: e instanceof Error ? e.message : String(e),
      })
      return fallback
    }
  }

  // Run-scoped queries — these all key off run.id.
  const [screenRows, segmentCount, promotions, defenseLayers, unresolved] = await Promise.all([
    safeCall<ScreenRowByRun[]>('screens', [], () => buildScreenTableByRun(run.id)),
    safeCall<number>('segments', 0, () => countSegmentsByRun(run.id)),
    safeCall<PromotionDistribution>(
      'promotions',
      {
        by_status: {},
        by_blocking_reason: {},
        by_field_key: {},
        totals: { promoted: 0, blocked: 0, rows: 0 },
      },
      () => buildPromotionDistribution(run.id),
    ),
    safeCall<DefenseLayerCounters>(
      'defense_layers',
      {
        is_cpu_demotions: 0,
        is_cpu_or_demoted_combined: 0,
        cross_team_dupes_segment_level_heuristic: null,
        or_fold_inferences: 0,
        hard_field_blocks: 0,
        junk_gamertag_blocks_ts: 0,
        junk_gamertag_blocks_python: null,
        notes: [],
      },
      () => buildDefenseLayerCounters(run.id),
    ),
    safeCall<UnresolvedCounts>(
      'unresolved',
      {
        gamertags: 0,
        personas: 0,
        actor_bindings_for_side: 0,
        totals: { all: 0 },
      },
      () => buildUnresolvedCounts(run.id),
    ),
  ])

  // Layer compute (L2/L2.5/L3) is match-scoped — it reads match_events and
  // player_loadout_snapshots filtered by match_id alone, which is the active
  // run's contribution. For inactive / superseded runs we skip compute and
  // store nulls (Codex P1-2). l1 stays a stub regardless: the L1 ground-truth
  // fixture path is orthogonal v1 work.
  const l1Note = 'ground-truth fixtures pending'

  let serializedLayers: ReportLayersSerialized
  if (!run.isActive) {
    // No DB calls for the layer inputs — purely a NULL row.
    serializedLayers = notComputedLayers(run.matchId, l1Note)
  } else {
    const match = await safeCall<Awaited<ReturnType<typeof getMatchById>>>('match', null, () =>
      getMatchById(run.matchId),
    )
    if (!match) {
      // Active run but match row gone — surface explicit failure as a not-computed result.
      serializedLayers = {
        computed: false,
        l1: { score: null, pass: null, notes: l1Note },
        l2: {
          score: null,
          pass: null,
          bgm_events: null,
          bgm_resolved: null,
          deductions: null,
          notes: 'not computed: match row not found',
        },
        l2_lineup: {
          score: null,
          pass: null,
          populated: null,
          expected: null,
          notes: 'not computed: match row not found',
        },
        l3: { score: null, pass: null, notes: 'not computed: match row not found' },
        overall_pass: null,
      }
    } else {
      const downstream = await safeCall<Awaited<ReturnType<typeof buildDownstreamCounts>>>(
        'downstream',
        [],
        () => buildDownstreamCounts(run.matchId, match),
      )
      const flags = await safeCall<Awaited<ReturnType<typeof buildQualityFlags>>>('flags', [], () =>
        buildQualityFlags(run.matchId, match),
      )
      // Sentinel that signals computeLayers failed and we should fall through
      // to a not-computed serialization with a failure note.
      const FAILED_SENTINEL = Symbol('computeLayers-failed')
      const layersOrFailed = await safeCall<LayerScores | typeof FAILED_SENTINEL>(
        'layers',
        FAILED_SENTINEL,
        () => computeLayers(run.matchId, downstream, flags),
      )
      if (layersOrFailed === FAILED_SENTINEL) {
        const failNote = 'not computed: computeLayers failed (see errors[])'
        serializedLayers = {
          computed: false,
          l1: { score: null, pass: null, notes: l1Note },
          l2: {
            score: null,
            pass: null,
            bgm_events: null,
            bgm_resolved: null,
            deductions: null,
            notes: failNote,
          },
          l2_lineup: {
            score: null,
            pass: null,
            populated: null,
            expected: null,
            notes: failNote,
          },
          l3: { score: null, pass: null, notes: failNote },
          overall_pass: null,
        }
      } else {
        serializedLayers = serializeComputedLayers(layersOrFailed)
      }
    }
  }

  // Screens totals: derive from the per-screen rows. `pending_review` is
  // computed as `max(0, frames - reviewed)` because the screen helper
  // only exposes frames + reviewed + ok + err (not the review_status
  // enum breakdown).
  // FIXME(schema:pending_review-buckets): when buildScreenTableByRun gains
  //   explicit review_status bucket counts (rejected vs pending_review),
  //   replace this approximation with COUNT(*) FILTER (WHERE review_status = 'pending_review').
  let totalFrames = 0
  let totalOk = 0
  let totalErr = 0
  let totalReviewed = 0
  for (const r of screenRows) {
    totalFrames += r.frames
    totalOk += r.ok
    totalErr += r.err
    totalReviewed += r.reviewed
  }
  const totalPendingReview = Math.max(0, totalFrames - totalReviewed)

  const runtime: ReportRuntime = opts.runtime
    ? {
        total_wall_ms: opts.runtime.total_wall_ms,
        stages: opts.runtime.stages,
        captured_at: opts.runtime.captured_at,
        captured_from: opts.runtime.captured_from,
        pass1_cache_hit: opts.runtime.pass1_cache_hit,
      }
    : {
        total_wall_ms: null,
        stages: null,
        captured_at: null,
        captured_from: 'backfill',
        pass1_cache_hit: null,
      }

  return {
    schema_version: 1,
    run: {
      run_id: run.id,
      match_id: run.matchId,
      decoder_version: run.decoderVersion,
      weights_hash: run.weightsHash,
      config_hash: run.configHash,
      is_active: run.isActive,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt ? run.completedAt.toISOString() : null,
    },
    runtime,
    screens: {
      by_screen_type: screenRows,
      totals: {
        frames: totalFrames,
        segments: segmentCount,
        ok: totalOk,
        err: totalErr,
        reviewed: totalReviewed,
        pending_review: totalPendingReview,
      },
    },
    promotions,
    defense_layers: defenseLayers,
    unresolved,
    layers: serializedLayers,
    errors,
  }
}

function deriveColumns(body: ReportBody): {
  matchId: number
  schemaVersion: number
  overallPass: boolean | null
  l1Score: number | null
  l2Score: number | null
  l2LineupScore: number | null
  l3Score: number | null
  totalWallMs: number | null
  totalSegments: number
  totalDemoted: number
  totalUnresolved: number
} {
  // NOTE(totalDemoted-overlap): this sum may double-count a single evidence
  //   row that hits multiple defense layers (e.g. an is_cpu=true row whose
  //   promotion also blocked on hard_fields). The per-layer breakdown in
  //   `body.defense_layers` keeps the underlying counts intact (no info
  //   loss), so this is a column-level approximation, not an authoritative
  //   total. Future schema/observability work should grep this marker.
  const totalDemoted =
    body.defense_layers.is_cpu_or_demoted_combined +
    body.defense_layers.hard_field_blocks +
    body.defense_layers.junk_gamertag_blocks_ts
  // Codex P1-2: when layer compute was skipped (run not active for match),
  // mirror nulls into the hot columns so trend dashboards can tell
  // "not computed" apart from "computed = 0". Defense / unresolved / segment
  // counters are run-scoped and remain valid regardless.
  const layerComputed = body.layers.computed
  return {
    matchId: body.run.match_id,
    schemaVersion: 1,
    overallPass: layerComputed ? body.layers.overall_pass : null,
    l1Score: null,
    l2Score: layerComputed ? body.layers.l2.score : null,
    l2LineupScore: layerComputed ? body.layers.l2_lineup.score : null,
    l3Score: layerComputed ? body.layers.l3.score : null,
    totalWallMs: body.runtime.total_wall_ms,
    // Hot column `total_segments` mirrors the segment layer (ocr_segments
    // count), not the frame layer. See Codex P3. The frame count remains
    // available in body.screens.totals.frames for forensic reads.
    totalSegments: body.screens.totals.segments,
    totalDemoted,
    totalUnresolved: body.unresolved.totals.all,
  }
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

// ── emit helper ──────────────────────────────────────────────────────────────

async function emitRow(
  runId: number,
  body: ReportBody,
  force: boolean,
): Promise<{ written: boolean; reportId: number | null; alreadyExists: boolean }> {
  const derived = deriveColumns(body)
  try {
    const reportId = await upsertRunQualityReport(
      runId,
      body as unknown as Record<string, unknown>,
      derived,
      {
        force,
      },
    )
    return { written: true, reportId, alreadyExists: false }
  } catch (e) {
    // Walk the cause chain looking for the unique-violation code 23505 that
    // upsertRunQualityReport throws when force=false and a row already exists.
    const codes: Array<string | undefined> = []
    const messages: string[] = []
    let cur: unknown = e
    for (let i = 0; i < 5 && cur && typeof cur === 'object'; i++) {
      const obj = cur as { code?: string; message?: string; cause?: unknown }
      codes.push(obj.code)
      if (obj.message) messages.push(obj.message)
      cur = obj.cause
    }
    const isUniqueViolation =
      codes.includes('23505') ||
      messages.some((m) => /duplicate key value violates unique constraint/i.test(m))
    if (isUniqueViolation && !force) {
      return { written: false, reportId: null, alreadyExists: true }
    }
    throw e
  }
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

  const stagePath = getFlag(argv, 'stage-runtimes')
  const runtime = stagePath ? loadStageRuntimes(stagePath) : null

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
      const body = await buildReportBody(runRow, { runtime })

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
