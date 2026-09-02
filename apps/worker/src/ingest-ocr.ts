/**
 * OCR ingest orchestration.
 *
 * 1. Insert one ocr_capture_batches row per CLI invocation.
 * 2. Run the Python OCR CLI as a subprocess (see ocr-cli-runner.ts).
 * 3. For each result, in its own transaction:
 *    - Upsert ocr_extractions row (idempotent on (batch_id, source_path)).
 *    - Replace ocr_extraction_fields rows for that extraction.
 *    - Dispatch to a per-screen promoter that writes domain rows.
 * 4. Return summary counts.
 *
 * One transaction per result, not one per batch. A single bad screenshot does
 * not roll back the rest of the batch.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  db,
  sql,
  ocrCaptureBatches,
  ocrExtractions,
  ocrExtractionFields,
  ocrFieldEvidence,
  ocrSegments,
  type Database,
  type NewOcrCaptureBatch,
  type NewOcrExtractionField,
  type NewOcrFieldEvidence,
  type NewOcrSegment,
  type OcrCaptureKind,
  type OcrEntityType,
  type OcrFieldStatus,
  type OcrScreenType,
  type OcrSegmentState,
} from '@eanhl/db'
import { lockDecoderRunForProvenance, refreshDecoderRunProvenance } from '@eanhl/db/queries'
import { and, eq, isNotNull } from 'drizzle-orm'
import { runOcrCli, type OcrResult, type OcrExtractionField } from './ocr-cli-runner.js'
import { getPromoter, type PromoterDb } from './ocr-promoters/index.js'
import { promoteLoadoutFromEvidence } from './ocr-promoters/loadout-v2.js'
import { promoteLobbyFromEvidence } from './ocr-promoters/lobby-v2.js'
import { applyMatchColors } from './lib/match-color-aggregator.js'
import { reconcilePositions } from './reconcile-positions.js'

export interface IngestOcrBatchInput {
  batchDir: string
  screen: OcrScreenType
  gameTitleId: number
  matchId?: number | null
  captureKind?: OcrCaptureKind
  notes?: string | null
  dryRun?: boolean
  /**
   * Optional SHA-256 of the source video. When provided, the batch row
   * is upserted on (video_sha256, source_directory) instead of always
   * inserting a new row — makes re-ingesting from the video pipeline
   * idempotent. NULL for manual screenshot batches.
   */
  videoSha256?: string | null
  /**
   * Optional Pass-1 segment metadata from the video pipeline orchestrator.
   * When all three are present, the ocr_segments row uses a stable key of
   * `${videoSha256}:seg${videoSegmentIndex}` (idempotent across video re-ingests)
   * plus the real time bounds. Otherwise the segment falls back to
   * `batch-${batchId}` (one segment per CLI call).
   */
  videoSegmentIndex?: number | null
  videoSegmentStartSec?: number | null
  videoSegmentEndSec?: number | null
  uiVersion?: string | null
  /**
   * Optional Pass-1 decoder version tag. Lands in `ocr_segments.decoder_version`.
   * When omitted, the legacy fallback (`legacy-passthrough-v0-{video|manual}`)
   * is derived from whether video metadata is present. Phase 1 video pipelines
   * pass `hmm-viterbi-v1` explicitly when the Viterbi engine is selected.
   */
  decoderVersion?: string | null
  /**
   * Pass-2 loadout extraction engine: 'typed_v1' | 'legacy'. Default 'legacy'.
   * Task 2A-14 will use this to select the write path for loadout field evidence.
   * For now accepted and stored in the input but does not change behaviour.
   */
  loadoutEngine?: string
  /**
   * Absolute path to `loadout_evidence.json` written by the typed_v1 extractor.
   * Only provided when loadout_engine='typed_v1' AND the file exists in the
   * segment directory. Task 2A-14 reads + ingests this file via
   * writeFieldEvidenceForBatch(). Accepted here but not yet acted on.
   */
  loadoutEvidenceJsonPath?: string | null
  /**
   * Pass-2 lobby extraction engine: 'typed_v1' | 'legacy'. Default 'legacy'.
   * Phase 3b — selects whether `pre_game_lobby_state_2` ingest writes typed
   * evidence (typed_v1) or only the legacy `player_loadout_snapshots` path.
   */
  lobbyEngine?: string
  /**
   * Absolute path to `lobby_evidence.json` written by the typed_v1 extractor.
   * Only provided when lobby_engine='typed_v1' AND the file exists in the
   * segment directory. Same JSON shape as loadout_evidence.json (the
   * FieldEvidenceRecord contract); ingested via writeFieldEvidenceForBatch.
   */
  lobbyEvidenceJsonPath?: string | null
  /**
   * Pass-2 segment frame count, threaded through dispatch from the video
   * pipeline orchestrator. When the segment is on a typed_v1 engine path
   * (`screen='player_loadout_view' && loadoutEngine='typed_v1'`, or
   * `screen='pre_game_lobby_state_2' && lobbyEngine='typed_v1'`) AND this
   * is provided, `ingestOcrBatch` SKIPS the legacy `runOcrCli` subprocess
   * + PNG glob entirely. Frame count comes from this field instead of
   * `cli.results.length`; one stub `ocr_extractions` row gets written per
   * segment for observability. Legacy engines ignore this field and keep
   * deriving frame count from the PNG-walking CLI as before.
   */
  frameCount?: number | null
  /**
   * Phase-A: the `ocr_decoder_runs.id` this ingest invocation belongs to.
   * When set, EVERY row written by this call (batch, segment, evidence,
   * extraction, downstream promotions) is tagged with this run_id. When
   * omitted, all rows are written with `run_id IS NULL` — the legacy
   * unmatched-batch path that pre-Phase-A code expects.
   *
   * The reprocess CLI (A3) creates a candidate run row up front and passes
   * its id here so promote-validate-activate can write into a pre-active
   * run scope.
   */
  runId?: number | null
}

export interface IngestOcrBatchResult {
  batchId: number | null
  processed: number
  succeeded: number
  failed: number
  skippedDryRun: boolean
}

