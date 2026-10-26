import test from 'node:test'
import assert from 'node:assert/strict'
import { SIGNATURE_WORDS } from '@eanhl/db/news'
import { CAVEAT_WORDS, hasCaveat, qualityReport, type QualityRow } from './quality.ts'

const row = (over: Partial<QualityRow> = {}): QualityRow => ({
  reporter: 'barlow',
  kind: 'post',
  result: null,
  body: 'The Boogeymen took 14 shots.',
  mentions: [],
  zeroCalled: [],
  takesUsed: [],
  ...over,
})

void test('caveat words are found as whole words, any case', () => {
  assert.ok(CAVEAT_WORDS.includes('but'))
  assert.equal(hasCaveat('A win, but not a clean one.'), true)
  assert.equal(hasCaveat('However you count it, they won.'), true)
  assert.equal(hasCaveat('A clean win from start to finish.'), false)
  assert.equal(hasCaveat('The butler did it.'), false)
})

void test('win posts with a caveat: only game posts that were wins count', () => {
  const r = qualityReport(
    [
      row({ result: 'WIN', body: 'They won, but the third was ugly.' }),
      row({ result: 'WIN', body: 'They won big.' }),
      row({ result: 'WIN', body: 'A win, although a close one.' }),
      row({ result: 'LOSS', body: 'They lost, but fought.' }),
      row({ result: null, body: 'A night post, but not a game.' }),
      row({ kind: 'article', result: 'WIN', body: 'An article, but not a post.' }),
    ],
    new Map(),
  )
  assert.deepEqual(r.winPosts, { total: 3, withCaveat: 2, share: 2 / 3 })
  assert.equal(r.items, 6)
  assert.equal(qualityReport([], new Map()).winPosts.share, null)
})

void test('signature words per reporter: counted by word, only used ones, most first', () => {
  const word = SIGNATURE_WORDS.mercer[0]!
  const r = qualityReport(
    [
      row({ reporter: 'mercer', body: `${word}, then ${word.toUpperCase()}. Plain words.` }),
      row({ reporter: 'mercer', body: 'Nothing special here.' }),
      row({ reporter: 'barlow', body: `${word} from the wrong reporter's bible.` }),
    ],
    new Map(),
  )
  const mine = r.signatureUses.find((s) => s.reporter === 'mercer' && s.word === word)
  assert.equal(mine?.count, 2)
  for (let i = 1; i < r.signatureUses.length; i++) {
    assert.ok(r.signatureUses[i - 1]!.count >= r.signatureUses[i]!.count)
  }
  assert.ok(r.signatureUses.every((s) => s.count > 0))
})

void test('mentions, zero call-outs and takes per player; the reporter mix', () => {
  const takePlayers = new Map([
    [7, 'Skater A'],
    [8, 'Skater B'],
  ])
  const r = qualityReport(
    [
      row({ mentions: [{ name: 'Skater A' }, { name: 'Skater B' }], zeroCalled: ['Skater B'] }),
      row({ mentions: [{ name: 'Skater A' }], takesUsed: [7] }),
      row({
        reporter: 'voss',
        kind: 'article',
        mentions: [{ name: 'Skater A' }],
        zeroCalled: ['Skater B'],
        takesUsed: [7, 8, 99],
      }),
    ],
    takePlayers,
  )
  assert.deepEqual(r.mentionsPerPlayer, [
    { name: 'Skater A', count: 3 },
    { name: 'Skater B', count: 1 },
  ])
  assert.deepEqual(r.zeroCallsPerPlayer, [{ name: 'Skater B', count: 2 }])
  // Take 99 is unknown (deleted take): counted under "unknown take".
  assert.deepEqual(r.takesPerPlayer, [
    { name: 'Skater A', count: 2 },
    { name: 'Skater B', count: 1 },
    { name: 'unknown take', count: 1 },
  ])
  const barlow = r.reporterMix.find((m) => m.reporter === 'barlow')!
  assert.deepEqual([barlow.posts, barlow.articles], [2, 0])
  assert.equal(r.reporterMix.find((m) => m.reporter === 'voss')!.articles, 1)
  assert.equal(r.reporterMix.length, 9)
  assert.equal(barlow.share, 2 / 3)
})
