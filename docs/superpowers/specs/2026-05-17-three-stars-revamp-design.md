# Three Stars (Top Performers) Revamp — Design

**Status:** approved · drafted 2026-05-17
**Component:** `apps/web/src/components/matches/top-performers.tsx`
**Page:** `/games/[id]` match recap

## Motivation

The shipped Top Performers component renders three cards with gold / silver / bronze gradient backgrounds and color-coded position pills (the canonical `PositionPill`, palette per [docs/specs/position-colors.md](../../specs/position-colors.md)). The gradients fight the broadcast-strip aesthetic — they read as a wedding cake. The color-coded position pills are correct everywhere else on the site, but on the **star card** they compete with the rank signal for the eye: there's no way to tell at a glance that "this card is the 1st star" when each card carries a different vivid hue. The hero score number lives alone with no visual answer to "why is it 14.28?"

The expanded "Show all player scores" panel groups by team (BGM block, then opponent block). That makes it easy to scan your team but hard to spot cross-team standouts — and the recent DtW work made cross-team ranking visible everywhere else on the page.

The revamp:
- Replaces the gold/silver/bronze gradient cards with brand-surface cards, applying the **scoreboard color rule** (winner takes the accent) — rank 1 gets the red wash, rank 2 paper, rank 3 plain. Accent belongs to **rank**, not team or position.
- Adds **portrait + jersey + team chip + position chip** to each card. The position chip is a **plain zinc pill** here — not the canonical color-coded `PositionPill` used elsewhere — because the star card's job is to make rank the lone color signal. The site-wide position palette is unchanged.
- Adds a **"vs season avg" delta** under the score so the user knows how unusual this player's performance was for their season.
- Adds a **mini stacked breakdown bar + legend** showing which factors built the score.
- Replaces the grouped BGM/OPP expanded panel with a **flat ranked table** (1..N across both teams), top 3 highlighted, click-to-expand rows revealing the existing per-factor breakdown table. Single open at a time; default closed.

## Visual design

### Three star cards

Grid of three cards, ordered **1 → 2 → 3 left to right** (1st star on the left). Cards stack vertically on mobile (rank 1 on top).

Rank-aware emphasis (the scoreboard color rule):

| Rank | Card background | Border | Score color | Portrait border | Jersey color | Stars |
|------|-----------------|--------|-------------|-----------------|--------------|-------|
| 1 | `linear-gradient(180deg, rgba(232,65,49,0.06), surface 40%)` + 2px ticker strip on top | accent-line | accent (with `0 0 14px rgba(232,65,49,0.22)` glow) | accent + soft red glow | accent | ★★★ in accent (glow) |
| 2 | `linear-gradient(180deg, rgba(235,235,235,0.04), surface 40%)` | default | paper (`--color-fg-1`) | default | paper | ★★ in paper |
| 3 | plain surface | default | secondary text (`--color-fg-2`) | default | paper | ★ in secondary |

The accent is **rank-bound, not team-bound**. If the opponent's player is the 1st star, the card still gets the red wash — but the team chip says (e.g.) "4TH" not "BGM".

Card body, top to bottom:

1. **Header row** — "First / Second / Third Star" label (uppercase, condensed, wide tracking) + ★ star glyphs (right-aligned). On rank 1, the label is accent; rank 2 paper; rank 3 dim.
2. **Identity row** — 64px circular portrait silhouette (matching the Lineup card silhouette), gamertag + persona/full name stacked, jersey "#NN" on the right. The portrait uses the existing silhouette SVG.
3. **Meta chips** — team chip (BGM accent-soft / OPP paper-on-charcoal) + position chip (plain zinc pill). Two chips per card.
4. **Score block** — hero score (~56px, condensed, black, tabular) + a stacked label: "Game score" + signed "**+4.3** vs season avg" (green for positive, red for negative). The delta line hides when `vsSeasonAvg` is null (opponent, or BGM with no prior season games).
5. **Stat line** — six inline `kv` pairs: G · A · +/− · SOG · Hits · TOA. For centers, swap Hits → FO%. Each kv stacks the uppercase label over the tabular value; +/− tints win-green or loss-red.
6. **Score breakdown** — slim stacked horizontal bar at the card foot. Each segment widths = `component.value / score`. Segment colors: goals = accent, assists = paper, +/− = win/loss, SOG = accent-soft strong, FO = accent-soft light, TOA = `--color-fg-3`, hits = `--color-fg-4`. Inline legend underneath with the swatch + label + signed numeric contribution.

The whole card is wrapped in an `<a href="/roster/[id]">` for BGM players; opponent cards render as a plain `<article>` (no profile page exists for them).

### Show all player scores

