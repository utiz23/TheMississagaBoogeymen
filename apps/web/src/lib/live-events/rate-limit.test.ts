import test from 'node:test'
import assert from 'node:assert/strict'
import { RateLimiter } from './rate-limit.ts'

void test('60 a minute: a burst of 60, then one more each second', () => {
  let t = 0
  const limiter = new RateLimiter(60, () => t)
  for (let i = 0; i < 60; i++) assert.equal(limiter.take().ok, true, String(i))
  const over = limiter.take()
  assert.equal(over.ok, false)
  assert.equal(over.ok ? null : over.retryAfterS, 1)
  t += 500
  assert.equal(limiter.take().ok, false)
  t += 500
  assert.equal(limiter.take().ok, true)
  assert.equal(limiter.take().ok, false)
})

void test('the bucket never holds more than one minute of requests', () => {
  let t = 0
  const limiter = new RateLimiter(60, () => t)
  t += 3_600_000
  let passed = 0
  for (let i = 0; i < 100; i++) if (limiter.take().ok) passed++
  assert.equal(passed, 60)
})

void test('a clock that steps back does not add requests', () => {
  let t = 10_000
  const limiter = new RateLimiter(2, () => t)
  assert.equal(limiter.take().ok, true)
  assert.equal(limiter.take().ok, true)
  t -= 5_000
  assert.equal(limiter.take().ok, false)
})
