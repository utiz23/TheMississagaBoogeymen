# Box Score (Period Summary) Revamp — Design

**Status:** approved · drafted 2026-05-17
**Replaces component:** `apps/web/src/components/matches/period-summary.tsx`
**Page:** `/games/[id]` match recap

## Motivation

The match recap page currently has two sections that read like "box scores":

1. `<TeamStats>` — labeled "**Box Score**". Renders team-aggregate totals across four groups (Offense, Possession, Defense, Goalie). ~15-20 rows, no per-period breakdown.
2. `<PeriodSummary>` — labeled "**Period Summary**". Renders four cards (P1/P2/P3/Total) with Goals/Shots/Faceoffs shown on every card.

The hockey-canonical use of the term "box score" is the period-by-period table — what we currently call "Period Summary". The naming is wrong, and the per-card-shows-all-three-stats layout makes none of the three categories the focus.

The user iterated on a mockup that introduced mode tabs (Goals/Shots/Faceoffs) and a period card grid. They kept the direction but felt the result was "convoluted" — three different per-mode cell treatments (giant scoreboard / split bars / pct chips), an asymmetric wider Total card, a redundant bottom "summary strip", and OT support that wasn't visible in the rendered example.

This revamp:

- Renames section #1's header `"Box Score"` → `"Team Stats"` to free the canonical name.
- Replaces `<PeriodSummary>` with a new `<BoxScore>` component using mode tabs + a plain HTML table (periods as columns, teams as rows).
- Drops the mode-specific cell treatments — same table structure for every mode, only the values change. The eye stays anchored when tabbing modes.
- Drops the bottom "summary strip" — its data already lives in the tab summaries and the Total cell.
- Adds OT support that's visible: OT columns insert between the last regulation period and Total.
- Defaults to Goals mode per the brief.

## Visual design

### Section header

```
SectionHeader
  label="Box Score"
  subtitle="Period-by-period · OCR-reviewed"
```

`<TeamStats>` (currently labeled "Box Score") has its label updated to `"Team Stats"` to avoid the collision. Subtitle stays `"Team totals and aggregate stats"`. Otherwise unchanged.

### Mode tabs

A three-column segmented control inside a bordered panel. Each tab is a `<button>` with `role="tab"` inside a `role="tablist"` container.

Each tab carries:

- **Label** — `"Goals"` / `"Shots"` / `"Faceoffs"` (font-condensed, uppercase, tight tracking, 11px).
- **Summary** — the mode's headline:
  - Goals: `"5 – 3"` (BGM accent on winner side; opp side `--color-fg-3`).
  - Shots: `"36 – 28  +8"` (delta in `--color-win` green when BGM ahead, `--color-loss` red when behind; tied = no delta).
  - Faceoffs: `"62.2%  28 of 45"` (pct large, raw split smaller and dimmer; pct is BGM-perspective).

Active tab gets:

- 2px accent ticker strip on top (uses existing `.ticker-strip ticker-strip-thin` utility),
- Soft red wash background gradient,
- Accent-colored label and summary.

Default: Goals. Mode state is local React state; no URL/storage persistence (out of scope).

Keyboard interaction:

- Arrow Left / Right cycle between tabs (roving tabindex pattern — only the active tab has `tabIndex={0}`, others are -1).
- Home / End jump to first / last.
- Enter / Space activate the focused tab.
- `aria-selected` reflects current mode; `aria-controls` points at the table id.

### The table

A single `<table>` with:

- One `<thead>` row of `<th scope="col">` cells: `Team · P1 · P2 · P3 [· OT · OT2 · OT3] · Total`.
- One `<tbody>` row per team (BGM first, opponent second). The team-name cell is `<th scope="row">`.
- For Faceoffs mode only, one secondary `<tr>` directly under the BGM row carrying per-period win percentages (see below).

Period columns:

- Each is named after `MatchPeriodSummaryRow.periodLabel` (e.g. `"1st"`, `"OT"`, `"OT2"`). OT/OT2/OT3 labels render in `--color-otl` amber.
- A period that exists in `rows` gets a column. Periods missing from `rows` (e.g. game ended in regulation) are simply not rendered — no empty placeholder.
- A period that exists but has no value for the active mode renders `—` in muted text (`--color-fg-5`) and is excluded from the Total computation.

