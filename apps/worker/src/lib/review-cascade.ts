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
 * durably REJECTED for a directly implicated stat family, conservatively
 * quarantined otherwise. See {@link PERIOD_SUMMARY_PROVENANCE_GAP}.
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
import {
  PERIOD_SUMMARY_FAMILIES,
  periodFamilyForScreenType,
  periodFamilyRejectionBarrier,
  type PeriodSummaryFamily,
} from '@eanhl/db/queries'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
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
 * WHAT `screen_type` CAN AND CANNOT DO. It says which family an extraction was
 * ABOUT, not which row values it actually wrote. That rules it out for
 * ATTRIBUTION — case 3 would still mis-attribute. It is exactly right, however,
 * for a BARRIER: a rejected `post_game_box_score_goals` extraction could have
 * written ANY goals value on its match, so the whole match/family must fail
 * closed. Implicating too much is safe; implicating too little is not.
 *
 * THE THREE DIRECTIONS. Ambiguous provenance is not symmetric in its
 * consequences, so each verdict gets its own treatment:
 *
 *   * `reviewed` (APPROVAL, widens publication) — PUBLISHES NOTHING. Publishing
 *     on a guess would authorize values two other extractions produced, and
 *     reviewing a later contributor would silently touch nothing. Ambiguity must
 *     never expose data. Family authorization happens only through the bounded,
 *     evidence-driven `promoteOcrPeriodFamily`, which proves what it publishes
 *     instead of attributing it. (An approval may still CLEAR a rejection
 *     barrier — see below. Clearing is not publishing.)
 *
 *   * `pending_review` (DEMOTION, narrows publication) — QUARANTINES. Skipping
 *     here was the unsafe half: an extraction that may well have contributed to
 *     an already-published family gets demoted, and the family stays visible
 *     because the cascade declined to act. The same ambiguity that forbids
 *     publishing REQUIRES withholding. A quarantine is a PAUSE — the next
 *     `reconcile-periods --promote` may republish whatever still reconciles.
 *
 *   * `rejected` (VERDICT, must be durable) — QUARANTINES *and* REJECTS. A
 *     quarantine alone was not enough: `pending_review` is the exact state the
 *     reconciliation boundary consumes, so a rejection of values that still
 *     reconcile was undone by the very next promote sweep. When the rejected
 *     extraction is one of the three Box Score tabs, its family is marked
 *     `rejected` on every OCR period row of every implicated match, and
 *     `promoteOcrPeriodFamily` independently refuses while any such rejection
 *     exists. Every OTHER family on those matches is quarantined only — never
 *     rejected as collateral, because nothing implicates it.
 *
 * A rejected extraction that is NOT a Box Score tab (lobby, events, loadout…)
 * implicates no family: it quarantines, and creates no permanent rejection.
 *
 * THE ASSOCIATION USED. Attribution is impossible, so none is attempted; the
 * MATCH is the unit. A match is associated with an extraction when the
 * extraction names it (`ocr_extractions.match_id`) OR when one of the match's
 * period rows names the extraction (`match_period_summaries.ocr_extraction_id`).
 * Both directions are load-bearing: the first catches a real contributor no row
 * records (the COALESCE merge keeps only the first), the second catches a row
 * naming an extraction whose own `match_id` is absent. The same two directions
 * define the rejection barrier — see `periodFamilyRejectionBarrier` in
 * `@eanhl/db/queries`, which both this module and the mutation boundary import
 * so the "is it still blocked?" question has exactly one answer.
 *
 * CLEARING A BARRIER. Moving a rejected extraction back to `pending_review` or
 * `reviewed` may lift the block, but only when NO other rejected extraction of
 * that screen type is still associated with the match, and only as far as
 * `pending_review`. Nothing is ever republished here; actual publication still
 * has to come from the semantic reconciliation boundary.
 *
 * KNOWN LIMITATION. The family status column cannot say WHO rejected it, so a
 * family an operator rejected by hand is indistinguishable from one this cascade
 * rejected. Clearing the last extraction-level rejection for a family therefore
 * also clears a hand-set rejection of that same family on that same match. It
 * fails safe — clearance only reaches `pending_review`, which publishes nothing
 * — and closing it needs the same per-family provenance the DEFERRED REQUIREMENT
 * below describes (a `*_rejected_by_extraction_id` column, or a contribution
 * table).
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
  'Re-run `reconcile-periods --promote` to republish whatever still reconciles — EXCEPT any ' +
  'family durably rejected below, which no re-run will restore.'

