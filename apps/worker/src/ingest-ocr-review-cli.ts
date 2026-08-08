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
 * The cascade itself lives in `lib/review-cascade.ts`, shared with
 * `auto-drain-cli.ts`. This CLI is the hand-driven front end for it.
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
  type OcrReviewStatus,
} from '@eanhl/db'
import { liveRunFilter } from '@eanhl/db/queries'
import { and, eq, gte, sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import {
  formatCascadeCounts,
  setExtractionStatus,
  PERIOD_SUMMARY_PROVENANCE_GAP,
  PERIOD_SUMMARY_QUARANTINE_NOTE,
  type CascadeCounts,
} from './lib/review-cascade.js'

const isStatus = process.argv.includes('status')

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

async function autoApproveBatch(
  batchId: number,
  confidenceThreshold: number,
): Promise<{
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
        gte(ocrExtractions.overallConfidence, confidenceThreshold.toFixed(4) as unknown as string),
        // Phase-A: don't auto-approve extractions from a superseded run.
        liveRunFilter(ocrExtractions.runId),
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
  console.log(`[review] ${prefix}: ${formatCascadeCounts(counts)}`)
  if (counts.periodSummariesSkipped > 0) {
    // Silence here would read as "the per-period rows were published too".
    console.log(
      `[review] ⚠ ${String(counts.periodSummariesSkipped)} match_period_summaries row(s) were ` +
        `NOT changed. ${PERIOD_SUMMARY_PROVENANCE_GAP}`,
    )
  }
  if (counts.periodSummariesQuarantined > 0) {
    // The opposite silence would read as "nothing was un-published", when in
    // fact a previously visible per-period breakdown just disappeared.
    console.log(
      `[review] ⚠ ${String(counts.periodSummariesQuarantined)} match_period_summaries row(s) ` +
        `were QUARANTINED (published families withdrawn to pending_review). ` +
        PERIOD_SUMMARY_QUARANTINE_NOTE,
    )
  }
}

async function main(): Promise<void> {
  if (isStatus) {
    await showStatus()
    return
  }

  const extractionIdStr = getFlag('extraction')
  const extractionListStr = getFlag('extractions')
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

  // Bulk applicator for an externally-computed extraction set. The selection
  // policy (which matches / which flag classes block promotion) deliberately
  // lives OUTSIDE this CLI — callers grade first, then hand the surviving ids
  // here so the flip still goes through the audited cascade rather than a
  // hand-rolled UPDATE that would miss one of the six downstream tables.
  // Accepts a comma-separated list or `@path` to a newline-delimited file.
  if (extractionListStr) {
    const raw = extractionListStr.startsWith('@')
      ? readFileSync(extractionListStr.slice(1), 'utf8')
      : extractionListStr
    const ids = raw
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map((s) => {
        const n = Number.parseInt(s, 10)
        if (!Number.isFinite(n)) throw new Error(`Invalid extraction id: ${s}`)
        return n
      })
    if (ids.length === 0) throw new Error('--extractions resolved to an empty id set')
    const status = statusStr ?? 'reviewed'
    if (status !== 'reviewed' && status !== 'rejected' && status !== 'pending_review') {
      throw new Error(`Invalid --status: ${String(status)}`)
    }
    if (process.argv.includes('--dry-run')) {
      console.log(`[review] DRY RUN — would flip ${String(ids.length)} extraction(s) → ${status}`)
      return
    }
    console.log(`[review] flipping ${String(ids.length)} extraction(s) → ${status}`)
    const counts = await setExtractionStatus(ids, status)
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
  console.log(
    '  pnpm --filter worker ingest-ocr-review --extraction <id> [--status reviewed|rejected]',
  )
  console.log(
    '  pnpm --filter worker ingest-ocr-review --batch <id> --auto-approve [--confidence-threshold 0.85]',
  )
  console.log('  pnpm --filter worker ingest-ocr-review --batch <id> --status reviewed|rejected')
  console.log(
    '  pnpm --filter worker ingest-ocr-review --extractions <csv|@file> [--status reviewed] [--dry-run]',
  )
}

main()
  .catch((err: unknown) => {
    console.error('[review] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
