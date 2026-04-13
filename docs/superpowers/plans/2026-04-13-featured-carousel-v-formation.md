# Featured Carousel V-Formation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the featured-player carousel into a genuine 5-card V-formation showcase where the center card is the hero, flanking cards recede into depth, and the whole arrangement reads like an olympic podium.

**Architecture:** Two files change. `page.tsx` gets a simplified `selectFeaturedPlayers` that sorts purely by points descending. `player-carousel.tsx` gets a new SLOT_CONFIG with vertical (Y) offsets that create the V shape, a wider stage, wider vignettes, swipe support, and a premium control strip below.

**Tech Stack:** Next.js 15 App Router, React (useState/useEffect), Tailwind CSS 4, TypeScript strict

---

## Current Carousel — What Is Weak

1. **No V formation.** All 5 cards sit at identical Y positions (`translateY(-50%)` for every slot). The "depth" is only horizontal spread + scale. There is no vertical stagger. The result looks like a flat row, not a showcase.

2. **The slot values are too compressed.** At x=±120 / scale=0.87, the inner cards overlap the center card by ~55 px of card content. At x=±205 / scale=0.72 the outer cards barely clear the inner ones. The spread is too tight to feel like a "featured" arrangement.

3. **Side cards don't fade enough.** Outer opacity=0.25 is fine, but inner opacity=0.62 is still quite visible — the hierarchy between center, inner, and outer isn't clear enough.

4. **`selectFeaturedPlayers` uses multi-criteria curation** (top 3 by points, top goals, top hits, best goalie) and doesn't guarantee ordering by points. User explicitly requested points-descending.

5. **Controls sit below the stage as a generic row** of small square arrows + round dots. Nothing signals "this is a premium showcase." The arrows are h-7 w-7 boxes.

6. **No touch/swipe.** Mobile has arrows but no gesture support.

7. **Vignette width (w-24 = 96 px) will clip outer cards** in the wider spread layout.

---

## Recommended Layout — Slot-by-Slot

### V-Formation Logic

Anchor each card on the stage by its center point. The center slot stays at the stage's geometric center. Each outer slot shifts its center point **downward** (positive Y in CSS). Combined with scale reduction, this makes the outer cards shorter _and_ lower — their tops descend away from the center card's top. The bottoms roughly align across all slots, which is the "podium" read.

```
Stage center = 200px (stage height 400px)

Slot  X offset   Y offset   Scale   Opacity   z-index
────  ─────────  ─────────  ──────  ────────  ───────
 -2   −280 px    +56 px     0.65    0.28        2
 -1   −148 px    +26 px     0.82    0.58        5
  0     0 px      0 px      1.00    1.00       10
 +1   +148 px    +26 px     0.82    0.58        5
 +2   +280 px    +56 px     0.65    0.28        2
```

Pixel reality with card height ≈ 320 px:

| Slot | Card center Y | Card top | Card bottom |
| ---- | ------------- | -------- | ----------- |
| 0    | 200           | 40 px    | 360 px      |
| ±1   | 226           | 95 px    | 357 px      |
| ±2   | 256           | 152 px   | 360 px      |

Tops form a V (center highest, outer lower). Bottoms align — exactly the podium shape.

### Center card (rel = 0)

- Full scale (1.0), full opacity, z-index 10
- Red accent bar fully lit (`bg-accent`)
- Fully interactive (Link navigates to player profile)
- Hover: `hover:-translate-y-1` + stronger glow (already on `PlayerCard`)

### Inner cards (rel = ±1)

- Scale 0.82 (~184 px wide, ~262 px tall)
- Opacity 0.58 — clearly secondary but still readable
- X offset ±148 px — outer edge of inner card is ~74 px inside center card edge (slight tuck)
- Y offset +26 px — top 55 px lower than center card top
- Clickable to bring forward (existing pointer-events wrapper handles this)
- Cursor: pointer

### Outer cards (rel = ±2)

