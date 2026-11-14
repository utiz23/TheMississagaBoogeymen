import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  NOTICE_TEXT,
  noticeFromQuery,
  parseId,
  parseRelationshipForm,
  relationshipBox,
  runTestScrumBox,
  setHeatBox,
  type PressBoxActionDeps,
} from './box-actions.ts'

const NOW = new Date('2026-11-14T12:00:00Z')
const ADMIN = { playerId: 2, name: 'Silky' }

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

/** Fake deps that record every call; `admin: false` makes the admin check throw (a redirect). */
function fakes(admin = true) {
  const calls: string[] = []
  const logged: { kind: string; actor: string; detail: unknown }[] = []
  let openRequest = false
  let relResult: Awaited<ReturnType<PressBoxActionDeps['applyRelationshipAction']>> = {
    ok: true,
    summary: 'feud -5.0 -> simmering -2.5',
  }
  const deps: PressBoxActionDeps = {
    requireAdmin: () => {
      calls.push('requireAdmin')
      return admin ? Promise.resolve(ADMIN) : Promise.reject(new Error('NEXT_REDIRECT'))
    },
    now: () => NOW,
    tonight: () => {
      calls.push('tonight')
      return Promise.resolve('2026-11-13')
    },
    setHeatWithAudit: (a) => {
      calls.push('setHeatWithAudit')
      logged.push({ kind: 'heat', actor: a.actor.name, detail: a })
      return Promise.resolve()
    },
    hasOpenTestScrum: () => {
      calls.push('hasOpenTestScrum')
      return Promise.resolve(openRequest)
    },
    queueTestScrum: (a) => {
      calls.push('queueTestScrum')
      logged.push({ kind: 'testscrum', actor: a.actor.name, detail: a })
      return Promise.resolve(7)
    },
    applyRelationshipAction: (a) => {
      calls.push('applyRelationshipAction')
      logged.push({ kind: a.action.kind, actor: a.actor.name, detail: a })
      return Promise.resolve(relResult)
    },
  }
  return {
    deps,
    calls,
    logged,
    openRequest: (v: boolean) => (openRequest = v),
    relResult: (r: typeof relResult) => (relResult = r),
  }
}

const REL = { playerId: '4', reporter: 'pettibone', kind: 'cooldown' }

void test('every action checks the admin first, and a failed check changes nothing', async () => {
  const f = fakes(false)
  await assert.rejects(setHeatBox(form({ heat: 'hot', scope: 'next' }), f.deps), /NEXT_REDIRECT/)
  await assert.rejects(runTestScrumBox(f.deps), /NEXT_REDIRECT/)
  await assert.rejects(relationshipBox(form(REL), f.deps), /NEXT_REDIRECT/)
  assert.deepEqual(f.calls, ['requireAdmin', 'requireAdmin', 'requireAdmin'])
  assert.equal(f.logged.length, 0)
})

void test('structure: each exported action starts with the admin check', () => {
  const source = readFileSync(new URL('./box-actions.ts', import.meta.url), 'utf8')
  const bodies = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)\n/g)]
  assert.deepEqual(
    bodies.map((m) => m[1]),
    ['setHeatBox', 'runTestScrumBox', 'relationshipBox'],
  )
  for (const m of bodies) {
    assert.match(m[2]!, /const actor = await deps\.requireAdmin\(\)/, m[1])
  }
  // The server actions only call these (no query of their own besides the injected ones).
  const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8')
  assert.match(actions, /^'use server'/)
  for (const fn of ['setHeatBox', 'runTestScrumBox', 'relationshipBox']) {
    assert.match(actions, new RegExp(`await ${fn}\\(`))
  }
})

