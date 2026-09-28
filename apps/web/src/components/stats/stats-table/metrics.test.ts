import test from 'node:test'
import assert from 'node:assert/strict'
import { GOALIE_METRICS } from './goalie-metrics.ts'
import { resolveCell } from './metrics.ts'
import { SKATER_METRICS } from './skater-metrics.ts'
import type { GoalieDisplayRow, SkaterDisplayRow } from './types.ts'
import { GOALIE_VIEWS, SKATER_VIEWS, resolveViews, visibleKeysFor } from './views.ts'

const skater = (over: Partial<SkaterDisplayRow> = {}): SkaterDisplayRow => ({
  playerId: 3,
  gamertag: 'Stick Menace',
  position: 'center',
  gamesPlayed: 41,
  goals: 46,
  assists: 28,
  points: 74,
  plusMinus: -15,
  pim: 102,
  shots: 199,
  hits: 125,
  takeaways: 98,
  giveaways: 242,
  faceoffPct: '54.50',
  passPct: '72.50',
  shotAttempts: 226,
  toiSeconds: 120240,
  expanded: null,
  ...over,
})

const goalie = (over: Partial<GoalieDisplayRow> = {}): GoalieDisplayRow => ({
  playerId: 5,
  gamertag: 'JoeyFlopfish',
  gamesPlayed: 4,
  wins: 1,
  losses: 3,
  otl: 0,
  savePct: '80.00',
  gaa: '3.10',
  shutouts: 0,
  totalSaves: 24,
  totalShotsAgainst: 30,
  totalGoalsAgainst: 6,
  toiSeconds: 6960,
  recordUnavailable: false,
  expanded: null,
  ...over,
})

function need<T>(v: T | undefined): T {
  assert.ok(v !== undefined, 'metric missing from registry')
  return v
}
const cell = (m: string, r: SkaterDisplayRow, pg = false) =>
  resolveCell(need(SKATER_METRICS[m]), r, pg)
const gcell = (m: string, r: GoalieDisplayRow, pg = false) =>
  resolveCell(need(GOALIE_METRICS[m]), r, pg)

function reachableKeys(views: ReturnType<typeof resolveViews>): Set<string> {
  return new Set(views.flatMap(visibleKeysFor))
}

void test('all 23 current skater metrics stay reachable WITHOUT expanded data', () => {
  const keys = reachableKeys(resolveViews(SKATER_VIEWS, SKATER_METRICS, false))
  // direct columns
  for (const k of [
    'gp',
    'g',
    'a',
    'pts',
    'pm',
    'pim',
    'sog',
    'gatt',
    'toigp',
    'hits',
    'ta',
    'gv',
    'fo',
    'passp',
    'tagv',
  ]) {
    assert.ok(keys.has(k), `missing skater metric ${k}`)
  }
  // old X/GP columns are the Per GP toggle on these bases (P/GP ≡ PTS/GP)
  for (const k of ['g', 'a', 'pts', 'sog', 'hits', 'ta', 'pim', 'gv']) {
    assert.ok(SKATER_METRICS[k]?.perGame, `${k} must support Per GP`)
  }
})

void test('all 14 current goalie metrics stay reachable WITHOUT expanded data', () => {
  const keys = reachableKeys(resolveViews(GOALIE_VIEWS, GOALIE_METRICS, false))
  for (const k of ['gp', 'w', 'l', 'otl', 'svp', 'gaa', 'so', 'sv', 'sa', 'ga', 'toi', 'toigp']) {
    assert.ok(keys.has(k), `missing goalie metric ${k}`)
  }
  for (const k of ['sv', 'sa']) assert.ok(GOALIE_METRICS[k]?.perGame)
})

void test('expanded-only columns and empty tabs are removed without expanded data', () => {
  const views = resolveViews(SKATER_VIEWS, SKATER_METRICS, false)
  const keys = reachableKeys(views)
  for (const k of ['ppg', 'poss', 'brk', 'shp', 'bs']) assert.ok(!keys.has(k), `${k} leaked`)
  assert.ok(!views.some((v) => v.id === 'breakaways'), 'all-expanded tab must be hidden')
  const withEx = resolveViews(SKATER_VIEWS, SKATER_METRICS, true)
  assert.ok(withEx.some((v) => v.id === 'breakaways'))
  assert.ok(reachableKeys(withEx).has('poss'))
})