export const PERIOD_FAMILY_REJECTION_NOTE =
  'A rejected Box Score extraction implicates its whole match/family, so that family is ' +
  'marked rejected on every OCR period row of the match and promoteOcrPeriodFamily will ' +
  'refuse it. `reconcile-periods --promote` will NOT bring it back. To lift the block, move ' +
  'every rejected extraction of that screen type for the match off `rejected`; clearing the ' +
  'last one returns the family to pending_review, and only then can the reconciliation ' +
  'boundary republish it.'

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
   * left unpublished because publication cannot be attributed.
   */
  periodSummariesSkipped: number
  /**
   * COLLATERAL: period-summary ROWS on which at least one published family was
   * withdrawn to `pending_review` because a possible contributor was demoted or
   * rejected. A pause, not a verdict — a later promote sweep may republish.
   * Disjoint from {@link CascadeCounts.periodSummariesSkipped}.
   */
  periodSummariesQuarantined: number
  /**
   * DIRECTLY IMPLICATED: (row, family) pairs durably set to `rejected` because a
   * rejected extraction of that family's Box Score screen type is associated
   * with the match. Not a row count — one row can contribute at most one pair
   * per rejected family. No re-run undoes these.
   */
  periodFamiliesRejected: number
  /**
   * (row, family) pairs moved `rejected` → `pending_review` because the last
   * rejected extraction blocking that match/family was moved off `rejected`.
   * Never reaches `reviewed`: republication still requires reconciliation.
   */
  periodRejectionBarriersCleared: number
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
    periodFamiliesRejected: 0,
    periodRejectionBarriersCleared: 0,
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
    periodFamiliesRejected: a.periodFamiliesRejected + b.periodFamiliesRejected,
    periodRejectionBarriersCleared:
      a.periodRejectionBarriersCleared + b.periodRejectionBarriersCleared,
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
    `period_families_rejected=${String(counts.periodFamiliesRejected)} ` +
    `period_rejection_barriers_cleared=${String(counts.periodRejectionBarriersCleared)} ` +
    `shot_type_summaries=${String(counts.shotTypeSummaries)} ` +
    `loadout_snapshots=${String(counts.loadoutSnapshots)} ` +
    `faceoff_dots=${String(counts.faceoffDots)} ` +
    `faceoff_zone_summaries=${String(counts.faceoffZoneSummaries)}`
  )
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The status column and the single-column patch each family owns. */
const FAMILY_STATUS_COLUMN: Record<PeriodSummaryFamily, AnyPgColumn> = {
  goals: matchPeriodSummaries.goalsReviewStatus,
  shots: matchPeriodSummaries.shotsReviewStatus,
  faceoffs: matchPeriodSummaries.faceoffsReviewStatus,
}

function familyPatch(
  family: PeriodSummaryFamily,
  status: OcrReviewStatus,
): Partial<typeof matchPeriodSummaries.$inferInsert> {
  switch (family) {
    case 'goals':
      return { goalsReviewStatus: status }
    case 'shots':
      return { shotsReviewStatus: status }
    case 'faceoffs':
      return { faceoffsReviewStatus: status }
  }
}

/** A per-match set of stat families. */
type FamilyMap = Map<number, Set<PeriodSummaryFamily>>

function addFamily(map: FamilyMap, matchId: number, family: PeriodSummaryFamily): void {
  const existing = map.get(matchId)
  if (existing) existing.add(family)
  else map.set(matchId, new Set([family]))
}

/**
 * Every match each extraction could have contributed period values to.
 *
 * Resolved PER EXTRACTION, not as one flat union: a batch can hold a goals
 * extraction for match A and a faceoffs extraction for match B, and rejecting
 * both must not reject goals on B. See the ASSOCIATION paragraph in
 * {@link PERIOD_SUMMARY_PROVENANCE_GAP}'s docblock for why both directions are
 * needed.
 */
