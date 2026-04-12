# Frontend Brainstorm

Use this skill for UI and UX concept work for this repository's frontend phase.

## Why This Exists

The `superpowers:brainstorming` skill already handles general ideation well, but this project has unusually specific constraints:

- stats-first sports product, not generic SaaS
- game-title-first navigation
- always-dark theme
- red-accented esports personality
- small authenticated audience
- data-dense pages that still need strong visual hierarchy

This skill keeps brainstorming grounded in this repo's architecture and visual direction so the output is immediately actionable for Phase 3.

## Inputs To Read First

1. `docs/ARCHITECTURE.md`
2. `CLAUDE.md`
3. `HANDOFF.md`

Read only the frontend-relevant sections unless the user asks for broader context.

## Goals

When invoked, help the user:

- choose the right page priority for the next frontend step
- compare 2-3 viable UI directions
- decide what belongs on home, stats, roster, games, and game detail
- define a coherent visual system before implementation
- turn vague style preferences into concrete build guidance

## Default Output Structure

Return:

1. `Design Goal`
   - what the screen or experience needs to achieve
2. `Constraints`
   - data, architecture, brand, and usability constraints
3. `Directions`
   - 2-3 distinct UI directions with names
   - each direction should describe layout, tone, typography, color behavior, density, and tradeoffs
4. `Recommendation`
   - pick one direction and explain why
5. `Build Plan`
   - the next 3-6 implementation steps

## Repo-Specific Guardrails

- Do not drift into light mode.
- Do not default to a generic analytics dashboard aesthetic.
- Do not over-prioritize charts over readable game and player tables.
- Treat the game title selector as the primary context switch.
- Favor bold hierarchy, scoreboard metaphors, and strong section framing.
- Preserve mobile usability, but do not let mobile flatten the visual identity into blandness.

## Page-Specific Heuristics

### Home

Should feel like a team hub:

- club identity
- record / trend snapshot
- recent games
- top performers
- obvious navigation into deeper stats

### Stats

Should answer:

- how good is the club overall?
- what trends matter?
- what is our identity as a team?

### Roster

Should be the densest page, but still scannable:

- sortable tables
- category views
- strong column hierarchy
- role-aware goalie treatment

### Games

Should read like a season/game log:

- chronological
- easy scanning of result and score
- opponent prominence
- compact metadata

### Game Detail

Should feel like a box score:

- final score hero
- side-by-side club comparison
- player stat lines below

## When To Use `superpowers:brainstorming` Instead

Use the plugin skill directly when:

- the problem is broad product ideation, not specifically frontend/UI
- the team still needs to decide what feature to build at all
- you need a formal spec-writing flow after ideation

Use this project skill when:

- the feature is known
- the main uncertainty is interaction model, layout, or visual direction
- the output needs to feed directly into implementation in this repo
