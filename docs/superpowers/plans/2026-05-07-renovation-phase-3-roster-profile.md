# Phase 3: Roster Profile Reconciliation + Voice Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the existing roster profile page (`/roster/[id]`) and its 16 component files against the design-system spec — apply Phase 1 primitives (Panel, SectionHeader with new subtitle prop, ResultPill, StatStrip), do a global voice/casing audit (UPPERCASE labels, en-dash for splits, em-dash for missing data), tighten spacing, and clean up dead code (RecentFormStrip, local SectionHeading).

**Architecture:** No structural rework — the 2026-05-05 IA is preserved. Phase 3 is reconciliation only: extend SectionHeader with `subtitle?: string` (the 3rd-consumer trigger from the Phase 1 plan), then migrate consumers to use it, then sweep through every roster component to swap inline `border border-zinc-800 bg-surface` for `<Panel>`, swap the legacy `<ResultBadge>` for `<ResultPill size="sm">` in the game log, and tighten label typography. End state: zero local SectionHeading or SurfaceCard duplications; consistent design-system voice across every roster surface.

**Tech Stack:** Next.js 15 App Router (mostly server components, ClubStatsTabs + StatsRecordCard + TitleRecordsTable are Client Components), TypeScript strict, Tailwind CSS 4. No new dependencies. Phase 1 primitives at `apps/web/src/components/ui/{panel,broadcast-panel,section-header,result-pill,stat-strip}.tsx`.

**Working assumptions:**
- Current branch: `feat/design-system-renovation`. Phase 2 commits landed (HEAD ~ commit `fddeadb`).
- The renovation spec at `docs/superpowers/specs/2026-05-07-boogeymen-renovation-design.md` is authoritative for Phase 3 scope.
- Run all commands from the repo root: `/home/michal/projects/eanhl-team-website`.
- Locked decisions from brainstorm 2026-05-07:
  - **Extend SectionHeader** with optional `subtitle?: string` (Phase 1 primitive widening — 3 consumers trigger).
  - **Replace SurfaceCard pattern** with `<Panel>` everywhere — 7 files duplicate `border border-zinc-800 bg-surface`.
  - **Delete dead RecentFormStrip + section-heading.tsx** — RecentFormStrip is unused since Phase 0; section-heading becomes obsolete after migrations.
  - **Keep ResultPips colored squares** (in dead code anyway, removed via deletion) — letter glyphs don't fit at 2.5px sparkline density.

**Out of scope:**
- Goalie-side IA parity (deferred, separate plan).
- Any structural change to existing roster sections.
- Any backend/data changes.
- Rebuilding the existing legacy `<ResultBadge>` at `apps/web/src/components/ui/result-badge.tsx` — leave it for Phase 4 (games detail), where its other consumers live.
- Deleting / rewriting the kitchen-sink page (Phase 6).

---

## File Map

**Files modified — Phase 1 primitive widening:**

| Path | Change | Approx LOC delta |
|---|---|---|
| `apps/web/src/components/ui/section-header.tsx` | Add `subtitle?: string` prop. Renders below the label in a tighter dim type. | +6 |
| `apps/web/src/app/_kitchen-sink/page.tsx` | Add a SectionHeader-with-subtitle variant to the kitchen-sink page so the new prop is verifiable. | +4 |

**Files deleted:**

| Path | Reason |
|---|---|
| `apps/web/src/components/roster/recent-form-strip.tsx` | Dead code (not imported anywhere since Phase 0). |
| `apps/web/src/components/roster/section-heading.tsx` | Obsolete after migrations in Tasks 2-3 (3 consumers all switch to SectionHeader). |

**Files restyled:**

