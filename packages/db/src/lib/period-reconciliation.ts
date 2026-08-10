/**
 * Per-period stat-family reconciliation POLICY — pure and dependency-safe.
 *
 * This module is the SINGLE definition of what makes a per-period stat family
 * publishable. It has no imports at all: no drizzle, no `db` client, no schema.
 * That is deliberate and is the point of the module — the two places that must
 * agree on the policy sit on opposite sides of the package boundary:
 *
 *   * `packages/db/src/queries/match-enrichments.ts` — `promoteOcrPeriodFamily`,
 *     the MUTATION boundary, which must establish authorization for itself.
 *   * `apps/worker/src/lib/l4-api-truth.ts` — the L4 comparator and the
 *     reconcile-periods CLI, which REPORT the same verdict.
 *
 * A worker module cannot be imported by `@eanhl/db` (the dependency runs the
 * other way), so before this module existed the mutation boundary had no way to
 * reach the policy and simply trusted its caller. Duplicating the rules instead
 * would give two implementations that drift, and the one that drifts looser
 * silently publishes bad data. Both sides now call `computePeriodEvidence` and
 * `reconcilePeriods` here, so a policy change lands in both at once.
 *
 * THE GRADING PRINCIPLE. EA publishes no per-period truth for any stat family.
 * Every verdict below is therefore a BOUNDED SUMMED-CONSISTENCY check: sum the
 * per-period readings over exactly the periods EA player TOI proves the game
 * reached, and require an exact match against EA's whole-game total. That is
 * weak evidence on its own, so each family additionally requires complete
 * coverage of the expected periods and a de-confounder that rules out the ways
 * a sum can agree without meaning anything.
 */

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

export function isPeriodSummaryFamily(value: unknown): value is PeriodSummaryFamily {
  return value === 'goals' || value === 'shots' || value === 'faceoffs'
}

/**
 * The Box Score tab each stat family is captured on — the ONLY link between an
 * `ocr_extractions` row and the family it could have written.
 *
 * This is a screen-type mapping, not provenance: it says which family an
 * extraction was ABOUT, never which row values it actually produced. That makes
 * it unusable for ATTRIBUTION (see the provenance-gap docblock in
 * `apps/worker/src/lib/review-cascade.ts`), but exactly right for a BARRIER: a
 * rejected `post_game_box_score_goals` extraction could have contributed to any
 * goals value on its match, so the whole match/family must fail closed.
 *
 * It lives here, in the import-free policy module, for the same reason the
 * verdicts do — the mutation boundary in `@eanhl/db` and the review cascade in
 * the worker sit on opposite sides of the package boundary and must not drift.
 */
export const PERIOD_FAMILY_SCREEN_TYPES = {
  goals: 'post_game_box_score_goals',
  shots: 'post_game_box_score_shots',
  faceoffs: 'post_game_box_score_faceoffs',
} as const satisfies Record<PeriodSummaryFamily, string>

/**
 * The stat family a screen type implicates, or `null` for any screen that owns
 * no per-period stat family (lobby, events, loadout, …).
 *
 * `null` is a real answer, not a failure: a rejected non-box-score extraction
 * must still trigger the conservative quarantine, but must NEVER create a
 * permanent family rejection, because it has no family to reject.
 */
export function periodFamilyForScreenType(
  screenType: string | null | undefined,
): PeriodSummaryFamily | null {
  for (const family of PERIOD_SUMMARY_FAMILIES) {
    if (PERIOD_FAMILY_SCREEN_TYPES[family] === screenType) return family
  }
  return null
}

/**
 * One OCR per-period reading (`source='ocr'`, `period_number >= 1`).
 *
 * The faceoff pair is optional on the TYPE only: `undefined` marks a caller that
 * supplies goals alone, and reads exactly like a null — unread, never a zero.
 */
export interface PeriodFamilyReading {
  periodNumber: number
  goalsFor: number | null
  goalsAgainst: number | null
  faceoffsFor?: number | null
  faceoffsAgainst?: number | null
}

