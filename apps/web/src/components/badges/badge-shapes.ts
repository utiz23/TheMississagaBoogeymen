/**
 * Badge silhouettes, ported from the design bundle's badge-shapes.js.
 * Only the five shapes the badge groups use are kept.
 */
import type { BadgeShapeId } from '@eanhl/db/cards'

export interface BadgeShape {
  /** CSS clip-path. */
  clip: string
  /** Height / width. */
  ar: number
  /** Icon size as a fraction of the badge width. */
  ic: number
  /** Icon bottom padding as a fraction of the height. */
  pad: number
  /** Icon top padding as a fraction of the height. */
  padTop: number
}

type Point = readonly [number, number]

/** Polygon with rounded corners as a percentage clip-path (badge-shapes.js roundedPoly). */
function roundedPoly(vertices: readonly Point[], r: number, steps: number): string {
  const n = vertices.length
  const at = (i: number): Point => vertices[((i % n) + n) % n] ?? [0, 0]
  const pts: Point[] = []
  for (let i = 0; i < n; i++) {
    const [px, py] = at(i)
    const [ax0, ay0] = at(i - 1)
    const [cx0, cy0] = at(i + 1)
    let ax = ax0 - px
    let ay = ay0 - py
    let cx = cx0 - px
    let cy = cy0 - py
    const la = Math.hypot(ax, ay)
    const lc = Math.hypot(cx, cy)
    ax /= la
    ay /= la
    cx /= lc
    cy /= lc
    const th = Math.acos(ax * cx + ay * cy)
    const d = r / Math.tan(th / 2)
    const h = r / Math.sin(th / 2)
    let bx = ax + cx
    let by = ay + cy
    const lb = Math.hypot(bx, by)
    bx /= lb
    by /= lb
    const ox = px + bx * h
    const oy = py + by * h
    const a1 = Math.atan2(py + ay * d - oy, px + ax * d - ox)
    const a2 = Math.atan2(py + cy * d - oy, px + cx * d - ox)
    let da = a2 - a1
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    for (let s = 0; s <= steps; s++) {
      const a = a1 + (da * s) / steps
      pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r])
    }
  }
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const pct = (v: number, lo: number, hi: number) => (((v - lo) / (hi - lo)) * 100).toFixed(2)
  return `polygon(${pts.map((p) => `${pct(p[0], x0, x1)}% ${pct(p[1], y0, y1)}%`).join(', ')})`
}

const TRI_AR = 0.92

export const BADGE_SHAPES: Readonly<Record<BadgeShapeId, BadgeShape>> = {
  hex: {
    clip: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
    ar: 42 / 38,
    ic: 0.47,
    pad: 0,
    padTop: 0,
  },
  round: { clip: 'circle(50% at 50% 50%)', ar: 1, ic: 0.46, pad: 0, padTop: 0 },
  octagon: {
    clip: 'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)',
    ar: 1,
    ic: 0.46,
    pad: 0,
    padTop: 0,
  },
  square: { clip: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', ar: 1, ic: 0.5, pad: 0, padTop: 0 },
  invtri: {
    clip: roundedPoly(
      [
        [0, 0],
        [100, 0],
        [50, 100 * TRI_AR],
      ],
      12,
      8,
    ),
    ar: TRI_AR,
    ic: 0.36,
    pad: 0.2,
    padTop: 0,
  },
}
