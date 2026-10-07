/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/cards/card-model.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBadgeShowcase,
  buildLast10,
  buildLedger,
  cardStats,
  formatGaa,
  formatRecord,
  formatSavePct,
  formatWinPct,
  positionTag,
  type CardCareerRow,
  type CardGame,
  type CardSeasonTotals,
} from './card-model.ts'

const totals: CardSeasonTotals = {
  skaterGp: 68,
  goalieGp: 15,
  goals: 65,
  assists: 65,
  points: 130,
  goalieWins: 8,
  savePct: '81.20',
  gaa: '3.4',
}

void test('record and win % (prototype rounding, dash when unknown)', () => {
  assert.equal(formatRecord(35, 30, 3), '35–30–3')
  assert.equal(formatRecord(35, 30, null), '35–30–0')
  assert.equal(formatRecord(null, 30, 3), '—')
  assert.equal(formatWinPct(35, 30, 3), '51% Win')
  assert.equal(formatWinPct(0, 0, 0), '—')
  assert.equal(formatWinPct(null, 2, 0), '—')
})

void test('save % shows hockey style; GAA two decimals', () => {
  assert.equal(formatSavePct('81.20'), '.812')
  assert.equal(formatSavePct('0.9'), '.900')
  assert.equal(formatSavePct('100.00'), '1.000')
  assert.equal(formatSavePct(null), '—')
  assert.equal(formatSavePct('n/a'), '—')
  assert.equal(formatGaa('3.4'), '3.40')
  assert.equal(formatGaa(null), '—')
})

void test('front stats: skater GP G A PTS, goalie GP SV% GAA W (last = lead)', () => {
  assert.deepEqual(
    cardStats('skater', totals).map((s) => `${s.label}=${s.value}`),
    ['GP=68', 'G=65', 'A=65', 'PTS=130'],
  )
  assert.deepEqual(
    cardStats('goalie', totals).map((s) => `${s.label}=${s.value}`),
    ['GP=15', 'SV%=.812', 'GAA=3.40', 'W=8'],
  )
  assert.deepEqual(
    cardStats('goalie', { ...totals, goalieWins: null, savePct: null, gaa: null }).map(
      (s) => s.value,
    ),
    ['15', '—', '—', '—'],
  )
})

void test('position tags follow the site labels', () => {
  assert.equal(positionTag('leftWing'), 'LW')
  assert.equal(positionTag('defenseMen'), 'D')
  assert.equal(positionTag('goalie'), 'G')
  assert.equal(positionTag(null), null)
})

const game = (partial: Partial<CardGame>): CardGame => ({
  result: 'WIN',
  isGoalie: false,
  goals: 0,
  assists: 0,
  saves: null,
  goalsAgainst: null,
  ...partial,
})

void test('last 10 (skater): role games only, newest 10, sums G A PTS', () => {
  const games = [
    game({ goals: 2, assists: 1 }),
    game({ isGoalie: true, saves: 20, goalsAgainst: 2 }),
    ...Array.from({ length: 11 }, () => game({ goals: 1, assists: 0 })),
  ]
  assert.deepEqual(buildLast10(games, 'skater'), { gp: 10, cells: ['10', '11', '1', '12'] })
})

void test('last 10 (goalie): record counts DNF as a loss; SV% = saves / (saves + GA); shutout = win with 0 GA', () => {
  const games = [
    game({ isGoalie: true, result: 'WIN', saves: 30, goalsAgainst: 0 }),
    game({ isGoalie: true, result: 'LOSS', saves: 20, goalsAgainst: 4 }),
    game({ isGoalie: true, result: 'DNF', saves: 10, goalsAgainst: 2 }),
    game({ isGoalie: true, result: 'OTL', saves: 25, goalsAgainst: 3 }),
    game({ goals: 5 }),
  ]
  assert.deepEqual(buildLast10(games, 'goalie'), {
    gp: 4,
    cells: ['4', '1–2–1', '.904', '2.25', '1'],
  })
})

