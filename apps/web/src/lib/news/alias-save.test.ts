import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALIAS_MAX_CHARS,
  GENERIC_ALIAS_ERROR,
  parseAliasInput,
  saveAlias,
  type SaveAliasDeps,
} from './alias-save.ts'

function form(alias: string, playerId = '5'): FormData {
  const f = new FormData()
  f.append('alias', alias)
  f.append('playerId', playerId)
  return f
}

function deps(over: Partial<SaveAliasDeps> = {}): SaveAliasDeps & {
  saved: [string, number][]
  logs: string[]
} {
  const saved: [string, number][] = []
  const logs: string[] = []
  return {
    saved,
    logs,
    roster: async () => [{ playerId: 5 }, { playerId: 6 }],
    aliases: async () => [{ alias: 'the wall', playerId: 6, name: 'Pat' }],
    upsert: async (a, p) => void saved.push([a, p]),
    log: (m) => void logs.push(m),
    ...over,
  }
}

void test('the nickname is trimmed and lowercased', () => {
  assert.deepEqual(parseAliasInput(form('  Big Mike  ')), {
    ok: true,
    alias: 'big mike',
    playerId: 5,
  })
})

void test('an empty or too long nickname is refused', () => {
  assert.equal(parseAliasInput(form('   ')).ok, false)
  assert.equal(parseAliasInput(form('x'.repeat(ALIAS_MAX_CHARS + 1))).ok, false)
  assert.equal(parseAliasInput(form('x'.repeat(ALIAS_MAX_CHARS))).ok, true)
})

void test('a missing or bad player is refused', () => {
  assert.equal(parseAliasInput(form('mike', '')).ok, false)
  assert.equal(parseAliasInput(form('mike', '0')).ok, false)
  assert.equal(parseAliasInput(form('mike', 'abc')).ok, false)
})

void test('a new nickname is saved lowercase', async () => {
  const d = deps()
  const r = await saveAlias(form('Big Mike'), d)
  assert.equal(r.status, 'ok')
  assert.deepEqual(d.saved, [['big mike', 5]])
})

void test('a nickname of another player is refused with that name and not overwritten', async () => {
  const d = deps()
  const r = await saveAlias(form('The Wall'), d)
  assert.deepEqual(r, { status: 'error', message: 'Already a nickname of Pat.' })
  assert.deepEqual(d.saved, [])
})

void test('the same nickname for the same player is accepted without a write', async () => {
  const d = deps()
  const r = await saveAlias(form('the wall', '6'), d)
  assert.equal(r.status, 'ok')
  assert.deepEqual(d.saved, [])
})

void test('a player outside the roster is refused', async () => {
  const d = deps()
  const r = await saveAlias(form('mike', '99'), d)
  assert.equal(r.status, 'error')
  assert.deepEqual(d.saved, [])
})

void test('a database error becomes a generic message and a code in the log', async () => {
  const d = deps({
    upsert: async () => {
      throw Object.assign(new Error('secret nickname text'), { code: '23514' })
    },
  })
  const r = await saveAlias(form('mike'), d)
  assert.deepEqual(r, { status: 'error', message: GENERIC_ALIAS_ERROR })
  assert.deepEqual(d.logs, ['saving a nickname failed (23514)'])
})
