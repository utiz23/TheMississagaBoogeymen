/**
 * L4 (API-truth accuracy) comparator + integration tests.
 *
 * Unit tests exercise the pure `computeL4` comparator (no DB). Integration
 * cases (added in Task 3.4) build the report body for the 4 already-ingested
 * matches and are gated on DATABASE_URL like match-250-benchmark.test.ts.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { computeL4, gateFromL4 } from '../lib/l4-api-truth.js'
// The integration cases lazy-import `@eanhl/db/queries` + `run-quality-report`
// INSIDE the DATABASE_URL gate. Those pull in the `@eanhl/db` client, which
// throws at import when DATABASE_URL is unset — so a top-level import would stop
// the pure `computeL4` unit tests from running standalone (no DB) too.

void test('computeL4 grades team totals exact, flags a shot mismatch', async () => {
  const r = await computeL4({
    ocrTeam: {
      goalsFor: 4,
      goalsAgainst: 2,
      shotsFor: 29,
      shotsAgainst: 20,
      faceoffsFor: 11,
      faceoffsAgainst: 9,
    },
    apiTeam: {
      scoreFor: 4,
      scoreAgainst: 2,
      shotsFor: 28,
      shotsAgainst: 20,
      faceoffsFor: 11,
      faceoffsAgainst: 9,
    },
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
  })
  assert.equal(r.gradable, true)
  assert.equal(r.fieldsTotal, 6)
  assert.equal(r.fieldsMatched, 5) // shotsFor 29≠28
  assert.equal(r.mismatches.length, 1)
  assert.equal(r.mismatches[0]!.field, 'shotsFor')
})

void test('computeL4 is ungradable when there is no API truth', async () => {
  const r = await computeL4({
    ocrTeam: {
      goalsFor: 4,
      goalsAgainst: 2,
      shotsFor: 29,
      shotsAgainst: 20,
      faceoffsFor: 11,
      faceoffsAgainst: 9,
    },
    apiTeam: null,
    ocrPlayers: [
      { personaRaw: 'silkyjoker85', goals: 2, assists: null, saves: null, savePct: null },
    ],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: 1 }),
  })
  assert.equal(r.gradable, false)
  assert.equal(r.score, null)
  assert.equal(r.fieldsTotal, 0)
  assert.equal(r.diffs.length, 0)
  assert.match(r.notes, /ungradable — OCR sole source/)
})

void test('computeL4 skips fields OCR never captured (accuracy, not coverage)', async () => {
  // match-463 shape: OCR read goals + faceoffs but not shots (null). The null
  // shots must NOT be graded as a wrong read — only what OCR captured counts.
  const r = await computeL4({
    ocrTeam: {
      goalsFor: 2,
      goalsAgainst: 0,
      shotsFor: null,
      shotsAgainst: null,
      faceoffsFor: 11,
      faceoffsAgainst: 15,
    },
    apiTeam: {
      scoreFor: 2,
      scoreAgainst: 0,
      shotsFor: 23,
      shotsAgainst: 18,
      faceoffsFor: 11,
      faceoffsAgainst: 15,
    },
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
  })
  assert.equal(r.gradable, true)
  assert.equal(r.fieldsTotal, 4) // goals×2 + faceoffs×2; shots skipped
  assert.equal(r.fieldsMatched, 4)
  assert.equal(r.score, 1)
  assert.equal(r.mismatches.length, 0)
  assert.ok(!r.diffs.some((d) => d.field === 'shotsFor' || d.field === 'shotsAgainst'))
})

void test('computeL4 grades per-player lines, flagging a persona mismatch', async () => {
  // Two OCR personas resolve to two API players; team side omitted (ocrTeam
  // null) to isolate per-player grading. 'silky' matches, 'henry' does not.
  const personaToId: Record<string, number> = { silky: 1, henry: 2 }
  const r = await computeL4({
    ocrTeam: null,
    apiTeam: {
      scoreFor: 3,
      scoreAgainst: 2,
      shotsFor: 20,
      shotsAgainst: 18,
      faceoffsFor: 10,
      faceoffsAgainst: 9,
    },
    ocrPlayers: [
      { personaRaw: 'silky', goals: 2, assists: null, saves: null, savePct: null },
      { personaRaw: 'henry', goals: 2, assists: null, saves: null, savePct: null },
    ],
    apiPlayers: [
      { playerId: 1, gamertag: 'silkyjoker85', goals: 2, assists: 1, saves: null, savePct: null },
      { playerId: 2, gamertag: 'HenryTheBobJr', goals: 0, assists: 2, saves: null, savePct: null },
    ],
    resolvePersona: async (raw) => ({ playerId: personaToId[raw] ?? null }),
  })
  assert.equal(r.gradable, true)
  assert.equal(r.fieldsTotal, 2) // only the two OCR-read goals values (assists null → skipped)
  assert.equal(r.fieldsMatched, 1)
  assert.equal(r.score, 0.5)
  assert.equal(r.mismatches.length, 1)
  assert.equal(r.mismatches[0]!.field, 'goals')
  assert.equal(r.mismatches[0]!.scope, 'player:henry')
})

// ── Task 4.G — coverage-aware sub-metrics + gate fn ─────────────────────────
// finalAccuracy grades the TOT-row final (the strongest signal), periodCoverage
// flags a missed period so periodAccuracy isn't false-scored, and gateFromL4
// turns finalAccuracy into {PASS / HOLD / OPERATOR_CONFIRM} without the naive
// `L4>=τ` reject that would false-reject a correct-final-noisy-per-period match.

const API_5_1 = {
  scoreFor: 5,
  scoreAgainst: 1,
  shotsFor: 20,
  shotsAgainst: 10,
  faceoffsFor: 10,
  faceoffsAgainst: 8,
}

void test('4.G (a) clean final + complete coverage → PASS, periodAccuracy graded', async () => {
  const r = await computeL4({
    ocrTeam: null,
    apiTeam: API_5_1,
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
    ocrFinal: { goalsFor: 5, goalsAgainst: 1 },
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 5, goalsAgainst: 1 },
      { periodNumber: 2, goalsFor: 0, goalsAgainst: 0 },
      { periodNumber: 3, goalsFor: 0, goalsAgainst: 0 },
      { periodNumber: 4, goalsFor: 0, goalsAgainst: 0 },
    ],
  })
  assert.equal(r.finalAccuracy, 1)
  assert.equal(r.periodCoverage, 1)
  assert.equal(r.periodAccuracy, 1)
  assert.equal(gateFromL4(r).decision, 'PASS')
})

void test('4.G (b) correct final + missing period → PASS, coverage<1, periodAccuracy null (973 case)', async () => {
  const r = await computeL4({
    ocrTeam: null,
    apiTeam: { ...API_5_1, scoreFor: 7, scoreAgainst: 3 },
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
    ocrFinal: { goalsFor: 7, goalsAgainst: 3 },
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 1, goalsAgainst: 1 },
      { periodNumber: 2, goalsFor: null, goalsAgainst: null }, // unread period
      { periodNumber: 3, goalsFor: 3, goalsAgainst: 1 },
      { periodNumber: 4, goalsFor: 0, goalsAgainst: 0 },
    ],
  })
  assert.equal(r.finalAccuracy, 1) // TOT final 7-3 == API 7-3
  assert.equal(r.periodCoverage, 0.75) // 3 of 4 periods have goals
  assert.equal(r.periodAccuracy, null) // NOT graded — coverage incomplete
  assert.equal(gateFromL4(r).decision, 'PASS') // the whole point: no false-reject
})

void test('4.G (c) wrong final → HOLD', async () => {
  const r = await computeL4({
    ocrTeam: null,
    apiTeam: { ...API_5_1, scoreFor: 7, scoreAgainst: 3 },
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
    ocrFinal: { goalsFor: 4, goalsAgainst: 2 }, // both sides misread
    ocrPeriods: [{ periodNumber: 1, goalsFor: 4, goalsAgainst: 2 }],
  })
  assert.equal(r.finalAccuracy, 0)
  assert.equal(gateFromL4(r).decision, 'HOLD')
})

void test('4.G (c2) half-wrong final → HOLD (finalAccuracy 0.5)', async () => {
  const r = await computeL4({
    ocrTeam: null,
    apiTeam: API_5_1,
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
    ocrFinal: { goalsFor: 5, goalsAgainst: 2 }, // for right, against wrong
  })
  assert.equal(r.finalAccuracy, 0.5)
  assert.equal(gateFromL4(r).decision, 'HOLD')
})

void test('4.G (d) api-missed (no API truth) → finalAccuracy null, OPERATOR_CONFIRM', async () => {
  const r = await computeL4({
    ocrTeam: null,
    apiTeam: null, // priority-0 batch target: no API truth to grade against
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
    ocrFinal: { goalsFor: 5, goalsAgainst: 1 },
    ocrPeriods: [
      { periodNumber: 1, goalsFor: 5, goalsAgainst: 1 },
      { periodNumber: 2, goalsFor: 0, goalsAgainst: 0 },
    ],
  })
  assert.equal(r.gradable, false)
  assert.equal(r.finalAccuracy, null)
  assert.equal(r.periodCoverage, 1) // coverage computable without API
  assert.equal(r.periodAccuracy, null) // no API final to grade against
  assert.equal(gateFromL4(r).decision, 'OPERATOR_CONFIRM')
})

void test('4.G (e) API truth present but no OCR final read → HOLD', async () => {
  const r = await computeL4({
    ocrTeam: null,
    apiTeam: API_5_1,
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
    ocrFinal: null, // no TOT row read
  })
  assert.equal(r.finalAccuracy, null)
  assert.equal(r.gradable, true)
  assert.equal(gateFromL4(r).decision, 'HOLD')
})

void test('4.G existing computeL4 callers (no ocrFinal/ocrPeriods) → sub-metrics null', async () => {
  const r = await computeL4({
    ocrTeam: {
      goalsFor: 4,
      goalsAgainst: 2,
      shotsFor: null,
      shotsAgainst: null,
      faceoffsFor: null,
      faceoffsAgainst: null,
    },
    apiTeam: API_5_1,
    ocrPlayers: [],
    apiPlayers: [],
    resolvePersona: async () => ({ playerId: null }),
  })
  assert.equal(r.finalAccuracy, null)
  assert.equal(r.periodCoverage, null)
  assert.equal(r.periodAccuracy, null)
})

void test('gateFromL4 maps each finalAccuracy/gradable combination', () => {
  assert.equal(gateFromL4({ finalAccuracy: 1, gradable: true }).decision, 'PASS')
  assert.equal(gateFromL4({ finalAccuracy: 0.5, gradable: true }).decision, 'HOLD')
  assert.equal(gateFromL4({ finalAccuracy: 0, gradable: true }).decision, 'HOLD')
  assert.equal(gateFromL4({ finalAccuracy: null, gradable: false }).decision, 'OPERATOR_CONFIRM')
  assert.equal(gateFromL4({ finalAccuracy: null, gradable: true }).decision, 'HOLD')
})

// ── Integration: L4 populates through the real report body for the 4 already-
// ingested matches (250 API-imperfect box score, 463 shots-untab'd, 968 noisy,
// 2582 no player-summary). Gated on DATABASE_URL like match-250-benchmark.
const L4_INGESTED_MATCHES = [250, 463, 968, 2582] as const

after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

for (const matchId of L4_INGESTED_MATCHES) {
  void test(`L4 report body is populated + gradable for match ${String(matchId)}`, async (t) => {
    if (!process.env['DATABASE_URL']) {
      t.skip('DATABASE_URL not set — L4 integration gate requires DB.')
      return
    }
    const { getActiveRunIdForMatch } = await import('@eanhl/db/queries')
    const { buildReportBody, loadRunRow } = await import('../lib/run-quality-report.js')
    const runId = await getActiveRunIdForMatch(matchId)
    assert.ok(runId, `no active run for match ${String(matchId)}`)
    const run = await loadRunRow(runId)
    assert.ok(run, `active run ${String(runId)} not loadable for match ${String(matchId)}`)

    const body = await buildReportBody(run, { runtime: null })
    const l4 = body.layers.l4
    assert.equal(l4.gradable, true, `match ${String(matchId)}: L4 should be gradable`)
    assert.ok(
      typeof l4.score === 'number' && l4.score >= 0 && l4.score <= 1,
      `match ${String(matchId)}: L4 score should be a number in [0,1]; got ${String(l4.score)}`,
    )
    assert.ok(
      Array.isArray(l4.mismatches),
      `match ${String(matchId)}: L4 mismatches must be an array`,
    )
  })
}
