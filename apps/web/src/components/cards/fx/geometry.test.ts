/**
 * Parity with the prototype: runs PlayerCard.dc.html's own seeded generators
 * (extracted from the design file) and requires identical shapes.
 * Run: node --test apps/web/src/components/cards/fx/geometry.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ARC_FOOT_BOLTS, ARC_FRAME_BOLTS, ARC_STAT_BOLTS, RIME_POINTS } from './geometry.ts'

const html = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../../docs/design/handoffs/2026-10-cards/PlayerCard.dc.html',
      import.meta.url,
    ),
  ),
  'utf8',
)
const line = (start: string) => {
  const found = html.split('\n').find((l) => l.trimStart().startsWith(start))
  assert.ok(found, start)
  return found
}

function prototypeGeometry(): { frame: string[]; stats: string[]; foot: string[]; rime: string } {
  const src = [
    line('let asd = 11;'),
    line('const jagPath ='),
    line('const jagLine ='),
    'const ACH = 9, AFH = 200, arcPts = [[ACH, 0], [240 - ACH, 0], [240, ACH], [240, AFH - ACH], [240 - ACH, AFH], [ACH, AFH], [0, AFH - ACH], [0, ACH]];',
    'const frame = [jagPath(arcPts, 7, 1.8), jagPath(arcPts, 9, 2.4), jagPath(arcPts, 6, 1.4)];',
    'const stats = [60, 120, 180].map((x) => jagLine(x, 10, 50, 7, 2));',
    'const foot = [80, 160].map((x) => jagLine(x, 12, 48, 6, 2));',
    line('let isd = 23;'),
    line('const rimePts ='),
    'return { frame, stats, foot, rime: rimePts };',
  ].join('\n')
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(src) as () => {
    frame: string[]
    stats: string[]
    foot: string[]
    rime: string
  }
  return run()
}

void test('storm arcs and frozen rime match the prototype exactly', () => {
  const p = prototypeGeometry()
  assert.deepEqual([...ARC_FRAME_BOLTS], p.frame)
  assert.deepEqual([...ARC_STAT_BOLTS], p.stats)
  assert.deepEqual([...ARC_FOOT_BOLTS], p.foot)
  assert.equal(RIME_POINTS, p.rime)
})
