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
import { accuracyOfPair, computePeriodEvidence } from '@eanhl/db/lib/period-reconciliation'

/**
 * The per-period reconciliation POLICY lives in `@eanhl/db/lib/period-reconciliation`
 * — a pure, import-free module — and is re-exported here so this module stays the
 * one place worker code imports it from.
 *
 * It sits in `@eanhl/db` rather than here because the MUTATION boundary
 * (`promoteOcrPeriodFamily`) has to enforce the very same rules this module
 * reports, and a worker module cannot be imported by the db package. Two copies
 * would drift, and the looser copy would publish unvalidated data — which is
 * exactly the bypass that made the boundary trust its caller. One definition,
 * two consumers.
 */
export {
  reconcilePeriods,
  computePeriodEvidence,
  reconcileFromEvidence,
  periodsPlayedFromToi,
  expectedPeriodsFromPlayed,
  PERIOD_SUMMARY_FAMILIES,
  isPeriodSummaryFamily,
} from '@eanhl/db/lib/period-reconciliation'
export type {
  PeriodSummaryFamily,
  PeriodReconciliation,
  PeriodReconciliationInput,
  PeriodReconciliationStatus,
  FamilyPromotionVerdict,
  PeriodEvidence,
  PeriodApiTruth,
  PeriodFamilyReading,
} from '@eanhl/db/lib/period-reconciliation'

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

export async function computeL4(inputs: L4Inputs): Promise<L4Result> {
  const { ocrTeam, apiTeam, ocrPlayers, apiPlayers, resolvePersona } = inputs
  const ocrFinal = inputs.ocrFinal ?? null
  const ocrPeriods = inputs.ocrPeriods ?? []

  // Every bounded per-period signal, from the ONE shared policy module. The
  // mutation boundary (`promoteOcrPeriodFamily`) derives the same signals from
  // the same function against the same truth, so what this scorecard reports and
  // what the database will actually authorize cannot diverge.
  //
  // The period bound inside is the INDEPENDENT denominator: it comes from player
  // TOI, never from the OCR rows, so a phantom OT row cannot create the
  // expectation it then satisfies.
  const evidence = computePeriodEvidence({
    periods: ocrPeriods,
    maxToiSeconds: inputs.maxToiSeconds,
    truth: apiTeam
      ? {
          scoreFor: apiTeam.scoreFor,
          scoreAgainst: apiTeam.scoreAgainst,
          faceoffsFor: apiTeam.faceoffsFor,
          faceoffsAgainst: apiTeam.faceoffsAgainst,
        }
      : null,
  })

  // No API truth ⇒ ungradable. OCR is the sole source; there is nothing to
  // grade it against. (Milestone ④ treats this as "promote with a warning".)
  // The coverage signals still report: they are a property of the OCR reads plus
  // the EA bound, and are informational on the scorecard for api-missed rows.
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
      ...evidence,
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

  return {
    gradable: true,
    score,
    fieldsTotal,
    fieldsMatched,
    diffs,
    mismatches,
    notes,
    finalAccuracy,
    ...evidence,
  }
}