/**
 * EA-API whole-game truth the bounded sums are graded against.
 *
 * `faceoffsFor`/`faceoffsAgainst` are the SUMMED PER-PLAYER faceoff wins, not a
 * team column — that is the only faceoff truth EA exposes. `null` (no `matches`
 * row) makes every accuracy metric ungradable, which fails every family closed.
 */
export interface PeriodApiTruth {
  scoreFor: number
  scoreAgainst: number
  faceoffsFor: number
  faceoffsAgainst: number
}

/** Reads the two columns one stat family owns off a period row. */
type PairReader = (p: PeriodFamilyReading) => [number | null, number | null]

const GOALS_PAIR: PairReader = (p) => [p.goalsFor, p.goalsAgainst]
const FACEOFFS_PAIR: PairReader = (p) => [p.faceoffsFor ?? null, p.faceoffsAgainst ?? null]

/** A regulation period in seconds. EASHL periods are 20:00; OT is shorter, but
 *  no rule below needs to know OT's length — see {@link periodsPlayedFromToi}. */
const PERIOD_SECONDS = 1200

/**
 * How many periods the game reached, from `max(player_match_stats.toi_seconds)`.
 *
 * Round UP: any time played inside period N means period N was reached. That
 * needs no tolerance — match 972 reads 1197s (a period that ended 3s early, not
 * a clean 1200) and still rounds to 1, while 1665s (match 974: P1 + 7:45 of P2)
 * rounds to 2. Full regulation reads exactly 3600 ⇒ 3.
 *
 * Rounding up is also the SAFE direction. This value only ever makes
 * `periodZerosForced` harder to satisfy (a scoreless row must sit strictly after
 * it), so over-counting can block a correct read but can never vindicate a bad
 * one. That is why OT needs no special case: 3742 (match 2582) and 4643 (match
 * 250) both read as ≥4, which is all "OT was reached" has to mean here.
 */
export function periodsPlayedFromToi(maxToiSeconds: number | null | undefined): number | null {
  if (maxToiSeconds == null || maxToiSeconds <= 0) return null
  return Math.ceil(maxToiSeconds / PERIOD_SECONDS)
}

/** `[1..periodsPlayed]`, or `null` when there is no trustworthy bound. */
export function expectedPeriodsFromPlayed(periodsPlayed: number | null): number[] | null {
  if (periodsPlayed === null || periodsPlayed < 1) return null
  return Array.from({ length: periodsPlayed }, (_, i) => i + 1)
}

/**
 * Coverage of one stat family over the EXPECTED periods.
 *
 * Denominator: the EA-derived expected set, so a fully-absent expected period
 * counts against coverage and an extra OCR period cannot pad it. Numerator:
 * expected periods whose pair is present on BOTH sides — a null side is an
 * unread half, while a zero is a real reading and counts. `null` when there is
 * no bound to measure against.
 */
function boundedCoverage(
  periods: PeriodFamilyReading[],
  expectedPeriods: number[] | null,
  pair: PairReader,
): number | null {
  if (expectedPeriods === null || expectedPeriods.length === 0) return null
  const byNumber = new Map(periods.map((p) => [p.periodNumber, p]))
  let covered = 0
  for (const n of expectedPeriods) {
    const row = byNumber.get(n)
    if (!row) continue
    const [forValue, againstValue] = pair(row)
    if (forValue !== null && againstValue !== null) covered++
  }
  return covered / expectedPeriods.length
}

/** Sum of one family's pair over the expected periods only. */
function boundedPairSum(
  periods: PeriodFamilyReading[],
  expectedPeriods: number[],
  pair: PairReader,
): [number, number] {
  const inBound = new Set(expectedPeriods)
  let sumFor = 0
  let sumAgainst = 0
  for (const p of periods) {
    if (!inBound.has(p.periodNumber)) continue
    const [forValue, againstValue] = pair(p)
    sumFor += forValue ?? 0
    sumAgainst += againstValue ?? 0
  }
  return [sumFor, sumAgainst]
}

