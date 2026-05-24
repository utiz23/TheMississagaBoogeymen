# Internal Review of research-2026-05-19.md

Internal critique by Claude `Plan` sub-agent. Reviews the deep-research output against the actual codebase shape; flags structural assumptions the research made that don't match the code.

## Review of Top-3 Prioritised Recommendations

### Rec 1: Event-first seeded chevron matching with Hungarian fallback

- **[WARN] Shape assumption is partly wrong.** The research describes the current matcher as "greedy pixel-space cluster, then majority-vote event attribution." That's only true of the _clustering_ phase. The _attribution_ phase at `tools/game_ocr/scripts/inventory_consensus_match.py:433-460` already does cross-product weighted assignment over `(cluster × all bucket events)` using `pair_weight()` (line 260-270), sorted descending, with 1:1 enforcement via `assigned_cluster`/`assigned_event` sets. It is greedy Hungarian-lite, not majority-vote. The real defect is upstream in `cluster_markers()` at line 132-151 (greedy spatial single-link clustering, pixel-order-sensitive), which means a single chevron-cluster representing two events gets one cost row in the matrix and only one event can claim it — the other gets nothing or steals a neighbour. SciPy `linear_sum_assignment` over the _current_ triples would not fix this; the fix must be in cluster formation (space-time, not space).

- **[OK] 1:1 invariant preserved.** The proposal's "rectangular one-to-one assignment" stage explicitly matches the existing invariant at `inventory_consensus_match.py:441-447` (`assigned_cluster`/`assigned_event` sets gate every triple). Switching to `scipy.optimize.linear_sum_assignment` is a drop-in for that block. Stage C "provisional clusters in `(x, y, clock_seconds)`" is the actual structural change and is sound.

- **[FAIL] Seeded-event source missing in the data pipeline.** Stage A wants to "ingest frames where `selected_event_index` is present and create seeded observations keyed by `match_event_id`." But `selected_event_index` lives in the **Action Tracker** capture (`apps/worker/src/ocr-promoters/action-tracker.ts:268`), not in `detected_markers`. The matcher consumes only `raw_result_json.detected_markers` and `events[]` (line 312-337), and currently has NO link from a marker observation back to a specific `match_event_id` — the only join is by `(period, event_type, team_side)` + actor/clock voting. To implement event-first seeding, the Action-Tracker spatial-update path that already lands x/y on the selected row (`action-tracker.ts:289-307`) would need to additionally **persist a marker→event_id observation** the consensus matcher can read. The research doesn't acknowledge this missing schema/storage link.

- **[WARN] Hidden interaction with cached Pass-1 results & match-quality report.** The consensus matcher pulls from `ocr_extractions.raw_result_json` (still cached). Adding a clock-aware clustering dimension means re-running the matcher invalidates `position_confidence` labels that already populated `match_events.x/y`. The 6 collision pairs in match 463's quality report are reported via the _delta-based_ Class C check shipped in Phase 5b.1 — that check fires on cluster-centroid proximity and would silently change its true-positive set under a new clusterer. Re-baselining the report before/after is required.

### Rec 2: Labeling and evaluation loop (Q4)

- **[OK] Matches existing repo conventions.** `calibration/extras/` already exists and is wired into `calibrate_classifier.py:34, 139` as a per-class fixture directory. Extending with `calibration/labels/frames_vYYYYMMDD.csv` and an `annotate_segments.py` CLI is a natural growth path; nothing structural blocks it.

- **[WARN] Budget claim drift.** The baseline says "~5 min/match" for `annotate-segments`. The research's proposed ranking (disagreement → boundary → downstream-failure → random) and per-class metric reporting is good active-learning, but with 1,680 frames in match 463 (baseline §L1 table) even the top-of-funnel "disagreement" slice can be hundreds of frames. The doc doesn't bound the labeling slice (e.g. "top-N=30 per match"). Without an explicit cap, 5 min/match is aspirational.

- **[OK] DVC suggestion is sensible but overkill for current scale (2 matches).** Append-only CSV in git + a frozen eval manifest is enough; the recommendation explicitly says "you do not have to adopt all of DVC on day one." Fits the repo.

### Rec 3: Scored anchor gate + temporal prior

