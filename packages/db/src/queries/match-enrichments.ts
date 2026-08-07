import { and, asc, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '../client.js'
import {
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  matchPeriodSummaries,
  matchShotTypeSummaries,
  type OcrReviewStatus,
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
 * SUPERSEDED by {@link countPendingOcrPeriodFamilies} — prefer it. This counts by
 * the legacy row-level `review_status`, so it is a ROW count, not a family count,
 * and the two are not interchangeable: a row with `review_status = 'reviewed'`
 * but three pending families is not counted here even though nothing in it is
 * publishable. Its number is a lower bound on outstanding review work, so a zero
 * from it does NOT mean "this match is fully reviewed". Retained only for
 * callers that genuinely want the legacy row state; nothing in the promotion
 * path may consult it.
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
 * The replacement has landed: {@link promoteOcrPeriodFamily} — family-scoped and
 * period-bounded, so a goals-only verdict may set `goals_review_status` for the
 * periods EA TOI proves were played, and nothing else. Use it. This export stays
 * only so an unconverted caller fails loudly instead of silently widening the
 * corruption.
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

// ── family-scoped, period-bounded promotion ──────────────────────────────────

/**
 * The three independently-captured stat families in a `match_period_summaries`
 * row — one per Post-Game Box Score tab. Closed union: anything outside it is a
 * programming error, and the mutation boundary rejects it rather than defaulting.
 */
export type PeriodSummaryFamily = 'goals' | 'shots' | 'faceoffs'

export const PERIOD_SUMMARY_FAMILIES: readonly PeriodSummaryFamily[] = [
  'goals',
  'shots',
  'faceoffs',
]

function isPeriodSummaryFamily(value: unknown): value is PeriodSummaryFamily {
  return value === 'goals' || value === 'shots' || value === 'faceoffs'
}

/** The two value columns and the one status column each family owns. */
const FAMILY_COLUMNS = {
  goals: {
    forColumn: matchPeriodSummaries.goalsFor,
    againstColumn: matchPeriodSummaries.goalsAgainst,
    statusColumn: matchPeriodSummaries.goalsReviewStatus,
  },
  shots: {
    forColumn: matchPeriodSummaries.shotsFor,
    againstColumn: matchPeriodSummaries.shotsAgainst,
    statusColumn: matchPeriodSummaries.shotsReviewStatus,
  },
  faceoffs: {
    forColumn: matchPeriodSummaries.faceoffsFor,
    againstColumn: matchPeriodSummaries.faceoffsAgainst,
    statusColumn: matchPeriodSummaries.faceoffsReviewStatus,
  },
} as const

/**
 * The patch each family's promotion applies. Exactly ONE column per entry —
 * this object is the reason a goals promotion cannot touch shots or faceoffs.
 */
const REVIEWED_PATCH = {
  goals: { goalsReviewStatus: 'reviewed' },
  shots: { shotsReviewStatus: 'reviewed' },
  faceoffs: { faceoffsReviewStatus: 'reviewed' },
} as const satisfies Record<PeriodSummaryFamily, Record<string, OcrReviewStatus>>

export interface PromoteOcrPeriodFamilyRequest {
  matchId: number
  family: PeriodSummaryFamily
  /**
   * The LAST period this call may authorize — the independently derived
   * periods-played bound (EA player TOI), never `max(period_number)` of the OCR
   * rows themselves. Periods above it stay pending, whatever they contain.
   */
  maxPeriod: number
}

export interface PromoteOcrPeriodFamilyResult {
  matchId: number
  family: PeriodSummaryFamily
  maxPeriod: number
  /** true ⇔ every expected period 1..maxPeriod now carries this family reviewed. */
  authorized: boolean
  /** Periods this call flipped pending_review → reviewed. */
  promotedPeriods: number[]
  /** Expected periods whose family was ALREADY reviewed (idempotent re-run). */
  alreadyReviewedPeriods: number[]
  /** Expected periods with no OCR row at all. */
  missingPeriods: number[]
  /** Expected periods present but with a null side — a half-read family. */
  incompletePeriods: number[]
  /** Expected periods whose family an operator explicitly rejected. */
  rejectedPeriods: number[]
  /** OCR periods above `maxPeriod`: excluded from the decision, left pending. */
  excludedPeriods: number[]
  reason: string
}

/**
 * Promote ONE stat family of ONE match's OCR per-period rows, bounded to periods
 * `1..maxPeriod`.
 *
 * This is the only automatic path to `*_review_status = 'reviewed'`, and it is
 * deliberately narrow:
 *
 *   * **One family.** The UPDATE names a single column ({@link REVIEWED_PATCH}).
 *     A goals verdict cannot expose shots or faceoffs, which is the whole defect
 *     migration 0056 exists to close.
 *   * **Bounded.** Only `source='ocr'` rows with `1 <= period_number <=
 *     maxPeriod`. `maxPeriod` is the caller's INDEPENDENTLY derived
 *     periods-played bound; passing `max(period_number)` of the OCR rows would
 *     let a phantom OT row authorize itself.
 *   * **All-or-nothing.** If any expected period is missing, half-read or
 *     rejected, NOTHING is promoted. A partially-published breakdown is worse
 *     than an unpublished one: it reads as complete on the recap.
 *   * **Never legacy.** `review_status` is neither read as authorization nor
 *     written. It stays exactly as it was.
 *   * **Never shots.** Shots have no automatic path at all (see below).
 *
 * Safe when called directly: every precondition is enforced here, not by the
 * CLI. Validation and mutation share one transaction and the candidate rows are
 * locked `FOR UPDATE`, so the row state the decision is made on is the row state
 * that gets written — a concurrent writer cannot slip a value in between. If the
 * UPDATE still touches a different period set than the decision authorized, the
 * transaction is rolled back and the call throws rather than reporting success.
 *
 * @throws on an unknown family, on `shots`, on a non-positive-integer
 *         `maxPeriod`/`matchId`, or on a post-mutation row-set mismatch. Every
 *         throw either happens before any DB work or rolls the transaction back;
 *         a throwing call never leaves rows half-promoted.
 */
export async function promoteOcrPeriodFamily(
  request: PromoteOcrPeriodFamilyRequest,
): Promise<PromoteOcrPeriodFamilyResult> {
  const { matchId, family, maxPeriod } = request

  if (!isPeriodSummaryFamily(family)) {
    throw new Error(
      `promoteOcrPeriodFamily: unknown stat family ${JSON.stringify(family)}. ` +
        `Expected one of ${PERIOD_SUMMARY_FAMILIES.join(', ')}. No rows were modified.`,
    )
  }
  if (family === 'shots') {
    throw new Error(
      'promoteOcrPeriodFamily: shots have no automatic promotion path. EA publishes no ' +
        'per-period shot breakdown, and its whole-game totals are not comparable truth — the ' +
        'box-score per-period shots legitimately differ from matches.shots_* (match 250 reads ' +
        '29 vs API 25). Per-period shots are operator-review-only. No rows were modified.',
    )
  }
  if (!Number.isInteger(maxPeriod) || maxPeriod < 1) {
    throw new Error(
      `promoteOcrPeriodFamily: maxPeriod must be a positive integer, got ${String(maxPeriod)}. ` +
        'It is the independently derived periods-played bound; an absent or untrustworthy ' +
        'bound must fail closed, not promote everything. No rows were modified.',
    )
  }
  if (!Number.isInteger(matchId) || matchId < 1) {
    throw new Error(
      `promoteOcrPeriodFamily: matchId must be a positive integer, got ${String(matchId)}. ` +
        'No rows were modified.',
    )
  }

  const columns = FAMILY_COLUMNS[family]

  return db.transaction(async (tx) => {
    // Lock every OCR period row of the match. The classification below and the
    // UPDATE that acts on it must see the same state (TOCTOU): without the lock
    // a concurrent promoter/repromoter could fill a null side, or flip a status,
    // between the two statements.
    const rows = await tx
      .select({
        id: matchPeriodSummaries.id,
        periodNumber: matchPeriodSummaries.periodNumber,
        forValue: columns.forColumn,
        againstValue: columns.againstColumn,
        status: columns.statusColumn,
      })
      .from(matchPeriodSummaries)
      .where(
        and(
          eq(matchPeriodSummaries.matchId, matchId),
          eq(matchPeriodSummaries.source, 'ocr'),
          gte(matchPeriodSummaries.periodNumber, 1),
        ),
      )
      .for('update')

    const excludedPeriods = rows
      .filter((r) => r.periodNumber > maxPeriod)
      .map((r) => r.periodNumber)
      .sort((a, b) => a - b)

    const inBound = new Map(
      rows.filter((r) => r.periodNumber <= maxPeriod).map((r) => [r.periodNumber, r]),
    )

    const missingPeriods: number[] = []
    const incompletePeriods: number[] = []
    const rejectedPeriods: number[] = []
    const alreadyReviewedPeriods: number[] = []
    const pending: { id: number; periodNumber: number }[] = []

    for (let period = 1; period <= maxPeriod; period++) {
      const row = inBound.get(period)
      if (!row) {
        missingPeriods.push(period)
        continue
      }
      // A null side is an unread half of the pair. Zero is a real reading and
      // passes — the gate is on presence, never on the value.
      if (row.forValue === null || row.againstValue === null) {
        incompletePeriods.push(period)
        continue
      }
      if (row.status === 'rejected') {
        rejectedPeriods.push(period)
        continue
      }
      if (row.status === 'reviewed') {
        alreadyReviewedPeriods.push(period)
        continue
      }
      pending.push({ id: row.id, periodNumber: period })
    }

    const blocked = missingPeriods.length + incompletePeriods.length + rejectedPeriods.length
    if (blocked > 0) {
      const why = [
        missingPeriods.length > 0 ? `missing ${missingPeriods.join(',')}` : null,
        incompletePeriods.length > 0 ? `half-read ${incompletePeriods.join(',')}` : null,
        rejectedPeriods.length > 0 ? `rejected ${rejectedPeriods.join(',')}` : null,
      ]
        .filter((s): s is string => s !== null)
        .join('; ')
      return {
        matchId,
        family,
        maxPeriod,
        authorized: false,
        promotedPeriods: [],
        alreadyReviewedPeriods,
        missingPeriods,
        incompletePeriods,
        rejectedPeriods,
        excludedPeriods,
        reason:
          `${family}: expected periods 1..${String(maxPeriod)} are not all publishable (${why}) — ` +
          'promoted nothing rather than publishing a partial breakdown',
      }
    }

    let promotedPeriods: number[] = []
    if (pending.length > 0) {
      // The status predicate is repeated here on purpose: it is the guard that
      // makes the write idempotent and keeps a row another transaction already
      // advanced from being re-flipped under us.
      const updated = await tx
        .update(matchPeriodSummaries)
        .set(REVIEWED_PATCH[family])
        .where(
          and(
            inArray(
              matchPeriodSummaries.id,
              pending.map((p) => p.id),
            ),
            eq(columns.statusColumn, 'pending_review'),
          ),
        )
        .returning({ periodNumber: matchPeriodSummaries.periodNumber })
      promotedPeriods = updated.map((r) => r.periodNumber).sort((a, b) => a - b)

      const expected = pending.map((p) => p.periodNumber).sort((a, b) => a - b)
      if (
        promotedPeriods.length !== expected.length ||
        promotedPeriods.some((p, i) => p !== expected[i])
      ) {
        // Should be unreachable under the FOR UPDATE lock. If it happens, the
        // row set moved beneath the decision — roll back the whole thing rather
        // than report a promotion we cannot describe.
        throw new Error(
          `promoteOcrPeriodFamily: ${family} promotion for match ${String(matchId)} updated ` +
            `periods [${promotedPeriods.join(',')}] but authorized [${expected.join(',')}] — ` +
            'the row set changed under the transaction. Rolled back; no rows were modified.',
        )
      }
    }

    return {
      matchId,
      family,
      maxPeriod,
      authorized: true,
      promotedPeriods,
      alreadyReviewedPeriods,
      missingPeriods,
      incompletePeriods,
      rejectedPeriods,
      excludedPeriods,
      reason:
        `${family}: periods 1..${String(maxPeriod)} authorized ` +
        `(${String(promotedPeriods.length)} promoted, ` +
        `${String(alreadyReviewedPeriods.length)} already reviewed)` +
        (excludedPeriods.length > 0
          ? `; periods ${excludedPeriods.join(',')} are above the bound and stay pending`
          : ''),
    }
  })
}

/** Per-family pending counts for a match's OCR per-period rows. */
export interface PendingOcrPeriodFamilyCounts {
  goals: number
  shots: number
  faceoffs: number
  /** OCR rows with period_number >= 1 — the denominator each count is out of. */
  rows: number
}

/**
 * Count, PER FAMILY, this match's OCR per-period readings still awaiting review.
 *
 * The family-aware replacement for {@link countPendingOcrPeriodSummaries}. A row
 * contributes independently to each of the three counts, so
 * `goals + shots + faceoffs` is not a row count and must never be reported as
 * one — three pending families on one row is three unpublished readings, not
 * three quarantined rows. Read-only.
 */
export async function countPendingOcrPeriodFamilies(
  matchId: number,
): Promise<PendingOcrPeriodFamilyCounts> {
  const [row] = await db
    .select({
      goals:
        sql<number>`COUNT(*) FILTER (WHERE ${matchPeriodSummaries.goalsReviewStatus} = 'pending_review')`.mapWith(
          Number,
        ),
      shots:
        sql<number>`COUNT(*) FILTER (WHERE ${matchPeriodSummaries.shotsReviewStatus} = 'pending_review')`.mapWith(
          Number,
        ),
      faceoffs:
        sql<number>`COUNT(*) FILTER (WHERE ${matchPeriodSummaries.faceoffsReviewStatus} = 'pending_review')`.mapWith(
          Number,
        ),
      rows: sql<number>`COUNT(*)`.mapWith(Number),
    })
    .from(matchPeriodSummaries)
    .where(
      and(
        eq(matchPeriodSummaries.matchId, matchId),
        eq(matchPeriodSummaries.source, 'ocr'),
        gte(matchPeriodSummaries.periodNumber, 1),
      ),
    )
  return {
    goals: row?.goals ?? 0,
    shots: row?.shots ?? 0,
    faceoffs: row?.faceoffs ?? 0,
    rows: row?.rows ?? 0,
  }
}

export type MatchPeriodSummaryRow = Awaited<ReturnType<typeof getMatchPeriodSummaries>>[number]
export type MatchShotTypeSummaryRow = Awaited<ReturnType<typeof getMatchShotTypeSummaries>>[number]
export type MatchFaceoffDotRow = Awaited<ReturnType<typeof getMatchFaceoffDots>>[number]
export type MatchFaceoffZoneSummaryRow = Awaited<
  ReturnType<typeof getMatchFaceoffZoneSummaries>
>[number]