| Path | Scope |
|---|---|
| `apps/web/src/components/roster/contribution-section.tsx` | Swap SectionHeading → SectionHeader; swap SurfaceCard → Panel. |
| `apps/web/src/components/roster/trend-chart.tsx` | Swap SectionHeading → SectionHeader; swap SurfaceCard → Panel. |
| `apps/web/src/components/roster/profile-hero.tsx` | Voice audit (UPPERCASE labels, en-dash splits, em-dash for missing); swap any inline result-rendering for `<ResultPill>`; verify AKA placement; outer surface stays a `<section>` (broadcast-panel hero) but inline labels tightened. |
| `apps/web/src/components/roster/player-game-log-section.tsx` | Swap inline `border border-zinc-800 bg-surface` wrappers for `<Panel>`; replace `<ResultBadge>` import with `<ResultPill size="sm">`; UPPERCASE column headers; tabular-nums on numeric cells; voice on "showing N games" footer. |
| `apps/web/src/components/roster/career-seasons-table.tsx` | Wrap in `<Panel>`; UPPERCASE column headers; en-dash separators where applicable. |
| `apps/web/src/components/roster/stats-record-card.tsx` | Wrap tab-strip + content in `<Panel>` if appropriate; UPPERCASE tab labels (already done? verify). |
| `apps/web/src/components/roster/club-stats-tabs.tsx` | Wrap in `<Panel>`; UPPERCASE labels throughout; tabular-nums on stat cells. |
| `apps/web/src/components/roster/charts-visuals-section.tsx` | Section heading uses `<SectionHeader>`; child placeholders use `<Panel>`. |
| `apps/web/src/components/roster/coming-soon-card.tsx` | Wrap in `<Panel>`; UPPERCASE title; voice. |
| `apps/web/src/components/roster/shot-map.tsx` | Outer wrapper → `<Panel>`; section heading → `<SectionHeader>` with subtitle if applicable. |
| `apps/web/src/app/roster/[id]/page.tsx` | Replace inline `ErrorState` with `<Panel>`; restyle "← Roster" back link voice; replace the "no local match history yet" inline div with a `<Panel>`. |

**Files unchanged (reference only):**
- `apps/web/src/components/roster/depth-chart.tsx` (used by `/roster` list, not by profile page — out of scope, Phase 5)
- `apps/web/src/components/roster/position-donut.tsx` (Phase 0 already retuned)
- `apps/web/src/components/roster/shot-map-renderer.tsx` (internal renderer — voice-neutral)
- `apps/web/src/components/roster/shot-map-zones.ts` (data only)

---

## Task 1: Extend `<SectionHeader>` with optional subtitle

The Phase 1 primitive renders a UPPERCASE wide-tracked label and an optional CTA arrow. Roster has 3 consumers (contribution-section, trend-chart, recent-form-strip-being-deleted) that need a subtitle line below the label. This is the third-consumer trigger that the Phase 1 plan reserved for primitive widening.

**Files:**
- Modify: `apps/web/src/components/ui/section-header.tsx`
- Modify: `apps/web/src/app/_kitchen-sink/page.tsx`

- [ ] **Step 1: Update SectionHeader**

Replace the entire contents of `apps/web/src/components/ui/section-header.tsx` with:

```tsx
import Link from 'next/link'

interface SectionHeaderProps {
  /** The section label, rendered UPPERCASE. */
  label: string
  /**
   * Optional secondary line below the label. Use sparingly — for context that
   * belongs with the section label (e.g. "Last 15 skater appearances · most
   * recent first") rather than provenance (which goes in StatStrip).
   */
  subtitle?: string
  /** Optional right-side call-to-action with arrow. */
  cta?: {
    href: string
    label: string
  }
  /**
   * Heading level for accessibility. Defaults to h2.
   * Use h1 only on the page hero.
   */
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}

/**
 * Section header — the "LATEST RESULT", "SCORING LEADERS" rule that
 * runs above every page section. Uppercase wide-tracking label in
 * font-condensed, dim zinc-500 on the label, lifting to zinc-100 on
 * the optional CTA arrow. Optional subtitle renders below the label
 * in dimmer text for sections that need contextual sub-text.
 */
export function SectionHeader({
  label,
  subtitle,
  cta,
  as: Heading = 'h2',
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`flex items-baseline justify-between ${className}`}>
      <div className="flex flex-col gap-0.5">
        <Heading className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:text-sm">
          {label}
        </Heading>
        {subtitle ? (
          <p className="font-condensed text-[11px] uppercase tracking-wider text-zinc-600">
            {subtitle}
          </p>
        ) : null}
      </div>
      {cta ? (
        <Link
          href={cta.href}
          className="font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-100"
        >
          {cta.label} <span aria-hidden>→</span>
        </Link>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Add subtitle variant to kitchen-sink**

Edit `apps/web/src/app/_kitchen-sink/page.tsx` — find the SectionHeader section and add a third example:

```tsx
<SectionHeader label="Latest Result" />
<SectionHeader
  label="Scoring Leaders"
  cta={{ href: '/stats', label: 'All stats' }}
