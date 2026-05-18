# Cross-Cutting Bar / Color Sweep — Match Detail Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve five UI-review issues across `/games/[id]` that share roots in two display conventions: team-side color encoding (BGM = accent red, OPP = neutral grey) and team-name abbreviation.

**Architecture:** Four small, independent commits. No new components, no data migrations. Three commits touch one file each; one consolidates a duplicated helper across four files. Color sweeps follow the convention already used by `star-card.tsx` and `scoresheet.tsx` (emerald-400 / rose-400 for signed deltas) and the existing accent/neutral palette in `team-stats.tsx`.

**Tech Stack:** Next.js 15 App Router, React Server + Client Components, Tailwind CSS 4 with CSS-var tokens (`--color-accent`, `--color-fg-1..6`), Drizzle. No new dependencies.

---

## Context

The `/games/[id]` UI review (`docs/reviews/Match-ID-UI-UX-Review.md`) called out five issues that look unrelated but share two root causes:

1. **Color convention drift** — `possession-edge.tsx ContributorRow` colors its bar segments and number labels by "who wins this factor" instead of by team identity. Result: BGM losses on hits render in the same red as BGM wins on shots, so a fast scan can't distinguish "where BGM dominated" from "where BGM lost." The same root cause also makes positive and negative deltas (`+7.2 to DtW`, `-3.5 to DtW`) both render in accent red.

2. **Polarity blindness in `team-stats.tsx`** — Giveaways 44 vs 38 renders BGM's wider red bar prominently, even though "more giveaways" means BGM is _worse_ on that row. The colors are already correct (BGM = accent, OPP = neutral); what's missing is a `↓ better` indicator on inverted-polarity rows.

3. **Tied-game score chips in `event-timeline.tsx`** — When the game is tied (`3-3 — TIED`), both score numbers render in accent red, which reads as "BGM tied them" (BGM-favorable framing). Should render neutral when tied.

4. **`4TH` vs `4L` for opponent abbreviation** — Event Timeline shows `4TH CLOSES` / `GOAL · 4TH`, while every other section shows `4L`. Root cause is twofold: (a) `matches.opp_team_abbr = "4TH"` is stored in the DB for match 250, and (b) only Event Timeline reads that DB field — every other component derives `"4L"` locally via one of three duplicated `abbreviateTeam` helpers.

5. **Three duplicated abbreviation helpers** — `event-timeline.tsx:1071`, `action-tracker-map.tsx:1411`, `faceoff-map.tsx:493` each define near-identical `abbreviateTeam` functions, while the canonical `abbreviateTeamName` in `apps/web/src/lib/format.ts:128` already exists and produces `"4L"` from `"4th Line"` correctly.

The intended outcome is a single sweep that makes the page's color and abbreviation conventions consistent in one focused arc, with each commit independently reviewable.

---

## File Map

| Touched in | File                                                     | Why                                                                                            |
| ---------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Task 1     | `apps/web/src/components/matches/event-timeline.tsx`     | Delete local `abbreviateTeam` helper, drop `oppTeamAbbr` prop precedence                       |
| Task 1     | `apps/web/src/components/matches/action-tracker-map.tsx` | Delete local `abbreviateTeam` helper                                                           |
| Task 1     | `apps/web/src/components/matches/faceoff-map.tsx`        | Delete local `abbreviateTeam` helper                                                           |
| Task 1     | `apps/web/src/app/games/[id]/page.tsx`                   | Drop `oppTeamAbbr={match.oppTeamAbbr}` prop                                                    |
| Task 2     | `apps/web/src/components/matches/possession-edge.tsx`    | Bar segment color + number color + delta color in `ContributorRow`                             |
| Task 3     | `apps/web/src/components/matches/event-timeline.tsx`     | Tied-state color in `FinalScore`, goal card footer score, `ScoreBubble`                        |
| Task 4     | `apps/web/src/lib/match-recap.ts`                        | Add `polarity?: 'higher-better' \| 'lower-better'` to `BoxScoreRow`; tag Giveaways + Penalties |
| Task 4     | `apps/web/src/components/matches/team-stats.tsx`         | Render `↓ better` indicator next to lower-better row labels                                    |

