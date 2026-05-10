/**
 * Review/promotion CLI for OCR-derived data.
 *
 * Promoter rows always start at review_status='pending_review'. UI queries
 * filter to review_status='reviewed' before surfacing, so nothing OCR-derived
 * appears on the site until an operator promotes it.
 *
 * Usage:
 *   # Approve a single extraction (and cascade to all rows referencing it).
 *   pnpm --filter worker ingest-ocr-review --extraction 42 --status reviewed
 *
 *   # Reject a single extraction.
 *   pnpm --filter worker ingest-ocr-review --extraction 42 --status rejected
 *
 *   # Auto-approve every extraction in a batch above a confidence threshold.
 *   # Cascades from ocr_extractions → match_events / match_period_summaries /
 *   # match_shot_type_summaries / player_loadout_snapshots.
 *   pnpm --filter worker ingest-ocr-review --batch 7 --auto-approve --confidence-threshold 0.85
 *
 *   # List batches and extraction-status counts.
 *   pnpm --filter worker ingest-ocr-review status
 *
 * Cascading: a flip on ocr_extractions.review_status only updates the
 * promoter tables that reference that extraction via ocr_extraction_id.
 * It does NOT walk transitively — if you flip an extraction whose rows have
 * already been promoted by a different extraction (cross-screen dedup), only
 * the rows pointed at by the current extraction id move.
 */

import {
  db,
  sql as dbSql,
  ocrCaptureBatches,
  ocrExtractions,
  matchEvents,
  matchPeriodSummaries,
  matchShotTypeSummaries,
  playerLoadoutSnapshots,
  type OcrReviewStatus,
} from '@eanhl/db'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'

const isStatus = process.argv.includes('status')

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

interface CascadeCounts {
  events: number
  periodSummaries: number
  shotTypeSummaries: number
  loadoutSnapshots: number
}

async function setExtractionStatus(
  extractionIds: number[],
  status: OcrReviewStatus,
): Promise<CascadeCounts> {
  if (extractionIds.length === 0) {
    return { events: 0, periodSummaries: 0, shotTypeSummaries: 0, loadoutSnapshots: 0 }
  }

  const counts: CascadeCounts = {
    events: 0,
    periodSummaries: 0,
    shotTypeSummaries: 0,
    loadoutSnapshots: 0,
  }

  // Use a single transaction so the extraction flip and all cascades commit together.
  await db.transaction(async (tx) => {
    const reviewedAt = status === 'pending_review' ? null : new Date()
    await tx
      .update(ocrExtractions)
      .set({ reviewStatus: status, reviewedAt })
      .where(inArray(ocrExtractions.id, extractionIds))

    const eventsRows = await tx
      .update(matchEvents)
      .set({ reviewStatus: status })
      .where(inArray(matchEvents.ocrExtractionId, extractionIds))
      .returning({ id: matchEvents.id })
    counts.events = eventsRows.length

    const periodRows = await tx
      .update(matchPeriodSummaries)
      .set({ reviewStatus: status })
      .where(inArray(matchPeriodSummaries.ocrExtractionId, extractionIds))
      .returning({ id: matchPeriodSummaries.id })
    counts.periodSummaries = periodRows.length

    const shotTypeRows = await tx
      .update(matchShotTypeSummaries)
      .set({ reviewStatus: status })
      .where(inArray(matchShotTypeSummaries.ocrExtractionId, extractionIds))
      .returning({ id: matchShotTypeSummaries.id })
    counts.shotTypeSummaries = shotTypeRows.length

    const loadoutRows = await tx
      .update(playerLoadoutSnapshots)
      .set({ reviewStatus: status })
      .where(inArray(playerLoadoutSnapshots.sourceExtractionId, extractionIds))
      .returning({ id: playerLoadoutSnapshots.id })
    counts.loadoutSnapshots = loadoutRows.length
  })

  return counts
}

async function autoApproveBatch(batchId: number, confidenceThreshold: number): Promise<{
  candidates: number
  approved: CascadeCounts
}> {
  const candidates = await db
    .select({ id: ocrExtractions.id, conf: ocrExtractions.overallConfidence })
    .from(ocrExtractions)
    .where(
      and(
        eq(ocrExtractions.batchId, batchId),
        eq(ocrExtractions.reviewStatus, 'pending_review'),
        eq(ocrExtractions.transformStatus, 'success'),
        gte(
          ocrExtractions.overallConfidence,
          confidenceThreshold.toFixed(4) as unknown as string,
        ),
      ),
    )
  const ids = candidates.map((c) => c.id)
  const approved = await setExtractionStatus(ids, 'reviewed')
  return { candidates: ids.length, approved }
}

