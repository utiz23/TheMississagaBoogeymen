# Phase 4: Games List + Detail Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the games list (`/games`) and games detail (`/games/[id]`) pages plus all their `apps/web/src/components/matches/*` components to use Phase 1 primitives (Panel, BroadcastPanel, SectionHeader, ResultPill) and the design-system voice. No IA changes — section order and component composition stay; only surfaces, typography, and result encoding change.

**Architecture:** Swap inline `ResultBadge` (legacy) and inline `ResultPill` helpers throughout the matches components for the design-system `<ResultPill>`. Replace hand-rolled `border + bg` divs with `<Panel>`. The games-list ScoreCard drops its result-based background tinting (per design-system "flat panels with hairline borders, never colored card fills") and uses a uniform Panel surface — result encoding lives only in the `<ResultPill>`. The games-detail HeroCard wraps in `<BroadcastPanel>` (matches the home page LATEST RESULT pattern). The Scoresheet's per-player tables get UPPERCASE column headers, tabular numerals, and hairline `divide-zinc-800/60` row dividers per the design-system spec.

**Tech Stack:** Next.js 15 App Router (server components for pages + most matches components; ScoresheetSection / TopPerformers may use Client Components if they have interactive state — verify in the read step). TypeScript strict, Tailwind CSS 4. Phase 1 primitives at `apps/web/src/components/ui/{panel,broadcast-panel,section-header,result-pill,stat-strip}.tsx`. No new dependencies.

**Working assumptions:**
- Current branch: `feat/design-system-renovation`. Phase 3 commits landed (HEAD ~ `95a0fe0`).
- The renovation spec at `docs/superpowers/specs/2026-05-07-boogeymen-renovation-design.md` is authoritative for Phase 4 scope.
- Run all commands from the repo root: `/home/michal/projects/eanhl-team-website`.
- Locked decisions from brainstorm 2026-05-07:
  - **Drop ScoreCard result-based card-background tinting.** Uniform Panel surface; ResultPill carries the result encoding.
  - **Phase 4 covers full detail page in one phase** (no 4a/4b split). Scoresheet's 410 lines done in this phase.
- Legacy `<ResultBadge>` at `apps/web/src/components/ui/result-badge.tsx` has TWO matches consumers: `match-row.tsx` and `hero-card.tsx`. Both get swapped in this phase. After Phase 4, `<ResultBadge>` will be unused — delete in the cleanup task at the end.

