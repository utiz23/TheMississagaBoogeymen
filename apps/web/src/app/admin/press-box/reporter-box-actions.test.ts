import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LOCKED_RULES, REPORTER_IDS } from '@eanhl/db/news'
import {
  REPORTER_NOTICE_TEXT,
  previewReporterBox,
  reporterOf,
  reporterSwitchBox,
  resetReporterBox,
  saveReporterBox,
  type ReporterActionDeps,
} from './reporter-box-actions.ts'
import { NOTICE_TEXT } from './box-actions.ts'
import { editorValues } from './reporters-data.ts'

/** Task press-box-l4: the reporter actions. Fakes only: no database, no model. */

const NOW = new Date('2026-11-14T18:00:00Z')
const ADMIN = { playerId: 2, name: 'Silky' }
const OK = { ok: true, summary: 'done', version: 4 } as const

function form(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

function fakes(admin = true) {
  const calls: string[] = []
  const logged: { kind: string; detail: Record<string, unknown> }[] = []
  let result: Awaited<ReturnType<ReporterActionDeps['resetReporterCharacterWithAudit']>> = OK
  const rec =
    (kind: string) =>
    (a: object): Promise<typeof result> => {
      calls.push(kind)
      logged.push({ kind, detail: a as Record<string, unknown> })
      return Promise.resolve(result)
    }
  const deps: ReporterActionDeps = {
    requireAdmin: () => {
      calls.push('requireAdmin')
      return admin ? Promise.resolve(ADMIN) : Promise.reject(new Error('NEXT_REDIRECT'))
    },
    now: () => NOW,
    saveReporterCharacterWithAudit: rec('save'),
    resetReporterCharacterWithAudit: rec('reset'),
    queueReporterPreviewWithAudit: rec('preview'),
    setReporterEnabled: (reporter, enabled) => {
      calls.push(`switch:${reporter}:${String(enabled)}`)
      return Promise.resolve()
    },
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

const EDIT = {
  reporter: 'quill',
  bio: 'A dry numbers columnist.',
  voiceNotes: 'She writes lean sentences.',
  catchphrases: 'noise floor\nsmall sample\nthe signal',
  disposition: '1',
}

void test('structure: every action checks the admin first; the server actions call them; both pages and the layout check the admin', () => {
  const source = readFileSync(new URL('./reporter-box-actions.ts', import.meta.url), 'utf8')
  const bodies = [...source.matchAll(/export async function (\w+Box)\([^)]*\)[^{]*\{\n([^\n]*)\n/g)]
  assert.deepEqual(
    bodies.map((m) => m[1]),
    ['saveReporterBox', 'resetReporterBox', 'previewReporterBox', 'reporterSwitchBox'],
  )
  for (const m of bodies) {
    assert.match(m[2]!, /(const actor = )?await deps\.requireAdmin\(\)/, m[1])
  }
  const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8')
  for (const m of bodies) assert.match(actions, new RegExp(`await ${m[1]!}\\(`), m[1])
  for (const file of ['./reporters/page.tsx', './reporters/[id]/page.tsx']) {
    const page = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(
      page.split('export default async function')[1]!.split('\n').slice(0, 10).join('\n'),
      /await requireAdmin\(\)/,
      file,
    )
  }
  assert.match(
    readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8'),
    /await requireAdmin\(\)/,
  )
})

void test('not the admin: nothing runs (no write, no switch, no request)', async () => {
  const f = fakes(false)
  for (const run of [
    () => saveReporterBox(form(EDIT), f.deps),
    () => resetReporterBox(form({ reporter: 'quill' }), f.deps),
    () => previewReporterBox(form({ reporter: 'quill' }), f.deps),
    () => reporterSwitchBox(form({ reporter: 'quill', enabled: '0' }), f.deps),
  ]) {
    await assert.rejects(run(), /NEXT_REDIRECT/)
  }
  assert.deepEqual(f.calls, ['requireAdmin', 'requireAdmin', 'requireAdmin', 'requireAdmin'])
})

void test('save passes the four typed fields, the actor and the clock to the one audited query', async () => {
  const f = fakes()
  assert.deepEqual(await saveReporterBox(form(EDIT), f.deps), { ok: true, code: 'rp_ok_save' })
  assert.deepEqual(f.calls, ['requireAdmin', 'save'])
  assert.deepEqual(f.logged[0]!.detail, {
    reporter: 'quill',
    input: {
      bio: EDIT.bio,
      voiceNotes: EDIT.voiceNotes,
      catchphrases: EDIT.catchphrases,
      disposition: '1',
    },
    actor: ADMIN,
    now: NOW,
  })
})

void test('the locked rules are not a form field: a request that sends them changes nothing about them', async () => {
  const f = fakes()
  await saveReporterBox(form({ ...EDIT, lockedRules: 'none', rules: 'off', locked: '' }), f.deps)
  const sent = JSON.stringify(f.logged[0]!.detail)
  assert.doesNotMatch(sent, /lockedRules|"rules"|"locked"|none|off/)
  assert.deepEqual(Object.keys((f.logged[0]!.detail as { input: object }).input).sort(), [
    'bio',
    'catchphrases',
    'disposition',
    'voiceNotes',
  ])
})

void test('a form with a missing or wrong field changes nothing', async () => {
  const f = fakes()
  for (const bad of [
    { ...EDIT, reporter: 'nobody' },
    { ...EDIT, reporter: '' },
  ]) {
    assert.deepEqual(await saveReporterBox(form(bad), f.deps), { ok: false, code: 'bad_input' })
  }
  for (const key of ['bio', 'voiceNotes', 'catchphrases', 'disposition']) {
    const partial: Record<string, string> = { ...EDIT }
    delete partial[key]
    assert.deepEqual(await saveReporterBox(form(partial), f.deps), { ok: false, code: 'bad_input' })
  }
  assert.deepEqual(await resetReporterBox(form({}), f.deps), { ok: false, code: 'bad_input' })
  assert.deepEqual(await previewReporterBox(form({ reporter: 'x' }), f.deps), {
    ok: false,
    code: 'bad_input',
  })
  assert.equal(
    f.calls.some((c) => c === 'save' || c === 'reset' || c === 'preview'),
    false,
  )
})

void test('a refused query result becomes a fixed notice code (no typed text echoed)', async () => {
  const f = fakes()
  for (const code of [
    'crude',
    'names_out',
    'rules_text',
    'bad_bio',
    'bad_voice',
    'bad_catchphrases',
    'bad_disposition',
    'no_change',
    'bad_reporter',
  ] as const) {
    f.result({ ok: false, code })
    const n = await saveReporterBox(form(EDIT), f.deps)
    assert.deepEqual(n, { ok: false, code: `rp_${code}` })
    assert.ok(REPORTER_NOTICE_TEXT[`rp_${code}`], code)
    assert.ok(NOTICE_TEXT[`rp_${code}`], `${code} is on the shared notice map`)
    assert.doesNotMatch(REPORTER_NOTICE_TEXT[`rp_${code}`]!, /A dry numbers/)
  }
  f.result({ ok: false, code: 'request_open' })
  assert.deepEqual(await previewReporterBox(form({ reporter: 'mercer' }), f.deps), {
    ok: false,
    code: 'rp_request_open',
  })
})

void test('reset and preview go to their own queries with the actor', async () => {
  const f = fakes()
  assert.deepEqual(await resetReporterBox(form({ reporter: 'rink' }), f.deps), {
    ok: true,
    code: 'rp_ok_reset',
  })
  assert.deepEqual(await previewReporterBox(form({ reporter: 'rink' }), f.deps), {
    ok: true,
    code: 'rp_ok_preview',
  })
  assert.deepEqual(f.calls, ['requireAdmin', 'reset', 'requireAdmin', 'preview'])
  assert.deepEqual(f.logged[0]!.detail, { reporter: 'rink', actor: ADMIN, now: NOW })
  assert.deepEqual(f.logged[1]!.detail, { reporter: 'rink', actor: ADMIN, now: NOW })
})

void test('the on/off switch is the existing one: this module only calls it', async () => {
  const f = fakes()
  assert.deepEqual(await reporterSwitchBox(form({ reporter: 'vale', enabled: '0' }), f.deps), {
    ok: true,
    code: 'rp_ok_off',
  })
  assert.deepEqual(await reporterSwitchBox(form({ reporter: 'vale', enabled: '1' }), f.deps), {
    ok: true,
    code: 'rp_ok_on',
  })
  assert.deepEqual(f.calls, [
    'requireAdmin',
    'switch:vale:false',
    'requireAdmin',
    'switch:vale:true',
  ])
  for (const bad of [
    { reporter: 'vale', enabled: 'yes' },
    { reporter: 'vale' },
    { reporter: 'x', enabled: '1' },
  ]) {
    assert.deepEqual(await reporterSwitchBox(form(bad), f.deps), { ok: false, code: 'bad_input' })
  }
  assert.equal(
    f.calls.length,
    4 + 3,
    'a bad request never reaches the switch (only the admin check)',
  )
  // No second switch: nothing in the new files writes to news_reporter_switch itself.
  for (const file of ['./reporter-box-actions.ts', './reporters-data.ts', './reporters-reads.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /news_reporter_switch|newsReporterSwitch/, file)
  }
  const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8')
  assert.match(actions, /setReporterEnabledAction\(reporter, enabled\)/)
})

void test('reporterOf reads only the nine ids', () => {
  for (const id of REPORTER_IDS) assert.equal(reporterOf(form({ reporter: id })), id)
  assert.equal(reporterOf(form({ reporter: 'BARLOW' })), null)
  assert.equal(reporterOf(form({})), null)
})

void test('the editor starts from the saved override, else the code default', () => {
  const defaults = { bio: 'B', voiceNotes: 'V', catchphrases: ['a', 'b', 'c'] }
  const base = { merged: {} as never, defaults }
  assert.deepEqual(editorValues({ ...base, override: null }), {
    bio: 'B',
    voiceNotes: 'V',
    catchphrases: 'a\nb\nc',
    disposition: 'default',
  })
  assert.deepEqual(
    editorValues({
      ...base,
      override: {
        reporter: 'quill',
        bio: 'Mine',
        voiceNotes: null,
        catchphrases: ['x', 'y', 'z'],
        disposition: -2,
        characterVersion: 3,
        updatedBy: 'Silky',
        updatedAt: NOW,
      },
    }),
    { bio: 'Mine', voiceNotes: 'V', catchphrases: 'x\ny\nz', disposition: '-2' },
  )
})

void test('the page shows every locked rule, read only (no field for them)', () => {
  const src = readFileSync(
    new URL('../../../components/press-box/reporters.tsx', import.meta.url),
    'utf8',
  )
  assert.match(src, /LOCKED_RULES\.map/)
  const locked = src.slice(src.indexOf('export function LockedRules'))
  assert.doesNotMatch(locked, /<textarea|<input|<select|<form/)
  assert.ok(LOCKED_RULES.length >= 6)
})
