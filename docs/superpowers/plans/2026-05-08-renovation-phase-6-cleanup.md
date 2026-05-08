# Phase 6: Cross-cutting Cleanup + Deferred Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Final phase of the renovation. Tighten nav voice, run the voice/casing grep audit and fix any leftover sentence-case labels, remove the kitchen-sink dev page, and ship the two deferred design decisions from the renovation spec — restore result-based card glows on ScoreCard + HeroCard, and switch `<ResultPill>` `size="sm"` from letter glyphs to full-word labels everywhere.

**Architecture:** Add a small `<ResultGlow>` primitive (positioned absolute overlay that paints a result-themed radial gradient inside any sharp panel). ScoreCard + HeroCard wrap their existing Panel/BroadcastPanel structure with `<ResultGlow>` to restore the per-result tinting that Phase 4 dropped — sharp borders + design-system structure preserved, just the coloring layer added back. ResultPill `size="sm"` widens to fit full words ("WIN" / "LOSS" / "OT LOSS" / "DNF") at smaller text size; consumers stay unchanged. Nav voice tightened to `tracking-widest` matching the pattern landed in Phases 2-5. Voice grep audit catches anything missed across the renovation.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript strict, Tailwind CSS 4. Phase 1 primitives in `apps/web/src/components/ui/*`. No new dependencies.

**Working assumptions:**
- Current branch: `feat/design-system-renovation`. Phase 5 commits landed (HEAD ~ `33d34c9`).
- The renovation spec at `docs/superpowers/specs/2026-05-07-boogeymen-renovation-design.md` is authoritative; the deferred-decisions section is what Tasks 1-4 implement.
- Bundle preview rejections (memory): `components-card-carousel.html`, `components-card-carousel-v2.html`, `components-player-card-v1.html`, `components-nav.html` are NOT canonical references. Nav restyle is voice-only — keep current nav structure; do NOT follow `components-nav.html`.
- Run all commands from the repo root: `/home/michal/projects/eanhl-team-website`.
- **Git push environment quirk:** stale `GITHUB_TOKEN` env var blocks gh's stored credentials. Prefix push commands with `env -u GITHUB_TOKEN ...` until the env var is removed from the user's shell rc.

**Out of scope:**
- Goalie-side IA parity for any roster sections — separate plan.
- Any new data queries / schema changes.
- Any structural rebuild of nav, footer, or layout — voice-only on nav.
- Storybook / automated visual regression infrastructure.

---

## File Map

**Files created:**

| Path | Responsibility | Approx LOC |
|---|---|---|
| `apps/web/src/components/ui/result-glow.tsx` | `<ResultGlow result intensity?>` — positioned absolute overlay with result-themed radial gradient. Composes inside any sharp Panel/BroadcastPanel. | 35 |

**Files modified:**

| Path | Scope |
|---|---|
| `apps/web/src/components/ui/result-pill.tsx` | `size="sm"` switches from `style.glyph` to `style.label`; sm size variant widens to fit full words at slightly smaller text. |
| `apps/web/src/lib/result-colors.ts` | The `glyph` field in `ResultStyle` becomes unused after the ResultPill update. Either drop the field or keep it for future use — drop, since YAGNI. |
| `apps/web/src/components/matches/score-card.tsx` | Wrap card body in `<ResultGlow result={match.result}>` overlay; preserve Panel structure. |
| `apps/web/src/components/matches/hero-card.tsx` | Wrap BroadcastPanel body in `<ResultGlow result={match.result}>` overlay; preserve BroadcastPanel structure. |
| `apps/web/src/components/nav/nav-links.tsx` | Bump `tracking-[0.15em]` (desktop) and `tracking-wider` (mobile) → `tracking-widest`. |
| `apps/web/src/components/nav/game-title-switcher.tsx` | Drop `rounded-sm` on outer wrapper + single-title chip; bump `tracking-wide` → `tracking-widest`. |
| `apps/web/src/components/nav/top-nav.tsx` | Bump `tracking-[0.15em]` (brand wordmark + desktop fallback) + `tracking-wider` (mobile fallback) → `tracking-widest`. |

**Files deleted:**

| Path | Reason |
|---|---|
| `apps/web/src/app/_kitchen-sink/page.tsx` (and the `_kitchen-sink/` directory) | Phase 1 visual-verification harness; not part of production. Removed at end of renovation per the renovation spec. |

