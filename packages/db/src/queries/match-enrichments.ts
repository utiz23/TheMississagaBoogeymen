import { and, asc, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { db } from '../client.js'
import {
  matchFaceoffDots,
  matchFaceoffZoneSummaries,
  matchPeriodSummaries,
  matchShotTypeSummaries,
  matches,
  opponentPlayerMatchStats,
  playerMatchStats,
  type OcrReviewStatus,
} from '../schema/index.js'
import {
  PERIOD_SUMMARY_FAMILIES,
  computePeriodEvidence,
  isPeriodSummaryFamily,
  reconcileFromEvidence,
  type PeriodApiTruth,
  type PeriodFamilyReading,
  type PeriodSummaryFamily,
} from '../lib/period-reconciliation.js'

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
 * The stat-family union and the reconciliation policy both live in
 * `../lib/period-reconciliation.js` — a pure, import-free module shared with the
 * worker's L4 comparator and the `reconcile-periods` CLI, so the code that
 * REPORTS a verdict and the code that ACTS on it cannot drift apart. Re-exported
 * here so `@eanhl/db/queries` consumers keep their existing import.
 */
export { PERIOD_SUMMARY_FAMILIES, type PeriodSummaryFamily } from '../lib/period-reconciliation.js'

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
   * The LAST period this call may authorize.
   *
   * ⚠️ THIS IS A CLAIM, NOT AUTHORIZATION. It must equal the periods-played bound
   * this function derives for itself from EA player TOI inside the transaction;
   * anything else throws. It is retained as a parameter so a caller states the
   * bound it believes it is promoting under and gets a loud error when its view
   * has gone stale — never so a caller can choose the bound.
   */
  maxPeriod: number
}

export interface PromoteOcrPeriodFamilyResult {
  matchId: number
  family: PeriodSummaryFamily
  maxPeriod: number
  /**
   * The periods-played bound this call DERIVED from EA player TOI. Always equal
   * to `maxPeriod` (the call throws otherwise); reported so a caller logging the
   * result records the authoritative number rather than its own claim.
   */
  derivedPeriodsPlayed: number
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
 * Promote ONE stat family of ONE match's OCR per-period rows, bounded to the
 * periods EA player TOI proves the game reached.
 *
 * This is the only automatic path to `*_review_status = 'reviewed'`, and it is
 * deliberately narrow:
 *
 *   * **One family.** The UPDATE names a single column ({@link REVIEWED_PATCH}).
 *     A goals verdict cannot expose shots or faceoffs, which is the whole defect
 *     migration 0056 exists to close.
 *   * **Bounded, by a bound this function derives.** Only `source='ocr'` rows
 *     with `1 <= period_number <= periodsPlayed`, where `periodsPlayed` comes
 *     from `max(player_match_stats.toi_seconds)` read here — never from
 *     `max(period_number)` of the OCR rows (which would let a phantom OT row
 *     authorize itself) and never from the caller.
 *   * **Semantically authorized.** The reconciliation verdict for this family is
 *     recomputed here from authoritative rows, through the SAME pure policy the
 *     `reconcile-periods` CLI reports from
 *     (`../lib/period-reconciliation.js`). Structural completeness is necessary
 *     but nowhere near sufficient: a complete breakdown that sums to the wrong
 *     final, a complete faceoff set that misses EA's total, a vacuous sum, an
 *     uncontested played period and an unverifiable match are all refused.
 *   * **All-or-nothing.** If any expected period is missing, half-read or
 *     rejected, NOTHING is promoted. A partially-published breakdown is worse
 *     than an unpublished one: it reads as complete on the recap.
 *   * **Never legacy.** `review_status` is neither read as authorization nor
 *     written. It stays exactly as it was. Neither is an existing `reviewed`
 *     family status treated as proof — the evidence is regraded every time.
 *   * **Never shots.** Shots have no automatic path at all.
 *
 * SAFE WHEN CALLED DIRECTLY. Every precondition is enforced here, not by the
 * CLI, and none of them is a caller-supplied token: `maxPeriod` is checked for
 * exact equality against the derived bound and otherwise contributes nothing.
 * The evidence reads, the authorization decision and the UPDATE all run in ONE
 * transaction, with the EA truth rows locked `FOR SHARE` and the candidate OCR
 * rows locked `FOR UPDATE`. So the state the verdict is computed on is the state
 * that gets written: a concurrent writer can neither change the truth the
 * decision rests on nor slip a value into the rows being classified. If the
 * UPDATE still touches a different period set than the decision authorized, the
 * transaction is rolled back and the call throws rather than reporting success.
 *
 * @throws on an unknown family, on `shots`, on a non-positive-integer
 *         `maxPeriod`/`matchId`, when no period bound can be derived, when
 *         `maxPeriod` disagrees with the derived bound, or on a post-mutation
 *         row-set mismatch. Every throw either happens before any DB work or
 *         rolls the transaction back; a throwing call never leaves rows
 *         half-promoted.
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
        'It is checked against the periods-played bound derived from EA player TOI; an absent ' +
        'or untrustworthy bound must fail closed, not promote everything. No rows were modified.',
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
    // ── authoritative EA truth, locked ───────────────────────────────────────
    //
    // Read inside the transaction and locked `FOR SHARE` so it cannot be
    // rewritten (or deleted) between grading and writing. FOR SHARE rather than
    // FOR UPDATE: concurrent promoters of other families read the same truth and
    // must not serialize against each other, only against a writer of it.
    //
    // Locks are taken in a fixed order — matches, then player stats, then the
    // period rows — so two concurrent promotions cannot deadlock.
    //
    // Aggregation happens in TypeScript rather than SQL because Postgres rejects
    // FOR SHARE alongside an aggregate; the row counts here are per-match roster
    // sized (~6-12), so it costs nothing.
    const matchRows = await tx
      .select({ scoreFor: matches.scoreFor, scoreAgainst: matches.scoreAgainst })
      .from(matches)
      .where(eq(matches.id, matchId))
      .for('share')

