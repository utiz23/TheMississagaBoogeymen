import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DOSSIER_NOTICE_TEXT,
  addNicknameBox,
  gmNoteBox,
  interviewBox,
  parseKey,
  pressLevelBox,
  profileBox,
  removeNicknameBox,
  type DossierActionDeps,
} from './dossier-box-actions.ts'
import { NOTICE_TEXT } from './box-actions.ts'

const NOW = new Date('2026-11-14T12:00:00Z')
const ADMIN = { playerId: 2, name: 'Silky' }
const OK = { ok: true, summary: 'done' } as const

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

/** Fake deps that record every call; `admin: false` makes the admin check throw (a redirect). */
function fakes(admin = true) {
  const calls: string[] = []
  const logged: { kind: string; actor: string; detail: Record<string, unknown> }[] = []
  let result: Awaited<ReturnType<DossierActionDeps['setPressLevelWithAudit']>> = OK
  const rec =
    (kind: string) =>
    (a: Record<string, unknown> & { actor: { name: string } }): Promise<typeof result> => {
      calls.push(kind)
      logged.push({ kind, actor: a.actor.name, detail: a })
      return Promise.resolve(result)
    }
  const deps: DossierActionDeps = {
    requireAdmin: () => {
      calls.push('requireAdmin')
      return admin ? Promise.resolve(ADMIN) : Promise.reject(new Error('NEXT_REDIRECT'))
    },
    now: () => NOW,
    tonight: () => {
      calls.push('tonight')
      return Promise.resolve('2026-11-13')
    },
    setPressLevelWithAudit: rec('level'),
    addNicknameWithAudit: rec('nick_add'),
    removeNicknameWithAudit: rec('nick_remove'),
    addGmNoteWithAudit: rec('note'),
    queueProfileRequest: rec('profile'),
    queueInterviewRequest: rec('interview'),
  }
  return {
    deps,
    calls,
    logged,
    result: (r: typeof result) => {
      result = r
    },
  }
}

const BENCH = 'u123456789012345678'

void test('structure: each dossier action starts with the admin check; the server actions call them', () => {
  const source = readFileSync(new URL('./dossier-box-actions.ts', import.meta.url), 'utf8')
  const bodies = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)\n/g)]
  assert.deepEqual(
    bodies.map((m) => m[1]),
    [
      'pressLevelBox',
      'addNicknameBox',
      'removeNicknameBox',
      'gmNoteBox',
      'profileBox',
      'interviewBox',
    ],
  )
  for (const m of bodies) {
    assert.match(m[2]!, /const actor = await deps\.requireAdmin\(\)/, m[1])
  }
  const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8')
  for (const fn of bodies.map((m) => m[1]!)) {
    assert.match(actions, new RegExp(`await ${fn}\\(`), fn)
  }
  // Every exported server action of the dossier ends in a redirect through one helper.
  assert.match(actions, /export async function dossierRelationshipAction/)
  // The page files check the admin too.
  for (const f of ['players/page.tsx', 'players/[id]/page.tsx', 'dossiers/page.tsx']) {
    const page = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    assert.match(page, /await requireAdmin\(\)/, f)
  }
})

void test('a caller who is not the admin changes nothing and queues nothing', async () => {
  const f = fakes(false)
  for (const run of [
    () => pressLevelBox(form({ key: '4', level: 'out' }), f.deps),
    () => addNicknameBox(form({ key: '4', nickname: 'zed' }), f.deps),
    () => removeNicknameBox(form({ key: '4', nickname: 'zed' }), f.deps),
    () => gmNoteBox(form({ key: '4', note: 'hi' }), f.deps),
    () => profileBox(form({ key: '4' }), f.deps),
    () => interviewBox(form({ key: '4' }), f.deps),
  ]) {
    await assert.rejects(run(), /NEXT_REDIRECT/)
  }
  assert.deepEqual(
    f.calls.filter((c) => c !== 'requireAdmin'),
    [],
  )
})

void test("press level: set on the player's behalf as the admin; bad level or key changes nothing", async () => {
  const f = fakes()
  assert.deepEqual(await pressLevelBox(form({ key: '4', level: 'easy' }), f.deps), {
    ok: true,
    code: 'level',
  })
  assert.deepEqual(f.logged[0]!.detail['playerId'], 4)
  assert.deepEqual(f.logged[0]!.detail['level'], 'easy')
  assert.equal(f.logged[0]!.actor, 'Silky')
  const g = fakes()
  for (const bad of [
    { key: '4', level: 'nobody' },
    { key: '4' },
    { key: BENCH, level: 'easy' }, // a bench person has no press level
    { key: '0', level: 'easy' },
    { key: '4; drop', level: 'easy' },
  ]) {
    assert.deepEqual(await pressLevelBox(form(bad), g.deps), { ok: false, code: 'bad_input' })
  }
  assert.equal(g.logged.length, 0)
})

