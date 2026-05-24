# Scoresheet Polish Pass — Match Detail Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the Scoresheet section's two CRITICAL issues (the "Shooting %" mislabel + the incoherent detail-group structure) plus the remaining UI-review polish items, including a cross-cutting fix to `PositionPill` colors that affects Top Performers + Goalie Spotlight at the same time.

**Architecture:** Five small commits. Most edits sit in `apps/web/src/components/matches/scoresheet.tsx` — line-range-disjoint, so they can land sequentially without conflicting. One commit refactors `position-pill.tsx` to use the existing `lib/position-colors.ts` palette (single source of truth) and ripples visually through three sections. One commit threads opponent-crest props through to the Scoresheet from `page.tsx`.

**Tech Stack:** Next.js 15 App Router, React Client Components (Scoresheet is `'use client'` because of the expand/collapse state), Tailwind CSS 4 with CSS-var tokens. No new dependencies. No data-layer changes — all metric reshuffling stays inside the component using fields already on `SkaterRow`.

---

## Context

The UI review (`docs/reviews/Match-ID-UI-UX-Review.md`, section 6) flagged the Scoresheet as carrying the page's single most actively-misleading display: the "Shooting %" quick-stat tile shows 117% for MrHomicide on match 250. The user confirmed (this conversation, 2026-05-17) that ">100% Shot On Net %" is **real EA data**, not a render bug:

> "It is possible to score without shooting. When some event happens that causes the puck to go into the net, the last opponent to touch the puck is credited with the goal."

So a deflection or own-goal credits `shots +1` (and sometimes `goals +1`) but **not** `shotAttempts +1`. The current code computes `shots / shotAttempts * 100` — that's **Shot On Net %**, not Shooting %. Two issues compound:

1. The tile is mislabeled. Real **Shooting %** is `goals / shots * 100` (1G on 7 SOG = 14.3%); the page has never shown this metric anywhere.
2. The same `shots / shotAttempts` value appears **twice** in the expanded panel — once as the mislabeled tile, once as the correctly-labeled "Shot On Net %" row inside the SHOOTING group.

Reader confusion: "this player scored on 117% of his shots" is the wrong mental model and erodes trust in the whole page.

The same expanded panel also has a structural problem: the two bottom groups are titled `Special Teams & Discipline` and `Discipline & Turnovers`. Both contain the word "Discipline" but split the stats arbitrarily — PIM is grouped with PPG/SHG; Penalties Drawn is grouped with PIM (but in a different group); Hits and Blocks are with Takeaways/Giveaways/Interceptions under "Discipline & Turnovers". The grouping logic is broken.

