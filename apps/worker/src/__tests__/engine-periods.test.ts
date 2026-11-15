/**
 * Engine period import (task P1): parser, score check and replace rules, against an
 * in-memory store. No database, no Docker.
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/__tests__/engine-periods.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ENGINE_VIDEO_SOURCE,
  FIELDS,
  formatTable,
  importFolder,
  parseEnginePeriodsFile,
  processParsed,
  type EnginePeriodRowValues,
  type FolderEntry,
  type MatchRef,
  type PeriodStore,
} from '../lib/engine-periods.js'

// ─── An in-memory store that mimics the real one ──────────────────────────────

interface StoredRow extends EnginePeriodRowValues {
  matchId: number
  source: string
  goalsStatus: string
  shotsStatus: string
}

class FakeStore implements PeriodStore {
  rows: StoredRow[] = []
  writes = 0
  constructor(public matches: Record<string, MatchRef>) {}
  findMatch(slug: string, eaMatchId: string) {
    if (slug !== 'nhl27') return Promise.resolve({ titleKnown: false, match: null })
    return Promise.resolve({ titleKnown: true, match: this.matches[eaMatchId] ?? null })
  }
  getEngineRows(matchId: number) {
    return Promise.resolve(
      this.rows
        .filter((r) => r.matchId === matchId && r.source === ENGINE_VIDEO_SOURCE)
        .map((r) => ({
          ...r,
          reviewed:
            r.goalsStatus === 'reviewed' &&
            (r.shotsStatus === 'reviewed' || (r.shotsFor === null && r.shotsAgainst === null)),
        })),
    )
  }
  replaceEngineRows(matchId: number, rows: EnginePeriodRowValues[]) {
    this.writes++
    const before = this.rows.length
    this.rows = this.rows.filter(
      (r) => !(r.matchId === matchId && r.source === ENGINE_VIDEO_SOURCE),
    )
    const deleted = before - this.rows.length
    for (const r of rows) {
      this.rows.push({
        ...r,
        matchId,
        source: ENGINE_VIDEO_SOURCE,
        goalsStatus: 'reviewed',
        shotsStatus: r.shotsFor !== null && r.shotsAgainst !== null ? 'reviewed' : 'pending_review',
      })
    }
    return Promise.resolve({ deleted, inserted: rows.length })
  }
}

const match = (
  id: number,
  scoreFor: number,
  scoreAgainst: number,
  extra: Partial<MatchRef> = {},
): MatchRef => ({
  id,
  scoreFor,
  scoreAgainst,
  shotsFor: 20,
  shotsAgainst: 20,
  result: 'WIN',
  bgmWasHome: false,
  ...extra,
})

/** A valid file in the real engine shape: periods are [goalsBm, goalsOpp, shotsBm, shotsOpp]. */
function file(
  eaMatchId: string,
  periods: [number, number, number | null, number | null][],
  final: [number, number],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    game_title: 'nhl27',
    ea_match_id: eaMatchId,
    recording: '2026-11-13_20-01-34',
    game: 'game-03',
    our_side: 'away',
    our_abbr: 'BM',
    opp_abbr: 'OPP',
    final: { bm: final[0], opp: final[1] },
    end_of_game_check: 'pass',
    periods: periods.map((p, i) => ({
      period: i + 1,
      goals_bm: p[0],
      goals_opp: p[1],
      shots_bm: p[2],
      shots_opp: p[3],
    })),
    goals: [],
    source_commit: 'abc1234',
    source_commit_basis: 'main at the run start (estimated)',
    source_run: 'out/club-1113',
    exported_at: '2026-11-15T00:55:20Z',
    complete: true,
    ...extra,
  }
}

const GOOD = (): Record<string, unknown> =>
  file(
    '111',
    [
      [2, 1, 4, 6],
      [1, 1, 4, 6],
      [2, 1, 4, 6],
    ],
    [5, 3],
  )

function run(store: PeriodStore, raw: unknown, apply: boolean, expected?: string) {
  return processParsed('f.json', parseEnginePeriodsFile(raw), store, {
    apply,
    expectedEaMatchId: expected ?? null,
  })
}

// ─── Parser ───────────────────────────────────────────────────────────────────

