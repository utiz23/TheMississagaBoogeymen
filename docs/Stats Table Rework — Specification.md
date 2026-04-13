# Stats Table Rework — Specification

## 1. Objective

Define the target behavior, structure, and data requirements for the main **Statistics table experience**.

This spec is for the upcoming database/statistics rework, not just the current UI.

Primary goals:

- Support a clean, expandable stats table for both skaters and goalies
- Treat each yearly NHL title as a selectable **season** in the product UI
- Support future historical data, even if older data must initially be entered manually
- Separate **Basic** and **Advanced** stats so the table stays readable
- Leave room for partial implementation when the data pipeline cannot yet support a filter or stat cleanly

---

## 2. Product Definitions

## Season

For this project, **season** now means the yearly NHL game cycle.

Examples:

- `NHL 26`
- `NHL 25`
- `NHL 24`

Important note:

- This aligns well with the existing architecture decision that **game title** is the primary grouping.
- In the database and code, this will likely still map to `game_titles`.
- In the product UI, we should label and present it as **Season** because that is the more useful mental model for the team.

## Last 5 Games

`Last 5 Games` is **not** a true season.

It is a convenience filter/preset that should live alongside season selection in the UI if feasible.

Product intent:

- let the user compare full-cycle performance vs recent form
- provide a fast “what have you done lately?” view without changing pages

Implementation note:

- It is acceptable if this ships later than yearly season selection
- It may be implemented as a separate date-range/filter preset under the hood

## Game Mode

Game mode refers to the club format:

- `6's`
- `3's`

This filter should exist in the target experience, even if the data mapping must be deferred initially.

---

## 3. High-Level Page Structure

The target page/module should follow this rough structure:

```text
Statistics
 ├── Controls Row
 │    ├── Season Selector
 │    ├── Game Mode Selector
 │    └── Stat Type Toggle (Basic / Advanced)
 ├── Skaters Section
 │    ├── Section Header
 │    ├── Basic or Advanced Toggle State
 │    └── Stats Table
 └── Goalies Section
      ├── Section Header
      ├── Basic or Advanced Toggle State
      └── Stats Table
```

Based on the provided mockup:

- one page
- one shared filter row at the top
- separate skater and goalie table blocks
- a Basic/Advanced switch per section or one shared mode if that proves cleaner

Preferred product behavior:

- shared `Season` selector
- shared `Game Mode` selector
- independent `Basic / Advanced` toggles for skaters and goalies

Reason:

- skaters and goalies have very different stat sets
- users may want to inspect basic goalie stats while looking at advanced skater stats, or vice versa

If that proves too complex in the first implementation, it is acceptable to start with:

- shared top filters
- one basic/advanced mode per section
- no persistence between sessions

---

## 4. Core UX Requirements

## 4.1 Season Selector

The season selector should:

- default to the current season (`NHL 26` to start)
- support switching to older yearly game cycles later
- be designed to allow future historical expansion without UI redesign

Target options:

- `NHL 26`
- `NHL 25`
- `NHL 24`
- `Last 5 Games`

Notes:

- If older games cannot be ingested automatically yet, the selector can still be designed and implemented around a data model that supports manual entry.
- If `Last 5 Games` is awkward inside the season dropdown, it may become a secondary preset or segmented filter later.

## 4.2 Game Mode Selector

The game mode selector should visually support:

- `All`
- `6's`
- `3's`

Notes:

- `All` should be the safest default
- If match data cannot yet reliably distinguish `3's` vs `6's`, keep the selector UI but defer accurate backend filtering
- The spec should assume this filter is eventually real, not cosmetic forever

## 4.3 Basic vs Advanced Toggle

This toggle exists because one combined table would become too wide and too dense.

Requirements:

- Every section must have a **Basic** view
- Every section should eventually have an **Advanced** view
- The toggle should switch columns, not navigate away
- Sorting should remain available within the active table mode

---

## 5. Section Definitions

## 5.1 Skaters Section

Purpose:

- display scoring and possession performance for all non-goalie players

Table row identity:

- Player name
- Supporting sub-line optional
  - example: position, recent form note, or win %
  - should only be shown if it stays readable

Basic skater stats should prioritize quick recognition:

- GP
- G
- A
- PTS
- +/-
- PIM
- SOG
- P/GP

Recommended first-pass basic skater columns:

| Column          | Label  | Reason                                  |
| --------------- | ------ | --------------------------------------- |
| Player          | `Name` | primary identity                        |
| Games Played    | `GP`   | standard context                        |
| Goals           | `G`    | core scoring stat                       |
| Assists         | `A`    | core scoring stat                       |
| Points          | `PTS`  | primary featured skater stat            |
| Plus/Minus      | `+/-`  | common hockey summary stat              |
| Penalty Minutes | `PIM`  | common, readable team stat              |
| Shots on Goal   | `SOG`  | highly understandable volume stat       |
| Points Per Game | `P/GP` | cleaner than showing a second raw total |

Advanced skater stats should hold the wider or more contextual metrics:

- SHT%
- TOI or TOI/GP
- Hits
- Takeaways
- Giveaways
- FO%
- Pass%
- Power-play stats if support exists later

Recommended advanced skater columns:

| Column               | Label    | Notes                                      |
| -------------------- | -------- | ------------------------------------------ |
| Player               | `Name`   | stays pinned/first                         |
| Games Played         | `GP`     | still needed for context                   |
| Shooting Percentage  | `SHT%`   | if derivable cleanly                       |
| Time on Ice per Game | `TOI/GP` | preferred over raw total                   |
| Hits                 | `Hits`   | current schema already trends this way     |
| Takeaways            | `TA`     | already familiar in current roster UI      |
| Giveaways            | `GV`     | already familiar in current roster UI      |
| Faceoff Percentage   | `FO%`    | nullable for non-centers / incomplete data |
| Pass Percentage      | `Pass%`  | current schema supports this aggregate     |

## 5.2 Goalies Section

Purpose:

- display goalie-specific performance without mixing it into skater tables

Basic goalie stats should prioritize common hockey reads:

- GP
- W
- L
- OTL
- SV%
- GAA
- SO

Recommended first-pass basic goalie columns:

| Column                | Label  | Reason                          |
| --------------------- | ------ | ------------------------------- |
| Player                | `Name` | primary identity                |
| Games Played          | `GP`   | standard context                |
| Wins                  | `W`    | core goalie summary             |
| Losses                | `L`    | core goalie summary             |
| Overtime Losses       | `OTL`  | needed for hockey record format |
| Save Percentage       | `SV%`  | primary quality stat            |
| Goals Against Average | `GAA`  | common goalie summary           |
| Shutouts              | `SO`   | conventional milestone stat     |

Advanced goalie stats should support deeper comparison:

- Saves
- Shots Against
- Goals Against
- Saves/Game
- Shots Against/Game
- TOI
- possibly quality-start style metrics later if support exists

Recommended advanced goalie columns:

| Column                 | Label          | Notes                     |
| ---------------------- | -------------- | ------------------------- |
| Player                 | `Name`         | stays pinned/first        |
| Games Played           | `GP`           | context                   |
| Saves                  | `SV`           | common volume stat        |
| Shots Against          | `SA`           | required for save context |
| Goals Against          | `GA`           | raw companion to GAA      |
| Saves Per Game         | `SV/GP`        | if useful and easy        |
| Shots Against Per Game | `SA/GP`        | optional                  |
| Time on Ice            | `TOI` or `MIN` | if support is reliable    |

---

## 6. Selector and Filter Behavior

## 6.1 Season Selector Behavior

Desired logic:

- changing season refreshes both skater and goalie tables
- season should scope the entire page
- the selected season should persist in the URL if feasible

Preferred long-term URL model:

- `/stats?season=nhl26`
- `/stats?season=nhl25`
- `/stats?range=last5`

If implementation stays tied to current architecture, this may instead be:

- `/stats?title=nhl26`

That is acceptable as long as the UI label reads as **Season**.

## 6.2 Game Mode Filter Behavior

Desired logic:

- `All` shows every eligible match
- `6's` filters to full-team games
- `3's` filters to 3-player format games

Current reality:

- it is not yet confirmed that the ingestion layer can reliably determine this from match data

Therefore:

- the selector should be included in the target spec
- real filtering may be deferred until the data source is verified

## 6.3 Basic / Advanced Behavior

Desired logic:

- toggle changes only the visible columns
- row set remains the same
- current sort can reset to a sensible default when mode changes

Recommended default sorts:

- Skaters Basic: `PTS desc`
- Skaters Advanced: `SHT% desc` or `TOI/GP desc`
- Goalies Basic: `SV% desc`
- Goalies Advanced: `SV desc` or `SA desc`

These may be refined later.

---

## 7. Data Reality and Support Levels

This project needs a spec that is honest about what is currently easy vs what is future-facing.

## 7.1 Supported Cleanly Today or Soon

- yearly season selection if mapped to `game_titles`
- skater vs goalie split
- basic aggregated stat tables
- sorting
- points/goals/assists/plus-minus/shots/hits/pim/takeaways/giveaways
- save percentage / GAA / shutouts / wins / losses where goalie support exists

## 7.2 Likely Supported but Needs Verification

- `Last 5 Games` filter/preset
- shooting percentage
- TOI/TOI per game
- game-mode split between `3's` and `6's`
- OTL availability at goalie/player aggregation level

## 7.3 Likely Manual or Deferred

- older game-cycle backfill (`NHL 25`, `NHL 24`, etc.)
- historical imports from screenshots or manual entry
- jersey numbers
- full advanced stat parity across every game title

Important product assumption:

- older seasons may need a mixed-source model
- automated ingestion for the current title, manual import/entry for older titles

The data model should not assume every season comes from the same ingestion method.

---

## 8. Manual Entry / Historical Backfill Requirements

If older game titles cannot be ingested automatically, the system should still be designed to support them later.

Target requirement:

- a historical season can exist even if its stats came from manual entry

Possible sources:

- screenshots
- typed totals
- exported spreadsheets

This means the future schema should support:

- identifying the season/game cycle
- identifying whether a record was ingested automatically or entered manually
- storing enough metadata to audit or update manually entered totals later

This does **not** require building the manual-entry tooling now.

It only means the stats-table design should not depend on “live EA ingestion only.”

---

## 9. Sorting Rules

These rules are product targets, not necessarily the first implementation.

## 9.1 Skaters Basic

Default:

1. Points descending
2. Goals descending
3. Assists descending
4. Player name ascending

Alternative sort keys should be available by clicking column headers.

## 9.2 Goalies Basic

Default:

1. Save percentage descending
2. Games played descending
3. GAA ascending
4. Player name ascending

## 9.3 Advanced Views

Default sorts can be stat-specific, but the general rule should be:

- higher is better for most metrics
- lower is better for `GAA`
- nulls sort to the bottom

---

## 10. Empty / Partial Data Rules

The page must handle incomplete data honestly.

Rules:

- If a filter exists but is not yet backed by real data, the UI may still appear, but its unsupported state should be tracked for implementation
- If a stat is unavailable, show `—`
- Do not fabricate goalie OTL, jersey numbers, or game mode
- If a whole section has no valid rows, show an honest empty state rather than a broken table

Examples:

- no historical NHL 25 data yet
- no reliable `3's` / `6's` split yet
- missing TOI for older imported seasons

---

## 11. Recommended First Rework Scope

To keep the database rework manageable, the first target should be:

## Phase A

- one `Season` selector backed by yearly game title / current title data
- skaters table
- goalies table
- basic stat view for both
- current season only if needed
- no historical backfill yet

## Phase B

- advanced columns
- `Last 5 Games`
- game mode selector wired to real data if feasible

## Phase C

- historical seasons (`NHL 25`, `NHL 24`, etc.)
- manual-entry support
- richer advanced metrics

---

## 12. Open Questions

These should remain open until the database rework begins:

1. Can match data reliably distinguish `3's` vs `6's`?
2. Should `Last 5 Games` live inside the season dropdown or as a separate preset?
3. Do we want one shared `Basic / Advanced` toggle or one per section?
4. Can older seasons be backfilled automatically from any EA source, or should the system assume manual entry?
5. Should historical manually-entered seasons and live-ingested seasons share exactly the same aggregate schema, or should one canonical normalized layer sit underneath both?

---

## 13. Implementation Guidance

This spec should drive the upcoming rework in this order:

1. Define the future aggregate/query model around yearly game-title seasons
2. Confirm which stats are first-class for skaters vs goalies
3. Decide how `Last 5 Games` and game mode filters fit into the query layer
4. Build the table UI against that future shape
5. Add manual/historical season support later if automated recovery is not feasible

Most important principle:

- design the table and schema for the future shape now
- do not block the first rework on perfect historical ingestion