async function showStatus(): Promise<void> {
  // Per-batch summary.
  const rows = await db.execute<{
    batch_id: number
    capture_kind: string
    match_id: number | null
    extraction_count: string
    pending_count: string
    reviewed_count: string
    rejected_count: string
    avg_conf: string | null
  }>(
    sql`
      SELECT
        b.id AS batch_id,
        b.capture_kind,
        b.match_id,
        COUNT(e.id)::text AS extraction_count,
        COUNT(*) FILTER (WHERE e.review_status = 'pending_review')::text AS pending_count,
        COUNT(*) FILTER (WHERE e.review_status = 'reviewed')::text AS reviewed_count,
        COUNT(*) FILTER (WHERE e.review_status = 'rejected')::text AS rejected_count,
        ROUND(AVG(e.overall_confidence)::numeric, 4)::text AS avg_conf
      FROM ${ocrCaptureBatches} b
      LEFT JOIN ${ocrExtractions} e ON e.batch_id = b.id
      GROUP BY b.id, b.capture_kind, b.match_id
      ORDER BY b.id
    `,
  )
  const arr = rows as unknown as Array<{
    batch_id: number
    capture_kind: string
    match_id: number | null
    extraction_count: string
    pending_count: string
    reviewed_count: string
    rejected_count: string
    avg_conf: string | null
  }>
  if (arr.length === 0) {
    console.log('[review] no OCR batches found.')
    return
  }
  console.log('[review] batch summary:')
  console.log('  batch  match  capture_kind         total  pending  reviewed  rejected  avg_conf')
  for (const r of arr) {
    const matchStr = r.match_id !== null ? String(r.match_id) : '—'
    console.log(
      `  ${String(r.batch_id).padStart(5)}  ${matchStr.padStart(5)}  ${(r.capture_kind ?? '').padEnd(20)}  ${r.extraction_count.padStart(5)}  ${r.pending_count.padStart(7)}  ${r.reviewed_count.padStart(8)}  ${r.rejected_count.padStart(8)}  ${r.avg_conf ?? '—'}`,
    )
  }
}

function logCascade(prefix: string, counts: CascadeCounts): void {
  console.log(
    `[review] ${prefix}: events=${String(counts.events)} period_summaries=${String(counts.periodSummaries)} shot_type_summaries=${String(counts.shotTypeSummaries)} loadout_snapshots=${String(counts.loadoutSnapshots)}`,
  )
}

async function main(): Promise<void> {
  if (isStatus) {
    await showStatus()
    return
  }

  const extractionIdStr = getFlag('extraction')
  const batchIdStr = getFlag('batch')
  const statusStr = getFlag('status') as OcrReviewStatus | undefined
  const isAutoApprove = process.argv.includes('--auto-approve')
  const confidenceStr = getFlag('confidence-threshold')

  if (extractionIdStr) {
    const extractionId = Number.parseInt(extractionIdStr, 10)
    if (!Number.isFinite(extractionId)) throw new Error(`Invalid --extraction: ${extractionIdStr}`)
    const status = statusStr ?? 'reviewed'
    if (status !== 'reviewed' && status !== 'rejected' && status !== 'pending_review') {
      throw new Error(`Invalid --status: ${String(status)}`)
    }
    console.log(`[review] flipping extraction ${String(extractionId)} → ${status}`)
    const counts = await setExtractionStatus([extractionId], status)
    logCascade('cascade', counts)
    return
  }

  if (batchIdStr) {
    const batchId = Number.parseInt(batchIdStr, 10)
    if (!Number.isFinite(batchId)) throw new Error(`Invalid --batch: ${batchIdStr}`)

    if (isAutoApprove) {
      const threshold = confidenceStr ? Number.parseFloat(confidenceStr) : 0.85
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`Invalid --confidence-threshold: ${String(confidenceStr)}`)
      }
      console.log(
        `[review] auto-approving batch ${String(batchId)} (threshold=${threshold.toFixed(4)})`,
      )
      const { candidates, approved } = await autoApproveBatch(batchId, threshold)
      console.log(`[review] approved ${String(candidates)} extraction(s)`)
      logCascade('cascade', approved)
      return
    }

    // Bulk flip the entire batch (any confidence) to a status.
    const status = statusStr ?? 'reviewed'
    if (status !== 'reviewed' && status !== 'rejected' && status !== 'pending_review') {
      throw new Error(`Invalid --status: ${String(status)}`)
    }
    const candidates = await db
      .select({ id: ocrExtractions.id })
      .from(ocrExtractions)
      .where(eq(ocrExtractions.batchId, batchId))
    const ids = candidates.map((c) => c.id)
    console.log(
      `[review] flipping ${String(ids.length)} extraction(s) in batch ${String(batchId)} → ${status}`,
    )
    const counts = await setExtractionStatus(ids, status)
    logCascade('cascade', counts)
    return
  }

  console.log('Usage:')
  console.log('  pnpm --filter worker ingest-ocr-review status')
  console.log('  pnpm --filter worker ingest-ocr-review --extraction <id> [--status reviewed|rejected]')
  console.log('  pnpm --filter worker ingest-ocr-review --batch <id> --auto-approve [--confidence-threshold 0.85]')
  console.log('  pnpm --filter worker ingest-ocr-review --batch <id> --status reviewed|rejected')
}

main()
  .catch((err: unknown) => {
    console.error('[review] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