- **[FAIL] Misreads where the recall problem lives.** The research treats the anchor gate as a "boolean substring test" with no continuous score. In fact `classifier.py:105-124` (`fuzzy_contains`) already returns boolean but is built on `_levenshtein` with a max-distance window — the _score_ is implicit (best-window edit distance). The deeper issue is at `classifier.py:303` (`anchor_color_floor = 0.30`) and the **anchor-priority single-winner loop** at `classifier.py:305-320`: once the longest-anchor class matches and clears the floor, the loop `break`s. For `player_loadout_view` the anchor `"player loadouts"` is the longest anchor in the config — when OCR is intact it wins easily; when OCR drops "player loadouts" entirely (which is what happens on 1,228 of the 1,230 mid-gameplay false-color frames), no class matches. The bottleneck is OCR recall on a 13-character anchor in a small ROI on transient frames, not the gate's score type. A logistic calibrator on top of `fuzzy_contains` cannot recover frames where OCR returned nothing.

- **[WARN] Temporal prior is sound and feasible.** The `pregame_bias` / `liveplay_bias` idea matches the existing segment-based architecture, and `_color_scores` returns a sorted list that's ready to be re-thresholded by segment context. This part is workable.

- **[OK] YAML schema extension fits.** Adding `anchor_lexemes`, `fuzzy_min_score`, etc. to `tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml` is straightforward — the loader at `classifier.py:158-192` is already permissive with `raw.get(...)` defaults.

## Cross-Cutting Concerns

### Multi-prototype recalibration (Q3) — test impact

- **[OK] `test_classifier.py:132-148` should still pass.** `NAMED_FIXTURES` lists 9 canonical PNGs. The proposed change is "max cosine-sim across prototypes per class," which on a class with `K=1` reduces exactly to the current single-centroid behaviour. Crucially `calibrate_classifier.py:147` already averages over multiple fixtures per class today — averaging is one prototype path; storing them separately and taking max-sim is strictly more permissive. Any fixture that classifies correctly under the averaged centroid will classify at least as well against the same fixture as its own prototype (max ≥ avg). The risk is `pre_game_lobby_state_2` (currently 6 fixtures averaged — multi-opponent calibration at `calibrate_classifier.py:50-66`). If multi-prototype K is chosen per-class with a sweep, that class might land at K=2 (BGM vs. opponent jersey-color modes) without harm to the canonical fixture. **Verify by re-running the E2E test post-change.**

### Q1 generalisation beyond match 463

- **[WARN] Recommendation is partly overfit.** The "6 marker-collision pairs" are a specific match-463 symptom. Event-first seeding (Rec 1) does generalise — it's a structural improvement. But the _clock-aware clustering_ part assumes events are well-separated in time; in NHL 26 a faceoff and a shot can occur within 1-2 seconds at the same hockey coordinate. The research notes "small tolerance" but doesn't define it. A 2-second clock tolerance would still collide many real match-event pairs; <1 second risks splitting genuine OCR jitter. Needs empirical tuning on a non-463 match.

### Q4 operator-budget realism

- **[FAIL] 5-min budget not respected as proposed.** The Settles-inspired ranking is right in principle, but the research describes four ranking tiers plus "a small random sample" with no slice size. With a single annotator and ~30 sec/frame labelling (read the title bar, classify into 8 classes, capture sha256), 5 min ≈ 10 frames/match. The doc should specify a fixed top-N (e.g., 10 disagreement + 5 boundary + 5 downstream + 2 random = 22, ~10 min) and accept that 5 min is optimistic for the first labelling round.

## Verdict

Rec 2 is solid and ready. Rec 1 is structurally sound but needs the marker→event_id storage hop the research didn't surface — implementing it as-described will fail at Stage A. Rec 3 misidentifies the root cause (OCR recall on transient frames, not gate-score granularity) and risks high-effort calibration work that doesn't move L1.

### Critical Files for Implementation

- `tools/game_ocr/scripts/inventory_consensus_match.py`
- `apps/worker/src/ocr-promoters/action-tracker.ts`
- `tools/game_ocr/game_ocr/classifier.py`
- `tools/game_ocr/scripts/calibrate_classifier.py`
- `tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml`