void test('parses a valid file', () => {
  const r = parseEnginePeriodsFile(GOOD())
  assert.equal(r.kind, 'ok')
  if (r.kind !== 'ok') return
  assert.equal(r.file.periods.length, 3)
  assert.equal(r.file.eaMatchId, '111')
  assert.deepEqual(r.file.periods[0], {
    period: 1,
    goalsFor: 2,
    goalsAgainst: 1,
    shotsFor: 4,
    shotsAgainst: 6,
  })
})

void test('an unknown schema_version is refused', () => {
  const r = parseEnginePeriodsFile({ ...GOOD(), schema_version: 2 })
  assert.equal(r.kind, 'invalid')
  const r0 = parseEnginePeriodsFile({ ...GOOD(), schema_version: '1' })
  assert.equal(r0.kind, 'invalid')
})

void test('an incomplete file is skipped, not parsed further', () => {
  const r = parseEnginePeriodsFile({ ...GOOD(), complete: false, periods: 'garbage' })
  assert.equal(r.kind, 'incomplete')
})

void test('strict: bad types, a missing field, a period gap and a duplicate are refused', () => {
  const bad = (patch: Record<string, unknown>) =>
    parseEnginePeriodsFile({ ...GOOD(), ...patch }).kind
  assert.equal(bad({ complete: 'yes' }), 'invalid')
  assert.equal(bad({ game_title: undefined }), 'invalid')
  assert.equal(bad({ ea_match_id: 'abc' }), 'invalid')
  assert.equal(bad({ our_side: 'left' }), 'invalid')
  assert.equal(bad({ source_commit: '' }), 'invalid')
  assert.equal(bad({ final: { bm: '5', opp: 3 } }), 'invalid')
  assert.equal(bad({ periods: [] }), 'invalid')
  assert.equal(bad({ end_of_game_check: false }), 'invalid')
  const p = (n: number, g: number) => ({
    period: n,
    goals_bm: g,
    goals_opp: 0,
    shots_bm: 3,
    shots_opp: 3,
  })
  assert.equal(bad({ periods: [p(1, 1), p(3, 1)] }), 'invalid') // gap
  assert.equal(bad({ periods: [p(1, 1), p(1, 1)] }), 'invalid') // duplicate
  assert.equal(bad({ periods: [p(0, 1)] }), 'invalid')
  assert.equal(bad({ periods: [p(7, 1)] }), 'invalid')
  const q = (patch: Record<string, unknown>) => ({
    period: 1,
    goals_bm: 1,
    goals_opp: 0,
    shots_bm: 3,
    shots_opp: 3,
    ...patch,
  })
  assert.equal(bad({ periods: [q({ goals_bm: -1 })] }), 'invalid')
  assert.equal(bad({ periods: [q({ goals_bm: 1.5 })] }), 'invalid')
  assert.equal(bad({ periods: [q({ goals_opp: null })] }), 'invalid') // goals are never null
  assert.equal(bad({ periods: [q({ shots_bm: 'x' })] }), 'invalid')
  assert.equal(bad({ periods: [q({ shots_opp: undefined })] }), 'invalid') // key missing
  assert.equal(bad({ end_of_game_check: 'fail' }), 'invalid')
  assert.equal(bad({ game: { a: 1 } }), 'invalid')
})

void test('a numeric ea_match_id is accepted and kept as text', () => {
  const r = parseEnginePeriodsFile({ ...GOOD(), ea_match_id: 3900836070187 })
  assert.equal(r.kind === 'ok' && r.file.eaMatchId, '3900836070187')
})

void test('the wire names live in FIELDS (one place to rename)', () => {
  assert.equal(FIELDS.schemaVersion, 'schema_version')
  assert.equal(FIELDS.eaMatchId, 'ea_match_id')
})

// ─── Score check, refusal, writes ─────────────────────────────────────────────

void test('period goals that match EA final are written (apply) with both sides right', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const out = await run(store, GOOD(), true)
  assert.equal(out.action, 'insert')
  assert.equal(out.inserted, 3)
  assert.equal(store.rows.length, 3)
  assert.deepEqual(
    store.rows.map((r) => [
      r.periodNumber,
      r.periodLabel,
      r.goalsFor,
      r.goalsAgainst,
      r.shotsFor,
      r.shotsAgainst,
    ]),
    [
      [1, '1st', 2, 1, 4, 6],
      [2, '2nd', 1, 1, 4, 6],
      [3, '3rd', 2, 1, 4, 6],
    ],
  )
})

