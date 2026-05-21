import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTRIBUTE_PROMOTION_FLOOR,
  TOTAL_ATTRIBUTE_COUNT,
  JUNK_GAMERTAGS,
  BUILD_CLASS_CANONICAL_SET,
  atLeast20Of23AttributesPerSlot,
  exactly3XFactorsPerSlot,
  jerseyNumberInRange,
  buildClassInCanonicalSet,
  junkGamertagWithoutSupportingEvidence,
  unresolvedTeamSideBlocksSnapshot,
  atMostOneCaptainPerTeamSide,
  type CandidateLike,
} from './loadout-invariants.js'

// ─── constant sanity checks ───────────────────────────────────────────────────

void test('ATTRIBUTE_PROMOTION_FLOOR is 20', () => {
  assert.equal(ATTRIBUTE_PROMOTION_FLOOR, 20)
})

void test('TOTAL_ATTRIBUTE_COUNT is 23', () => {
  assert.equal(TOTAL_ATTRIBUTE_COUNT, 23)
})

void test('JUNK_GAMERTAGS contains AWAY HOME CPU ? (UNKNOWN)', () => {
  assert.ok(JUNK_GAMERTAGS.has('AWAY'))
  assert.ok(JUNK_GAMERTAGS.has('HOME'))
  assert.ok(JUNK_GAMERTAGS.has('CPU'))
  assert.ok(JUNK_GAMERTAGS.has('?'))
  assert.ok(JUNK_GAMERTAGS.has('(UNKNOWN)'))
})

void test('BUILD_CLASS_CANONICAL_SET contains known canonical builds', () => {
  assert.ok(BUILD_CLASS_CANONICAL_SET.has('Sniper'))
  assert.ok(BUILD_CLASS_CANONICAL_SET.has('Playmaker'))
  assert.ok(BUILD_CLASS_CANONICAL_SET.has('Two-Way Defenseman'))
})

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(
  fieldKey: string,
  candidateValue: unknown,
  rawConfidence: number,
): CandidateLike {
  return { fieldKey, candidateValue, rawConfidence }
}

function makeAttrCandidates(promotedCount: number): CandidateLike[] {
  return Array.from({ length: TOTAL_ATTRIBUTE_COUNT }, (_, i) => ({
    fieldKey: `attr_${i}`,
    candidateValue: i < promotedCount ? 85 : null,
    rawConfidence: i < promotedCount ? 0.9 : 0,
  }))
}

function makeXFactorCandidates(promotedCount: number): CandidateLike[] {
  return Array.from({ length: 3 }, (_, i) => ({
    fieldKey: `x_factor_name_${i}`,
    candidateValue: i < promotedCount ? 'Tape to Tape' : null,
    rawConfidence: i < promotedCount ? 0.95 : 0,
  }))
}

// ─── atLeast20Of23AttributesPerSlot ──────────────────────────────────────────

void test('atLeast20Of23AttributesPerSlot passes at exactly 20', () => {
  const result = atLeast20Of23AttributesPerSlot(makeAttrCandidates(20))
  assert.equal(result.ok, true)
  assert.equal(result.violationReason, undefined)
})

void test('atLeast20Of23AttributesPerSlot passes at 23 (all promoted)', () => {
  const result = atLeast20Of23AttributesPerSlot(makeAttrCandidates(23))
  assert.equal(result.ok, true)
})

void test('atLeast20Of23AttributesPerSlot fails at 19', () => {
  const result = atLeast20Of23AttributesPerSlot(makeAttrCandidates(19))
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.startsWith('below_attribute_floor_19'), result.violationReason)
})

void test('atLeast20Of23AttributesPerSlot fails at 0', () => {
  const result = atLeast20Of23AttributesPerSlot(makeAttrCandidates(0))
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.startsWith('below_attribute_floor_0'), result.violationReason)
})

void test('atLeast20Of23AttributesPerSlot passes at 21 and 22 as well', () => {
  assert.equal(atLeast20Of23AttributesPerSlot(makeAttrCandidates(21)).ok, true)
  assert.equal(atLeast20Of23AttributesPerSlot(makeAttrCandidates(22)).ok, true)
})

void test('atLeast20Of23AttributesPerSlot: null candidateValue counts as not promoted', () => {
  const candidates = makeAttrCandidates(20)
  // Override the last promoted one to have value null but keep confidence > 0
  candidates[19]!.candidateValue = null
  const result = atLeast20Of23AttributesPerSlot(candidates)
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('19'), result.violationReason)
})

// ─── exactly3XFactorsPerSlot ─────────────────────────────────────────────────

void test('exactly3XFactorsPerSlot passes with 3 promoted x_factor candidates', () => {
  const result = exactly3XFactorsPerSlot(makeXFactorCandidates(3))
  assert.equal(result.ok, true)
})

