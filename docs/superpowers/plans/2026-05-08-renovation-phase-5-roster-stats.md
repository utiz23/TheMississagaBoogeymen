# Phase 5: Roster List + Stats Restyle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the roster list (`/roster`) and stats (`/stats`) pages plus the four `apps/web/src/components/stats/*` table/visualization components and the shared `title-selector.tsx`/`stat-card.tsx` to use Phase 1 primitives + design-system voice. No IA changes — page structure, table columns, and section composition stay identical; only surfaces, typography, and result/source encoding change.

**Architecture:** Same pattern as Phases 3-4. Replace inline `border border-zinc-800 bg-surface` divs with `<Panel>`. Replace inline `<h2>`/`<h3>` section markup with `<SectionHeader>`. Wrap `<TeamShotMap>` in `<BroadcastPanel>` per the renovation spec ("Team shot map kept structurally; reframed in BroadcastPanel with SectionHeader"). All stats tables: UPPERCASE `font-condensed text-[10px] tracking-widest` column headers, `tabular-nums` on every numeric cell, hairline `divide-y divide-zinc-800/60` row dividers, hover to `bg-surface-raised`. Voice audit on every label.

**Tech Stack:** Next.js 15 App Router (server components for both pages; chemistry-tables and stats-table sub-components may use Client Components for interactive sort — verify in the read step). TypeScript strict, Tailwind CSS 4. Phase 1 primitives at `apps/web/src/components/ui/{panel,broadcast-panel,section-header,result-pill,stat-strip}.tsx`. No new dependencies.

**Working assumptions:**
- Current branch: `feat/design-system-renovation`. Phase 4 commits landed (HEAD ~ `4871484`).
- The renovation spec at `docs/superpowers/specs/2026-05-07-boogeymen-renovation-design.md` is authoritative for Phase 5 scope.
- Run all commands from the repo root: `/home/michal/projects/eanhl-team-website`.
- Bundle preview rejections (memory): `components-card-carousel.html`, `components-card-carousel-v2.html`, `components-player-card-v1.html`, `components-nav.html` are NOT canonical. Use `components-stats-table.html`, `components-shot-map.html`, `components-player-card.html` (no suffix) as references.
- Roster card surfaces (DepthChart cards) were already restyled in Phase 0 (jersey number, position pill, EA W/L splits). Phase 5 voice-only on those; no structural rework.

**Out of scope:**
- Restoring result-based card glows on ScoreCard + HeroCard (deferred per renovation spec § "Deferred Design Decisions" — Phase 6 / polish).
- Switching `<ResultPill>` `size="sm"` from letter glyphs to full words (deferred to Phase 6 / polish).
- Any new data queries / schema changes.
- Cross-cutting nav restyle and final voice grep audit — Phase 6.
- Goalie-side IA parity for any roster sections — separate plan.

---

## File Map

**Files modified:**