void test('last 10 with no games in the role shows dashes', () => {
  assert.deepEqual(buildLast10([], 'skater'), { gp: 0, cells: ['0', '—', '—', '—'] })
  assert.deepEqual(buildLast10([], 'goalie'), { gp: 0, cells: ['0', '—', '—', '—', '—'] })
})

const career = (partial: Partial<CardCareerRow>): CardCareerRow => ({
  gameTitleId: 7,
  gameTitleName: 'NHL 27',
  skaterGp: 0,
  goals: 0,
  assists: 0,
  points: 0,
  goalieGp: 0,
  wins: null,
  losses: null,
  otl: null,
  savePct: null,
  gaa: null,
  shutouts: null,
  ...partial,
})

void test('skater ledger: LAST 10, current title, CAREER total when 2+ titles', () => {
  const rows = [
    career({
      gameTitleId: 7,
      gameTitleName: 'NHL 27',
      skaterGp: 68,
      goals: 65,
      assists: 65,
      points: 130,
    }),
    career({
      gameTitleId: 6,
      gameTitleName: 'NHL 26',
      skaterGp: 54,
      goals: 41,
      assists: 38,
      points: 79,
    }),
  ]
  const ledger = buildLedger('skater', { gp: 10, cells: ['10', '9', '8', '17'] }, rows, 7)
  assert.deepEqual(ledger.head, ['', 'GP', 'G', 'A', 'PTS'])
  assert.equal(ledger.leadCol, 4)
  assert.deepEqual(
    ledger.rows.map((r) => [r.label, ...r.cells].join(' ')),
    ['LAST 10 10 9 8 17', 'NHL 27 68 65 65 130', 'CAREER 122 106 103 209'],
  )
})

void test('skater ledger with a single title has no CAREER row; missing current title falls back to the newest', () => {
  const rows = [
    career({
      gameTitleId: 7,
      gameTitleName: 'NHL 27',
      skaterGp: 5,
      goals: 1,
      assists: 2,
      points: 3,
    }),
  ]
  assert.deepEqual(
    buildLedger('skater', { gp: 5, cells: ['5', '1', '2', '3'] }, rows, 99).rows.map(
      (r) => r.label,
    ),
    ['LAST 10', 'NHL 27'],
  )
})

void test('goalie ledger: LAST 10 and current title (GP REC SV% GAA SO)', () => {
  const rows = [
    career({
      goalieGp: 15,
      wins: 8,
      losses: 6,
      otl: 1,
      savePct: '81.20',
      gaa: '3.40',
      shutouts: 1,
    }),
  ]
  const ledger = buildLedger(
    'goalie',
    { gp: 4, cells: ['4', '1–2–1', '.904', '2.25', '1'] },
    rows,
    7,
  )
  assert.deepEqual(ledger.head, ['', 'GP', 'REC', 'SV%', 'GAA', 'SO'])
  assert.equal(ledger.leadCol, 3)
  assert.deepEqual(
    ledger.rows.map((r) => [r.label, ...r.cells].join(' ')),
    ['LAST 10 4 1–2–1 .904 2.25 1', 'NHL 27 15 8–6–1 .812 3.40 1'],
  )
})

void test('badge showcase: earned count and top 4 within the role pool', () => {
  const badges = [
    { familyId: 'pgoals' as const, level: 15 },
    { familyId: 'phits' as const, level: 14 },
    { familyId: 'gsv' as const, level: 20 },
    { familyId: 'pasts' as const, level: 9 },
    { familyId: 'pwins' as const, level: 15 },
    { familyId: 'pblk' as const, level: 2 },
    { familyId: 'pfight' as const, level: 0 },
  ]
  const skater = buildBadgeShowcase(badges, 'skater')
  assert.equal(skater.earned, 5)
  assert.equal(skater.pool, 15)
  assert.deepEqual(
    skater.top.map((b) => b.familyId),
    ['pwins', 'pgoals', 'phits', 'pasts'],
  )
  const goalie = buildBadgeShowcase(badges, 'goalie')
  assert.deepEqual([goalie.earned, goalie.pool, goalie.top.length], [1, 6, 1])
})
