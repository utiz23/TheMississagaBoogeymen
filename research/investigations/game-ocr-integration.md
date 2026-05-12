# Game OCR Integration Scope

Date: 2026-05-10

## Source Project

Investigated `/home/michal/projects/Game_Data_OCR`.

The OCR project is a screenshot-first Python CLI using fixed ROI YAML files and RapidOCR. Phase 1 explicitly avoids ML/computer vision beyond fixed crops and OCR. Current supported screens are:

- `pre_game_lobby_state_1`
- `pre_game_lobby_state_2`
- `player_loadout_view`
- `post_game_player_summary`

The repo-level `docs/ocr/source-screen-inventory.md` describes more target screens than the extractor currently implements, including in-game clock, goal overlays, post-game box score, events, action tracker, and event maps.

## Current Extracted Metrics

### Pre-Game Lobby

Available now:

- game mode
- our team name
- opponent team name
- team rosters by slot
- slot position
- gamertag
- CPU/empty slot flag
- player level, when OCR sees `LVL`
- build class, when OCR sees known build words
- readiness
- raw height/weight text
- state 2 only: jersey number and player name from the `#...` line

Integration use:

- pre-match lineup evidence
- opponent identity evidence
- player-position evidence before the match starts
- profile enrichment: jersey number, player name, build text, rough physical profile

Do not promote directly into `players.position` or `player_profiles` without review, because lobby OCR is slot-text based and player rows can shift.

### Player Loadout

Available now:

- selected player
- position
- player name
- player level
- platform/gamertag text
- home team
- build class
- height
- weight
- handedness
- top three X-Factors
- partial attribute-group OCR buckets: technique, power, playstyle, tenacity, tactics

Target from the document, but not fully parsed yet:

- wrist shot accuracy
- slap shot accuracy
- speed
- balance
- agility
- wrist shot power
- slap shot power
- acceleration
- puck control
- endurance
- passing
- offensive awareness
- body checking
- stick checking
- defensive awareness
- hand-eye
- strength
- durability
- shot blocking
- deking
- faceoffs
- discipline
- fighting skill

Current parser risk:

- sample output showed attribute rows collapsing across labels, for example `ACCURACY 83 SLAP SHO`, not clean numeric values.
- `player_level` parser currently turns `P2LVL40` into `240`, which is useful as raw evidence but not a clean level model.

Integration use:

- add a loadout/build layer separate from match stats.
- link snapshots to `players` after identity review.
- use as current profile/build context, not as performance canon.

### Post-Game Player Summary

Available now:

- away final score
- home final score
- some team abbreviation/name fields, but current ROI can bleed score text into abbreviation
- per-player side
- gamertag
- position played
- rank points
- goals
- assists
- saves
- save percentage

Integration use:

- post-game participant evidence
- post-game score validation against EA match row
- fill stats that EA/local tracking misses only after review

Current parser risk:

- sample output had missing team names/away abbreviation.
- home abbreviation output included score text.
- skater/goalie columns are inferred from row position, so column alignment must be reviewed.

## Documented Target Metrics Not Yet Implemented

### In-Game Clock

- home/away abbreviations
- home/away score
- home/away shots
- game clock
- period
- empty net / powerplay timer

Integration use:

- timeline state evidence
- score and shot progression by period
- powerplay state reconstruction when paired with events

### In-Game Goal Overlay

- team logo/side
- scorer name
- player goal count in game
- time of goal
- period
- primary assist
- secondary assist

Integration use:

- typed goal events
- assist reconciliation
- goal timeline validation

### Post-Game Box Score

- goals by period and total
- shots by period and total
- faceoffs by period and total

Integration use:

- period-level team summaries
- reconcile `matches.score_*`, `matches.shots_*`, and `matches.faceoff_pct`
- expose period splits not currently present in the schema

### Post-Game Events

- period
- team abbreviation/logo
- penalties: infraction, penalty type, time, culprit
- goals: time, scorer, scorer goal number, primary assist, secondary assist

Integration use:

- event log table
- penalty ledger
- goal/assist timeline

### Action Tracker / Event Map

- event category: all, goals, shots, hits, penalties, faceoffs, net chart
- period filter
- selected event
- attacker/initiator
- defender/receiver
- event type
- event time
- event period
- final score and shot context
- rink/map coordinates or marker grid
- markers for shots, hits, penalties, goals
- faceoff events, likely without map markers

Integration use:

- spatial shot/hit/penalty/goal evidence
- faceoff event locations
- richer chemistry and matchup analysis
- validates or replaces coarse EA shot-location grids where available

## Recommended Schema Shape

Keep OCR as a third layer:

1. EA canon: existing EA API raw payloads and normalized `matches`, `player_match_stats`, `opponent_player_match_stats`, `ea_member_season_stats`.
2. Local tracking: current curated/imported video and local match data.
3. OCR evidence: in-game/post-game screenshot observations with confidence, review status, and optional promotion into canonical match/event tables.

