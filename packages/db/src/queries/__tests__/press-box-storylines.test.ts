/**
 * Press Box storylines, trends, takes and stances (task press-box-l3, migration 0085).
 * No real database: the async actions run against a scripted fake transaction.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/press-box-storylines.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { PRESS_BOX_AUDIT_KINDS, newsStorylines } from '../../schema/index.js'
import type { TakeInput } from '../press-box-storylines.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../press-box-storylines.js')
const { db } = await import('../../client.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const AT = new Date('2026-11-14T18:00:00Z')
const ACTOR = { playerId: 2, name: 'Silky' }

// ── Pure rules ───────────────────────────────────────────────────────────────

void test('thread keys: the six derived forms parse, anything else does not', () => {
  assert.deepEqual(q.parseThreadKey('winning-streak@2026-11-07'), {
    kind: 'winning-streak',
    arg: null,
    since: '2026-11-07',
  })
  assert.deepEqual(q.parseThreadKey('player-hot:5@2026-11-09'), {
    kind: 'player-hot',
    arg: '5',
    since: '2026-11-09',
  })
  assert.equal(q.parseThreadKey('rival:nhlclub02139@2026-11-01')?.arg, 'nhlclub02139')
  for (const bad of [
    'storyline:4',
    'player-hot@2026-11-09',
    'player-hot:x@2026-11-09',
    'winning-streak:5@2026-11-09',
    'rival@2026-11-09',
    'nonsense@2026-11-09',
    'player-hot:5@2026-13',
    '',
  ]) {
    assert.equal(q.parseThreadKey(bad), null, bad)
  }
})

void test('thread labels: fixed words, no digit, the player name where there is one', () => {
  const label = (k: string, name: string | null = null) => q.threadLabel(q.parseThreadKey(k)!, name)
  assert.equal(label('winning-streak@2026-11-07'), 'The win streak')
  assert.equal(label('losing-streak@2026-11-09'), 'The losing streak')
  assert.equal(label('pp-drought@2026-06-12'), 'The power-play drought')
  assert.equal(label('player-hot:5@2026-11-09', 'Stick Menace'), "Stick Menace's point streak")
  assert.equal(label('player-slump:5@2026-11-09', 'Erb'), "Erb's goal drought")
  assert.equal(label('rival:big red@2026-11-01'), 'Rival: Big Red')
  for (const k of ['winning-streak@2026-11-07', 'pp-drought@2026-06-12']) {
    assert.doesNotMatch(label(k), /\d/)
  }
  assert.equal(q.threadPlayerId(q.parseThreadKey('player-hot:5@2026-11-09')!), 5)
  assert.equal(q.threadPlayerId(q.parseThreadKey('winning-streak@2026-11-07')!), null)
})

void test('edited text passes the same checks as the desk: crude, digits, a "Leave me out" player, length', () => {
  const out = ['Zed Gone', 'zedder']
  const t = (raw: string, field: Parameters<typeof q.checkTypedText>[1] = 'angle') =>
    q.checkTypedText(raw, field, 100, out)
  assert.deepEqual(t('  a  quiet   angle '), { ok: true, text: 'a quiet angle' })
  assert.deepEqual(t('what a shit night'), { ok: false, code: 'crude' })
  assert.deepEqual(t('he is a dumbass', 'take'), { ok: false, code: 'crude' })
  assert.deepEqual(t('23 hits'), { ok: false, code: 'digits' })
  assert.deepEqual(
    t('23 hits', 'take'),
    { ok: true, text: '23 hits' },
    'a take may keep numbers (as before)',
  )
  assert.deepEqual(t('Zedder is slumping'), { ok: false, code: 'names_out' })
  assert.deepEqual(t('zed gone should skate more', 'take'), { ok: false, code: 'names_out' })
  assert.deepEqual(t('Zeddy is fine'), { ok: true, text: 'Zeddy is fine' }, 'whole words only')
  assert.deepEqual(t(''), { ok: false, code: 'bad_angle' })
  assert.deepEqual(t('', 'title'), { ok: false, code: 'bad_title' })
  assert.deepEqual(t('x'.repeat(101), 'stance'), { ok: false, code: 'bad_stance' })
  assert.deepEqual(q.checkTypedText('', 'angle', 100, out, { allowEmpty: true }), {
    ok: true,
    text: '',
  })
})

void test('take shape: spread, intensity range, reporters, defender not the holder and not a critic', () => {
  const base: TakeInput = {
    take: 'x',
    spread: 'some',
    critics: ['vale'],
    defender: null,
    dataAngle: null,
    intensity: 0,
    active: true,
  }
  assert.deepEqual(q.checkTakeShape({ ...base }, 'quill'), { ok: true })
  assert.deepEqual(q.checkTakeShape({ ...base, spread: 'all' as never }, 'quill'), {
    ok: false,
    code: 'bad_spread',
  })
  for (const intensity of [3, -3, 0.5]) {
    assert.deepEqual(q.checkTakeShape({ ...base, intensity }, 'quill'), {
      ok: false,
      code: 'bad_intensity',
    })
  }
  assert.deepEqual(q.checkTakeShape({ ...base, critics: ['nobody' as never] }, 'quill'), {
    ok: false,
    code: 'bad_reporter',
  })
  assert.deepEqual(q.checkTakeShape({ ...base, defender: 'quill' }, 'quill'), {
    ok: false,
    code: 'bad_defender',
  })
  assert.deepEqual(q.checkTakeShape({ ...base, defender: 'vale' }, 'quill'), {
    ok: false,
    code: 'bad_defender',
  })
  assert.deepEqual(q.checkTakeShape({ ...base, defender: 'rink' }, 'quill'), { ok: true })
})

void test('changedTakeFields names the fields, never the text', () => {
  const a: TakeInput = {
    take: 'SECRET-OLD',
    spread: 'some',
    critics: ['vale'],
    defender: null,
    dataAngle: null,
    intensity: 0,
    active: true,
  }
  const b: TakeInput = {
    ...a,
    take: 'SECRET-NEW',
    intensity: 1,
    active: false,
    critics: ['vale', 'rink'],
  }
  const out = q.changedTakeFields(a, b)
  assert.deepEqual(out, ['text', 'intensity 0 -> 1', 'critics', 'switched off'])
  assert.equal(JSON.stringify(out).includes('SECRET'), false)
  assert.deepEqual(q.changedTakeFields(a, { ...a }), [])
})

// ── SQL shapes ───────────────────────────────────────────────────────────────

void test('stance and thread SQL leave deleted and test items out; typed stances stay', () => {
  const stances = flat(dialect.sqlToQuery(q.stancesForKeysSql(['a@2026-11-09', 'storyline:3'])).sql)
  assert.match(stances, /s\.item_id is null or \(i\.deleted_at is null and i\.is_test = false\)/)
  assert.match(stances, /s\.thread_key in \(\$1, \$2\)/)
  const recent = flat(dialect.sqlToQuery(q.recentThreadKeysSql(AT, 30, 12)).sql)
  assert.match(recent, /s\.thread_key !~ '\^storyline:'/)
  assert.match(recent, /i\.deleted_at is null and i\.is_test = false/)
  assert.match(recent, /limit \$/)
})

void test('the writers read only a pinned storyline that is not closed', async () => {
  const sql = flat(dialect.sqlToQuery(q.pinnedStorylineSql()).sql)
  assert.match(sql, /where pinned and closed_at is null limit 1/)
  // No pinned row: nothing for the writers.
  const none = await withFakeDb([], () => q.getPinnedStoryline())
  assert.equal(none.result, null)
  // A pinned row: its title, angle and the stances kept under its key (a typed storyline: storyline:<id>).
  const some = await withFakeDb(
    [
      {
        match: /where pinned and closed_at is null/,
        rows: [{ id: 4, thread_key: null, title: 'Hits gap', angle: 'Push back' }],
      },
      {
        match: /from news_stances s/,
        rows: Array.from({ length: 8 }, (_, i) => ({
          id: i + 1,
          thread_key: 'storyline:4',
          reporter: 'vale',
          stance: `stance ${String(i)}`,
          night: null,
          created_at: AT,
          item_id: null,
        })),
      },
    ],
    () => q.getPinnedStoryline(),
  )
  assert.equal(some.result?.title, 'Hits gap')
  assert.equal(some.result?.stances.length, q.PINNED_STANCES_MAX)
  assert.equal(some.result?.stances.at(-1)?.stance, 'stance 7', 'the newest stances, oldest first')
  assert.match(
    some.statements.find((s) => /from news_stances s/.test(s))!,
    /s\.thread_key in \(\$1\)/,
  )
})

void test('talk counts: no answer text is read, test answers and answers about a teammate are left out', () => {
  const sql = flat(dialect.sqlToQuery(q.talkCountsSql(AT, 30)).sql)
  assert.doesNotMatch(sql, /\.answer\b|\.question\b/)
  assert.match(sql, /not a\.is_test/)
  assert.match(sql, /not ia\.is_test/)
  assert.match(sql, /news_background_asks/)
  assert.doesNotMatch(
    flat(dialect.sqlToQuery(q.talkCountsSql(AT, 30, false)).sql),
    /news_background_asks/,
  )
})

void test('schema and migration: one pinned row at a time, a pinned row is never closed, nothing destructive', () => {
  const cfg = getTableConfig(newsStorylines)
  const idx = Object.fromEntries(cfg.indexes.map((i) => [i.config.name, i.config]))
  assert.equal(idx['news_storylines_one_pinned_uniq']?.unique, true)
  assert.equal(idx['news_storylines_thread_key_uniq']?.unique, true)
  assert.ok(cfg.checks.some((c) => c.name === 'news_storylines_pin_state_check'))
  for (const kind of [
    'storyline_new',
    'storyline_pin',
    'storyline_unpin',
    'storyline_close',
    'take_add',
    'take_edit',
    'take_remove',
    'stance_add',
    'stance_edit',
    'stance_remove',
  ]) {
    assert.ok((PRESS_BOX_AUDIT_KINDS as readonly string[]).includes(kind), kind)
  }
  const file = readFileSync(
    new URL('../../../migrations/0085_press_box_storylines.sql', import.meta.url),
    'utf8',
  )
  const [header, body] = file.split('\nBEGIN;') as [string, string]
  assert.match(header, /ROLLBACK/)
  assert.match(header, /DROP TABLE IF EXISTS "news_storylines"/)
  assert.match(header, /DEPLOY ORDER/)
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_storylines"/)
  assert.match(
    body,
    /CREATE UNIQUE INDEX IF NOT EXISTS "news_storylines_one_pinned_uniq"\s+ON "news_storylines" \("pinned"\) WHERE "pinned"/,
  )
  assert.match(body, /DROP CONSTRAINT IF EXISTS "news_storylines_pin_state_check"/)
  assert.doesNotMatch(body, /\bDROP TABLE\b|\bDELETE\b|\bTRUNCATE\b|DROP COLUMN/)
})

// ── Actions against a scripted fake transaction ──────────────────────────────

type Step = { match: RegExp; rows: unknown[] }

/** Runs `fn` with `db.transaction` replaced by a fake: statements are recorded, rows scripted by regex. */
async function withFakeDb<T>(
  script: Step[],
  fn: () => Promise<T>,
): Promise<{
  result: T
  statements: string[]
  audits: Record<string, unknown>[]
  committed: boolean
}> {
  const statements: string[] = []
  const audits: Record<string, unknown>[] = []
  let committed = false
  const original = db.transaction
  const originalExecute = db.execute
  const fake = {
    execute: (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const text = flat(dialect.sqlToQuery(query).sql).trim()
      statements.push(text)
      const step = script.find((s) => s.match.test(text))
      return Promise.resolve(step?.rows ?? [])
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        statements.push('AUDIT')
        audits.push(v)
        return Promise.resolve()
      },
    }),
  }
  ;(db as unknown as { transaction: unknown }).transaction = async (
    cb: (tx: unknown) => Promise<unknown>,
  ) => {
    const r = await cb(fake)
    committed = true
    return r
  }
  ;(db as unknown as { execute: unknown }).execute = fake.execute
  try {
    const result = await fn()
    return { result, statements, audits, committed }
  } finally {
    ;(db as unknown as { execute: unknown }).execute = originalExecute
    ;(db as unknown as { transaction: unknown }).transaction = original
  }
}

