/**
 * L4 — API-truth accuracy comparator (pure).
 *
 * Diffs OCR box-score team totals and per-player audit lines against the
 * EA-API truth, producing an exact-match fraction plus a mismatch list for the
 * review queue. Read-only + synchronous except for the injected persona
 * resolver; all DB access happens in the caller (`computeLayers`) via the
 * Task 3.2 input queries.
 *
 * Grading principle: **accuracy, not coverage.** A field is graded only when
 * BOTH the OCR value and the API value are present. A field OCR never captured
 * (null) is skipped, not counted as a miss — omissions are a completeness
 * concern (L2), not an accuracy one. So `score` answers "of what OCR read, how
 * much was correct?".
 */
import type {
  OcrTeamTotals,
  ApiTeamTotals,
  OcrPlayerLine,
  ApiPlayerLine,
  OcrBoxScorePeriod,
  PeriodSummaryFamily,
} from '@eanhl/db/queries'

export interface L4FieldDiff {
  field: string
  scope: 'team' | `player:${string}`
  ocrValue: number | null
  apiValue: number | null
  exactMatch: boolean
}

export interface L4Result {
  /** false ⇒ "ungradable — OCR sole source" (no matches row / no API truth). */
  gradable: boolean
  /** Exact-match fraction over gradable fields; null when !gradable or 0 fields. */
  score: number | null
  fieldsTotal: number
  fieldsMatched: number
  /** Every gradable (both-sides-present) field comparison. */
  diffs: L4FieldDiff[]
  /** Subset of `diffs` where the OCR value disagrees — feeds the review queue. */
  mismatches: L4FieldDiff[]
  notes: string
  /**
   * Task 4.G — the HARD gate signal. TOT-row final (goals-for + goals-against)
   * vs API final: `1` both sides match, `0.5` one, `0` neither. `null` when no
   * API truth (ungradable), no OCR TOT read, or the OCR side is unresolved.
   * Grades the strongest correctness signal, so a missed *period* (which sinks
   * the per-period sum) never false-rejects a correctly-read final.
   */
  finalAccuracy: number | null
  /**
   * The periods the game is EXPECTED to have — `[1..periodsPlayed]`, derived
   * from EA player TOI, never from the OCR rows. `null` when TOI gives no
   * trustworthy bound, which fails every bounded metric below closed.
   */
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
   * when the period bound is unknown. A value < 1 marks a missing or half-read
   * expected period.
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
   *
   * EA publishes NO per-period goal truth. This is a summed-consistency check
   * against the whole-game final, which is why it needs complete coverage and
   * the vacuity de-confounder below to mean anything.
   */
  periodAccuracy: number | null
  /** Fraction of EXPECTED periods whose faceoffs were read on BOTH sides. */
  faceoffCoverage: number | null
  /**
   * Bounded per-period faceoff totals vs EA whole-game faceoff truth (summed
   * per-player faceoff wins). Graded only at complete faceoff coverage and only
   * when that truth exists. Like goals, EA publishes no per-period breakdown —
   * this is a summed-consistency check.
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
   * true ⇒ EA has faceoff truth to compare against. `getMatchFaceoffTotals`
   * COALESCEs absent player rows to 0, so a 0-0 truth is indistinguishable from
   * "EA published no faceoff data" — an OCR 0-0 agreeing with it proves nothing.
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
   * there is nothing to evaluate (no rows, incomplete coverage, or no API truth).
   *
   * ⚠️ Match 972 is NOT an example of cause 1 — it is cause 2, and its rows are
   * CORRECT. Every skater on both teams has `toi_seconds = 1197` (≈ one 20-minute
   * period), i.e. the opponent quit after P1 and the game really was 5-1 / 0-0 /
   * 0-0 / 0-0. That de-confounding now happens — see `periodZerosForced`. This
   * field deliberately keeps describing the raw SHAPE, so it stays true for 972.
   * See docs/calibration/l4-per-period-review-gating-2026-07-16.md.
   */
  periodSumVacuous: boolean | null
  /**
   * How many periods the game actually reached, derived from EA-API truth
   * (`max(player_match_stats.toi_seconds)`). `null` when no TOI is available.
   * See `periodsPlayedFromToi` for the rule.
   */
  periodsPlayed: number | null
  /**
   * true ⇒ TOI proves every scoreless per-period row lies strictly AFTER the last
   * period the game reached, so 0-0 is the only value those rows could hold, and
   * every scoring row lies within a played period. This is what de-confounds
   * `periodSumVacuous`: the sum agreeing is no longer "by construction" once the
   * zeros are forced, so a vacuous-shaped early-ended game (match 972) becomes
   * promotable while a TOT-cell leak (which would put the whole final in P1 of a
   * game that played all three) does not. `null` when there is nothing to
   * evaluate (no TOI, or incomplete coverage).
   */
  periodZerosForced: boolean | null
}