| Path | Scope | Approx LOC |
|---|---|---|
| `apps/web/src/components/title-selector.tsx` | Wrap `EmptyState` in `<Panel>`. Tighten TitleSelector + ModeFilter pill voice (font-condensed tracking-widest). Drop the rounded-sm corners on the segmented bars (per "no soft cards" rule). | 135 |
| `apps/web/src/components/ui/stat-card.tsx` | Already uses `.broadcast-panel` CSS class. Tighten label voice (font-condensed tracking-widest); replace `tabular` with `tabular-nums`. | 43 |
| `apps/web/src/components/stats/skater-stats-table.tsx` | Wrap in `<Panel>`; UPPERCASE column headers (font-condensed text-[10px] tracking-widest text-zinc-500); tabular-nums on numeric cells; hairline `divide-y divide-zinc-800/60` rows; hover surface-raised. | 345 |
| `apps/web/src/components/stats/goalie-stats-table.tsx` | Same treatment as SkaterStatsTable. | 322 |
| `apps/web/src/components/stats/chemistry-tables.tsx` | WithWithoutTable + BestPairsTable + ChemistrySection: each table wraps in `<Panel>`; UPPERCASE column headers; tabular-nums; hairline dividers; ChemistrySection's outer header uses `<SectionHeader>` with subtitle if present. | 334 |
| `apps/web/src/components/stats/team-shot-map.tsx` | Wrap interior in `<BroadcastPanel>` per renovation spec. Section heading uses `<SectionHeader>`. Mode tabs + legend voice tightened. No layout change to the shot map renderer itself. | 265 |
| `apps/web/src/components/roster/depth-chart.tsx` | Voice audit only — slot labels, line labels, "POSITION USAGE" labels. Cards already correct from Phase 0. | 301 |
| `apps/web/src/app/roster/page.tsx` | Page header → `tracking-widest`. Inline `<h2>` (line 430) → `<SectionHeader>`. Inline strips with `border border-zinc-800 bg-surface` (lines 530 + 631) → `<Panel>`. Replace any inline `EmptyState` reference with the now-Panel-backed shared one. | 704 |
| `apps/web/src/app/stats/page.tsx` | Page header → `tracking-widest`. All inline `<h2>`/`<h3>` section headings → `<SectionHeader>`. Wrap any inline `border border-zinc-800 bg-surface` with `<Panel>`. | 556 |

**Files unchanged:**
- All Phase 1 primitives.
- `apps/web/src/components/roster/profile-hero.tsx` and other roster profile components — Phase 3 work is final.
- All match components — Phase 4 work is final.
- `apps/web/src/components/home/*` — Phase 2 work is final.

---

## Task 1: Restyle `<TitleSelector>`, `<ModeFilter>`, `<EmptyState>` in title-selector.tsx

The shared title-mode selector lives in this file. Both `/roster` and `/stats` import from here.

**Files:**
- Modify: `apps/web/src/components/title-selector.tsx`

- [ ] **Step 1: Apply transformations**

Make these edits to `title-selector.tsx`:

1. Add `import { Panel } from '@/components/ui/panel'` at the top.

2. **TitleSelector outer wrapper** (around line 41): drop `rounded-sm`. Replace:
   ```tsx
   <div className="flex flex-wrap items-center divide-x divide-zinc-700 overflow-hidden rounded-sm border border-zinc-700">
   ```
   with:
   ```tsx
   <div className="flex flex-wrap items-center divide-x divide-zinc-700 overflow-hidden border border-zinc-700">
   ```

3. **TitleSelector pill voice** (around line 49): `tracking-wide` → `tracking-widest`. Replace:
   ```tsx
   'flex items-center gap-1.5 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wide transition-colors',
   ```
   with:
   ```tsx
   'flex items-center gap-1.5 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest transition-colors',
   ```

4. **ModeFilter outer wrapper** (around line 92): drop `rounded-sm`. Replace:
   ```tsx
   <div className="inline-flex items-center divide-x divide-zinc-800 overflow-hidden rounded-sm border border-zinc-800">
   ```
   with:
   ```tsx
   <div className="inline-flex items-center divide-x divide-zinc-800 overflow-hidden border border-zinc-800">
   ```

5. **ModeFilter pill voice** (around line 101): `tracking-wide` → `tracking-widest`. Replace:
   ```tsx
   'px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wide transition-colors',
   ```
   with:
   ```tsx
   'px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest transition-colors',
   ```

6. **EmptyState helper** (lines 115-121): Replace:
   ```tsx
   export function EmptyState({ message }: { message: string }) {
     return (
       <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
         <p className="max-w-xl px-6 text-center text-sm text-zinc-500">{message}</p>
       </div>
     )
   }
   ```
   with:
   ```tsx
   export function EmptyState({ message }: { message: string }) {
     return (
       <Panel className="flex min-h-[12rem] items-center justify-center">
         <p className="max-w-xl px-6 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
           {message}
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
git add apps/web/src/components/title-selector.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on title-selector

TitleSelector + ModeFilter segmented bars drop rounded-sm corners (per
design-system "no soft cards" rule); pill labels tighten to
tracking-widest. Shared EmptyState wraps in Panel; voice on the
message gets font-condensed UPPERCASE tracking-wider treatment.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on title-selector` is HEAD.