**Out of scope:**
- Any IA changes (section reorder, composition rebuild).
- Stats page (`/stats`) restyle — Phase 5.
- Roster list (`/roster`) restyle — Phase 5.
- Backend/data changes.
- The MatchRow component will be lightly restyled here (it's also consumed by Stats page in Phase 5; doing it here saves duplication).

---

## File Map

**Files modified:**

| Path | Scope | Approx LOC |
|---|---|---|
| `apps/web/src/components/matches/match-row.tsx` | Wrap in `<Panel hoverable>`; swap `<ResultBadge>` → `<ResultPill size="sm">`; voice. | 58 |
| `apps/web/src/components/matches/score-card.tsx` | Drop CARD_STYLES/TOP_BAR/RESULT_PILL_CONFIG inline configs. Use `<Panel hoverable>` + `<ResultPill size="sm">` from primitives. Keep accent top-bar (1px gradient) only when result is WIN. Voice on labels. | 268 → ~200 |
| `apps/web/src/components/matches/hero-card.tsx` | Wrap in `<BroadcastPanel>`. Drop CARD_BG/TOP_BAR inline configs (BroadcastPanel provides ticker + glow). Swap `<ResultBadge>` → `<ResultPill size="md">`. Voice on labels. | 173 |
| `apps/web/src/components/matches/top-performers.tsx` | Apply leaders-pattern voice; UPPERCASE labels; Panel for any inline `border bg-surface` wrappers. | 284 |
| `apps/web/src/components/matches/possession-edge.tsx` | Wrap in `<Panel>`; voice on labels; tabular-nums. | 200 |
| `apps/web/src/components/matches/team-stats.tsx` | Wrap in `<Panel>`; UPPERCASE column headers; tabular-nums on numeric cells; hairline dividers. | 101 |
| `apps/web/src/components/matches/goalie-spotlight.tsx` | `<SectionHeader>` for the section heading; wrap each goalie card in `<Panel>`; voice. | 107 |
| `apps/web/src/components/matches/scoresheet.tsx` | Two-team per-player tables: `<SectionHeader>` for the section heading; `<Panel>` wrapping each team's table; UPPERCASE column headers (font-condensed, text-[10px], tracking-widest); tabular-nums on every numeric cell; hairline dividers (`divide-zinc-800/60`); voice on team labels. | 410 |
| `apps/web/src/components/matches/context-footer.tsx` | Wrap in `<Panel>`; voice on prev/next labels; UPPERCASE. | 84 |
| `apps/web/src/app/games/page.tsx` | Page header voice; replace inline EmptyState with `<Panel>`; date-group section headers use `<SectionHeader>`; FormStrip uses `<ResultPill>` for the chips; PaginationNav voice. | 384 |
| `apps/web/src/app/games/[id]/page.tsx` | Back link voice; replace inline ErrorState + EmptyScoresheet with `<Panel>`. | 215 |

**Files deleted (after consumers migrated):**

| Path | Reason |
|---|---|
| `apps/web/src/components/ui/result-badge.tsx` | Legacy solid-red WIN badge. Both consumers (match-row, hero-card) migrate to design-system `<ResultPill>` in Tasks 1 + 4. Delete in the cleanup at Task 11. |

**Files unchanged:**
- `apps/web/src/components/matches/position-pill.tsx` — Phase 0 work; voice already correct.
- `apps/web/src/components/ui/{panel,broadcast-panel,section-header,result-pill,stat-strip}.tsx` — Phase 1 primitives.
- `apps/web/src/components/ui/opponent-crest.tsx` — voice-neutral image component.

---

## Task 1: Restyle `<MatchRow>` — Panel hoverable + ResultPill primitive

**Files:**
- Modify: `apps/web/src/components/matches/match-row.tsx`

- [ ] **Step 1: Replace the file**

Write the entire new contents to `apps/web/src/components/matches/match-row.tsx`:

```tsx
import Link from 'next/link'
import type { Match } from '@eanhl/db'
import { Panel } from '@/components/ui/panel'
import { ResultPill } from '@/components/ui/result-pill'
import { formatMatchDate, formatScore } from '@/lib/format'

interface MatchRowProps {
  match: Match
  /** Highlights the row with an accent left bar — use for the most recent game. */
  isMostRecent?: boolean
}

/**
 * A single match row for the game log.
 *
 * Layout uses a 1px-wide accent bar as the first flex child so the column
 * header (which uses the same structure) aligns naturally.
 *
 * Columns: [bar] [date 80px] [opponent flex-1] [result 40px] [score 56px] [sog 80px hidden-mobile]
 */
export function MatchRow({ match, isMostRecent = false }: MatchRowProps) {
  return (
    <Panel hoverable>
      <div className="flex items-stretch group">
        {/* Accent bar — 4px, accent color on most recent game only */}
        <div className={`w-1 shrink-0 ${isMostRecent ? 'bg-accent' : 'bg-transparent'}`} />

        {/* Row link — entire row is clickable */}
        <Link
          href={`/games/${match.id.toString()}`}
          className="flex flex-1 items-center gap-4 px-4 py-3"
        >
          {/* Date */}
          <span className="w-20 shrink-0 whitespace-nowrap font-condensed text-sm font-semibold uppercase tracking-wider tabular-nums text-zinc-500 group-hover:text-zinc-400">
            {formatMatchDate(match.playedAt)}
          </span>

          {/* Opponent — truncates on narrow screens */}
          <span className="flex-1 min-w-0 truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 group-hover:text-zinc-50">
            {match.opponentName}
          </span>

          {/* Result pill */}
          <div className="w-10 shrink-0 flex justify-start">
            <ResultPill result={match.result} size="sm" />
          </div>

          {/* Score */}
          <span className="w-14 shrink-0 text-right font-condensed text-sm font-bold tabular-nums text-zinc-100">
            {formatScore(match.scoreFor, match.scoreAgainst)}
          </span>

          {/* Shots for–against — hidden on mobile */}
          <span className="hidden sm:block w-20 shrink-0 whitespace-nowrap text-right font-condensed text-xs uppercase tracking-wider tabular-nums text-zinc-500">
            {match.shotsFor.toString()}–{match.shotsAgainst.toString()}
          </span>
        </Link>
      </div>
    </Panel>
  )
}
```

Key changes from the previous version:
- Wraps the row in `<Panel hoverable>` (sharp border, hover lift, no result-based tint).
- Replaces `<ResultBadge>` import + usage with `<ResultPill size="sm">`.
- Date / opponent / shots-strip get `font-condensed uppercase tracking-wider` voice.
- The `tabular` utility class is replaced with the standard `tabular-nums` Tailwind utility.
- `transition-colors` is dropped on the inner Link — Panel `hoverable` carries the transition.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/matches/match-row.tsx
git commit -m "$(cat <<'EOF'
refactor(web): restyle MatchRow with Panel + ResultPill primitives

Wraps the row in Panel hoverable (replaces hand-rolled border + hover
classes), swaps the legacy ResultBadge for ResultPill at size=sm, and
applies font-condensed uppercase voice to date / opponent / shots
labels. Stats page consumes this same component (Phase 5).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): restyle MatchRow ...` is HEAD.

---

## Task 2: Restyle `<ScoreCard>` — drop tinting, Panel hoverable, ResultPill

The games-list workhorse (rendered in a date-grouped grid). Currently encodes result via card background tinting (CARD_STYLES) — drop this per the design-system spec. Result encoding lives only in `<ResultPill>`.

**Files:**
- Modify: `apps/web/src/components/matches/score-card.tsx`

- [ ] **Step 1: Read the current file**

```bash
sed -n '1,80p' apps/web/src/components/matches/score-card.tsx
sed -n '80,180p' apps/web/src/components/matches/score-card.tsx
sed -n '180,268p' apps/web/src/components/matches/score-card.tsx
```

- [ ] **Step 2: Apply transformations**

Make these edits to `score-card.tsx`:

1. Add imports near the top:
   ```tsx
   import { Panel } from '@/components/ui/panel'
   import { ResultPill } from '@/components/ui/result-pill'
   ```

2. Delete the entire `CARD_STYLES` block (around lines 14-35) — the `Record<MatchResult, { bg: string; border: string; hoverBorder: string }>` config. No replacement needed; Panel handles the surface.

3. Delete the entire `RESULT_PILL_CONFIG` block (around lines 37-54) and the local `ResultPill` helper function (around lines 67-76). The design-system ResultPill replaces both.

4. Replace the outer `<Link>` element. Change:
   ```tsx
   <Link
     href={`/games/${match.id.toString()}`}
     className={`group block overflow-hidden border ${cardStyles.border} ${cardStyles.bg} transition-[border-color,transform] hover:-translate-y-0.5 ${cardStyles.hoverBorder}`}
   >
     <div className={`h-1 w-full ${topBarColor}`} />
     {/* ... rest of card body ... */}
   </Link>
   ```
   to:
   ```tsx
   <Link
     href={`/games/${match.id.toString()}`}
     className="group block transition-transform hover:-translate-y-0.5"
   >
     <Panel hoverable className="overflow-hidden">
       <div className="h-[3px] w-full bg-gradient-to-r from-rose-900 via-accent to-rose-900" />
       {/* ... rest of card body ... */}
     </Panel>
   </Link>
   ```
   - The `topBarColor` derivation (around line 78) is no longer needed — replace with the design-system gradient strip (matching BroadcastPanel's ticker style).
   - The `cardStyles` reference (around line 49) is dead — delete that line.

5. Replace any remaining inline `<ResultPill result={match.result} />` usage with `<ResultPill result={match.result} size="sm" />` (note the size="sm" variant from Phase 1 primitive).

6. Voice on inline labels — search for `text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600` and verify they're using the same pattern. SnapStat already does this; DtWStat already does this; SplitStat already does this. No changes needed unless the tracking deviates.

7. The score numbers retain their existing pattern (custom result-based color logic for emphasis on winner side stays — it's about score visual hierarchy, not card fill).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/matches/score-card.tsx
git commit -m "$(cat <<'EOF'
refactor(web): restyle ScoreCard — drop card tinting, use primitives

Per design-system spec, cards are flat panels with hairline borders;
result encoding lives only in ResultPill. Drops the CARD_STYLES and
TOP_BAR result-based bg/border configs. Card surface becomes a
uniform Panel hoverable. Top bar swaps to the design-system red
gradient ticker (matches BroadcastPanel pattern). Inline ResultPill
helper deleted in favour of the Phase 1 primitive at size=sm.

Score-color emphasis (winner brighter, loser dim) is preserved — that's
about reading hierarchy, not card-fill encoding.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): restyle ScoreCard ...` is HEAD.

