# Scoresheet Minor Polish Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 6 remaining minor UI-review polish items on the Scoresheet section + retire a stale entry already addressed by today's morning sweep. Seven commits: replace the redundant expanded-panel header with the player gamertag; brighten the chevron on row hover; strengthen the expanded-row background + add accent rail; add Game Score cross-link tooltip; show a "no profile" placeholder for opp players; align the goalie + skater table min-widths; mark the tile-reorder item Resolved (silently addressed by the morning PIM-tile removal).

**Architecture:** Multi-commit sweep, all touching `apps/web/src/components/matches/scoresheet.tsx` + one doc commit updating the UI review. Each task is line-disjoint. No new components, no prop changes, no schema changes.

**Tech Stack:** Next.js 15 App Router, React Client Component (Scoresheet is `'use client'` for expand/collapse state), Tailwind CSS 4 with CSS-var tokens. No new dependencies.

---

## Context

Today's morning Scoresheet polish sweep (commits `0a0546d` → `6cbe153`) landed the CRITICAL fixes (Shooting% mislabel, group regrouping, PositionPill colors, mobile column collapse, keyboard/ARIA, crests, tooltip plumbing). The UI review §6 backlog has 8 minor items remaining; today's audit found:

| UI review § | Item | Status |
|---|---|---|
| §6 #8 | "Advanced Statistics / Per-match breakdown" header redundancy | **In scope** (Task 1) |
| §6 #10 | Chevron `▸` hover brightness | **In scope** (Task 2) |
| §6 #11 | Expanded row `bg-zinc-950/30` barely visible | **In scope** (Task 3) |
| §6 #12 | "Score" tile cross-link to Top Performers | **In scope** (Task 4) |
| §6 #13 | Opp expanded-panel empty right side | **In scope** (Task 5) |
| §6 #15 | Goalie/skater min-w mismatch (480px vs 640px) | **In scope** (Task 6) |
| §6 #9 | Quick-stat tile order ranks PIM with offensive metrics | **Resolved** by morning sweep (PIM tile removed; remaining 6 tiles are coherent — Task 7) |
| §6 #3a | Position pill specific LD/RD when OCR loadout has it | **Out of scope** — requires data-layer plumbing in `buildScoresheet` to join OCR loadout snapshots into SkaterRow.position; real data work, not polish |

User decisions (2026-05-17):
- **Header (#8):** replace the "Advanced Statistics / Per-match breakdown" pair with the player gamertag — when the panel is scrolled, the gamertag identifies whose stats are being shown.
- **Opp right side (#13):** render a faint "Opponent — no profile" placeholder where the "View Player Profile" link would be for BGM players — preserves layout symmetry + explicit signal.

Intended outcome: Scoresheet drops to ~1 deferred item (#3a — data-layer work). Section effectively closed for polish.

---

## File Map

| Touched in | File | Why |
|---|---|---|
| Task 1 | `apps/web/src/components/matches/scoresheet.tsx` | Replace expanded-panel header with player gamertag (lines 196-199) |
| Task 2 | `apps/web/src/components/matches/scoresheet.tsx` | Add `group-hover:text-zinc-300` to chevron (lines 151-155); confirm the parent row has `group` class |
| Task 3 | `apps/web/src/components/matches/scoresheet.tsx` | Strengthen expanded row contrast — `bg-zinc-950/30` → `bg-zinc-900/40` + left-accent rail (line 191) |
| Task 4 | `apps/web/src/components/matches/scoresheet.tsx` | Add tooltip on Score tile pointing to Top Performers (line 214 area) |
| Task 5 | `apps/web/src/components/matches/scoresheet.tsx` | Render "Opponent — no profile" placeholder when `row.playerId === null` (lines 201-211) |
| Task 6 | `apps/web/src/components/matches/scoresheet.tsx` | Align GoalieTable `min-w-[480px]` → `min-w-[640px]` to match SkaterTable (line 339) |
| Task 7 | `docs/reviews/Match-ID-UI-UX-Review.md` | Mark §6 #9 Resolved (PIM tile already removed by morning sweep) |

Seven commits. Tasks 1-6 all touch `scoresheet.tsx`; line-disjoint. Task 7 is doc-only.

---

### Task 1: Replace expanded-panel header with gamertag

**Files:**
- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 196-199)

- [ ] **Step 1: Replace "Advanced Statistics / Per-match breakdown" with player gamertag**

The expanded panel header (lines 196-199) currently:

```tsx
<h4 className="font-condensed text-lg font-semibold text-zinc-100">
  Advanced Statistics
</h4>
<p className="text-sm text-zinc-500">Per-match breakdown</p>
```

Replace with (gamertag as the main heading, "Per-match breakdown" as subtitle):

```tsx
<h4 className="font-condensed text-lg font-semibold text-zinc-100">
  {row.gamertag}
</h4>
<p className="text-sm text-zinc-500">Per-match breakdown</p>
```

When the expanded panel is scrolled past the row header, the gamertag identifies whose stats are being shown without needing to scroll back up. The "View Player Profile" link on the right side already implies these are advanced stats.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. (`row.gamertag` is already in scope — used in the row header above.)

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Expand a skater row (e.g., MrHomicide). The expanded panel header should now read `MrHomicide` (h4) followed by `Per-match breakdown` (subtitle). Opponent rows show their persona / gamertag as well.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
polish(matches/scoresheet): expanded-panel header → player gamertag

The expanded panel's h4/subtitle pair ("Advanced Statistics" /
"Per-match breakdown") was redundant — the panel was inside an
already-titled Scoresheet section, and the section header already
established the data context.

Replaced the generic "Advanced Statistics" with the player's
gamertag. When the panel is scrolled past the row header, the
gamertag identifies whose stats are being shown without needing
to scroll back up. The "View Player Profile" link on the right
side still implies these are advanced stats.

Resolves UI review §6 issue #8.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Chevron hover brightness

**Files:**
- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 151-155 — chevron span)