void test('DNF and GC are intentionally not offered', () => {
  for (const m of [SKATER_METRICS, GOALIE_METRICS]) {
    assert.ok(!('dnf' in m) && !('gc' in m))
  }
})

void test('G/SATT% keeps the goals ÷ attempts formula and is unavailable at 0/null attempts', () => {
  assert.equal(cell('gatt', skater()).text, '20.4%')
  assert.equal(cell('gatt', skater({ shotAttempts: 0 })).text, '—')
  assert.equal(cell('gatt', skater({ shotAttempts: null })).text, '—')
})

void test('TA:GV is unavailable when giveaways are 0; TOI/GP is m:ss', () => {
  assert.equal(cell('tagv', skater({ giveaways: 0 })).text, '—')
  assert.equal(cell('tagv', skater()).text, '0.40')
  assert.equal(cell('toigp', skater()).text, '48:53')
})

void test('Per GP: rate values use role GP, label gains /GP, and zero GP is unavailable', () => {
  assert.equal(cell('pts', skater(), true).text, '1.80')
  assert.equal(cell('pts', skater({ gamesPlayed: 0 }), true).text, '—')
  assert.equal(cell('pts', skater({ gamesPlayed: 0 }), true).value, null)
  // non-rate metrics are unchanged in per-game mode
  assert.equal(cell('pm', skater(), true).text, '−15')
  assert.equal(cell('fo', skater(), true).text, '54.50%')
})

void test('goalie per-game rates never produce Infinity/NaN for GP = 0 (sortable value is null)', () => {
  const r = goalie({ gamesPlayed: 0, totalSaves: 633 })
  const c = gcell('sv', r, true)
  assert.equal(c.value, null)
  assert.equal(c.text, '—')
  assert.equal(gcell('toigp', r, false).value, null)
})

void test('goalie supplied SV% and GAA keep stored precision; nulls are dashes', () => {
  assert.equal(gcell('svp', goalie(), false).text, '80.00%')
  assert.equal(gcell('gaa', goalie(), false).text, '3.10')
  assert.equal(gcell('gaa', goalie({ gaa: null }), false).text, '—')
  assert.equal(gcell('w', goalie({ wins: null }), false).text, '—')
})

void test('expanded values render from the expanded payload; strings keep precision', () => {
  const r = skater({
    expanded: {
      powerPlayGoals: 31,
      possessionSeconds: 144114,
      shotPct: '23.60',
    } as SkaterDisplayRow['expanded'],
  })
  assert.equal(cell('ppg', r).text, '31')
  assert.equal(cell('poss', r).text, '40:01:54')
  assert.equal(cell('poss', r, true).text, '58:35')
  assert.equal(cell('shp', r).text, '23.60%')
  assert.equal(cell('bs', r).text, '—') // field absent from payload = unavailable, not 0
})

void test('ascending defaults: skater PIM/GV; goalie L/OTL/GAA/GA', () => {
  for (const k of ['pim', 'gv']) assert.equal(SKATER_METRICS[k]?.sortAsc, true)
  for (const k of ['l', 'otl', 'gaa', 'ga']) assert.equal(GOALIE_METRICS[k]?.sortAsc, true)
  for (const k of ['pts', 'g', 'svp', 'sv']) {
    assert.ok(!(SKATER_METRICS[k]?.sortAsc ?? GOALIE_METRICS[k]?.sortAsc))
  }
})

// ─── Career TOI/GAA coverage (Phase 2 Unit C) ────────────────────────────

void test('skater TOI/GP uses toiCoverageGp for career rows; ordinary rows keep using total GP', () => {
  // Career-shaped row: total GP 210, but only 26 GP have recorded TOI.
  const career = skater({ gamesPlayed: 210, toiSeconds: 69_420, toiCoverageGp: 26 })
  // 69420 / 26 = 2670s = 44:30, NOT 69420 / 210 = 330s = 5:30
  assert.equal(cell('toigp', career).text, '44:30')

  // Ordinary row (no toiCoverageGp at all): unaffected, still divides by gamesPlayed.
  const ordinary = skater({ gamesPlayed: 41, toiSeconds: 120_240 })
  assert.equal(cell('toigp', ordinary).text, '48:53')
})

