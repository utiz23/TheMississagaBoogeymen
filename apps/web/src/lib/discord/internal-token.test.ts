import test from 'node:test'
import assert from 'node:assert/strict'
import { isInternalTokenValid } from './internal-token.ts'

const TOKEN = 'a'.repeat(32)

void test('the right token passes', () => {
  assert.equal(isInternalTokenValid(TOKEN, TOKEN), true)
})
void test('wrong, missing, or different-length tokens fail', () => {
  assert.equal(isInternalTokenValid('b'.repeat(32), TOKEN), false)
  assert.equal(isInternalTokenValid(null, TOKEN), false)
  assert.equal(isInternalTokenValid(undefined, TOKEN), false)
  assert.equal(isInternalTokenValid('', TOKEN), false)
  assert.equal(isInternalTokenValid(TOKEN.slice(1), TOKEN), false)
})
void test('an unset, empty or short server token refuses everyone', () => {
  assert.equal(isInternalTokenValid('', ''), false)
  assert.equal(isInternalTokenValid('x', undefined), false)
  assert.equal(isInternalTokenValid('short', 'short'), false)
})
