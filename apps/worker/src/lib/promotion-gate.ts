/**
 * Generic promotion gate for the OCR pipeline redesign.
 *
 * `runPromotionGate` is the heart of Phase 2A. It takes a list of candidate
 * values (with confidences + evidence_ids) for ONE field/slot, applies
 * invariant predicates + an optional authority resolver, and returns a
 * structured `PromotionDecision` with one of 5 statuses:
 *
 *   'promoted'              — winning value selected
 *   'blocked_consensus'     — multiple candidates above threshold, no dominant winner
 *   'blocked_observability' — no candidates exist (field not observable)
 *   'blocked_invariant'     — invariant predicate failed
 *   'blocked_authority'     — authority resolver override conflicts with OCR
 *
 * This module is intentionally generic — Phase 3+ promoters import it and
 * inject their own invariants + authority resolvers. The architectural
 * contract is the input/output shape, not the loadout-specific logic.
 *
 * Design decisions:
 *   - consensusThreshold default 0.5  — candidates below this are "noise" and
 *     don't count as competing, matching the calibration floor in Round 4 §6.
 *   - dominanceRatio default 1.5      — the top candidate must be 1.5× the
 *     next-best competitor. Anything less means OCR is genuinely ambiguous.
 *     Both defaults can be overridden per-call.
 *   - AuthorityResolver returning null means "no opinion; let consensus decide."
 *     An override with the same value as top OCR is NOT blocked — authority
 *     agrees with OCR, so promotion proceeds normally. Only a disagreeing
 *     override triggers blocked_authority.
 *   - conflictCount = (competitors above threshold) − 0  (the winner itself
 *     is NOT counted). A single-candidate promotion has conflictCount=0.
 */

// ─── types ─────────────────────────────────────────────────────────────────────

export type PromotionStatus =
  | 'promoted'
  | 'blocked_consensus'
  | 'blocked_observability'
  | 'blocked_invariant'
  | 'blocked_authority'

export type AuthoritySource = 'manual_truth' | 'ea_api' | 'ocr_evidence'

export interface GateCandidate<TValue = unknown> {
  /** Rank at extraction time: 0 = top extraction hypothesis, n = alternate. */
  candidateRank: number
  value: TValue
  rawConfidence: number
  calibratedConfidence: number
  /** `ocr_field_evidence.id` — recorded in `evidence_ids` of the promotion row. */
  evidenceId: number
}

export interface InvariantPredicate {
  /** Descriptive name — surfaces in blocking_reason for triage. */
  name: string
  check: (candidates: GateCandidate[]) => { ok: boolean; violationReason?: string }
}

export interface AuthorityResolverInput<TValue> {
  candidates: GateCandidate<TValue>[]
  topCandidate: GateCandidate<TValue> | null
}

/**
 * Returns a resolution if the authority source has an opinion, or null to
 * signal "no opinion — proceed with OCR consensus."
 *
 * When `overriddenValue` is provided and differs from the top OCR candidate,
 * the gate returns `blocked_authority`. When `overriddenValue` matches (or is
 * absent), the gate continues to the consensus step.
 */
export type AuthorityResolver<TValue = unknown> = (
  input: AuthorityResolverInput<TValue>,
) => { authoritySource: AuthoritySource; overriddenValue?: TValue } | null

export interface RunPromotionGateInput<TValue = unknown> {
  candidates: GateCandidate<TValue>[]
  invariantPredicates?: InvariantPredicate[]
  authorityResolver?: AuthorityResolver<TValue>
  /**
   * Calibrated-confidence floor. Candidates below this are excluded from the
   * "competing" count. Default: 0.5
   */
  consensusThreshold?: number
  /**
   * The top candidate must exceed the next-best competitor by at least this
   * multiplicative factor for the gate to declare a dominant winner. Default: 1.5
   */
  dominanceRatio?: number
}

export interface PromotionDecision<TValue = unknown> {
  status: PromotionStatus
  winningValue?: TValue
  winningConfidence?: number
  authoritySource?: AuthoritySource
  /** All participating candidates' evidenceIds (even when blocked). */
  evidenceIds: number[]
  /**
   * Count of candidates above consensusThreshold MINUS the winner.
   * 0 when there is a single uncontested candidate.
   */
  conflictCount: number
  blockingReason?: string
}

