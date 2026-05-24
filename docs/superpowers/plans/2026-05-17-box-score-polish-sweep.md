# Box Score Polish Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close five UI-review polish items off the Box Score section in one focused sweep. Five commits, all touching `box-score.tsx`: resolve the OT-column color collision with OTL-loss; tighten the FACEOFFS tab summary phrasing; adopt the shared `formatPeriodLabel` for column headers; add a faint two-team heatmap tint on per-period winner cells; replace the `⚠` emoji in the missing-period footnote with a red `●` for icon-family consistency.

**Architecture:** Multi-commit sweep, one commit per fix. All edits in a single file — `apps/web/src/components/matches/box-score.tsx` — plus one import addition for `formatPeriodLabel`. Each task is line-disjoint from the others.

**Tech Stack:** Next.js 15 App Router, React Client Component (Box Score is `'use client'` for tab state), Tailwind CSS 4 with CSS-var tokens. No new dependencies.

---

## Context

After today's Box Score GOALS delta indicator fix (commit `b0a614e`) — the only Box Score code change so far — five UI-review polish items remain. They cluster naturally into a single-file sweep:

| #   | Item                                                                      | UI review § | Type               |
| --- | ------------------------------------------------------------------------- | ----------- | ------------------ |
| 1   | OT period column header `text-otl` collides with OTL-loss result color    | §5 #2       | Visual bug         |
| 2   | FACEOFFS tab summary `21 of 30` phrasing                                  | §5 #3       | UX polish          |
| 3   | `r.periodLabel` raw use should adopt shared `formatPeriodLabel`           | §5 #4       | Future-proofing    |
| 4   | Per-period winner cells need a faint heatmap tint                         | §5 #10      | Visual signal      |
| 5   | Missing-period footnote `⚠` emoji breaks icon-family consistency with `●` | §5 #6       | Typographic polish |

User decisions (2026-05-17):

