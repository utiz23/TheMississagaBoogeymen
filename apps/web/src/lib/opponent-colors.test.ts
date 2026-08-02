/**
 * Unit tests for resolveOpponentColors — the opponent clash-contingency
 * ladder from `Game sheet prototype layout (1)/Opponent Colour Rules.dc.html`.
 * Pure function, no React/DOM.
 *
 * The dominant production path is a NULL brand hex (brand colour exists for
 * ~1/191 clubs), so the abbrev-keyed alternate rung is tested hardest.
 *
 * Run: node --test apps/web/src/lib/opponent-colors.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveOpponentColors,
  clashFailures,
  OPPONENT_ALTERNATES,
  type OpponentColors,
} from './opponent-colors.ts'

const ALTERNATE_HEXES: readonly string[] = OPPONENT_ALTERNATES.map((a) => a.hex)

// ── Rung 3: the alternate set (null brand hex — the production path) ──────────

void test('null brand hex resolves to an issued alternate', () => {
  const r = resolveOpponentColors({ abbrev: 'BB', brandHex: null })
  assert.equal(r.provenance, 'alternate')
  assert.ok(ALTERNATE_HEXES.includes(r.base), `${r.base} should come from the alternate set`)
})

void test('alternate assignment is deterministic per abbrev', () => {
  const first = resolveOpponentColors({ abbrev: '716', brandHex: null })
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(resolveOpponentColors({ abbrev: '716', brandHex: null }), first)
  }
  // Values pinned so a hash change (silent re-colouring of every opponent
  // across the site) fails loudly.
  assert.equal(first.base, '#8FA6C4') // 716 → STEEL
  assert.equal(resolveOpponentColors({ abbrev: 'OPP', brandHex: null }).base, '#6E8FE8') // OPP → COBALT
})

void test('abbrev is case-insensitive and empty abbrev falls back to OPP', () => {
  const upper = resolveOpponentColors({ abbrev: 'BB', brandHex: null })
  const lower = resolveOpponentColors({ abbrev: 'bb', brandHex: null })
  assert.equal(lower.base, upper.base)

  const empty = resolveOpponentColors({ abbrev: '', brandHex: null })
  const opp = resolveOpponentColors({ abbrev: 'OPP', brandHex: null })
  assert.equal(empty.base, opp.base)
})

void test('invalid hex strings fall through to the alternate rung', () => {
  for (const bad of ['garbage', '#12', '#12345', 'rgb(1,2,3)', '']) {
    const r = resolveOpponentColors({ abbrev: 'XYZ', brandHex: bad })
    assert.equal(r.provenance, 'alternate', `"${bad}" should resolve via the alternate rung`)
    assert.ok(ALTERNATE_HEXES.includes(r.base))
  }
})

void test('every issued alternate itself clears the clash zones', () => {
  for (const alt of OPPONENT_ALTERNATES) {
    assert.deepEqual(clashFailures(alt.hex), [], `${alt.name} must be clash-free`)
  }
})

// ── Rung 1: brand pass-through ────────────────────────────────────────────────

void test('a clean brand colour ships unchanged', () => {
  const r = resolveOpponentColors({ abbrev: 'BLU', brandHex: '#3D7DD8' })
  assert.equal(r.provenance, 'brand')
  assert.equal(r.base, '#3D7DD8')
})

void test('brand hex is normalized to uppercase 6-digit form', () => {
  // DB stores lowercase (e.g. opponent_clubs.primary_color '#cc3333'-style).
  assert.equal(resolveOpponentColors({ abbrev: 'BLU', brandHex: '#3d7dd8' }).base, '#3D7DD8')
  assert.equal(resolveOpponentColors({ abbrev: 'BLU', brandHex: '3d7dd8' }).base, '#3D7DD8')
})

// ── Rung 2: the AWAY fallback (brand secondary) ───────────────────────────────

void test('a failing primary falls to a clearing secondary — the club changes sweaters', () => {
  // Spec worked case: a red club with gold in its kit keeps the gold.
  const r = resolveOpponentColors({ abbrev: 'RED', brandHex: '#C8102E', secondaryHex: '#F1C40F' })
  assert.equal(r.provenance, 'secondary')
  assert.equal(r.base, '#F1C40F')
})

void test('the secondary is only consulted when the primary fails', () => {
  const r = resolveOpponentColors({ abbrev: 'BLU', brandHex: '#3D7DD8', secondaryHex: '#F1C40F' })
  assert.equal(r.provenance, 'brand')
  assert.equal(r.base, '#3D7DD8')
})

void test('a secondary that also fails is skipped — rung 3 reads the PRIMARY', () => {
  // Black primary + red secondary: the gunmetal lift belongs to the black,
  // and the red must not leak through as the issued colour.
  const r = resolveOpponentColors({ abbrev: 'DVL', brandHex: '#0B0B0B', secondaryHex: '#CE1126' })
  assert.equal(r.provenance, 'gunmetal')
  assert.equal(r.base, '#81878D')
  assert.deepEqual(clashFailures(r.base), [])
})

void test('a missing primary promotes the secondary — it IS the club colour', () => {
  // No jersey hex was OCR'd for the match, so the club's stored brand accent is
  // the only real colour there is. It runs the full ladder as the primary.
  for (const missing of [null, '', 'garbage']) {
    const r = resolveOpponentColors({ abbrev: 'BLU', brandHex: missing, secondaryHex: '#3D7DD8' })
    assert.equal(r.provenance, 'brand', `primary "${String(missing)}" should promote the secondary`)
    assert.equal(r.base, '#3D7DD8')
  }
})

void test('a promoted secondary still gets rung 3 lifted, hue intact', () => {
  // Regression guard: promotion (not the AWAY rung) is what keeps a dark brand
  // colour from collapsing to a generic alternate when no jersey was read.
  const promoted = resolveOpponentColors({ abbrev: 'NAV', brandHex: null, secondaryHex: '#0B1C3A' })
  assert.equal(promoted.provenance, 'adjusted')
  assert.equal(promoted.base, resolveOpponentColors({ abbrev: 'NAV', brandHex: '#0B1C3A' }).base)
})

void test('an absent or unusable secondary leaves the old two-rung behaviour intact', () => {
  const bare = resolveOpponentColors({ abbrev: 'RED', brandHex: '#C8102E' })
  for (const bad of [null, undefined, '', '#12345', '#111111']) {
    const r = resolveOpponentColors({ abbrev: 'RED', brandHex: '#C8102E', secondaryHex: bad })
    assert.deepEqual(r, bare, `secondary "${String(bad)}" must not change the outcome`)
  }
})

void test('the secondary is normalized like the primary', () => {
  assert.equal(
    resolveOpponentColors({ abbrev: 'RED', brandHex: '#C8102E', secondaryHex: '3d7dd8' }).base,
    '#3D7DD8',
  )
})

// ── Red wedge: no lightness change can save it ────────────────────────────────

void test('red-wedge clubs are issued a cool alternate, never a red', () => {
  for (const red of ['#C8102E', '#E84131', '#7A0019']) {
    const r = resolveOpponentColors({ abbrev: 'RED', brandHex: red })
    assert.equal(r.provenance, 'alternate', `${red} sits in the reserved wedge`)
    assert.ok(ALTERNATE_HEXES.includes(r.base))
    assert.notEqual(r.base, red)
  }
})

// ── Clash adjustment: dark and pale brands ────────────────────────────────────

void test('true black lifts to gunmetal — a hue is never invented', () => {
  for (const black of ['#111111', '#0B0B0B']) {
    const r = resolveOpponentColors({ abbrev: 'BLK', brandHex: black })
    assert.equal(r.provenance, 'gunmetal')
    assert.equal(r.base, '#81878D') // pinned output of the spec's gunmetal lift
  }
})

void test('a dark but chromatic brand is lifted with its hue kept', () => {
  const r = resolveOpponentColors({ abbrev: 'NAV', brandHex: '#0B1C3A' })
  assert.equal(r.provenance, 'adjusted')
  assert.equal(r.base, '#7187AC') // navy in, lighter blue out — still reads as the club
})

void test('near-white drops out of the text zone with a cool cast', () => {
  const r = resolveOpponentColors({ abbrev: 'WHT', brandHex: '#F7F7F7' })
  assert.equal(r.provenance, 'adjusted')
  assert.equal(r.base, '#C0D3E8')
})

// ── The core invariant: every output clears every clash zone ──────────────────

void test('resolved base always clears the clash zones, whatever the input', () => {
  const inputs: (string | null)[] = [
    '#C8102E',
    '#E84131',
    '#111111',
    '#0B0B0B',
    '#7A0019',
    '#F7F7F7',
    '#3D7DD8',
    '#0B1C3A',
    '#FFFFFF',
    '#000000',
    null,
    'nonsense',
  ]
  const secondaries: (string | null | undefined)[] = [
    undefined,
    null,
    '#F1C40F',
    '#C8102E',
    '#000000',
    'nonsense',
  ]
  for (const brandHex of inputs) {
    for (const abbrev of ['BB', '716', 'OPP', 'ZZZZ']) {
      for (const secondaryHex of secondaries) {
        const r = resolveOpponentColors({ abbrev, brandHex, secondaryHex })
        assert.deepEqual(
          clashFailures(r.base),
          [],
          `${String(brandHex)} / ${String(secondaryHex)} (${abbrev}) resolved to ${r.base}, which must be clash-free`,
        )
      }
    }
  }
})

// ── Derived surfaces ──────────────────────────────────────────────────────────

void test('strong/line/soft are alpha variants of base at 74/40/12 percent', () => {
  const r: OpponentColors = resolveOpponentColors({ abbrev: 'BB', brandHex: null })
  // BB → STEEL #8FA6C4 = rgb(143, 166, 196)
  assert.equal(r.strong, 'rgba(143, 166, 196, 0.74)')
  assert.equal(r.line, 'rgba(143, 166, 196, 0.4)')
  assert.equal(r.soft, 'rgba(143, 166, 196, 0.12)')
})

void test('fg flips between page charcoal and paper on base lightness', () => {
  // STEEL is light — dark text on it.
  assert.equal(resolveOpponentColors({ abbrev: 'BB', brandHex: null }).fg, '#1A1819')
  // A passing mid-dark brand blue keeps paper text.
  assert.equal(resolveOpponentColors({ abbrev: 'BLU', brandHex: '#3D7DD8' }).fg, '#EBEBEB')
})