A real `<button>` styled as the brand "module button": full-width panel border, `▰` accent glyph + "Show all player scores" + right-aligned player count + caret. Default closed (`aria-expanded="false"`).

When open, reveals a single flat `<table>` ranked by score desc.

**Columns**:

| Column | Behavior |
|--------|----------|
| # (rank) | "1" + ★★★ stars on rank 1; "2" + ★★; "3" + ★; plain number from rank 4 down. Click-target for expand. |
| Team + Position | BGM/OPP chip + position pill. |
| Player | Gamertag in condensed-bold uppercase. Wrapped in `<Link href="/roster/[id]">` for BGM, plain text for OPP. |
| G | Goals, right-aligned tabular. |
| A | Assists. |
| +/− | Plus/minus, tinted win-green or loss-red. |
| SOG | Shots on goal. |
| TOA | Time on attack, formatted `m:ss`. For **goalies**, this cell shows "SV%" instead. |
| Score | Composite. Accent on rank 1; paper-white on ranks 2 & 3; secondary on the rest. Larger font-weight. |

Row treatment:
- Rank 1 row gets a soft `rgba(232,65,49,0.06)` background wash. Ranks 2 and 3 keep the default surface but render their rank cell in accent.
- Every row is a click-to-expand `<button>` (visually a `<tr>`). One row open at a time — opening row X closes any previously-open row.
- Expanded state inserts a child `<tr>` whose single `<td colspan>` hosts the existing **factor × weight = contribution** breakdown table — same data and layout that ships today, just transplanted from the grouped panel into a flat-table row.

**Goalies** appear in the same flat table by composite score. Their G / A / +/− / SOG cells render `—`. The TOA cell becomes SV%. Their expanded breakdown uses goalie-appropriate factors (Saves, GA, SV%, Pokechecks, etc.) — the existing `goalieBreakdown` already returns the right shape.

**Empty / missing-data**:
- Whole `<TopPerformers>` section hides when `performers.length === 0 && allTeamScores.length === 0` (same gate as today).
- "Show all" button text shows the actual count: `"12 players"`.
- An individual player with no recorded activity is already filtered out upstream by `hasRecordedActivity`.

### Mobile (< 640px)

- Cards stack vertically, 1 on top → 3 on bottom. Same rank logic (accent stays on rank 1).
- Inside the card: portrait + jersey + identity row stay as one horizontal row; stat-line wraps to two rows if it has to; breakdown bar + legend run full card width.
- The show-all table hides lower-priority columns (TOA, Hits, SOG) via `hidden sm:table-cell`. **Rank · Player · G · A · Score** are always visible.
- Expanded factor breakdown on mobile renders as a stacked label/value list rather than a 4-column table.

## Data model

### New DB query

Add to the existing player-queries file (`packages/db/src/queries/players.ts` or equivalent):

```ts
/**
 * For each BGM player, compute their average composite score across matches
 * in the same game-title played BEFORE the given timestamp.
 *
 * The composite score formula must match `buildAllTeamScores`/`toEntry` in
 * apps/web/src/lib/match-recap.ts — we compute it from raw player_match_stats
 * rows so the average reflects exactly what the UI shows per match.
 *
 * Returns null entries for players with zero prior games this season.
 */
export function getPlayerSeasonAvgScores(
  gameTitleId: number,
  playedAt: Date,
  playerIds: number[],
): Promise<Map<number, { avgScore: number; gp: number }>>
```

Implementation note: the cleanest approach is to fetch the raw `player_match_stats` rows for the requested players + game-title + `playedAt < $1` window, then reuse the same `skaterBreakdown` / `goalieBreakdown` helpers from `match-recap.ts` to compute the same composite score per match, then average. This avoids divergence between "score on the card" and "score the average is built from." If those helpers can't be moved server-side, we replicate the formula in the query with a shared constants file as the single source of truth.

### View-model

In `apps/web/src/lib/match-recap.ts`:

```ts
export interface TopPerformerWithDelta extends TopPerformer {
  /**
   * Signed delta vs the player's season-to-date average score, before this
   * match. null for opponent players (no profile) and for BGM players with
   * zero prior games in the current game-title.
   */
  vsSeasonAvg: number | null
}

export function attachSeasonAvgs(
  performers: TopPerformer[],
  seasonAvgs: Map<number, { avgScore: number; gp: number }>,
): TopPerformerWithDelta[]
```

`buildTopPerformers` stays unchanged; the augmentation is a separate step so the page can call the query independently and inject the delta.

### Page wiring

`apps/web/src/app/games/[id]/page.tsx` adds one call to the existing `Promise.all`:

```ts
safe(() => getPlayerSeasonAvgScores(m.gameTitleId, m.playedAt, bgmPlayerIds), new Map())
```

