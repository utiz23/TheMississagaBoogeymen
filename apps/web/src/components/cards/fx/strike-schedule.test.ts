/**
 * Run: node --test apps/web/src/components/cards/fx/strike-schedule.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextStrikeDelay } from './strike-schedule.ts'

void test('first wait is short so a hovered card can strike soon', () => {
  assert.equal(
    nextStrikeDelay({ striking: false, first: true }, () => 0),
    1500,
  )
  assert.equal(
    nextStrikeDelay({ striking: false, first: true }, () => 1),
    4000,
  )
})

void test('rain lasts 6–16 s, a strike 1–2 s (prototype stormLoop)', () => {
  assert.equal(
    nextStrikeDelay({ striking: false, first: false }, () => 0),
    6000,
  )
  assert.equal(
    nextStrikeDelay({ striking: false, first: false }, () => 1),
    16000,
  )
  assert.equal(
    nextStrikeDelay({ striking: true, first: false }, () => 0),
    1000,
  )
  assert.equal(
    nextStrikeDelay({ striking: true, first: false }, () => 1),
    2000,
  )
})
