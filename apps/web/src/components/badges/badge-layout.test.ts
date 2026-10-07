/**
 * Run: node --test apps/web/src/components/badges/badge-layout.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeBadgeLayout } from './badge-layout.ts'
import type { BadgeShape } from './badge-shapes'
import type { BadgeSkin } from './badge-skins'

const HEX: BadgeShape = {
  clip: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
  ar: 42 / 38,
  ic: 0.47,
  pad: 0,
  padTop: 0,
}
const SKIN: BadgeSkin = {
  outer: 'OUTER',
  fill: 'FILL',
  icon: '#fff',
  label: '#ccc',
  inset: 2,
  filter: 'none',
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9

void test('single frame at the design base size (38px)', () => {
  const l = computeBadgeLayout(HEX, SKIN, 'single', 38)
  assert.equal(l.width, 38)
  assert.ok(close(l.height, 42))
  assert.deepEqual(
    l.layers.map((x) => [x.inset, x.background]),
    [
      [0, 'OUTER'],
      [2, 'FILL'],
      [2, 'FILL'],
      [2, 'FILL'],
    ],
  )
  assert.ok(close(l.iconSize, 38 * 0.47))
  assert.equal(l.bevel, false)
  assert.equal(l.filter, 'none')
})

void test('double frame opens a gap ring between two rims', () => {
  const l = computeBadgeLayout(HEX, SKIN, 'double', 38)
  assert.deepEqual(
    l.layers.map((x) => x.background),
    ['OUTER', '#070606', 'OUTER', 'FILL'],
  )
  const [, gap, ring, face] = l.layers
  assert.ok(gap && ring && face)
  assert.ok(close(gap.inset, 2))
  assert.ok(close(ring.inset, 3.5))
  assert.ok(close(face.inset, 5.1))
  assert.equal(
    computeBadgeLayout(HEX, { ...SKIN, gap: 'GAP' }, 'double', 38).layers[1]?.background,
    'GAP',
  )
})

void test('heavy frame thickens the rim 2.4x and scales with size', () => {
  assert.ok(close(computeBadgeLayout(HEX, SKIN, 'heavy', 38).layers[1]?.inset ?? 0, 4.8))
  assert.ok(close(computeBadgeLayout(HEX, SKIN, 'single', 76).layers[1]?.inset ?? 0, 4))
})

void test('an inner hairline adds a fifth layer; gloss turns on the bevel', () => {
  const l = computeBadgeLayout(HEX, { ...SKIN, inner: 'INNER', gloss: true }, 'single', 38)
  assert.deepEqual(
    l.layers.map((x) => x.background),
    ['OUTER', 'FILL', 'FILL', 'INNER', 'FILL'],
  )
  assert.ok(close(l.layers[4]?.inset ?? 0, 3))
  assert.equal(l.bevel, true)
})