/>
<SectionHeader label="Page Title (h1)" as="h1" />
```

Add after the third one:

```tsx
<SectionHeader
  label="Recent Form"
  subtitle="Last 15 skater appearances · most recent first"
/>
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/section-header.tsx apps/web/src/app/_kitchen-sink/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): add optional subtitle to SectionHeader primitive

Roster has three consumers (contribution-section, trend-chart, and
the soon-to-be-deleted recent-form-strip) that need a secondary line
below the label. Triggers the Phase 1 plan's third-consumer rule for
primitive widening. Existing call-sites are unaffected (subtitle is
optional). Kitchen-sink page gets a fourth SectionHeader example to
verify the new variant.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add optional subtitle to SectionHeader ...` is HEAD.

---

## Task 2: Migrate `<ContributionSection>` to SectionHeader + Panel

Swap the local SectionHeading → SectionHeader (with subtitle), and replace the local `SurfaceCard` helper with `<Panel>`.

**Files:**
- Modify: `apps/web/src/components/roster/contribution-section.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,160p' apps/web/src/components/roster/contribution-section.tsx
```

- [ ] **Step 2: Apply transformations**

Make these specific edits in `contribution-section.tsx`:

1. Replace the import line `import { SectionHeading } from '@/components/roster/section-heading'` with:
   ```tsx
   import { SectionHeader } from '@/components/ui/section-header'
   import { Panel } from '@/components/ui/panel'
   ```

2. Replace `<SectionHeading title="Season Profile" subtitle={...} />` with:
   ```tsx
   <SectionHeader
     label="Season Profile"
     subtitle={`Normalized vs teammates in the same role · ${selectedRole === 'skater' ? 'skater' : 'goalie'} view`}
   />
   ```

3. Find the local `SurfaceCard` helper function (renders `<div className="border border-zinc-800 bg-surface p-4">`). Replace ALL `<SurfaceCard>` JSX usages with `<Panel className="p-4">` — preserve any other classes that were composed via the `className` prop. Then delete the `SurfaceCard` helper function entirely.

4. Find any `<SurfaceCard className="...">` calls and merge the className into the new Panel: e.g. `<SurfaceCard className="flex flex-col items-center justify-center gap-4 py-6">` becomes `<Panel className="flex flex-col items-center justify-center gap-4 py-6">` — drop the `p-4` since `py-6` is more specific. Audit each call and pick the right padding.

5. Find the EmptyPanel helper (rendering `<div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">`). Replace the outer div's classes with `<Panel className="flex min-h-[6rem] items-center justify-center">`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/roster/contribution-section.tsx
git commit -m "$(cat <<'EOF'
refactor(web): migrate ContributionSection to SectionHeader + Panel

