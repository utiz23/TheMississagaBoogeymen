/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/app/preview/_cards/preview-params.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCardOverrides, parseCardPreviewParams } from './preview-params.ts'
import type { CardViewModel } from '../../../components/cards/card-model'

const card = {
  front: { theme: 'carbon', tier: 4, level: 6 },
  back: null,
} as unknown as CardViewModel

void test('defaults: no overrides, front face, gallery shown', () => {
  assert.deepEqual(parseCardPreviewParams({}), {
    theme: null,
    tier: null,
    level: null,
    face: 'front',
    gallery: true,
  })
})

void test('reads valid overrides (any of the 10 themes); ignores junk', () => {
  assert.deepEqual(
    parseCardPreviewParams({
      cardTheme: 'alternate',
      cardTier: '2',
      cardLevel: '9',
      face: 'back',
      gallery: '0',
    }),
    { theme: 'alternate', tier: 2, level: 9, face: 'back', gallery: false },
  )
  assert.equal(parseCardPreviewParams({ cardTheme: 'inferno' }).theme, 'inferno')
  const junk = parseCardPreviewParams({
    cardTheme: 'lava',
    cardTier: '9',
    cardLevel: 'x',
    face: 'side',
  })
  assert.deepEqual([junk.theme, junk.tier, junk.level, junk.face], [null, null, null, 'front'])
})

void test('a theme override brings its own tier unless one is given; a tier override picks its theme', () => {
  const t = applyCardOverrides(card, {
    theme: 'away',
    tier: null,
    level: null,
    face: 'front',
    gallery: true,
  })
  assert.deepEqual([t.front.theme, t.front.tier, t.front.level], ['away', 1, 6])
  const u = applyCardOverrides(card, {
    theme: null,
    tier: 5,
    level: 10,
    face: 'front',
    gallery: true,
  })
  assert.deepEqual([u.front.theme, u.front.tier, u.front.level], ['futureB', 5, 10])
  assert.equal(applyCardOverrides(card, parseCardPreviewParams({})), card)
})