**Existing helpers to reuse (do not re-implement):**

- [`abbreviateTeamName(name: string): string`](apps/web/src/lib/format.ts#L128) — multi-word, filler-aware. `"4th Line"` → `"4L"`, `"Habs of Anarchy"` → `"HOA"`.
- Tailwind tokens already in use: `text-accent` (BGM red), `text-fg-1` (off-white), `text-fg-3` (muted), `text-fg-4` (more muted), `bg-fg-4` (neutral bar), `bg-accent` (BGM bar). All defined via CSS vars in `apps/web/src/app/globals.css`.
- `text-emerald-400` / `text-rose-400` for signed deltas — same tokens as [`star-card.tsx:225`](apps/web/src/components/matches/star-card.tsx#L225) and [`scoresheet.tsx:94`](apps/web/src/components/matches/scoresheet.tsx#L94).

---

### Task 1: Consolidate `abbreviateTeam` helpers + drop `oppTeamAbbr` DB precedence

**Why first:** Touches 4 files but each change is mechanical (delete a local helper, replace with import). Zero rendering logic changes. Auto-fixes match 250's `4TH → 4L` because `abbreviateTeamName("4th Line") === "4L"`.

**Files:**

- Modify: `apps/web/src/components/matches/event-timeline.tsx` (lines 25-30, 56-73, 1071-1080)
- Modify: `apps/web/src/components/matches/action-tracker-map.tsx` (around line 141 and 1411)
- Modify: `apps/web/src/components/matches/faceoff-map.tsx` (around line 227 and 493)
- Modify: `apps/web/src/app/games/[id]/page.tsx` (line 231)

- [ ] **Step 1: Remove the duplicate helper from `event-timeline.tsx` and use `abbreviateTeamName`**

Delete lines 1071-1080 entirely (the `function abbreviateTeam(label: string): string { ... }` block).

At the top of the file (alphabetical with other `@/lib` imports), add:

```ts
import { abbreviateTeamName } from '@/lib/format'
```

Then update the `oppAbbrev` derivation (currently lines 70-73) from:

```ts
// Prefer the DB-stored team abbreviation (set by the OCR colour extractor)
// over a name-derived fallback so the timeline matches the in-game crest.
const oppAbbrev =
  oppTeamAbbr && oppTeamAbbr.length > 0 ? oppTeamAbbr : abbreviateTeam(opponentLabel)
```

to:

```ts
const oppAbbrev = abbreviateTeamName(opponentLabel)
```

Also remove the `oppTeamAbbr` prop from the component signature. In the `EventTimelineProps` interface (around line 28), delete:

```ts
oppTeamAbbr?: string | null
```

And from the destructured params (around line 61), delete the `oppTeamAbbr,` line.

- [ ] **Step 2: Remove the duplicate helper from `action-tracker-map.tsx`**

Delete the local `function abbreviateTeam(label: string): string { ... }` block at line 1411 (read the block to confirm its full extent — it's the same shape as the one in event-timeline). Add the import at the top:

```ts
import { abbreviateTeamName } from '@/lib/format'
```

Replace the single call site at line 141:

```ts
const oppAbbrev = abbreviateTeam(opponentLabel)
```

with:

```ts
const oppAbbrev = abbreviateTeamName(opponentLabel)
```

- [ ] **Step 3: Remove the duplicate helper from `faceoff-map.tsx`**

Same shape as Step 2. Delete the local `function abbreviateTeam` at line 493, add the import, replace the call site at line 227 (`const oppAbbr = abbreviateTeam(opponentLabel)` → `const oppAbbr = abbreviateTeamName(opponentLabel)`).

Note the local variable here is `oppAbbr`, not `oppAbbrev` — preserve the existing name.

- [ ] **Step 4: Drop the `oppTeamAbbr` prop in `page.tsx`**

In `apps/web/src/app/games/[id]/page.tsx` at line 231, the `<EventTimeline>` JSX currently passes:

```tsx
oppTeamAbbr={match.oppTeamAbbr}
```

Delete that prop line entirely. The other props on `<EventTimeline>` stay as-is.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. If TS complains about an unused import or unused destructured param anywhere, clean it up (likely won't, but the helper deletions could leave a stale import).

- [ ] **Step 6: Manual browser verification**

Start the dev server if it isn't already (`pnpm --filter web dev`), navigate to `/games/250`, and confirm:

- Event Timeline lead-change tags now say `4L CLOSES` / `GOAL · 4L` (not `4TH`)
- Action Tracker filter row still shows `4L` (unchanged from before)
- Faceoff Map still shows `4L` (unchanged from before)
- Box Score period table still shows `4L` (unchanged from before; uses `abbreviateTeamName` already)

- [ ] **Step 7: Format**

Run: `pnpm format`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/matches/event-timeline.tsx \
        apps/web/src/components/matches/action-tracker-map.tsx \
        apps/web/src/components/matches/faceoff-map.tsx \
        apps/web/src/app/games/[id]/page.tsx
git commit -m "$(cat <<'EOF'
refactor(matches): consolidate abbreviateTeam helpers on lib/format.ts

Three near-identical `abbreviateTeam` functions (event-timeline, action-tracker-map,
faceoff-map) replaced with the canonical `abbreviateTeamName` from lib/format.ts.
Also drops the `match.oppTeamAbbr` DB-precedence path in event-timeline so the
opponent abbreviation is derived from `opponentName` consistently across all
sections.

Side effect: match 250's "4TH CLOSES" tag in Event Timeline becomes "4L CLOSES",
matching every other section. The stale `opp_team_abbr` DB column for match 250
is now ignored at render time (separate followup: backfill or deprecate the
column).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fix `ContributorRow` colors in `possession-edge.tsx`

**Why second:** Single-file change; isolates the most visible color bug on the page (the contributor breakdown's red-on-red delta confusion). The bar segment + number colors decouple team identity from outcome; the delta color follows the convention used elsewhere on the page.

**Files:**

- Modify: `apps/web/src/components/matches/possession-edge.tsx` (lines 359-423, `ContributorRow`)

- [ ] **Step 1: Fix the bar segment colors**

In `ContributorRow` (line 359), the bar at lines 393-401 currently colors each segment based on which side wins. Replace:

```tsx
<div className="flex h-2.5 border border-zinc-800 bg-charcoal">
  <span
    className={`block h-full ${winner === 'bgm' ? 'bg-accent' : 'bg-fg-4'}`}
    style={{ width: `${bgmSharePct}%` }}
  />
  <span
    className={`block h-full ${winner === 'opp' ? 'bg-accent' : 'bg-fg-4'}`}
    style={{ width: `${oppSharePct}%` }}
  />
</div>
```

with:

```tsx
<div className="flex h-2.5 border border-zinc-800 bg-charcoal">
  <span className="block h-full bg-accent" style={{ width: `${bgmSharePct}%` }} />
  <span className="block h-full bg-fg-4" style={{ width: `${oppSharePct}%` }} />
</div>
```

BGM segment is always accent red; OPP segment is always neutral. The widths still encode the share.

- [ ] **Step 2: Fix the number colors flanking the bar**

Lines 386-391 (BGM number) and 403-408 (OPP number) also follow the winner. Replace the BGM number block:

```tsx
<span
  className={`text-right font-condensed text-[14px] font-extrabold leading-none tabular-nums ${
    winner === 'bgm' ? 'text-accent' : 'text-fg-1'
  }`}
>
  {contributor.bgmDisplay}
</span>
```

with:

```tsx
<span className="text-right font-condensed text-[14px] font-extrabold leading-none tabular-nums text-accent">
  {contributor.bgmDisplay}
</span>
```

And the OPP number block:

```tsx
<span
  className={`text-left font-condensed text-[14px] font-extrabold leading-none tabular-nums ${
    winner === 'opp' ? 'text-accent' : 'text-fg-3'
  }`}
>
  {contributor.oppDisplay}
</span>
```

with:

```tsx
<span className="text-left font-condensed text-[14px] font-extrabold leading-none tabular-nums text-fg-3">
  {contributor.oppDisplay}
</span>
```

- [ ] **Step 3: Fix the delta color**

Lines 367-374 currently render both positive and negative deltas in `text-accent`. Replace the `deltaColor` derivation:

```ts
const deltaColor =
  delta == null
    ? 'text-fg-5'
    : winner === 'bgm'
      ? 'text-accent'
      : winner === 'opp'
        ? 'text-accent'
        : 'text-fg-1'
```

with sign-based green/rose matching the page's existing convention (see `star-card.tsx:225` and `scoresheet.tsx:94`):

```ts
const deltaColor =
  delta == null
    ? 'text-fg-5'
    : delta > 0
      ? 'text-emerald-400'
      : delta < 0
        ? 'text-rose-400'
        : 'text-fg-1'
```

Note: `delta` semantics in `Contributor` are "signed impact on BGM's DtW share." Positive = factor helps BGM, negative = factor hurts BGM. The sign-based mapping is correct.

- [ ] **Step 4: Remove the now-unused `winner` derivation if nothing else uses it**

Re-read the `ContributorRow` body. If after Steps 1-3 the local `winner` variable (line 363-364) is no longer referenced anywhere in the component, delete those lines too. (If `winner` is still used by something I missed, leave it.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 6: Manual browser verification**

Navigate to `/games/250`, open the Deserve to Win "Where the edge came from" collapsible, confirm:

- SHOTS row: BGM segment (left) is accent red, OPP segment (right) is grey
- HITS row: BGM segment (left) is accent red (even though BGM has fewer hits — color encodes side, width encodes value)
- `+7.2 to DtW` for SHOTS renders in green (emerald-400)
- `-3.5 to DtW` for HITS renders in rose
- TIME ON ATTACK delta still distinguishes positive/negative correctly

- [ ] **Step 7: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/possession-edge.tsx
git commit -m "$(cat <<'EOF'
fix(matches/possession-edge): decouple bar/number colors from winner, sign-based delta

ContributorRow bar segments and flanking numbers now color by team identity
instead of by which side wins each factor. BGM always renders in accent red,
OPP in neutral; bar widths still encode the share split. The previous
winner-based coloring made "BGM dominated" and "BGM lost" look identical on
a fast scan.

Per-factor delta also switched from dual-accent to sign-based emerald (positive
DtW impact for BGM) / rose (negative). Matches the convention already used on
the Top Performers star cards and Scoresheet +/- column.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Tied-state score chip color in `event-timeline.tsx`

**Why third:** Single-file, three call sites, no new dependencies. Removes the "BGM-favorable framing" on tied games.

**Files:**

- Modify: `apps/web/src/components/matches/event-timeline.tsx` (lines 211-233, 520-533, 687-715)

- [ ] **Step 1: Fix `FinalScore` (bottom anchor)**

Lines 211-233 currently render:

```tsx
<span className={bgmWon || tied ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-3)]'}>
  {bgm}
</span>
<span className="text-[var(--color-fg-6)]">–</span>
<span className={!bgmWon && !tied ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-fg-3)]'}>
  {opp}
</span>
```

The `tied` case incorrectly groups with `bgmWon`. Replace the two team-number `<span>` blocks with explicit three-state logic:

```tsx
<span
  className={
    tied
      ? 'text-[var(--color-fg-1)]'
      : bgmWon
        ? 'text-[var(--color-accent)]'
        : 'text-[var(--color-fg-3)]'
  }
>
  {bgm}
</span>
<span className="text-[var(--color-fg-6)]">–</span>
<span
  className={
    tied
      ? 'text-[var(--color-fg-1)]'
      : bgmWon
        ? 'text-[var(--color-fg-3)]'
        : 'text-[var(--color-fg-1)]'
  }
>
  {opp}
</span>
```

When tied: both numbers are off-white. When BGM won: BGM accent, OPP muted. When BGM lost: BGM muted, OPP off-white.

- [ ] **Step 2: Fix the goal card footer score**

Lines 520-533 render the post-goal running score inside each goal card. Currently:

```tsx
<span className="font-condensed text-[13px] font-black tabular-nums tracking-[0.02em] text-[var(--color-fg-3)]">
  <span className="text-[var(--color-accent)]">{scoreCtx.bgmAfter}</span>
  <span className="px-1 text-[var(--color-fg-6)]">–</span>
  <span className="text-[var(--color-fg-1)]">{scoreCtx.oppAfter}</span>
</span>
```

The BGM number is hardcoded accent regardless of whether the score is tied. Use `scoreCtx.tied` (which exists on `GoalContext`, see line 928 where it's set) to pick neutral when tied. Replace with:

```tsx
<span className="font-condensed text-[13px] font-black tabular-nums tracking-[0.02em] text-[var(--color-fg-3)]">
  <span className={scoreCtx.tied ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-accent)]'}>
    {scoreCtx.bgmAfter}
  </span>
  <span className="px-1 text-[var(--color-fg-6)]">–</span>
  <span className="text-[var(--color-fg-1)]">{scoreCtx.oppAfter}</span>
</span>
```

(OPP number is already `text-fg-1`, which is the neutral tone we want when tied — no change needed.)

- [ ] **Step 3: Fix `ScoreBubble` (on-rail running score)**

Lines 687-715. The BGM number is hardcoded `text-[var(--color-accent)]`. Replace the bubble's number spans:

```tsx
<span className="text-[16px] text-[var(--color-accent)]">{ctx.bgmAfter}</span>
<span className="text-[11px] text-[var(--color-fg-6)]">–</span>
<span className="text-[16px] text-[var(--color-fg-1)]">{ctx.oppAfter}</span>
```

with:

```tsx
<span
  className={`text-[16px] ${
    ctx.tied ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-accent)]'
  }`}
>
  {ctx.bgmAfter}
</span>
<span className="text-[11px] text-[var(--color-fg-6)]">–</span>
<span className="text-[16px] text-[var(--color-fg-1)]">{ctx.oppAfter}</span>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Manual browser verification**

Navigate to `/games/250`. Scroll the Event Timeline and check the score chip after the 3rd BGM goal (which ties the game at 3-3):

- The on-rail score bubble between events shows `3 – 3` with both numbers in off-white (not BGM in red)
- The goal card footer for the tying goal shows `3 – 3` with both numbers in off-white
- The "— Tied" swing label stays in `text-otl` orange (unchanged)
- Scroll to the bottom: `FINAL · BGM · 4 – 3` still renders BGM `4` in accent red (winning state, not tied)
- For a sanity check, also confirm the chip after the 2nd BGM goal (`2 – 0`, BGM leads) still shows BGM number in accent red.

- [ ] **Step 6: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/event-timeline.tsx
git commit -m "$(cat <<'EOF'
fix(matches/event-timeline): neutral score color when game is tied

The three running-score render paths (FinalScore anchor, goal card footer,
on-rail ScoreBubble) hardcoded BGM's number to accent red regardless of
verdict. When the game was tied (e.g. after a 3-3 equalizer) this read as
"BGM took the tie", a BGM-favorable framing inappropriate for a neutral
score state.

Tied → both numbers in off-white (text-fg-1). BGM-leads and BGM-trails
states unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Polarity indicator in `team-stats.tsx`

**Why last:** Touches two files (`match-recap.ts` view-model + `team-stats.tsx` rendering) and is the most additive change. The bar colors in team-stats are already correct (BGM = accent, OPP = neutral); this task only adds a `↓ better` label on rows where lower-is-better, so a reader scanning Giveaways or Penalties knows a "wider red BGM bar" is a _bad_ outcome.

**Files:**

- Modify: `apps/web/src/lib/match-recap.ts` (lines 622-637 for type, lines 638-738 for `buildBoxScore`)
- Modify: `apps/web/src/components/matches/team-stats.tsx` (lines 64-95 for `Row`)

- [ ] **Step 1: Add `polarity` to `BoxScoreRow`**

In `apps/web/src/lib/match-recap.ts` at line 622, extend the interface:

```ts
export interface BoxScoreRow {
  label: string
  /** BGM value (already formatted). */
  us: string
  /** Opponent value (formatted). null = unknown / not comparable. */
  them: string | null
  /**
   * Indicates the stat's semantic direction.
   * 'higher-better' (default) — more is good for BGM (goals, shots, hits).
   * 'lower-better' — less is good for BGM (giveaways, penalties).
   * Used by team-stats.tsx to show a "↓ better" indicator on inverted rows.
   */
  polarity?: 'higher-better' | 'lower-better'
}
```

- [ ] **Step 2: Tag the two lower-better rows in `buildBoxScore`**

In the same file, the `defenseRows` array (around line 699) contains the two lower-better stats: `Giveaways` and `Penalties`. Locate these two lines:

```ts
row('Giveaways', bgmAgg.giveaways, oppAgg.giveaways),
...
row('Penalties', match.penaltyMinutes ?? 0, match.penaltyMinutesAgainst ?? 0),
```

The `row()` helper likely returns a `BoxScoreRow` without polarity. The cleanest way is to override on the resulting object. Replace the `defenseRows` definition with:

```ts
const defenseRows: BoxScoreRow[] = [
  row('Hits', match.hitsFor, match.hitsAgainst),
  row('Blocked Shots', bgmAgg.blockedShots, oppAgg.blockedShots),
  row('Takeaways', bgmAgg.takeaways, oppAgg.takeaways),
  { ...row('Giveaways', bgmAgg.giveaways, oppAgg.giveaways)!, polarity: 'lower-better' },
  row('Interceptions', bgmAgg.interceptions, oppAgg.interceptions),
  {
    ...row('Penalties', match.penaltyMinutes ?? 0, match.penaltyMinutesAgainst ?? 0)!,
    polarity: 'lower-better',
  },
  row('Short Handed Goals', bgmAgg.shGoals, oppAgg.shGoals),
].filter(nonEmptyRow)
```

If `row()` can return `null` (look at its signature/implementation around the same file — search for `function row`), the non-null assertion `!` may be unsafe. If so, wrap in a conditional:

```ts
const giveawaysRow = row('Giveaways', bgmAgg.giveaways, oppAgg.giveaways)
const penaltiesRow = row('Penalties', match.penaltyMinutes ?? 0, match.penaltyMinutesAgainst ?? 0)
const defenseRows: BoxScoreRow[] = [
  row('Hits', match.hitsFor, match.hitsAgainst),
  row('Blocked Shots', bgmAgg.blockedShots, oppAgg.blockedShots),
  row('Takeaways', bgmAgg.takeaways, oppAgg.takeaways),
  giveawaysRow ? { ...giveawaysRow, polarity: 'lower-better' } : null,
  row('Interceptions', bgmAgg.interceptions, oppAgg.interceptions),
  penaltiesRow ? { ...penaltiesRow, polarity: 'lower-better' } : null,
  row('Short Handed Goals', bgmAgg.shGoals, oppAgg.shGoals),
].filter(nonEmptyRow)
```

(Pick whichever shape matches `row()`'s actual return type. Read its definition first — likely in the same file, search for `function row(`.)

- [ ] **Step 3: Render the `↓ better` indicator in `Row`**

In `apps/web/src/components/matches/team-stats.tsx`, the `Row` component (line 64) currently renders the label centrally:

```tsx
<span className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
  {row.label}
</span>
```

Replace with:

```tsx
<span className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
  {row.label}
  {row.polarity === 'lower-better' ? (
    <span
      className="ml-1.5 align-middle font-condensed text-[9px] font-bold tracking-[0.18em] text-zinc-600"
      title="Lower is better"
    >
      ↓ BETTER
    </span>
  ) : null}
</span>
```

Tiny inline pill, muted tone, sits right of the label. The `title` attr surfaces the meaning on hover for sighted users; the visible glyph + label communicates it at a glance.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Manual browser verification**

Navigate to `/games/250`, scroll to the Team Stats section, confirm:

- `GIVEAWAYS` row label shows `GIVEAWAYS ↓ BETTER` (small muted indicator)
- `PENALTIES` row label shows `PENALTIES ↓ BETTER`
- All other rows (Goals, Shots, Hits, Takeaways, etc.) have no indicator
- Bars themselves are unchanged: BGM still red, OPP still neutral grey

Now read each row with the indicator in mind: GIVEAWAYS shows BGM=44 with a wider red bar, but the `↓ BETTER` label tells you that's the _worse_ outcome. The polarity signal lands without inverting the visual encoding.

- [ ] **Step 6: Format + commit**

```bash
pnpm format
git add apps/web/src/lib/match-recap.ts apps/web/src/components/matches/team-stats.tsx
git commit -m "$(cat <<'EOF'
feat(matches/team-stats): polarity indicator for lower-is-better rows

Adds optional `polarity: 'higher-better' | 'lower-better'` to BoxScoreRow.
Team Stats renders a small "↓ BETTER" indicator next to the label on
lower-better rows (Giveaways, Penalties), so the reader knows a wider
red BGM bar on those rows means BGM is *worse*, not dominant.

Bar colors unchanged: BGM still always accent, OPP still always neutral —
the indicator handles polarity without inverting the visual encoding.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (end-to-end)

After all four commits:

1. **Typecheck the whole repo:** `pnpm typecheck` — expect 0 errors.
2. **Format:** `pnpm format` — expect clean (each task already runs this, but a final sweep catches anything missed).
3. **Browser verification at `/games/250`** — walk through each section in order:
   - **Event Timeline:** Lead-change tags say `4L CLOSES` / `4L TAKES LEAD` (not `4TH`). Score chip after a tying goal renders both numbers in off-white. FINAL anchor still highlights BGM's 4 in accent red.
   - **Deserve to Win → Where the edge came from:** SHOTS row BGM segment in red, HITS row BGM segment in red (not flipped). `+7.2 to DtW` in emerald, `-3.5 to DtW` in rose.
   - **Team Stats:** GIVEAWAYS and PENALTIES rows show `↓ BETTER` indicator next to label. Other rows unchanged.
4. **Cross-section consistency check:** Every section that mentions the opponent abbreviation should say `4L` — Action Tracker filter, Faceoff Map header, Box Score period header, Lineup matchup tag, Event Timeline tags. None should say `4TH` anywhere.
5. **Git log review:** `git log --oneline -4` should show four commits with clear scopes.

## Out of Scope (follow-ups)

- **Backfill `matches.opp_team_abbr` column** — the column is now ignored at render time, but it's still populated by the OCR colour extractor. Either deprecate the column or fix the extractor's abbreviation logic. Worth a separate ticket.
- **Per-cell heatmap tint on team-stats** — UI review issue #5 (sparse-value bars look misleading). Not in this sweep.
- **Box Score period table polarity** — same `lower-better` concept could later apply to period-by-period giveaways/penalties if those ever surface there. Not currently rendered.
- **Vitest infra for web component tests** — none exists today; adding it is a separate plan, not a polish-sweep prereq.
