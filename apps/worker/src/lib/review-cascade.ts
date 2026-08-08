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
 * ⚠️ `match_period_summaries` IS HANDLED ASYMMETRICALLY — never published here,
 * conservatively quarantined on a revocation. See
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
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * WHY THE PERIOD-SUMMARY CASCADE IS ASYMMETRIC (migration 0056 follow-up).
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
 * Scoping by `ocr_extractions.screen_type` does NOT repair it: screen type says
 * which family an extraction was ABOUT, not which row values it actually wrote,
 * so case 3 still mis-attributes.
 *
 * THE ASYMMETRY. Ambiguous provenance is not symmetric in its consequences, so
 * the two directions get opposite treatment:
 *
 *   * `reviewed` (APPROVAL, widens publication) — SKIPPED. Publishing on a guess
 *     would authorize values two other extractions produced, and reviewing a
 *     later contributor would silently touch nothing. Ambiguity must never
 *     expose data. Family authorization happens only through the bounded,
 *     evidence-driven `promoteOcrPeriodFamily`, which proves what it publishes
 *     instead of attributing it.
 *
 *   * `pending_review` / `rejected` (REVOCATION, narrows publication) —
 *     QUARANTINED. Skipping here was the unsafe half: an extraction that may
 *     well have contributed to an already-published family gets rejected, and
 *     the family stays visible because the cascade declined to act. Rejected
 *     data kept rendering on the recap. The same ambiguity that forbids
 *     publishing REQUIRES withholding.
 *
 * THE ASSOCIATION USED FOR A REVOCATION. Attribution is impossible, so none is
 * attempted; the MATCH is the unit. A match is affected when it is named by a
 * revoked extraction (`ocr_extractions.match_id`) OR when any of its period rows
 * names one (`match_period_summaries.ocr_extraction_id`). Both directions are
 * load-bearing: the first catches a real contributor no row records (the
 * COALESCE merge keeps only the first), the second catches a row naming an
 * extraction whose own `match_id` is absent. Every `source='ocr'` period row of
 * an affected match then has each `reviewed` family demoted to `pending_review`.
 *
 * This deliberately OVER-withholds — rejecting a lobby extraction quarantines
 * that match's period summaries too. That is the correct trade: the cost is a
 * re-run of `reconcile-periods --promote`, which republishes anything that still
 * reconciles, whereas the alternative leaves rejected data published.
 *
 * What a quarantine does NOT do: it never demotes a family an operator
 * explicitly `rejected` back to `pending_review` (withholding must not erase a
 * stronger verdict), and it never writes the legacy row-level `review_status`
 * (which is not an authorization signal in either direction).
 *
 * DEFERRED REQUIREMENT (not invented here): making the cascade PRECISE needs real
 * per-family provenance — either three contributor columns
 * (`goals_ocr_extraction_id`, …) or a contribution table keyed
 * (period_summary_id, family, side) → extraction_id, written by `box-score.ts`
 * at the point of the COALESCE merge. Until that exists, approval stays closed
 * and revocation stays broad.
 */
export const PERIOD_SUMMARY_PROVENANCE_GAP =
  'match_period_summaries carries one ocr_extraction_id for three independently-captured ' +
  'stat families and records only the first contributor, so a review verdict cannot be ' +
  'attributed to the family it authorizes. Period-summary publication is therefore never ' +
  'cascaded; use the bounded per-family promotion path (reconcile-periods --promote) or ' +
  'set the family status explicitly.'

export const PERIOD_SUMMARY_QUARANTINE_NOTE =
  'Because a contributing extraction cannot be identified, a demotion or rejection ' +
  'conservatively withdraws publication of EVERY OCR per-period family of every affected ' +
  'match, so nothing stays visible merely because the cascade could not attribute it. ' +
  'Re-run `reconcile-periods --promote` to republish whatever still reconciles.'

export interface CascadeCounts {
  events: number
  /**
   * ALWAYS 0. Period summaries are never PUBLISHED by the cascade — see
   * {@link PERIOD_SUMMARY_PROVENANCE_GAP}. Retained so callers keep compiling
   * and so the number stays visibly zero rather than silently absent.
   */
  periodSummaries: number
  /**
   * APPROVALS only: period-summary rows referencing these extractions that were
   * left untouched because publication cannot be attributed.
   */
  periodSummariesSkipped: number
  /**
   * REVOCATIONS only: period-summary rows whose published families were
   * withdrawn to `pending_review` because a possible contributor was demoted or
   * rejected. Disjoint from {@link CascadeCounts.periodSummariesSkipped} — one
   * call is either an approval or a revocation, never both.
   */
  periodSummariesQuarantined: number
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
    periodSummariesQuarantined: 0,
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
    periodSummariesQuarantined: a.periodSummariesQuarantined + b.periodSummariesQuarantined,
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
    `period_summaries_quarantined=${String(counts.periodSummariesQuarantined)} ` +
    `shot_type_summaries=${String(counts.shotTypeSummaries)} ` +
    `loadout_snapshots=${String(counts.loadoutSnapshots)} ` +
    `faceoff_dots=${String(counts.faceoffDots)} ` +
    `faceoff_zone_summaries=${String(counts.faceoffZoneSummaries)}`
  )
}

