/**
 * SQL-shape pins for the news desk queries. No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const {
  listGameJobCandidatesSql,
  listEndedNightsSql,
  claimNewsJobSql,
  newsFeedSql,
  countNightGamesSql,
  undeliveredNewsItemsQuery,
  markNewsItemFailedQuery,
  discordDeletionsQuery,
  publicNewsItemWhere,
  deleteTestNewsItemsQuery,
  rawToNewsItem,
} = await import('../news.js')
const { db } = await import('../../client.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const NIGHT = (a: string) =>
  `((${a}.played_at at time zone 'America/Edmonton') - interval '6 hours')::date`

void test('game candidates: active title, not DNF, discord row settled, no job or failed under cap', () => {
  const q = dialect.sqlToQuery(
    listGameJobCandidatesSql({ since: new Date('2026-10-24T00:00:00Z'), limit: 5 }),
  )
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.match(s, /join discord_posts dp on dp\.match_id = m\.id/)
  assert.match(s, /dp\.status <> 'pending'/)
  assert.match(s, /left join news_jobs j on j\.kind = 'game' and j\.job_key = m\.id::text/)
  assert.match(s, /j\.job_key is null or \( ?j\.status = 'failed' and j\.attempts < 3 ?\)/)
  assert.match(s, /m\.played_at > \$\d+::timestamptz/)
  assert.match(s, /order by m\.played_at/)
  assert.match(s, /limit \$\d+/)
  assert.ok(q.params.includes('2026-10-24T00:00:00.000Z'))
  assert.ok(q.params.every((p) => !(p instanceof Date)))
})

void test('ended nights: night key, cut-off, since, job cap, every counted game has a finished job', () => {
  const q = dialect.sqlToQuery(
    listEndedNightsSql({
      now: new Date('2026-10-24T20:00:00Z'),
      endedForMs: 90 * 60_000,
      since: new Date('2026-10-20T00:00:00Z'),
    }),
  )
  const s = flat(q.sql)
  assert.ok(s.includes(NIGHT('m')), 'night expression for the grouped matches')
  assert.ok(s.includes(NIGHT('m2')), 'night expression for the per-game check')
  assert.match(s, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  assert.match(s, /max\(m\.played_at\) < \$\d+::timestamptz/)
  assert.match(s, /max\(m\.played_at\) > \$\d+::timestamptz/)
  assert.ok(q.params.includes('2026-10-24T18:30:00.000Z'), 'now minus endedForMs')
  assert.ok(q.params.includes('2026-10-20T00:00:00.000Z'))
  assert.ok(q.params.every((p) => !(p instanceof Date)))
  assert.match(
    s,
    /left join news_jobs j on j\.kind = 'night' and j\.job_key = to_char\(n\.night, 'YYYY-MM-DD'\)/,
  )
  assert.match(s, /j\.job_key is null or \( ?j\.status = 'failed' and j\.attempts < 3 ?\)/)
  assert.match(s, /m2\.result <> 'DNF'/)
  assert.match(
    s,
    /not exists \( ?select 1 from news_jobs gj where gj\.kind = 'game' and gj\.job_key = m2\.id::text and \(gj\.status in \('done', 'skipped'\) or \(gj\.status = 'failed' and gj\.attempts >= 3\)\) ?\)/,
  )
  assert.match(s, /order by n\.night/)
})

void test('claim: insert pending, or flip only a failed row under the cap', () => {
  const q = dialect.sqlToQuery(claimNewsJobSql('game', '42', false))
  const s = flat(q.sql)
  assert.match(
    s,
    /insert into news_jobs \(kind, job_key, status, attempts, is_test\) values \(\$1, \$2, 'pending', 1, \$3\)/,
  )
  assert.deepEqual(q.params, ['game', '42', false])
  assert.match(
    s,
    /on conflict \(kind, job_key\) do update set status = 'pending', attempts = news_jobs\.attempts \+ 1, updated_at = now\(\) where news_jobs\.status = 'failed' and news_jobs\.attempts < 3 returning id/,
  )
})

void test('public feed: not test, not deleted, newest first, keyset only when beforeId is set', () => {
  const first = dialect.sqlToQuery(newsFeedSql({ kind: 'post', beforeId: null, limit: 20 }))
  const a = flat(first.sql)
  assert.match(a, /from news_items n/)
  assert.match(a, /n\.kind = \$\d+/)
  assert.match(a, /n\.is_test = false/)
  assert.match(a, /n\.deleted_at is null/)
  assert.match(a, /order by n\.id desc/)
  assert.match(a, /limit \$\d+/)
  assert.doesNotMatch(a, /n\.id < \$/)
  assert.deepEqual(first.params, ['post', 20])

  const next = dialect.sqlToQuery(newsFeedSql({ kind: 'article', beforeId: 77, limit: 10 }))
  assert.match(flat(next.sql), /n\.id < \$\d+/)
  assert.deepEqual(next.params, ['article', 77, 10])
})

void test('every public query uses the same not-test, not-deleted filter', () => {
  const s = flat(dialect.sqlToQuery(publicNewsItemWhere()).sql)
  assert.match(s, /"news_items"\."is_test" = \$\d+|"is_test" = \$\d+/)
  assert.match(s, /"deleted_at" is null/)
})

void test('count night games: active title, not DNF, night key in the list', () => {
  const q = dialect.sqlToQuery(countNightGamesSql(['2026-10-23', '2026-10-24']))
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.ok(s.includes(`to_char(${NIGHT('m')}, 'YYYY-MM-DD') in ($1, $2)`))
  assert.deepEqual(q.params, ['2026-10-23', '2026-10-24'])
})

void test('undelivered: failed under the cap, not test, not deleted', () => {
  const q = undeliveredNewsItemsQuery(10).toSQL()
  const s = flat(q.sql)
  assert.match(s, /"discord_status" = \$\d+/)
  assert.match(s, /"discord_attempts" < \$\d+/)
  assert.match(s, /"is_test" = \$\d+/)
  assert.match(s, /"deleted_at" is null/)
  assert.ok(q.params.includes('failed'))
  assert.ok(q.params.includes(3))
  assert.ok(q.params.includes(false))
})

void test('mark failed: status failed and attempts + 1', () => {
  const q = markNewsItemFailedQuery(5, 'boom').toSQL()
  const s = flat(q.sql)
  assert.match(s, /"discord_status" = \$\d+/)
  assert.match(s, /"discord_attempts" = "news_items"\."discord_attempts" \+ 1/)
  assert.ok(q.params.includes('failed'))
  assert.ok(q.params.includes('boom'))
})

void test('discord deletions: deleted, has a message id, not yet deleted on Discord', () => {
  const s = flat(discordDeletionsQuery(10).toSQL().sql)
  assert.match(s, /"deleted_at" is not null/)
  assert.match(s, /"discord_message_id" is not null/)
  assert.match(s, /"discord_deleted_at" is null/)
})

void test('delete test items: only items, never jobs', () => {
  const s = flat(deleteTestNewsItemsQuery().toSQL().sql)
  assert.match(s, /^delete from "news_items" where "news_items"\."is_test" = \$1/)
  assert.doesNotMatch(s, /news_jobs/)
})

void test('raw feed row: mentions and facts parse the same way (text or object, null stays null)', () => {
  const base = {
    id: '1',
    job_id: null,
    kind: 'article',
    reporter: 'barlow',
    match_id: '9',
    night: '2026-10-23',
    week_start: null,
    reply_to: null,
    slug: 's',
    headline: 'h',
    dek: null,
    body: 'b',
    summary: null,
    is_test: false,
    discord_status: 'pending',
    discord_attempts: 0,
    discord_message_id: null,
    last_error: null,
    deleted_at: null,
    discord_deleted_at: null,
    created_at: '2026-10-24 12:00:00+00',
  } as const
  const facts = { games: [{ matchId: 9 }] }
  const mentions = [{ name: 'A', playerId: 1 }]
  const asText = rawToNewsItem({
    ...base,
    mentions: JSON.stringify(mentions),
    facts: JSON.stringify(facts),
  } as never)
  const asObject = rawToNewsItem({ ...base, mentions, facts } as never)
  assert.deepEqual(asText.facts, facts)
  assert.deepEqual(asObject.facts, facts)
  assert.deepEqual(asText.mentions, mentions)
  assert.equal(rawToNewsItem({ ...base, mentions: [], facts: null } as never).facts, null)
})

void test('db handle exists (builders need no connection)', () => {
  assert.ok(db)
})
