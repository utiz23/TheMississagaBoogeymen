# Advanced Stat Tracking Roadmap

Date: 2026-05-16

This is a planning and brainstorm doc for the next OCR/data-extraction phases. It reviews the current video OCR stack, then sketches the path from menu/postgame extraction into advanced stat tracking: rink locations, possession proxies, player tracking, and puck tracking.

Blunt framing: the current stack is good at reading game UI. It is not yet a gameplay tracking system. Trying to fake player/puck tracking by adding more ROI OCR parsers would be a waste. The right path is to keep the OCR pipeline as the evidence layer for structured screens, then add a separate vision telemetry layer for continuous gameplay frames.

---

## Current State

### What exists

The project currently has three connected extraction layers:

1. **Screenshot OCR CLI** in `tools/game_ocr`
   - RapidOCR-backed extraction.
   - Fixed screen registry.
   - Screen-specific parsers.
   - Field confidence/status output.
   - Full-frame anchor parsing where useful, especially lobby/loadout screens.

2. **Two-pass video ingest** in `tools/video_ingest`
   - Pass 1: sample video at low cadence, classify screen windows with hybrid color signature + OCR anchors.
   - Pass 2: extract dense PNG frames only inside accepted screen windows.
   - Optional dispatch into the worker OCR ingest path.
   - Version-pinned config, currently `nhl26`.

3. **Review-gated database promotion**
   - Raw OCR batches/extractions/fields in `ocr_capture_batches`, `ocr_extractions`, `ocr_extraction_fields`.
   - Domain tables for period summaries, shot types, events, goals, penalties, and loadouts.
   - Worker promoters move parsed OCR into domain tables without overwriting EA API canon.
   - `review_status` is present, but still has process risk: reviewed data can be wrong if the review pass is too loose.

### Screens currently covered by code/schema

Primary implemented extraction targets:

- `pre_game_lobby_state_1`
- `pre_game_lobby_state_2`
- `player_loadout_view`
- `post_game_player_summary`
- `post_game_box_score_goals`
- `post_game_box_score_shots`
- `post_game_box_score_faceoffs`
- `post_game_events`
- `post_game_action_tracker`
- `post_game_faceoff_map`
- `post_game_net_chart`

Schema also already reserves:

- `in_game_clock`
- `in_game_goal_state_1`
- `in_game_goal_state_2`

### What the current stack can already support

With current tables and promoters, the site can support:

- Period goals/shots/faceoffs.
- Goal and penalty timeline.
- Shot/hit/penalty/goal event list from Action Tracker.
- Rink coordinates for non-faceoff events when the marker workflow is completed.
- Goal details: scorer, primary assist, secondary assist, goal number.
- Penalty details: culprit, infraction, type, minutes.
- Team shot-type summaries from Net Chart.
- Per-match pregame lineup and player build snapshots.
- Player X-Factors, X-Factor tiers, attributes, height, weight, handedness, platform, level.
- Opponent roster/build scouting, once side resolution and identity matching are tightened.

### Known strengths

- **Fail-closed screen classification.** Unknown screens are skipped instead of silently misparsed.
- **Good provenance.** Raw OCR JSON and per-field data are preserved.
- **Non-destructive model.** OCR adds evidence; it does not overwrite EA canon.
- **Multi-frame consensus works.** Pre-game loadout/lobby extraction improved dramatically once repeated captures were fused.
- **Action Tracker spatial workflow is real.** Match 250 reached 72/72 placed non-faceoff events after calibration/importer fixes.

### Known weak spots

- **Review quality is the bottleneck.** `reviewed` means approved, not necessarily correct.
- **Identity resolution still needs tightening.** Player aliases and display-name variants directly affect `team_side`, actor IDs, and chemistry stats.
- **Manual spatial labelling does not scale.** CVAT marker labels are fine for a pilot, ugly for season-wide throughput.
- **Postgame Action Tracker is event-level, not possession-level.** It tells us where logged events happened, not what everyone did between events.
- **In-game HUD parsers are schema-reserved but not production-built.** Clock and goal overlays are important because they let us align live gameplay windows with postgame events.
- **Player/puck tracking is not present.** There is no detector, tracker, camera calibration, jersey/color association, puck detector, or frame-by-frame telemetry schema.

