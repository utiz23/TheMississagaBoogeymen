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
  vote,
  pickAnchor,
  fieldConfidence,
  sameGamertagIdentity,
  VOTED_COLUMNS,
  type FieldConfidenceMap,
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
    subjectSlotKey: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase F — confidence-weighted consolidation primitives (pure, no DB).
// ─────────────────────────────────────────────────────────────────────────────

// Richer factory for the weighting tests: lets a test set id / slot key /
// screen type / voted columns without a DB round-trip.
function mkSnap(overrides: Partial<Snapshot>): Snapshot {
  return {
    id: 1,
    playerId: null,
    gamertagSnapshot: 'Tag',
    playerNameSnapshot: null,
    playerNamePersona: null,
    playerNumber: null,
    isCaptain: null,
    isCaptainConfidence: null,
    subjectSlotKey: null,
    teamSide: 'for',
    position: 'C',
    buildClass: null,
    heightText: null,
    weightLbs: null,
    handedness: null,
    playerLevelRaw: null,
    playerLevelNumber: null,
    platform: null,
    gameTitleId: 1,
    ocrExtractionId: 1,
    screenType: 'player_loadout_view',
    reviewStatus: 'pending_review',
    isCpu: false,
    ...overrides,
  }
}

// ── weighted vote() ──────────────────────────────────────────────────────────

void test('vote (unweighted): majority wins, anchor wins ties, all-null → null', () => {
  assert.equal(vote('A', ['B', 'B']), 'B')
  assert.equal(vote('A', ['B']), 'A', 'tie → anchor (first observation) wins')
  assert.equal(vote<string>(null, [null]), null)
})

void test('vote (weighted): a single high-confidence reading beats a low-confidence majority', () => {
  // "lo" twice at 0.3 (Σ0.6) vs "hi" once at 0.95 → the confident reading wins.
  assert.equal(vote('lo', ['lo', 'hi'], [0.3, 0.3, 0.95]), 'hi')
})

void test('vote (weighted): equal weights reduce to count + anchor tiebreak (today’s behavior)', () => {
  assert.equal(vote('A', ['B', 'B'], [0.5, 0.5, 0.5]), 'B', 'B Σ1.0 > A 0.5')
  assert.equal(vote('A', ['B'], [0.7, 0.7]), 'A', 'weight tie → anchor wins')
})

void test('vote (weighted): a missing confidence falls back to weight 1, never a zero-weight drop', () => {
  // anchor "A" has no evidence (→ weight 1); "B" has 0.4. Weight 1 > 0.4 → A.
  // If a missing confidence silently dropped to 0, B would wrongly win.
  assert.equal(vote('A', ['B'], [null, 0.4]), 'A')
})

// ── confidence-aware pickAnchor() ─────────────────────────────────────────────

void test('pickAnchor: the higher anchor-field-confidence loadout slot wins over recency', () => {
  // "A" is NEWER (higher id) but low-confidence; "B" is OLDER but reads its
  // X-Factor/attribute fields far more confidently. Confidence must beat recency.
  const a = mkSnap({ id: 2, gamertagSnapshot: 'Tag', subjectSlotKey: 'loadout_slot_A' })
  const b = mkSnap({ id: 1, gamertagSnapshot: 'Tag', subjectSlotKey: 'loadout_slot_B' })
  const conf: FieldConfidenceMap = new Map([
    [
      'loadout_slot_A',
      new Map([
        ['x_factor_name_0', 0.4],
        ['attribute_speed_value', 0.4],
      ]),
    ],
    [
      'loadout_slot_B',
      new Map([
        ['x_factor_name_0', 0.95],
        ['attribute_speed_value', 0.95],
      ]),
    ],
  ])
  assert.equal(pickAnchor([a, b], conf).id, 1, 'older but more-confident slot B wins')
})

void test('pickAnchor: no evidence → recency (byte-identical to pre-Phase-F behavior)', () => {
  const a = mkSnap({ id: 2, gamertagSnapshot: 'Tag', subjectSlotKey: null })
  const b = mkSnap({ id: 1, gamertagSnapshot: 'Tag', subjectSlotKey: null })
  assert.equal(pickAnchor([a, b], new Map()).id, 2, 'newest snapshot wins when no confidence')
})