async function matchesByExtraction(
  tx: Tx,
  targets: { id: number; matchId: number | null }[],
): Promise<Map<number, Set<number>>> {
  const byExtraction = new Map<number, Set<number>>()
  const add = (extractionId: number, matchId: number): void => {
    const existing = byExtraction.get(extractionId)
    if (existing) existing.add(matchId)
    else byExtraction.set(extractionId, new Set([matchId]))
  }

  for (const t of targets) {
    if (t.matchId != null) add(t.id, t.matchId)
  }

  const rowLinks = await tx
    .selectDistinct({
      matchId: matchPeriodSummaries.matchId,
      extractionId: matchPeriodSummaries.ocrExtractionId,
    })
    .from(matchPeriodSummaries)
    .where(
      inArray(
        matchPeriodSummaries.ocrExtractionId,
        targets.map((t) => t.id),
      ),
    )
  for (const link of rowLinks) {
    if (link.extractionId != null) add(link.extractionId, link.matchId)
  }

  return byExtraction
}

/** true ⇒ at least one extraction still blocks this match/family. */
async function barrierStillStands(
  tx: Tx,
  matchId: number,
  family: PeriodSummaryFamily,
): Promise<boolean> {
  const [row] = await tx
    .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(ocrExtractions)
    .where(
      and(
        periodFamilyRejectionBarrier(matchId, family),
        eq(ocrExtractions.reviewStatus, 'rejected'),
      ),
    )
  return (row?.n ?? 0) > 0
}

