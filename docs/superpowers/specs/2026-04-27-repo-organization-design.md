# Repo Organization — Design

**Date:** 2026-04-27  
**Scope:** Non-code files only. No source, schema, or config changes.

## Problem

Non-code files are scattered across root, `imgs/`, `docs/`, and `research/` with no consistent taxonomy. Spec filenames have spaces and em-dashes (shell-hostile). The Chelhead research capture is untracked. A HAR file sits at root.

## Design

Two categories, enforced by directory:

- **`docs/`** — everything about *what we're building*: architecture, specs, design mockups, branding
- **`research/`** — everything *external we investigated*: Chelhead capture, EA API artifacts

## File Moves

### Root

| From | To |
|---|---|
| `EASHL Team Stats Website – Full Blueprint.md` | `docs/planning/system-blueprint.md` |
| `www.ea.com.har` | `research/ea-api/www.ea.com.har` |
| `imgs/` | dissolved — contents distributed below |

### `docs/`

| From | To |
|---|---|
| `docs/Branding/` | `docs/branding/` |
| `docs/Final Score Card — UI-UX Specification.md` | `docs/specs/final-score-card.md` |
| `docs/Home Page Leading Scorers Panel — UI-UX Specification.md` | `docs/specs/home-scorers-panel.md` |
| `docs/Player Card Carousel — UI-UX Specification.md` | `docs/specs/player-card-carousel.md` |
| `docs/Player Card UI Spec — EASHL Stats Website.md` | `docs/specs/player-card.md` |
| `docs/Roster Depth Chart — Specification.md` | `docs/specs/roster-depth-chart.md` |
| `docs/Stats Table Rework — Specification.md` | `docs/specs/stats-table-rework.md` |
| `imgs/Reference Images/` (design mockups — see below) | `docs/design/` |
| `imgs/Code_Test_ScreenShots/` (all) | `docs/design/screenshots/` |
| `imgs/Reference Images/Screenshot 2026-04-13 02-58-30.png` | `docs/design/screenshots/` |

Design mockups moved to `docs/design/`:  
`Home_1_Carosel.png`, `Home_2_Final score.png`, `Home_3_Stats_Concise.png`,  
`Game_sheet_2.png`, `Scores.png`, `PlayerCardBluePrint.png`, `PlayerCardBluePrint_2.png`,  
`Roster_1_Depth_Chart.png`, `Roster_2_Stats.png`, `122707092025112423.webp`, `kgnt.png`

### `research/`

| From | To |
|---|---|
| `www.ea.com.har` (root) | `research/ea-api/www.ea.com.har` |
| `imgs/Reference Images/FireShot Capture 019 - …ea.com….png` | `research/ea-api/ea-pro-clubs-overview.png` |
| `imgs/Reference Images/FireShot Capture 007 - …ChelHead - Club Stats….png` | `research/chelhead/club/screenshots/` |
| `imgs/Reference Images/FireShot Capture 021 - Stick Menace - …ChelHead….png` | `research/chelhead/player-profile/screenshots/` |

`research/chelhead/` is committed as-is (currently untracked).

## Unchanged

- All root config/protocol files: `CLAUDE.md`, `HANDOFF.md`, `DEPLOY.md`, `AGENTS.md`, `README.md`
- `docs/ARCHITECTURE.md`, `docs/planning/database-roadmap.md`, `docs/operations/agent-manager-workflow.md`
- `docs/superpowers/`
- All `apps/`, `packages/` source
