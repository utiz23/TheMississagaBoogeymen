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
 *
 * ⚠️ `match_period_summaries` IS DELIBERATELY EXCLUDED — see
 * {@link PERIOD_SUMMARY_PROVENANCE_GAP}.
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
import { inArray, sql } from 'drizzle-orm'

/**
 * WHY THE PERIOD-SUMMARY CASCADE IS DISABLED (migration 0056 follow-up).
 *
 * Since 0056 a `match_period_summaries` row is authorized PER FAMILY — goals,
 * shots and faceoffs each have their own `*_review_status`, because each is
 * captured on its own Box Score tab by its own extraction. To cascade a review
 * verdict onto a family, this module would have to know which extraction
 * contributed that family's values. The schema cannot tell it:
 *
 *   1. There is ONE `ocr_extraction_id` per row for THREE families.
 *   2. `box-score.ts` writes it as `COALESCE(existing, incoming)`, so it records
 *      only the FIRST contributor; the other two families' extractions are
 *      recorded nowhere at all.
 *   3. The same COALESCE merge applies per column, so even within one family a
 *      second frame can supply the side the first left null — a row's goals pair
 *      can come from two goals extractions while naming only one.
 *
 * Consequences if this cascaded anyway: reviewing the first contributor would
 * publish families two other extractions produced (over-authorization), while
 * reviewing a later contributor would touch nothing (silently ignored). Scoping
 * by `ocr_extractions.screen_type` does NOT repair it — screen type says which
 * family an extraction was ABOUT, not which row values it actually wrote, so
 * case 3 still mis-authorizes.
 *
 * Fail-closed behaviour: the cascade neither publishes nor revokes any family,
 * and does not write the legacy `review_status` either (a row reading
 * `reviewed` while its three families are pending records a publication that
 * did not happen). It reports the rows it skipped so an operator can see them.
 *
 * The ONE authorized automatic path is `promoteOcrPeriodFamily` — family-scoped,
 * bounded to the periods EA player TOI proves were played, and driven by
 * evidence rather than by attribution. It is unaffected by this and runs
 * independently of manual review.
 *
 * DEFERRED REQUIREMENT (not invented here): making the cascade sound needs real
 * per-family provenance — either three contributor columns
 * (`goals_ocr_extraction_id`, …) or a contribution table keyed
 * (period_summary_id, family, side) → extraction_id, written by `box-score.ts`
 * at the point of the COALESCE merge. Until that exists, this stays closed.
 */
export const PERIOD_SUMMARY_PROVENANCE_GAP =
  'match_period_summaries carries one ocr_extraction_id for three independently-captured ' +
  'stat families and records only the first contributor, so a review verdict cannot be ' +
  'attributed to the family it authorizes. Period-summary publication is therefore not ' +
  'cascaded; use the bounded per-family promotion path (reconcile-periods --promote) or ' +
  'set the family status explicitly.'

export interface CascadeCounts {
  events: number
  /**
   * ALWAYS 0. Period summaries are never cascaded — see
   * {@link PERIOD_SUMMARY_PROVENANCE_GAP}. Retained so callers keep compiling
   * and so the number stays visibly zero rather than silently absent.
   */
  periodSummaries: number
  /** Period-summary rows referencing these extractions that were left untouched. */
  periodSummariesSkipped: number
  shotTypeSummaries: number
  loadoutSnapshots: number
  faceoffDots: number
  faceoffZoneSummaries: number
}

export function emptyCascadeCounts(): CascadeCounts {
  return {
    events: 0,
    periodSummaries: 0,
    periodSummariesSkipped: 0,
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
    periodSummariesSkipped: a.periodSummariesSkipped + b.periodSummariesSkipped,
    shotTypeSummaries: a.shotTypeSummaries + b.shotTypeSummaries,
    loadoutSnapshots: a.loadoutSnapshots + b.loadoutSnapshots,
    faceoffDots: a.faceoffDots + b.faceoffDots,
    faceoffZoneSummaries: a.faceoffZoneSummaries + b.faceoffZoneSummaries,
  }
}

export function formatCascadeCounts(counts: CascadeCounts): string {
  return (
    `events=${String(counts.events)} period_summaries=${String(counts.periodSummaries)} ` +
    `period_summaries_skipped=${String(counts.periodSummariesSkipped)} ` +
    `shot_type_summaries=${String(counts.shotTypeSummaries)} ` +
    `loadout_snapshots=${String(counts.loadoutSnapshots)} ` +
    `faceoff_dots=${String(counts.faceoffDots)} ` +
    `faceoff_zone_summaries=${String(counts.faceoffZoneSummaries)}`
  )
}

/**
 * Flip `ocr_extractions.review_status` for the given ids and cascade to every
 * promoter table that references them EXCEPT `match_period_summaries`, whose
 * per-family authorization this module cannot attribute
 * ({@link PERIOD_SUMMARY_PROVENANCE_GAP}). Returns the per-table row counts,
 * with the skipped period-summary rows reported separately.
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

    // NOT an update. Period summaries are counted and left alone — publishing or
    // revoking a stat family here would authorize (or revoke) values a different
    // extraction contributed. See PERIOD_SUMMARY_PROVENANCE_GAP.
    const [periodSkipped] = await tx
      .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(matchPeriodSummaries)
      .where(inArray(matchPeriodSummaries.ocrExtractionId, extractionIds))
    counts.periodSummaries = 0
    counts.periodSummariesSkipped = periodSkipped?.n ?? 0

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