/**
 * The TOI de-confounder for `periodSumVacuous` (2026-07-23).
 *
 * true ⇒ every scoreless row lies strictly after the last period played (so 0-0
 * is the ONLY value it could hold) AND every scoring row lies within a played
 * period. Under those two conditions the per-period sum matching the final is
 * real evidence, not an artifact of the shape.
 *
 * Note the second condition is not decoration: a row claiming goals in a period
 * TOI says never happened is a contradiction, and TOI must not vindicate it.
 *
 * Deliberately NOT satisfied by a full game whose whole final landed in P3 —
 * P1/P2 were really played, so their 0-0 is a claim about the game that the sum
 * cannot check. Only rows for periods that never happened are forced.
 */
function computePeriodZerosForced(
  periods: PeriodFamilyReading[],
  periodsPlayed: number | null,
): boolean | null {
  if (periodsPlayed === null) return null
  for (const p of periods) {
    const scoreless = (p.goalsFor ?? 0) === 0 && (p.goalsAgainst ?? 0) === 0
    if (scoreless) {
      if (p.periodNumber <= periodsPlayed) return false
    } else if (p.periodNumber > periodsPlayed) {
      return false
    }
  }
  return true
}

/** Fraction of {for, against} matching, over 2 sub-fields; `null` if either side
 *  of the OCR value is missing (a half-read pair can't be graded/gated). */
export function accuracyOfPair(
  ocrFor: number | null,
  ocrAgainst: number | null,
  apiFor: number,
  apiAgainst: number,
): number | null {
  if (ocrFor == null || ocrAgainst == null) return null
  return ((ocrFor === apiFor ? 1 : 0) + (ocrAgainst === apiAgainst ? 1 : 0)) / 2
}

// ── evidence ─────────────────────────────────────────────────────────────────

/**
 * Every bounded per-period signal, derived from the OCR readings plus EA truth.
 *
 * This is the INPUT SIDE of the policy, and it is shared for the same reason the
 * verdicts are: the signals are where the subtlety lives (which denominator,
 * which periods are in bound, when a metric is `null` rather than `0`), so two
 * implementations of them would drift exactly as fast as two implementations of
 * the rules.
 */
export interface PeriodEvidence {
  /** How many periods the game reached, from EA player TOI. `null` ⇒ no bound. */
  periodsPlayed: number | null
  /** `[1..periodsPlayed]` — the periods that are EXPECTED. `null` ⇒ no bound. */
  expectedPeriods: number[] | null
  /**
   * OCR periods above the bound — phantom OT rows invented by frame
   * segmentation. Excluded from coverage, from the sums, and from promotion.
   * Empty when the bound is unknown (nothing is included either).
   */
  excludedPeriods: number[]
  /**
   * Periods above the bound that nonetheless carry goals. A row claiming a goal
   * in a period TOI says never happened is a contradiction, so it blocks
   * promotion outright rather than being quietly dropped from the sum.
   */
  scoringPeriodsBeyondBound: number[]
  /**
   * Fraction of EXPECTED periods whose goals were read on both sides. `null`
   * when the period bound is unknown.
   *
   * The denominator is `periodsPlayed`, NOT `max(periodNumber)` of the OCR rows:
   * self-derived expectations let a phantom P4 both create and satisfy its own
   * requirement, so a bad read could certify itself.
   */
  periodCoverage: number | null
  /**
   * Summed per-period goals (bounded to the expected periods) vs the EA final —
   * graded ONLY at complete coverage, else `null`, not `0`, which removes the
   * missed-period confound.
   */
  periodAccuracy: number | null
  /** Fraction of EXPECTED periods whose faceoffs were read on BOTH sides. */
  faceoffCoverage: number | null
  /**
   * Bounded per-period faceoff totals vs EA whole-game faceoff truth (summed
   * per-player faceoff wins). Graded only at complete faceoff coverage and only
   * when that truth exists.
   */
  faceoffAccuracy: number | null
  /**
   * true ⇒ every expected period records at least one faceoff across the two
   * sides. Every period that starts opens with a centre-ice draw that someone
   * wins, so an all-zero expected period is a misread (or a whole-game cell
   * leaking into one row) and never a real period. `null` when there is nothing
   * to evaluate (unknown bound or incomplete faceoff coverage).
   */
  faceoffPeriodsContested: boolean | null
  /**
   * true ⇒ EA has faceoff truth to compare against. The per-player faceoff sums
   * COALESCE absent rows to 0, so a 0-0 truth is indistinguishable from "EA
   * published no faceoff data" — an OCR 0-0 agreeing with it proves nothing.
   */
  faceoffTruthPresent: boolean
  /**
   * true ⇒ `periodAccuracy` is VACUOUS: a single period carries the entire final
   * and every other period is 0-0, so the per-period goals sum to the final *by
   * construction* and the sum test proves nothing.
   *
   * The shape has two indistinguishable causes, and box-score data alone cannot
   * tell them apart:
   *   1. a TOT/FINAL cell leaking into the first period row (breakdown fabricated), or
   *   2. a game that really ended early, so the unplayed periods really are 0-0.
   *
   * Either way `periodAccuracy` scores 1 without evidence, so reconciliation must
   * NOT authorize promotion — it routes to review and a human decides. `null` when
   * there is nothing to evaluate (no rows or no API truth).
   *
   * ⚠️ Match 972 is NOT an example of cause 1 — it is cause 2, and its rows are
   * CORRECT. Every skater on both teams has `toi_seconds = 1197` (≈ one 20-minute
   * period), i.e. the opponent quit after P1 and the game really was 5-1 / 0-0 /
   * 0-0 / 0-0. That de-confounding happens via `periodZerosForced`. This field
   * deliberately keeps describing the raw SHAPE, so it stays true for 972.
   * See docs/calibration/l4-per-period-review-gating-2026-07-16.md.
   */
  periodSumVacuous: boolean | null
  /**
   * true ⇒ TOI proves every scoreless per-period row lies strictly AFTER the last
   * period the game reached, so 0-0 is the only value those rows could hold, and
   * every scoring row lies within a played period. This is what de-confounds
   * `periodSumVacuous`. `null` when there is nothing to evaluate.
   */
  periodZerosForced: boolean | null
}

