# OCR Features & Metrics

What the OCR-derived third evidence layer unlocks for the website. Reconstructed from the 2026-05-10 brainstorm session and the schema integration plan.

This doc is a forward-looking catalog: what signals each screen exposes, what UI surfaces those signals enable, and what aggregate metrics fall out of them. **It is not an implementation plan** — see `docs/superpowers/plans/2026-05-10-ocr-schema-integration.md` and `/home/michal/.claude/plans/abstract-yawning-dream.md` for build sequencing.

Status as of 2026-05-10: phases 0-2 of the OCR build are landed (schema + subprocess pipeline + 9 screen parsers + 4 promoters). Phase 3 (identity reconciliation) and Phase 4 (review CLI + UI surfaces) are next. Phase 5 (rink coordinates) is deferred.

---

## The three big unlocks

Everything below collapses into one of these three themes:

### 1. The Timeline

Right now we have totals. The EA API gives per-match aggregates (goals, shots, hits, faceoff wins) but never the *sequence*. The Events screen and Action Tracker turn a match from a row of stats into a story: who scored when, who set them up, who took penalties at what point of the game.

**What the data adds:** discrete event records w/ clock + period + actor + (for goals) two assisters + (for penalties) infraction + length.

**Schema home:** `match_events` + `match_goal_events` + `match_penalty_events`.

### 2. The Map

Every shot, hit, penalty, and faceoff has *actual rink coordinates* from the Action Tracker's right-panel rink illustration. Not zone buckets — pixel-level dot-on-a-rink locations.

**What the data adds:** `match_events.x` / `match_events.y` (numeric 6,2) for every event, plus per-zone faceoff splits from the Faceoff Map screen.

**Schema home:** `match_events.x` / `match_events.y` (already in schema; population is Phase 5 spatial work).

**Status:** **deferred to Phase 5.** Requires OpenCV marker detection and rink-template fitting. The text panels of Net Chart and Faceoff Map are captured today, so aggregate shot-type and zone-faceoff counts work without spatial extraction.

### 3. The Build

Every player's *actual loaded attributes* from the Pre-Game Lobby and Player Loadout View screens — 23 attribute values across 5 groups, plus up to 3 X-factors, build class, height, weight, handedness, and position. Captured per-match, so build evolution over time is queryable.

**What the data adds:** `player_loadout_snapshots` w/ child `_x_factors` and `_attributes` rows. EA API exposes none of this.

**Schema home:** `player_loadout_snapshots` + `player_loadout_x_factors` + `player_loadout_attributes`.

---

## Screen → data → DB tables

Each row is one OCR screen we capture and what gets persisted from it.

