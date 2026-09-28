import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCareerCoverage,
  excludeHistoricalRowsCoveredByEa,
  aggregateSkaterCareerRows,
  aggregateGoalieCareerRows,
  type CareerSkaterCountRow,
  type CareerGoalieCountRow,
} from './career-coverage.js'

// ─── computeCareerCoverage ───────────────────────────────────────────────

void test('computeCareerCoverage: complete when covered equals total and total > 0', () => {
  assert.deepEqual(computeCareerCoverage(48, 48), { state: 'complete', coveredGp: 48, totalGp: 48 })
})

void test('computeCareerCoverage: partial when covered is between 0 and total', () => {
  assert.deepEqual(computeCareerCoverage(26, 210), {
    state: 'partial',
    coveredGp: 26,
    totalGp: 210,
  })
})

void test('computeCareerCoverage: unavailable when covered is zero', () => {
  assert.deepEqual(computeCareerCoverage(0, 21), {
    state: 'unavailable',
    coveredGp: 0,
    totalGp: 21,
  })
})

void test('computeCareerCoverage: unavailable when total is also zero', () => {
  assert.deepEqual(computeCareerCoverage(0, 0), { state: 'unavailable', coveredGp: 0, totalGp: 0 })
})

// ─── excludeHistoricalRowsCoveredByEa (source precedence) ───────────────────

void test('excludeHistoricalRowsCoveredByEa: EA/player-card overlap on the same player+title excludes the historical row', () => {
  const eaRows = [{ playerId: 5, gameTitleId: 1 }]
  const historicalRows = [
    { playerId: 5, gameTitleId: 1, goals: 10 },
    { playerId: 5, gameTitleId: 3, goals: 20 },
  ]
  const result = excludeHistoricalRowsCoveredByEa(eaRows, historicalRows)
  assert.deepEqual(result, [{ playerId: 5, gameTitleId: 3, goals: 20 }])
})

void test('excludeHistoricalRowsCoveredByEa: no overlap across different titles keeps every historical row', () => {
  const eaRows = [{ playerId: 5, gameTitleId: 1 }]
  const historicalRows = [
    { playerId: 5, gameTitleId: 2, goals: 5 },
    { playerId: 5, gameTitleId: 3, goals: 6 },
  ]
  const result = excludeHistoricalRowsCoveredByEa(eaRows, historicalRows)
  assert.deepEqual(result, historicalRows)
})

void test('excludeHistoricalRowsCoveredByEa: a different player with the same title is unaffected', () => {
  const eaRows = [{ playerId: 5, gameTitleId: 1 }]
  const historicalRows = [{ playerId: 7, gameTitleId: 1, goals: 3 }]
  assert.deepEqual(excludeHistoricalRowsCoveredByEa(eaRows, historicalRows), historicalRows)
})

// ─── aggregateSkaterCareerRows ───────────────────────────────────────────────

function skaterRow(overrides: Partial<CareerSkaterCountRow>): CareerSkaterCountRow {
  return {
    gamesPlayed: 0,
    goals: 0,
    assists: 0,
    points: 0,
    plusMinus: 0,
    pim: 0,
    shots: 0,
    hits: 0,
    takeaways: 0,
    giveaways: 0,
    shotAttempts: 0,
    faceoffWins: 0,
    faceoffLosses: 0,
    passCompletions: 0,
    passAttempts: 0,
    toiSeconds: null,
    ...overrides,
  }
}

void test('aggregateSkaterCareerRows: complete TOI coverage — one row, TOI present', () => {
  const result = aggregateSkaterCareerRows([
    skaterRow({ gamesPlayed: 46, goals: 5, toiSeconds: 146_880 }),
  ])
  assert.equal(result.gamesPlayed, 46)
  assert.equal(result.toiSeconds, 146_880)
  assert.equal(result.toiCoverageGp, 46)
  assert.deepEqual(result.toiCoverage, { state: 'complete', coveredGp: 46, totalGp: 46 })
})

void test('aggregateSkaterCareerRows: partial TOI coverage — one covered row, one uncovered row', () => {
  const result = aggregateSkaterCareerRows([
    skaterRow({ gamesPlayed: 25, goals: 3, toiSeconds: 69_420 }),
    skaterRow({ gamesPlayed: 184, goals: 20, toiSeconds: null }),
  ])
  assert.equal(result.gamesPlayed, 209)
  assert.equal(result.goals, 23)
  assert.equal(result.toiSeconds, 69_420)
  assert.equal(result.toiCoverageGp, 25)
  assert.deepEqual(result.toiCoverage, { state: 'partial', coveredGp: 25, totalGp: 209 })
})

void test('aggregateSkaterCareerRows: unavailable TOI — no row ever captured it', () => {
  const result = aggregateSkaterCareerRows([
    skaterRow({ gamesPlayed: 21, goals: 2, toiSeconds: null }),
  ])
  assert.equal(result.toiSeconds, null)
  assert.equal(result.toiCoverageGp, 0)
  assert.deepEqual(result.toiCoverage, { state: 'unavailable', coveredGp: 0, totalGp: 21 })
})

void test('aggregateSkaterCareerRows: preserves other totals — faceoffPct/passPct recompute from ALL rows regardless of TOI coverage', () => {
  const result = aggregateSkaterCareerRows([
    skaterRow({
      gamesPlayed: 10,
      goals: 4,
      assists: 6,
      points: 10,
      faceoffWins: 30,
      faceoffLosses: 20,
      passCompletions: 80,
      passAttempts: 100,
      toiSeconds: null, // no TOI, but rate fields still count this row
    }),
  ])
  assert.equal(result.faceoffPct, '60.00')
  assert.equal(result.passPct, '80.00')
  assert.equal(result.goals, 4)
  assert.equal(result.assists, 6)
  assert.equal(result.points, 10)
})

