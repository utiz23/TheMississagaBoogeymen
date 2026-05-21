/**
 * Unit tests for runPromotionGate.
 *
 * No DB, no imports from packages/db — pure function under test.
 *
 * Required tests per task spec:
 *   1. test_promotes_when_single_dominant_candidate_above_threshold
 *   2. test_blocks_consensus_when_two_candidates_both_above_floor
 *   3. test_blocks_observability_when_no_candidates
 *   4. test_blocks_invariant_when_predicate_fails
 *   5. test_blocks_authority_when_manual_truth_disagrees
 *   6. test_records_evidence_ids_and_conflict_count
 *   T4A. test_blocks_two_competing_build_class_above_threshold_yields_blocked_consensus
 *
 * Plus supplementary tests covering edge cases.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  runPromotionGate,
  type GateCandidate,
  type InvariantPredicate,
  type AuthorityResolver,
} from './promotion-gate.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCandidate<T>(
  value: T,
  calibratedConfidence: number,
  evidenceId: number,
  opts: Partial<Omit<GateCandidate<T>, 'value' | 'calibratedConfidence' | 'evidenceId'>> = {},
): GateCandidate<T> {
  return {
    value,
    candidateRank: opts.candidateRank ?? 0,
    rawConfidence: opts.rawConfidence ?? calibratedConfidence,
    calibratedConfidence,
    evidenceId,
  }
}

function failingPredicate(name: string, violationReason: string): InvariantPredicate {
  return {
    name,
    check: () => ({ ok: false, violationReason }),
  }
}

function passingPredicate(name: string): InvariantPredicate {
  return {
    name,
    check: () => ({ ok: true }),
  }
}

// ─── required tests ────────────────────────────────────────────────────────────

void test('promotes when single dominant candidate above threshold', () => {
  const candidates = [makeCandidate('Sniper', 0.9, 101)]
  const result = runPromotionGate({ candidates })
  assert.equal(result.status, 'promoted')
  assert.equal(result.winningValue, 'Sniper')
  assert.equal(result.winningConfidence, 0.9)
  assert.equal(result.authoritySource, 'ocr_evidence')
  assert.equal(result.conflictCount, 0)
  assert.deepEqual(result.evidenceIds, [101])
  assert.equal(result.blockingReason, undefined)
})

void test('blocks_consensus when two candidates both above floor', () => {
  // Both at 0.7; ratio = 1.0, which is < 1.5 (default dominanceRatio)
  const candidates = [makeCandidate('Sniper', 0.7, 201), makeCandidate('Playmaker', 0.7, 202)]
  const result = runPromotionGate({ candidates })
  assert.equal(result.status, 'blocked_consensus')
  assert.equal(result.conflictCount, 1)
  assert.ok(result.blockingReason?.includes('non_dominant_top'), result.blockingReason)
})

void test('blocks_observability when no candidates', () => {
  const result = runPromotionGate({ candidates: [] })
  assert.equal(result.status, 'blocked_observability')
  assert.equal(result.blockingReason, 'no_candidates')
  assert.deepEqual(result.evidenceIds, [])
  assert.equal(result.conflictCount, 0)
})

void test('blocks_invariant when predicate fails', () => {
  const candidates = [makeCandidate('Sniper', 0.9, 301)]
  const predicate = failingPredicate('build_class_check', 'unknown_build_class_Snipoor')
  const result = runPromotionGate({ candidates, invariantPredicates: [predicate] })
  assert.equal(result.status, 'blocked_invariant')
  assert.ok(result.blockingReason?.includes('build_class_check'), result.blockingReason)
  assert.ok(result.blockingReason?.includes('unknown_build_class_Snipoor'), result.blockingReason)
})

void test('blocks_authority when manual_truth disagrees', () => {
  const candidates = [makeCandidate('Sniper', 0.9, 401)]
  const resolver: AuthorityResolver<string> = () => ({
    authoritySource: 'manual_truth',
    overriddenValue: 'Playmaker', // disagrees with OCR top 'Sniper'
  })
  const result = runPromotionGate({ candidates, authorityResolver: resolver })
  assert.equal(result.status, 'blocked_authority')
  assert.ok(result.blockingReason?.includes('authority_manual_truth_disagrees_with_ocr'), result.blockingReason)
  assert.equal(result.conflictCount, 0) // only one candidate above threshold
})

void test('records evidence_ids and conflict_count', () => {
  // Three candidates: top dominant at 0.9, two competitors at 0.6
  const candidates = [
    makeCandidate('Sniper', 0.9, 501),
    makeCandidate('Playmaker', 0.6, 502),
    makeCandidate('Grinder', 0.6, 503),
  ]
  const result = runPromotionGate({ candidates })
  // Top (0.9) vs next (0.6) → ratio 1.5 — exactly at dominanceRatio boundary.
  // The check is ratio < dominanceRatio so 1.5 < 1.5 is false → promoted.
  assert.equal(result.status, 'promoted')
  assert.equal(result.conflictCount, 2)
  // All three evidence IDs must be recorded regardless of outcome.
  assert.deepEqual(result.evidenceIds.sort(), [501, 502, 503])
})

// ─── T4A — explicit Phase-2 acceptance gate ────────────────────────────────────

void test('T4A: blocks two competing build_class above threshold yields blocked_consensus', () => {
  // Two build_class candidates each at 0.7 → ratio = 1.0 < 1.5 → blocked_consensus
  const candidates = [
    makeCandidate('Sniper', 0.7, 601, { candidateRank: 0 }),
    makeCandidate('Playmaker', 0.7, 602, { candidateRank: 1 }),
  ]
  const result = runPromotionGate({ candidates })
  assert.equal(result.status, 'blocked_consensus')
  assert.equal(result.conflictCount, 1)
  // Both evidence IDs recorded.
  assert.deepEqual(result.evidenceIds.sort(), [601, 602])
  // Blocking reason includes the confidence values.
  assert.ok(result.blockingReason?.startsWith('non_dominant_top'), result.blockingReason)
})

// ─── supplementary tests ──────────────────────────────────────────────────────

void test('dominance ratio override: custom dominanceRatio=2.0', () => {
  // Top at 0.9, next at 0.6 → ratio = 1.5, which is < 2.0 → blocked_consensus
  const candidates = [makeCandidate('Sniper', 0.9, 701), makeCandidate('Playmaker', 0.6, 702)]
  const result = runPromotionGate({ candidates, dominanceRatio: 2.0 })
  assert.equal(result.status, 'blocked_consensus')
})

void test('dominance ratio override: ratio just meets custom threshold 1.5', () => {
  // Top at 0.9, next at 0.6 → ratio = 1.5, which is NOT < 1.5 → promoted
  const candidates = [makeCandidate('Sniper', 0.9, 801), makeCandidate('Playmaker', 0.6, 802)]
  const result = runPromotionGate({ candidates, dominanceRatio: 1.5 })
  assert.equal(result.status, 'promoted')
  assert.equal(result.winningValue, 'Sniper')
})

void test('authority resolver returns null → falls through to consensus', () => {
  const candidates = [makeCandidate('Sniper', 0.9, 901)]
  const resolver: AuthorityResolver<string> = () => null
  const result = runPromotionGate({ candidates, authorityResolver: resolver })
  assert.equal(result.status, 'promoted')
  assert.equal(result.winningValue, 'Sniper')
})

void test('authority agrees with OCR → falls through to promotion', () => {
  const candidates = [makeCandidate('Sniper', 0.9, 1001)]
  const resolver: AuthorityResolver<string> = () => ({
    authoritySource: 'ea_api',
    overriddenValue: 'Sniper', // same as top OCR value → not a conflict
  })
  const result = runPromotionGate({ candidates, authorityResolver: resolver })
  assert.equal(result.status, 'promoted')
  assert.equal(result.winningValue, 'Sniper')
})

void test('promotes even with conflict_count=0 when single candidate is above all thresholds', () => {
  // Single candidate well above consensusThreshold; no competitors.
  const candidates = [makeCandidate(42, 0.95, 1101)]
  const result = runPromotionGate({ candidates, consensusThreshold: 0.5 })
  assert.equal(result.status, 'promoted')
  assert.equal(result.conflictCount, 0)
  assert.equal(result.winningValue, 42)
})

void test('candidate below consensusThreshold does not count as a competitor', () => {
  // Top at 0.8, second at 0.3 (below default threshold 0.5) → second is noise → promoted
  const candidates = [makeCandidate('Sniper', 0.8, 1201), makeCandidate('Playmaker', 0.3, 1202)]
  const result = runPromotionGate({ candidates })
  assert.equal(result.status, 'promoted')
  assert.equal(result.conflictCount, 0)
  assert.equal(result.winningValue, 'Sniper')
  // Both evidence IDs still recorded.
  assert.deepEqual(result.evidenceIds.sort(), [1201, 1202])
})

void test('invariant receives all candidates including low-confidence ones', () => {
  let capturedLength = 0
  const candidates = [
    makeCandidate('Sniper', 0.9, 1301),
    makeCandidate('Playmaker', 0.1, 1302), // below threshold
  ]
  const predicate: InvariantPredicate = {
    name: 'length_check',
    check: (cs) => {
      capturedLength = cs.length
      return { ok: true }
    },
  }
  runPromotionGate({ candidates, invariantPredicates: [predicate] })
  assert.equal(capturedLength, 2) // invariant sees ALL candidates, not just threshold-passers
})

void test('first failing invariant short-circuits remaining predicates', () => {
  let secondCalled = false
  const candidates = [makeCandidate('Sniper', 0.9, 1401)]
  const first = failingPredicate('first', 'first_fails')
  const second: InvariantPredicate = {
    name: 'second',
    check: () => { secondCalled = true; return { ok: true } },
  }
  const result = runPromotionGate({ candidates, invariantPredicates: [first, second] })
  assert.equal(result.status, 'blocked_invariant')
  assert.equal(secondCalled, false)
})

void test('passing invariant does not block promotion', () => {
  const candidates = [makeCandidate('Sniper', 0.9, 1501)]
  const predicate = passingPredicate('all_good')
  const result = runPromotionGate({ candidates, invariantPredicates: [predicate] })
  assert.equal(result.status, 'promoted')
})

void test('custom consensusThreshold: competitor just below threshold is ignored', () => {
  // threshold=0.7; second candidate at 0.69 → not a competitor → top wins
  const candidates = [makeCandidate('Sniper', 0.8, 1601), makeCandidate('Playmaker', 0.69, 1602)]
  const result = runPromotionGate({ candidates, consensusThreshold: 0.7 })
  assert.equal(result.status, 'promoted')
  assert.equal(result.conflictCount, 0)
})

void test('custom consensusThreshold: competitor at threshold is included', () => {
  // threshold=0.7; second at 0.7 → IS a competitor; ratio 0.8/0.7 ≈ 1.14 < 1.5 → blocked
  const candidates = [makeCandidate('Sniper', 0.8, 1701), makeCandidate('Playmaker', 0.7, 1702)]
  const result = runPromotionGate({ candidates, consensusThreshold: 0.7 })
  assert.equal(result.status, 'blocked_consensus')
  assert.equal(result.conflictCount, 1)
})

void test('blocked_invariant includes evidence ids from all candidates', () => {
  const candidates = [makeCandidate('Sniper', 0.9, 1801), makeCandidate('Playmaker', 0.4, 1802)]
  const predicate = failingPredicate('test_pred', 'violated')
  const result = runPromotionGate({ candidates, invariantPredicates: [predicate] })
  assert.equal(result.status, 'blocked_invariant')
  assert.deepEqual(result.evidenceIds.sort(), [1801, 1802])
})

void test('top candidate selected by calibratedConfidence, not candidateRank', () => {
  // candidateRank=0 has lower confidence than candidateRank=1 — gate should sort by confidence
  const candidates = [
    makeCandidate('Playmaker', 0.6, 1901, { candidateRank: 0 }),
    makeCandidate('Sniper', 0.9, 1902, { candidateRank: 1 }),
  ]
  const result = runPromotionGate({ candidates })
  assert.equal(result.status, 'promoted')
  assert.equal(result.winningValue, 'Sniper') // higher calibratedConfidence wins
})