/**
 * True when this segment is a typed_v1 path that does NOT need the
 * legacy game_ocr.cli subprocess to run. The typed_v1 evidence JSON
 * (produced by Pass-2's in-process typed extractors) is fully
 * independent of `cli.results`; for these segments the legacy CLI
 * call is purely observational and can be skipped, removing Pass-2's
 * dependency on PNGs-on-disk for typed_v1 segments.
 *
 * Exported for unit testing — call sites should rely on the in-line
 * carve-out check in `ingestOcrBatch`.
 */
export function isTypedV1CarveOut(
  screen: OcrScreenType,
  loadoutEngine: string,
  lobbyEngine: string,
  frameCount: number | null | undefined,
): boolean {
  if (frameCount === null || frameCount === undefined) return false
  if (screen === 'player_loadout_view' && loadoutEngine === 'typed_v1') return true
  if (screen === 'pre_game_lobby_state_2' && lobbyEngine === 'typed_v1') return true
  return false
}

/**
 * Synthesize a single stub `OcrResult` for a typed_v1 segment so the
 * downstream `persistOneResult` + `writeSegmentForBatch` pipeline runs
 * unchanged. The stub satisfies the NOT NULL constraints on
 * `ocr_extractions` (source_path, raw_result_json, ocr_backend) and
 * yields no per-field rows (the typed_v1 path writes evidence into
 * `ocr_field_evidence` directly, not via `walkExtractionFields`).
 *
 * Exported for unit testing.
 */
export function synthesizeTypedV1Stub(
  screen: OcrScreenType,
  videoSha256: string | null,
  videoSegmentIndex: number | null,
  frameCount: number,
): OcrResult {
  const segTag =
    videoSha256 && videoSegmentIndex !== null
      ? `vsha-${videoSha256.slice(0, 12)}:seg${String(videoSegmentIndex).padStart(4, '0')}`
      : `batch:${screen}`
  return {
    meta: {
      screen_type: screen,
      source_path: `<typed_v1:summary:${segTag}>`,
      processed_at: new Date().toISOString(),
      ocr_backend: 'typed_v1_summary',
      overall_confidence: null,
      duplicate_of: null,
    },
    success: true,
    errors: [],
    warnings: [],
    typed_v1_summary: {
      frame_count: frameCount,
    },
  }
}

