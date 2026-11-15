import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STORYLINE_NOTICE_TEXT,
  addStanceBox,
  addTakeBox,
  closeStorylineBox,
  createStorylineBox,
  editStanceBox,
  editTakeBox,
  parseRef,
  pinStorylineBox,
  removeStanceBox,
  removeTakeBox,
  unpinStorylineBox,
  type StorylineActionDeps,
} from './storyline-box-actions.ts'
import { NOTICE_TEXT } from './box-actions.ts'

/** Task press-box-l3: the storyline, stance and take actions. Fakes only: no database. */

const NOW = new Date('2026-11-14T18:00:00Z')
const ADMIN = { playerId: 2, name: 'Silky' }
const OK = { ok: true, summary: 'done' } as const

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) f.append(k, one)
  }
  return f
}

function fakes(admin = true) {
  const calls: string[] = []
  const logged: { kind: string; detail: Record<string, unknown> }[] = []
  let result: Awaited<ReturnType<StorylineActionDeps['pinStorylineWithAudit']>> = OK
  const rec =
    (kind: string) =>
    (a: object): Promise<typeof result> => {
      calls.push(kind)
      logged.push({ kind, detail: a as Record<string, unknown> })
      return Promise.resolve(result)
    }
  const deps: StorylineActionDeps = {
    requireAdmin: () => {
      calls.push('requireAdmin')
      return admin ? Promise.resolve(ADMIN) : Promise.reject(new Error('NEXT_REDIRECT'))
    },
    now: () => NOW,
    createStorylineWithAudit: rec('create'),
    pinStorylineWithAudit: rec('pin'),
    unpinStorylineWithAudit: rec('unpin'),
    closeStorylineWithAudit: rec('close'),
    addStanceWithAudit: rec('stance_add'),
    editStanceWithAudit: rec('stance_edit'),
    removeStanceWithAudit: rec('stance_remove'),
    addTakeWithAudit: rec('take_add'),
    editTakeWithAudit: rec('take_edit'),
    removeTakeWithAudit: rec('take_remove'),
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

const TAKE = {
  take: 'Plays hard',
  spread: 'some',
  critics: ['vale'],
  defender: 'rink',
  dataAngle: 'goal rate',
  intensity: '1',
  active: 'on',
}

void test('structure: every action checks the admin first; the server actions call them; the page and layout check the admin', () => {
  const source = readFileSync(new URL('./storyline-box-actions.ts', import.meta.url), 'utf8')
  const bodies = [...source.matchAll(/export async function (\w+Box)\([^)]*\)[^{]*\{\n([^\n]*)\n/g)]
  assert.deepEqual(
    bodies.map((m) => m[1]),
    [
      'createStorylineBox',
      'addStanceBox',
      'editStanceBox',
      'removeStanceBox',
      'addTakeBox',
      'editTakeBox',
      'removeTakeBox',
    ],
  )
  for (const m of bodies) assert.match(m[2]!, /const actor = await deps\.requireAdmin\(\)/, m[1])
  // pin, unpin and close share `refAction`, which checks the admin on its first line.
  const refAction = source.slice(source.indexOf('async function refAction('))
  assert.match(
    refAction.split('\n').slice(0, 8).join('\n'),
    /const actor = await deps\.requireAdmin\(\)/,
  )
  const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8')
  for (const fn of [
    ...bodies.map((m) => m[1]!),
    'pinStorylineBox',
    'unpinStorylineBox',
    'closeStorylineBox',
  ]) {
    assert.match(actions, new RegExp(`await ${fn}\\(`), fn)
  }
  const page = readFileSync(new URL('./storylines/page.tsx', import.meta.url), 'utf8')
  assert.match(
    page.split('export default async function')[1]!.split('\n').slice(0, 6).join('\n'),
    /await requireAdmin\(\)/,
  )
  const layout = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /await requireAdmin\(\)/)
})

void test('the takes section of /admin/news moved: the old editor and its unlogged action are gone, a link stays', () => {
  const news = readFileSync(new URL('../news/page.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(news, /TakesSection|takes-section/)
  assert.match(news, /\/admin\/press-box\/storylines/)
  const actions = readFileSync(new URL('../news/actions.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(actions, /saveTakeAction|updateAdminTake/)
})

void test('every notice code the actions can return has fixed page text, and is reachable from the query string', () => {
  for (const code of Object.keys(STORYLINE_NOTICE_TEXT)) {
    assert.equal(NOTICE_TEXT[code], STORYLINE_NOTICE_TEXT[code], code)
  }
  const types = readFileSync(
    new URL('../../../../../../packages/db/src/queries/press-box-storylines.ts', import.meta.url),
    'utf8',
  )
  const codes = [
    ...types
      .slice(
        types.indexOf('export type StorylineErrorCode'),
        types.indexOf('export type StorylineActionResult'),
      )
      .matchAll(/'(\w+)'/g),
  ].map((m) => m[1]!)
  assert.ok(codes.length > 15)
  for (const c of codes) assert.ok(STORYLINE_NOTICE_TEXT[`sl_${c}`], `sl_${c}`)
})

void test('a caller who is not the admin changes nothing', async () => {
  const f = fakes(false)
  for (const run of [
    () => createStorylineBox(form({ title: 't' }), f.deps),
    () => pinStorylineBox(form({ ref: 's3' }), f.deps),
    () => unpinStorylineBox(form({ ref: 's3' }), f.deps),
    () => closeStorylineBox(form({ ref: 's3' }), f.deps),
    () => addStanceBox(form({ target: 's3', reporter: 'vale', text: 'x' }), f.deps),
    () => editStanceBox(form({ stance: '3', text: 'x' }), f.deps),
    () => removeStanceBox(form({ stance: '3' }), f.deps),
    () => addTakeBox(form({ reporter: 'quill', playerId: '5', ...TAKE }), f.deps),
    () => editTakeBox(form({ id: '3', ...TAKE }), f.deps),
    () => removeTakeBox(form({ id: '3' }), f.deps),
  ]) {
    await assert.rejects(run(), /NEXT_REDIRECT/)
  }
  assert.deepEqual(
    f.calls.filter((c) => c !== 'requireAdmin'),
    [],
  )
})

void test('references: a stored storyline or a thread key; nothing else', () => {
  assert.deepEqual(parseRef('s12'), { id: 12 })
  assert.deepEqual(parseRef('t:player-hot:5@2026-11-09'), { threadKey: 'player-hot:5@2026-11-09' })
  assert.deepEqual(parseRef("t:rival:o'brien & sons@2026-11-01"), {
    threadKey: "rival:o'brien & sons@2026-11-01",
  })
  for (const bad of [
    null,
    '',
    's0',
    's01',
    's1;2',
    'x5',
    't:',
    't:ab',
    't:a\nb@2026-11-09',
    '12',
  ]) {
    assert.equal(parseRef(bad), null, String(bad))
  }
})

void test('create, pin, unpin and close: the admin is the actor and the reference reaches the query', async () => {
  const f = fakes()
  assert.deepEqual(
    await createStorylineBox(form({ title: 'Hits gap', angle: 'Push back' }), f.deps),
    {
      ok: true,
      code: 'sl_ok_new',
    },
  )
  assert.equal(f.logged[0]!.detail['title'], 'Hits gap')
  assert.equal(f.logged[0]!.detail['angle'], 'Push back')
  assert.deepEqual(f.logged[0]!.detail['actor'], ADMIN)
  assert.deepEqual(await pinStorylineBox(form({ ref: 's3' }), f.deps), {
    ok: true,
    code: 'sl_ok_pin',
  })
  assert.deepEqual(f.logged[1]!.detail['ref'], { id: 3 })
  assert.deepEqual(await unpinStorylineBox(form({ ref: 't:winning-streak@2026-11-07' }), f.deps), {
    ok: true,
    code: 'sl_ok_unpin',
  })
  assert.deepEqual(f.logged[2]!.detail['ref'], { threadKey: 'winning-streak@2026-11-07' })
  assert.deepEqual(await closeStorylineBox(form({ ref: 's3' }), f.deps), {
    ok: true,
    code: 'sl_ok_close',
  })
  assert.equal(f.logged[3]!.detail['now'], NOW)
})

void test('a query refusal comes back as a prefixed notice code', async () => {
  const f = fakes()
  f.result({ ok: false, code: 'closed' })
  assert.deepEqual(await pinStorylineBox(form({ ref: 's3' }), f.deps), {
    ok: false,
    code: 'sl_closed',
  })
  f.result({ ok: false, code: 'crude' })
  assert.deepEqual(await createStorylineBox(form({ title: 'x' }), f.deps), {
    ok: false,
    code: 'sl_crude',
  })
})

void test('stances: a typed storyline by id, a thread by key; edit and remove by id', async () => {
  const f = fakes()
  await addStanceBox(form({ target: 's3', reporter: 'vale', text: 'Ride it' }), f.deps)
  assert.deepEqual(f.logged[0]!.detail['target'], { storylineId: 3 })
  assert.equal(f.logged[0]!.detail['reporter'], 'vale')
  assert.equal(f.logged[0]!.detail['text'], 'Ride it')
  await addStanceBox(
    form({ target: 't:pp-drought@2026-06-12', reporter: 'quill', text: 'x' }),
    f.deps,
  )
  assert.deepEqual(f.logged[1]!.detail['target'], { threadKey: 'pp-drought@2026-06-12' })
  assert.deepEqual(await editStanceBox(form({ stance: '7', text: 'New' }), f.deps), {
    ok: true,
    code: 'sl_ok_stance_edit',
  })
  assert.equal(f.logged[2]!.detail['id'], 7)
  assert.deepEqual(await removeStanceBox(form({ stance: '7' }), f.deps), {
    ok: true,
    code: 'sl_ok_stance_remove',
  })
})

void test('takes: the existing form parser checks the fields; add needs a reporter and a player', async () => {
  const f = fakes()
  assert.deepEqual(await addTakeBox(form({ reporter: 'quill', playerId: '5', ...TAKE }), f.deps), {
    ok: true,
    code: 'sl_ok_take_add',
  })
  const d = f.logged[0]!.detail
  assert.equal(d['reporter'], 'quill')
  assert.equal(d['playerId'], 5)
  assert.deepEqual(d['input'], {
    take: 'Plays hard',
    spread: 'some',
    critics: ['vale'],
    defender: 'rink',
    dataAngle: 'goal rate',
    intensity: 1,
    active: true,
  })
  assert.deepEqual(
    await editTakeBox(form({ id: '12', ...TAKE, active: [] as unknown as string }), f.deps),
    {
      ok: true,
      code: 'sl_ok_take_edit',
    },
  )
  assert.equal(f.logged[1]!.detail['id'], 12)
  assert.equal((f.logged[1]!.detail['input'] as { active: boolean }).active, false)
  assert.deepEqual(await removeTakeBox(form({ id: '12' }), f.deps), {
    ok: true,
    code: 'sl_ok_take_remove',
  })
})

void test('a bad field changes nothing', async () => {
  const f = fakes()
  for (const bad of [
    () => createStorylineBox(form({ angle: 'x' }), f.deps),
    () => pinStorylineBox(form({ ref: 'nonsense' }), f.deps),
    () => pinStorylineBox(form({}), f.deps),
    () => closeStorylineBox(form({ ref: 's0' }), f.deps),
    () => addStanceBox(form({ target: 's3', reporter: 'vale' }), f.deps),
    () => addStanceBox(form({ target: 'x', reporter: 'vale', text: 'x' }), f.deps),
    () => editStanceBox(form({ stance: 'abc', text: 'x' }), f.deps),
    () => removeStanceBox(form({ stance: '0' }), f.deps),
    () => addTakeBox(form({ reporter: 'nobody', playerId: '5', ...TAKE }), f.deps),
    () => addTakeBox(form({ reporter: 'quill', playerId: '0', ...TAKE }), f.deps),
    () => addTakeBox(form({ reporter: 'quill', playerId: '5', ...TAKE, take: '' }), f.deps),
    () => addTakeBox(form({ reporter: 'quill', playerId: '5', ...TAKE, intensity: '9' }), f.deps),
    () => editTakeBox(form({ ...TAKE }), f.deps),
    () => editTakeBox(form({ id: 'x', ...TAKE }), f.deps),
    () => removeTakeBox(form({ id: '-1' }), f.deps),
  ]) {
    assert.deepEqual(await bad(), { ok: false, code: 'bad_input' })
  }
  assert.deepEqual(
    f.calls.filter((c) => c !== 'requireAdmin'),
    [],
  )
})