/**
 * Derive every bounded per-period signal from the raw readings + EA truth.
 *
 * `truth === null` (no `matches` row / api-missed) leaves every ACCURACY signal
 * `null` while still reporting the coverage signals, which are a property of the
 * OCR reads plus the TOI bound alone. Downstream that means a family is never
 * promotable without truth, but the scorecard can still say how much was read.
 */
export function computePeriodEvidence(input: {
  periods: PeriodFamilyReading[]
  maxToiSeconds: number | null | undefined
  truth: PeriodApiTruth | null
}): PeriodEvidence {
  const { periods, truth } = input

  // The INDEPENDENT period denominator: it comes from player TOI, never from the
  // OCR rows, so a phantom OT row cannot create the expectation it then
  // satisfies. Computed unconditionally — a property of the EA side alone.
  const periodsPlayed = periodsPlayedFromToi(input.maxToiSeconds)
  const expectedPeriods = expectedPeriodsFromPlayed(periodsPlayed)

  // Everything above the bound is excluded from every metric below. When the
  // bound is unknown nothing is excluded because nothing is included either —
  // the metrics all read `null` and the caller fails closed.
  const excludedPeriods =
    periodsPlayed === null
      ? []
      : periods
          .filter((p) => p.periodNumber > periodsPlayed)
          .map((p) => p.periodNumber)
          .sort((a, b) => a - b)
  const scoringPeriodsBeyondBound =
    periodsPlayed === null
      ? []
      : periods
          .filter(
            (p) =>
              p.periodNumber > periodsPlayed &&
              ((p.goalsFor ?? 0) !== 0 || (p.goalsAgainst ?? 0) !== 0),
          )
          .map((p) => p.periodNumber)
          .sort((a, b) => a - b)

  const periodCoverage = boundedCoverage(periods, expectedPeriods, GOALS_PAIR)
  const faceoffCoverage = boundedCoverage(periods, expectedPeriods, FACEOFFS_PAIR)

  // Every period that starts opens with a centre-ice draw, so a played period
  // with 0-0 faceoffs is a misread. Only meaningful once both sides of every
  // expected period were actually read.
  let faceoffPeriodsContested: boolean | null = null
  if (faceoffCoverage === 1 && expectedPeriods !== null) {
    const byNumber = new Map(periods.map((p) => [p.periodNumber, p]))
    faceoffPeriodsContested = expectedPeriods.every((n) => {
      const row = byNumber.get(n)
      if (!row) return false
      const [forValue, againstValue] = FACEOFFS_PAIR(row)
      return (forValue ?? 0) + (againstValue ?? 0) >= 1
    })
  }

  const faceoffTruthPresent = truth !== null && truth.faceoffsFor + truth.faceoffsAgainst > 0

  if (truth === null) {
    return {
      periodsPlayed,
      expectedPeriods,
      excludedPeriods,
      scoringPeriodsBeyondBound,
      periodCoverage,
      periodAccuracy: null,
      faceoffCoverage,
      faceoffAccuracy: null,
      faceoffPeriodsContested,
      faceoffTruthPresent,
      periodSumVacuous: null,
      periodZerosForced: null,
    }
  }

  // The BOUNDED per-period goals sum, graded ONLY when every EXPECTED period was
  // read. Incomplete ⇒ null (not 0), so a missed period doesn't masquerade as a
  // wrong read.
  let periodAccuracy: number | null = null
  if (periodCoverage === 1 && expectedPeriods !== null) {
    const [sumFor, sumAgainst] = boundedPairSum(periods, expectedPeriods, GOALS_PAIR)
    periodAccuracy = accuracyOfPair(sumFor, sumAgainst, truth.scoreFor, truth.scoreAgainst)
  }

  // The same summed-consistency check for faceoffs, against EA's whole-game
  // faceoff wins. Only graded when that truth exists — a 0-0 EA total means "no
  // faceoff data", and agreeing with it would be evidence of nothing.
  let faceoffAccuracy: number | null = null
  if (faceoffCoverage === 1 && expectedPeriods !== null && faceoffTruthPresent) {
    const [sumFor, sumAgainst] = boundedPairSum(periods, expectedPeriods, FACEOFFS_PAIR)
    faceoffAccuracy = accuracyOfPair(sumFor, sumAgainst, truth.faceoffsFor, truth.faceoffsAgainst)
  }

  // Vacuity check — see `periodSumVacuous`. Computed from the shape alone,
  // independent of coverage, so it stays reportable on partially-read matches.
  let periodSumVacuous: boolean | null = null
  if (periods.length > 0) {
    const inBound =
      periodsPlayed === null ? periods : periods.filter((p) => p.periodNumber <= periodsPlayed)
    const scoring = inBound.filter((p) => (p.goalsFor ?? 0) !== 0 || (p.goalsAgainst ?? 0) !== 0)
    const onlyScoringPeriod = scoring.length === 1 ? scoring[0] : undefined
    periodSumVacuous =
      onlyScoringPeriod?.goalsFor === truth.scoreFor &&
      onlyScoringPeriod.goalsAgainst === truth.scoreAgainst
  }

  const periodZerosForced =
    periodsPlayed === null ? null : computePeriodZerosForced(periods, periodsPlayed)

  return {
    periodsPlayed,
    expectedPeriods,
    excludedPeriods,
    scoringPeriodsBeyondBound,
    periodCoverage,
    periodAccuracy,
    faceoffCoverage,
    faceoffAccuracy,
    faceoffPeriodsContested,
    faceoffTruthPresent,
    periodSumVacuous,
    periodZerosForced,
  }
}

