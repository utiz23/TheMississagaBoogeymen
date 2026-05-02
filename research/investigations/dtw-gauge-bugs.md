# DTW (Deserve to Win) Gauge — Bug Investigation Log

> Component: `apps/web/src/components/matches/possession-edge.tsx`
> Research: 2026-04-30 – 2026-05-01

The "Deserve to Win" gauge is a semicircular meter on the match detail page (`/games/[id]`) showing relative team possession/shot share. Two separate bugs were found and fixed.

---

## Bug 1 — Inverted Needle Direction

**Discovered:** 2026-04-30 (first match-detail pass)

### Root Cause

The `shareToNeedle` function mapped BGM's possession share to a rotation angle using:

```js
degrees = -180 + (normalized * 180)
```

At BGM share = 100%: `degrees = -180 + 180 = 0` → needle points **right** (OPP side).
At BGM share = 0%: `degrees = -180 + 0 = -180` → needle points **left** (BGM side).

The needle was pointing to the opponent's side when BGM dominated. Completely backwards.

### Fix

```js
degrees = -(normalized * 180)
```

At BGM share = 100%: `degrees = -180` → needle points **left** (BGM side). ✓
At BGM share = 50%: `degrees = -90` → needle points **up** (center). ✓
At BGM share = 0%: `degrees = 0` → needle points **right** (OPP side). ✓

---

## Bug 2 — Arc Proportional Fill Hardcoded at 50%

**Discovered:** 2026-05-01 (visual QA pass)

### Root Cause

Both arc endpoints were hardcoded at `-90°` (exactly 50%):

```tsx
{/* Both arcs split at -90° regardless of actual share */}
<path d={arcPath(cx, cy, r, -180, -90)} stroke="#e11d48" />  // always 50% red
<path d={arcPath(cx, cy, r, -90, 0)} stroke="#374151" />     // always 50% grey
```

The needle moved correctly (Bug 1 was already fixed), but the colored arcs always showed a 50/50 split. A 70% BGM game looked identical to a 50% game.

### Fix

```tsx
const clampedShare = Math.max(1, Math.min(99, bgmShare))
const splitDeg = -(clampedShare / 100) * 180

{/* BGM arc: -180° → splitDeg (grows as BGM share increases) */}
<path d={arcPath(cx, cy, r, -180, splitDeg)} stroke="#e11d48" />
{/* OPP arc: splitDeg → 0° (the remainder) */}
<path d={arcPath(cx, cy, r, splitDeg, 0)} stroke="#374151" />
```

**Clamp to [1, 99]** prevents zero-length SVG arcs at 0% or 100% (browser renders incorrectly).

### Geometric Proof

For BGM=70%: `splitDeg = -(0.70 × 180) = -126°`
- BGM arc: −180° → −126° = spans 54° = 30% of semicircle? No — arc from -180° to -126°: the arc distance is |−126 − (−180)| = 54°, which is 54/180 = **30%** of the semicircle. That's the OPP share.
- Wait — arc from -180° to splitDeg is the **left** arc (OPP side). Arc from splitDeg to 0° is the **right** arc (BGM side).

**Correct assignment:**
- BGM red arc goes **-180° to splitDeg** — this covers the BGM portion on the **left side**
- OPP grey arc goes **splitDeg to 0°** — this covers the OPP portion on the **right side**

For BGM=70%, splitDeg=−126°: BGM arc spans 54° on left, OPP arc spans 126° on right. BGM left-side arc smaller, OPP right-side arc larger — **this is correct** because BGM is on the left side of the gauge.

---

## Bug 3 — Arc Colors Inverted (Earlier Session)

**Discovered:** 2026-04-30 (earlier in same session)

In addition to the arc size bug, the stroke color assignments were originally also inverted:

```tsx
{/* OPP arc — was drawing BGM's zone with grey */}
<path ... stroke="#374151" />  // grey on BGM side
{/* BGM arc — was drawing OPP's zone with red */}
<path ... stroke="#e11d48" />  // red on OPP side
```

**Fix:** Swapped the stroke assignments so red fills the BGM portion.

---

## Final State (correct)

```tsx
const clampedShare = Math.max(1, Math.min(99, bgmShare))
const splitDeg = -(clampedShare / 100) * 180

// BGM arc (left, red) — grows when BGM dominates
<path d={arcPath(cx, cy, r, -180, splitDeg)} stroke="#e11d48" strokeLinecap="butt" />
// OPP arc (right, grey) — the remainder  
<path d={arcPath(cx, cy, r, splitDeg, 0)} stroke="#374151" strokeLinecap="butt" />
```

---

## Opponent TOA Investigation

During this pass, the gauge was also displaying only BGM's Time on Attack with a "BGM only" note. Investigation found `time_on_attack_against` IS stored in the DB but the view-model never passed it through. See `ea-api-data-gaps.md` for details.