---

## Task 3: Update games list page — voice, FormStrip, EmptyState, date headers

**Files:**
- Modify: `apps/web/src/app/games/page.tsx`

- [ ] **Step 1: Apply transformations**

Make these edits to `games/page.tsx`:

1. Add imports near the top:
   ```tsx
   import { Panel } from '@/components/ui/panel'
   import { SectionHeader } from '@/components/ui/section-header'
   import { ResultPill } from '@/components/ui/result-pill'
   ```

2. **Page header voice (around lines 99-107):** Tighten to `tracking-widest`. Replace:
   ```tsx
   <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
     Scores
   </h1>
   <span className="text-sm text-zinc-500">{gameTitle.name}</span>
   {total > 0 && <span className="text-sm text-zinc-600">{total} matches</span>}
   ```
   with:
   ```tsx
   <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
     Scores
   </h1>
   <span className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
     {gameTitle.name}
   </span>
   {total > 0 && (
     <span className="font-condensed text-sm uppercase tracking-wider tabular-nums text-zinc-600">
       <span className="tabular-nums">{total}</span> matches
     </span>
   )}
   ```

3. **Date-group section headers (around lines 124-130):** Replace:
   ```tsx
   <div className="flex items-center gap-3">
     <h2 className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
       {group.label}
     </h2>
     <div className="h-px flex-1 bg-zinc-800" />
   </div>
   ```
   with:
   ```tsx
   <div className="flex items-center gap-3">
     <SectionHeader label={group.label} as="h2" />
     <div className="h-px flex-1 bg-zinc-800" />
   </div>
   ```