Drops the local SectionHeading import in favour of the Phase 1
SectionHeader primitive (now with subtitle support). Removes the
local SurfaceCard helper — Panel does the same job. Drops the local
EmptyPanel helper for the same reason.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): migrate ContributionSection ...` is HEAD.

---

## Task 3: Migrate `<TrendChart>` to SectionHeader + Panel

Same pattern as Task 2.

**Files:**
- Modify: `apps/web/src/components/roster/trend-chart.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,120p' apps/web/src/components/roster/trend-chart.tsx
```

- [ ] **Step 2: Apply transformations**

Make these specific edits:

1. Replace `import { SectionHeading } from '@/components/roster/section-heading'` with:
   ```tsx
   import { SectionHeader } from '@/components/ui/section-header'
   import { Panel } from '@/components/ui/panel'
   ```

2. Replace `<SectionHeading title="..." subtitle={...} />` with `<SectionHeader label="..." subtitle={...} />`. Preserve the original title and subtitle strings as-is.

3. Find the local SurfaceCard helper at the bottom of the file. Replace JSX usages with `<Panel className="p-4">` and delete the helper.

4. Audit any inline `border border-zinc-800 bg-surface` divs in the chart rendering (axis labels, tooltips, etc.). Replace them with `<Panel>` only if they're meant as a card surface. If they're chrome around an SVG, leave the inline classes — Panel is for top-level card surfaces, not chart-internal frames.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/roster/trend-chart.tsx
git commit -m "$(cat <<'EOF'
refactor(web): migrate TrendChart to SectionHeader + Panel

Same pattern as ContributionSection — local SectionHeading swapped for
the Phase 1 primitive, local SurfaceCard helper removed in favour of
Panel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): migrate TrendChart ...` is HEAD.

---

## Task 4: Delete dead `RecentFormStrip` + obsolete `section-heading.tsx`

After Tasks 2-3, the local SectionHeading has zero callers (RecentFormStrip is dead code, not imported anywhere). Both files are safe to delete.

**Files:**
- Delete: `apps/web/src/components/roster/recent-form-strip.tsx`
- Delete: `apps/web/src/components/roster/section-heading.tsx`

- [ ] **Step 1: Confirm zero references**

```bash
grep -rln "RecentFormStrip\|recent-form-strip" apps/web/src/ apps/web/src/app/ 2>&1
grep -rln "SectionHeading\|section-heading" apps/web/src/ apps/web/src/app/ 2>&1
```
Expected:
- First grep: only `apps/web/src/components/roster/recent-form-strip.tsx` itself (self-reference). No `app/roster/[id]/page.tsx`, no other consumers.
- Second grep: only `apps/web/src/components/roster/section-heading.tsx` itself. No consumers in `contribution-section.tsx` or `trend-chart.tsx` (those got migrated in Tasks 2-3).

If either grep shows additional consumers, STOP — there's a missed migration. Investigate before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm apps/web/src/components/roster/recent-form-strip.tsx
git rm apps/web/src/components/roster/section-heading.tsx
git status --short | grep -E '^D '
```
Expected: 2 lines, both `D `.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (no consumers reference either file).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(web): delete dead RecentFormStrip and obsolete SectionHeading

RecentFormStrip has been unimported since Phase 0 (its data was folded
into ProfileHero's recent-form strip). SectionHeading became obsolete
when the last two consumers migrated to the now-subtitle-supporting
Phase 1 SectionHeader primitive in Tasks 2-3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
git status --short
```
Expected: `chore(web): delete dead RecentFormStrip ...` is HEAD; working tree clean.

---

## Task 5: Restyle `<ProfileHero>` — voice audit + Panel + AKA verify

The biggest restyle target — 450 lines, the visual centerpiece of the roster profile page. Phase 0 already added the AKA line; Phase 3 confirms it matches the spec, applies the design-system voice across labels, and swaps the outer hand-rolled `border border-zinc-800 bg-surface` wrapper for `<Panel>` (or `<BroadcastPanel>` if the section is intended to be a hero broadcast surface — verify against the design-system spec).

**Files:**
- Modify: `apps/web/src/components/roster/profile-hero.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,100p' apps/web/src/components/roster/profile-hero.tsx
sed -n '100,250p' apps/web/src/components/roster/profile-hero.tsx
sed -n '250,450p' apps/web/src/components/roster/profile-hero.tsx
```

- [ ] **Step 2: Apply transformations**

Make these specific edits in `profile-hero.tsx`:

1. Add imports at the top of the file (after existing imports):
   ```tsx
   import { Panel } from '@/components/ui/panel'
   ```
   Only add `BroadcastPanel` if Step 3 below decides to use it.

