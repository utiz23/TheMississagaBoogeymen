# Match Detail Page

## Summary

The `/games/[id]` page is the club's **single-game recap and archive** page.

It should work like a dense internal **game sheet**:

- fast to scan
- grounded in trusted stored match data
- useful for checking how one game went
- strong enough visually to feel important

This page is **not** a full NHL GameCenter clone and should not pretend to support data the system does not actually track.

## Product Role

Primary jobs:

1. Show what happened in a specific match quickly.
2. Surface who performed best for BGM.
3. Show the full BGM player line sheet for that game.
4. Provide enough match context to make the game memorable in the season archive.

This page is a **match recap first**, not a generic database detail page and not a fake broadcast product.

## Core Principles

- Single long page, not tabs
- Score and result are the visual anchor
- Use only trusted match and player-match data
- Derived sections are acceptable only if clearly labeled
- Unsupported data should be omitted, not faked
- Player-level detail is BGM-only unless opponent player data exists later

## Inspirations

Primary influences:

- internal game-sheet mockup: strong hero, stats, performer callouts, player line sheet
- NHL GameCenter: score-first recap structure, strong top block, team stat framing
- Chelhead match pages: useful derived context like mode and pressure / quality feel
- esports match pages: compact match story modules, strong performer highlights, clear archive utility

What to borrow:

- strong score block
- standout-performer cards
- team stat comparison
- contextual metadata like mode and same-opponent context
- one-page recap layout

What not to borrow:

- fake play-by-play
- fake shot maps
- giant public-broadcast clutter
- official-sounding labels for computed values

## Page Structure

Top to bottom:

1. Back link + hero score card
2. Story strip
3. Box score summary / team stats
4. Goalie spotlight
5. BGM scoresheet
6. Context footer

## Hero Score Card

The hero is the visual anchor of the page.

It should include:

- back link to `/games`
- BGM crest / mark
- opponent crest or initials fallback
- large final score
- result pill: `WIN`, `LOSS`, `OTL`
- opponent name
- played date/time
- mode pill: `6s` or `3s`
- compact metadata line when cheap and trustworthy

Good metadata examples:

- `Game 47`
- `3rd meeting vs MTL`
- DNF finish note if this is later ingested

The hero should feel like a proper postgame header, not just a row of text above a table.

## Story Strip

This section should sit directly below the hero and provide the story of the game at a glance.

It contains two modules:

1. `Top Performers (computed)`
2. `Possession & Pressure Edge (computed)`

### Top Performers (computed)

This is the honest replacement for `3 Stars`.

Rules:

- based on **BGM player match stats only**
- clearly labeled as computed
- not presented as official stars

Each performer card should show:

- gamertag
- position pill
- short stat line
- link to player profile

Recommended ranking inputs:

- skaters: goals, assists, plus-minus, shots, hits
- goalies: saves, save %, goals against suppression

Keep the formula simple and transparent. Do not turn it into fake science.

### Possession & Pressure Edge (computed)

This is the honest replacement for `Deserve To Win`.

Rules:

- derived only from trusted team-level match stats
- clearly labeled as computed
- hide or degrade gracefully if required source values are missing

Recommended inputs:

- shot share
- faceoff share
- time on attack share
- hit share as a lighter factor

Presentation:

- one comparison bar between BGM and opponent
- show the key input numbers nearby

Preferred label:

- `Possession & Pressure Edge (computed)`

Alternative acceptable label:

- `Quality Index (computed)`

## Box Score Summary / Team Stats

This is the main factual middle section.

It should show trusted team totals in a side-by-side comparison format.

Recommended rows:

- Shots / SOG
- Hits
- Faceoff %
- Time on Attack
- Penalty Minutes
- Passing
- Power Play

Passing should use:

- `passCompletions / passAttempts`
- optional percentage if it reads cleanly

Power Play should use:

- `ppGoals / ppOpportunities`

Rules:

- only show metrics that are actually stored and trustworthy
- if a stat is null or incomplete, hide it or render it honestly
- do not invent opponent-side values for fields that do not exist

This section keeps the useful idea of a `box score`, but **does not** include fake period-by-period rows.

