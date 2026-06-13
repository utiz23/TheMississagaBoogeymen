/**
 * Unit tests for computeMarkerOffsets — the Action Tracker marker
 * deconfliction layout. Pure function, no React/DOM.
 *
 * Run: node --test apps/web/src/lib/marker-layout.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMarkerOffsets, MARKER_COLLISION_RADIUS, type MarkerPoint } from './marker-layout.ts'

const dist = (a: { dx: number; dy: number }, b: { dx: number; dy: number }) =>
  Math.hypot(a.dx - b.dx, a.dy - b.dy)

void test('non-colliding markers get zero offset', () => {
  const points: MarkerPoint[] = [
    { id: 1, cx: 100, cy: 100 },
    { id: 2, cx: 800, cy: 400 },
  ]
  const offsets = computeMarkerOffsets(points)
  assert.deepEqual(offsets.get(1), { dx: 0, dy: 0 })
  assert.deepEqual(offsets.get(2), { dx: 0, dy: 0 })
})

void test('two near-identical coordinates get distinct rendered positions (match-250 case)', () => {
  // The two E. WANHG → M. LEHMANN shots: 10:20 (x≈82.34) and 0:42 (x≈82.27)
  // resolve to viewBox centers <1px apart.
  const a = { id: 227, cx: 2190.58, cy: 264.2 } // 10:20
  const b = { id: 248, cx: 2189.74, cy: 264.32 } // 0:42
  const offsets = computeMarkerOffsets([a, b])

  const oa = offsets.get(227)
  const ob = offsets.get(248)
  assert.ok(oa, 'offset for 10:20 shot exists')
  assert.ok(ob, 'offset for 0:42 shot exists')

  // Both events keep an identity in the output.
  assert.equal(offsets.size, 2)

  // Final rendered centers must be meaningfully apart so BOTH markers are
  // visible (shot glyph is 84px wide — require > one marker-radius of gap).
  const finalA = { x: a.cx + oa.dx, y: a.cy + oa.dy }
  const finalB = { x: b.cx + ob.dx, y: b.cy + ob.dy }
  const gap = Math.hypot(finalA.x - finalB.x, finalA.y - finalB.y)
  assert.ok(gap > 80, `markers should be separated (>80px), got ${gap.toFixed(1)}`)

  // No event lost its marker: the offsets differ.
  assert.ok(dist(oa, ob) > 0, 'the two markers must receive different offsets')
})

void test('layout is deterministic and order-independent', () => {
  const points: MarkerPoint[] = [
    { id: 248, cx: 2189.74, cy: 264.32 },
    { id: 227, cx: 2190.58, cy: 264.2 },
    { id: 99, cx: 2191.0, cy: 265.0 },
  ]
  const a = computeMarkerOffsets(points)
  const b = computeMarkerOffsets([...points].reverse())
  for (const p of points) {
    assert.deepEqual(a.get(p.id), b.get(p.id), `offset for ${String(p.id)} is stable`)
  }
})

void test('every input id appears exactly once in the output', () => {
  const points: MarkerPoint[] = Array.from({ length: 7 }, (_, i) => ({
    id: i + 1,
    cx: 500 + (i % 2), // tightly clustered → one bucket
    cy: 500,
  }))
  const offsets = computeMarkerOffsets(points)
  assert.equal(offsets.size, points.length)
  for (const p of points) assert.ok(offsets.has(p.id))
})

void test('a bucket of 3+ separates every pair', () => {
  const points: MarkerPoint[] = [
    { id: 1, cx: 1000, cy: 500 },
    { id: 2, cx: 1001, cy: 500 },
    { id: 3, cx: 1000, cy: 501 },
  ]
  const offsets = computeMarkerOffsets(points)
  const finals = points.map((p) => {
    const o = offsets.get(p.id) ?? { dx: 0, dy: 0 }
    return { x: p.cx + o.dx, y: p.cy + o.dy }
  })
  for (const [i, fi] of finals.entries()) {
    for (let j = i + 1; j < finals.length; j++) {
      const fj = finals[j] ?? { x: 0, y: 0 }
      const gap = Math.hypot(fi.x - fj.x, fi.y - fj.y)
      assert.ok(gap > 30, `pair ${String(i)},${String(j)} separated, got ${gap.toFixed(1)}`)
    }
  }
})

void test('markers just outside the collision radius are left alone', () => {
  const points: MarkerPoint[] = [
    { id: 1, cx: 1000, cy: 500 },
    { id: 2, cx: 1000 + MARKER_COLLISION_RADIUS + 5, cy: 500 },
  ]
  const offsets = computeMarkerOffsets(points)
  assert.deepEqual(offsets.get(1), { dx: 0, dy: 0 })
  assert.deepEqual(offsets.get(2), { dx: 0, dy: 0 })
})