Beyond those two CRITICAL items, the review flagged six smaller issues (POSSESSION unit inconsistency, FO W/L ambiguity, mobile horizontal-scroll affordance, missing keyboard/ARIA on row click, missing team crests on the section header, and the cross-cutting PositionPill D-color inconsistency that's caused by `position-pill.tsx` carrying its own side-aware palette instead of using the canonical `lib/position-colors.ts` single source of truth).

The intended outcome is a single focused arc that lands the two CRITICAL fixes, normalizes the position pills across the page, and clears the polish backlog — leaving the Scoresheet as the highest-fidelity surface on the match page.

---

## File Map

| Touched in | File                                                                                      | Why                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 1     | `apps/web/src/components/matches/scoresheet.tsx`                                          | Rename "Shooting %" tile → "Shot On Net %"; add real Shooting % tile; add Shooting % row to SHOOTING group; drop PIM tile (PIM stays in detail group); add explainer tooltip on Shot On Net % when > 100% |
| Task 2     | `apps/web/src/components/matches/scoresheet.tsx`                                          | Split last two groups into five atomic groups: Special Teams (PPG, SHG) / Discipline (PIM, Penalties Drawn) / Defense (Hits, Blocks) / Turnovers (Takeaways, Giveaways, Interceptions) / Workload (TOI)   |
| Task 3     | `apps/web/src/components/matches/position-pill.tsx`                                       | Drop the side-aware `POSITION_STYLE` palette; use `colorForPosition()` + `POSITION_META` from `lib/position-colors.ts`. Single color per position across BGM/opp, L/R.                                    |
| Task 4     | `apps/web/src/components/matches/scoresheet.tsx` + `apps/web/src/app/games/[id]/page.tsx` | TeamSide gets BGM logo / opponent crest in the team-label `<h3>`. Drop redundant section subtitle. Unify POSSESSION format. Add FO W/L "team total" tooltip.                                              |
| Task 5     | `apps/web/src/components/matches/scoresheet.tsx`                                          | Apply `hideOnMobile` to Hits + Blks columns. Add `role="button"`, `tabIndex={0}`, `aria-expanded`, `onKeyDown` (Enter / Space) to skater rows.                                                            |

**Existing helpers to reuse (do not re-implement):**

- [`colorForPosition(pos: string | null): string`](apps/web/src/lib/position-colors.ts#L64) — returns `var(--pos-*)` CSS-var reference. Accepts both long ("center", "leftWing") and short ("C", "LW") keys. Falls back to `var(--color-fg-5)` on unknown.
- [`POSITION_META`](apps/web/src/lib/position-colors.ts#L37) — full position → `{tag, colorVar}` table. Defines `defenseMen` as alias of `leftDefenseMen` (both → `--pos-d` / `--pos-ld`).
- [`OpponentCrest`](apps/web/src/components/ui/opponent-crest.tsx) — `<Image>` wrapper with URL fallback chain. Already used by `hero-card.tsx:122-140`. Takes `crestAssetId` + `useBaseAsset` props.
- `/images/bgm-logo.png` — canonical BGM crest path. Used in [hero-card.tsx:95](apps/web/src/components/matches/hero-card.tsx#L95) and [lineup-section.tsx:219](apps/web/src/components/matches/lineup-section.tsx#L219).
- `SkaterRow` fields used in Task 1: `goals` (line 838 of match-recap.ts), `shots` (line 842), `shotAttempts` (854). Both `goals` and `shots` are already on the type — no schema change needed.

---

### Task 1: Shot On Net % relabel + real Shooting % tile + duplicate cleanup

**Why first:** Highest user-visible data-correctness fix. Single file, three local edits to `SkaterRowEl` (lines 170-210).

**Files:**

- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 170-210)

- [ ] **Step 1: Rebuild the 6-tile grid**

Replace the tile grid (lines 170-197) — drop PIM, rename "Shooting %" → "Shot On Net %", add real Shooting % (`goals / shots`), keep the others. The grid stays `sm:grid-cols-3`:

```tsx
<div className="grid gap-3 sm:grid-cols-3">
  <DetailStat label="Score" value={row.score.toFixed(2)} />
  <DetailStat
    label="Shot On Net %"
    value={row.shotAttempts > 0 ? `${((row.shots / row.shotAttempts) * 100).toFixed(0)}%` : '—'}
    tooltip={
      row.shotAttempts > 0 && row.shots > row.shotAttempts
        ? 'Can exceed 100% — EA credits deflection goals as shots without recording a shot attempt.'
        : undefined
    }
  />
  <DetailStat
    label="Shooting %"
    value={row.shots > 0 ? `${((row.goals / row.shots) * 100).toFixed(0)}%` : '—'}
  />
  <DetailStat label="Pass %" value={row.passPct !== null ? `${row.passPct.toFixed(0)}%` : '—'} />
  <DetailStat
    label="FO %"
    value={
      row.faceoffWins + row.faceoffLosses > 0
        ? `${((row.faceoffWins / (row.faceoffWins + row.faceoffLosses)) * 100).toFixed(0)}%`
        : '—'
    }
  />
  <DetailStat
    label="Possession"
    value={row.possessionSeconds > 0 ? `${row.possessionSeconds.toString()}s` : '—'}
  />
</div>
```

New tile order: SCORE / Shot On Net % / Shooting % | Pass % / FO % / Possession. PIM removed from the tile row; it remains in the new "Discipline" detail group (Task 2). The `tooltip` prop drives a `title=` attribute on the tile — added in Step 2.

- [ ] **Step 2: Extend the `DetailStat` component to accept a tooltip**

`DetailStat` lives at lines 334-345. Currently:

```tsx
function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 font-condensed text-lg font-bold tabular-nums text-zinc-100">
        {value}
      </div>
    </div>
  )
}
```

Replace with (preserving the existing class strings exactly — only adding the tooltip surface):

```tsx
function DetailStat({ label, value, tooltip }: { label: string; value: string; tooltip?: string }) {
  return (
    <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2" title={tooltip}>
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
        {tooltip ? (
          <span className="ml-1 text-zinc-600" aria-hidden>
            ⓘ
          </span>
        ) : null}
      </div>
      <div className="mt-1 font-condensed text-lg font-bold tabular-nums text-zinc-100">
        {value}
      </div>
    </div>
  )
}
```

The `title=` attribute on the wrapper surfaces the tooltip natively; the small `ⓘ` glyph next to the label hints that hover-info exists. Class strings preserved verbatim.

- [ ] **Step 3: Update the SHOOTING detail group to include both metrics**

The SHOOTING group at lines 198-210 currently has `Shots / Attempts`, `Shot On Net %`, `Deflections`. Add a `Shooting %` row alongside (the row/tile duplication is the established pattern — Pass %, FO %, Possession all appear in both places):

```tsx
<DetailGroup
  title="Shooting"
  stats={[
    ['Shots / Attempts', `${row.shots.toString()}/${row.shotAttempts.toString()}`],
    [
      'Shot On Net %',
      row.shotAttempts > 0 ? `${((row.shots / row.shotAttempts) * 100).toFixed(1)}%` : '—',
    ],
    ['Shooting %', row.shots > 0 ? `${((row.goals / row.shots) * 100).toFixed(1)}%` : '—'],
    ['Deflections', row.deflections.toString()],
  ]}
/>
```

(Same `.toFixed(1)` precision as the existing `Shot On Net %` row.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 5: Manual browser verification**

Navigate to `/games/250`, expand MrHomicide's row (1G on 7 SOG, 6 shotAttempts per the DB):

- Tile row should show **Shot On Net % = 117%** (with a small `ⓘ` glyph and tooltip "Can exceed 100% — EA credits deflection goals as shots without recording a shot attempt.")
- New **Shooting % = 14%** tile shown next to it (1/7)
- PIM tile **gone** from the headline grid
- SHOOTING group below shows: `Shots / Attempts 7/6 · Shot On Net % 116.7% · Shooting % 14.3% · Deflections N`
- PIM still visible in the Special Teams & Discipline group (until Task 2 regroups it)

For a sanity check, also expand a player with 0 deflections (e.g., a defenseman) — Shot On Net % should be ≤ 100% and the `ⓘ` glyph should be absent.

- [ ] **Step 6: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
fix(matches/scoresheet): rename Shooting% → Shot On Net%, add real Shooting% tile

The "Shooting %" tile in the player drill-down was computing
shots/shotAttempts, which is actually Shot On Net %. The mislabel
surfaced as a 117% value for MrHomicide on match 250 — a real EA
quirk (deflection/redirect goals credit shots without a shotAttempt)
that read as a render bug under the wrong label.

Three fixes:
- Rename the tile to "Shot On Net %"; add an info tooltip explaining
  the >100% case via DetailStat's new `tooltip` prop.
- Add a real Shooting % tile (goals/shots) — the metric was previously
  not shown anywhere on the page.
- Add the Shooting % row to the SHOOTING detail group alongside the
  existing Shot On Net % row (matches the tile/row duplication pattern
  used by Pass %, FO %, Possession).
- Drop the PIM tile from the headline grid so the layout stays 2×3;
  PIM still appears in the detail group below.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Regroup the bottom detail panels (5 atomic groups)

**Why second:** Same file as Task 1, line-disjoint (Task 1 touched lines 170-210; this touches 237-254). Resolves the "two groups both named Discipline" structural mess.

**Files:**

- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 237-254)

- [ ] **Step 1: Replace the two confused groups with five atomic ones**

The current `Special Teams & Discipline` + `Discipline & Turnovers` groups (lines 237-254) split stats arbitrarily. Replace both blocks with:

```tsx
              <DetailGroup
                title="Special Teams"
                stats={[
                  ['PPG', row.ppGoals.toString()],
                  ['SHG', row.shGoals.toString()],
                ]}
              />
              <DetailGroup
                title="Discipline"
                stats={[
                  ['PIM', row.pim.toString()],
                  ['Penalties Drawn', row.penaltiesDrawn.toString()],
                ]}
              />
              <DetailGroup
                title="Defense"
                stats={[
                  ['Hits', row.hits.toString()],
                  ['Blocks', row.blocks.toString()],
                ]}
              />
              <DetailGroup
                title="Turnovers"
                stats={[
                  ['Takeaways', row.takeaways.toString()],
                  ['Giveaways', row.giveaways.toString()],
                  ['Interceptions', row.interceptions.toString()],
                ]}
              />
              <DetailGroup
                title="Workload"
                stats={[['TOI', row.toi ?? '—']]}
              />
```

Order rationale: Special Teams → Discipline (semantic chain: PPG/SHG → penalties), then Defense → Turnovers (semantic chain: stops & takeaways), then Workload as a single-row coda. Faceoffs & Pressure group above (lines 223-236) stays unchanged — it's already coherent.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Expand any skater row at `/games/250`. The bottom of the drill-down should now show five small groups in order: **Special Teams** (PPG, SHG) → **Discipline** (PIM, Penalties Drawn) → **Defense** (Hits, Blocks) → **Turnovers** (Takeaways, Giveaways, Interceptions) → **Workload** (TOI).

Verify no rows were lost: total of 11 stats across the new groups should match the 10 stats that were in the two old groups plus TOI (Workload is the only group with TOI; it didn't move).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
fix(matches/scoresheet): split tangled detail groups into five atomic sections

The expanded panel had two groups both titled with "Discipline"
("Special Teams & Discipline" and "Discipline & Turnovers") that
split stats arbitrarily — PIM with PPG/SHG, Penalties Drawn separate
from PIM, Hits/Blocks bundled with takeaways/giveaways under
"Discipline & Turnovers". Reader couldn't tell why a stat was in
one group vs the other.

Split into five single-purpose groups: Special Teams (PPG/SHG) →
Discipline (PIM, Penalties Drawn) → Defense (Hits, Blocks) →
Turnovers (Takeaways, Giveaways, Interceptions) → Workload (TOI).
All 11 stats preserved; group headers now describe their contents
unambiguously.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Normalize PositionPill colors via lib/position-colors.ts

**Why third:** Cross-cutting fix to `position-pill.tsx` — affects Scoresheet, Top Performers (`star-card.tsx`), and Goalie Spotlight (`goalie-spotlight.tsx`). Removes the side-aware `POSITION_STYLE` table and uses the canonical `colorForPosition()` from `lib/position-colors.ts`. Single source of truth.

**Files:**

- Modify: `apps/web/src/components/matches/position-pill.tsx` (full rewrite of the style logic; props unchanged)

- [ ] **Step 1: Rewrite `position-pill.tsx` to use `lib/position-colors.ts`**

Replace the entire file contents with:

```tsx
// Color-coded position pill used on the scoresheet, Top Performer cards, and
// goalie spotlight. Single source of color truth: lib/position-colors.ts.
// Palette documented in docs/specs/position-colors.md.

import { colorForPosition } from '@/lib/position-colors'

interface PositionPillProps {
  label: string
  position: string | null
  isGoalie: boolean
  /**
   * @deprecated Kept for call-site compatibility; color is now position-derived
   * only. Will be removed in a follow-up cleanup once all call sites stop
   * passing it.
   */
  side?: 'bgm' | 'opp'
  /**
   * @deprecated Same as `side` — L/R defensemen now share a per-position color
   * regardless of which side they line up on.
   */
  defenseSide?: 'left' | 'right' | null
  onLight?: boolean
}

export function PositionPill({ label, position, isGoalie, onLight = false }: PositionPillProps) {
  // Resolve which canonical position key to color by. PositionPill receives
  // raw EA position strings ("defenseMen", "leftDefenseMen", etc.) plus a
  // boolean for goalie. colorForPosition() maps either short or long form.
  const colorKey = isGoalie ? 'goalie' : position
  const color = colorForPosition(colorKey)

  return (
    <span
      className="inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-widest tabular"
      style={{
        borderColor: onLight ? color : `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: onLight
          ? 'rgba(8,8,10,0.84)'
          : `color-mix(in srgb, ${color} 10%, transparent)`,
        color,
      }}
    >
      {label}
    </span>
  )
}
```

Notes:

- `side` and `defenseSide` props kept (`@deprecated`) so call sites don't break — they're simply ignored. A follow-up cleanup can strip them.
- `color-mix(in srgb, X 40%, transparent)` reproduces the old `66`/`1a` alpha hex suffixes (40% / ~10% opacity) using the CSS-var color. Browser support is universal in 2026 evergreen browsers.
- For BGM `defenseMen` (line 124 in scoresheet.tsx passes `position="defenseMen"`), `colorForPosition("defenseMen")` returns `var(--pos-d)` (cyan, per `lib/position-colors.ts:41`). Same for opp. The L/R asymmetry disappears.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. Call sites passing `side` / `defenseSide` continue to compile (props remain in the interface, just unused).

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Check three surfaces:

1. **Scoresheet:** Both BGM and opp D pills (HenryTheBobJr, JoeyFlopfish, shadowassault20, MUTTBUTT) render in the same cyan (`var(--pos-d)`). Centers (MrHomicide) in red, wings in green/blue per the canonical palette.
2. **Top Performers (star-card):** Per-card position pills follow the same colors. No BGM-vs-opp drift.
3. **Goalie Spotlight:** Goalie pill in purple (`var(--pos-g)` = #6f00a5).

Spot-check: the opponent D pills (previously orange/yellow) should now be cyan, matching BGM's D pills.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/position-pill.tsx
git commit -m "$(cat <<'EOF'
refactor(matches/position-pill): single color per position via lib/position-colors.ts

PositionPill had its own side-aware POSITION_STYLE palette assigning
different colors to BGM D (cyan) vs opp D (orange), and again to
defenseLeft (cyan) vs defenseRight (yellow). Result: the same
position rendered in three different colors across rows on the
Scoresheet, breaking the position-as-visual-anchor convention.

Refactored to use colorForPosition() from lib/position-colors.ts —
the single source of truth already in use by the Lineup section.
One canonical color per position regardless of side or L/R.

`side` and `defenseSide` props kept @deprecated for call-site
compatibility; they're ignored. Follow-up cleanup will strip them
across scoresheet.tsx, star-card.tsx, goalie-spotlight.tsx,
show-all-player-scores.tsx.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: TeamSide crests + section subtitle + POSSESSION unit + FO W/L tooltip

**Why fourth:** Polish bundle in `scoresheet.tsx` + `page.tsx` prop threading. All edits are small and line-disjoint from Tasks 1/2/3.

**Files:**

- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 22-26 subtitle, 36-46 TeamSide, 195 + 220 possession, 226 FO W/L)
- Modify: `apps/web/src/app/games/[id]/page.tsx` (line 223 — add crest props to ScoresheetSection)

- [ ] **Step 1: Add `bgmCrestSrc` + opponent crest props to `ScoresheetProps`**

In `scoresheet.tsx`, replace the props interface (line 11-13):

```tsx
interface ScoresheetProps {
  scoresheet: Scoresheet
  opponentCrestAssetId: string | null
  opponentCrestUseBaseAsset: string | null
  opponentName: string
}
```

And destructure them in `ScoresheetSection` (line 15) and thread them through to TeamSide:

```tsx
export function ScoresheetSection({
  scoresheet,
  opponentCrestAssetId,
  opponentCrestUseBaseAsset,
  opponentName,
}: ScoresheetProps) {
  const { bgm, opponent } = scoresheet
  const bgmEmpty = bgm.skaters.length === 0 && bgm.goalies.length === 0
  const oppEmpty = opponent.skaters.length === 0 && opponent.goalies.length === 0
  if (bgmEmpty && oppEmpty) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Scoresheet" />

      <div className="space-y-6">
        {!bgmEmpty ? <TeamSide side={bgm} crest={<BgmCrest />} /> : null}
        {!oppEmpty ? (
          <TeamSide
            side={opponent}
            crest={
              <OpponentCrest
                crestAssetId={opponentCrestAssetId}
                useBaseAsset={opponentCrestUseBaseAsset}
                alt={opponentName}
                width={24}
                height={24}
                className="h-6 w-6 object-contain"
              />
            }
          />
        ) : null}
      </div>
    </section>
  )
}
```

Note: section subtitle dropped — the BGM-vs-opp visual separation is now provided by the crests + team labels, making "BGM player profiles linked · opponent rows are match-archive only" redundant.

- [ ] **Step 2: Add the imports + define `BgmCrest`**

At the top of `scoresheet.tsx`, add:

```tsx
import Image from 'next/image'
import { OpponentCrest } from '@/components/ui/opponent-crest'
```

And define a small `BgmCrest` helper (near the bottom of the file, alongside other helpers like `DnfBadge`):

```tsx
function BgmCrest() {
  return (
    <Image
      src="/images/bgm-logo.png"
      alt="BGM"
      width={24}
      height={24}
      className="h-6 w-6 object-contain"
    />
  )
}
```

- [ ] **Step 3: Update `TeamSide` to render the crest**

Replace the `TeamSide` function (lines 36-54):

```tsx
function TeamSide({ side, crest }: { side: ScoresheetSide; crest: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-300">
        {crest}
        <span>{side.teamLabel}</span>
        {side.isBgm ? (
          <span className="border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-condensed text-[9px] font-bold uppercase tracking-widest text-accent">
            BGM
          </span>
        ) : null}
      </h3>

      <div className="space-y-3">
        {side.skaters.length > 0 ? <SkaterTable rows={side.skaters} isBgm={side.isBgm} /> : null}
        {side.goalies.length > 0 ? <GoalieTable rows={side.goalies} isBgm={side.isBgm} /> : null}
      </div>
    </div>
  )
}
```

Changed `items-baseline` → `items-center` so the 24×24 crest aligns to the small uppercase team label.

- [ ] **Step 4: Unify POSSESSION format (drop `s` suffix from the tile)**

Line 195 currently renders `${row.possessionSeconds.toString()}s` (tile, with `s`). Line 220 renders `row.possessionSeconds.toString()` (group, no suffix). The `s` is ambiguous (seconds? since?). Drop it from the tile so both surfaces show the same raw integer:

Replace line 195's tile value:

```tsx
                  value={row.possessionSeconds > 0 ? row.possessionSeconds.toString() : '—'}