    const ourStats = await tx
      .select({
        toiSeconds: playerMatchStats.toiSeconds,
        faceoffWins: playerMatchStats.faceoffWins,
      })
      .from(playerMatchStats)
      .where(eq(playerMatchStats.matchId, matchId))
      .for('share')

    const oppStats = await tx
      .select({ faceoffWins: opponentPlayerMatchStats.faceoffWins })
      .from(opponentPlayerMatchStats)
      .where(eq(opponentPlayerMatchStats.matchId, matchId))
      .for('share')

    // Lock every OCR period row of the match. The classification below and the
    // UPDATE that acts on it must see the same state (TOCTOU): without the lock
    // a concurrent promoter/repromoter could fill a null side, or flip a status,
    // between the two statements.
    const rows = await tx
      .select({
        id: matchPeriodSummaries.id,
        periodNumber: matchPeriodSummaries.periodNumber,
        goalsFor: matchPeriodSummaries.goalsFor,
        goalsAgainst: matchPeriodSummaries.goalsAgainst,
        faceoffsFor: matchPeriodSummaries.faceoffsFor,
        faceoffsAgainst: matchPeriodSummaries.faceoffsAgainst,
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

    // ── derive the bound, and check the caller's claim against it ────────────
    //
    // MAX over BGM skaters only, mirroring `getMaxToiSecondsForMatch` — the
    // longest-playing skater measures the game's real duration, while a player
    // who joined late would understate it. Both teams skate the same clock.
    let maxToiSeconds: number | null = null
    for (const s of ourStats) {
      const toi = s.toiSeconds
      // `null` is "no TOI recorded for this skater", not zero — skip it so one
      // unrecorded player cannot drag the bound down. A non-finite value is
      // equally unusable; both leave `maxToiSeconds` null if nobody has one.
      if (toi == null || !Number.isFinite(toi)) continue
      maxToiSeconds = maxToiSeconds === null ? toi : Math.max(maxToiSeconds, toi)
    }

    const readings: PeriodFamilyReading[] = rows.map((r) => ({
      periodNumber: r.periodNumber,
      goalsFor: r.goalsFor ?? null,
      goalsAgainst: r.goalsAgainst ?? null,
      faceoffsFor: r.faceoffsFor ?? null,
      faceoffsAgainst: r.faceoffsAgainst ?? null,
    }))

    const sumWins = (stats: { faceoffWins: number | null }[]): number =>
      stats.reduce((acc, s) => acc + (s.faceoffWins ?? 0), 0)

    const matchRow = matchRows[0]
    const truth: PeriodApiTruth | null = matchRow
      ? {
          scoreFor: matchRow.scoreFor,
          scoreAgainst: matchRow.scoreAgainst,
          // EA's only faceoff truth is the summed per-player wins; there is no
          // team faceoff column.
          faceoffsFor: sumWins(ourStats),
          faceoffsAgainst: sumWins(oppStats),
        }
      : null

    const evidence = computePeriodEvidence({ periods: readings, maxToiSeconds, truth })
    const periodsPlayed = evidence.periodsPlayed

    if (periodsPlayed === null || periodsPlayed < 1) {
      throw new Error(
        `promoteOcrPeriodFamily: match ${String(matchId)} has no derivable period bound — EA ` +
          'player TOI does not say how many periods the game reached, so which periods are ' +
          'EXPECTED is unknown and nothing can be authorized. A caller-supplied maxPeriod is a ' +
          'claim, not evidence, and cannot stand in for it. Rolled back; no rows were modified.',
      )
    }
    if (maxPeriod !== periodsPlayed) {
      throw new Error(
        `promoteOcrPeriodFamily: maxPeriod=${String(maxPeriod)} disagrees with the ` +
          `${String(periodsPlayed)}-period bound derived from EA player TOI for match ` +
          `${String(matchId)}. maxPeriod is a claim to be checked, never authorization: a lower ` +
          'value would publish a truncated breakdown as if complete, a higher one would publish ' +
          'periods that were never played. Rolled back; no rows were modified.',
      )
    }

    // ── the semantic verdict, from the SHARED policy ─────────────────────────
    //
    // `reconcileFromEvidence` is the same function the reconcile-periods CLI
    // reports from, so the boundary cannot be looser than the report. `pass`
    // gates only the review-task flag and is irrelevant here.
    const reconciliation = reconcileFromEvidence(evidence)
    const verdict = reconciliation.families[family]

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

    const refuse = (reason: string): PromoteOcrPeriodFamilyResult => ({
      matchId,
      family,
      maxPeriod,
      derivedPeriodsPlayed: periodsPlayed,
      authorized: false,
      promotedPeriods: [],
      alreadyReviewedPeriods,
      missingPeriods,
      incompletePeriods,
      rejectedPeriods,
      excludedPeriods,
      reason,
    })

    // The SEMANTIC gate, checked before the structural one: a family whose
    // values do not reconcile is unpublishable no matter how complete its rows
    // are, and saying so is the more useful diagnosis.
    if (!verdict.promotable) {
      return refuse(
        `${family}: not reconciled against EA truth — ${verdict.reason}. Promoted nothing.`,
      )
    }
    // Belt and braces: the verdict must cover exactly the bounded window. This
    // can only fail if the policy and the bound ever disagree, and if they do,
    // nothing is written.
    const authorized = [...verdict.authorizedPeriods].sort((a, b) => a - b)
    const expectedWindow = Array.from({ length: maxPeriod }, (_, i) => i + 1)
    if (
      authorized.length !== expectedWindow.length ||
      authorized.some((p, i) => p !== expectedWindow[i])
    ) {
      throw new Error(
        `promoteOcrPeriodFamily: the ${family} verdict authorized periods ` +
          `[${authorized.join(',')}] but the derived bound is 1..${String(maxPeriod)} for match ` +
          `${String(matchId)}. Rolled back; no rows were modified.`,
      )
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
      return refuse(
        `${family}: expected periods 1..${String(maxPeriod)} are not all publishable (${why}) — ` +
          'promoted nothing rather than publishing a partial breakdown',
      )
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
      derivedPeriodsPlayed: periodsPlayed,
      authorized: true,
      promotedPeriods,
      alreadyReviewedPeriods,
      missingPeriods,
      incompletePeriods,
      rejectedPeriods,
      excludedPeriods,
      reason:
        `${family}: periods 1..${String(maxPeriod)} reconcile against EA truth and are ` +
        `authorized (${String(promotedPeriods.length)} promoted, ` +
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