---

## Task 2: Tighten `<StatCard>` voice

**Files:**
- Modify: `apps/web/src/components/ui/stat-card.tsx`

- [ ] **Step 1: Replace the file**

Write the entire new contents to `apps/web/src/components/ui/stat-card.tsx`:

```tsx
interface StatCardProps {
  label: string
  value: string
  /** Small line below the value — e.g. "Win %" or "per game". */
  sublabel?: string
  /**
   * Applies a red left-accent border and red value color.
   * Use sparingly to highlight 1-2 key stats per section.
   */
  featured?: boolean
}

/**
 * Compact stat display card: label / large value / optional sublabel.
 *
 * Designed for 2–6-column grids. Reusable across /stats and / (home).
 * The `featured` flag applies the accent left-bar treatment borrowed from
 * the Broadcast Strip design direction.
 */
export function StatCard({ label, value, sublabel, featured = false }: StatCardProps) {
  return (
    <div
      className={[
        'broadcast-panel px-4 py-4',
        featured ? 'border-l-2 border-l-accent' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div
        className={[
          'mt-1 font-condensed text-2xl font-bold tabular-nums leading-none',
          featured ? 'text-accent' : 'text-zinc-100',
        ].join(' ')}
      >
        {value}
      </div>
      {sublabel !== undefined && (
        <div className="mt-1 font-condensed text-[11px] uppercase tracking-wider text-zinc-600">
          {sublabel}
        </div>
      )}
    </div>
  )
}
```

Key changes:
- Label: `text-xs tracking-wider` → `text-[10px] tracking-widest` (matches Phase 1 design-system spec).
- Value: `tabular` → `tabular-nums` (Tailwind utility instead of local CSS class).
- Sublabel: `text-xs text-zinc-600` → `font-condensed text-[11px] uppercase tracking-wider text-zinc-600`.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/stat-card.tsx
git commit -m "$(cat <<'EOF'
refactor(web): tighten StatCard voice to design-system spec

Label tightens to text-[10px] tracking-widest (matches Phase 1 stat-
label spec). Value swaps `tabular` local utility for `tabular-nums`
Tailwind utility. Sublabel gets font-condensed UPPERCASE tracking-wider
voice. The .broadcast-panel CSS class remains as the surface treatment.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): tighten StatCard voice ...` is HEAD.

---

## Task 3: Restyle `<SkaterStatsTable>`

**Files:**
- Modify: `apps/web/src/components/stats/skater-stats-table.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,150p' apps/web/src/components/stats/skater-stats-table.tsx
sed -n '150,345p' apps/web/src/components/stats/skater-stats-table.tsx
```

- [ ] **Step 2: Apply transformations**

1. Add `import { Panel } from '@/components/ui/panel'` near the top.

2. Replace the outer table wrapper. Find any `<div className="overflow-x-auto border border-zinc-800 bg-surface">` and replace with `<Panel className="overflow-x-auto">`. The closing `</div>` becomes `</Panel>`.

3. **Column headers (Th cells):** every `<th>` needs:
   ```
   font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500
   ```
   Replace any existing `text-xs ... tracking-wider text-zinc-600` patterns with the design-system spec above. Keep alignment classes (text-left / text-right / text-center) intact.

4. **Row hover state:** every `<tr>` body element gets `transition-colors hover:bg-surface-raised` (replace `hover:bg-zinc-800/30` if present).

5. **Body dividers:** the `<tbody>` element gets `divide-y divide-zinc-800/60` for hairline row dividers. Remove per-row `border-b border-zinc-800/60` if it duplicates the divide-y treatment.

6. **Numeric cells:** every `<td>` containing a number gets `tabular-nums` class. Replace any local `tabular` utility with `tabular-nums` Tailwind utility.

7. **Player name cell voice:** clickable name cells get `font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 group-hover:text-accent`.

8. **Empty state inside the component (if any):** wrap in `<Panel className="flex min-h-[8rem] items-center justify-center">` with a UPPERCASE wide-tracked message.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/stats/skater-stats-table.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on SkaterStatsTable

Outer table wraps in Panel with overflow-x-auto. Column headers become
font-condensed text-[10px] tracking-widest text-zinc-500. Body gets
divide-y divide-zinc-800/60 for hairline row dividers. Numeric cells
get tabular-nums (replacing local `tabular` utility). Player name cells
gain font-condensed UPPERCASE voice with accent hover.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on SkaterStatsTable` is HEAD.