```

(The Possession tile is already in the Task 1 rewrite — apply this change as part of finalizing Task 4 on top of Task 1's result.)

- [ ] **Step 5: Clarify FO W/L (centerman = team total)**

Line 226 renders the row currently as `['FO W/L', row.faceoffRecord ?? '—']`. In EASHL only the center takes the team's faceoffs, so a center's W/L equals the team's. Add a tooltip via a small wrapper. Replace the row:

```tsx
                  [
                    'FO W/L',
                    row.faceoffRecord ?? '—',
                    'Centerman takes all team faceoffs in EASHL — this is the team total.',
                  ],
                ]}
              />
```

This requires extending the `DetailGroup` row tuple from `[label, value]` to `[label, value, tooltip?]` and threading the tooltip through to the underlying `DetailStat`. `DetailGroup` (lines 319-332) currently composes `DetailStat` directly — so the change is small:

```tsx
function DetailGroup({
  title,
  stats,
}: {
  title: string
  stats: ReadonlyArray<readonly [string, string] | readonly [string, string, string]>
}) {
  return (
    <Panel className="p-3">
      <h5 className="mb-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-400">
        {title}
      </h5>
      <div className="grid gap-2 sm:grid-cols-2">
        {stats.map(([label, value, tooltip]) => (
          <DetailStat key={label} label={label} value={value} tooltip={tooltip} />
        ))}
      </div>
    </Panel>
  )
}
```

Wrapper markup preserved verbatim — only the `stats` tuple type widens and the tooltip is forwarded.

- [ ] **Step 6: Pass the new props from `page.tsx`**

In `apps/web/src/app/games/[id]/page.tsx` at line 223, the current call is:

```tsx
<ScoresheetSection scoresheet={scoresheet} />
```

Replace with:

```tsx
<ScoresheetSection
  scoresheet={scoresheet}
  opponentCrestAssetId={opponentCrestAssetId}
  opponentCrestUseBaseAsset={opponentCrestUseBaseAsset}
  opponentName={match.opponentName}
