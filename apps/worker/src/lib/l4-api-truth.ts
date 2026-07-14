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
  if (periodCoverage === 1) {
    let sumFor = 0
    let sumAgainst = 0
    for (const p of ocrPeriods) {
      sumFor += p.goalsFor ?? 0
      sumAgainst += p.goalsAgainst ?? 0
    }
    periodAccuracy = accuracyOfPair(sumFor, sumAgainst, apiTeam.scoreFor, apiTeam.scoreAgainst)
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
  }
}