void test('exactly3XFactorsPerSlot fails with only 2 promoted', () => {
  const result = exactly3XFactorsPerSlot(makeXFactorCandidates(2))
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('2'), result.violationReason)
})

void test('exactly3XFactorsPerSlot fails with 1 promoted', () => {
  const result = exactly3XFactorsPerSlot(makeXFactorCandidates(1))
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('1'), result.violationReason)
})

void test('exactly3XFactorsPerSlot fails with 0 promoted', () => {
  const result = exactly3XFactorsPerSlot(makeXFactorCandidates(0))
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('0'), result.violationReason)
})

void test('exactly3XFactorsPerSlot: violation reason includes x_factor_child_block_incomplete', () => {
  const result = exactly3XFactorsPerSlot(makeXFactorCandidates(2))
  assert.ok(
    result.violationReason?.startsWith('x_factor_child_block_incomplete'),
    result.violationReason,
  )
})

// ─── jerseyNumberInRange ──────────────────────────────────────────────────────

void test('jerseyNumberInRange passes 0, 50, 99 (boundary + midpoint)', () => {
  assert.equal(jerseyNumberInRange(0).ok, true)
  assert.equal(jerseyNumberInRange(50).ok, true)
  assert.equal(jerseyNumberInRange(99).ok, true)
})

void test('jerseyNumberInRange fails -1 (below lower bound)', () => {
  const result = jerseyNumberInRange(-1)
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('-1'), result.violationReason)
})

void test('jerseyNumberInRange fails 100 (above upper bound)', () => {
  const result = jerseyNumberInRange(100)
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('100'), result.violationReason)
})

void test('jerseyNumberInRange fails NaN', () => {
  const result = jerseyNumberInRange(NaN)
  assert.equal(result.ok, false)
})

void test('jerseyNumberInRange fails non-integer float 5.5', () => {
  const result = jerseyNumberInRange(5.5)
  assert.equal(result.ok, false)
})

void test('jerseyNumberInRange fails null (coerced as unknown)', () => {
  const result = jerseyNumberInRange(null as unknown as number)
  assert.equal(result.ok, false)
})

void test('jerseyNumberInRange fails string "5" (wrong type)', () => {
  const result = jerseyNumberInRange('5' as unknown as number)
  assert.equal(result.ok, false)
})

void test('jerseyNumberInRange respects custom min/max bounds', () => {
  assert.equal(jerseyNumberInRange(1, 1, 99).ok, true)
  assert.equal(jerseyNumberInRange(0, 1, 99).ok, false)
  assert.equal(jerseyNumberInRange(99, 0, 98).ok, false)
})

// ─── buildClassInCanonicalSet ─────────────────────────────────────────────────

void test('buildClassInCanonicalSet passes "Sniper"', () => {
  const result = buildClassInCanonicalSet('Sniper')
  assert.equal(result.ok, true)
})

void test('buildClassInCanonicalSet passes all 9 canonical builds', () => {
  const builds = [
    'Playmaker',
    'Sniper',
    'Grinder',
    'Two-Way Forward',
    'Power Forward',
    'Puck Moving Defenseman',
    'Defensive Defenseman',
    'Offensive Defenseman',
    'Two-Way Defenseman',
  ]
  for (const b of builds) {
    assert.equal(buildClassInCanonicalSet(b).ok, true, `Expected ${b} to pass`)
  }
})

void test('buildClassInCanonicalSet fails "Snipoor" (typo)', () => {
  const result = buildClassInCanonicalSet('Snipoor')
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('Snipoor'), result.violationReason)
})

void test('buildClassInCanonicalSet fails empty string', () => {
  assert.equal(buildClassInCanonicalSet('').ok, false)
})

void test('buildClassInCanonicalSet fails "sniper" (wrong case — canonical is title case)', () => {
  assert.equal(buildClassInCanonicalSet('sniper').ok, false)
})

void test('buildClassInCanonicalSet accepts custom canonicalSet', () => {
  const custom = new Set(['CustomBuild'])
  assert.equal(buildClassInCanonicalSet('CustomBuild', custom).ok, true)
  assert.equal(buildClassInCanonicalSet('Sniper', custom).ok, false)
})

// ─── junkGamertagWithoutSupportingEvidence ────────────────────────────────────

void test('junkGamertagWithoutSupportingEvidence blocks AWAY with 0 supporting', () => {
  const result = junkGamertagWithoutSupportingEvidence('AWAY', 0)
  assert.equal(result.ok, false)
  assert.equal(result.violationReason, 'junk_gamertag_without_supporting_evidence')
})

void test('junkGamertagWithoutSupportingEvidence blocks HOME with 0 supporting', () => {
  assert.equal(junkGamertagWithoutSupportingEvidence('HOME', 0).ok, false)
})

void test('junkGamertagWithoutSupportingEvidence blocks CPU with 0 supporting', () => {
  assert.equal(junkGamertagWithoutSupportingEvidence('CPU', 0).ok, false)
})