// ─── implementation ────────────────────────────────────────────────────────────

/**
 * Value equality for consensus competition. Primitives compare with `===`
 * (so the string "null" stays distinct from a real null). Object/array values
 * (rare in field evidence) fall back to a structural JSON compare.
 */
function sameGateValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

export function runPromotionGate<TValue = unknown>(
  input: RunPromotionGateInput<TValue>,
): PromotionDecision<TValue> {
  const consensusThreshold = input.consensusThreshold ?? 0.5
  const dominanceRatio = input.dominanceRatio ?? 1.5
  const candidates = input.candidates ?? []

  // ── Step 1: observability — no candidates at all ───────────────────────────
  if (candidates.length === 0) {
    return {
      status: 'blocked_observability',
      evidenceIds: [],
      conflictCount: 0,
      blockingReason: 'no_candidates',
    }
  }

  const evidenceIds = candidates.map((c) => c.evidenceId)

  // ── Step 2: invariants — apply each predicate to the full candidate list ───
  for (const predicate of input.invariantPredicates ?? []) {
    const result = predicate.check(candidates)
    if (!result.ok) {
      return {
        status: 'blocked_invariant',
        evidenceIds,
        conflictCount: 0,
        blockingReason: `${predicate.name}: ${result.violationReason ?? 'failed'}`,
      }
    }
  }

  // ── Step 3: rank candidates by calibratedConfidence descending ─────────────
  const sorted = [...candidates].sort((a, b) => b.calibratedConfidence - a.calibratedConfidence)
  const top = sorted[0]!
  const others = sorted.slice(1)

  // Competitors that create genuine ambiguity are candidates OTHER than the
  // top that are above the threshold AND carry a DIFFERENT value. Candidates
  // repeating the top value reinforce it — they must not count as competition.
  //
  // Without the value check, two identical high-confidence readings (e.g. the
  // same `x_factor_tier` = "All Star" extracted twice from one loadout
  // segment) dead-lock at ratio 1.0 < dominanceRatio and wrongly
  // `blocked_consensus`, even though there is only ONE distinct value. This
  // was the exact cause of match 250's X-Factor tiers all landing NULL.
  const competing = others.filter(
    (c) => c.calibratedConfidence >= consensusThreshold && !sameGateValue(c.value, top.value),
  )
  const conflictCount = competing.length

  // ── Step 4: authority — give resolver a chance to override ────────────────
  if (input.authorityResolver) {
    const authority = input.authorityResolver({ candidates: sorted, topCandidate: top })
    if (authority !== null) {
      if (authority.overriddenValue !== undefined) {
        // Block only when the authority value disagrees with the top OCR candidate.
        const disagrees = authority.overriddenValue !== top.value
        if (disagrees) {
          return {
            status: 'blocked_authority',
            evidenceIds,
            conflictCount,
            blockingReason: `authority_${authority.authoritySource}_disagrees_with_ocr`,
          }
        }
        // Authority agrees → fall through to consensus / promotion.
      }
      // authority.overriddenValue is undefined → resolver had an opinion on
      // authoritySource but no value override; fall through.
    }
    // null → no opinion; fall through.
  }

  // ── Step 5: consensus — top must be dominant if there are competitors ──────
  if (competing.length > 0) {
    const nextBest = competing[0]!
    // Guard against divide-by-zero for near-zero confidence values.
    const ratio = top.calibratedConfidence / Math.max(nextBest.calibratedConfidence, 1e-9)
    if (ratio < dominanceRatio) {
      return {
        status: 'blocked_consensus',
        evidenceIds,
        conflictCount,
        blockingReason: `non_dominant_top_${top.calibratedConfidence.toFixed(3)}_vs_${nextBest.calibratedConfidence.toFixed(3)}`,
      }
    }
  }

  // ── Step 6: promote ────────────────────────────────────────────────────────
  return {
    status: 'promoted',
    winningValue: top.value,
    winningConfidence: top.calibratedConfidence,
    authoritySource: 'ocr_evidence',
    evidenceIds,
    conflictCount,
  }
}
