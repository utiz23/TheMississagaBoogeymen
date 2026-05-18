# Team Stats Polish Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five UI-review polish items off the Team Stats section in one focused sweep. Five commits: format the unitless `Possession` integer as `mm:ss` via the existing `timeRow` helper (the field is seconds, not touches); split the mixed-polarity DEFENSE group into Defense + Discipline; floor the bar denominator at 5 so tiny-count stats stop reading as "total domination"; thread the opp abbreviation so the side label reads `4L` instead of `OPP`; drop `rounded-full` from the bars to align with the page's sharp/squared aesthetic.

**Architecture:** Multi-commit sweep, one commit per fix. Most edits inside `apps/web/src/components/matches/team-stats.tsx` plus the `buildBoxScore` builder in `apps/web/src/lib/match-recap.ts` plus a prop-thread through `apps/web/src/app/games/[id]/page.tsx`. No new components, no schema changes.

**Tech Stack:** Next.js 15 App Router, Server Component (TeamStats has no `'use client'` since the section is purely presentational), Tailwind CSS 4 with CSS-var tokens. No new dependencies.

---

## Context

After today's two earlier Team Stats fixes (RATINGS placeholder removal in commit `2b428c9` + the `↓ BETTER` polarity indicator in commit `1a0242c`), five UI-review polish items remain — all single-file or single-builder-function changes that cluster naturally into a sweep:

| # | Item | UI review § | Type |
|---|---|---|---|
| 1 | `Possession 1471 vs 1162` has no unit — actually seconds, not touches | §3 #13 | Labeling |
| 2 | DEFENSE group mixes "more better" + "less better" stats | §3 #4 | Group structure |
| 3 | Sparse-value bar (1-vs-0 = full-width "domination") | §3 #5 | Visual signal |
| 4 | Side label `OPP` should use real abbreviation `4L` | §3 #6 | Consistency |
| 5 | `rounded-full` bars break sharp esports aesthetic | §3 #9 | Polish |

