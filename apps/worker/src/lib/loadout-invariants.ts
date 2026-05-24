/**
 * Loadout-specific invariants for the promotion gate.
 *
 * Each invariant is a pure function that takes candidates (and optional context)
 * and returns InvariantResult({ ok, violationReason }). The generic gate
 * (Task 2A-16) calls these to decide promotion / blocking.
 *
 * The Promotable Slot Field Matrix from the plan is encoded here as a set of
 * checks. The 20-of-23 attribute floor + 3-of-3 X-Factor child block + junk-
 * gamertag invariant are first-class outcomes, not silent skips.
 *
 * Junk-row semantics: the legacy silent-skip gate at
 * apps/worker/src/ocr-promoters/loadout.ts:54-67 (pattern: AWAY/HOME/CPU/
 * single-char + no supporting fields → `return`) is replaced by
 * `junkGamertagWithoutSupportingEvidence`. Same logic; exposed as an
 * inspectable InvariantResult so downstream can record it in ocr_promotions
 * rather than silently swallow it.
 */

import { BUILD_CANONICAL_NAMES } from './normalize-build-class.js'

// ─── constants ────────────────────────────────────────────────────────────────

/**
 * Minimum number of attributes that must promote for the
 * `player_loadout_attributes` child block to be written.
 * Below this floor the entire child block is skipped; the parent snapshot
 * still writes.  Plan §Promotable Slot Field Matrix: "≥20 of 23 attributes".
 */
export const ATTRIBUTE_PROMOTION_FLOOR = 20 as const

/**
 * Total number of attribute slots in a loadout capture.
 * NHL 26 exposes exactly 5 groups × ≤5 attributes = 23 unique attribute keys.
 */
export const TOTAL_ATTRIBUTE_COUNT = 23 as const

/**
 * Set of gamertag strings that the OCR pipeline regularly emits as false
 * positives: section headers ("AWAY", "HOME"), the CPU bot sentinel, the
 * explicit "(unknown)" sentinel, and the bare "?" placeholder.
 *
 * Comparison in junkGamertagWithoutSupportingEvidence is
 * case-insensitive (call `.toUpperCase()` before `has()`).
 */
export const JUNK_GAMERTAGS: ReadonlySet<string> = new Set([
  'AWAY',
  'HOME',
  'CPU',
  '?',
  '(UNKNOWN)',
])

/**
 * Canonical build-class set derived from normalize-build-class.ts.
 * Invariant `buildClassInCanonicalSet` uses this by default.
 */
export const BUILD_CLASS_CANONICAL_SET: ReadonlySet<string> = new Set(BUILD_CANONICAL_NAMES)

// ─── types ─────────────────────────────────────────────────────────────────────

/** Structured result returned by every invariant function. */
export interface InvariantResult {
  ok: boolean
  /**
   * Machine-readable reason code when ok=false.
   * Recorded in ocr_promotions.blocking_reason for triage.
   * Examples: "junk_gamertag_without_supporting_evidence",
   * "below_attribute_floor_19_of_23", "x_factor_child_block_incomplete".
   */
  violationReason?: string
}

/**
 * Minimal shape of a candidate as passed to per-slot invariants.
 * The generic gate (Task 2A-16) will pass richer objects; invariants only
 * inspect the fields they need.
 */
export interface CandidateLike {
  /** Field key, e.g. "gamertag", "x_factor_name_0", "attribute_skating" */
  fieldKey: string
  /** Extracted value; null means extraction found nothing promotable */
  candidateValue: unknown
  /**
   * Raw model/alias confidence in [0, 1].
   * 0 means the candidate was emitted but carries no confidence (treat as
   * unverified).  Use > 0 check to distinguish "has a value" from "no
   * extraction at all".
   */
  rawConfidence: number
}

// ─── per-slot invariants ───────────────────────────────────────────────────────

