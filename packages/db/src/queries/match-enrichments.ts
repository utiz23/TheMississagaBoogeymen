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

export type MatchPeriodSummaryRow = Awaited<ReturnType<typeof getMatchPeriodSummaries>>[number]
export type MatchShotTypeSummaryRow = Awaited<ReturnType<typeof getMatchShotTypeSummaries>>[number]
export type MatchFaceoffDotRow = Awaited<ReturnType<typeof getMatchFaceoffDots>>[number]
export type MatchFaceoffZoneSummaryRow = Awaited<
  ReturnType<typeof getMatchFaceoffZoneSummaries>
>[number]