export interface L4Inputs {
  ocrTeam: OcrTeamTotals | null
  apiTeam: ApiTeamTotals | null
  ocrPlayers: OcrPlayerLine[]
  apiPlayers: ApiPlayerLine[]
  resolvePersona: (raw: string) => Promise<{ playerId: number | null }>
  /**
   * Task 4.G — side-resolved OCR TOT-row final (BGM perspective). The caller
   * reads the raw away/home TOT via `getOcrBoxScoreFinalForMatch` and resolves
   * the side with `resolveSidesFromNames`. `null`/omitted ⇒ finalAccuracy null.
   */
  ocrFinal?: { goalsFor: number | null; goalsAgainst: number | null } | null
  /** Task 4.G — promoted OCR per-period rows for coverage/periodAccuracy. */
  ocrPeriods?: OcrBoxScorePeriod[]
  /**
   * EA-API truth: `max(player_match_stats.toi_seconds)` for the match. Max, not
   * avg — the longest-playing skater measures the game's real duration, while a
   * player who joined late would understate it. Feeds `periodsPlayed`.
   */
  maxToiSeconds?: number | null
}

/** Save-% comparison tolerance (percentage points), per the L4 spec. */
const SAVE_PCT_TOLERANCE = 0.01

/**
 * OCR-team → API-team field mapping. The box-score screen shows API team
 * numbers, so goalsFor↔scoreFor / goalsAgainst↔scoreAgainst, and shots/faceoffs
 * map by identical name. Diff `field` is named for the OCR side.
 */
const TEAM_FIELD_MAP: ReadonlyArray<{
  field: string
  ocr: keyof OcrTeamTotals
  api: keyof ApiTeamTotals
}> = [
  { field: 'goalsFor', ocr: 'goalsFor', api: 'scoreFor' },
  { field: 'goalsAgainst', ocr: 'goalsAgainst', api: 'scoreAgainst' },
  { field: 'shotsFor', ocr: 'shotsFor', api: 'shotsFor' },
  { field: 'shotsAgainst', ocr: 'shotsAgainst', api: 'shotsAgainst' },
  { field: 'faceoffsFor', ocr: 'faceoffsFor', api: 'faceoffsFor' },
  { field: 'faceoffsAgainst', ocr: 'faceoffsAgainst', api: 'faceoffsAgainst' },
]

/** Reads the two columns one stat family owns off a period row. */
type PairReader = (p: OcrBoxScorePeriod) => [number | null, number | null]

const GOALS_PAIR: PairReader = (p) => [p.goalsFor, p.goalsAgainst]
/** `undefined` (caller supplied goals only) reads exactly like a null: unread. */
const FACEOFFS_PAIR: PairReader = (p) => [p.faceoffsFor ?? null, p.faceoffsAgainst ?? null]