/**
 * Guard for the X-Factor child block (all-or-nothing rule).
 *
 * All 3 X-Factor slots (slot_index 0, 1, 2) must have a promotable candidate
 * (candidateValue != null && rawConfidence > 0).  If any slot is missing the
 * entire child table is skipped for that snapshot; the per-slot blocks are
 * still recorded in ocr_promotions.
 *
 * The caller is expected to pass only the three x_factor_name candidates
 * (one per slot_index).  If fewer or more than 3 candidates are supplied the
 * invariant rejects — the pipeline should emit exactly one candidate per slot.
 *
 * @param xFactorCandidates Array of exactly 3 CandidateLike entries for
 *   x_factor_name_0, x_factor_name_1, x_factor_name_2 (order by slot_index).
 */
export function exactly3XFactorsPerSlot(xFactorCandidates: CandidateLike[]): InvariantResult {
  const promotedCount = xFactorCandidates.filter(
    (c) => c.candidateValue !== null && c.candidateValue !== undefined && c.rawConfidence > 0,
  ).length
  if (promotedCount === 3) {
    return { ok: true }
  }
  return {
    ok: false,
    violationReason: `x_factor_child_block_incomplete_${promotedCount}_of_3`,
  }
}

/**
 * Guard for the attribute child block (floor rule).
 *
 * At least ATTRIBUTE_PROMOTION_FLOOR (20) of the 23 attribute candidates must
 * have a non-null candidateValue with rawConfidence > 0.  Below the floor the
 * entire child table is skipped; the parent snapshot still writes.
 *
 * @param attributeCandidates All attribute CandidateLike entries for the slot
 *   (expected length: 23, but the invariant handles shorter lists).
 */
export function atLeast20Of23AttributesPerSlot(
  attributeCandidates: CandidateLike[],
): InvariantResult {
  const promotedCount = attributeCandidates.filter(
    (c) => c.candidateValue !== null && c.candidateValue !== undefined && c.rawConfidence > 0,
  ).length
  if (promotedCount >= ATTRIBUTE_PROMOTION_FLOOR) {
    return { ok: true }
  }
  return {
    ok: false,
    violationReason: `below_attribute_floor_${promotedCount}_of_${TOTAL_ATTRIBUTE_COUNT}`,
  }
}

/**
 * Range check for player jersey number.
 *
 * Valid EASHL jersey numbers are 0–99 (inclusive).  Non-integer values,
 * NaN, null, and non-numeric types all fail.
 *
 * @param value The jersey number to check.
 * @param min   Lower bound (inclusive). Default 0.
 * @param max   Upper bound (inclusive). Default 99.
 */
export function jerseyNumberInRange(value: unknown, min = 0, max = 99): InvariantResult {
  if (typeof value !== 'number' || !Number.isInteger(value) || Number.isNaN(value)) {
    return { ok: false, violationReason: `jersey_number_not_integer_${String(value)}` }
  }
  if (value >= min && value <= max) {
    return { ok: true }
  }
  return { ok: false, violationReason: `jersey_number_out_of_range_${value}` }
}

/**
 * Validates that a build-class value is a member of the canonical set.
 *
 * The canonical set is the 9-entry BUILD_CANONICAL_NAMES list from
 * normalize-build-class.ts.  The invariant accepts a custom set so callers
 * can substitute a YAML-derived set from the closed-vocab dictionary (Task
 * 2A-1) without re-importing normalize-build-class.ts.
 *
 * @param value        The build-class string to check (post-normalization).
 * @param canonicalSet The accepted canonical build-class values.
 *   Defaults to BUILD_CLASS_CANONICAL_SET (from normalize-build-class.ts).
 */
export function buildClassInCanonicalSet(
  value: string,
  canonicalSet: ReadonlySet<string> = BUILD_CLASS_CANONICAL_SET,
): InvariantResult {
  if (canonicalSet.has(value)) {
    return { ok: true }
  }
  return { ok: false, violationReason: `unknown_build_class_${value}` }
}

