/**
 * Unit tests for Career Team Stats logic. Pure functions, no React/DOM.
 *
 * Tested hardest: source separation (live and archive never merge), null
 * propagation (no coercion to 0), nulls-last sorting in both directions,
 * numeric (not lexical) ordering, and explicit playlist families.
 *
 * Run: node --test apps/web/src/lib/team-history.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregate,
  aggregateBySource,
  archiveRowToTeamHistoryInput,
  buildGroups,
  filterRows,
  formatGoalDiff,
  formatRecord,
  formatToa,
  listFamilies,
  listTitles,
  loadTeamHistory,
  nextSort,
  parseToaSeconds,
  playlistFamily,
  sortRows,
  toTeamHistoryRow,
  type TeamHistoryInput,
  type TeamHistoryLoaderDeps,
  type TeamHistoryRow,
} from './team-history.ts'

function input(overrides: Partial<TeamHistoryInput> = {}): TeamHistoryInput {
  return {
    gameTitleId: 2,
    titleName: 'NHL 25',
    source: 'archive',
    playlist: 'eashl_6v6',
    gamesPlayed: 89,
    wins: 53,
    losses: 34,
    otl: 2,
    avgGoalsFor: '3.30',
    avgGoalsAgainst: '2.80',
    avgTimeOnAttack: '07:06',
    powerPlayPct: '21.70',
    powerPlayKillPct: '80.10',
    ...overrides,
  }
}

function row(overrides: Partial<TeamHistoryInput> = {}): TeamHistoryRow {
  return toTeamHistoryRow(input(overrides))
}

void test('parseToaSeconds: accepts live M:SS and archive MM:SS, rejects junk', () => {
  assert.equal(parseToaSeconds('9:07'), 547)
  assert.equal(parseToaSeconds('08:42'), 522)
  assert.equal(parseToaSeconds('00:47'), 47)
  assert.equal(parseToaSeconds(null), null)
  assert.equal(parseToaSeconds(''), null)
  assert.equal(parseToaSeconds('9:7'), null)
  assert.equal(parseToaSeconds('abc'), null)
})

void test('formatToa / formatGoalDiff: shape and missing glyph', () => {
  assert.equal(formatToa(547), '9:07')
  assert.equal(formatToa(null), '—')
  assert.equal(formatGoalDiff(0.5), '+0.50')
  assert.equal(formatGoalDiff(-0.35), '−0.35')
  assert.equal(formatGoalDiff(0.001), '0.00')
  assert.equal(formatGoalDiff(null), '—')
})

void test('playlistFamily: era slugs collapse; Threes and Quickplay stay separate; unknown is its own family', () => {
  assert.equal(playlistFamily('eashl_6v6').key, playlistFamily('clubs_6v6').key)
  assert.equal(playlistFamily('6_player_full_team').key, playlistFamily('clubs_6_players').key)
  assert.equal(playlistFamily('eashl_3v3').key, playlistFamily('clubs_3v3').key)
  const keys = new Set(
    ['eashl_6v6', '6_player_full_team', 'eashl_3v3', 'threes', 'quickplay_3v3'].map(
      (p) => playlistFamily(p).key,
    ),
  )
  assert.equal(keys.size, 5)
  assert.notEqual(playlistFamily('quickplay_3v3').key, playlistFamily('eashl_3v3').key)
  assert.notEqual(playlistFamily('threes').key, playlistFamily('eashl_3v3').key)
  const unknown = playlistFamily('brand_new_mode')
  assert.equal(unknown.key, 'other:brand_new_mode')
  assert.equal(unknown.label, 'brand_new_mode')
})

void test('toTeamHistoryRow: parses strings, derives W% and GD/G, keeps missing as null', () => {
  const r = row()
  assert.equal(r.gfg, 3.3)
  assert.ok(r.gdg !== null && Math.abs(r.gdg - 0.5) < 1e-9)
  assert.ok(r.wpct !== null && Math.abs(r.wpct - (53 / 89) * 100) < 1e-9)
  assert.equal(r.toaSeconds, 426)

  const missing = row({ powerPlayPct: null, avgGoalsAgainst: null, wins: null })
  assert.equal(missing.pp, null)
  assert.equal(missing.gdg, null)
  assert.equal(missing.wpct, null)
  assert.equal(missing.w, null)
})

// ─── archiveRowToTeamHistoryInput: locked-title archive mapping ──────────────

function archiveQueryRow(
  overrides: Partial<Omit<TeamHistoryInput, 'gameTitleId' | 'titleName' | 'source'>> = {},
) {
  return {
    playlist: 'eashl_6v6',
    gamesPlayed: 89,
    wins: 53,
    losses: 34,
    otl: 2,
    avgGoalsFor: '3.30',
    avgGoalsAgainst: '2.80',
    avgTimeOnAttack: '07:06',
    powerPlayPct: '21.70',
    powerPlayKillPct: '80.10',
    ...overrides,
  }
}

void test('archiveRowToTeamHistoryInput: maps a fully-populated row, tags it archive, takes id/name from the title argument', () => {
  const mapped = archiveRowToTeamHistoryInput(archiveQueryRow(), { id: 6, name: 'NHL 22' })
  assert.deepEqual(mapped, {
    gameTitleId: 6,
    titleName: 'NHL 22',
    source: 'archive',
    playlist: 'eashl_6v6',
    gamesPlayed: 89,
    wins: 53,
    losses: 34,
    otl: 2,
    avgGoalsFor: '3.30',
    avgGoalsAgainst: '2.80',
    avgTimeOnAttack: '07:06',
    powerPlayPct: '21.70',
    powerPlayKillPct: '80.10',
  })
})

void test('archiveRowToTeamHistoryInput: null GP/W/L/OTL stay null — never coerced to 0', () => {
  const mapped = archiveRowToTeamHistoryInput(
    archiveQueryRow({ gamesPlayed: null, wins: null, losses: null, otl: null }),
    { id: 6, name: 'NHL 22' },
  )
  assert.equal(mapped.gamesPlayed, null)
  assert.equal(mapped.wins, null)
  assert.equal(mapped.losses, null)
  assert.equal(mapped.otl, null)
})

void test('archiveRowToTeamHistoryInput: null rate/average fields stay null', () => {
  const mapped = archiveRowToTeamHistoryInput(
    archiveQueryRow({
      avgGoalsFor: null,
      avgGoalsAgainst: null,
      avgTimeOnAttack: null,
      powerPlayPct: null,
      powerPlayKillPct: null,
    }),
    { id: 6, name: 'NHL 22' },
  )
  assert.equal(mapped.avgGoalsFor, null)
  assert.equal(mapped.avgGoalsAgainst, null)
  assert.equal(mapped.avgTimeOnAttack, null)
  assert.equal(mapped.powerPlayPct, null)
  assert.equal(mapped.powerPlayKillPct, null)
})

void test('archiveRowToTeamHistoryInput: a null W/L/OTL still nulls winPct/formatRecord end to end through toTeamHistoryRow/aggregate', () => {
  const mapped = archiveRowToTeamHistoryInput(archiveQueryRow({ otl: null }), {
    id: 6,
    name: 'NHL 22',
  })
  const r = toTeamHistoryRow(mapped)
  assert.equal(r.otl, null)
  assert.equal(r.wpct, null)
  assert.equal(formatRecord(r.w, r.l, r.otl), '—')

  const agg = aggregate([r])
  assert.equal(agg.otl, null)
  assert.equal(agg.wpct, null)
  assert.equal(formatRecord(agg.w, agg.l, agg.otl), '—')
})

void test('aggregate: exact sums, GP-weighted averages flagged approximate, null propagates', () => {
  const a = row({
    playlist: 'eashl_6v6',
    gamesPlayed: 90,
    wins: 50,
    losses: 40,
    otl: 0,
    avgGoalsFor: '3.00',
    avgGoalsAgainst: '2.00',
  })
  const b = row({
    playlist: 'eashl_3v3',
    gamesPlayed: 10,
    wins: 5,
    losses: 4,
    otl: 1,
    avgGoalsFor: '4.00',
    avgGoalsAgainst: '3.00',
  })
  const agg = aggregate([a, b])
  assert.equal(agg.gp, 100)
  assert.equal(agg.w, 55)
  assert.equal(agg.l, 44)
  assert.equal(agg.otl, 1)
  assert.ok(agg.wpct !== null && Math.abs(agg.wpct - 55) < 1e-9)
  assert.ok(agg.gfg !== null && Math.abs(agg.gfg - 3.1) < 1e-9)
  assert.ok(agg.gdg !== null && Math.abs(agg.gdg - 1.0) < 1e-9)
  assert.equal(agg.averagesApproximate, true)

  // A single row is the source's own figure, not an approximation.
  assert.equal(aggregate([a]).averagesApproximate, false)

  // One missing component nulls the aggregate instead of being treated as 0.
  const holey = aggregate([a, row({ wins: null, gamesPlayed: 5 })])
  assert.equal(holey.w, null)
  assert.equal(holey.wpct, null)
  const noAvg = aggregate([a, row({ avgGoalsFor: null })])
  assert.equal(noAvg.gfg, null)
  assert.equal(noAvg.gdg, null)
})

void test('aggregateBySource: live and archive are never merged', () => {
  const live = row({
    source: 'live',
    gameTitleId: 7,
    titleName: 'NHL 27',
    gamesPlayed: 10,
    wins: 6,
    losses: 4,
    otl: 0,
  })
  const arch = row({ gamesPlayed: 20, wins: 10, losses: 10, otl: 0 })
  const out = aggregateBySource([arch, live])
  assert.deepEqual(
    out.map((s) => s.source),
    ['live', 'archive'],
  )
  assert.equal(out[0]?.aggregate.gp, 10)
  assert.equal(out[1]?.aggregate.gp, 20)
  assert.deepEqual(aggregateBySource([]), [])
})

void test('sortRows: numeric not lexical, missing last in both directions', () => {
  const rows = [
    row({ playlist: 'eashl_6v6', gamesPlayed: 9 }),
    row({ playlist: 'eashl_3v3', gamesPlayed: 111 }),
    row({ playlist: 'threes', gamesPlayed: 21, powerPlayPct: null }),
    row({ playlist: 'clubs_6v6', gamesPlayed: 100, powerPlayPct: '5.00' }),
  ]
  const gpDesc = sortRows(rows, { key: 'gp', dir: 'desc' }, 'title').map((r) => r.gp)
  assert.deepEqual(gpDesc, [111, 100, 21, 9]) // lexical would put 9 first
  const gpAsc = sortRows(rows, { key: 'gp', dir: 'asc' }, 'title').map((r) => r.gp)
  assert.deepEqual(gpAsc, [9, 21, 100, 111])

  for (const dir of ['asc', 'desc'] as const) {
    const pp = sortRows(rows, { key: 'pp', dir }, 'title').map((r) => r.pp)
    assert.equal(pp[pp.length - 1], null, `null last (${dir})`)
    assert.equal(pp.filter((v) => v === null).length, 1)
  }

  // TOA sorts by seconds, so 10:08 (608s) beats 9:07 (547s) despite the string order.
  const toa = sortRows(
    [row({ avgTimeOnAttack: '9:07' }), row({ playlist: 'eashl_3v3', avgTimeOnAttack: '10:08' })],
    { key: 'toa', dir: 'desc' },
    'title',
  ).map((r) => r.toaSeconds)
  assert.deepEqual(toa, [608, 547])
})

void test('nextSort: first direction → opposite → cleared', () => {
  const s1 = nextSort(null, 'gp')
  assert.deepEqual(s1, { key: 'gp', dir: 'desc' })
  const s2 = nextSort(s1, 'gp')
  assert.deepEqual(s2, { key: 'gp', dir: 'asc' })
  assert.equal(nextSort(s2, 'gp'), null)
  assert.deepEqual(nextSort(null, 'label'), { key: 'label', dir: 'asc' })
  assert.deepEqual(nextSort({ key: 'gp', dir: 'asc' }, 'wpct'), { key: 'wpct', dir: 'desc' })
})

void test('filter / list / group: titles newest first, families in fixed order, mixed-source groups split subtotals', () => {
  const rows = [
    row({ source: 'live', gameTitleId: 7, titleName: 'NHL 27', playlist: 'eashl_6v6' }),
    row({ source: 'live', gameTitleId: 1, titleName: 'NHL 26', playlist: 'eashl_3v3' }),
    row({ titleName: 'NHL 25', playlist: 'threes' }),
    row({ titleName: 'NHL 25', playlist: 'eashl_6v6' }),
    row({ gameTitleId: 6, titleName: 'NHL 22', playlist: 'clubs_6v6' }),
  ]
  assert.deepEqual(listTitles(rows), ['NHL 27', 'NHL 26', 'NHL 25', 'NHL 22'])
  assert.deepEqual(
    listFamilies(rows).map((f) => f.key),
    ['6v6', '3v3', 'threes'],
  )
  assert.equal(filterRows(rows, 'NHL 25', null).length, 2)
  assert.equal(filterRows(rows, null, '6v6').length, 3)
  assert.equal(filterRows(rows, 'NHL 25', '6v6').length, 1)

  const byTitle = buildGroups(rows, 'title', null)
  assert.deepEqual(
    byTitle.map((g) => g.label),
    ['NHL 27', 'NHL 26', 'NHL 25', 'NHL 22'],
  )
  const newest = byTitle[0]
  assert.ok(newest)
  assert.equal(newest.hasLive, true)
  assert.equal(newest.subtotals.length, 1)

  const byPlaylist = buildGroups(rows, 'playlist', null)
  const sixes = byPlaylist.find((g) => g.label === '6v6')
  assert.ok(sixes)
  assert.deepEqual(
    sixes.subtotals.map((s) => s.source),
    ['live', 'archive'],
  )
  // Rows inside a playlist group run newest title first.
  assert.deepEqual(
    sixes.rows.map((r) => r.titleName),
    ['NHL 27', 'NHL 25', 'NHL 22'],
  )
})

// ─── loadTeamHistory: failure path ────────────────────────────────────────────

type QueryRow = Awaited<ReturnType<TeamHistoryLoaderDeps['getLiveRows']>>[number]

function queryRow(gameTitleId: number, playlist = 'eashl_6v6'): QueryRow {
  return {
    gameTitleId,
    playlist,
    gamesPlayed: 10,
    wins: 5,
    losses: 4,
    otl: 1,
    avgGoalsFor: '3.00',
    avgGoalsAgainst: '2.00',
    avgTimeOnAttack: '8:00',
    powerPlayPct: null,
    powerPlayKillPct: null,
  }
}

function loaderDeps(overrides: Partial<TeamHistoryLoaderDeps> = {}): TeamHistoryLoaderDeps {
  return {
    activeTitles: [
      { id: 1, name: 'NHL 26' },
      { id: 7, name: 'NHL 27' },
    ],
    listArchiveTitles: () => Promise.resolve([{ id: 2, name: 'NHL 25' }]),
    getLiveRows: (id) => Promise.resolve([queryRow(id)]),
    getArchiveRows: (ids) => Promise.resolve(ids.map((id) => queryRow(id))),
    ...overrides,
  }
}

void test('loadTeamHistory: all queries succeed → live rows for every active title + archive rows, tagged', async () => {
  const load = await loadTeamHistory(loaderDeps())
  assert.equal(load.status, 'ok')
  assert.deepEqual(
    load.rows.map((r) => [r.titleName, r.source]),
    [
      ['NHL 26', 'live'],
      ['NHL 27', 'live'],
      ['NHL 25', 'archive'],
    ],
  )
})

void test('loadTeamHistory: a failed active-title query → unavailable, no partial rows', async () => {
  const errors: unknown[] = []
  const load = await loadTeamHistory(
    loaderDeps({
      getLiveRows: (id) =>
        id === 7 ? Promise.reject(new Error('live 7 down')) : Promise.resolve([queryRow(id)]),
      onError: (e) => errors.push(e),
    }),
  )
  assert.deepEqual(load, { status: 'unavailable' })
  assert.equal(errors.length, 1)
})

void test('loadTeamHistory: a failed archive rows query → unavailable', async () => {
  const load = await loadTeamHistory(
    loaderDeps({ getArchiveRows: () => Promise.reject(new Error('archive down')) }),
  )
  assert.deepEqual(load, { status: 'unavailable' })
})

void test('loadTeamHistory: a failed archive title list → unavailable', async () => {
  const load = await loadTeamHistory(
    loaderDeps({ listArchiveTitles: () => Promise.reject(new Error('titles down')) }),
  )
  assert.deepEqual(load, { status: 'unavailable' })
})

void test('loadTeamHistory: an empty archive title list is a valid result, not a failure', async () => {
  let archiveCalls = 0
  const load = await loadTeamHistory(
    loaderDeps({
      listArchiveTitles: () => Promise.resolve([]),
      getArchiveRows: () => {
        archiveCalls += 1
        return Promise.resolve([])
      },
    }),
  )
  assert.equal(load.status, 'ok')
  assert.equal(load.rows.length, 2)
  assert.equal(archiveCalls, 0)
})

void test('loadTeamHistory: no data anywhere is ok with zero rows (distinct from unavailable)', async () => {
  const load = await loadTeamHistory(
    loaderDeps({ activeTitles: [], listArchiveTitles: () => Promise.resolve([]) }),
  )
  assert.deepEqual(load, { status: 'ok', rows: [] })
})