4. **EmptyState helper (around lines 378-384):** Replace:
   ```tsx
   function EmptyState({ message }: { message: string }) {
     return (
       <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
         <p className="text-sm text-zinc-500">{message}</p>
       </div>
     )
   }
   ```
   with:
   ```tsx
   function EmptyState({ message }: { message: string }) {
     return (
       <Panel className="flex min-h-[12rem] items-center justify-center">
         <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
           {message}
         </p>
       </Panel>
     )
   }
   ```

5. **FormStrip (around lines 304-330):** Replace the inline letter-chip rendering with `<ResultPill size="sm">`. Replace:
   ```tsx
   <div className="flex items-center gap-0.5">
     {matches.map((m, i) => (
       <span
         key={i}
         className={`inline-flex w-7 items-center justify-center rounded border py-0.5 font-condensed text-[10px] font-bold uppercase tracking-wider ${FORM_PILL[m.result]}`}
       >
         {FORM_PILL_LABEL[m.result]}
       </span>
     ))}
   </div>
   ```
   with:
   ```tsx
   <div className="flex items-center gap-1">
     {matches.map((m, i) => (
       <ResultPill key={i} result={m.result} size="sm" />
     ))}
   </div>
   ```
   And delete the `FORM_PILL` and `FORM_PILL_LABEL` consts (around lines 290-302) — no longer needed.

6. **FormStrip header voice:** the `text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600` "Last N" label is acceptable; just verify it's there. The wins-losses-otl summary `text-sm font-bold tabular-nums text-zinc-400` already uses tabular — confirm.

7. **PaginationNav voice (around lines 251-283):** the existing `text-sm` / `text-zinc-400` voice is loose. Tighten the pagination links to font-condensed UPPERCASE wide-tracked:
   - Replace `text-zinc-400 transition-colors hover:text-zinc-200` with `font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-200`.
   - Replace `select-none text-zinc-700` with `select-none font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-700`.
   - Replace `text-zinc-600` (the page indicator) with `font-condensed text-xs font-semibold uppercase tracking-widest tabular-nums text-zinc-600`.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/games/page.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + primitives on games list page

