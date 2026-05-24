# Redesign Round 1 — Internal Codebase Assessment (2026-05-19)

> Round 1 of a four-round research process. Produced by an internal Plan agent
> reading the existing pipeline + spec docs end-to-end. Feeds Round 4 synthesis.

## 0. Method

I read both spec docs in full (`docs/ocr/source-screen-inventory.md`, `research/OCR-SS/Manual OCR benchmark for verification V2.md`), both calibration docs (`baseline-2026-05-19.md`, `redesign-scope-2026-05-19.md`), the Pass 1 + 2 orchestration code, the classifier, all 8 promoters, the matching dedup helper, the inventory-consensus matcher, the match-quality CLI, the match-250 benchmark test, the schema, the EA-API member-ingest flow, and the version YAML configs. Where I cite a "line" the file path is anchored to the top-of-repo at `/home/michal/projects/eanhl-team-website/`.

## 1. Inventory the pipeline must produce — the per-match field budget

Below is the canonical field set across all screens that the redesign must reliably extract. Counts are per-match. "Slot" = a discriminable row/column whose value differs across slots. "Instance" = how many times the slot is captured in a single match.

### Critical Point 1 — Pre-Game (two screens, optional Loadout View)

**Lobby (state 1 + state 2 combined).** `source-screen-inventory.md:9-57`. Per-team panel × 2 teams × 6 slots:

| Field group                                                                                                                        | Per slot |                       Per match |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------: | ------------------------------: |
| `gamemode` (one for both teams)                                                                                                    |        1 |                               1 |
| `team_name` × 2 teams                                                                                                              |        1 |                               2 |
| Per-slot: `position`, `position_colour`, `player_level`, `gamertag`, `platform`, `is_captain`, `is_cpu_or_empty` (state-invariant) |        7 |                  7 × 6 × 2 = 84 |
| State-1 only: `build_class`, `build_height`, `build_weight`, `x_factor_1/2/3`                                                      |        6 | 6 × 5 × 2 = 60 (G is CPU, skip) |
| State-2 only: `player_number`, `player_name` (persona)                                                                             |        2 |                  2 × 5 × 2 = 20 |

Subtotal lobby: ≈ **3 + 84 + 60 + 20 = 167 fields/match**.

**Player Loadout View.** `source-screen-inventory.md:60-107`. Per slot (10 BGM+opp skaters):

