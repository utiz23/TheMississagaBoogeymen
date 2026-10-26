import test from 'node:test'
import assert from 'node:assert/strict'
import { GENERIC_SAVE_ERROR, saveTake, type SaveTakeDeps } from './takes-save.ts'

const SECRET = 'INVENTED SECRET TAKE TEXT'

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData()
  const base: Record<string, string> = {
    id: '7',
    take: SECRET,
    spread: 'some',
    defender: 'quill',
    intensity: '0',
    ...over,
  }
  for (const [k, v] of Object.entries(base)) if (v !== '') f.append(k, v)
  return f
}

function deps(over: Partial<SaveTakeDeps> = {}): SaveTakeDeps & { logs: string[] } {
  const logs: string[] = []
  return {
    logs,
    holderOf: async () => 'mercer',
    update: async () => true,
    log: (m) => void logs.push(m),
    ...over,
  }
}

void test('a valid edit is saved', async () => {
  const d = deps()
  assert.deepEqual(await saveTake(form(), d), { ok: true })
})

void test('the defender cannot be the take holder', async () => {
  const d = deps()
  const r = await saveTake(form({ defender: 'mercer' }), d)
  assert.deepEqual(r, {
    ok: false,
    error: 'The defender cannot be the reporter who holds the take.',
  })
})

void test('a missing take is refused', async () => {
  const r = await saveTake(form(), deps({ holderOf: async () => null }))
  assert.equal(r.ok, false)
})

void test('a database error gives a generic error; the log holds a code, never the take text', async () => {
  const dbError = Object.assign(
    new Error(`value too long: Failing row contains (${SECRET}, params: ${SECRET})`),
    { code: '22001' },
  )
  const d = deps({
    update: async () => {
      throw dbError
    },
  })
  const r = await saveTake(form(), d)
  assert.deepEqual(r, { ok: false, error: GENERIC_SAVE_ERROR })
  assert.equal(d.logs.length, 1)
  assert.match(d.logs[0]!, /22001/)
  assert.ok(!d.logs[0]!.includes(SECRET))
  assert.ok(!JSON.stringify(r).includes(SECRET))
  // A read error is handled the same way.
  const d2 = deps({
    holderOf: async () => {
      throw new Error(SECRET)
    },
  })
  const r2 = await saveTake(form(), d2)
  assert.deepEqual(r2, { ok: false, error: GENERIC_SAVE_ERROR })
  assert.ok(!d2.logs.join('\n').includes(SECRET))
})