---

## Task 4: Restyle `<GoalieStatsTable>` — same pattern as Task 3

**Files:**
- Modify: `apps/web/src/components/stats/goalie-stats-table.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,160p' apps/web/src/components/stats/goalie-stats-table.tsx
sed -n '160,322p' apps/web/src/components/stats/goalie-stats-table.tsx
```

- [ ] **Step 2: Apply transformations** — identical to Task 3:

1. Add `import { Panel } from '@/components/ui/panel'` at the top.
2. Outer table wrapper: `<div className="overflow-x-auto border border-zinc-800 bg-surface">` → `<Panel className="overflow-x-auto">`.
3. Column headers: `font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500`.
4. Row hover: `transition-colors hover:bg-surface-raised`.
5. Body dividers: `divide-y divide-zinc-800/60` on `<tbody>`; remove per-row borders if duplicated.
6. Numeric cells: `tabular-nums` (replacing `tabular`).
7. Player name voice: `font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 group-hover:text-accent`.
8. Empty state (if any): `<Panel className="flex min-h-[8rem] items-center justify-center">` with UPPERCASE message.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/stats/goalie-stats-table.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on GoalieStatsTable

Same treatment as SkaterStatsTable — Panel wrap, UPPERCASE column
headers (text-[10px] tracking-widest), hairline row dividers,
tabular-nums on numeric cells, font-condensed UPPERCASE on player
name cells. Structure unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on GoalieStatsTable` is HEAD.

---

## Task 5: Restyle `<ChemistryTables>` (WithWithout + BestPairs + ChemistrySection)

**Files:**
- Modify: `apps/web/src/components/stats/chemistry-tables.tsx`

This file exports three components: `WithWithoutTable`, `BestPairsTable`, and the wrapping `ChemistrySection`. Same Panel/voice pattern as Tasks 3-4 applied to all three.

- [ ] **Step 1: Read current file**

```bash
sed -n '1,170p' apps/web/src/components/stats/chemistry-tables.tsx
sed -n '170,334p' apps/web/src/components/stats/chemistry-tables.tsx
```

- [ ] **Step 2: Apply transformations**

1. Add imports: `Panel`, `SectionHeader`.

2. **`ChemistrySection`:** find the section heading element and replace with `<SectionHeader label="Chemistry" subtitle="..." />` (keep any existing subtitle text). If the section has a description block below the heading, leave it inline below SectionHeader.

3. **Each table (`WithWithoutTable`, `BestPairsTable`):** wrap in `<Panel className="overflow-x-auto">`; UPPERCASE column headers; tabular-nums on numbers; hairline divide-y dividers; row hover surface-raised.

4. **Empty states inside any of the three components:** `<Panel className="flex min-h-[8rem] items-center justify-center">` with UPPERCASE wide-tracked message.

5. Replace any local `tabular` utility with `tabular-nums`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/stats/chemistry-tables.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on ChemistryTables

ChemistrySection heading uses SectionHeader primitive. Each table
(WithWithout, BestPairs) wraps in Panel; UPPERCASE column headers
(text-[10px] tracking-widest); hairline divide-y dividers; tabular-nums
on numeric cells. Empty states wrap in Panel with UPPERCASE messages.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on ChemistryTables` is HEAD.

---

## Task 6: Restyle `<TeamShotMap>` — BroadcastPanel + SectionHeader

Per the renovation spec: "Team shot map kept structurally; reframed in BroadcastPanel with SectionHeader. No layout changes to the shot map itself."