---

## Architecture Decision

Do not overload the OCR stack.

Future extraction should split into two data products:

1. **Structured UI OCR**
   - Menus, lobby, loadout, postgame screens, scoreboard, goal overlays.
   - Output: facts shown by the game UI.
   - Current stack owns this.

2. **Gameplay telemetry**
   - Continuous gameplay frames.
   - Detect/track players, goalie, puck, rink geometry, scorebug state, possession windows.
   - Output: inferred movement and event context.
   - Needs a new pipeline, new schema, and new review tooling.

The bridge between the two is match time:

- `match_id`
- video PTS timestamp
- game period
- game clock
- score state
- event ID when known

If this bridge is weak, every advanced metric becomes suspect garbage with a pretty chart.

---

## Phase Plan

## Phase A: Harden Current OCR Evidence Layer

Goal: make current OCR reliable enough that advanced stats can use it as ground truth scaffolding.

Work:

- Add stricter review CLI rules: require confidence thresholds, sample raw rows, and flag suspicious values before bulk approval.
- Make identity resolution less manual:
  - normalize gamertags and persona names;
  - use `player_display_aliases`;
  - add Levenshtein-1 matching only behind review;
  - surface unresolved actor names in a queue.
- Add duplicate/phantom event guards:
  - do not create a new event from a single weak OCR row if adjacent captures disagree;
  - require period + clock + actor/event-type consistency where possible.
- Finish useful UI surfaces from current OCR:
  - event timeline;
  - period summary;
  - shot mix;
  - lineup/loadout card;
  - player loadout history;
  - action tracker rink map.

Metrics unlocked:

- Goals by period/player.
- First goal, response goals, OT goals, game winners.
- Penalty timing and culprit distribution.
- Assist web.
- Period shot share and faceoff share.
- Build/X-Factor usage over time.

Why this comes first: advanced tracking needs clean match/event anchors. If the event layer is polluted, tracking math will confidently explain the wrong events.

## Phase B: Automate Event-Map Spatial Extraction

Goal: remove manual CVAT from normal operation.

Current pilot proved the concept:

- selection row can be detected via white border;
- selected marker can be found;
- calibration can map pixels to hockey coordinates;
- importer can fail loudly instead of smearing labels onto the wrong event.

Next work:

- Promote `selected_event_x/y` extraction from helper artifact to first-class importer input.
- Store spatial provenance per event:
  - auto marker detection;
  - CVAT/manual label;
  - direct operator correction;
  - confidence class.
- Add a confidence gate:
  - no selected row -> no coordinate write;
  - no selected marker -> no coordinate write;
  - out-of-rink or extreme extrapolation -> pending review.
- Add per-period attack-direction handling.
- Add faceoff coordinate support from Action Tracker or Faceoff Map.
- Add batch QA:
  - expected event count versus Action Tracker rows;
  - shots/goals/hits/penalties by period versus box score/postgame totals;
  - coordinate distribution sanity checks.

Deferred backlog item (scoped 2026-07-04, Session-1 inspect-and-define; not started):

