/**
 * Home-page Title Records: every title exactly once, newest first; live
 * (match-backed) titles from match-derived aggregates, the rest from reviewed
 * historical imports; independent of which title is selected.
 *
 * title-records.ts is pure. The selection test also runs the shared resolver,
 * which reaches `@eanhl/db/queries` (client throws at import without
 * DATABASE_URL); a closed-port placeholder is set and never dialled.
 *
 * Run: node --test apps/web/src/lib/title-records.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClubGameTitleStats } from '@eanhl/db'
import type { GameTitleListing, HistoricalClubTeamBatchRow } from '@eanhl/db/queries'
import {
  buildTitleRecords,
  loadTitleRecords,
  type LiveTitleRecordStats,
  type TitleRecordsLoaderDeps,
} from './title-records.ts'

process.env.DATABASE_URL = 'postgresql://title-records-test:unused@127.0.0.1:1/unused'

const { resolveTitle } = await import('./title-resolver.ts')

function title(
  slug: string,
  id: number,
  releaseOrder: number,
  flags: { isActive?: boolean; isDefault?: boolean; isLive?: boolean },
): GameTitleListing {
  return {
    id,
    slug,
    name: `NHL ${slug.replace(/^nhl/u, '')}`,
    eaPlatform: 'common-gen5',
    eaClubId: '19224',
    apiBaseUrl: 'https://proclubs.ea.com/api/nhl',
    isActive: flags.isActive ?? false,
    isDefault: flags.isDefault ?? false,
    releaseOrder,
    launchedAt: null,
    isLive: flags.isLive ?? false,
  }
}

function club(
  gameTitleId: number,
  gamesPlayed: number,
  wins: number,
  losses: number,
  otl: number,
): ClubGameTitleStats {
  return {
    id: gameTitleId * 10,
    gameTitleId,
    gamesPlayed,
    wins,
    losses,
    otl,
    goalsFor: gamesPlayed * 3,
    goalsAgainst: gamesPlayed * 2,
    shotsPerGame: null,
    hitsPerGame: null,
    faceoffPct: null,
    passPct: null,
    gameMode: null,
  }
}

function hist(
  gameTitleId: number,
  playlist: string,
  gamesPlayed: number,
  wins: number,
): HistoricalClubTeamBatchRow {
  return {
    gameTitleId,
    playlist,
    gamesPlayed,
    wins,
    losses: gamesPlayed - wins,
    otl: 0,
    avgGoalsFor: '3.00',
    avgGoalsAgainst: '2.00',
    avgTimeOnAttack: '08:30',
    powerPlayPct: '20.00',
    powerPlayKillPct: '80.00',
  }
}

// NHL 27 polled default; NHL 26 no longer polled but match-backed; NHL 22 archive.
const NHL27 = title('nhl27', 7, 27, { isActive: true, isDefault: true, isLive: true })
const NHL26 = title('nhl26', 1, 26, { isActive: false, isLive: true })
const NHL22 = title('nhl22', 6, 22, {})
const TITLES = [NHL26, NHL22, NHL27]

const LIVE = new Map<number, LiveTitleRecordStats>([
  [NHL27.id, { all: club(NHL27.id, 10, 6, 3, 1), sixs: club(NHL27.id, 8, 5, 2, 1), threes: null }],
  [NHL26.id, { all: club(NHL26.id, 300, 180, 100, 20), sixs: null, threes: null }],
])
// NHL 26 also has a reviewed import row: it must NOT replace or add to NHL 26's
// match-derived record.
const HIST = [hist(NHL22.id, 'eashl_6v6', 50, 30), hist(NHL26.id, 'eashl_6v6', 999, 999)]

function recordsFor(selectedSlug: string | undefined) {
  const result = resolveTitle(selectedSlug, TITLES)
  assert.equal(result.kind, 'ok')
  return buildTitleRecords(result.resolved.allTitles, LIVE, HIST)
}

function row(rows: ReturnType<typeof recordsFor>, slug: string) {
  const found = rows.find((r) => r.slug === slug)
  assert.ok(found, `${slug} row present`)
  return found
}

void test('every title appears exactly once, newest first', () => {
  const rows = recordsFor(undefined)
  assert.deepEqual(
    rows.map((r) => r.slug),
    ['nhl27', 'nhl26', 'nhl22'],
  )
})

void test('live titles use match-derived stats; archive titles use reviewed imports', () => {
  const rows = recordsFor(undefined)
  const nhl27 = row(rows, 'nhl27')
  const nhl26 = row(rows, 'nhl26')
  const nhl22 = row(rows, 'nhl22')

  assert.equal(nhl27.isLive, true)
  assert.equal(nhl27.all?.gamesPlayed, 10)
  assert.equal(nhl27.sixs?.gamesPlayed, 8)
  assert.equal(nhl27.sixsg, null)

  assert.equal(nhl26.isLive, true, 'NHL 26 stays match-backed after polling stops')
  assert.equal(nhl26.all?.gamesPlayed, 300, 'match-derived only — the import row is ignored')
  assert.equal(nhl26.sixs, null)

  assert.equal(nhl22.isLive, false)
  assert.equal(nhl22.all?.gamesPlayed, 50)
  assert.equal(nhl22.all.wins, 30)
  assert.equal(nhl22.sixs?.gamesPlayed, 50)
})

void test('selecting an archive or older title never removes the match-backed titles', () => {
  const byDefault = recordsFor(undefined)
  assert.deepEqual(recordsFor('nhl22'), byDefault)
  assert.deepEqual(recordsFor('nhl26'), byDefault)
})

// ─── loadTitleRecords: the whole dataset is required, failure is isolated ───

function workingDeps(): TitleRecordsLoaderDeps {
  return {
    getLiveStats: (titleId: number) =>
      Promise.resolve(LIVE.get(titleId) ?? { all: null, sixs: null, threes: null }),
    getArchiveRows: () => Promise.resolve(HIST),
  }
}

void test('loadTitleRecords: successful loading stays ready and matches buildTitleRecords directly', async () => {
  const result = await loadTitleRecords(TITLES, workingDeps())
  assert.equal(result.status, 'ok')
  assert.deepEqual(
    result.status === 'ok' ? result.rows : null,
    buildTitleRecords(TITLES, LIVE, HIST),
  )
})

void test('loadTitleRecords: a rejected live-title query (any title, not just the selected one) yields unavailable — no throw, no partial rows', async () => {
  const errors: unknown[] = []
  // Called directly, with no try/catch around it: if the implementation let
  // the rejection propagate instead of catching it, this test would fail with
  // an unhandled rejection rather than reaching the assertions below.
  const result = await loadTitleRecords(TITLES, {
    ...workingDeps(),
    getLiveStats: (titleId: number) =>
      titleId === NHL26.id
        ? Promise.reject(new Error('EA fetch failed for a comparison title'))
        : Promise.resolve(LIVE.get(titleId) ?? { all: null, sixs: null, threes: null }),
    onError: (error) => errors.push(error),
  })
  assert.deepEqual(result, { status: 'unavailable' })
  assert.equal(errors.length, 1)
})

void test('loadTitleRecords: a rejected archive batch query yields unavailable — no throw, no partial rows', async () => {
  const result = await loadTitleRecords(TITLES, {
    ...workingDeps(),
    getArchiveRows: () => Promise.reject(new Error('historical batch query failed')),
  })
  assert.deepEqual(result, { status: 'unavailable' })
})

void test('loadTitleRecords: a genuinely empty dataset is ready, distinct from a failed one', async () => {
  const result = await loadTitleRecords(TITLES, {
    getLiveStats: () => Promise.resolve({ all: null, sixs: null, threes: null }),
    getArchiveRows: () => Promise.resolve([]),
  })
  assert.equal(result.status, 'ok')
  assert.notDeepEqual(result, { status: 'unavailable' })
  if (result.status === 'ok') {
    assert.equal(result.rows.length, TITLES.length, 'every title still gets a row')
    for (const row of result.rows) assert.equal(row.all, null, 'empty is null cells, not dropped rows')
  }
})
