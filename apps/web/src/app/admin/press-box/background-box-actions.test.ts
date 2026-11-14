import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BACKGROUND_NOTICE_TEXT,
  addBackgroundBox,
  confirmBackgroundBox,
  editBackgroundBox,
  rejectBackgroundBox,
  removeBackgroundBox,
  type BackgroundActionDeps,
} from './background-box-actions.ts'
import { NOTICE_TEXT } from './box-actions.ts'

/** Task background-b1: the admin's Background actions. Fakes only: no database. */

const NOW = new Date('2026-11-14T12:00:00Z')
const ADMIN = { playerId: 2, name: 'Silky' }
const OK = { ok: true, summary: 'done', factId: 7 } as const
const BENCH = 'u123456789012345678'

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

function fakes(admin = true) {
  const calls: string[] = []
  const logged: { kind: string; detail: Record<string, unknown> }[] = []
  let result: Awaited<ReturnType<BackgroundActionDeps['addBackgroundFactWithAudit']>> = OK
  const rec =
    (kind: string) =>
    (a: Record<string, unknown>): Promise<typeof result> => {
      calls.push(kind)
      logged.push({ kind, detail: a })
      return Promise.resolve(result)
    }
  const deps: BackgroundActionDeps = {
    requireAdmin: () => {
      calls.push('requireAdmin')
      return admin ? Promise.resolve(ADMIN) : Promise.reject(new Error('NEXT_REDIRECT'))
    },
    now: () => NOW,
    addBackgroundFactWithAudit: rec('add'),
    decideBackgroundFactWithAudit: rec('decide'),
    editBackgroundFactWithAudit: rec('edit'),
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

void test('structure: each background action starts with the admin check; the server actions call them', () => {
  const source = readFileSync(new URL('./background-box-actions.ts', import.meta.url), 'utf8')
  const bodies = [
    ...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)\n/g),
  ].filter((m) => m[1] !== 'decide')
  assert.deepEqual(
    bodies.map((m) => m[1]),
    [
      'addBackgroundBox',
      'confirmBackgroundBox',
      'rejectBackgroundBox',
      'removeBackgroundBox',
      'editBackgroundBox',
    ],
  )
  // add and edit check the admin first; confirm, reject and remove do it in the shared `decide`.
  for (const name of ['addBackgroundBox', 'editBackgroundBox']) {
    const m = bodies.find((b) => b[1] === name)!
    assert.match(m[2]!, /const actor = await deps\.requireAdmin\(\)/, name)
  }
  const decide = source.slice(source.indexOf('async function decide('))
  assert.match(
    decide.split('\n').slice(0, 8).join('\n'),
    /const actor = await deps\.requireAdmin\(\)/,
  )
  const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8')
  for (const fn of bodies.map((m) => m[1]!)) {
    assert.match(actions, new RegExp(`await ${fn}\\(`), fn)
  }
  // The dossier page checks the admin and shows the section.
  const page = readFileSync(new URL('./players/[id]/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /await requireAdmin\(\)/)
  assert.match(page, /<BackgroundPanel/)
})

void test('a caller who is not the admin changes nothing', async () => {
  const f = fakes(false)
  for (const run of [
    () => addBackgroundBox(form({ key: '4', part: 'career', text: 'x' }), f.deps),
    () => confirmBackgroundBox(form({ key: '4', fact: '3' }), f.deps),
    () => rejectBackgroundBox(form({ key: '4', fact: '3' }), f.deps),
    () => removeBackgroundBox(form({ key: '4', fact: '3' }), f.deps),
    () => editBackgroundBox(form({ key: '4', fact: '3', text: 'x' }), f.deps),
  ]) {
    await assert.rejects(run(), /NEXT_REDIRECT/)
  }
  assert.deepEqual(
    f.calls.filter((c) => c !== 'requireAdmin'),
    [],
  )
})

void test('add: a member or a bench person, a real part or a question; the admin is the actor', async () => {
  const f = fakes()
  assert.deepEqual(
    await addBackgroundBox(
      form({ key: '4', part: 'career', text: 'Joined in season one' }),
      f.deps,
    ),
    { ok: true, code: 'bg_added' },
  )
  const d = f.logged[0]!.detail
  assert.deepEqual(d['key'], { playerId: 4 })
  assert.equal(d['part'], 'career')
  assert.equal(d['subjectPlayerId'], null)
  assert.equal(d['questionId'], null)
  assert.deepEqual(d['actor'], ADMIN)
  // A bench person, a teammate, and a bank question (the part is then the question's own).
  await addBackgroundBox(form({ key: BENCH, part: 'room', text: 't', subject: '9' }), f.deps)
  assert.deepEqual(f.logged[1]!.detail['key'], { discordUserId: '123456789012345678' })
  assert.equal(f.logged[1]!.detail['subjectPlayerId'], 9)
  await addBackgroundBox(form({ key: '4', question: '31', text: 't', part: '' }), f.deps)
  assert.equal(f.logged[2]!.detail['questionId'], 31)
  assert.equal(f.logged[2]!.detail['part'], null)
})

void test('add, confirm, reject, remove and edit: a bad field changes nothing', async () => {
  const f = fakes()
  for (const bad of [
    () => addBackgroundBox(form({ key: '0', part: 'career', text: 'x' }), f.deps),
    () => addBackgroundBox(form({ part: 'career', text: 'x' }), f.deps),
    () => addBackgroundBox(form({ key: '4', part: 'career' }), f.deps),
    () => addBackgroundBox(form({ key: '4', part: 'nonsense', text: 'x' }), f.deps),
    () => addBackgroundBox(form({ key: '4', text: 'x' }), f.deps),
    () => addBackgroundBox(form({ key: '4', part: 'career', text: 'x', subject: 'abc' }), f.deps),
    () => addBackgroundBox(form({ key: '4', text: 'x', question: '-3' }), f.deps),
    () => confirmBackgroundBox(form({ key: '4' }), f.deps),
    () => confirmBackgroundBox(form({ key: '4', fact: '0' }), f.deps),
    () => rejectBackgroundBox(form({ key: '4', fact: '1.5' }), f.deps),
    () => removeBackgroundBox(form({ key: '4', fact: 'x' }), f.deps),
    () => editBackgroundBox(form({ key: '4', fact: '3' }), f.deps),
    () => editBackgroundBox(form({ key: '4', text: 'x' }), f.deps),
  ]) {
    assert.deepEqual(await bad(), { ok: false, code: 'bad_input' })
  }
  assert.deepEqual(
    f.calls.filter((c) => c !== 'requireAdmin'),
    [],
  )
})

void test('confirm, reject, remove and edit pass the fact id and the right action to the query', async () => {
  const f = fakes()
  assert.deepEqual(await confirmBackgroundBox(form({ key: '4', fact: '12' }), f.deps), {
    ok: true,
    code: 'bg_confirmed',
  })
  assert.deepEqual(await rejectBackgroundBox(form({ key: '4', fact: '12' }), f.deps), {
    ok: true,
    code: 'bg_rejected',
  })
  assert.deepEqual(await removeBackgroundBox(form({ key: '4', fact: '12' }), f.deps), {
    ok: true,
    code: 'bg_removed',
  })
  assert.deepEqual(
    f.logged.map((l) => [l.detail['factId'], l.detail['action']]),
    [
      [12, 'confirm'],
      [12, 'reject'],
      [12, 'delete'],
    ],
  )
  assert.deepEqual(
    await editBackgroundBox(form({ key: '4', fact: '12', text: 'New text' }), f.deps),
    {
      ok: true,
      code: 'bg_edited',
    },
  )
  assert.equal(f.logged[3]!.detail['confirm'], false)
  await editBackgroundBox(form({ key: '4', fact: '12', text: 'New text', confirm: '1' }), f.deps)
  assert.equal(f.logged[4]!.detail['confirm'], true)
  assert.ok(f.logged.every((l) => l.detail['now'] === NOW && l.detail['actor'] === ADMIN))
})

void test('a refusal from the query comes back as a fixed notice code', async () => {
  const f = fakes()
  f.result({ ok: false, code: 'bad_state' })
  assert.deepEqual(await confirmBackgroundBox(form({ key: '4', fact: '12' }), f.deps), {
    ok: false,
    code: 'bg_bad_state',
  })
  f.result({ ok: false, code: 'bad_fact' })
  assert.deepEqual(await addBackgroundBox(form({ key: '4', part: 'career', text: 'x' }), f.deps), {
    ok: false,
    code: 'bg_bad_fact',
  })
})

void test('every background notice has fixed text, merged into the page notices; none echoes the request', () => {
  for (const [code, text] of Object.entries(BACKGROUND_NOTICE_TEXT)) {
    assert.ok(text.length > 12, code)
    assert.equal(NOTICE_TEXT[code], text, code)
    assert.doesNotMatch(text, /\$\{|%s/)
  }
  for (const code of [
    'bg_added',
    'bg_confirmed',
    'bg_edited',
    'bg_rejected',
    'bg_removed',
    'bg_no_person',
    'bg_no_fact',
    'bg_bad_state',
    'bg_bad_fact',
    'bg_bad_part',
    'bg_bad_subject',
    'bg_bad_question',
  ]) {
    assert.ok(NOTICE_TEXT[code] !== undefined, code)
  }
})

void test("the part list the form checks is the db package's list; the error codes have a notice each", async () => {
  const schema = await import('@eanhl/db/schema')
  const parts = schema.BACKGROUND_PARTS
  for (const p of parts) {
    const f = fakes()
    assert.equal(
      (await addBackgroundBox(form({ key: '4', part: p, text: 'x' }), f.deps)).ok,
      true,
      p,
    )
  }
  process.env['DATABASE_URL'] = 'postgresql://x:y@127.0.0.1:1/z'
  const q = await import('@eanhl/db/queries')
  for (const code of q.BACKGROUND_ERROR_CODES) {
    assert.ok(NOTICE_TEXT[`bg_${code}`] !== undefined, code)
  }
})
