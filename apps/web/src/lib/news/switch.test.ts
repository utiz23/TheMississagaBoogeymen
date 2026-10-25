import test from 'node:test'
import assert from 'node:assert/strict'
import { switchNewsDesk, type NewsSwitchDeps } from './switch.ts'

const NOW = new Date('2026-10-24T20:00:00Z')

function fake(enabled: boolean) {
  const calls: string[] = []
  const deps: NewsSwitchDeps = {
    getEnabled: async () => enabled,
    setEnabled: async (on) => void calls.push(`set:${String(on)}`),
    skipBacklog: async (now) => void calls.push(`skip:${now.toISOString()}`),
    now: () => NOW,
  }
  return { deps, calls }
}

void test('switch: off -> on skips the backlog first, then switches on', async () => {
  const f = fake(false)
  await switchNewsDesk(true, f.deps)
  assert.deepEqual(f.calls, [`skip:${NOW.toISOString()}`, 'set:true'])
})

void test('switch: on -> on does not skip again', async () => {
  const f = fake(true)
  await switchNewsDesk(true, f.deps)
  assert.deepEqual(f.calls, ['set:true'])
})

void test('switch: switching off never skips', async () => {
  for (const enabled of [true, false]) {
    const f = fake(enabled)
    await switchNewsDesk(false, f.deps)
    assert.deepEqual(f.calls, ['set:false'])
  }
})

void test('switch: a failed back-fill leaves the desk off', async () => {
  const f = fake(false)
  f.deps.skipBacklog = async () => {
    throw new Error('db down')
  }
  await assert.rejects(switchNewsDesk(true, f.deps), /db down/)
  assert.deepEqual(f.calls, [])
})