- Scale 0.65 (~146 px wide, ~208 px tall)
- Opacity 0.28 — atmospheric, barely readable, clearly decorative
- X offset ±280 px — slight overlap with inner card outer edge
- Y offset +56 px — top 112 px lower than center card top
- Clickable (jumps 2 positions)

### Cards beyond ±2

Hidden (cfg === undefined, same as today).

---

## Ordering / Selection Rules

Replace `selectFeaturedPlayers` in `apps/web/src/app/page.tsx` with:

```typescript
function selectFeaturedPlayers(roster: RosterRow[]): RosterRow[] {
  return [...roster]
    .sort((a, b) => b.points - a.points || b.gamesPlayed - a.gamesPlayed)
    .slice(0, 8)
}
```

- Pure points-descending sort, tiebreak by games played.
- Goalies sort naturally to the back (0 points in EASHL stat model).
- Slice to 8: enough players for carousel cycling without padding.
- Carousel always starts at `activeIndex = 0` → the #1 points leader is the initial center card.

---

## Navigation / Controls

### Desktop controls (below stage)

Replace the current "small arrow boxes + circles" with:

```
[ ← ]   ──  ●  ──  ──  ──  ──   [ → ]
       active player name label
```

Specifically:

- Arrows: `h-8 w-8`, no background, thin border `border-zinc-700`, hover `border-zinc-500 text-zinc-200`
- Dot indicators: replace round dots with thin horizontal bars (`h-0.5 w-5` active red, `h-0.5 w-2.5` inactive zinc-700)
- Below the indicators: centered gamertag label — `font-condensed text-sm font-black uppercase tracking-wide text-zinc-300`, showing `players[activeIndex].gamertag`

### Keyboard

Keep existing `ArrowLeft` / `ArrowRight` on the region div.

### Clicking side cards

Keep existing behavior (click non-active card sets `activeIndex` directly).

---

## Touch / Swipe

Add to the desktop stage div (and the mobile card wrapper):

```typescript
const [swipeStart, setSwipeStart] = useState<number | null>(null)

const onTouchStart = (e: React.TouchEvent) => setSwipeStart(e.touches[0].clientX)
const onTouchEnd = (e: React.TouchEvent) => {
  if (swipeStart === null) return
  const delta = e.changedTouches[0].clientX - swipeStart
  if (Math.abs(delta) > 44) delta < 0 ? next() : prev()
  setSwipeStart(null)
}
```

Threshold 44 px (roughly one thumb-width) prevents accidental triggers.

---

## Mobile Behavior

Keep the existing `sm:hidden` single-card layout. Additions:

- Add touch handlers to the card wrapper div (same `onTouchStart`/`onTouchEnd` above)
- Show active player gamertag label below the card (matches desktop treatment)
- Keep dot indicators

---

## File Map

| File                                               | Change                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/web/src/app/page.tsx`                        | Replace `selectFeaturedPlayers` body                                                        |
| `apps/web/src/components/home/player-carousel.tsx` | SLOT_CONFIG, transform string, stage height, vignette width, swipe state, controls redesign |

`player-card.tsx` — **do not touch**.

---

## Implementation Tasks

---

### Task 1: Simplify featured-player selection to points-descending

**Files:**

- Modify: `apps/web/src/app/page.tsx` (lines 55–88, the `selectFeaturedPlayers` function)

- [ ] **Step 1: Replace `selectFeaturedPlayers`**

In `apps/web/src/app/page.tsx`, replace the entire `selectFeaturedPlayers` function (currently lines 55–88) with:

```typescript
/**
 * Top players by points descending for the featured carousel.
 * Goalies sort naturally to the back (0 points). Returns up to 8.
 */