## Goalie Spotlight

If a goalie played for BGM, show a dedicated goalie summary above the full player table.

Purpose:

- use the richer goalie data already stored
- avoid burying all goalie-specific detail inside one mixed player table
- make the page feel more complete without needing new data

Recommended content:

- goalie name
- saves
- goals against
- save %
- shots against

Optional extras if they still read cleanly:

- breakaway saves
- penalty-shot saves
- desperation saves
- pokechecks

If no goalie data exists for the match, omit this section entirely.

## BGM Scoresheet

This is the deepest trustworthy section on the page.

Important note:

- `Per-player stats are tracked for BGM only.`

The scoresheet should show the full BGM match table.

Recommended skater columns:

- Player
- Pos
- G
- A
- PTS
- +/-
- SOG
- Hits
- PIM
- FO W-L or FO%
- TOI
- Pass %
- Blocks if available cleanly

Recommended goalie columns:

- Goalie
- SV
- GA
- SV%
- Shots Against

Enhancements:

- player name links to `/roster/[id]`
- position color pills
- sortable only if cheap and natural to add

This is the correct place for the player line sheet. Do not try to fake an opponent player box.

## Context Footer

This is a low-cost context block at the bottom of the page.

Include if cheap:

- previous game
- next game
- same-opponent season series context

Examples:

- `Previous game`
- `Next game`
- `3rd meeting vs MTL — BGM leads 2-1`

If scope needs to shrink, this is the first section to cut.

## Buildable Now vs Derived vs Deferred

### Buildable now

- current hero foundation
- mode pill
- expanded team stats with passing and power play
- improved BGM scoresheet
- goalie spotlight
- previous / next game navigation
- same-opponent season-series context if easy

### Buildable with transparent heuristics

- Top Performers (computed)
- Possession & Pressure Edge (computed)
- game-number / meeting-number context if query logic is simple and trustworthy

### Deferred / blocked

Do not fake any of these:

- period-by-period scoring
- play-by-play / goal log
- event map / heatmap
- opponent player scoresheet
- momentum / win-probability chart
- official 3 stars
- auto-generated recap prose
- highlight / VOD rail

## Data Rules

### Trusted sources for V1

- match-level stored totals from `matches`
- BGM player-level match data from `player_match_stats`
- opponent crest / club metadata when available

### View-model guidance

Add or use a match-page-focused loader/view-model that centralizes:

- hero metadata
- comparison stats
- Top Performers inputs and output
- Possession & Pressure Edge inputs and output
- goalie spotlight data
- scoresheet rows
- context footer data

Keep formulas and section-readiness logic out of the page component body where possible.

## Test Plan

### Data behavior

- match page loads when core match totals exist
- nullable stats do not produce bogus comparisons
- computed modules hide or degrade when required inputs are missing
- BGM-only scoresheet renders cleanly without implying opponent player data exists
- goalie spotlight only renders when goalie data exists

### UX behavior

- hero remains readable on mobile
- Top Performers cards degrade gracefully for low-stat matches
- scoresheet remains usable on smaller screens
- computed labels are visible and honest
- no section implies unsupported data like period splits or event locations

### Acceptance scenarios

- normal regulation win
- overtime loss
- sparse older match with missing TOA or FO%
- match with missing opponent crest
- goalie-heavy performance where the goalie should be surfaced
- low-event match where computed sections still stay believable

## Explicit Non-Goals

Not for V1:

- fake event-map placeholder
- fake goal log / scoresheet timeline
- fake period rows with blanks or dashes
- fake opponent player sheet
- giant public-broadcast UI clutter

If the data is not there, the UI should not pretend otherwise.

## Build Order

1. Strengthen the hero with mode + context metadata
2. Add the story strip
3. Expand the team stats / box score summary
4. Add goalie spotlight
5. Improve the BGM scoresheet
6. Add context footer last

## Assumptions

- V1 is a **single-page game sheet**
- the page is **internal-first**
- computed modules are acceptable if clearly labeled
- player-level data is **BGM-only**
- unsupported data should be omitted rather than placeholdered
- if scope needs to shrink, cut the `Context Footer` first
