# UI Bugs & Fixes — Investigation Log

> Running log of discovered UI bugs, root causes, and fixes.

---

## Match Detail Page (`/games/[id]`)

### FormStrip "Last N" Denominator Incoherence

**Discovered:** 2026-04-30
**File:** `apps/web/src/app/games/page.tsx`

**Bug:** The "Last 10: 5-2-1" form strip used `n = matches.length` as the denominator for the label. `matches.length` includes DNF matches, making the label incoherent. A "Last 10" label with a "5-2-1" tally is confusing if 2 of those 10 were DNFs (they don't appear in the W-L-OTL count).

**Fix:**

```ts
// Before:
const n = matches.length

// After:
const n = wins + losses + otl
```

Now the label "Last 7: 5-2-1" accurately reflects what's in the tally.

---

### Event Map Placeholder Removed

**Discovered:** 2026-04-30
**File:** `apps/web/src/app/games/[id]/page.tsx`

**Bug:** A 22-line placeholder section for a future "Event Map" feature was rendering on every game detail page. No data, no value, just dead weight on every match page.

**Fix:** Entire Event Map section deleted.

---

### Box Score Structure Issues

**Discovered:** 2026-04-30
**File:** `apps/web/src/lib/match-recap.ts` → `buildBoxScore()`

Multiple structural problems found in the Box Score view-model builder:

1. **"Box Score" group inside "Box Score" section** — redundant nesting created a confusing "Box Score > Box Score" hierarchy
2. **Power Play appeared twice** — once as raw "Power Play Goals" row and once as a formatted record in a utility group
3. **Time on Attack buried in utility group** — should be in Possession section
4. **Goalie stats in Defense group** — misleading placement

**Fix:** Restructured `buildBoxScore` groups:

- **Offense**: Goals, Assists, Shots, Shooting%, Shot On Net%, Deflections, Power Play record
- **Possession**: Faceoff%, Pass%, Possession, Time on Attack
- **Defense**: Hits, Blocked Shots, Takeaways, Giveaways, Interceptions, Penalties, SHG
- **Goalie**: Saves, GA, SV%
- Removed the redundant "Box Score" utility group
- Removed dead `formatPassing` and `passingRow` helpers

---

### FO% Always Null

**Discovered:** 2026-05-01
**File:** `apps/web/src/components/matches/score-card.tsx`

FO% was showing `—` for every match card. Investigation confirmed FO% is null for all 33+ matches in the DB — EA does not populate it.

**Fix:** Replaced FO% with Pass% (populated for all 33 matches, range 50–93%). Computation: `Math.round(passCompletions / passAttempts * 100)%` with zero-division guard.

---

### Position Pill Readability on Light Backgrounds

**Discovered:** 2026-05-01
**File:** `apps/web/src/components/matches/position-pill.tsx`

**Bug:** The `onLight` prop used `rgba(0,0,0,0.42)` as background — on a near-white card (rank-2 performer), this composites to approximately `rgb(150,150,150)`. The 40%-opacity border (`borderColor + '66'`) also nearly disappeared. Result: unreadable grey smear on medium-value position colors.

**Fix:**

- `backgroundColor`: `rgba(0,0,0,0.42)` → `rgba(8,8,10,0.84)` (near-solid dark)
- `borderColor`: `style.text + '66'` (40% opacity) → `style.text` (full saturation solid)

Pills are now legible on any card background brightness.

---

### DTW Gauge Arc Proportional Fill

See dedicated investigation: `dtw-gauge-bugs.md`.

---

### Opponent Players Dropped from Score Section

**Discovered:** 2026-05-01
**File:** `apps/web/src/lib/match-recap.ts` → `buildAllTeamScores()`

**Bug:** A shared filter `score > 0` was applied to both BGM and opponent entries. In high-giveaway/blowout games, some opponent players scored net-negative. They were silently dropped from "Show all player scores."

**Root cause:** The `score > 0` guard was designed to suppress AI bench/empty slots on the BGM side. It should not apply to opponent players.

**Fix:** Split the filter:

- BGM: keep `score > 0` guard (still needed for AI slot suppression)
- Opponent: no filter — all opponent players pass through unconditionally

---

## Navigation

### Mobile Wordmark Overflow

**Discovered:** 2026-05-01
**File:** `apps/web/src/components/nav/top-nav.tsx`

Two `Boogeymen` spans existed — one `hidden sm:block` (desktop) and one `sm:hidden` (mobile). With `letter-spacing` and `shrink-0` on the brand link, the mobile text overflowed the available nav width.

**Fix:** Removed the `sm:hidden` mobile wordmark span. Logo alone renders at xs; wordmark appears sm+ via the existing `hidden sm:block` span.

---

### "EASHL · #19224" Subtitle

**Discovered:** HANDOFF item
**File:** `apps/web/src/components/nav/top-nav.tsx`

Navbar showed `EASHL · #19224` as a subtitle — exposed internal club ID to users and added no value.

**Fix:** Subtitle removed entirely.

---

## Score Card (`/games` list)

### Team Name Overflow in Score Panel

**Discovered:** 2026-05-01

"Boogeymen" (9 characters) overflowed the 56px team panel column in score cards.

**Fix:** Changed `OUR_NAME = 'Boogeymen'` to `OUR_ABBREV = 'BGM'` within `score-card.tsx`. Abbreviation fits cleanly.

---

### Mode Pills Visually Identical

**Discovered:** 2026-05-01

Both `6s` and `3s` mode pills used identical `border-zinc-700 bg-zinc-900/70 text-zinc-400` styling — zero visual distinction between game modes.

**Fix:**

- `6s` pill: `border-violet-500/80 bg-violet-950/50 text-violet-300` (violet — distinct from results and 3s)
- `3s` pill: `border-sky-400/80 bg-sky-950/50 text-sky-300` (sky blue)
- WIN: `text-emerald-400` with emerald glow + green top bar
- LOSS: `text-rose-400` with rose glow + rose top bar
- OTL: amber treatment

---

## Roster Page (`/roster`)

### Goalie Block Empty Slots

**Discovered:** 2026-05-01
**File:** `apps/web/src/components/roster/depth-chart.tsx`

`GoalieBlock` hardcoded a 5-slot grid, always showing 3–4 empty "Open Slot" placeholders even if the roster only has 1–2 goalies.

**Fix:** `GoalieBlock` now renders only as many slots as there are real goalies (minimum 1 if none). Grid template columns are dynamic via inline style.

---

### FO% Tab in Roster Table

**Discovered:** 2026-05-01
**File:** `apps/web/src/components/roster/roster-table.tsx` (now deleted)

The Possession tab in the roster stats table showed FO% — always null. The goalie tab was hidden by default.

**Fix:** The entire `RosterTable` component was replaced by the shared `SkaterStatsTable` and `GoalieStatsTable` components from `/stats`. No more parallel drift between the two pages.

---

## Star Ranking Display

**Discovered:** 2026-05-01
**File:** `apps/web/src/components/matches/top-performers.tsx`

```tsx
// Before (backwards):
{
  rank === 1 ? '★' : rank === 2 ? '★★' : '★★★'
}
// Rank 1 (best) showed fewest stars; rank 3 showed most — visually reads as rank 3 being "better"

// After (correct):
{
  rank === 1 ? '★★★' : rank === 2 ? '★★' : '★'
}
// More stars = better = rank 1
```