function selectFeaturedPlayers(roster: RosterRow[]): RosterRow[] {
  return [...roster]
    .sort((a, b) => b.points - a.points || b.gamesPlayed - a.gamesPlayed)
    .slice(0, 8)
}
```

- [ ] **Step 2: Verify types pass**

```bash
pnpm --filter @eanhl/web typecheck
```

Expected: no errors.

- [ ] **Step 3: Verify lint and format**

```bash
pnpm --filter @eanhl/web lint
pnpm prettier --check apps/web/src/app/page.tsx
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(home): simplify featured players to points-descending sort"
```

---

### Task 2: Add V-formation SLOT_CONFIG with Y offsets

**Files:**

- Modify: `apps/web/src/components/home/player-carousel.tsx`

- [ ] **Step 1: Update the SlotConfig type and SLOT_CONFIG constant**

Find the existing SLOT_CONFIG block (currently near line 208) and replace it with:

```typescript
interface SlotConfig {
  x: number
  y: number
  scale: number
  opacity: number
  zIndex: number
}

/**
 * V-formation slot values.
 * rel 0 = center hero; ±1 = inner flanks; ±2 = outer flanks.
 * Y offset shifts outer cards downward so card tops form a V.
 * Cards at |rel| > 2 are hidden.
 */
const SLOT_CONFIG: Record<number, SlotConfig> = {
  [-2]: { x: -280, y: 56, scale: 0.65, opacity: 0.28, zIndex: 2 },
  [-1]: { x: -148, y: 26, scale: 0.82, opacity: 0.58, zIndex: 5 },
  [0]: { x: 0, y: 0, scale: 1.0, opacity: 1.0, zIndex: 10 },
  [1]: { x: 148, y: 26, scale: 0.82, opacity: 0.58, zIndex: 5 },
  [2]: { x: 280, y: 56, scale: 0.65, opacity: 0.28, zIndex: 2 },
}
```

Remove the old inline `Record<number, { x: number; scale: number; opacity: number; zIndex: number }>` type annotation.

- [ ] **Step 2: Update the transform string to include Y offset**

Find the inline style block that constructs the `transform` property (currently line ~83):

```typescript
transform: `translateX(calc(-50% + ${cfg.x.toString()}px)) translateY(-50%) scale(${cfg.scale.toString()})`,
```

Replace with:

```typescript
transform: `translateX(calc(-50% + ${cfg.x.toString()}px)) translateY(calc(-50% + ${cfg.y.toString()}px)) scale(${cfg.scale.toString()})`,
```

- [ ] **Step 3: Verify no type errors**

```bash
pnpm --filter @eanhl/web typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/home/player-carousel.tsx
git commit -m "feat(carousel): add V-formation slot config with Y offsets"
```

---

### Task 3: Update stage height and vignette width

**Files:**

- Modify: `apps/web/src/components/home/player-carousel.tsx`

- [ ] **Step 1: Update stage height**

Find:

```tsx
<div className="relative h-[342px] overflow-hidden">
```

Replace with:

```tsx
<div className="relative h-[400px] overflow-hidden">
```

Rationale: outer cards (scale 0.65, height ~208 px, center at y=256) have their bottom at 360 px. 400 px stage gives 40 px of breathing room. Center card (height ~320 px, top at y=40) has 40 px of headroom.

- [ ] **Step 2: Widen vignette masks**

Outer cards now spread to ±280 px + ~73 px half-width = ±353 px from center. On a typical container (≤ 700 px wide), they'll be clipped. The vignette should cover more of the edges.

Find both vignette divs (currently `w-24`):

```tsx
className = 'pointer-events-none absolute inset-y-0 left-0 z-20 w-24'
```

```tsx
className = 'pointer-events-none absolute inset-y-0 right-0 z-20 w-24'
```

Change both to `w-36`:

```tsx
className = 'pointer-events-none absolute inset-y-0 left-0 z-20 w-36'
```

```tsx
className = 'pointer-events-none absolute inset-y-0 right-0 z-20 w-36'
```

- [ ] **Step 3: Verify no type errors and lint**

```bash
pnpm --filter @eanhl/web typecheck && pnpm --filter @eanhl/web lint
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/home/player-carousel.tsx
git commit -m "feat(carousel): expand stage to 400px, widen vignettes for V spread"
```

---

### Task 4: Add touch/swipe support

**Files:**

- Modify: `apps/web/src/components/home/player-carousel.tsx`

- [ ] **Step 1: Add swipe state**

Inside `PlayerCarousel`, after the existing `const [activeIndex, setActiveIndex] = useState(0)` line, add:

```typescript
const [swipeStart, setSwipeStart] = useState<number | null>(null)
```

- [ ] **Step 2: Add swipe handlers**

Directly after the `next` function definition, add:

```typescript
const onTouchStart = (e: React.TouchEvent) => {
  setSwipeStart(e.touches[0]?.clientX ?? null)
}

