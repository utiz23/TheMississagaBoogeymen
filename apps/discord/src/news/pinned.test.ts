import test from 'node:test'
import assert from 'node:assert/strict'
import type { PinnedStoryline } from '@eanhl/db/queries'
import { pinnedForSheet } from './pinned.ts'
import {
  PINNED_END,
  PINNED_START,
  buildArticleUserPrompt,
  buildGameArticleUserPrompt,
  buildGameUserPrompt,
  pinnedStorylineBlock,
} from './prompts.ts'
import { REPORTERS } from '@eanhl/db/news'
import { angleLines } from '../press/asker.ts'

const PINNED: PinnedStoryline = {
  id: 4,
  title: 'The hits gap',
  angle: 'Say the team is getting pushed around',
  stances: [
    { reporter: 'pettibone', stance: 'Getting pushed around every night.' },
    { reporter: 'vale', stance: 'Zedder never hits.' },
  ],
}

void test('pinnedForSheet: a forbidden name drops the storyline (title or angle) or the stance', () => {
  assert.equal(pinnedForSheet(null, []), null)
  assert.equal(pinnedForSheet(PINNED, [])?.stances.length, 2)
  assert.deepEqual(
    pinnedForSheet(PINNED, ['Zedder'])?.stances.map((s) => s.reporter),
    ['pettibone'],
  )
  assert.equal(pinnedForSheet({ ...PINNED, title: 'Zedder and the hits' }, ['zedder']), null)
  assert.equal(pinnedForSheet({ ...PINNED, angle: 'Blame  Zedder' }, ['Zedder']), null)
  assert.equal(
    pinnedForSheet({ ...PINNED, title: 'Zeddy is fine', stances: [] }, ['Zedder'])?.title,
    'Zeddy is fine',
  )
})

void test('the block: title, angle and stances as the reporters said them; a stance with a digit is left out; no source named', () => {
  const block = pinnedStorylineBlock({
    ...PINNED,
    stances: [...PINNED.stances, { reporter: 'quill', stance: 'They hit 23 times.' }],
  })!
  assert.ok(block.startsWith(PINNED_START) && block.endsWith(PINNED_END))
  assert.match(block, /Storyline: The hits gap\./)
  assert.match(block, /Suggested angle: Say the team is getting pushed around/)
  assert.ok(block.includes(`- ${REPORTERS.pettibone.name}: "Getting pushed around every night."`))
  assert.ok(!block.includes('23 times'))
  assert.match(block, /Never say where the angle came from/)
  assert.match(block, /Every number and every claim still comes from the fact sheet/)
  assert.doesNotMatch(block, /\b(GM|admin)\b/i)
  assert.equal(pinnedStorylineBlock(undefined), null)
  const bare = pinnedStorylineBlock({ ...PINNED, angle: '', stances: [] })!
  assert.doesNotMatch(bare, /Suggested angle|already said/)
})

void test('the scrum question prompt gets the pinned angle as a suggestion; nothing without one', () => {
  const lines = angleLines({
    angle: { title: 'The hits gap', angle: 'Push back' },
    player: { name: 'Silky', pressLevel: 'full' },
  })
  const text = lines.join('\n')
  assert.match(text, /suggested angle for tonight's questions/)
  assert.match(text, /use it when it fits Silky's game, otherwise ignore it/)
  assert.match(text, /a "Go easy" player gets no criticism because of it/)
  assert.match(text, /- Storyline: The hits gap\./)
  assert.match(text, /- Angle: Push back/)
  assert.deepEqual(angleLines({ player: { name: 'Silky', pressLevel: 'full' } }), [])
  assert.doesNotMatch(
    angleLines({
      angle: { title: 'T', angle: '' },
      player: { name: 'S', pressLevel: 'full' },
    }).join('\n'),
    /Angle:/,
  )
})

void test('structure: the three recap builders print the block after the Club Finals block and before the desk context', () => {
  for (const f of [buildGameUserPrompt, buildArticleUserPrompt, buildGameArticleUserPrompt]) {
    const src = f.toString()
    assert.match(src, /pinnedStorylineBlock\(ctx\.pinned\)/, f.name)
    assert.ok(src.indexOf('finalsBlock') < src.indexOf('pinnedStorylineBlock'), f.name)
  }
})