**Important data correction:** The UI review (and an earlier draft of this plan) framed the `possession` field as a "touches" counter. The DB schema is explicit at [packages/db/src/schema/player-match-stats.ts:75](packages/db/src/schema/player-match-stats.ts#L75): `/** Possession time in seconds. EA field: skpossession. */`. Match 250's `1471 vs 1162` = `24:31 vs 19:22`. This is total puck-time anywhere on the rink — distinct from `Time on Attack` (TOA), which is only offensive-zone seconds. Both metrics stay.

User decisions (2026-05-17):
- **Item 1:** swap the `row(...)` for the existing `timeRow(...)` helper that already formats seconds as `mm:ss` (same shape as Time on Attack below it). Label stays `Possession`.
- **Item 2:** Defense + Discipline two-way split (SHG stays in Defense, as a "killed AND scored" achievement)
- **Item 3:** floor denominator at 5 in `barWidth` — uniform scaling so sparse stats read as low magnitude

The intended outcome: Team Stats becomes the page's most semantically clean tabular comparison surface — labels carry units, groups carry consistent polarity, bars don't over-state sparse-data dominance, side labels match the page-wide team abbreviation convention, and the visual chrome matches the sharp squared aesthetic of every other surface that's already been polished today.

---

## File Map

| Touched in | File | Why |
|---|---|---|
| Task 1 | `apps/web/src/lib/match-recap.ts` | Swap `row('Possession', ...)` for `timeRow('Possession', ...)` so seconds render as `mm:ss` (line 699) |
| Task 2 | `apps/web/src/lib/match-recap.ts` | Split current `defenseRows` array into two arrays + push two groups in place of one (lines 705-716, 730) |
| Task 3 | `apps/web/src/components/matches/team-stats.tsx` | Change `Math.max(ours, theirs, 1)` → `Math.max(ours, theirs, 5)` in `barWidth` (line 102) |
| Task 4 | `apps/web/src/components/matches/team-stats.tsx` + `apps/web/src/app/games/[id]/page.tsx` | Add `opponentName` prop to TeamStats; derive `oppAbbrev` via `abbreviateTeamName`; render in place of "OPP" label (lines 5-7, 22-24); pass prop from page.tsx |
| Task 5 | `apps/web/src/components/matches/team-stats.tsx` | Remove `rounded-full` from bar containers + fills (lines 82, 84, 88, 90) |

Five commits. Tasks 1 + 2 both touch `match-recap.ts`; line-disjoint. Tasks 3, 4, 5 all touch `team-stats.tsx`; line-disjoint.

**Existing helpers to reuse (do not re-implement):**

- [`abbreviateTeamName(name: string): string`](apps/web/src/lib/format.ts#L128) — same helper used by Event Timeline, Action Tracker, Faceoff Map, Box Score, Scoresheet. `"4th Line"` → `"4L"`.
- `match.opponentName` is already in scope on the games page (used by every other section).

---

### Task 1: Format Possession as `mm:ss` via `timeRow` helper

**Files:**
- Modify: `apps/web/src/lib/match-recap.ts` (line 699 — inside `buildBoxScore` `possessionRows`)

- [ ] **Step 1: Swap `row(...)` for `timeRow(...)`**

In `match-recap.ts` at line 699, currently:

```ts
    row('Possession', bgmAgg.possession, oppAgg.possession),
```

Replace with:

```ts
    timeRow('Possession', bgmAgg.possession, oppAgg.possession),
```

The `timeRow` helper is already defined in the same file and used one line below for `Time on Attack` (line 700). It formats integer seconds as `mm:ss`. `bgmAgg.possession` and `oppAgg.possession` are integer seconds per the DB schema comment ("Possession time in seconds. EA field: skpossession"). For match 250: 1471 seconds → `24:31`; 1162 seconds → `19:22`.

The row stays inside the POSSESSION group. POSSESSION and TIME ON ATTACK are different metrics — POSSESSION is total puck-time anywhere on the rink; TOA is only offensive-zone seconds. Both belong.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. (`timeRow` already accepts `(label, secondsFor, secondsAgainst)` per its TOA call site one line below.)

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Team Stats → POSSESSION group → the row previously labeled `POSSESSION 1471 vs 1162` should now read `POSSESSION 24:31 vs 19:22`. TIME ON ATTACK row below it (`12:42 vs 6:11`) unchanged. The two rows now use the same `mm:ss` format, reading as the complementary metrics they are (total puck-time vs offensive-zone puck-time).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/lib/match-recap.ts
git commit -m "$(cat <<'EOF'
polish(matches/team-stats): format Possession as mm:ss (it's seconds, not touches)

The Possession row rendered as `1471 vs 1162` — a raw integer with
no unit. The original UI review framed it as a "touches" counter
but the DB schema is explicit: `Possession time in seconds. EA
field: skpossession`. So the row was actually `1471 seconds vs
1162 seconds`, just unformatted.

Swapped `row(...)` for the existing `timeRow(...)` helper that
formats integer seconds as mm:ss (already used one line below for
Time on Attack). Match 250 now renders `POSSESSION 24:31 vs 19:22`
instead of `POSSESSION 1471 vs 1162`.

POSSESSION and TIME ON ATTACK stay as distinct rows — Possession
is total puck-time anywhere on the rink; TOA is only offensive-
zone seconds. Both belong, and they now use the same mm:ss format
so the comparison is direct.

Resolves UI review §3 issue #13.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Split DEFENSE → Defense + Discipline

**Files:**
- Modify: `apps/web/src/lib/match-recap.ts` (lines 705-716 — `defenseRows` array; line 730 — group push)

- [ ] **Step 1: Split `defenseRows` into two arrays**

Currently lines 705-716 build one array with mixed polarity:

```ts
  const defenseRows: BoxScoreRow[] = [
    row('Hits', match.hitsFor, match.hitsAgainst),
    row('Blocked Shots', bgmAgg.blockedShots, oppAgg.blockedShots),
    row('Takeaways', bgmAgg.takeaways, oppAgg.takeaways),
    { ...row('Giveaways', bgmAgg.giveaways, oppAgg.giveaways), polarity: 'lower-better' as const },
    row('Interceptions', bgmAgg.interceptions, oppAgg.interceptions),
    {
      ...row('Penalties', match.penaltyMinutes ?? 0, match.penaltyMinutesAgainst ?? 0),
      polarity: 'lower-better' as const,
    },
    row('Short Handed Goals', bgmAgg.shGoals, oppAgg.shGoals),
  ].filter(nonEmptyRow)
```

Replace with two arrays — Defense (higher-better) keeping the SHG row; Discipline (lower-better) holding Giveaways + Penalties:

```ts
  const defenseRows: BoxScoreRow[] = [
    row('Hits', match.hitsFor, match.hitsAgainst),
    row('Blocked Shots', bgmAgg.blockedShots, oppAgg.blockedShots),
    row('Takeaways', bgmAgg.takeaways, oppAgg.takeaways),
    row('Interceptions', bgmAgg.interceptions, oppAgg.interceptions),
    row('Short Handed Goals', bgmAgg.shGoals, oppAgg.shGoals),
  ].filter(nonEmptyRow)

  const disciplineRows: BoxScoreRow[] = [
    { ...row('Giveaways', bgmAgg.giveaways, oppAgg.giveaways), polarity: 'lower-better' as const },
    {
      ...row('Penalties', match.penaltyMinutes ?? 0, match.penaltyMinutesAgainst ?? 0),
      polarity: 'lower-better' as const,
    },
  ].filter(nonEmptyRow)
```

- [ ] **Step 2: Push both groups in sequence (Defense then Discipline)**

Around line 730 currently:

```ts
  if (defenseRows.length > 0) groups.push({ title: 'Defense', rows: defenseRows })
  if (goalieRows.length > 0) groups.push({ title: 'Goalie', rows: goalieRows })
```

Insert the Discipline push between Defense and Goalie:

```ts
  if (defenseRows.length > 0) groups.push({ title: 'Defense', rows: defenseRows })
  if (disciplineRows.length > 0) groups.push({ title: 'Discipline', rows: disciplineRows })
  if (goalieRows.length > 0) groups.push({ title: 'Goalie', rows: goalieRows })
```

The Team Stats section will now render five groups: OFFENSE → POSSESSION → DEFENSE → DISCIPLINE → GOALIE. The `↓ BETTER` indicator from the earlier polarity-indicator commit (commit `1a0242c`) is preserved on the Discipline rows.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 4: Manual browser verification**

Navigate to `/games/250`. Team Stats should now show: OFFENSE / POSSESSION (with `TOUCHES`) / DEFENSE (Hits, Blocked Shots, Takeaways, Interceptions, Short Handed Goals — all higher-better) / DISCIPLINE (Giveaways, Penalties — both with `↓ BETTER` indicator) / GOALIE.

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/web/src/lib/match-recap.ts
git commit -m "$(cat <<'EOF'
fix(matches/team-stats): split mixed-polarity DEFENSE → Defense + Discipline

The DEFENSE group mixed "more is better" stats (Hits, Blocked Shots,
Takeaways, Interceptions, SHG) with "less is better" stats
(Giveaways, Penalties) under one group header. Even with the
`↓ BETTER` indicator landed earlier today (commit 1a0242c), the
mental switch was abrupt — readers had to re-orient mid-group.

Split into two adjacent groups: DEFENSE (more is better) and
DISCIPLINE (less is better). Short Handed Goals stays in Defense
as a "killed AND scored" achievement, not a discipline event. The
`↓ BETTER` polarity indicator continues to mark the Discipline
rows.

New group order: OFFENSE → POSSESSION → DEFENSE → DISCIPLINE → GOALIE.

Resolves UI review §3 issue #4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Floor `barWidth` denominator at 5

**Files:**
- Modify: `apps/web/src/components/matches/team-stats.tsx` (line 102 — inside `barWidth`)

- [ ] **Step 1: Change `Math.max(ours, theirs, 1)` → `Math.max(ours, theirs, 5)`**

The `barWidth` helper at lines 99-104 currently:

```ts
function barWidth(value: string | null, other: string | null): number {
  const ours = parseStat(value)
  const theirs = parseStat(other)
  const max = Math.max(ours, theirs, 1)
  return Math.max(0, Math.min(100, (ours / max) * 100))
}
```

Replace the denominator floor:

```ts
function barWidth(value: string | null, other: string | null): number {
  const ours = parseStat(value)
  const theirs = parseStat(other)
  // Floor the denominator at 5 so sparse stats (e.g. 1-vs-0 deflections)
  // don't render as "total domination" full-width bars. At low magnitudes
  // the bars stay visually small, matching the actual small absolute counts.
  const max = Math.max(ours, theirs, 5)
  return Math.max(0, Math.min(100, (ours / max) * 100))
}
```

Behavioral impact:
- `1-vs-0`: max=5, BGM bar 20%, OPP bar 0% (was 100%/0%) — looks like a small lead, matches reality
- `3-vs-2`: max=5, BGM bar 60%, OPP bar 40% (was 100%/67%) — proportions preserved
- `12-vs-8`: max=12, BGM bar 100%, OPP bar 67% (unchanged from before)
- `0-vs-0`: max=5, both bars 0% (unchanged from before)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Team Stats → look for rows with small counts:
- DEFLECTIONS 1 vs 0 (under OFFENSE): BGM bar should now be ~20% width instead of 100%. Reads as "we had one, they had none" — small magnitude.
- Any row with counts ≥ 5 on the higher side (Hits 14-vs-39, Giveaways 44-vs-38, etc.) should be unchanged.

Curl sanity (the bar widths are inline `style=` values, so we can spot-check the rendered HTML):

```bash
curl -s http://localhost:3000/games/250 | grep -oE 'width:[^"]*%' | sort -u | head -20
```

Expected: a wider variety of bar widths in the HTML (more values < 100% than before).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/team-stats.tsx
git commit -m "$(cat <<'EOF'
fix(matches/team-stats): floor barWidth denominator at 5 to dampen sparse-value bars

A `1-vs-0` count rendered as a full-width red bar on the BGM side
and zero-width on the OPP side — visually screaming "BGM dominated
this stat" when the absolute difference is just one event
(Deflections is the canonical case).

Floored the denominator in `barWidth` at 5 so sparse stats render
as low-magnitude bars (1-vs-0 → 20%/0% instead of 100%/0%). High-
count stats unaffected. Visualization now better matches the
absolute magnitude of the counts.

Resolves UI review §3 issue #5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Side label `OPP` → `4L` via opp abbreviation

**Files:**
- Modify: `apps/web/src/components/matches/team-stats.tsx` (lines 1-7, 22-24)
- Modify: `apps/web/src/app/games/[id]/page.tsx` (TeamStats call site — add `opponentName` prop)

- [ ] **Step 1: Extend `TeamStatsProps` + render real abbreviation**

`team-stats.tsx` currently (lines 1-7):

```tsx
import type { BoxScoreGroup, BoxScoreRow } from '@/lib/match-recap'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface TeamStatsProps {
  rows: BoxScoreGroup[]
}
```

Replace with (add `opponentName` prop + import `abbreviateTeamName`):

```tsx
import type { BoxScoreGroup, BoxScoreRow } from '@/lib/match-recap'
import { abbreviateTeamName } from '@/lib/format'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface TeamStatsProps {
  rows: BoxScoreGroup[]
  opponentName: string
}
```

And in the `TeamStats` function signature + side-label render (lines 9-25 currently):

```tsx
export function TeamStats({ rows }: TeamStatsProps) {
  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Team Stats" subtitle="Team totals and aggregate stats" />
      <Panel className="px-4 py-4">
        {/* Side labels */}
        <div className="mb-3 grid grid-cols-[5rem_1fr_5rem] items-center gap-3">
          <span className="text-right font-condensed text-xs font-bold uppercase tracking-widest text-accent">
            BGM
          </span>
          <span />
          <span className="text-left font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500">
            OPP
          </span>
        </div>
```

Replace with:

```tsx
export function TeamStats({ rows, opponentName }: TeamStatsProps) {
  if (rows.length === 0) return null

  const oppAbbrev = abbreviateTeamName(opponentName)

  return (
    <section className="space-y-3">
      <SectionHeader label="Team Stats" subtitle="Team totals and aggregate stats" />
      <Panel className="px-4 py-4">
        {/* Side labels */}
        <div className="mb-3 grid grid-cols-[5rem_1fr_5rem] items-center gap-3">
          <span className="text-right font-condensed text-xs font-bold uppercase tracking-widest text-accent">
            BGM
          </span>
          <span />
          <span className="text-left font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500">
            {oppAbbrev}
          </span>
        </div>
```

For match 250: opponentName = "4th Line" → `abbreviateTeamName` returns `"4L"` (same as every other section).

- [ ] **Step 2: Pass `opponentName` from `page.tsx`**

In `apps/web/src/app/games/[id]/page.tsx`, find the `<TeamStats>` call site. Currently:

```tsx
<TeamStats rows={boxScore} />
```

(Or similar — the JSX may have slight variations; search for `<TeamStats`.) Replace with:

```tsx
<TeamStats rows={boxScore} opponentName={match.opponentName} />
```

`match.opponentName` is already in scope (used by every other section that needs it).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. The new required prop on `TeamStatsProps` must be matched by the page.tsx call site.

- [ ] **Step 4: Manual browser verification**

Navigate to `/games/250`. Team Stats top side labels should now read `BGM | 4L` instead of `BGM | OPP`. Consistent with every other section on the page.

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/team-stats.tsx apps/web/src/app/games/[id]/page.tsx
git commit -m "$(cat <<'EOF'
polish(matches/team-stats): side label OPP → real opp abbreviation (4L)

The OPP side label was generic where every other section on the
page renders the actual opponent abbreviation (`4L` for match 250,
derived from "4th Line" via the canonical abbreviateTeamName
helper). Reader scrolling the page sees "4L" consistently in
Action Tracker, Faceoff Map, Box Score period table, Lineup
summary band, Event Timeline — except Team Stats said "OPP".

Added `opponentName` prop to TeamStats; derived oppAbbrev via the
shared lib/format.ts helper. Page.tsx passes `match.opponentName`
(already in scope).

Resolves UI review §3 issue #6.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Drop `rounded-full` bars

**Files:**
- Modify: `apps/web/src/components/matches/team-stats.tsx` (lines 82, 84, 88, 90 — bar containers + fills)

- [ ] **Step 1: Remove `rounded-full` from all four bar classes**

The `Row` component's bar markup (lines 81-94) currently:

```tsx
      <div className="grid grid-cols-2 gap-2">
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${barWidth(row.us, row.them).toString()}%` }}
          />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-zinc-500"
            style={{ width: `${barWidth(row.them, row.us).toString()}%` }}
          />
        </div>
      </div>
```

Drop `rounded-full` from each of the four `className` strings:

```tsx
      <div className="grid grid-cols-2 gap-2">
        <div className="h-1.5 overflow-hidden bg-zinc-800">
          <div
            className="h-full bg-accent"
            style={{ width: `${barWidth(row.us, row.them).toString()}%` }}
          />
        </div>
        <div className="h-1.5 overflow-hidden bg-zinc-800">
          <div
            className="h-full bg-zinc-500"
            style={{ width: `${barWidth(row.them, row.us).toString()}%` }}
          />
        </div>
      </div>
```

Squared corners match the page-wide sharp/aggressive esports aesthetic (per CLAUDE.md "Always-dark theme. Red accents, sharp/aggressive esports aesthetic"). Every other section's bars (Deserve to Win contributor bars, Action Tracker rink markers, etc.) use squared corners.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. (Tailwind class deletions only.)

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Team Stats bars should now have squared corners instead of pill-shaped rounded ends. Visual change is subtle but matches the rest of the page.

Curl sanity:

```bash
curl -s http://localhost:3000/games/250 | grep -c "h-1.5 overflow-hidden rounded-full"
```

Expected: `0` (the Team Stats bars were the only `h-1.5 + rounded-full` use; if other sections share the pattern they'd remain).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/team-stats.tsx
git commit -m "$(cat <<'EOF'
polish(matches/team-stats): drop rounded-full from bars — squared corners match page aesthetic

The Team Stats bars used `rounded-full` (pill-shaped ends), which
broke the page-wide sharp/aggressive esports aesthetic. Every other
bar/chip on the page (Deserve to Win contributor bars, Action
Tracker rink markers, score chips, etc.) uses squared corners per
the design direction in CLAUDE.md.

Dropped `rounded-full` from all four bar `className` strings
(container + fill, BGM + OPP). Bars now render as flat rectangles,
matching the rest of the section's visual chrome.

Resolves UI review §3 issue #9.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (end-to-end, after all 5 commits)

1. **Typecheck:** `pnpm typecheck` — 0 errors.
2. **Format:** `pnpm format` — clean.
3. **Browser at `/games/250`** — Team Stats walkthrough:
   - **Side labels:** `BGM` left, `4L` right (was `OPP`)
   - **Group structure:** OFFENSE / POSSESSION (with `TOUCHES` row) / DEFENSE (Hits, Blocked Shots, Takeaways, Interceptions, Short Handed Goals — all higher-better) / DISCIPLINE (Giveaways, Penalties — both with `↓ BETTER` indicator) / GOALIE
   - **Sparse-value bars:** DEFLECTIONS 1-vs-0 row now shows a ~20% BGM bar instead of 100%
   - **Bar shape:** squared corners (no pill ends)
4. **Curl sanity:**
   - `grep -c "TOUCHES"` ≥ 1; `grep -c "POSSESSION 1471"` → 0
   - `grep -c "Discipline"` ≥ 1
   - `grep -c "h-1.5 overflow-hidden rounded-full"` → 0
   - "OPP" no longer appears as a Team Stats side label (may still appear elsewhere)
5. **Git log review:** `git log --oneline -5` — five commits, each scoped.

## Out of Scope (follow-ups)

- **Token migration `text-zinc-*` → `text-fg-*`** (UI review §3 issue #8) — Team Stats still uses raw `zinc-*` tokens while the renovated components use CSS-var `fg-*`. Cosmetic; not blocking.
- **ARIA on bars** (UI review §3 issue #10) — `aria-label="BGM 4, opponent 3"` on bar wrappers. Could naturally bundle into a future a11y sweep.
- **Section subtitle "Team totals and aggregate stats" drop** (UI review §3 issue #11) — minor copy edit, deferred.
- **Mobile column shrink-to-content** (UI review §3 issue #12) — `5rem` outer columns oversized for tiny values on 390px. Low priority.
- **Four untracked plan files** under `docs/superpowers/plans/` from prior sweeps — separate cleanup commit.