2. **Outer wrapper decision** (around line 111: `<section className="relative overflow-hidden border border-zinc-800 bg-surface">`):
   - The profile hero is a "hero" surface — the design-system spec says broadcast-panel decoration is for hero + leaders. So replace this outer `<section>` with a `<section>` containing a `<BroadcastPanel>`:
     ```tsx
     // Before:
     <section className="relative overflow-hidden border border-zinc-800 bg-surface">
       {/* ... */}
     </section>

     // After:
     <section>
       <BroadcastPanel className="overflow-hidden">
         {/* ... */}
       </BroadcastPanel>
     </section>
     ```
   - Add `import { BroadcastPanel } from '@/components/ui/broadcast-panel'` to the imports.

3. **AKA placement audit:** The AKA line was added in Phase 0 (commit `536f18a`). It should be a dim secondary line directly below the gamertag h1, using `font-condensed text-sm font-semibold uppercase tracking-widest text-zinc-500`. Confirm via Read; no edit needed if already correct.

4. **Voice audit — find sentence-case labels and convert to UPPERCASE wide-tracked.** Search the file for label-like strings (anything rendered as a small zinc-500/zinc-600 label). Common ones to upper-case if not already:
   - "this season" → "THIS SEASON"
   - "career totals" → "CAREER TOTALS"
   - "position" / "role" → "POSITION" / "ROLE"
   - Add `font-condensed uppercase tracking-widest` to the `<span>`/`<p>` wrapping these labels if missing.

5. **En-dash for splits:** Find any `formatRecord(...)` or score-like strings using a hyphen `-` between numbers. Verify they use en-dash `–` (already done by formatRecord helper most likely; confirm).

6. **Em-dash for missing data:** Find any spots that render `'—'` for null/missing data — these should already be correct per recent Phase 0 work; spot-check.

7. **Provenance tags:** If the hero has multiple stat strips (this-season, career), each should carry an "EA official" or "local · 6s" provenance tag. Use the design-system pattern: small `font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600` line with the accent red dot prefix `<span className="h-1.5 w-1.5 rounded-full bg-accent" />`. If the hero stat blocks aren't already using `<StatStrip>` from Phase 1, leaving them inline is acceptable — wrap each block's labels alongside the provenance row manually. Don't refactor the whole hero into StatStrip primitives in this phase (that's structural; out of scope).

8. **Tighten spacing:** Hero interior padding should be `px-8 py-10` per the design-system spec on hero panels. Confirm or adjust the relevant `<div className="px-...">`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/roster/profile-hero.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + primitives reconcile on ProfileHero

Wraps the hero surface in BroadcastPanel; tightens label voice
(UPPERCASE wide-tracked everywhere); confirms AKA placement matches
design-system spec; ensures en-dash for splits and em-dash for missing
data. Hero stat blocks keep their existing inline structure (StatStrip
refactor would be structural and is out of Phase 3 scope).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + primitives reconcile on ProfileHero` is HEAD.

---

## Task 6: Restyle `<PlayerGameLogSection>` — Panel + ResultPill swap

The game log section currently uses the legacy `<ResultBadge>` from `apps/web/src/components/ui/result-badge.tsx` (the solid red WIN badge — predates the design system). Swap to `<ResultPill size="sm">` and apply Panel + voice audit to the wrapping table.

**Files:**
- Modify: `apps/web/src/components/roster/player-game-log-section.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,100p' apps/web/src/components/roster/player-game-log-section.tsx
sed -n '100,273p' apps/web/src/components/roster/player-game-log-section.tsx
```

- [ ] **Step 2: Apply transformations**

1. Replace the import:
   ```tsx
   // Before
   import { ResultBadge } from '@/components/ui/result-badge'

   // After
   import { ResultPill } from '@/components/ui/result-pill'
   import { Panel } from '@/components/ui/panel'
   ```

2. Replace `<ResultBadge result={row.result} />` with `<ResultPill result={row.result} size="sm" />`. The ResultPill `size="sm"` is the 24px chip that fits dense rows.

3. Wrap each `<div className="flex min-h-[Nrem] ... border border-zinc-800 bg-surface">` empty-state / loading wrapper with `<Panel className="flex min-h-[Nrem] items-center justify-center ...">` — preserve the layout classes, drop `border border-zinc-800 bg-surface`.

4. Replace the table-wrapping `<div className="overflow-x-auto border border-zinc-800 bg-surface">` with `<Panel className="overflow-x-auto">`.

5. UPPERCASE the column headers if not already (`font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500`).

6. Confirm `tabular-nums` on numeric `<td>` cells (most likely already there; spot-check).

7. The "showing N games" / paginator footer voice: ensure UPPERCASE wide-tracked.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/roster/player-game-log-section.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + primitives reconcile on PlayerGameLogSection

Swaps the legacy ResultBadge (solid-red WIN style) for the design-
system ResultPill at size=sm. Wraps the table + empty-state surfaces
in Panel. UPPERCASE column headers and tabular-nums on numeric cells.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + primitives reconcile on PlayerGameLogSection` is HEAD.