// ── verdicts ─────────────────────────────────────────────────────────────────

export type PeriodReconciliationStatus = 'reconciled' | 'review' | 'not_applicable'

/**
 * The promotion verdict for ONE stat family. Each family is captured on its own
 * Box Score tab and reviewed independently (migration 0056), so each needs its
 * own authorization — a goals verdict says nothing about faceoffs, and neither
 * says anything about shots.
 */
export interface FamilyPromotionVerdict {
  family: PeriodSummaryFamily
  /** true ⇒ this family's `*_review_status` MAY be set for `authorizedPeriods`. */
  promotable: boolean
  /**
   * Exactly the periods this verdict covers — the EA-derived expected set, never
   * anything read beyond it. Empty whenever `promotable` is false.
   */
  authorizedPeriods: number[]
  coverage: number | null
  accuracy: number | null
  reason: string
}

export interface PeriodReconciliation {
  /**
   * GOALS reconciliation verdict over the per-period rows ALONE (independent of
   * the match's pass/fail):
   *   - `reconciled`     — every expected period read AND the bounded per-period
   *                        goals sum to the EA final. The only state that permits
   *                        automatic goals promotion.
   *   - `review`         — rows exist but are incomplete or don't sum. Needs a human.
   *   - `not_applicable` — nothing to reconcile (no rows / no period bound) or
   *                        nothing to reconcile AGAINST (no API truth).
   */
  status: PeriodReconciliationStatus
  /**
   * true ⇒ raise a `period_reconciliation` review task for this match.
   *
   * Gated on the match otherwise passing, per spec: a non-passing match is
   * already in the review queue on its own verdict, so a second task would be
   * noise. NEVER fails the match, withholds its final, or blocks aggregates.
   */
  flag: boolean
  /**
   * LEGACY ALIAS FOR THE GOALS VERDICT — identical to `families.goals.promotable`.
   *
   * It authorizes GOALS ONLY. It is not, and has never been, authorization for
   * shots or faceoffs: reading it as a whole-row verdict is the defect migration
   * 0056 and the family-scoped promotion API exist to close. Prefer `families`;
   * this field survives only so existing readers keep their exact meaning.
   */
  promotable: boolean
  reason: string
  /** The EA-TOI-derived period bound the verdicts are computed against. */
  periodsPlayed: number | null
  /** Explicit per-family authorization. The only safe thing to promote from. */
  families: {
    goals: FamilyPromotionVerdict
    shots: FamilyPromotionVerdict
    faceoffs: FamilyPromotionVerdict
  }
}