Page header gets tracking-widest treatment. Date-group section
headers use SectionHeader primitive. EmptyState wraps in Panel.
FormStrip pips swap to ResultPill at size=sm (drops the local
FORM_PILL config). PaginationNav text gets font-condensed UPPERCASE
voice. No IA changes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + primitives on games list page` is HEAD.

---

## Task 4: Restyle `<HeroCard>` — BroadcastPanel + ResultPill

The games detail hero — wraps in BroadcastPanel (matches the home page's LATEST RESULT pattern). Drops result-based card-bg tinting.

**Files:**
- Modify: `apps/web/src/components/matches/hero-card.tsx`

- [ ] **Step 1: Read the current file**

```bash
sed -n '1,90p' apps/web/src/components/matches/hero-card.tsx
sed -n '90,173p' apps/web/src/components/matches/hero-card.tsx
```

- [ ] **Step 2: Apply transformations**

Make these edits to `hero-card.tsx`:

1. Replace the import for legacy ResultBadge:
   ```tsx
   // Before
   import { ResultBadge } from '@/components/ui/result-badge'

   // After
   import { ResultPill } from '@/components/ui/result-pill'
   import { BroadcastPanel } from '@/components/ui/broadcast-panel'
   ```

2. Delete the `CARD_BG` and `TOP_BAR` consts (around lines 21-34). BroadcastPanel provides the ticker + glow.

3. Replace the outer wrapper div. Change:
   ```tsx
   <div className={`overflow-hidden border border-zinc-800 ${CARD_BG[match.result]}`}>
     <div className={`h-1 w-full ${TOP_BAR[match.result]}`} />
     {/* ... body ... */}
   </div>
   ```
   to:
   ```tsx
   <BroadcastPanel className="overflow-hidden">
     {/* ... body (ticker is built into BroadcastPanel; drop the explicit h-1 div) ... */}
   </BroadcastPanel>
   ```

4. Replace any `<ResultBadge result={match.result} />` with `<ResultPill result={match.result} size="md" />`. (Hero is large; use the `md` pill variant with the full word like "WIN" / "OT LOSS".)

5. Voice tightening on inline meta strip (around line 75): the `font-condensed text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500` is on-spec. Verify; no edit needed unless tracking is wider somewhere.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/matches/hero-card.tsx
git commit -m "$(cat <<'EOF'
refactor(web): restyle HeroCard with BroadcastPanel + ResultPill

Wraps the games detail hero in BroadcastPanel (mirrors the home page
LATEST RESULT pattern). Drops the inline CARD_BG and TOP_BAR result-
based bg/ticker configs — BroadcastPanel provides both. Swaps the
legacy ResultBadge for ResultPill at size=md (full word, hero size).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): restyle HeroCard ...` is HEAD.

---

## Task 5: Restyle `<TopPerformers>` — leaders pattern voice

**Files:**
- Modify: `apps/web/src/components/matches/top-performers.tsx`

- [ ] **Step 1: Read the current file**

```bash
sed -n '1,150p' apps/web/src/components/matches/top-performers.tsx
sed -n '150,284p' apps/web/src/components/matches/top-performers.tsx
```

- [ ] **Step 2: Apply transformations**

Make these edits:

1. Add imports:
   ```tsx
   import { Panel } from '@/components/ui/panel'
   import { SectionHeader } from '@/components/ui/section-header'
   ```

2. Find any inline `<h2>` / `<h3>` section heading at the top of the rendered output. Replace with `<SectionHeader label="Top Performers" />` (or whatever the existing label is). Preserve subtitle/source line if present by passing as `subtitle` prop.

3. Find any wrapping `<div className="border border-zinc-800 bg-surface ...">` and replace with `<Panel className="...">` — preserving the additional padding/layout classes.

4. Voice on stat labels: `text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600` is acceptable; tighten to `tracking-[0.22em] text-zinc-500` if it's currently the dimmer/lower-contrast variant.

5. Numeric values: confirm `tabular-nums` on stats. Replace `tabular` (the local CSS class) with `tabular-nums` (Tailwind utility).

6. If the component uses inline result-rendering for performer cards, swap any inline pills for `<ResultPill>` from primitives (unlikely — TopPerformers usually shows performance stats not match results).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/matches/top-performers.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on TopPerformers

Section heading uses SectionHeader primitive. Performer cards wrap
in Panel. Stat labels tighten to tracking-[0.22em] dim-zinc-500;
numeric values switch from local .tabular utility to tabular-nums.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on TopPerformers` is HEAD.

---

## Task 6: Restyle `<PossessionEdgeBar>` + `<TeamStats>`

Two compact stat surfaces. Combined task.

**Files:**
- Modify: `apps/web/src/components/matches/possession-edge.tsx`
- Modify: `apps/web/src/components/matches/team-stats.tsx`

- [ ] **Step 1: Read both files**

```bash
sed -n '1,100p' apps/web/src/components/matches/possession-edge.tsx
sed -n '100,200p' apps/web/src/components/matches/possession-edge.tsx
sed -n '1,101p' apps/web/src/components/matches/team-stats.tsx
```

- [ ] **Step 2: Apply transformations**

For `possession-edge.tsx`:
1. Add `import { Panel } from '@/components/ui/panel'`.
2. Wrap the outer `border border-zinc-800 bg-surface` div in `<Panel>`.
3. UPPERCASE labels (verify; tighten tracking to widest if needed).
4. Replace any `tabular` utility with `tabular-nums`.

For `team-stats.tsx`:
1. Add `import { Panel } from '@/components/ui/panel'`.
2. If the team-stats component renders a table, wrap with `<Panel className="overflow-x-auto">`. If it renders inline label/value pairs, replace each row container with `<Panel className="...">`.
3. UPPERCASE column headers / labels (font-condensed text-[10px] tracking-widest text-zinc-500).
4. tabular-nums on all numeric cells.
5. Hairline dividers between rows: `divide-y divide-zinc-800/60` on the table body.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/matches/possession-edge.tsx apps/web/src/components/matches/team-stats.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on PossessionEdge + TeamStats

Both wrap in Panel; UPPERCASE wide-tracked labels; tabular-nums on
numeric cells. TeamStats body gets divide-y divide-zinc-800/60 for
hairline row dividers per design-system spec.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on PossessionEdge + TeamStats` is HEAD.

