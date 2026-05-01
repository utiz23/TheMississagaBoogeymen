# Matches Scores Page

## Summary

The `/matches` page is the club's **Scores** page.

It should behave like a **scoreboard wall**, not a generic database table and not an analytics dashboard. The page exists to help team members quickly scan:

- what games were played
- who the opponent was
- whether the club won, lost, or lost in overtime
- the score
- a small amount of trusted match context

This page should feel like a broadcast-style results board with strong hierarchy, fast scanning, and clean navigation into the single-game detail page.

## Product Role

Primary jobs:

1. Show recent and historical club matches in a scan-friendly way.
2. Make results visually obvious.
3. Group games in a way that feels like a real scores page.
4. Let users jump into `/games/[id]` for deeper detail.
5. Show only trusted, already-stored contextual match stats.

This is a **scoreboard-first** page, not a player-stat page.

## Core Principles

- Card-first, not table-first
- Group by date
- Score and result are the visual anchor
- Supporting stats are secondary
- Only use trusted/stored fields
- Whole card should be clickable
- Avoid fake analytics and noisy metadata

## Inspirations

Primary visual/structural influences:

- older internal wireframe: grouped-by-date match board
- NHL-style scoreboard reference: bold score tiles, strong result state, clean scanability

What to borrow:

- date-grouped score clusters
- bold score typography
- clear result pill
- responsive card grid
- a high-contrast card hierarchy that prioritizes score first, opponent second, context third

What not to borrow:

- giant league-wide simulation UI
- extra league-navigation clutter
- fake contextual detail that the current data model does not support

## Page Structure

Top to bottom:

1. Page header
2. Filter bar
3. Date-grouped results sections
4. Pagination / older-newer navigation

## Header

The top of the page should include:

- `Scores` page title
- short supporting copy such as `Club match history`
- optional current-title context like `NHL 26`

This header should stay concise. The page content is the main visual feature.

## Filters

### Required V1 filters

- `All`
- `6s`
- `3s`

### Optional V1.1 filters

- `Wins`
- `Losses`
- `OTL`

### Not for V1

- opponent search
- date range picker
- complex sort controls
- advanced stat filters

Default behavior:

- newest first
- grouped by date
- all modes shown unless a mode filter is selected

## Grouping

Matches should be grouped by play date.

Example section headers:

- `Apr 27`
- `Apr 25`
- `Apr 21`

Each date section contains a responsive grid/list of match cards.

This grouping is preferred over a single long list because it:

- feels like a real scores page
- helps users scan by session/night
- makes the archive more readable

## Match Card

The match card is the atomic unit of the page.

### Card content hierarchy

1. Meta strip
2. Main score row
3. Result pill
4. Opponent context
5. Compact stat strip
6. Navigation affordance

### 1. Meta strip

Top row should show:

- game mode pill: `6s` or `3s`
- played time/date

Keep this compact and subdued.

### 2. Main score row

This is the visual anchor of the card.

Recommended structure:

- opponent crest or initials fallback
- large centered score
- optional club-side identity treatment

The score should be:

- large
- condensed
- centered
- tabular

### 3. Result pill

Directly under or near the score:

- `WIN`
- `LOSS`
- `OTL`

Result state must be readable immediately.

### 4. Opponent context

Show:

- opponent name

Optional later:

- opponent record if trustworthy and easy

Do not overload this row.

### 5. Compact stat strip

Use only trusted stored match-level stats.

V1 supported stats:

- `SOG`
- `Hits`
- `FO%`
- `TOA`

Presentation guidance:

- short labels
- compact row or two-row strip
- clearly secondary to the score/result

### 6. Navigation

The card should link to `/games/[id]`.

Either:

- the entire card is clickable
- or include a subtle `View Match` affordance

The scoreboard page is the browse surface. The detail page holds the full game breakdown.

## Data Rules

Use only already stored / trusted match data.

### Canonical V1 fields

- `playedAt`
- `opponentName`
- `result`
- `scoreFor`
- `scoreAgainst`
- `gameMode`
- `shotsFor`
- `shotsAgainst`
- `hitsFor`
- `hitsAgainst`
- `faceoffPct`
- `timeOnAttack`
- opponent crest metadata when available

### Null handling

- if `FO%` is missing: show `—`
- if `TOA` is missing: show `—`
- do not invent opponent TOA
- if crest fails: use fallback initials

### Stats intentionally omitted in V1

- PIM
- PP stats
- pass completion
- player-level match summaries inside the card
- fake MVP / fake GWG logic unless already stored cleanly

These are omitted because they either:

- are nullable/noisy
- are one-sided without enough context
- or add clutter to a page whose main job is scanability

## Visual Direction

This page should feel like a **broadcast scoreboard wall**.

### Overall style

- dark shell
- bold score typography
- strong result pills
- subtle but meaningful card state differences

### Result state styling

- `WIN`: stronger accent / energy
- `LOSS`: muted / colder / lower-energy
- `OTL`: amber / distinct but not loud

Avoid turning the page into a rainbow of conflicting state colors.

### Card density

Cards should feel dense enough to scan quickly, but not cramped.

The eye order should be:

1. score
2. result
3. opponent
4. supporting stats

## Responsive Layout

### Desktop

- 2 or 3 cards per row depending on available width
- generous date section spacing

### Mobile

- 1 card per row
- keep score large
- keep result pill obvious
- compact stat strip can wrap or reduce spacing

## V1 Wireframe

```text
Scores
Club match history

[ All ] [ 6s ] [ 3s ]

APR 27
--------------------------------------------------

┌──────────────────────────────────────┐
│ 6s                            9:40PM │
│ vs Edmonton Wolves                    │
│                                      │
│ [crest]        4 – 2                 │
│               WIN                    │
│                                      │
│ SOG 28-21   Hits 14-9                │
│ FO% 53      TOA 8:12                 │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 3s                            8:55PM │
│ vs Calgary Burn                       │
│                                      │
│ [crest]        2 – 3                 │
│               OTL                    │
│                                      │
│ SOG 20-18   Hits 8-11                │
│ FO% —       TOA 6:41                 │
└──────────────────────────────────────┘
```

## Navigation and Behavior

- newest matches first
- grouped by date
- filtered by mode when selected
- cards navigate to match detail

If pagination already exists, preserve it.

Preferred V1 behavior:

- `Older Results`
- `Newer Results`

Do not overcomplicate page navigation.

## Non-Goals

Not for this pass:

- advanced analytics dashboards
- player box scores on the main scores page
- heavy search/filter UI
- season-simulation league browser behavior
- multi-layer opponent scouting info

## Recommended Build Order

1. Restructure `/matches` into date-grouped cards
2. Make score and result the dominant hierarchy
3. Add the trusted compact stat strip
4. Tighten responsive behavior
5. Keep pagination/load-older mechanics simple

## Acceptance Criteria

- Page reads as a scores board, not a table dump
- Matches are grouped by date
- Score is the strongest visual element
- Result state is obvious at a glance
- Only trusted/stored stats are shown
- Match cards are clickable and lead to detail pages
- Desktop and mobile both remain readable
- No fake analytics or noisy metadata creep into V1

## V1.1 Candidates

Possible later enhancements:

- sticky filter bar
- collapsible older date groups
- recent form streak strip
- result trend pills
- stronger featured-game treatment for latest / biggest result

These are explicitly later, not required for V1.