**Files unchanged:**
- All Phase 1 primitives except `result-pill.tsx` and `result-colors.ts`.
- All Phase 2-5 component restyles are final.
- Renovation spec — its "Deferred Design Decisions" section was the input to this phase; once delivered, the items can stay in the doc as historical record.

---

## Task 1: Add `<ResultGlow>` primitive

The decoration overlay that restores result-based color tinting on ScoreCard + HeroCard without compromising the design-system "sharp panels" rule.

**Files:**
- Create: `apps/web/src/components/ui/result-glow.tsx`

- [ ] **Step 1: Create the component**

Write to `apps/web/src/components/ui/result-glow.tsx`:

```tsx
import type { MatchResult } from '@eanhl/db'

interface ResultGlowProps {
  result: MatchResult
  /**
   * Glow intensity. `default` = visible result tinting on cards. `soft` = dimmer
   * tinting for nested or supporting placements.
   */
  intensity?: 'default' | 'soft'
}

const GLOW_DEFAULT: Record<MatchResult, string> = {
  WIN: 'bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.10),transparent_50%)]',
  LOSS: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.07),transparent_50%)]',
  OTL: 'bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.10),transparent_45%)]',
  DNF: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.05),transparent_50%)]',
}

const GLOW_SOFT: Record<MatchResult, string> = {
  WIN: 'bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.06),transparent_55%)]',
  LOSS: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.04),transparent_55%)]',
  OTL: 'bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.06),transparent_50%)]',
  DNF: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.03),transparent_55%)]',
}

/**
 * Result-themed radial-gradient overlay. Place INSIDE a sharp Panel or
 * BroadcastPanel as the first child; subsequent children should sit on a
 * `<div className="relative">` wrapper to render above the glow.
 *
 * Mirrors the per-result tinting (emerald / rose / amber / dim-rose) that
 * Phase 4 dropped to make cards uniform. Restored as an opt-in coloring
 * layer per the renovation spec's deferred-decisions section, without
 * breaking the design-system "sharp panels, no soft cards" rule (the
 * panel border + radius is still the hosting Panel's responsibility).
 */
export function ResultGlow({ result, intensity = 'default' }: ResultGlowProps) {
  const tint = intensity === 'soft' ? GLOW_SOFT[result] : GLOW_DEFAULT[result]
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${tint}`}
    />
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/result-glow.tsx
git commit -m "$(cat <<'EOF'
feat(web): add ResultGlow primitive — result-themed radial overlay

Positioned absolute overlay that paints a per-result radial gradient
(emerald/rose/amber/dim-rose) inside any sharp Panel or BroadcastPanel.
Restores the per-result card tinting that Phase 4 dropped, without
breaking the design-system "sharp panels, no soft cards" rule — the
hosting panel keeps its hairline border + zero rounding; ResultGlow
adds only the coloring layer.

Two intensities: default (visible card tinting) and soft (dimmer for
supporting placements). ScoreCard + HeroCard consume this in the
following tasks.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add ResultGlow primitive ...` is HEAD.

---

## Task 2: Restore glow on `<ScoreCard>`

Wrap the card body in `<ResultGlow>` overlay so the games-list cards regain per-result tinting.

**Files:**
- Modify: `apps/web/src/components/matches/score-card.tsx`

- [ ] **Step 1: Apply transformations**

1. Add the import near the top:
   ```tsx
   import { ResultGlow } from '@/components/ui/result-glow'
   ```

2. Find the existing `<Panel hoverable className="overflow-hidden">` block (around line 118). Inside the Panel, immediately before the existing top-bar gradient div, insert the ResultGlow + a relative wrapper for content. Replace:
   ```tsx
   <Panel hoverable className="overflow-hidden">
     <div className="h-[3px] w-full bg-gradient-to-r from-rose-900 via-accent to-rose-900" />

     <div className="flex items-center justify-between px-4 py-3">
       {/* ... game-mode pill row ... */}
     </div>
     <div className="px-4 pb-5">
       {/* ... main card body ... */}
     </div>
   </Panel>
   ```
   with:
   ```tsx
   <Panel hoverable className="relative overflow-hidden">
     <ResultGlow result={match.result} />
     <div className="relative">
       <div className="h-[3px] w-full bg-gradient-to-r from-rose-900 via-accent to-rose-900" />

       <div className="flex items-center justify-between px-4 py-3">
         {/* ... game-mode pill row ... */}
       </div>
       <div className="px-4 pb-5">
         {/* ... main card body ... */}
       </div>
     </div>
   </Panel>
   ```
   The key changes: `relative` added to Panel className; `<ResultGlow>` is the first child; existing content moves inside a `<div className="relative">` wrapper so it sits above the glow.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/matches/score-card.tsx
git commit -m "$(cat <<'EOF'
feat(web): restore result-based glow on ScoreCard

Wraps card body in ResultGlow overlay (Phase 6 deferred-decisions
restoration). Each game card regains the emerald/rose/amber/dim-rose
result tinting that Phase 4 dropped. Sharp borders + design-system
structure preserved; only the coloring layer is added back.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): restore result-based glow on ScoreCard` is HEAD.