- **Net-chart net-mouth shot placement.** The `post_game_net_chart` screen plots each shot/goal as an `S` / `G` marker _on the goal mouth_ (glove/blocker × high/low/five-hole); today only the left-hand shot-type count table is extracted and the marker placement is discarded. Key finding from inspecting a real frame: this is a **distinct coordinate system from the rink** — `spatial.py` maps to rink coords (x ∈ [-100,100], y ∈ [-42.5,42.5]) via rink landmarks, whereas the net diagram needs its own **goal-frame calibration** + a net-relative `(u,v)` model + its **own DB table** (cannot reuse `match_events.x/y`, which are rink-space). The generic marker detector and shape classifier reuse cleanly (`hexagon=goal`, `circle=shot` already implemented). Markers are **anonymous** (no per-shooter identity on-screen, ~5–7/period) → a **team-aggregate net-placement heatmap** only ("where BGM scores from / where our goalie gets beaten"), not per-player. Effort = a full vertical slice: calibration → coordinate model → DB table → promoter → frontend heatmap → benchmark (multi-session, similar shape to the Action Tracker build).
- **Correction to this phase's faceoff bullets ("Add faceoff coordinate support … from Faceoff Map", "Faceoff dot/location map"):** the Faceoff Map's 9 fixed dots are **already extracted** categorically (`dot_id` + win counts) and the `/games` faceoff-dominance map already renders them. That half is **shipped** — no marker-detection work is needed for faceoffs; only the net-chart item above remains as spatial-extraction work.

Metrics unlocked:

- Team and player shot maps.
- Shot distance and angle proxies.
- High-danger / slot / point / perimeter splits.
- Hit map.
- Penalty location map.
- Faceoff dot/location map.
- Goalie goals-against location map.

This phase is still OCR-adjacent. It uses UI artifacts, not raw gameplay object tracking.

## Phase C: In-Game HUD Synchronization

Goal: align raw video time to game time.

Required before serious player/puck tracking because gameplay video has pauses, cutscenes, replays, menu pauses, and stoppages.

Work:

- Implement `in_game_clock` parser:
  - period;
  - clock;
  - score;
  - shots;
  - power play / empty net state if visible.
- Implement `in_game_goal_state_1` and `in_game_goal_state_2` parsers:
  - scorer;
  - assist names;
  - goal time;
  - period;
  - team.
- Build a time-sync table:
  - video PTS;
  - period;
  - clock;
  - score;
  - source extraction;
  - confidence.
- Build a timeline resolver:
  - interpolate game-clock between reliable HUD reads;
  - stop interpolation during replays/menus/cutscenes;
  - snap known goal overlays to postgame goal events.

Likely schema:

- `match_video_sources`
- `match_video_clock_samples`
- `match_video_segments`

Metrics unlocked:

- True score-state windows.
- Leading/trailing/tied time.
- Time-on-attack proxies by visible gameplay segment.
- Event lead-up clips.
- Better automatic match/event reconciliation.

## Phase D: Gameplay Segmentation

Goal: isolate actual playable broadcast/gameplay frames from menus, replays, cutscenes, and static UI.

Work:

- Extend Pass 1 with gameplay states:
  - live gameplay;
  - replay;
  - faceoff setup;
  - pause/menu;
  - cutscene;
  - post-whistle idle.
- Use a hybrid detector:
  - scorebug/HUD presence;
  - rink/ice color geometry;
  - camera motion;
  - clock changing/not changing;
  - optional lightweight classifier after enough labeled frames exist.
- Emit segments with:
  - start/end PTS;
  - segment type;
  - period/clock range if known;
  - confidence.

This is where the system starts becoming a video analytics pipeline instead of a postgame screen parser.

## Phase E: Player Tracking Prototype

Goal: track skater/goalie blobs well enough for possession and spacing proxies. Do not start with jersey/name identification. Start with "our five skaters vs their five skaters plus goalies".

Minimum viable approach:

- Detect rink bounds and camera view.
- Segment players using:
  - jersey/team color masks;
  - motion/foreground cues;
  - human/player detector if needed;
  - goalie-specific area priors.
- Track detections with a standard tracker:
  - Kalman + Hungarian matching;
  - ByteTrack/OC-SORT-style tracking if a detector is introduced;
  - short tracklet stitching across occlusion.
- Associate team side:
  - jersey colors from pregame/lobby/team uniforms;
  - scoreboard side;
  - attack direction by period.
- Store anonymous tracks first:
  - `team_side`;
  - `role_guess`;
  - rink x/y;
  - screen bbox;
  - confidence.

Do not try to identify exact players in v1. Exact identity from overhead-ish gameplay video is hard, jerseys are small, camera zoom varies, and EASHL nameplates are not always visible. Forcing identity too early will poison the dataset.