Total column:

- Always present, always rightmost.
- Larger font (24px vs 17px for period cells), soft red wash background (`rgba(232,65,49,0.04)`), 1px accent-line left border.
- BGM cell uses `--color-accent` when BGM is the mode winner, paper otherwise; the winner cell gets a soft text-shadow glow. Opponent cell uses paper when winner, `--color-fg-3` when not.

Cell values:

- **Goals** mode — integer goals per period (e.g. `2`).
- **Shots** mode — integer shots per period (e.g. `12`).
- **Faceoffs** mode — integer faceoff **wins** per period (e.g. `8`). The pct row carries the percentage.

Per-period winner cells:

- BGM cell when `goalsFor > goalsAgainst` (or `shotsFor > shotsAgainst` / `faceoffsFor > faceoffsAgainst`) gets the accent color + bold weight.
- Opponent cell when opp leads that period: cell value rendered in paper white + bold (no accent — accent stays a BGM signal).
- Tied period: both cells stay default colors (BGM `--color-fg-3`, opp `--color-fg-3`).

### Faceoff percentage row

When mode is `"faceoffs"`, a thin secondary `<tr>` renders directly under the BGM win-counts row. It shows the per-period BGM faceoff percentage:

```
       P1     P2     P3      OT     Total
BGM    8      9      11      0      28          ← wins
       53.3%  60.0%  73.3%   —      62.2%       ← pct (this row)
RVN    7      6      4       0      17          ← opp wins
```

The pct row uses font-size 10px, `--color-fg-3` for non-winner periods, `--color-accent` when BGM took that period. Cells for periods without faceoff data render `—`. The opponent does NOT get a pct row — the BGM row's pct already implies it (`100 - bgmPct`).

The row's first cell is a `<th scope="row">` containing a visually-hidden label (`"BGM faceoff percentage by period"`) so screen readers can associate the percentages with BGM. Visually the cell is empty.

This is the only mode-specific structural deviation. Goals and Shots modes render exactly two table rows.

### Missing-OCR period footnote

When `computeTotals` excludes any period (because its `<mode>For` and `<mode>Against` are both null), a small text line renders directly below the table:

```
P2 OCR unavailable — excluded from totals
```

Font-condensed, 10px, `--color-fg-5`, uppercase, wide tracking. The list of excluded period labels is comma-separated for multi-period cases. Not announced separately to AT — the `—` cells already communicate the gap; this is a sighted-user provenance disclosure.

### Provenance footnote

A single line below the table (same row as the missing-OCR footnote, when both apply):

```
● OCR-reviewed · post-game · 0.96 conf
```

10px font-condensed, `--color-fg-5`, the leading dot is a 6px `--color-win` emerald circle to signal the data is reviewed/trusted. When no OCR exists and the source is EA totals only, the line reads `EA · official` with a paper-colored dot instead.

## Component shape

### `<BoxScore>` (client component)

```tsx
// apps/web/src/components/matches/box-score.tsx
'use client'

import type { MatchPeriodSummaryRow } from '@eanhl/db/queries'

interface BoxScoreProps {
  rows: MatchPeriodSummaryRow[]
  opponentLabel: string
}

export function BoxScore({ rows, opponentLabel }: BoxScoreProps): JSX.Element | null
```

Returns `null` when `rows.length === 0` (same gate as the current `<PeriodSummary>`).

Internal structure:

- `<SectionHeader>` (existing component).
- `<ModeTabs>` (private to this file) — three buttons + roving tabindex + `tablist` role.
- `<BoxScoreTable>` (private) — the table itself, takes `mode` + `rows` + `opponentLabel` + the `bgmAbbrev`.

State owned: `mode: 'goals' | 'shots' | 'faceoffs'`, default `'goals'`. No URL state.

### Helper: data derivation

Three small pure helpers in the same file (or hoisted to `match-recap.ts` if reused later):