void test('heat: saved by the admin with the actor named; night heat is tied to tonight', async () => {
  const f = fakes()
  const r = await setHeatBox(form({ heat: 'hot', scope: 'night' }), f.deps)
  assert.deepEqual(r, { ok: true, code: 'heat' })
  const call = f.logged[0]!.detail as { heat: string; scope: string; night: string | null }
  assert.deepEqual([call.heat, call.scope, call.night], ['hot', 'night', '2026-11-13'])
  assert.equal(f.logged[0]!.actor, 'Silky')
  // A "next" heat is not tied to a night.
  const g = fakes()
  await setHeatBox(form({ heat: 'cool', scope: 'next' }), g.deps)
  assert.equal((g.logged[0]!.detail as { night: string | null }).night, null)
  assert.ok(!g.calls.includes('tonight'))
})

void test('heat: a bad value changes nothing', async () => {
  const f = fakes()
  assert.deepEqual(await setHeatBox(form({ heat: 'lava', scope: 'next' }), f.deps), {
    ok: false,
    code: 'bad_input',
  })
  assert.deepEqual(await setHeatBox(form({ heat: 'hot' }), f.deps), {
    ok: false,
    code: 'bad_input',
  })
  assert.equal(f.logged.length, 0)
})

void test('test scrum: queued once, logged; a second click while one waits changes nothing', async () => {
  const f = fakes()
  assert.deepEqual(await runTestScrumBox(f.deps), { ok: true, code: 'testscrum' })
  assert.equal(f.logged.length, 1)
  f.openRequest(true)
  assert.deepEqual(await runTestScrumBox(f.deps), { ok: false, code: 'test_scrum_open' })
  assert.equal(f.logged.length, 1)
})

void test('relationship: every kind is parsed, run as the admin and reported', async () => {
  for (const kind of ['cooldown', 'reset', 'freeze', 'unfreeze', 'level_clear']) {
    const f = fakes()
    const r = await relationshipBox(form({ ...REL, kind }), f.deps)
    assert.deepEqual(r, { ok: true, code: 'relationship' })
    assert.equal(f.logged[0]!.kind, kind)
    assert.equal(f.logged[0]!.actor, 'Silky')
  }
  const f = fakes()
  await relationshipBox(form({ ...REL, kind: 'level', level: 'feud', reason: 'playoffs' }), f.deps)
  assert.deepEqual((f.logged[0]!.detail as { action: unknown }).action, {
    kind: 'level',
    level: 'feud',
    reason: 'playoffs',
  })
})

void test('relationship: a refused rule comes back as its code; bad fields never reach the query', async () => {
  const f = fakes()
  f.relResult({ ok: false, code: 'frozen', error: 'frozen' })
  assert.deepEqual(await relationshipBox(form(REL), f.deps), { ok: false, code: 'frozen' })
  const g = fakes()
  for (const bad of [
    { ...REL, playerId: '0' },
    { ...REL, playerId: 'abc' },
    { ...REL, reporter: 'nobody' },
    { ...REL, kind: 'delete' },
    { ...REL, kind: 'level', level: 'feud' }, // no reason field
    { ...REL, kind: 'level', level: 'extreme', reason: 'x' },
  ]) {
    assert.deepEqual(await relationshipBox(form(bad), g.deps), { ok: false, code: 'bad_input' })
  }
  assert.equal(g.logged.length, 0)
})

void test('form parsing and notice codes', () => {
  assert.equal(parseId('12'), 12)
  assert.equal(parseId('012'), null)
  assert.equal(parseId('1; drop'), null)
  assert.equal(parseId(null), null)
  assert.equal(
    parseRelationshipForm(form({ playerId: '4', reporter: 'vale', kind: 'reset' }))?.reporter,
    'vale',
  )
  assert.equal(noticeFromQuery('frozen'), 'frozen')
  assert.equal(noticeFromQuery('<script>'), null)
  assert.equal(noticeFromQuery('constructor'), null)
  assert.equal(noticeFromQuery(undefined), null)
  // Every notice has fixed text.
  for (const text of Object.values(NOTICE_TEXT)) assert.ok(text.length > 3)
})
