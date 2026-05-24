# Top Performers Polish Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four genuine polish items in the Top Performers section + retire two stale UI-review entries the morning's Three Stars revamp silently fixed. Five commits: bump rank-3 score brightness, add a season-delta placeholder so rank-3 cards align with ranks 1-2, drop the dim off-stars for a clean medal-podium look, gradient the Show-All row tints, and mark two stale items Resolved in the review.

**Architecture:** Multi-commit sweep across `star-card.tsx`, `show-all-player-scores.tsx`, and the UI review doc. No new components, no prop changes, no schema changes. The biggest scope shrinker is that 3 of the original 7 UI-review items either don't need work (already shipped during the morning revamp) or aren't polish (mobile carousel is a feature-level design task).

**Tech Stack:** Next.js 15 App Router, React Server Components (StarCard + ShowAllPlayerScores both render server-side), Tailwind CSS 4 with CSS-var tokens. No new dependencies.

---

## Context

A pre-implementation audit of the morning's Three Stars revamp ([commit `fa67d7b`](https://github.com/eanhl/repo)) found that **3 of the 7 UI-review items called out in the review are already resolved or out-of-scope-for-polish**:

| UI review § | Item                                    | Status                                                                                                                                 |
| ----------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| §1 #2       | Rank-3 score too dim                    | **In scope** (Task 1)                                                                                                                  |
| §1 #1       | Rank-3 missing season-delta placeholder | **In scope** (Task 2)                                                                                                                  |
| §1 #3       | Off-stars (`☆`) too dim                 | **In scope** (Task 3)                                                                                                                  |
| §1 #11      | Show-All ranks 2/3 lack medal tint      | **In scope** (Task 4)                                                                                                                  |
| §1 #4       | Archetype pill legend                   | **Resolved** — `ArchetypePillCompact` already has `title=` hover tooltip with `${meta.category} · ${meta.descriptor}` (doc fix Task 5) |
| §1 #14      | `+/−` Unicode hyphen mismatch           | **Resolved** — both card and table now use Unicode minus U+2212 (doc fix Task 5)                                                       |
| §1 #16      | Mobile carousel for medal cards         | **Deferred** — substantive feature work (swipe-snap component + responsive logic + a11y), not single-task polish                       |

User decisions (2026-05-17):

- **Item 3 (off-stars):** drop entirely → `★★★ / ★★ / ★` (cleanest medal-podium pattern; star count alone signals rank)
- **Item 4 (Show-All tints):** graduated accent — rank 1 = `bg-accent/[0.06]` (current), rank 2 = `bg-accent/[0.03]`, rank 3 = `bg-accent/[0.015]` (heatmap echoing the cards above)

Intended outcome: Top Performers becomes the page's cleanest medal-podium surface — rank-3 reads at parity with ranks 1-2, no lopsided card slot, no dim off-glyphs, Show-All table reads as a continuation of the card hierarchy. UI review §1 backlog drops from 7 items to 1 deferred design item (mobile carousel).

---

## File Map

| Touched in | File                                                         | Why                                                                            |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Task 1     | `apps/web/src/components/matches/star-card.tsx`              | Rank-3 score `text-fg-2` → `text-fg-1` (line 208)                              |
| Task 2     | `apps/web/src/components/matches/star-card.tsx`              | Add `— no season data` placeholder when `vsSeasonAvg === null` (lines 220-234) |
| Task 3     | `apps/web/src/components/matches/star-card.tsx`              | Drop `off: '☆'` / `off: '☆☆'` from `RANK_STARS` (lines 16-20)                  |
| Task 4     | `apps/web/src/components/matches/show-all-player-scores.tsx` | Graduated row tints for ranks 1-3 (line 143)                                   |
| Task 5     | `docs/reviews/Match-ID-UI-UX-Review.md`                      | Mark UI review §1 #4 + §1 #14 Resolved                                         |