/>
```

`opponentCrestAssetId` and `opponentCrestUseBaseAsset` are already in scope (defined at lines 124-125 of the same file).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 8: Manual browser verification**

Navigate to `/games/250`. The Scoresheet section should now show:

- Section header: just "Scoresheet" (no subtitle line)
- Each TeamSide's `<h3>`: 24px crest, team label, then the small "BGM" red pill for the BGM side
- Expand any skater: Possession value matches between tile (no `s`) and group row (already no `s`)
- The FO W/L row in the Faceoffs & Pressure group: small `ⓘ` glyph next to "FO W/L"; hovering shows the team-total tooltip

- [ ] **Step 9: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx \
        apps/web/src/app/games/[id]/page.tsx
git commit -m "$(cat <<'EOF'
feat(matches/scoresheet): team crests in header + tooltip plumbing + format polish

TeamSide headers now render the BGM logo / opponent crest next to the
team label, tying the section back to the team identity already
established at the top of the page. Section subtitle dropped — the
visual crest treatment makes "BGM player profiles linked · opponent
rows are match-archive only" redundant.

DetailGroup row tuple extended from [label, value] to optionally
[label, value, tooltip] so individual rows can carry contextual notes
without inflating the row schema. First user: FO W/L gets a "team
total" tooltip explaining that only the centerman takes faceoffs in
EASHL.

POSSESSION tile drops the ambiguous `s` suffix to match the group-row
formatting. Section header subtitle removed.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Mobile column hiding + keyboard/ARIA on skater rows

**Why last:** Pure a11y + mobile polish. Single file, line-disjoint from prior tasks.

**Files:**

- Modify: `apps/web/src/components/matches/scoresheet.tsx` (lines 75-76 column headers, 144-145 cells, 100-104 row interaction)

- [ ] **Step 1: Apply `hideOnMobile` to Hits + Blks columns**

The `Th` / `Td` helpers already support `hideOnMobile` (verified at lines 391-408 and 410-428) — no caller passes it. Update the skater table header (lines 75-76) and body cells (lines 144-145):

Replace lines 75-76:

```tsx
            <Th hideOnMobile>Hits</Th>
            <Th hideOnMobile>Blks</Th>