// ── field-map coverage (review finding 2) ─────────────────────────────────────
//
// Ground-truth RAW evidence field_keys the extractors actually emit, written
// out INDEPENDENTLY of EVIDENCE_KEY_BY_SOURCE so the test genuinely guards the
// map: if the map pointed a column at a key the extractor doesn't emit,
// fieldConfidence() would not find it in this hand-seeded slot map and the
// assertion would fail. Verified against lobby-v2.ts:473-490 (no alias map, so
// promoted-decision keys == raw keys) and loadout-v2.ts:659-727 +
// FIELD_KEY_ALIASES (jersey_number/persona_raw are the raw evidence keys).
const LOADOUT_RAW_KEYS = [
  'build_class',
  'player_name_full',
  'persona_raw',
  'jersey_number',
  'height',
  'weight',
  'handedness',
  'player_level_raw',
  'player_level_number',
  'player_platform',
]
const LOBBY_RAW_KEYS = [
  'build_class',
  'player_name_persona',
  'player_number',
  'height_text',
  'weight_lbs',
  'handedness',
  'player_level_raw',
  'player_level_number',
  'platform',
]

function seedSlotMap(rawKeys: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const k of rawKeys) m.set(k, 0.9)
  return m
}

void test('field-map: every voted column resolves confidence for a loadout snapshot', () => {
  const slotKey = 'loadout_slot_seg0002_subject01'
  const conf: FieldConfidenceMap = new Map([[slotKey, seedSlotMap(LOADOUT_RAW_KEYS)]])
  const s = mkSnap({ subjectSlotKey: slotKey, screenType: 'player_loadout_view' })
  for (const col of VOTED_COLUMNS) {
    assert.equal(
      fieldConfidence(s, col, conf),
      0.9,
      `loadout column ${col} must map to an emitted evidence key (finding-2 guard)`,
    )
  }
})

void test('field-map: every voted column except playerNameSnapshot resolves for a lobby snapshot', () => {
  const slotKey = 'lobby_for_C'
  const conf: FieldConfidenceMap = new Map([[slotKey, seedSlotMap(LOBBY_RAW_KEYS)]])
  const s = mkSnap({ subjectSlotKey: slotKey, screenType: 'pre_game_lobby_state_2' })
  for (const col of VOTED_COLUMNS) {
    const c = fieldConfidence(s, col, conf)
    if (col === 'playerNameSnapshot') {
      assert.equal(c, null, 'lobby writes no player_name_snapshot → intentionally unmapped')
    } else {
      assert.equal(
        c,
        0.9,
        `lobby column ${col} must map to an emitted evidence key (finding-2 guard)`,
      )
    }
  }
})

void test('field-map: a bare snapshot (no slot key) yields no confidence → weight-1 fallback', () => {
  const s = mkSnap({ subjectSlotKey: null })
  for (const col of VOTED_COLUMNS) {
    assert.equal(fieldConfidence(s, col, new Map()), null)
  }
})

// ── identity gate on the field vote (Phase G — for_RW bleed) ──────────────────
//
// A mid-scroll lobby transition frame can bind a neighbouring player's row into
// the wrong position slot (geometric row-grouping), producing a snapshot whose
// gamertag — and therefore whole identity (number/persona/build/…) — is a
// DIFFERENT player. `sameGamertagIdentity` gates such observations out of the
// per-slot field vote so they can't override the anchor's real values.

void test('identity gate: an observation reading a different player is not the same identity', () => {
  // match-250 for|RW: the loadout card is silkyjoker85; a transition frame bled
  // the LD player (HenryTheBobJr) into the RW slot. Different player → excluded.
  const anchor = mkSnap({ id: 1, gamertagSnapshot: 'silkyjoker85' })
  const bleed = mkSnap({ id: 2, gamertagSnapshot: 'HenryTheBobJr' })
  assert.equal(sameGamertagIdentity(bleed, anchor), false)
})

void test('identity gate: spacing/casing variants of one gamertag are the same identity', () => {
  // The common case must stay a no-op: `Stick Menace` and `StickMenace` are one
  // player (normalized), so the vote is unchanged for unbled slots.
  const anchor = mkSnap({ id: 1, gamertagSnapshot: 'Stick Menace' })
  const other = mkSnap({ id: 2, gamertagSnapshot: 'StickMenace' })
  assert.equal(sameGamertagIdentity(other, anchor), true)
})

void test('identity gate: an empty/unknown gamertag is never dropped (total, no silent zero-vote)', () => {
  // When identity can't be established on either side, do not gate — keep the
  // observation so no field is silently starved of votes.
  const anchor = mkSnap({ id: 1, gamertagSnapshot: '' })
  const other = mkSnap({ id: 2, gamertagSnapshot: 'silkyjoker85' })
  assert.equal(sameGamertagIdentity(other, anchor), true)
})