**Files:**
- Modify: `apps/web/src/components/stats/team-shot-map.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,130p' apps/web/src/components/stats/team-shot-map.tsx
sed -n '130,265p' apps/web/src/components/stats/team-shot-map.tsx
```

- [ ] **Step 2: Apply transformations**

1. Add imports:
   ```tsx
   import { BroadcastPanel } from '@/components/ui/broadcast-panel'
   import { SectionHeader } from '@/components/ui/section-header'
   ```

2. **Section heading:** find the inline `<h2>` / `<h3>` heading and replace with `<SectionHeader label="Team Shot Map" subtitle="..." />`. Keep the existing subtitle string if present, or use a sensible one like `"NHL 26 · all-modes"` based on the source label.

3. **Outer wrapper:** find the existing `<section className="border border-zinc-800 bg-surface ...">` (or similar) and convert to:
   ```tsx
   <section className="space-y-3">
     <div className="flex items-center justify-between gap-3">
       <SectionHeader label="Team Shot Map" subtitle={sourceLabel} />
       {/* existing right-side mode tabs / controls if any */}
     </div>
     <BroadcastPanel className="p-4">
       {/* existing body */}
     </BroadcastPanel>
   </section>
   ```
   Adapt the surrounding structure to fit the existing component shape.

4. **Mode tabs / legend / labels** inside the body: tighten to font-condensed UPPERCASE wide-tracked.

5. The shot map renderer inside (the SVG) is voice-neutral — leave alone.

6. Replace any local `tabular` utility with `tabular-nums`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/stats/team-shot-map.tsx
git commit -m "$(cat <<'EOF'
refactor(web): wrap TeamShotMap in BroadcastPanel + SectionHeader

Per renovation spec — team shot map kept structurally, reframed in
BroadcastPanel with SectionHeader. Mode tabs and legend get font-
condensed UPPERCASE voice. Shot map renderer SVG is voice-neutral
and unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): wrap TeamShotMap in BroadcastPanel + SectionHeader` is HEAD.

---

## Task 7: Voice audit on `<DepthChart>`

The roster cards inside the depth chart were already restyled in Phase 0 (jersey number, position pill, EA W/L splits). Phase 5 is voice-only on the slot/line labels and the position-usage callout.

**Files:**
- Modify: `apps/web/src/components/roster/depth-chart.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,150p' apps/web/src/components/roster/depth-chart.tsx
sed -n '150,301p' apps/web/src/components/roster/depth-chart.tsx
```

- [ ] **Step 2: Apply transformations**

1. Find slot/line/position labels (e.g. "LINE 1", "LW", "C", "RW", "DEFENSE", "GOALIE", "POSITION USAGE"). Ensure they use `font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500` (or similar wide-tracked dim treatment). If any are at `tracking-wider` or `tracking-wide`, tighten to `tracking-widest` for top-level slot labels; keep `tracking-wider` for sublabels.

2. Numeric values (GP totals, win counts) replace `tabular` with `tabular-nums`.

3. The card surfaces themselves are already correct from Phase 0 — DO NOT change card structure or styling.

4. Section/strip headings inside the chart (e.g. "All Modes", "6s", "3s") get `font-condensed UPPERCASE tracking-widest`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/roster/depth-chart.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice audit on DepthChart slot + line labels

Slot / line / position-usage labels tighten to tracking-widest.
Numeric values switch from local `tabular` utility to tabular-nums.
Card surfaces are unchanged from Phase 0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice audit on DepthChart ...` is HEAD.

---

## Task 8: Polish `/roster/page.tsx`

The roster list page (704 lines). Page header voice; inline `<h2>` to `<SectionHeader>`; inline strip surfaces to `<Panel>`.

**Files:**
- Modify: `apps/web/src/app/roster/page.tsx`

- [ ] **Step 1: Read the relevant sections**

```bash
sed -n '420,440p' apps/web/src/app/roster/page.tsx
sed -n '525,540p' apps/web/src/app/roster/page.tsx
sed -n '625,640p' apps/web/src/app/roster/page.tsx
sed -n '690,704p' apps/web/src/app/roster/page.tsx
```