Likely schema:

- `match_tracking_runs`
- `match_player_tracks`
- `match_player_track_points`
- `match_track_event_links`

Metrics unlocked:

- Team spacing.
- Rush vs set-zone shape.
- Defensive gap/pressure proxy.
- Offensive-zone presence.
- Net-front presence.
- Screen/traffic proxy.
- Odd-man rush candidates.
- Backcheck participation proxy.
- Lineup-level territorial tilt.

Review tool need:

- frame viewer with overlayed tracks;
- track split/merge correction;
- team-side correction;
- segment-level approve/reject.

## Phase F: Puck Tracking Prototype

Goal: detect enough puck state to infer possession transitions and shot/pass candidates.

This is harder than player tracking. The puck is tiny, fast, often motion-blurred, often hidden by players/boards, and sometimes indistinguishable from skate/stick noise.

Minimum viable approach:

- Start around known event windows:
  - 5 seconds before shots/goals;
  - faceoff drops;
  - turnovers if visible;
  - goalie saves if visible.
- Use a layered detector:
  - dark small-object candidates on ice;
  - motion streaks;
  - stick/puck proximity;
  - event-map/postgame anchors;
  - temporal continuity.
- Store candidates, not fake certainty:
  - puck x/y;
  - screen bbox/point;
  - confidence;
  - visibility state: visible, inferred, occluded, unknown.

Likely schema:

- `match_puck_track_points`
- `match_possession_windows`
- `match_puck_candidate_events`

Metrics unlocked:

- Possession windows.
- Zone entries/exits proxy.
- Pass sequence candidates.
- Shot release location from gameplay, cross-checked against Action Tracker.
- Loose-puck recoveries.
- Turnover candidates.
- Time between possession gain and shot.

Guardrail: no public-facing puck-derived metric should ship without confidence bands and review flags.

## Phase G: Identity-Aware Tracking

Goal: connect anonymous tracks to actual BGM players when confidence is high enough.

Possible signals:

- nameplates when visible;
- player position from pregame lineup;
- starting faceoff formation;
- handedness/stance;
- role location priors;
- event actors from Action Tracker;
- goal/shot/hit/penalty actor at a known timestamp;
- manual operator correction.

Output should be probabilistic:

- `track_id`;
- candidate `player_id`;
- confidence;
- evidence source;
- valid time range.

Metrics unlocked:

- Player time-on-ice proxy in visible segments.
- Individual possession share proxy.
- Player shot-assist/pass-lane involvement.
- Player spacing tendencies.
- Defensive coverage and missed assignment candidates.
- Build-to-behavior analysis: speed/strength/checking/faceoff attributes versus actual tracked behavior.

## Phase H: EDGE-Style Goal Visualizer

Goal: build the presentation layer people actually want to click on: a clean rink diagram that explains how a goal happened. Do not confuse this with true NHL EDGE-quality tracking.

Important distinction:

- **EDGE-style visualizer** means the UX shape:
  - rink view;
  - event markers;
  - numbered sequence;
  - team branding;
  - filters by team/player/period/game situation;
  - optional clip link.
- **EDGE-grade tracking** means the underlying fidelity:
  - precise puck path;
  - player paths;
  - pass chain certainty;
  - pressure/traffic context;
  - release timing and location from gameplay telemetry.

We can likely ship the first long before we can ship the second.

### Versioning Strategy

#### Visualizer v1: Event-Sequence Explainer

Build this from postgame OCR, Action Tracker coordinates, and clock sync. No fake tracking.

What it can show honestly:

- goal location;
- previous shots/events in the same possession window, if anchored;
- faceoff origin if the play starts from a known draw;
- scorer, assists, period, clock, score state, strength state;
- shot type if extracted;
- rebound / deflection / rush / cycle tags only when confidence rules support them;
- a short clip window if video PTS has already been aligned.

What it should not pretend to show:

