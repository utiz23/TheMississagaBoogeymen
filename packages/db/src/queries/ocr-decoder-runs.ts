import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db, type Database } from '../client.js'
import {
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  ocrSegments,
} from '../schema/index.js'

/**
 * GAP (3): keep the decoder-run ledger consistent for association-flow matches.
 *
 * Migration 0048_phase_a_decoder_runs.sql backfilled one synthetic active
 * `ocr_decoder_runs` row per match that had OCR data at migration time, and
 * cascaded its `run_id` onto every match-linked row across five tables. Matches
 * confirmed through the reel→match association flow AFTER that migration never
 * got a run: `confirmAssociation` stamped `ocr_capture_batches.match_id` but
 * created no run and set no `run_id`. The result — run-less batches/segments and
 * zero active runs — violates the invariants 0048 established.
 *
 * `ensureSyntheticActiveRunForMatch` reproduces 0048's synthetic-backfill
 * semantics for a single match so the association flow (and a one-time backfill)
 * produce the exact ledger shape 0048 would have. It is idempotent: an existing
 * active run is reused, and only NULL-`run_id` rows are cascaded.
 */

const SYNTHETIC_WEIGHTS_HASH = 'synthetic-backfill-no-weights-hash'
const SYNTHETIC_CONFIG_HASH = 'synthetic-backfill-no-config-hash'

export interface EnsureRunResult {
  /** The active run id for the match, or null when the match has no capture batches yet. */
  runId: number | null
  /** True when this call created the run (false when an active run already existed). */
  created: boolean
  /** Count of rows whose run_id was cascaded, per table. */
  cascaded: {
    batches: number
    segments: number
    fieldEvidence: number
    extractions: number
    promotions: number
  }
}

/**
 * Ensure a synthetic active decoder run exists for `matchId` and cascade its
 * `run_id` onto every match-linked row (batches, segments, field evidence,
 * extractions, promotions) that still has `run_id IS NULL`.
 *
 * Provenance is computed from the match's own match-linked rows, mirroring 0048:
 *   - `video_sha256`: one distinct non-null sha across the match's batches AND
 *     no manual (NULL-sha) batch → that sha; otherwise NULL.
 *   - `decoder_version`: one distinct non-null decoder across the match's
 *     segments → that value; multiple → `'legacy-mixed'`; none → `'unknown'`.
 *   - `notes` start with `'synthetic backfill'` and disclose `videos=[…]` /
 *     `decoders=[…]`, so the ocr-decoder-runs-backfill provenance tests validate
 *     these runs identically to migration-0048 runs.
 *
 * No-op guard: a match with zero capture batches gets no run (a returned
 * `runId: null`). 0048 only created a run for a match with ≥1 match-linked
 * batch, and its orphan-run invariant forbids an active run that owns none.
 *
 * MUST run inside a transaction — pass the transaction as `conn` (the create +
 * five cascades must be atomic). Callers follow the repo idiom of
 * `tx as unknown as Database`.
 */