- **OT color (item 1):** drop orange entirely, use neutral `text-fg-1`.
- **Heatmap scope (item 4):** both teams — BGM cells in accent-red tint, OPP cells in neutral tint (matches the page-wide BGM=accent / OPP=neutral convention).
- **FACEOFFS phrasing (item 2, default):** `21W · 30 total` (matches the FO W/L convention used by the Scoresheet's faceoff row).
- **Warning icon (item 5, default):** red `●` (consistency with the existing OCR-reviewed pulse-dot family).

Intended outcome: the Box Score section becomes the page's cleanest tabular surface — no visual collisions with result-badge semantics, period-winner cells legible as a heatmap at a glance, all icon affordances drawn from the same family.

---

## File Map

| Touched in | File                                                  | Why                                       |
| ---------- | ----------------------------------------------------- | ----------------------------------------- |
| Tasks 1-5  | `apps/web/src/components/matches/box-score.tsx`       | All five fixes                            |
| Task 3     | (also import from `apps/web/src/lib/period-label.ts`) | Reuse existing `formatPeriodLabel` helper |

Five commits, single file. Each task is line-disjoint from the others.

**Existing helpers to reuse (do not re-implement):**

- [`formatPeriodLabel(n: number): string`](apps/web/src/lib/period-label.ts#L8) — returns `'1ST'`, `'2ND'`, `'3RD'`, `'OT'`, `'OT2'`, `'OT3'`, or `P${n}`. Already used by Action Tracker filter bar and Faceoff Map filter bar.
- Existing `text-fg-1` token = off-white headline color (used everywhere on the page).
- Existing `bg-accent` / accent-tint pattern — `bg-accent/[0.04]` reads as a faint tint without dominating the text.

---

### Task 1: Drop OT orange — use neutral `text-fg-1`

**Files:**

- Modify: `apps/web/src/components/matches/box-score.tsx` (lines 324-327 — `PeriodHeading`)

- [ ] **Step 1: Replace the OT-orange conditional with a neutral brighter color**

`PeriodHeading` currently colors OT columns in `text-otl` (orange), which collides visually with the OTL-loss result badge on the hero card. Replace lines 324-327:

```tsx
function PeriodHeading({ label, number }: { label: string; number: number }) {
  const isOt = number >= 4
  return <span className={isOt ? 'text-otl' : ''}>{label}</span>
}
```

with (drop the orange; use `text-fg-1` so OT still reads as "special column" via brighter weight but no result-color collision):

```tsx
function PeriodHeading({ label, number }: { label: string; number: number }) {
  const isOt = number >= 4
  return <span className={isOt ? 'font-black text-fg-1' : ''}>{label}</span>
}
```

The `font-black` plus brighter `text-fg-1` (off-white) preserves the "this column is special" visual emphasis without borrowing the OTL-loss result color. Column position (rightmost period before the totals column) already conveys "this is overtime."

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250` (which went to OT). Box Score column header for `OT` should now render in bright off-white instead of orange. Other period headers (`1ST`, `2ND`, `3RD`) unchanged.

Curl sanity:

```bash
curl -s http://localhost:3000/games/250 | grep -oE "text-otl|font-black text-fg-1" | sort | uniq -c | head -5
```

Expected: `text-otl` count should drop (was used only here for the OT period header in Box Score).

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/box-score.tsx
git commit -m "$(cat <<'EOF'
fix(matches/box-score): drop OT column orange — use neutral fg-1 to break OTL-loss collision

The OT period column header used `text-otl` (orange), which is also
the result-badge color for OTL-loss elsewhere on the page (e.g. the
hero card). A reader who'd seen the OTL pill could misread the
orange OT header as "this period was lost in OT" when it just means
"overtime."

Dropped the orange — OT column now renders in `font-black text-fg-1`
(brighter off-white + bold weight). Still visually distinct from
regulation columns, but no result-color collision. Column position
already conveys "this is overtime."

Resolves UI review §5 issue #2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: FACEOFFS tab summary phrasing — `N of M` → `NW · M total`

**Files:**

- Modify: `apps/web/src/components/matches/box-score.tsx` (line 209 — inside the `mode === 'faceoffs'` branch of `ModeTabSummary`)

- [ ] **Step 1: Replace the "N of M" template with "NW · M total"**

Line 209 currently renders:

```tsx
{
  totalAttempts > 0 ? `${totals.forVal.toString()} of ${totalAttempts.toString()}` : '—'
}
```

Replace with (compact-wins-with-total phrasing — matches the FO W/L convention used by the Scoresheet):

```tsx
{
  totalAttempts > 0 ? `${totals.forVal.toString()}W · ${totalAttempts.toString()} total` : '—'
}
```

Renders `21W · 30 total` instead of `21 of 30`. Compact, hockey-conventional, no "of" ambiguity.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to `/games/250`. Box Score FACEOFFS tab summary should now read `70.0% 21W · 30 total` (was `70.0% 21 of 30`).

Curl sanity:

```bash
curl -s http://localhost:3000/games/250 | grep -oE "[0-9]+ of [0-9]+|[0-9]+W · [0-9]+ total" | sort | uniq -c
```

Expected: `21W · 30 total` appears; `21 of 30` does not.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/box-score.tsx
git commit -m "$(cat <<'EOF'
polish(matches/box-score): FACEOFFS tab summary — N of M → NW · M total

`21 of 30` read awkwardly — "of" is ambiguous (won-of-attempted vs
some other ratio). Switched to `21W · 30 total` which matches the
FO W/L convention already used by the Scoresheet's faceoff row
("21-9 W/L"). Hockey-conventional, compact, unambiguous.

Resolves UI review §5 issue #3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Adopt shared `formatPeriodLabel` for column headers

**Files:**

- Modify: `apps/web/src/components/matches/box-score.tsx` (top imports + lines 289 + 324-327 — `PeriodHeading` + its call site)

- [ ] **Step 1: Import `formatPeriodLabel`**

At the top of `box-score.tsx` (around line 5, alongside other `@/lib/*` imports), add:

```ts
import { formatPeriodLabel } from '@/lib/period-label'
```

- [ ] **Step 2: Compute the label inside `PeriodHeading` via the shared helper**

`PeriodHeading` currently takes both `label` and `number` as props (line 324-327). With `formatPeriodLabel(number)` available, the `label` prop becomes redundant. Replace:

```tsx
function PeriodHeading({ label, number }: { label: string; number: number }) {
  const isOt = number >= 4
  return <span className={isOt ? 'font-black text-fg-1' : ''}>{label}</span>
}
```

with:

```tsx
function PeriodHeading({ number }: { number: number }) {
  const isOt = number >= 4
  return <span className={isOt ? 'font-black text-fg-1' : ''}>{formatPeriodLabel(number)}</span>
}
```

(The Task 1 OT-color fix is preserved — only the label source changes.)

- [ ] **Step 3: Update the call site**

Line 289 currently passes both props:

```tsx
<PeriodHeading label={r.periodLabel} number={r.periodNumber} />
```

Drop the `label` prop (the helper derives it from `number`):

```tsx
<PeriodHeading number={r.periodNumber} />
```

`r.periodLabel` is no longer consumed in this surface — but it stays on the data row in case other surfaces need it (and it's harmless if unused here).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors. The `label` prop is removed from both the signature and the call site.

- [ ] **Step 5: Manual browser verification**

Navigate to `/games/250`. Box Score column headers should still read `1ST / 2ND / 3RD / OT / TOTAL` (no visible change for match 250). The fix is future-proofing — if OCR ever emits a longer-form `periodLabel` like `"2ND PERIOD"`, the table layout no longer breaks because the helper enforces the short form.

- [ ] **Step 6: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/box-score.tsx
git commit -m "$(cat <<'EOF'
refactor(matches/box-score): adopt shared formatPeriodLabel for column headers

Box Score column headers previously consumed `r.periodLabel` raw
from the data row, which is OCR-derived and could in principle emit
longer forms ("2ND PERIOD" instead of "2ND"). The other match-page
sections (Action Tracker, Faceoff Map) already use the shared
`formatPeriodLabel(n)` helper from lib/period-label.ts.

Dropped the `label` prop from PeriodHeading; the component now
derives its label from the period number via the shared helper.
Future-proofs the table layout against any OCR label-form drift.

No visible change for match 250 (OCR labels already short-form).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Heatmap tint on per-period winner cells (both teams)

**Files:**

- Modify: `apps/web/src/components/matches/box-score.tsx` (lines 350-367 — `BgmRow` cells, and lines 405-422 — `OppRow` cells)

- [ ] **Step 1: Add accent-red tint to BGM-won period cells**

The `BgmRow` per-cell render (lines 350-367) already computes `isPeriodWinner`. Add a conditional background tint to the cell className. Currently:

```tsx
{
  rows.map((r) => {
    const { forVal, againstVal } = getModeValues(r, mode)
    const isPeriodWinner = forVal !== null && againstVal !== null && forVal > againstVal
    return (
      <td
        key={r.id}
        className={`border-b border-zinc-800/40 px-3 py-3 text-center font-condensed text-[17px] tabular-nums ${
          forVal === null
            ? 'font-bold text-fg-5'
            : isPeriodWinner
              ? 'font-black text-accent'
              : 'font-bold text-fg-2'
        }`}
      >
        {forVal ?? '—'}
      </td>
    )
  })
}
```

Replace the className template with (add the `isPeriodWinner ? 'bg-accent/[0.04]' : ''` tint as a separate token):

```tsx
{
  rows.map((r) => {
    const { forVal, againstVal } = getModeValues(r, mode)
    const isPeriodWinner = forVal !== null && againstVal !== null && forVal > againstVal
    return (
      <td
        key={r.id}
        className={`border-b border-zinc-800/40 px-3 py-3 text-center font-condensed text-[17px] tabular-nums ${
          forVal === null
            ? 'font-bold text-fg-5'
            : isPeriodWinner
              ? 'font-black text-accent'
              : 'font-bold text-fg-2'
        } ${isPeriodWinner ? 'bg-accent/[0.04]' : ''}`}
      >
        {forVal ?? '—'}
      </td>
    )
  })
}
```

`bg-accent/[0.04]` is a 4% opacity tint — faint enough that it doesn't fight the text, just enough to read as a heatmap on a quick scan.

- [ ] **Step 2: Add neutral tint to OPP-won period cells**

`OppRow` (lines 405-422) is structurally identical. Apply the same pattern with a neutral tint (matches the page-wide BGM=accent / OPP=neutral convention):

```tsx
{
  rows.map((r) => {
    const { forVal, againstVal } = getModeValues(r, mode)
    const isPeriodWinner = againstVal !== null && forVal !== null && againstVal > forVal
    return (
      <td
        key={r.id}
        className={`border-b border-zinc-800/40 px-3 py-3 text-center font-condensed text-[17px] tabular-nums ${
          againstVal === null
            ? 'font-bold text-fg-5'
            : isPeriodWinner
              ? 'font-black text-fg-1'
              : 'font-bold text-fg-3'
        } ${isPeriodWinner ? 'bg-fg-4/[0.04]' : ''}`}
      >
        {againstVal ?? '—'}
      </td>
    )
  })
}
```

The `isPeriodWinner` check is reversed for OppRow (`againstVal > forVal` instead of `forVal > againstVal`) — read the existing code at line 407-408 to confirm the exact form and preserve it; the only change is the appended `${isPeriodWinner ? 'bg-fg-4/[0.04]' : ''}` token in the className template.

(If `bg-fg-4/[0.04]` doesn't compile as a Tailwind arbitrary-opacity value with a CSS var, fall back to `bg-zinc-500/[0.04]` — same neutral muted tint.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 4: Manual browser verification**

Navigate to `/games/250` (BGM won 4-3 in OT). Box Score table cells should now show:

- GOALS tab: 2ND period BGM cell tinted accent-red (BGM scored 2 to opp's 0); 3RD period OPP cell tinted neutral (opp scored 2 to BGM's 1); OT cell tinted accent-red (BGM scored the GWG)
- SHOTS tab: similar per-period winner tinting based on shot counts
- FACEOFFS tab: per-period faceoff-winner tinting

Read at a glance: BGM-dominant periods read as faint red bands across the row; OPP-dominant periods read as faint grey bands. Heatmap effect.

- [ ] **Step 5: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/box-score.tsx
git commit -m "$(cat <<'EOF'
feat(matches/box-score): two-team heatmap tint on per-period winner cells

Per-period winner is already computed for typography emphasis
(font-black + text-accent on BGM-won cells, font-black + text-fg-1
on OPP-won cells). Added a faint background tint following the
same pattern — accent-red @ 4% opacity for BGM-won cells, neutral
@ 4% opacity for OPP-won cells.

The tint is subtle enough not to fight the text but visible enough
to make the table read as a heatmap on a quick scan: BGM-dominant
periods show as faint red bands across the BGM row; OPP-dominant
periods show as faint grey bands across the OPP row.

Matches the page-wide BGM=accent / OPP=neutral convention
established by the bar/color sweep.

Resolves UI review §5 issue #10.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `⚠` emoji → red `●` for icon-family consistency

**Files:**

- Modify: `apps/web/src/components/matches/box-score.tsx` (lines 499-502 — missing-period footnote in `Footnotes`)

- [ ] **Step 1: Replace the `⚠` emoji with a red pulse-dot**

The missing-period footnote (lines 499-502) currently:

```tsx
{
  missingPeriods.length > 0 ? (
    <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
      ⚠ {missingPeriods.join(', ')} OCR unavailable — excluded from totals
    </span>
  ) : null
}
```

Replace with (red `●` mirrors the green `●` used by the OCR-reviewed badge below; same shape, color encodes meaning):

```tsx
{
  missingPeriods.length > 0 ? (
    <span className="inline-flex items-center gap-2 font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
      {missingPeriods.join(', ')} OCR unavailable — excluded from totals
    </span>
  ) : null
}
```

Switched outer `<span>` to `inline-flex items-center gap-2` (so the dot + text align on the baseline, matching the OCR-reviewed badge at lines 504-516). The dot is `bg-accent` (the page's red token), `aria-hidden` (decorative; the text carries the meaning).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual browser verification**

Navigate to a match with missing periods (if `/games/250` doesn't have any, the conditional won't fire — visually nothing changes there, but the typecheck verifies the JSX still compiles). For matches with missing periods, the footnote should now read `● 1ST OCR unavailable — excluded from totals` with a small red dot prefix instead of the `⚠` emoji.

The dot family now matches the green OCR-reviewed pulse-dot in the badge next to it — consistent icon language across both surfaces.

- [ ] **Step 4: Format + commit**

```bash
pnpm format
git add apps/web/src/components/matches/box-score.tsx
git commit -m "$(cat <<'EOF'
polish(matches/box-score): missing-period footnote ⚠ emoji → red ● dot

The `⚠` emoji prefix in the missing-period footnote was visually
inconsistent with the green `●` pulse-dot used by the OCR-reviewed
badge sitting alongside it. Two different icon families in adjacent
elements broke the section's typographic consistency.

Replaced `⚠` with a red `●` dot (same shape as the OCR badge's
green dot, color encodes "warning" vs "good"). Footnote container
switched to `inline-flex items-center gap-2` so the dot + text
align on the baseline, matching the OCR badge.

Resolves UI review §5 issue #6.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification (end-to-end, after all 5 commits)

1. **Typecheck:** `pnpm typecheck` — 0 errors.
2. **Format:** `pnpm format` — clean.
3. **Browser at `/games/250`** — Box Score walkthrough:
   - **Column headers:** `1ST / 2ND / 3RD / OT / TOTAL`. OT in bright off-white (not orange).
   - **GOALS tab body:** Per-period winner cells subtly tinted (BGM-dominant periods = faint red, OPP-dominant = faint grey). Existing GOALS delta indicator (commit `b0a614e`) unchanged.
   - **SHOTS tab body:** Same heatmap.
   - **FACEOFFS tab summary:** `70.0% 21W · 30 total` (was `70.0% 21 of 30`).
   - **OCR-reviewed badge:** still green `● OCR-reviewed · post-game`. No visible change.
   - **Missing-period footnote** (if applicable to other matches): red `● <period> OCR unavailable …` instead of `⚠`.
4. **Curl sanity:**
   - `grep -c "text-otl" → 0` for this file
   - `grep -c "21 of 30" → 0`
   - `grep -c "21W · 30 total" → ≥1`
   - `grep -c "⚠"` in box-score render → 0
5. **Git log review:** `git log --oneline -5` — five commits, each scoped.

## Out of Scope (follow-ups)

- **Three untracked plan files** (`docs/superpowers/plans/2026-05-17-bar-color-sweep.md` + `2026-05-17-scoresheet-polish.md` + `2026-05-17-action-tracker-polish-sweep.md`) — still uncommitted from prior sweeps; separate cleanup commit when convenient.
- **Other Box Score items closed today** — UI review §5 issue #1 (GOALS delta indicator) shipped earlier as commit `b0a614e`. After this sweep, only future-spec items remain (heatmap intensification, alternate metric tabs).
- **`text-otl` usage elsewhere on the page** — the OTL-loss result badge (hero card) and the OT-banner color in Event Timeline both still use `text-otl`. Those are semantically correct uses (badge = loss, banner = OT). Only Box Score's column-header use collided.