/**
 * Every match a revoked extraction could have contributed period values to.
 *
 * The union of the two directions the schema can express — see the ASSOCIATION
 * paragraph in {@link PERIOD_SUMMARY_PROVENANCE_GAP}'s docblock. Neither alone
 * is sufficient, because the sticky `ocr_extraction_id` records only the first
 * contributor.
 */
async function affectedMatchIds(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  extractionIds: number[],
): Promise<number[]> {
  const byExtraction = await tx
    .select({ matchId: ocrExtractions.matchId })
    .from(ocrExtractions)
    .where(inArray(ocrExtractions.id, extractionIds))

  const byPeriodRow = await tx
    .selectDistinct({ matchId: matchPeriodSummaries.matchId })
    .from(matchPeriodSummaries)
    .where(inArray(matchPeriodSummaries.ocrExtractionId, extractionIds))

  const ids = new Set<number>()
  for (const r of [...byExtraction, ...byPeriodRow]) {
    if (r.matchId != null) ids.add(r.matchId)
  }
  return [...ids]
}

/**
 * Flip `ocr_extractions.review_status` for the given ids and cascade to every
 * promoter table that references them.
 *
 * `match_period_summaries` is handled asymmetrically because its per-family
 * authorization cannot be attributed to an extraction
 * ({@link PERIOD_SUMMARY_PROVENANCE_GAP}):
 *
 *   * `reviewed` — skipped and counted (`periodSummariesSkipped`). Nothing is
 *     published on a guess.
 *   * `pending_review` / `rejected` — every published family on every
 *     `source='ocr'` period row of every affected match is withdrawn to
 *     `pending_review` and counted (`periodSummariesQuarantined`), so no data
 *     survives merely because attribution failed.
 *
 * The quarantine runs inside the SAME transaction as the extraction flip, so a
 * rejection and the withdrawal it forces commit or roll back together — there is
 * no window in which an extraction reads `rejected` while its match's period
 * families are still published.
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

    // Period summaries are NEVER published here, whatever the status.
    counts.periodSummaries = 0

    if (status === 'reviewed') {
      // APPROVAL — count and leave alone. Publishing a stat family here would
      // authorize values a different extraction contributed.
      const [periodSkipped] = await tx
        .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(matchPeriodSummaries)
        .where(inArray(matchPeriodSummaries.ocrExtractionId, extractionIds))
      counts.periodSummariesSkipped = periodSkipped?.n ?? 0
    } else {
      // REVOCATION — withdraw publication across every affected match.
      const matchIds = await affectedMatchIds(tx, extractionIds)
      if (matchIds.length > 0) {
        // `reviewed → pending_review` only. A family an operator explicitly
        // `rejected` keeps that stronger verdict; quarantine withholds, it does
        // not reinstate. Restricted to source='ocr': EA rows bypass review
        // entirely and a `manual` row's values did not come from this extraction.
        const demote = (column: AnyPgColumn) =>
          sql`CASE WHEN ${column} = 'reviewed' THEN 'pending_review' ELSE ${column} END`
        const quarantined = await tx
          .update(matchPeriodSummaries)
          .set({
            goalsReviewStatus: demote(matchPeriodSummaries.goalsReviewStatus),
            shotsReviewStatus: demote(matchPeriodSummaries.shotsReviewStatus),
            faceoffsReviewStatus: demote(matchPeriodSummaries.faceoffsReviewStatus),
          })
          .where(
            and(
              inArray(matchPeriodSummaries.matchId, matchIds),
              eq(matchPeriodSummaries.source, 'ocr'),
              // Only rows that actually publish something, so the count means
              // "rows whose visibility changed" rather than "rows we rewrote".
              or(
                eq(matchPeriodSummaries.goalsReviewStatus, 'reviewed'),
                eq(matchPeriodSummaries.shotsReviewStatus, 'reviewed'),
                eq(matchPeriodSummaries.faceoffsReviewStatus, 'reviewed'),
              ),
            ),
          )
          .returning({ id: matchPeriodSummaries.id })
        counts.periodSummariesQuarantined = quarantined.length
      }
    }

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