Five commits. Tasks 1-3 all touch `star-card.tsx`; line-disjoint. Task 4 is `show-all-player-scores.tsx`. Task 5 is doc-only.

---

### Task 1: Rank-3 score brightness — `text-fg-2` → `text-fg-1`

**Files:**

- Modify: `apps/web/src/components/matches/star-card.tsx` (lines 203-208 — `scoreCls`)

- [ ] **Step 1: Bump rank-3 score color**

The `scoreCls` ternary at lines 203-208 currently:

```ts
const scoreCls =
  rank === 1
    ? 'text-accent [text-shadow:0_0_14px_rgba(232,65,49,0.22)]'
    : rank === 2
      ? 'text-fg-1'
      : 'text-fg-2'
```

Replace the rank-3 branch:

```ts
const scoreCls =
  rank === 1
    ? 'text-accent [text-shadow:0_0_14px_rgba(232,65,49,0.22)]'
    : rank === 2
      ? 'text-fg-1'
      : 'text-fg-1'
```

(Rank-3 now matches rank-2 brightness. Rank-1 still dominates via accent + glow. The hierarchy comes from the card chrome — rank-3 has no card gradient and no jersey glow — so the score doesn't need to be dim to signal "less important".)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Top Performers → SHADOWASSAULT20's rank-3 card → the score (`9.06`) should now render in bright off-white instead of dim grey, matching the rank-2 score. Rank-1 (MrHomicide's `14.28`) unchanged in accent red.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/star-card.tsx
git commit -m "$(cat <<'EOF'
polish(matches/top-performers): rank-3 score brightness — text-fg-2 → text-fg-1

The rank-3 star card's score rendered in `text-fg-2` (dim grey)
while rank-2 used `text-fg-1` (off-white). Within its own card the
score-vs-name contrast inverted — name was brighter than the score
it dominates.

Bumped rank-3 to `text-fg-1` so the score reads at parity within
each card. Rank-1 still dominates the row via accent red + glow;
rank-3's "less important" cue comes from the card chrome (no
gradient, no jersey glow), not from a dim score.

Resolves UI review §1 issue #2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rank-3 season-delta placeholder

**Files:**

- Modify: `apps/web/src/components/matches/star-card.tsx` (lines 220-234 — `vsSeasonAvg` render)

- [ ] **Step 1: Replace the null-collapse with a faint placeholder**

The current render at lines 220-234:

```tsx
{
  performer.vsSeasonAvg !== null ? (
    <span className="font-condensed text-[10px] font-bold tabular-nums tracking-[0.12em] text-fg-4">
      <span
        className={
          performer.vsSeasonAvg >= 0
            ? 'font-extrabold text-emerald-400'
            : 'font-extrabold text-rose-400'
        }
      >
        {performer.vsSeasonAvg >= 0 ? '+' : ''}
        {performer.vsSeasonAvg.toFixed(1)}
      </span>{' '}
      vs season avg
    </span>
  ) : null
}
```

When `vsSeasonAvg === null` (e.g., SHADOWASSAULT20 — no season data on file), the slot collapses entirely and the card's score block sits lopsided next to ranks 1-2. Replace with (always render a span at the same line height; show placeholder text when null):

```tsx
{
  performer.vsSeasonAvg !== null ? (
    <span className="font-condensed text-[10px] font-bold tabular-nums tracking-[0.12em] text-fg-4">
      <span
        className={
          performer.vsSeasonAvg >= 0
            ? 'font-extrabold text-emerald-400'
            : 'font-extrabold text-rose-400'
        }
      >
        {performer.vsSeasonAvg >= 0 ? '+' : ''}
        {performer.vsSeasonAvg.toFixed(1)}
      </span>{' '}
      vs season avg
    </span>
  ) : (
    <span className="font-condensed text-[10px] font-bold tracking-[0.12em] text-fg-6 italic">
      — no season data
    </span>
  )
}
```

The placeholder uses `text-fg-6` (the dimmest foreground token) + italic so it visually recedes — readers know the slot is "empty by design" not "we forgot to render".

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. SHADOWASSAULT20's rank-3 card should now show `— no season data` under the score in dim italic. The score block now aligns vertically with rank-1 and rank-2 cards (no lopsided gap).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/star-card.tsx
git commit -m "$(cat <<'EOF'
polish(matches/top-performers): placeholder when no season-avg delta data

When a star-card performer has no season-to-date data on file (e.g.
SHADOWASSAULT20 is new to the roster), the `+X vs season avg` slot
collapsed entirely, leaving the score block lopsided vs the rank-1
and rank-2 cards that did show the delta.

Render a faint `— no season data` placeholder (text-fg-6 + italic)
in the same slot so card structures align across all three medal
positions. Readers see "this player has no baseline yet" rather
than wondering why one card looks shorter than the others.

Resolves UI review §1 issue #1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Drop off-stars for clean medal-podium look

**Files:**

- Modify: `apps/web/src/components/matches/star-card.tsx` (lines 16-20 — `RANK_STARS`)

- [ ] **Step 1: Remove the `off` glyphs from the rank map**

The `RANK_STARS` config at lines 16-20 currently:

```ts
const RANK_STARS = {
  1: { on: '★★★', off: '' },
  2: { on: '★★', off: '☆' },
  3: { on: '★', off: '☆☆' },
} as const
```

The dim `☆` off-glyphs blend into the background (UI review says they're "nearly invisible at viewing distance"). Drop them entirely:

```ts
const RANK_STARS = {
  1: { on: '★★★', off: '' },
  2: { on: '★★', off: '' },
  3: { on: '★', off: '' },
} as const
```

Cards now render `★★★ / ★★ / ★` — the count alone signals rank, matching the standard gold-silver-bronze medal-podium pattern. The `off` rendering site at line 103 will simply emit empty strings, no JSX changes needed.

(Alternative: collapse the whole `RANK_STARS` to a `string` keyed map. The current `{on, off}` shape stays for backward compatibility with the existing JSX — if a future treatment wants off-glyphs back, the data structure is ready.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. (`as const` ensures the empty strings type-check identically to the previous values.)

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Top Performers cards should now show:

- Rank 1 (FIRST STAR) — `★★★` solid accent red
- Rank 2 (SECOND STAR) — `★★` (no dim `☆` after)
- Rank 3 (THIRD STAR) — `★` (no dim `☆☆` after)

Reads as a clean medal podium.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/star-card.tsx
git commit -m "$(cat <<'EOF'
polish(matches/top-performers): drop dim off-stars for clean medal-podium look

Rank 2 cards showed `★★` lit + a dim `☆` off-glyph; rank 3 showed
`★` + two dim `☆☆`. The off-glyphs blended into the card
background and were nearly invisible at viewing distance, so the
"three slots" reading they were meant to convey didn't actually
land for viewers.

Dropped the off-glyphs entirely. Cards now show `★★★ / ★★ / ★` —
star count alone signals rank, matching the standard gold-silver-
bronze medal-podium pattern. Less visual noise, clearer hierarchy.

Resolves UI review §1 issue #3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Show-All row tints — graduated accent

**Files:**

- Modify: `apps/web/src/components/matches/show-all-player-scores.tsx` (line 143 — `rowBg`)

- [ ] **Step 1: Replace the single rank-1 tint with a 3-rank gradient**

Line 143 currently:

```ts
const rowBg = rank === 1 ? 'bg-accent/[0.06]' : ''
```

Replace with a graduated-accent gradient — rank 1 at current intensity, ranks 2 and 3 at decreasing intensity, everyone else plain:

```ts
const rowBg =
  rank === 1
    ? 'bg-accent/[0.06]'
    : rank === 2
      ? 'bg-accent/[0.03]'
      : rank === 3
        ? 'bg-accent/[0.015]'
        : ''
```

The opacity ladder (6% → 3% → 1.5%) reads as a heatmap echoing the cards above — rank 1 strongly red, rank 2 noticeable, rank 3 just-barely-tinted. Ties the table back into the card hierarchy.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. (Tailwind arbitrary-opacity values — `bg-accent/[0.03]` and `bg-accent/[0.015]` are valid syntactically; if the Tailwind config rejects `[0.015]` use `[0.02]` as fallback.)

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Top Performers → Show All Player Scores → expand the table. Top three rows should show a graduated accent tint (rank 1 strongest, rank 2 medium, rank 3 faintest). Ranks 4+ plain background.

Curl sanity:

```bash
curl -s http://localhost:3000/games/250 | grep -oE 'bg-accent/\[0\.0[136]+5?\]' | sort | uniq -c
```

Expected: three distinct accent-opacity classes appear (`bg-accent/[0.06]`, `bg-accent/[0.03]`, `bg-accent/[0.015]`).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/show-all-player-scores.tsx
git commit -m "$(cat <<'EOF'
polish(matches/top-performers): graduated accent row tints for Show-All ranks 1-3

Only the rank-1 row in the Show-All player scores table carried a
tinted background (`bg-accent/[0.06]`). Ranks 2 and 3 had identical
plain styling despite the star markers — medal hierarchy went from
"obvious" on the cards above to "implicit" in the table.

Graduated accent tints: rank 1 stays at 6% opacity (unchanged),
rank 2 at 3%, rank 3 at 1.5%. Reads as a heatmap echoing the card
hierarchy. Ranks 4+ stay plain.

Resolves UI review §1 issue #11.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Mark UI review §1 #4 + §1 #14 Resolved

**Files:**

- Modify: `docs/reviews/Match-ID-UI-UX-Review.md` (§1 issue #4 body + #14 body + suggested-next-moves table rows)

**Why this task:** Pre-implementation audit found that two §1 items don't need any code work:

- **#4 (Archetype pill legend):** `ArchetypePillCompact` already has a `title=` hover tooltip carrying `${meta.category} · ${meta.descriptor}` (e.g., "Forward · Vision · Distribution" for PLY). The UI review's "no key" framing is stale — there IS a key, it's just a tooltip rather than a persistent legend.
- **#14 (`+/−` Unicode mismatch):** Both card and table surfaces now use Unicode minus U+2212. Some commit between the review's writing and today silently fixed this.

Mark both Resolved at the issue bodies + suggested-next-moves rows.

- [ ] **Step 1: Add Status notes under §1 #4 and §1 #14**

In `docs/reviews/Match-ID-UI-UX-Review.md`, find the §1 #4 body — currently reads (approximately):

```markdown
**4. Archetype pill colors lack a legend.** PLY (lavender), SNP (red), PMD (blue), TWF, DFD, etc. Users will see colors change between rows and intuit meaning, but there's no key. Two options: tooltip on hover (cheap), or a tiny `?` icon in the section header that opens a one-row legend.
```

Append a Status paragraph beneath it:

```markdown
**4. Archetype pill colors lack a legend.** PLY (lavender), SNP (red), PMD (blue), TWF, DFD, etc. Users will see colors change between rows and intuit meaning, but there's no key. Two options: tooltip on hover (cheap), or a tiny `?` icon in the section header that opens a one-row legend.

**Status (2026-05-17): Resolved (tooltip variant)** — audit of `apps/web/src/components/ui/archetype-pill.tsx` confirms `ArchetypePillCompact` already passes `title={`${meta.category} · ${meta.descriptor}`}` on every pill, so hover surfaces "Forward · Vision · Distribution" etc. A persistent legend in the section header is a separate design decision.
```

Similarly for §1 #14:

```markdown
**14. `+/-` column header uses a hyphen-minus, not the en-dash used in card legends.** Cards use `+/−` (Unicode minus), table header uses `+/-`. Pick one across both surfaces.
```

Append:

```markdown
**14. `+/-` column header uses a hyphen-minus, not the en-dash used in card legends.** Cards use `+/−` (Unicode minus), table header uses `+/-`. Pick one across both surfaces.

**Status (2026-05-17): Resolved** — audit of `apps/web/src/components/matches/star-card.tsx:265` and `apps/web/src/components/matches/show-all-player-scores.tsx:63` confirms both surfaces now use Unicode minus U+2212. Fix landed between the review's writing and today.
```

- [ ] **Step 2: Strike the suggested-next-moves rows**

The §1 "Suggested next moves" table should have rows for #4 and #14. Strikethrough each with an inline Resolved note (same pattern used for Action Tracker #23 and Event Timeline §7 #8 earlier today):

Find:

```markdown
| 4 | Archetype-pill tooltip OR section-header `?` legend popover | 15–30 lines |
```

Replace with:

```markdown
| 4 | ~~Archetype-pill tooltip OR section-header `?` legend popover~~ — **Resolved 2026-05-17** (tooltip variant already present). | — |
```

Find:

```markdown
| 14 | `+/-` hyphen vs Unicode minus mismatch between cards and table | 1 line |
```

Replace with:

```markdown
| 14 | ~~`+/-` hyphen vs Unicode minus mismatch between cards and table~~ — **Resolved 2026-05-17** (both surfaces now Unicode minus). | — |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/Match-ID-UI-UX-Review.md
git commit -m "$(cat <<'EOF'
docs(reviews): mark Top Performers §1 #4 + #14 resolved

Pre-implementation audit of the Top Performers polish sweep found
two §1 items that no longer need code work:

- #4 (archetype pill legend) — ArchetypePillCompact already has a
  `title=` hover tooltip carrying "${category} · ${descriptor}"
  (e.g., "Forward · Vision · Distribution" for PLY). The UI
  review's "no key" framing was stale.

- #14 (`+/-` hyphen vs Unicode minus mismatch) — both card and
  table surfaces now use Unicode minus U+2212. Some commit between
  the review's writing and today silently fixed this.

Marked Resolved at both issue bodies + struck through the
suggested-next-moves rows. Same pattern as Action Tracker #23 and
Event Timeline §7 #8 earlier today.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (end-to-end, after all 5 commits)

1. **Typecheck:** `pnpm typecheck` — 0 errors.
2. **Format:** `pnpm format` — clean.
3. **Browser at `/games/250`** — Top Performers walkthrough:
   - **Cards row:** Rank 1 (`★★★ MrHomicide 14.28`) accent red glow; Rank 2 (`★★ SECOND_NAME N.NN`) off-white; Rank 3 (`★ SHADOWASSAULT20 9.06 — no season data`) off-white with italic placeholder where the season-delta would be.
   - **Show-All table** (expanded): rank-1 row strongly red-tinted, rank-2 medium red, rank-3 faint red, ranks 4+ plain.
4. **Curl sanity:**
   - `grep -c "no season data"` → ≥1 (when SHADOWASSAULT20 lacks vsSeasonAvg)
   - `grep -c "bg-accent/\[0\.06\]"` ≥1 (rank-1 row)
   - `grep -c "☆"` for top-performers HTML → 0 (off-stars dropped)
5. **Git log review:** `git log --oneline -5` — five commits, each scoped.

## Out of Scope (follow-ups)

- **UI review §1 #16 — mobile carousel for medal cards.** Substantive feature work (swipe-snap carousel component, responsive breakpoint logic, controls, a11y). Current mobile experience (three stacked cards) is acceptable; carousel is optimization, not fix. Deferred as separate design task.
- **Five untracked plan files** under `docs/superpowers/plans/` from prior sweeps — separate cleanup commit when convenient.
- **The remaining Top Performers minor items** flagged in the UI review (sub-text, mobile checks, etc.) — bundled into the section as polish that didn't make today's cut.
