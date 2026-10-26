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

void test('the correction post: same reporter and night, a plain post, flagged, with the rules version', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  const original = {
    reporter: 'mercer' as const,
    kind: 'post' as const,
    night: '2026-10-24',
    isTest: false,
    discordMessageId: 'm1',
  }
  const item = correctionItem(original, now, '2026-10-25.9')
  assert.ok(item)
  assert.equal(item.kind, 'post')
  assert.equal(item.reporter, 'mercer')
  assert.equal(item.night, '2026-10-24')
  assert.equal(item.replyTo ?? null, null)
  assert.equal(item.isTest, false)
  assert.equal(item.isCorrection, true)
  assert.equal(item.rulesVersion, '2026-10-25.9')
  assert.equal(item.facts, null)
  assert.deepEqual(item.mentions, [])
  // The original was on Discord: the correction is sent on the next pass.
  assert.equal(item.sendAfter, now)
  assert.equal(item.discordStatus, undefined)
  // No correction for an item that was never public.
  assert.equal(correctionItem({ ...original, isTest: true }, now, 'v'), null)
})

void test('the original never reached Discord ⇒ the correction is site only (skipped)', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  const item = correctionItem(
    { reporter: 'voss', kind: 'article', night: null, isTest: false, discordMessageId: null },
    now,
    'v',
  )
  assert.ok(item)
  assert.equal(item.sendAfter ?? null, null)
  assert.equal(item.discordStatus, 'skipped')
  assert.match(item.lastError ?? '', /site only/)
  assert.match(item.body, /earlier article from Talia Voss/)
})
