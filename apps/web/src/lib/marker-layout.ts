/**
 * Deterministic marker de-confliction for the Action Tracker rink.
 *
 * The OCR pipeline frequently extracts two distinct events at effectively the
 * same rink coordinate — e.g. match 250's two E. WANHG shots on M. LEHMANN at
 * `10:20` (x≈82.34) and `0:42` (x≈82.27). Rendered verbatim, their marker
 * glyphs (80–112 px wide in the 2405×1025 viewBox) land <1 px apart and the
 * later-drawn marker completely hides the earlier one — so one real event has
 * no visible marker at all.
 *
 * `computeMarkerOffsets` buckets markers whose rendered centers fall within a
 * small collision radius and fans each bucket out around its centroid using a
 * stable, fully deterministic layout (NO random jitter). Every event keeps its
 * own identity + offset so hover/selection/tooltip still address one marker.
 *
 * Pure module — no React, no DOM — so it is unit-testable in isolation.
 */

export interface MarkerPoint {
  /** Stable per-event id (match_events.id). Drives deterministic ordering. */
  id: number
  /** Rendered center X in viewBox units (already clamped to the rink). */
  cx: number
  /** Rendered center Y in viewBox units (already clamped to the rink). */
  cy: number
}

export interface MarkerOffset {
  dx: number
  dy: number
}

/**
 * Two centers within this many viewBox units are considered colliding and get
 * fanned apart. Sized a little above the OCR's positional jitter so genuinely
 * distinct positions are left untouched, but co-located duplicates separate.
 */
export const MARKER_COLLISION_RADIUS = 36

/**
 * Distance each marker is pushed from its bucket centroid. ~half a shot-marker
 * width, so a 2-marker bucket ends up ~1 marker width center-to-center: clearly
 * two glyphs, still visually clustered as "same spot".
 */
export const MARKER_FAN_SPREAD = 48

const TWO_PI = Math.PI * 2

/**
 * Compute a per-marker render offset that separates co-located markers.
 *
 * Returns a Map keyed by `MarkerPoint.id`. Markers that don't collide map to
 * `{dx: 0, dy: 0}`. Markers sharing a bucket are placed on a circle around the
 * bucket centroid at evenly-spaced angles, ordered by ascending id so the
 * layout is stable across renders and independent of input order.
 *
 * Guarantees:
 *   - deterministic: same input (in any order) → same offsets
 *   - identity-preserving: every input id appears exactly once in the output
 *   - co-located markers receive distinct offsets (so each stays visible)
 */
export function computeMarkerOffsets(
  points: readonly MarkerPoint[],
  opts: { radius?: number; spread?: number } = {},
): Map<number, MarkerOffset> {
  const radius = opts.radius ?? MARKER_COLLISION_RADIUS
  const spread = opts.spread ?? MARKER_FAN_SPREAD
  const result = new Map<number, MarkerOffset>()

  // Stable order: ascending id. Makes bucketing + fan angles deterministic
  // regardless of the order the caller passed markers in.
  const ordered = [...points].sort((a, b) => a.id - b.id)

  // Greedy single-pass bucketing: a marker joins the first existing bucket whose
  // ANCHOR (its first/lowest-id member) is within `radius`, else opens a new
  // bucket. Anchoring on the first member (rather than a moving centroid) keeps
  // the assignment order-independent given the stable sort above.
  const buckets: { anchor: MarkerPoint; members: MarkerPoint[] }[] = []
  for (const p of ordered) {
    let placed = false
    for (const bucket of buckets) {
      if (Math.hypot(p.cx - bucket.anchor.cx, p.cy - bucket.anchor.cy) <= radius) {
        bucket.members.push(p)
        placed = true
        break
      }
    }
    if (!placed) buckets.push({ anchor: p, members: [p] })
  }

  for (const { anchor, members } of buckets) {
    if (members.length === 1) {
      result.set(anchor.id, { dx: 0, dy: 0 })
      continue
    }
    // Fan the bucket out around its centroid. For n=2 the base angle of 0 with
    // a half-turn step yields a clean horizontal split (±spread, 0). Larger
    // buckets grow the ring radius so neighbours don't re-overlap.
    const n = members.length
    const cxAvg = members.reduce((s, p) => s + p.cx, 0) / n
    const cyAvg = members.reduce((s, p) => s + p.cy, 0) / n
    const ringRadius = spread * (n <= 2 ? 1 : 1 + 0.22 * (n - 2))
    members.forEach((p, i) => {
      const angle = (i / n) * TWO_PI
      const targetX = cxAvg + ringRadius * Math.cos(angle)
      const targetY = cyAvg + ringRadius * Math.sin(angle)
      result.set(p.id, { dx: targetX - p.cx, dy: targetY - p.cy })
    })
  }

  return result
}