| Field group                                                                                                                                                                     |                   Per slot |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------: |
| Identity & build: `is_selected`, `player_position`, `player_name_full`, `player_level`, `platform`, `gamertag`, `home_or_away`, `build_class`, `height`, `weight`, `handedness` |                         11 |
| `x_factor_1/2/3` (each carries name + tier — V2 has these as a single hyphenated string but they're 2 fields apiece)                                                            |      3 names + 3 tiers = 6 |
| Attributes (5 groups × 4-5 keys = 23 attrs; each attr has a value 0–99 AND a delta chip; V2 shows the value column only)                                                        | 23 values + 23 deltas = 46 |

Subtotal loadout: 11 + 6 + 46 = **63 fields/slot × 10 slots = 630 fields/match** when fully captured.

### Critical Point 2 — In Game (clock + goal overlays)

**In Game Clock.** `source-screen-inventory.md:124-136`. Continuously visible during play (~50 minutes of source video per match). 9 fields/instance: `away_abbr, home_abbr, away_score, home_score, away_shots, home_shots, time, period, pp_or_empty_net_timer`. The redesign nominally needs these per "interesting" moment (~50 events). But L1 doesn't classify this screen at all (`tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml:1-50` has no `in_game_clock` class, and no extractor entry exists in `tools/game_ocr/game_ocr/extractor.py:37-93`). **Currently captured: 0.**

**In Game Goal Overlay.** `source-screen-inventory.md:139-164`. State 1: 6 fields (team logo, scorer, stat, amount, time, period). State 2: 6 fields (team logo, primary assist, secondary assist, stat, time, period). Appears for ~5 sec per goal × ~4 goals = ~24 instances/match. **Currently captured: 0** (`OcrScreenType` declares `in_game_clock`, `in_game_goal_state_1/2` at `packages/db/src/schema/ocr-pipeline.ts:25-27` but classifier and extractor have no entries; promoter registry has no entry).

### Critical Point 3 — Post Game

**Post-Game Player Summary.** `source-screen-inventory.md:170-189`. 6 header fields + per-player record. ~10 player records × 8 fields each (`platform, gamertag, build, rank, position_played, rp, goals, assists, saves, save_pct`) = **6 + ~80 = 86 fields/match**.

**Box Score (3 tabs: goals, shots, faceoffs).** `source-screen-inventory.md:190-220`. Each tab: 2 teams × ≥4 periods × 1 stat = 8 cells, plus 2 team labels + 1 tab label + ≥4 period labels. ~15 fields/tab × 3 tabs = **≈ 45 fields/match**.

**Post-Game Events.** `source-screen-inventory.md:222-241`. List screen, scrollable. Per event:

- Goal: 6 fields (period, team_abbr, time, scorer, goal_number, [assist1, assist2])
- Penalty: 6 fields (period, team_abbr, time, infraction, type, culprit)

Match 250 V2 (`research/OCR-SS/Manual OCR benchmark for verification V2.md:1066-1080`) has 7 goal events with ~5 fields each, 0 penalties → ~35 fields/match. Per match this varies 30–60 fields.

**Action Tracker.** `source-screen-inventory.md:243-278`. Per-period view × ≥4 periods + "All Periods". Per event: 8 fields (period, event_type, time, initiator, receiver, position_on_rink_x, position_on_rink_y, event_chip_color). Match 250 V2 has 34 + 36 + 24 events × 8 = **≈ 740 fields/match for events**, plus 3 header fields (cat/period filter + team abbreviations) × 4 periods = 12.

**Action Tracker — Faceoff Map.** `source-screen-inventory.md:279-308`. Per period × ≥4 periods × (3 zone-rows × 2 sides + 9 dots × 2 sides) = 30 cells/period + 6 zone-percent cells + 2 team labels = **≈ 152 fields/match**.

**Action Tracker — Net Chart.** `source-screen-inventory.md:310-343`. Per period × ≥4 periods × 7 stat-rows × 2 sides = 56 cells + per-period shot location markers (5–10 per period). **≈ 100 fields/match for the stats panel; shot-location dots on the net diagram are not yet attempted.**

### Roll-up

| Screen group                 |            Fields/match |      Instances/match (frames needed) |
| ---------------------------- | ----------------------: | -----------------------------------: |
| Lobby (states 1+2)           |                    ~167 |            ≥2 frames (one per state) |
| Loadout View                 |                    ~630 |            ≥10 frames (one per slot) |
| In-Game Clock                |   ~450 (50 moments × 9) |                           continuous |
| In-Game Goal Overlay         | ~144 (24 instances × 6) |                         event-driven |
| Post-Game Player Summary     |                     ~86 |                                    1 |
| Box Score (3 tabs)           |                     ~45 |                                   ≥3 |
| Post-Game Events             |                  ~35–60 |               1 (may need to scroll) |
| Action Tracker — list        |                    ~740 | ≥4 (one per period; needs scrolling) |
| Action Tracker — Faceoff Map |                    ~152 |                                   ≥4 |
| Action Tracker — Net Chart   |                    ~100 |                                   ≥4 |

**Total: ≈ 2,550 fields/match across ≈ 30–40 distinct frame-views.** This is "the definition of done" — every one of these has to land at ≥98% per-field accuracy without manual review. The current pipeline attempts roughly the post-game subset (≈ 1,800 fields) and is hitting ~92–98% L2 / 84–100% L3.

Two structural observations from the V2 file itself that the redesign must accommodate:

- **V2's "Action Tracker" period sections have OCR-quality noise in the source data.** Times like `1747` instead of `17:47` (line 696), `933` for `9:33` (line 682) appear in V2 itself. That's the human author transcribing a frozen UI frame and not even bothering with the colon — implying time-formatting OCR drift is intrinsic to the screen, not a model failure.
- **V2 is incomplete by design.** Net Chart shot locations are shown as empty `Type | Owner | X | Y` rows (lines 951-956, 977-982, 1006-1010, 1034-1037). That's the most under-instrumented data on screen and the redesign should either (a) commit to extracting it or (b) explicitly carve it out of "definition of done".

## 2. Load-bearing vs accidental vs anti-feature

### 2.1 Two-pass (classify → extract)

**Accidental, slipping toward anti-feature.** The two-pass framing exists to amortize OCR cost: Pass 1 is 1 fps with a cheap HSV+anchor gate, Pass 2 is dense OCR only inside Pass-1-emitted segments. (`tools/video_ingest/video_ingest/orchestrator.py:85-244` — Pass 1 cache key, segments, Pass 2 cache key all wrapped in cascade-invalidation logic.) Reasoning: RapidOCR is ~336 ms/full-frame on a 3060.

The motivation is real but the design **conflates segmentation with classification**. A run-length compressor over per-frame hard labels (`pass1_classify.py:166-280`) silently drops every short or noisy real segment. Match 463 shows the failure mode bluntly: 1,230 of 1,680 frames have `color_class=player_loadout_view` but **only 2 emerge as accepted loadout segments** (`baseline-2026-05-19.md:38-48`). At a single-author / 30 matches/season volume, the OCR-budget savings stop justifying the segmentation tax. Even if you did dense OCR on every frame at 1080p with current code, the match takes ~3 hours on a 3060 — still cheaper than the engineering hours to diagnose Pass-1 dropouts.

### 2.2 1 fps Pass-1 sampling

**Anti-feature for the loadout screen and faceoff map.** A 1 fps sample is below the rate at which the user navigates between loadout cards (~0.5 s each per `redesign-scope-2026-05-19.md:31`). Match 463 captured 2 of 10 loadout slots at 1 fps; the operator confirms all 10 were displayed in the recording. The 1 fps rate is also the source of the `min_run_to_open=2` boundary in the YAML (`tools/video_ingest/video_ingest/configs/nhl26.yaml:25`) — it had to be loosened in production because the original threshold of 3 dropped the entire faceoff_map screen. The 1 fps rate is fine for the static post-game screens but turns the brief loadout-card sequence into a data quality crapshoot.

### 2.3 HSV histogram + anchor-text Levenshtein gate

**Load-bearing as concept, accidental in implementation.** The split is structurally sound: a coarse colour signature pre-selects candidates; a text discriminator confirms. But each half is fragile:

- The HSV centroid is calibrated from **one PNG per class** (`docs/calibration/baseline-2026-05-19.md:119` flags this as Phase-4 open question Q3). For visually multimodal classes (10 loadout cards with 10 different player photos), one centroid cannot represent the cluster. Hence Match 463's 1,230 false-positive `color_class=player_loadout_view` for mid-gameplay scoreboard frames.
- The anchor-text gate keys on a small ROI (top 200 px) and accepts Levenshtein-1 against a list of substrings (`tools/game_ocr/game_ocr/classifier.py:33-46, 105-124, 285-321`). When a frame is mid-transition or the cursor obscures the anchor text, the gate rejects the frame even when colour is dead-on. The looser `anchor_color_floor = 0.30` (line 303) is an explicit acknowledgement that the centroid-cosine threshold is fundamentally untrustworthy below 0.7, but a 0.30 floor is essentially "accept anything that has the right anchor text", which means the anchor text is doing all the work — at which point the HSV vote is dead weight.

### 2.4 Per-screen ROI-based parsers (`tools/game_ocr/game_ocr/parsers.py`)

**Mostly load-bearing for the static post-game screens. Anti-feature for the lobby and loadout screens.** Each parser has its own configuration of fixed ROI coordinates, regex patterns, and disambiguation rules. For tabular screens where the layout is rigid (box score, net chart, faceoff map, events list, player summary) this is the right shape — the parser knows what fields it's looking for, and OCR on a tight ROI is more accurate than full-frame.

For the lobby and loadout views the parser is **doing the segmentation that L1 should have done**. The lobby parser (`parsers.py:166-443`) re-runs OCR on the full frame, then re-discovers position-label anchors (C/LW/RW/LD/RD/G), then synthesises missing anchors using row-spacing assumptions (lines 101-150), then per-team detects state 1 vs state 2 from a `#NN` hash count regex (lines 153-163), then runs a per-row classifier. Each step is a fallback for a separate failure mode of the layer above. The loadout parser (`parsers.py:897-1063`) does the same dance plus three pixel-art tier-classification fallbacks (`_classify_xfactor_tier`, `_rescan_delta_chip`, `_infer_delta_sign_from_color`). The net result works but is unverifiable — each new screen variant adds another epicycle.

The `_rescan_delta_chip` function (`parsers.py:711-773`) is a particularly clean example of the brittleness. It re-OCRs a 12×16 px chip at 4× bicubic upscale because the full-frame pass dropped it. Then it samples the chip background HSV to recover the sign because the upscaled OCR sometimes drops the leading `-`. Then it has a 2:1 majority gate so mixed pixels don't flip the sign. Three layered hacks for one tiny chip. NHL 27 will move that chip and all three fail at once.

### 2.5 sha-keyed cache

**Load-bearing for development, accidental for production.** The cache (`pass1_classify.py:52-69`, manifest at `pass2_extract.py:PASS2_MANIFEST_FILENAME`, the cascade-invalidation logic in `orchestrator.py:178-310`) is genuinely valuable when you're iterating on Pass-2 only and don't want to re-do Pass 1. At single-author / 30 matches/season the storage cost is trivial and the iteration speedup is real. But the cascade-invalidation logic spans hundreds of lines of orchestrator code (`orchestrator.py:178-310`) — and one of the two failure modes that `CacheMismatch` catches (the `pass1_cache_key` derived from version YAML + classifier YAML, line 56-63) is "you changed the classifier centroids → re-run Pass 1". For a single author the trade-off is **net positive on dev velocity, net negative on code surface area**. Not load-bearing in production but cheap to keep.

### 2.6 ffmpeg-extract Pass-2

**Load-bearing.** ffmpeg with `-vf fps=N,scale=W:H -pix_fmt bgr24 -f rawvideo pipe:1` (`pass1_classify.py:115-122`) is the right tool for the job. PNG-via-disk in Pass 2 is the more interesting question — `extract_segments` writes per-segment dirs of PNGs (`tools/video_ingest/video_ingest/pass2_extract.py`) that the parser later reads back from disk. The disk hop is unnecessary for OCR-only purposes but it survives the architectural choice and is fine.

### 2.7 Table-keyed promoters

**Load-bearing for now, schema-locked accidental in detail.** Eight promoter files (`apps/worker/src/ocr-promoters/{action-tracker.ts, box-score.ts, events.ts, faceoff-map.ts, loadout.ts, net-chart.ts, post-game-player-summary.ts, pre-game-lobby.ts}`) each translate one screen's parsed result into 1–3 SQL tables. The split is sound; each promoter encapsulates a specific dedup or merge strategy:

- `events.ts:69-83` does Events-screen "remaining" → "elapsed" clock conversion before dedup, because the dedup key includes clock and the two screens use opposite conventions.
- `action-tracker.ts:69-75, 152-176` cross-screen dedup with `findExistingMatchEvent` + Levenshtein-1 actor matching.
- `faceoff-map.ts:96-117` and `net-chart.ts:107-130` use Postgres `onConflictDoUpdate` with COALESCE for preserve-non-null merges across multiple captures of the same period.
- `box-score.ts:73-103` does update-first / insert-fallback to avoid clobbering columns set by other tabs of the same screen.

The accidental detail: **`player_loadout_snapshots.source_extraction_id`** (`packages/db/src/schema/player-loadout.ts:61`) vs **`ocr_extraction_id`** on every other domain table (`packages/db/src/schema/match-enrichments.ts:42, 88, 152, 200`, `packages/db/src/schema/match-events.ts:79`). Both reference the same column, both serve the same purpose, the column name is just inconsistent. This was flagged as a constraint in the user's prompt; I confirm it exists. The cost of fixing is one migration; the cost of not fixing is one more `source_extraction_id` aliased wherever a downstream join touches loadout snapshots.

### 2.8 V2-style hand-keyed truth

**Load-bearing for the redesign, anti-feature in its current scope.** V2 exists for one match (250) and the `apps/worker/src/__tests__/match-250-benchmark.test.ts` asserts only the lineup (10 slots × 6 fields = 60 fields). The lineup is ~3% of the per-match field budget computed in §1. The other 97% of fields in V2 — every event, every period summary, every faceoff dot, every net-chart cell — is encoded in markdown tables only, never as runnable assertions. This is why the redesign feels unanchored: we have a beautiful manual benchmark but the only thing that fails the build when violated is one screen.

## 3. Per-screen capture status

For each screen in `source-screen-inventory.md`, I classify fields as **captured / fails ≥10% / not attempted**. Cites the parser and promoter.

### 3.1 Pre-Game Lobby — `pre_game_lobby_state_1` / `_state_2`

| Field                             | Status                                                                                     | Parser                                            | Promoter                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------ |
| `gamemode`                        | Captured (>95% on m250/m463)                                                               | `parsers.py:396-404`                              | `pre-game-lobby.ts` does not persist it. **Captured-but-dropped.** |
| `team_name` (both)                | Captured but dropped                                                                       | `parsers.py:406-422`                              | `pre-game-lobby.ts` does not write team names.                     |
| Per-slot `position`               | Captured 100% (anchored on position-label OCR, fallback synthesis at `parsers.py:101-150`) | `parsers.py:209-229`                              | `pre-game-lobby.ts:75, 92-113` writes `position`                   |
| `gamertag`                        | Captured ≥87% exact, ~100% fuzzy-equivalent (`baseline-2026-05-19.md:65-83`)               | `parsers.py:355-385`                              | `pre-game-lobby.ts:65-69, 94`                                      |
| `player_level`                    | Captured                                                                                   | `parsers.py:273-284`                              | `pre-game-lobby.ts:77, 110-111`                                    |
| `platform`                        | **Not attempted** in this parser; field is `null` in pre-game-lobby.ts:112                 | —                                                 | —                                                                  |
| `is_captain`                      | Captured                                                                                   | `parsers.py:295-301`                              | `pre-game-lobby.ts:81-83, 99-100`                                  |
| `is_cpu_or_empty`                 | Captured                                                                                   | `parsers.py:254-259`                              | Used to skip insert; not persisted                                 |
| `build_class` (state 1)           | Captured                                                                                   | `parsers.py:323-335`                              | `pre-game-lobby.ts:78, 106`                                        |
| `build_height`/`weight` (state 1) | Captured but parsing is regex-fragile                                                      | `parsers.py:261-272`, `pre-game-lobby.ts:124-137` | Persists                                                           |
| `x_factor_1/2/3` (state 1)        | **Not attempted** in lobby parser (only in Loadout View)                                   | —                                                 | —                                                                  |
| `player_number` (state 2)         | Captured                                                                                   | `parsers.py:304-317`                              | `pre-game-lobby.ts:99`                                             |
| `player_name` persona (state 2)   | Captured                                                                                   | `parsers.py:309-318`                              | `pre-game-lobby.ts:98`                                             |

Lobby net coverage: **~75% of inventory fields**, but team names + X-factors are dropped. X-factors live on loadout view only and only there are they read. Lobby state-1 x-factors are visible but the lobby parser ignores them.

### 3.2 Player Loadout View — `player_loadout_view`

| Field                                                                | Status                                                                                                          | Where                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `player_position`, `player_number`, `player_name_full`, `is_captain` | Captured                                                                                                        | `parsers.py:541-625`, promoted at `loadout.ts:73-104` |
| `gamertag`                                                           | Captured                                                                                                        | `parsers.py:911-919`                                  |
| `player_level`                                                       | Captured                                                                                                        | `parsers.py:1013-1032`                                |
| `platform`                                                           | **Not attempted by parser.** Always MISSING (`parsers.py:1049`). Whitelisted to `null` in `loadout.ts:266-280`. |
| `build_class`                                                        | Captured                                                                                                        | `parsers.py:903-909`                                  |
| `height` / `weight` / `handedness`                                   | Captured                                                                                                        | `parsers.py:628-667`                                  |
| `ap_used`/`ap_total`                                                 | Captured                                                                                                        | `parsers.py:988-1008`                                 |
| `x_factor_1/2/3` name                                                | Captured (text + icon template match)                                                                           | `parsers.py:925-968`                                  |
| `x_factor_1/2/3` tier                                                | Captured (HSV)                                                                                                  | `_classify_xfactor_tier` `parsers.py:473-503`         |
| 23 attributes × {value, delta}                                       | Captured                                                                                                        | `parsers.py:670-708` + `_rescan_delta_chip`           |

**Caveat: capture-rate is the bottleneck, not parse-rate.** On match 463 the loadout parser is 100% accurate on the one slot it sees (HenryTheBobJr) and 0% on the other 9 because they're never even segmented (`baseline-2026-05-19.md:38-48`, `redesign-scope-2026-05-19.md:31-33`). This is an L1 failure not an L2 failure.

### 3.3 In-Game Clock and Goal Overlays — `in_game_clock`, `in_game_goal_state_1/2`

**Not attempted at all.** OcrScreenType has the enum values (`packages/db/src/schema/ocr-pipeline.ts:25-27`) but:

- No classifier centroid in `tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml`
- No `ScreenDefinition` in `tools/game_ocr/game_ocr/extractor.py:37-93`
- No `parse_in_game_*` function in `tools/game_ocr/game_ocr/parsers.py`
- No promoter entry in `apps/worker/src/ocr-promoters/index.ts:40-52`
- No row in `_test_match-250-benchmark.test.ts`

This is the biggest gap vs. the V2 inventory. The clock/goal overlay would feed period_number determination (current pipeline uses _folder names_ in `apps/worker/src/ocr-promoters/resolve-period.ts` and the inventory consensus matcher's `period_from_path()` at `inventory_consensus_match.py:183-201` — both fail closed when the operator hasn't labelled paths) and would give us scoring authority that doesn't depend on the post-game events/AT screens.

### 3.4 Post-Game Player Summary — `post_game_player_summary`

| Field                                  | Status                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Team labels + final scores (away/home) | Captured but de-prioritised — the promoter is a no-op (`apps/worker/src/ocr-promoters/post-game-player-summary.ts:16-19`). |
| Per-player rows                        | Captured by `build_player_record` (`parsers.py:1066-1091`), **never persisted** because EA API has the same data.          |

This is the only screen where the promoter is intentionally a no-op. Fine in isolation, but it's the second example (after team names in the lobby) of "captured but dropped". The redesign's authority-model story has to either declare these fields out of scope or commit to writing them somewhere.

### 3.5 Box Score (3 tabs)

| Field                                                                            | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `period` × {`away_value`, `home_value`} for each of `goals`, `shots`, `faceoffs` | Captured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `parsers.py:1254-1356` + `box-score.ts:52-103` |
| Per-period TOT (summed)                                                          | Captured, with sanity-check warnings on mismatch (`parsers.py:1319-1345`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `stat_kind` discrimination                                                       | **Anti-feature.** The classifier has only `post_game_box_score_goals` as a class (`tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml:153`). The `post_game_box_score_shots` and `post_game_box_score_faceoffs` parser entries (`extractor.py:63-71`) exist but are unreachable through video ingest — the dispatch (`tools/video_ingest/video_ingest/dispatch.py:82,94,108`) uses `segment.screen_type` which is whatever Pass-1 classified the segment as. **All three box-score tabs in a video recording are classified as `post_game_box_score_goals` and only the goals parser runs on them.** This means box-score-shots and box-score-faceoffs are currently **unreachable from video ingest** and depend entirely on manual-screenshot ingest with explicit screen-type override at `ingest-ocr-cli` time. |

### 3.6 Post-Game Events

| Field                                                        | Status                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------- |
| Per-event `period_label`, `team_abbr`, `clock`, `event_type` | Captured                                                                  | `parsers.py:2052-2293`, `events.ts:103-205` |
| Goal `scorer`, `goal_number_in_game`, `assist1`, `assist2`   | Captured                                                                  | `parsers.py:2128-2173`, `events.ts:210-246` |
| Penalty `culprit`, `infraction`, `type`, `minutes`           | Captured (NHL-26 bracketed format added Phase 5c, `parsers.py:2042-2049`) |
| Cross-screen dedup w/ Action Tracker                         | Implemented at `events.ts:148-176`, `match-events-dedup.ts:52-105`        |

Failure modes ≥10%:

- "remaining" → "elapsed" clock conversion (`events.ts:69-83`) drops any malformed clock without a fallback. Match 463 lost ~5 penalties pre-Phase-5c (`baseline-2026-05-19.md:95`).
- Ornament prefix stripping `_strip_ornament` (`parsers.py:2101-2103`) handles `-.` but Match 250 V2 has `-, SIlky` (line 1071) with a comma not a period — actor parsing fails on this on m250 OT goal events.

### 3.7 Post-Game Action Tracker — list panel

| Field                                                          | Status                         |
| -------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| Per-event `actor`, `target`, `relation`, `event_type`, `clock` | Captured                       | `parsers.py:2372-2493`, `action-tracker.ts:97-237`  |
| `selected_event_index` + `selected_event_x/y/zone`             | Captured                       | `parsers.py:2495-2568`, `action-tracker.ts:246-309` |
| `detected_markers` (all colored markers on the rink)           | Captured                       | `parsers.py:2530-2546`                              |
| Cross-screen dedup w/ events                                   | `match-events-dedup.ts:52-105` |
| Team color trapezoid sampling                                  | Captured                       | `parsers.py:2576-2598`                              |

Failure modes ≥10%:

- 11–13 wrong-actor/target attributions per match pre-Phase-5a (`baseline-2026-05-19.md:96-97`). Mostly fixed by `display_aliases` rows but the _mechanism_ is stale alias leak (Class G), not OCR.
- Penalty rows from Action Tracker carry no infraction text (`action-tracker.ts:217-235`); the row is inserted with infraction='(unknown)' awaiting Events-screen merge. ~5/match.
- `event_type='unknown'` on 5–10% of rows; recovered by `inferEventTypeFromRawText` regex (`action-tracker.ts:53-67`).

### 3.8 Faceoff Map

| Field                                                                                                             | Status   |
| ----------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| `period_label`, `away_label`/`home_label`, `overall_win_pct`, `offensive_zone_w/t`, `defensive_zone_w/t` per side | Captured | `parsers.py:1866-1983`, `faceoff-map.ts:81-118` |
| 9 dot W/L per period                                                                                              | Captured | `parsers.py:1943-1983`                          |

Failure modes: single-digit dot readings rely on a lookalike-to-digit translation table (`parsers.py:1805-1812`) including CJK characters because RapidOCR's default model is multilingual. Net failure rate on single dots is low for m250 but unverified on m463 (no V2).

### 3.9 Net Chart

| Field                                            | Status                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 7 stat-rows × {away, home}                       | Captured with per-cell ROI override on disagreement (`parsers.py:1629-1647`)                     |
| Game-total shots from score-strip header         | Captured                                                                                         | `parsers.py:1654-1663`                                        |
| Per-period x/y shot locations on the net diagram | **Not attempted.** Net Chart's net diagram has shot dots; nothing parses them. V2 shows empty `X | Y` columns (lines 951-956) — even V2's manual key didn't try. |

Open L3 gap: 6/8 rows for `match_shot_type_summaries` on match 463 (`baseline-2026-05-19.md:103` defect #9). The 2 missing rows are P3-period rows the operator never navigated to.

## 4. Architectural alternatives — characterised honestly

### 4.1 Event-driven extraction (replace fixed-rate sampling with screen-transition detection)

**Gain:** parse exactly as many frames as there are stable views — 30–40 per match, not 1,680. Drops Pass-2 frame extraction by ~95%. No more "loadout card was only 0.5 s, you only got 1 of 10".

**Cost:** the transition detector becomes the new Pass-1 failure surface. You're trading a probabilistic mis-classification (current HSV+anchor) for a deterministic edge case (transition jitter, fade animations, post-game card scroll dynamics). Frame-difference detectors over compressed video are notoriously twitchy. Almost all production sports-video pipelines actually do fixed-rate sampling with smart aggregation, not edge detection.

**Needs:** ~3 hand-labelled videos to verify the detector. Also needs the transition detector to know which side of the transition is "the new screen" — easy for cuts, hard for slow fades.

**Migration:** the Pass-1 cache + segments.json contract survives. Just replace `pass1_classify.py:classify_video` + `build_segments` with a transition detector that emits one (screen_type, [frame_indices]) tuple per transition. The segments file shape doesn't change. Low-effort migration.

**Honest take:** good idea for the loadout screen specifically (10 fast transitions). Marginal everywhere else. The static post-game screens dwell for 15+ seconds; fixed-rate sampling + ensemble vote is more robust than transition detection.

### 4.2 Single-pass continuous OCR (drop Pass 1)

**Gain:** zero classifier failures. Every frame gets OCR'd; the screen type is decoded from the OCR output itself (text content) rather than upstream from HSV. Pass-1 dropouts (the entire match-463 loadout problem) cease to exist.

**Cost:** ~1,680× 336 ms = 9.4 minutes per match of OCR at 1 fps. At 30 fps it's 4.7 hours. Even at 5 fps it's ~47 min. Acceptable at 30 matches/season, painful for iteration.

But the bigger cost is **bookkeeping**: you're now OCR-ing every frame including mid-gameplay scoreboard frames which have no payload. The aggregator has to dedup near-identical successive frames into a single "view" — which is exactly what Pass-1 segmentation was trying to do, just done in the OCR-result space instead of pixel space.

**Needs:** content-fingerprint hash function over OCR output. Cheap.

**Migration:** Pass 2 stays. Drop Pass 1. Tighten the OCR aggregator to dedupe identical frames.

**Honest take:** this is what I would do if I were writing the pipeline from scratch and didn't already have a working two-pass. The "Pass-1 segmentation" abstraction is paying for itself only because I already wrote it. The aggregation step (cross-frame consensus) is where the real value is — and that step already exists (`inventory_consensus_match.py`). Single-pass OCR + aggregation moves the segmentation problem into the aggregator, which is where it belongs.

### 4.3 HMM/Viterbi segmenter

**Gain:** principled handling of "screen transitions are quiet" — instead of hard label per frame + run-length compress, you emit P(screen|evidence) per frame and find the most-likely sequence. Gracefully handles the 1,230 false-positive `color_class=player_loadout_view` because Viterbi sees them as the high-color-low-anchor states transitioning to low-color-zero-anchor and stays in the gameplay state.

**Cost:** you need transition probabilities. Where do they come from? Hand-tuned (operator labels what's "expected" — pre-game → game → post-game → events → faceoff → net) or learned from one labelled video. At 30 matches/season the human-tuning version is fine.

**Needs:** a transition prior matrix. Maybe 8×8 numbers. Trivially hand-tuned in 30 minutes.

**Migration:** replace `build_segments()` in `pass1_classify.py:166-280` with a Viterbi pass over the per-frame `(color_score, anchor_text)` evidence. Same input shape, same output shape. Cleanest possible migration.

**Honest take:** this is the right segmenter for the post-game screens. It does **not** solve the loadout-card problem (which is about Pass-1 sampling rate, not segmentation). Mid-effort, high-payoff for the post-game flow. Should be paired with 5 fps sampling for the pre-game loadout sequence.

### 4.4 Probabilistic OCR (P(field=value | frame) instead of hard decision)

**Gain:** captures the actual uncertainty. Instead of "OCR said `M. RANTANEN`, OCR said `M.RANTANEN`, dedup says these are 2 events", you say "M. RANTANEN with confidence 0.93, M.RANTANEN with confidence 0.87, both come from the same period+clock bucket, max-likelihood merge says they're the same event with normalised value `M. RANTANEN`". The current Levenshtein-based dedup in `match-events-dedup.ts:96-104` is a worse, hand-coded version of this.

**Cost:** every field becomes a distribution. Every downstream table has to either commit (pick the argmax at promotion time) or store the distribution. Storing the distribution explodes the schema. Picking argmax at promotion time means you've just renamed the existing pipeline.

**Needs:** RapidOCR already emits per-region confidence. The hard part is propagating uncertainty through the parser logic.

**Migration:** semi-invasive — each parser has to emit a `[(value, confidence)]` list instead of an `ExtractionField`. Then a downstream consensus step picks the canonical value. The cross-frame consensus matcher (`inventory_consensus_match.py`) already does this for spatial markers; generalising it to text fields is a non-trivial rewrite.

**Honest take:** the value is overstated. RapidOCR confidence is poorly calibrated (often 0.93–0.99 on a misread). At low match volume (30 matches/season, one author) you don't have the truth-data scale to recalibrate the confidences. The hard fixes are upstream (better OCR backend, anchored ROIs) and downstream (consensus across many frames of the same view), not in the field-level uncertainty representation.

### 4.5 Multi-modal classification (learned classifier replaces HSV+anchor)

**Gain:** kills the single-prototype HSV centroid problem at the root. A tiny CNN trained on, say, 200 labelled frames per class (operator effort ~2 hours) gives you 99%+ on every screen. Modern vision-language models (e.g., a small CLIP-style image-text similarity head) work zero-shot on the 8 screens — describe each screen in text, embed, similarity-vote.

**Cost:** an ML model in the pipeline. Has to ship in Docker, has to be retrained when NHL 27 lands. For 30 matches/season this might be over-engineering; for a 5-year team-site project it's not.

The vision-language-model version (CLIP / similar) costs zero training data but ~200 MB of model weights and depends on the model being available offline. Training data isn't actually free either — you need labelled examples to evaluate.

**Needs:** ~2 hours of labelling (CVAT exists at `cvat/`). A retraining pipeline.

**Migration:** swap `classifier.py:Classifier.classify()` to invoke the model. Output shape (`ClassifyResult`) stays. Same Pass-1 framing.

**Honest take:** **this is the right L1 replacement.** The HSV+anchor approach is what you do when you have zero training data and a hard deadline; you don't have a hard deadline. The single-PNG-per-class centroid is a hack; a small CNN over the same 8 classes with 50 labelled frames each is solved-problem territory.

Catch: this doesn't solve loadout-card capture rate. Even a perfect classifier won't see a 0.5 s card at 1 fps. Sampling rate is orthogonal.

### 4.6 EA-API-anchored pipeline (treat OCR as augmentation)

**Gain:** EA Pro Clubs API gives you authoritative per-match player stats keyed by `gamertag` (the `name` field — `apps/worker/src/ingest-members.ts:42-103`). Goals, assists, hits, shots, PIM, TOI, faceoff-w/l per player are all in EA payload (`packages/db/src/schema/player-match-stats.ts:42-105`). For the BGM side every player exists in `players`; that's why `resolveGamertagToPlayer` succeeds 97-98% on BGM-side events.

If you treat EA API as canonical for the metrics it has, OCR's job shrinks to the screens EA doesn't cover:

- **Loadouts** (build_class, x_factors, attributes) — not in EA API. OCR-only.
- **Action Tracker spatial** (rink x/y coords) — not in EA API. OCR-only.
- **Faceoff Dot Map** (per-dot W/L breakdown) — not in EA API. OCR-only.
- **Net Chart shot-type breakdown** — partially in EA API (per-player shot count, no shot-type split). OCR adds value.
- **Period-by-period stats** — not in EA API at the period level. OCR-only.
- **Opponent identity** — partially OCR (the opponent gamertags ARE captured by EA but only as `opponent_player_match_stats` keyed by `ea_player_id` — `packages/db/src/schema/opponent-player-match-stats.ts`). Cross-link to OCR personas is non-trivial.

**Cost:** EA API is the _only_ source for per-player base stats. If it's down or rate-limited or schema-drifts on NHL 27, every match ingests with empty stats. The current pipeline already has this dependency via `apps/worker/src/ingest.ts`, so it's not a new risk.

**Needs:** an explicit authority-model document. Currently the schema's `EnrichmentSource = 'ea' | 'ocr' | 'manual'` (`packages/db/src/schema/match-enrichments.ts:15`) implies the design already understands this. The redesign should make it explicit which fields are EA-authoritative and which are OCR-authoritative.

**Migration:** stop OCR-promoting player_match_stats fields (Player Summary screen is already a no-op — good). Add explicit "OCR is not authoritative for goals/assists per player" to the design.

**Honest take:** **this is the highest-leverage architectural move.** It shrinks the OCR success criterion from "extract 2,550 fields/match at 98%" to "extract ~1,000 OCR-unique fields/match at 98%". The 1,000 that remain are the _hard_ fields (spatial, attributes, dots, shot-type) but at least the budget shrinks and the EA-redundant work goes away.

### 4.7 Hybrid (recommended for synthesis)

The right architecture for this project is, in my read:

1. EA API authoritative for everything EA covers (per-player stats, opponent identity, match metadata, members ingestion). Already true; make it explicit.
2. Single-pass continuous OCR at variable rates per screen: 1 fps for static post-game screens, 5 fps during the pre-game loadout sequence, 2 fps during gameplay (for in-game clock + goal overlays which the current pipeline doesn't even attempt).
3. Learned classifier (small CNN or CLIP head) replaces HSV+anchor, calibrated on ~50 labelled frames per class.
4. HMM/Viterbi segmenter over per-frame screen labels for the post-game flow.
5. Cross-frame consensus aggregator (existing `inventory_consensus_match.py` generalised to text fields, not just spatial markers) for all multi-frame screens. This becomes the dedup+confidence layer instead of the brittle per-event Levenshtein in `match-events-dedup.ts`.
6. ROI-based parsers stay for the static post-game tabular screens. The lobby + loadout parsers get rewritten as "subject-locating + cell-extracting" patterns over the segmented loadout-card sub-frames.

## 5. The truth system

V2 ground truth is unevenly applied: 60 lineup fields are runnable assertions (`match-250-benchmark.test.ts:56-160`); the remaining ~2,490 fields per match exist as markdown tables only. For a redesign judged at 98% per-field, this is the rate-limiting step.

### How V2 ground truth gets created for each new match

Estimate from the V2 file itself (`research/OCR-SS/Manual OCR benchmark for verification V2.md` is ~1,080 lines): keying one match into V2 markdown takes the author ~3–6 hours. The events section alone is 100+ rows with time-formatting noise (`933` instead of `9:33`, `-, Silky` with the comma — both visible in the source UI). The faceoff dot grid is 9 dots × 4 periods × 2 sides = 72 cells per match. At 30 matches/season at 4 hours/match that's 120 hours. **Not viable as the main truth source.**

A defensible truth system needs three tiers:

**Tier 1 — EA-API-derived truth (free per match, no human time).** Every field that's in `player_match_stats` becomes a verifier assertion automatically: per-match goals/assists totals must match, shots per player must match, faceoff-win/loss per player must match. This validates the _event aggregates_ without keying individual events. The EA `aggregates.json`-derived expected values are already in `match-quality-cli.ts:97-138`. Generalise this.

**Tier 2 — V2-full for the canonical pilot, once (match 250).** Hand-key the rest of match 250's V2 into runnable assertions: every Action Tracker event (3 periods × ~30 events = ~90 rows), every faceoff dot per period (~72 cells), every net-chart cell (~56 cells), every event (7 goals), every box score (~30 cells). Roughly 300 assertions to add. **Yes, this should happen before any redesign work**, because without it you can't tell whether a redesign regressed something subtle. Cost: 4–6 hours of careful keying.

**Tier 3 — spot-check truth per new match.** For each new match, pick 5 random fields per screen and hand-verify against the recording. ~10 minutes/match × 30 matches/season = 5 hours/season. Detects regressions without needing full V2 per match.

### How to validate the system on matches without V2 ground truth

Three internal-consistency checks the redesign should bake in:

1. **TOT-sum invariants.** Box score periods should sum to TOT. The current parser already warns on these (`parsers.py:1319-1345`). Generalise: shots per player sum to total shots; net-chart per-shot-type rows sum to total shots; faceoff dots sum to per-period faceoff totals.
2. **Cross-screen agreement.** A goal at P2 13:41 from Action Tracker (elapsed) should equal a goal at P2 06:19 from Events (remaining) for the same scorer. The current `match-events-dedup.ts` does this but throws away the agreement signal — it should be a logged consistency check.
3. **EA-aggregate agreement.** Sum of OCR per-period goals_for must equal `matches.score_for`. Sum of OCR per-period faceoffs_for must equal `aggregates.faceoff_wins`. Etc.

Match 463's L3 84.2% being capped by "user navigation didn't include P3 net chart" is detectable today via this exact check (the unique index would show 6/8 rows existed where 8 were expected) but it isn't surfaced as a recording-protocol failure to the operator.

### Should match-250 V2 be expanded before redesign

Yes. Two reasons:

- **Regression risk.** A redesign that breaks lineup extraction would be caught by the existing test; a redesign that breaks net-chart shot-type extraction would not be caught by anything until the next /games/250 page review. That's an unacceptable feedback loop length for ML/computer-vision work.
- **Calibration baseline.** Match 250 is the canonical "good capture" — manual screenshots with full screen coverage. If the redesign can't hit ≥98% on the full V2 for match 250, the architecture is wrong regardless of how well it scores on m463 (which has structural recording gaps and can't hit 98% even in principle).

## 6. Calibration loop — surviving NHL 26 → 27

The version-detection logic at `tools/video_ingest/video_ingest/version_detect.py` (referenced from `orchestrator.py:138-156`) anticipates this. The classifier config is per-version (`tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml`); a new `nhl27.yaml` could land alongside. But the architectural risk isn't in the classifier — it's in:

- **ROI coordinates.** Every parser hard-codes pixel coordinates calibrated at 1920×1080 (`parsers.py:467, 469, 597-601, 925-931`, etc.). If NHL 27 moves the X-Factor icons by 20 px, every loadout extraction breaks silently — the OCR finds different text in the same ROI and returns garbage. The `_scale_roi` (`classifier.py:195-212`) handles only resolution scaling, not layout shifts.
- **Anchor substrings.** "player loadouts", "all", "goal summary", "eashl" are hard-coded (`tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml:8-326`). NHL 27 renaming a tab breaks classification.
- **Regex grammars.** `_EVENT_PENALTY_BRACKETED_RE` was added Phase 5c because NHL 26's penalty format differed from NHL 25's (`parsers.py:2042-2049`). Each format change is a regex.

**The proposed calibration loop:**

1. **Frozen fixture corpus per version.** Before NHL 27 ships its first match, capture 10 screenshots per screen type (80 total) and label them. These become the L1 classifier training set + the ROI calibration anchor set + the parser regression test set.
2. **One operator-facing "recalibrate" command** that walks each screen's known fixtures, lets the operator approve or override the detected ROIs, and produces a new `nhl27.yaml` + parser-overlay file. The parsers themselves stay; the ROIs come from config not constants. This is a non-trivial refactor of the parsers to externalise hard-coded pixel coordinates.
3. **Version detection that fails closed.** Already exists at `orchestrator.py:137-156`. Keep it.
4. **Match-level "version" stamp.** Every `ocr_extractions` row should carry the version string. Currently it's only in the segments.json header (`pass1_classify.py:294-302`) but not in the DB row. Add a column.

## 7. Constraints I discovered while reading

These are non-obvious things that constrain the redesign space.

### 7.1 `player_loadout_snapshots.source_extraction_id` vs `match_*.ocr_extraction_id` (confirmed)

`packages/db/src/schema/player-loadout.ts:61` calls it `source_extraction_id`. Every other table calls it `ocr_extraction_id` (`packages/db/src/schema/match-events.ts:79`, `packages/db/src/schema/match-enrichments.ts:42, 88, 152, 200`). One-line migration to rename; until then, queries that join on the audit-pointer have to know which spelling to use per table.

### 7.2 The classifier knows 8 screens; the schema knows 14; the parsers know 11; the promoters know 11; the inventory wants ≥13

- Classifier (`tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml`): 8 classes — `pre_game_lobby_state_2`, `player_loadout_view`, `post_game_player_summary`, `post_game_box_score_goals`, `post_game_events`, `post_game_action_tracker`, `post_game_faceoff_map`, `post_game_net_chart`.
- Schema `OcrScreenType` (`packages/db/src/schema/ocr-pipeline.ts:20-34`): 14 types — adds `pre_game_lobby_state_1`, `in_game_clock`, `in_game_goal_state_1/2`, `post_game_box_score_shots`, `post_game_box_score_faceoffs`.
- Parser registry (`tools/game_ocr/game_ocr/extractor.py:37-93`): 11 types — adds `pre_game_lobby_state_1`, `post_game_box_score_shots`, `post_game_box_score_faceoffs`.
- Promoter registry (`apps/worker/src/ocr-promoters/index.ts:40-52`): 11 types — same as parsers.

The **box-score-shots and box-score-faceoffs screens are unreachable from video ingest** because Pass-1 only emits one class (`post_game_box_score_goals`) for all three tabs and the dispatch (`tools/video_ingest/video_ingest/dispatch.py:82`) uses that class verbatim. Only manual-screenshot ingest with `--screen` override reaches the other two parsers. This is invisible from the schema's perspective; it looks like the screens are wired up. They're not.

The **in-game-clock and in-game-goal screens are completely unimplemented** — no classifier, no parser, no promoter, no test. Goal scorer + assist info still gets captured via the post-game events screen, so this isn't catastrophic, but it means the redesign's "definition of done" inventory at §1 has roughly **600 fields of in-game data that the current pipeline doesn't even try**.

### 7.3 Period determination depends on folder paths

`apps/worker/src/ocr-promoters/resolve-period.ts:9` and `inventory_consensus_match.py:183-201` both derive period from the parent folder name (`1st-Period-Events`, `2nd-Period-Events`, `OT-Events`). This works for the manual-screenshot workflow (operator places PNGs into pre-named folders) but for video ingest the segments are named by start-second, not by period. The current video-ingest dispatch must be falling back to some other period source (probably OCR'd `period_label` from the parser); when both fail, the row gets `period_number=0` which the faceoff-map and net-chart promoters reject (`faceoff-map.ts:65-69`, `net-chart.ts:47-53`). This is the actual source of the "Net Chart period_label OCR unrecognized" error class.

### 7.4 The clock convention split

Action Tracker = elapsed time (counts up). Events = remaining time (counts down). The promoter at `events.ts:69-83` converts the latter to the former before dedup. **This is invisible to anyone reading the schema** — `match_events.clock` is a text column with no doc comment about which convention. If the convention shifts in NHL 27 or if a third screen reports clock in a third convention, the dedup silently breaks.

### 7.5 Greedy spatial clustering is pixel-order-sensitive

`inventory_consensus_match.py:132-151` does greedy clustering by first-fit on existing cluster centroid. The order markers are processed determines the cluster assignment. `baseline-2026-05-19.md:99` calls this out: "naive merge attempt swapped collisions around without net reduction". The Phase 5b.2 fix is deferred and any redesign that keeps spatial consensus has to address this.

### 7.6 RapidOCR confidence is poorly calibrated

The codebase repeatedly demonstrates that 0.93–0.99 confidence still produces a misread. The 0.72 floor at `parsers.py:43` ("UNCERTAIN below 0.72") and the per-cell override at 0.85 (`parsers.py:1629`) and the 0.5 confidence-to-label cutoff (`parsers.py:455`) are all magic numbers chosen because the underlying calibration is bad. Any redesign that depends on OCR confidence (e.g., the probabilistic approach in §4.4) inherits this problem. The fix is to recalibrate per-version on a held-out labelled set, but that requires the labelled set we don't have.

### 7.7 Cross-screen dedup happens at the wrong layer

`match-events-dedup.ts` is in the promoter layer. The dedup decision uses {match, period, type, clock, actor} as the key, with Levenshtein-1 fallback. But by the time the dedup runs, the _Action Tracker_ row may already have spatial (x,y), while the _Events_ row is still being inserted — and the spatial UPDATE separately runs at `action-tracker.ts:246-309`. This means: an Events-screen capture processed AFTER the matching Action Tracker capture overwrites the Action Tracker's team_side and team_abbreviation but the spatial UPDATE may attribute to the wrong row when scrolling/sorting changes ordering. The architecture is "OCR is fact, dedup merges later" but the dedup logic is buried in two promoter files and depends on insertion order.

### 7.8 Single-prototype HSV centroid is calibrated from ONE png per class

This is in `baseline-2026-05-19.md:119` as Q3 ("Is averaged HSV histogram appropriate for visually-multimodal classes (10 different loadout cards with different player photos)?"). Confirmed by inspecting the YAML (each class has one centroid array). It is _not_ appropriate. This is the single biggest L1 reliability bug.

## 8. What I would NOT do at this volume

**Do not invest in a probabilistic OCR rewrite.** RapidOCR's confidences are poorly calibrated, the truth-data scale to recalibrate doesn't exist, and the gain (10–20% better dedup) is bought back trivially by a small CNN classifier + variable-rate sampling + cross-frame consensus on text values. At 30 matches/season the gain doesn't pay for the schema-wide changes required.

**Do not invest in transition-detection-based segmentation.** Transition detectors are notoriously fragile over compressed video (fades, scoreboard overlays, animations all look like cuts). The current 1 fps + HMM segmenter idea is more robust and easier to debug.

**Do not write your own OCR model.** RapidOCR is the right backend; the issues are in classification and ROI definition, not character recognition.

**Do not bundle classification + extraction in one model (i.e., a single end-to-end VLM prompt).** Yes, GPT-4V or similar could "look at this frame and tell me the loadout for this player". But: (a) you lose the ability to debug intermediate failures; (b) cost is prohibitive at 1,680 frames/match × 30 matches/season; (c) hallucination on numeric fields like attribute deltas is exactly the failure you can't afford at "no test-time human review". A pipeline with a small classifier + targeted OCR per ROI is more diagnosable, cheaper, and more deterministic.

**Do not expand the schema to store per-field probability distributions.** The architecture cost is high, the read-side complexity infects every UI component, and the actual reliability gain over a hard-decision schema + cross-frame consensus is marginal at this volume.

**Do not require a labelled-fixture-set CLI annotation workflow before each match.** The operator labelling burden in `baseline-2026-05-19.md:120` is already flagged as a concern. The redesign should prefer architectures that get good behaviour from ≤10 labelled examples per class total, not per match.

**Do not make NHL 26 → 27 a migration project.** Make it a config refresh. Externalise every per-version constant (ROI coords, anchor substrings, regex patterns, color centroids) into `configs/<version>.yaml`. If the redesign requires a code change to handle NHL 27, the redesign failed at the calibration-loop requirement.

---

## Critical Files for Implementation

- `tools/game_ocr/game_ocr/classifier.py` — the L1 module that needs to be replaced (or augmented with a learned classifier + Viterbi segmenter). Single highest-leverage file.
- `tools/game_ocr/game_ocr/parsers.py` — 2,651 lines; per-screen ROI definitions and field-level extraction logic that need externalisation into config so NHL 27 is config-only.
- `tools/game_ocr/scripts/inventory_consensus_match.py` — the existing cross-frame consensus matcher; generalising this from spatial-only to text-field is the path to a clean confidence model without a schema rewrite.
- `apps/worker/src/__tests__/match-250-benchmark.test.ts` — extend from 60 lineup fields to the full V2 inventory (~300 assertions) before any redesign work begins. The single biggest unlock for redesign confidence.
- `apps/worker/src/match-quality-cli.ts` — the existing scoring CLI; needs L1 measurement (currently null) backed by the labelled fixture set, and EA-aggregate-vs-OCR cross-check assertions added to L3.
