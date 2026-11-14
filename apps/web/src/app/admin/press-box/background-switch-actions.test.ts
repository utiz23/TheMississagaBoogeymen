import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BACKGROUND_SWITCH_NOTICE_TEXT,
  setBackgroundQuestionsBox,
  type BackgroundSwitchDeps,
} from './background-switch-actions.ts'
import { NOTICE_TEXT, noticeFromQuery } from './box-actions.ts'

const NOW = new Date('2026-11-14T12:00:00Z')
const ADMIN = { playerId: 2, name: 'Silky' }

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

function fakes(admin = true) {
  const calls: string[] = []
  const saved: { on: boolean; actor: string; now: Date }[] = []
  const deps: BackgroundSwitchDeps = {
    requireAdmin: () => {
      calls.push('requireAdmin')
      return admin ? Promise.resolve(ADMIN) : Promise.reject(new Error('NEXT_REDIRECT'))
    },
    now: () => NOW,
    setBackgroundQuestionsWithAudit: (a) => {
      calls.push('setBackgroundQuestionsWithAudit')
      saved.push({ on: a.on, actor: a.actor.name, now: a.now })
      return Promise.resolve()
    },
  }
  return { deps, calls, saved }
}

void test('the switch checks the admin first, and a failed check changes nothing', async () => {
  const f = fakes(false)
  await assert.rejects(setBackgroundQuestionsBox(form({ on: '1' }), f.deps), /NEXT_REDIRECT/)
  assert.deepEqual(f.calls, ['requireAdmin'])
  assert.equal(f.saved.length, 0)
})

void test('the switch turns on and off, each time through the one logged query', async () => {
  const f = fakes()
  assert.deepEqual(await setBackgroundQuestionsBox(form({ on: '1' }), f.deps), {
    ok: true,
    code: 'bgq_on',
  })
  assert.deepEqual(await setBackgroundQuestionsBox(form({ on: '0' }), f.deps), {
    ok: true,
    code: 'bgq_off',
  })
  assert.deepEqual(f.saved, [
    { on: true, actor: 'Silky', now: NOW },
    { on: false, actor: 'Silky', now: NOW },
  ])
  assert.deepEqual(f.calls, [
    'requireAdmin',
    'setBackgroundQuestionsWithAudit',
    'requireAdmin',
    'setBackgroundQuestionsWithAudit',
  ])
})

void test('a missing or odd field changes nothing', async () => {
  const f = fakes()
  for (const fields of [{}, { on: '' }, { on: 'true' }, { on: '2' }, { off: '1' }]) {
    assert.deepEqual(await setBackgroundQuestionsBox(form(fields), f.deps), {
      ok: false,
      code: 'bad_input',
    })
  }
  assert.equal(f.saved.length, 0)
})

void test('the notice texts are fixed and known to the page', () => {
  for (const code of Object.keys(BACKGROUND_SWITCH_NOTICE_TEXT)) {
    assert.equal(noticeFromQuery(code), code)
    assert.ok((NOTICE_TEXT[code] ?? '').length > 0)
  }
  assert.match(BACKGROUND_SWITCH_NOTICE_TEXT['bgq_on']!, /ON/)
  assert.match(BACKGROUND_SWITCH_NOTICE_TEXT['bgq_off']!, /OFF/)
})

void test('the server action wires the switch to the admin check and the logged query; the page shows it off by default', () => {
  const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8')
  assert.match(
    actions,
    /setBackgroundQuestionsBox\(formData, \{\s*requireAdmin: deps\.requireAdmin/,
  )
  assert.match(actions, /setBackgroundQuestionsWithAudit/)
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
  assert.match(page, /d\.backgroundQuestionsOn \? '0' : '1'/)
})
