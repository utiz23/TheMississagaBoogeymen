import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NEWS_RULES_VERSION } from './rules-version.ts'

void test('the rules version is a dated string: YYYY-MM-DD.N', () => {
  assert.match(NEWS_RULES_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/)
})
