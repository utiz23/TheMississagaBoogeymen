import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodGoalCells, periodGoalsText, periodWord } from './period-goals.ts'

void test('the card line: BGM goals first, en dash, regulation then OT', () => {
  const rows = [
    { periodNumber: 4, goalsFor: 1, goalsAgainst: 0 },
    { periodNumber: 1, goalsFor: 2, goalsAgainst: 1 },
    { periodNumber: 3, goalsFor: 2, goalsAgainst: 1 },
    { periodNumber: 2, goalsFor: 1, goalsAgainst: 1 },
  ]
  assert.equal(periodGoalsText(rows), '1st 2–1 · 2nd 1–1 · 3rd 2–1 · OT 1–0')
  assert.deepEqual(periodGoalCells(rows)[3], { label: 'OT', score: '1–0' })
})

void test('a 0-0 period still shows (zero is a real value)', () => {
  assert.equal(periodGoalsText([{ periodNumber: 1, goalsFor: 0, goalsAgainst: 0 }]), '1st 0–0')
})

void test('period words: OT2, OT3, no shootout', () => {
  assert.equal(periodWord(5), 'OT2')
  assert.equal(periodWord(6), 'OT3')
  assert.equal(periodWord(7), 'P7')
})