---

## Task 7: Restyle `<GoalieSpotlightSection>` + `<ContextFooter>`

Two more small surfaces — combined task.

**Files:**
- Modify: `apps/web/src/components/matches/goalie-spotlight.tsx`
- Modify: `apps/web/src/components/matches/context-footer.tsx`

- [ ] **Step 1: Read both files**

```bash
sed -n '1,107p' apps/web/src/components/matches/goalie-spotlight.tsx
sed -n '1,84p' apps/web/src/components/matches/context-footer.tsx
```

- [ ] **Step 2: Apply transformations**

For `goalie-spotlight.tsx`:
1. Add imports: `Panel`, `SectionHeader`.
2. Replace any inline `<h2>` / `<h3>` section heading with `<SectionHeader label="Goalie Spotlight" />` (preserve any subtitle as the `subtitle` prop).
3. Wrap each goalie card or the outer surface in `<Panel>`.
4. UPPERCASE labels, tabular-nums on numeric values, replace any `tabular` with `tabular-nums`.
5. If the component returns null when no goalies — preserve that behavior.

For `context-footer.tsx`:
1. Add `import { Panel } from '@/components/ui/panel'`.
2. Wrap the outer surface in `<Panel className="...">`.
3. UPPERCASE the prev/next labels: `font-condensed text-xs font-semibold uppercase tracking-wider`.
4. Replace any inline result-related rendering with the `<ResultPill>` primitive at size=sm.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/matches/goalie-spotlight.tsx apps/web/src/components/matches/context-footer.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on GoalieSpotlight + ContextFooter

GoalieSpotlight: SectionHeader primitive on the section heading; each
goalie card in Panel; tabular-nums on stats. ContextFooter: Panel
wrapper; UPPERCASE wide-tracked prev/next labels; ResultPill primitive
on any inline result rendering.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on GoalieSpotlight + ContextFooter` is HEAD.

---

## Task 8: Restyle `<ScoresheetSection>` — per-player tables (the big one)

The biggest matches component (410 lines). Two-team per-player tables. Per the design-system spec: UPPERCASE column headers (font-condensed, text-[10px], tracking-widest), tabular-nums on every numeric cell, hairline row dividers (`divide-zinc-800/60`).

**Files:**
- Modify: `apps/web/src/components/matches/scoresheet.tsx`

- [ ] **Step 1: Read the file**

```bash
sed -n '1,140p' apps/web/src/components/matches/scoresheet.tsx
sed -n '140,280p' apps/web/src/components/matches/scoresheet.tsx
sed -n '280,410p' apps/web/src/components/matches/scoresheet.tsx
```

- [ ] **Step 2: Apply transformations**

Make these edits to `scoresheet.tsx`:

1. Add imports:
   ```tsx
   import { Panel } from '@/components/ui/panel'
   import { SectionHeader } from '@/components/ui/section-header'
   ```

2. **Section header:** find the top-level section heading element and replace with `<SectionHeader label="Scoresheet" />` (preserve any subtitle).

3. **Team-side wrappers:** the component renders two team tables (BGM + opponent). Each team's table or container should wrap in `<Panel className="overflow-x-auto">`. If there's a per-team header (e.g. "Boogeymen", opponent name), keep it but apply font-condensed UPPERCASE wide-tracked voice.

4. **Column headers (skater + goalie tables):** every `<th>` cell needs:
   ```tsx
   className="px-2 py-2 text-left font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
   ```
   (or text-right for numeric columns). Replace any existing `text-xs ... tracking-wider text-zinc-600` patterns with the design-system spec above.

5. **Numeric body cells:** every `<td>` containing a number gets `tabular-nums` class. Search for any cell that renders `{row.points}`, `{row.goals}`, `{row.assists}`, `{row.shotsFor}`, etc., and ensure `tabular-nums` is in its className.

6. **Row dividers:** the `<tbody>` should have `divide-y divide-zinc-800/60` class for hairline dividers between rows.

7. **Hover state** on rows: `hover:bg-surface-raised` (not `hover:bg-zinc-800/30` or other variants). Each `<tr>` gets `transition-colors hover:bg-surface-raised`.

8. **Result column** (if scoresheet has per-player result rendering — unlikely but check): swap any inline result rendering for `<ResultPill size="sm">`.

9. Voice on player-name cells: `font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 group-hover:text-accent` for clickable name cells, dropping `text-sm font-medium` patterns if present.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
refactor(web): scoresheet table voice + hairline dividers

Per-team tables wrap in Panel with overflow-x-auto. Column headers
become font-condensed text-[10px] tracking-widest text-zinc-500.
Body rows get divide-y divide-zinc-800/60 for hairline dividers and
hover:bg-surface-raised. Numeric cells get tabular-nums. Player name
cells get font-condensed UPPERCASE voice for clickable navigation.
Section heading uses SectionHeader primitive. No structural change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): scoresheet table voice + hairline dividers` is HEAD.