/** `[1..periodsPlayed]`, or `null` when there is no trustworthy bound. */
function expectedPeriodsFromPlayed(periodsPlayed: number | null): number[] | null {
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
  periods: OcrBoxScorePeriod[],
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
  periods: OcrBoxScorePeriod[],
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

/** A regulation period in seconds. EASHL periods are 20:00; OT is shorter, but
 *  no rule below needs to know OT's length — see `periodsPlayedFromToi`. */
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
function periodsPlayedFromToi(maxToiSeconds: number | null | undefined): number | null {
  if (maxToiSeconds == null || maxToiSeconds <= 0) return null
  return Math.ceil(maxToiSeconds / PERIOD_SECONDS)
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
  periods: OcrBoxScorePeriod[],
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
 *  of the OCR value is missing (a half-read final can't be graded/gated). */
function accuracyOfPair(
  ocrFor: number | null,
  ocrAgainst: number | null,
  apiFor: number,
  apiAgainst: number,
): number | null {
  if (ocrFor == null || ocrAgainst == null) return null
  return ((ocrFor === apiFor ? 1 : 0) + (ocrAgainst === apiAgainst ? 1 : 0)) / 2
}

export type L4GateDecision = 'PASS' | 'HOLD' | 'OPERATOR_CONFIRM'
export interface L4Gate {
  decision: L4GateDecision
  reason: string
}

/**
 * Task 4.G — pure promotion gate over the TOT-final signal (per match):
 *   - finalAccuracy === 1        → PASS (final matches API truth)
 *   - finalAccuracy present < 1  → HOLD (genuinely misread final → review queue)
 *   - finalAccuracy === null:
 *       - !gradable (api-missed, no API truth) → OPERATOR_CONFIRM (the confirmed
 *         ② association is the sole gate — L4 cannot grade it)
 *       - gradable  (API truth but no OCR final read) → HOLD (can't verify)
 *
 * Enforcement is flag-not-purge: HOLD/OPERATOR_CONFIRM route to the review queue;
 * OCR never touches `matches` API truth. NOT a naive `L4>=τ` reject — that would
 * false-reject a correct-final-but-noisy-per-period match (the 973/974 case).
 */
export function gateFromL4(r: Pick<L4Result, 'finalAccuracy' | 'gradable'>): L4Gate {
  if (r.finalAccuracy === 1) {
    return { decision: 'PASS', reason: 'TOT-row final matches API truth (finalAccuracy=1)' }
  }
  if (r.finalAccuracy !== null) {
    return {
      decision: 'HOLD',
      reason: `TOT-row final disagrees with API truth (finalAccuracy=${String(r.finalAccuracy)})`,
    }
  }
  if (!r.gradable) {
    return {
      decision: 'OPERATOR_CONFIRM',
      reason: 'no API truth (api-missed) — confirmed association is the sole gate',
    }
  }
  return { decision: 'HOLD', reason: 'API truth present but no OCR final read — needs review' }
}

// ── period_reconciliation ────────────────────────────────────────────────────

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
const SHOTS_REASON =
  'shots have no automatic promotion path — EA publishes no per-period shot breakdown and ' +
  'its whole-game totals are not comparable truth (box-score per-period shots legitimately ' +
  'differ), so nothing can grade them; per-period shots are manual operator review only'

/**
 * Pure `period_reconciliation` decision — the deferred half of the 2026-07-16
 * calibration decision (docs/calibration/l4-per-period-review-gating-2026-07-16.md).
 *
 * Consumes the two soft signals `computeL4` already produces but nothing used.
 * Routes them to a review task and to the per-period promotion guard, WITHOUT
 * touching `overall.pass` or `gateFromL4` — the gate stays calibrated as-is
 * (match 2675 is a correct PASS: its final is right, only its periods are not).
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

export async function computeL4(inputs: L4Inputs): Promise<L4Result> {
  const { ocrTeam, apiTeam, ocrPlayers, apiPlayers, resolvePersona } = inputs
  const ocrFinal = inputs.ocrFinal ?? null
  const ocrPeriods = inputs.ocrPeriods ?? []

  // EA-API truth about the game's real duration. This is the INDEPENDENT period
  // denominator: it comes from player TOI, never from the OCR rows, so a phantom
  // OT row cannot create the expectation it then satisfies. Computed
  // unconditionally (a property of the API side alone), so it reports even on
  // ungradable rows.
  const periodsPlayed = periodsPlayedFromToi(inputs.maxToiSeconds)
  const expectedPeriods = expectedPeriodsFromPlayed(periodsPlayed)

  // Everything above the bound is excluded from every metric below. When the
  // bound is unknown nothing is excluded because nothing is included either —
  // the metrics all read `null` and the caller fails closed.
  const excludedPeriods =
    periodsPlayed === null
      ? []
      : ocrPeriods
          .filter((p) => p.periodNumber > periodsPlayed)
          .map((p) => p.periodNumber)
          .sort((a, b) => a - b)
  const scoringPeriodsBeyondBound =
    periodsPlayed === null
      ? []
      : ocrPeriods
          .filter(
            (p) =>
              p.periodNumber > periodsPlayed &&
              ((p.goalsFor ?? 0) !== 0 || (p.goalsAgainst ?? 0) !== 0),
          )
          .map((p) => p.periodNumber)
          .sort((a, b) => a - b)

  // Coverage is a property of the OCR reads plus the EA bound, so both families'
  // coverage is computed even without API truth (informational on the scorecard
  // for api-missed rows).
  const periodCoverage = boundedCoverage(ocrPeriods, expectedPeriods, GOALS_PAIR)
  const faceoffCoverage = boundedCoverage(ocrPeriods, expectedPeriods, FACEOFFS_PAIR)

  // Every period that starts opens with a centre-ice draw, so a played period
  // with 0-0 faceoffs is a misread. Only meaningful once both sides of every
  // expected period were actually read.
  let faceoffPeriodsContested: boolean | null = null
  if (faceoffCoverage === 1 && expectedPeriods !== null) {
    const byNumber = new Map(ocrPeriods.map((p) => [p.periodNumber, p]))
    faceoffPeriodsContested = expectedPeriods.every((n) => {
      const row = byNumber.get(n)
      if (!row) return false
      const [forValue, againstValue] = FACEOFFS_PAIR(row)
      return (forValue ?? 0) + (againstValue ?? 0) >= 1
    })
  }

  const faceoffTruthPresent = apiTeam !== null && apiTeam.faceoffsFor + apiTeam.faceoffsAgainst > 0

  // No API truth ⇒ ungradable. OCR is the sole source; there is nothing to
  // grade it against. (Milestone ④ treats this as "promote with a warning".)
  if (apiTeam === null) {
    return {
      gradable: false,
      score: null,
      fieldsTotal: 0,
      fieldsMatched: 0,
      diffs: [],
      mismatches: [],
      notes: 'ungradable — OCR sole source (no API truth)',
      finalAccuracy: null,
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
      periodsPlayed,
      periodZerosForced: null,
    }
  }

  const diffs: L4FieldDiff[] = []

  // ── Team totals ────────────────────────────────────────────────────────────
  if (ocrTeam !== null) {
    for (const { field, ocr, api } of TEAM_FIELD_MAP) {
      const ocrValue = ocrTeam[ocr]
      const apiValue = apiTeam[api]
      if (ocrValue == null || apiValue == null) continue // ungradable field
      diffs.push({ field, scope: 'team', ocrValue, apiValue, exactMatch: ocrValue === apiValue })
    }
  }

  // ── Per-player lines ─────────────────────────────────────────────────────────
  const apiByPlayerId = new Map<number, ApiPlayerLine>()
  for (const p of apiPlayers) apiByPlayerId.set(p.playerId, p)

  for (const line of ocrPlayers) {
    const { playerId } = await resolvePersona(line.personaRaw)
    if (playerId == null) continue // unresolved persona — nothing to grade against
    const api = apiByPlayerId.get(playerId)
    if (!api) continue // resolved to a player not on the API roster
    const scope: `player:${string}` = `player:${line.personaRaw}`

    for (const field of ['goals', 'assists', 'saves'] as const) {
      const ocrValue = line[field]
      const apiValue = api[field]
      if (ocrValue == null || apiValue == null) continue
      diffs.push({ field, scope, ocrValue, apiValue, exactMatch: ocrValue === apiValue })
    }

    // Save % compared within tolerance (both sides on the 0-100 scale).
    if (line.savePct != null && api.savePct != null) {
      diffs.push({
        field: 'savePct',
        scope,
        ocrValue: line.savePct,
        apiValue: api.savePct,
        exactMatch: Math.abs(line.savePct - api.savePct) <= SAVE_PCT_TOLERANCE,
      })
    }
  }

  const mismatches = diffs.filter((d) => !d.exactMatch)
  const fieldsTotal = diffs.length
  const fieldsMatched = fieldsTotal - mismatches.length
  const score = fieldsTotal > 0 ? fieldsMatched / fieldsTotal : null

  const notes =
    fieldsTotal === 0
      ? 'gradable but no overlapping OCR/API fields to compare'
      : `graded ${String(fieldsMatched)}/${String(fieldsTotal)} fields (team + per-player) vs EA-API truth`

  // Task 4.G — the HARD gate: TOT-row final (side-resolved) vs API final.
  const finalAccuracy = ocrFinal
    ? accuracyOfPair(
        ocrFinal.goalsFor,
        ocrFinal.goalsAgainst,
        apiTeam.scoreFor,
        apiTeam.scoreAgainst,
      )
    : null

  // periodAccuracy — the BOUNDED per-period sum, graded ONLY when every EXPECTED
  // period was read. Incomplete ⇒ null (not 0), so a missed period doesn't
  // masquerade as a wrong read. Soft flag; never gates the match.
  let periodAccuracy: number | null = null
  if (periodCoverage === 1 && expectedPeriods !== null) {
    const [sumFor, sumAgainst] = boundedPairSum(ocrPeriods, expectedPeriods, GOALS_PAIR)
    periodAccuracy = accuracyOfPair(sumFor, sumAgainst, apiTeam.scoreFor, apiTeam.scoreAgainst)
  }

  // The same summed-consistency check for faceoffs, against EA's whole-game
  // faceoff wins. Only graded when that truth exists — a 0-0 EA total means "no
  // faceoff data", and agreeing with it would be evidence of nothing.
  let faceoffAccuracy: number | null = null
  if (faceoffCoverage === 1 && expectedPeriods !== null && faceoffTruthPresent) {
    const [sumFor, sumAgainst] = boundedPairSum(ocrPeriods, expectedPeriods, FACEOFFS_PAIR)
    faceoffAccuracy = accuracyOfPair(
      sumFor,
      sumAgainst,
      apiTeam.faceoffsFor,
      apiTeam.faceoffsAgainst,
    )
  }

  // Vacuity check — see `periodSumVacuous`. One IN-BOUND period holding the whole
  // final with the rest scoreless has two indistinguishable causes (TOT-cell leak
  // vs early-ended game), so the sum agreeing carries no information about the
  // breakdown's correctness. Computed from the shape alone, independent of
  // coverage, so it stays reportable on partially-read matches.
  let periodSumVacuous: boolean | null = null
  if (ocrPeriods.length > 0) {
    const inBound =
      periodsPlayed === null
        ? ocrPeriods
        : ocrPeriods.filter((p) => p.periodNumber <= periodsPlayed)
    const scoring = inBound.filter((p) => (p.goalsFor ?? 0) !== 0 || (p.goalsAgainst ?? 0) !== 0)
    periodSumVacuous =
      scoring.length === 1 &&
      scoring[0]!.goalsFor === apiTeam.scoreFor &&
      scoring[0]!.goalsAgainst === apiTeam.scoreAgainst
  }

  // …and the de-confounder: TOI can prove the scoreless rows were forced.
  const periodZerosForced =
    periodsPlayed === null ? null : computePeriodZerosForced(ocrPeriods, periodsPlayed)

  return {
    gradable: true,
    score,
    fieldsTotal,
    fieldsMatched,
    diffs,
    mismatches,
    notes,
    finalAccuracy,
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
    periodsPlayed,
    periodZerosForced,
  }
}