- [ ] **Step 2: Apply transformations**

1. Add imports near the top:
   ```tsx
   import { Panel } from '@/components/ui/panel'
   import { SectionHeader } from '@/components/ui/section-header'
   ```

2. **Page header (around line 697):** Replace the existing:
   ```tsx
   <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
   ```
   with:
   ```tsx
   <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
   ```

3. **Inline `<h2>` section heading (around line 430):** Replace:
   ```tsx
   <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
     {/* existing title text */}
   </h2>
   ```
   with `<SectionHeader label="..." />`. Read the surrounding code to extract the exact label text and any subtitle.

4. **Inline strips with `border border-zinc-800 bg-surface` (lines 530 + 631):** Replace:
   ```tsx
   <div className="flex flex-wrap divide-y divide-zinc-800 border border-zinc-800 bg-surface sm:flex-nowrap sm:divide-x sm:divide-y-0">
   ```
   with:
   ```tsx
   <Panel className="flex flex-wrap divide-y divide-zinc-800 sm:flex-nowrap sm:divide-x sm:divide-y-0">
   ```
   Closing `</div>` becomes `</Panel>`.

5. Tighten any other inline label/heading voice to design-system spec where it's currently looser.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/roster/page.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + primitives on roster list page

Page header tightens to tracking-widest. Inline <h2> section heading
swaps for SectionHeader primitive. Two inline `border border-zinc-800
bg-surface` strips swap to Panel. No structural change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + primitives on roster list page` is HEAD.

---

## Task 9: Polish `/stats/page.tsx`

The stats page (556 lines). Same pattern as Task 8.

**Files:**
- Modify: `apps/web/src/app/stats/page.tsx`

- [ ] **Step 1: Read the file**

```bash
sed -n '1,80p' apps/web/src/app/stats/page.tsx
sed -n '80,300p' apps/web/src/app/stats/page.tsx
sed -n '300,556p' apps/web/src/app/stats/page.tsx
```

- [ ] **Step 2: Apply transformations**

1. Add imports near the top:
   ```tsx
   import { Panel } from '@/components/ui/panel'
   import { SectionHeader } from '@/components/ui/section-header'
   ```

2. **Page header h1:** find the `<h1 className="font-condensed text-2xl font-semibold uppercase ...">` and ensure it has `tracking-widest`.

3. **Section headings (`<h2>` / `<h3>`):** every inline section heading element gets swapped for `<SectionHeader label="..." subtitle="..." />`. Common section labels: "Club Record", "Recent Matches", "Skater Stats", "Goalie Stats", "Chemistry", etc. — keep the existing label text and any subtitle.

4. **Inline `border border-zinc-800 bg-surface` divs:** swap to `<Panel>` preserving any layout classes.

5. **EmptyState references:** if the page imports `EmptyState` from `title-selector`, no further work needed (Task 1 already updated it to use Panel).

6. Tighten any pagination links or controls to font-condensed UPPERCASE wide-tracked.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/stats/page.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + primitives on stats page

Page header tightens to tracking-widest. Inline <h2>/<h3> section
headings swap for SectionHeader primitive (Club Record, Recent
Matches, Skater Stats, Goalie Stats, Chemistry). Inline strip
surfaces wrap in Panel. No structural change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + primitives on stats page` is HEAD.

---

## Task 10: Visual verification + targeted format + push

Phase 5 ends when both pages render correctly with the new primitives + voice, full repo typechecks clean, and the branch is pushed.

- [ ] **Step 1: Full-repo typecheck**

```bash
pnpm typecheck
```
Expected: 6 successful tasks across @eanhl/db, @eanhl/web, @eanhl/worker.

- [ ] **Step 2: Visual review (dev server is already running)**