/**
 * Junk-gamertag invariant — subsumes the legacy silent junk-row gate.
 *
 * A gamertag is "junk" when it is:
 *   • a known section-header or sentinel token: AWAY, HOME, CPU, ?, (unknown)
 *     (comparison is case-insensitive), OR
 *   • a single-character string (letter-segmentation noise).
 *
 * Junk gamertags are only blocked when there is zero supporting evidence from
 * other fields (build, jersey number, X-Factors).  If at least one other
 * above-threshold candidate exists the row is allowed through — the
 * consolidator can vote a better gamertag from the supporting evidence.
 *
 * This matches the legacy guard at loadout.ts:54-67 but as an inspectable
 * InvariantResult recorded in ocr_promotions rather than a silent `return`.
 *
 * @param gamertag            The gamertag string from the OCR extraction.
 * @param supportingFieldCount Count of other fields (build_class, player_number,
 *   x_factors) that have at least one above-threshold candidate. Legacy code
 *   checks `hasBuild || hasNumber || hasXFactors`; pass the sum of those
 *   boolean flags as the count.
 */
export function junkGamertagWithoutSupportingEvidence(
  gamertag: string,
  supportingFieldCount: number,
): InvariantResult {
  const trimmed = gamertag.trim()
  const isKnownJunkToken = JUNK_GAMERTAGS.has(trimmed.toUpperCase())
  const isSingleChar = trimmed.length <= 1
  const isJunk = isKnownJunkToken || isSingleChar

  if (isJunk && supportingFieldCount === 0) {
    return { ok: false, violationReason: 'junk_gamertag_without_supporting_evidence' }
  }
  return { ok: true }
}

/**
 * Team-side resolution invariant.
 *
 * The snapshot row carries `teamSide` ('for' | 'against') resolved post-gate
 * by `resolveGamertagToPlayer()`.  When resolution fails (gamertag does not
 * map to any known player on either team) the snapshot is blocked rather than
 * written with a NULL team_side — a NULL team_side would silently corrupt
 * team-level analytics.
 *
 * In the plan's Promotable Slot Field Matrix, `teamSide` is a HARD field
 * with `blocked_invariant` reason `unresolved_team_side`.
 *
 * @param teamSide The resolved team side, or null when resolution failed.
 */
export function unresolvedTeamSideBlocksSnapshot(
  teamSide: 'for' | 'against' | null,
): InvariantResult {
  if (teamSide === null) {
    return { ok: false, violationReason: 'unresolved_team_side' }
  }
  return { ok: true }
}

// ─── cross-slot invariants ─────────────────────────────────────────────────────

/**
 * Cross-slot captain uniqueness guard.
 *
 * EASHL allows exactly one captain per team side.  When the OCR pipeline
 * produces multiple `is_captain=true` candidates for the same team side
 * the entire set of captain designations for that side is ambiguous and
 * blocks.
 *
 * Operates across all slots for a single team side; the promoter (Task 2A-17)
 * calls this once per match after resolving all slots' isCaptain evidence.
 *
 * @param captainCandidates Array of per-slot resolved captain status.
 *   Each entry: `{ teamSide: 'for'|'against', isCaptain: boolean }`.
 */
export function atMostOneCaptainPerTeamSide(
  captainCandidates: { teamSide: 'for' | 'against'; isCaptain: boolean }[],
): InvariantResult {
  const forCount = captainCandidates.filter((c) => c.teamSide === 'for' && c.isCaptain).length
  const againstCount = captainCandidates.filter(
    (c) => c.teamSide === 'against' && c.isCaptain,
  ).length
  if (forCount > 1) {
    return { ok: false, violationReason: `multiple_captains_on_for_${forCount}` }
  }
  if (againstCount > 1) {
    return { ok: false, violationReason: `multiple_captains_on_against_${againstCount}` }
  }
  return { ok: true }
}