// ─── aggregateGoalieCareerRows ────────────────────────────────────────────

function goalieRow(overrides: Partial<CareerGoalieCountRow>): CareerGoalieCountRow {
  return {
    gamesPlayed: 0,
    wins: null,
    losses: null,
    otl: null,
    shutouts: null,
    totalSaves: null,
    totalGoalsAgainst: null,
    toiSeconds: null,
    ...overrides,
  }
}

void test('aggregateGoalieCareerRows: complete GAA coverage — one row with TOI and GA', () => {
  const result = aggregateGoalieCareerRows([
    goalieRow({ gamesPlayed: 14, totalSaves: 300, totalGoalsAgainst: 50, toiSeconds: 40_260 }),
  ])
  assert.equal(result.gaa, ((50 * 3600) / 40_260).toFixed(2))
  assert.deepEqual(result.gaaCoverage, { state: 'complete', coveredGp: 14, totalGp: 14 })
  assert.deepEqual(result.toiCoverage, { state: 'complete', coveredGp: 14, totalGp: 14 })
})

void test('aggregateGoalieCareerRows: partial GAA coverage — the frozen silkyjoker85 fixture', () => {
  // Frozen production-shaped fixture (see PLAN Unit C task 7): total GP 210,
  // TOI-covered GP 26, total GA 760, covered GA 94, covered TOI 69,420s.
  // Modeled as: one EA-style row with the full TOI+GA coverage (26 GP, 94 GA,
  // 69,420s TOI) plus reviewed player-card rows that have GP and GA but no
  // TOI, summing to the remaining 184 GP and 666 GA.
  const rows: CareerGoalieCountRow[] = [
    goalieRow({ gamesPlayed: 26, totalSaves: 587, totalGoalsAgainst: 94, toiSeconds: 69_420 }),
    goalieRow({ gamesPlayed: 184, totalSaves: 0, totalGoalsAgainst: 666, toiSeconds: null }),
  ]
  const result = aggregateGoalieCareerRows(rows)

  assert.equal(result.gamesPlayed, 210)
  assert.equal(result.toiCoverageGp, 26)
  assert.equal(result.totalGoalsAgainst, 760)
  assert.equal(result.gaaCoveredGoalsAgainst, 94)
  assert.equal(result.toiSeconds, 69_420)
  assert.equal(result.gaa, '4.87')
  assert.equal(result.toiCoverageGp, 26)
  // `toiSeconds` is narrowed non-null by the assertion above: 69420 / 26 = 2670s = 44:30
  assert.equal(result.toiSeconds / result.toiCoverageGp, 2670)
  assert.deepEqual(result.toiCoverage, { state: 'partial', coveredGp: 26, totalGp: 210 })
  assert.deepEqual(result.gaaCoverage, { state: 'partial', coveredGp: 26, totalGp: 210 })
})

void test('aggregateGoalieCareerRows: unavailable GAA — no row has both TOI and GA', () => {
  const result = aggregateGoalieCareerRows([
    goalieRow({ gamesPlayed: 21, totalGoalsAgainst: 77, toiSeconds: null }),
  ])
  assert.equal(result.gaa, null)
  assert.equal(result.gaaCoveredGoalsAgainst, null)
  assert.deepEqual(result.gaaCoverage, { state: 'unavailable', coveredGp: 0, totalGp: 21 })
})

void test('aggregateGoalieCareerRows: TOI present but GA missing does not count as GAA coverage', () => {
  const result = aggregateGoalieCareerRows([
    goalieRow({ gamesPlayed: 10, totalGoalsAgainst: null, toiSeconds: 20_000 }),
  ])
  // TOI coverage exists...
  assert.deepEqual(result.toiCoverage, { state: 'complete', coveredGp: 10, totalGp: 10 })
  // ...but GAA coverage must not, since GA was never recorded on this row.
  assert.equal(result.gaa, null)
  assert.equal(result.gaaCoveredGoalsAgainst, null)
  assert.deepEqual(result.gaaCoverage, { state: 'unavailable', coveredGp: 0, totalGp: 10 })
})

void test('aggregateGoalieCareerRows: preserves other totals — savePct and totalShotsAgainst are unaffected by TOI coverage', () => {
  const result = aggregateGoalieCareerRows([
    goalieRow({ gamesPlayed: 20, totalSaves: 180, totalGoalsAgainst: 20, toiSeconds: null }),
  ])
  assert.equal(result.savePct, '90.00')
  assert.equal(result.totalShotsAgainst, 200)
  assert.equal(result.totalGoalsAgainst, 20)
  assert.equal(result.totalSaves, 180)
})

void test('aggregateGoalieCareerRows: recorded zero GA on a covered row is a real value, not treated as missing', () => {
  const result = aggregateGoalieCareerRows([
    goalieRow({ gamesPlayed: 5, totalSaves: 100, totalGoalsAgainst: 0, toiSeconds: 15_000 }),
  ])
  assert.equal(result.gaaCoveredGoalsAgainst, 0)
  assert.equal(result.gaa, '0.00')
  assert.deepEqual(result.gaaCoverage, { state: 'complete', coveredGp: 5, totalGp: 5 })
})
