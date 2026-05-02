# Roster Page — Design Research & Implementation Log

> Page: `/roster`
> Research: 2026-04-30 – 2026-05-01

---

## Section Structure (current)

```
Season Summary Strip
Depth Chart
[Skater Stats Table — from /stats]
[Goalie Stats Table — from /stats]
```

---

## Season Summary Strip

Compact team-context bar above the depth chart. Contains:
- W-L-OTL record
- Top scorer (gamertag + points)
- Top goal scorer (gamertag + goals)
- Top goalie (gamertag + SV% or W, with "N/A" fallback if data is thin)

Uses existing data already fetched on the page — no additional queries.

---

## Depth Chart Algorithm

Two-pass placement fills slots by tracking position game counts:

**Slots:** 12 forward (4 lines × LW/C/RW) + 6 defense (3 pairs × LD/RD) + variable goalies

**Pass 1:** Place each player in their most-played position
**Pass 2:** Fill remaining slots with best fit from remaining players

**Tiebreaker:** EA `favoritePosition` as a secondary signal

**Open slots:** Render as dashed empty placeholders

**Goalie slots:** Dynamic (not hardcoded 5) — shows only as many slots as real goalies (min 1)

**Rule:** 1 game at a position is enough to count. No minimum threshold. Depth chart prefers a fuller inferred board over sparse honesty. Manual/member-only players appear marked "provisional."

---

## Stats Tables

The `/roster` page reuses `SkaterStatsTable` and `GoalieStatsTable` from `apps/web/src/components/stats/`. These are the same components used by `/stats`.

**Motivation:** Eliminates parallel drift. The custom `RosterTable` component was deleted.

**Data source:** `getSkaterStats(gameTitleId, null)` + `getGoalieStats(gameTitleId, null)` — `null` game mode = all modes combined (same as roster context needs).

**Result:** Roster page gets the full Basic/Advanced toggle, all columns, sortable table — same as `/stats` page.

---

## Key Design Decisions

### Goalie as Always-Visible Section

Previous: Goalie stats were in a tab (hidden by default) in the `RosterTable`.
Current: `GoalieStatsTable` is always visible as a separate section below skaters.

### P/GP Rate Stat

Added `P/GP` column to Scoring tab — `points / skaterGp`, returns `'—'` for zero division. Added after research showed Hockey Reference and EliteProspects make rate stats primary, not optional.

### Position in Player Identity Cell

Skater table shows a compact position pill next to the gamertag. Players shouldn't have to remember who plays what position.

---

## Outside References Reviewed

**Hockey Reference:**
- Two separate always-visible sections (skaters + goalies)
- Rate columns (P/GP, G/GP) standard
- Sortable everything

**Elite Prospects:**
- Position-count summary strip above roster (best element on the page)
- Season selector prominent
- Team aggregate stats appear before individual rows

**NHL.com:**
- Card layout with jersey # and position immediately visible
- Position filter chips
- Photo-first (we can't replicate)

**Chelhead:**
- Club page shows club record, season record, members list with season totals
- Member list shows GP/G/A/PTS/+/-/SHT%/FO%/PIM (all-mode combined)

---

## Data Source: Depth Chart vs Stats Table

These two parts of the page use different data sources:

| Section | Source |
|---|---|
| Depth chart cards | `ea_member_season_stats` |
| Stats tables (Skater/Goalie) | `player_game_title_stats` (locally tracked) |

This is intentional. Depth chart needs all current active members (including those not in any ingested match), so it uses EA's member data. Stats tables show only players with locally tracked stats, which are more detailed.
