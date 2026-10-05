/**
 * Player career rows: chronology and one-source-per-title precedence —
 * DB-free tests of the pure `assembleCareerSeasons`.
 *
 * `../players.js` reaches the db client, which throws at import time without
 * DATABASE_URL; a closed-port placeholder is set unconditionally and never
 * dialled (nothing here queries).
 *
 * Run:
 *   pnpm --filter @eanhl/db build && \
 *   node --test packages/db/dist/queries/__tests__/career-seasons.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
// Type-only: erased at compile time, so it cannot load the client early.
import type { CareerSeasonStats, CareerSeasonTitle } from '../players.js'

process.env.DATABASE_URL = 'postgresql://career-seasons-test:unused@127.0.0.1:1/unused'

const { assembleCareerSeasons } = await import('../players.js')

function stats(goals: number, assists: number, skaterGp: number): CareerSeasonStats {
  return {
    skaterGp,
    goals,
    assists,
    points: goals + assists,
    plusMinus: 0,
    shots: 0,
    shotAttempts: 0,
    hits: 0,
    pim: 0,
    takeaways: 0,
    giveaways: 0,
    faceoffPct: null,
    passPct: null,
    goalieGp: 0,
    wins: null,
    losses: null,
    otl: null,
    savePct: null,
    gaa: null,
    shutouts: null,
    saves: null,
    shotsAgainst: null,
    goalsAgainst: null,
  }
}

// Ids deliberately misleading: NHL 27 has the lowest id, NHL 26 the highest.
// The pre-0057 code sorted ascending id, which would put NHL 27 first here but
// last on production (nhl26 = 1, nhl27 = 7) — chronology must not depend on it.
const NHL27: CareerSeasonTitle = {
  gameTitleId: 2,
  gameTitleName: 'NHL 27',
  gameTitleSlug: 'nhl27',
  gameTitleReleaseOrder: 27,
}
const NHL26: CareerSeasonTitle = {
  gameTitleId: 9,
  gameTitleName: 'NHL 26',
  gameTitleSlug: 'nhl26',
  gameTitleReleaseOrder: 26,
}
const NHL22: CareerSeasonTitle = {
  gameTitleId: 5,
  gameTitleName: 'NHL 22',
  gameTitleSlug: 'nhl22',
  gameTitleReleaseOrder: 22,
}
const NHL24: CareerSeasonTitle = {
  gameTitleId: 3,
  gameTitleName: 'NHL 24',
  gameTitleSlug: 'nhl24',
  gameTitleReleaseOrder: 24,
}

const EA = new Map<number, CareerSeasonStats>([
  [NHL27.gameTitleId, stats(10, 5, 12)],
  [NHL26.gameTitleId, stats(100, 80, 200)],
])
// NHL 26 ALSO has a reviewed historical row (e.g. a manual import) that
// overlaps the EA totals; NHL 22 is historical-only.
const HISTORICAL = new Map<number, CareerSeasonStats>([
  [NHL26.gameTitleId, stats(90, 70, 180)],
  [NHL22.gameTitleId, stats(30, 20, 60)],
])

void test('career rows run newest first (NHL 27 before NHL 26) whatever the ids or input order', () => {
  for (const input of [
    [NHL26, NHL22, NHL27],
    [NHL22, NHL27, NHL26],
    [NHL27, NHL26, NHL22],
  ]) {
    const rows = assembleCareerSeasons(input, EA, HISTORICAL)
    assert.deepEqual(
      rows.map((r) => r.gameTitleSlug),
      ['nhl27', 'nhl26', 'nhl22'],
    )
  }
})

void test('exactly one cumulative source per title; EA wins where both exist', () => {
  const rows = assembleCareerSeasons([NHL26, NHL22, NHL27], EA, HISTORICAL)
  assert.equal(rows.length, 3)
  assert.equal(new Set(rows.map((r) => r.gameTitleId)).size, rows.length, 'no title repeated')
  assert.deepEqual(
    rows.map((r) => [r.gameTitleSlug, r.source]),
    [
      ['nhl27', 'ea'],
      ['nhl26', 'ea'],
      ['nhl22', 'historical'],
    ],
  )
  const nhl26 = rows.find((r) => r.gameTitleSlug === 'nhl26')
  assert.equal(nhl26?.goals, 100, 'NHL 26 goals are the EA total alone, not EA + historical')
})

void test('career totals sum one source per title — never EA and historical together', () => {
  const rows = assembleCareerSeasons([NHL26, NHL22, NHL27], EA, HISTORICAL)
  const total = rows.reduce((acc, r) => acc + r.goals, 0)
  // EA NHL 27 + EA NHL 26 + historical NHL 22. Adding the overlapping NHL 26
  // historical row (90) would double count.
  assert.equal(total, 10 + 100 + 30)
  const gp = rows.reduce((acc, r) => acc + r.skaterGp, 0)
  assert.equal(gp, 12 + 200 + 60)
})

void test('a title with neither source is skipped, and duplicates collapse to one row', () => {
  const rows = assembleCareerSeasons([NHL24, NHL27, NHL27], EA, HISTORICAL)
  assert.deepEqual(
    rows.map((r) => r.gameTitleSlug),
    ['nhl27'],
  )
})