---

## Task 3: Restore glow on `<HeroCard>`

Same pattern — ResultGlow inside the existing BroadcastPanel.

**Files:**
- Modify: `apps/web/src/components/matches/hero-card.tsx`

- [ ] **Step 1: Apply transformations**

1. Add the import near the top:
   ```tsx
   import { ResultGlow } from '@/components/ui/result-glow'
   ```

2. Find the `<BroadcastPanel className="overflow-hidden">` block. Replace:
   ```tsx
   <BroadcastPanel className="overflow-hidden">
     <div className="px-4 py-6 sm:px-8 sm:py-8">
       {/* ... hero body ... */}
     </div>
   </BroadcastPanel>
   ```
   with:
   ```tsx
   <BroadcastPanel className="relative overflow-hidden">
     <ResultGlow result={match.result} intensity="soft" />
     <div className="relative px-4 py-6 sm:px-8 sm:py-8">
       {/* ... hero body ... */}
     </div>
   </BroadcastPanel>
   ```
   `intensity="soft"` because BroadcastPanel already provides a base red radial — the result-themed glow layers on top at a dimmer intensity to avoid washing out.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/matches/hero-card.tsx
git commit -m "$(cat <<'EOF'
feat(web): restore result-based glow on HeroCard

Wraps the games-detail hero body in ResultGlow overlay at intensity=
soft (BroadcastPanel already provides a base red radial; result tint
layers at lower intensity to avoid washing out). Sharp borders and
ticker preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): restore result-based glow on HeroCard` is HEAD.

---

## Task 4: Switch `<ResultPill>` `size="sm"` to full-word labels

The renovation spec's deferred-decisions section calls for full words ("WIN" / "LOSS" / "OT LOSS" / "DNF") on every ResultPill, not just `size="md"`. Update the primitive; consumers stay unchanged.

**Files:**
- Modify: `apps/web/src/components/ui/result-pill.tsx`
- Modify: `apps/web/src/lib/result-colors.ts`

- [ ] **Step 1: Update result-pill.tsx**

Replace the entire contents of `apps/web/src/components/ui/result-pill.tsx`:

```tsx
import type { MatchResult } from '@eanhl/db'
import { getResultStyle } from '@/lib/result-colors'

