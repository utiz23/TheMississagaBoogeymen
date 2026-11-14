/**
 * SQL-shape pins for the live events table and queries (E1, migration 0079). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/live-events.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { LIVE_EVENT_SOURCES, LIVE_EVENT_TYPES, liveEvents } from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://live-events-test:unused@127.0.0.1:1/unused'

const q = await import('../live-events.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

void test('schema: id primary key, type, source, at, received_at, payload; checks; received_at index', () => {
  const cfg = getTableConfig(liveEvents)
  assert.equal(cfg.name, 'live_events')
  assert.deepEqual(cfg.columns.map((c) => c.name).sort(), [
    'at',
    'id',
    'payload',
    'received_at',
    'source',
    'type',
  ])
  const id = cfg.columns.find((c) => c.name === 'id')!
  assert.equal(id.primary, true)
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    'live_events_id_check',
    'live_events_source_check',
    'live_events_type_check',
  ])
  assert.deepEqual(
    cfg.indexes.map((i) => i.config.name),
    ['live_events_received_at_idx'],
  )
  assert.deepEqual(
    [...LIVE_EVENT_TYPES],
    [
      'lobby_countdown',
      'game_start',
      'period_end',
      'goal',
      'penalty',
      'end_of_game_screen',
      'game_end',
    ],
  )
  assert.deepEqual([...LIVE_EVENT_SOURCES], ['obs', 'engine'])
})

void test('migration 0079: creates live_events idempotently, same checks as the schema, rollback in the header', () => {
  const file = readFileSync(
    new URL('../../../migrations/0079_live_events.sql', import.meta.url),
    'utf8',
  )
  const [header, body] = file.split('\nBEGIN;') as [string, string]
  assert.ok(body, 'the body is in a transaction')
  assert.match(body, /CREATE TABLE IF NOT EXISTS "live_events"/)
  assert.match(body, /"id" text PRIMARY KEY NOT NULL/)
  assert.match(body, /"received_at" timestamp with time zone DEFAULT now\(\) NOT NULL/)
  assert.match(body, /"payload" jsonb NOT NULL/)
  assert.match(body, /CREATE INDEX IF NOT EXISTS "live_events_received_at_idx"/)
  const types = LIVE_EVENT_TYPES.map((t) => `'${t}'`).join(', ')
  assert.ok(body.includes(`CHECK ("type" IN (${types}))`), 'type check lists every v1 type')
  assert.ok(body.includes(`CHECK ("source" IN ('obs', 'engine'))`))
  assert.ok(body.includes('CHECK (char_length("id") BETWEEN 1 AND 128)'))
  // Re-runnable: each check is dropped by name before it is added.
  for (const name of [
    'live_events_type_check',
    'live_events_source_check',
    'live_events_id_check',
  ]) {
    assert.ok(body.includes(`DROP CONSTRAINT IF EXISTS "${name}"`), name)
  }
  assert.match(body, /COMMIT;\s*$/)
  // Touches no other table.
  assert.doesNotMatch(body, /ALTER TABLE "(?!live_events")/)
  assert.match(header, /ROLLBACK/)
  assert.match(header, /DROP TABLE IF EXISTS "live_events";/)
})

void test('insert: on conflict (id) do nothing, returning id (idempotent by id)', () => {
  const query = dialect.sqlToQuery(
    q.insertLiveEventSql({
      id: 'obs-1',
      type: 'period_end',
      source: 'obs',
      at: new Date('2026-11-14T03:20:41Z'),
      payload: { v: 1, id: 'obs-1', period: 3 },
    }),
  )
  const text = flat(query.sql)
  assert.match(text, /^insert into live_events \(id, type, source, at, payload\)/)
  assert.match(text, /on conflict \(id\) do nothing returning id$/)
  assert.ok(text.includes('::jsonb'))
  assert.deepEqual(query.params, [
    'obs-1',
    'period_end',
    'obs',
    '2026-11-14T03:20:41.000Z',
    JSON.stringify({ v: 1, id: 'obs-1', period: 3 }),
  ])
})

void test('triggers: period_end and game_end after the (received_at, id) cursor, oldest first', () => {
  const query = dialect.sqlToQuery(
    q.listLiveEventTriggersSql({ receivedAt: new Date('2026-11-14T03:00:00Z'), id: 'x' }, 25),
  )
  const text = flat(query.sql)
  assert.ok(text.includes('(e.received_at, e.id) > ($1::timestamptz, $2)'))
  assert.ok(text.includes(`e.type in ('period_end', 'game_end')`))
  // period is read only when it is a JSON number (never a failing cast).
  assert.ok(text.includes(`case when jsonb_typeof(e.payload->'period') = 'number'`))
  assert.match(text, /order by e\.received_at, e\.id limit \$3$/)
  assert.deepEqual(query.params, ['2026-11-14T03:00:00.000Z', 'x', 25])
})

void test('latest club game and game-ended checks read active titles only', () => {
  const latest = flat(dialect.sqlToQuery(q.latestActiveClubMatchIdSql()).sql)
  assert.ok(latest.includes('select max(m.id) as id from matches m'))
  assert.ok(latest.includes('g.is_active = true'))
  const ended = dialect.sqlToQuery(q.activeClubGameEndedSinceSql(new Date('2026-11-14T03:10:00Z')))
  assert.ok(flat(ended.sql).includes('g.is_active = true and m.played_at >= $1::timestamptz'))
  assert.deepEqual(ended.params, ['2026-11-14T03:10:00.000Z'])
})

void test('cleanup deletes only rows stored before the cutoff; retention is 30 days', () => {
  const del = dialect.sqlToQuery(q.deleteLiveEventsBeforeSql(new Date('2026-10-15T00:00:00Z')))
  assert.ok(flat(del.sql).includes('delete from live_events where received_at < $1::timestamptz'))
  assert.deepEqual(del.params, ['2026-10-15T00:00:00.000Z'])
  assert.equal(q.LIVE_EVENTS_RETENTION_DAYS, 30)
})