export async function ensureSyntheticActiveRunForMatch(
  matchId: number,
  conn: Database,
): Promise<EnsureRunResult> {
  const emptyCascade = {
    batches: 0,
    segments: 0,
    fieldEvidence: 0,
    extractions: 0,
    promotions: 0,
  }

  const [existing] = await conn
    .select({ id: ocrDecoderRuns.id })
    .from(ocrDecoderRuns)
    .where(and(eq(ocrDecoderRuns.matchId, matchId), eq(ocrDecoderRuns.isActive, true)))
    .limit(1)

  let runId: number
  let created: boolean

  if (existing) {
    runId = existing.id
    created = false
  } else {
    const batches = await conn
      .select({ videoSha256: ocrCaptureBatches.videoSha256 })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.matchId, matchId))

    // No batches → no run (mirrors 0048; avoids an orphan active run).
    if (batches.length === 0) {
      return { runId: null, created: false, cascaded: emptyCascade }
    }

    const distinctShas = Array.from(
      new Set(batches.map((b) => b.videoSha256).filter((s): s is string => s !== null)),
    )
    const hasManual = batches.some((b) => b.videoSha256 === null)
    const chosenSha = distinctShas.length === 1 && !hasManual ? distinctShas[0]! : null

    const segs = await conn
      .select({ decoderVersion: ocrSegments.decoderVersion })
      .from(ocrSegments)
      .where(eq(ocrSegments.matchId, matchId))
    const distinctDecoders = Array.from(
      new Set(segs.map((s) => s.decoderVersion).filter((d): d is string => d != null)),
    )
    const chosenDecoder =
      distinctDecoders.length === 0
        ? 'unknown'
        : distinctDecoders.length === 1
          ? distinctDecoders[0]!
          : 'legacy-mixed'

    const notes =
      `synthetic backfill (association-confirm): ` +
      `videos=[${distinctShas.join(', ') || 'none'}] ` +
      `decoders=[${distinctDecoders.join(', ') || 'none'}] ` +
      `has_manual=${hasManual}`

    const [inserted] = await conn
      .insert(ocrDecoderRuns)
      .values({
        matchId,
        videoSha256: chosenSha,
        decoderVersion: chosenDecoder,
        weightsHash: SYNTHETIC_WEIGHTS_HASH,
        configHash: SYNTHETIC_CONFIG_HASH,
        isActive: true,
        notes,
      })
      .returning({ id: ocrDecoderRuns.id })
    if (!inserted) {
      throw new Error(
        `ensureSyntheticActiveRunForMatch: insert returned no row for match ${matchId}`,
      )
    }
    runId = inserted.id
    created = true
  }

  // Cascade run_id onto NULL-run_id match-linked rows across the five tables.
  const batchesN = (
    await conn
      .update(ocrCaptureBatches)
      .set({ runId })
      .where(and(eq(ocrCaptureBatches.matchId, matchId), isNull(ocrCaptureBatches.runId)))
      .returning({ id: ocrCaptureBatches.id })
  ).length
  const segmentsN = (
    await conn
      .update(ocrSegments)
      .set({ runId })
      .where(and(eq(ocrSegments.matchId, matchId), isNull(ocrSegments.runId)))
      .returning({ id: ocrSegments.id })
  ).length
  const fieldEvidenceN = (
    await conn
      .update(ocrFieldEvidence)
      .set({ runId })
      .where(and(eq(ocrFieldEvidence.matchId, matchId), isNull(ocrFieldEvidence.runId)))
      .returning({ id: ocrFieldEvidence.id })
  ).length
  const extractionsN = (
    await conn
      .update(ocrExtractions)
      .set({ runId })
      .where(and(eq(ocrExtractions.matchId, matchId), isNull(ocrExtractions.runId)))
      .returning({ id: ocrExtractions.id })
  ).length
  const promotionsN = (
    await conn
      .update(ocrPromotions)
      .set({ runId })
      .where(and(eq(ocrPromotions.matchId, matchId), isNull(ocrPromotions.runId)))
      .returning({ id: ocrPromotions.id })
  ).length

  return {
    runId,
    created,
    cascaded: {
      batches: batchesN,
      segments: segmentsN,
      fieldEvidence: fieldEvidenceN,
      extractions: extractionsN,
      promotions: promotionsN,
    },
  }
}

/**
 * One-time / maintenance wrapper: run `ensureSyntheticActiveRunForMatch` for a
 * single match inside its own transaction (atomic create + cascade). Safe to
 * re-run — idempotent once the match is linked.
 */
export async function backfillRunLinkageForMatch(matchId: number): Promise<EnsureRunResult> {
  return db.transaction(async (tx) =>
    ensureSyntheticActiveRunForMatch(matchId, tx as unknown as Database),
  )
}

/**
 * Discover every match that has ≥1 match-linked capture batch whose `run_id`
 * is still NULL — i.e. the matches the association-confirm bug left run-less.
 * Ordered ascending for stable, reproducible backfill runs.
 */
export async function findMatchesNeedingRunLinkage(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ matchId: ocrCaptureBatches.matchId })
    .from(ocrCaptureBatches)
    .where(and(isNotNull(ocrCaptureBatches.matchId), isNull(ocrCaptureBatches.runId)))
  return rows
    .map((r) => r.matchId)
    .filter((m): m is number => m != null)
    .sort((a, b) => a - b)
}
