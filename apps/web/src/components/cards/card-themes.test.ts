/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/cards/card-themes.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_THEME_ORDER } from '@eanhl/db/cards'
import { CARD_POS_COLORS, CARD_THEMES, CARD_TIER_STYLE } from './card-themes.ts'

const REGULAR = ['away', 'home', 'alternate', 'carbon', 'futureB'] as const
const DEAD_KEYS = ['texture', 'unlockBg', 'hud', 'crack', 'noCrack', 'fire', 'flame']
const TOKEN_KEYS = ['ink', 'sv', 'sl', 'rec', 'pct', 'line', 'lead', 'leadL', 'pipOn', 'pipOff']

void test('exactly the 10 shipping themes, in unlock order', () => {
  assert.deepEqual(Object.keys(CARD_THEMES), [...CARD_THEME_ORDER])
})

void test('dead prototype keys are dropped and no design-bundle asset paths remain', () => {
  for (const [key, theme] of Object.entries(CARD_THEMES)) {
    for (const dead of DEAD_KEYS) assert.ok(!(dead in theme), `${key}.${dead}`)
    assert.ok(!JSON.stringify(theme).includes('assets/'), key)
  }
})

void test('text tokens are fully merged with the prototype defaults', () => {
  for (const [key, theme] of Object.entries(CARD_THEMES)) {
    for (const t of TOKEN_KEYS)
      assert.equal(typeof theme.tk[t as keyof typeof theme.tk], 'string', `${key}.tk.${t}`)
  }
})

void test('the five regular themes need no image files', () => {
  for (const key of REGULAR) assert.ok(!JSON.stringify(CARD_THEMES[key]).includes('url('), key)
})

void test('tier chips, silhouette sizes and position colours come from the design', () => {
  assert.equal(CARD_TIER_STYLE[1].silh, 130)
  assert.equal(CARD_TIER_STYLE[5].silh, 156)
  assert.equal(CARD_TIER_STYLE[4].chip.c, '#ef6a5e')
  assert.equal(CARD_POS_COLORS.LW, '#23cf1d')
  assert.equal(CARD_POS_COLORS.G, '#6f00a5')
})