---

## Task 7: Restyle `<CareerSeasonsTable>` + `<StatsRecordCard>` — Panel + voice

Two tightly related files: StatsRecordCard is the tabbed wrapper that hosts CareerSeasonsTable + the game log. Both get a light Panel + voice pass.

**Files:**
- Modify: `apps/web/src/components/roster/career-seasons-table.tsx`
- Modify: `apps/web/src/components/roster/stats-record-card.tsx`

- [ ] **Step 1: Read both files**

```bash
sed -n '1,222p' apps/web/src/components/roster/career-seasons-table.tsx
sed -n '1,57p' apps/web/src/components/roster/stats-record-card.tsx
```

- [ ] **Step 2: Apply transformations to career-seasons-table.tsx**

1. Add `import { Panel } from '@/components/ui/panel'` at the top.

2. Replace the empty-state `<div className="flex min-h-[8rem] items-center justify-center border border-zinc-800 bg-surface">` with `<Panel className="flex min-h-[8rem] items-center justify-center">`.

3. The header rows (`<tr className="border-b border-zinc-800 bg-surface-raised">`) — these are inside a table, leave them inline (Panel is a wrapper concept). But UPPERCASE wide-tracked the header cells: `font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500`.

4. Body rows (`<tr ... transition-colors hover:bg-surface-raised>`): no change needed unless any hand-rolled padding is off-spec.

5. Numeric cells: confirm `tabular-nums`.

- [ ] **Step 3: Apply transformations to stats-record-card.tsx**

1. Read the file. It's a thin tabbed wrapper around two children. Apply:
   - Wrap the tab strip + content in `<Panel>` if it currently uses inline `border border-zinc-800 bg-surface`.
   - Tab labels: UPPERCASE font-condensed wide-tracked.
   - If already structured via Phase 1 primitives, no edit needed.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/roster/career-seasons-table.tsx apps/web/src/components/roster/stats-record-card.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on career table + stats record card

Wraps empty-state and outer surfaces in Panel; UPPERCASE wide-tracked
column headers; tabular-nums on numeric cells. Stats-record-card tab
strip gets the same voice treatment.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on career table + stats record card` is HEAD.

---

## Task 8: Restyle `<ClubStatsTabs>` — Panel + voice

This is a Client Component (uses tab state). 257 lines. Multiple inner tables (Overview, Scoring, Playmaking, Defense, Faceoffs).

**Files:**
- Modify: `apps/web/src/components/roster/club-stats-tabs.tsx`

- [ ] **Step 1: Read current file**

```bash
sed -n '1,150p' apps/web/src/components/roster/club-stats-tabs.tsx
sed -n '150,257p' apps/web/src/components/roster/club-stats-tabs.tsx
```

- [ ] **Step 2: Apply transformations**

1. Add `import { Panel } from '@/components/ui/panel'` at the top.

2. Replace `<div className="border border-zinc-800 bg-surface px-3 py-2">` (around line 112) with `<Panel className="px-3 py-2">`.

3. Audit the tab nav strip — UPPERCASE the tab labels with font-condensed wide-tracked if not already.

4. Audit each inner table for column headers — UPPERCASE wide-tracked. Numeric cells `tabular-nums`.

5. Any inline section-style headings inside a tab body should use the new `<SectionHeader>` primitive if they apply (label + optional subtitle). Don't be aggressive — only swap where the existing heading clearly matches the SectionHeader pattern (uppercase + tracking + dim).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/roster/club-stats-tabs.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel reconcile on ClubStatsTabs

Wraps the tabs surface in Panel; UPPERCASE wide-tracked tab and column
labels; tabular-nums on stat cells throughout the 5 inner tables.
Structure (Overview / Scoring / Playmaking / Defense / Faceoffs) is
unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel reconcile on ClubStatsTabs` is HEAD.

