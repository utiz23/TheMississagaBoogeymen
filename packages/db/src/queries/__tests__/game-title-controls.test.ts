/**
 * Game-title controls (migration 0057): chronology, live/archive view class and
 * the single-default invariant — DB-free.
 *
 * `../game-titles.js` reaches the db client, which throws at import time
 * without DATABASE_URL. postgres.js connects lazily and nothing here queries,
 * so a closed-port placeholder (the apps/web/test/register-loader.mjs
 * convention) is set unconditionally and never dialled.
 *
 * Run:
 *   pnpm --filter @eanhl/db build && \
 *   node --test packages/db/dist/queries/__tests__/game-title-controls.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getTableConfig } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://game-title-controls-test:unused@127.0.0.1:1/unused'

const { compareGameTitlesNewestFirst, isLiveGameTitle, gameTitleListingQuery } =
  await import('../game-titles.js')
const { gameTitles } = await import('../../schema/index.js')

interface Fixture {
  id: number
  slug: string
  releaseOrder: number | null
  isDefault: boolean
}

// Ids deliberately disagree with chronology: NHL 27 has the LOWEST id, NHL 26
// the highest, and the oldest title (NHL 19) is the default.
const MISLEADING: Fixture[] = [
  { id: 9, slug: 'nhl26', releaseOrder: 26, isDefault: false },
  { id: 7, slug: 'nhl19', releaseOrder: 19, isDefault: true },
  { id: 1, slug: 'nhl27', releaseOrder: 27, isDefault: false },
  { id: 5, slug: 'nhl22', releaseOrder: 22, isDefault: false },
]

void test('chronology is newest first by release_order, independent of id and default', () => {
  const ordered = [...MISLEADING].sort(compareGameTitlesNewestFirst).map((t) => t.slug)
  assert.deepEqual(ordered, ['nhl27', 'nhl26', 'nhl22', 'nhl19'])
  // Sorting by id either way would not give this order.
  assert.notDeepEqual(
    ordered,
    [...MISLEADING].sort((a, b) => a.id - b.id).map((t) => t.slug),
  )
  assert.notDeepEqual(
    ordered,
    [...MISLEADING].sort((a, b) => b.id - a.id).map((t) => t.slug),
  )
})

void test('unset release_order sorts after every ordered title, ties broken by slug', () => {
  const titles: Fixture[] = [
    { id: 1, slug: 'zz-unset', releaseOrder: null, isDefault: false },
    { id: 2, slug: 'nhl24', releaseOrder: 24, isDefault: false },
    { id: 3, slug: 'aa-unset', releaseOrder: null, isDefault: true },
    { id: 4, slug: 'nhl25', releaseOrder: 25, isDefault: false },
  ]
  assert.deepEqual(
    [...titles].sort(compareGameTitlesNewestFirst).map((t) => t.slug),
    ['nhl25', 'nhl24', 'aa-unset', 'zz-unset'],
  )
  // Deterministic: input order does not matter.
  assert.deepEqual(
    [...titles]
      .reverse()
      .sort(compareGameTitlesNewestFirst)
      .map((t) => t.slug),
    ['nhl25', 'nhl24', 'aa-unset', 'zz-unset'],
  )
})

void test('live view class = polled OR has matches; the default flag plays no part', () => {
  assert.equal(isLiveGameTitle({ isActive: true, hasMatches: false }), true) // newly enabled
  assert.equal(isLiveGameTitle({ isActive: false, hasMatches: true }), true) // NHL 26 after cutover
  assert.equal(isLiveGameTitle({ isActive: true, hasMatches: true }), true)
  assert.equal(isLiveGameTitle({ isActive: false, hasMatches: false }), false) // NHL 19–25 archive
})

void test('the has-matches subquery correlates to the outer title, table-qualified', () => {
  // Regression: Drizzle renders `${column}` unqualified in a single-table
  // select, and an unqualified "id" inside the subquery binds to matches.id —
  // which made EXISTS true for every title (archive titles turned "live").
  const { sql } = gameTitleListingQuery().toSQL()
  assert.match(
    sql,
    /exists \(select 1 from "matches" where "matches"\."game_title_id" = "game_titles"\."id"\)/,
  )
})

void test('schema declares at most one default and unique chronology', () => {
  const config = getTableConfig(gameTitles)
  const single = config.indexes.find((i) => i.config.name === 'game_titles_single_default')
  assert.ok(single, 'game_titles_single_default index is declared')
  assert.equal(single.config.unique, true)
  assert.ok(single.config.where, 'single-default index is partial (WHERE is_default = true)')
  const columns = single.config.columns.map((c) => ('name' in c ? c.name : null))
  assert.deepEqual(columns, ['is_default'])

  const order = config.indexes.find((i) => i.config.name === 'game_titles_release_order_uniq')
  assert.ok(order, 'game_titles_release_order_uniq index is declared')
  assert.equal(order.config.unique, true)
})

void test('migration 0057 enforces a single default and never writes is_active', () => {
  const raw = readFileSync(
    new URL('../../../migrations/0057_game_title_controls.sql', import.meta.url),
    'utf8',
  )
  // Executable SQL only: the header documents operator UPDATEs in comments.
  const body = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  assert.match(
    body,
    /CREATE UNIQUE INDEX IF NOT EXISTS "game_titles_single_default"\s+ON "game_titles" \("is_default"\) WHERE "is_default" = true;/,
  )
  assert.doesNotMatch(body, /"?is_active"?\s*=\s*(true|false)/i, 'no is_active assignment')
  assert.doesNotMatch(body, /SET\s+"?is_active"?/i, 'no is_active SET')
  // Fill-only backfill and default-only-when-none guards.
  assert.match(body, /WHERE "release_order" IS NULL/)
  assert.match(body, /IF EXISTS \(SELECT 1 FROM "game_titles" WHERE "is_default"\) THEN\s+RETURN;/)
})