Do not write OCR directly into EA canon tables on first pass.

### New Source Tables

`ocr_capture_batches`

- id
- game_title_id
- match_id nullable
- source_asset_path or source_directory
- capture_kind: `video_frames`, `manual_screenshots`, `post_game_bundle`
- imported_by_user_id nullable
- imported_at
- notes

`ocr_extractions`

- id
- batch_id
- match_id nullable
- screen_type
- source_path
- source_hash
- ocr_backend
- overall_confidence
- raw_result_json
- transform_status: `pending`, `success`, `error`
- transform_error
- review_status: `pending_review`, `reviewed`, `rejected`
- duplicate_of_extraction_id nullable
- extracted_at
- reviewed_at

`ocr_extraction_fields`

- id
- extraction_id
- entity_type: `match`, `team`, `player`, `event`, `loadout`
- entity_key nullable
- field_key
- raw_text
- parsed_value_json
- confidence
- status: `ok`, `uncertain`, `missing`
- promoted_at nullable

This preserves raw OCR evidence and lets review tooling inspect per-field disagreement.

### New Match/Event Tables

`match_period_summaries`

- match_id
- period_number
- period_label
- goals_for
- goals_against
- shots_for
- shots_against
- faceoffs_for
- faceoffs_against
- source: `ea`, `ocr`, `manual`
- ocr_extraction_id nullable

`match_events`

- id
- match_id
- period_number
- period_label
- clock
- event_type: `goal`, `shot`, `hit`, `penalty`, `faceoff`
- team_side: `for`, `against`
- team_abbreviation nullable
- actor_player_id nullable
- actor_gamertag_snapshot nullable
- target_player_id nullable
- target_gamertag_snapshot nullable
- event_detail nullable
- x nullable
- y nullable
- rink_zone nullable
- source: `ea`, `ocr`, `manual`
- ocr_extraction_id nullable
- review_status

`match_goal_events`

- event_id
- scorer_player_id nullable
- scorer_snapshot
- goal_number_in_game nullable
- primary_assist_player_id nullable
- primary_assist_snapshot nullable
- secondary_assist_player_id nullable
- secondary_assist_snapshot nullable

`match_penalty_events`

- event_id
- culprit_player_id nullable
- culprit_snapshot
- infraction
- penalty_type
- minutes nullable

These tables add detail without bloating `matches`.

### New Player Build Tables

`player_loadout_snapshots`

- id
- player_id nullable
- gamertag_snapshot
- player_name_snapshot
- game_title_id
- match_id nullable
- source_extraction_id
- position
- build_class
- height_text
- weight_lbs nullable
- handedness
- player_level_raw
- player_level_number nullable
- platform
- captured_at
- review_status

`player_loadout_x_factors`

- loadout_snapshot_id
- slot_index
- x_factor_name

`player_loadout_attributes`

- loadout_snapshot_id
- attribute_key
- raw_text
- value nullable
- confidence

This is profile/build data, not match performance data.

## Promotion Rules

- Raw extraction is always inserted first.
- Parsed fields with `status != ok` or confidence below a threshold stay pending.
- OCR can auto-link to an existing `matches` row only when score, teams, date/time window, and game mode agree.
- OCR player identity should resolve by current gamertag/history first, then fall back to unmatched snapshot rows.
- OCR post-game player summaries may update or create player-level match stats only after review.
- OCR event data should not backfill `player_match_stats.goals/assists` until it reconciles with the post-game summary and final score.
- Conflicts with EA canon should create review flags, not overwrite EA fields.

## First Implementation Slice

1. Vendor or wrap the OCR CLI from `Game_Data_OCR` as a tool, not a direct dependency yet.
2. Add OCR source/evidence tables.
3. Import `post_game_player_summary` JSON into pending review rows.
4. Build a reconciliation query: match by score + game title + likely date/path metadata.
5. Add a small admin/review page later; initially use SQL/CLI review.
6. Only after reviewed imports are reliable, add event-map parsers and event tables.

## Metrics Priority

V1, high confidence:

- post-game score
- participant gamertags
- player positions played
- goals
- assists
- goalie saves
- goalie save percentage
- rank points
- pre-game lineup slots
- jersey number/player name from lobby state 2

V1.5:

- loadout build class
- height/weight/handedness
- X-Factors
- cleaned player attributes

V2:

- goal and assist event timeline
- penalties and infractions
- period goals/shots/faceoffs
- shots/hits/penalties/faceoffs event maps
- spatial event coordinates

## Open Risks

- ROI configs assume 1920x1080 stable layouts.
- Parser quality is currently behind the document scope.
- Some fields are visually available but semantically ambiguous without team-side mapping.
- OCR should be treated as human-reviewable evidence until multiple screenshots for the same match agree.
- The current web app has no admin review UI for OCR imports yet.
