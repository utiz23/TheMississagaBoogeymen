/**
 * Seeded shapes for the mythic effects, computed once at module load from the
 * prototype's own LCG (seed 11 for Storm arcs, 23 for the Frozen rime) in the
 * prototype's call order — deterministic, so server and browser agree.
 * geometry.test.ts checks them against PlayerCard.dc.html.
 */

type Point = readonly [number, number]

function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

/** Chamfered 240×200 frame (Storm arcs and Cyber traces share the outline). */
export const FRAME_OUTLINE: readonly Point[] = [
  [9, 0],
  [231, 0],
  [240, 9],
  [240, 191],
  [231, 200],
  [9, 200],
  [0, 191],
  [0, 9],
]
export const FRAME_POINTS = FRAME_OUTLINE.map((p) => p.join(',')).join(' ')

function jagPath(rnd: () => number, pts: readonly Point[], step: number, amp: number): string {
  const out: string[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] ?? [0, 0]
    const b = pts[(i + 1) % pts.length] ?? [0, 0]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    const n = Math.max(1, Math.round(len / step))
    const nx = -dy / len
    const ny = dx / len
    for (let j = 0; j < n; j++) {
      const t = j / n
      const o = j ? (rnd() - 0.5) * 2 * amp : 0
      out.push(`${(a[0] + dx * t + nx * o).toFixed(1)},${(a[1] + dy * t + ny * o).toFixed(1)}`)
    }
  }
  out.push(out[0] ?? '')
  return out.join(' ')
}

function jagLine(
  rnd: () => number,
  x: number,
  y0: number,
  y1: number,
  n: number,
  amp: number,
): string {
  return Array.from(
    { length: n + 1 },
    (_, i) =>
      `${(x + (i && i < n ? (rnd() - 0.5) * 2 * amp : 0)).toFixed(1)},${(y0 + ((y1 - y0) * i) / n).toFixed(1)}`,
  ).join(' ')
}

// Storm arcs: one stream, consumed frame → stats → foot exactly as the prototype does.
const arcRnd = lcg(11)
export const ARC_FRAME_BOLTS: readonly string[] = [
  jagPath(arcRnd, FRAME_OUTLINE, 7, 1.8),
  jagPath(arcRnd, FRAME_OUTLINE, 9, 2.4),
  jagPath(arcRnd, FRAME_OUTLINE, 6, 1.4),
]
export const ARC_STAT_BOLTS: readonly string[] = [60, 120, 180].map((x) =>
  jagLine(arcRnd, x, 10, 50, 7, 2),
)
export const ARC_FOOT_BOLTS: readonly string[] = [80, 160].map((x) =>
  jagLine(arcRnd, x, 12, 48, 6, 2),
)

/** Storm frame cracks: [points, animation delay (s)] — PlayerCard.dc.html ARC_CR. */
export const ARC_CRACKS: readonly (readonly [string, number])[] = [
  ['0,10 9,16 14,27 26,31 33,40', 0],
  ['14,27 8,36', 0.15],
  ['240,6 231,13 228,24 215,30 207,41', 2.1],
  ['228,24 236,33', 2.25],
  ['0,96 8,101 6,113 14,120', 3.6],
  ['240,84 233,92 236,104 229,112', 1.2],
  ['80,200 83,186 78,172 82,160 79,148', 4.4],
  ['83,186 89,180', 4.55],
  ['160,200 157,186 162,172 158,160 161,148', 0.7],
  ['157,186 151,180', 0.85],
  ['0,148 7,156 5,170 13,182 9,196', 2.9],
  ['5,170 0,176', 3.05],
  ['240,150 233,161 236,175 228,188 232,200', 5.2],
  ['236,175 240,182', 5.35],
]

// Frozen rime band along the top of the ice panel.
const iceRnd = lcg(23)
export const RIME_POINTS: string = (() => {
  const o = ['0,0']
  let x = 0
  while (x < 240) {
    const w = 3 + iceRnd() * 5
    const l = iceRnd() < 0.18 ? 6 + iceRnd() * 5 : 1.5 + iceRnd() * 2.5
    o.push(`${(x + w * 0.5).toFixed(1)},${l.toFixed(1)}`, `${Math.min(240, x + w).toFixed(1)},0`)
    x += w
  }
  return o.join(' ')
})()