const row = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 4,
  title: 'The hits gap',
  angle: '',
  pinned: false,
  closed_at: null,
  thread_key: null,
  ...o,
})
const SELECT_ROW = /from news_storylines\s+where id = \$1 for update/

void test('pin: the old pin is released BEFORE the new one is set, both in one transaction with the audit line', async () => {
  const r = await withFakeDb(
    [
      { match: SELECT_ROW, rows: [row()] },
      {
        match: /pinned = false, pinned_at = null.*where pinned and id <> \$2 returning title/,
        rows: [{ title: 'Old one' }],
      },
    ],
    () => q.pinStorylineWithAudit({ ref: { id: 4 }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(r.result.ok, true)
  assert.equal(r.committed, true)
  const unpin = r.statements.findIndex((s) => /where pinned and id <> /.test(s))
  const pin = r.statements.findIndex((s) => /set pinned = true/.test(s))
  const audit = r.statements.indexOf('AUDIT')
  assert.ok(unpin > -1 && pin > unpin && audit > pin, `order: ${r.statements.join(' | ')}`)
  assert.equal(r.audits.length, 1)
  assert.equal(r.audits[0]!['kind'], 'storyline_pin')
  assert.equal(r.audits[0]!['actorName'], 'Silky')
  assert.match(String(r.audits[0]!['summary']), /replaced "Old one"/)
})

void test('pin refuses a closed storyline, an already pinned one and one that names a "Leave me out" player; nothing is written', async () => {
  const closed = await withFakeDb([{ match: SELECT_ROW, rows: [row({ closed_at: AT })] }], () =>
    q.pinStorylineWithAudit({ ref: { id: 4 }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(closed.result, { ok: false, code: 'closed' })
  const already = await withFakeDb([{ match: SELECT_ROW, rows: [row({ pinned: true })] }], () =>
    q.pinStorylineWithAudit({ ref: { id: 4 }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(already.result, { ok: false, code: 'already_pinned' })
  const out = await withFakeDb(
    [
      { match: SELECT_ROW, rows: [row({ title: 'Zedder and the hits' })] },
      { match: /press_level = 'out'/, rows: [{ name: 'Zedder', gamertag: 'zed', aliases: [] }] },
    ],
    () => q.pinStorylineWithAudit({ ref: { id: 4 }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(out.result, { ok: false, code: 'names_out' })
  for (const r of [closed, already, out]) {
    assert.equal(r.audits.length, 0)
    assert.equal(r.statements.filter((s) => /^(update|insert|delete)/.test(s)).length, 0)
  }
})

void test('pin of a reporter-system thread with no row makes the row from the thread label; a thread nobody took a stance on is refused', async () => {
  const key = 'player-hot:5@2026-11-09'
  const ok = await withFakeDb(
    [
      { match: /where thread_key = \$1 for update/, rows: [] },
      { match: /from news_stances where thread_key = \$1 limit 1/, rows: [{ n: 1 }] },
      {
        match: /p\.id = \$1 and p\.ai_goalie_side is null/,
        rows: [{ name: 'Stick Menace', press_level: 'full' }],
      },
      { match: /insert into news_storylines/, rows: [{ id: 9 }] },
    ],
    () => q.pinStorylineWithAudit({ ref: { threadKey: key }, actor: ACTOR, now: AT }),
  )
  assert.equal(ok.result.ok, true)
  assert.equal(ok.audits[0]!['target'], "Stick Menace's point streak")
  const fake = await withFakeDb(
    [
      { match: /where thread_key = \$1 for update/, rows: [] },
      { match: /from news_stances where thread_key = \$1 limit 1/, rows: [] },
    ],
    () => q.pinStorylineWithAudit({ ref: { threadKey: key }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(fake.result, { ok: false, code: 'bad_thread' })
  const bad = await withFakeDb([], () =>
    q.pinStorylineWithAudit({ ref: { threadKey: 'drop table' }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(bad.result, { ok: false, code: 'bad_thread' })
  const out = await withFakeDb(
    [
      { match: /where thread_key = \$1 for update/, rows: [] },
      { match: /from news_stances where thread_key = \$1 limit 1/, rows: [{ n: 1 }] },
      {
        match: /p\.id = \$1 and p\.ai_goalie_side is null/,
        rows: [{ name: 'Zed', press_level: 'out' }],
      },
    ],
    () => q.pinStorylineWithAudit({ ref: { threadKey: key }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(out.result, { ok: false, code: 'out' })
  assert.equal(out.audits.length, 0)
})

void test('close: a pinned storyline is unpinned and closed together; unpin needs a pinned row', async () => {
  const close = await withFakeDb([{ match: SELECT_ROW, rows: [row({ pinned: true })] }], () =>
    q.closeStorylineWithAudit({ ref: { id: 4 }, actor: ACTOR, now: AT }),
  )
  assert.equal(close.result.ok, true)
  const upd = close.statements.find((s) => /^update news_storylines/.test(s))!
  assert.match(upd, /pinned = false, pinned_at = null/)
  assert.match(upd, /closed_at = coalesce\(closed_at, \$1::timestamptz\)/)
  assert.equal(close.audits[0]!['kind'], 'storyline_close')
  assert.match(String(close.audits[0]!['summary']), /it was pinned/)
  const unpinned = await withFakeDb([{ match: SELECT_ROW, rows: [row()] }], () =>
    q.unpinStorylineWithAudit({ ref: { id: 4 }, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(unpinned.result, { ok: false, code: 'not_pinned' })
  const unpin = await withFakeDb([{ match: SELECT_ROW, rows: [row({ pinned: true })] }], () =>
    q.unpinStorylineWithAudit({ ref: { id: 4 }, actor: ACTOR, now: AT }),
  )
  assert.equal(unpin.result.ok, true)
  assert.equal(unpin.audits[0]!['kind'], 'storyline_unpin')
})

void test('every action writes its audit line inside the transaction, and a refused text writes nothing', async () => {
  const take: TakeInput = {
    take: 'Plays hard',
    spread: 'some',
    critics: [],
    defender: null,
    dataAngle: null,
    intensity: 0,
    active: true,
  }
  const cases: [string, () => Promise<{ ok: boolean }>, Step[], string][] = [
    [
      'create',
      () =>
        q.createStorylineWithAudit({
          title: 'Hits gap',
          angle: 'Push back',
          actor: ACTOR,
          now: AT,
        }),
      [{ match: /insert into news_storylines/, rows: [{ id: 3 }] }],
      'storyline_new',
    ],
    [
      'stance add',
      () =>
        q.addStanceWithAudit({
          target: { storylineId: 3 },
          reporter: 'vale',
          text: 'Ride it',
          actor: ACTOR,
          now: AT,
        }),
      [
        {
          match: /from news_storylines\s+where id = \$1 and thread_key is null/,
          rows: [row({ id: 3 })],
        },
        { match: /insert into news_stances/, rows: [{ id: 21 }] },
      ],
      'stance_add',
    ],
    [
      'stance edit',
      () => q.editStanceWithAudit({ id: 21, text: 'Ride it out', actor: ACTOR, now: AT }),
      [
        {
          match: /from news_stances where id = \$1 for update/,
          rows: [{ thread_key: 'storyline:3', reporter: 'vale', stance: 'Ride it' }],
        },
      ],
      'stance_edit',
    ],
    [
      'stance remove',
      () => q.removeStanceWithAudit({ id: 21, actor: ACTOR, now: AT }),
      [
        {
          match: /delete from news_stances/,
          rows: [{ thread_key: 'storyline:3', reporter: 'vale' }],
        },
      ],
      'stance_remove',
    ],
    [
      'take add',
      () =>
        q.addTakeWithAudit({ reporter: 'quill', playerId: 5, input: take, actor: ACTOR, now: AT }),
      [
        {
          match: /p\.id = \$1 and p\.ai_goalie_side is null/,
          rows: [{ name: 'Erb', press_level: 'full' }],
        },
        { match: /insert into news_reporter_takes/, rows: [{ id: 12 }] },
      ],
      'take_add',
    ],
    [
      'take edit',
      () =>
        q.editTakeWithAudit({ id: 12, input: { ...take, intensity: 1 }, actor: ACTOR, now: AT }),
      [
        {
          match: /from news_reporter_takes t/,
          rows: [
            {
              id: 12,
              reporter: 'quill',
              player_id: 5,
              take: 'Plays hard',
              spread: 'some',
              critics: [],
              defender: null,
              data_angle: null,
              intensity: 0,
              active: true,
              player_name: 'Erb',
            },
          ],
        },
      ],
      'take_edit',
    ],
    [
      'take remove',
      () => q.removeTakeWithAudit({ id: 12, actor: ACTOR, now: AT }),
      [
        {
          match: /delete from news_reporter_takes/,
          rows: [{ reporter: 'quill', player_name: 'Erb', len: 10 }],
        },
      ],
      'take_remove',
    ],
  ]
  for (const [name, run, script, kind] of cases) {
    const r = await withFakeDb(script, run)
    assert.equal(r.result.ok, true, name)
    assert.equal(r.committed, true, name)
    assert.equal(r.audits.length, 1, name)
    assert.equal(r.audits[0]!['kind'], kind, name)
    assert.equal(r.audits[0]!['actorName'], 'Silky', name)
  }
  // A refused text: nothing is written and there is no audit line.
  const refused: [string, () => Promise<{ ok: boolean }>][] = [
    [
      'crude storyline',
      () => q.createStorylineWithAudit({ title: 'Shit show', angle: '', actor: ACTOR, now: AT }),
    ],
    [
      'digit angle',
      () => q.createStorylineWithAudit({ title: 'Hits', angle: '23 to 5', actor: ACTOR, now: AT }),
    ],
    [
      'crude stance',
      () =>
        q.addStanceWithAudit({
          target: { storylineId: 3 },
          reporter: 'vale',
          text: 'what a dumbass',
          actor: ACTOR,
          now: AT,
        }),
    ],
    [
      'crude stance edit',
      () => q.editStanceWithAudit({ id: 21, text: 'fuck this', actor: ACTOR, now: AT }),
    ],
    [
      'crude take edit',
      () =>
        q.editTakeWithAudit({ id: 12, input: { ...take, take: 'a bitch' }, actor: ACTOR, now: AT }),
    ],
  ]
  for (const [name, run] of refused) {
    const r = await withFakeDb(
      [
        {
          match: /from news_reporter_takes t/,
          rows: [
            {
              id: 12,
              reporter: 'quill',
              player_id: 5,
              take: 'x',
              spread: 'some',
              critics: [],
              defender: null,
              data_angle: null,
              intensity: 0,
              active: true,
              player_name: 'Erb',
            },
          ],
        },
        {
          match: /from news_stances where id = \$1 for update/,
          rows: [{ thread_key: 'storyline:3', reporter: 'vale', stance: 'x' }],
        },
      ],
      run,
    )
    assert.equal(r.result.ok, false, name)
    assert.equal(r.audits.length, 0, name)
    assert.equal(r.statements.filter((s) => /^(update|insert|delete)/.test(s)).length, 0, name)
  }
})

void test('add a take: a "Leave me out" player and a second take of the same reporter on the same player are refused', async () => {
  const take: TakeInput = {
    take: 'x',
    spread: 'some',
    critics: [],
    defender: null,
    dataAngle: null,
    intensity: 0,
    active: true,
  }
  const out = await withFakeDb(
    [
      {
        match: /p\.id = \$1 and p\.ai_goalie_side is null/,
        rows: [{ name: 'Zed', press_level: 'out' }],
      },
    ],
    () =>
      q.addTakeWithAudit({ reporter: 'quill', playerId: 5, input: take, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(out.result, { ok: false, code: 'out' })
  const dup = await withFakeDb(
    [
      {
        match: /p\.id = \$1 and p\.ai_goalie_side is null/,
        rows: [{ name: 'Erb', press_level: 'full' }],
      },
      { match: /from news_reporter_takes where reporter/, rows: [{ id: 3 }] },
    ],
    () =>
      q.addTakeWithAudit({ reporter: 'quill', playerId: 5, input: take, actor: ACTOR, now: AT }),
  )
  assert.deepEqual(dup.result, { ok: false, code: 'take_exists' })
  const bad = await q.addTakeWithAudit({
    reporter: 'nobody',
    playerId: 5,
    input: take,
    actor: ACTOR,
    now: AT,
  })
  assert.deepEqual(bad, { ok: false, code: 'bad_reporter' })
})

void test('the audit summaries never hold a typed text', async () => {
  const CANARY = 'CANARY-TEXT-xyz'
  const r = await withFakeDb([{ match: /insert into news_storylines/, rows: [{ id: 3 }] }], () =>
    q.createStorylineWithAudit({ title: 'Hits gap', angle: CANARY, actor: ACTOR, now: AT }),
  )
  assert.equal(r.result.ok, true)
  assert.equal(JSON.stringify(r.audits).includes(CANARY), false)
})
