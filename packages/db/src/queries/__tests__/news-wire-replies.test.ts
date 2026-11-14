/**
 * SQL-shape pins for the wire-reply queries (T4, migration 0075). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news-wire-replies.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { WIRE_REPLY_STATUSES, newsWireReplies } from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../news-press.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('schema: one row per person per post; no column for the reply text', () => {
  const cfg = getTableConfig(newsWireReplies)
  assert.equal(cfg.name, 'news_wire_replies')
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    'news_wire_replies_reporter_check',
    'news_wire_replies_status_check',
  ])
  const uniq = cfg.uniqueConstraints.find((u) => u.name === 'news_wire_replies_item_user_uniq')!
  assert.deepEqual(
    uniq.columns.map((c) => c.name),
    ['item_id', 'discord_user_id'],
  )
  const cols = cfg.columns.map((c) => c.name).sort()
  assert.deepEqual(cols, [
    'answer',
    'answer_message_id',
    'created_at',
    'discord_user_id',
    'id',
    'is_test',
    'item_id',
    'night',
    'player_id',
    'reply_message_id',
    'reporter',
    'status',
  ])
  // Privacy: the member's reply text has no place to go.
  assert.ok(!cols.some((c) => /reply_text|reply_content|^text$|content/.test(c)))
  assert.deepEqual([...WIRE_REPLY_STATUSES], ['claimed', 'answered', 'failed'])
})

void test('migration 0075: the same table, checks and unique key; idempotent; no 0073/0074 tables', () => {
  const file = readFileSync(
    new URL('../../../migrations/0075_press_wire_replies.sql', import.meta.url),
    'utf8',
  )
  assert.match(file, /CREATE TABLE IF NOT EXISTS "news_wire_replies"/)
  assert.match(
    file,
    /news_wire_replies_item_user_uniq[\s\S]*UNIQUE \("item_id", "discord_user_id"\)/,
  )
  assert.match(file, /CHECK \("status" IN \('claimed', 'answered', 'failed'\)\)/)
  assert.match(file, /CREATE INDEX IF NOT EXISTS "news_wire_replies_night_idx"/)
  assert.doesNotMatch(file, /news_interviews|news_scrum_people|panel/)
  assert.match(file, /^BEGIN;$/m)
  assert.match(file, /^COMMIT;$/m)
})

void test('claimWireReply: insert as claimed, conflict on (item, user) inserts nothing', () => {
  const { sql: s, params } = q
    .claimWireReplyQuery({
      itemId: 7,
      discordUserId: '200000000000000001',
      playerId: 1,
      reporter: 'voss',
      night: '2026-10-12',
      replyMessageId: 'm1',
      isTest: true,
    })
    .toSQL()
  const f = flat(s)
  assert.match(f, /insert into "news_wire_replies"/)
  assert.match(f, /on conflict \("item_id","discord_user_id"\) do nothing/)
  assert.match(f, /returning "id"/)
  assert.ok(params.includes('claimed'))
  assert.ok(params.includes('m1'))
})

void test('finishWireReply: only a claimed row changes', () => {
  const answered = flat(
    q
      .finishWireReplyQuery(3, { status: 'answered', answer: 'Fair point.', answerMessageId: 'a1' })
      .toSQL().sql,
  )
  assert.match(
    answered,
    /update "news_wire_replies" set "answer_message_id" = \$\d+, "answer" = \$\d+, "status" = \$\d+/,
  )
  assert.match(
    answered,
    /where \("news_wire_replies"\."id" = \$\d+ and "news_wire_replies"\."status" = \$\d+\)/,
  )
  const failed = q.finishWireReplyQuery(3, { status: 'failed' }).toSQL()
  assert.ok(failed.params.includes('failed'))
  assert.ok(failed.params.includes('claimed'))
})

void test('countWireRepliesTonight: by night, claimed and answered only', () => {
  const s = flat(dialect.sqlToQuery(q.countWireRepliesTonightSql('2026-10-12')).sql)
  assert.match(
    s,
    /from news_wire_replies where night = \$1::date and status in \('claimed', 'answered'\)/,
  )
})
