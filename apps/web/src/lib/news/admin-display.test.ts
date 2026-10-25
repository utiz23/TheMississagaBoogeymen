import test from 'node:test'
import assert from 'node:assert/strict'
import { itemPreview, monthlyLimitUsd, pressLevelSetByLabel } from './admin-display.ts'

void test('the monthly limit defaults to 10 unless a positive number is set', () => {
  assert.equal(monthlyLimitUsd(undefined), 10)
  assert.equal(monthlyLimitUsd(''), 10)
  assert.equal(monthlyLimitUsd('-3'), 10)
  assert.equal(monthlyLimitUsd('abc'), 10)
  assert.equal(monthlyLimitUsd('7.5'), 7.5)
})

void test('an article shows its headline, a post its first 120 characters', () => {
  assert.equal(
    itemPreview({ kind: 'article', headline: ' Big night ', body: 'long body' }),
    'Big night',
  )
  assert.equal(itemPreview({ kind: 'post', headline: null, body: 'Short\npost' }), 'Short post')
  const long = 'x'.repeat(200)
  assert.equal(itemPreview({ kind: 'post', headline: null, body: long }), `${'x'.repeat(120)}…`)
})

void test('press level source labels', () => {
  assert.equal(pressLevelSetByLabel('admin'), 'set by you')
  assert.equal(pressLevelSetByLabel('self'), 'by the player')
  assert.equal(pressLevelSetByLabel(null), 'default')
})
