import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodWord } from './period-goals.ts'

void test('period words: regulation, OT, OT2, OT3, no shootout', () => {
  assert.equal(periodWord(1), '1st')
  assert.equal(periodWord(2), '2nd')
  assert.equal(periodWord(3), '3rd')
  assert.equal(periodWord(4), 'OT')
  assert.equal(periodWord(5), 'OT2')
  assert.equal(periodWord(6), 'OT3')
  assert.equal(periodWord(7), 'P7')
})