- exact puck trail;
- exact pass path;
- exact player routes;
- exact defender coverage;
- exact goaltender depth;
- possession certainty when the source is only OCR plus sparse events.

This is still useful. A numbered goal sequence on a rink is a much better product than a raw event table, even if it is built from sparse event anchors.

#### Visualizer v2: Assisted Spatial Replay

Add:

- linked gameplay clip;
- optional player blobs/anonymous tracks;
- inferred possession path;
- confidence-colored arrows instead of hard claims;
- event-to-video crosshair alignment.

This version depends on:

- reliable `video_pts -> game_clock`;
- gameplay segmentation;
- at least anonymous player tracking;
- review tooling for corrections.

#### Visualizer v3: Tracking-Aware Goal Replay

Only after player and puck tracking are good enough:

- puck route candidates;
- skater route overlays;
- traffic/screening around release;
- slot collapse / defender spacing;
- controlled entry to shot sequence;
- time-to-shot from possession gain;
- pass chain candidates with confidence.

This is the version that starts approaching the spirit of NHL EDGE instead of just borrowing its visual language.

### Data Model Needed

Likely tables/artifacts:

- `match_goal_visualizations`
- `match_goal_visualization_steps`
- `match_goal_possession_windows`
- `match_goal_clip_links`
- `match_goal_visualization_review`

Each step should store:

- `match_id`
- `goal_event_id`
- `sequence_index`
- `event_type`
- `team_id`
- `player_id` when known
- `period`
- `clock_seconds_remaining`
- `rink_x`
- `rink_y`
- `source_type`
  - action_tracker
  - postgame_event_log
  - gameplay_tracking
  - inferred
- `confidence`
- `review_status`

Guardrail: every drawn object on the rink should have provenance. If a dot, arrow, or label exists, we should know whether it came from extracted coordinates, gameplay tracking, or inference.

### Classification Opportunities

Once the visualizer exists, we can add derived labels with clear evidence rules:

- rush goal;
- rebound goal;
- net-front tip/deflection;
- off faceoff;
- broken play / scramble;
- cycle-generated;
- odd-man chance;
- east-west pass before shot;
- point-shot with traffic.

These should start as review-assisted tags, not fully automatic truth.

### Review Tool Requirement

The visualizer will create trust issues if we cannot inspect and correct it.

Minimum reviewer actions:

- approve/reject full visualizer;
- drag event point if coordinate extraction is wrong;
- reorder or delete a sequence step;
- mark an arrow/path as inferred;
- attach or trim a clip window;
- set public visibility only after review.

### Recommendation

Treat this as a product layer built on top of Phases B through G, not as a separate computer vision moonshot.

Practical order:

1. Ship `Visualizer v1` from sparse event data plus synced clips.
2. Add `Visualizer v2` once anonymous player tracking and segment review exist.
3. Attempt `Visualizer v3` only after puck and player tracking stop hallucinating.

Bluntly: copy the NHL.com interaction model first, not the NHL tracking stack. The UX is achievable. The telemetry quality is the hard part.

---

## Research-Informed ML/CV Directions

This section converts relevant sports CV research into practical decisions for this project. The point is not to admire papers. The point is to avoid building the wrong thing first.

### 1. Treat Rink Registration as a First-Class System

Research signal:

- `Sports Field Localization via Deep Structured Models` (CVPR 2017) shows field/rink localization from a single broadcast image can be automated from semantic cues instead of hand-annotating key frames.
- `TVCalib` (WACV 2023) argues sports registration should be treated as camera calibration, not just rough homography estimation.
- `No Bells Just Whistles` (CVPRW 2024) emphasizes geometry-driven registration and notes temporal consistency as an obvious next step for broadcast video.

Project implication:

- Build rink calibration as its own module, not as a side effect of player tracking.
- Use line, circle, crease, and blue-line geometry as stable anchors.
- Store both:
  - image-space detections;
  - rink-space transforms and quality scores.
- Add temporal smoothing across nearby frames. A single-frame solve is not enough for broadcast pans and zooms.

