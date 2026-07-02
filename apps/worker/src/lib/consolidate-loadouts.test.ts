/**
 * Phase D: one-captain-per-side resolution in consolidation.
 *
 * resolveSideCaptains is a pure function over the (team_side, position) groups
 * map. These tests prove:
 *   - the single highest visual-★-confidence slot on a side wins captain and
 *     every other slot on that side is demoted (covers match 463 "2-per-side"
 *     and the match 250 lone false-positive at the write layer);
 *   - each side is resolved independently;
 *   - below-floor signals yield no captain;
 *   - cross-frame MAX confidence within a group is used;
 *   - un-scored (pre-Phase-D, NULL-confidence) data falls back to the legacy
 *     OR-fold unchanged.
 *
 * Synthetic Snapshot rows only — no DB, no real frames (real proof is Phase G).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveSideCaptains,
  CAPTAIN_MIN_CONFIDENCE,
  type Snapshot,
} from './consolidate-loadouts.js'

// Minimal Snapshot factory — resolveSideCaptains only reads isCaptain +
// isCaptainConfidence; team_side/position come from the groups-map key.
function snap(isCaptain: boolean | null, isCaptainConfidence: string | null): Snapshot {
  return {
    id: 0,
    playerId: null,
    gamertagSnapshot: 'tag',
    playerNameSnapshot: null,
    playerNamePersona: null,
    playerNumber: null,
    isCaptain,
    isCaptainConfidence,
    teamSide: null,
    position: null,
    buildClass: null,
    heightText: null,
    weightLbs: null,
    handedness: null,
    playerLevelRaw: null,
    playerLevelNumber: null,
    platform: null,
    gameTitleId: 1,
    ocrExtractionId: 1,
    screenType: 'loadout',
    reviewStatus: 'pending_review',
    isCpu: false,
  }
}

interface Decision {
  isCaptain: boolean | null
  isCaptainConfidence: string | null
}

function decisionFor(out: Map<string, Decision>, key: string): Decision {
  const d = out.get(key)
  assert.ok(d, `missing decision for ${key}`)
  return d
}

void test('argmax: highest-confidence slot wins captain, other candidate demoted', () => {
  // Two slots on the FOR side both flagged captain=true (the 463 "2-per-side"
  // bug). Only the higher-★ one may survive.
  const groups = new Map<string, Snapshot[]>([
    ['for|C', [snap(true, '0.9500')]],
    ['for|LD', [snap(true, '0.6000')]],
    ['for|RW', [snap(false, null)]],
  ])
  const out = resolveSideCaptains(groups)
  assert.equal(decisionFor(out, 'for|C').isCaptain, true)
  assert.equal(decisionFor(out, 'for|C').isCaptainConfidence, '0.9500')
  assert.equal(
    decisionFor(out, 'for|LD').isCaptain,
    null,
    'lower-confidence captain must be demoted',
  )
  assert.equal(decisionFor(out, 'for|RW').isCaptain, null)
})

void test('false positive with weak star loses to the real captain', () => {
  // Mirrors match 250: a non-captain slot the OCR text flagged (for|LW) but
  // whose real visual star is ~0, vs the true captain (for|C) with a strong star.
  const groups = new Map<string, Snapshot[]>([
    ['for|LW', [snap(true, '0.1000')]], // OCR-flagged but visually starless-ish
    ['for|C', [snap(true, '0.9900')]],
  ])
  const out = resolveSideCaptains(groups)
  assert.equal(decisionFor(out, 'for|C').isCaptain, true)
  assert.equal(decisionFor(out, 'for|LW').isCaptain, null)
})

void test('each side resolves exactly one captain independently', () => {
  const groups = new Map<string, Snapshot[]>([
    ['for|C', [snap(true, '0.9000')]],
    ['for|LW', [snap(true, '0.7000')]],
    ['against|C', [snap(true, '0.8000')]],
    ['against|RD', [snap(true, '0.9500')]],
  ])
  const out = resolveSideCaptains(groups)
  const forTrue = [...out].filter(([k, v]) => k.startsWith('for|') && v.isCaptain === true)
  const againstTrue = [...out].filter(([k, v]) => k.startsWith('against|') && v.isCaptain === true)
  assert.equal(forTrue.length, 1)
  assert.equal(againstTrue.length, 1)
  assert.equal(forTrue[0]?.[0], 'for|C')
  assert.equal(againstTrue[0]?.[0], 'against|RD')
})

void test('below-floor confidence yields no captain but keeps the signal present', () => {
  const weak = (CAPTAIN_MIN_CONFIDENCE - 0.2).toFixed(4)
  const groups = new Map<string, Snapshot[]>([['for|C', [snap(true, weak)]]])
  const out = resolveSideCaptains(groups)
  assert.equal(decisionFor(out, 'for|C').isCaptain, null, 'weak star must not claim captain')
  // The observed star confidence is still recorded on the row.
  assert.equal(decisionFor(out, 'for|C').isCaptainConfidence, weak)
})

void test('cross-frame MAX confidence within a group is used', () => {
  const groups = new Map<string, Snapshot[]>([
    ['for|C', [snap(true, '0.6000'), snap(true, '0.9000'), snap(false, '0.0000')]],
  ])
  const out = resolveSideCaptains(groups)
  assert.equal(decisionFor(out, 'for|C').isCaptain, true)
  assert.equal(decisionFor(out, 'for|C').isCaptainConfidence, '0.9000')
})

void test('legacy fallback: no confidence signal on a side → OR-fold (backward compat)', () => {
  // All is_captain_confidence NULL (pre-Phase-D data). One slot flagged captain
  // by the old text path must still resolve true; the other stays null.
  const groups = new Map<string, Snapshot[]>([
    ['for|C', [snap(true, null)]],
    ['for|LW', [snap(null, null)]],
  ])
  const out = resolveSideCaptains(groups)
  assert.equal(decisionFor(out, 'for|C').isCaptain, true)
  assert.equal(decisionFor(out, 'for|C').isCaptainConfidence, null)
  assert.equal(decisionFor(out, 'for|LW').isCaptain, null)
})

void test('mixed side: a scored slot activates argmax and suppresses a null-conf true', () => {
  // If ANY slot on the side carries a visual signal, the whole side uses argmax
  // (not the legacy fold), so a stray null-confidence true cannot win.
  const groups = new Map<string, Snapshot[]>([
    ['for|C', [snap(true, '0.9000')]],
    ['for|LW', [snap(true, null)]], // legacy true with no star signal
  ])
  const out = resolveSideCaptains(groups)
  assert.equal(decisionFor(out, 'for|C').isCaptain, true)
  assert.equal(decisionFor(out, 'for|LW').isCaptain, null)
})