where `bgmPlayerIds` is derived from `playerStats`. Then:

```ts
const topPerformers = attachSeasonAvgs(
  buildTopPerformers(match, playerStats, opponentPlayerStats),
  seasonAvgs,
)
```

`<TopPerformers performers={topPerformers} allTeamScores={allTeamScores} opponentLabel={match.opponentName} />` — same callsite, augmented props.

## Component shape

### TopPerformers (Server Component)

```tsx
interface TopPerformersProps {
  performers: TopPerformerWithDelta[]   // always 3 or fewer, score-sorted
  allTeamScores: PlayerScoreEntry[]     // full ranked list for the expander
  opponentLabel: string
}
```

Renders:
1. `<SectionHeader label="Top Performers" subtitle="Computed from player stats" />`
2. Grid of 0–3 `<StarCard>` server components.
3. `<ShowAllPlayerScores entries={allTeamScores} opponentLabel={opponentLabel} />` client component.

### StarCard (Server Component)

```tsx
interface StarCardProps {
  rank: 1 | 2 | 3
  performer: TopPerformerWithDelta
  /** Inline breakdown segments and legend values — already on PlayerScoreEntry. */
  breakdown: ScoreFactor[]
}
```

Pure presentational — no client state. The full performer breakdown is included on the existing `PlayerScoreEntry`, so the page passes the matching entry's `breakdown` through to the card.

### ShowAllPlayerScores (Client Component)

```tsx
'use client'

interface ShowAllPlayerScoresProps {
  entries: PlayerScoreEntry[]   // flat, sorted by score desc, BGM + opponent
  opponentLabel: string
}
```

Owns two pieces of state:
- `panelOpen: boolean` — whether the full table is visible (default `false`).
- `openRow: number | null` — index of the currently-expanded row (default `null`).

Clicking a row sets `openRow` to that index, or back to `null` if it was already open (toggle). Opening row X closes any previously-open row.

## What gets deleted

From `apps/web/src/components/matches/top-performers.tsx`:
- `cardClass()` — gold/silver/bronze switch. Delete.
- `PerformerCard` — replaced by `<StarCard>` in a new file.
- `ScoreGroup` — grouped BGM/OPP rendering. Delete.
- `ScoreRow` — replaced by the flat-table row in `<ShowAllPlayerScores>`.

**Keep and move** (do not duplicate):
- `BreakdownTable` and `FactorRow` — the per-factor breakdown table is reused inside the flat-table expanded row. Move them to `show-all-player-scores.tsx` (or a shared helpers file if it ends up being used in more than one place).

**Position chip on the star card** — does NOT use the canonical color-coded `PositionPill`. Instead the card renders a plain zinc pill inline (one-off styling, the same one used in the show-all table and the design bundle). This is deliberate (see Motivation). The canonical `PositionPill` is unchanged and still used on the scoresheet, depth chart, lineup section, etc.

**Show-all flat table** uses the same plain zinc pill, also for consistency with the cards.

## Accessibility

- Star rank communicated by **text label** ("First Star" / "Second Star" / "Third Star") AND ★ glyphs. Screen readers get the words; sighted users get the glyphs.
- Each card has an `aria-label` summarizing the highlight: `"First Star: MrHomiecide, score 14.28, 1 goal 2 assists, plus 1"`.
- The "Show all player scores" expander is a real `<button>` with `aria-expanded` and `aria-controls`.
- Row-expand triggers are `<button>` elements (one per row) with their own `aria-expanded` + `aria-controls` pointing at the inserted breakdown row.
- The table is a real `<table>` with `<th scope="col">` so screen readers announce column meanings.
- Mobile column-hiding is `hidden sm:table-cell` (Tailwind) — the hidden columns are also hidden from the accessibility tree, so screen readers don't read empty data.

## Out of scope

- Animated stars reveal (3rd → 2nd → 1st countdown).
- Per-column sort in the flat table — always sorted by score desc.
- Cross-game career score history — lives on the player profile page.
- Tooltip explaining the score formula — could live on the score number in a future iteration.

## Implementation order (high level)

1. Add `getPlayerSeasonAvgScores` query + supporting test data.
2. Add `TopPerformerWithDelta` + `attachSeasonAvgs` to `match-recap.ts`.
3. Wire the query into `/games/[id]/page.tsx`.
4. Build `<StarCard>` server component (new file).
5. Build `<ShowAllPlayerScores>` client component (new file).
6. Rewrite `<TopPerformers>` to orchestrate the two.
7. Delete the old `PerformerCard`, `ScoreGroup`, `ScoreRow`, `cardClass` helpers.
8. Mobile checks at 360px / 640px.
9. Verify a11y attributes via DOM inspection.