Why this matters:

- Every downstream task gets better once image coordinates can be projected into rink coordinates.
- Without stable calibration, player tracking, puck localization, shot lanes, and any EDGE-style visualizer become fake precision.

### 2. Frame Player Tracking as Association Plus Rink Context

Research signal:

- `SportsMOT` (ICCV 2023) identifies association, not just detection, as the core sports MOT problem.
- `Efficient Tracking of Team Sport Players With Few Game-Specific Annotations` (CVPRW 2022) shows few game-specific labels plus semi-interactive correction can go further than generic MOT assumptions.
- `Multi Player Tracking in Ice Hockey with Homographic Projections` (2024) improves hockey MOT by projecting foot keypoints onto an overhead rink template and using that spatial context for association.
- `Player Tracking and Identification in Ice Hockey` (2021) and `Evaluating deep tracking models for player tracking in broadcast ice hockey video` (2022) both reinforce that hockey broadcast tracking fails on occlusion, blur, zoom, and same-team appearance similarity.

Project implication:

- Track anonymous players first.
- Do not rely on screen-space bounding boxes alone for association.
- Project footpoints to rink coordinates as early as possible and use projected motion as a primary feature.
- Expect MOT quality to be bottlenecked by:
  - overlap at boards;
  - camera cuts and zooms;
  - lookalike uniforms;
  - long occlusions.

Architecture consequence:

- Detector
- tracker
- rink projection
- tracklet association
- review/correction

Do not collapse all of this into one magical model.

### 3. Separate Identity From Tracking

Research signal:

- `Player Tracking and Identification in Ice Hockey` (2021) breaks the problem into tracking, team identification, and player identification.
- `Ice Hockey Player Identification via Transformers and Weakly Supervised Learning` (CVPRW 2022) uses temporal tracklets and OCR-derived player shift constraints to improve identification.
- Modern jersey-number recognition work still struggles with blur, occlusion, orientation, and low resolution.

Project implication:

- Keep identity as a later probabilistic layer over stable tracklets.
- Use every weak constraint available:
  - lineup/roster;
  - on-ice shift data if inferable;
  - scorebug clock;
  - handedness/role priors;
  - known event actors;
  - visible nameplates / jersey digits.
- Do not force exact `player_id` when only `team_side` and `role_guess` are reliable.

Practical rule:

- anonymous tracks can power spacing metrics;
- identity-aware tracks are required only when publishing player-level claims.

### 4. Puck Localization Must Be Contextual, Not Naive Detection

Research signal:

- `Puck Localization and Multi-Task Event Recognition in Broadcast Hockey Videos` (CVPRW 2021) uses temporal context, player-location heatmaps, and multi-task event recognition to localize the puck.
- `What Players Do With the Ball` (CVPR 2016) shows that small-object tracking improves when interaction with players and physical trajectory constraints are modeled together.
- `Tracking Small and Fast Moving Objects: A Benchmark` (ACCV 2022) makes the obvious point official: generic trackers underperform badly on small, fast sports objects.

Project implication:

- Do not build puck tracking as "run a detector on every frame and hope."
- Restrict the search to informative windows first:
  - pre-shot;
  - pre-goal;
  - faceoff drop;
  - goalie save;
  - turnover candidates.
- Feed the model context:
  - temporal clips;
  - projected player positions;
  - stick proximity;
  - known event anchors;
  - physical continuity priors.

Practical output:

- visible puck point;
- inferred puck point;
- occluded;
- unknown.

The system should output candidates and confidence, not pretend certainty.

### 5. Event Spotting Should Use Temporal Context and Dense Anchors

Research signal:

- `A Context-Aware Loss Function for Action Spotting in Soccer Videos` (CVPR 2020) improves spotting by modeling temporal context around the labeled instant instead of treating the target as a single isolated frame.
- `Temporally Precise Action Spotting in Soccer Videos Using Dense Detection Anchors` (ICIP 2022) shows dense anchor formulations plus temporal displacement prediction improve precise localization.
- `Spotting Temporally Precise, Fine-Grained Events in Video` (ECCV 2022) argues precise spotting needs both global temporal reasoning and local frame-level discrimination.