| Screen | Source data | Promotes to | Notes |
|---|---|---|---|
| `pre_game_lobby_state_1` / `_state_2` | Per-player roster slot: position, build, level, gamertag (state 2 adds player name + jersey #) | `player_loadout_snapshots` (thin — no attrs / no x-factors) | Captures opponent rosters too; useful for opponent scouting |
| `player_loadout_view` | One player's full build: 23 attributes, 3 X-factors, build class, height/weight/handedness, platform, level | `player_loadout_snapshots` + `_x_factors` + `_attributes` | One snapshot per capture; not deduped across games (builds change) |
| `post_game_player_summary` | Per-player end-of-game scoreboard stats (G, A, +/-, saves, save%) | *audit only* — not promoted | Redundant with EA API canon |
| `post_game_box_score_goals` | Per-period goals: 1ST/2ND/3RD/OT/SO/TOT × {away, home} | `match_period_summaries.goals_for/_against` | One of three tabs — all merge into one row per period |
| `post_game_box_score_shots` | Per-period shots, same shape | `match_period_summaries.shots_for/_against` | |
| `post_game_box_score_faceoffs` | Per-period faceoff wins, same shape | `match_period_summaries.faceoffs_for/_against` | |
| `post_game_events` | Goal + penalty event log, period-grouped, scrollable | `match_events` (event_type='goal'\|'penalty') + `match_goal_events` (scorer + 2 assists + goal_number_in_game) + `match_penalty_events` (infraction + length) | Multiple captures merge via cross-capture dedup |
| `post_game_action_tracker` | Per-period event list with shots + hits + faceoffs + goals + penalties | `match_events` (full event_type set) | Cross-screen dedup with Events for goals/penalties |
| `post_game_net_chart` | Shot-type breakdown per side per period: total/wrist/snap/back/slap/deflection/PP | `match_shot_type_summaries` (one row per side per period) | |
| `post_game_faceoff_map` | Text panel: overall win % + offensive/defensive zone wins per side | *audit only* — fields in `ocr_extraction_fields`, no domain promotion | Box Score's faceoffs tab covers per-period totals already; zone splits await a future schema column |

---

## Feature catalog

The brainstorm grouped these around the three big unlocks. Each entry calls out (a) the data it consumes, (b) the screen it depends on, (c) the v1 vs Phase 5 status.

### Match-detail surfaces (`/games/[id]`)

#### Period summary widget
Small grid of goals/shots/faceoffs per period for both sides. The first time the site shows that *5 of BGM's 9 shots in the 2nd period happened in the last 4 minutes*, or that *we won 1st-period faceoffs 6-2*.

- **Data:** `match_period_summaries` (Box Score, all 3 tabs).
- **Status:** v1 ready as soon as Phase 4 review CLI flips reviewed batches.
- **Surface:** `/games/[id]` — right under the score header.

#### Event log section
Period-grouped goal + penalty list. Goals show scorer, two assists, goal number in game. Penalties show culprit, infraction, minor/major. Roster-resolved names link to `/roster/[id]`; unresolved snapshots render as plain text.

- **Data:** `match_events` + `match_goal_events` + `match_penalty_events` (Events screen + Action Tracker).
- **Status:** v1 ready.
- **Surface:** `/games/[id]` — its own tabbed section, period-grouped.
- **Notable derivations:** "Game-winning goal" (last goal scored by winning side), "OT winner" highlight, primary-assist leaders per match.

#### Shot-mix readout
Small breakdown chart per side per period: wrist / snap / back / slap / deflection / PP. Renders as proportional bars or a stacked compact strip.

- **Data:** `match_shot_type_summaries` (Net Chart).
- **Status:** v1 ready.
- **Surface:** `/games/[id]` — sidebar widget.

#### Pre-game lineup card
Reconstructed starting lineup from lobby OCR — who played where, with what build class, what X-factors, what level. Side-by-side BGM vs opponent.

- **Data:** `player_loadout_snapshots` rows where `match_id = X` AND `source_extraction_id` came from a `pre_game_lobby_state_*` extraction.
- **Status:** v1 ready (lobby parser + promoter both shipped).
- **Surface:** `/games/[id]` — collapsible section.
- **Caveat:** lobby OCR has known field-bleed issues (gamertag region overlaps adjacent text); review pass is the cleanup path.

### Player profile surfaces (`/roster/[id]`)

#### Loadout history strip
Recent build snapshots for this player. Position, build class, top 3 X-factors, attribute averages by group (Technique/Power/Playstyle/Tenacity/Tactics). Captures build evolution: did silky switch from Sniper to Playmaker mid-season? Did Joey bump Speed at the cost of Body Checking?

- **Data:** `player_loadout_snapshots` + `_x_factors` + `_attributes` (Player Loadout View screen).
- **Status:** v1 ready.
- **Surface:** `/roster/[id]` — under the existing hero strip.
- **Notable derivations:** "build class changes per season," "X-factor frequency leaderboard," "average attribute by group."

#### Personal shot type tendency
Per-player wrist / snap / back / slap / deflection breakdown across all matches that have a Net Chart capture. Is silky a wrist-shot guy? Does someone live on backhand goals?

- **Data:** join `match_events` (event_type='shot' or 'goal', actor_player_id = X) with `match_shot_type_summaries` per matched period.
- **Status:** Phase 5 dependent if we want per-shot type via rink-map. v1 approximation: aggregate by team-side via `match_shot_type_summaries` and pro-rate to players using their share of `match_events.shots`.
- **Surface:** player profile — small donut or stacked bar.

### Catalog / standalone surfaces

#### `/loadouts` — Build Library
Page showing each player's current build snapshot: class, attributes, X-factors. Track how builds have changed across sessions. Compare two players side-by-side.

- **Data:** most-recent `player_loadout_snapshots` per player.
- **Status:** v1 ready; needs a new route.
- **Notable derivations:** "build class distribution across roster," "team-wide attribute averages."

#### Opponent scouting card
Recurring opponents build a profile over time. Each lobby capture against `4th Line` records their roster + builds + X-factors; over N games we know their starting C, their LD's preferred build, etc.

- **Data:** `player_loadout_snapshots` where `gameTitleId = X` AND `match_id IN (SELECT id FROM matches WHERE opponent_name = 'Y')` AND the snapshot side was opponent.
- **Status:** v1 ready (data flows via the lobby promoter — but it currently writes BOTH BGM and opponent rows the same way; a side discriminator is needed before the scouting query becomes reliable). Requires a small Phase 4 schema add: `player_loadout_snapshots.is_opponent_side bool` derived at promotion time.
- **Surface:** future opponent profile route, e.g. `/opponents/[club_id]`.

### Aggregate / analytical surfaces

#### Clutch stats
3rd-period and OT goals; goals when tied or trailing. For the first time, we know *when* goals happened — not just that they happened.

- **Data:** `match_events` (event_type='goal') joined to `match_period_summaries` for score-state at the time.
- **Status:** v1 ready (event log + period summaries both shipped).
- **Surface:** `/stats` aggregate widget; also a "Clutch" badge on the player profile hero strip.
- **Notable derivations:** "3rd-period goals as % of total," "goals while tied," "OT-winner count per player."

#### Period tendency charts
Are we a slow-starting team? Do we dominate 3rd periods? Per-period shot share and goal differential aggregated across the season.

- **Data:** `match_period_summaries` aggregated across all matches in a title/season.
- **Status:** v1 ready.
- **Surface:** `/stats` chart strip.

#### Penalty analysis
Who takes the most penalties, what infractions, at what times. Who draws the most penalties. Power-play conversion by penalty type.

- **Data:** `match_events` (event_type='penalty') + `match_penalty_events` for infraction + length.
- **Status:** v1 ready for the count side. Penalty-draw side requires Phase 5 spatial data (no current capture exposes the drawer separately).
- **Surface:** `/stats` aggregate widget; player-profile penalty tab.

#### Assist web
Now that goals carry scorer + two assists, we can build a real pass network — who sets up who most often. Render as a matrix or as a node-edge graph.

- **Data:** `match_goal_events` (scorer_player_id, primary_assist_player_id, secondary_assist_player_id).
- **Status:** v1 ready.
- **Surface:** `/stats` chemistry section — already has a chemistry table, this becomes a peer of that.

### Map-driven surfaces (Phase 5 deferred)

These all depend on populated `match_events.x` / `match_events.y`, which is Phase 5 work.

#### Team shot heatmap
Aggregate all shot coordinates across the season onto a single rink. Slot shots (high danger) vs point shots (low danger) vs perimeter shots. Identify who drives shot quality, not just volume. BGM's SHT% might look low because of too many point shots.

#### Period-filtered shot map
Filter to 3rd period: are we generating offense or defending? Does the team get hemmed in late in close games? The map makes territory visible.

#### Faceoff dominance map
The Action Tracker marks every faceoff location. Over a season: which faceoff dots do we dominate? Which do we lose? Directly maps to zone time. Faceoff Map screen's dot counts feed this directly.

#### Hit map
Where are hits happening? Lots of hits behind our own net = opponent cycling successfully. Hits along the boards in the offensive zone = we're winning puck battles.

---

## Derivable metrics (compute at query time)

These are stat lines the new data unlocks without storing anything new beyond what's already in the schema. Mostly derived in `packages/db/src/queries/` or in `apps/web/src/lib/`.

| Metric | Derivation | New? |
|---|---|---|
| Goals by period (per player) | `COUNT(*) FILTER (WHERE actor_player_id = X) GROUP BY period_number` on `match_events` | ✓ — entirely OCR-dependent |
| Game-winning goal count | Last `match_events`/`match_goal_events` row per match where `team_side = 'for'` and BGM won | ✓ |
| Two-assist games | `match_goal_events` where `primary_assist_player_id = X OR secondary_assist_player_id = X` grouped by match | ✓ |
| Per-game shot mix | `match_shot_type_summaries` per match per side; ratio per shot type | ✓ |
| 3rd-period dominance index | (3rd-period shots_for - shots_against) / total | ✓ |
| Build-class distribution per match | `player_loadout_snapshots.build_class` filtered to `match_id = X AND is_opponent_side = false` | ✓ |
| X-factor combo frequency | `player_loadout_x_factors` grouped by `(player_id, x_factor_name)` | ✓ |
| Attribute-by-group average per player | `player_loadout_attributes` joined to a group-mapping CTE; group average | ✓ |
| Penalty rate per player | `match_events` event_type='penalty' grouped by `actor_player_id` over `count(matches)` | ✓ |
| Faceoff win share by zone | Phase 5 — needs spatial data |  |

---

## Phasing summary

| Phase | What lands | Surfaces enabled |
|---|---|---|
| **0** ✓ | Schema (11 tables + review_status) | (none — schema only) |
| **1** ✓ | Worker subprocess + 4 baseline promoters (loadout, lobby, player summary no-op, registry) | Loadout snapshots ingestible end-to-end |
| **2** ✓ | 5 new Python parsers + 4 new promoters (box score, net chart, events, action tracker) | All 9 screens ingestible end-to-end |
| **3** | Production identity reconciliation (gamertag → players.id with normalize + alias + Levenshtein-1) | Action Tracker `team_side` correctness; cleaner cross-screen dedup |
| **4** | Review/promotion CLI + web queries + UI surfaces | Period summary widget, Event log section, Shot-mix readout, Pre-game lineup card, Loadout history strip, Build Library, Clutch stats, Period tendency, Penalty analysis, Assist web |
| **5** (deferred) | OpenCV rink-marker detection → populates `match_events.x`/`.y` | Team shot heatmap, Period-filtered shot map, Faceoff dominance map, Hit map |

Anything not listed under the Phase 5 row works without spatial data. Phase 5 is purely additive — it fills `x`/`y` on existing rows + adds dot-level events from Faceoff Map and Net Chart screens.

---

## Out of scope (for now)

- **Promoting OCR data into pre-existing canonical EA tables.** OCR is purely additive: it surfaces alongside EA data, never overwrites it. If EA says BGM scored 4 and OCR says 5, we trust EA and surface OCR as a discrepancy badge — we do not silently overwrite `matches.score_for`.
- **Auto-correlation of capture batches to matches.** Operator passes `--match-id` explicitly. EA match IDs aren't visible on the OCR'd screens, and date+score guesses are brittle.
- **Web review UI.** Review remains a CLI activity until volume justifies a UI.
- **Faceoff zone-split columns on `match_period_summaries`.** Faceoff Map text panel is captured to `ocr_extraction_fields` for audit; schema expansion waits until the data has a UI surface ready to consume it.

---

## Source artifacts

- Visual brainstorm mockups (gitignored): `.superpowers/brainstorm/13495-1778398004/content/ocr-features-overview.html` and `map-exploration.html`
- Schema integration plan: `docs/superpowers/plans/2026-05-10-ocr-schema-integration.md`
- Investigation notes: `research/investigations/game-ocr-integration.md`
- Build plan: `/home/michal/.claude/plans/abstract-yawning-dream.md` (outside repo)
- Reference screenshot inventory: `research/OCR-SS/` (gitignored — large binaries)
