import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NEWS_RULES_VERSION } from './rules-version.ts'

void test('the rules version is a dated string: YYYY-MM-DD.N', () => {
  assert.match(NEWS_RULES_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/)
})

void test('the rules version is at least the one of the scrum quotes in the night recap', () => {
  const key = (v: string) => {
    const [day, n] = v.split('.')
    return [day!, Number(n)] as const
  }
  const [day, n] = key(NEWS_RULES_VERSION)
  const [minDay, minN] = key('2026-10-26.4')
  assert.ok(day > minDay || (day === minDay && n >= minN), NEWS_RULES_VERSION)
})
