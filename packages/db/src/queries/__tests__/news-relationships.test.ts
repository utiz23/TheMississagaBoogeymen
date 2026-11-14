/**
 * SQL-shape pins for the relationship queries (T9, migration 0078). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news-relationships.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { newsPressRelationships } from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../news-relationships.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('schema: one row per player and reporter; points only, no message text', () => {
  const cfg = getTableConfig(newsPressRelationships)
  assert.equal(cfg.name, 'news_press_relationships')
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    'news_press_relationships_override_level_check',
    'news_press_relationships_points_check',
    'news_press_relationships_reporter_check',
  ])
  const uniq = cfg.uniqueConstraints.find(
    (u) => u.name === 'news_press_relationships_player_reporter_uniq',
  )!
  assert.deepEqual(
    uniq.columns.map((c) => c.name),
    ['player_id', 'reporter'],
  )
  const cols = cfg.columns.map((c) => c.name).sort()
  // 0080 (Press Box) adds frozen, override_level and override_reason: still no message text.
  assert.deepEqual(cols, [
    'frozen',
    'id',
    'last_event_at',
    'override_level',
    'override_reason',
    'player_id',
    'points',
    'reporter',
    'updated_at',
  ])
})

void test('migration 0078: renames T5 table, maps points to negative, signed check, idempotent, rollback in the header', () => {
  const file = readFileSync(
    new URL('../../../migrations/0078_press_relationships.sql', import.meta.url),
    'utf8',
  )
  const body = file.split('\nBEGIN;')[1]!
  assert.match(body, /to_regclass\('public\.news_press_feuds'\) IS NOT NULL/)
  assert.match(body, /to_regclass\('public\.news_press_relationships'\) IS NULL/)
  assert.match(body, /RENAME TO "news_press_relationships"/)
  // T5 points are kept and mapped to the negative side, after the old check is dropped.
  const drop = body.indexOf('DROP CONSTRAINT IF EXISTS "news_press_feuds_points_check"')
  const flip = body.indexOf('SET "points" = -"points"')
  assert.ok(drop > 0 && flip > drop, 'old check dropped before the flip')
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_press_relationships"/)
  assert.match(body, /"points" numeric\(6, 2\) NOT NULL/)
  assert.match(body, /CHECK \("points" BETWEEN -12 AND 12\)/)
  assert.match(
    body,
    /news_press_relationships_player_reporter_uniq"\s*UNIQUE \("player_id", "reporter"\)/,
  )
  // Rollback in the header: favour-side rows deleted, points flipped back, table renamed back.
  const header = file.split('\nBEGIN;')[0]!
  assert.match(header, /ROLLBACK/)
  assert.match(header, /DELETE FROM "news_press_relationships" WHERE "points" > 0/)
  assert.match(header, /RENAME TO "news_press_feuds"/)
  assert.match(file, /^BEGIN;$/m)
  assert.match(file, /^COMMIT;$/m)
})

void test('addRelationshipPoints: one signed upsert that fades toward zero, adds, caps both ways and moves the clock', () => {
  const at = new Date('2026-11-13T12:00:00Z')
  const { sql: s, params } = dialect.sqlToQuery(
    q.addRelationshipPointsSql({ playerId: 4, reporter: 'mercer', points: -2, at }),
  )
  const f = flat(s)
  assert.match(
    f,
    /insert into news_press_relationships \(player_id, reporter, points, last_event_at, updated_at\)/,
  )
  assert.match(f, /on conflict \(player_id, reporter\) do update set/)
  // The existing row's columns are qualified by the table name.
  assert.match(f, /news_press_relationships\.points \* power\(0\.5::numeric/)
  assert.match(f, /news_press_relationships\.last_event_at/)
  // Capped on both sides.
  assert.match(
    f,
    /greatest\(-\$\d+::numeric, least\(\$\d+::numeric, news_press_relationships\.points/,
  )
  // Press Box (0080): a frozen pair takes no new points.
  assert.match(f, /where news_press_relationships\.frozen = false/)
  assert.ok(params.includes(4))
  assert.ok(params.includes('mercer'))
  assert.ok(params.includes(-2))
  assert.ok(params.includes(12))
  assert.ok(params.includes(7))
  assert.ok(params.includes(at.toISOString()))
})

void test('listRelationships: by player ids or all, recent rows only', () => {
  const now = new Date('2026-11-13T12:00:00Z')
  const all = flat(dialect.sqlToQuery(q.listRelationshipRowsSql(now, null)).sql)
  assert.match(all, /from news_press_relationships f join players p on p\.id = f\.player_id/)
  assert.match(all, /f\.last_event_at > \$1::timestamptz - make_interval\(days => \$2\)/)
  assert.doesNotMatch(all, /f\.player_id in/)
  const some = flat(dialect.sqlToQuery(q.listRelationshipRowsSql(now, [3, 9])).sql)
  assert.match(some, /and f\.player_id in \(\$3, \$4\)/)
})

void test('isPressThread: a scrum thread (or its message) or an interview thread', () => {
  const s = flat(dialect.sqlToQuery(q.isPressThreadSql('t1')).sql)
  assert.match(s, /from news_scrums s where s\.thread_id = \$1 or s\.message_id = \$2/)
  assert.match(s, /from news_interviews i where i\.thread_id = \$3 or i\.offer_message_id = \$4/)
})