export async function ingestOcrBatch(input: IngestOcrBatchInput): Promise<IngestOcrBatchResult> {
  const captureKind = input.captureKind ?? 'manual_screenshots'
  const matchId = input.matchId ?? null
  const loadoutEngine = input.loadoutEngine ?? 'legacy'
  const lobbyEngine = input.lobbyEngine ?? 'legacy'

  console.log(
    `[ingest-ocr] batch screen=${input.screen} dir=${input.batchDir} match=${matchId ?? 'null'}${
      input.dryRun ? ' (dry run)' : ''
    }`,
  )

  // Typed-v1 carve-out: skip the legacy Python OCR subprocess. The
  // typed_v1 evidence JSON written by Pass-2 is the source of truth for
  // these segments; the legacy CLI's per-frame extractions are purely
  // observational, replaced here by one stub `ocr_extractions` row whose
  // `overall_confidence` gets back-filled from the typed_v1 evidence
  // after `writeFieldEvidenceForBatch` runs.
  const carveOut = isTypedV1CarveOut(input.screen, loadoutEngine, lobbyEngine, input.frameCount)

  let cli: { results: OcrResult[] }
  if (carveOut) {
    const stub = synthesizeTypedV1Stub(
      input.screen,
      input.videoSha256 ?? null,
      input.videoSegmentIndex ?? null,
      input.frameCount as number,
    )
    cli = { results: [stub] }
    console.log(
      `[ingest-ocr] typed_v1 carve-out: skipping runOcrCli (frameCount=${String(input.frameCount)} from dispatch)`,
    )
  } else {
    cli = await runOcrCli({ screen: input.screen, inputPath: input.batchDir })
    console.log(`[ingest-ocr] CLI returned ${String(cli.results.length)} result(s)`)
  }

  if (input.dryRun) {
    for (const r of cli.results) {
      console.log(
        `[ingest-ocr] (dry run) ${r.meta.source_path} success=${String(r.success)} confidence=${
          r.meta.overall_confidence ?? 'null'
        }`,
      )
    }
    return {
      batchId: null,
      processed: cli.results.length,
      succeeded: 0,
      failed: 0,
      skippedDryRun: true,
    }
  }

  // Insert (or upsert, when keyed by video_sha256) the batch row up
  // front so all extractions can reference it.
  const videoSha256 = input.videoSha256 ?? null
  const runId = input.runId ?? null
  const batchValues: NewOcrCaptureBatch = {
    gameTitleId: input.gameTitleId,
    matchId,
    sourceDirectory: input.batchDir,
    captureKind,
    videoSha256,
    runId,
    notes: input.notes ?? null,
  }

  let batchRow: typeof ocrCaptureBatches.$inferSelect | undefined
  if (videoSha256) {
    // Idempotent path for video-pipeline ingests: re-running on the
    // same (sha, dir, run_id) returns the existing batch row instead of
    // inserting a duplicate. Phase-A: conflict target includes run_id so
    // v1 and v2 reprocesses for the same video produce separate batch
    // rows (each tied to its own decoder run). NULLS NOT DISTINCT on the
    // index preserves the legacy NULL-run idempotency.
    const upserted = await db
      .insert(ocrCaptureBatches)
      .values(batchValues)
      .onConflictDoUpdate({
        target: [
          ocrCaptureBatches.videoSha256,
          ocrCaptureBatches.sourceDirectory,
          ocrCaptureBatches.runId,
        ],
        targetWhere: isNotNull(ocrCaptureBatches.videoSha256),
        set: {
          matchId,
          captureKind,
          notes: input.notes ?? null,
        },
      })
      .returning()
    batchRow = upserted[0]
  } else {
    const inserted = await db.insert(ocrCaptureBatches).values(batchValues).returning()
    batchRow = inserted[0]
  }
  if (!batchRow) throw new Error('Failed to insert/upsert ocr_capture_batches row')
  const batchId = batchRow.id

  let succeeded = 0
  let failed = 0

  for (const result of cli.results) {
    try {
      await persistOneResult(batchId, matchId, result, loadoutEngine, lobbyEngine, runId)
      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ingest-ocr] failed to persist ${result.meta.source_path}: ${msg}`)
      failed++
    }
  }

  console.log(
    `[ingest-ocr] batch ${String(batchId)} done. processed=${String(cli.results.length)} succeeded=${String(succeeded)} failed=${String(failed)}`,
  )

  // Phase 0 evidence-layer adapter: emit one ocr_segments row per ingest batch.
  // The legacy pipeline treats one CLI invocation = one screen-type segment;
  // the HMM/Viterbi decoder in Phase 1 will replace this with multiple decoded
  // segments per batch. Until then, this row makes "what screen did the system
  // think it was looking at" a queryable fact instead of segments.json-on-disk.
  // Frame count: under the typed_v1 carve-out the stub `cli.results`
  // has length 1, which would lie about how many frames Pass-2 actually
  // processed. Use the Pass-2-supplied `input.frameCount` instead.
  const segmentFrameCount = carveOut ? (input.frameCount as number) : cli.results.length

  let segmentId: number | null = null
  try {
    const segRow = await writeSegmentForBatch({
      matchId,
      batchId,
      screen: input.screen,
      frameCount: segmentFrameCount,
      results: cli.results,
      videoSha256: input.videoSha256 ?? null,
      videoSegmentIndex: input.videoSegmentIndex ?? null,
      videoSegmentStartSec: input.videoSegmentStartSec ?? null,
      videoSegmentEndSec: input.videoSegmentEndSec ?? null,
      uiVersion: input.uiVersion ?? null,
      decoderVersion: input.decoderVersion ?? null,
      runId,
    })
    segmentId = segRow.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[ingest-ocr] writeSegmentForBatch(${String(batchId)}) skipped: ${msg}`)
  }

  // Collect every typed_v1 evidence record processed in this batch so the
  // carve-out stub's confidence can be back-filled from the mean calibrated
  // confidence below. A typed_v1 segment is loadout XOR lobby, but writing
  // this as a union keeps the back-fill symmetric.
  const typedV1Records: LoadoutEvidenceRecord[] = []

  // Task 2A-14: write typed_v1 loadout field evidence when the engine produced
  // a loadout_evidence.json and a segment row was successfully upserted.
  if (
    input.loadoutEvidenceJsonPath &&
    input.loadoutEngine === 'typed_v1' &&
    segmentId !== null &&
    matchId !== null
  ) {
    try {
      const jsonContent = await readFile(input.loadoutEvidenceJsonPath, 'utf-8')
      const records = JSON.parse(jsonContent) as LoadoutEvidenceRecord[]
      typedV1Records.push(...records)
      const evResult = await writeFieldEvidenceForBatch({
        matchId,
        segmentId,
        batchId,
        records,
        runId,
      })
      console.log(
        `[ingest-ocr] batch ${String(batchId)} field evidence: inserted=${String(evResult.insertedCount)} deleted=${String(evResult.deletedCount)}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[ingest-ocr] writeFieldEvidenceForBatch(${String(batchId)}) skipped: ${msg}`)
    }
  }

  // Task 3B-5: write typed_v1 lobby field evidence — same JSON contract as
  // loadout, only the screen_state differs. Reuses writeFieldEvidenceForBatch.
  if (
    input.lobbyEvidenceJsonPath &&
    input.lobbyEngine === 'typed_v1' &&
    segmentId !== null &&
    matchId !== null
  ) {
    try {
      const jsonContent = await readFile(input.lobbyEvidenceJsonPath, 'utf-8')
      const records = JSON.parse(jsonContent) as LoadoutEvidenceRecord[]
      typedV1Records.push(...records)
      const evResult = await writeFieldEvidenceForBatch({
        matchId,
        segmentId,
        batchId,
        records,
        runId,
      })
      console.log(
        `[ingest-ocr] batch ${String(batchId)} lobby field evidence: inserted=${String(evResult.insertedCount)} deleted=${String(evResult.deletedCount)}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[ingest-ocr] writeFieldEvidenceForBatch(${String(batchId)}, lobby) skipped: ${msg}`,
      )
    }
  }

  // Carve-out confidence back-fill: the stub `ocr_extractions` row was
  // written with `overall_confidence = null` because the typed_v1 evidence
  // didn't exist yet at synthesis time. Now that it's loaded, populate
  // the column with the mean `calibrated_confidence` across all evidence
  // records in this segment so match-quality + run-quality dashboards
  // surface a meaningful number.
  if (carveOut && typedV1Records.length > 0) {
    const confidences = typedV1Records
      .map((r) => r.calibrated_confidence)
      .filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
    if (confidences.length > 0) {
      const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length
      try {
        const updated = await db
          .update(ocrExtractions)
          .set({ overallConfidence: mean.toFixed(4) })
          .where(
            and(
              eq(ocrExtractions.batchId, batchId),
              eq(ocrExtractions.ocrBackend, 'typed_v1_summary'),
            ),
          )
          .returning({ id: ocrExtractions.id })
        console.log(
          `[ingest-ocr] batch ${String(batchId)} typed_v1 stub confidence back-fill: rows=${String(updated.length)} mean=${mean.toFixed(4)} (from ${String(confidences.length)} evidence records)`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[ingest-ocr] stub confidence back-fill(${String(batchId)}) skipped: ${msg}`)
      }
    }
  }

  // Task 2A-18: typed_v1 per-match loadout promotion. Runs AFTER
  // writeFieldEvidenceForBatch has written all evidence rows for this segment,
  // consuming them in a single pass across all segments for the match.
  // Legacy path keeps per-extraction promoteLoadout (guarded in index.ts).
  if (loadoutEngine === 'typed_v1' && matchId !== null) {
    try {
      const promResult = await promoteLoadoutFromEvidence({ matchId, runId })
      console.log(
        `[ingest-ocr] batch ${String(batchId)} loadout-v2: promoted=${String(promResult.promotedSnapshotCount)} blocked=${String(promResult.blockedSnapshotCount)} promotionRows=${String(promResult.promotionRowsWritten)}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[ingest-ocr] promoteLoadoutFromEvidence(${String(matchId)}) skipped: ${msg}`)
    }
  }

  // Task 3B-6: typed_v1 per-match lobby promotion. Mirrors loadout-v2 above.
  // Runs after the lobby evidence has been written (via writeFieldEvidenceForBatch
  // in the lobby-evidence block earlier). Legacy path keeps per-extraction
  // promotePreGameLobby (guarded in ocr-promoters/index.ts).
  if (lobbyEngine === 'typed_v1' && matchId !== null) {
    try {
      const promResult = await promoteLobbyFromEvidence({ matchId, runId })
      console.log(
        `[ingest-ocr] batch ${String(batchId)} lobby-v2: promoted=${String(promResult.promotedSnapshotCount)} blocked=${String(promResult.blockedSnapshotCount)} promotionRows=${String(promResult.promotionRowsWritten)}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[ingest-ocr] promoteLobbyFromEvidence(${String(matchId)}) skipped: ${msg}`)
    }
  }

  // Roll the per-frame team-colour + home/away signal up to matches.* for
  // this match. Runs once per batch so all per-screen promoters have already
  // written their ocr_extraction_fields rows.
  if (matchId !== null) {
    try {
      const agg = await applyMatchColors(matchId)
      console.log(
        `[ingest-ocr] match ${String(matchId)} colours: home=${
          agg.bgmWasHome === true ? 'BGM' : agg.bgmWasHome === false ? 'OPP' : '?'
        } bgm=${agg.bgmColorHex ?? 'null'} opp=${agg.oppColorHex ?? 'null'} samples=${String(agg.sampleCount)}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[ingest-ocr] applyMatchColors(${String(matchId)}) skipped: ${msg}`)
    }
  }

  // Recover scroll-past Action Tracker positions the per-frame pass couldn't
  // place (card and rink marker never co-visible in one frame). Runs once per
  // batch after all promoters have committed match_events. Gated on this batch
  // producing Action Tracker evidence (other screens add no marker data) and on
  // the OCR_RECONCILE_ENABLED kill switch. Best-effort: a failure here never
  // fails the batch — positions are recoverable on the next reconcile. Mirrors
  // the loadout-v2 / lobby-v2 tail blocks; this is the single swallow layer
  // (reconcilePositions itself stays honest).
  const hasActionTracker = cli.results.some(
    (r) => r.meta.screen_type === 'post_game_action_tracker' && r.success,
  )
  if (matchId !== null && hasActionTracker && process.env.OCR_RECONCILE_ENABLED !== 'false') {
    try {
      const recon = await reconcilePositions(matchId, runId)
      console.log(
        `[ingest-ocr] match ${String(matchId)} reconcile: proposed=${String(recon.proposed)} applied=${String(recon.applied)}`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[ingest-ocr] reconcilePositions(${String(matchId)}) skipped: ${msg}`)
    }
  }

  return { batchId, processed: cli.results.length, succeeded, failed, skippedDryRun: false }
}