export interface PeriodReconciliationInput {
  /**
   * The ROUTING verdict — `gateFromL4(...).decision === 'PASS'`. Gates `flag`
   * only; never any family's `promotable`.
   */
  pass: boolean
  /** EA-TOI-derived period bound. Absent/null ⇒ every family fails closed. */
  periodsPlayed?: number | null
  periodCoverage: number | null
  periodAccuracy: number | null
  periodSumVacuous?: boolean | null
  periodZerosForced?: boolean | null
  /** Periods above the bound that carry goals — a TOI contradiction. */
  scoringPeriodsBeyondBound?: number[]
  faceoffCoverage?: number | null
  faceoffAccuracy?: number | null
  faceoffPeriodsContested?: boolean | null
  faceoffTruthPresent?: boolean
}

const NO_BOUND_REASON =
  'no trustworthy period bound — EA player TOI does not say how many periods the ' +
  'game reached, so which periods are EXPECTED is unknown; failing closed'

/** GOALS — the only family EA data can grade via a summed-consistency check. */
function goalsVerdict(input: PeriodReconciliationInput): {
  status: PeriodReconciliationStatus
  promotable: boolean
  reason: string
} {
  const periodsPlayed = input.periodsPlayed ?? null
  const { periodCoverage, periodAccuracy } = input
  const periodSumVacuous = input.periodSumVacuous ?? null
  const periodZerosForced = input.periodZerosForced ?? null
  const scoringBeyond = input.scoringPeriodsBeyondBound ?? []

  if (periodsPlayed === null || periodsPlayed < 1) {
    return { status: 'not_applicable', promotable: false, reason: NO_BOUND_REASON }
  }
  if (periodCoverage === null) {
    return {
      status: 'not_applicable',
      promotable: false,
      reason: 'no promoted per-period rows — nothing to reconcile',
    }
  }
  if (periodCoverage < 1) {
    return {
      status: 'review',
      promotable: false,
      reason: `periodCoverage=${String(periodCoverage)} (an expected period's goals were not read)`,
    }
  }
  if (periodAccuracy === null) {
    // Ungradable (api-missed): coverage is a property of the OCR reads alone, but
    // there is no final to sum against. An unverifiable read stays quarantined.
    return {
      status: 'not_applicable',
      promotable: false,
      reason: 'all expected periods read but no API truth to reconcile against (ungradable)',
    }
  }
  if (periodAccuracy !== 1) {
    return {
      status: 'review',
      promotable: false,
      reason: `periodAccuracy=${String(periodAccuracy)} (per-period goals do not sum to the API final)`,
    }
  }
  if (scoringBeyond.length > 0) {
    return {
      status: 'review',
      promotable: false,
      reason:
        `period(s) ${scoringBeyond.join(',')} carry goals but lie beyond the ${String(periodsPlayed)}-` +
        'period bound EA TOI proves the game reached — the bounded sum reconciles only because ' +
        'those goals were excluded, so the breakdown contradicts itself and needs a human',
    }
  }
  if (periodSumVacuous === true && periodZerosForced !== true) {
    // A vacuous sum is NOT reconciliation. One period holding the entire final
    // sums correctly by construction whether the breakdown is a whole-game cell
    // leak or an early-ended game, so this routes to review, not promotion.
    return {
      status: 'review',
      promotable: false,
      reason:
        'per-period sum matches the API final VACUOUSLY — one period carries the ' +
        'entire final and the rest are scoreless (a TOT-cell leak and an ' +
        'early-ended game look identical here); the sum test proves nothing, so a ' +
        'human must confirm the breakdown',
    }
  }
  if (periodSumVacuous === true) {
    // Vacuous SHAPE, de-confounded by TOI: the scoreless rows are for periods the
    // game never reached, so 0-0 is the only value they could hold. Match 972.
    return {
      status: 'reconciled',
      promotable: true,
      reason:
        'per-period sum matches the API final and TOI proves the scoreless ' +
        'periods were never played, so their 0-0 is forced — the shape is ' +
        'vacuous but the read is not unverified (early-ended game)',
    }
  }
  return {
    status: 'reconciled',
    promotable: true,
    reason: 'all expected periods read and per-period goals sum to the API final',
  }
}

