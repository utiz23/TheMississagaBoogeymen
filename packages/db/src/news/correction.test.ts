import test from 'node:test'
import assert from 'node:assert/strict'
import { correctionItem, correctionText } from './correction.js'

void test('the correction names the reporter and says what happened', () => {
  assert.equal(
    correctionText('mercer', 'post'),
    'Correction: an earlier post from Dex Mercer had a wrong fact and was removed.',
  )
  assert.equal(
    correctionText('voss', 'article'),
    'Correction: an earlier article from Talia Voss had a wrong fact and was removed.',
  )
})

void test('the correction post: same reporter and night, a plain post, sent on the next pass', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  const item = correctionItem(
    { reporter: 'mercer', kind: 'post', night: '2026-10-24', isTest: false },
    now,
  )
  assert.ok(item)
  assert.equal(item.kind, 'post')
  assert.equal(item.reporter, 'mercer')
  assert.equal(item.night, '2026-10-24')
  assert.equal(item.replyTo ?? null, null)
  assert.equal(item.isTest, false)
  assert.equal(item.sendAfter, now)
  assert.equal(item.facts, null)
  assert.deepEqual(item.mentions, [])
  // No correction for an item that was never public.
  assert.equal(
    correctionItem({ reporter: 'mercer', kind: 'post', night: null, isTest: true }, now),
    null,
  )
})