- [ ] **Step 1: Add `group-hover:text-zinc-300` to the chevron**

The chevron span (around lines 151-155) currently:

```tsx
<span
  className={`mt-1 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
>
  ▸
</span>
```

The parent `<tr>` already has the `group` class (confirmed from the earlier mobile/keyboard sweep, lines 100-105: `className="group cursor-pointer transition-colors hover:bg-surface-raised focus:bg-surface-raised focus:outline-none"`). Add the `group-hover:` brightening:

```tsx
<span
  className={`mt-1 shrink-0 text-zinc-500 transition-colors transition-transform group-hover:text-zinc-300 ${expanded ? 'rotate-90' : ''}`}
>
  ▸
</span>
```

The `transition-colors` is added alongside `transition-transform` so the color animates smoothly on hover (matching the rotate animation's smoothness).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Hover over a skater row — the `▸` chevron should brighten from `zinc-500` (default) to `zinc-300` (hover). Visual cue that the row is interactive.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
polish(matches/scoresheet): chevron brightens on row hover

The `▸` chevron stayed at `text-zinc-500` regardless of row hover
state — only the row background changed on hover. Chevron + the
row background animating together makes the interactivity cue
clearer; chevron alone staying dim made it feel inert.

Added `group-hover:text-zinc-300` + `transition-colors` so the
chevron brightens on hover, matching the smoothness of the
existing `transition-transform` rotate animation.

Resolves UI review §6 issue #10.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Strengthen expanded row contrast

**Files:**
- Modify: `apps/web/src/components/matches/scoresheet.tsx` (line 191 — expanded `<tr>`)

- [ ] **Step 1: Strengthen the expanded row background + add accent left rail**

Line 191 currently:

```tsx
<tr className="bg-zinc-950/30">
```

Replace with (slightly stronger background + thin accent rail on the left to clearly demarcate the expansion):

```tsx
<tr className="bg-zinc-900/40 border-l-2 border-accent/30">
```

Visual scan now reads: row → row → [accent rail | tinted background] expanded panel → row. The reader can tell where the panel ends and the next row begins without squinting.

(`border-l-2 border-accent/30` on a `<tr>` may not render in some browser default table styles — if the rail doesn't appear after this change, move the border to the inner `<td>` or wrap with a `<div>` instead. Verify in Step 3.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Expand any skater row. The expanded `<tr>` should now have:
- Slightly more visible dark background (deeper than the surrounding surface)
- A thin red accent rail on the left edge, signaling the panel start/end

If the left rail doesn't render on the `<tr>`, it's a CSS-on-table-row quirk — re-apply the border to the inner `<td>` (`className="border-l-2 border-accent/30 ..."`) and re-verify.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
polish(matches/scoresheet): strengthen expanded-row contrast + add accent rail

The expanded-row background (`bg-zinc-950/30`) was barely visible
against the surrounding surface — readers had to squint to tell
where the expansion panel ended and the next row began.

Strengthened to `bg-zinc-900/40` (deeper tint) + added a thin
`border-l-2 border-accent/30` rail on the left edge. The accent
rail visually demarcates the panel as belonging to the row above
it (matches the page-wide convention of left-accent rails for
"this is part of the same thing").

Resolves UI review §6 issue #11.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Game Score cross-link tooltip

**Files:**
- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 213-216 area — Score `DetailStat`)

- [ ] **Step 1: Add `tooltip` prop to the Score tile**

The Score tile (lines 213-216 area) currently:

```tsx
<DetailStat label="Score" value={row.score.toFixed(2)} />
```

Add the tooltip prop (introduced earlier today during the Scoresheet polish sweep when `DetailStat` was extended for the Shot On Net % explainer):

```tsx
<DetailStat
  label="Score"
  value={row.score.toFixed(2)}
  tooltip="Game Score — same value shown in the Top Performers section above. Ranks players by overall match contribution."
