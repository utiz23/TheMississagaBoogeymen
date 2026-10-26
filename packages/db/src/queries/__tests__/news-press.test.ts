/**
 * SQL-shape pins for the press queries (news desk bots, migration 0072). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news-press.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import {
  NEWS_JOB_KINDS,
  newsGmNotes,
  newsPlayerAliases,
  newsPressMirrors,
  newsPressSettings,
  newsReactionTriggers,
  newsReactionVotes,
  newsScrumAnswers,
  newsScrumPeople,
  newsScrums,
} from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const {
  claimPingQuery,
  listExpiredPingsSql,
  listExpiredQuestionsSql,
  nightHasActiveScrumSql,
  nightPressMaterialSql,
  nightPressNotesSql,
  listRecapItemsWithoutScrumSql,
  listPressRosterSql,
  countAutoPingsTonightSql,
  countCommandUsesTonightSql,
  consumeNextHeatSql,
  listItemsToMirrorQuery,
  listMirrorDeletionsSql,
  listReactionTriggersWithoutJobSql,
  insertScrumQuery,
  insertScrumPersonQuery,
  insertReactionVoteQuery,
  insertReactionTriggerQuery,
  PRESS_ACCEPT_WINDOW_MS,
  PRESS_ANSWER_WINDOW_MS,
} = await import('../news-press.js')
const { nightCriticizedSql } = await import('../news.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test("job kinds include 'reaction'", () => {
  assert.ok((NEWS_JOB_KINDS as readonly string[]).includes('reaction'))
})

void test('scrums: one scrum per recap item (unique recap_item_id)', () => {
  const cfg = getTableConfig(newsScrums)
  assert.equal(cfg.name, 'news_scrums')
  const unique = cfg.uniqueConstraints.find((u) =>
    u.columns.some((c) => c.name === 'recap_item_id'),
  )
  assert.ok(unique, 'unique on recap_item_id')
  assert.equal(unique.columns.length, 1)
  const checks = cfg.checks.map((c) => c.name).sort()
  assert.deepEqual(checks, ['news_scrums_heat_check', 'news_scrums_reporter_check'])
})

void test('scrum people: unique (scrum_id, player_id); status, role, requested_by checks', () => {
  const cfg = getTableConfig(newsScrumPeople)
  const unique = cfg.uniqueConstraints.find((u) => u.columns.length === 2)
  assert.ok(unique, 'composite unique')
  assert.deepEqual(unique.columns.map((c) => c.name).sort(), ['player_id', 'scrum_id'])
  const names = cfg.checks.map((c) => c.name).sort()
  assert.deepEqual(names, [
    'news_scrum_people_requested_by_check',
    'news_scrum_people_role_check',
    'news_scrum_people_status_check',
  ])
  const status = cfg.checks.find((c) => c.name === 'news_scrum_people_status_check')
  const text = flat(dialect.sqlToQuery(status!.value).sql)
  for (const s of ['pinged', 'asking', 'done', 'expired']) assert.ok(text.includes(`'${s}'`), s)
})

void test('answers, notes, aliases, settings, mirrors, votes, triggers: table names and key checks', () => {
  assert.equal(getTableConfig(newsScrumAnswers).name, 'news_scrum_answers')
  assert.equal(getTableConfig(newsGmNotes).name, 'news_gm_notes')
  assert.equal(getTableConfig(newsPlayerAliases).name, 'news_player_aliases')
  assert.equal(getTableConfig(newsPressSettings).name, 'news_press_settings')
  assert.equal(getTableConfig(newsPressMirrors).name, 'news_press_mirrors')
  assert.equal(getTableConfig(newsReactionVotes).name, 'news_reaction_votes')
  assert.equal(getTableConfig(newsReactionTriggers).name, 'news_reaction_triggers')
  const votes = getTableConfig(newsReactionVotes)
  assert.equal(votes.primaryKeys.length, 1)
  assert.deepEqual(votes.primaryKeys[0]!.columns.map((c) => c.name).sort(), ['item_id', 'user_id'])
  const settings = getTableConfig(newsPressSettings)
  assert.ok(settings.checks.some((c) => c.name === 'news_press_settings_single_row_check'))
  const notes = getTableConfig(newsGmNotes)
  assert.ok(notes.checks.some((c) => c.name === 'news_gm_notes_status_check'))
  const answers = getTableConfig(newsScrumAnswers)
  assert.ok(answers.checks.some((c) => c.name === 'news_scrum_answers_usability_check'))
})

void test('claim ping: sets pinged_at only while it is null', () => {
  const q = claimPingQuery(7).toSQL()
  const s = flat(q.sql)
  assert.match(s, /^update "news_scrum_people" set "pinged_at" = now\(\)/)
  assert.match(s, /"pinged_at" is null/)
  assert.match(s, /returning/)
  assert.ok(q.params.includes(7))
})

void test('inserts: scrum conflicts on recap_item_id, person on (scrum_id, player_id), vote and trigger do nothing', () => {
  const scrum = flat(
    insertScrumQuery({
      recapItemId: 1,
      night: '2026-10-25',
      channelId: 'c',
      messageId: 'm',
      reporter: 'barlow',
      heat: 'normal',
      buzzLevel: 'normal',
      openUntil: new Date('2026-10-25T20:00:00Z'),
    }).toSQL().sql,
  )
  assert.match(scrum, /on conflict \("recap_item_id"\) do nothing/)
  const person = flat(
    insertScrumPersonQuery({
      scrumId: 1,
      playerId: 2,
      discordUserId: 'u',
      role: 'picked',
      requestedBy: 'auto',
    }).toSQL().sql,
  )
  assert.match(person, /on conflict \("scrum_id","player_id"\) do nothing/)
  assert.match(flat(insertReactionVoteQuery(1, 'u').toSQL().sql), /on conflict do nothing/)
  assert.match(
    flat(insertReactionTriggerQuery({ itemId: 1, night: '2026-10-25', isTest: false }).toSQL().sql),
    /on conflict \("item_id"\) do nothing/,
  )
})

void test('expired pings: pinged, pinged_at older than the accept window (5 min), claimed', () => {
  assert.equal(PRESS_ACCEPT_WINDOW_MS, 5 * 60_000)
  const q = dialect.sqlToQuery(listExpiredPingsSql(new Date('2026-10-25T20:10:00Z')))
  const s = flat(q.sql)
  assert.match(s, /p\.status = 'pinged'/)
  assert.match(s, /p\.pinged_at is not null/)
  assert.match(s, /p\.pinged_at < \$1::timestamptz/)
  assert.deepEqual(q.params, ['2026-10-25T20:05:00.000Z'])
})

void test('expired questions: asking, last_asked_at older than the answer window (15 min)', () => {
  assert.equal(PRESS_ANSWER_WINDOW_MS, 15 * 60_000)
  const q = dialect.sqlToQuery(listExpiredQuestionsSql(new Date('2026-10-25T20:30:00Z')))
  const s = flat(q.sql)
  assert.match(s, /p\.status = 'asking'/)
  assert.match(s, /p\.last_asked_at < \$1::timestamptz/)
  assert.deepEqual(q.params, ['2026-10-25T20:15:00.000Z'])
})

void test('night has active scrum: asking, or pinged within 5 minutes; test rows only when asked', () => {
  const q = dialect.sqlToQuery(nightHasActiveScrumSql('2026-10-25', false))
  const s = flat(q.sql)
  assert.match(s, /'asking'/)
  assert.match(s, /p\.status = 'pinged' and p\.pinged_at > now\(\) - interval '5 minutes'/)
  assert.match(s, /s\.is_test = false/)
  assert.match(s, /s\.night = \$1::date/)
  assert.deepEqual(q.params, ['2026-10-25', false])
})

void test('night press material: usable or joke answers only, never from players who are out', () => {
  const q = dialect.sqlToQuery(nightPressMaterialSql('2026-10-25', false))
  const s = flat(q.sql)
  assert.match(s, /a\.usability in \('usable', 'joke'\)/)
  assert.doesNotMatch(s, /unusable'\)/)
  assert.match(s, /coalesce\(pp\.press_level, 'full'\) <> 'out'/)
  assert.match(s, /a\.night = \$1::date/)
  assert.match(s, /\(a\.is_test = false or \$2\)/)
  assert.match(s, /order by a\.id asc/)
  assert.match(s, /coalesce\(nullif\(btrim\(pp\.player_name\), ''\), p\.gamertag\)/)
  assert.deepEqual(q.params, ['2026-10-25', false])
})

void test('night press notes: active notes of the night, same test rule', () => {
  const q = dialect.sqlToQuery(nightPressNotesSql('2026-10-25', true))
  const s = flat(q.sql)
  assert.match(s, /from news_gm_notes g/)
  assert.match(s, /g\.status = 'active'/)
  assert.match(s, /g\.night = \$1::date/)
  assert.match(s, /\(g\.is_test = false or \$2\)/)
  assert.deepEqual(q.params, ['2026-10-25', true])
})

void test('night criticized: item lists plus players with an active critical GM note, same test rule', () => {
  const real = dialect.sqlToQuery(nightCriticizedSql('2026-10-12', false))
  const s = flat(real.sql)
  assert.match(s, /from news_items n where n\.night = \$1::date and n\.deleted_at is null/)
  assert.match(s, /from news_gm_notes g/)
  assert.match(s, /g\.status = 'active' and g\.critical/)
  assert.match(s, /\(g\.is_test = false or \$4\)/)
  assert.deepEqual(real.params, ['2026-10-12', false, '2026-10-12', false])
})

void test('recap items without scrum: live = bot-posted real recaps; trial = mirrored recaps, test items included', () => {
  const since = new Date('2026-10-25T14:00:00Z')
  const live = dialect.sqlToQuery(listRecapItemsWithoutScrumSql({ since, mode: 'live', limit: 5 }))
  const l = flat(live.sql)
  assert.match(l, /n\.is_game_recap/)
  assert.match(l, /n\.discord_via = 'bot'/)
  assert.match(l, /n\.discord_status = 'posted'/)
  assert.match(l, /n\.is_test = false/)
  assert.match(l, /not exists \(select 1 from news_scrums s where s\.recap_item_id = n\.id\)/)
  assert.match(l, /n\.deleted_at is null/)
  assert.doesNotMatch(l, /news_press_mirrors/)
  assert.ok(live.params.includes('2026-10-25T14:00:00.000Z'))
  const trial = dialect.sqlToQuery(
    listRecapItemsWithoutScrumSql({ since, mode: 'trial', limit: 5 }),
  )
  const t = flat(trial.sql)
  assert.match(t, /join news_press_mirrors mi on mi\.item_id = n\.id/)
  assert.match(t, /mi\.deleted_at is null/)
  assert.doesNotMatch(t, /n\.is_test = false/)
  assert.doesNotMatch(t, /discord_via = 'bot'/)
})

void test('press roster: members without AI goalies, display name, aliases', () => {
  const s = flat(dialect.sqlToQuery(listPressRosterSql()).sql)
  assert.match(s, /p\.ai_goalie_side is null/)
  assert.match(s, /coalesce\(nullif\(btrim\(pp\.player_name\), ''\), p\.gamertag\) as name/)
  assert.match(s, /coalesce\(pp\.press_level, 'full'\) as press_level/)
  assert.match(s, /from news_player_aliases a where a\.player_id = p\.id/)
})

void test('auto pings and command uses are counted per night', () => {
  const a = dialect.sqlToQuery(countAutoPingsTonightSql(5, '2026-10-25'))
  assert.match(
    flat(a.sql),
    /p\.requested_by = 'auto' and p\.player_id = \$1 and s\.night = \$2::date/,
  )
  const c = dialect.sqlToQuery(countCommandUsesTonightSql('u1', '2026-10-25'))
  assert.match(
    flat(c.sql),
    /p\.requested_by = 'command' and p\.requested_by_user_id = \$1 and s\.night = \$2::date/,
  )
})

void test('consume next heat: reads and resets in one statement, only for scope next', () => {
  const s = flat(dialect.sqlToQuery(consumeNextHeatSql()).sql)
  assert.match(s, /where id = 1 and heat_scope = 'next' for update/)
  assert.match(s, /set heat = 'normal', heat_scope = 'night', heat_night = null/)
  assert.match(s, /returning old\.heat/)
})

void test('items to mirror: newer than the mark, not deleted, no mirror row yet, oldest first', () => {
  const s = flat(listItemsToMirrorQuery(10, 5).toSQL().sql)
  assert.match(s, /"news_items"\."id" > \$1/)
  assert.match(s, /"news_items"\."deleted_at" is null/)
  assert.match(
    s,
    /not exists \(select 1 from news_press_mirrors mi where mi\.item_id = "news_items"\."id"\)/,
  )
  assert.match(s, /order by "news_items"\."id" asc/)
})

void test('mirror deletions: mirrored item now deleted, mirror message not yet deleted', () => {
  const s = flat(dialect.sqlToQuery(listMirrorDeletionsSql(10)).sql)
  assert.match(s, /mi\.deleted_at is null/)
  assert.match(s, /n\.deleted_at is not null/)
})

void test('reaction triggers without a job: no reaction job, or one failed under the cap', () => {
  const q = dialect.sqlToQuery(listReactionTriggersWithoutJobSql(false, 3))
  const s = flat(q.sql)
  assert.match(s, /left join news_jobs j on j\.kind = 'reaction' and j\.job_key = t\.item_id::text/)
  assert.match(s, /j\.job_key is null or \( ?j\.status = 'failed' and j\.attempts < 3 ?\)/)
  assert.match(s, /\(t\.is_test = false or \$1\)/)
  assert.match(s, /n\.deleted_at is null/)
})

void test('migration 0072: idempotent tables and columns, kind check gains reaction, rollback block', async () => {
  const { readFile } = await import('node:fs/promises')
  const sqlText = await readFile(
    new URL('../../../migrations/0072_news_press.sql', import.meta.url),
    'utf8',
  )
  const tables = [
    'news_scrums',
    'news_scrum_people',
    'news_scrum_answers',
    'news_gm_notes',
    'news_player_aliases',
    'news_press_settings',
    'news_press_mirrors',
    'news_reaction_votes',
    'news_reaction_triggers',
  ]
  for (const t of tables) {
    assert.match(sqlText, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}"`), t)
    assert.match(sqlText, new RegExp(`--   DROP TABLE IF EXISTS "${t}";`), `rollback ${t}`)
  }
  for (const c of ['is_game_recap', 'discord_via', 'discord_channel_id']) {
    assert.match(sqlText, new RegExp(`ADD COLUMN IF NOT EXISTS "${c}"`), c)
  }
  assert.match(
    sqlText,
    /DROP CONSTRAINT IF EXISTS "news_jobs_kind_check";\s+ALTER TABLE "news_jobs" ADD CONSTRAINT "news_jobs_kind_check"\s+CHECK \("kind" IN \('game', 'night', 'week', 'game_article', 'reaction'\)\)/,
  )
  assert.match(sqlText, /ON CONFLICT \("id"\) DO NOTHING/)
})