void test('score-sum refusal: period goals differ from EA final, nothing written', async () => {
  for (const ea of [match(7, 5, 4), match(7, 4, 3), match(7, 3, 5)]) {
    const store = new FakeStore({ '111': ea })
    const out = await run(store, GOOD(), true)
    assert.equal(out.action, 'refused')
    assert.match(out.reason, /do not add up/)
    assert.equal(store.writes, 0)
    assert.equal(store.rows.length, 0)
  }
})

void test('refused when the file final contradicts its own periods, even if EA agrees with the periods', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const out = await run(store, { ...GOOD(), final: { bm: 6, opp: 3 } }, true)
  assert.equal(out.action, 'refused')
  assert.equal(store.writes, 0)
})

void test('refused: unknown schema, invalid, no such match, unknown title, wrong file name', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  assert.equal((await run(store, { ...GOOD(), schema_version: 9 }, true)).action, 'refused')
  assert.equal((await run(store, 'nope', true)).action, 'refused')
  assert.equal((await run(store, { ...GOOD(), ea_match_id: '222' }, true)).action, 'refused')
  assert.equal((await run(store, { ...GOOD(), game_title: 'nhl99' }, true)).action, 'refused')
  assert.equal((await run(store, GOOD(), true, '999')).action, 'refused')
  assert.equal(store.writes, 0)
})

void test('incomplete file is skipped and never written', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const out = await run(store, { ...GOOD(), complete: false }, true)
  assert.equal(out.action, 'skipped')
  assert.equal(store.writes, 0)
})

void test('dry run writes nothing but reports what it would do', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const out = await run(store, GOOD(), false)
  assert.equal(out.action, 'insert')
  assert.match(out.reason, /dry run/)
  assert.equal(store.writes, 0)
  assert.equal(store.rows.length, 0)
})

void test('idempotent: a re-run with the same file does not write or duplicate', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  await run(store, GOOD(), true)
  const again = await run(store, GOOD(), true)
  assert.equal(again.action, 'unchanged')
  assert.equal(store.writes, 1)
  assert.equal(store.rows.length, 3)
})

void test('a changed file replaces the same match rows, no duplicates', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  await run(store, GOOD(), true)
  const changed = file(
    '111',
    [
      [2, 1, 5, 6],
      [1, 1, 4, 6],
      [2, 1, 4, 6],
    ],
    [5, 3],
  )
  const out = await run(store, changed, true)
  assert.equal(out.action, 'replace')
  assert.equal(out.deleted, 3)
  assert.equal(out.inserted, 3)
  assert.equal(store.rows.length, 3)
  assert.equal(store.rows.find((r) => r.periodNumber === 1)?.shotsFor, 5)
})

void test('rows whose review was changed are re-written even when the numbers match', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  await run(store, GOOD(), true)
  for (const r of store.rows) r.goalsStatus = 'pending_review'
  const out = await run(store, GOOD(), true)
  assert.equal(out.action, 'replace')
  assert.ok(store.rows.every((r) => r.goalsStatus === 'reviewed'))
})

void test('overtime periods 4 to 6 are imported and counted', async () => {
  const f = file(
    '111',
    [
      [1, 1, 5, 5],
      [0, 0, 5, 5],
      [1, 1, 5, 5],
      [0, 0, 1, 1],
      [1, 0, 2, 0],
    ],
    [3, 2],
  )
  const store = new FakeStore({ '111': match(7, 3, 2, { result: 'WIN' }) })
  const out = await run(store, f, true)
  assert.equal(out.action, 'insert')
  assert.deepEqual(
    store.rows.map((r) => r.periodLabel),
    ['1st', '2nd', '3rd', 'OT', 'OT2'],
  )
  const f6 = file(
    '111',
    [
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [1, 0, 1, 0],
    ],
    [1, 0],
  )
  const store6 = new FakeStore({ '111': match(7, 1, 0) })
  await run(store6, f6, true)
  assert.equal(store6.rows.at(-1)?.periodLabel, 'OT3')
})

void test('a game that ended early (one period) is imported when it adds up', async () => {
  const store = new FakeStore({ '111': match(7, 1, 0) })
  const out = await run(store, file('111', [[1, 0, 3, 2]], [1, 0]), true)
  assert.equal(out.action, 'insert')
})