const onTouchEnd = (e: React.TouchEvent) => {
  if (swipeStart === null) return
  const delta = (e.changedTouches[0]?.clientX ?? swipeStart) - swipeStart
  if (Math.abs(delta) > 44) delta < 0 ? next() : prev()
  setSwipeStart(null)
}
```

- [ ] **Step 3: Attach handlers to the desktop stage div**

Find the desktop stage div:

```tsx
<div className="relative h-[400px] overflow-hidden">
```

Replace with:

```tsx
<div
  className="relative h-[400px] overflow-hidden"
  onTouchStart={onTouchStart}
  onTouchEnd={onTouchEnd}
>
```

- [ ] **Step 4: Attach handlers to the mobile card wrapper**

Find the mobile layout's outer card wrapper div:

```tsx
<div className="flex flex-1 justify-center">
```

Replace with:

```tsx
<div
  className="flex flex-1 justify-center"
  onTouchStart={onTouchStart}
  onTouchEnd={onTouchEnd}
>
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @eanhl/web typecheck && pnpm --filter @eanhl/web lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/home/player-carousel.tsx
git commit -m "feat(carousel): add swipe-to-navigate touch support"
```

---

### Task 5: Redesign controls — premium indicator strip

**Files:**

- Modify: `apps/web/src/components/home/player-carousel.tsx`

Goal: replace the current "arrows + round dots" row with a three-row control strip:

1. Thin-bar dot indicators (horizontal lines instead of circles)
2. Active player gamertag label (centered)
3. Prev/next arrows flanking the label row

- [ ] **Step 1: Replace the desktop navigation block**

Find the entire desktop navigation block (currently starts at `{/* Navigation: arrows + dot indicators */}`, line ~110):

```tsx
{
  /* Navigation: arrows + dot indicators */
}
;<div className="mt-5 flex items-center justify-center gap-5">
  <button
    type="button"
    onClick={prev}
    aria-label="Previous player"
    className="flex h-7 w-7 items-center justify-center border border-zinc-700 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
  >
    <ChevronLeft />
  </button>

  <div className="flex items-center gap-2" role="tablist">
    {players.map((p, i) => (
      <button
        key={p.playerId}
        type="button"
        role="tab"
        aria-selected={i === activeIndex}
        aria-label={`Show ${p.gamertag}`}
        onClick={() => {
          setActiveIndex(i)
        }}
        className={[
          'h-1.5 rounded-full transition-all duration-300',
          i === activeIndex ? 'w-5 bg-accent' : 'w-1.5 bg-zinc-700 hover:bg-zinc-500',
        ].join(' ')}
      />
    ))}
  </div>

  <button
    type="button"
    onClick={next}
    aria-label="Next player"
    className="flex h-7 w-7 items-center justify-center border border-zinc-700 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
  >
    <ChevronRight />
  </button>
