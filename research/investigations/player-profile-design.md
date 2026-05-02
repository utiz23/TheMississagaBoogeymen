# Player Profile Page — Design Research & Implementation Log

> Page: `/roster/[id]`
> Research: 2026-04-30 – 2026-05-01

---

## Reference Surfaces Reviewed

### Chelhead Player Page

- Hero: large avatar, gamertag, position, jersey number, role/title badges
- Stat strip: GP, G, A, PTS, +/-, SHT%, TOI — most important stats above the fold
- Section tabs: Overview / Career / Game Log / Ratings
- Career Stats table: cross-game-title aggregates (same as our structure)
- Rating breakdown: Off/Def/Team numeric ratings by game (we don't have this data)

### Hockey Reference

- Two always-visible tables (skater + goalie) — no tabs to reveal goalie data
- Per-game rate columns (P/GP, G/GP) standard
- Clean player-identity cell with position next to name

### Elite Prospects

- Position-count summary strip above roster (G: 2 / D: 4 / F: 6)
- Team aggregate stats before individual rows
- Season selector prominent and at top

---

## Section Order (current — after cleanup)

```
Hero + HeroStatStrip
Contribution Radar
Recent Form (last 5)
Game Log
Career Stats (per game title)
EA Season Totals
Gamertag History
```

Previous order had "Current Season Snapshot" after Hero — removed because it duplicated hero strip stats.

---

## Hero Stat Strip

**Skaters (8 cells):** GP / G / A / PTS / +/- / Hits / P·GP / App. Record

**Goalies (7 cells):** GP / W-L-OTL / SV% / GAA / SO / Saves / App. Record

**Responsive handling:** The 8-cell strip is wrapped in `overflow-x-auto` — scrolls horizontally on narrow screens rather than wrapping.

---

## Archetype Badge

Computed from skater stats, displayed as an accent chip in the hero:

| Archetype | Conditions |
|---|---|
| Sniper | High goals/game, moderate assists |
| Playmaker | High assists/game, moderate goals |
| Enforcer | High hits, elevated PIM |
| Two-Way | Good +/- AND strong defensive stats (TA/blocks) |
| Balanced | Default / doesn't meet any other threshold |

Goalies do not get an archetype badge.

---

## Position Usage

Shown as `PositionPill` chips in the hero sub-info line. Shows each position the player has played, with game count beside each pill (e.g., `LW 8  C 3`). Only shows positions where `gameCount > 0` and `position !== 'goalie'`.

Query: `getPlayerPositionUsage(playerId, gameTitleId)` in `packages/db/src/queries/players.ts`.

---

## Contribution Radar

SVG radar chart with 6 axes, values normalized against same-role EA season teammates:

**Skaters:** Scoring / Playmaking / Shooting / Physicality / Possession / Discipline
**Goalies:** Win Rate / Save% / GAA / Saves·GP / SO·GP / Workload

Requires minimum 5 players in the same role group. Shows empty state if not met.

---

## Current Season Snapshot — Removed

Originally a second stats block below the hero that repeated most of the hero strip values plus a "Source Notes" sidebar card explaining data sourcing. Both were removed:

- **Source Notes card:** Clutter. Page should communicate through structure/labels, not documentation blocks.
- **Snapshot section:** Pure repetition of hero strip. Unique values (Saves, +/-) were moved into the expanded hero strip instead.

---

## Game Log

Per-match table. Columns: Date / Opponent / Result / Score / G / A / PTS / +/- / Saves

- Goalies show `—` for G/A/PTS/+/-; skaters show `—` for Saves
- Opponent cell links to `/games/[matchId]`
- Position column: shown only if player has played multiple positions (`rows.some(r => r.position !== rows[0].position)`)
- Ordered by `desc(playedAt)` — most recent first

---

## Wins/Losses Semantics (important)

`wins/losses/otl` in `player_game_title_stats` = **team record during player appearances**, not goalie-only record. A skater's W/L/OTL record = how the team did when that skater played.

This is the correct interpretation for "Appearance Record" in the hero strip.

---

## Data Sources on Profile Page

| Section | Source | Label |
|---|---|---|
| Hero strip (current season) | `player_game_title_stats` | Locally tracked |
| Contribution Radar | `ea_member_season_stats` | EA season totals (normalized) |
| Recent Form | `player_match_stats` (last 5 role-matched) | Locally tracked |
| Game Log | `player_match_stats` | Locally tracked |
| Career Stats | `player_game_title_stats` | Per game title |
| EA Season Totals | `ea_member_season_stats` | EA season totals (clearly labeled) |

Never mix these silently. EA totals ≠ local aggregates.

---

## Member-Only Players

Players created via `ea_member_season_stats` (appear in EA's member list but haven't been in any ingested match). These players:
- Show on the roster with "provisional" marking
- Have a player profile with "no local match history" notice
- Have EA Season Totals but no Career Stats, Game Log, or Recent Form

---

## Player Profile Cleanup — What Was Done (2026-04-30 to 2026-05-01)

1. Removed `CurrentSeasonSnapshotSection` (~113 lines)
2. Removed `SnapshotStat` component
3. Expanded `HeroStatStrip` from 6 → 8 cells (skaters), 5 → 7 cells (goalies)
4. Reordered sections: Game Log now before Career Stats
5. Added archetype badge to hero
6. Added position usage as `PositionPill` chips
7. `onLight` styling fixed for position pills
8. Section headings upgraded from zinc-500 → zinc-300 for visibility
9. Radar fill opacity boosted from 0.20 → 0.35
10. Hero bloom boosted from 0.11 → 0.16
11. "Best Recent Game" label tinted accent
12. 8-cell HeroStatStrip wrapped in `overflow-x-auto` for mobile
