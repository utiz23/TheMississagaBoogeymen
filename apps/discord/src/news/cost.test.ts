import test from 'node:test'
import assert from 'node:assert/strict'
import { costUsd } from './cost.ts'

void test('opus 5.5 price', () => {
  assert.equal(costUsd('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }), 6)
})

void test('unknown model is priced as opus 5.5', () => {
  assert.equal(costUsd('claude-mystery', { input_tokens: 1_000_000, output_tokens: 100_000 }), 6)
})

void test('cache tokens are priced; null and missing count as zero', () => {
  const u = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  }
  assert.equal(costUsd('claude-opus-5-5', u), 5.2)
  assert.equal(costUsd('claude-sonnet-5-5', u), 2.7)
  assert.equal(costUsd('claude-haiku-5-5', u), 0.135)
  assert.equal(
    costUsd('claude-opus-5-5', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: null,
    }),
    0,
  )
})