</div>
```

Replace with:

```tsx
{
  /* Controls — indicator bars + player label + arrows */
}
;<div className="mt-4 flex flex-col items-center gap-2">
  {/* Thin-bar indicators */}
  <div className="flex items-center gap-1.5" role="tablist">
    {players.map((p, i) => (
      <button
        key={p.playerId}
        type="button"
        role="tab"
        aria-selected={i === activeIndex}
        aria-label={`Show ${p.gamertag}`}
        onClick={() => {
          setActiveIndex(i)
        }}
        className={[
          'rounded-full transition-all duration-300',
          i === activeIndex ? 'h-0.5 w-6 bg-accent' : 'h-0.5 w-3 bg-zinc-700 hover:bg-zinc-500',
        ].join(' ')}
      />
    ))}
  </div>

  {/* Player label + flanking arrows */}
  <div className="flex items-center gap-4">
    <button
      type="button"
      onClick={prev}
      aria-label="Previous player"
      className="flex h-8 w-8 items-center justify-center border border-zinc-800 text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-200"
    >
      <ChevronLeft />
    </button>

    <span className="min-w-[140px] text-center font-condensed text-sm font-black uppercase tracking-wider text-zinc-300">
      {players[activeIndex]?.gamertag ?? ''}
    </span>

    <button
      type="button"
      onClick={next}
      aria-label="Next player"
      className="flex h-8 w-8 items-center justify-center border border-zinc-800 text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-200"
    >
      <ChevronRight />
    </button>
  </div>
</div>
```

- [ ] **Step 2: Update mobile dot indicators to match thin-bar style**

Find the mobile dot indicators block:

```tsx
{
  /* Dot indicators */
}
;<div className="mt-3 flex justify-center gap-2">
  {players.map((p, i) => (
    <button
      key={p.playerId}
      type="button"
      aria-label={`Show ${p.gamertag}`}
      onClick={() => {
        setActiveIndex(i)
      }}
      className={[
        'h-1.5 rounded-full transition-all duration-300',
        i === activeIndex ? 'w-5 bg-accent' : 'w-1.5 bg-zinc-700',
      ].join(' ')}
    />
  ))}
</div>
```

Replace with:

```tsx
{
  /* Thin-bar indicators + player label */
}
;<div className="mt-3 flex flex-col items-center gap-2">
  <div className="flex items-center gap-1.5">
    {players.map((p, i) => (
      <button
        key={p.playerId}
        type="button"
        aria-label={`Show ${p.gamertag}`}
        onClick={() => {
          setActiveIndex(i)
        }}
        className={[
          'rounded-full transition-all duration-300',
          i === activeIndex ? 'h-0.5 w-6 bg-accent' : 'h-0.5 w-3 bg-zinc-700 hover:bg-zinc-500',
        ].join(' ')}
      />
    ))}
  </div>
  <span className="font-condensed text-sm font-black uppercase tracking-wider text-zinc-400">
    {players[activeIndex]?.gamertag ?? ''}
  </span>
</div>
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter @eanhl/web typecheck && pnpm --filter @eanhl/web lint
pnpm prettier --check apps/web/src/components/home/player-carousel.tsx
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/home/player-carousel.tsx
git commit -m "feat(carousel): premium control strip — thin bars, player label, clean arrows"
```

---

## Open Questions (genuinely matter before build)

1. **Should goalies appear in the carousel at all?**
   The points-desc sort puts goalies last (0 points). With 8 slots, a team with 7+ active skaters will never show the goalie. If the team has ≤ 6 skaters, the goalie will appear in slot 7+. Is that acceptable, or should goalies be excluded entirely? A simple filter `(r) => r.wins === null` would exclude them.

2. **How many players to pass to the carousel?**
   The plan uses `slice(0, 8)`. With 8 players, the "hidden" pool beyond ±2 has 3 cards cycling through on navigation. If the team has fewer than 5 players, the outer slots will re-use wrapped cards (the `getRelPos` wrap logic handles this — but 3 cards in a 5-slot layout means the same card can appear in two slots simultaneously if `total < 5`). Minimum viable roster for clean display: 5 players.

3. **Auto-rotate: yes or no?**
   The spec lists it as optional. Not included in this plan. Can be added as a follow-up `useEffect` with a 4-second interval that pauses on hover. Confirm whether you want it in this pass or later.