/** FACEOFFS — graded to the same rigor as goals, against EA's whole-game wins. */
function faceoffsVerdict(input: PeriodReconciliationInput): {
  promotable: boolean
  reason: string
} {
  const periodsPlayed = input.periodsPlayed ?? null
  const coverage = input.faceoffCoverage ?? null
  const accuracy = input.faceoffAccuracy ?? null
  const contested = input.faceoffPeriodsContested ?? null
  const truthPresent = input.faceoffTruthPresent ?? false

  if (periodsPlayed === null || periodsPlayed < 1) {
    return { promotable: false, reason: NO_BOUND_REASON }
  }
  if (coverage === null) {
    return { promotable: false, reason: 'no per-period faceoff readings — nothing to reconcile' }
  }
  if (coverage < 1) {
    return {
      promotable: false,
      reason: `faceoffCoverage=${String(coverage)} (an expected period is missing a faceoff side)`,
    }
  }
  if (!truthPresent) {
    return {
      promotable: false,
      reason:
        'no EA faceoff truth — summed per-player faceoff wins are 0-0, which is ' +
        'indistinguishable from EA publishing no faceoff data, so an OCR read agreeing ' +
        'with it proves nothing',
    }
  }
  if (accuracy === null) {
    return { promotable: false, reason: 'faceoff totals are not gradable against EA truth' }
  }
  if (accuracy !== 1) {
    return {
      promotable: false,
      reason:
        `faceoffAccuracy=${String(accuracy)} — the bounded per-period faceoff totals do not ` +
        'match EA truth exactly; a partial match is not reconciliation',
    }
  }
  if (contested !== true) {
    return {
      promotable: false,
      reason:
        'an expected period records zero faceoffs on both sides — every period that starts ' +
        'opens with a centre-ice draw somebody wins, so an all-zero played period is a ' +
        'misread (or a whole-game cell leaking into one row), not a real reading',
    }
  }
  return {
    promotable: true,
    reason:
      'every expected period carries both faceoff sides and the bounded totals match EA ' +
      'truth (summed per-player faceoff wins) exactly',
  }
}

