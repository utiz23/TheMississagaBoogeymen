import { and, asc, eq, or } from 'drizzle-orm'
import { db } from '../client.js'
import {
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  matchPeriodSummaries,
  matchShotTypeSummaries,
} from '../schema/index.js'

/**
 * Per-period goals/shots/faceoffs for a match.
 *
 * EA-source rows (`source = 'ea'`) always pass; OCR-source rows pass only when
 * `review_status = 'reviewed'`. Ordered by period_number ascending.
 */
export async function getMatchPeriodSummaries(matchId: number) {
  return db
    .select()
    .from(matchPeriodSummaries)
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        or(
          eq(matchPeriodSummaries.source, 'ea'),
          and(
            eq(matchPeriodSummaries.source, 'ocr'),
            eq(matchPeriodSummaries.reviewStatus, 'reviewed'),
          ),
          and(
            eq(matchPeriodSummaries.source, 'manual'),
            eq(matchPeriodSummaries.reviewStatus, 'reviewed'),
          ),
        ),
      ),
    )
    .orderBy(asc(matchPeriodSummaries.periodNumber))
}

/**
 * Shot-type breakdown for a match per (team_side, period_number).
 *
 * Same review-status gating as `getMatchPeriodSummaries`. Includes both per-period
 * rows and the full-game aggregate (period_number = -1).
 */
export async function getMatchShotTypeSummaries(matchId: number) {
  return db
    .select()
    .from(matchShotTypeSummaries)
    .where(
      and(
        eq(matchShotTypeSummaries.matchId, matchId),
        or(
          eq(matchShotTypeSummaries.source, 'ea'),
          and(
            eq(matchShotTypeSummaries.source, 'ocr'),
            eq(matchShotTypeSummaries.reviewStatus, 'reviewed'),
          ),
          and(
            eq(matchShotTypeSummaries.source, 'manual'),
            eq(matchShotTypeSummaries.reviewStatus, 'reviewed'),
          ),
        ),
      ),
    )
    .orderBy(asc(matchShotTypeSummaries.periodNumber), asc(matchShotTypeSummaries.teamSide))
}

/**
 * Per-dot face-off outcomes for a match. Same review-status gating as the
 * other enrichment queries. Ordered by period_number, then dot_id.
 */
export async function getMatchFaceoffDots(matchId: number) {
  return db
    .select()
    .from(matchFaceoffDots)
    .where(
      and(
        eq(matchFaceoffDots.matchId, matchId),
        or(
          eq(matchFaceoffDots.source, 'ea'),
          and(eq(matchFaceoffDots.source, 'ocr'), eq(matchFaceoffDots.reviewStatus, 'reviewed')),
          and(eq(matchFaceoffDots.source, 'manual'), eq(matchFaceoffDots.reviewStatus, 'reviewed')),
        ),
      ),
    )
    .orderBy(asc(matchFaceoffDots.periodNumber), asc(matchFaceoffDots.dotId))
}

/**
 * Per-period zone-split faceoff summaries (overall %, OZ wins/total, DZ
 * wins/total) per team_side. Same review-status gating.
 */
export async function getMatchFaceoffZoneSummaries(matchId: number) {
  return db
    .select()
    .from(matchFaceoffZoneSummaries)
    .where(
      and(
        eq(matchFaceoffZoneSummaries.matchId, matchId),
        or(
          eq(matchFaceoffZoneSummaries.source, 'ea'),
          and(
            eq(matchFaceoffZoneSummaries.source, 'ocr'),
            eq(matchFaceoffZoneSummaries.reviewStatus, 'reviewed'),
          ),
          and(
            eq(matchFaceoffZoneSummaries.source, 'manual'),
            eq(matchFaceoffZoneSummaries.reviewStatus, 'reviewed'),
          ),
        ),
      ),
    )
    .orderBy(asc(matchFaceoffZoneSummaries.periodNumber), asc(matchFaceoffZoneSummaries.teamSide))
}

/**
 * Count this match's OCR per-period rows still awaiting review.
 *
 * Read-only companion to {@link markOcrPeriodSummariesReviewed} — lets a caller
 * report "N rows quarantined" without flipping anything.
 */
export async function countPendingOcrPeriodSummaries(matchId: number): Promise<number> {
  const rows = await db
    .select({ id: matchPeriodSummaries.id })
    .from(matchPeriodSummaries)
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        eq(matchPeriodSummaries.source, 'ocr'),
        eq(matchPeriodSummaries.reviewStatus, 'pending_review'),
      ),
    )
  return rows.length
}

/**
 * Flip this match's pending OCR per-period rows to `review_status = 'reviewed'`,
 * making them visible to {@link getMatchPeriodSummaries} (and so to the frontend).
 *
 * ⚠️ INVARIANT — DO NOT CALL THIS ON A `PASS` VERDICT.
 * Per-period correctness is auto-unverifiable: EA publishes no per-period
 * breakdown, so `matches` carries no truth to grade a period read against.
 * `overall.pass` / `gateFromL4` grade the box-score FINAL only and say nothing
 * about the per-period rows — match 2675 is a correct PASS whose P3
 * goals-against reads 7 in a 5-goal game. Wiring "PASS ⇒ promote periods" turns
 * the `pending_review` quarantine into a silent-corruption pipe.
 *
 * The ONLY authorized callers are:
 *   (a) `reconcile-periods` CLI, gated on `reconcilePeriods().promotable` —
 *       i.e. `periodCoverage === 1 && periodAccuracy === 1`, the sole automatic
 *       self-consistency check EA data can support; or
 *   (b) manual operator review (`ingest-ocr-review`).
 *
 * See docs/calibration/l4-per-period-review-gating-2026-07-16.md.
 *
 * @returns the number of rows promoted.
 */
export async function markOcrPeriodSummariesReviewed(matchId: number): Promise<number> {
  const updated = await db
    .update(matchPeriodSummaries)
    // No `reviewed_at` column on this table (unlike ocr_extractions) — the
    // promotion is recorded by the status flip alone.
    .set({ reviewStatus: 'reviewed' })
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        eq(matchPeriodSummaries.source, 'ocr'),
        eq(matchPeriodSummaries.reviewStatus, 'pending_review'),
      ),
    )
    .returning({ id: matchPeriodSummaries.id })
  return updated.length
}

export type MatchPeriodSummaryRow = Awaited<ReturnType<typeof getMatchPeriodSummaries>>[number]
export type MatchShotTypeSummaryRow = Awaited<ReturnType<typeof getMatchShotTypeSummaries>>[number]
export type MatchFaceoffDotRow = Awaited<ReturnType<typeof getMatchFaceoffDots>>[number]
export type MatchFaceoffZoneSummaryRow = Awaited<
  ReturnType<typeof getMatchFaceoffZoneSummaries>
>[number]