```ts
type BoxScoreMode = 'goals' | 'shots' | 'faceoffs'

interface ModeValues {
  for: number | null
  against: number | null
}

function getModeValues(row: MatchPeriodSummaryRow, mode: BoxScoreMode): ModeValues
// → goals: { for: row.goalsFor, against: row.goalsAgainst }, etc.

function computeTotals(
  rows: MatchPeriodSummaryRow[],
  mode: BoxScoreMode,
): { for: number | null; against: number | null; missingPeriods: string[] }
// Sums each side across periods where BOTH values are non-null.
// Periods where either side's value is null go into missingPeriods (using periodLabel).
// When zero periods have any value for the active mode, `for` and `against` are both
// null — the Total cell renders `—` instead of `0`.

function computeFaceoffPct(wins: number | null, oppWins: number | null): number | null
// BGM faceoff %. Returns null when either side is null or sum is zero.
```

### Page wiring

`apps/web/src/app/games/[id]/page.tsx`:

```diff
- import { PeriodSummary } from '@/components/matches/period-summary'
+ import { BoxScore } from '@/components/matches/box-score'

  …

- <PeriodSummary rows={periodSummaries} />
+ <BoxScore rows={periodSummaries} opponentLabel={match.opponentName} />
```

`<TeamStats>` keeps everything except its `SectionHeader` label, which becomes `"Team Stats"`.

## Deletions

- `apps/web/src/components/matches/period-summary.tsx` — full file. The `PeriodCard` + per-card pattern is not reused elsewhere; search confirms only `page.tsx` imports it.

## Mobile (< 640px)

- Mode tabs collapse to two-line labels (label on top, summary below) so all three still fit at 360px.
- Table keeps the same column structure. When period count gets large (3 regulation + 3 OT + Total = 7 columns), wrap the table in `<div className="overflow-x-auto">` so it scrolls horizontally inside its container without breaking layout.
- Faceoff pct row stays a single secondary row on mobile — no special collapse.
- Footnotes stay below the table; they wrap normally.

## Accessibility

- Mode tabs implement the WAI-ARIA tabs pattern: `role="tablist"` on the container, `role="tab"` on each button, `aria-selected` reflects mode, `aria-controls` points at the table id, roving tabindex (only active tab has `tabIndex={0}`).
- Keyboard: Arrow Left/Right cycle, Home/End jump, Enter/Space activate. The pattern is the canonical accessible-tabs implementation; verify with NVDA / VoiceOver during implementation.
- Table is a real `<table>` with `<th scope="col">` and `<th scope="row">`. The Total column header is also `scope="col"`. Screen readers will read "BGM, P1, 2 / BGM, P2, 1 / BGM, P3, 2 / BGM, Total, 5" — natural.
- Winner emphasis is both **color and weight** (accent color + font-black). Not color-only.
- The footnote text is plain prose, no ARIA. Visual placement directly under the table makes the association obvious.

## Data flow

No DB schema changes. Existing `getMatchPeriodSummaries(matchId)` query already returns the row shape we need (filter applied for `source IN ('ea', 'ocr', 'manual')` with reviewed status — already in place).

The `rows` prop passes through unchanged from the page. `opponentLabel` is `match.opponentName`, abbreviated inside the component using the existing `abbreviateTeamName` helper to render the team-row label (BGM is fixed; opponent is e.g. "RVN", "4L").

## Out of scope

- Per-period stoppage / power-play splits — not in OCR contract.
- Mode toggle persisting via URL or localStorage.
- "Best period" callouts — redundant with the visible table.
- Comparison vs last meeting / season averages — wrong page for it.
- Per-period shot-type breakdown — that's `<ShotMix>`'s job.
- Animated transitions when switching modes — table re-renders normally; no fade or slide.

## Implementation order

1. Create `apps/web/src/components/matches/box-score.tsx` with the component + helpers + tabs.
2. Rename `<SectionHeader>` label in `apps/web/src/components/matches/team-stats.tsx`: `"Box Score"` → `"Team Stats"`.
3. Update `apps/web/src/app/games/[id]/page.tsx`: swap the import and the JSX call.
4. Delete `apps/web/src/components/matches/period-summary.tsx`.
5. Manual visual checks on `/games/250`: each mode tab renders correctly, winner cells colored, Total cell emphasized, faceoff pct row visible only on Faceoffs mode, footnote appears for the actual OCR state of match 250.
6. Mobile check at 360px: tabs fit on two lines, table scrolls horizontally if needed.
7. Keyboard check: arrow keys cycle tabs, Tab moves into and out of the tablist as a single stop.