void test("nicknames and notes: member only; the rule's refusal code comes back", async () => {
  const f = fakes()
  assert.deepEqual(await addNicknameBox(form({ key: '4', nickname: 'Zed' }), f.deps), {
    ok: true,
    code: 'nick_added',
  })
  assert.equal(f.logged[0]!.detail['nickname'], 'Zed')
  assert.deepEqual(await removeNicknameBox(form({ key: '4', nickname: 'zed' }), f.deps), {
    ok: true,
    code: 'nick_removed',
  })
  f.result({ ok: false, code: 'nick_taken' })
  assert.deepEqual(await addNicknameBox(form({ key: '4', nickname: 'Erb' }), f.deps), {
    ok: false,
    code: 'nick_taken',
  })
  const g = fakes()
  assert.deepEqual(await addNicknameBox(form({ key: BENCH, nickname: 'x1' }), g.deps), {
    ok: false,
    code: 'bad_input',
  })
  assert.deepEqual(await gmNoteBox(form({ key: BENCH, note: 'hi' }), g.deps), {
    ok: false,
    code: 'bad_input',
  })
  assert.equal(g.logged.length, 0)
})

void test("GM note: saved for tonight's night as the admin; Go easy and Leave me out come back as their codes", async () => {
  const f = fakes()
  assert.deepEqual(await gmNoteBox(form({ key: '4', note: 'Great hit on the boards' }), f.deps), {
    ok: true,
    code: 'note',
  })
  const call = f.logged[0]!.detail
  assert.deepEqual(
    [call['playerId'], call['night'], call['note']],
    [4, '2026-11-13', 'Great hit on the boards'],
  )
  f.result({ ok: false, code: 'note_easy' })
  assert.deepEqual(await gmNoteBox(form({ key: '4', note: 'x' }), f.deps), {
    ok: false,
    code: 'note_easy',
  })
  f.result({ ok: false, code: 'out' })
  assert.deepEqual(await gmNoteBox(form({ key: '4', note: 'x' }), f.deps), {
    ok: false,
    code: 'out',
  })
})

void test('profile request: queues a request (the web app makes no AI call); a bench key works; refusals come back', async () => {
  const f = fakes()
  assert.deepEqual(await profileBox(form({ key: '4' }), f.deps), {
    ok: true,
    code: 'profile_queued',
  })
  assert.deepEqual(await profileBox(form({ key: BENCH }), f.deps), {
    ok: true,
    code: 'profile_queued',
  })
  assert.deepEqual(
    f.logged.map((l) => l.detail['key']),
    [{ playerId: 4 }, { discordUserId: '123456789012345678' }],
  )
  f.result({ ok: false, code: 'out' })
  assert.deepEqual(await profileBox(form({ key: '4' }), f.deps), { ok: false, code: 'out' })
  f.result({ ok: false, code: 'request_open' })
  assert.deepEqual(await profileBox(form({ key: '4' }), f.deps), {
    ok: false,
    code: 'request_open',
  })
  assert.deepEqual(await profileBox(form({}), f.deps), { ok: false, code: 'bad_input' })
})

void test('interview request: reporter and topic are checked; empty means "the press service chooses"', async () => {
  const f = fakes()
  assert.deepEqual(
    await interviewBox(form({ key: '4', reporter: 'vale', topic: ' the third period ' }), f.deps),
    { ok: true, code: 'interview_queued' },
  )
  assert.deepEqual(
    [f.logged[0]!.detail['reporter'], f.logged[0]!.detail['topic']],
    ['vale', ' the third period '],
  )
  await interviewBox(form({ key: '4', reporter: '', topic: '  ' }), f.deps)
  assert.deepEqual([f.logged[1]!.detail['reporter'], f.logged[1]!.detail['topic']], [null, null])
  assert.deepEqual(await interviewBox(form({ key: '4', reporter: 'nobody' }), f.deps), {
    ok: false,
    code: 'bad_reporter',
  })
  assert.equal(f.logged.length, 2)
})

void test('every notice has fixed text; the page never echoes the request', () => {
  for (const [code, text] of Object.entries(DOSSIER_NOTICE_TEXT)) {
    assert.ok(text.length > 8, code)
    assert.equal(NOTICE_TEXT[code], text, code)
  }
  for (const code of [
    'level',
    'nick_added',
    'nick_removed',
    'note',
    'profile_queued',
    'interview_queued',
    'bad_nickname',
    'nick_taken',
    'nick_exists',
    'nick_missing',
    'bad_note',
    'note_names_out',
    'note_easy',
    'request_open',
    'not_linked',
    'bad_reporter',
    'bad_topic',
    'out',
    'no_player',
    'bad_level',
  ]) {
    assert.ok(NOTICE_TEXT[code] !== undefined, code)
  }
})

void test("the key rule matches the db package's parseDossierKey", async () => {
  process.env['DATABASE_URL'] = 'postgresql://x:y@127.0.0.1:1/z'
  const q = await import('@eanhl/db/queries')
  for (const raw of [
    '12',
    '0',
    '012',
    'u123456789012345678',
    'u123',
    'u1234567890123456789012',
    'x',
    '',
    '-1',
    '1e3',
  ]) {
    assert.deepEqual(parseKey(raw), q.parseDossierKey(raw), raw)
  }
})