/** SHA-256 hex of a file's bytes. The schema expects SHA-256 (`source_hash`). */
async function sha256OfFile(path: string): Promise<string> {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Phase 0 evidence-layer adapter. Writes one ocr_segments row per CLI batch.
 *
 * When called from the video pipeline orchestrator, the caller passes the
 * Pass-1 segment index + time bounds so the resulting row is keyed on
 * `${videoSha256}:seg${index}` — stable across video re-ingests so
 * `on_conflict do_update` makes the operation idempotent and the row
 * carries the real time bounds from Pass-1 decoding.
 *
 * For manual screenshot ingests, the segment_key falls back to `batch-${batchId}`
 * (each batch = one logical segment).
 *
 * Phase 1's HMM/Viterbi decoder will replace this writer with proper
 * per-state segmentation; the row's `decoder_version` tag distinguishes the
 * two paths so reports can filter.
 */
export async function writeSegmentForBatch(input: {
  matchId: number | null
  batchId: number
  screen: OcrScreenType
  frameCount: number
  results: ReadonlyArray<OcrResult>
  videoSha256: string | null
  videoSegmentIndex: number | null
  videoSegmentStartSec: number | null
  videoSegmentEndSec: number | null
  uiVersion: string | null
  decoderVersion: string | null
  /** Phase-A: decoder-run scope this segment belongs to. NULL for legacy. */
  runId: number | null
}): Promise<{ id: number }> {
  const confidences = input.results
    .map((r) => r.meta.overall_confidence)
    .filter((c): c is number => c !== null && Number.isFinite(c))
  const avgConfidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : null

  const hasVideoMeta = input.videoSha256 !== null && input.videoSegmentIndex !== null
  const segmentKey = hasVideoMeta
    ? // Stable per-video segment key — same video re-ingested produces same
      // (match_id, segment_key) so on_conflict_do_update keeps one row per
      // logical Pass-1 segment.
      `vsha-${input.videoSha256!.slice(0, 12)}:seg${String(input.videoSegmentIndex).padStart(4, '0')}`
    : `batch-${String(input.batchId)}`

  const segment: NewOcrSegment = {
    matchId: input.matchId,
    segmentKey,
    // OcrScreenType is a subset of OcrSegmentState by construction (the new
    // states `unknown_or_transition`, `loading_or_intro`, `end_of_video` don't
    // appear in the legacy enum, so the cast is total here).
    state: input.screen as unknown as OcrSegmentState,
    tStartSec: input.videoSegmentStartSec !== null ? input.videoSegmentStartSec.toFixed(3) : null,
    tEndSec: input.videoSegmentEndSec !== null ? input.videoSegmentEndSec.toFixed(3) : null,
    frameCount: input.frameCount,
    segmentConfidence: avgConfidence !== null ? avgConfidence.toFixed(4) : null,
    observabilityStatus: input.frameCount > 0 ? 'observable' : 'not_observable_from_source',
    uiVersion: input.uiVersion ?? 'nhl26',
    // Tag legacy-emitted segments so Phase 1's HMM/Viterbi rows can be
    // distinguished from this Phase-0 passthrough by a simple version filter.
    // If the caller passed an explicit decoder_version (e.g. hmm-viterbi-v1
    // from the Viterbi engine path), use it; otherwise fall back to the
    // legacy-derived value.
    decoderVersion:
      input.decoderVersion ??
      (hasVideoMeta ? 'legacy-passthrough-v0-video' : 'legacy-passthrough-v0-manual'),
    captureBatchId: input.batchId,
    runId: input.runId,
    notes: null,
  }

  // Phase-A: conflict target includes run_id so v1 and v2 segments for the
  // same (match_id, segment_key) coexist as distinct rows; the unique index
  // uses NULLS NOT DISTINCT to preserve the legacy single-NULL idempotency.
  //
  // The segment write and the parent run's provenance refresh share one
  // transaction: a rescue-like attachment of a new-decoder segment under an
  // existing run must never commit while the parent's decoder_version still
  // claims a single stale decoder (see docs/operations/decoder-provenance-
  // repair-main-sync-2026-08-16.md). No run_id -> nothing to lock or refresh.
  //
  // Lock ordering (see lockDecoderRunForProvenance for the full rationale):
  //   1. begin
  //   2. exclusive lock on the ONE parent run row  <- BEFORE the child write
  //   3. upsert the child segment
  //   4. derive + write the parent's provenance
  //   5. commit
  // Step 2 must precede step 3: the child insert itself takes FOR KEY SHARE on
  // the parent for its FK check, and FOR KEY SHARE is self-compatible, so two
  // cooperating writers for the same run that inserted first would each have to
  // escalate past the other's lock and deadlock (40P01). Locking first makes the
  // second writer queue up before it holds anything, so both commit.
  return db.transaction(async (tx) => {
    if (input.runId !== null) {
      await lockDecoderRunForProvenance(input.runId, tx as unknown as Database)
    }

    const [segRow] = await tx
      .insert(ocrSegments)
      .values(segment)
      .onConflictDoUpdate({
        target: [ocrSegments.matchId, ocrSegments.segmentKey, ocrSegments.runId],
        set: {
          state: segment.state,
          tStartSec: segment.tStartSec,
          tEndSec: segment.tEndSec,
          frameCount: segment.frameCount,
          segmentConfidence: segment.segmentConfidence,
          observabilityStatus: segment.observabilityStatus,
          uiVersion: segment.uiVersion,
          decoderVersion: segment.decoderVersion,
          captureBatchId: segment.captureBatchId,
        },
      })
      .returning({ id: ocrSegments.id })
    if (!segRow) throw new Error('writeSegmentForBatch: no row returned from upsert')

    if (input.runId !== null) {
      await refreshDecoderRunProvenance(input.runId, tx as unknown as Database)
    }

    return { id: segRow.id }
  })
}

// ─── Loadout evidence write path (Task 2A-14) ────────────────────────────────

/**
 * 1:1 mirror of FieldEvidenceRecord.to_dict() from
 * tools/game_ocr/game_ocr/loadout_evidence.py.
 * Snake_case keys match the Python JSON output and the Drizzle column names
 * (Drizzle maps camelCase ↔ snake_case via its pg column name convention).
 */
export interface LoadoutEvidenceRecord {
  screen_state: string // always "player_loadout_view"
  field_key: string
  field_family: string // 'open_text' | 'closed_vocab' | 'tabular_numeric' | 'icon' | 'geometry'
  candidate_value: unknown // string | number | object | null
  candidate_rank: number
  raw_confidence: number
  calibrated_confidence: number
  extractor_family: string
  extractor_version: string
  observability_status: string
  normalization_status: string
  screen_instance_key?: string | null
  subject_slot_key?: string | null
  support_frame_ids: number[]
  roi_bbox?: { x: number; y: number; w: number; h: number } | null
  template_version?: string | null
  row_key?: string | null
  column_key?: string | null
  x_norm?: number | null
  y_norm?: number | null
  shape_or_icon_class?: string | null
}

/**
 * Writes one `ocr_field_evidence` row per record from a typed_v1 loadout
 * extraction run.
 *
 * **Idempotency contract (Decision F):** in a single transaction, DELETE all
 * prior rows for `segmentId` regardless of extractor_family or
 * extractor_version, then bulk-INSERT the new records. The segment is the
 * atomic unit of "current truth." Stale extractor versions are NOT retained
 * in the evidence layer — audit lives in `ocr_extractions.raw_result_json`.
 */
export async function writeFieldEvidenceForBatch(input: {
  matchId: number
  segmentId: number // ocr_segments.id
  batchId: number
  records: LoadoutEvidenceRecord[]
  /**
   * Phase-A: decoder-run scope. NULL for legacy / unmatched batches. Every
   * row inserted by this call is tagged with this id so live readers can
   * filter by active-run.
   */
  runId?: number | null
}): Promise<{ insertedCount: number; deletedCount: number }> {
  return await db.transaction(async (tx) => {
    // 1. Delete ALL prior rows for this segment (scope = segment, not extractor version).
    const deleted = await tx
      .delete(ocrFieldEvidence)
      .where(eq(ocrFieldEvidence.segmentId, input.segmentId))
      .returning({ id: ocrFieldEvidence.id })

    // 2. Bulk insert new rows.
    if (input.records.length === 0) {
      return { insertedCount: 0, deletedCount: deleted.length }
    }

    const rows: NewOcrFieldEvidence[] = input.records.map((rec) => ({
      matchId: input.matchId,
      segmentId: input.segmentId,
      screenState: rec.screen_state as OcrSegmentState,
      screenInstanceKey: rec.screen_instance_key ?? null,
      subjectSlotKey: rec.subject_slot_key ?? null,
      fieldKey: rec.field_key,
      fieldFamily: rec.field_family as NewOcrFieldEvidence['fieldFamily'],
      candidateValue: rec.candidate_value as NewOcrFieldEvidence['candidateValue'],
      candidateRank: rec.candidate_rank,
      rawConfidence: rec.raw_confidence.toString(),
      calibratedConfidence: rec.calibrated_confidence.toString(),
      supportFrameIds: rec.support_frame_ids,
      roiBbox: (rec.roi_bbox ?? null) as NewOcrFieldEvidence['roiBbox'],
      templateVersion: rec.template_version ?? null,
      extractorFamily: rec.extractor_family as NewOcrFieldEvidence['extractorFamily'],
      extractorVersion: rec.extractor_version,
      observabilityStatus: rec.observability_status as NewOcrFieldEvidence['observabilityStatus'],
      normalizationStatus: rec.normalization_status as NewOcrFieldEvidence['normalizationStatus'],
      rowKey: rec.row_key ?? null,
      columnKey: rec.column_key ?? null,
      xNorm: rec.x_norm != null ? rec.x_norm.toString() : null,
      yNorm: rec.y_norm != null ? rec.y_norm.toString() : null,
      shapeOrIconClass: rec.shape_or_icon_class ?? null,
      runId: input.runId ?? null,
    }))

    const inserted = await tx
      .insert(ocrFieldEvidence)
      .values(rows)
      .returning({ id: ocrFieldEvidence.id })

    return { insertedCount: inserted.length, deletedCount: deleted.length }
  })
}

async function persistOneResult(
  batchId: number,
  matchId: number | null,
  result: OcrResult,
  loadoutEngine: string,
  lobbyEngine: string,
  runId: number | null,
): Promise<void> {
  const sourcePath = result.meta.source_path
  const sourceHash = await sha256OfFile(sourcePath).catch(() => null)

  await db.transaction(async (tx) => {
    const [ext] = await tx
      .insert(ocrExtractions)
      .values({
        batchId,
        matchId,
        screenType: result.meta.screen_type,
        sourcePath,
        sourceHash,
        ocrBackend: result.meta.ocr_backend,
        overallConfidence:
          result.meta.overall_confidence !== null
            ? result.meta.overall_confidence.toFixed(4)
            : null,
        rawResultJson: result as unknown as object,
        transformStatus: 'pending',
        transformError: null,
        runId,
      })
      .onConflictDoUpdate({
        // (batch_id, source_path) is transitively run-scoped via the batch
        // row's run_id, so no need to add run_id to the conflict target.
        target: [ocrExtractions.batchId, ocrExtractions.sourcePath],
        set: {
          screenType: result.meta.screen_type,
          sourceHash,
          ocrBackend: result.meta.ocr_backend,
          overallConfidence:
            result.meta.overall_confidence !== null
              ? result.meta.overall_confidence.toFixed(4)
              : null,
          rawResultJson: result as unknown as object,
          transformStatus: 'pending',
          transformError: null,
          runId,
        },
      })
      .returning()

    if (!ext) throw new Error(`Failed to upsert ocr_extractions for ${sourcePath}`)

    // Idempotent re-runs: clear and re-insert fields for this extraction.
    await tx.delete(ocrExtractionFields).where(eq(ocrExtractionFields.extractionId, ext.id))
    const fieldRows = walkExtractionFields(result, ext.id)
    if (fieldRows.length > 0) {
      await tx.insert(ocrExtractionFields).values(fieldRows)
    }

    if (!result.success) {
      // Failed extractions still get a row in ocr_extractions for audit.
      // No promoter dispatch.
      await tx
        .update(ocrExtractions)
        .set({
          transformStatus: 'error',
          transformError: result.errors.join('; ') || 'parser failed',
        })
        .where(eq(ocrExtractions.id, ext.id))
      return
    }

    // Typed-v1 carve-out stub: the row is purely observational. The
    // promoter dispatch is owned by the typed_v1 evidence path
    // (`writeFieldEvidenceForBatch` + `promoteLoadoutFromEvidence` /
    // `promoteLobbyFromEvidence`), which runs separately after this
    // function returns. Mark success and exit.
    if (result.meta.ocr_backend === 'typed_v1_summary') {
      await tx
        .update(ocrExtractions)
        .set({ transformStatus: 'success', transformError: null })
        .where(eq(ocrExtractions.id, ext.id))
      return
    }

    // Dispatch to per-screen promoter. Promoter sets transform_status itself.
    const promoter = getPromoter(result.meta.screen_type)
    if (!promoter) {
      // Unknown screen type — record as success but no promotion.
      await tx
        .update(ocrExtractions)
        .set({ transformStatus: 'success', transformError: null })
        .where(eq(ocrExtractions.id, ext.id))
      return
    }

    try {
      await promoter({
        result,
        extractionId: ext.id,
        matchId,
        sourcePath,
        loadoutEngine,
        lobbyEngine,
        db: tx as PromoterDb,
      })
      await tx
        .update(ocrExtractions)
        .set({ transformStatus: 'success', transformError: null })
        .where(eq(ocrExtractions.id, ext.id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await tx
        .update(ocrExtractions)
        .set({ transformStatus: 'error', transformError: msg })
        .where(eq(ocrExtractions.id, ext.id))
      // Do not rethrow — promoter failures should not abort the per-result transaction
      // for the extraction row itself, which has already been persisted.
    }
  })
}

// ─── Field walkers ────────────────────────────────────────────────────────────

/**
 * Heuristic check: an object with raw_text/value/confidence/status keys is an
 * ExtractionField. Mirrors the Pydantic shape from tools/game_ocr/game_ocr/models.py.
 */
function isExtractionField(v: unknown): v is OcrExtractionField {
  if (typeof v !== 'object' || v === null) return false
  const keys = Object.keys(v as Record<string, unknown>)
  return keys.includes('status') && keys.includes('confidence')
}

function fieldRow(
  extractionId: number,
  entityType: OcrEntityType,
  entityKey: string | null,
  fieldKey: string,
  field: OcrExtractionField,
): NewOcrExtractionField {
  return {
    extractionId,
    entityType,
    entityKey,
    fieldKey,
    rawText: field.raw_text ?? null,
    parsedValueJson: { value: field.value },
    confidence: field.confidence !== null ? field.confidence.toFixed(4) : null,
    status: (field.status ?? 'missing') as OcrFieldStatus,
  }
}

/**
 * Top-level dispatcher. Per-screen walker functions handle each result shape.
 * Always emits at least the 4 standard meta fields if present.
 */
export function walkExtractionFields(
  result: OcrResult,
  extractionId: number,
): NewOcrExtractionField[] {
  const rows: NewOcrExtractionField[] = []
  switch (result.meta.screen_type) {
    case 'pre_game_lobby_state_1':
    case 'pre_game_lobby_state_2':
      walkPreGameLobby(result, extractionId, rows)
      break
    case 'player_loadout_view':
      walkPlayerLoadout(result, extractionId, rows)
      break
    case 'post_game_player_summary':
      walkPostGamePlayerSummary(result, extractionId, rows)
      break
    case 'post_game_box_score_goals':
    case 'post_game_box_score_shots':
    case 'post_game_box_score_faceoffs':
      walkPostGameBoxScore(result, extractionId, rows)
      break
    case 'post_game_net_chart':
      walkPostGameNetChart(result, extractionId, rows)
      break
    case 'post_game_faceoff_map':
      walkPostGameFaceoffMap(result, extractionId, rows)
      break
    case 'post_game_events':
      walkPostGameEvents(result, extractionId, rows)
      break
    case 'post_game_action_tracker':
      walkPostGameActionTracker(result, extractionId, rows)
      break
    default:
      walkGenericTopLevel(result, extractionId, rows)
      break
  }
  return rows
}

function walkPostGameActionTracker(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // home_color_hex / away_color_hex are per-frame team-colour samples taken
  // from the trapezoid ROIs behind each goal; the aggregator collapses them
  // across all action_tracker captures for a match.
  for (const key of ['filter_label', 'period_label', 'home_color_hex', 'away_color_hex']) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  const events = result.events
  if (!Array.isArray(events)) return
  events.forEach((ev, i) => {
    if (typeof ev !== 'object' || ev === null) return
    const e = ev as Record<string, unknown>
    const idxKey = String(i)
    for (const fk of ['raw_text', 'actor_snapshot', 'target_snapshot', 'relation', 'clock']) {
      if (isExtractionField(e[fk])) {
        rows.push(fieldRow(extractionId, 'event', idxKey, fk, e[fk]))
      }
    }
  })
}

function walkPostGameEvents(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  if (isExtractionField(result.filter_label)) {
    rows.push(fieldRow(extractionId, 'match', null, 'filter_label', result.filter_label))
  }
  const events = result.events
  if (!Array.isArray(events)) return
  events.forEach((ev, i) => {
    if (typeof ev !== 'object' || ev === null) return
    const e = ev as Record<string, unknown>
    const idxKey = String(i)
    for (const fk of [
      'raw_text',
      'team_abbreviation',
      'clock',
      'actor_snapshot',
      'goal_number_in_game',
      'infraction',
      'penalty_type',
    ]) {
      if (isExtractionField(e[fk])) {
        rows.push(fieldRow(extractionId, 'event', idxKey, fk, e[fk]))
      }
    }
    const assists = e.assists_snapshot
    if (Array.isArray(assists)) {
      assists.forEach((a, ai) => {
        if (isExtractionField(a)) {
          rows.push(fieldRow(extractionId, 'event', idxKey, `assist.${String(ai)}`, a))
        }
      })
    }
  })
}

function walkPostGameNetChart(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // home_team_abbr / away_team_abbr ride along as match-level fields so the
  // match-color aggregator can read them by field_key without reparsing the
  // raw home_label / away_label text.
  for (const key of [
    'period_label',
    'away_label',
    'home_label',
    'away_team_abbr',
    'home_team_abbr',
    'away_header_total_shots',
    'home_header_total_shots',
  ]) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  for (const sideKey of ['away', 'home'] as const) {
    const block = result[sideKey] as Record<string, unknown> | undefined
    if (!block || typeof block !== 'object') continue
    for (const [statKey, statField] of Object.entries(block)) {
      if (isExtractionField(statField)) {
        rows.push(fieldRow(extractionId, 'team', sideKey, statKey, statField))
      }
    }
  }
}

function walkPostGameFaceoffMap(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // Match-level: period + team labels + parsed abbreviations (the match-color
  // aggregator and the promoter both read these by field_key).
  for (const key of [
    'period_label',
    'away_label',
    'home_label',
    'away_team_abbr',
    'home_team_abbr',
  ]) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  // Per-side text-panel fields: overall_win_pct + verbatim zone strings +
  // parsed zone wins/total ints.
  for (const sideKey of ['away', 'home'] as const) {
    const block = result[sideKey] as Record<string, unknown> | undefined
    if (!block || typeof block !== 'object') continue
    for (const [statKey, statField] of Object.entries(block)) {
      if (isExtractionField(statField)) {
        rows.push(fieldRow(extractionId, 'team', sideKey, statKey, statField))
      }
    }
  }
  // Per-dot wins: entity_type='faceoff_dot', entity_key=<dot_id>,
  // field_key='away_wins'|'home_wins'.
  const dots = result.dots
  if (dots && typeof dots === 'object') {
    for (const [dotId, dot] of Object.entries(dots as Record<string, unknown>)) {
      if (!dot || typeof dot !== 'object') continue
      const d = dot as Record<string, unknown>
      if (isExtractionField(d.away_wins)) {
        rows.push(fieldRow(extractionId, 'faceoff_dot', dotId, 'away_wins', d.away_wins))
      }
      if (isExtractionField(d.home_wins)) {
        rows.push(fieldRow(extractionId, 'faceoff_dot', dotId, 'home_wins', d.home_wins))
      }
    }
  }
}

function walkPostGameBoxScore(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // Top-level scalars.
  for (const key of ['tab_label', 'away_team', 'home_team']) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  // Period header columns (audit/debug — not strictly needed but useful for review).
  const headers = result.period_headers
  if (Array.isArray(headers)) {
    headers.forEach((h, i) => {
      if (isExtractionField(h)) {
        rows.push(fieldRow(extractionId, 'team', null, `period_headers.${String(i)}`, h))
      }
    })
  }
  // Period cells: emit one row per (period, side) numeric value.
  const periods = result.periods
  if (!Array.isArray(periods)) return
  periods.forEach((p, _i) => {
    if (typeof p !== 'object' || p === null) return
    const cell = p as {
      period_label?: string
      period_number?: number
      away_value?: unknown
      home_value?: unknown
    }
    const label = cell.period_label ?? '?'
    if (isExtractionField(cell.away_value)) {
      rows.push(fieldRow(extractionId, 'team', 'away', `period.${label}`, cell.away_value))
    }
    if (isExtractionField(cell.home_value)) {
      rows.push(fieldRow(extractionId, 'team', 'home', `period.${label}`, cell.home_value))
    }
  })
}

/** Generic fallback: walk top-level ExtractionField properties only. */
function walkGenericTopLevel(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  for (const [key, value] of Object.entries(result)) {
    if (key === 'meta' || key === 'success' || key === 'errors' || key === 'warnings') continue
    if (isExtractionField(value)) {
      rows.push(fieldRow(extractionId, 'match', null, key, value))
    }
  }
}

function walkPreGameLobby(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // Top-level scalars.
  for (const key of ['game_mode', 'our_team_name', 'opponent_team_name']) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'match', null, key, v))
  }
  // Two team panels.
  for (const [teamKey, teamSide] of [
    ['our_team', 'for'],
    ['opponent_team', 'against'],
  ] as const) {
    const team = result[teamKey] as
      | { roster?: Array<{ slot_index?: number; fields?: Record<string, unknown> }> }
      | undefined
    if (!team || !Array.isArray(team.roster)) continue
    for (const slot of team.roster) {
      const slotKey = String(slot.slot_index ?? '')
      const entityKey = `${teamSide}:${slotKey}`
      const fields = slot.fields ?? {}
      for (const [fk, fv] of Object.entries(fields)) {
        if (isExtractionField(fv)) {
          rows.push(fieldRow(extractionId, 'player', entityKey, fk, fv))
        }
      }
    }
  }
}

