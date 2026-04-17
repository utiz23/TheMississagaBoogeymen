# DB Roadmap

## Purpose

This document preserves the agreed database and product requirements so the
first schema pass does not lose the later requirements.

The first design pass should focus on:

1. separate skater vs goalie reporting model
2. positional lineup / role filtering model
3. EA-official club record snapshot model

Everything else below remains in scope for later phases unless explicitly
changed by the user.

## Locked Product Requirements

### Player stats model

- Skater stats and goalie stats must be reported separately.
- A player may have both skater and goalie history for the Boogeymen.
- Per-game participation remains the foundation for advanced stats.
- `ea_member_season_stats` is the current-game baseline, not the full answer.
- Advanced stats are built on locally recorded game logs, not on EA season totals.

### Club scope

- This project is Boogeymen-only.
- Career totals and history are only for games played for the Boogeymen.

### Player page direction

Future player pages need to support:

- current game / current season stats (e.g. NHL 26)
- total Boogeymen career stats
- last 5 games
- career by season
- full recorded game log

Important constraint:

- imported historical seasons from past NHL titles will not have advanced stats
- current-game baseline totals are easiest to source from `ea_member_season_stats`

### Positional filtering

The system must support filters such as:

- games where center = `silkyjoker85`
- games where right wing = `camrazz`

This means lineup / role assignment per recorded match is a first-class query
requirement, not a nice-to-have.

### Platform

- Current platform only
- No platform history required
- Platform should be fetched automatically when practical
- Platform icons should be displayable next to current players
- Platform is ingestion-owned metadata, not manual profile metadata

### Club record authority

- EA official club record is authoritative
- if the official record cannot be retrieved or reconciled, return an error so
  the issue is visible and debuggable
- local match ingestion is for team and player game logs, not the authoritative
  club record

### Matchup / record display

- Matchup records should reflect the official EA record at the time of the match
- current example target: `283-188-20`

Implication:

- current official record and historical official record snapshot are different
- if the product needs "record at match time", the system must preserve
  snapshots over time rather than only fetching the current value

### Content seasons

- No current product decision yet
- Do not prioritize content-season schema work ahead of the first three focus
  areas unless a concrete use case is defined

## Phase Priorities

### Phase 1

Design only:

1. separate skater vs goalie reporting model
2. positional lineup / role filtering model
3. EA-official club record snapshot model

### Phase 2

After the first three are settled:

1. current platform ownership and display model
2. Boogeymen-only historical season summary model
3. current player page data model for:
   - current game baseline totals
   - Boogeymen career totals
   - last 5 games
   - career by season
   - full recorded game log

### Phase 3

Only later, if needed:

1. content-season usage
2. richer lineup semantics beyond role-based filters
3. extra caches or materialized aggregates for expensive queries

## Guardrails

- Do not collapse EA baseline totals and local advanced stats into one fake
  all-purpose stat source.
- Do not put ingestion-owned current platform data into `player_profiles`.
- Do not invent historical official club records if snapshots were not captured
  at the time.
- Do not let future schema work quietly drift into multi-club scope.
