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
  /** Fraction of expected per-period rows that carry goals. Soft flag; `null` when
   *  no per-period rows exist. A value < 1 marks an unread period. */
  periodCoverage: number | null
  /** Summed-per-period goals vs API final — graded ONLY when coverage is complete
   *  (else `null`, not `0`, which removes the missed-period confound). Soft flag. */
  periodAccuracy: number | null
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
   * 0-0 / 0-0. `player_match_stats.toi_seconds` is API truth that would
   * de-confound this shape; wiring it in is deferred, so 972 stays in the review
   * queue as a correct-but-unproven read. See
   * docs/calibration/l4-per-period-review-gating-2026-07-16.md.
   */
  periodSumVacuous: boolean | null
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

/**
 * Task 4.G — coverage of the promoted per-period rows: how many of the periods
 * the game reached carry goals. Denominator is the highest period seen (so a
 * fully-absent middle period counts against coverage, not just a null-valued
 * one); numerator counts rows with BOTH goals present. `null` when no rows.
 */
function computePeriodCoverage(periods: OcrBoxScorePeriod[]): number | null {
  if (periods.length === 0) return null
  const maxPeriod = Math.max(...periods.map((p) => p.periodNumber))
  if (maxPeriod < 1) return null
  const byNumber = new Map(periods.map((p) => [p.periodNumber, p]))
  let covered = 0
  for (let n = 1; n <= maxPeriod; n++) {
    const row = byNumber.get(n)
    if (row && row.goalsFor != null && row.goalsAgainst != null) covered++
  }
  return covered / maxPeriod
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

export interface PeriodReconciliation {
  /**
   * Reconciliation verdict over the per-period rows ALONE (independent of the
   * match's pass/fail):
   *   - `reconciled`     — every period read AND the per-period goals sum to the
   *                        API-verified final. The only state that permits
   *                        automatic promotion.
   *   - `review`         — rows exist but are incomplete or don't sum. Needs a human.
   *   - `not_applicable` — nothing to reconcile (no rows) or nothing to
   *                        reconcile AGAINST (no API truth ⇒ periodAccuracy null).
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
   * true ⇒ this match's per-period rows MAY be flipped to
   * `review_status = 'reviewed'` (⇒ eligible for the frontend).
   *
   * THE INVARIANT: this is the ONLY automatic path to `reviewed`. It requires
   * `periodCoverage === 1 && periodAccuracy === 1` — i.e. self-consistency
   * against the API-verified final, the sole automatic check EA data can
   * support (EA publishes no per-period breakdown). `overall.pass` and
   * `gateFromL4` grade the FINAL only and say nothing about per-period
   * correctness — they must never be used as a proxy for it. Wiring
   * "PASS ⇒ promote periods" would turn the pending_review quarantine into a
   * silent-corruption pipe.
   */
  promotable: boolean
  reason: string
}

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
export function reconcilePeriods(input: {
  pass: boolean
  periodCoverage: number | null
  periodAccuracy: number | null
  periodSumVacuous?: boolean | null
}): PeriodReconciliation {
  const { pass, periodCoverage, periodAccuracy } = input
  const periodSumVacuous = input.periodSumVacuous ?? null

  if (periodCoverage === null) {
    return {
      status: 'not_applicable',
      flag: false,
      promotable: false,
      reason: 'no promoted per-period rows — nothing to reconcile',
    }
  }

  if (periodCoverage === 1 && periodAccuracy === null) {
    // Ungradable (api-missed): coverage is a property of the OCR reads alone and
    // is computed even without API truth, but there is no final to sum against.
    // Not promotable — an unverifiable read must stay quarantined.
    return {
      status: 'not_applicable',
      flag: false,
      promotable: false,
      reason: 'all periods read but no API truth to reconcile against (ungradable)',
    }
  }

  if (periodCoverage === 1 && periodAccuracy === 1) {
    // A vacuous sum is NOT reconciliation — see `L4Result.periodSumVacuous`.
    // One period holding the entire final sums correctly by construction whether
    // the breakdown is a TOT-cell leak or an early-ended game, so this must route
    // to review, not promote.
    if (periodSumVacuous === true) {
      return {
        status: 'review',
        flag: pass,
        promotable: false,
        reason:
          'per-period sum matches the API final VACUOUSLY — one period carries the ' +
          'entire final and the rest are scoreless (a TOT-cell leak and an ' +
          'early-ended game look identical here); the sum test proves nothing, so a ' +
          'human must confirm the breakdown',
      }
    }
    return {
      status: 'reconciled',
      flag: false,
      promotable: true,
      reason: 'all periods read and per-period goals sum to the API final',
    }
  }

  const why =
    periodCoverage < 1
      ? `periodCoverage=${String(periodCoverage)} (a period's goals were not read)`
      : `periodAccuracy=${String(periodAccuracy)} (per-period goals do not sum to the API final)`
  return {
    status: 'review',
    flag: pass,
    promotable: false,
    reason: pass
      ? `PASS match with unreconciled per-period rows — ${why}`
      : `unreconciled per-period rows — ${why} (match already under review on its own verdict)`,
  }
}

export async function computeL4(inputs: L4Inputs): Promise<L4Result> {
  const { ocrTeam, apiTeam, ocrPlayers, apiPlayers, resolvePersona } = inputs
  const ocrFinal = inputs.ocrFinal ?? null
  const ocrPeriods = inputs.ocrPeriods ?? []

  // Task 4.G — coverage is a property of the OCR reads alone, so it is computed
  // even without API truth (informational on the scorecard for api-missed rows).
  const periodCoverage = computePeriodCoverage(ocrPeriods)

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
      periodCoverage,
      periodAccuracy: null,
      periodSumVacuous: null,
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

  // periodAccuracy — the per-period sum graded ONLY when every period was read
  // (coverage complete). Incomplete ⇒ null (not 0), so a missed period doesn't
  // masquerade as a wrong read. Soft flag; never gates.
  let periodAccuracy: number | null = null
  let periodSumVacuous: boolean | null = null
  if (periodCoverage === 1) {
    let sumFor = 0
    let sumAgainst = 0
    for (const p of ocrPeriods) {
      sumFor += p.goalsFor ?? 0
      sumAgainst += p.goalsAgainst ?? 0
    }
    periodAccuracy = accuracyOfPair(sumFor, sumAgainst, apiTeam.scoreFor, apiTeam.scoreAgainst)

    // Vacuity check — see `periodSumVacuous`. One period holding the whole final
    // with the rest scoreless has two indistinguishable causes (TOT-cell leak vs
    // early-ended game), so the sum agreeing carries no information about the
    // breakdown's correctness.
    const scoring = ocrPeriods.filter((p) => (p.goalsFor ?? 0) !== 0 || (p.goalsAgainst ?? 0) !== 0)
    periodSumVacuous =
      scoring.length === 1 &&
      scoring[0]!.goalsFor === apiTeam.scoreFor &&
      scoring[0]!.goalsAgainst === apiTeam.scoreAgainst
  }

  return {
    gradable: true,
    score,
    fieldsTotal,
    fieldsMatched,
    diffs,
    mismatches,
    notes,
    finalAccuracy,
    periodCoverage,
    periodAccuracy,
    periodSumVacuous,
  }
}