function walkPlayerLoadout(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  // Top-level loadout scalars. The legacy keys (selected_player, home_team) are
  // kept in the list so old extractions still flatten cleanly; new captures from
  // the post-2026-05 parser emit MISSING for those and skip the row via
  // isExtractionField().
  const scalarKeys = [
    'selected_player',
    'player_position',
    'player_name',
    'player_name_full',
    'player_number',
    'player_level',
    'player_platform',
    'gamertag',
    'home_team',
    'is_captain',
    'build_class',
    'height',
    'weight',
    'handedness',
    'ap_used',
    'ap_total',
  ]
  for (const key of scalarKeys) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'loadout', null, key, v))
  }
  // X-factors: positional list. New parser also emits a parallel x_factor_tiers list.
  const xFactors = result.x_factors
  if (Array.isArray(xFactors)) {
    xFactors.forEach((xf, i) => {
      if (isExtractionField(xf)) {
        rows.push(fieldRow(extractionId, 'loadout', null, `x_factor.${String(i)}`, xf))
      }
    })
  }
  const xFactorTiers = result.x_factor_tiers
  if (Array.isArray(xFactorTiers)) {
    xFactorTiers.forEach((xt, i) => {
      if (isExtractionField(xt)) {
        rows.push(fieldRow(extractionId, 'loadout', null, `x_factor_tier.${String(i)}`, xt))
      }
    })
  }
  // Icon glyph template match — far more reliable for the X-Factor
  // NAME than OCR'ing the stylized text label below the icon. Each
  // slot's `value` is `{ name, confidence }` (or null when no
  // template cleared the matcher's confidence threshold).
  const xFactorIconMatches = result.x_factor_icon_matches
  if (Array.isArray(xFactorIconMatches)) {
    xFactorIconMatches.forEach((xm, i) => {
      if (isExtractionField(xm)) {
        rows.push(fieldRow(extractionId, 'loadout', null, `x_factor_icon_match.${String(i)}`, xm))
      }
    })
  }
  // Attribute groups.
  const attrs = result.attributes
  if (attrs && typeof attrs === 'object') {
    for (const [groupKey, group] of Object.entries(attrs as Record<string, unknown>)) {
      const values = (group as { values?: Record<string, unknown> }).values ?? {}
      for (const [attrKey, attrVal] of Object.entries(values)) {
        if (isExtractionField(attrVal)) {
          rows.push(
            fieldRow(extractionId, 'loadout', null, `attributes.${groupKey}.${attrKey}`, attrVal),
          )
        }
      }
    }
  }
  // Per-attribute Δ chips. Flat dict keyed by attribute_key (no group prefix).
  const attrDeltas = result.attribute_deltas
  if (attrDeltas && typeof attrDeltas === 'object') {
    for (const [attrKey, deltaVal] of Object.entries(attrDeltas as Record<string, unknown>)) {
      if (isExtractionField(deltaVal)) {
        rows.push(fieldRow(extractionId, 'loadout', null, `attribute_delta.${attrKey}`, deltaVal))
      }
    }
  }
}