---

## Task 9: Polish games detail page — back link + ErrorState + EmptyScoresheet

**Files:**
- Modify: `apps/web/src/app/games/[id]/page.tsx`

- [ ] **Step 1: Apply transformations**

Make these edits:

1. Add `import { Panel } from '@/components/ui/panel'`.

2. **Back link (around lines 112-117):** Replace:
   ```tsx
   <Link
     href="/games"
     className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
   >
     <span aria-hidden>←</span> Games
   </Link>
   ```
   with:
   ```tsx
   <Link
     href="/games"
     className="inline-flex items-center gap-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
   >
     <span aria-hidden>←</span> Games
   </Link>
   ```

3. **ErrorState helper (around lines 199-205):** Replace:
   ```tsx
   function ErrorState({ message }: { message: string }) {
     return (
       <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
         <p className="text-sm text-zinc-500">{message}</p>
       </div>
     )
   }
   ```
   with:
   ```tsx
   function ErrorState({ message }: { message: string }) {
     return (
       <Panel className="flex min-h-[12rem] items-center justify-center">
         <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
       </Panel>
     )
   }
   ```

4. **EmptyScoresheet helper (around lines 207-215):** Replace:
   ```tsx
   function EmptyScoresheet() {
     return (
       <section>
         <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
           <p className="text-sm text-zinc-500">No player stats recorded for this game.</p>
         </div>
       </section>
     )
   }
   ```
   with:
   ```tsx
   function EmptyScoresheet() {
     return (
       <Panel className="flex min-h-[6rem] items-center justify-center">
         <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
           No player stats recorded for this game.
         </p>
       </Panel>
     )
   }
   ```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/games/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on games detail page

Back link gets font-condensed UPPERCASE voice. ErrorState and
EmptyScoresheet helpers wrap in Panel; voice on the messages.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on games detail page` is HEAD.

---

## Task 10: Delete legacy `<ResultBadge>` (now unused)

After Tasks 1 + 4 + Phase 3 Task 6, no remaining consumers reference `<ResultBadge>`. Verify and delete.

**Files:**
- Delete: `apps/web/src/components/ui/result-badge.tsx`

- [ ] **Step 1: Confirm zero references**

```bash
grep -rln "ResultBadge\|result-badge" apps/web/src/ apps/web/src/app/ 2>&1
```
Expected: only `apps/web/src/components/ui/result-badge.tsx` itself (self-reference). If any consumer remains, STOP — find the missed migration and address before deleting.

- [ ] **Step 2: Delete + typecheck**

```bash
git rm apps/web/src/components/ui/result-badge.tsx
pnpm --filter web typecheck
```
Expected: typecheck passes (no consumers).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(web): delete legacy ResultBadge component

All consumers (player-game-log, match-row, hero-card) migrated to the
design-system ResultPill primitive in Phase 3 + Phase 4. The legacy
solid-red WIN badge had been duplicating ResultPill's job. Removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
git status --short
```
Expected: `chore(web): delete legacy ResultBadge component` is HEAD; working tree clean.

---

## Task 11: Visual verification + targeted format + push

Phase 4 ends when both games pages render correctly with the new primitives + voice, full repo typechecks clean, and the branch is pushed.

- [ ] **Step 1: Full-repo typecheck**

```bash
pnpm typecheck
```
Expected: 6 successful tasks.

- [ ] **Step 2: Start dev server**

