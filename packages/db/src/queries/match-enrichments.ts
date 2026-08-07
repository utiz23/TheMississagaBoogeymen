import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '../client.js'
import {
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  matchPeriodSummaries,
  matchShotTypeSummaries,
} from '../schema/index.js'

/**
 * Project one stat column through its stat family's review gate.
 *
 * Emits `CASE WHEN <row is EA> OR <family is reviewed> THEN <column> END`, so an
 * unreviewed family reads as SQL NULL. Masking happens in the database, inside
 * the same projection that reads the value — the unsafe raw value never leaves
 * Postgres, so there is no window in which application code holds it.
 *
 * `CASE` with no `ELSE` yields NULL, which is what an unreviewed family must
 * look like. A *reviewed* family's genuine `0` passes through untouched: the
 * gate is on the family status, never on the value, so zero is never confused
 * with "not authorized".
 *
 * `.mapWith(column)` reuses the column's own driver decoder, and drizzle skips
 * decoding for NULL — so the masked result is `null`, not `NaN`/`0`.
 *
 * The cast widens `mapWith`'s inferred type: it reports the column's data type,
 * but a gated `CASE` can also yield NULL, which is precisely the masked reading.
 */
function familyGated(column: AnyPgColumn, familyStatus: AnyPgColumn): SQL<number | null> {
  return sql`CASE WHEN ${matchPeriodSummaries.source} = 'ea' OR ${familyStatus} = 'reviewed' THEN ${column} END`.mapWith(
    column,
  ) as SQL<number | null>
}

/**
 * Per-period goals/shots/faceoffs for a match, gated PER STAT FAMILY.
 *
 * The three families in a row (goals, shots, faceoffs) are captured from three
 * separate Box Score tabs and reviewed independently, so they are authorized
 * independently (migration 0056):
 *
 *   * `source = 'ea'` — EA is the truth source; returned unmasked, review state
 *     is irrelevant to it.
 *   * `source = 'ocr' | 'manual'` — each family is visible only when its own
 *     `*_review_status` is `'reviewed'`. An unreviewed family's two columns come
 *     back NULL. A row survives only if at least one family is reviewed; a row
 *     with all three unreviewed is excluded entirely.
 *
 * The legacy row-level `review_status` is deliberately NOT part of the
 * authorization predicate for the six stat columns — it is transitional
 * metadata, returned for callers that still display it. `review_status =
 * 'reviewed'` on a row whose family status is still `'pending_review'` exposes
 * nothing. Reintroducing it here would restore the whole-row publication defect
 * this gating exists to close.
 *
 * Ordered by period_number ascending.
 */
export async function getMatchPeriodSummaries(matchId: number) {
  return db
    .select({
      id: matchPeriodSummaries.id,
      matchId: matchPeriodSummaries.matchId,
      periodNumber: matchPeriodSummaries.periodNumber,
      periodLabel: matchPeriodSummaries.periodLabel,
      goalsFor: familyGated(matchPeriodSummaries.goalsFor, matchPeriodSummaries.goalsReviewStatus),
      goalsAgainst: familyGated(
        matchPeriodSummaries.goalsAgainst,
        matchPeriodSummaries.goalsReviewStatus,
      ),
      shotsFor: familyGated(matchPeriodSummaries.shotsFor, matchPeriodSummaries.shotsReviewStatus),
      shotsAgainst: familyGated(
        matchPeriodSummaries.shotsAgainst,
        matchPeriodSummaries.shotsReviewStatus,
      ),
      faceoffsFor: familyGated(
        matchPeriodSummaries.faceoffsFor,
        matchPeriodSummaries.faceoffsReviewStatus,
      ),
      faceoffsAgainst: familyGated(
        matchPeriodSummaries.faceoffsAgainst,
        matchPeriodSummaries.faceoffsReviewStatus,
      ),
      source: matchPeriodSummaries.source,
      ocrExtractionId: matchPeriodSummaries.ocrExtractionId,
      /** Transitional legacy status — NOT an authorization signal. */
      reviewStatus: matchPeriodSummaries.reviewStatus,
      goalsReviewStatus: matchPeriodSummaries.goalsReviewStatus,
      shotsReviewStatus: matchPeriodSummaries.shotsReviewStatus,
      faceoffsReviewStatus: matchPeriodSummaries.faceoffsReviewStatus,
      bgmAttackDirection: matchPeriodSummaries.bgmAttackDirection,
    })
    .from(matchPeriodSummaries)
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        // Row retention: EA always; otherwise at least one reviewed family.
        // A row whose every family is unreviewed would be all-NULL stats and is
        // dropped rather than returned as an empty shell.
        or(
          eq(matchPeriodSummaries.source, 'ea'),
          eq(matchPeriodSummaries.goalsReviewStatus, 'reviewed'),
          eq(matchPeriodSummaries.shotsReviewStatus, 'reviewed'),
          eq(matchPeriodSummaries.faceoffsReviewStatus, 'reviewed'),
        ),
      ),
    )
    .orderBy(asc(matchPeriodSummaries.periodNumber))
}

