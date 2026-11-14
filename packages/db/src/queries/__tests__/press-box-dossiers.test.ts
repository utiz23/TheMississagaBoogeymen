/**
 * Press Box dossier rules and SQL shapes (task press-box-l2, migration 0081). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/press-box-dossiers.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import {
  newsPlayerProfiles,
  newsPressBoxRequests,
  PRESS_BOX_AUDIT_KINDS,
  PRESS_BOX_REQUEST_KINDS,
} from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../press-box-dossiers.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const AT = new Date('2026-11-14T12:00:00Z')

void test('splitAnswers: usable and joke are quotes; an unusable answer is only counted', () => {
  const CANARY = 'CANARY-UNUSABLE-TEXT'
  const rows = [
    {
      id: 'scrum:1',
      source: 'scrum',
      usability: 'usable',
      question: 'Q1',
      answer: 'A1',
      reporter: 'vale',
      at: new Date(AT.getTime() - 1000),
    },
    {
      id: 'interview:2',
      source: 'interview',
      usability: 'joke',
      question: 'Q2',
      answer: 'A2',
      reporter: 'quill',
      at: AT,
    },
    // A caller that wrongly hands an unusable row its text still gets no text out.
    {
      id: 'scrum:3',
      source: 'scrum',
      usability: 'unusable',
      question: CANARY,
      answer: CANARY,
      reporter: null,
      at: AT,
    },
    {
      id: 'scrum:4',
      source: 'scrum',
      usability: 'unusable',
      question: null,
      answer: null,
      reporter: null,
      at: AT,
    },
  ] as const
  const out = q.splitAnswers(rows)
  assert.deepEqual(out.counts, { usable: 1, joke: 1, unusable: 2 })
  assert.deepEqual(
    out.quotes.map((x) => x.id),
    ['interview:2', 'scrum:1'],
    'newest first',
  )
  assert.equal(JSON.stringify(out).includes(CANARY), false)
})

void test('quote SQL reads the text only for usable and joke answers; the count SQL has no text column', () => {
  for (const key of [{ playerId: 4 }, { discordUserId: '123456789012345678' }]) {
    const quotes = flat(dialect.sqlToQuery(q.quotesSql(key, 30)).sql)
    assert.match(
      quotes,
      /case when a\.usability in \('usable', 'joke'\) then a\.answer end as answer/,
    )
    assert.match(quotes, /case when ia\.usability in \('usable', 'joke'\) then ia\.answer end/)
    assert.match(quotes, /where x\.usability in \('usable', 'joke'\)/)
    assert.match(quotes, /not a\.is_test/)
    const counts = flat(dialect.sqlToQuery(q.answerCountsSql(key)).sql)
    assert.doesNotMatch(counts, /\banswer\b|\bquestion\b/)
    assert.match(counts, /group by usability/)
  }
  const bench = flat(
    dialect.sqlToQuery(q.quotesSql({ discordUserId: '123456789012345678' }, 5)).sql,
  )
  assert.match(bench, /a\.player_id is null and sp\.discord_user_id = \$1/)
})

void test('index and detail SQL leave test rows out and never read answer text', () => {
  const talk = flat(dialect.sqlToQuery(q.talkSql()).sql)
  assert.doesNotMatch(talk, /\.answer\b|\.question\b/)
  assert.match(talk, /where not s\.is_test/)
  assert.match(talk, /where not iv\.is_test/)
  const iv = flat(dialect.sqlToQuery(q.dossierInterviewsSql({ playerId: 3 }, 8)).sql)
  assert.match(iv, /not iv\.is_test/)
  assert.match(iv, /ni\.deleted_at is null/)
  assert.doesNotMatch(iv, /\.answer\b/)
  const bench = flat(dialect.sqlToQuery(q.benchPeopleSql()).sql)
  assert.match(bench, /sp\.player_id is null/)
})

void test('stance threads that name the player: one id, several ids, never another id', () => {
  const re = new RegExp(q.stanceThreadPattern(5))
  assert.ok(re.test('player-slump:5@2026-06-16'))
  assert.ok(re.test('duo:3:5@2026-06-16'))
  assert.ok(re.test('player-hot:5'))
  assert.equal(re.test('player-slump:15@2026-06-16'), false)
  assert.equal(re.test('player-slump:55@2026-06-16'), false)
  assert.equal(re.test('winning-streak@2026-11-07'), false)
})

void test('dossier keys: a member is a number, a bench person is u + Discord id', () => {
  assert.deepEqual(q.parseDossierKey('12'), { playerId: 12 })
  assert.deepEqual(q.parseDossierKey('u123456789012345678'), {
    discordUserId: '123456789012345678',
  })
  for (const bad of ['0', '012', '1;2', 'u12', 'x123456789012345678', '', '-1']) {
    assert.equal(q.parseDossierKey(bad), null, bad)
  }
  assert.equal(q.dossierKeyOf({ playerId: 7, discordUserId: null }), '7')
  assert.equal(
    q.dossierKeyOf({ playerId: null, discordUserId: '123456789012345678' }),
    'u123456789012345678',
  )
})

void test('mergeIndex: members by name, then bench; counts and dates joined by key', () => {
  const rows = q.mergeIndex({
    roster: [
      { playerId: 5, name: 'Beev', gamertag: 'beev', pressLevel: 'full' },
      { playerId: 2, name: 'Silky', gamertag: 'silkyjoker85', pressLevel: 'easy' },
      { playerId: 9, name: 'Zed', gamertag: 'zed', pressLevel: 'out' },
    ],
    bench: [{ discordUserId: '123456789012345678', name: 'Coach', role: 'coach' }],
    talk: [
      { key: '2', quotes: 4, lastAt: AT },
      { key: '9', quotes: 6, lastAt: AT },
      { key: 'u123456789012345678', quotes: 1, lastAt: null },
    ],
    profiles: new Map([
      ['2', AT],
      ['9', AT],
    ]),
    relationships: new Map([
      [2, 3],
      [9, 2],
    ]),
  })
  assert.deepEqual(
    rows.map((r) => r.key),
    ['5', '2', '9', 'u123456789012345678'],
  )
  const silky = rows.find((r) => r.key === '2')!
  assert.equal(silky.quotes, 4)
  assert.equal(silky.relationships, 3)
  assert.equal(silky.profileWrittenAt, AT)
  assert.equal(silky.pressLevel, 'easy')
  const beev = rows.find((r) => r.key === '5')!
  assert.equal(beev.lastTalkedAt, null)
  assert.equal(beev.profileWrittenAt, null)
  // A "Leave me out" member carries no counts and no dates.
  const zed = rows.find((r) => r.key === '9')!
  assert.deepEqual(
    [zed.quotes, zed.relationships, zed.lastTalkedAt, zed.profileWrittenAt],
    [0, 0, null, null],
  )
  const coach = rows.find((r) => r.role === 'coach')!
  assert.equal(coach.pressLevel, null)
  assert.equal(coach.playerId, null)
})

void test('a "Leave me out" dossier carries identity only', () => {
  const identity = {
    key: '9',
    playerId: 9,
    discordUserId: null,
    name: 'Out Player',
    gamertag: 'outp',
    role: 'player' as const,
    pressLevel: 'out' as const,
    pressLevelSetBy: 'self' as const,
    aliases: ['op'],
    discordLinked: true,
  }
  const d = q.outDossier(identity)
  assert.equal(d.identity, identity)
  assert.equal(d.profile, null)
  for (const list of [
    d.quotes,
    d.takes,
    d.stances,
    d.relationships,
    d.notes,
    d.asks,
    d.interviews,
  ]) {
    assert.deepEqual(list, [])
  }
  assert.deepEqual(d.counts, { usable: 0, joke: 0, unusable: 0 })
  assert.equal(d.scrums.count, 0)
})

void test('nicknames: trimmed, lowercase, 2 to 24 characters, letters and digits, no stop words', () => {
  assert.equal(q.normalizeNickname('  Sil  Ky '), 'sil ky')
  assert.equal(q.normalizeNickname("O'Brien"), "o'brien")
  assert.equal(q.normalizeNickname('Zé'), 'zé')
  for (const bad of [
    '',
    'a',
    'x'.repeat(25),
    'him',
    'The',
    '<b>x</b>',
    '@everyone',
    '-dash',
    'a\nb;drop',
  ]) {
    assert.equal(q.normalizeNickname(bad), null, bad)
  }
})

void test('namesAny: whole words only; short keys never match', () => {
  assert.equal(q.namesAny('Erb scored twice', ['erb']), true)
  assert.equal(q.namesAny('Herbert scored twice', ['erb']), false)
  assert.equal(q.namesAny('good night for Joey Flopfish', ['joey flopfish']), true)
  assert.equal(q.namesAny('he is d', ['d']), false)
  assert.equal(q.namesAny('nothing here', []), false)
  assert.equal(q.namesAny('a.b.c', ['a.b.c']), true)
})

void test('stored profile and request shapes', () => {
  const p = getTableConfig(newsPlayerProfiles)
  assert.equal(p.name, 'news_player_profiles')
  assert.deepEqual(p.columns.map((c) => c.name).sort(), [
    'cost_usd',
    'discord_user_id',
    'display_name',
    'id',
    'model',
    'player_id',
    'profile',
    'rules_version',
    'written_at',
  ])
  const r = getTableConfig(newsPressBoxRequests)
  for (const col of ['target_player_id', 'target_discord_user_id', 'reporter', 'topic']) {
    assert.ok(
      r.columns.some((c) => c.name === col),
      col,
    )
  }
  assert.deepEqual([...PRESS_BOX_REQUEST_KINDS], ['testscrum', 'profile', 'interview'])
  for (const k of [
    'press_level',
    'nickname_add',
    'nickname_remove',
    'gm_note',
    'profile_request',
    'interview_request',
  ]) {
    assert.ok((PRESS_BOX_AUDIT_KINDS as readonly string[]).includes(k), k)
  }
})

void test('migration 0081: idempotent, rollback in the header, nothing destructive in the body', () => {
  const file = readFileSync(
    new URL('../../../migrations/0081_press_box_dossiers.sql', import.meta.url),
    'utf8',
  )
  const [header, body] = file.split('\nBEGIN;') as [string, string]
  assert.match(header, /ROLLBACK/)
  assert.match(header, /DROP TABLE IF EXISTS "news_player_profiles"/)
  assert.match(header, /DROP COLUMN IF EXISTS "target_player_id"/)
  assert.match(header, /DEPLOY ORDER/)
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_player_profiles"/)
  for (const col of ['target_player_id', 'target_discord_user_id', 'reporter', 'topic']) {
    assert.match(body, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`))
  }
  assert.match(body, /CHECK \("kind" IN \('testscrum', 'profile', 'interview'\)\)/)
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS "news_player_profiles_player_uniq"/)
  assert.doesNotMatch(body, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/)
})