Project implication:

- Our gameplay event detector should not start as coarse clip classification.
- It should start as timestamp spotting with:
  - dense temporal candidates;
  - offset refinement;
  - long-context features;
  - frame-local evidence.

Good early targets:

- puck drop;
- shot release;
- whistle;
- replay start/end;
- scorebug disappear/reappear;
- goalie freeze;
- faceoff setup complete.

These are the scaffolding events that make later possession and goal-sequence reconstruction possible.

### 6. Build an Internal Benchmark Early

Research signal:

- Hockey-specific public datasets are limited.
- Multiple hockey papers explicitly rely on manually annotated private datasets.
- SportsMOT and TSFMO exist, but neither is a drop-in benchmark for EASHL broadcast gameplay.

Project implication:

- We need our own benchmark if we want honest iteration.
- Make it small but disciplined.

Recommended internal benchmark slices:

- rink calibration frames across camera states;
- 10-second live-play tracking clips;
- puck-visible shot windows;
- goal-sequence clips;
- Action Tracker selected-marker samples;
- scorebug/clock OCR samples.

For each slice, define:

- metric;
- failure mode;
- human review path.

If we cannot measure progress, we will end up arguing from vibes.

### 7. Prefer Modular Systems Over One End-to-End Mega-Model

Research signal:

- The strongest sports CV systems in practice are usually pipelines:
  - calibration;
  - detection;
  - tracking;
  - association;
  - identity;
  - event inference.
- Even where learning is used heavily, the successful methods preserve explicit geometry, temporal structure, and reviewability.

Project implication:

Near term, use ML where it adds clear value:

- scoreboard/clock OCR cleanup;
- gameplay/live/replay segmentation;
- rink element segmentation;
- player detection;
- tracklet association;
- jersey number recognition;
- temporal event spotting;
- puck candidate scoring.

Do not hide all logic inside an end-to-end model that cannot explain:

- why a point was placed;
- why a player identity was assigned;
- why a goal sequence was reconstructed.

### Working Recommendation

Use research to justify a staged stack:

1. `Calibration first`
2. `Anonymous player tracking second`
3. `Contextual puck localization third`
4. `Temporal event spotting fourth`
5. `Identity and advanced derived metrics after review tooling exists`

That is the shortest path from our current OCR/event pipeline to something that looks like advanced hockey analytics without lying about what the system actually knows.

---

## Advanced Metric Brainstorm

### Safe Near-Term Metrics

These can be built from current OCR plus Phase B/C work:

- Clutch goals: 3rd period, OT, final 5 minutes.
- Response goals after conceding.
- Goals while tied/leading/trailing.
- Penalty damage: goals against within the resulting penalty window.
- Shot map by player/team/period.
- Shot quality proxy from location buckets.
- Faceoff map by dot/zone.
- Shot type mix by team and period.
- Assist network.
- Build and X-Factor usage versus scoring/shot/hit rates.

### Medium-Term Tracking Metrics

These need player tracks but not perfect puck tracking:

- Offensive-zone occupancy.
- Net-front presence.
- Slot presence.
- Defensive shape width/depth.
- Rush support lanes.
- Backcheck depth.
- Odd-man rush detection.
- Pressure near puck carrier, if puck carrier is inferred.
- Goalie screen/traffic proxy.

### Hard Metrics

These need puck tracking and identity, so treat them as research until proven:

- True possession time by player.
- Completed passes.
- Expected goals from release point plus traffic.
- Zone entries/exits by carrier.
- Controlled exits.
- Turnovers forced by player.
- Individual defensive coverage quality.
- Puck recoveries.
- Shot assists.

### Probably Not Worth It Yet

- Full NHL EDGE clone.
- Real-time processing.
- Perfect player identity on every frame.
- Fully automatic puck tracking across entire games.
- Deep learned models before a labeled dataset exists.

