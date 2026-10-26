/**
 * SQL-shape pins for the news desk queries. No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { FEATURE_KINDS, REPORTER_IDS } from '../../news/index.js'
import { NEWS_REPORTER_IDS, newsItems, newsReporterSwitch } from '../../schema/index.js'

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
  listNewsNightMatchesSql,
  findNewsPostQuery,
  findNewsArticleQuery,
  listTitleResultsSql,
  listRecentNightSummariesSql,
  listNewsCardEventsSql,
  listPlayerTitleTotalsSql,
  listNewsHistoryGamesSql,
  listNewsNormGamesSql,
  rowToNormGame,
  listNewsPlayerGamesSql,
  rowToPlayerGame,
  listNewsPlayersWithOtherSeasonsSql,
  listNewsTitleSeasonTotalsSql,
  listNewsClubRecordLinesSql,
  stancesForThreadsSql,
  predictionScorecardsSql,
  recentReporterSummariesSql,
  reporterActivitySql,
  lastFeatureSql,
  nightCriticizedSql,
  nightZeroCalledSql,
  recentReporterPiecesSql,
  rowToOwnPiece,
  listGameArticleRetriesSql,
  activeTakesForPlayersQuery,
  takesUsedSinceSql,
  disabledReportersQuery,
  adminTakesSql,
  seedPlayersSql,
  skipHeldPostsSql,
  updateAdminTakeQuery,
  qualityItemsSql,
  rowToAdminTake,
  rowToQualityItem,
  dueNewsItemsQuery,
  claimDueNewsItemQuery,
  rowsToNightZeroCalled,
  nightPostsForPromptSql,
  rowToNightPost,
  rowToActivity,
  skipBacklogGamesSql,
  skipBacklogNightsSql,
  skipBacklogWeeksSql,
  softDeleteNewsItemQuery,
  NIGHT_SETTLE_CEILING_MS,
  NEWS_BACKLOG_MS,
} = await import('../news.js')
const { db } = await import('../../client.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const NIGHT = (a: string) =>
  `((${a}.played_at at time zone 'America/Edmonton') - interval '6 hours')::date`

void test('game candidates: active title, not DNF, discord row final, no job or failed under cap', () => {
  const q = dialect.sqlToQuery(
    listGameJobCandidatesSql({ since: new Date('2026-10-24T00:00:00Z'), limit: 5 }),
  )
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.match(s, /join discord_posts dp on dp\.match_id = m\.id/)
  // M1: final = posted, skipped, or failed for good (the result poster may still retry a failed one).
  assert.match(
    s,
    /\(dp\.status in \('posted', 'skipped'\) or \(dp\.status = 'failed' and dp\.attempts >= 3\)\)/,
  )
  assert.doesNotMatch(s, /dp\.status <> 'pending'/)
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
  // I1.1: a pending game job counts as settled (one news process: a pending job seen here is dead).
  assert.match(
    s,
    /not exists \( ?select 1 from news_jobs gj where gj\.kind = 'game' and gj\.job_key = m2\.id::text and \(gj\.status in \('done', 'skipped', 'pending'\) or \(gj\.status = 'failed' and gj\.attempts >= 3\)\) ?\)/,
  )
  // I1.2: 3 h after the last game the night is over whatever its game jobs say.
  assert.equal(NIGHT_SETTLE_CEILING_MS, 3 * 60 * 60 * 1000)
  assert.match(
    s,
    /and \( ?n\.last_end < \$\d+::timestamptz or not exists \( ?select 1 from matches m2/,
  )
  assert.ok(q.params.includes('2026-10-24T17:00:00.000Z'), 'now minus 3 h')
  assert.match(s, /order by n\.night/)
})

void test('claim: insert pending, or flip only a failed row under the cap of the same mode', () => {
  const q = dialect.sqlToQuery(claimNewsJobSql('game', '42', false))
  const s = flat(q.sql)
  assert.match(
    s,
    /insert into news_jobs \(kind, job_key, status, attempts, is_test\) values \(\$1, \$2, 'pending', 1, \$3\)/,
  )
  assert.deepEqual(q.params, ['game', '42', false, false])
  assert.match(
    s,
    /on conflict \(kind, job_key\) do update set status = 'pending', attempts = news_jobs\.attempts \+ 1, updated_at = now\(\) where news_jobs\.status = 'failed' and news_jobs\.attempts < 3 and news_jobs\.is_test = \$4 returning id/,
  )
  // M6: a failed test job is never re-claimed live.
  assert.deepEqual(dialect.sqlToQuery(claimNewsJobSql('night', 'k', true)).params, [
    'night',
    'k',
    true,
    true,
  ])
})

void test('recent reporter summaries: real, not deleted, never an item that names a player now at "out"', () => {
  const q = dialect.sqlToQuery(recentReporterSummariesSql('quill', 3))
  const s = flat(q.sql)
  assert.match(s, /from news_items n/)
  assert.match(s, /n\.is_test = false/)
  assert.match(s, /n\.deleted_at is null/)
  assert.match(s, /n\.reporter = \$1/)
  assert.match(s, /n\.headline is not null and n\.summary is not null/)
  assert.match(
    s,
    /and not exists \( ?select 1 from jsonb_array_elements\(n\.mentions\) as e\(elem\) join player_profiles pp on pp\.player_id = \(e\.elem->>'playerId'\)::int where pp\.press_level = 'out' ?\)/,
  )
  assert.match(s, /order by n\.id desc limit \$2/)
  assert.deepEqual(q.params, ['quill', 3])
})

void test('reporter activity: real, not deleted, since; kind = feature, night, recap or reaction (rev 2, B2)', () => {
  const q = dialect.sqlToQuery(reporterActivitySql(new Date('2026-10-10T00:00:00Z')))
  const s = flat(q.sql)
  assert.match(s, /select n\.reporter, n\.night, n\.created_at, t\.reporter as reply_to,/)
  assert.match(
    s,
    /case when n\.kind = 'article' and n\.week_start is not null then 'feature' when n\.kind = 'article' and n\.match_id is not null then 'game' when n\.kind = 'article' then 'night' when n\.reply_to is null and not exists \( ?select 1 from news_items p where p\.kind = 'post' and p\.is_test = false and p\.match_id = n\.match_id and p\.id < n\.id ?\) then 'recap' else 'reaction' end as kind/,
  )
  assert.match(
    s,
    /from news_items n left join news_items t on t\.id = n\.reply_to where n\.is_test = false and n\.is_correction = false and n\.deleted_at is null/,
  )
  assert.match(s, /and n\.created_at >= \$1::timestamptz order by n\.id asc/)
  assert.deepEqual(q.params, ['2026-10-10T00:00:00.000Z'])
})

void test('reporter activity rows: night as a day, created_at as a Date, unknown kinds dropped', () => {
  assert.deepEqual(
    rowToActivity({
      reporter: 'quill',
      night: '2026-10-12',
      created_at: '2026-10-13T04:00:00.000Z',
      kind: 'recap',
    }),
    {
      reporter: 'quill',
      night: '2026-10-12',
      createdAt: new Date('2026-10-13T04:00:00.000Z'),
      kind: 'recap',
      replyTo: null,
    },
  )
  assert.equal(
    rowToActivity({
      reporter: 'barlow',
      night: '2026-10-12',
      created_at: '2026-10-13T04:00:00.000Z',
      kind: 'reaction',
      reply_to: 'mercer',
    })?.replyTo,
    'mercer',
  )
  assert.equal(
    rowToActivity({ reporter: 'barlow', night: null, created_at: new Date(), kind: 'game' })?.kind,
    'game',
  )
  assert.deepEqual(
    rowToActivity({
      reporter: 'vale',
      night: null,
      created_at: new Date('2026-10-13T04:00:00.000Z'),
      kind: 'feature',
    })?.night,
    null,
  )
  assert.equal(
    rowToActivity({ reporter: 'vale', night: null, created_at: new Date(), kind: 'other' }),
    null,
  )
})

void test('last feature: the newest real, not deleted item with a feature kind (rev 2, B5)', () => {
  const q = dialect.sqlToQuery(lastFeatureSql())
  const s = flat(q.sql)
  assert.match(s, /select n\.feature_kind, n\.prediction, n\.week_start from news_items n/)
  assert.match(
    s,
    /where n\.is_test = false and n\.deleted_at is null and n\.feature_kind is not null and n\.week_start is not null order by n\.week_start desc nulls last, n\.id desc limit 1/,
  )
  assert.deepEqual(q.params, [])
})

void test("night criticized: the night's not-deleted items; test items only when asked (rev 2, B4)", () => {
  const real = dialect.sqlToQuery(nightCriticizedSql('2026-10-12', false))
  const s = flat(real.sql)
  assert.match(
    s,
    /select n\.criticized from news_items n where n\.night = \$1::date and n\.deleted_at is null and \(n\.is_test = false or \$2\) order by n\.id asc/,
  )
  assert.deepEqual(real.params, ['2026-10-12', false])
  assert.deepEqual(dialect.sqlToQuery(nightCriticizedSql('2026-10-12', true)).params, [
    '2026-10-12',
    true,
  ])
})

void test('switch-on back-fill: skipped game and night jobs for the last 3 days, never overwriting a job', () => {
  assert.equal(NEWS_BACKLOG_MS, 3 * 86_400_000)
  const since = new Date('2026-10-21T12:00:00Z')
  const g = dialect.sqlToQuery(skipBacklogGamesSql(since))
  const gs = flat(g.sql)
  assert.match(gs, /insert into news_jobs \(kind, job_key, status, last_error\)/)
  assert.match(gs, /select 'game', m\.id::text, 'skipped', 'desk was off' from matches m/)
  assert.match(gs, /m\.played_at > \$1::timestamptz/)
  assert.match(gs, /on conflict \(kind, job_key\) do nothing$/)
  assert.deepEqual(g.params, ['2026-10-21T12:00:00.000Z'])

  const n = dialect.sqlToQuery(skipBacklogNightsSql(since))
  const ns = flat(n.sql)
  assert.ok(ns.includes(`select distinct 'night', to_char(${NIGHT('m')}, 'YYYY-MM-DD'), 'skipped'`))
  assert.match(ns, /m\.played_at > \$1::timestamptz/)
  assert.match(ns, /on conflict \(kind, job_key\) do nothing$/)
  assert.deepEqual(n.params, ['2026-10-21T12:00:00.000Z'])
})

void test('switch-on back-fill: the current and the previous week (Edmonton calendar) are skipped', () => {
  const q = dialect.sqlToQuery(skipBacklogWeeksSql(new Date('2026-10-24T20:00:00Z')))
  const s = flat(q.sql)
  assert.match(s, /select 'week', to_char\(w\.start, 'YYYY-MM-DD'\), 'skipped', 'desk was off'/)
  assert.match(
    s,
    /date_trunc\('week', \$1::timestamptz at time zone 'America\/Edmonton'\)::date as start union all select date_trunc\('week', \$2::timestamptz at time zone 'America\/Edmonton'\)::date - 7/,
  )
  assert.match(s, /on conflict \(kind, job_key\) do nothing$/)
  assert.deepEqual(q.params, ['2026-10-24T20:00:00.000Z', '2026-10-24T20:00:00.000Z'])
})

void test('soft delete: the item and its replies, only those not yet deleted', () => {
  const q = softDeleteNewsItemQuery(12).toSQL()
  const s = flat(q.sql)
  assert.match(s, /^update "news_items" set "deleted_at" = now\(\)/)
  assert.match(
    s,
    /where \(\("news_items"\."id" = \$\d+ or "news_items"\."reply_to" = \$\d+\) and "news_items"\."deleted_at" is null\)/,
  )
  assert.deepEqual(
    q.params.filter((p) => p === 12),
    [12, 12],
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

void test('raw feed row: criticized, prediction and feature kind (rev 2)', () => {
  const base = {
    id: '2',
    job_id: null,
    kind: 'article',
    reporter: 'pettibone',
    match_id: null,
    night: null,
    week_start: '2026-10-19',
    reply_to: null,
    slug: '2026-10-19-notes',
    headline: 'h',
    dek: null,
    body: 'b',
    summary: null,
    mentions: [],
    facts: null,
    is_test: false,
    discord_status: 'pending',
    discord_attempts: 0,
    discord_message_id: null,
    last_error: null,
    deleted_at: null,
    discord_deleted_at: null,
    created_at: '2026-10-26 18:00:00+00',
  } as const
  const asText = rawToNewsItem({
    ...base,
    criticized: JSON.stringify(['Hero Name']),
    prediction: 'They win the opener.',
    feature_kind: 'notes',
    receipt_verdict: 'hit',
  } as never)
  assert.equal(asText.receiptVerdict, 'hit')
  assert.deepEqual(asText.criticized, ['Hero Name'])
  assert.equal(asText.prediction, 'They win the opener.')
  assert.equal(asText.featureKind, 'notes')
  const asArray = rawToNewsItem({
    ...base,
    criticized: [],
    prediction: null,
    feature_kind: null,
  } as never)
  assert.deepEqual(asArray.criticized, [])
  assert.equal(asArray.prediction, null)
  assert.equal(asArray.featureKind, null)
  // A row from before the columns existed reads as empty.
  const old = rawToNewsItem(base as never)
  assert.deepEqual(old.criticized, [])
  assert.equal(old.prediction, null)
  assert.equal(old.featureKind, null)
  assert.equal(old.receiptVerdict, null)
  // Part C3a: zero_called and takes_used, as text or arrays; absent = [].
  assert.deepEqual(old.zeroCalled, [])
  assert.deepEqual(old.takesUsed, [])
  const c3 = rawToNewsItem({
    ...base,
    zero_called: JSON.stringify(['Hero Name']),
    takes_used: [4, 9],
  } as never)
  assert.deepEqual(c3.zeroCalled, ['Hero Name'])
  assert.deepEqual(c3.takesUsed, [4, 9])
  // Part C3b: rules_version; absent = null.
  assert.equal(old.rulesVersion, null)
  assert.equal(
    rawToNewsItem({ ...base, rules_version: '2026-10-25.1' } as never).rulesVersion,
    '2026-10-25.1',
  )
})

void test('schema: reporter ids match the cast; rev 2 columns and checks (pins)', () => {
  assert.deepEqual([...NEWS_REPORTER_IDS], [...REPORTER_IDS])
  const config = getTableConfig(newsItems)
  const cols = new Map(config.columns.map((c) => [c.name, c]))
  const criticized = cols.get('criticized')
  assert.ok(criticized)
  assert.equal(criticized.notNull, true)
  assert.equal(criticized.getSQLType(), 'jsonb')
  assert.deepEqual(criticized.default, [])
  assert.equal(cols.get('prediction')?.notNull, false)
  assert.equal(cols.get('prediction')?.getSQLType(), 'text')
  assert.equal(cols.get('feature_kind')?.notNull, false)
  assert.equal(cols.get('feature_kind')?.getSQLType(), 'text')
  const checkSql = (name: string): string => {
    const c = config.checks.find((x) => x.name === name)
    assert.ok(c, name)
    return flat(dialect.sqlToQuery(c.value).sql)
  }
  const reporter = checkSql('news_items_reporter_check')
  for (const id of REPORTER_IDS) assert.ok(reporter.includes(`'${id}'`), id)
  const kind = checkSql('news_items_feature_kind_check')
  assert.match(kind, /"news_items"\."feature_kind" is null or "news_items"\."feature_kind" in \(/i)
  for (const k of FEATURE_KINDS) assert.ok(kind.includes(`'${k}'`), k)
  assert.match(
    checkSql('news_items_prediction_feature_check'),
    /"news_items"\."prediction" is null or "news_items"\."feature_kind" is not null/i,
  )
  assert.match(
    checkSql('news_items_criticized_array_check'),
    /jsonb_typeof\("news_items"\."criticized"\) = 'array'/,
  )
})

void test('migration 0071: rev 2 columns; reporter check upgraded by drop and re-add (idempotent)', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  const text = flat(
    raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  )
  const ids = REPORTER_IDS.map((id) => `'${id}'`).join(', ')
  // A re-run on a database that has the old seven-id check replaces it.
  assert.ok(
    text.includes(
      `DO $$ BEGIN ALTER TABLE "news_items" DROP CONSTRAINT IF EXISTS "news_items_reporter_check"; ALTER TABLE "news_items" ADD CONSTRAINT "news_items_reporter_check" CHECK ("reporter" IN (${ids})); END $$;`,
    ),
    'reporter check drop + re-add',
  )
  // Only that one definition: no older add-if-missing block left behind.
  assert.equal(text.split('ADD CONSTRAINT "news_items_reporter_check"').length, 2)
  assert.ok(
    text.includes(
      `ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "criticized" jsonb DEFAULT '[]'::jsonb NOT NULL;`,
    ),
  )
  assert.ok(text.includes(`ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "prediction" text;`))
  assert.ok(text.includes(`ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "feature_kind" text;`))
  const kinds = FEATURE_KINDS.map((k) => `'${k}'`).join(', ')
  assert.ok(
    text.includes(
      `DO $$ BEGIN ALTER TABLE "news_items" DROP CONSTRAINT IF EXISTS "news_items_feature_kind_check"; ALTER TABLE "news_items" ADD CONSTRAINT "news_items_feature_kind_check" CHECK ("feature_kind" IS NULL OR "feature_kind" IN (${kinds})); END $$;`,
    ),
    'feature kind check',
  )
  assert.ok(
    text.includes(`CHECK ("prediction" IS NULL OR "feature_kind" IS NOT NULL)`),
    'prediction only on features',
  )
  assert.ok(text.includes(`CHECK (jsonb_typeof("criticized") = 'array')`), 'criticized is an array')
  // The columns are added before any check that names them, and inside the transaction.
  assert.ok(text.indexOf('"criticized" jsonb') < text.indexOf('jsonb_typeof("criticized")'))
  assert.ok(text.indexOf('BEGIN;') < text.indexOf('"criticized" jsonb'))
  assert.ok(text.indexOf('"feature_kind" text') < text.indexOf('COMMIT;'))
})

void test('db handle exists (builders need no connection)', () => {
  assert.ok(db)
})

void test('fact sheet matches: active title, not DNF, night key in the list, oldest first', () => {
  const q = dialect.sqlToQuery(listNewsNightMatchesSql(['2026-10-12', '2026-10-13']))
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.ok(s.includes(`to_char(${NIGHT('m')}, 'YYYY-MM-DD') in ($1, $2)`))
  assert.match(s, /order by m\.played_at, m\.id/)
  assert.deepEqual(q.params, ['2026-10-12', '2026-10-13'])
})

void test('fact sheet matches: includeInactive drops only the active-title condition (B2)', () => {
  const def = flat(
    dialect.sqlToQuery(listNewsNightMatchesSql(['2026-05-08'], { includeInactive: false })).sql,
  )
  assert.match(def, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  const q = dialect.sqlToQuery(listNewsNightMatchesSql(['2026-05-08'], { includeInactive: true }))
  const s = flat(q.sql)
  assert.ok(!/is_active/.test(s), s)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.ok(s.includes(`to_char(${NIGHT('m')}, 'YYYY-MM-DD') in ($1)`))
  assert.match(s, /order by m\.played_at, m\.id/)
  assert.deepEqual(q.params, ['2026-05-08'])
})

void test('title results: counted games up to the last game, bound taken from matches, newest first', () => {
  const q = dialect.sqlToQuery(listTitleResultsSql(4, 900))
  const s = flat(q.sql)
  assert.match(s, /m\.game_title_id = \$1/)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.match(s, /m\.played_at <= \( ?select l\.played_at from matches l where l\.id = \$2 ?\)/)
  assert.match(s, /order by m\.played_at desc, m\.id desc/)
  assert.deepEqual(q.params, [4, 900])
})

void test('recent nights: counted games grouped by night key, before the given night, newest first', () => {
  const q = dialect.sqlToQuery(
    listRecentNightSummariesSql({ gameTitleId: 4, before: '2026-10-12', limit: 3 }),
  )
  const s = flat(q.sql)
  assert.ok(s.includes(NIGHT('m')))
  assert.match(s, /m\.game_title_id = \$1 and m\.result <> 'DNF'/)
  assert.match(s, /x\.night < \$2::date/)
  assert.match(s, /group by x\.night order by x\.night desc limit \$3/)
  assert.match(s, /count\(\*\) filter \(where x\.result = 'OTL'\)/)
  assert.deepEqual(q.params, [4, '2026-10-12', 3])
})

void test('card events: counted kinds only, no AI goalies, window from the matches table', () => {
  const q = dialect.sqlToQuery(
    listNewsCardEventsSql({
      gameTitleId: 4,
      playerIds: [7, 8],
      firstMatchId: 900,
      lastMatchId: 902,
      afterMinutes: 10,
    }),
  )
  const s = flat(q.sql)
  assert.match(s, /ev\.game_title_id = \$1/)
  assert.match(s, /ev\.player_id in \(\$2, \$3\)/)
  assert.match(s, /p\.ai_goalie_side is null/)
  assert.match(s, /ev\.occurred_at >= \( ?select f\.played_at from matches f where f\.id = \$4 ?\)/)
  assert.match(
    s,
    /ev\.occurred_at <= \( ?select l\.played_at from matches l where l\.id = \$5 ?\) \+ make_interval\(mins => 10\)/,
  )
  assert.match(
    s,
    /\(\(ev\.kind = 'badge_level_up' and ev\.to_value > ev\.from_value\) or ev\.kind in \('level_up', 'tier_up', 'mythic_awarded'\)\)/,
  )
  assert.match(s, /order by ev\.occurred_at, ev\.id/)
  assert.deepEqual(q.params.slice(0, 3), [4, 7, 8])
})

void test('title totals: counted games, before the first game and through the last, from matches', () => {
  const q = dialect.sqlToQuery(
    listPlayerTitleTotalsSql({
      gameTitleId: 4,
      playerIds: [7],
      firstMatchId: 900,
      lastMatchId: 902,
    }),
  )
  const s = flat(q.sql)
  assert.match(s, /from player_match_stats pms join matches m on m\.id = pms\.match_id/)
  assert.match(s, /m\.game_title_id = \$\d+/)
  assert.doesNotMatch(s, /DNF/, 'DNF games count, like player_game_title_stats on the site')
  assert.match(
    s,
    /filter \(where m\.played_at < \( ?select f\.played_at from matches f where f\.id = \$\d+ ?\)\)/,
  )
  assert.match(s, /m\.played_at <= \( ?select l\.played_at from matches l where l\.id = \$\d+ ?\)/)
  assert.match(s, /group by pms\.player_id/)
})

void test('migration 0071: skipped back-fill for every game, night and week, idempotent', async () => {
  const { readFile } = await import('node:fs/promises')
  const text = flat(
    await readFile(new URL('../../../migrations/0071_news_desk.sql', import.meta.url), 'utf8'),
  )
  for (const kind of ['game', 'night', 'week']) {
    assert.match(
      text,
      new RegExp(
        `INSERT INTO "news_jobs" \\("kind", "job_key", "status", "last_error"\\) SELECT (DISTINCT )?'${kind}',[^;]*'skipped', 'before launch' FROM "matches" m ON CONFLICT \\("kind", "job_key"\\) DO NOTHING;`,
      ),
      kind,
    )
  }
  // M3: the week key is the Monday of the night key's week.
  assert.ok(
    text.includes(
      `to_char(date_trunc('week', (m."played_at" AT TIME ZONE 'America/Edmonton') - interval '6 hours')::date, 'YYYY-MM-DD')`,
    ),
  )
})

void test('backfill lookups: a post by match, reporter and body; an article by slug; deleted and test rows count (B3)', () => {
  const p = findNewsPostQuery({ matchId: 250, reporter: 'barlow', body: 'Hello.' }).toSQL()
  const ps = flat(p.sql)
  assert.match(ps, /from "news_items"/)
  assert.match(ps, /"news_items"\."kind" = \$1/)
  assert.match(ps, /"news_items"\."match_id" = \$2/)
  assert.match(ps, /"news_items"\."reporter" = \$3/)
  assert.match(ps, /"news_items"\."body" = \$4/)
  assert.ok(!/deleted_at|is_test/.test(ps), ps)
  assert.deepEqual(p.params.slice(0, 4), ['post', 250, 'barlow', 'Hello.'])
  const a = findNewsArticleQuery('2026-05-08-a-night').toSQL()
  const as = flat(a.sql)
  assert.match(as, /"news_items"\."slug" = \$1/)
  assert.ok(!/deleted_at|is_test/.test(as), as)
  assert.deepEqual(a.params.slice(0, 1), ['2026-05-08-a-night'])
})

void test('week history games: one title, not DNF, night key in [from, to), oldest first (A4)', () => {
  const q = dialect.sqlToQuery(
    listNewsHistoryGamesSql({ gameTitleId: 7, from: '2026-09-21', to: '2026-10-19' }),
  )
  const s = flat(q.sql)
  assert.match(
    s,
    /select m\.id, to_char\(x\.night, 'YYYY-MM-DD'\) as night, m\.result, m\.score_for, m\.score_against, m\.shots_for, m\.shots_against, m\.pp_goals, m\.pp_opportunities, m\.time_on_attack, bgm\.credited_goals from matches m/,
  )
  // C1 fix 4: the club rows' goals, for the ended-early rule.
  assert.match(
    s,
    /left join lateral \( select coalesce\(sum\(greatest\(p\.goals, 0\)\), 0\) as credited_goals from player_match_stats p where p\.match_id = m\.id \) bgm on true/,
  )
  assert.ok(s.includes(NIGHT('m')), 'night expression')
  assert.match(s, /m\.game_title_id = \$\d+/)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.match(s, /x\.night >= \$\d+::date and x\.night < \$\d+::date/)
  assert.match(s, /order by m\.played_at, m\.id/)
  // No active-title join: the caller passes the title of the sheet it already allowed.
  assert.doesNotMatch(s, /is_active/)
  assert.deepEqual(q.params, [7, '2026-09-21', '2026-10-19'])
})

void test("norm games: the title's counted games before the sheet's first game, page shots, pass sums (C1.2)", () => {
  const q = dialect.sqlToQuery(listNewsNormGamesSql({ gameTitleId: 7, beforeMatchId: 900 }))
  const s = flat(q.sql)
  // A side with a reviewed period missing its value is not a total: EA's count (match 979).
  assert.match(
    s,
    /case when count\(\*\) = count\(s\.shots_for\) then sum\(s\.shots_for\) end as shots_for, case when count\(\*\) = count\(s\.shots_against\) then sum\(s\.shots_against\) end as shots_against/,
  )
  assert.match(s, /from matches m join matches l on l\.id = \$\d+/)
  assert.match(s, /m\.game_title_id = \$\d+/)
  assert.match(s, /m\.result <> 'DNF'/)
  // Strictly before the first game of the sheet (ties on played_at broken by id).
  assert.match(s, /\(m\.played_at, m\.id\) < \(l\.played_at, l\.id\)/)
  // Shots as the match page shows them: reviewed OCR period rows over EA's count.
  assert.match(
    s,
    /coalesce\(ocr\.shots_for, m\.shots_for\) as shots_for, coalesce\(ocr\.shots_against, m\.shots_against\) as shots_against/,
  )
  assert.match(
    s,
    /from match_period_summaries s where s\.match_id = m\.id and s\.source = 'ocr' and s\.shots_review_status = 'reviewed' and s\.period_number <> -1/,
  )
  // Pass % from the player rows of both sides (as the page's Pass % row), credited goals from the club rows.
  assert.match(
    s,
    /coalesce\(sum\(p\.pass_attempts\), 0\) as pass_attempts, coalesce\(sum\(p\.pass_completions\), 0\) as pass_completions, coalesce\(sum\(greatest\(p\.goals, 0\)\), 0\) as credited_goals from player_match_stats p where p\.match_id = m\.id/,
  )
  assert.match(s, /from opponent_player_match_stats o where o\.match_id = m\.id/)
  assert.match(
    s,
    /m\.time_on_attack, m\.time_on_attack_against, m\.pp_goals, m\.pp_opportunities, m\.pp_goals_against, m\.pp_opportunities_against/,
  )
  assert.match(s, /order by m\.played_at, m\.id$/)
  assert.doesNotMatch(s, /is_active/)
  assert.deepEqual(q.params, [900, 7])
  // C2: the mode, result, score, opponent and night of each game (mode-split norms, team context).
  assert.match(
    s,
    new RegExp(
      `select m\\.id, to_char\\(${NIGHT('m').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, 'YYYY-MM-DD'\\) as night, m\\.game_mode, m\\.result, m\\.score_for, m\\.score_against, m\\.opponent_name,`,
    ),
  )
})

void test('norm games: raw rows become numbers; nulls stay null (C1.2)', () => {
  assert.deepEqual(
    rowToNormGame({
      id: '12',
      night: '2026-10-12',
      game_mode: '3s',
      result: 'OTL',
      score_against: '4',
      opponent_name: 'Rivals  HC',
      score_for: 3,
      credited_goals: '2',
      hits_for: 9,
      hits_against: 11,
      shots_for: '25',
      shots_against: 20,
      time_on_attack: 400,
      time_on_attack_against: null,
      pp_goals: 1,
      pp_opportunities: 3,
      pp_goals_against: null,
      pp_opportunities_against: '2',
      pass_attempts: '150',
      pass_completions: '120',
      opp_pass_attempts: 0,
      opp_pass_completions: '0',
    }),
    {
      id: 12,
      night: '2026-10-12',
      gameMode: '3s',
      result: 'OTL',
      scoreAgainst: 4,
      opponentName: 'Rivals  HC',
      scoreFor: 3,
      creditedGoals: 2,
      hitsFor: 9,
      hitsAgainst: 11,
      shotsFor: 25,
      shotsAgainst: 20,
      timeOnAttack: 400,
      timeOnAttackAgainst: null,
      ppGoals: 1,
      ppOpportunities: 3,
      ppGoalsAgainst: null,
      ppOpportunitiesAgainst: 2,
      passAttempts: 150,
      passCompletions: 120,
      passAttemptsAgainst: 0,
      passCompletionsAgainst: 0,
    },
  )
})

void test("night posts for the prompt: the night's not-deleted posts, oldest first; test items only when asked (C1.8)", () => {
  const real = dialect.sqlToQuery(nightPostsForPromptSql('2026-10-12', false))
  const s = flat(real.sql)
  assert.match(
    s,
    /select n\.reporter, n\.body from news_items n where n\.kind = 'post' and n\.is_correction = false and n\.night = \$1::date and n\.deleted_at is null and \(n\.is_test = false or \$2\) order by n\.created_at asc, n\.id asc/,
  )
  assert.deepEqual(real.params, ['2026-10-12', false])
  assert.deepEqual(dialect.sqlToQuery(nightPostsForPromptSql('2026-10-12', true)).params, [
    '2026-10-12',
    true,
  ])
  assert.deepEqual(rowToNightPost({ reporter: 'quill', body: 'Outshot 30-21.' }), {
    reporter: 'quill',
    text: 'Outshot 30-21.',
  })
})

void test("player games: the named players' rows in every title up to the sheet's last game, with the ended-early inputs (C2.3)", () => {
  const q = dialect.sqlToQuery(listNewsPlayerGamesSql({ playerIds: [2, 5], lastMatchId: 900 }))
  const s = flat(q.sql)
  // A side with a reviewed period missing its value is not a total: EA's count (match 979).
  assert.match(
    s,
    /case when count\(\*\) = count\(s\.shots_for\) then sum\(s\.shots_for\) end as shots_for, case when count\(\*\) = count\(s\.shots_against\) then sum\(s\.shots_against\) end as shots_against/,
  )
  // The matches of those players, once each, bounded by the last game (ties on played_at by id).
  assert.match(
    s,
    /with g as \( select distinct pms\.match_id from player_match_stats pms where pms\.player_id in \(\$1, \$2\) \)/,
  )
  assert.match(s, /join matches l on l\.id = \$3/)
  assert.match(s, /where \(m\.played_at, m\.id\) <= \(l\.played_at, l\.id\)/)
  // Every title and every result (DNF rows count for the title totals; callers skip them for runs and norms).
  assert.doesNotMatch(s, /game_title_id = /)
  assert.doesNotMatch(s, /DNF/)
  // Shots as the match page shows them, credited goals of the club rows.
  assert.match(s, /coalesce\(ocr\.shots_for, m\.shots_for\) as shots_for/)
  assert.match(
    s,
    /s\.source = 'ocr' and s\.shots_review_status = 'reviewed' and s\.period_number <> -1/,
  )
  assert.match(s, /coalesce\(sum\(greatest\(p\.goals, 0\)\), 0\) as credited_goals/)
  assert.match(
    s,
    /select pms\.player_id, mg\.id as match_id, mg\.game_title_id, mg\.night, mg\.played_at, mg\.game_mode, mg\.result, pms\.goals, pms\.assists, pms\.shots, pms\.hits, pms\.position, pms\.is_goalie,/,
  )
  assert.match(
    s,
    /where pms\.player_id in \(\$4, \$5\) order by pms\.player_id, mg\.played_at, mg\.id$/,
  )
  assert.deepEqual(q.params, [2, 5, 900, 2, 5])
  assert.deepEqual(
    rowToPlayerGame({
      player_id: '2',
      match_id: '901',
      game_title_id: 3,
      night: '2026-05-08',
      played_at: new Date('2026-05-09T01:00:00Z'),
      game_mode: '6s',
      result: 'DNF',
      goals: 1,
      assists: '0',
      shots: 3,
      hits: 2,
      position: 'center',
      is_goalie: false,
      score_for: 2,
      credited_goals: '2',
      time_on_attack: null,
      shots_for: '20',
      shots_against: 18,
    }),
    {
      playerId: 2,
      matchId: 901,
      gameTitleId: 3,
      night: '2026-05-08',
      playedAt: '2026-05-09T01:00:00.000Z',
      gameMode: '6s',
      result: 'DNF',
      goals: 1,
      assists: 0,
      shots: 3,
      hits: 2,
      position: 'center',
      isGoalie: false,
      scoreFor: 2,
      creditedGoals: 2,
      timeOnAttack: null,
      shotsFor: 20,
      shotsAgainst: 18,
    },
  )
})

void test('players with other seasons: archive or EA season rows of an earlier (or unordered) title (C2.5 debuts)', () => {
  const q = dialect.sqlToQuery(
    listNewsPlayersWithOtherSeasonsSql({ playerIds: [2], gameTitleId: 7 }),
  )
  const s = flat(q.sql)
  for (const t of [
    'historical_player_season_stats',
    'historical_club_member_season_stats',
    'ea_member_season_stats',
  ]) {
    assert.ok(s.includes(`from ${t} x`), t)
  }
  assert.match(s, /x\.game_title_id <> \$\d+/)
  assert.match(
    s,
    /\(t\.release_order is null or cur\.release_order is null or t\.release_order < cur\.release_order\)/,
  )
  assert.match(s, /where p\.id in \(\$\d+\)/)
})

void test("title season totals: every human player's rows of the title before the sheet's first game (C2.4 records)", () => {
  const q = dialect.sqlToQuery(listNewsTitleSeasonTotalsSql({ gameTitleId: 7, beforeMatchId: 900 }))
  const s = flat(q.sql)
  assert.match(
    s,
    /coalesce\(sum\(pms\.goals\), 0\) as goals, coalesce\(sum\(pms\.assists\), 0\) as assists, count\(\*\) as games/,
  )
  assert.match(s, /join matches l on l\.id = \$1/)
  assert.match(
    s,
    /where m\.game_title_id = \$2 and p\.ai_goalie_side is null and \(m\.played_at, m\.id\) < \(l\.played_at, l\.id\)/,
  )
  // Every result: DNF rows count, like the title totals.
  assert.doesNotMatch(s, /DNF/)
  assert.match(s, /group by pms\.player_id, p\.gamertag$/)
  assert.deepEqual(q.params, [900, 7])
})

void test('club record lines: stored games per title, else the reviewed club archive; Boogeymen only (C2.4, 2026-10-25)', () => {
  const q = dialect.sqlToQuery(listNewsClubRecordLinesSql())
  const s = flat(q.sql)
  // Stored games: every row of the title, AI goalies left out.
  assert.match(
    s,
    /from player_match_stats pms join players p on p\.id = pms\.player_id join matches m on m\.id = pms\.match_id where p\.ai_goalie_side is null group by pms\.player_id, m\.game_title_id/,
  )
  // The Stats page's club archive, only for a title without stored games.
  assert.match(s, /from historical_club_member_season_stats h/)
  assert.match(s, /h\.review_status = 'reviewed' and h\.role_group = 'skater'/)
  assert.match(
    s,
    /not exists \(select 1 from matches sm where sm\.game_title_id = h\.game_title_id\)/,
  )
  // Never the player-card totals of other clubs or EA's member totals.
  assert.doesNotMatch(s, /historical_player_season_stats|ea_member_season_stats/)
  assert.deepEqual(q.params, [])
})

void test('stances for threads: the given keys, oldest first; stances of deleted or test items left out (C2.8)', () => {
  const q = dialect.sqlToQuery(
    stancesForThreadsSql(['player-slump:2@2026-05-08', 'pp-drought@2026-05-10']),
  )
  const s = flat(q.sql)
  assert.match(s, /from news_stances s left join news_items i on i\.id = s\.item_id/)
  assert.match(s, /where s\.thread_key in \(\$1, \$2\)/)
  assert.match(s, /and \(s\.item_id is null or \(i\.deleted_at is null and i\.is_test = false\)\)/)
  assert.match(s, /to_char\(s\.night, 'YYYY-MM-DD'\) as night/)
  assert.match(s, /order by s\.night asc nulls last, s\.id asc$/)
  assert.deepEqual(q.params, ['player-slump:2@2026-05-08', 'pp-drought@2026-05-10'])
})

void test('migration 0071: news_stances (C2.8) is idempotent; reporter check drop and re-add; cascade with the item', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  const text = flat(
    raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  )
  const ids = REPORTER_IDS.map((id) => `'${id}'`).join(', ')
  assert.ok(
    text.includes(
      'CREATE TABLE IF NOT EXISTS "news_stances" ( "id" bigserial PRIMARY KEY NOT NULL, "thread_key" text NOT NULL, "reporter" text NOT NULL, "stance" text NOT NULL, "night" date, "item_id" bigint REFERENCES "news_items"("id") ON DELETE CASCADE, "created_at" timestamp with time zone DEFAULT now() NOT NULL );',
    ),
  )
  assert.ok(
    text.includes(
      `DO $$ BEGIN ALTER TABLE "news_stances" DROP CONSTRAINT IF EXISTS "news_stances_reporter_check"; ALTER TABLE "news_stances" ADD CONSTRAINT "news_stances_reporter_check" CHECK ("reporter" IN (${ids})); END $$;`,
    ),
  )
  assert.ok(
    text.includes(
      'CREATE INDEX IF NOT EXISTS "news_stances_thread_key_idx" ON "news_stances" ("thread_key");',
    ),
  )
  // Inside the transaction.
  assert.ok(text.indexOf('"news_stances"') < text.indexOf('COMMIT;'))
})

void test("prediction scorecards: the judged feature's author gets the verdict; title and week bounds (C2.9)", () => {
  const all = flat(dialect.sqlToQuery(predictionScorecardsSql({})).sql)
  assert.match(
    all,
    /count\(\*\) filter \(where f\.receipt_verdict = 'hit'\) as hits, count\(\*\) filter \(where f\.receipt_verdict = 'miss'\) as misses/,
  )
  assert.match(
    all,
    /join lateral \( select n\.reporter, n\.prediction from news_items n where n\.is_test = false and n\.deleted_at is null and n\.feature_kind is not null and n\.week_start < f\.week_start order by n\.week_start desc, n\.id desc limit 1 \) p on true/,
  )
  assert.match(
    all,
    /where f\.is_test = false and f\.deleted_at is null and f\.feature_kind is not null and f\.receipt_verdict is not null and p\.prediction is not null/,
  )
  assert.match(all, /group by p\.reporter order by p\.reporter$/)
  assert.doesNotMatch(all, /game_title_id/)
  const q = dialect.sqlToQuery(
    predictionScorecardsSql({ gameTitleId: 7, beforeWeek: '2026-05-18' }),
  )
  const s = flat(q.sql)
  assert.match(
    s,
    /select 1 from matches m where m\.game_title_id = \$1 and date_trunc\('week', \(\(m\.played_at at time zone 'America\/Edmonton'\) - interval '6 hours'\)::date\)::date = f\.week_start/,
  )
  assert.match(s, /and f\.week_start < \$2::date/)
  assert.deepEqual(q.params, [7, '2026-05-18'])
})

void test('migration 0071: receipt_verdict hit | miss on features only (C2.9)', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  const text = flat(
    raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  )
  assert.ok(
    text.includes('ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "receipt_verdict" text;'),
  )
  assert.ok(
    text.includes(
      `DO $$ BEGIN ALTER TABLE "news_items" DROP CONSTRAINT IF EXISTS "news_items_receipt_verdict_check"; ALTER TABLE "news_items" ADD CONSTRAINT "news_items_receipt_verdict_check" CHECK ("receipt_verdict" IS NULL OR ("receipt_verdict" IN ('hit', 'miss') AND "feature_kind" IS NOT NULL)); END $$;`,
    ),
  )
  // The column comes before its check.
  assert.ok(
    text.indexOf('"receipt_verdict" text') < text.indexOf('news_items_receipt_verdict_check'),
  )
})

void test('night zero-called (C3a): tonight and the previous night with items; test items only when asked', () => {
  const q = dialect.sqlToQuery(nightZeroCalledSql('2026-10-12', false))
  const s = flat(q.sql)
  assert.match(
    s,
    /select to_char\(n\.night, 'YYYY-MM-DD'\) as night, n\.zero_called from news_items n where n\.deleted_at is null and \(n\.is_test = false or \$1\) and \( n\.night = \$2::date or n\.night = \( select max\(p\.night\) from news_items p where p\.night < \$3::date and p\.deleted_at is null and \(p\.is_test = false or \$4\) \) \) order by n\.id asc/,
  )
  assert.deepEqual(q.params, [false, '2026-10-12', '2026-10-12', false])
  assert.deepEqual(
    rowsToNightZeroCalled('2026-10-12', [
      { night: '2026-10-08', zero_called: ['Old Name'] },
      { night: '2026-10-12', zero_called: JSON.stringify(['Hero Name']) },
      { night: '2026-10-12', zero_called: ['Hero Name'] },
      { night: '2026-10-12', zero_called: null },
    ]),
    { tonight: ['Hero Name'], previous: ['Old Name'] },
  )
})

void test('migration 0071: zero_called and takes_used arrays (C3a), idempotent checks', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  const text = flat(
    raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  )
  for (const col of ['zero_called', 'takes_used']) {
    assert.ok(
      text.includes(
        `ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "${col}" jsonb DEFAULT '[]'::jsonb NOT NULL;`,
      ),
      col,
    )
    assert.ok(
      text.includes(
        `DO $$ BEGIN ALTER TABLE "news_items" DROP CONSTRAINT IF EXISTS "news_items_${col}_array_check"; ALTER TABLE "news_items" ADD CONSTRAINT "news_items_${col}_array_check" CHECK (jsonb_typeof("${col}") = 'array'); END $$;`,
      ),
      col,
    )
  }
  const cols = getTableConfig(newsItems).columns.map((c) => c.name)
  assert.ok(cols.includes('zero_called') && cols.includes('takes_used'))
})

void test('migration 0071: news_items.rules_version (C3b.2), idempotent add', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  assert.ok(raw.includes('ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "rules_version" text;'))
  const cols = getTableConfig(newsItems).columns.map((c) => c.name)
  assert.ok(cols.includes('rules_version'))
})

void test('reporter takes (C3a.6): active takes on the players; last use per take from items', () => {
  const q = activeTakesForPlayersQuery([2, 5]).toSQL()
  assert.match(
    flat(q.sql),
    /from "news_reporter_takes" where \("news_reporter_takes"\."active" = \$1 and "news_reporter_takes"\."player_id" in \(\$2, \$3\)\) order by "news_reporter_takes"\."id" asc/,
  )
  assert.deepEqual(q.params, [true, 2, 5])
  const u = dialect.sqlToQuery(takesUsedSinceSql(new Date('2026-10-18T00:00:00Z'), false))
  assert.match(
    flat(u.sql),
    /select \(e\.value\)::bigint as take_id, max\(n\.created_at\) as last_used from news_items n cross join lateral jsonb_array_elements\(n\.takes_used\) as e\(value\) where n\.deleted_at is null and \(n\.is_test = false or \$1\) and n\.created_at >= \$2::timestamptz group by 1 order by 1/,
  )
  assert.deepEqual(u.params, [false, '2026-10-18T00:00:00.000Z'])
})

void test('migration 0071: news_reporter_takes (C3a.6), idempotent checks, cascade with the player', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  const text = flat(
    raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  )
  assert.ok(text.includes('CREATE TABLE IF NOT EXISTS "news_reporter_takes" ('))
  assert.ok(
    text.includes('"player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE'),
  )
  assert.ok(text.includes(`"spread" text DEFAULT 'some' NOT NULL`))
  assert.ok(text.includes(`"critics" jsonb DEFAULT '[]'::jsonb NOT NULL`))
  assert.ok(text.includes('"active" boolean DEFAULT true NOT NULL'))
  assert.ok(text.includes('"intensity" integer DEFAULT 0 NOT NULL'))
  for (const c of ['reporter', 'defender', 'spread', 'intensity', 'critics_array']) {
    assert.ok(
      text.includes(
        `ALTER TABLE "news_reporter_takes" DROP CONSTRAINT IF EXISTS "news_reporter_takes_${c}_check";`,
      ),
      c,
    )
  }
  assert.ok(text.includes(`CHECK ("intensity" BETWEEN -2 AND 2)`))
  assert.ok(text.includes(`CHECK ("spread" IN ('some', 'a few', 'most'))`))
  assert.ok(text.includes('CREATE INDEX IF NOT EXISTS "news_reporter_takes_player_idx"'))
  assert.ok(raw.includes('DROP TABLE IF EXISTS "news_reporter_takes";'))
})

void test('recent reporter pieces (C3a.3): posts and articles, newest first; test items only when asked; never an "out" mention', () => {
  const q = dialect.sqlToQuery(recentReporterPiecesSql('quill', 5, false))
  const s = flat(q.sql)
  assert.match(
    s,
    /select n\.kind, n\.body, n\.headline, n\.summary, n\.night from news_items n where \(n\.is_test = false or \$1\) and n\.is_correction = false and n\.deleted_at is null and n\.reporter = \$2 and not exists/,
  )
  assert.match(s, /where pp\.press_level = 'out' ?\) order by n\.id desc limit \$3/)
  assert.deepEqual(q.params, [false, 'quill', 5])
  assert.deepEqual(
    rowToOwnPiece({
      kind: 'post',
      body: 'A post.',
      headline: null,
      summary: null,
      night: '2026-10-12',
    }),
    { kind: 'post', text: 'A post.', night: '2026-10-12' },
  )
  assert.deepEqual(
    rowToOwnPiece({ kind: 'article', body: 'b', headline: 'H', summary: 'S.', night: null }),
    { kind: 'article', text: 'H — S.', night: null },
  )
})

void test('game article retries (C3a.8): failed game_article jobs under the cap since a time', () => {
  const q = dialect.sqlToQuery(
    listGameArticleRetriesSql({ since: new Date('2026-10-24T00:00:00Z'), limit: 5 }),
  )
  assert.match(
    flat(q.sql),
    /select j\.job_key from news_jobs j where j\.kind = 'game_article' and j\.status = 'failed' and j\.attempts < 3 and j\.updated_at >= \$1::timestamptz order by j\.id asc limit \$2/,
  )
  assert.deepEqual(q.params, ['2026-10-24T00:00:00.000Z', 5])
})

void test('migration 0071: the job kind check gains game_article by drop and re-add (C3a.8)', async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  const text = flat(
    raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  )
  assert.ok(
    text.includes(
      `DO $$ BEGIN ALTER TABLE "news_jobs" DROP CONSTRAINT IF EXISTS "news_jobs_kind_check"; ALTER TABLE "news_jobs" ADD CONSTRAINT "news_jobs_kind_check" CHECK ("kind" IN ('game', 'night', 'week', 'game_article')); END $$;`,
    ),
  )
})

void test('C3b.3: the per-reporter switch: query, table and idempotent migration', async () => {
  const q = disabledReportersQuery().toSQL()
  assert.match(
    flat(q.sql),
    /select "reporter" from "news_reporter_switch" where "news_reporter_switch"\."enabled" = \$1 order by "news_reporter_switch"\."reporter" asc/,
  )
  assert.deepEqual(q.params, [false])
  const cols = new Map(getTableConfig(newsReporterSwitch).columns.map((c) => [c.name, c]))
  assert.equal(cols.get('reporter')?.primary, true)
  assert.equal(cols.get('enabled')?.default, true)
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  const text = flat(
    raw
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n'),
  )
  assert.ok(text.includes('CREATE TABLE IF NOT EXISTS "news_reporter_switch" ('))
  assert.ok(text.includes('"enabled" boolean DEFAULT true NOT NULL'))
  assert.ok(
    text.includes(
      'ALTER TABLE "news_reporter_switch" DROP CONSTRAINT IF EXISTS "news_reporter_switch_reporter_check";',
    ),
  )
  assert.ok(raw.includes('DROP TABLE IF EXISTS "news_reporter_switch";'))
  // The check holds exactly the nine reporter ids.
  const check = /news_reporter_switch_reporter_check"\s+CHECK \("reporter" IN \(([^)]*)\)\)/.exec(
    raw,
  )
  assert.ok(check)
  const ids = [...check[1]!.matchAll(/'(\w+)'/g)].map((m) => m[1])
  assert.deepEqual([...ids].sort(), [...NEWS_REPORTER_IDS].sort())
})

void test('C3b.4: waiting posts: due query, claim and the send_after column', async () => {
  const d = dueNewsItemsQuery(new Date('2026-10-24T12:00:00Z'), 20).toSQL()
  assert.match(
    flat(d.sql),
    /from "news_items" where \("news_items"\."discord_status" = \$1 and "news_items"\."send_after" is not null and "news_items"\."send_after" <= \$2 and "news_items"\."is_test" = \$3 and "news_items"\."deleted_at" is null and not exists \( select 1 from news_items r where r\.job_id = "news_items"\."job_id" and r\.id < "news_items"\."id" and r\.deleted_at is null and r\.send_after is null and r\.discord_status = 'failed' and r\.discord_attempts < 3 \)\) order by "news_items"\."send_after" asc, "news_items"\."id" asc limit \$4/,
  )
  assert.deepEqual(d.params, ['pending', '2026-10-24T12:00:00.000Z', false, 20])
  const c = claimDueNewsItemQuery(7).toSQL()
  assert.match(
    flat(c.sql),
    /update "news_items" set "send_after" = \$1 where \("news_items"\."id" = \$2 and "news_items"\."discord_status" = \$3 and "news_items"\."send_after" is not null and "news_items"\."deleted_at" is null\) returning "id"/,
  )
  assert.deepEqual(c.params, [null, 7, 'pending'])
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  assert.ok(
    raw.includes(
      'ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "send_after" timestamp with time zone;',
    ),
  )
  assert.ok(raw.includes('CREATE INDEX IF NOT EXISTS "news_items_send_after_idx"'))
  const cols = getTableConfig(newsItems).columns.map((x) => x.name)
  assert.ok(cols.includes('send_after'))
})

void test('C3b.6/7: admin takes and quality items: SQL pins and row mappers', () => {
  const t = dialect.sqlToQuery(adminTakesSql())
  assert.match(
    flat(t.sql),
    /from news_reporter_takes t join players p on p\.id = t\.player_id left join player_profiles pp on pp\.player_id = t\.player_id order by lower\(coalesce\(nullif\(btrim\(pp\.player_name\), ''\), p\.gamertag\)\), t\.id/,
  )
  const take = rowToAdminTake({
    id: '7',
    reporter: 'mercer',
    player_id: '2',
    player_name: 'Skater B',
    take: 'INVENTED',
    spread: 'some',
    critics: JSON.stringify(['voss']),
    defender: null,
    data_angle: null,
    active: true,
    intensity: '-1',
    updated_at: '2026-10-25 12:00:00+00',
  })
  assert.equal(take.id, 7)
  assert.equal(take.playerId, 2)
  assert.deepEqual(take.critics, ['voss'])
  assert.equal(take.intensity, -1)
  assert.equal(take.updatedAt.toISOString(), '2026-10-25T12:00:00.000Z')

  const q = dialect.sqlToQuery(qualityItemsSql(new Date('2026-09-25T00:00:00Z')))
  assert.match(
    flat(q.sql),
    /from news_items n where n\.deleted_at is null and n\.is_test = false and n\.is_correction = false and n\.created_at >= \$1::timestamptz order by n\.id/,
  )
  // The result is the sheet game with the ITEM's match id, not the first game on the sheet.
  assert.match(
    flat(q.sql),
    /select g\.value->>'result' from jsonb_array_elements\(n\.facts->'games'\) as g where \(g\.value->>'matchId'\)::bigint = n\.match_id limit 1/,
  )
  assert.ok(!flat(q.sql).includes("->0->>'result'"))
  assert.deepEqual(q.params, ['2026-09-25T00:00:00.000Z'])
  const item = rowToQualityItem({
    reporter: 'voss',
    kind: 'post',
    body: 'b',
    mentions: JSON.stringify([{ name: 'Skater A', playerId: 1 }]),
    zero_called: ['Skater B'],
    takes_used: '[7]',
    result: 'WIN',
  })
  assert.deepEqual(
    item.mentions.map((m) => m.name),
    ['Skater A'],
  )
  assert.deepEqual(item.takesUsed, [7])
})

void test('C3b.7: the takes editor update: only the editable columns, by id', () => {
  const u = updateAdminTakeQuery(7, {
    take: 'INVENTED',
    spread: 'most',
    critics: ['voss'],
    defender: null,
    dataAngle: null,
    intensity: 2,
    active: false,
  }).toSQL()
  assert.match(
    flat(u.sql),
    /^update "news_reporter_takes" set "take" = \$1, "spread" = \$2, "critics" = \$3, "defender" = \$4, "data_angle" = \$5, "active" = \$6, "intensity" = \$7, "updated_at" = now\(\) where "news_reporter_takes"\."id" = \$8 returning "id"$/,
  )
  assert.equal(u.params[7], 7)
  assert.ok(!/reporter" =|player_id" =/.test(flat(u.sql)), 'holder and player are not editable')
})

void test('C3b.9: the seed resolves names against human players and profile names', () => {
  const q = dialect.sqlToQuery(seedPlayersSql())
  assert.match(
    flat(q.sql),
    /select p\.id, p\.gamertag, nullif\(btrim\(pp\.player_name\), ''\) as name from players p left join player_profiles pp on pp\.player_id = p\.id where p\.ai_goalie_side is null order by p\.id/,
  )
})

void test('C3b fix: is_correction column and the held-posts skip on switch-on', async () => {
  const q = dialect.sqlToQuery(skipHeldPostsSql())
  assert.match(
    flat(q.sql),
    /update news_items set discord_status = 'skipped', send_after = null, last_error = 'held while the desk was off' where discord_status = 'pending' and send_after is not null and is_correction = false/,
  )
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(
    new URL('../../../migrations/0071_news_desk.sql', import.meta.url),
    'utf8',
  )
  assert.ok(
    raw.includes(
      'ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "is_correction" boolean DEFAULT false NOT NULL;',
    ),
  )
  assert.ok(getTableConfig(newsItems).columns.some((c) => c.name === 'is_correction'))
})