function walkPostGamePlayerSummary(
  result: OcrResult,
  extractionId: number,
  rows: NewOcrExtractionField[],
): void {
  for (const key of [
    'away_team',
    'away_team_abbreviation',
    'away_team_final_score',
    'home_team',
    'home_team_abbreviation',
    'home_team_final_score',
  ]) {
    const v = result[key]
    if (isExtractionField(v)) rows.push(fieldRow(extractionId, 'team', null, key, v))
  }
  const players = result.players
  if (!Array.isArray(players)) return
  players.forEach((p, i) => {
    if (typeof p !== 'object' || p === null) return
    const rec = p as Record<string, unknown>
    const side = typeof rec.side === 'string' ? rec.side : 'unknown'
    const gamertagField = isExtractionField(rec.gamertag) ? rec.gamertag : null
    const gamertagValue =
      gamertagField && typeof gamertagField.value === 'string' ? gamertagField.value : null
    const entityKey = gamertagValue ?? `${side}:${String(i)}`
    for (const [fk, fv] of Object.entries(rec)) {
      if (fk === 'side') continue
      if (isExtractionField(fv)) rows.push(fieldRow(extractionId, 'player', entityKey, fk, fv))
    }
  })
}

// Suppress unused import warning for sql; it's exported for downstream use.
void sql
