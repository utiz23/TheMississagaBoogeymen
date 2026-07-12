/**
 * L4 (API-truth accuracy) comparator + integration tests.
 *
 * Unit tests exercise the pure `computeL4` comparator (no DB). Integration
 * cases (added in Task 3.4) build the report body for the 4 already-ingested
 * matches and are gated on DATABASE_URL like match-250-benchmark.test.ts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeL4 } from '../lib/l4-api-truth.js'

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
    ocrPlayers: [{ personaRaw: 'silkyjoker85', goals: 2, assists: null, saves: null, savePct: null }],
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
