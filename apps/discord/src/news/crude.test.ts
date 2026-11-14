import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crudeHit, crudeHitOutsideNames, normalizeForFilter, slurHit } from './crude.ts'
import { oct12Facts } from './test-fixtures.ts'

void test('slurs are hit, also with leet speak, stretched letters and spread-out letters', () => {
  assert.equal(slurHit('you are a nigger'), true)
  assert.equal(slurHit('n1gg3r'), true)
  assert.equal(slurHit('NIIIGGGER'), true)
  assert.equal(slurHit('n.i.g.g.e.r'), true)
  assert.equal(slurHit('what a faggot'), true)
  assert.equal(slurHit('so retarded'), true)
})

void test('clean hockey talk is not a slur or crude', () => {
  for (const t of [
    'We outshot them 31 to 18 and still lost.',
    'Great game, 455 shots on the season',
    'Dex Mercer is wrong, the power play was fine.',
    'That was a damn good pass',
    'what the hell was that line change',
    'Class act, assassin on the wing, Scunthorpe, Hancock, passage',
  ]) {
    assert.equal(slurHit(t), false, t)
    assert.equal(crudeHit(t), false, t)
  }
})

void test('crude words are hit: strong words, other crude words, and leet speak', () => {
  assert.equal(crudeHit('fuck u wade'), true)
  assert.equal(crudeHit('gord ur an asshole'), true)
  assert.equal(crudeHit('what a $h1t take'), true)
  assert.equal(crudeHit('kiss my ass'), true)
  assert.equal(crudeHit('shut up you dick'), true)
  assert.equal(crudeHit('#FuckMaraQuill'), true)
})

void test('a teammate whose name holds a crude word never counts', () => {
  const base = oct12Facts()
  const facts = { ...base, people: [{ ...base.people[0]!, name: 'Dick Hunter' }] }
  assert.equal(crudeHit('Dick Hunter scored twice'), true)
  assert.equal(crudeHitOutsideNames('Dick Hunter scored twice', facts), false)
  assert.equal(crudeHitOutsideNames('Dick Hunter is an asshole', facts), true)
})

void test('look-alikes map only inside a word with a letter', () => {
  assert.equal(normalizeForFilter('455 shots'), '455 shots')
  assert.equal(normalizeForFilter('4ss'), 'ass')
})