/**
 * Flip `ocr_extractions.review_status` for the given ids and cascade to every
 * promoter table that references them.
 *
 * `match_period_summaries` is handled asymmetrically because its per-family
 * authorization cannot be attributed to an extraction
 * ({@link PERIOD_SUMMARY_PROVENANCE_GAP}):
 *
 *   * `reviewed` — published families are left untouched and counted
 *     (`periodSummariesSkipped`). Nothing is published on a guess. A rejection
 *     barrier this approval was the last holder of is cleared to
 *     `pending_review` (`periodRejectionBarriersCleared`).
 *   * `pending_review` — every published family on every `source='ocr'` period
 *     row of every associated match is withdrawn to `pending_review`
 *     (`periodSummariesQuarantined`), and a barrier this demotion was the last
 *     holder of is cleared.
 *   * `rejected` — as above, plus: for each rejected extraction that is one of
 *     the three Box Score tabs, THAT family is durably set to `rejected` on
 *     every OCR period row of every match the extraction is associated with
 *     (`periodFamiliesRejected`). Other families are quarantined only.
 *
 * LOCK ORDER — `ocr_extractions` first (`FOR UPDATE`), then
 * `match_period_summaries` (`FOR UPDATE`, UNQUALIFIED by status), both ordered
 * by id. `promoteOcrPeriodFamily` takes the same two tables in the same order
 * (`FOR SHARE` on the extractions), so the two paths serialize rather than
 * deadlock, and neither can commit inside the other's decision window.
 *
 * The unqualified period-row lock is the C4 fix and is load-bearing: the old
 * status-qualified UPDATE never locked a row that was still `pending_review`, so
 * a promotion holding those rows was invisible to it — the rejection committed
 * against zero rows and the promotion then published `reviewed` values for an
 * already-rejected extraction.
 *
 * Everything runs in ONE transaction, so a rejection and the withdrawal it
 * forces commit or roll back together — there is no window in which an
 * extraction reads `rejected` while its match's period families are published.
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
    // ── 1. lock the target extractions, in id order ─────────────────────────
    //
    // Taken BEFORE any period row, matching the promotion path's order. Holding
    // these blocks a concurrent `promoteOcrPeriodFamily` at its own barrier read
    // (`FOR SHARE`), so it cannot decide on a status this transaction is about
    // to change.
    const targets = await tx
      .select({
        id: ocrExtractions.id,
        matchId: ocrExtractions.matchId,
        screenType: ocrExtractions.screenType,
        reviewStatus: ocrExtractions.reviewStatus,
      })
      .from(ocrExtractions)
      .where(inArray(ocrExtractions.id, extractionIds))
      .orderBy(asc(ocrExtractions.id))
      .for('update')

    const reviewedAt = status === 'pending_review' ? null : new Date()
    await tx
      .update(ocrExtractions)
      .set({ reviewStatus: status, reviewedAt })
      .where(inArray(ocrExtractions.id, extractionIds))

    // The single-family promoter tables have RELIABLE provenance — one
    // `ocr_extraction_id` genuinely identifies the writer — so they cascade
    // symmetrically in both directions, unchanged. Done before the
    // period-summary work so its early exits can never skip them.
    const eventsRows = await tx
      .update(matchEvents)
      .set({ reviewStatus: status })
      .where(inArray(matchEvents.ocrExtractionId, extractionIds))
      .returning({ id: matchEvents.id })
    counts.events = eventsRows.length

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

    // Period summaries are NEVER published here, whatever the status.
    counts.periodSummaries = 0

    if (status === 'reviewed') {
      // APPROVAL — count what publication was declined. Publishing a stat family
      // here would authorize values a different extraction contributed.
      const [periodSkipped] = await tx
        .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(matchPeriodSummaries)
        .where(inArray(matchPeriodSummaries.ocrExtractionId, extractionIds))
      counts.periodSummariesSkipped = periodSkipped?.n ?? 0
    }

    // ── 2. classify what each target implicates ─────────────────────────────
    const association = await matchesByExtraction(tx, targets)

    /** Families to durably reject, per match. Only ever populated on `rejected`. */
    const implicated: FamilyMap = new Map()
    /** Families whose barrier this call MIGHT lift, per match. */
    const clearingCandidates: FamilyMap = new Map()
    /** Matches to conservatively quarantine. Empty on an approval. */
    const quarantineMatchIds = new Set<number>()

    for (const target of targets) {
      const family = periodFamilyForScreenType(target.screenType)
      const matchIds = association.get(target.id) ?? new Set<number>()
      for (const matchId of matchIds) {
        if (status !== 'reviewed') quarantineMatchIds.add(matchId)
        if (family === null) continue
        if (status === 'rejected') {
          addFamily(implicated, matchId, family)
        } else if (target.reviewStatus === 'rejected') {
          // Moving OFF `rejected` — this target was holding a barrier. Whether
          // it may actually be lifted depends on the others, checked below.
          addFamily(clearingCandidates, matchId, family)
        }
      }
    }

    // A barrier lifts only when NOTHING else still blocks that match/family. The
    // check runs AFTER the flip above, so the targets themselves already read
    // their new status and cannot block their own clearance.
    const clearing: FamilyMap = new Map()
    for (const [matchId, families] of clearingCandidates) {
      for (const family of families) {
        if (!(await barrierStillStands(tx, matchId, family))) addFamily(clearing, matchId, family)
      }
    }

    const lockMatchIds = new Set<number>([...quarantineMatchIds, ...clearing.keys()])
    if (lockMatchIds.size === 0) return

    // ── 3. lock EVERY candidate period row, whatever its status ─────────────
    //
    // Unqualified on purpose (the C4 fix): a status predicate here would skip —
    // and therefore not wait on — rows a concurrent promotion is holding while
    // they are still `pending_review`.
    const rows = await tx
      .select({
        id: matchPeriodSummaries.id,
        matchId: matchPeriodSummaries.matchId,
        goals: matchPeriodSummaries.goalsReviewStatus,
        shots: matchPeriodSummaries.shotsReviewStatus,
        faceoffs: matchPeriodSummaries.faceoffsReviewStatus,
      })
      .from(matchPeriodSummaries)
      .where(
        and(
          inArray(matchPeriodSummaries.matchId, [...lockMatchIds]),
          // EA rows bypass review entirely, and a `manual` row's values did not
          // come from this extraction.
          eq(matchPeriodSummaries.source, 'ocr'),
        ),
      )
      .orderBy(asc(matchPeriodSummaries.id))
      .for('update')

    // ── 4. decide each (row, family) from the LOCKED state ──────────────────
    const toReject: Record<PeriodSummaryFamily, number[]> = { goals: [], shots: [], faceoffs: [] }
    const toQuarantine: Record<PeriodSummaryFamily, number[]> = {
      goals: [],
      shots: [],
      faceoffs: [],
    }

    /** Clearance ids grouped per match, because its guard is per match/family. */
    const clearByMatch = new Map<number, Record<PeriodSummaryFamily, number[]>>()
    const clearBucket = (matchId: number): Record<PeriodSummaryFamily, number[]> => {
      const existing = clearByMatch.get(matchId)
      if (existing) return existing
      const fresh: Record<PeriodSummaryFamily, number[]> = { goals: [], shots: [], faceoffs: [] }
      clearByMatch.set(matchId, fresh)
      return fresh
    }

    for (const row of rows) {
      const rejectFamilies = implicated.get(row.matchId)
      const clearFamilies = clearing.get(row.matchId)
      let rowQuarantined = false
      for (const family of PERIOD_SUMMARY_FAMILIES) {
        const current = row[family]
        if (rejectFamilies?.has(family)) {
          if (current !== 'rejected') toReject[family].push(row.id)
        } else if (clearFamilies?.has(family)) {
          if (current === 'rejected') clearBucket(row.matchId)[family].push(row.id)
        } else if (quarantineMatchIds.has(row.matchId) && current === 'reviewed') {
          // Withhold, do not weaken: an explicitly `rejected` family keeps that
          // stronger verdict, and the legacy row-level `review_status` is not an
          // authorization signal in either direction and is never written.
          toQuarantine[family].push(row.id)
          rowQuarantined = true
        }
      }
      if (rowQuarantined) counts.periodSummariesQuarantined++
    }

    // ── 5. apply, one narrow single-column UPDATE per family and direction ──
    const applyFamily = async (
      family: PeriodSummaryFamily,
      ids: number[],
      next: OcrReviewStatus,
      guard: OcrReviewStatus | null,
    ): Promise<number> => {
      if (ids.length === 0) return 0
      const updated = await tx
        .update(matchPeriodSummaries)
        .set(familyPatch(family, next))
        .where(
          and(
            inArray(matchPeriodSummaries.id, ids),
            // Belt and braces under the FOR UPDATE lock: the row set cannot have
            // moved, so a mismatch would be a bug, not a race.
            guard === null ? undefined : eq(FAMILY_STATUS_COLUMN[family], guard),
          ),
        )
        .returning({ id: matchPeriodSummaries.id })
      if (updated.length !== ids.length) {
        throw new Error(
          `setExtractionStatus: ${family} → ${next} updated ${String(updated.length)} row(s) but ` +
            `${String(ids.length)} were locked and classified. The row set changed under the ` +
            'transaction. Rolled back; no rows were modified.',
        )
      }
      return updated.length
    }

    for (const family of PERIOD_SUMMARY_FAMILIES) {
      counts.periodFamiliesRejected += await applyFamily(family, toReject[family], 'rejected', null)
      await applyFamily(family, toQuarantine[family], 'pending_review', 'reviewed')
    }

    // Clearance carries its barrier re-check INTO the UPDATE, per match/family.
    //
    // `barrierStillStands` above decided on a snapshot; another transaction may
    // reject a different extraction of the same screen type after that read and
    // commit before this write. It cannot be locked out without risking a
    // deadlock between two concurrent clearances, so the guard is evaluated by
    // the write itself: READ COMMITTED gives each statement a fresh snapshot, so
    // either this UPDATE already sees the new rejection and clears nothing, or
    // the rejecting transaction is still behind our period-row locks and sets
    // `rejected` after we commit. Both orders end rejected.
    for (const [matchId, families] of clearByMatch) {
      for (const family of PERIOD_SUMMARY_FAMILIES) {
        const ids = families[family]
        if (ids.length === 0) continue
        const cleared = await tx
          .update(matchPeriodSummaries)
          .set(familyPatch(family, 'pending_review'))
          .where(
            and(
              inArray(matchPeriodSummaries.id, ids),
              eq(FAMILY_STATUS_COLUMN[family], 'rejected'),
              sql`NOT EXISTS (
                SELECT 1 FROM ${ocrExtractions}
                WHERE ${periodFamilyRejectionBarrier(matchId, family)}
                  AND ${ocrExtractions.reviewStatus} = 'rejected'
              )`,
            ),
          )
          .returning({ id: matchPeriodSummaries.id })
        counts.periodRejectionBarriersCleared += cleared.length
      }
    }
  })

  return counts
}