/>
```

The `tooltip` prop emits a `title=` HTML attribute + the small `ⓘ` glyph next to the label. Hover-tooltip text explains the cross-surface connection.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. (`DetailStat.tooltip?: string | undefined` already exists in the component signature from the morning sweep.)

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Expand a skater row. The SCORE tile should now show a small `ⓘ` next to the label; hovering surfaces the cross-link text.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
polish(matches/scoresheet): Game Score tile gets cross-link tooltip

The "Score" tile in the expanded panel shows the same value as
the Top Performers section's Game Score above. A reader expanding
the panel and seeing the number again might wonder "is this the
same thing as the score above?" with no explicit signal.

Added a tooltip explaining the cross-surface connection:
"Game Score — same value shown in the Top Performers section
above. Ranks players by overall match contribution."

Uses the existing DetailStat `tooltip` prop introduced during the
morning Scoresheet polish sweep (commit b25945c).

Resolves UI review §6 issue #12.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Opp "no profile" placeholder

**Files:**
- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 201-211 — `View Player Profile` conditional)

- [ ] **Step 1: Replace the null branch with a placeholder**

The `View Player Profile` link conditional (lines 201-211) currently:

```tsx
{row.playerId !== null ? (
  <Link
    href={`/roster/${row.playerId.toString()}`}
    className="font-condensed text-sm font-bold uppercase tracking-wide text-accent hover:text-accent/80"
    onClick={(e) => {
      e.stopPropagation()
    }}
  >
    View player profile
  </Link>
) : null}
```

Replace the null branch with a faint placeholder:

```tsx
{row.playerId !== null ? (
  <Link
    href={`/roster/${row.playerId.toString()}`}
    className="font-condensed text-sm font-bold uppercase tracking-wide text-accent hover:text-accent/80"
    onClick={(e) => {
      e.stopPropagation()
    }}
  >
    View player profile
  </Link>
) : (
  <span className="font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-600">
    Opponent · no profile
  </span>
)}
```

Layout stays symmetric (link or placeholder always renders in the same slot); reader gets explicit signal that opp rows don't link out by design (not a bug).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Expand an opp row (e.g., DUH POPE under the 4L team). The right side of the expanded panel header should now show `Opponent · no profile` in faint grey instead of being empty. BGM rows still show the red `View player profile` link.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
polish(matches/scoresheet): opp expanded-panel — "Opponent · no profile" placeholder

The "View Player Profile" link rendered only for BGM players (which
have `row.playerId` set). For opp rows the right side of the
expanded panel header sat empty, leaving an asymmetric layout +
no explanation of why the link wasn't there.

Replaced the null branch with a faint `Opponent · no profile`
placeholder (text-zinc-600). Layout stays symmetric and the
absence reads as "by design", not "missing data".

Resolves UI review §6 issue #13.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Align GoalieTable min-width to 640px

**Files:**
- Modify: `apps/web/src/components/matches/scoresheet.tsx` (line 339 — GoalieTable)

- [ ] **Step 1: Bump GoalieTable `min-w-[480px]` → `min-w-[640px]`**

The GoalieTable's outer `<table>` (line 339) currently:

```tsx
<table className="w-full min-w-[480px]">
```

Replace with (match SkaterTable's 640px so both tables share a horizontal-scroll threshold):

```tsx
<table className="w-full min-w-[640px]">
```

Goalie has fewer columns so it technically fits at 480px, but a uniform threshold means the page only horizontal-scrolls at one viewport width across both tables — readers don't see one table scroll-bar while another doesn't.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Both SkaterTable and GoalieTable should now share the same min-width threshold. At ~500px viewport width, both tables should engage their horizontal scroll behavior together (or neither).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
polish(matches/scoresheet): align GoalieTable min-width to 640px (match SkaterTable)

GoalieTable used `min-w-[480px]` while SkaterTable used
`min-w-[640px]`. The threshold gap meant one table could engage
its horizontal scroll behavior while the other didn't, depending
on viewport width — visually inconsistent within the same section.

Aligned GoalieTable to 640px. Both tables now share a horizontal
scroll threshold; the section either scrolls horizontally as a
whole or doesn't.

Resolves UI review §6 issue #15.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Mark UI review §6 #9 Resolved

**Files:**
- Modify: `docs/reviews/Match-ID-UI-UX-Review.md` (§6 issue #9 body + suggested-next-moves row if present)

**Why this task:** UI review §6 #9 called out that the quick-stat tile order mixed PIM (penalty minutes) with offensive metrics — confusing reader scan. Today's morning Scoresheet polish sweep (commit `0a0546d`) removed the PIM tile entirely (PIM stays in the Discipline detail group below). The remaining 6 tiles (SCORE / Shot On Net % / Shooting % / Pass % / FO % / Possession) are all positive/neutral metrics — no mixing concern. The original §9 critique is moot.

- [ ] **Step 1: Add Status note under §6 #9**

In `docs/reviews/Match-ID-UI-UX-Review.md`, find the §6 #9 body (around line 516):

```markdown
**9. Quick-stat tile order isn't ordered by importance.** SCORE / SHOOTING % / PASS % / FO % / PIM / POSSESSION. Score and PIM are quite different concerns — Score is "how much did this player help win?" and PIM is "how many penalty minutes did they take?". The 3×2 grid layout shows them adjacent. Could reorder by category (offensive metrics first, then discipline) or by importance.
```

Append a Status paragraph beneath it (mirroring the format used for prior Resolved markings today):

```markdown
**9. Quick-stat tile order isn't ordered by importance.** SCORE / SHOOTING % / PASS % / FO % / PIM / POSSESSION. Score and PIM are quite different concerns — Score is "how much did this player help win?" and PIM is "how many penalty minutes did they take?". The 3×2 grid layout shows them adjacent. Could reorder by category (offensive metrics first, then discipline) or by importance.

