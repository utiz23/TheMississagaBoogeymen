/**
 * Run-quality report body assembly + emit — extracted from `run-quality-cli.ts`
 * (Tier 0 WS0.1A) so the same report-building + upsert path is shared by:
 *   - the `run-quality` CLI (`--json` / `--emit-row` / `--all-runs`), and
 *   - the `decoder-runs activate` quality gate, which emits the report row for
 *     the just-activated (and consolidated) run AFTER the activation tx commits.
 *
 * Keeping a single `buildReportBody` means the gate's persisted `overall_pass`
 * and the standalone CLI's report can never drift — both run the same
 * `computeLayers` over the same committed canonical state.
 *
 * NO behaviour change vs the prior inline implementation in run-quality-cli.
 * `run-quality-cli.test.ts` is the contract.
 */

import { db, ocrDecoderRuns } from '@eanhl/db'
import {
  buildScreenTableByRun,
  buildPromotionDistribution,
  buildDefenseLayerCounters,
  buildUnresolvedCounts,
  countSegmentsByRun,
  upsertRunQualityReport,
  getMatchById,
  type ScreenRowByRun,
  type PromotionDistribution,
  type DefenseLayerCounters,
  type UnresolvedCounts,
} from '@eanhl/db/queries'
import { eq } from 'drizzle-orm'
import { computeLayers, type LayerScores } from './quality-layers.js'
import type { L4FieldDiff } from './l4-api-truth.js'
import { buildDownstreamCounts, buildQualityFlags } from './quality-inputs.js'

// ── stage-runtimes shape (file produced by reprocess.py; consumed here) ──────

export interface StageRuntimes {
  create_candidate_ms: number | null
  ingest_ms: number | null
  repromote_loadout_ms: number | null
  repromote_lobby_ms: number | null
  validate_ms: number | null
  activate_ms: number | null
  consolidate_loadouts_ms: number | null
  backfill_event_actor_resolution_ms: number | null
  run_quality_emit_ms: number | null
  pass1_ms: number | null
  pass2_ms: number | null
  pass1_decode_ms: number | null
  pass1_classify_ms: number | null
  pass1_viterbi_ms: number | null
  prefilter_frames_scanned: number | null
  prefilter_frames_selected: number | null
  prefilter_selection_ms: number | null
}

export interface StageRuntimesFile {
  stages: StageRuntimes
  total_wall_ms: number | null
  captured_at: string | null
  captured_from: 'reprocess.py' | 'backfill'
  pass1_cache_hit: boolean | null
}

// ── body shape ───────────────────────────────────────────────────────────────

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
  pass1_cache_hit: boolean | null
}

interface ReportScreens {
  by_screen_type: ScreenRowByRun[]
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
  /**
   * API-truth accuracy (L4), Milestone ③. `gradable=false` ⇒ no EA-API truth to
   * grade against; `score`/`pass` null when ungradable or no overlapping fields.
   * `mismatches` lists each disagreeing field for the review queue.
   */
  l4: {
    score: number | null
    pass: boolean | null
    gradable: boolean
    notes: string
    mismatches: L4FieldDiff[]
    /** Task 4.G — TOT-row final accuracy (hard gate); soft period sub-metrics. */
    final_accuracy: number | null
    period_coverage: number | null
    period_accuracy: number | null
  }
  overall_pass: boolean | null
}

export interface ReportBody {
  /** Bumped 1→2 in Milestone ③ when `layers.l4` (API-truth accuracy) was added. */
  schema_version: 2
  run: ReportRun
  runtime: ReportRuntime
  screens: ReportScreens
  promotions: PromotionDistribution
  defense_layers: DefenseLayerCounters
  unresolved: UnresolvedCounts
  layers: ReportLayersSerialized
  errors: Array<{ section: string; message: string }>
  /**
   * Tier 0 WS0.1A — present ONLY when activation bypassed the quality gate via
   * `decoder-runs activate --force --reason "<text>"`. Records the override for
   * audit without a schema migration (lives in the existing `report` jsonb).
   */
  override?: { overridden: true; reason: string; at: string }
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
    l4: {
      score: layers.l4.score,
      pass: layers.l4.pass,
      gradable: layers.l4.gradable,
      notes: layers.l4.notes,
      mismatches: layers.l4.mismatches,
      final_accuracy: layers.l4.finalAccuracy,
      period_coverage: layers.l4.periodCoverage,
      period_accuracy: layers.l4.periodAccuracy,
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
    l4: {
      score: null,
      pass: null,
      gradable: false,
      notes: note,
      mismatches: [],
      final_accuracy: null,
      period_coverage: null,
      period_accuracy: null,
    },
    overall_pass: null,
  }
}

export interface DecoderRunRow {
  id: number
  matchId: number
  decoderVersion: string
  weightsHash: string
  configHash: string
  isActive: boolean
  startedAt: Date
  completedAt: Date | null
}

export async function loadRunRow(runId: number): Promise<DecoderRunRow | null> {
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

export interface BuildReportOptions {
  runtime: StageRuntimesFile | null
}

export async function buildReportBody(
  run: DecoderRunRow,
  opts: BuildReportOptions,
): Promise<ReportBody> {
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
        l4: {
          score: null,
          pass: null,
          gradable: false,
          notes: 'not computed: match row not found',
          mismatches: [],
          final_accuracy: null,
          period_coverage: null,
          period_accuracy: null,
        },
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
          l4: {
            score: null,
            pass: null,
            gradable: false,
            notes: failNote,
            mismatches: [],
            final_accuracy: null,
            period_coverage: null,
            period_accuracy: null,
          },
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
    schema_version: 2,
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

export function deriveColumns(body: ReportBody): {
  matchId: number
  schemaVersion: number
  overallPass: boolean | null
  l1Score: number | null
  l2Score: number | null
  l2LineupScore: number | null
  l3Score: number | null
  l4Score: number | null
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
    schemaVersion: 2,
    overallPass: layerComputed ? body.layers.overall_pass : null,
    l1Score: null,
    l2Score: layerComputed ? body.layers.l2.score : null,
    l2LineupScore: layerComputed ? body.layers.l2_lineup.score : null,
    l3Score: layerComputed ? body.layers.l3.score : null,
    // L4 may still be null even when layers were computed — a gradable run
    // with no overlapping fields, or an ungradable (OCR-sole-source) run.
    l4Score: layerComputed ? body.layers.l4.score : null,
    totalWallMs: body.runtime.total_wall_ms,
    // Hot column `total_segments` mirrors the segment layer (ocr_segments
    // count), not the frame layer. See Codex P3. The frame count remains
    // available in body.screens.totals.frames for forensic reads.
    totalSegments: body.screens.totals.segments,
    totalDemoted,
    totalUnresolved: body.unresolved.totals.all,
  }
}

export async function emitRow(
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
