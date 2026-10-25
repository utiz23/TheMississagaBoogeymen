import test from 'node:test'
import assert from 'node:assert/strict'
import { mapLimit, memoize } from './map-limit.ts'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

void test('mapLimit: input order, at most `limit` in flight, and the timing gain (C2 fix A)', async () => {
  let inFlight = 0
  let most = 0
  const items = Array.from({ length: 24 }, (_, i) => i)
  const t0 = Date.now()
  const out = await mapLimit(items, 6, async (x) => {
    inFlight++
    most = Math.max(most, inFlight)
    await wait(100)
    inFlight--
    return x * 2
  })
  const ms = Date.now() - t0
  assert.deepEqual(
    out,
    items.map((x) => x * 2),
  )
  assert.equal(most, 6)
  // 24 tasks of 100 ms: 2400 ms one at a time, ~400 ms six at a time
  // (a wide margin: the whole suite runs in parallel).
  assert.ok(ms < 1500, `took ${String(ms)} ms`)
  assert.deepEqual(await mapLimit([], 4, async () => 1), [])
})

void test('memoize: one load within the TTL; reloads after it; a failure is not cached', async () => {
  let t = 0
  let loads = 0
  const get = memoize(
    async () => ++loads,
    1000,
    () => t,
  )
  assert.equal(await get(), 1)
  t = 999
  assert.equal(await get(), 1)
  t = 1000
  assert.equal(await get(), 2)
  let fail = true
  const flaky = memoize(
    async () => {
      if (fail) throw new Error('db down')
      return 'ok'
    },
    1000,
    () => 0,
  )
  await assert.rejects(flaky(), /db down/)
  fail = false
  assert.equal(await flaky(), 'ok')
})