**Status (2026-05-17): Resolved by morning Scoresheet polish sweep (commit `0a0546d`)** — the PIM tile was removed entirely when the real Shooting % tile was added. The remaining 6 tiles (SCORE / Shot On Net % / Shooting % / Pass % / FO % / Possession) are all positive/neutral metrics; the original "PIM mixed with offensive metrics" critique is moot. PIM is still visible in the Discipline detail group below.
```

- [ ] **Step 2: Commit**

```bash
git add docs/reviews/Match-ID-UI-UX-Review.md
git commit -m "$(cat <<'EOF'
docs(reviews): mark Scoresheet §6 #9 (tile order) resolved

Today's morning Scoresheet polish sweep (commit 0a0546d) removed
the PIM tile from the headline grid when the real Shooting % tile
was added. The remaining 6 tiles (SCORE / Shot On Net % / Shooting
% / Pass % / FO % / Possession) are all positive/neutral metrics;
the original "PIM mixed with offensive metrics" critique that §6
#9 raised is moot.

Marked Resolved at the issue body with citation. Same pattern as
prior doc-resolution commits today (Action Tracker #23, Event
Timeline §7 #8, Top Performers §1 #4 + #14).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (end-to-end, after all 7 commits)

1. **Typecheck:** `pnpm typecheck` — 0 errors.
2. **Format:** `pnpm format` — clean.
3. **Browser at `/games/250`** — Scoresheet walkthrough:
   - **Expand a BGM skater row** (e.g., MrHomicide):
     - Panel header shows `MrHomicide` (gamertag) + `Per-match breakdown` subtitle
     - SCORE tile has small `ⓘ` glyph; hovering shows the Top Performers cross-link tooltip
     - Expanded panel background slightly darker + left red rail visible
     - "View Player Profile" link on the right (accent red)
   - **Expand an opp skater row** (e.g., DUH POPE):
     - Panel header shows the persona / gamertag
     - Right side shows `Opponent · no profile` placeholder in faint grey
   - **Hover over any row:** chevron `▸` brightens from `text-zinc-500` → `text-zinc-300`.
   - **GoalieTable + SkaterTable scroll together** at narrow widths (uniform 640px threshold).
4. **Curl sanity:**
   - `grep -c "Advanced Statistics"` → 0 (header replaced)
   - `grep -c "Opponent · no profile"` → ≥1 (placeholder rendered for opp rows)
   - `grep -c "min-w-\\[480px\\]"` → 0 (GoalieTable aligned to 640)
5. **Git log review:** `git log --oneline -7` — seven commits, each scoped.

## Out of Scope (follow-ups)

- **UI review §6 #15 — alignment as design choice.** Bumping GoalieTable to 640px is the user's pick; the original 480px was technically defensible (goalie table has fewer columns). The bump is a uniformity tradeoff — if it makes the goalie table look sparse, a future revert to 480 is fine.
- **UI review §6 #3a — specific LD/RD position from OCR loadout.** Requires plumbing OCR loadout snapshots into `buildScoresheet` in match-recap.ts to override `SkaterRow.position` from generic `defenseMen` → specific `leftDefenseMen` / `rightDefenseMen` per slot. Data-layer work, not polish.
- **Six untracked plan files** under `docs/superpowers/plans/` from prior sweeps — separate cleanup commit when convenient.
