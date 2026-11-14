/**
 * Background questions: rules, SQL shapes and migration 0084 (task background-b2). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/press-background-asks.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import {
  PRESS_BOX_AUDIT_KINDS,
  newsBackgroundAsks,
  newsBackgroundSettings,
} from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../press-background-asks.js')
const news = await import('../news-press.js')
const dossiers = await import('../press-box-dossiers.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const text = (s: Parameters<typeof dialect.sqlToQuery>[0]) => flat(dialect.sqlToQuery(s).sql)
const AT = new Date('2026-11-14T12:00:00Z')

// ── SQL shapes ───────────────────────────────────────────────────────────────

void test('open questions skip any question with a fact of the person (any status) or an earlier ask', () => {
  const s = text(q.askableQuestionsSql(2, false))
  assert.match(s, /q\.active/)
  assert.match(s, /q\.player_id is null or q\.player_id = \$1/)
  assert.match(
    s,
    /not exists \( select 1 from news_background_facts f where f\.question_id = q\.id and f\.player_id = \$2 \)/,
  )
  assert.match(
    s,
    /not exists \( select 1 from news_background_asks a where a\.question_id = q\.id and a\.player_id = \$3 and a\.is_test = \$4 \)/,
  )
  // no status filter on the facts: a rejected fact keeps the question closed
  assert.doesNotMatch(s, /f\.status/)
})

void test('the 7-day count reads real or test asks as asked, scrum asks only', () => {
  const s = text(q.countAsksSinceSql(2, AT, false))
  assert.match(s, /a\.kind = 'scrum'/)
  assert.match(s, /a\.is_test = \$2/)
  assert.match(s, /a\.asked_at >= \$3::timestamptz/)
})

void test('a fact from an answer is inserted PROPOSED, only from a real answered ask, never for Leave me out or a teammate off "full"', () => {
  const d = dialect.sqlToQuery(q.insertProposedFactSql(9, 'Plays centre.', AT))
  const s = flat(d.sql)
  assert.match(s, /'proposed', 'answer'/)
  assert.doesNotMatch(s, /'confirmed'/)
  assert.doesNotMatch(s, /reviewed_by/)
  assert.match(s, /a\.answered_at is not null and not a\.is_test/)
  assert.match(s, /coalesce\(opp\.press_level, 'full'\) <> 'out'/)
  assert.match(s, /a\.subject_player_id is null or coalesce\(spp\.press_level, 'full'\) = 'full'/)
  assert.match(s, /< \$\d+/)
  assert.ok(d.params.includes(q.MAX_PROPOSED_PER_ANSWER))
  assert.equal(q.BACKGROUND_BOT_NAME, 'press bot')
})

void test('no insert in the module can write a confirmed fact (the status is fixed)', () => {
  const src = readFileSync(
    new URL('../../../src/queries/press-background-asks.ts', import.meta.url),
    'utf8',
  )
  const inserts = src.split('insert into news_background_facts').slice(1)
  assert.equal(inserts.length, 1)
  assert.doesNotMatch(inserts[0]!.split('returning id')[0]!, /confirmed/)
})

void test('answers to a teammate question leave the quote reads (night recap and dossier quotes), with a fallback before 0084', () => {
  const nightWith = text(news.nightPressMaterialSql('2026-11-14', false))
  const nightWithout = text(news.nightPressMaterialSql('2026-11-14', false, false))
  assert.match(
    nightWith,
    /not exists \(select 1 from news_background_asks ba where ba\.answer_scrum_id = a\.id and ba\.subject_player_id is not null\)/,
  )
  assert.doesNotMatch(nightWithout, /news_background_asks/)
  const key = { playerId: 2 }
  const withAsks = text(dossiers.quotesSql(key, 10))
  const without = text(dossiers.quotesSql(key, 10, false))
  assert.match(withAsks, /ba\.answer_scrum_id = a\.id and ba\.subject_player_id is not null/)
  assert.match(withAsks, /ba\.answer_interview_id = ia\.id and ba\.subject_player_id is not null/)
  assert.doesNotMatch(without, /news_background_asks/)
})

void test('the answer lists mark a teammate answer with the table name, not a bare column', () => {
  assert.match(
    text(q.scrumAnswerIsAboutTeammateSql('news_scrum_answers')),
    /ba\.answer_scrum_id = news_scrum_answers\.id/,
  )
  assert.match(
    text(q.interviewAnswerIsAboutTeammateSql('news_interview_answers')),
    /ba\.answer_interview_id = news_interview_answers\.id/,
  )
})

// ── Schema and migration ─────────────────────────────────────────────────────

void test('schema: the ask log keys one ask per panel and per interview, and never a self subject', () => {
  const cfg = getTableConfig(newsBackgroundAsks)
  assert.equal(cfg.name, 'news_background_asks')
  const idx = cfg.indexes.map((i) => i.config.name)
  assert.ok(idx.includes('news_background_asks_scrum_person_uniq'))
  assert.ok(idx.includes('news_background_asks_interview_idx'))
  assert.ok(!idx.includes('news_background_asks_interview_uniq'), 'no cap per interview')
  const checks = cfg.checks.map((c) => c.name)
  assert.ok(checks.includes('news_background_asks_kind_check'))
  assert.ok(checks.includes('news_background_asks_subject_check'))
  assert.equal(getTableConfig(newsBackgroundSettings).name, 'news_background_settings')
  assert.ok((PRESS_BOX_AUDIT_KINDS as readonly string[]).includes('background_switch'))
})

void test('migration 0084: switch row created OFF, idempotent, no fact, no worksheet answer', () => {
  const sql = readFileSync(
    new URL('../../../migrations/0084_background_asks.sql', import.meta.url),
    'utf8',
  )
  assert.match(sql, /"enabled" boolean DEFAULT false NOT NULL/)
  assert.match(
    sql,
    /INSERT INTO "news_background_settings" \("id", "enabled"\) VALUES \(1, false\)/,
  )
  assert.match(sql, /ON CONFLICT \("id"\) DO NOTHING/)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "news_background_asks"/)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "news_background_asks_scrum_person_uniq"/)
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "news_background_asks_interview_idx"/)
  assert.doesNotMatch(sql, /news_background_asks_interview_uniq/)
  // Starts from nothing: no fact row and no worksheet answer is created (operator, 2026-11-14).
  const code = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(code, /news_background_facts/)
  assert.doesNotMatch(code, /INSERT INTO "news_background_(facts|questions)"/)
  assert.doesNotMatch(sql, /camrazz\.md/i)
})