Open in a browser:
- `http://localhost:<port>/_kitchen-sink` — confirm Phase 1 primitives still render correctly.
- `http://localhost:<port>/roster` — confirm:
  1. Page header "ROSTER" UPPERCASE wide-tracked.
  2. Title selector + mode filter pills tightened to tracking-widest, no rounded corners on the segmented bars.
  3. Depth chart cards unchanged from Phase 0 (jersey numbers, position pills, EA splits visible).
  4. Inline section labels via SectionHeader primitive.
  5. Stat strips wrap in Panel.
  6. EmptyState surfaces (if visible) wrap in Panel.
  7. Skater + Goalie stats tables (if rendered): UPPERCASE column headers, tabular-nums, hairline dividers.
- `http://localhost:<port>/stats` — confirm:
  1. Page header "STATS" UPPERCASE wide-tracked.
  2. All section headings via SectionHeader.
  3. Recent Matches uses MatchRow (already restyled in Phase 4).
  4. Skater + Goalie tables: UPPERCASE column headers, tabular-nums, hairline dividers, hover surface-raised.
  5. Chemistry section: SectionHeader; both inner tables in Panel; UPPERCASE headers.
  6. **TeamShotMap**: section header on top, body wrapped in BroadcastPanel (red ticker + soft glow visible).
  7. StatCard tiles: dim wide-tracked label, condensed-bold tabular value.

If anything renders broken, stop and surface to the user.

- [ ] **Step 3: Targeted format pass**

```bash
pnpm exec prettier --write \
  apps/web/src/components/title-selector.tsx \
  apps/web/src/components/ui/stat-card.tsx \
  apps/web/src/components/stats/skater-stats-table.tsx \
  apps/web/src/components/stats/goalie-stats-table.tsx \
  apps/web/src/components/stats/chemistry-tables.tsx \
  apps/web/src/components/stats/team-shot-map.tsx \
  apps/web/src/components/roster/depth-chart.tsx \
  apps/web/src/app/roster/page.tsx \
  apps/web/src/app/stats/page.tsx
git status --short
```

If any files are reformatted, stage and commit:

```bash
git add apps/web/src/components/title-selector.tsx \
        apps/web/src/components/ui/stat-card.tsx \
        apps/web/src/components/stats/*.tsx \
        apps/web/src/components/roster/depth-chart.tsx \
        apps/web/src/app/roster/page.tsx \
        apps/web/src/app/stats/page.tsx
git commit -m "$(cat <<'EOF'
style(web): prettier pass on phase 5 roster + stats work

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If nothing changed, skip this step.

- [ ] **Step 4: Stop dev server**

```bash
pkill -f "next-server" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1
pgrep -af "next-server|next dev" || echo "(stopped)"
```

- [ ] **Step 5: Push the branch**

```bash
git push origin feat/design-system-renovation
```
Expected: branch pushes cleanly.

- [ ] **Step 6: Final state check**

```bash
git status
git log --oneline main..HEAD | head -25
```
Expected: clean tree on `feat/design-system-renovation`; ~10-11 new commits ahead of `main` from Phase 5.

---

## Recovery if something goes wrong mid-plan

- **Typecheck fails after a component restyle:** revert via `git checkout HEAD -- <file>`, re-read carefully, apply more conservatively. Do NOT commit a broken state.
- **A stats table reveals it imports a Client Component utility (sort, filter):** preserve the `'use client'` directive at the top of the file. Restyle is voice-only; no change to interaction logic.
- **TeamShotMap's existing component shape doesn't fit BroadcastPanel cleanly (e.g. it has an absolutely-positioned legend that depends on the parent surface):** flag the gap. The minimum-viable BroadcastPanel wrap is acceptable; aggressive structural rework is out of scope.
- **Visual regression on Task 10 Step 2:** identify the responsible file, revert just that file's commit (`git revert <sha>`) or fix-forward with a `fix(web): ...` commit. Don't push until visuals are right.
- **`/roster/page.tsx` is 704 lines and hard to read in one pass:** read in chunks (Task 8 Step 1 already does this). Make focused per-area edits rather than full-file rewrites — the page is too big and has too much logic to safely rewrite wholesale.