---

## Task 9: Restyle small components — ChartsVisualsSection, ComingSoonCard, ShotMap section header, page.tsx polish

Catch-all task for the smaller surfaces. Each gets a Panel + SectionHeader + voice pass.

**Files:**
- Modify: `apps/web/src/components/roster/charts-visuals-section.tsx`
- Modify: `apps/web/src/components/roster/coming-soon-card.tsx`
- Modify: `apps/web/src/components/roster/shot-map.tsx`
- Modify: `apps/web/src/app/roster/[id]/page.tsx`

- [ ] **Step 1: Restyle charts-visuals-section.tsx**

```bash
sed -n '1,32p' apps/web/src/components/roster/charts-visuals-section.tsx
```

Apply:
1. Add `import { SectionHeader } from '@/components/ui/section-header'`.
2. Replace the inline `<h2 className="font-condensed text-2xl ...">Charts & Visuals</h2>` with `<SectionHeader label="Charts & Visuals" />`.

- [ ] **Step 2: Restyle coming-soon-card.tsx**

```bash
sed -n '1,33p' apps/web/src/components/roster/coming-soon-card.tsx
```

Apply:
1. Add `import { Panel } from '@/components/ui/panel'`.
2. Replace the outer `border border-zinc-800 bg-surface` div with `<Panel>`.
3. UPPERCASE the title + voice on the description (if it has any inline classes that disagree).

- [ ] **Step 3: Restyle shot-map.tsx outer wrapper + section header**

```bash
sed -n '1,50p' apps/web/src/components/roster/shot-map.tsx
```

Apply:
1. Add imports for `Panel` and `SectionHeader`.
2. Replace the outer `<section className="border border-zinc-800 bg-surface p-4">` (around line 23) with:
   ```tsx
   <section className="space-y-3">
     <SectionHeader label="Shot Map" />
     <Panel className="p-4">
       {/* existing body */}
     </Panel>
   </section>
   ```
   (Move any existing inline section heading inside the body up to the SectionHeader if there is one.)

- [ ] **Step 4: Polish page.tsx**

```bash
sed -n '130,233p' apps/web/src/app/roster/\[id\]/page.tsx
```

Apply:
1. Add `import { Panel } from '@/components/ui/panel'` to the imports.
2. Replace the local `ErrorState` helper's `<div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">` with `<Panel className="flex min-h-[12rem] items-center justify-center">`. The helper can stay as a function or be inlined — either works.
3. The "no local match history yet" alert at lines 152-160: replace the `rounded border border-zinc-700 bg-zinc-900` div with `<Panel>` and drop `rounded`.
4. The back-link at lines 135-140: tighten voice to design-system standard:
   ```tsx
   <Link
     href="/roster"
     className="inline-flex items-center gap-1.5 font-condensed text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
   >
     <span aria-hidden>←</span> Roster
   </Link>
   ```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/roster/charts-visuals-section.tsx \
        apps/web/src/components/roster/coming-soon-card.tsx \
        apps/web/src/components/roster/shot-map.tsx \
        apps/web/src/app/roster/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
refactor(web): voice + Panel sweep on remaining roster surfaces

