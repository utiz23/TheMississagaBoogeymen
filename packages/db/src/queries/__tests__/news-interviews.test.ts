/**
 * SQL-shape pins for the press interview queries (migration 0074). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/news-interviews.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { INTERVIEW_STATUSES, newsInterviewAnswers, newsInterviews } from '../../schema/index.js'
import {
  interviewBody,
  interviewParagraph,
  interviewSlugKey,
  isInterviewSlug,
} from '../../news/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../news-interviews.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const AT = new Date('2026-11-13T20:00:00.000Z')

void test('schema: two new tables; one open interview per player; one auto offer per night and mode', () => {
  const cfg = getTableConfig(newsInterviews)
  assert.equal(cfg.name, 'news_interviews')
  assert.deepEqual(cfg.checks.map((c) => c.name).sort(), [
    'news_interviews_article_status_check',
    'news_interviews_person_named_check',
    'news_interviews_person_role_check',
    'news_interviews_reporter_check',
    'news_interviews_status_check',
    'news_interviews_trigger_check',
  ])
  const open = cfg.indexes.find((i) => i.config.name === 'news_interviews_open_player_uniq')!
  assert.equal(open.config.unique, true)
  assert.deepEqual(
    open.config.columns.map((c) => (c as { name: string }).name),
    ['player_id'],
  )
  assert.match(
    flat(dialect.sqlToQuery(open.config.where!).sql),
    /status IN \('offered', 'active'\)/,
  )
  // T7 (migration 0077): a person with no player row has one open interview per Discord user.
  const nonPlayer = cfg.indexes.find(
    (i) => i.config.name === 'news_interviews_open_nonplayer_uniq',
  )!
  assert.equal(nonPlayer.config.unique, true)
  assert.deepEqual(
    nonPlayer.config.columns.map((c) => (c as { name: string }).name),
    ['discord_user_id'],
  )
  assert.match(
    flat(dialect.sqlToQuery(nonPlayer.config.where!).sql),
    /player_id IS NULL AND status IN \('offered', 'active'\)/,
  )
  const auto = cfg.indexes.find((i) => i.config.name === 'news_interviews_auto_night_uniq')!
  assert.equal(auto.config.unique, true)
  assert.match(flat(dialect.sqlToQuery(auto.config.where!).sql), /"trigger" = 'auto'/)
  assert.deepEqual([...INTERVIEW_STATUSES], ['offered', 'active', 'done', 'stopped', 'expired'])
  const answers = getTableConfig(newsInterviewAnswers)
  assert.equal(answers.name, 'news_interview_answers')
  assert.ok(answers.columns.some((c) => c.name === 'reporter' && c.notNull))
  assert.ok(answers.checks.some((c) => c.name === 'news_interview_answers_usability_check'))
})

void test('migration 0074: only new tables, idempotent, no reference to 0073 (T2)', () => {
  const sqlText = readFileSync(
    new URL('../../../migrations/0074_press_interviews.sql', import.meta.url),
    'utf8',
  )
  const body = sqlText
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_interviews"/)
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_interview_answers"/)
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS "news_interviews_open_player_uniq"/)
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS "news_interviews_auto_night_uniq"/)
  // Additive only: no ALTER of an existing table, nothing dropped.
  assert.doesNotMatch(body, /ALTER TABLE "(news_items|news_scrum\w*|news_gm_notes|players)"/)
  assert.doesNotMatch(body, /\bDROP TABLE\b/)
  assert.doesNotMatch(body, /news_scrum_people|question_reporter|0073/)
  assert.match(body, /^BEGIN;/m)
  assert.match(body, /^COMMIT;/m)
  assert.match(sqlText, /ROLLBACK/)
})

void test('insert: any unique conflict inserts nothing', () => {
  const s = flat(
    q
      .insertInterviewQuery({
        playerId: 1,
        discordUserId: 'u',
        reporter: 'barlow',
        trigger: 'gm',
        night: '2026-11-12',
        channelId: 'c',
      })
      .toSQL().sql,
  )
  assert.match(s, /^insert into "news_interviews"/)
  assert.match(s, /on conflict do nothing returning "id"/)
})

void test('detail lists: to offer, expired offers, expired questions, articles waiting', () => {
  const toOffer = flat(q.interviewDetailQuery({ toOffer: true }).toSQL().sql)
  assert.match(
    toOffer,
    /"news_interviews"\."status" = \$\d+ and "news_interviews"\."offered_at" is null/,
  )
  // T7: a person with no player row is named by display_name (left join: no player row needed).
  assert.match(
    toOffer,
    /coalesce\("news_interviews"\."display_name", nullif\(btrim\("player_profiles"\."player_name"\), ''\), "players"\."gamertag"\)/,
  )
  assert.match(toOffer, /left join "players" on "players"\."id" = "news_interviews"\."player_id"/)
  const offers = q.interviewDetailQuery({ expiredOffers: AT }).toSQL()
  assert.match(
    flat(offers.sql),
    /"news_interviews"\."offered_at" is not null and "news_interviews"\."offered_at" <= \$\d+/,
  )
  const questions = q.interviewDetailQuery({ expiredQuestions: AT }).toSQL()
  assert.match(
    flat(questions.sql),
    /coalesce\("news_interviews"\."last_asked_at", "news_interviews"\."accepted_at", "news_interviews"\."created_at"\) <= \$\d+::timestamptz/,
  )
  assert.ok(questions.params.includes(AT.toISOString()))
  const article = flat(q.interviewDetailQuery({ forArticle: true }).toSQL().sql)
  assert.match(article, /"news_interviews"\."status" in \(\$\d+, \$\d+\)/)
  assert.match(article, /"news_interviews"\."article_status" = \$\d+/)
})

void test('claims: offer, accept, question, follow-up, answer, end and article are conditional', () => {
  const offer = flat(q.claimInterviewOfferQuery(5, AT).toSQL().sql)
  assert.match(
    offer,
    /set "offered_at" = \$1 where \("news_interviews"\."id" = \$2 and "news_interviews"\."status" = \$3 and "news_interviews"\."offered_at" is null\) returning/,
  )
  const accept = q.acceptInterviewQuery(5, AT, AT).toSQL()
  assert.match(flat(accept.sql), /"news_interviews"\."offered_at" >= \$\d+/)
  assert.ok(accept.params.includes('offered') && accept.params.includes('active'))
  const args = { id: 5, questionsAsked: 2, followupsAsked: 1, question: 'Q?', at: AT }
  const question = flat(q.claimInterviewQuestionQuery(args).toSQL().sql)
  assert.match(
    question,
    /"questions_asked" = \$\d+, "asking_followup" = \$\d+, "current_question" = \$\d+/,
  )
  assert.match(question, /"news_interviews"\."current_question" is null/)
  const follow = flat(q.claimInterviewFollowupQuery(args).toSQL().sql)
  assert.match(follow, /"followups_asked" = \$\d+, "asking_followup" = \$\d+/)
  const answerQ = q
    .claimInterviewAnswerQuery({ id: 5, questionsAsked: 2, followupsAsked: 1, at: AT })
    .toSQL()
  const answer = flat(answerQ.sql)
  assert.match(answer, /set "current_question" = \$1, "last_asked_at" = \$2/)
  assert.equal(answerQ.params[0], null)
  assert.match(answer, /"news_interviews"\."current_question" is not null/)
  const endExpired = flat(
    q.endInterviewQuery({ id: 5, from: 'offered', to: 'expired', cutoff: AT, at: AT }).toSQL().sql,
  )
  assert.match(endExpired, /"news_interviews"\."offered_at" <= \$\d+/)
  const endNow = flat(
    q.endInterviewQuery({ id: 5, from: 'active', to: 'done', cutoff: null, at: AT }).toSQL().sql,
  )
  assert.doesNotMatch(endNow, /<=/)
  const article = flat(q.claimInterviewArticleQuery(5).toSQL().sql)
  assert.match(
    article,
    /set "article_status" = \$1 where \("news_interviews"\."id" = \$2 and "news_interviews"\."article_status" = \$3\)/,
  )
})

void test('typed answers: this user, this thread, active with a question open', () => {
  const s = dialect.sqlToQuery(q.openInterviewInThreadSql('thread-1', '200000000000000001'))
  assert.match(
    flat(s.sql),
    /i\.thread_id = \$1 and i\.discord_user_id = \$2 and i\.status = 'active' and i\.current_question is not null/,
  )
  assert.deepEqual(s.params, ['thread-1', '200000000000000001'])
})

void test('limits: /interview per player (expired ones never started), auto offers per club, by mode', () => {
  const p = dialect.sqlToQuery(q.countPlayerInterviewsSinceSql(2, AT, false))
  assert.match(
    flat(p.sql),
    /"trigger" = 'player' and is_test = \$2 and status <> 'expired' and created_at > \$3::timestamptz/,
  )
  assert.deepEqual(p.params, [2, false, AT.toISOString()])
  const a = dialect.sqlToQuery(q.countAutoInterviewsSinceSql(AT, true))
  assert.match(flat(a.sql), /"trigger" = 'auto' and is_test = \$1/)
})

void test("latest player night: active title, not DNF, the player's games, Edmonton night key", () => {
  const s = flat(dialect.sqlToQuery(q.latestPlayerNightSql(2, AT)).sql)
  assert.match(s, /join game_titles g on g\.id = m\.game_title_id and g\.is_active/)
  assert.match(s, /join player_match_stats pms on pms\.match_id = m\.id and pms\.player_id = \$1/)
  assert.match(s, /m\.result <> 'DNF'/)
  assert.match(s, /at time zone 'America\/Edmonton'\) - interval '6 hours'/)
})

void test('automatic source: a night job article, not deleted, no auto offer yet; live = real items only', () => {
  const live = flat(dialect.sqlToQuery(q.nightForAutoInterviewSql(AT, false)).sql)
  assert.match(live, /join news_jobs j on j\.id = n\.job_id and j\.kind = 'night'/)
  assert.match(live, /n\.deleted_at is null/)
  assert.match(live, /and n\.is_test = false/)
  assert.match(
    live,
    /not exists \(select 1 from news_interviews i where i\."trigger" = 'auto' and i\.night = n\.night/,
  )
  const trial = flat(dialect.sqlToQuery(q.nightForAutoInterviewSql(AT, true)).sql)
  assert.doesNotMatch(trial, /n\.is_test = false/)
})

void test('article format: slug marker and Q/A paragraphs round-trip', () => {
  assert.equal(interviewSlugKey(12), 'interview-12')
  assert.equal(isInterviewSlug('interview-12-skater-a-talks'), true)
  assert.equal(isInterviewSlug('2026-11-12-night'), false)
  assert.equal(isInterviewSlug(null), false)
  const body = interviewBody(
    ['Intro one.', 'Intro\ntwo.'],
    [{ question: 'Why?', answer: 'Because.' }],
  )
  assert.equal(body, 'Intro one.\n\nIntro two.\n\nQ: Why?\n\nA: Because.')
  assert.deepEqual(body.split('\n\n').map(interviewParagraph), [
    { kind: 'intro', text: 'Intro one.' },
    { kind: 'intro', text: 'Intro two.' },
    { kind: 'question', text: 'Why?' },
    { kind: 'answer', text: 'Because.' },
  ])
})

void test('migration 0077: player_id nullable, roles and names, idempotent, rolled back in the header', () => {
  const sqlText = readFileSync(
    new URL('../../../migrations/0077_press_bench.sql', import.meta.url),
    'utf8',
  )
  const body = sqlText
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  for (const t of [
    'news_scrum_people',
    'news_scrum_answers',
    'news_gm_asks',
    'news_interviews',
    'news_interview_answers',
  ]) {
    assert.match(body, new RegExp(`ALTER TABLE "${t}" ALTER COLUMN "player_id" DROP NOT NULL`), t)
  }
  for (const t of ['news_scrum_people', 'news_gm_asks', 'news_interviews']) {
    assert.match(
      body,
      new RegExp(
        `ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "person_role" text DEFAULT 'player' NOT NULL`,
      ),
      t,
    )
    assert.match(
      body,
      new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "display_name" text`),
      t,
    )
  }
  assert.match(body, /ALTER TABLE "news_gm_asks" ADD COLUMN IF NOT EXISTS "discord_user_id" text/)
  assert.match(
    body,
    /CREATE UNIQUE INDEX IF NOT EXISTS "news_scrum_people_scrum_user_nonplayer_uniq"/,
  )
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS "news_interviews_open_nonplayer_uniq"/)
  // No table is dropped and no existing row changes (the defaults keep every row a player).
  assert.doesNotMatch(body, /\bDROP TABLE\b|\bDELETE FROM\b|\bUPDATE\b/)
  // The rollback is in the header, as comments.
  assert.match(sqlText, /-- ROLLBACK/)
  assert.match(sqlText, /--   ALTER TABLE news_scrum_people ALTER COLUMN player_id SET NOT NULL;/)
})