void test('skater TOI/GP annotation: complete/partial/unavailable text and marker', () => {
  const complete = skater({
    gamesPlayed: 46,
    toiSeconds: 146_880,
    toiCoverageGp: 46,
    toiCoverage: { state: 'complete', coveredGp: 46, totalGp: 46 },
  })
  const completeCell = cell('toigp', complete)
  assert.equal(completeCell.annotation?.marker, undefined)
  assert.equal(completeCell.annotation?.srText, 'Based on all 46 GP with recorded time on ice.')

  const partial = skater({
    gamesPlayed: 210,
    toiSeconds: 69_420,
    toiCoverageGp: 26,
    toiCoverage: { state: 'partial', coveredGp: 26, totalGp: 210 },
  })
  const partialCell = cell('toigp', partial)
  assert.equal(partialCell.annotation?.marker, '*')
  // `annotation` is narrowed non-undefined by the assertion above.
  assert.equal(partialCell.annotation.srText, 'Based on 26 of 210 GP with recorded time on ice.')

  const unavailable = skater({
    gamesPlayed: 21,
    toiSeconds: null,
    toiCoverageGp: 0,
    toiCoverage: { state: 'unavailable', coveredGp: 0, totalGp: 21 },
  })
  const unavailableCell = cell('toigp', unavailable)
  assert.equal(unavailableCell.text, '—')
  assert.equal(unavailableCell.annotation?.marker, undefined)
  assert.equal(
    unavailableCell.annotation?.srText,
    'No time on ice was recorded for this player’s career history.',
  )

  // Ordinary rows never carry a coverage annotation.
  assert.equal(cell('toigp', skater()).annotation, undefined)
})

void test('goalie career GAA is calculated only from same-row covered GA/TOI, with the frozen silkyjoker85 fixture', () => {
  const career = goalie({
    gamesPlayed: 210,
    gaa: '4.87', // as the corrected getAllTimeGoalieStats would return
    toiSeconds: 69_420,
    toiCoverageGp: 26,
    toiCoverage: { state: 'partial', coveredGp: 26, totalGp: 210 },
    gaaCoveredGoalsAgainst: 94,
    gaaCoverageGp: 26,
    gaaCoverage: { state: 'partial', coveredGp: 26, totalGp: 210 },
  })
  assert.equal(gcell('gaa', career).text, '4.87')
  assert.equal(gcell('toigp', career).text, '44:30')
  const gaaCell = gcell('gaa', career)
  assert.equal(gaaCell.annotation?.marker, '*')
  // `annotation` is narrowed non-undefined by the assertion above.
  assert.equal(
    gaaCell.annotation.srText,
    'Based on 26 of 210 GP with recorded time on ice and goals against.',
  )

  // Ordinary (non-career) goalie row: no coverage annotation, GAA unaffected.
  const ordinary = goalie()
  assert.equal(gcell('gaa', ordinary).text, '3.10')
  assert.equal(gcell('gaa', ordinary).annotation, undefined)
})

void test('goalie career TOI cell shows the covered-only total and its own coverage annotation', () => {
  const career = goalie({
    gamesPlayed: 210,
    toiSeconds: 69_420,
    toiCoverageGp: 26,
    toiCoverage: { state: 'partial', coveredGp: 26, totalGp: 210 },
  })
  assert.equal(gcell('toi', career).text, '19:17:00')
  assert.equal(gcell('toi', career).annotation?.marker, '*')
})

void test('every view default sort is one of its own visible columns', () => {
  for (const [views, metrics] of [
    [SKATER_VIEWS, SKATER_METRICS],
    [GOALIE_VIEWS, GOALIE_METRICS],
  ] as const) {
    for (const ex of [false, true]) {
      for (const v of resolveViews(views, metrics as never, ex)) {
        assert.ok(v.keys.includes(v.defaultSort), `${v.id} default ${v.defaultSort}`)
      }
    }
  }
})