/**
 * SHOTS — no automatic path exists, and this is not a temporary gap.
 *
 * EA publishes no per-period shot breakdown, and its whole-game `matches.shots_*`
 * is not comparable truth either: the box-score per-period shot counts
 * legitimately differ from it (match 250 reads 29 vs API 25). There is therefore
 * nothing to reconcile against at any granularity.
 */
export const SHOTS_REASON =
  'shots have no automatic promotion path — EA publishes no per-period shot breakdown and ' +
  'its whole-game totals are not comparable truth (box-score per-period shots legitimately ' +
  'differ), so nothing can grade them; per-period shots are manual operator review only'

/**
 * Pure `period_reconciliation` decision — the deferred half of the 2026-07-16
 * calibration decision (docs/calibration/l4-per-period-review-gating-2026-07-16.md).
 *
 * @param pass the ROUTING verdict — `gateFromL4(...).decision === 'PASS'`, the
 *             signal `batch-promote` uses to route a match away from review.
 *             NOT `overall.pass` (which is L2 && L2.5 && L3 and never inspects
 *             the final: match 2675 is `overall.pass = FAIL` yet a gate PASS).
 *             Gates `flag` only — never `promotable`.
 */
export function reconcilePeriods(input: PeriodReconciliationInput): PeriodReconciliation {
  const periodsPlayed = input.periodsPlayed ?? null
  const expectedPeriods = expectedPeriodsFromPlayed(periodsPlayed) ?? []

  const goals = goalsVerdict(input)
  const faceoffs = faceoffsVerdict(input)

  // The review task fires on the GOALS verdict, unchanged: it is the signal the
  // 2026-07-16 calibration decision defined, and `pass` (the routing verdict)
  // suppresses a duplicate task on a match already queued on its own verdict.
  const flag = goals.status === 'review' && input.pass

  const verdict = (
    family: PeriodSummaryFamily,
    promotable: boolean,
    coverage: number | null,
    accuracy: number | null,
    reason: string,
  ): FamilyPromotionVerdict => ({
    family,
    promotable,
    authorizedPeriods: promotable ? [...expectedPeriods] : [],
    coverage,
    accuracy,
    reason,
  })

  return {
    status: goals.status,
    flag,
    promotable: goals.promotable,
    reason:
      goals.status === 'review' && input.pass
        ? `PASS match with unreconciled per-period rows — ${goals.reason}`
        : goals.status === 'review'
          ? `unreconciled per-period rows — ${goals.reason} (match already under review on its own verdict)`
          : goals.reason,
    periodsPlayed,
    families: {
      goals: verdict(
        'goals',
        goals.promotable,
        input.periodCoverage,
        input.periodAccuracy,
        goals.reason,
      ),
      shots: verdict('shots', false, null, null, SHOTS_REASON),
      faceoffs: verdict(
        'faceoffs',
        faceoffs.promotable,
        input.faceoffCoverage ?? null,
        input.faceoffAccuracy ?? null,
        faceoffs.reason,
      ),
    },
  }
}

/**
 * `reconcilePeriods` fed straight from derived evidence — the form both the
 * mutation boundary and the CLI use, so neither can transcribe a signal into the
 * wrong field on the way in.
 *
 * `pass` defaults to false because it gates only `flag` (the review-task
 * signal), which a caller that just wants the authorization verdicts does not
 * consume. It never influences any family's `promotable`.
 */
export function reconcileFromEvidence(
  evidence: PeriodEvidence,
  pass = false,
): PeriodReconciliation {
  return reconcilePeriods({
    pass,
    periodsPlayed: evidence.periodsPlayed,
    periodCoverage: evidence.periodCoverage,
    periodAccuracy: evidence.periodAccuracy,
    periodSumVacuous: evidence.periodSumVacuous,
    periodZerosForced: evidence.periodZerosForced,
    scoringPeriodsBeyondBound: evidence.scoringPeriodsBeyondBound,
    faceoffCoverage: evidence.faceoffCoverage,
    faceoffAccuracy: evidence.faceoffAccuracy,
    faceoffPeriodsContested: evidence.faceoffPeriodsContested,
    faceoffTruthPresent: evidence.faceoffTruthPresent,
  })
}