void test('other sources are never touched', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const other = (source: string, matchId: number): StoredRow => ({
    matchId,
    source,
    periodNumber: 1,
    periodLabel: '1st',
    goalsFor: 9,
    goalsAgainst: 9,
    shotsFor: 9,
    shotsAgainst: 9,
    goalsStatus: 'reviewed',
    shotsStatus: 'reviewed',
  })
  store.rows = [other('ocr', 7), other('ea', 7), other('manual', 7), other('engine_video', 8)]
  await run(store, GOOD(), true)
  const changed = file(
    '111',
    [
      [2, 1, 5, 6],
      [1, 1, 4, 6],
      [2, 1, 4, 6],
    ],
    [5, 3],
  )
  await run(store, changed, true)
  for (const s of ['ocr', 'ea', 'manual']) {
    const rows = store.rows.filter((r) => r.source === s)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.goalsFor, 9)
  }
  // Another match's engine rows are not touched either.
  assert.equal(store.rows.filter((r) => r.matchId === 8).length, 1)
})

void test('warnings: side mismatch, more goals than shots, goal list differs, DNF; never a refusal', async () => {
  const f = file(
    '111',
    [
      [2, 1, 1, 6],
      [1, 1, 4, 6],
      [2, 1, 4, 6],
    ],
    [5, 3],
    {
      our_side: 'home',
      goals: [{ period: 1, clock_left_ds: 6000, team: 'BM' }],
    },
  )
  const store = new FakeStore({ '111': match(7, 5, 3, { bgmWasHome: false, result: 'DNF' }) })
  const out = await run(store, f, false)
  assert.equal(out.action, 'insert')
  const text = out.warnings.join(' | ')
  assert.match(text, /our_side/)
  assert.match(text, /more goals than shots/)
  assert.match(text, /goal list differs/)
  assert.match(text, /DNF/)
})

// ─── Folder ───────────────────────────────────────────────────────────────────

void test('two files for the same match are both refused', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const entries: FolderEntry[] = [
    { name: '111.json', json: { ok: true, value: GOOD() } },
    { name: '111-copy.json', json: { ok: true, value: GOOD() } },
  ]
  const out = await importFolder(entries, store, { apply: true })
  assert.deepEqual(
    out.map((o) => o.action),
    ['refused', 'refused'],
  )
  assert.equal(store.writes, 0)
})

void test('invalid JSON is refused and does not stop the rest of the folder', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const entries: FolderEntry[] = [
    { name: 'bad.json', json: { ok: false, error: 'Unexpected token' } },
    { name: '111.json', json: { ok: true, value: GOOD() } },
  ]
  const out = await importFolder(entries, store, { apply: false })
  assert.deepEqual(
    out.map((o) => o.action),
    ['refused', 'insert'],
  )
  assert.match(formatTable(out), /not valid JSON/)
})

void test('fixture folder: dry run writes nothing, each file gets the expected verdict', async () => {
  const dir = fileURLToPath(
    new URL('../../src/__tests__/fixtures/engine-periods/', import.meta.url),
  )
  const entries: FolderEntry[] = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      json: { ok: true as const, value: JSON.parse(readFileSync(dir + name, 'utf8')) as unknown },
    }))
  assert.equal(entries.length, 8)
  const store = new FakeStore({
    '3900836070187': match(3448, 5, 3, { shotsFor: 12, shotsAgainst: 18 }),
    '3898840100293': match(3447, 4, 0),
    '3898658310239': match(3446, 5, 2),
    '3898514700085': match(3445, 3, 0),
    '3899000000001': match(1, 1, 1),
    '3852785320026': match(9, 5, 4, { result: 'OTL' }),
    // A cut recording: the file says end_of_game_check "pass" and complete false, but its
    // goals do not add up to EA's final (3-1 here).
    '3850226150424': match(10, 3, 1),
  })
  const out = await importFolder(entries, store, { apply: false })
  const by = Object.fromEntries(out.map((o) => [o.source, o.action]))
  assert.deepEqual(by, {
    '3898514700085.json': 'skipped',
    '3898658310239.json': 'refused',
    '3898840100293.json': 'insert',
    '3850226150424.json': 'refused',
    '3852785320026.json': 'insert',
    '3899000000001.json': 'refused',
    '3900836070187.json': 'insert',
    '3999999999999.json': 'refused',
  })
  assert.equal(store.writes, 0)
  assert.equal(store.rows.length, 0)
})

void test('unknown extra keys are allowed (the real files carry source_run and source_commit_basis)', () => {
  const r = parseEnginePeriodsFile({ ...GOOD(), brand_new_field: { x: 1 } })
  assert.equal(r.kind, 'ok')
})