---

## Data Collection Requirements

Advanced tracking will fail without better source data. Needed:

- Original 1080p60 or better recordings, not compressed social clips.
- Stable capture settings.
- Full game video with pregame, gameplay, postgame, and Action Tracker scroll-through.
- No crop changes mid-session.
- Consistent file naming and match ID association.
- A small labeled dataset:
  - gameplay segments;
  - player boxes/points;
  - puck points where visible;
  - rink landmarks;
  - scoreboard clock samples;
  - Action Tracker selected-marker frames.

Suggested first dataset:

- 3 matches:
  - one clean win;
  - one close loss;
  - one overtime game.
- For each:
  - full video;
  - postgame Action Tracker event scroll;
  - 2-3 manually labelled gameplay clips per period;
  - 10-20 puck-visible shot windows;
  - full OCR extraction output.

---

## Technical Spikes

### Spike 1: HUD Clock Sync

Question: can we map video PTS to period/clock accurately enough?

Success criteria:

- 95%+ readable clock samples during gameplay HUD visibility.
- Goal overlay timestamps match postgame goal events.
- Interpolated timeline does not run through replays/menus.

### Spike 2: Automatic Action Tracker Marker Coordinates

Question: can `selected_event_x/y` replace CVAT for normal matches?

Success criteria:

- 95%+ selected marker detection on clean Action Tracker captures.
- 0 silent wrong-event coordinate writes.
- Failed frames enter review, not the DB as false precision.

### Spike 3: Anonymous Player Tracking

Question: can we track team-side player positions in live gameplay clips?

Success criteria:

- stable team-side tracks for at least 10-second live-play windows;
- fewer than 1 severe identity/team swap per 10 seconds;
- useful rink-coordinate projection for visible skaters.

### Spike 4: Puck Detection Around Shot Events

Question: can we detect the puck around known shot/goal windows?

Success criteria:

- visible puck candidate in most manually selected shot windows;
- confidence score separates real puck from skate/stick noise;
- inferred release location roughly matches Action Tracker shot coordinate.

### Spike 5: Review Overlay Tool

Question: can a human review tracks fast enough to make this practical?

Success criteria:

- video frame with player/puck overlays;
- approve/reject segment;
- correct team side;
- split/merge track;
- link track to player when obvious.

---

## Suggested Next Build Order

1. Finish Phase A cleanup and user-facing OCR surfaces.
2. Automate Action Tracker coordinates enough to avoid CVAT for normal matches.
3. Build in-game clock samples and `video_pts -> game_clock` sync.
4. Add gameplay segment classification.
5. Prototype anonymous player tracking on short clips.
6. Prototype puck tracking only around known shot events.
7. Add review tooling before any public advanced metric ships.
8. Only then attempt identity-aware player metrics.

The order matters. Puck tracking before clock sync is noise. Identity-aware tracking before anonymous tracks are stable is fantasy. Public metrics before review tooling is how bad data becomes permanent.

---

## Open Questions

- What video quality is the normal source: 1080p60, 1440p, or something else?
- Are player nameplates visible often enough to help identity?
- Does the camera angle remain consistent enough for one rink calibration per game state?
- Can we reliably detect attack direction per period from UI/postgame context?
- How much manual review per match is acceptable?
- Should advanced tracking live in PostgreSQL only, or should dense frame-level telemetry live in Parquet/SQLite artifacts with summarized rows promoted to Postgres?
- What is the first public-facing advanced metric worth shipping: shot quality, possession proxy, traffic/screening, or spacing?

---

## Immediate Recommendation

Do the next work in this sequence:

1. **Current OCR hardening:** identity resolution, phantom event guards, review discipline.
2. **Event-map automation:** selected marker coordinate extraction with strict failure gates.
3. **Clock sync:** build the video/game-time bridge.
4. **Tiny tracking pilot:** anonymous player tracking on a few known live-play clips.

That gives a sane ladder from today's working system to advanced stat tracking without pretending the current OCR parser can magically see the puck.