/**
 * Shot-type breakdown for a match per (team_side, period_number).
 *
 * Still WHOLE-ROW gated on the legacy `review_status` — unlike
 * `getMatchPeriodSummaries`, which is now per-stat-family. This table carries a
 * single family (shot types), so one status covers the row; it does not have the
 * mixed-family exposure defect migration 0056 closes. Includes both per-period
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
 * Per-dot face-off outcomes for a match. Single-family table, so still
 * whole-row gated on the legacy `review_status` (see `getMatchShotTypeSummaries`).
 * Ordered by period_number, then dot_id.
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
 * wins/total) per team_side. Single-family table, so still whole-row gated on
 * the legacy `review_status` (see `getMatchShotTypeSummaries`).
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
 * Read-only. Reports "N rows quarantined" without flipping anything.
 *
 * TRANSITIONAL LIMITATION: this still counts by the legacy row-level
 * `review_status`, so it is a ROW count, not a family count. It says nothing
 * about which of a row's goals/shots/faceoffs families remain unreviewed — a row
 * with `review_status = 'reviewed'` but three pending families is not counted
 * here even though nothing in it is publishable. Its number is therefore a lower
 * bound on outstanding review work. A family-aware replacement lands with the
 * family-scoped promotion API; until then, do not treat a zero from this
 * function as "this match is fully reviewed".
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
 * @deprecated DISABLED — always throws. Whole-row promotion is unsafe and has no
 * replacement in this commit.
 *
 * This used to flip every pending OCR per-period row of a match to
 * `review_status = 'reviewed'`, publishing the whole row at once. That is the
 * defect migration 0056 exists to close: a `match_period_summaries` row packs
 * three independently-captured stat families (goals, shots, faceoffs), and the
 * only verdict that can authorize promotion — `reconcilePeriods()` — grades
 * GOALS alone, because EA publishes no per-period shot or faceoff breakdown.
 * Every historical call therefore published unvalidated shots, unvalidated
 * faceoffs, partially-captured families and phantom OT periods alongside the
 * goals it did validate. The live corpus already contains data published this
 * way.
 *
 * It fails closed rather than being deleted so that existing callers (the
 * `reconcile-periods` CLI) still compile while the staged migration proceeds,
 * and so that any attempt to promote loudly reaches an operator instead of
 * silently widening the corruption. It performs NO database work before
 * throwing — a caller that ignores the error has still mutated nothing.
 *
 * The replacement is a family-scoped, period-bounded promotion API landing with
 * the worker/reconciliation slice: a goals-only verdict may set
 * `goals_review_status` and nothing else. Until then, promotion is operator-only
 * and out-of-band.
 *
 * @throws always.
 */
export async function markOcrPeriodSummariesReviewed(_matchId: number): Promise<number> {
  throw new Error(
    'markOcrPeriodSummariesReviewed is disabled: whole-row promotion of match_period_summaries ' +
      'is unsafe. A row carries three independently-captured stat families (goals, shots, ' +
      'faceoffs) and reconcilePeriods() can only grade goals, so flipping the row published ' +
      'unvalidated shots/faceoffs, partial families and phantom OT periods. Per-family bounded ' +
      'promotion is required; the family-scoped API lands with the worker/reconciliation slice. ' +
      'No rows were modified.',
  )
}

export type MatchPeriodSummaryRow = Awaited<ReturnType<typeof getMatchPeriodSummaries>>[number]
export type MatchShotTypeSummaryRow = Awaited<ReturnType<typeof getMatchShotTypeSummaries>>[number]
export type MatchFaceoffDotRow = Awaited<ReturnType<typeof getMatchFaceoffDots>>[number]
export type MatchFaceoffZoneSummaryRow = Awaited<
  ReturnType<typeof getMatchFaceoffZoneSummaries>
>[number]