void test('a period with null shots is stored as null, never 0, and goals still import', async () => {
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const f = file(
    '111',
    [
      [2, 1, 4, 6],
      [1, 1, null, null],
      [2, 1, 4, 6],
    ],
    [5, 3],
  )
  const out = await run(store, f, true)
  assert.equal(out.action, 'insert')
  assert.equal(store.rows.find((r) => r.periodNumber === 2)?.shotsFor, null)
  assert.match(out.shots ?? '', /1 period\(s\) without shots/)
})

void test('the real sample file (2026-11-13, W 5-4 in OT, 4 periods) imports against a 5-4 match', async () => {
  const dir = fileURLToPath(
    new URL('../../src/__tests__/fixtures/engine-periods/', import.meta.url),
  )
  const raw = JSON.parse(readFileSync(dir + '3852785320026.json', 'utf8')) as unknown
  const store = new FakeStore({ '3852785320026': match(9, 5, 4, { result: 'OTL' }) })
  const out = await run(store, raw, true, '3852785320026')
  assert.equal(out.action, 'insert')
  assert.deepEqual(
    store.rows.map((r) => [r.periodLabel, r.goalsFor, r.goalsAgainst, r.shotsFor, r.shotsAgainst]),
    [
      ['1st', 1, 0, 6, 2],
      ['2nd', 1, 0, 1, 5],
      ['3rd', 2, 4, 4, 10],
      ['OT', 1, 0, 5, 3],
    ],
  )
  // Against a different EA score the same file is refused.
  const store2 = new FakeStore({ '3852785320026': match(9, 5, 3) })
  assert.equal((await run(store2, raw, true)).action, 'refused')
  assert.equal(store2.writes, 0)
})

void test('end_of_game_check "pass" is never trusted alone: complete true but final differs from EA is refused', async () => {
  const store = new FakeStore({ '111': match(7, 4, 3) })
  const out = await run(store, GOOD(), true) // file says 5-3 and "pass"
  assert.equal(out.action, 'refused')
  assert.equal(store.writes, 0)
})

void test('a cut recording (complete false, "pass", goals differ from EA) is shown as refused, never written', async () => {
  const cut = file(
    '111',
    [
      [0, 1, 0, 2],
      [0, 1, 5, 2],
      [0, 0, null, null],
    ],
    [0, 2],
    {
      complete: false,
      end_of_game_check: 'pass',
    },
  )
  const store = new FakeStore({ '111': match(7, 3, 2) })
  const out = await run(store, cut, true)
  assert.equal(out.action, 'refused')
  assert.match(out.reason, /not complete/)
  assert.match(out.reason, /do not add up/)
  assert.equal(store.writes, 0)
  assert.equal(store.rows.length, 0)
})

void test('an incomplete file whose goals do add up is skipped, not refused, and never written', async () => {
  const cut = file(
    '111',
    [
      [2, 1, 4, 6],
      [1, 1, 4, 6],
      [2, 1, 4, 6],
    ],
    [5, 3],
    { complete: false },
  )
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const out = await run(store, cut, true)
  assert.equal(out.action, 'skipped')
  assert.equal(store.writes, 0)
})

void test('the opponent abbreviation is never read, shown or stored (it can be misread)', async () => {
  const f = file(
    '111',
    [
      [2, 1, 4, 6],
      [1, 1, 4, 6],
      [2, 1, 4, 6],
    ],
    [5, 3],
    {
      opp_abbr: 'PIK',
      goals: [{ period: 1, clock_left_ds: 6000, team: 'PIK' }],
    },
  )
  const store = new FakeStore({ '111': match(7, 5, 3) })
  const out = await run(store, f, true)
  assert.equal(out.action, 'insert')
  assert.ok(!JSON.stringify(out).includes('PIK'))
  assert.ok(!formatTable([out]).includes('PIK'))
  assert.ok(!JSON.stringify(store.rows).includes('PIK'))
  const parsed = parseEnginePeriodsFile(f)
  assert.ok(parsed.kind === 'ok' && !JSON.stringify(parsed.file).includes('PIK'))
  // A missing or garbage opp_abbr does not block the import.
  const { opp_abbr: _drop, ...without } = f
  assert.equal(parseEnginePeriodsFile(without).kind, 'ok')
  assert.equal(parseEnginePeriodsFile({ ...f, opp_abbr: 42 }).kind, 'ok')
})
