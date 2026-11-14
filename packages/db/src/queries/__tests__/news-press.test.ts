/**
 * SQL-shape pins for the press queries (news desk bots, migrations 0072 and 0073). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news-press.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import {
  NEWS_JOB_KINDS,
  newsGmAsks,
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
  countLimitedPingsTonightSql,
  countCommandUsesTonightSql,
  consumeNextHeatSql,
  listItemsToMirrorQuery,
  listMirrorDeletionsSql,
  listReactionTriggersWithoutJobSql,
  findReactionItemSql,
  getReactionItemSql,
  insertScrumQuery,
  insertScrumPersonQuery,
  insertReactionVoteQuery,
  insertReactionTriggerQuery,
  PRESS_ACCEPT_WINDOW_MS,
  openQuestionInThreadSql,
  scrumThreadOwnerSql,
  PRESS_ANSWER_WINDOW_MS,
  setScrumThreadQuery,
  lastScrumReporterQuery,
  gmAskForMatchQuery,
  scrumPersonDetailQuery,
  listScrumAnswersQuery,
  expireScrumPersonQuery,
  claimScrumQuestionQuery,
  acceptScrumPersonQuery,
  claimScrumAnswerQuery,
  latestScrumItemSql,
  latestPressNightSql,
  scrumForMatchQuery,
  getGmNoteQuery,
  updateGmNoteQuery,
  countGmPingsTonightSql,
  expireUnpingedGmPersonQuery,
  listScrumQuestionsSql,
  setScrumPersonPanelQuery,
  findScrumPersonQuery,
  findScrumPersonByUserQuery,
  gmAsksForMatchQuery,
  gmAskForPlayerQuery,
  gmAskForUserQuery,
  TEST_SCRUM_BUZZ,
  testScrumThreadSql,
  insertTestRecapItemQuery,
  deleteTestRecapItemQuery,
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
  const flag = cfg.columns.find((c) => c.name === 'asking_followup')
  assert.ok(flag, 'asking_followup column')
  assert.equal(flag.notNull, true)
  assert.equal(flag.default, false)
  const unique = cfg.uniqueConstraints.find((u) => u.columns.length === 2)
  assert.ok(unique, 'composite unique')
  assert.deepEqual(unique.columns.map((c) => c.name).sort(), ['player_id', 'scrum_id'])
  const names = cfg.checks.map((c) => c.name).sort()
  assert.deepEqual(names, [
    'news_scrum_people_panel_check',
    'news_scrum_people_person_named_check',
    'news_scrum_people_person_role_check',
    'news_scrum_people_requested_by_check',
    'news_scrum_people_role_check',
    'news_scrum_people_status_check',
    'news_scrum_people_target_total_check',
  ])
  // T7 (migration 0077): a person with no player row counts once per scrum and Discord user.
  const nonPlayer = cfg.indexes.find(
    (i) => i.config.name === 'news_scrum_people_scrum_user_nonplayer_uniq',
  )!
  assert.equal(nonPlayer.config.unique, true)
  assert.deepEqual(
    nonPlayer.config.columns.map((c) => (c as { name: string }).name),
    ['scrum_id', 'discord_user_id'],
  )
  assert.match(flat(dialect.sqlToQuery(nonPlayer.config.where!).sql), /player_id IS NULL/)
  const role = cfg.columns.find((c) => c.name === 'person_role')!
  assert.equal(role.default, 'player')
  assert.equal(cfg.columns.find((c) => c.name === 'player_id')!.notNull, false)
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
  // No conflict target: the unique (scrum, player) and the partial unique (scrum, Discord user)
  // of a person with no player row (T7) both count.
  assert.match(person, /on conflict do nothing returning "id"/)
  assert.match(flat(insertReactionVoteQuery(1, 'u').toSQL().sql), /on conflict do nothing/)
  assert.match(
    flat(insertReactionTriggerQuery({ itemId: 1, night: '2026-10-25', isTest: false }).toSQL().sql),
    /on conflict \("item_id"\) do nothing/,
  )
})

void test('expired pings: pinged, pinged_at older than the accept window (15 min), claimed', () => {
  assert.equal(PRESS_ACCEPT_WINDOW_MS, 15 * 60_000)
  const q = dialect.sqlToQuery(listExpiredPingsSql(new Date('2026-10-25T20:20:00Z')))
  const s = flat(q.sql)
  assert.match(s, /p\.status = 'pinged'/)
  assert.match(s, /p\.pinged_at is not null/)
  assert.match(s, /p\.pinged_at < \$1::timestamptz/)
  assert.match(s, /s\.message_id as scrum_message_id, s\.reporter, s\.is_test/)
  // T6: the thread of a person is the scrum's shared one, else their own once a question was asked.
  assert.match(
    s,
    /case when s\.thread_id is not null then s\.thread_id when p\.questions_asked > 0 then p\.ping_message_id end as thread_id/,
  )
  assert.deepEqual(q.params, ['2026-10-25T20:05:00.000Z'])
})

void test('scrum thread owner: the person whose thread starts from this message (T6)', () => {
  const q = dialect.sqlToQuery(scrumThreadOwnerSql('thread-9'))
  const s = flat(q.sql)
  assert.match(s, /select p\.discord_user_id from news_scrum_people p/)
  assert.match(s, /where p\.ping_message_id = \$1/)
  assert.match(s, /order by p\.id desc limit 1/)
  assert.deepEqual(q.params, ['thread-9'])
})

void test('expired questions: asking, last_asked_at older than the answer window (15 min)', () => {
  assert.equal(PRESS_ANSWER_WINDOW_MS, 15 * 60_000)
  const q = dialect.sqlToQuery(listExpiredQuestionsSql(new Date('2026-10-25T20:30:00Z')))
  const s = flat(q.sql)
  assert.match(s, /p\.status = 'asking'/)
  assert.match(s, /p\.last_asked_at < \$1::timestamptz/)
  assert.deepEqual(q.params, ['2026-10-25T20:15:00.000Z'])
})

void test('night has active scrum: asking, or pinged within 15 minutes; test rows only when asked', () => {
  const q = dialect.sqlToQuery(nightHasActiveScrumSql('2026-10-25', false))
  const s = flat(q.sql)
  assert.match(s, /'asking'/)
  assert.match(s, /p\.status = 'pinged' and p\.pinged_at > now\(\) - interval '15 minutes'/)
  // The SQL interval follows the accept window constant.
  assert.equal(PRESS_ACCEPT_WINDOW_MS, 15 * 60_000)
  assert.match(s, /s\.is_test = false/)
  assert.match(s, /s\.night = \$1::date/)
  assert.deepEqual(q.params, ['2026-10-25', false])
})

void test('open question in thread: this user, this thread, asking with a current question', () => {
  const q = dialect.sqlToQuery(openQuestionInThreadSql('thread-9', '200000000000000001'))
  const s = flat(q.sql)
  // The scrum's shared thread (an old scrum) or the person's own thread (T6).
  assert.match(s, /\(s\.thread_id = \$1 or p\.ping_message_id = \$2\)/)
  assert.match(s, /p\.discord_user_id = \$3/)
  assert.match(s, /p\.status = 'asking'/)
  assert.match(s, /p\.current_question is not null/)
  assert.match(s, /order by p\.id desc\s+limit 1/)
  assert.deepEqual(q.params, ['thread-9', 'thread-9', '200000000000000001'])
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
  // Every quote names the reporter who asked: the answer's own, else the scrum's (an old round).
  assert.match(s, /coalesce\(a\.reporter, sc\.reporter\) as reporter/)
  assert.match(s, /join news_scrums sc on sc\.id = a\.scrum_id/)
  // T7: the person row names the speaker (the coach has no players row) and says in what capacity.
  assert.match(s, /join news_scrum_people sp on sp\.id = a\.person_id/)
  assert.match(s, /left join players p on p\.id = a\.player_id/)
  assert.match(s, /coalesce\(sp\.display_name, coalesce\(nullif\(btrim\(pp\.player_name\)/)
  assert.match(s, /sp\.person_role as person_role/)
  assert.deepEqual(q.params, ['2026-10-25', false])
})

void test('night press notes: active notes of the night, same test rule', () => {
  const q = dialect.sqlToQuery(nightPressNotesSql('2026-10-25', true))
  const s = flat(q.sql)
  assert.match(s, /from news_gm_notes g/)
  assert.match(s, /select g\.id, g\.player_id, /)
  assert.match(s, /g\.note, g\.match_id, g\.critical/)
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

void test('limited pings (auto and command) and command uses are counted per night', () => {
  const a = dialect.sqlToQuery(countLimitedPingsTonightSql(5, '2026-10-25'))
  assert.match(
    flat(a.sql),
    /p\.requested_by in \('auto', 'command'\) and p\.player_id = \$1 and s\.night = \$2::date/,
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
  for (const c of ['is_game_recap', 'discord_via', 'discord_channel_id', 'asking_followup']) {
    assert.match(sqlText, new RegExp(`ADD COLUMN IF NOT EXISTS "${c}"`), c)
  }
  assert.match(
    sqlText,
    /DROP CONSTRAINT IF EXISTS "news_jobs_kind_check";\s+ALTER TABLE "news_jobs" ADD CONSTRAINT "news_jobs_kind_check"\s+CHECK \("kind" IN \('game', 'night', 'week', 'game_article', 'reaction'\)\)/,
  )
  assert.match(sqlText, /ON CONFLICT \("id"\) DO NOTHING/)
  assert.match(sqlText, /"asking_followup" boolean DEFAULT false NOT NULL/)
})

void test('set scrum thread: only while the scrum has no thread', () => {
  const q = setScrumThreadQuery(4, 't1').toSQL()
  const s = flat(q.sql)
  assert.match(s, /^update "news_scrums" set "thread_id" = \$1/)
  assert.match(s, /"news_scrums"."id" = \$2 and "news_scrums"."thread_id" is null/)
  assert.match(s, /returning/)
  assert.deepEqual(q.params, ['t1', 4])
})

void test('last scrum reporter: the newest scrum', () => {
  const s = flat(lastScrumReporterQuery().toSQL().sql)
  assert.match(s, /select "reporter" from "news_scrums"/)
  assert.match(s, /order by "news_scrums"."id" desc limit \$1/)
})

void test('GM ask for a match: newest active note that asks a player, same test rule', () => {
  const q = gmAskForMatchQuery(90001, false).toSQL()
  const s = flat(q.sql)
  assert.match(s, /from "news_gm_notes"/)
  assert.match(s, /"news_gm_notes"."match_id" = \$1/)
  assert.match(s, /"news_gm_notes"."status" = \$2/)
  assert.match(s, /"news_gm_notes"."asks_player" = \$3/)
  assert.match(s, /"news_gm_notes"."player_id" is not null/)
  assert.match(s, /\("news_gm_notes"."is_test" = false or \$4\)/)
  assert.match(s, /order by "news_gm_notes"."id" desc/)
  assert.deepEqual(q.params.slice(0, 4), [90001, 'active', true, false])
})

void test('scrum person detail: person, scrum and display name; by id or the people to ping', () => {
  const byId = scrumPersonDetailQuery({ id: 9 }).toSQL()
  const s = flat(byId.sql)
  assert.match(
    s,
    /from "news_scrum_people" inner join "news_scrums" on "news_scrums"."id" = "news_scrum_people"."scrum_id"/,
  )
  // T7: a person with no player row (the coach) has no players row: left join.
  assert.match(s, /left join "players" on "players"."id" = "news_scrum_people"."player_id"/)
  assert.match(
    s,
    /left join "player_profiles" on "player_profiles"."player_id" = "news_scrum_people"."player_id"/,
  )
  assert.match(
    s,
    /coalesce\("news_scrum_people"."display_name", nullif\(btrim\("player_profiles"."player_name"\), ''\), "players"."gamertag"\)/,
  )
  assert.match(s, /where "news_scrum_people"."id" = \$1/)
  assert.ok(byId.params.includes(9))
  const toPing = flat(scrumPersonDetailQuery({ toPing: true }).toSQL().sql)
  assert.match(
    toPing,
    /"news_scrum_people"."status" = \$1 and "news_scrum_people"."pinged_at" is null/,
  )
  assert.match(toPing, /order by "news_scrum_people"."id" asc/)
})

void test("scrum answers: one person's answers, oldest first", () => {
  const q = listScrumAnswersQuery(5).toSQL()
  const s = flat(q.sql)
  assert.match(s, /select "question", "answer", "usability", "reporter" from "news_scrum_answers"/)
  assert.match(s, /where "news_scrum_answers"."person_id" = \$1/)
  assert.match(s, /order by "news_scrum_answers"."id" asc/)
})

void test('expire scrum person: pinged -> expired, asking -> done, only past the cutoff', () => {
  const cutoff = new Date('2026-10-25T20:05:00Z')
  const ping = expireScrumPersonQuery(3, 'pinged', cutoff).toSQL()
  const p = flat(ping.sql)
  assert.match(p, /set "status" = \$1/)
  assert.match(
    p,
    /"news_scrum_people"."status" = \$\d+ and "news_scrum_people"."pinged_at" < \$\d+/,
  )
  assert.ok(ping.params.includes('expired'))
  assert.ok(ping.params.includes('pinged'))
  const ask = expireScrumPersonQuery(3, 'asking', cutoff).toSQL()
  const a = flat(ask.sql)
  assert.match(a, /set "status" = \$1, "current_question" = \$2/)
  assert.equal(ask.params[1], null)
  assert.match(
    a,
    /"news_scrum_people"."status" = \$\d+ and "news_scrum_people"."last_asked_at" < \$\d+/,
  )
  assert.ok(ask.params.includes('done'))
  assert.ok(ask.params.includes('asking'))
  assert.match(a, /returning/)
})

void test('claim scrum question: only from the expected count, while pinged or asking', () => {
  const q = claimScrumQuestionQuery({
    personId: 3,
    questionsAsked: 1,
    question: 'Why?',
    at: new Date('2026-10-25T20:00:00Z'),
  }).toSQL()
  const s = flat(q.sql)
  assert.match(
    s,
    /set "status" = \$1, "questions_asked" = "news_scrum_people"."questions_asked" \+ 1, "asking_followup" = \$2, "current_question" = \$3, "last_asked_at" = \$4/,
  )
  assert.match(s, /"news_scrum_people"."questions_asked" = \$\d+/)
  assert.match(s, /"news_scrum_people"."status" in \(\$\d+, \$\d+\)/)
  assert.match(s, /returning/)
  assert.ok(q.params.includes('Why?'))
  // A question (not a follow-up) is now open.
  assert.equal(q.params[1], false)
})

void test('expire scrum person without a cutoff: state check only (a person taken off the sheet)', () => {
  const q = expireScrumPersonQuery(3, 'asking', null).toSQL()
  const s = flat(q.sql)
  assert.match(
    s,
    /where \("news_scrum_people"."id" = \$\d+ and "news_scrum_people"."status" = \$\d+\)/,
  )
  assert.doesNotMatch(s, /last_asked_at/)
  assert.ok(q.params.includes('done'))
})

void test('accept: pinged to asking, only within the accept window', () => {
  const cutoff = new Date('2026-10-25T19:55:00Z')
  const at = new Date('2026-10-25T20:00:00Z')
  const q = acceptScrumPersonQuery(3, cutoff, at).toSQL()
  const s = flat(q.sql)
  assert.match(s, /set "status" = \$1, "last_asked_at" = \$2/)
  assert.match(
    s,
    /"news_scrum_people"."id" = \$\d+ and "news_scrum_people"."status" = \$\d+ and "news_scrum_people"."pinged_at" >= \$\d+/,
  )
  assert.equal(q.params[0], 'asking')
  assert.ok(q.params.includes('pinged'))
  assert.match(s, /returning/)
})

void test('claim scrum answer: only for the current question, once', () => {
  const q = claimScrumAnswerQuery({
    personId: 3,
    questionsAsked: 2,
    followupsAsked: 1,
    at: new Date('2026-10-25T20:00:00Z'),
  }).toSQL()
  const s = flat(q.sql)
  assert.match(s, /set "current_question" = \$1, "last_asked_at" = \$2/)
  assert.equal(q.params[0], null)
  assert.match(
    s,
    /"news_scrum_people"."id" = \$\d+ and "news_scrum_people"."status" = \$\d+ and "news_scrum_people"."questions_asked" = \$\d+ and "news_scrum_people"."followups_asked" = \$\d+ and "news_scrum_people"."current_question" is not null/,
  )
  assert.ok(q.params.includes('asking'))
  assert.ok(q.params.includes(2))
  assert.ok(q.params.includes(1))
  assert.match(s, /returning/)
})

void test("latest scrum item: newest recap within the window, of the player's game", () => {
  const since = new Date('2026-10-25T14:00:00Z')
  const q = dialect.sqlToQuery(latestScrumItemSql({ playerId: 7, since, isTest: false }))
  const s = flat(q.sql)
  assert.match(
    s,
    /select s\.recap_item_id from news_scrums s join news_items n on n\.id = s\.recap_item_id/,
  )
  assert.match(s, /s\.is_test = \$1 and n\.deleted_at is null and n\.created_at > \$2::timestamptz/)
  assert.match(
    s,
    /exists \( ?select 1 from player_match_stats pms where pms\.match_id = s\.match_id and pms\.player_id = \$3 ?\)/,
  )
  assert.match(s, /order by n\.created_at desc, s\.id desc limit 1/)
  assert.deepEqual(q.params, [false, since.toISOString(), 7])
  // The trial GM acts for any game: no player filter.
  const t = dialect.sqlToQuery(latestScrumItemSql({ playerId: null, since, isTest: true }))
  assert.doesNotMatch(flat(t.sql), /player_match_stats/)
  assert.deepEqual(t.params, [true, since.toISOString()])
})

void test('latest press night: night of the newest counted game of an active title after since', () => {
  const since = new Date('2026-10-25T20:00:00Z')
  const q = dialect.sqlToQuery(latestPressNightSql(since))
  const s = flat(q.sql)
  assert.match(
    s,
    /select to_char\(\(\(m\.played_at at time zone 'America\/Edmonton'\) - interval '6 hours'\)::date, 'YYYY-MM-DD'\) as night from matches m/,
  )
  assert.match(s, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  assert.match(s, /m\.played_at > \$1::timestamptz and m\.result <> 'DNF'/)
  assert.match(s, /order by m\.played_at desc, m\.id desc limit 1/)
  assert.deepEqual(q.params, [since.toISOString()])
})

void test("scrum for match: the match's newest scrum of the mode (test or real)", () => {
  const q = scrumForMatchQuery(90001, true).toSQL()
  const s = flat(q.sql)
  assert.match(s, /from "news_scrums"/)
  assert.match(s, /"news_scrums"."match_id" = \$1 and "news_scrums"."is_test" = \$2/)
  assert.match(s, /order by "news_scrums"."id" desc limit \$3/)
  assert.deepEqual(q.params, [90001, true, 1])
})

void test('GM note by id, and its update only while not cancelled', () => {
  const g = getGmNoteQuery(7).toSQL()
  assert.match(flat(g.sql), /from "news_gm_notes" where "news_gm_notes"."id" = \$1/)
  assert.deepEqual(g.params.slice(0, 1), [7])
  const u = updateGmNoteQuery(7, { playerId: 3, status: 'refused', refusal: 'out' }).toSQL()
  const s = flat(u.sql)
  assert.match(s, /^update "news_gm_notes" set "player_id" = \$1, "status" = \$2, "refusal" = \$3/)
  assert.match(s, /"news_gm_notes"."id" = \$4 and "news_gm_notes"."status" <> \$5/)
  assert.match(s, /returning/)
  assert.deepEqual(u.params, [3, 'refused', 'out', 7, 'cancelled'])
})

void test("GM pings tonight: the player's GM-requested scrum people that night, never one expired before its ping", () => {
  const q = dialect.sqlToQuery(countGmPingsTonightSql(5, '2026-10-25', false))
  const s = flat(q.sql)
  assert.match(
    s,
    /select count\(\*\)::int as n from news_scrum_people p join news_scrums s on s\.id = p\.scrum_id/,
  )
  assert.match(
    s,
    /p\.requested_by = 'gm' and p\.player_id = \$1 and s\.night = \$2::date and \(s\.is_test = false or \$3\)/,
  )
  assert.match(s, /and not \(p\.status = 'expired' and p\.pinged_at is null\)/)
  assert.deepEqual(q.params, [5, '2026-10-25', false])
})

void test('expire unpinged GM person: only a GM-requested person still waiting for the ping', () => {
  const q = expireUnpingedGmPersonQuery(4, 7).toSQL()
  const s = flat(q.sql)
  assert.match(s, /^update "news_scrum_people" set "status" = \$1/)
  assert.match(
    s,
    /"news_scrum_people"."scrum_id" = \$2 and "news_scrum_people"."player_id" = \$3 and "news_scrum_people"."requested_by" = \$4 and "news_scrum_people"."status" = \$5 and "news_scrum_people"."pinged_at" is null/,
  )
  assert.match(s, /returning/)
  assert.deepEqual(q.params, ['expired', 4, 7, 'gm', 'pinged'])
})

void test("reaction item by message: live = the item's own message, trial = its mirror; with the job kind", () => {
  const live = dialect.sqlToQuery(findReactionItemSql('900000000000000001', 'live'))
  const l = flat(live.sql)
  assert.match(
    l,
    /from news_items n left join news_jobs j on j\.id = n\.job_id left join matches m on m\.id = n\.match_id/,
  )
  assert.match(l, /j\.kind as job_kind/)
  assert.match(l, /n\.is_correction/)
  assert.match(l, /coalesce\(to_char\(n\.night, 'YYYY-MM-DD'\), to_char\(/)
  assert.match(l, /where n\.deleted_at is null and n\.discord_message_id = \$1/)
  assert.doesNotMatch(l, /news_press_mirrors/)
  assert.deepEqual(live.params, ['900000000000000001'])
  const trial = dialect.sqlToQuery(findReactionItemSql('900000000000000002', 'trial'))
  const t = flat(trial.sql)
  assert.match(t, /join news_press_mirrors mi on mi\.item_id = n\.id/)
  assert.match(t, /where n\.deleted_at is null and mi\.deleted_at is null and mi\.message_id = \$1/)
  assert.doesNotMatch(t, /n\.discord_message_id =/)
  assert.deepEqual(trial.params, ['900000000000000002'])
})

void test('reaction item by id: not deleted, with the job kind', () => {
  const q = dialect.sqlToQuery(getReactionItemSql(42))
  const s = flat(q.sql)
  assert.match(s, /left join news_jobs j on j\.id = n\.job_id/)
  assert.match(s, /where n\.deleted_at is null and n\.id = \$1/)
  assert.doesNotMatch(s, /news_press_mirrors/)
  assert.deepEqual(q.params, [42])
})

// ── Panel scrums and /gm ask (migration 0073) ───────────────────────────────

void test('scrum people: panel (reporter ids, default empty) and target_total (2-6, nullable)', () => {
  const cfg = getTableConfig(newsScrumPeople)
  const panel = cfg.columns.find((c) => c.name === 'panel')
  assert.ok(panel, 'panel column')
  assert.equal(panel.notNull, true)
  assert.equal(panel.getSQLType(), 'text[]')
  const target = cfg.columns.find((c) => c.name === 'target_total')
  assert.ok(target, 'target_total column')
  assert.equal(target.notNull, false)
})

void test('scrum answers: reporter is nullable (null = the scrum reporter) with a reporter check', () => {
  const cfg = getTableConfig(newsScrumAnswers)
  const reporter = cfg.columns.find((c) => c.name === 'reporter')
  assert.ok(reporter, 'reporter column')
  assert.equal(reporter.notNull, false)
  assert.ok(cfg.checks.some((c) => c.name === 'news_scrum_answers_reporter_check'))
})

void test('GM asks: their own table (a note reaches the writers as a true event), with status and reporter checks', () => {
  const cfg = getTableConfig(newsGmAsks)
  assert.equal(cfg.name, 'news_gm_asks')
  const names = cfg.columns.map((c) => c.name).sort()
  assert.deepEqual(names, [
    'created_at',
    'discord_user_id',
    'display_name',
    'exact',
    'id',
    'is_test',
    'match_id',
    'night',
    'person_role',
    'player_id',
    'question',
    'refusal',
    'reporter',
    'requested_by_user_id',
    'status',
  ])
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    'news_gm_asks_person_named_check',
    'news_gm_asks_person_role_check',
    'news_gm_asks_reporter_check',
    'news_gm_asks_status_check',
  ])
  const exact = cfg.columns.find((c) => c.name === 'exact')!
  assert.equal(exact.default, true)
})

void test('answers list carries the reporter; the scrum questions query leaves the person out, answered first', () => {
  const a = flat(listScrumAnswersQuery(5).toSQL().sql)
  assert.match(a, /"usability", "reporter" from "news_scrum_answers"/)
  const q = dialect.sqlToQuery(listScrumQuestionsSql(3, 7))
  const s = flat(q.sql)
  assert.match(s, /from news_scrum_answers a where a\.scrum_id = \$1 and a\.person_id <> \$2/)
  assert.match(
    s,
    /from news_scrum_people p where p\.scrum_id = \$3 and p\.id <> \$4 and p\.current_question is not null/,
  )
  assert.match(s, /order by q\.ord asc/)
  assert.deepEqual(q.params, [3, 7, 3, 7])
})

void test('set panel: only while the panel is empty (two callers never both set it)', () => {
  const q = setScrumPersonPanelQuery(8, ['voss', 'mercer', 'vale'], 5).toSQL()
  const s = flat(q.sql)
  assert.match(s, /^update "news_scrum_people" set "panel" = \$1, "target_total" = \$2/)
  assert.match(
    s,
    /"news_scrum_people"."id" = \$3 and cardinality\("news_scrum_people"."panel"\) = 0/,
  )
  assert.match(s, /returning/)
  assert.equal(q.params[1], 5)
  assert.equal(q.params[2], 8)
})

void test('find person: by scrum and player', () => {
  const q = findScrumPersonQuery(4, 9).toSQL()
  const s = flat(q.sql)
  assert.match(s, /from "news_scrum_people"/)
  assert.match(s, /"news_scrum_people"."scrum_id" = \$1 and "news_scrum_people"."player_id" = \$2/)
  assert.deepEqual(q.params.slice(0, 2), [4, 9])
})

void test('find person by user: a person with no player row, by scrum and Discord user', () => {
  const q = findScrumPersonByUserQuery(4, '200000000000000040').toSQL()
  const s = flat(q.sql)
  assert.match(s, /from "news_scrum_people"/)
  assert.match(
    s,
    /"news_scrum_people"."scrum_id" = \$1 and "news_scrum_people"."discord_user_id" = \$2 and "news_scrum_people"."player_id" is null/,
  )
  assert.deepEqual(q.params.slice(0, 2), [4, '200000000000000040'])
})

void test('GM asks for a match: active ones only, oldest first, same test rule', () => {
  const q = gmAsksForMatchQuery(90001, false).toSQL()
  const s = flat(q.sql)
  assert.match(s, /from "news_gm_asks"/)
  assert.match(s, /"news_gm_asks"."match_id" = \$1/)
  assert.match(s, /"news_gm_asks"."status" = \$2/)
  assert.match(s, /\("news_gm_asks"."is_test" = false or \$3\)/)
  assert.match(s, /order by "news_gm_asks"."id" asc/)
  assert.deepEqual(q.params.slice(0, 3), [90001, 'active', false])
})

void test("the GM ask for a player: the newest active one on that match is the first question's wish", () => {
  const q = gmAskForPlayerQuery(90001, 3, true).toSQL()
  const s = flat(q.sql)
  assert.match(s, /"news_gm_asks"."match_id" = \$1 and "news_gm_asks"."player_id" = \$2/)
  assert.match(s, /"news_gm_asks"."status" = \$3/)
  assert.match(s, /\("news_gm_asks"."is_test" = false or \$4\)/)
  assert.match(s, /order by "news_gm_asks"."id" desc limit/)
  assert.deepEqual(q.params.slice(0, 4), [90001, 3, 'active', true])
})

void test('the GM ask for a person with no player row is found by Discord user id (T7)', () => {
  const q = gmAskForUserQuery(90001, '431630903048011777', true).toSQL()
  const s = flat(q.sql)
  assert.match(s, /"news_gm_asks"."match_id" = \$1 and "news_gm_asks"."discord_user_id" = \$2/)
  assert.match(s, /"news_gm_asks"."status" = \$3/)
  assert.match(s, /\("news_gm_asks"."is_test" = false or \$4\)/)
  assert.deepEqual(q.params.slice(0, 4), [90001, '431630903048011777', 'active', true])
})

void test('migration 0073: idempotent, additive, header with how to apply and the rollback', async () => {
  const { readFile } = await import('node:fs/promises')
  const sqlText = await readFile(
    new URL('../../../migrations/0073_press_panel.sql', import.meta.url),
    'utf8',
  )
  // Columns: added only when missing.
  for (const c of ['panel', 'target_total', 'reporter']) {
    assert.match(sqlText, new RegExp(`ADD COLUMN IF NOT EXISTS "${c}"`), c)
  }
  assert.match(sqlText, /"panel" text\[\] DEFAULT '\{\}' NOT NULL/)
  assert.match(sqlText, /"target_total" integer;/)
  // The new table, idempotent, with its indexes.
  assert.match(sqlText, /CREATE TABLE IF NOT EXISTS "news_gm_asks"/)
  assert.match(sqlText, /CREATE INDEX IF NOT EXISTS "news_gm_asks_match_player_idx"/)
  assert.match(sqlText, /CREATE INDEX IF NOT EXISTS "news_gm_asks_night_idx"/)
  // Checks: dropped and re-added by name.
  for (const name of [
    'news_scrum_people_panel_check',
    'news_scrum_people_target_total_check',
    'news_scrum_answers_reporter_check',
    'news_gm_asks_status_check',
    'news_gm_asks_reporter_check',
  ]) {
    assert.match(
      sqlText,
      new RegExp(
        `DROP CONSTRAINT IF EXISTS "${name}";\\s+ALTER TABLE "[a-z_]+" ADD CONSTRAINT "${name}"`,
      ),
      name,
    )
  }
  // Additive only: no destructive statement outside the rollback comment.
  const live = sqlText
    .split('\n')
    .filter((l) => !l.startsWith('--'))
    .join('\n')
  assert.doesNotMatch(live, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE|UPDATE "/)
  // Header: how to apply, and the rollback of every addition.
  assert.match(sqlText, /HOW TO APPLY/)
  assert.match(sqlText, /< packages\/db\/migrations\/0073_press_panel\.sql/)
  assert.match(sqlText, /Needs 0072 first/)
  assert.match(sqlText, /^-- {3}DROP TABLE IF EXISTS "news_gm_asks";$/m)
  for (const c of ['reporter']) {
    assert.match(
      sqlText,
      new RegExp(`^--   ALTER TABLE "news_scrum_answers" DROP COLUMN IF EXISTS "${c}";$`, 'm'),
    )
  }
  for (const c of ['panel', 'target_total']) {
    assert.match(
      sqlText,
      new RegExp(`^--   ALTER TABLE "news_scrum_people" DROP COLUMN IF EXISTS "${c}";$`, 'm'),
    )
  }
  assert.match(sqlText, /BEGIN;[\s\S]*COMMIT;/)
  // The reporter list in the checks matches the schema's.
  assert.match(
    sqlText,
    /'barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'/,
  )
})

// ── T8: the test scrum (`/gm testscrum`) ────────────────────────────────────

void test('test scrum: the marker is left out of the night recap, its wait and /scrum', () => {
  assert.equal(TEST_SCRUM_BUZZ, 'testscrum')
  // The marker is a literal in the SQL (the params stay as they were).
  const material = dialect.sqlToQuery(nightPressMaterialSql('2026-10-25', true))
  assert.match(flat(material.sql), /and sc\.buzz_level <> 'testscrum'/)
  assert.deepEqual(material.params, ['2026-10-25', true])
  const wait = dialect.sqlToQuery(nightHasActiveScrumSql('2026-10-25', true))
  assert.match(flat(wait.sql), /and s\.buzz_level <> 'testscrum'/)
  assert.deepEqual(wait.params, ['2026-10-25', true])
  const since = new Date('2026-10-25T14:00:00Z')
  const latest = dialect.sqlToQuery(latestScrumItemSql({ playerId: null, since, isTest: true }))
  assert.match(flat(latest.sql), /and s\.buzz_level <> 'testscrum'/)
  assert.deepEqual(latest.params, [true, since.toISOString()])
})

void test('test scrum thread: a thread of a test scrum, by its shared or a person thread', () => {
  const q = dialect.sqlToQuery(testScrumThreadSql('thread-9'))
  const s = flat(q.sql)
  assert.match(s, /s\.buzz_level = 'testscrum'/)
  assert.match(s, /\(s\.thread_id = \$1 or p\.ping_message_id = \$2\)/)
  assert.deepEqual(q.params, ['thread-9', 'thread-9'])
})

void test('test recap item: a hidden test row (soft-deleted, not a recap, never posted by the desk)', () => {
  const q = insertTestRecapItemQuery({ reporter: 'barlow', body: '(test scrum) hello' }).toSQL()
  const s = flat(q.sql)
  assert.match(s, /insert into "news_items"/)
  assert.ok(q.params.includes('barlow'))
  assert.ok(q.params.includes('(test scrum) hello'))
  assert.ok(q.params.includes('skipped'))
  assert.ok(q.params.includes('bot'))
  // is_test true, is_game_recap false, deleted_at now().
  assert.ok(q.params.includes(true))
  assert.match(s, /now\(\)/)
  const d = deleteTestRecapItemQuery(5).toSQL()
  const ds = flat(d.sql)
  assert.match(ds, /delete from "news_items"/)
  assert.match(ds, /"is_test" = \$2/)
  assert.match(ds, /"is_game_recap" = \$3/)
  assert.match(ds, /"deleted_at" is not null/)
  assert.deepEqual(d.params, [5, true, false])
})