void test('junkGamertagWithoutSupportingEvidence blocks lowercase "away" (case-insensitive)', () => {
  assert.equal(junkGamertagWithoutSupportingEvidence('away', 0).ok, false)
})

void test('junkGamertagWithoutSupportingEvidence blocks single-char "X" with 0 supporting', () => {
  assert.equal(junkGamertagWithoutSupportingEvidence('X', 0).ok, false)
})

void test('junkGamertagWithoutSupportingEvidence blocks empty string with 0 supporting', () => {
  assert.equal(junkGamertagWithoutSupportingEvidence('', 0).ok, false)
})

void test('junkGamertagWithoutSupportingEvidence allows AWAY with supporting evidence (count=1)', () => {
  // Legacy logic: junk token is allowed through when supporting evidence exists
  assert.equal(junkGamertagWithoutSupportingEvidence('AWAY', 1).ok, true)
})

void test('junkGamertagWithoutSupportingEvidence allows HOME with supporting count=3', () => {
  assert.equal(junkGamertagWithoutSupportingEvidence('HOME', 3).ok, true)
})

void test('junkGamertagWithoutSupportingEvidence allows real gamertag "HenryTheBobJr" with 0 supporting', () => {
  assert.equal(junkGamertagWithoutSupportingEvidence('HenryTheBobJr', 0).ok, true)
})

void test('junkGamertagWithoutSupportingEvidence allows "AB" (two chars) with 0 supporting', () => {
  // Two-char strings are NOT junk — single char or known token only
  assert.equal(junkGamertagWithoutSupportingEvidence('AB', 0).ok, true)
})

// ─── unresolvedTeamSideBlocksSnapshot ────────────────────────────────────────

void test('unresolvedTeamSideBlocksSnapshot blocks null team side', () => {
  const result = unresolvedTeamSideBlocksSnapshot(null)
  assert.equal(result.ok, false)
  assert.equal(result.violationReason, 'unresolved_team_side')
})

void test('unresolvedTeamSideBlocksSnapshot passes "for"', () => {
  assert.equal(unresolvedTeamSideBlocksSnapshot('for').ok, true)
})

void test('unresolvedTeamSideBlocksSnapshot passes "against"', () => {
  assert.equal(unresolvedTeamSideBlocksSnapshot('against').ok, true)
})

// ─── atMostOneCaptainPerTeamSide ──────────────────────────────────────────────

void test('atMostOneCaptainPerTeamSide passes with 1 captain on each side', () => {
  const candidates = [
    { teamSide: 'for' as const, isCaptain: true },
    { teamSide: 'for' as const, isCaptain: false },
    { teamSide: 'against' as const, isCaptain: true },
    { teamSide: 'against' as const, isCaptain: false },
  ]
  assert.equal(atMostOneCaptainPerTeamSide(candidates).ok, true)
})

void test('atMostOneCaptainPerTeamSide passes with 0 captains on either side', () => {
  const candidates = [
    { teamSide: 'for' as const, isCaptain: false },
    { teamSide: 'against' as const, isCaptain: false },
  ]
  assert.equal(atMostOneCaptainPerTeamSide(candidates).ok, true)
})

void test('atMostOneCaptainPerTeamSide fails with 2 captains on "for" side', () => {
  const candidates = [
    { teamSide: 'for' as const, isCaptain: true },
    { teamSide: 'for' as const, isCaptain: true },
    { teamSide: 'against' as const, isCaptain: false },
  ]
  const result = atMostOneCaptainPerTeamSide(candidates)
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.startsWith('multiple_captains_on_for'), result.violationReason)
  assert.ok(result.violationReason?.includes('2'), result.violationReason)
})

void test('atMostOneCaptainPerTeamSide fails with 2 captains on "against" side', () => {
  const candidates = [
    { teamSide: 'for' as const, isCaptain: false },
    { teamSide: 'against' as const, isCaptain: true },
    { teamSide: 'against' as const, isCaptain: true },
  ]
  const result = atMostOneCaptainPerTeamSide(candidates)
  assert.equal(result.ok, false)
  assert.ok(
    result.violationReason?.startsWith('multiple_captains_on_against'),
    result.violationReason,
  )
})

void test('atMostOneCaptainPerTeamSide fails with 3 captains on "for" side', () => {
  const candidates = [
    { teamSide: 'for' as const, isCaptain: true },
    { teamSide: 'for' as const, isCaptain: true },
    { teamSide: 'for' as const, isCaptain: true },
  ]
  const result = atMostOneCaptainPerTeamSide(candidates)
  assert.equal(result.ok, false)
  assert.ok(result.violationReason?.includes('3'), result.violationReason)
})

void test('atMostOneCaptainPerTeamSide handles empty candidate list (no captains)', () => {
  assert.equal(atMostOneCaptainPerTeamSide([]).ok, true)
})
