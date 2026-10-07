/**
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/cards/card-style.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_THEMES } from './card-themes.ts'
import { cardLook, resolveFx } from './card-style.ts'

const base = { tier: 4 as const, level: 6, hot: false, role: 'skater' as const, position: 'LW' }

void test('gradient-rim themes: padding-box layers, border-box rim, transparent border', () => {
  const th = CARD_THEMES.carbon
  const look = cardLook(th, base)
  assert.ok(th.grad)
  assert.ok(look.cardBg.endsWith(`${th.grad} border-box`))
  assert.equal(look.cardBg.split(' padding-box').length - 1, th.layers.length)
  assert.equal(look.border, '1px solid transparent')
})

void test('plain-border themes turn the border red when hot', () => {
  const th = CARD_THEMES.home
  assert.equal(cardLook(th, base).border, `1px solid ${String(th.border)}`)
  assert.equal(cardLook(th, { ...base, hot: true }).border, '1px solid rgba(232,65,49,0.45)')
  assert.equal(cardLook(th, { ...base, hot: true }).ruleBg, th.ruleHot)
  assert.equal(cardLook(th, base).ruleBg, th.rule)
})

void test('hot adds the red glow shadow, then the theme suffix', () => {
  const th = CARD_THEMES.home
  const hot = cardLook(th, { ...base, hot: true }).shadow
  assert.ok(hot.startsWith('0 1px 0 rgba(255,255,255,0.04) inset, 0 14px 32px'))
  assert.ok(hot.endsWith(th.shadow))
})

void test('tier chip: theme override applies only at tiers 1–2', () => {
  const th = CARD_THEMES.away
  assert.equal(cardLook(th, { ...base, tier: 1 }).chip.c, th.tk.chipC)
  assert.equal(cardLook(th, { ...base, tier: 3 }).chip.c, '#f4f4f5')
  assert.equal(cardLook(th, { ...base, tier: 1 }).chipText, 'Prospect')
})

void test('position chip: light themes darken the colour; posInk themes use their own ink', () => {
  assert.equal(cardLook(CARD_THEMES.away, base).posColor, 'color-mix(in oklch, #23cf1d 62%, black)')
  assert.equal(cardLook(CARD_THEMES.home, base).posColor, '#23cf1d')
  assert.equal(cardLook(CARD_THEMES.home, base).posBorder, '#23cf1d66')
  assert.equal(cardLook(CARD_THEMES.carbon, base).posColor, CARD_THEMES.carbon.posInk?.c)
})

void test('stat cells: plate themes style each cell, rule themes draw separators', () => {
  const plates = cardLook(CARD_THEMES.carbon, base).stats
  assert.equal(plates[3]?.vc, CARD_THEMES.carbon.plates?.leadV)
  assert.equal(plates[3]?.fs, '23px')
  assert.equal(plates[1]?.sep, false)
  const rules = cardLook(CARD_THEMES.home, base).stats
  assert.deepEqual(
    rules.map((s) => s.sep),
    [false, true, true, true],
  )
  assert.equal(rules[0]?.fs, '19px')
})

void test('level pips: first `level` segments lit', () => {
  const pips = cardLook(CARD_THEMES.home, { ...base, level: 6 }).pips
  assert.equal(pips.length, 10)
  assert.equal(pips.filter((p) => p === CARD_THEMES.home.tk.pipOn).length, 6)
})

void test('effect gates follow the prototype: foil from tier 4 (not Inferno), pulse from tier 2 or when hot', () => {
  const on = { motionOn: true, hot: false, motionAllowed: true }
  assert.equal(resolveFx(CARD_THEMES.carbon, 4, on).foil, true)
  assert.equal(resolveFx(CARD_THEMES.alternate, 3, on).foil, false)
  assert.equal(resolveFx(CARD_THEMES.inferno, 6, on).foil, false)
  assert.equal(resolveFx(CARD_THEMES.away, 1, on).pulse, false)
  assert.equal(
    resolveFx(CARD_THEMES.away, 1, { motionOn: true, hot: true, motionAllowed: true }).pulse,
    true,
  )
  assert.equal(resolveFx(CARD_THEMES.home, 2, on).pulse, true)
  assert.equal(resolveFx(CARD_THEMES.futureB, 5, on).gridAnimated, true)
  const off = resolveFx(CARD_THEMES.futureB, 5, {
    motionOn: false,
    hot: true,
    motionAllowed: false,
  })
  assert.deepEqual(
    [off.foil, off.pulse, off.sweep, off.tilt, off.gridAnimated, off.scan],
    [false, false, false, false, false, false],
  )
  assert.equal(off.grid, true)
})

void test('the hover sweep stays mounted on idle list cards so it can animate on hover', () => {
  const idle = resolveFx(CARD_THEMES.home, 2, { motionOn: false, hot: false, motionAllowed: true })
  assert.equal(idle.sweep, true)
  assert.equal(idle.foil, false)
  assert.equal(
    resolveFx(CARD_THEMES.home, 2, { motionOn: false, hot: false, motionAllowed: false }).sweep,
    false,
  )
})