interface ResultPillProps {
  result: MatchResult
  /**
   * Variant size. `sm` is the compact pill used inside dense rows
   * (game lists, recent-form strips); `md` is the larger pill used
   * in heroes and featured contexts. Both render the full word
   * ("WIN" / "LOSS" / "OT LOSS" / "DNF") per the design-system
   * spec's deferred-decisions adjustment.
   */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Result pill — the WIN / LOSS / OT LOSS / DNF marker. Color via
 * getResultStyle: emerald (WIN), rose (LOSS), amber (OTL), zinc (DNF).
 */
export function ResultPill({ result, size = 'sm', className = '' }: ResultPillProps) {
  const style = getResultStyle(result)
  const sizeClasses =
    size === 'md'
      ? 'h-[42px] min-w-[88px] px-4 text-sm tracking-[0.22em]'
      : 'h-6 px-2.5 text-[10px] tracking-[0.18em]'
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border font-condensed font-bold uppercase whitespace-nowrap ${sizeClasses} ${style.container} ${className}`}
    >
      {style.label}
    </span>
  )
}
```

Key changes:
- Both `sm` and `md` render `style.label` (the full word) — no more glyph branch.
- `sm` drops `min-w-[32px]` and shrinks to `text-[10px] tracking-[0.18em]` so "OT LOSS" fits.
- `whitespace-nowrap` added to prevent wrapping when the pill is squeezed in a flex container.

- [ ] **Step 2: Update result-colors.ts**

The `glyph` field on `ResultStyle` is no longer consumed. Replace the entire contents of `apps/web/src/lib/result-colors.ts`:

```ts
import type { MatchResult } from '@eanhl/db'

interface ResultStyle {
  /** Tailwind classes for the chip/pill container — bg + border + text. */
  container: string
  /** Full-word label rendered by ResultPill at any size. */
  label: string
}

const STYLES: Record<MatchResult, ResultStyle> = {
  WIN: {
    container: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
    label: 'WIN',
  },
  LOSS: {
    container: 'bg-rose-500/10 border-rose-500/40 text-rose-400',
    label: 'LOSS',
  },
  OTL: {
    container: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
    label: 'OT LOSS',
  },
  DNF: {
    container: 'bg-zinc-700/40 border-zinc-600/40 text-zinc-400',
    label: 'DNF',
  },
}

export function getResultStyle(result: MatchResult): ResultStyle {
  return STYLES[result]
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/result-pill.tsx apps/web/src/lib/result-colors.ts
git commit -m "$(cat <<'EOF'
feat(web): switch ResultPill to full-word labels at every size

Per the renovation spec's deferred-decisions section, ResultPill now
renders the full word ("WIN" / "LOSS" / "OT LOSS" / "DNF") at both
size=sm and size=md. The previous size=sm letter-glyph variant (W/L
/OT/—) is removed. Compact pill widens just enough to fit "OT LOSS"
at text-[10px] tracking-[0.18em] with whitespace-nowrap.

Drops the now-unused `glyph` field from getResultStyle.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): switch ResultPill to full-word labels ...` is HEAD.

---

## Task 5: Tighten nav voice (NavLinks + GameTitleSwitcher + top-nav fallbacks)

Bring the nav into final voice consistency with Phases 2-5.

**Files:**
- Modify: `apps/web/src/components/nav/nav-links.tsx`
- Modify: `apps/web/src/components/nav/game-title-switcher.tsx`
- Modify: `apps/web/src/components/nav/top-nav.tsx`

- [ ] **Step 1: Apply transformations to nav-links.tsx**

1. Desktop variant: change `tracking-[0.15em]` → `tracking-widest`. Replace:
   ```tsx
   'font-condensed text-sm font-bold uppercase tracking-[0.15em] transition-colors',
   ```
   with:
   ```tsx
   'font-condensed text-sm font-bold uppercase tracking-widest transition-colors',
   ```

2. Mobile variant: change `tracking-wider` → `tracking-widest`. Replace:
   ```tsx
   'text-xs font-semibold uppercase tracking-wider',
   ```
   with:
   ```tsx
   'font-condensed text-xs font-semibold uppercase tracking-widest',
   ```

- [ ] **Step 2: Apply transformations to game-title-switcher.tsx**

1. Single-title chip: drop `rounded-sm` and bump `tracking-wide` → `tracking-widest`. Replace:
   ```tsx
   <span className="inline-flex items-center rounded-sm border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wide text-zinc-50">
   ```
   with:
   ```tsx
   <span className="inline-flex items-center border border-zinc-700 bg-zinc-900/70 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-50">
   ```

2. Multi-title segmented bar wrapper: drop `rounded-sm`. Replace:
   ```tsx
   <div className="flex items-center divide-x divide-zinc-700 overflow-hidden rounded-sm border border-zinc-700">
   ```
   with:
   ```tsx
   <div className="flex items-center divide-x divide-zinc-700 overflow-hidden border border-zinc-700">
   ```

3. Pill items: bump `tracking-wide` → `tracking-widest`. Replace:
   ```tsx
   'px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wide transition-colors',
   ```
   with:
   ```tsx
   'px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest transition-colors',
   ```

- [ ] **Step 3: Apply transformations to top-nav.tsx**

1. Brand wordmark: bump `tracking-[0.15em]` → `tracking-widest`. Replace:
   ```tsx
   <span className="hidden font-condensed text-lg font-black uppercase leading-none tracking-[0.15em] text-zinc-50 sm:block">
   ```
   with:
   ```tsx
   <span className="hidden font-condensed text-lg font-black uppercase leading-none tracking-widest text-zinc-50 sm:block">
   ```

2. Desktop fallback: bump `tracking-[0.15em]` → `tracking-widest`. Replace:
   ```tsx
   className="font-condensed text-sm font-bold uppercase tracking-[0.15em] text-zinc-400"
   ```
   with:
   ```tsx
   className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-400"
   ```

3. Mobile fallback: bump `tracking-wider` → `tracking-widest` and add `font-condensed`. Replace:
   ```tsx
   className="flex-1 py-2 text-center text-xs font-semibold uppercase tracking-wider text-zinc-400"
   ```
   with:
   ```tsx
   className="flex-1 py-2 text-center font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-400"
   ```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/nav/nav-links.tsx apps/web/src/components/nav/game-title-switcher.tsx apps/web/src/components/nav/top-nav.tsx
git commit -m "$(cat <<'EOF'
refactor(web): tighten nav voice to tracking-widest

NavLinks (desktop + mobile), GameTitleSwitcher (drop rounded-sm corners
on segmented bar + single-title chip), and top-nav fallbacks bump
tracking to widest matching Phases 2-5 voice. Final pass before
removing the kitchen-sink dev page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): tighten nav voice ...` is HEAD.

---

## Task 6: Voice/casing audit grep

Spec calls for a grep pass to catch any leftover sentence-case labels. Earlier phases caught most; this confirms.

- [ ] **Step 1: Run the grep**

```bash
rg -n '"(record|leaders?|standings?|stats|games?|roster)"' apps/web/src
```
Expected: no matches (already verified earlier in this session).

- [ ] **Step 2: Wider audit — catch label-y strings inside JSX**

```bash
rg -n '>(Record|Leaders?|Standings?|Stats|Games?|Roster|Recent|Latest|Featured|Top Performers|Goalie|Position|Defense|Offense|Chemistry|Trend|Skater|Shot Map|Club|Season|Title|Career|Faceoff|Playmaking|Scoring|Overview|Profile|Division|Standing|Mode)\s*<' apps/web/src
```
This catches text content inside JSX tags that's sentence-case. Many will be legitimate (uppercase already) — review each match. Anything that's a label needing UPPERCASE wide-tracked treatment but currently rendered without those classes should be tightened.

- [ ] **Step 3: Spot-fix any genuine sentence-case labels found**

For each match identified in Step 2, verify:
- If the surrounding `className` already has `uppercase` + `font-condensed` + appropriate tracking → no fix needed.
- If the className is missing those, add them. Use Edit tool for each spot fix.

If no fixes needed, skip Step 4 and move to verify in Step 5.

- [ ] **Step 4: Commit any voice-audit fixes**

```bash
# Only if Step 3 produced changes:
git add apps/web/src/...
git commit -m "$(cat <<'EOF'
refactor(web): voice audit fixes from phase 6 grep

Tighten any leftover sentence-case JSX labels surfaced by the
phase 6 cross-cutting voice grep audit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If no changes needed, skip the commit.

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: latest commit is either the voice-audit fix or whatever the previous commit was.

---

## Task 7: Remove kitchen-sink dev page

Phase 1's visual-verification harness. Removed at end of renovation per spec.

**Files:**
- Delete: `apps/web/src/app/_kitchen-sink/page.tsx` (and the `_kitchen-sink/` directory)

- [ ] **Step 1: Confirm zero references**

```bash
rg -n "_kitchen-sink" apps/web/src apps/web/src/app
```
Expected: only the page file itself (or no matches if Next.js resolves it from the filesystem layout).

- [ ] **Step 2: Delete the directory**

```bash
git rm -r apps/web/src/app/_kitchen-sink
git status --short
```
Expected: a single `D` line for `apps/web/src/app/_kitchen-sink/page.tsx`.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(web): remove kitchen-sink dev page

Phase 1 visual-verification harness; not part of production. Removed
at end of renovation per the spec.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
git status
```
Expected: `chore(web): remove kitchen-sink dev page` is HEAD; clean working tree.

---

## Task 8: Final verification — typecheck + format + dev-server walkthrough + push

Phase 6 ends when the renovation is fully landed and pushed.

- [ ] **Step 1: Full-repo typecheck**

```bash
pnpm typecheck
```
Expected: 6 successful tasks.

- [ ] **Step 2: Targeted format pass**

```bash
pnpm exec prettier --write \
  apps/web/src/components/ui/result-glow.tsx \
  apps/web/src/components/ui/result-pill.tsx \
  apps/web/src/lib/result-colors.ts \
  apps/web/src/components/matches/score-card.tsx \
  apps/web/src/components/matches/hero-card.tsx \
  apps/web/src/components/nav/nav-links.tsx \
  apps/web/src/components/nav/game-title-switcher.tsx \
  apps/web/src/components/nav/top-nav.tsx
git status --short
```

If any files reformatted, commit:

```bash
git add apps/web/src/components/ui/*.tsx \
        apps/web/src/lib/result-colors.ts \
        apps/web/src/components/matches/score-card.tsx \
        apps/web/src/components/matches/hero-card.tsx \
        apps/web/src/components/nav/*.tsx
git commit -m "$(cat <<'EOF'
style(web): prettier pass on phase 6 cleanup work

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If nothing changed, skip.

- [ ] **Step 3: Start dev server**

```bash
pnpm --filter web dev
```
Wait for "Ready in" line.

- [ ] **Step 4: End-to-end walkthrough — every route**

Open in a browser:
- `http://localhost:<port>/` — home page (Phases 2 + 4 + 6 all visible: LATEST RESULT broadcast hero, ROSTER SPOTLIGHT, SCORING LEADERS, CLUB RECORD STRIP, SEASON RANK, RECENT RESULTS strip with **full-word ResultPill chips**, TITLE RECORDS).
- `http://localhost:<port>/games` — list page. Each card has its result glow restored (emerald for WIN, rose for LOSS, amber for OTL, dim-rose for DNF). FormStrip pips show full words.
- `http://localhost:<port>/games/<id>` — detail. HeroCard has BroadcastPanel + result-tinted glow layered on top. Top Performers, Possession Edge, Team Stats, Goalie Spotlight, Scoresheet, Context Footer all retain Phase 4 voice.
- `http://localhost:<port>/roster` — list. Depth chart, summary strips, Skater + Goalie tables.
- `http://localhost:<port>/roster/<id>` — profile. ProfileHero, Stats Record, Club Stats Tabs, Contribution donut, Shot Map, Charts & Visuals.
- `http://localhost:<port>/stats` — Record, Team Averages StatCards, TeamShotMap (BroadcastPanel + section header), Skater + Goalie tables, Chemistry, Recent Games, all the cross-title comparison sections.
- `http://localhost:<port>/_kitchen-sink` — should 404 (page deleted).
- Top nav on every route — sticky, `border-b border-accent/15`, `tracking-widest` labels, accent under-bar on the active link.

Click through links + filters to confirm interactions work. Confirm no broken images, no missing data shape, no console errors.

If anything renders broken, stop and surface to the user.

- [ ] **Step 5: Stop dev server**

```bash
pkill -f "next-server" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1
pgrep -af "next-server|next dev" || echo "(stopped)"
```

- [ ] **Step 6: Push**

```bash
env -u GITHUB_TOKEN git push origin feat/design-system-renovation
```
Expected: push succeeds. The `env -u GITHUB_TOKEN` prefix is needed until the user removes the stale token from their shell environment.

- [ ] **Step 7: Final state check**

```bash
git status
git log --oneline main..HEAD | head -20
```
Expected: clean tree on `feat/design-system-renovation`; commits ahead of `main` show the full renovation arc (Phase 0's spec + plan, Phase 1 primitives, Phases 2-5 page restyles, Phase 6 cleanup + deferred polish).

---

## Recovery if something goes wrong mid-plan

- **Typecheck fails after the ResultPill update:** the most likely culprit is `getResultStyle().glyph` accessed somewhere we missed. Run `rg -n "\.glyph" apps/web/src` to find any consumer. Either restore the glyph field on `ResultStyle` or update the consumer to use `.label`. Don't commit a broken state.
- **A ResultGlow consumer (ScoreCard / HeroCard) renders the glow ABOVE content because of stacking-context confusion:** the content `<div className="relative">` wrapper is the fix; without it, content sits on the same z-plane as the absolute glow. Verify each consumer adds the relative wrapper.
- **Visual regression on the FormStrip pips after Task 4:** the FormStrip on `/games` renders multiple ResultPills inline. Full-word pills take more horizontal space than letter glyphs. If the row visibly wraps, consider tightening `min-w-[32px]` (now removed) to a more conservative compact pad — e.g. `px-2` instead of `px-2.5`. Or accept the wider visual; the user explicitly asked for full words.
- **Push still fails despite `env -u GITHUB_TOKEN`:** the user's GitHub token may have expired again. Run `gh auth status` and re-authenticate via `gh auth login` if needed.
- **Voice grep audit (Task 6) surfaces many sentence-case strings:** review each individually. Many will be UI copy (sentences in empty states, error messages) that legitimately stay sentence-case — only LABEL-style strings (section headers, table column labels, stat names) need UPPERCASE treatment.
- **Phase 6 walkthrough surfaces a regression in an earlier phase's component:** fix-forward with a `fix(web): ...` commit on the renovation branch. Don't `git revert` Phase 0-5 commits — they're the foundation; we patch on top.
