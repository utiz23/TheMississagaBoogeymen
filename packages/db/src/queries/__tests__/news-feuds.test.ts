/**
 * SQL-shape pins for the feud queries (T5, migration 0076). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news-feuds.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { newsPressFeuds } from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../news-feuds.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('schema: one row per player and reporter; points only, no message text', () => {
  const cfg = getTableConfig(newsPressFeuds)
  assert.equal(cfg.name, 'news_press_feuds')
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    'news_press_feuds_points_check',
    'news_press_feuds_reporter_check',
  ])
  const uniq = cfg.uniqueConstraints.find(
    (u) => u.name === 'news_press_feuds_player_reporter_uniq',
  )!
  assert.deepEqual(
    uniq.columns.map((c) => c.name),
    ['player_id', 'reporter'],
  )
  const cols = cfg.columns.map((c) => c.name).sort()
  assert.deepEqual(cols, ['id', 'last_event_at', 'player_id', 'points', 'reporter', 'updated_at'])
})

void test('migration 0076: same table, checks and unique key; idempotent; rollback in the header', () => {
  const file = readFileSync(
    new URL('../../../migrations/0076_press_feuds.sql', import.meta.url),
    'utf8',
  )
  assert.match(file, /CREATE TABLE IF NOT EXISTS "news_press_feuds"/)
  assert.match(file, /"points" numeric\(6, 2\) NOT NULL/)
  assert.match(
    file,
    /news_press_feuds_player_reporter_uniq[\s\S]*UNIQUE \("player_id", "reporter"\)/,
  )
  assert.match(file, /ROLLBACK[\s\S]*DROP TABLE IF EXISTS "news_press_feuds"/)
  assert.doesNotMatch(file, /news_scrum_answers"? *(ADD|ALTER)/i)
  assert.match(file, /^BEGIN;$/m)
  assert.match(file, /^COMMIT;$/m)
})

void test('addFeudPoints: one upsert that fades the old total, adds, caps and moves the clock', () => {
  const at = new Date('2026-11-13T12:00:00Z')
  const { sql: s, params } = dialect.sqlToQuery(
    q.addFeudPointsSql({ playerId: 4, reporter: 'mercer', points: 2, at }),
  )
  const f = flat(s)
  assert.match(
    f,
    /insert into news_press_feuds \(player_id, reporter, points, last_event_at, updated_at\)/,
  )
  assert.match(f, /on conflict \(player_id, reporter\) do update set/)
  // The existing row's columns are qualified by the table name.
  assert.match(f, /news_press_feuds\.points \* power\(0\.5::numeric/)
  assert.match(f, /news_press_feuds\.last_event_at/)
  assert.match(f, /least\(\$\d+::numeric, news_press_feuds\.points/)
  assert.ok(params.includes(4))
  assert.ok(params.includes('mercer'))
  assert.ok(params.includes(12))
  assert.ok(params.includes(7))
  assert.ok(params.includes(at.toISOString()))
})

void test('listFeuds: by player ids or all, recent rows only', () => {
  const now = new Date('2026-11-13T12:00:00Z')
  const all = flat(dialect.sqlToQuery(q.listFeudRowsSql(now, null)).sql)
  assert.match(all, /from news_press_feuds f join players p on p\.id = f\.player_id/)
  assert.match(all, /f\.last_event_at > \$1::timestamptz - make_interval\(days => \$2\)/)
  assert.doesNotMatch(all, /f\.player_id in/)
  const some = flat(dialect.sqlToQuery(q.listFeudRowsSql(now, [3, 9])).sql)
  assert.match(some, /and f\.player_id in \(\$3, \$4\)/)
})

void test('isPressThread: a scrum thread (or its message) or an interview thread', () => {
  const s = flat(dialect.sqlToQuery(q.isPressThreadSql('t1')).sql)
  assert.match(s, /from news_scrums s where s\.thread_id = \$1 or s\.message_id = \$2/)
  assert.match(s, /from news_interviews i where i\.thread_id = \$3 or i\.offer_message_id = \$4/)
})