```bash
pnpm --filter web dev
```
Wait for "Ready in" line.

- [ ] **Step 3: Walk the games pages**

Open in a browser:
- `http://localhost:<port>/_kitchen-sink` — verify Phase 1 primitives still render correctly (no regressions).
- `http://localhost:<port>/games` — confirm:
  1. Page header "SCORES" UPPERCASE wide-tracked.
  2. Mode filter (All/6s/3s) renders correctly.
  3. FormStrip uses small ResultPill chips (W/L/OT/—) with letter glyphs.
  4. Date-group section headers UPPERCASE.
  5. ScoreCard cards have UNIFORM dark surface (no result-based bg tinting); each card has the design-system red gradient ticker on top; ResultPill (small) inside.
  6. Pagination links UPPERCASE wide-tracked.
- `http://localhost:<port>/games/<some-id>` — confirm:
  1. Back link "← GAMES" UPPERCASE.
  2. HeroCard has red ticker top + soft red glow (BroadcastPanel decoration); ResultPill at size=md (full word like "WIN") in the score area.
  3. Top Performers section — leaders pattern; sharp panels.
  4. Possession Edge bar — Panel-wrapped; UPPERCASE labels.
  5. Team Stats — Panel-wrapped; UPPERCASE column headers; hairline dividers between rows.
  6. Goalie Spotlight (if data) — section header + Panel; UPPERCASE.
  7. Scoresheet — section header; both team tables in Panels; UPPERCASE column headers (font-condensed text-[10px] tracking-widest); tabular-nums on numbers; hairline `divide-y` dividers; rows hover to surface-raised.
  8. Context Footer — Panel-wrapped; UPPERCASE prev/next links.

If anything renders broken, stop and surface to the user.

- [ ] **Step 4: Targeted format pass**

```bash
pnpm exec prettier --write \
  apps/web/src/app/games/page.tsx \
  apps/web/src/app/games/\[id\]/page.tsx \
  apps/web/src/components/matches/match-row.tsx \
  apps/web/src/components/matches/score-card.tsx \
  apps/web/src/components/matches/hero-card.tsx \
  apps/web/src/components/matches/top-performers.tsx \
  apps/web/src/components/matches/possession-edge.tsx \
  apps/web/src/components/matches/team-stats.tsx \
  apps/web/src/components/matches/goalie-spotlight.tsx \
  apps/web/src/components/matches/scoresheet.tsx \
  apps/web/src/components/matches/context-footer.tsx
git status --short
```

If any files are reformatted, stage and commit:

```bash
git add apps/web/src/app/games/page.tsx \
        apps/web/src/app/games/\[id\]/page.tsx \
        apps/web/src/components/matches/*.tsx
git commit -m "$(cat <<'EOF'
style(web): prettier pass on phase 4 games work

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If nothing changed, skip this step.

- [ ] **Step 5: Stop dev server**

```bash
pkill -f "next-server" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1
pgrep -af "next-server|next dev" || echo "(stopped)"
```

- [ ] **Step 6: Push the branch**

```bash
git push origin feat/design-system-renovation
```
Expected: branch pushes cleanly.

- [ ] **Step 7: Final state check**

```bash
git status
git log --oneline main..HEAD | head -25
```
Expected: clean tree on `feat/design-system-renovation`; ~11-12 new commits ahead of `main` from Phase 4.

---

## Recovery if something goes wrong mid-plan

- **Typecheck fails after a component restyle:** revert the file via `git checkout HEAD -- <file>`, re-read the original, apply changes more carefully. Do NOT commit a broken state.
- **A consumer of `<ResultBadge>` is found in Task 10's grep:** stop. The missed consumer needs migration first (apply same pattern as the player-game-log migration in Phase 3). Only delete `result-badge.tsx` once grep returns the file itself only.
- **ScoreCard's color-based score emphasis logic gets in the way of the uniform Panel surface:** the score-color emphasis (winner brighter, loser dim) is preserved per Task 2 — that's separate from card-fill encoding. If it ends up looking wrong, the alternative is to use uniform `text-zinc-100` for both teams and let the ResultPill alone carry the emphasis. Surface to user before changing this if it doesn't look right.
- **Scoresheet (Task 8) reveals a refactor would be cleaner than in-place edits:** stop. The spec says "no structural rework." Bend back to in-place edits; flag the gap for a follow-up phase.
- **Visual regression on Task 11 Step 3:** identify the responsible file, revert just that file's commit (`git revert <sha>`) or fix-forward with a `fix(web): ...` commit. Don't push until visuals are right.
