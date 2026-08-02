/**
 * The OCR review-status promotion cascade — extracted from
 * `ingest-ocr-review-cli.ts` so the hand-driven review CLI and the automated
 * `auto-drain-cli.ts` share ONE implementation.
 *
 * Why this is worth a module rather than a copy: flipping
 * `ocr_extractions.review_status` is only half the job. Six promoter tables
 * carry their own `review_status` and reference the extraction via
 * `ocr_extraction_id`; the UI filters on THEIR status, not the extraction's. A
 * hand-rolled UPDATE that misses one of the six leaves that surface invisible
 * with no error anywhere — exactly the silent failure mode that stranded 4,298
 * event rows. All seven updates commit in a single transaction.
 *
 * Cascading is NON-TRANSITIVE by design: only rows pointed at by the given
 * extraction ids move. If a row was promoted by a *different* extraction
 * (cross-screen dedup), flipping this one does not touch it.
 */

import {
  db,
  ocrExtractions,
  matchEvents,
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  matchPeriodSummaries,
  matchShotTypeSummaries,
  playerLoadoutSnapshots,
  type OcrReviewStatus,
} from '@eanhl/db'
import { inArray } from 'drizzle-orm'

export interface CascadeCounts {
  events: number
  periodSummaries: number
  shotTypeSummaries: number
  loadoutSnapshots: number
  faceoffDots: number
  faceoffZoneSummaries: number
}

export function emptyCascadeCounts(): CascadeCounts {
  return {
    events: 0,
    periodSummaries: 0,
    shotTypeSummaries: 0,
    loadoutSnapshots: 0,
    faceoffDots: 0,
    faceoffZoneSummaries: 0,
  }
}

/** Accumulate per-match cascade results into a corpus-wide total. */
export function addCascadeCounts(a: CascadeCounts, b: CascadeCounts): CascadeCounts {
  return {
    events: a.events + b.events,
    periodSummaries: a.periodSummaries + b.periodSummaries,
    shotTypeSummaries: a.shotTypeSummaries + b.shotTypeSummaries,
    loadoutSnapshots: a.loadoutSnapshots + b.loadoutSnapshots,
    faceoffDots: a.faceoffDots + b.faceoffDots,
    faceoffZoneSummaries: a.faceoffZoneSummaries + b.faceoffZoneSummaries,
  }
}

export function formatCascadeCounts(counts: CascadeCounts): string {
  return (
    `events=${String(counts.events)} period_summaries=${String(counts.periodSummaries)} ` +
    `shot_type_summaries=${String(counts.shotTypeSummaries)} ` +
    `loadout_snapshots=${String(counts.loadoutSnapshots)} ` +
    `faceoff_dots=${String(counts.faceoffDots)} ` +
    `faceoff_zone_summaries=${String(counts.faceoffZoneSummaries)}`
  )
}

/**
 * Flip `ocr_extractions.review_status` for the given ids and cascade to every
 * promoter table that references them. Returns the per-table row counts.
 *
 * `reviewed_at` is set on any non-pending status and cleared when demoting back
 * to `pending_review`.
 */
export async function setExtractionStatus(
  extractionIds: number[],
  status: OcrReviewStatus,
): Promise<CascadeCounts> {
  if (extractionIds.length === 0) return emptyCascadeCounts()

  const counts = emptyCascadeCounts()

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
      .where(inArray(playerLoadoutSnapshots.ocrExtractionId, extractionIds))
      .returning({ id: playerLoadoutSnapshots.id })
    counts.loadoutSnapshots = loadoutRows.length

    const faceoffDotRows = await tx
      .update(matchFaceoffDots)
      .set({ reviewStatus: status })
      .where(inArray(matchFaceoffDots.ocrExtractionId, extractionIds))
      .returning({ id: matchFaceoffDots.id })
    counts.faceoffDots = faceoffDotRows.length

    const faceoffZoneRows = await tx
      .update(matchFaceoffZoneSummaries)
      .set({ reviewStatus: status })
      .where(inArray(matchFaceoffZoneSummaries.ocrExtractionId, extractionIds))
      .returning({ id: matchFaceoffZoneSummaries.id })
    counts.faceoffZoneSummaries = faceoffZoneRows.length
  })

  return counts
}