ChartsVisualsSection, ComingSoonCard, ShotMap, and the roster profile
page get the design-system voice + Panel treatment. Back link, error
state, and "no local data" alert all switch to Panel + UPPERCASE
wide-tracked voice.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): voice + Panel sweep on remaining roster surfaces` is HEAD.

---

## Task 10: Visual verification + targeted format + push

Phase 3 ends when the roster profile renders correctly with the new voice + primitives, full repo typechecks clean, and the branch is pushed.

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

- [ ] **Step 3: Walk the roster profile + kitchen-sink**

Open in a browser:
- `http://localhost:<port>/_kitchen-sink` — confirm the new SectionHeader-with-subtitle variant renders correctly.
- `http://localhost:<port>/roster` — confirm the list still works (Phase 5 territory; should be unaffected).
- `http://localhost:<port>/roster/<some-skater-id>` — walk through every section:
  1. Back link "← ROSTER" UPPERCASE wide-tracked.
  2. Profile hero — broadcast-panel decoration (red ticker top + soft red glow), AKA line under gamertag, this-season + career stat strips visible.
  3. Stats Record card — tabbed UPPERCASE.
  4. Club Stats Tabs — UPPERCASE labels, tabular nums.
  5. Contribution donut — section heading shows label + subtitle.
  6. Shot Map — section header above; sharp panel surface.
  7. Charts & Visuals zone — section header above; trend chart on left, 3 coming-soon placeholders.
  8. Coming Soon cards use Panel.
- `http://localhost:<port>/roster/<some-goalie-id>` — confirm goalie path renders the "Goalie Club Stats" coming-soon placeholder (Phase 3 doesn't touch goalie-side IA).

If anything renders broken, stop and surface to the user.

- [ ] **Step 4: Targeted format pass**

```bash
pnpm exec prettier --write \
  apps/web/src/components/ui/section-header.tsx \
  apps/web/src/app/_kitchen-sink/page.tsx \
  apps/web/src/components/roster/contribution-section.tsx \
  apps/web/src/components/roster/trend-chart.tsx \
  apps/web/src/components/roster/profile-hero.tsx \
  apps/web/src/components/roster/player-game-log-section.tsx \
  apps/web/src/components/roster/career-seasons-table.tsx \
  apps/web/src/components/roster/stats-record-card.tsx \
  apps/web/src/components/roster/club-stats-tabs.tsx \
  apps/web/src/components/roster/charts-visuals-section.tsx \
  apps/web/src/components/roster/coming-soon-card.tsx \
  apps/web/src/components/roster/shot-map.tsx \
  apps/web/src/app/roster/\[id\]/page.tsx
git status --short
```

If any files are reformatted, stage and commit them as a single style commit:

```bash
git add apps/web/src/components/ui/section-header.tsx \
        apps/web/src/app/_kitchen-sink/page.tsx \
        apps/web/src/components/roster/*.tsx \
        apps/web/src/app/roster/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
style(web): prettier pass on phase 3 roster work

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
Expected: branch pushes cleanly to origin.

- [ ] **Step 7: Final state check**

```bash
git status
git log --oneline main..HEAD | head -25
```
Expected: clean tree on `feat/design-system-renovation`; ~10-11 new commits ahead of `main` from Phase 3.

---

## Recovery if something goes wrong mid-plan

- **Typecheck fails after a primitive widening (Task 1):** revert via `git checkout HEAD -- <file>` and re-apply more carefully. Do not commit a broken state. Existing SectionHeader consumers (Phase 2's home page) should continue working since the new prop is optional.
- **A SectionHeading consumer was missed before deletion (Task 4):** the typecheck will fail with "cannot find module 'section-heading'". Find the consumer via grep, migrate it to SectionHeader (Task 2 pattern), commit the migration, then retry deletion.
- **`<ResultBadge>` is still used elsewhere after Task 6's swap:** that's fine — leave the legacy component intact; it has consumers in `apps/web/src/components/matches/` (Phase 4 territory). Phase 3 only swaps the roster-side consumer.
- **Visual regression on the profile page (Task 10 Step 3):** identify the responsible file, revert just that file's commit (`git revert <sha>`) or fix-forward with a `fix(web): ...` commit. Don't push until visuals are right.
- **A stat-strip refactor in ProfileHero (Task 5) starts looking like a structural rebuild:** stop. The spec said "no structural rework expected." Bend back to inline; flag the gap to the user; address in a follow-up phase if needed.