```

Replace lines 144-145:

```tsx
        <Td hideOnMobile>{row.hits.toString()}</Td>
        <Td hideOnMobile>{row.blocks.toString()}</Td>
```

On mobile (< 640px) Hits + Blks columns collapse, keeping PTS / +/− / SOG visible without horizontal scroll. The expanded panel still shows them.

- [ ] **Step 2: Add keyboard + ARIA to skater rows**

The `<tr>` element at lines 100-105 currently has `onClick` only. Replace with:

```tsx
      <tr
        className="group cursor-pointer transition-colors hover:bg-surface-raised focus:bg-surface-raised focus:outline-none"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((v) => !v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
      >
```

The `<tr>` becomes keyboard-focusable, screen-readers announce it as a button with expanded state, and Enter/Space toggle the same expand behavior as click.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 4: Manual browser verification**

At `/games/250`:

- Resize the browser to < 640px (or use mobile devtools). Hits + Blks columns should disappear from the table; PTS / +/− / SOG remain.
- At desktop width, Tab through the Scoresheet skater rows. Each row should focus (visible focus ring via `focus:bg-surface-raised`). Press Enter or Space → row expands. Press again → collapses.

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/scoresheet.tsx
git commit -m "$(cat <<'EOF'
feat(matches/scoresheet): mobile column collapse + keyboard/ARIA on row expand

Hits + Blks columns now collapse on mobile (< 640px) via the existing
hideOnMobile prop on the Th/Td helpers (previously unused). High-value
columns (PTS, +/-, SOG) stay visible without horizontal scroll; the
hidden stats remain available in the expanded panel.

Skater rows are now keyboard-accessible: role="button", tabIndex={0},
aria-expanded, and Enter/Space toggle the same expand behavior as
click. Screen-readers correctly announce row interactivity and state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (end-to-end)

After all five commits:

1. **Typecheck the whole repo:** `pnpm typecheck` — expect 0 errors.
2. **Format:** `pnpm format` — expect clean.
3. **Browser verification at `/games/250`** — walk through the Scoresheet section:
   - **Section header:** "Scoresheet" with no subtitle.
   - **TeamSide headers:** BGM logo crest + "BGM" label + small red BGM pill; opponent crest (4th Line) + "4th Line" label.
   - **Position pills (in the table):** All D pills (BGM and opp, L and R) render in the same cyan. C in red, LW in green, RW in blue. Same colors appear on Top Performers and Goalie Spotlight (cross-cutting effect).
   - **Mobile (< 640px):** Hits + Blks columns hidden from the table.
   - **Expand a skater row** (keyboard: Tab + Enter or Space; or click):
     - Six tiles: SCORE / Shot On Net % (with `ⓘ` tooltip when > 100%) / Shooting % / Pass % / FO % / Possession (no `s` suffix)
     - SHOOTING group: Shots/Attempts · Shot On Net % · Shooting % · Deflections
     - FACEOFFS & PRESSURE group: FO W/L (with `ⓘ` "team total" tooltip) · FO % · Takeaways · Interceptions
     - Five small groups at the bottom: Special Teams / Discipline / Defense / Turnovers / Workload — each single-purpose, no group title contains "Discipline" twice.
4. **A11y spot-check:** Tab through the table. Each row focusable; Enter/Space expands.
5. **Git log review:** `git log --oneline -5` should show five commits with clear scopes.

## Out of Scope (follow-ups)

- **Specific position from OCR loadout when available** — the Scoresheet's `PositionPill` currently always shows the generic cyan `D` for defensemen because `SkaterRow.position` from EA's `player_match_stats` only records `defenseMen` (not LD vs RD). The OCR loadout pipeline DOES capture `leftDefenseMen` / `rightDefenseMen` per slot (visible in the Lineup section). Thread that through to `buildScoresheet` in `match-recap.ts` so the Scoresheet pill renders cyan `LD` or yellow `RD` when known, falling back to cyan `D` otherwise. Same enrichment may benefit Top Performers `StarCard` for any position where EA underspecifies.
- **Strip the @deprecated `side` and `defenseSide` props from PositionPill call sites** (scoresheet.tsx, star-card.tsx, goalie-spotlight.tsx, show-all-player-scores.tsx) and from the interface. Mechanical cleanup; separate plan.
- **Show-All Player Scores table** in Top Performers — the row breakdown table is a different surface and was punted in the earlier renovation (UI review issue Top Performers #13).
- **Vitest infra for Scoresheet behaviour tests** — still no test runner in apps/web. Out of scope for this polish sweep.
- **Heatmap tint on Team Stats period-winner cells** — orthogonal Box Score polish.
