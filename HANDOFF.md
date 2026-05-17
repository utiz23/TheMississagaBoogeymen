# Handoff

## Current Status

**Phase:** **Video → match_events pipeline shipped end-to-end (Phases 0-5 of the video rewrite plan).** A single command turns a 32-min `.mkv` into DB rows: probe → 1-fps coarse classify into segments → per-segment dense ffmpeg extraction → fan-out to existing ingest-ocr-cli per segment dir → existing 4-tier downstream finishes the job.

**Verified on the canonical match-250 video** (32 min, 60 fps, 815 MB → 10 segments → 212 frames → 209 successful extractions → 94 match_events). Per-type breakdown identical to the canonical 93 events (7 goals, 31 shots, 35 hits) plus +1 faceoff. Total wall-clock: ~30 min on RTX 3060. Idempotent re-runs via `ocr_capture_batches.video_sha256` unique-when-not-null index.

### Video pipeline architecture

```
tools/video_ingest/                         apps/worker/                  packages/db/
─────────────────────                       ─────────────                 ────────────
video_ingest.cli ingest                     ingest-ocr.ts                 ocr_capture_batches
  → pts.probe (sha256, DTS monotonicity)      ON CONFLICT                   + video_sha256 col
  → version_detect (--version auto)           (video_sha256,                + partial unique idx
  → Pass-1: ffmpeg 1fps raw-BGR pipe          source_directory)
    → game_ocr.classifier (HSV cosine
      + anchor OCR + OOD)
    → N-window segmentation
    → segments.json
  → Pass-2: ffmpeg per-segment @ N fps
    → seg-NNN-<screen_type>/00000.png ...
  → dispatch.py: fan out to ingest-ocr-cli
    once per segment dir
```

Per-screen Pass-2 sample rates (`tools/video_ingest/video_ingest/configs/nhl26.yaml`): action_tracker=5 fps, everything else=1 fps. RapidOCR-GPU benchmark on RTX 3060: full-frame 687 ms / panel-crop 336 ms / anchor-ROI 191 ms p50 — 3× CPU speedup.

### Key files added / modified in this rewrite

| New                                                                                                                              | What it does                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `tools/video_ingest/` (entire package)                                                                                           | Two-pass orchestrator                                                                             |
| `tools/video_ingest/video_ingest/{pts, pass1_classify, pass2_extract, dispatch, orchestrator, cli, version_detect, gpu_libs}.py` | Core modules                                                                                      |
| `tools/video_ingest/video_ingest/configs/nhl26.yaml`                                                                             | Per-version sample rates + N-window knobs                                                         |
| `tools/video_ingest/tests/fixtures/match-250-clip.{mkv,segments.json}`                                                           | 60s labeled fixture for unit + e2e                                                                |
| `tools/game_ocr/game_ocr/classifier.py`                                                                                          | Hybrid HSV-cosine + anchor-OCR + OOD classifier                                                   |
| `tools/game_ocr/game_ocr/configs/classifier/nhl26.yaml`                                                                          | 8-class config calibrated from `ScreenShots/` + 3 multi-opponent extras                           |
| `tools/game_ocr/scripts/calibrate_classifier.py`                                                                                 | Regenerates `nhl26.yaml` from labeled fixtures                                                    |
| `tools/game_ocr/calibration/extras/`                                                                                             | Multi-opponent lobby samples (broadens centroid beyond canonical fixture's TRIPORT CHUGS palette) |
| `packages/db/migrations/0035_legal_iron_lad.sql`                                                                                 | `video_sha256` col + partial unique index                                                         |

| Modified                                              | Why                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `apps/worker/src/ingest-ocr.ts`                       | `videoSha256` field + idempotent upsert                         |
| `apps/worker/src/ingest-ocr-cli.ts`                   | `--video-sha256` flag with hex validation                       |
| `tools/game_ocr/game_ocr/cli.py`                      | New `classify` subcommand (NDJSON output)                       |
| `tools/game_ocr/game_ocr/ocr.py`                      | `RapidOCRBackend(use_gpu=True)` kwarg                           |
| `tools/game_ocr/scripts/inventory_consensus_match.py` | argparse + `--cluster-radius-px` + density-aware default        |
| `tools/game_ocr/scripts/cutoff_event_recovery.py`     | Filename regex also matches `NNNNN.png` (video-pipeline output) |

### Run the full pipeline

```bash
# One command, .mkv → match_events
PYTHONPATH=tools/video_ingest:tools/game_ocr python3 -m video_ingest.cli ingest \
  --video /mnt/k/NHL/NHL26/<file>.mkv \
  --output-root /tmp/vi-canonical \
  --version auto \
  --dispatch --game-title-id 1 --match-id <id> \
  [--force-pass1] [--force-pass2]
```

Then run tier-2/3/4 manually (orchestrator does not auto-trigger them) — see existing reproducible procedure below.

### Phase 5 acceptance summary (canonical regression)

- Pipeline reproduced **all 73 canonical shot/hit/goal events** ✓
- **+1 faceoff** vs canonical (clock-OCR variation; tier-4 can't dedup unpositioned faceoffs)
- **0 spurious** shot/hit/goal events
- **0 phantoms** after tier-4
- **0 canonical events lost** (fuzzy-actor dedup re-linked 71/73 to new extractions; 2 stayed canonical)
- Pre-Phase-5 backup at `.tmp-backups/match250-pre-phase5-20260515-*.sql` (full table-level pg_dump, restorable)

### Known limitations / future work

1. **Classifier calibration is single-fixture-per-class for most screens** — works on canonical match-250 but expect issues on different game versions, different opponents (lobby is already multi-opponent-calibrated via the `calibration/extras/` set).
2. **Faceoff-map segment** can be missed when the user only briefly views the screen — Pass-1 requires 3 consecutive same-type frames at 1 fps to open a segment. Mitigation: bump `min_run_to_open` knob in nhl26.yaml down to 2, or sample Pass-1 at 2 fps.
3. **Tier-2 default `--cluster-radius-px` is density-aware** but tested only at current ~220 markers/period. Dense AT regimes (>1500 markers/period) will exercise the tighter end of the curve.
4. **NHL 27 anchors** are stubbed in `version_detect.VERSION_ANCHORS` but empty. First NHL 27 capture → populate the tuple → version-detect picks it up.
5. **`post_game_events` extractor doesn't run from this pipeline** for match 250 (user viewed the screen only during intermissions, which are correctly rejected). Penalty extraction relies on events tab — if a future video has the user viewing events post-game, those frames will be picked up and processed.

### Review findings on record — 2026-05-16

Video extraction code review surfaced four concrete issues that are not yet fixed:

1. **`video_ingest` CLI import order is broken.** `tools/video_ingest/video_ingest/cli.py` inserts `tools/game_ocr` into `sys.path` only after importing `video_ingest.orchestrator`, but `orchestrator -> pass1_classify` imports `game_ocr` at module import time. In a clean interpreter where `game_ocr` is not already installed, the CLI dies before startup with `ModuleNotFoundError: No module named 'game_ocr'`.
2. **Cache invalidation is wrong for Pass 1 and Pass 2.** `segments.json` cache reuse is keyed only by video SHA path, not by requested `--version` or classifier config; `pass2/` cache reuse is keyed only by the directory being non-empty, ignoring sample rates, padding, and extract-screen config. Re-running the same video with a different version or changed config can silently reuse stale results.
3. **Phase-specific CLI commands do not match their contract.** `classify-only` still runs the full orchestrator and can perform Pass 2 extraction on first run; `extract-only` does not actually require cached `segments.json` and will fall back to re-running Pass 1 if the cache is missing.
4. **Cached Pass 2 metadata is reconstructed incorrectly.** Fresh Pass 2 results record padded extraction windows, but the cache-hit path rebuilds `Pass2Result.start_seconds/end_seconds` from raw segment bounds. That makes `pass2_manifest.json` and dispatch notes differ between fresh and cached runs, which is a bad audit trail for a supposedly reproducible pipeline.

Additional note: `tools/video_ingest/tests/` currently contains only fixture files (`match-250-clip.mkv` and labeled `segments.json`) and no actual test coverage for these cache, CLI-contract, or timestamp-path behaviors.

---

**Prior phase context** (still applicable to existing manual-screenshot workflow):

**Phase:** OCR position pipeline is a fully-automated four-tier system with fuzzy actor dedup at promoter time and clock-phantom sanity sweep as the final pass. Match 250 has **71 real plottable events**, all positioned, from a clean-slate DELETE + 4-tier run with zero manual interventions.

> **Note on row counts.** Earlier session notes use "72" — that's the row count BEFORE tier 4 runs. Tiers 1-3 produce 72 rows in `match_events`, of which 71 are real events and 1 is the `1:10 SILKY` clock-OCR phantom (an OCR misread of `11:10`; the real `11:10 SILKY` shot is one of the 71 canonical rows). Tier 4 (`clock_phantom_check.py`) deletes the phantom on every run, yielding the 71-row final state. The pipeline has always handled 71 real events; the count "drop" from 72 to 71 reflects the addition of tier 4, not a lost event.

### Four-tier OCR position pipeline

| Tier | Tool                                                                                               | Signal                                                                                                                                                              | Match 250 contribution |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1    | Action-tracker promoter spatial UPDATE (`apps/worker/src/ocr-promoters/action-tracker.ts:225-265`) | Yellow rink marker + clean white-underline detection                                                                                                                | 64 events positioned   |
| 2    | `tools/game_ocr/scripts/inventory_consensus_match.py`                                              | Cross-frame consensus of non-yellow markers + greedy `(actor, clock)` matching                                                                                      | +2 events              |
| 3    | `tools/game_ocr/scripts/cutoff_event_recovery.py`                                                  | Orphan yellow markers reconciled against orphan events via panel-anchor + next-chronological lookup                                                                 | +5 events              |
| 4    | `tools/game_ocr/scripts/clock_phantom_check.py` (NEW)                                              | Clock-OCR phantom detection: same `(period, type, actor_player_id)` bucket + clock substring/Levenshtein-1 + position asymmetry → `DELETE` the unpositioned phantom | −1 phantom row         |

All tiers are idempotent. Tier 3 has three sub-cases:

- **Sub-case B** — panel last plottable row is itself an orphan event → match it (underline rendered just below the OCR'd actor band).
- **Sub-case A** — anchor is positioned; predict the chronologically-next event after the anchor (older real time = higher clock value = lower index in descending-clock-sorted list).
- **Sub-case C** — predicted event already positioned; emit consistency-check log only (distance < 5 ft = OK).

### Other fixes shipped this session

- **Fuzzy actor dedup in promoter** (`apps/worker/src/ocr-promoters/match-events-dedup.ts`, NEW). Replaces the prior exact-string actor dedup in both `action-tracker.ts` and `events.ts`. Two strategies in sequence:
  1. **Resolved-player path** — when `resolveGamertagToPlayer` succeeded (handles BGM-side typos via existing Levenshtein-1 cascade), dedup on `actor_player_id`. Catches SIlKY ↔ SILKY etc.
  2. **Unresolved-actor fuzzy fallback** — for opps (not in `players` / `player_display_aliases`), load same-bucket rows with null `actor_player_id` and Levenshtein-1 compare actor snapshots in TS. Catches WILOE ↔ WILDE and fOEWS ↔ TOEWS.
  - Action-tracker's spatial UPDATE also routes through the helper so it lands on the canonical row even when the capture's actor string is a typo.
  - Diagnostic across all matches: 0 resolved-actor duplicates remain anywhere; 1 same-bucket pair in match 250 (WILDE hit + S. ZUBOV hit, both at clock 2:09) is legitimately distinct players, kept as-is.
- **Consensus matcher rewritten** (`inventory_consensus_match.py`). Global greedy max-weight bipartite matching across (clusters × all bucket events) using (actor, clock) frequency. Cluster's best match → event; emits UPDATE only when the matched event is unpositioned. Replaces FCFS that double-plotted.
- **Action-tracker promoter robustness** (`apps/worker/src/ocr-promoters/action-tracker.ts`):
  - `periodFromPath()` fallback when OCR period parsing returns -1 (e.g. "RT 2ND PERIOD 11.1") — recovered 4 events.
  - `inferEventTypeFromRawText()` recovers `shot`/`goal`/`hit` from corrupted "SHDT"/"GDAL"/"10HS" raw text — recovered 6 events, including SILKY's 6:02 goal.
  - `sourcePath` plumbed through `PromoterContext`. Both `ingest-ocr.ts` and `repromote-ocr-cli.ts` now forward it.
  - **`selected_event_index === null` no longer falls back to `events[0]`** for the spatial UPDATE. The fallback was actively corrupting other events' positions; removed so the cutoff-recovery tool can attribute these properly downstream.
- **OCR errors: 0**. All match-page sections live on `/games/250`.

**Reproducible procedure for match 250 (clean-slate, no manual cleanups):**

```bash
# 1. Optional clean slate — DELETE all match 250 OCR plottable events:
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "
  DELETE FROM match_goal_events WHERE event_id IN (
    SELECT id FROM match_events WHERE match_id=250 AND source='ocr' AND event_type IN ('shot','hit','goal','penalty'));
  DELETE FROM match_penalty_events WHERE event_id IN (
    SELECT id FROM match_events WHERE match_id=250 AND source='ocr' AND event_type IN ('shot','hit','goal','penalty'));
  DELETE FROM match_events WHERE match_id=250 AND source='ocr' AND event_type IN ('shot','hit','goal','penalty');
"

# (Or just NULL the positions if rows are otherwise correct:
#  UPDATE match_events SET x=NULL,y=NULL,rink_zone=NULL,position_confidence=NULL ...)

# 2. Tier 1: repromote (fuzzy actor dedup catches all typo cases at insert time):
pnpm --filter worker repromote-ocr -- --match 250 --screen post_game_action_tracker

# 3. Tier 2: consensus matcher:
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \
  "SELECT json_agg(json_build_object('id',id,'source_path',source_path,'raw_result_json',raw_result_json))
   FROM ocr_extractions WHERE match_id=250 AND screen_type='post_game_action_tracker'
     AND raw_result_json->'detected_markers' IS NOT NULL" \
  | python3 tools/game_ocr/scripts/inventory_consensus_match.py 250 \
  | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl

# 4. Tier 3: cutoff recovery:
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \
  "SELECT json_agg(json_build_object('id',id,'source_path',source_path,'raw_result_json',raw_result_json))
   FROM ocr_extractions WHERE match_id=250 AND screen_type='post_game_action_tracker'" \
  | python3 tools/game_ocr/scripts/cutoff_event_recovery.py 250 \
  | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl

# 5. Tier 4: clock-phantom sanity sweep:
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -tAc \
  "SELECT json_agg(json_build_object('id',id,'period_number',period_number,'event_type',event_type, \
       'clock',clock,'actor_player_id',actor_player_id,'actor',actor_gamertag_snapshot,'x',x,'y',y)) \
   FROM match_events WHERE match_id=250 AND source='ocr' AND event_type IN ('shot','hit','goal','penalty')" \
  | python3 tools/game_ocr/scripts/clock_phantom_check.py 250 --apply \
  | docker exec -i eanhl-team-website-db-1 psql -U eanhl -d eanhl
```

End state: **71 canonical rows, all 71 positioned = 100% coverage**, no manual interventions.

**Open items, ranked:**

1. **Partial-row underline detector improvement** (~1.5 hr, OPTIONAL) — expose `peak_y` and a `state ∈ {matched, peak_no_row_match, no_peak}` from `detect_selected_row_index` in `tools/game_ocr/game_ocr/spatial.py:679-777`. Lets `cutoff_event_recovery.py` distinguish sub-case A vs B without relying on the panel-anchor heuristic.
2. **Hit-vs-shot discrimination at 8 vertices** (deferred). After the noisy-square-fallback fix, hit ratio 1.31 (was 1.03) but ~90 markers currently classified as "shot" (8-vert circ≥0.85) are likely noisy hits with rounded corners. Distinguishing them without per-marker ground-truth labels is hard. Revisit if a future match shows obviously wrong per-player hit attribution.
3. **Auto opp-color detection** (~45 min). Match 250 is BGM-away + opp-white; future matches will break.
4. **Overlap watershed** (~2 hr). Stacked markers at one on-ice spot. Not present in 250 but real games will have it.
5. **Clock-phantom generalisations** (deferred) — period-bounds check (clock > 20:00 in p1-3 = impossible), OT-lower-bound (clock < game-end-clock impossible), unresolved-actor phantom detection. None of these classes currently have known instances; ship if/when a future match surfaces one.

**Last updated:** 2026-05-16 (Net-Chart OCR pipeline hardening: period sentinel + multi-frame merge + ALL PERIODS aggregate from header — see session summary below)

---

## Session Summary — 2026-05-16 (Pre-Game Loadout OCR — Attribute + X-Factor completion)

### What was done

Five-phase pass on the `player_loadout_view` OCR pipeline so every match-250 BGM anchor has full 23-attribute coverage + accurate Δ deltas, X-Factor tiers are non-null on every slot, and the previously-broken BGM LD / RD anchors point at the correct source PNGs. Shipped as plan-quirky-reddy.

| Phase | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Extended `validate_loadout_v2.py` to also diff per-attribute Δ values, using the user-provided 23-row MrHomicide baseline. Captured pre-tune output to `/tmp/ocr-baseline-pre.txt`. DB inventory showed only DuhPope/HenryTheBobJr/MuttButt/RAIDERSG7/XZ4RKY/shadowassault20/silkyjoker85 had 23 attrs; MrHomicide had 0 (anchor was a lobby capture), JoeyFlopfish + Stick Menace had 5 (wrong/stale source PNGs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2     | Tuned [tools/game_ocr/game_ocr/parsers.py](tools/game_ocr/game_ocr/parsers.py) `_parse_loadout_attributes` + `_extract_cell`. Two specific fixes: (a) **`_infer_delta_sign_from_color()`** samples the chip's background hue when OCR captured a delta digit without a sign — red chip → negative, green chip → positive. (b) **`_rescan_delta_chip()`** falls back to a tight ROI re-OCR (4× bicubic upscale) when the full-frame scan missed the delta entirely. Both fixes pushed MrHomicide from 18/22 to 22/22 delta coverage. All 93 existing pytest tests still pass.                                                                                                                                                                                                                                                                                                                                                                                     |
| 3     | Skipped — `_classify_xfactor_tier()` already returns correct tiers on every May-10 source PNG. The earlier "null tier" symptom was a data-side artifact of stale anchors, fully resolved by Phase 4's re-ingest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4     | `pg_dump` snapshot to `/tmp/loadout-backup-20260516-2116.sql`. Re-ingested all 11 May-10 PNGs via `pnpm --filter worker ingest-ocr --batch-dir research/OCR-SS/Pre-Game-Loadouts --screen player_loadout_view --game-title-id 1 --match-id 250` (batch 62, 11/11 succeeded). Updated [consolidate-loadouts-cli.ts](apps/worker/src/consolidate-loadouts-cli.ts) `pickAnchor`: (i) normalize gamertags via `normTag()` so `StickMenace` and `Stick Menace` resolve to the same identity; (ii) when multiple candidates match the dominant gamertag, prefer the **most recent** snapshot (highest id) instead of the field-count winner — older snapshots inherit field values from prior consolidator runs (`player_name_persona`, etc.), which artificially inflated their non-null count and locked them in as anchors. Critical subfix: cast `id` to `Number` before comparison; node-postgres returns bigint as string so `"1446" < "509"` lexicographically. |
| 5     | Updated `match-250-benchmark.test.ts` — restored BGM RD `xFactorsCanonical: ['Elite_Edges', 'Tape_to_Tape', 'Stick_Em_Up']` assertion now that the OCR pipeline produces it. Both benchmark tests pass; 29 unit tests pass. Live `/games/250` opens every BGM drill-down with all 23 attribute rows populated, green tip on every boosted attribute, X-Factor PNG icons on every card (no more dot fallbacks for LD/RD).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Verified

- `python3 scripts/validate_loadout_v2.py` → MrHomicide 23/23 R, 22/22 Δ matches per-pixel screen content; overall 94.4% across all 5 BGM captures (remaining "diffs" are display-form mismatches: `Tage Thompson - PowerForward` vs `TAGETHOMPSON-PWF`, `Cole Caufield - Sniper` vs `COLECAUFIELD-SNP`, etc., not OCR errors).
- DB inventory post-consolidation: all 10 reviewed anchors have 23 attributes. Stick Menace + silkyjoker85 have 0 deltas because their actual loadout-view screens show no Δ chips (verified via cropped screenshot — both players have base ratings only).
- All 30 X-Factor rows (10 anchors × 3 slots) have non-null `tier` and canonical names matching V2 truth.
- `pnpm --filter @eanhl/worker test` → 29 pass.
- `node --test apps/worker/dist/__tests__/match-250-benchmark.test.js` → 2 pass.

### Note on the user-provided MrHomicide baseline

The user's manual Tenacity column (hand_eye 94 / strength 90 / durability 80 / shot_blocking 68) appears to be Tactics-column values copy-pasted by mistake. The actual screen shows 92 / 83 / 76 / 75 — verified visually by cropping the source PNG at the Tenacity column. The OCR is correct; the baseline numbers in that block were inadvertently duplicated. All other 19 user-provided baseline values match the screen and the parser output.

### Files added / modified this session

| Modified                                                | Why                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/game_ocr/game_ocr/parsers.py`                    | `_parse_loadout_attributes`/`_extract_cell` accept `image`; new helpers `_infer_delta_sign_from_color()` + `_rescan_delta_chip()` + lazy `_shared_ocr_backend()` |
| `tools/game_ocr/scripts/validate_loadout_v2.py`         | Extended baseline to include 23 Δ rows for MrHomicide; harness now diffs deltas                                                                                  |
| `apps/worker/src/consolidate-loadouts-cli.ts`           | `pickAnchor` normalizes gamertags + prefers newest snapshot among matches; `Number()` cast around id comparison                                                  |
| `apps/worker/src/__tests__/match-250-benchmark.test.ts` | Restored BGM RD canonical X-Factor list                                                                                                                          |

### Data-side rollout

```bash
docker exec eanhl-team-website-db-1 pg_dump -U eanhl -d eanhl \
  -t player_loadout_snapshots -t player_loadout_attributes -t player_loadout_x_factors \
  --data-only > /tmp/loadout-backup-20260516-2116.sql

pnpm --filter worker ingest-ocr \
  --batch-dir /home/michal/projects/eanhl-team-website/research/OCR-SS/Pre-Game-Loadouts \
  --screen player_loadout_view --game-title-id 1 --match-id 250

pnpm --filter worker consolidate-loadouts --match 250
```

11 source PNGs re-extracted into batch 62; new anchors land on `for|C=1445` (MrHomiecide), `for|LW=1446` (StickMenace), `for|LD=1449` (HenryTheBobJr), `for|RD=1450` (JoeyFlopfish), `for|RW=1448` (silkyjoker85).

---

## Session Summary — 2026-05-16 (Lineup & Loadouts punch-list round 2 — 11 follow-ups)

### What was done

Visual + interaction follow-ups on `/games/[id]` **Lineup & Loadouts** after the mockup-adoption work. Shipped as plan-quirky-reddy (the plan file was overwritten again for this round).

| #   | Issue                                                               | Fix shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `M.Rantanen Stick Menacesilkyjoker85` text concatenation            | `platformDisplayLabel()` now uses a strict whitelist (`Xbox`/`PlayStation`/`PS5`/`PS4`/`PC`/`Switch`). OCR-junk gamertags that landed in the platform column no longer leak through.                                                                                                                                                                                                                                                                                                        |
| 2   | Platforms missing in UI                                             | DB cleaned: 14 rows of garbage platform values NULL'd via direct UPDATE. Consolidator + promoter now apply the same strict whitelist before write so future ingest can't pollute the column. Real platform OCR (separate parser work) **deferred** — the new anchor parser stubs `player_platform=MISSING` and no clean source exists yet.                                                                                                                                                  |
| 3   | BGM LD / BGM RD missing X-Factor icons                              | Diagnosed: `_classify_xfactor_tier()` is verified correct on V2 source screenshots. The affected snapshot rows (anchors 147 + 505) were extracted when the parser version of the time either lacked the classifier (May 12) or returned None for that specific frame (May 13). Their source PNGs are gone or wrong-player; real fix needs a re-OCR pass on the current parser. **Deferred** as data work. The renderer falls back to the colored-dot stack so the section degrades cleanly. |
| 4   | X-Factor name pills consume too much space                          | New `XFactorStack` component: 3 vertical 28px PNG icons (or dot fallback) sitting opposite the jersey/portrait on every player card. Names move to the drill-down panel only. Tooltip on each icon surfaces `Name — Tier`.                                                                                                                                                                                                                                                                  |
| 5   | Multiple drill-downs open at once                                   | New client wrapper `LineupLadder` owns `openPosition: PositionKey \| null`. `LineupRow` converted to controlled props. Opening row B closes row A automatically.                                                                                                                                                                                                                                                                                                                            |
| 6   | Replace plain build chip with the existing archetype pill component | `BuildArchetype` component swaps in `ArchetypePillCompact` (from `apps/web/src/components/ui/archetype-pill.tsx`). Canonical-build → archetype enum mapper covers all 8 build classes that appear in OCR. Summary band's bare + reference build chips use the same component, with a `2× PMD` style multiplier when a bare build collapses.                                                                                                                                                 |
| 7   | Opp side rendered two "C" captain pips (Toews + DuhPope)            | `getMatchLineups` now enforces one captain per side at the end of the pipeline. Ties resolved by canonical position order (C wins over LW, etc.). Benchmark test updated to assert DuhPope `isCaptain: false`.                                                                                                                                                                                                                                                                              |
| 8   | "Captain" → "Room Leader"                                           | UI string change in the summary band's KV. The in-card jersey `C` pip stays as-is since that's the in-game glyph.                                                                                                                                                                                                                                                                                                                                                                           |
| 9   | Confusing red bars in attribute drill-down                          | Base bar tone is now neutral (no more red on boosted attributes).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10  | Add green segment for additions, red marker for deductions          | Attribute bar is rendered as a stacked composition: neutral base from 0 to `max(0, value − delta)`, then a green segment (`var(--color-win)` + soft glow) covering the positive boost, OR a red striped marker beyond the current value showing where the rating would have sat without a nerf. Verified live: open RW row has 15 green boost markers + 5 red nerf markers across both players.                                                                                             |
| 11  | Color the middle position rail                                      | Shared `colorForPosition` helper extracted into `apps/web/src/lib/position-colors.ts`. `PositionBadge` and `LineupExpandPanel.CenterRail` both apply `color-mix(in srgb, var(--pos-X) 10%, transparent)` background + matching border + colored letter. C=red, LW=green, RW=blue, LD=teal, RD=yellow, G=purple per `docs/specs/position-colors.md`.                                                                                                                                         |

### Mid-session inline fixes (asked while iterating)

- Player cards no longer show the reference-player suffix (`T. Thompson`, `C. Caufield`). The reference name appears only inside the drill-down's build block.
- Summary band trimmed: `X-Factors`, `Elite`, `All Star`, `Specialist` counts are gone — the band now shows `Dressed N/6`, `Goalie`, `Room Leader` plus the build chip row.
- Global archetype pill compact form converted to 3-letter codes per user spec: `PLY`, `SNP`, `PWF`, `GRN`, `TWF`, `ENF`, `DFD`, `OFD`, `TWD`, `EFD`, `PMD`. Affects every consumer of `ArchetypePillCompact` (roster ledger leader tiles, lineup section, etc).

### Verified

- `pnpm --filter @eanhl/db build`, `pnpm --filter @eanhl/worker build`, `pnpm --filter web typecheck` all clean.
- `pnpm --filter @eanhl/worker test` → 29 unit tests pass.
- `node --test apps/worker/dist/__tests__/match-250-benchmark.test.js` → 2 pass (slot data + goalie CPU check).
- DB inventory: `SELECT DISTINCT platform FROM player_loadout_snapshots ORDER BY 1` returns only `NULL` after the backfill.
- Live `/games/250`: no platform string after any gamertag; single captain pip (`#11` BGM, `#19` opp); 3-icon X-Factor stack opposite jersey on every card; build pills are 3-letter codes with color/icon from `ArchetypePillCompact`; position badges + expand-rail tinted per-slot; opening BGM C → BGM LW closes C automatically; boosted attribute bars show a green tip at the boost width.

### Known OCR data-quality limits carried forward

- Platform indicator stays hidden across all matches until real platform OCR lands. The whitelist + DB cleanup keeps the column honest in the meantime.
- BGM LD / BGM RD X-Factor icons fall back to the dot stack because the consolidator-selected anchors for those slots have `tier=NULL` (parser version skew at extraction time). The current anchor parser's tier classifier is verified correct — re-OCR on the source PNGs would restore the icons.

### Files added / modified this session

| New                                                 | What it does                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/web/src/lib/position-colors.ts`               | Shared `colorForPosition()` + `POSITION_META` + short↔long position-key helpers |
| `apps/web/src/components/matches/lineup-ladder.tsx` | Client wrapper owning the single open-position state                            |

| Modified                                                  | Why                                                     |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `apps/web/src/components/matches/lineup-section.tsx`      | All 11 frontend follow-ups, plus inline trim asks       |
| `apps/web/src/components/matches/lineup-row.tsx`          | Controlled props (lifted state)                         |
| `apps/web/src/components/matches/lineup-expand-panel.tsx` | Position-color center rail + attribute bar overlay      |
| `apps/web/src/components/ui/archetype-pill.tsx`           | Compact pill names converted to 3-letter codes (global) |
| `apps/web/src/components/roster/profile-hero.tsx`         | Now imports `colorForPosition` from shared lib          |
| `packages/db/src/queries/match-lineups.ts`                | One-captain-per-side enforcement                        |
| `apps/worker/src/consolidate-loadouts-cli.ts`             | `sanitizePlatform()` whitelist before voting            |
| `apps/worker/src/ocr-promoters/loadout.ts`                | `whitelistPlatform()` at insert time                    |
| `apps/worker/src/__tests__/match-250-benchmark.test.ts`   | DuhPope `isCaptain: false` per Phase 7                  |

### One-shot SQL backfill applied to the live DB (not a migration)

```sql
UPDATE player_loadout_snapshots
SET platform = NULL
WHERE platform IS NOT NULL
  AND lower(trim(platform)) NOT IN ('xbox','playstation','ps5','ps4','pc','switch');
-- 14 rows updated
```

---

## Session Summary — 2026-05-16 (Lineup & Loadouts mockup adoption — 6-phase plan)

### What was done

Six-phase frontend feature pass on `/games/[id]` **Lineup & Loadouts** that closes the gap between the implementation and the design mockup at `boogeymen-design-system/project/Lineup.html`. Shipped as plan-quirky-reddy (the file was overwritten for this round).

| Phase | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Files                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `getMatchLineups` now also pulls per-attribute values from `player_loadout_attributes` (same gamertag-normalized pool used for X-Factors so misattributed rows can't leak attributes between players) and exposes them on each `LineupRow` as `attributes: Record<key, {value, delta}> \| null`. New sibling `getMatchLineupProvenance(matchId)` returns capture-time range, source-screen counts, and three confidence aggregates (canonical / tiered / attribute). Plumbed `match.gameMode`, `match.id`, and the provenance object through to `<LineupSection>`. The benchmark test's `LineupRow` contract is preserved (only additive fields). | `packages/db/src/queries/match-lineups.ts`, `apps/web/src/app/games/[id]/page.tsx`, `apps/web/src/components/matches/lineup-section.tsx`                                                                                      |
| 2     | Summary band: replaced duplicated `VS / VS / EASHL 6s` center stack with mockup's `GAME / 250 / VS / EASHL 6s`. New `Goalie · CPU` KV on both sides. `Dressed N/6` now renders the `/6` dimmed. Build chips show reference-player + canonical build name (`C. Caufield · Sniper`, `T. Thompson · Power Forward`); duplicate bare builds still collapse to `2× PMD`.                                                                                                                                                                                                                                                                               | `apps/web/src/components/matches/lineup-section.tsx` (`SummaryBand`, `SummarySide`, `summarizeBuilds`, new `DressedKV`)                                                                                                       |
| 3     | Player card polish: X-Factor chips now render the canonical PNG icon (Red/Blue/Gold per tier) via `xFactorIconUrl()` instead of the colored dot. Platform indicator (inline Xbox/PS SVG + label) wires up to `LineupRow.platform`; `platformDisplayLabel()` rejects OCR garbage like `MuttButt` in the platform column. Cards gain hover state (raised surface + lighter border, `cursor: pointer`). `CpuPlaceholderCard` rewritten to the mockup's full layout (jersey `#—`, hatched avatar, persona "CPU Goalie", `cpu-tag`, subline).                                                                                                          | `apps/web/src/components/matches/lineup-section.tsx` (`PlayerCard`, `PlayerInfo`, `XFactorChip`, `PlatformIcon`, `platformDisplayLabel`, `CpuPlaceholderCard`, `Jersey`, `Avatar`)                                            |
| 4     | In-row drill-down (the marquee mockup interaction). New client component `LineupRow` owns the `open` state, exposes role=button + aria-expanded + Enter/Space toggle. New server component `LineupExpandPanel` renders side-by-side BGM/Opp panels: build block (label + ref + HWH KVs + X-Factor list with PNG icons + 3-tick `XFactorTierRail` + tier word), 5-group attribute breakdown (`ATTRIBUTE_GROUPS` hard-coded) with per-row bar/value/delta. Goalie row stays non-expandable (CPU on both sides).                                                                                                                                     | `apps/web/src/components/matches/lineup-row.tsx` (new), `apps/web/src/components/matches/lineup-expand-panel.tsx` (new), `apps/web/src/components/matches/lineup-section.tsx` (`LadderRow` rewired to pass cards as children) |
| 5     | OCR provenance footer at the bottom of the section: `Captured` (date range), `Sources` (sentence joining screen-type labels), `Confidence` (mean of the three sub-scores with a `High/Solid/Partial/Low` word), plus three colored badges (`Canonical · 100%`, `Tiered · 67%`, `Attribute · 83%` on match 250). Badge tone is `ok` ≥ 0.9 else `warn`.                                                                                                                                                                                                                                                                                             | `apps/web/src/components/matches/lineup-section.tsx` (new `OcrProvenanceFooter` + helpers)                                                                                                                                    |
| 6     | Build / typecheck / test sweep clean. Benchmark regression test still passes (the additive `attributes`/`platform`/`buildClassCanonical` fields don't affect its assertions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                             |

### Verified

- `/games/250` 1600×1400 visual capture: summary band shows `GAME · 250 · VS · EASHL 6s` in the center; both sides show `Goalie · CPU` and `5/6` (with `/6` dimmed); BGM build chips read `T. THOMPSON · POWER FORWARD` and `C. CAUFIELD · SNIPER` alongside `PLAYMAKER` and `2× PMD`. Every X-Factor chip in the ladder shows a small PNG icon. CPU goalie cards have the full layout with hatched fill. Footer reads `Captured · May 12 → May 15 · Pre-game lobby + Loadout view · Confidence Solid · 0.83`.
- Click BGM C → row expands. Left column: `Playmaker / Wheels-Elite / One T-Elite / Tape to Tape-AllStar` with tier rails (Elite=3 ticks lit). Right column: Toews's `Two-Way Forward / Warrior-Elite / Big Rig-Elite / Rocket-Elite`. Mid column: vertical "Position matchup" label, large `C`, `↑ BGM / OPP ↓` markers. Attribute groups render with the 23 keys grouped into Technique / Power / Playstyle / Tenacity / Tactics; missing values show `—`.
- `pnpm --filter worker test` → 29 pass.
- `node --test apps/worker/dist/__tests__/match-250-benchmark.test.js` → 2 pass (slot data + goalie CPU check).

### Known cosmetic data-quality limits (NOT bugs in this work)

- Platform indicator currently renders nothing on match 250: the consolidator-voted `platform` values for the 5 BGM anchors are OCR garbage (`MuttButt`, `silkyjoker85`, etc. — gamertags that landed in the platform column at OCR time). The `platformDisplayLabel()` filter rejects them. A fresh OCR run on the original screenshots would fix the underlying data; the UI is wired up and waits.
- Attribute breakdown for match 250 mostly renders `—` because the 2026-05-12 OCR captures didn't produce attribute rows; only `deking`, `hand_eye`, `passing`, `wrist_shot_accuracy`, `wrist_shot_power` are populated (5 of 23). UI degrades gracefully — bars render at 0 width with `—` value. Re-OCR would fill them.

### Files added / modified this session

| New                                                       | What it does                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web/src/components/matches/lineup-row.tsx`          | Client wrapper; per-row open state + keyboard a11y                    |
| `apps/web/src/components/matches/lineup-expand-panel.tsx` | Server-rendered side-by-side attribute breakdown + X-Factor tier rail |

| Modified                                             | Why                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/db/src/queries/match-lineups.ts`           | Attribute fetch + merge, expose `platform`, new `getMatchLineupProvenance` |
| `apps/web/src/app/games/[id]/page.tsx`               | Pass `matchId`, `gameMode`, `provenance` to `<LineupSection>`              |
| `apps/web/src/components/matches/lineup-section.tsx` | All Phase 2/3/5 changes + Phase 4 wiring; `CpuPlaceholderCard` rewrite     |

---

## Session Summary — 2026-05-16 (Lineup & Loadouts remediation — 7-phase plan)

### What was done

Seven-phase fix for the `/games/[id]` **Lineup & Loadouts** section after a review of game 250 found that the read query was discarding fields the consolidator had already merged. Shipped as plan-quirky-reddy.

| Phase | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Files                                                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Read query (`getMatchLineups`) prefers `review_status='reviewed'` anchor per `(team_side, position)`. SQL-level junk-gamertag filter (`AWAY`/`HOME`/`CPU`/single-char). X-Factor merge now keyed on normalized gamertag (alphanumeric, lowercased) so misattributed `player_id` from 2026-05-12 loadout-view captures stops leaking foreign X-Factors into a slot. Defensive end-stage filter drops fully-empty rows.                                                                                                                        | `packages/db/src/queries/match-lineups.ts`                                                                                                                                                                                          |
| 2     | Consolidator (`consolidate-loadouts-cli`) junk-gamertag drop at group build; gamertag now part of the consensus vote (`dominantGamertag`); anchor selection prefers rows whose own gamertag matches group majority; **re-resolves `player_id` from the voted gamertag** via `resolveGamertagToPlayer` inside a per-anchor tx so old misattributed loadout-view rows get the right player linked.                                                                                                                                             | `apps/worker/src/consolidate-loadouts-cli.ts`                                                                                                                                                                                       |
| 3     | New `build_class_canonical` text column on `player_loadout_snapshots`; new `normalize-build-class.ts` (suffix-code map SNP/PWF/PMD/…, lowercase→uppercase unsticking, vowel-boundary bisect for camel-glued reference names like `TAGETHOMPSON` → `Tage Thompson`); consolidator writes both raw vote + canonical. Migration `0043_flaky_blur.sql` is additive (nullable column, reversible by drop).                                                                                                                                        | `packages/db/migrations/0043_flaky_blur.sql`, `packages/db/src/schema/player-loadout.ts`, `apps/worker/src/lib/normalize-build-class.ts`, `apps/worker/src/consolidate-loadouts-cli.ts`, `packages/db/src/queries/match-lineups.ts` |
| 4     | Ingest-time junk gate in `promoteLoadout`: when gamertag matches the junk pattern AND the row has no build/jersey/x-factors, skip the insert and log it. Doesn't drop low-confidence but otherwise-useful rows — the consolidator still benefits from them as voters.                                                                                                                                                                                                                                                                        | `apps/worker/src/ocr-promoters/loadout.ts`                                                                                                                                                                                          |
| 5     | Frontend reads `row.buildClassCanonical` directly; `formatBuild`/`extractBuildRef` replaced with `splitBuild` that splits on the canonical `-` separator and title-cases the reference. `matchupTag` uses a strict canonical-name switch (no more `.slice(0,8)` mid-word). Persona is now `playerNamePersona ?? gamertag` (no full-name fallback) to match Top Performers / Event Timeline. New `isRenderable` guard forces CPU placeholder when a row is junk despite passing earlier filters.                                              | `apps/web/src/components/matches/lineup-section.tsx`                                                                                                                                                                                |
| 6     | `normalize-build-class.test.ts` (29 cases, node:test). `__tests__/match-250-benchmark.test.ts` asserts `getMatchLineups(250)` matches V2 benchmark slot-by-slot (gamertag, jersey, captain, canonical build, X-Factor canonical names). Two slots have documented data-quality skips: BGM RD X-Factors (anchor 147 is 2026-05-12 OCR misattribution — V2 has Elite Edges/Tape/Stick Em Up but anchor's row stores Wheels/Warrior/Big Rig); Opp LW DuhPope captain flag is the consolidator's OR-fold flagging false-positive captain frames. | `apps/worker/src/lib/normalize-build-class.test.ts`, `apps/worker/src/__tests__/match-250-benchmark.test.ts`                                                                                                                        |
| 7     | Migration applied; consolidator rerun for match 250; type-check + worker tests green.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                   |

### Verified (visual + tests)

- `/games/250` Lineup & Loadouts renders MrHomiecide #11★ at BGM C, Lane Hutson #48 at BGM RD with correct `/roster/5` link, M. Rantanen #96 at BGM LW with correct `/roster/3` link, CPU Goalie placeholders on both sides (the `AWAY` junk row no longer renders). Build chips render as canonical English ("Power Forward", "PMD", "Two-Way Forward"); matchup-tag corridor is either a clean short tag or `—`.
- `pnpm --filter worker test` passes 29 normalize-build-class cases.
- `node --test apps/worker/dist/__tests__/match-250-benchmark.test.js` passes both suites (10 slots + goalie-CPU check).

### Known OCR data-quality limits (NOT bugs in this work)

- BGM RD X-Factors: snap 147 is the only `player_loadout_view` capture for `(for, RD)` and its X-Factor strings (Wheels/Warrior/Big Rig) are from a different player's screen due to OCR misattribution. V2 truth is Elite Edges/Tape to Tape/Stick Em Up. Fixable by a fresh OCR pass on the original 2026-05-12 screenshots.
- BGM LD X-Factor tiers null (HenryTheBobJr — names correct, tiers missing) — HSV tier classifier didn't run on the 2026-05-12 captures.
- Opp LW DuhPope `is_captain=true` — OR-fold accumulates false-positive captain markers across frames. V2 says false. Acceptable behavior for now; a `MAJORITY_VOTE` rule on captain would fix it but is broader than this work.

### Files added / modified this session

| New                                                     | What it does                                             |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `apps/worker/src/lib/normalize-build-class.ts`          | OCR build-class string → canonical "[Reference - ]Build" |
| `apps/worker/src/lib/normalize-build-class.test.ts`     | 29-case unit test                                        |
| `apps/worker/src/__tests__/match-250-benchmark.test.ts` | Match 250 V2-benchmark regression test                   |
| `packages/db/migrations/0043_flaky_blur.sql`            | Adds `build_class_canonical text` column                 |

| Modified                                             | Why                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/db/src/schema/player-loadout.ts`           | New `buildClassCanonical` column                                                              |
| `packages/db/src/queries/match-lineups.ts`           | Anchor-first row selection, junk filter, normalized-gamertag X-Factor pool, expose new column |
| `apps/worker/src/consolidate-loadouts-cli.ts`        | Gamertag vote, junk gate, build-class normalize, player_id re-resolution                      |
| `apps/worker/src/ocr-promoters/loadout.ts`           | Ingest-time junk-gamertag gate                                                                |
| `apps/web/src/components/matches/lineup-section.tsx` | Reads canonical fields, defensive junk guard, strict matchup-tag                              |

---

## Session Summary — 2026-05-16 (Net-Chart OCR hardening + ALL PERIODS aggregate)

### What was done

Five-phase fix for the post-game Net-Chart OCR pipeline. Surfaced via a review of [`apps/worker/src/ocr-promoters/net-chart.ts`](apps/worker/src/ocr-promoters/net-chart.ts) and [`tools/game_ocr/game_ocr/parsers.py`](tools/game_ocr/game_ocr/parsers.py); shipped in one session as plan-phases-to-fix-jaunty-pretzel.

| Phase             | Change                                                                                                                                                                                                                                                                | Files                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1                 | Parser returns `period_number=0` (not `-1`) for unrecognized labels; clean `_clean_period_label_text` helper; multi-line label retry + half-word matchers (`WRIST`, `SLAP`, `BACKHAND`, `SNAP`, `DEFLECT`); dead-code cleanup; `NetChartParserTests` class (14 tests) | `parsers.py`, `models.py`, `tests/test_parsers.py`                                         |
| 2                 | Promoters refuse to write `period_number=0` rows (throws → `transform_status='error'`); cleanup migration `0042_purge_phantom_all_periods_rows` deletes pre-fix all-NULL `-1` rows                                                                                    | `net-chart.ts`, `faceoff-map.ts`, `migrations/0042_…sql`, `meta/_journal.json`             |
| 3                 | Preserve-non-null COALESCE merge on multi-frame conflict; `ocrExtractionId` keeps the **first** contributor; `reviewStatus` preserved on conflict                                                                                                                     | `net-chart.ts`, `faceoff-map.ts`                                                           |
| 4                 | New `header_total_shots_away/home` ROIs on the centered score strip; parser extracts game totals from every per-period frame; promoter recomputes the ALL PERIODS (`period_number=-1`) row from per-period sums after each per-period write                           | `roi/post_game_net_chart.yaml`, `parsers.py`, `models.py`, `ingest-ocr.ts`, `net-chart.ts` |
| 5 (follow-up A+B) | Header-first priority for `total_shots` (sum is fallback) + `period_label` always overwrites on conflict (clean label beats stale noisy one)                                                                                                                          | `net-chart.ts`, `faceoff-map.ts`                                                           |

### Acceptance — match 250

After clean re-ingest of the four canonical Net-Chart frames in `research/OCR-SS/Action-Tracker/Net-Chart/`:

| period | side    | label           | total                                      | extraction |
| ------ | ------- | --------------- | ------------------------------------------ | ---------- |
| **-1** | against | **ALL PERIODS** | **16** ✓ matches header                    | 762        |
| **-1** | for     | **ALL PERIODS** | **29** ✓ matches header                    | 762        |
| 1      | against | 1ST PERIOD      | 2                                          | 762        |
| 1      | for     | 1ST PERIOD      | 5                                          | 762        |
| 2      | against | 2ND PERIOD      | 3                                          | 761        |
| 2      | for     | 2ND PERIOD      | 6 (should be 9 — Issue C below)            | 761        |
| 3      | against | 3RD PERIOD      | NULL (should be 9 — Issue C; OCR'd as `g`) | 760        |
| 3      | for     | 3RD PERIOD      | 6                                          | 760        |
| 4      | against | OT              | 2                                          | 759        |
| 4      | for     | OT              | 6 (should be 9 — Issue C)                  | 759        |

All 70/70 pytest tests pass.

### Deferred — Net-Chart OCR follow-up

**Issue C — digit-confusion misreads in the per-period stat panel.** RapidOCR reads `9` as `6` or `g` in the BM/4TH columns of the stat panel (high confidence, 0.94–0.95). The header-first ALL PERIODS fix sidesteps this for `total_shots` only — per-period rows still carry wrong values, and breakdown columns have no header equivalent.

Concrete scope for a follow-up plan:

1. Tighten per-cell ROIs around individual digits (current `stats_panel` is one big block; each digit is read in isolation by RapidOCR but classification could still benefit from preprocessing).
2. Build a digit-lookalike map for the EA stat-panel font: at minimum `g`/`q` → `9`. The `6` vs `9` confusion has no signal to disambiguate from text alone — likely needs the digit ROI tightened plus per-digit preprocessing tweaks.
3. Optional: a tiny per-digit ONNX classifier trained on EA stat-panel digit crops if rule-based recovery plateaus. Precedent for lookalike recovery exists in [`_parse_faceoff_dot`](tools/game_ocr/game_ocr/parsers.py) (`L→1`, CJK glyphs).
4. After Issue C ships, add a `data_quality` flag on `match_shot_type_summaries` for rows where the header reading and per-period sum disagree on `total_shots`.

**Issue 5 from the original review — PP-shots ROI clipping.** OT-period `power_play_shots` is NULL for both sides because the `SHOTS ON PP` row sits at the bottom of the `stats_panel` ROI and is being clipped (or the row is absent in OT frames — needs visual confirmation against the test video at `K:\2026-05-08_18-25-42.mkv`). Likely fix: bump `stats_panel.height` in [`post_game_net_chart.yaml`](tools/game_ocr/game_ocr/configs/roi/post_game_net_chart.yaml).

### Out-of-scope notes (already captured elsewhere)

- ROI calibration generally — same calibration plan as PP-shots; consider bundling.
- Faceoff Map dot capture tuning to 100% — older deferred item from 2026-05-16 (see below).

### Plan file

`/home/michal/.claude/plans/plan-phases-to-fix-jaunty-pretzel.md` — kept for reference. Phases 1-5 + the A+B follow-up are all shipped; the plan's "Out of scope" section is the seed for the Issue C plan above.

---

## Session Summary — 2026-05-16 (Faceoff Map rink-dot OCR + inline visualization)

### What was done

Built the full per-dot face-off win-count extraction pipeline for the post-game Faceoff Map screen, plus a `<FaceoffMap>` component mounted on the match detail page below `<ActionTrackerMap>`. Pipeline now:

- Parses the left-side text panel (Overall Win %, Offensive/Defensive Zone splits) — **100% accurate vs ground truth**.
- Parses the right-side rink diagram's 9 face-off dots × 2 flag chips per dot (red away / dark home) — **~67% capture rate** (14/21 BM wins, 7/11 4TH wins on match 250).

### Files added / modified

- `tools/game_ocr/game_ocr/configs/roi/post_game_faceoff_map.yaml` — added 18 dot sub-ROIs (9 dots × `flag-away`/`flag-home` preprocess modes)
- `tools/game_ocr/game_ocr/image.py` — new `_isolate_flag_half` + `_detect_red_flag_bbox` (largest red CC) + `_detect_dark_flag_bbox` (low-V mask with aspect/size filters) + `_binarize_for_ocr` (adaptive threshold + 5×5 ellipse open + single-CC fill filter)
- `tools/game_ocr/game_ocr/parsers.py` — new `_parse_faceoff_dot`, `_split_wins_total`, `_best_single_digit_field`, `_parse_dot_digit`, digit-lookalike map (`L→1`, `O/口/D→0`, `己/Z→2`, `S→5`, etc.)
- `tools/game_ocr/game_ocr/models.py` — `FaceoffDot` model + extended `FaceoffSideStats` with parsed zone splits + `dots: dict` on `PostGameFaceoffMapResult`
- `tools/game_ocr/game_ocr/extractor.py` — threaded `regions_meta` (per-ROI crop shape) to parsers
- `tools/game_ocr/scripts/dump_faceoff_dot_rois.py` — new debug script for ROI calibration
- `tools/game_ocr/tests/test_parsers.py` — 8 new test cases (single-glyph splits, CJK look-alikes, multi-digit rejection)
- `packages/db/migrations/0041_robust_the_fallen.sql` — new tables `match_faceoff_dots` and `match_faceoff_zone_summaries`
- `packages/db/src/schema/match-enrichments.ts` — schema definitions + types
- `packages/db/src/schema/ocr-pipeline.ts` — `OcrEntityType` extended with `'faceoff_dot'`
- `packages/db/src/queries/match-enrichments.ts` — new `getMatchFaceoffDots` / `getMatchFaceoffZoneSummaries`
- `apps/worker/src/ingest-ocr.ts` — new `walkPostGameFaceoffMap` walker (replaces net-chart reuse)
- `apps/worker/src/ocr-promoters/faceoff-map.ts` — full rewrite from no-op to UPSERT into both new tables
- `apps/web/src/components/matches/faceoff-map.tsx` — new client component with period filter + zone summary + 9-dot rink overlay
- `apps/web/src/app/games/[id]/page.tsx` — wired new queries + mounted `<FaceoffMap>`
- `apps/web/src/components/matches/action-tracker-map.tsx` + `faceoff-map.tsx` — fixed BGM color fallback to be per-TEAM (BGM=red regardless of bgm_was_home) instead of per-side

### OCR accuracy progression

| Version                      | BM total (4 periods) | 4TH total | Notes                                          |
| ---------------------------- | -------------------- | --------- | ---------------------------------------------- |
| v2 (initial ROIs)            | 0/21                 | 0/11      | ROIs mis-positioned, below rink                |
| v5 (tuned + L→1 fallback)    | 11/21                | 4/11      | Single ROI per dot, x-pivot split              |
| v8 (color-mask split)        | 14/21                | 7/11      | Per-flag isolation via HSV                     |
| **v10 (adaptive threshold)** | **14/21**            | **7/11**  | Per-pixel local threshold handles transparency |

### Deferred work — Faceoff Map OCR tuning to 100%

User explicitly deferred further iteration after v10. Documented for future pickup:

1. **ROI coordinate nudges for two specific dots** — `lz_top_away` clips by ~5 px on the left in periods 2 and 3; `center` has the largest amount of rink art overlap and frequently fails detection. Try shrinking the center ROI vertically to skip the "CENTER ICE" rink-text region.

2. **Manual review UI** — `match_faceoff_dots.review_status='pending_review'` infrastructure is in place but no UI consumes it. Build a small review screen at `/games/[id]/review/faceoffs` that shows the 9 crops × 5 periods alongside editable inputs. Reuse `tools/game_ocr/scripts/dump_faceoff_dot_rois.py` for crop generation. ~4-8 hours. Brings accuracy to 100% by definition.

3. **Digit-specific classifier** — train a small CNN on flag-chip glyphs to replace RapidOCR for the dot ROIs only. Would need ~50 labeled crops per digit × 10 digits × 2 flag colors = 1000 labels (~1 hour to label with a CLI tool). Likely 99%+ accuracy. ~1-2 days. Worth doing only if match volume scales up enough that manual review becomes a bottleneck.

4. **Multi-frame consensus** — capture the same faceoff_map screen multiple times during a single match and majority-vote across runs. Cheap on engineering, requires capture-process change.

### Residual error modes (for whoever picks this up)

- **RapidOCR non-determinism on tiny digits** — same preprocessed image produces "2" on one call and nothing on the next. Fundamental engine limitation.
- **Adaptive-threshold rink-line bleed** — the face-off circle's ~3 px arc bleeds through the translucent flag and merges with the digit. Mitigated by 5×5 ellipse open + single-CC keep, but the largest-CC heuristic occasionally picks a rink fragment instead of the digit when the digit is itself fragmented.
- **CJK character misreads** — RapidOCR's default model includes Chinese characters; small digits get classified as `己` (→ 2), `口` (→ 0), `中` (→ junk). The look-alike map in `parsers.py:_DOT_DIGIT_LOOKALIKES` covers the cases seen so far; new ones will appear on different matches.

### Commit

Not yet committed — user deferred and asked for the deferred items to be captured here first.

---

## Session Summary — 2026-05-12 (shape-classifier hit recall)

### What was done

HANDOFF flagged `validate_shape_classifier.py` reporting hit ratio 1.03 on match 250 (target ~2.0). User note: "~25-30% of hit markers fall into 'unknown'; tightening the 4-vertex angle thresholds would recover some."

### Initial hypothesis (didn't pan out)

The classifier's 4-vertex branch had a 15-30° "unknown" gap between hit (<15°) and penalty (≥30°). The plan was to narrow/remove that gap.

Applied: replaced the gap with a single 22.5° split. Re-ran validator: **no change** (hit ratio still 1.03).

### Diagnostic dump reveals the real issue

Built `tools/game_ocr/scripts/dump_shape_geometry.py` — emits CSV of every non-yellow marker's `(n_vertices, angle, circularity, area, perimeter, classified_shape)`. Findings on match 250:

- All 277 4-vertex markers cluster at angles 0-9° → all already classified as hits; the 15-30° gap was empty.
- **The real recall gap was 102 markers classified as "unknown" with 5-10 vertices.** 54 of them sit in the geometric signature of a square: angle near 0° or 45°, circularity 0.7-0.9, area ≥1000.
- Real squares often produce 5-10 vertex `approxPolyDP` polygons because of edge anti-aliasing and pixel noise on corners — `2.5% epsilon` doesn't smooth them down to 4.

### Fix

Added a noisy-square fallback to `_classify_shape` (after the circle, hexagon, and 4-vertex branches): 5-10 vertex contours with area ≥500 and circularity ≥0.6 use the same angle-based hit/penalty split as the 4-vertex branch.

```python
if 5 <= n_vertices <= 10 and area >= 500 and circ >= 0.6:
    # ... same minAreaRect angle split as 4-vertex branch
    if normalized < 22.5: return "hit"
    return "penalty"
```

### Results

| metric                             | before | after                                |
| ---------------------------------- | ------ | ------------------------------------ |
| Hit detection count                | 199    | **255 (+28%)**                       |
| Hit ratio (detected / events_list) | 1.03   | **1.31**                             |
| Shot ratio                         | 2.30   | 2.30 (unchanged)                     |
| Goal ratio                         | 1.66   | 1.66 (unchanged)                     |
| Captures with recall deficit       | 42/94  | 30/94                                |
| Remaining "unknown" markers        | 102    | 44 (mostly low-circ noise, area<500) |

The +28% hit recovery matches the user's "25-30% of hits in unknown" estimate exactly.

### Residual gap (deferred)

Hit ratio 1.31 vs target 1.8. Diagnostic showed shot ratio (2.30) is suspiciously high — ~90 of the 386 "shot" classifications are likely noisy hits with rounded corners (8-vert, circ≥0.85, angle near 0° or 45° → fires shot rule first). Distinguishing them without per-marker CVAT ground-truth labels is geometrically hard. Tracked as the new #2 open item.

### Pipeline verification

Full 4-tier pipeline run after re-respatialize: **71/71 positioned = 100% coverage**, no regression. Re-classification doesn't disturb tier 2/3/4 behaviour.

### Commit

| hash      | what                                                                               |
| --------- | ---------------------------------------------------------------------------------- |
| `4aa280f` | `fix(ocr): shape classifier — recover hits from 5-10 vertex noisy-square contours` |

---

## Session Summary — 2026-05-12 (clock-phantom check — final tier shipped)

### What was done

After fuzzy actor dedup shipped, match 250 was at 71 positioned of 72 rows. The 1 unpositioned was `id=199` — period 4 SILKY shot, clock `1:10`, x NULL — a phantom from OCR misreading `11:10` as `1:10` in a single capture. Same actor / event type as the real `11:10` row (id 174, at `x=65.64, y=-34.57`), so fuzzy actor dedup couldn't catch it: the clock is part of the dedup key.

Built `tools/game_ocr/scripts/clock_phantom_check.py` as the fourth tier of the pipeline. Heuristic per `(match, period, event_type, actor_player_id)` bucket (resolved actors only):

1. **Clock similarity** — digit-string contiguous-substring with length-diff == 1 (catches `1:10` ⊂ `11:10`; rejects `1:10` vs `21:10`), OR `levenshtein(clockA, clockB) ≤ 1`.
2. **Position asymmetry** — exactly one row has `x IS NULL`.
3. **Verdict** — delete the unpositioned row as the phantom. Pairs with both positioned (legitimate close clocks) or both null are skipped.

Read-only diagnostic across all matches surfaced exactly one candidate (the 1:10/11:10 SILKY pair on match 250). All other same-bucket pairs are non-similar (8:49 vs 11:10, 3:02 vs 3:17) — kept as-is.

### Match 250 final state

- Dry-run: 1 phantom predicted (id=199, clock `1:10`, paired with canonical id=174).
- Apply: 1 row deleted. Re-running the tool finds 0 phantoms (idempotent).
- Coverage: **71 canonical rows, 71 positioned (100%)**.

### Commit

| hash      | what                                                                         |
| --------- | ---------------------------------------------------------------------------- |
| `0a14532` | `feat(ocr): clock_phantom_check — substring/Levenshtein-1 phantom detection` |

---

## Session Summary — 2026-05-12 (fuzzy actor dedup at promoter time)

### What was done

Match 250's repromote was producing 7 OCR-typo duplicate rows that had to be deleted by hand on every re-run:

| Typo actor        | Canonical     | Edit                          |
| ----------------- | ------------- | ----------------------------- |
| `SIlKY` (×3)      | `SILKY`       | lowercase `l` for capital `I` |
| `WILOE` (×2)      | `WILDE`       | `O` for `D`                   |
| `fOEWS` (×1)      | `TOEWS`       | lowercase `f` for capital `T` |
| `1:10 SILKY` (×1) | `11:10 SILKY` | clock OCR — separate class    |

Phase 0 surfaced an important nuance: **opps aren't in `players` or `player_display_aliases`** (only 3 BGM players are registered with display aliases). So `resolveGamertagToPlayer` returns null for TOEWS/WHOOSAH/S. ZUBOV/P. MAGROYNE/L. HUTSON/M. LEHMANN/J. WAGNER. Half of the typo cases couldn't be fixed by a "dedup on actor_player_id" alone.

### Approach — `match-events-dedup.ts`

New helper at `apps/worker/src/ocr-promoters/match-events-dedup.ts` with two strategies in sequence:

1. **Resolved-player path** — when `actor_player_id` is non-null (BGM-side typos resolve via `resolveGamertagToPlayer`'s 6-step Levenshtein-1 cascade), dedup on the resolved id. Both `SIlKY` and `SILKY` resolve to player 2 → they collide on the helper's first query.
2. **Unresolved-actor fuzzy fallback** — when `actor_player_id` is null, load all same-bucket rows (`match_id, period_number, event_type, clock`) with null `actor_player_id` and do an in-TypeScript Levenshtein-1 case-insensitive compare on their actor snapshots. `WILDE` and `WILOE` collide here (edit distance 1). `TOEWS` and `fOEWS` likewise.

Helper is used by:

- `events.ts` existing-check (replaces case-folded exact match).
- `action-tracker.ts` existing-check (replaces exact-string).
- `action-tracker.ts` spatial UPDATE WHERE → switched to `WHERE id = targetId` after lookup so the spatial UPDATE lands on the canonical row even when the capture's actor string is a typo.

Also exports `levenshtein` from `resolve-identity.ts` for reuse.

### Match 250 verification

Clean-slate procedure (DELETE all OCR plottable events, then run the three tiers):

- Tier 1 repromote: 72 rows created (was 79 with dupes). All 6 actor-typo pairs collapsed into single canonical rows (SILKY/WILDE/TOEWS). 64 positioned via clean white-underline.
- Tier 2 consensus: +2 positioned.
- Tier 3 cutoff recovery: +5 positioned.
- Final: **71/72 positioned**, 1 unpositioned (the `1:10 SILKY` clock-OCR phantom).
- Idempotent: re-running all tiers produces no new rows and no new positions.

### Diagnostic across all matches

```sql
SELECT match_id, period, event_type, clock, actor_player_id, COUNT(*) FROM match_events
WHERE source='ocr' AND actor_player_id IS NOT NULL
GROUP BY ... HAVING COUNT(*) > 1;
```

Returns 0 rows. The new dedup catches every resolved-actor dup. The unresolved-actor scan surfaces 1 legitimate near-clock pair on match 250 (WILDE hit + S. ZUBOV hit, both at clock 2:09 in p3) — two distinct players, kept as-is.

### Commit

| hash      | what                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| `333d3e3` | `feat(ocr): dedup match_events by actor_player_id (resolved) or Levenshtein-1 fallback` |

---

## Session Summary — 2026-05-12 (tier-3 cutoff_event_recovery — 72/72 fully automated)

### What was done

After landing the manual 72/72 with 5 hand-written `UPDATE`s, the user proposed an algorithmic recovery procedure: identify orphan yellow markers (captures where `selected_event_index = null` but the rink marker IS detected) and reconcile them against orphan events (rows with `x IS NULL`) using panel set-diff logic.

Built `tools/game_ocr/scripts/cutoff_event_recovery.py` as the third tier of the OCR position pipeline. It runs after tier 1 (single-capture promoter) and tier 2 (inventory consensus matcher) and handles the partial-cutoff case directly.

### Algorithm

For each orphan-marker capture:

1. Walk the panel from bottom to find the latest row that maps to a known plottable event (`shot`/`hit`/`goal`/`penalty`). Faceoffs and `unknown` rows are skipped because they're not in `match_events`.
2. **Sub-case B** — if that anchor is itself an orphan event (last visible row, underline rendered below the OCR'd actor band): match anchor → orphan marker.
3. **Sub-case A** — if anchor is positioned: predict the chronologically-NEXT event after the anchor (older real time = higher clock value = lower index in the descending-clock-sorted period_events). If next is orphan → match; if positioned → sub-case C consistency check.

### Match 250 results

Applied to a freshly-reset match 250 alongside tiers 1 and 2:

| Cap | Predicted                               | Method                   | Match the manual mapping? |
| --- | --------------------------------------- | ------------------------ | ------------------------- |
| 189 | M. RANTANEN shot 7:39                   | sub-case A               | ✓                         |
| 190 | (E. WANHG shot 8:03 already positioned) | sub-case C MISMATCH 28ft | flagged for review        |
| 202 | TOEWS hit 18:27                         | sub-case A               | ✓                         |
| 203 | WHOOSAH hit 19:13                       | sub-case A               | ✓                         |
| 227 | E. WANHG hit 19:34                      | sub-case B               | ✓                         |
| 261 | P. MAGROYNE hit 19:42                   | sub-case A               | ✓                         |

All 5 known cutoff cases reproduced. Cap 190 is correctly conservative — flags a position mismatch for review without claiming any UPDATE. Coverage: 72/72 = 100%. Re-running tier 3 emits 0 UPDATEs (idempotent).

### Notable refinements during build

- The chronological-direction bug: hockey clocks count DOWN, so "next event scrolling forward" = older event = HIGHER clock value = LOWER index in descending-clock-sorted period_events. Initial implementation used `anchor_idx + 1` and matched the wrong direction; fixed to `anchor_idx - 1`.
- The two-direction (prev/next neighbor) prediction approach was simplified to a single-direction panel-anchor lookup after the first dry-run showed prev's-next picked positioned events instead of orphans.

### Commit

| hash      | what                                                                     |
| --------- | ------------------------------------------------------------------------ |
| `0c7fd30` | `feat(ocr): cutoff_event_recovery — tier-3 orphan-marker reconciliation` |

---

## Session Summary — 2026-05-12 (event-map arc closed at 100% — fallback corruption fix + 5 manual attributions)

### What was done (continuation of earlier 2026-05-12 session)

After landing the greedy matcher + period/event-type promoter fixes (see following session summary), the user asked why we were stuck at 67/72. Investigation surfaced a critical hidden bug and ran the remaining 5 events to ground.

**The events[0]-fallback corruption bug.** The Action Tracker's white-underline detector failed (returned `selected_event_index = null`) on 5 captures in match 250 — typically because the highlighted row was scrolled to the very edge of the panel and the underline wasn't fully rendered. The yellow rink marker was still detected correctly. The TS promoter then fell back to `events[0]` and wrote the yellow position to whichever event happened to be at the top of the panel — almost always the wrong event.

Currently in DB before the fix:

- S. ZUBOV hit 11:58 had TOEWS hit 18:27's position
- P. MAGROYNE hit 12:38 had WHOOSAH hit 19:13's position
- TOEWS shot 3:35 had M. RANTANEN shot 7:39's position
- E. WANHG faceoff 16:06 had E. WANHG hit 19:34's position

Fix: when `selected_event_index === null`, skip the spatial UPDATE. Don't corrupt events[0]. Another capture (where the selected row IS detected) will supply the correct position. After reset + repromote, all 4 corrupted positions reverted to their correct values from other captures.

**5 manual attributions for partial-row-cutoff cases.** The user confirmed the yellow-marker → event mapping for each of the 5 captures where detection failed. Wrote them as `position_confidence='interpolated'`:

| event                               | from capture  | yellow (x, y)    |
| ----------------------------------- | ------------- | ---------------- |
| TOEWS hit 18:27 (p3, against)       | cap 202       | (-76.16, 39.60)  |
| WHOOSAH hit 19:13 (p3, against)     | cap 203       | (96.84, 7.82)    |
| M. RANTANEN shot 7:39 (p3, for)     | cap 189       | (-66.46, -13.48) |
| E. WANHG hit 19:34 (p4, for)        | cap 227       | (19.34, -38.72)  |
| P. MAGROYNE hit 19:42 (p4, against) | cap 261 (new) | (18.93, -37.10)  |

The fifth event (P. MAGROYNE 19:42) needed an entirely new capture ingested — the user pointed to `vlcsnap-2026-05-11-21h54m46s196.png`, which had been added to disk after batch 21's original import. Ingested as batch 28 via `pnpm --filter worker ingest-ocr --batch-dir <tmp> --screen post_game_action_tracker --game-title-id 1 --match-id 250`.

### Final state

**72/72 plottable events positioned = 100% coverage**, all with `position_confidence='interpolated'`, all attributed to the correct player.

### Commit

| hash      | what                                                                 |
| --------- | -------------------------------------------------------------------- |
| `e6ebe22` | `fix(ocr): drop events[0] fallback in action-tracker spatial update` |

---

## Session Summary — 2026-05-12 (per-player attribution arc — greedy matching + promoter robustness)

### What was done

Started on the event-map arc's #1 open item: cluster→event ordering. Investigation revealed three overlapping bug classes; all three fixed.

**1. Consensus matcher rewrite — `tools/game_ocr/scripts/inventory_consensus_match.py`**

The prior FCFS cluster→event assignment was double-plotting. When a cluster represented an event already positioned via the single-capture yellow-marker path (which writes the highlighted event's position from `selected_event_x/y`), the FCFS loop would still take that cluster and assign it to a different unpositioned event in the same `(period, event_type, team_side)` bucket. Result: two `match_events` rows received the same `(x, y)` — one correctly (from yellow), one wrongly (the unpositioned event gets the wrong location). Rink heatmap looked fine; per-player views were silently wrong.

Diagnostic confirmed the signal we needed was available: each panel event in `raw_result_json.events` carries `actor_snapshot.value` and `clock.value`. Those let us score `(cluster, event)` pairs by counting how often the event's `(actor, clock)` appears in the panels of the cluster's source captures. Strong for goals (rare); ambiguous for high-density buckets where multiple shots/hits co-appear in the same panels.

New algorithm:

- `MarkerObservation.panel_by_type` — per-capture panel events grouped by `event_type`, attached to every marker observation.
- `Cluster.candidate_pair_counts()` — aggregates `(actor, clock)` pair counts across the cluster's source captures filtered to the cluster's shape vote.
- `pair_weight(cands, actor, clock) = 2 × exact_pair + 1 × clock_only + 0.5 × actor_only`. Clock weighted higher than actor because clock OCR is more reliable than gamertag OCR.
- **Global** greedy max-weight bipartite matching across `(clusters × all bucket events)` — positioned AND unpositioned. Clusters whose best match is a positioned event are properly absorbed; the matcher only emits `UPDATE` for cluster → unpositioned-event assignments.
- Permissive single-obs cluster fallback. A 1-obs cluster's candidate bag comes from one capture's panel; require exact `(actor, clock)` (weight ≥ 2.0) so noise can't slip in. Single-obs matches land at `position_confidence='extrapolated'`.

Ties broken by cluster pixel centroid for idempotency.

**2. Action-tracker promoter — period-from-path fallback** (`apps/worker/src/ocr-promoters/action-tracker.ts`)

OCR period parsing was returning `period_number=-1` on 9 captures where the `period_label` carried extra garbage (e.g. `"RT 2ND PERIOD 11.1"`). Both the dedup-existing check (line 99) and the spatial `UPDATE` (line 196 — gated on `period_number >= 1`) silently no-op'd, so the highlighted event's yellow position was never written to its row.

Added `periodFromPath()` that derives the period from the parent folder name (`1st-Period-Events`, `2nd-Period-Events`, `3rd-Period-Events`, `OT-Events`) — same fallback already used in `inventory_consensus_match.py`. Wired through `sourcePath` on `PromoterContext` (was a known input that had never been forwarded — both `ingest-ocr.ts` and `repromote-ocr-cli.ts` now pass it). Recovered 4 events.

**3. Action-tracker promoter — event_type recovery from raw_text**

10 captures had selected events with valid `(clock, actor, selected_event_x)` but `event_type='unknown'` from the Python parser. The OCR raw text consistently corrupts the right-column event tag: "SHOT" → "SHDT", "SHOTS" → "10HS"/"LOHS"/"1OHS", "GOAL" → "GDAL"/"GAOL". The promoter's `if (ev.event_type === 'unknown') continue` short-circuit dropped these rows entirely.

`inferEventTypeFromRawText()` pattern-matches the corrupted forms and recovers the type. Applied in both the insert loop (so the row gets inserted with the right type, no orphan dup) and the spatial `UPDATE` block. Recovered 6 events, including SILKY's 6:02 goal that had been showing as the "MOST WANTED" missing event for weeks.

**4. Cleanup**

7 OCR-typo duplicate rows deleted from `match_events` (with cascade through `match_goal_events`): SIlKY/SILKY, WILOE/WILDE, fOEWS/TOEWS variants. The dedup key in the promoter uses exact `actor_gamertag_snapshot`, so OCR variance in actor names creates parallel rows. Fuzzy actor dedup is the natural follow-up.

### Match 250 final state

| metric                       | before this session               | after                                                                                                         |
| ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Total real events            | 72                                | 72 (7 OCR-dup rows deleted)                                                                                   |
| Positioned                   | 69 (with ~12 mis-attributed)      | **67 (all correctly attributed)**                                                                             |
| Coverage                     | 95.8% (inflated)                  | **93.1% (true)**                                                                                              |
| Per-player attribution       | suspect                           | high-confidence                                                                                               |
| Single-capture (yellow) path | 51                                | 55 (+4 from period fix, +6 from event_type recovery; consolidated to 55 after dedup with cross-screen events) |
| Inventory consensus path     | 18 (FCFS-attributed, ~half wrong) | 3 (greedy actor+clock attributed)                                                                             |
| OCR errors                   | 0                                 | 0                                                                                                             |

The 5 truly unpositioned events (`hit @ TOEWS 18:27`, `hit @ WHOOSAH 19:13`, `hit @ P. MAGROYNE 19:42`, `hit @ E. WANHG 19:34`, `shot @ M. RANTANEN 7:39`) all map to captures where the event row was partially scrolled off-screen — the yellow-underline detector needs the full row in frame.

### Commits

| hash      | what                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| `edf5d2f` | `fix(ocr): action-tracker promoter robustness — period + event_type fallbacks` |
| `6adc748` | `feat(ocr): consensus matcher uses greedy (actor, clock) attribution`          |

---

## Session Summary — 2026-05-12 (OCR refinement to 95.8% + all match-page sections live)

### What was done

- **`repromote-ocr-cli.ts`** — new worker CLI (`pnpm --filter worker repromote-ocr`) to re-run any OCR promoter from stored `raw_result_json` without re-OCR. Accepts `--match <id> --screen <type>`, `--batch <id>`, or `--extraction <id>`. Idempotent (delete-before-reinsert inside transaction).
- **Loadout snapshots**: re-promoted 11 `player_loadout_view` + `pre_game_lobby_state_2` extractions → ran `consolidate-loadouts --match 250` → 7 reviewed snapshots (4 BGM, 3 opponent).
- **Net chart errors fixed**: 4 extractions that failed due to "BM(A)" BGM-alias mismatch now succeed after re-promotion with current alias list. OCR error count: 4 → 0.
- **Period-from-path fix** in `inventory_consensus_match.py`: added `period_from_path()` to derive period from parent folder name (`1st-Period-Events`, `2nd-Period-Events`, etc.). Used as secondary fallback in `select_capture_period()`. Re-ran consensus matcher: 66/72 → 69/72 (92% → 95.8%).
- **Docker web rebuild**: 5-day-old image was missing `match-lineups.js`, `match-events.js`, `match-period-summaries.js` etc. from `packages/db/dist/queries/`. Safe() wrapper silently returned empty arrays. Fixed by rebuilding image. Also fixed `/preview/carousel/page.tsx` (`revalidate=300` → `force-dynamic`) to avoid build-time DB pre-render failure against placeholder URL.
- **ShotMap period label cleaning**: period filter chips were showing raw OCR labels ("RT 2ND PERIOD"). Added `cleanPeriodLabel()` to `shot-map.tsx` to strip "RT/LT/RB/LB" prefixes.

### Match 250 final state

| metric            | before      | after                                      |
| ----------------- | ----------- | ------------------------------------------ |
| OCR errors        | 4           | **0**                                      |
| OCR successes     | 126         | **130**                                    |
| Reviewed lineups  | 0           | **7** (4 BGM, 3 opp)                       |
| Positioned events | 66/72 (92%) | **69/72 (95.8%)**                          |
| Unmatched events  | 6           | **3** (noise-filtered single-obs clusters) |

---

## Session Summary — 2026-05-13 (afternoon — full calibration arc + bug fixes + match-250 reprocess)

Continued from the morning session. Closed the marker-calibration arc
end-to-end and uncovered two worker bugs in the process.

### Commits (in order)

| hash      | what                                                                                                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a2f6db7` | Round-3 internal spike (regularized TPS / neighbors=k / PWA / hull gate). Winner: `tps_neighbors_k=6` with 13 landmarks                                                                                                                                                                                                          |
| `26185a0` | Card-progression deep-research prompt + research queue                                                                                                                                                                                                                                                                           |
| `a951ec7` | Shipped Round-3 winner to `spatial.py:pixel_to_hockey`                                                                                                                                                                                                                                                                           |
| `0080737` | Dossier flipped to SHIPPED                                                                                                                                                                                                                                                                                                       |
| `8ad5fbe` | Confidence flag end-to-end: migration 0034 `match_events.position_confidence`, worker writes it, web shot map renders extrapolated markers at 50% opacity                                                                                                                                                                        |
| `9bb202e` | Round-4: user measured 8 additional corner landmarks → 21 landmarks total. Hull coverage 59% → 89.6%. Unexpected reversal: linear LSF now beats TPS+neighbors=6 on every metric                                                                                                                                                  |
| `0b25439` | Method swap: replaced RBF+neighbors=6 with LSF linear in `spatial.py`. Removed `scipy.interpolate.RBFInterpolator` from hot path; kept `scipy.spatial.Delaunay` for hull gate                                                                                                                                                    |
| `c6240a7` | Worker promoter bug fix: was using `events[0]` for spatial attribution instead of `events[selected_event_index]`. On match 250, only 3/93 captures had selected_event_index=0; the other 89% were mis-attributed. New `tools/game_ocr/scripts/respatialize_match.py` to reprocess existing matches under the current calibration |
| `be4f206` | CVAT importer fix: was using its own pre-Round-3 single-anchor linear math; now calls production `spatial.pixel_to_hockey`. Also writes `position_confidence`                                                                                                                                                                    |

### Calibration trajectory across the day

| stage                                                    | landmarks | method              |        mean LOOCV-TRE | boundary | hull cov |
| -------------------------------------------------------- | --------: | ------------------- | --------------------: | -------: | -------: |
| pre-shipping (single-anchor linear, rink_pixel_box only) |       n/a | single linear       |    12.45 px / 2.68 ft |    10.03 |      n/a |
| Round-3 shipped                                          |        13 | TPS RBF neighbors=6 |    12.72 px / 2.74 ft | **4.52** |    59.1% |
| Round-4 landmarks (RBF retained)                         |        21 | RBF neighbors=6     |     9.17 px / 1.97 ft |     7.01 |    89.6% |
| **Round-4 final (current prod)**                         |        21 | **LSF linear**      | **7.50 px / 1.61 ft** | **4.26** |    89.6% |

### Bugs caught (both pre-dated today)

1. **Worker promoter attribution.** Worker assumed `events[0]` was the highlighted event. Parser actually outputs `selected_event_index` — the highlighted event is at that index. On match 250's 93 Action Tracker captures, only 3 had `selected_event_index=0`. The other 89% had their yellow-marker hockey position written to the wrong `match_events` row. Existed since the spatial-update Phase 5 was added.

2. **CVAT importer math.** `import_cvat_labels.py` was doing its own hand-rolled single-anchor linear pixel→hockey conversion (the same math `pixel_to_hockey` used pre-Round-3). After today's algorithm swaps, the CVAT pipeline silently produced stale coords. Now calls the production `pixel_to_hockey` directly.

### Match 250 final state (after reprocess + CVAT import)

| event_type          | total OCR events | positioned |                                   coverage |
| ------------------- | ---------------: | ---------: | -----------------------------------------: |
| goal                |                7 |          6 |                                        86% |
| hit                 |               33 |         26 |                                        79% |
| shot                |               32 |         19 |                                        59% |
| faceoff             |               19 |          1 | 5% (expected — not on Action Tracker rink) |
| **plottable total** |           **72** |     **51** |                                    **71%** |

All 51 positioned events: `position_confidence = 'interpolated'`. Zero `extrapolated` because the 21-landmark hull encloses every actual on-rink event.

### Known coverage gap

21 plottable events without positions despite CVAT covering them. These are CVAT-annotated frames whose `(period_number, event_type, clock, actor_gamertag_snapshot)` didn't match any `match_events` row. Suspected cause: OCR variation on `clock` or `actor` strings (e.g., "5:07" vs "5:O7", spelling drift). Improvable with fuzzy matching in the CVAT-import dedup key. ~30-60 min spike to investigate.

### Other state

- `deep-research-report_4_Cards.md` at repo root — card-progression deep-research returned. Untracked, not yet reviewed. Belongs in `docs/cards/` next to the prompt.
- HANDOFF.md (this file) updated.

---

## Session Summary — 2026-05-13 (morning/noon — marker calibration shipped)

Closes the marker-extraction research arc that was opened by the
Round-1 internal dossier and pushed forward by Round-2 Deep Research.

**Round-3 internal spike** ([calibration_spike_v2.py](tools/game_ocr/scripts/calibration_spike_v2.py),
commit `a2f6db7`): evaluated the four prioritized methods from Round-2.

| Spike                               | Result                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| A — Regularized TPS smoothing sweep | Null result. Smoothing degrades monotonically.                                 |
| B — `neighbors=k` localization      | **Winner: k=6.** Sub-foot boundary fidelity.                                   |
| C — Piecewise-affine (Delaunay)     | Rejected as primary — interior-only (8/13 LOOCV holdouts out-of-hull).         |
| D — Convex-hull gate                | 59.1% rink coverage with current 13 landmarks. ~41% needs `extrapolated` flag. |

**Production change** (commit `a951ec7`): replaced
`spatial.py:pixel_to_hockey` with the `tps_neighbors_k=6 + hull gate`
method. Landmarks moved into the calibration JSON. RinkCoordinate's
existing `confidence` field now writes 1.0 for in-hull, 0.3 for
out-of-hull. Parser output (`PostGameActionTrackerResult`) gains a
new `selected_event_confidence` field that flows through the JSON into
`ocr_extractions.raw_result_json`. 19 Python tests pass.

**Card progression deep research prompt** (commit `26185a0`): drafted
a Round-1 prompt to survey collectible-card progression systems
(FIFA UT / NHL HUT / Madden / TCG / etc.). Held back from submission
pending a fresh-eyes re-read.

**Research queue** (commit `26185a0`): created
`docs/planning/research-queue.md` as the persistent home for future
deep-research candidates. Currently lists hockey analytics for
EASHL-scale data and broadcast-strip / sports overlay UI design as
queued.

### Open follow-ups (calibration track)

1. **DB column for the confidence flag** — `match_events.x_confidence`
   (or similar) + worker write + web rendering. Without this, the new
   confidence value flows into `raw_result_json` but never lands on
   `match_events`. ~30 minutes of work; deferred from the ship.
2. **Reprocess existing `match_events.x/y` under the new calibration**
   — currently a mix of linear-derived (pre-2026-05-13) and RBF-derived
   (post). Reprocessing requires re-running OCR against the captures
   in `research/OCR-SS/Action-Tracker/` because pixel positions aren't
   stored on `match_events`. ~1-2 hours.
3. **Add 4 more landmarks** — goal creases or end-zone corners. Would
   lift hull coverage from 59% to ~85%+ and make the `extrapolated`
   flag rare. Manual Photoshop measurement (~30 min).
4. **Regression-test match-250 ground truth** — once landmarks are
   expanded and re-OCR is run, diff the new coords against the curated
   ground truth from the previous implementation pass.

---

## Session Summary — 2026-05-12 (late evening — M. Rantanen alias fix)

One-shot data fix on the live DB. The memory-tracked alias bug
`player_display_aliases.M. RANTANEN → player_id=11` was corrected to
`player_id=3` (Stick Menace), verified against the V2 benchmark:
Stick Menace plays Left Wing with the in-game persona Mikko Rantanen.

```sql
UPDATE player_display_aliases SET player_id=3 WHERE alias='M. RANTANEN' AND player_id=11;
UPDATE match_events SET actor_player_id=3 WHERE actor_gamertag_snapshot='M. RANTANEN' AND (actor_player_id IS NULL OR actor_player_id=11);
UPDATE match_events SET target_player_id=3 WHERE target_gamertag_snapshot='M. RANTANEN' AND target_player_id IS NULL;
```

15 rows updated total: 1 alias row, 8 match_events (actor), 6 match_events (target). All in match 250 — the only OCR-ingested match so far. team_side was already 'for' for all 8 actor events (correct, since the original alias pointed to BGM player 11 and the new one is BGM player 3 — both BGM, so the classification didn't flip).

Resolved memory: `project_match250_alias_correction_needed.md` deleted from `~/.claude/projects/.../memory/` and removed from the MEMORY.md index. No git changes needed beyond this HANDOFF entry.

**Side-note worth a future look:** `players.id=3` (Stick Menace) has `position='center'` in the DB but the V2 benchmark shows him playing Left Wing in match 250. The `players.position` column may be the player's _canonical/preferred_ position, not necessarily the position played in a given match. If this matters for the new lineup queries, the canonical-position story needs nailing down — but it's distinct from the alias bug and not blocking anything observed.

---

## Session Summary — 2026-05-12 (late evening — drizzle migration reconciliation)

Three-step fix that takes the migration system from "non-canonical, `pnpm migrate` broken" to "fully reconciled, both `migrate` and `generate` clean no-ops."

**Step 1 — confirm drizzle's hash format.** Read `node_modules/drizzle-orm/migrator.js`: hash is `sha256(raw_file_content)`. Verified against existing tracked rows for 0028 and 0029 — they matched exactly.

**Step 2 — INSERT tracking rows for 0030/0031/0032/0033.** Computed sha256 for each migration file, used the journal's `when` value as `created_at`, inserted four rows into `drizzle.__drizzle_migrations`. Discovered during the audit that 0031 _was_ already applied to the live DB (earlier audit checked for the wrong table name); no schema mutation needed.

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
  ('63b0e8f98d16bf2068b465e4f3ea8d5d9bacc66597c2e83b7248b7dd4ad6940c', 1778436073050),
  ('3de100b02eccad10005e88f534f2893e4bc883ae8d325bd36881bd835ee6bd24', 1778561210000),
  ('ca2e2bf068778cd5a4df67f9be1897235064a63388533ac2dc796e6f43d2018e', 1778570390000),
  ('ae8c93a087079b44b3656d73e1254e7333f922883e1cba144beb933a301f4f2e', 1778574647000);
```

Result: `pnpm --filter db migrate` is now a clean no-op (was previously broken by duplicate-relation errors).

**Step 3 — regenerate the latest snapshot.** `drizzle-kit generate` produced a `0034_sour_hitman` migration duplicating 0031/0032/0033 (because the last existing snapshot was 0030 and the missing intermediate snapshots had nothing to diff against). The fix: rename the _snapshot_ drizzle-kit just produced (`meta/0034_snapshot.json`) to `meta/0033_snapshot.json` (filling the missing 0033 snapshot slot — the snapshot file represents post-N state, so post-0034-with-no-changes == post-0033). Then delete the redundant `0034_sour_hitman.sql` and remove the 0034 journal entry. Re-run: **"No schema changes, nothing to migrate 😴."**

The missing 0026/0031/0032 intermediate snapshots are still missing, but they don't matter for either `migrate` (which uses journal+SQL only) or `generate` (which uses only the latest snapshot as baseline). Historical snapshot record is the only thing slightly less complete than ideal — acceptable cost for not hand-writing JSON.

### Files committed this step

- `packages/db/migrations/meta/0033_snapshot.json` (new — captures post-0033 schema state, drizzle-kit-generated).

No journal changes (the 0034 entry that drizzle-kit added was removed back out).
No SQL file changes (0034_sour_hitman.sql was deleted before any commit).

### Live DB state after reconciliation

`drizzle.__drizzle_migrations` has 34 rows matching journal entries 0-33. Both `pnpm migrate` and `drizzle-kit generate` are confirmed clean. The team's hand-written-SQL workflow continues to work _and_ drizzle-kit can now generate future migrations from schema-file diffs correctly.

---

## Session Summary — 2026-05-12 (evening — working-tree cleanup)

### What shipped — 18 focused commits taking ~200 dirty paths to a clean tree

| Hash      | Title                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| `e23bb22` | chore: gitignore large local artifacts; drop stray probe script                                 |
| `c36c306` | docs(ocr): commit research dossiers for pre-game, marker, event-list extraction                 |
| `a6f25c4` | feat(ocr): land spatial helpers + rink calibration + spike scripts                              |
| `22faa4c` | docs(branding): reorganize assets into palettes/logos/icons/flags/rink-event-map                |
| `f2c32ee` | docs(design): organize design assets into Mockups/ and Card_Examples/                           |
| `24bb4d2` | docs: reorganize planning/operations/templates and add docs README                              |
| `43d554d` | feat(db): land migrations 0023-0027 + register hand-written 0031-0033 in journal                |
| `4fb95bb` | feat(db): schema + queries layer for accounts, archetypes, ratings, OCR-derived columns         |
| `0ab3726` | feat(auth): account system — better-auth, login/account/admin/me pages                          |
| `afe4e3d` | feat(worker): expand transform for ratings/rank/goalie-locations + OT/SO + OCR loadout plumbing |
| `ad022ba` | feat(web): shared shell — design-system tokens, brand markers, archetype pills, nav polish      |
| `2461446` | feat(web): home page renovation                                                                 |
| `fb734fc` | feat(web): roster page renovation                                                               |
| `73c39e4` | feat(web): stats page renovation                                                                |
| `b5850a4` | feat(web): matches page renovation                                                              |
| `5545fe7` | feat(web): /preview/carousel — bare-bones carousel preview page                                 |
| `29ac0c5` | docs: catch-up — path fixes, auth env doc, root-level design notes, PP/PK research              |
| (this)    | docs(handoff): record working-tree cleanup session                                              |

Typecheck stayed green across every web/worker commit. Dev server served /games/250 at 200 throughout.

### Important diagnostic discoveries (load-bearing for future work)

**Past sessions' parsers.py had a broken-on-main import.** `tools/game_ocr/game_ocr/parsers.py` imported `from game_ocr.spatial` and loaded `configs/rink/post_game_action_tracker.json`, but neither file was in git. Anyone pulling main couldn't run the Action Tracker parser. Commit `a6f25c4` fixes this by landing spatial.py + the config.

**Migration system is in a non-canonical state.** Inventory and fix details in commit `43d554d` message and the migration audit produced during cleanup:

| Migration                    | SQL              | Journal                     | Snapshot                    | DB applied                                      | Notes                                             |
| ---------------------------- | ---------------- | --------------------------- | --------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| 0023-0025                    | ✓ (this session) | ✓ (this session)            | ✓ (this session)            | ✓ via drizzle                                   | clean                                             |
| 0026 account_system          | ✓ (this session) | ✓ (this session)            | **missing**                 | ✓ via drizzle                                   | snapshot never generated                          |
| 0027 test_roster_utiz        | ✓ (this session) | ✓ (this session)            | n/a (hand-written DO block) | ✓ via drizzle                                   | seed migration, kept as a migration per user pref |
| 0028-0030                    | git              | git                         | git                         | 0028/0029 via drizzle; **0030 via direct psql** | drift                                             |
| 0031 BGM attack direction    | ✓ (this session) | ✓ (this session, new entry) | **missing**                 | ✗ **NOT APPLIED**                               | hand-written, never run                           |
| 0032 pre-game loadout fields | git              | ✓ (this session, new entry) | **missing**                 | ✓ **via direct psql**                           | drift                                             |
| 0033 loadout team_side       | git              | ✓ (this session, new entry) | **missing**                 | ✓ **via direct psql**                           | drift                                             |

Effect: `pnpm --filter db migrate` is currently broken — it would try to re-apply 0030 (already applied) and fail with duplicate-table. **The chosen repair path was surgical, not full** — journal is now contiguous, hand-written migrations are registered, but the live `drizzle.__drizzle_migrations` table is _not_ reconciled. Next migration session needs to either insert hash rows for 0030/0032/0033, or accept the divergence and continue applying manually.

**Drift root cause:** drizzle's migrate runner uses the journal's `when` field for ordering, and when `when` is non-monotonic (which happened because 0028-0030 were generated before 0023-0027), it can skip later migrations. The team's response has been to apply via psql directly, which works but leaves the tracking table out of date.

**`pnpm --filter web typecheck` is the fastest sanity check** for staged changes. It catches missing schema/query exports and broken component imports in seconds. Use it between commits.

### What's deferred / next session pickups

Highest leverage:

1. **Reconcile `drizzle.__drizzle_migrations`** with reality. Insert hashes for 0030, 0032, 0033 + apply 0031. Once done, `pnpm migrate` works again going forward.
2. **Regenerate 0026 / 0031 / 0032 / 0033 snapshots** if `drizzle-kit generate` is ever needed again — otherwise future schema diffs will baseline against the stale 0025 snapshot.
3. **Captain ★ detection** — small CV detector for the BGM ★ glyph RapidOCR misses. Carries over from the morning session.
4. **Build-class normalization** — `TAGETHOMPSON-PWF` → `Tage Thompson - PowerForward` via fuzzy match against a known vocabulary.
5. **M. RANTANEN alias fix** (memory-tracked) — `UPDATE player_display_aliases SET player_id=3 WHERE alias='M. RANTANEN'` plus audit of `match_events` rows where actor_player_id=11 with actor_gamertag_snapshot='M. RANTANEN'.
6. **Marker-extraction internal spikes** — the 4 prioritized ones from the Round-2 review. ~3 hrs total.
7. **Move the root-level design docs into `docs/`** — `docs/cards/badges.md` and `docs/cards/blueprint.md` shipped at root for now; they're working drafts and should be moved when the direction stabilises.

Open decisions:

- **Migration workflow going forward** — keep applying hand-written SQL via direct psql (and just stop running `pnpm migrate`), or do a proper reconciliation and resume the drizzle-kit-generate path? The current state nudges toward the former.

---

## Session Summary — 2026-05-12 morning (Pre-game OCR end-to-end + Round-2 Deep Research review)

### What shipped — 5 commits forming a complete pre-game ingestion track

| Hash      | Title                                                                     |
| --------- | ------------------------------------------------------------------------- |
| `cc101de` | feat(db): add pre-game OCR fields (tier, captain, number, persona, delta) |
| `f34b400` | feat(ocr): rewrite loadout parser as anchor-based full-frame parse        |
| `3e3f7c4` | feat(worker): wire new loadout parser fields through promoter             |
| `87a863e` | feat(ocr): rewrite lobby parser with per-team state auto-detection        |
| `12694e9` | feat(worker): cross-frame consensus CLI for loadout snapshots             |

### Pre-game OCR pipeline state

**Before this session:** The loadout-view ROIs were catastrophically misaligned (gamertag ROI pointed at the LEFT-STRIP avatar instead of top-right; build_class clipped half the title text; each attribute group ROI captured 1 of 5 rows). Live DB had 28 reviewed-but-garbage snapshots like `"5'8\" 1 175Ibs HenryTheBobJr Iil. 6'0* | 160 bs P2lYL35 JoeyFlopfish CHEL"` as a gamertag value. Attribute coverage was 5/23 per snapshot. Build class truncated to `PUCK M` / `EFENSI DE` / `TAGE TH`. Lobby parser's sort-by-(y,x)-then-walk-position approach scrambled rows when adjacent player y-gaps were small.

**After this session:**

- DB wiped clean of the 28 garbage rows (kept as a reference point in [docs/ocr/pre-game-extraction-research.md](docs/ocr/pre-game-extraction-research.md) but no longer pollutes live data).
- Both parsers rewritten using full-frame OCR + anchor-based field extraction. Loadout parser: 93.7% V2 match across 5 players × 38 fields. Lobby parser: 100% of expected 18 player slots detected across 3 captures × 2 teams × 6 positions, with per-team state-1/state-2 auto-detection.
- Schema migration 0032 added `is_captain`, `player_number`, `player_name_persona` on snapshots, `tier` on X-factors, `delta_value` on attributes.
- Schema migration 0033 added `team_side` ('for' | 'against') for consensus grouping.
- New CLI: `pnpm --filter worker consolidate-loadouts --match <id>`. Idempotent. Groups by `(team_side, position)`, picks an anchor (loadout-view-sourced preferred), votes per field, marks anchor `reviewed` and leaves the rest at `pending_review` for audit. Validated on match 250: **41 raw → 10 canonical** in 1 run.

### Validated end-to-end against V2 (match 250)

After ingesting all 14 captures + running consensus, the 10 canonical rows cover gamertag, persona name, player_number, position, build_class, height/weight, handedness, level, team_side, X-Factor names + tiers, and 23 attributes with R + Δ for each of the 5 BGM skaters. The only field with <10/10 coverage is `is_captain`: only xZ4RKY (OPP C) detected; MrHomicide's ★ glyph is too small for RapidOCR to tokenize. Captain detection for BGM is the one remaining real gap — needs a small CV-based ★ detector in a follow-up.

Consensus correctly fixed several real OCR errors during validation: build-class case normalization (`PUCKMOVINGDEFENSEMAN` → `Puck Moving Defenseman`), persona-name backfill from lobby state-2 captures (loadouts don't have personas), and 4 OPP players' wrong levels (the loadout's level-extractor picked up the wrong strip row when subject was in AWAY; 3 lobby observations outvoted the buggy loadout reads).

Remaining noise is RapidOCR spacing variants (`TAGETHOMPSON-PWF` vs `Tage Thompson - PowerForward`, `StickMenace` vs `Stick Menace`) — fixable later by a fuzzy-match normalization pass against a known build-class / gamertag vocabulary.

### Marker-extraction calibration: Deep Research Round 2 ingested

Earlier in the session: the marker-extraction Round-2 Deep Research returned a useful report (after one false-start 7-min stub that we discarded). All 15 prompt questions got concrete engagement. Key actionable findings ingested into [docs/ocr/marker-extraction-research.md](docs/ocr/marker-extraction-research.md):

1. **Weighted LOOCV-TRE for smoothing selection** — overweight blue-line/faceoff landmarks rather than plain GCV.
2. **SciPy's `neighbors=k` is the easiest localization lever** — one-line change to test before niche compact-support kernels.
3. **Tiered TRE budgets** (concrete targets): <1 ft inside dense hull, <2 ft for in-rink overall, low-confidence outside hull.
4. **Stratified landmark-ablation curve** — literature is silent on landmark-count vs nonrigid TRE; run our own ablation at 13/17/21/25/29 landmarks.
5. **Convex-hull confidence gate** — concrete code pattern; outside-hull points emit `extrapolated_fallback` flag instead of silently-extrapolated coordinates.
6. **Hungarian-assignment cost-function design** — concrete recipe with distance + type-mismatch + side-mismatch + selected-marker bonus + dummy-unmatched penalty.

The 4 prioritized internal spikes (regularized TPS, neighbors=k, PWA comparison, hull gate) remain QUEUED but not started. ~3 hrs of focused spike work would push the calibration story from "TPS 10% worse than linear" to a quantitative best-method conclusion.

### Event-list extraction: Round 2 Deep Research ingested

Also earlier in the session: event-list Round-2 Deep Research findings were reviewed and ingested into [docs/ocr/event-list-extraction-research.md](docs/ocr/event-list-extraction-research.md). Key takeaways:

- **The end-state input is video frames, not screenshots.** Operator records the match playthrough including the scrolling Action Tracker. Tracking-by-detection over short row sequences becomes the right framing for the eventual video pipeline.
- **CVTS-style character-level alignment + uncertainty fusion** is the right implementation detail of CWMV — not whole-string voting.
- **PaddleOCR/RapidOCR's default decoders are argmax-only** — no top-K hypothesis lattice exposed. Per-character fusion would require forking the recognizer. For our scale, sequence-level CWMV is enough.
- **Smart-sampling matters at video rates** — scroll-motion gate (only OCR when text is stable for ≥100 ms) or fixed 5-10 fps; naive 30 fps is 3600 frames per scroll-through.

17 of 23 Round-2 prompt questions remain open as internal-spike candidates (logged in the dossier with concrete next steps).

### Uncommitted research artifacts (next session: please commit these)

A LOT of valuable research work is currently sitting in the working directory but not in git. If the working tree is wiped (worktree cleanup, fresh checkout, etc.) it'll be lost. Recommend a `docs(ocr): commit research dossiers + spike scripts` commit early in the next session covering:

**Dossiers** (in `docs/ocr/`, untracked):

- `pre-game-extraction-research.md` — full diagnosis of the pre-game OCR problem + internal research that drove this session's commits
- `marker-extraction-research.md` — full marker calibration research incl. spike findings and Round-2 ingestion
- `event-list-extraction-research.md` — event-list problem statement + Round-1/Round-2 findings
- `event-map-extraction-deep-research-prompt.md` — Round-2 marker Deep Research prompt
- `event-list-extraction-deep-research-prompt.md` — Round-2 event-list Deep Research prompt
- `event-map-implementation-report.md` — comprehensive review of the shot-map implementation
- `features-and-metrics.md`, `metrics-feature-brainstorm.md`, `source-screen-inventory.md` — earlier brainstorm/inventory artifacts
- `deep-research-report_1.md`, `_2.md`, `_3.md` — raw Deep Research outputs (verbatim, citation tokens mangled but content readable)

**Calibration data** (in `tools/game_ocr/game_ocr/configs/rink/`, untracked):

- `match250_landmarks.json` — 13 user-measured landmarks + 12 axis-only observations for match 250 (the spike data that defeated plain TPS)

**Spike / diagnostic scripts** (in `tools/game_ocr/scripts/`, untracked):

- `calibration_spike.py` — TPS-vs-linear comparison with LOOCV-TRE
- `xfactor_tier_spike.py` — HSV classifier (validated 18/18 in this session)
- `dump_raw_ocr.py` — full-frame + per-ROI OCR dump tool
- Plus `benchmark_side_by_side.py`, `benchmark_vs_truth.py`, `calibrate_rink.py`, `recalibrate_rink.py`, `verify_rink_calibration.py`, `import_cvat_labels.py`, `test_spatial.py` from prior sessions

Also untracked: `tools/game_ocr/game_ocr/spatial.py` (marker / row-selection detection helpers built in earlier sessions).

### What's deferred / next session pickups

Closest-to-done items (each is a small focused commit):

1. **Build-class normalization** — `TAGETHOMPSON-PWF` → `Tage Thompson - PowerForward` via fuzzy match against a known vocabulary. Cleanest spot is in the consensus engine after voting picks the most-common variant.
2. **Captain ★ detection** — small CV-based detector for the BGM ★ glyph that RapidOCR misses. Sample a fixed pixel region in the strip avatar area; HSV-match against yellow.
3. **Web rendering** of the now-canonical loadout data — surface position / build / X-Factors / attributes on the match page. The DB query `getMatchLineups` in `packages/db/src/queries/match-lineups.ts` already returns this shape (per earlier session's work); just plumb through to the UI.
4. **M. RANTANEN alias fix** (memory-tracked) — `UPDATE player_display_aliases SET player_id=3 WHERE alias='M. RANTANEN'` plus audit of `match_events` rows where actor_player_id=11 with actor_gamertag_snapshot='M. RANTANEN'.

Medium-scope items:

5. **Marker-extraction internal spikes** — the 4 prioritized ones from the Round-2 review. ~3 hrs total. Quantifies the calibration improvement before any production rewrite.
6. **Event-list internal spikes** — 17 small empirical questions (JW threshold sweep, DBSCAN eps tuning, frame-duplicate hashing, etc.). Pick whichever blocks the next event-list direction.

Bigger items:

7. **Goalie loadout support** — no goalie data in match 250 (CPU). When a match with human goalies is captured, the loadout view shape may differ from skaters (Glove / Blocker / Speed etc.). Schema additions may be needed.
8. **Penalty-row handling verification** — match 250 has 0 penalties. The Action Tracker parser's penalty path (`<player> <INFRACTION> (SEVERITY)`) is unverified empirically. First penalty-containing match ingested will exercise this.

### Open decisions / blockers

- **Dossiers should be committed** before the next implementation pivot. Recommended commit at the start of the next session.
- **Captain ★ detection approach** — CV-based or accept the limitation? My recommendation: small CV detector, but it can wait.
- **Build-class catalogue** — should we maintain a hardcoded mapping (`SNP → Sniper`, `PWF → Power Forward`, etc.) or scrape from EA's data? Hardcoded is faster; scraping is more sustainable. No strong opinion yet.

### Files added this session (committed)

- `packages/db/migrations/0032_pregame_loadout_fields.sql` (cc101de)
- `packages/db/migrations/0033_loadout_team_side.sql` (12694e9)
- `tools/game_ocr/scripts/validate_loadout_v2.py` (f34b400) — V2-benchmark regression harness for the loadout parser
- `apps/worker/src/consolidate-loadouts-cli.ts` (12694e9)

### Files modified this session (committed)

- `packages/db/src/schema/player-loadout.ts` — schema for new columns
- `tools/game_ocr/game_ocr/configs/roi/player_loadout_view.yaml` — collapsed to single full_frame region
- `tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_1.yaml` — same
- `tools/game_ocr/game_ocr/configs/roi/pre_game_lobby_state_2.yaml` — same
- `tools/game_ocr/game_ocr/image.py` — added `raw`/`none` preprocess mode
- `tools/game_ocr/game_ocr/models.py` — PlayerLoadoutResult shape change, TeamSummary.state
- `tools/game_ocr/game_ocr/parsers.py` — both loadout + lobby parsers rewritten
- `tools/game_ocr/tests/test_parsers.py` — updated CPU-detection fixture for new full-frame shape
- `apps/worker/src/ingest-ocr.ts` — walker emits new loadout field keys
- `apps/worker/src/ocr-promoters/loadout.ts` — writes new columns
- `apps/worker/src/ocr-promoters/pre-game-lobby.ts` — writes new columns + parses measurements
- `apps/worker/package.json` — added `consolidate-loadouts` script

---

## Session Summary — 2026-05-11 (Games-page revamp + shot-map data-correctness chase)

### Match-page revamp shipped

Per the brainstorm at `docs/ocr/metrics-feature-brainstorm.md` and the plan at `docs/superpowers/plans/2026-05-10-ocr-schema-integration.md`:

- **Branding SVG port** — `Rink.svg` + 8 event marker badges (Goal/Shot/Hit/Penalty × Home/Away) ported from `docs/branding/rink-event-map/` into inline JSX in `apps/web/src/components/branding/{rink,event-markers}.tsx`. Source SVGs are now decoupled from the UI; the user can reorganise the branding folder freely.
- **PeriodSummary** — horizontal cards (4 per period), per-period winner ribbon (BGM red / dim / tied), proportional bars for Goals/Shots/Faceoffs.
- **EventLog** — vertical-timeline with goal-hex and penalty-diamond markers, BGM/4L sides of the rail, GWG tag on the game-winning goal.
- **ShotMap** — uses new `RinkSvg`, marker SVG components for goals/shots/hits/penalties, filter chips (now without Faceoffs — they don't render on the map by design), period-filter chips, 2x marker sizes, coverage disclosure under the rink: _"N events positioned on the rink · K captured but not yet placed"_.
- **ShotMix** — Total row promoted (big numbers, separator), subtitle "Most BGM shots: X · Most OPP shots: Y".
- **LineupCard** (new) — added between TeamStats and PeriodSummary. Two-column BGM/opponent roster from `player_loadout_snapshots` joined via `getMatchLineups()` (new query in `packages/db/src/queries/match-lineups.ts`). Team side derived from raw_result_json (`our_team` vs `opponent_team`) with a player-resolution fallback. CPU/empty slots fill remaining seats as ghost chips.

### Box-score "Shots" override (OCR wins when present)

`buildBoxScore()` in `apps/web/src/lib/match-recap.ts` now takes `periodSummaries` and overrides EA's `match.shotsFor/_against` with the sum of reviewed OCR per-period shots. The Offense group gains a footnote: _"Shots and shooting % are taken from the in-game Box Score (OCR-reviewed). EA reported X–Y."_. Shooting % and Shot On Net % cascade off the OCR total.

For match 250: EA reported 25–15; OCR Box Score reads 29–16 (after manual fix to 9→6 misreads). Page now shows 29–16 with the footnote.

### Shootout (`SO`) removal

User confirmed EASHL has no shootout. Removed:

- `SO`/`S0` entries from `_BOX_SCORE_PERIOD_NUMBER` / aliases in `tools/game_ocr/game_ocr/parsers.py`.
- TOT-sum sanity check narrowed from periods 1..7 → 1..6.
- DB cleanup: 1 stray `match_period_summaries` row at `period_number=7 (SO)` deleted.
- Confirmed no `match_events` or `match_shot_type_summaries` rows had period_number > 6.

### Shot-map data correctness — the hard part

**Issue 1:** rink_pixel_box was misaligned. Original (960, 382, 1793, 832) didn't hug the actual rink in the in-game image. Re-tuned to **(947, 342, 1797, 830)** — wider by 17 px, taller by 38 px, centre moved up 21 px. Verified via overlay script (`tools/game_ocr/scripts/verify_rink_calibration.py` — new).

**Issue 2 (the real bug):** the CVAT importer was using `events[0]` to identify which match_events row a labelled yellow marker corresponded to. **`events[0]` is the FIRST event in the parsed list (chronological top of panel) — NOT the highlighted/selected event.** The OCR pipeline had no way to know which row was selected.

**Fix:**

- `tools/game_ocr/game_ocr/spatial.py` — new `detect_selected_row_index()`. Samples the red-tinted full-row background in the list panel (not just the left-edge team-indicator strip, which appears on every BGM-actor row). Scores each parsed event's y-band by red-pixel count; row with the most red = selected.
- `tools/game_ocr/game_ocr/parsers.py` — captures each event's actor-row `y_center` (scaled /2 because OCR runs on a 2x upscale via `image.preprocess_image`), calls the detector, attaches `selected_event_index` to `PostGameActionTrackerResult`.
- `tools/game_ocr/game_ocr/models.py` — adds the field.
- `tools/game_ocr/scripts/import_cvat_labels.py` — reads `raw_result_json.selected_event_index` and writes the CVAT pixel coords to `events[selected_event_index]` (fallback to 0 for older rows, but those have all been re-OCR'd).

### Re-OCR + clean re-import

- Deleted stale Action Tracker batches 10/11/12/13 (3367 fields + 96 extractions + 4 batches).
- Re-ingested via `pnpm --filter worker exec node dist/ingest-ocr-cli.js --batch-dir … --screen post_game_action_tracker --match-id 250 --game-title-id 1` — new batches 19/20/21 (32 + 37 + 24 = 93 captures), all with `selected_event_index` populated.
- Cleared all OCR-derived `match_events.x/y/rink_zone` on match 250 (95 rows nulled).
- Re-ran `import_cvat_labels.py` against the existing CVAT XML at `/tmp/cvat-export/annotations.xml`. Result: 20 unique `match_events` rows positioned (13 faceoffs + 2 goals + 3 shots + 2 hits). Faceoffs are hidden from the map by design, so **7 events render on the shot map**.

The drop from the prior 38 "positioned" events down to 7 visible is because the prior coordinates were essentially random (events[0] mismapping). Now they're honest: only events that genuinely had their yellow marker labelled, and whose row was actually selected at label time, get coords.

### CVAT pipeline reference

- `tools/game_ocr/scripts/import_cvat_labels.py` — re-runnable importer.
- `tools/game_ocr/scripts/verify_rink_calibration.py` — overlay debug visualisation (`--crop` flag for tight rink view; `--box "x1,y1,x2,y2"` to test alternate calibrations without writing).
- CVAT export currently at `/tmp/cvat-export/` (extracted from the user's zip at `task_1_dataset_2026_05_11_02_57_07_cvat for images 1.1.zip`).

### Team-side correctness fixes (one-off)

- 3 BGM events were tagged `team_side='against'` because Action Tracker writes `team_abbreviation=NULL` and the events-screen promoter defaulted to 'against'. Flipped via SQL when actor resolves to a BGM `players.id`.
- M. Rantanen's 5:07 P2 goal had `actor_player_id=NULL` because OCR captured the jersey name ("M. Rantanen") not the gamertag. Linked manually to `player_id=11` (MrHomiecide).

### What's deferred / next session pickups

- **Re-label CVAT focused on goal/shot/hit-highlighted frames** if denser map data is wanted for match 250.
- **Sample home/away team colors** from Action Tracker screenshots and apply to event markers per match (instead of fixed red/blue).
- **Audit Net Chart OCR** — its 23-7 disagrees with Box Score 29-16. One OPP `total_shots` came back NULL.
- **v2 CVAT labelling** — annotate ALL visible markers per capture (~5x clicking, but positions the ~50 events that don't have any frame selecting them).
- **Optional** — render the site rink with the in-game rink's aspect (1.74:1) so visual feature-relative positions match the in-game art. Trade-off: less authentic NHL look.

### Files added this session

- `apps/web/src/components/branding/rink.tsx`
- `apps/web/src/components/branding/event-markers.tsx`
- `apps/web/src/lib/event-markers.ts`
- `apps/web/src/components/matches/lineup-card.tsx`
- `packages/db/src/queries/match-lineups.ts`
- `tools/game_ocr/scripts/import_cvat_labels.py`
- `tools/game_ocr/scripts/verify_rink_calibration.py`

### Files modified this session

- `apps/web/src/app/games/[id]/page.tsx` — Lineup card wired in; `buildBoxScore` now receives `periodSummaries`.
- `apps/web/src/lib/match-recap.ts` — OCR shot override + group footnote.
- `apps/web/src/components/matches/{period-summary,event-log,shot-map,shot-mix,team-stats}.tsx` — full redesigns.
- `tools/game_ocr/game_ocr/parsers.py` — Action Tracker parser tracks y_centres + calls selected-row detector + drops SO.
- `tools/game_ocr/game_ocr/spatial.py` — `detect_selected_row_index()`.
- `tools/game_ocr/game_ocr/models.py` — `PostGameActionTrackerResult.selected_event_index`.
- `tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json` — rink_pixel_box retune.

---

## Session Summary — 2026-05-10 (OCR benchmark + reconciliation)

### Manual ground truth recorded

`research/OCR-SS/Manual OCR benchmark for verification.md` — operator-recorded canonical reference for match 250 covering every screen (Pre-Game Lobby, Loadouts × 10 players, Box Score 3 tabs, Events, Action Tracker 2nd/3rd/OT, Faceoff Map per period, Net Chart per period, Post-Game Player Summary). 90 Action Tracker events, 7 goals, 24 box-score cells.

### Backfilled 3rd-period + OT Action Tracker

Phase 5 work had only ingested 2nd-period captures. Backfilled the rest:

- Batch 12 (3rd period): 37 captures → 39 cascade events.
- Batch 13 (OT): 24 captures → 25 cascade events.

Both auto-approved at threshold 0.85. Match 250 now has 102 events total: 33 (2nd) + 43 (3rd) + 26 (OT). Spatial fill ~37% (38 of 102 events have x/y).

### Benchmark tool — `tools/game_ocr/scripts/benchmark_vs_truth.py`

Parses the markdown ground truth, queries the DB via `docker exec psql`, compares cell-by-cell, reports per-screen accuracy + discrepancies. No new Python deps (pure stdlib + subprocess).

Headline accuracy on match 250:

```
Box Score:        18/24 cells match  (75.0%)
Events (goals):    6/7  truths match (one missing — see clock-convention finding below)
Action Tracker:   85/90 events match (94.4% recall)
```

Discrepancies surfaced (Action Tracker — 5 missing, 17 extra):

- **Truly missing from DB**: 4 faceoffs (04:42 P2, 10:07 P2, 00:52 P3, 14:42 P2 hit) + 1 misclassified shot (13:41 P2 Silky — recorded as goal in DB).
- **Extras in DB**: OCR digit/letter misreads (`WILOE` vs `WILDE`, `fOEWS` vs `TOEWS`, `SIlKY` vs `SILKY`); a clearly-bogus `71:10` clock; 7 Action Tracker rows that are actually Events-screen-clock duplicates of the same goal under a different clock convention (see below).

### Critical finding: clock convention differs between Events and Action Tracker screens

The Events screen shows **time remaining in the period**. The Action Tracker shows **time elapsed**.

| Goal         | Events screen     | Action Tracker  | Same event?                   |
| ------------ | ----------------- | --------------- | ----------------------------- |
| Silky's 1st  | 06:19 (remaining) | 13:41 (elapsed) | yes — `20:00 − 06:19 = 13:41` |
| Rantanen 2nd | 14:53             | 05:07           | yes — `20:00 − 14:53 = 05:07` |
| Wanhg OT     | 17:23             | 02:37           | yes — `20:00 − 17:23 = 02:37` |

Phase 2's cross-capture dedup matches on identical clock strings, so it doesn't collapse Events- and Action-Tracker–sourced rows for the same goal. Result: every goal lives in the DB twice (once per screen). Match 250 has 14 goal rows when there were only 7 actual goals.

**Fix path (open):** in the Events promoter, transform `clock` from "time remaining" to "elapsed" before insertion (`20:00 − clock`). All other promoters already use elapsed time. Single-line transform, but invalidates existing data — would require either a re-ingest of the Events batches OR a one-time SQL UPDATE to flip the existing rows.

### Operational edge case: highlighted-event off-screen during scroll

Ground-truth Action Tracker for 3rd period has a `Hit @ 19:13 -, Whoosah → H. Jenkins` event. While that event was selected in-game, its row had already scrolled off the visible 6-row list, so the captured frame doesn't show it. The next capture (Faceoff @ 19:59) does show the 19:13 row above the new selection.

Implication for video ingestion: when capturing from a video stream rather than discrete screenshots, frames where the highlighted event is off-screen contribute a YELLOW marker to the rink without the parser knowing which event the marker belongs to. We can't naively associate "first event in list" with the yellow marker in those frames.

Mitigations to consider when wiring video ingestion:

- Detect the off-screen condition: if the visible event list shows N rows but no row appears highlighted, drop the spatial extraction for that frame.
- Use the prior/next frame's list state to find the "missing" event: if frame K's selection is N+1 (visible) and frame K-1's was N (now off-screen), the K-1 yellow marker belongs to the event that's now at the top of the frame-K list.
- Or simply: prefer captures where the selected event is clearly visible at the top.

Not blocking for the current screenshot-based workflow but flag this loud when video ingestion is built.

### OCR-quality issues the benchmark surfaced

- **Digit confusion in Box Score** (especially the "9 vs 6" pair): 3rd-period BM shots truth=9 db=6, OT BM shots truth=9 db=6. The "9" glyph in this font reads as "6" intermittently.
- **Letter confusion in names**: I/l in `SIlKY`, D/O in `WILOE`, T/f in `fOEWS`. Case-fixing in identity resolver helps but doesn't fully fix.
- **Bogus clock**: `71:10` — period clock can't exceed `19:59`. Sanity-check `MM ≤ 19, SS < 60` post-OCR.
- **Faceoff Map OT** truth has `None` for faceoffs but DB has values — likely an OCR misread of an empty cell as a number, or possibly the OT screen captures show the FULL-GAME aggregate rather than period-specific faceoffs.

### Reconciliations agreed with operator

Confirmed in this session that for the manual-vs-OCR mismatches I flagged earlier, the OCR was correct three times:

- 10:52 P2 shot L. Hutson — OCR correct, manual missed.
- 13:41 P2 Silky shot — OCR misclassified as goal; operator initially wrote "Shot" but reviewing again says shot was right (so OCR misclassification stands).
- Zubov goal at 19:08 — OCR correct; manual transcribed 19:06.

These three corrections were applied to the manual benchmark interpretation; the next regenerable run of the benchmark won't flag them.

### Files added

- `tools/game_ocr/scripts/benchmark_vs_truth.py` — markdown parser + DB diff + per-screen report.

### What's next

- Fix the Events-vs-Action-Tracker clock-convention dedup (the highest-impact OCR fix found this session).
- Tune Box Score digit OCR for the 9-vs-6 confusion specifically.
- Ground truth for at least one more match would let us tell signal-from-game from signal-from-OCR.

---

---

## Session Summary — 2026-05-10 (OCR build, Phase 5 — rink coordinates)

Plan: `/home/michal/.claude/plans/abstract-yawning-dream.md`

### Goal

Fill `match_events.x` / `.y` / `.rink_zone` (already in schema, all null after Phase 4) by detecting marker positions on the rink illustration in the right panel of each Action Tracker capture. Coordinate system: hockey-standard (`x ∈ [-100, +100]`, `y ∈ [-42.5, +42.5]`, center ice = (0, 0), BGM attacks +x). Net Chart and Faceoff Map spatial deferred per user decision.

### CV pipeline (Python: `tools/game_ocr/game_ocr/spatial.py`)

New module. Public API: `load_rink_calibration`, `detect_rink_markers`, `find_selected_marker`, `pixel_to_hockey`, `extract_selected_event_position`. Pipeline:

1. Crop to `rink_pixel_box` from the calibration JSON.
2. HSV color masks via `cv2.inRange`: yellow (selected highlight), red (event marker fill), white (event marker fill).
3. Morphological cleanup: erode 3×3 → dilate 3×3 to remove noise.
4. `cv2.findContours` per mask; filter by area `[100, 4500]` and circularity `≥ 0.35`.
5. For surviving contours: centroid via `cv2.moments`.
6. Among detected markers, the unique YELLOW marker = the selected event (Action Tracker highlights the selected list-row's corresponding rink marker in yellow).
7. Convert pixel → hockey-standard via affine transform anchored on the rink bounding box.

Calibration coords for Action Tracker were tuned empirically from the OCR-SS samples:
`rink_pixel_box: { x1: 960, y1: 382, x2: 1793, y2: 832 }` at 1920×1080. Yellow HSV `H ∈ [15, 30]`, `S ≥ 120`, `V ≥ 150`. Yellow markers are larger than regular event markers (highlight glow), so `area_max=4500` and `circularity_min=0.35` accommodate both clean center-of-rink markers AND markers cut off by the rink boundary.

### Calibration script (`tools/game_ocr/scripts/calibrate_rink.py`)

One-off helper to overlay the calibration's `rink_pixel_box`, reference points, and detected markers on a sample image. Save the result as a PNG for visual inspection. Use when bootstrapping calibration values for a new screen type or when game UI shifts position between updates.

### Smoke test (`tools/game_ocr/tests/test_spatial.py`)

11 unit tests covering:

- Calibration JSON load + parse.
- Synthetic rink image with a yellow circle at known pixel positions → assert hockey coordinates round-trip within 0.5 units.
- Box-corner round-trips (top-left → x=-100, y=+42.5; bottom-right → x=+100, y=-42.5).
- Multiple-yellow disambiguation (picks the larger marker).
- No-yellow returns None with a warning.
- Y-axis inversion (pixel-y above center → positive hockey-y).

All 11 pass plus the existing 7 parser tests = 18 total in 13 seconds.

### Action Tracker parser integration (`tools/game_ocr/game_ocr/parsers.py`)

`parse_post_game_action_tracker` now accepts an optional `image=None` kwarg. When set (production: extractor passes the loaded full-frame BGR np.ndarray), it runs `extract_selected_event_position` and attaches:

- `selected_event_x: float | None` — hockey-standard
- `selected_event_y: float | None`
- `selected_event_rink_zone: 'offensive' | 'defensive' | 'neutral' | None`
- `spatial_marker_count: int`
- `spatial_yellow_count: int`
- `spatial_warnings: list[str]`

The first event in `events` corresponds to the highlighted (yellow) marker because the selected row is rendered topmost in the Action Tracker UI.

`Extractor.extract_path` now passes the full image as a kwarg: `definition.parser(meta, regions, image=image)`. All other parsers gained an unused `**_kwargs` to accept-and-ignore. The Parser type is now `Callable[..., BaseExtractionResult]`.

### Worker promoter update (`apps/worker/src/ocr-promoters/action-tracker.ts`)

After the existing event-loop, when `result.selected_event_x/y` is non-null and the first event has a clock+actor, the promoter UPDATEs the matching `match_events` row's `x`, `y`, `rink_zone` columns in place. The dedup key is the same one the loop uses: `(matchId, periodNumber, eventType, source='ocr', clock, actorGamertagSnapshot)`.

This is **augment-only** — never inserts new rows for spatial data. Cross-screen dedup means a goal seen by both Events screen and Action Tracker collapses to one row in Phase 2; Phase 5 fills its spatial columns. If the same event is captured multiple times from Action Tracker (operator scrolls and re-highlights), every UPDATE points at the same row with the latest coords.

### DB query (`packages/db/src/queries/match-events.ts`)

`getMatchEvents` already projected `x/y/rinkZone` in Phase 4 — no change needed there. New: `getPlayerCareerShots(playerId, limit=500)` returns reviewed positioned events for a player across all matches, joined with `matches` for opponent name + played date. Sorted by match_id descending.

### UI surfaces (`apps/web/src/`)

- **Single-match shot map** (`components/matches/shot-map.tsx`): SVG rink drawn directly in hockey-standard coordinate space (`viewBox="-110 -50 220 100"`), so each marker is plotted at its raw `(x, y)`. Markers color/shape-coded: red circle (goal), gray circle (shot), blue square (hit), yellow diamond (penalty), small white circle (faceoff). Hover tooltip shows actor + clock + period. Hides itself if no events have spatial data.
- **Career shot map** (`components/roster/career-shot-map.tsx`): same SVG rink, plots all reviewed positioned events for the player. Client-side filter buttons (All / Shots / Goals / Hits / Penalties / Faceoffs) hide event types with zero count. Hides itself if fewer than 5 positioned events exist (sparse-dot rendering would be misleading).

Both wired into their respective pages: ShotMap after EventLog on `/games/[id]`; CareerShotMap after LoadoutHistoryStrip on `/roster/[id]`.

### End-to-end verification

Re-ingested 32 Action Tracker captures from `research/OCR-SS/Action-Tracker/2nd-Period-Events/` against match 250:

```
Total match_events for match 250:    38 rows
Rows with spatial data (x non-null): 16 (42% of total)
  rink_zone='offensive':             10
  rink_zone='defensive':              2
  rink_zone='neutral':                4
```

Spot check: SILKY shot at clock 0:01 → `(24.32, 31.91)` neutral zone ≈ high slot, plausible. M. RANTANEN goal at 5:07 → `(64.28, -8.02)` offensive slot, classic goal-scoring position. E. WANHG faceoff at 2:13 → `(-26.43, -33.81)` defensive zone faceoff dot. All within ±5 ft of the visible on-rink position.

UI smoke check (`pnpm --filter web dev`):

- `/games/250` renders ShotMap with 12+ markers visible on the SVG rink.
- `/roster/11` (MrHomiecide, 5 positioned events) renders CareerShotMap.
- `/roster/2` (silkyjoker85, 1 positioned event) correctly hides CareerShotMap (below the ≥5 threshold).

### Files added

- `tools/game_ocr/game_ocr/spatial.py`
- `tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json`
- `tools/game_ocr/scripts/calibrate_rink.py`
- `tools/game_ocr/tests/test_spatial.py`
- `apps/web/src/components/matches/shot-map.tsx`
- `apps/web/src/components/roster/career-shot-map.tsx`

### Files modified

- `tools/game_ocr/game_ocr/extractor.py` — Parser type widened to `Callable[..., BaseExtractionResult]`; `extract_path` passes `image=image` kwarg to parsers.
- `tools/game_ocr/game_ocr/parsers.py` — All 7 module-level parsers gained `**_kwargs` to ignore the new image arg; `parse_post_game_action_tracker` actually uses it for spatial extraction.
- `tools/game_ocr/game_ocr/models.py` — `PostGameActionTrackerResult` extended with 6 spatial fields (x, y, rink_zone, marker counts, warnings).
- `apps/worker/src/ocr-promoters/action-tracker.ts` — UPDATE matched event row with x/y/rink_zone after the existing event-loop.
- `packages/db/src/queries/match-events.ts` — added `getPlayerCareerShots` + `PlayerCareerShotRow` type.
- `apps/web/src/app/games/[id]/page.tsx` — fetches + renders ShotMap.
- `apps/web/src/app/roster/[id]/page.tsx` — fetches + renders CareerShotMap.

### What's deferred (Phase 5+ future)

- **Net Chart spatial extraction** (per user decision). Action Tracker covers per-shot data; Net Chart's per-shot map would only validate, not add new info.
- **Faceoff Map per-dot spatial insertion**. Aggregate counts already in `ocr_extraction_fields` for audit; per-dot rows wait until the UI demands it.
- **Season-aggregate heatmaps** (team shot heatmap, period-filtered map, faceoff dominance map, hit map). Fall out naturally once enough matches have populated x/y. The per-match and per-player maps shipped in this phase already prove the underlying data is good.
- **Cross-validation against EA's `skShotsLocationOnIce*` grid** (`apps/worker/src/extract-shot-locations.ts`). Quality-check phase for later.
- **Other Action Tracker periods** beyond 2nd period (3rd, OT). The same calibration applies; just ingest the additional batches when ready.

---

---

## Session Summary — 2026-05-10 (OCR build, Phases 0-2)

Plan: `/home/michal/.claude/plans/abstract-yawning-dream.md`

### Phase 0 — Schema pre-flight (migration 0029)

- Added `'post_game_faceoff_map'` to `OcrScreenType` (TS-only, `packages/db/src/schema/ocr-pipeline.ts`).
- Added `review_status` column (default `'pending_review'`) to `match_period_summaries` and `match_shot_type_summaries` so all four OCR-fed promoter tables share the same review lifecycle. Migration `0029_red_xavin.sql` (idempotent `ADD COLUMN IF NOT EXISTS`).
- Drizzle journal `when` bumped to be after the manually-backdated migration `0027_test_roster_utiz` so future `pnpm --filter db migrate` runs don't skip it.

### Phase 1 — Worker subprocess + capture-batch skeleton

End-to-end pipe alive against the 4 already-implemented Python parsers (lobby ×2, loadout, post-game player summary).

New files in `apps/worker/src/`:

- `ocr-cli-runner.ts` — `runOcrCli({screen, inputPath, pythonBin?})`. Spawns `python3 -m game_ocr.cli`, writes JSON to a tempfile, parses, deletes tempfile. Honors `OCR_PYTHON` env var; sets `PYTHONPATH` to `tools/game_ocr`. Tolerates exit code 1 (CLI emits 1 for warnings if JSON wrote anyway).
- `ingest-ocr.ts` — `ingestOcrBatch(...)` orchestrates: insert one `ocr_capture_batches` row, run CLI, walk results. Per-result transaction: upsert `ocr_extractions` (idempotent on `(batch_id, source_path)`), clear+rewrite `ocr_extraction_fields`, dispatch to per-screen promoter, mark `transform_status` success/error. **One transaction per result, not per batch** — bad screenshots don't roll back the rest.
- `walkExtractionFields()` — per-screen field walkers emit one `ocr_extraction_fields` row per `ExtractionField` in the parsed result tree, with `entity_type` / `entity_key` per the schema's documented conventions.
- `ocr-promoters/index.ts` — promoter registry keyed on `OcrScreenType`.
- `ocr-promoters/loadout.ts` — promotes `player_loadout_view` into `player_loadout_snapshots` + up to 3 `player_loadout_x_factors` + ~23 `player_loadout_attributes`. Idempotent: deletes prior snapshot rows for the same `source_extraction_id` before reinserting.
- `ocr-promoters/pre-game-lobby.ts` — promotes lobby states into thin `player_loadout_snapshots` rows (no x_factors/attributes — lobby UI doesn't expose those).
- `ocr-promoters/post-game-player-summary.ts` — no-op (data is redundant with EA API canon; we keep extraction record for audit).
- `ocr-promoters/resolve-identity.ts` — Phase 1 stub: lowercase exact match against `players.gamertag`, returns `{playerId: null}` on miss. Never inserts new players from OCR.
- `ingest-ocr-cli.ts` — CLI shim. `pnpm --filter worker ingest-ocr --batch-dir <dir> --screen <type> --game-title-id <id> [--match-id <id>] [--capture-kind manual_screenshots] [--notes "..."] [--dry-run]`. Mirrors `reprocess.ts` conventions (argv parsing, `[ingest-ocr]` log prefix, `sql.end()` in `finally`).

`apps/worker/package.json` script: `"ingest-ocr": "node dist/ingest-ocr-cli.js"`. No new npm deps.

Verified end-to-end: a loadout screenshot produces 1 `ocr_capture_batches` row, 1 `ocr_extractions` row (`transform_status='success'`, `overall_confidence=0.9504`), 19 `ocr_extraction_fields` rows, 1 `player_loadout_snapshots` row, 3 x-factors, 5 attributes (parser merges adjacent rows — see Phase 2 ROI tuning notes below). Re-running a batch is idempotent within an extraction.

### Phase 2 — Five new Python parsers + their promoters

All five parsers are wired into `tools/game_ocr/game_ocr/extractor.py` `ScreenRegistry`. ROI calibration done from real `research/OCR-SS/` screenshots; `invert-threshold` preprocess used universally for stat-row regions (Otsu binary + invert) — much more robust than the default `threshold` mode for grayed-out "loser-row" text.

#### Box Score (3 sub-tabs)

YAMLs: `post_game_box_score_{goals,shots,faceoffs}.yaml`. One shared parser `parse_post_game_box_score(meta, regions, *, stat_kind)`; the 3 screen types differ only by `stat_kind` discriminator.

Layout: tab label top-left, period header row (`1ST 2ND 3RD OT SO TOT`) above two team rows. Parser strategy:

- `_split_into_columns` clusters OCR by horizontal gap to find header columns.
- `_align_row_to_headers` anchors each stats row's OCR detections to header column x-centers, exploding tightly-spaced glued digit tokens (e.g. `"2331"` → 4 separate digits) by per-character x-slicing.
- `_BOX_SCORE_PERIOD_ALIASES` covers common OCR misreads (`"S0"` → `"SO"`, `"BRD"` → `"3RD"`, etc.).

Promoter: `apps/worker/src/ocr-promoters/box-score.ts` — upserts `match_period_summaries` keyed on `(match_id, period_number, source='ocr')`. Each tab updates only the columns it owns (goals/shots/faceoffs); merging across the three tabs produces one row per period with all three stats populated.

`apps/worker/src/ocr-promoters/resolve-bgm-side.ts` — soft-matches OCR'd team names against BGM aliases (`bgm`, `boogeymen`, `the boogeymen`, `bm`) with first-token fallback. Used by Box Score, Net Chart, Events promoters to determine `for/against` sidedness.

End-to-end verified for match 250 (`BGM 4-3 4th Line`): all 3 tabs ingested → 5 period rows in `match_period_summaries`, ~31 of 36 cells correct. Wrong digits have intact confidence scores for Phase 4 review.

#### Net Chart

YAML: `post_game_net_chart.yaml`. Parser `parse_post_game_net_chart`. Layout: 7 stat rows × {away, home}.

Promoter: `apps/worker/src/ocr-promoters/net-chart.ts` — upserts `match_shot_type_summaries` keyed on `(match_id, team_side, period_number, source)`. `period_number = -1` for ALL PERIODS aggregate; otherwise 1/2/3/4 from the period selector tab.

Verified: 4 period screenshots → 8 rows in `match_shot_type_summaries` (4 periods × {for, against}). BGM correctly resolved as `for`. ~85% per-cell accuracy.

`resolve-bgm-side.ts` was hardened during this phase to handle `BM(A)` / `4TH(H)` style labels (separate alphanumeric runs as words; first-token comparison; replace `"4TH(H)"` regex strip with proper word splitting).

#### Faceoff Map (audit-only)

YAML: `post_game_faceoff_map.yaml`. Parser `parse_post_game_faceoff_map` captures the text panel (overall win %, offensive/defensive zone splits per side). Promoter `apps/worker/src/ocr-promoters/faceoff-map.ts` is a no-op — Box Score's faceoffs tab already populates `faceoffs_for/_against`, and zone splits have no schema columns yet. Per-extraction field rows recorded in `ocr_extraction_fields` for review.

#### Events (full-game scrollable list)

YAML: `post_game_events.yaml`. Parser `parse_post_game_events` groups OCR lines by y, identifies period headers via fuzzy regex (handles OCR-corrupted `"STPERIOD"` and `"BRDPERIOD"` by inferring the period from ordinal-suffix tokens or any leading digit), and parses each event row through three regexes:

- `_EVENT_GOAL_RE`: `<CLOCK> <SCORER>[N] [ASSIST1, ASSIST2]`
- `_EVENT_GOAL_NO_NUM_RE`: same minus `[N]` (OT-winner edge case)
- `_EVENT_PENALTY_RE`: `<CLOCK> <PLAYER> <INFRACTION> Minor|Major`

Ornament filter rejects single-letter UI badges (`"L"`, `"TL"`, `"IL"`) that the loss-indicator chip renders to the left of the team logo.

Promoter: `apps/worker/src/ocr-promoters/events.ts`. Cross-capture dedup key: `(matchId, periodNumber, clock, eventType, source='ocr', teamAbbreviation, actorGamertagSnapshot)`. When a row already exists, just refresh `ocr_extraction_id` to the new extraction. Inserts:

- `match_events` row with `source='ocr'`, `reviewStatus='pending_review'`, `eventType='goal'|'penalty'`.
- `match_goal_events` extension (scorer + goal_number_in_game + up to 2 assists, each gamertag resolved).
- `match_penalty_events` extension (infraction + penalty_type + minutes derived).

Verified end-to-end: 2 OCR captures (top-of-list + scrolled) of match 250 → 7 unique goals in `match_events` after dedup, fully matching the actual game (BGM goals: Silky×2, Rantanen, Wanhg-OT; 4TH goals: Toews×2, S.Zubov). All 7 goals have correct `match_goal_events` extension rows with assist details.

#### Action Tracker (list panel only — rink coords deferred to Phase 5)

YAML: `post_game_action_tracker.yaml`. Parser `parse_post_game_action_tracker` uses a wide y-grouping threshold (~85 px) to capture each event's 3 visual sub-rows (actor "ON|VS" target | event-type chip | event_type+clock+period text) as ONE OCR group. Each group produces one event row.

Promoter: `apps/worker/src/ocr-promoters/action-tracker.ts`. Same dedup key as events but without `team_abbreviation` (Action Tracker UI doesn't expose it on the list panel — that's on the rink map). `team_side` heuristically derived from whether the actor gamertag resolves to a known player (BGM-resolved → `for`; unresolved → `against`). Phase 3 will replace this heuristic with proper resolution.

Inserts shots, hits, faceoffs as plain `match_events` rows; goals add `match_goal_events`; penalties add `match_penalty_events`.

Verified: 3 sample 2nd-period screenshots → 13 new events on top of the 7 already present from Events. ~6 of 7 visible events per screenshot fully parsed; 1-2 misses per screenshot due to OCR misreads on the small chip glyphs (`"SHOT"` rendered as `"10HS"`, `"0:42"` rendered as `"D:42"`, etc.). Cross-screen dedup correctly collapses Events-source goals with Action Tracker–source equivalents when actor gamertags align.

### Cumulative state in DB (match 250 BGM 4-3 4th Line)

```
ocr_capture_batches:  10  rows
ocr_extractions:      14  rows (transform_status='success', review_status='pending_review')
ocr_extraction_fields: ~250 rows
player_loadout_snapshots: 2 (early Phase 1 tests)
match_period_summaries: 5 rows (per period; goals + shots + faceoffs merged)
match_shot_type_summaries: 8 rows (4 periods × {for, against})
match_events: 20 rows (7 goals + 13 shots/hits/faceoffs/goal-misclassifications)
match_goal_events: 7 rows
match_penalty_events: 0 rows (no penalties in this match)
```

### Open issues to address in Phase 3+

- `Silky` / `SILKY` case mismatch: the Action Tracker captures uppercase gamertags, but the Phase 1 resolve-identity stub does case-insensitive _exact_ match against `players.gamertag`. If the DB has `silkyjoker85` but OCR reads `Silky` (just the displayed first name), the resolver returns null. Phase 3 needs alias matching against `player_gamertag_history` and Levenshtein-1 fallback against current gamertags.
- OCR misreads of digits (`2`→`7`, `9`→`6`) and chips (`SHOT`→`10HS`, `0:04`→`0:42`) flow through to the DB with confidence intact. Phase 4's review CLI is the canonical fix path.
- Action Tracker `team_side` heuristic ("if actor resolved → for") is wrong for cases where BGM gamertags don't resolve due to case mismatch. Will improve naturally once Phase 3 lands.

---

## Session Summary — 2026-05-10 (OCR build, Phase 3 — identity reconciliation)

### Schema: `player_display_aliases` (migration 0030)

OCR captures **display names** (`Silky`, `M. Rantanen`, `E. Wanhg`) on Action Tracker / Events / Loadout screens, never the EA gamertag. Display names rarely substring-match the gamertag, so we added an explicit alias table that the resolver consults after gamertag and history lookups. Schema: `packages/db/src/schema/player-display-aliases.ts` — `(player_id, alias, normalized_alias, source: 'manual'|'auto', created_at)`. Unique on `(player_id, normalized_alias)` for upsert.

Migration `0030_sleepy_gressill.sql` applied directly via `cat | docker exec psql` to dodge the Drizzle journal-drift quirks.

### Production resolver (`apps/worker/src/ocr-promoters/resolve-identity.ts`)

Replaces the Phase 1 stub. Resolution order:

1. Normalize: trim + strip leading `-.`/`.` ornaments + strip trailing punctuation.
2. Exact case-insensitive match against `players.gamertag`.
3. Exact match against active `player_gamertag_history` aliases (`seen_until IS NULL`).
4. Exact match against `player_display_aliases.normalized_alias`.
5. Substring match — snapshot is contained in OR contains the gamertag — single-candidate only.
6. Levenshtein ≤ 1 against active gamertags — single-candidate only.

Never inserts new `players` rows. Returns `{ playerId, via }` so callers can debug which path resolved.

### Resolve CLI (`apps/worker/src/ingest-ocr-resolve-cli.ts`)

`pnpm --filter worker ingest-ocr-resolve <subcommand>`:

- `list` — groups every unresolved `(actor|target|scorer|primary_assist|secondary_assist|culprit|player_loadout)` snapshot across all promoter tables. Output sorted by row count.
- `--auto` — re-runs the resolver against every unresolved snapshot, reports per-`via` counts. Idempotent.
- `--map "Silky=>2,M. Rantanen=>5,E. Wanhg=>11"` — bulk manual mapping. Each pair (a) inserts/updates a `player_display_aliases` row (so future ingests auto-resolve), (b) updates every existing unresolved row whose snapshot normalizes to the alias.

### End-to-end results against existing data

Starting state: 55 unresolved rows across 20 distinct snapshots after Phase 2 ingest.

- `--auto` resolved **10 rows** via substring matching (e.g., `Silky`/`SILKY` → `silkyjoker85`, also `MrHomiecide - Evoeni Wan` → MrHomiecide via "MrHomiecide" substring).
- `--map "E. Wanhg=>11,E. WANHG=>11"` resolved **7 more rows**. Both casings collapsed to one alias row via lowercase normalization; future ingests of either case will auto-resolve.
- Remaining 38 rows are ~all opponent display names (`Toews`, `Wilde`, `Whoosah`, etc.) that legitimately don't map to BGM players — schema is BGM-perspective, opponent rows live with `actor_player_id IS NULL` and `actor_gamertag_snapshot` preserved verbatim, which is the correct steady state.

### Files added

- `packages/db/src/schema/player-display-aliases.ts`
- `packages/db/migrations/0030_sleepy_gressill.sql` + `meta/0030_snapshot.json`
- `apps/worker/src/ingest-ocr-resolve-cli.ts`
- `apps/worker/package.json` — `ingest-ocr-resolve` script

### Files modified

- `apps/worker/src/ocr-promoters/resolve-identity.ts` — full rewrite: 5 resolution paths + Levenshtein helper.
- `packages/db/src/schema/index.ts` — re-exports new alias schema.

---

## Session Summary — 2026-05-10 (OCR build, Phase 4 — review + queries + UI)

### Review CLI (`apps/worker/src/ingest-ocr-review-cli.ts`)

`pnpm --filter worker ingest-ocr-review <subcommand>`:

- `status` — per-batch summary: `batch | match | capture_kind | total | pending | reviewed | rejected | avg_conf`.
- `--extraction <id> [--status reviewed|rejected]` — flip a single extraction; cascades `review_status` to every `match_events` / `match_period_summaries` / `match_shot_type_summaries` / `player_loadout_snapshots` row referencing it via `ocr_extraction_id`. Sets `ocr_extractions.reviewed_at` when not pending.
- `--batch <id> --auto-approve [--confidence-threshold 0.85]` — auto-flip every `pending_review` extraction in the batch with `overall_confidence >= threshold`, plus its cascade. Default threshold 0.85.
- `--batch <id> --status reviewed|rejected` — bulk flip every extraction in a batch regardless of confidence.

Cascade is scoped to rows owned by the flipped extraction id. Cross-screen dedup means a goal can be referenced by Events and Action Tracker — flipping just one of those extractions only moves the rows it currently points at.

All flips are wrapped in a single transaction so partial cascade is impossible.

### DB queries (`packages/db/src/queries/`)

Three new query files exposed via the `@eanhl/db/queries` subpath:

- **`match-enrichments.ts`** — `getMatchPeriodSummaries(matchId)` and `getMatchShotTypeSummaries(matchId)`. Both gate OCR rows on `review_status = 'reviewed'`; EA-source rows always pass.
- **`match-events.ts`** — `getMatchEvents(matchId)` returns events joined with `match_goal_events` + `match_penalty_events` + 6 LEFT-JOINs on `players` (one per nullable identity FK: actor / target / scorer / primaryAssist / secondaryAssist / culprit). Resolved players surface as nested `{ id, gamertag }` objects via `jsonb_build_object`; unresolved rows fall through with snapshot strings only.
- **`player-loadouts.ts`** — `getPlayerLoadoutSnapshots(playerId, limit=20)` returns reviewed snapshots newest-first, with x_factors and attributes attached.

### UI surfaces (`apps/web/src/`)

Match detail page (`/games/[id]`) gains three sections — each hides itself when the source query returns 0 rows:

- **Period summary** (`components/matches/period-summary.tsx`) — period × {goals, shots, faceoffs} grid, BGM·OPP split per cell, "—" for null cells.
- **Shot mix** (`components/matches/shot-mix.tsx`) — wrist / snap / backhand / slap / deflection / power-play breakdown per side. Uses the full-game (period_number = -1) row when present, otherwise sums per-period rows.
- **Event log** (`components/matches/event-log.tsx`) — period-grouped goal + penalty list. Resolved players link to `/roster/[id]`; unresolved snapshots render as plain text. Goals show scorer + goal_number_in_game + up to 2 assists; penalties show culprit + infraction + minutes. Strips OCR ornaments (`RT`/`LT`) from period labels for display.

Player profile page (`/roster/[id]`) gains:

- **Loadout history strip** (`components/roster/loadout-history-strip.tsx`) — up to 4 most-recent reviewed loadout snapshots side-by-side. Each card shows position, build class, height/weight/handedness, level, X-factors, and per-group attribute averages (Technique/Power/Playstyle/Tenacity/Tactics).

### End-to-end verification (match 250: BGM 4-3 4th Line)

Approved batches 1, 2, 3, 4, 5, 7, 9, 10 via `--auto-approve --confidence-threshold 0.85`. Cascade tally: 14 extractions reviewed → 5 period_summaries + 8 shot_type_summaries + 20 events + 2 loadout_snapshots flipped to `reviewed`.

Smoke check via `next dev`:

- `/games/250` rendered all three OCR sections. Confirmed 7 BGM/OPP goals in event log with full assist chains; resolved silkyjoker85 + MrHomiecide link to roster pages, opponent display names (Toews, S. Zubov) render as plain text.
- `/roster/11` (MrHomiecide) renders the loadout history strip with class + measurements + X-factors + group averages.
- `/roster/2` (silkyjoker85) correctly hides the strip — no reviewed loadout snapshot for this player yet.

### Files added

- `apps/worker/src/ingest-ocr-review-cli.ts` + `package.json` script
- `packages/db/src/queries/match-enrichments.ts`
- `packages/db/src/queries/match-events.ts`
- `packages/db/src/queries/player-loadouts.ts`
- `apps/web/src/components/matches/period-summary.tsx`
- `apps/web/src/components/matches/shot-mix.tsx`
- `apps/web/src/components/matches/event-log.tsx`
- `apps/web/src/components/roster/loadout-history-strip.tsx`
- `docs/ocr/features-and-metrics.md` — features catalog reconstructed from the 2026-05-10 brainstorm

### Files modified

- `packages/db/src/queries/index.ts` — re-exports the 3 new query modules
- `apps/web/src/app/games/[id]/page.tsx` — fetches OCR queries, renders 3 new sections (period summary + shot mix between TeamStats and Goalie spotlight; event log after Scoresheet)
- `apps/web/src/app/roster/[id]/page.tsx` — fetches loadout snapshots, renders strip after ContributionSection

---

---

## Session Summary — 2026-05-10 (OCR schema integration)

### 11-table OCR evidence layer added to the database

Plan: `docs/superpowers/plans/2026-05-10-ocr-schema-integration.md`

**New schema files (4 files, 11 tables):**

- `packages/db/src/schema/ocr-pipeline.ts` — Foundation layer
  - `ocr_capture_batches` — batch import sessions (per video/screenshot set)
  - `ocr_extractions` — per-frame/per-file extractions with raw JSON, confidence, review status
  - `ocr_extraction_fields` — per-field breakdown for promoted values

- `packages/db/src/schema/match-enrichments.ts` — Period/shot-type aggregates
  - `match_period_summaries` — goals/shots/faceoffs per period per source ('ea' | 'ocr' | 'manual')
  - `match_shot_type_summaries` — wrist/slap/backhand/snap/deflections/PP shots; period_number=-1 sentinel for full-game aggregate

- `packages/db/src/schema/match-events.ts` — Normalized event log
  - `match_events` — event-level rows (goal/shot/hit/penalty/faceoff), check constraints on event_type + team_side, nullable actor/target identity until reviewed
  - `match_goal_events` — 1:1 extension for goal detail (scorer, assists, goal_number_in_game)
  - `match_penalty_events` — 1:1 extension for penalty detail (infraction, penalty_type, minutes)

- `packages/db/src/schema/player-loadout.ts` — Build/loadout snapshots
  - `player_loadout_snapshots` — per-player build captured from Pre-Game Lobby or Loadout View
  - `player_loadout_x_factors` — up to 3 X-factors per snapshot (slot 0/1/2)
  - `player_loadout_attributes` — 23 known attribute keys (Technique/Power/Playstyle/Tenacity/Tactics groups)

**Migration:** `0028_omniscient_kid_colt.sql` — generated, edited to strip extraneous auth table DDL (Drizzle snapshot drift from migrations 0026/0027), and applied successfully.

**DB after migration:** 11 new tables confirmed present. All FK chains, check constraints, and unique indexes applied. Identifier-truncation NOTICEs from PG for long FK names are harmless (auto-truncated to 63 chars).

**Index updated:** `packages/db/src/schema/index.ts` exports all 4 new schema files.

**Design decisions preserved:**

- OCR is a 3rd evidence layer — never overwrites EA API canon (`ea_member_season_stats`, `player_match_stats`)
- `review_status` pattern on all enrichment tables: `'pending_review' | 'reviewed' | 'rejected'`
- `source` column on period summaries and events: `'ea' | 'ocr' | 'manual'`
- Self-referential FK on `ocr_extractions.duplicate_of_extraction_id` uses Drizzle's `(): AnyPgColumn =>` lambda syntax

**What's next:**

1. Worker transform: parse OCR CLI output for supported screen types and insert into new tables
2. Queries: write read-side query functions in `packages/db/src/queries/` for the new tables
3. UI: surface per-period breakdowns, shot-type charts, event feeds, and loadout views once data flows in

---

---

## Session Summary — 2026-05-09 (OTL classification + home record strip)

### EA OT/OTL detection — landed end-to-end

Until today the worker emitted only `WIN | LOSS | DNF` because no overtime
fixture had been mined to confirm the OTL code. After cross-referencing 71 NHL
26 BGM payloads, the full result-code set is:

|               Code | Meaning                       | Mapped to        |
| -----------------: | ----------------------------- | ---------------- |
|                `1` | Regulation WIN                | `WIN`            |
|                `2` | Regulation LOSS               | `LOSS`           |
|                `5` | OT / SO WIN (still 2pts)      | `WIN`            |
|                `6` | OT / SO LOSS (1pt OTL credit) | **`OTL`** ✨ new |
|               `10` | DNF                           | `DNF`            |
| `16385` (`0x4001`) | WIN by opponent forfeit       | `WIN`            |

Smoking gun: every code-5/code-6 match has a strict 1-goal margin and the
codes always pair (`5 ↔ 6`). OT and shootout share the same code — EA does not
distinguish them — so both fold into `OTL`.

**Files touched:**

- [`apps/worker/src/transform.ts`](apps/worker/src/transform.ts) — `deriveResult()` extended; code 6 → `OTL`, unknown codes still fall back to score-derived WIN/LOSS so future variants don't silently break.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Known Assumption #7 updated with the full code table; added assumption #8 about `clubs[id].result` codes.
- [`research/investigations/ea-overtime-detection.md`](research/investigations/ea-overtime-detection.md) — full evidence + bitfield speculation (new file).
- [`research/investigations/ea-api-data-gaps.md`](research/investigations/ea-api-data-gaps.md) — added "OT/SO Outcome Detection" entry under "Confirmed Available."
- Worker rebuilt and `reprocess --all` run; aggregates auto-recomputed.

**DB after reprocess:** 5 historical losses reclassified to `OTL`. Distribution went 40 W / 19 L / 0 OTL / 12 DNF → **40 W / 14 L / 5 OTL / 12 DNF**.

### Home record strip — newest-left layout

[`apps/web/src/components/home/record-strip.tsx`](apps/web/src/components/home/record-strip.tsx)

- [`record-strip.css`](apps/web/src/components/home/record-strip.css):

* Last-10 dot ribbon flipped: newest match on the **left**, 10-games-ago on the right. Drop the `.reverse()` and swap the meta labels (`← Most recent` / `10 games ago →`).
* Accent rim outline moved from `:last-child` → `:first-child` so it highlights the most-recent dot.
* DNFs now count as losses for both the W-L-OTL line in "last 10" and for streak detection (`streakKindFor(DNF) → 'L'`). DNF dots still render with the `·` glyph + loss-style red so disconnects remain visually distinct, but they no longer break a loss streak.

---

## Session Summary — 2026-05-05 (profile page restructure)

### Restructured `/roster/[id]` from 1700 → 217 lines with new IA

Plan: `docs/superpowers/plans/2026-05-05-profile-page-restructure.md`. Branch: `feat/skater-stats-expansion` (continuing the same branch as the skater stats work).

**New IA:**

- ProfileHero (richer two-column layout) — left: gamertag, position/archetype/country pills, bio, **AKA strip** (folded gamertag history), SKATER/GOALIE role selector. Right: **THIS SEASON** stat strip (NHL 26 EA totals), **CAREER TOTALS** stat strip (sum across NHL 22-26), position usage donut, jersey number watermark.
- RecentFormStrip (compact LAST 5 panel with form dots + record + G/A + +/- + best-recent callout)
- StatsRecordCard (tabbed wrapper) — **Season-by-Season** tab shows unified per-title rows with EA/Archive source badges; **Game Log** tab shows existing PlayerGameLogSection
- ClubStatsTabs (existing 5-tab thing, skater only) / ComingSoonCard placeholder for goalie
- ContributionSection (existing donut + metric bars, role-aware)
- ChartsVisualsSection — bottom zone with the real TrendChart (15-game bars) + 3 wireframe placeholders (Shot Map, Overall Archetype, Awards)

**Data layer (commits 1ab8d9e, 93e9d87):** New `getPlayerCareerSeasons(playerId)` query in `packages/db/src/queries/players.ts` returns one row per game title blending sources — NHL 26 from `ea_member_season_stats` (EA-authoritative), NHL 22-25 from `historical_player_season_stats` aggregated across modes via existing `getHistoricalSkaterStatsAllModes` / `getHistoricalGoalieStatsAllModes` helpers. Title-list filter aligned to helper-filter to prevent silent skip of titles with only position-specific scope rows.

**Component extractions** (no behavior change — refactor for maintainability):

- `apps/web/src/components/roster/contribution-section.tsx` (commit 01658e9)
- `apps/web/src/components/roster/section-heading.tsx` (commit 01658e9)
- `apps/web/src/components/roster/trend-chart.tsx` + `recent-form-strip.tsx` (commit 0aab56c — split TrendSection)
- `apps/web/src/components/roster/position-donut.tsx` (commit a60bc6d)

**New components** (commits ee8bc1e, ffceaca, d04baf6, 2cfa40c, 8c2aece):

- `career-seasons-table.tsx` — unified per-title table, filters by role, EA/Archive source badges, derives SHT% / P/GP from underlying counts, +/- color coding
- `stats-record-card.tsx` — Client Component tabbed wrapper (Server Components passed as ReactNode slots)
- `coming-soon-card.tsx` — placeholder primitive with dashed border + "Coming soon" pill
- `profile-hero.tsx` — 435-line two-column hero with stat strips, AKA, role selector, position donut
- `charts-visuals-section.tsx` — bottom zone wrapper combining real trend chart + 3 wireframes

**Page restructure (commit 7635a43):** Page file shrank from 1168 → 217 lines (951 deletions, 41 insertions). Deleted inline functions: `HeroSection`, `HeroStatStrip`, `CurrentSeasonSection`, `SeasonStatCard`, `CareerStatsTable`, `EASeasonStatsTable`, `PreviousSeasonStatsTable`, `HeroChip`, `EmptyPanel`, `computeSkaterArchetype`, `roleHref`, `previousTitleSlug`, `buildPreviousSeasonTotals`, dead helpers (`perGame`, `formatDecimal`, `formatDbPct`, `formatSigned`, `signedClass`), Gamertag History `<section>` (folded into ProfileHero AKA). Removed `getPlayerCareerStats`, `getGameTitleBySlug`, `getHistoricalSkaterStatsAllModes`, `getHistoricalGoalieStatsAllModes` imports — they're called only via `getPlayerCareerSeasons` now.

**Smoke check (silkyjoker85, /roster/2):**

- Skater hero THIS SEASON: GP 520, G 426, A 691, PTS 1117, P/GP 2.15, +/- +169, SOG 1841, SHT% 23.1%, HITS 2067
- Skater hero CAREER TOTALS: GP 1987, G 2047, A 2854, PTS 4901, +/- +854, SOG 8243, SHT% 24.8%, HITS 5630, PIM 1767
- Goalie hero THIS SEASON: GP 25, W-L-OTL 6-19-0, SV% 74.00%, GAA 4.66, SO 1
- Goalie hero CAREER TOTALS: GP 209, W 92, L 105, OTL 12, SO 12
- Stats Record Season tab shows 5 rows (NHL 26 EA, NHL 22-25 Archive); Game Log tab shows existing per-game data
- ContributionSection, Club Stats 5-tab, Charts & Visuals all rendering

**Verification:** lint clean, typecheck clean, both `/roster/2` and `/roster/2?role=goalie` return 200, dev server stable on http://localhost:3002 throughout development.

**Out of scope (future plans):**

- Goalie Club Stats Tabs (Tabs 6-8) — currently a `<ComingSoonCard>` placeholder for goalie role
- Real Shot Map (data captured in `skGoalsLocationOnIce*` / `skShotsLocationOnIce*`, never visualized)
- Real Overall Archetype radar
- Real Awards
- Career SV%/GAA aggregation (currently shows `—` because helpers don't carry total saves/SA across rows)
- Backfill historical importer to produce `all_skaters` aggregate rows for players with only position-specific data (e.g. player 11 NHL 23 wing-only — silently excluded)
- Pre-existing `desc(gameTitleId)` sort bug in `getPlayerCareerStats` / `getPlayerEASeasonStats` / `getPlayerProfileOverview` — masked by current single-row data shape; will surface when NHL 27 launches

---

## Session Summary — 2026-05-05 (skater stats expansion)

### Captured ~50 missing skater metrics from EA `/members/stats` and surfaced them as a 5-tab Club Stats UI on the player profile

Plan: `docs/superpowers/plans/2026-05-05-skater-stats-expansion.md`. Branch: `feat/skater-stats-expansion`.

**Discovery:** EA's `/members/stats` endpoint returns ~150 fields per player; our `transform-members.ts` was discarding ~125 of them. All 96 ChelHead Club Stats metrics (less the 5 EA-internal ones) are present in the API. Spatial/hot-zone data is also in the raw payload (deferred to a future plan).

**Schema (commit 90bc49c):** Migration `0020_silly_crystal.sql` adds 49 new columns to `ea_member_season_stats` covering ChelHead Tabs 1-5: skater record split (skater_wins/losses/otl/winner_by_dnf/win_pct/dnf), aggregate (games_completed, games_completed_fc, player_quit_disc), position GP splits (lw/rw/c/d_gp), scoring (power_play_goals, short_handed_goals, game_winning_goals, hat_tricks, prev_goals/assists), shooting (shots_per_game, shot_on_net_pct, breakaways/\_goals/\_pct), playmaking (passes, pass_attempts, interceptions, dekes/\_made, deflections, saucer_passes, screen_chances/\_goals, possession_seconds, xfactor_zone_used), defense (hits_per_game, fights/\_won, blocked_shots, pk_clear_zone, offsides/\_per_game, penalties_drawn), faceoffs (faceoff_total/wins/losses, penalty_shot_attempts/goals/pct).

**EA client typing (commit 6180fbc):** `EaMemberStats` interface in `packages/ea-client/src/types.ts` extended from 5 named fields to ~80, preserving EA's inconsistent naming (`skDNF`, `gamesCompletedFC`, `xfactor_zoneability_times_used`) verbatim. Catch-all index signature retained.

**Transform (commit 0840b7c):** `transformMemberStats()` body in `apps/worker/src/transform-members.ts` rewritten to map all 49 new fields through existing parser helpers. Function signature, helpers, and goalie field mappings unchanged.

**Worker upsert bug fix (commit 6b5d3ea):** Discovered during verification that `apps/worker/src/ingest-members.ts` had an explicit `onConflictDoUpdate({ set: { ... } })` clause hard-coded with the OLD column list. New columns were INSERTED on first row but never UPDATED on existing rows, leaving all 10 club members with zeros. Replaced explicit SET with `set: { ...statsRow, lastFetchedAt: now }`. Future schema additions automatically participate in upserts.

**Query layer (commit efd8eef):** `getPlayerEASeasonStats` in `packages/db/src/queries/players.ts` widened from 27 to 80 selected fields. Drizzle's inferred return type ripples to `PlayerEASeasonRow` automatically.

**UI component (commit dd6cb84):** New `apps/web/src/components/roster/club-stats-tabs.tsx` (257 lines, client component). 5 tabs (Overview, Scoring, Playmaking, Defense, Faceoffs) with 67 stat items, responsive 2/3/4-col grid, useState-backed tab switching, null-aware percentage rendering. `formatPossession(seconds)` helper converts to "Xh Ym" format.

**Wired onto profile (commit a431b39):** 3-line addition to `apps/web/src/app/roster/[id]/page.tsx` — import + conditional render block between EA Season Totals and Previous NHL Season sections. Render gated on `selectedRole === 'skater' && eaStats[0]` — goalie role hides it.

**End-to-end smoke check (silkyjoker85, /roster/2):** All values flow correctly from EA API → DB → query → component → browser. Spot-checked against HAR capture:

- Overview: 545 GP, 466 completed, 67 forced, 275-222-23 record, 52% win, 101 wins by DNF, 79 quit disconnects, center fav position, position split 334/133/33/20 C/D/RW/LW
- Scoring: GWG 22, Hat Tricks 45, Breakaways 71/28/39.40%, Shooting 23.10%, Shot on Net 81.90%
- Playmaking: Passes 6725/8945/75.20%, Dekes 526/246, Deflections 137, Saucer 61, Screen 2167/0, Possession 32h 40m
- Defense: Hits/GP 4.00, Fights 9/4, Blocked 310, GV 2543, TA 1358, PK Clear 54, Offsides 166/0.30, PIM 361, Penalties Drawn 135
- Faceoffs: FO 6447 total / 3391/3056/52.60%, Pen Shot 26/15/57.70%, TOI 429h 37m, +/- +169, Prev G/A 18/31

All numbers match HAR exactly (silky hadn't played new games since capture).

**Out of scope (deferred to future plans):**

- Goalie tabs 6-8 (Goalie Overview / Saves / Situations) — requires ~30 more goalie columns and a parallel `<GoalieClubStatsTabs>` component
- Spatial hot-zone data (`skGoalsLocationOnIce1-16`, `skShotsLocationOnIce1-16`) — IS available in the API, requires `jsonb` column or dedicated table + rink-overlay heatmap UI
- Per-game derived metrics (gamescore, percentile vs teammates) — derive at query time
- Backfill of historical NHL titles (older `ea_member_season_stats` rows have 0/NULL for new columns)

**Verification:** `pnpm --filter web lint` clean, `pnpm build` 4/4 tasks passed, runtime smoke at `/roster/2` (skater) shows all 5 tabs with HAR-matching data, `/roster/2?role=goalie` hides the section. Loose PNG screenshots in repo root not committed (debug artifacts).

---

## Session Summary — 2026-05-03 (player profile revamp)

### Player profile Phase 1 — significant redesign landed

Full rewrite of `apps/web/src/app/roster/[id]/page.tsx` (~1250 lines) plus targeted changes to `packages/db/src/queries/players.ts`.

**Hero upgrades:**

- Jersey number (#10 for silkyjoker85), nationality (CANADA), archetype pill (PLAYMAKER / SNIPER / etc.), bio text — all pulled from `player_profiles` table
- Position usage donut (SVG, `hidden lg:flex`) replaces the old generic silhouette. Segments per position (center/LW/RW/D/goalie) sized by game count, color-coded.
- "Also plays Goalie" inline stat strip when dual-role GP > 0
- Role selector pills (SKATER / GOALIE) using URL param `?role=`. Defaults to `primaryRole`, clamped to roles with actual data.

**New stat strip:** GP · PTS (featured, accent color) · PTS/GP · G · A · +/- · Hits · APP.RECORD — role-aware (goalie shows W-L-OTL, SV%, GAA instead)

**Anchor nav updated to:** SEASON / FORM / PROFILE / CAREER / EA TOTALS / GAME LOG

**Current season stat grid** (role-aware):

- Skater: GP, PTS, PTS/GP, G, G/GP, A, A/GP, +/-, Hits, Hits/GP, SHT%, SOG/GP
- Goalie: GP, W-L-OTL, SV%, GAA, SO, Saves, Saves/GP

**Trend chart (RECENT FORM section):** SVG bar chart of points-per-game (or SV% for goalie) over last 15 role-filtered games, bars colored by result (emerald=W, amber=OT, rose=L/DNF), dashed average reference line. Sidebar shows LAST 5 form dots, record, G/A (or GA), +/-, BEST RECENT game.

**Contribution section renamed SEASON PROFILE:** ContributionDonut (6-segment multicolor SVG donut, same stroke-dasharray technique as position donut) replaces old ContributionWheelSection radar polygon. Metric bars now have per-metric colors matching donut segments.

**DB changes:** `PlayerProfileOverview` interface split `contributionSummary`/`recentForm` into dual-role fields (`skaterContribution`, `goalieContribution`, `skaterRecentForm`, `goalieRecentForm`, `trendGames`). `getPlayerProfileOverview` builds both role paths independently.

**Silkyjoker85 profile seeded:**

```sql
UPDATE player_profiles SET jersey_number=10, nationality='Canada', preferred_position='center',
bio='Started as a goalie with the Speds, transitioned into a scoring winger, and now plays as a playmaking center.'
WHERE player_id=2;
```

**Verification:** lint clean (13 errors fixed — unused imports, template literal numbers, optional chain), build 4/4 tasks passed. Playwright smoke check at `/roster/2` (desktop 1440px) confirmed: position donut in hero with C/D/LW breakdown, role selector pills, stats grid with per-game rates, trend bar chart with result colors + dashed avg line, contribution donut with 6 color segments, metric bars with matching colors.

**What's next (Phase 2 candidates):**

- Seed `player_profiles` enrichment for remaining players (currently only player_id=2 has data)
- Per-game rate columns in career/EA tables
- Goalie role view smoke check (I-amCaKee, player_id=7)
- Previous season section design polish (currently shows raw EA data)

---

## Session Summary — 2026-05-04 (latest)

### Homepage Title Records — pill mode selector redesign + section reorder

Replaced the multi-column-mode table from the prior session with the correct design: one stat row per title, mode pill controls which mode's data is shown.

- **Mode pills:** All / 6s / 6s+G / 3s — client-side `useState` in `TitleRecordsTable` client component (`apps/web/src/components/home/title-records-table.tsx`). Pill switches the stat set for all title rows instantly.
- **Stat columns:** GP, W, L, OTL, W%, GF/G, GA/G, TOA, PP%, PK% — same schema for all pills; individual cells show "—" where data is unavailable for that mode.
- **Playlist-to-pill mapping** (explicit, in `page.tsx` comments):
  - 6s → `eashl_6v6` / `clubs_6v6` (primary EASHL 6v6)
  - 6s+G → `6_player_full_team` / `clubs_6_players` (full-squad mode)
  - 3s → `eashl_3v3` / `clubs_3v3` (primary EASHL 3v3; Threes excluded)
  - All → GP/W/L/OTL summed; GF/G and GA/G weighted by GP; TOA/PP%/PK% → "—" (can't cross-mode average)
- **Live NHL 26:** All, 6s, 3s pills use local `club_game_title_stats` aggregates. GF/G and GA/G computed from goals totals. 6s+G → "—" (live pipeline doesn't split sub-modes). TOA/PP%/PK% → "—" (not tracked live).
- **Batch query updated:** `getHistoricalClubTeamStatsBatch` now returns `avgGoalsFor`, `avgGoalsAgainst`, `avgTimeOnAttack`, `powerPlayPct`, `powerPlayKillPct` alongside the existing GP/W/L/OTL fields.
- **Section reorder:** Latest Result → Roster Spotlight → Scoring Leaders → Title Records → Recent Results → Division Standing.
- **Verification:** lint clean, build 4/4, smoke check confirmed all 4 pills, 10 stat columns, 5 title rows (correct GP totals: NHL 26=59, NHL 25=250, NHL 24=866, NHL 23=507, NHL 22=372). Section order confirmed correct in rendered HTML.

---

## Session Summary — 2026-05-04 (earlier)

### Homepage cross-title records table

Replaced the old "Club Record" strip (single-title, mode-filtered) with a compact cross-title comparison table.

- **New query:** `getHistoricalClubTeamStatsBatch(gameTitleIds[])` in `packages/db/src/queries/historical-club-team.ts`. Fetches reviewed, `games_played > 0` rows for multiple title IDs in one DB call. Callers group by `gameTitleId` and map playlist slugs to logical columns.
- **Column mapping** (explicit, documented in page.tsx):
  - **6v6** → `eashl_6v6` / `clubs_6v6` (primary competitive matchmaking mode per era)
  - **Full Team** → `6_player_full_team` / `clubs_6_players` (full 6-player squad required incl. goalie)
  - **3v3** → `eashl_3v3` / `clubs_3v3` (primary competitive 3v3; excludes Threes casual mode)
  - NHL 26 (live): 6v6 and 3v3 sourced from local `club_game_title_stats` mode aggregates. Full Team column shows "—" — live data does not split sub-modes.
- **Table structure:** 5 rows (NHL 26 → NHL 22), 10 columns (Title + GP/W-L-OT/W% × 3 modes). Footer note clarifies data sources and live row limitation.
- **Visual:** NHL 26 row highlighted with accent background + "LIVE" badge. Mode filter (All/6s/3s) moved from record header to Roster Spotlight section where it actually applies.
- **Removed:** `RecordStrip`, `OfficialRecordUnavailable`, `LocalModeRecordStrip` components (all replaced by the table). `ClubSeasonalStats` no longer imported in page.tsx.
- **Verification:** lint clean, build 4/4, homepage smoke check confirmed all 5 title rows, all 3 mode columns, "LIVE" badge, mode filter in Roster Spotlight.

---

## Session Summary — 2026-05-03 (latest)

### Historical club-team totals wired into /stats

- **New query:** `getHistoricalClubTeamStats(gameTitleId, gameMode)` in `packages/db/src/queries/historical-club-team.ts`. Filters `review_status = 'reviewed'` and `games_played > 0`. Maps `GameMode | null` to playlist slugs via explicit constant arrays (no `game_mode` column on the table).
- **Exported** from `packages/db/src/queries/index.ts` as `export * from './historical-club-team.js'`.
- **UI:** New `ArchiveClubTeamSection` component in `apps/web/src/app/stats/page.tsx`. Renders a scrollable table with Playlist, GP, W, L, OTL, W%, GF/G, GA/G, TOA, PP%, PK% columns. Appears only for archive title views (guarded by `teamRows.length > 0` inside `ArchiveStats`). Live `/stats` route (no title param) unaffected.
- **Playlist labels:** `PLAYLIST_LABEL` constant maps raw DB slugs to display labels (e.g., `eashl_6v6` → `EASHL 6v6`). Falls back to raw slug if unknown.
- **Verification:** `pnpm --filter web lint` clean. `pnpm build` passes (4/4 tasks). Smoke checks confirm:
  - `/stats?title=nhl25` renders "Club team records" section with EASHL 6v6 / EASHL 3v3 / Threes rows, GF/G, PP%, TOA columns present.
  - `/stats` (live) has no "Club team records" section, existing stats render normally.

---

## Session Summary — 2026-05-03 (third)

### Historical club-team stats — reviewed JSON imported and verified

- **Source:** `tools/historical_import/club_team_stats/reviewed-club-team-stats.json` (17 records, NHL 22–25, hand-checked against `research/Previous_NHL_Stats/EXTRACT_TABLES_Hand_Checked.md`)
- **Import command:** `pnpm --filter @eanhl/db import:club-team <abs-path>/reviewed-club-team-stats.json`
- **Run 1:** `imported: 15, updated: 2, skipped: 0`
  - The 2 "updated" rows (`nhl24/eashl_3v3` and `nhl24/eashl_6v6`) existed from a prior hand-keyed pilot batch and were re-stamped to `importBatch = handchecked-2026-05-03`. Prior batch label is lost — if audit lineage matters, it was the original pilot import.
- **Run 2 (idempotency check):** `imported: 0, updated: 17, skipped: 0` — row count unchanged at 17. Fully idempotent.
- **DB state after import:**
  - `historical_club_team_stats` total rows: **17**
  - All 17 rows: `import_batch = handchecked-2026-05-03`, `review_status = reviewed`
  - Coverage verified: nhl22 (clubs_3v3, clubs_6_players, clubs_6v6, threes) · nhl23 (same) · nhl24 (6_player_full_team, eashl_3v3, eashl_6v6, quickplay_3v3, threes) · nhl25 (6_player_full_team, eashl_3v3, eashl_6v6, threes)
  - Representative spot-checks: `nhl22/clubs_6v6` (gp=29, pp_pct=20.90, toa=07:05) and `nhl25/eashl_6v6` (gp=89, pk_pct=80.10, toa=07:06) both match source exactly.
  - `raw_extract_json` confirmed to preserve `win_differential`, `faceoffs_lost`, `shutouts`, `penalty_shot_goals`, `penalty_shots`, `power_play_goals_against`, and threes-specific elim/round fields.
- **No code changes required.** Importer was already correct after the fix in the prior session.

---

## Session Summary — 2026-05-03 (later)

### Remediation pass — historical importer + query layer

Targeted fixes against issues surfaced in the project review.

- **Club-team importer fix.** `packages/db/src/tools/import-club-team-reviewed.ts` previously did a two-query/intersection lookup with a title-wide `LIMIT 1` and a playlist filter that was not scoped to the title. Re-importing an existing reviewed row could fall through to INSERT and trip the `(game_title_id, playlist)` unique index. Replaced with a single `WHERE game_title_id = X AND playlist = Y` lookup. Re-imports are now idempotent.
- **Historical club-member queries — semantics changed.** All four exported functions in `packages/db/src/queries/historical-club-member.ts` (`getClubMemberSkaterStats`, `getClubMemberGoalieStats`, `getClubMemberSkaterStatsAllModes`, `getClubMemberGoalieStatsAllModes`) now:
  - filter `review_status = 'reviewed'` explicitly (matches the player-card path; `pending_review` / `needs_identity_match` rows never reach the UI),
  - use `LEFT JOIN players` with `COALESCE(players.gamertag, gamertag_snapshot)` so unmatched rows (`player_id IS NULL`) survive and are visibly listed instead of silently dropped,
  - in the all-modes variants, group on a synthetic identity key (`'p:' || player_id` or `'g:' || lower(gamertag_snapshot)`) so unmatched rows aggregate independently of any existing matched rows.
- **`HistoricalSkaterStatsRow.playerId` / `HistoricalGoalieStatsRow.playerId` widened to `number | null`.** `apps/web/src/components/stats/skater-stats-table.tsx` and `goalie-stats-table.tsx` updated to render unmatched rows as a non-link span (`title="Unmatched gamertag — no current player profile"`) instead of a `/roster/<id>` link. Sort key falls back to `g${gamertag}` when `playerId` is null.
- **Combined-mode goalie GAA fix.** `getClubMemberGoalieStatsAllModes` previously computed a GA-weighted average of per-row GAAs (mathematically wrong). Replaced with the canonical season-level definition: `combined_gaa = SUM(total_goals_against) / SUM(goalie_gp where GA non-null)`, treating each `goalie_gp` as a 60-minute game, which is how the in-game leaderboard reports it. (No TOI is captured for the club-member source, so this is the most defensible aggregation available.)
- **Web hygiene.** Removed ~145 lines of dead code in `apps/web/src/app/roster/[id]/page.tsx` (`MODE_LABELS`, `gameModeHref`, `gameLogPageHref`, `GameModeFilter`, `GameLogPaginationNav`, `GameLog`, `GameLogDataRow`, unused `GameLogRow` alias) — all superseded by `<PlayerGameLogSection>`. Removed four unused historical-query imports in `apps/web/src/app/roster/page.tsx`. Cleared remaining `apps/web` lint failures (inline `import()` types in `stats/page.tsx`, `type` vs `interface` in `title-resolver.ts`, unused `goalieScore` in `match-recap.ts`, and surgical fixes to redundant null checks / non-null assertions in the touched roster files).

Standing rules to keep in mind for any future club-member work:

- The query layer no longer guarantees that returned rows have a non-null `playerId`. Components that need to link to a profile must guard on `playerId !== null`.
- Reviewed-only filtering is now explicit. Importing rows with `reviewStatus: 'pending_review'` or `'needs_identity_match'` will keep them out of the UI until the review pass flips them to `'reviewed'`.
- The combined-mode goalie GAA assumes `goalie_gp` corresponds to standard 60-minute games. If a future title exposes partial-period records, this assumption needs to be revisited.

---

## Session Summary — 2026-05-03

### Club/team stats — third historical source landed end-to-end (review-pending)

Added a third intentionally-separate legacy source for club-level totals from the in-game `STATS → CLUB STATS` screen.

- **Schema:** `historical_club_team_stats` (one row per `(game_title_id, playlist)`). Wide nullable column set covering ~40 metrics — record/W-L, goals, shots, hits, PIM/PP, faceoffs/breakaways/one-timers/blocks, plus `avg_time_on_attack` text. Provenance fields: `source_asset_paths text[]`, `raw_extract_json jsonb`, `import_batch`, `review_status`, `confidence_score`, `notes`. Migration `0019_dashing_the_hood.sql`.
- **Importer:** `packages/db/src/tools/import-club-team-reviewed.ts` (`pnpm --filter @eanhl/db import:club-team`). Transactional UPSERT keyed on `(game_title_id, playlist)`. Rejects unknown metric keys.
- **Hand-keyed pilots imported (DB):** `nhl25 / eashl_6v6` and `nhl25 / eashl_3v3`. 2 canonical rows live in `historical_club_team_stats`.
- **Dedicated extractor:** `tools/historical_import/club_team_stats/extract_club_team_stats.py`. RapidOCR full-image, row clustering by y-centre, label/value pairing per row, greedy known-label-prefix split for cross-column glued labels. Outputs the exact reviewed-pilot JSON shape with `reviewStatus='pending_review'`. No reuse of the player-card video extractor or the club-member member-table extractor.
- **Review queue across NHL 22–25:** `tools/historical_import/club_team_stats/run_review_queue.py` ran the extractor over all 17 logical playlist pairs (4 NHL 22 + 4 NHL 23 + 5 NHL 24 + 4 NHL 25). 17 reviewable JSONs written, 0 failures. Aggregate index at `_review_index.json` with per-playlist confidence, label-glue null counts, arithmetic-sanity flags, and pilot-comparison data where a hand-keyed pilot exists.
- **Validation against hand-keyed pilots (NHL 25):** `eashl_6v6` extractor → 36/39 matches, **0 mismatches**. `eashl_3v3` extractor → 18/26 matches; 4 of the 6 mismatches are pilot-data errors the extractor caught (e.g. `hits_per_game 7.5` confirmed by `836/111`; pilot had `1.5`).
- **No DB import for the queue.** Per the brief, the queue is a review surface, not blind ingestion. The user is the final reviewer.

Tooling under `tools/historical_import/club_team_stats/`:

- `extract_club_team_stats.py` — extractor
- `run_review_queue.py` — driver across all titles/playlists
- `compare_to_pilot.py` — diff extractor output vs hand-keyed pilot
- `augment_review_index.py` — post-process index with pilot comparison
- `_review_index.json` — aggregate review summary
- `nhl25_eashl_6v6_pilot.json`, `nhl25_eashl_3v3_pilot.json` — hand-keyed truth (preserved, not overwritten)
- `<title>__<playlist>.extract.json` × 17 — extractor outputs, distinct filename pattern from hand-keyed pilots

### Identity reconciliation pass

- `Stick Menace` (`players.id=3`, active) ↔ `StickMenace` (`players.id=22`, inactive) collapsed. 18 `historical_player_season_stats` rows reassigned to `id=3`. `player_gamertag_history` for `id=3` now has `StickMenace` as a closed historical era (2021-09 → 2023-08) and `Stick Menace` as the open current entry. `id=22` deleted.
- No collision risk: `id=3` had zero `historical_player_season_stats` rows; the merge was free.
- All other historical-source identity mismatches (`HenryTheBobJ`, `AwesomeLion50`, etc.) are by-design `gamertag_snapshot` preservation — `player_id` was already correct in those cases.
- Final scan: zero same-simplified-name duplicates remaining across the 23 `players` rows; zero unmatched `historical_club_member_season_stats` rows.

### Cleanup at end of session

- Removed two duplicate extractor outputs that lived under `research/Previous_NHL_Stats/NHL_25/nhl25_eashl_*.extract.json` (validation-pass leftovers). Canonical home for extractor outputs is `tools/historical_import/club_team_stats/<title>__<playlist>.extract.json`.

### What's next (no active workstream — all of these are optional)

1. **Reviewer pass on the 17 club-team-stats extract JSONs.** Per-playlist burden: 0–5 label-glue nulls to fill from the screenshot, plus one arithmetic anomaly to verify (`nhl24/eashl_6v6 pim=144420` looks doubled-up). Once reviewed, flip `reviewStatus` to `reviewed` and run `import:club-team` to land them in the DB.
2. **Schema expansion** for currently-unmodelled labels in club/team stats: `Win Differential`, `Faceoffs Lost`, `Power Play Goals Against`, `Breakaway Goals`, `Avg Pass Attempts`, `Penalty Shot Goals`, `Penalty Shots`, `Shutouts`. Each is preserved verbatim in `rawExtract` so re-extraction is unnecessary.
3. **UI surfacing of club/team stats.** Currently nothing on `/stats` or `/roster` reads `historical_club_team_stats`. Out of scope until the review pass lands DB rows.
4. **Cross-title playlist normalisation.** NHL 22/23 use `clubs_*` playlist labels; NHL 24/25 use `eashl_*`. Stored as raw labels today. Decide later whether to add a `playlist_normalised` column or a lookup.

---

## Session Summary — 2026-05-02

### Historical Stats Import (NHL 22–25) — Complete

Two distinct legacy historical sources are now live and intentionally separate:

1. `historical_player_season_stats`

- player-card season totals
- broader player totals
- may include games for other clubs

2. `historical_club_member_season_stats`

- club-scoped member totals from `CLUBS -> MEMBERS` screenshots
- authoritative for "what this player did for the BGM in that title"

Third historical source (built, not yet fully reviewed/imported across titles):

3. `historical_club_team_stats`

- club/team totals from `STATS -> CLUB STATS` screenshots
- one row per `(game_title_id, playlist)`
- intended to become the authoritative legacy club-total source once the review queue is promoted and imported

Player-card pipeline counts below are reviewed rows in `historical_player_season_stats`.

| Title     | Reviewed rows |
| --------- | ------------: |
| nhl22     |            43 |
| nhl23     |            39 |
| nhl24     |            46 |
| nhl25     |            31 |
| **total** |       **159** |

Club-member pipeline counts below are canonical rows in `historical_club_member_season_stats`.

| Title     | Skater | Goalie |
| --------- | -----: | -----: |
| nhl22     |      7 |      3 |
| nhl23     |      6 |      3 |
| nhl24     |      8 |      4 |
| nhl25     |     10 |      1 |
| **total** | **31** | **11** |

Pipeline status:

- Extractor (`tools/historical_import/extract_review_artifacts.py`) validated across NHL 22–25.
- Importer (`packages/db/src/tools/import-historical-reviewed.ts`) stable; pool teardown closes via `await sql.end({ timeout: 5 })` in try/finally.
- GPU OCR working on RTX 3060 with explicit CUDA env (`OCR_USE_CUDA=1`, `OCR_INTRA_THREADS=1`, `OCR_INTER_THREADS=1`) and `LD_LIBRARY_PATH` pointing at the pip-bundled CUDA libs in the venv.
- Performance optimization is **not** the active workstream anymore. The kept improvements are: video-static-context cache (filters/footer_gamertag/highlight_rank only — `footer_summary` deliberately excluded), `cv2.grab/retrieve` skip-frame pattern, env-driven CUDA. The dHash-based header cache was rejected (0% hit rate against continuously scrolling tables) and reverted.

### Club/Team Stats Screenshot Pipeline — Review Queue Generated

The third historical source is no longer hypothetical.

Built:

- Schema: `historical_club_team_stats`
- Migration: `0019_dashing_the_hood.sql`
- Importer: `packages/db/src/tools/import-club-team-reviewed.ts`
- Extractor: `tools/historical_import/club_team_stats/extract_club_team_stats.py`
- Queue driver: `tools/historical_import/club_team_stats/run_review_queue.py`
- Review index: `tools/historical_import/club_team_stats/_review_index.json`

Current state:

- 17 logical playlist pairs discovered across NHL 22–25 (`4 + 4 + 5 + 4`)
- all 34 `club_stats__*.png` files extracted successfully
- one reviewable `*.extract.json` file generated per playlist
- OCR confidence per playlist is consistently high (`0.97–0.99`)
- dominant review burden is still top-row label glue creating 0–5 nulls per playlist
- one obvious arithmetic/OCR anomaly remains flagged for manual review:
  - `nhl24 / eashl_6v6` `pim = 144420`

Hand-keyed/imported pilot state:

- `nhl25 / eashl_6v6` pilot proven
- `nhl25 / eashl_3v3` pilot proven
- those two pilots validated the `(game_title_id, playlist)` grain and the wide-nullable schema design

Important rule:

- extractor outputs are review-assisted only
- do **not** blind-import the generated queue
- reviewer must fill label-glue nulls and correct obvious OCR shape errors first

Operational rules for any future OCR run:

- Use the GPU env. Don't run two OCR batches in parallel on one GPU.
- One title batch at a time.
- First inference on a fresh process is slow (model/runtime warmup).
- Salvage strategy on bad OCR fields: leave the typed column null rather than store a clipped value. Raw OCR remains in `stats_json` regardless.

### Website — Legacy Integration

Legacy seasons live inside the main routes (Hockey-Reference style). The dedicated `/archive/*` routes are deleted.

- `/stats` and `/roster` accept `?title=nhlXX` for any active or legacy title and render the appropriate view.
- Title selector pill bar shows all five titles (NHL 26 | 25 | 24 | 23 | 22). Active titles get a green dot. Selector + mode filter sit inline above the stats tables.
- For legacy titles:
  - `/roster` is club-scoped only and renders from `historical_club_member_season_stats`.
  - `/stats` renders two clearly-labeled sections:
    - `Club-scoped totals` from `historical_club_member_season_stats`
    - `Player-card season totals` from `historical_player_season_stats`
  - Chemistry, recent matches, depth chart, and team averages are hidden with explanatory copy.
- Player profile (`/roster/[id]`) — career-row Season cells link to `/stats?title=<slug>`. No per-title view on the profile itself.
- `/`, `/games`, `/games/[id]` remain NHL-26-only (live data) by design.
- `/archive/stats` and `/archive/roster` return 404.

Sanity-check verified end-to-end: every title × mode combination renders correctly; legacy views correctly hide live-only sections; the salvaged silky NHL 25 6s goalie row renders without crashing.

### Identity Reconciliation

- HenryTheBobJ (typo split) collapsed into HenryTheBobJr. 14 historical player-card rows reassigned via `BEGIN; UPDATE historical_player_season_stats SET player_id=1 WHERE player_id=19; DELETE FROM player_gamertag_history WHERE player_id=19; DELETE FROM players WHERE id=19; COMMIT;`.
- StickMenace (OCR/no-space) collapsed into Stick Menace. 18 player-card rows reassigned to `players.id=3`.
- Flopfish8015 and Utiz23 are represented as historical alt identities through `player_gamertag_history`; club-member rows were reconciled onto JoeyFlopfish and silkyjoker85 respectively.
- AwesomeLion50 resolves to AwesomeLion through `player_gamertag_history`.
- `adolph151` remains a separate retired member (`players.is_active=false`) and is intentionally preserved.
- `player_gamertag_history` and `gamertag_snapshot` fields still preserve legacy/typo strings for audit purposes — that's intentional, not a bug.

### Known Caveats (current truth, no fixes planned)

- `/stats?title=nhl99` (and any unknown slug) renders the NHL 26 default content correctly, but Next caches the redirect destination at the requested URL, so the address bar stays cosmetically `?title=nhl99`. Functionally correct, cosmetically stale. Not worth fixing.
- One salvaged historical row — `silkyjoker85` NHL 25 6s goalie — has `save_pct`, `total_saves`, and `total_shots_against` set to NULL by design (OCR clipped `save_pct` to "4675.000%"). Other typed fields (GP/W/L/OTL/GAA/GA) are valid. Renders as `—` in null cells.
- Club-member provenance is append-only by design. Re-imports grow `historical_club_member_stat_sources`; they do not rewrite prior provenance rows.
- Some club-member metrics are honestly null because the screenshots never exposed them for that title/view combination.

---

## Session Summary — 2026-05-01

### Match Detail Page Polish (`/games/[id]`)

- **Scoring model V3** (`match-recap.ts`) — Anchored to Luszczyszyn Game Score + NWHL Game Score published models. G:A ratio = 1.23:1. Four-tier structure: core offense → strong positive defensive → strong negative → light context. Full calibration log at `research/investigations/player-scoring-model.md`.
- **DTW gauge** (`possession-edge.tsx`) — Fixed 3 independent bugs: needle direction inverted, arc fill hardcoded at 50%, arc colors swapped. Arc now proportional to actual share (clamped [1,99]). Opponent TOA wired (was always in DB, view-model never passed it through).
- **Box score restructured** — Offense / Possession / Defense / Goalie grouping. Removed redundant "Box Score" utility group.
- **Scoresheet** — Position shown under player name (not separate column); SOG promoted; BGM header accent.
- **Opponent score filter fixed** — BGM keeps `score > 0` guard (AI bench suppression); opponent entries now pass through unconditionally. Previously dropped real opponent players with negative scores.
- **Star ordering fixed** — rank 1 = ★★★, rank 3 = ★.
- **Position pill `onLight`** — `rgba(0,0,0,0.42)` → `rgba(8,8,10,0.84)` bg + solid color border. Now readable on any card brightness.

### Score Card Polish (`/games` list)

- WIN = emerald glow + green bar; LOSS = rose glow + rose bar; OTL = amber
- Mode pills: 6s = violet, 3s = sky (distinct from each other and from result colors)
- `SplitStat` component: our number bold, their number muted
- Stat order: SOG → TOA → Hits → DtW
- FO% removed (always null — confirmed by DB query). DtW replaces Pass% as fourth stat.
- "BGM" abbreviation replaces "Boogeymen" in score panel (prevented overflow)
- "Private" badge for `club_private`; "Dominated"/"Outshot" quality badge at 65/35% shot share
- Form strip denominator fixed: `n = wins + losses + otl` (not `matches.length`)

### Roster Page (`/roster`)

- `RosterTable` deleted — replaced by `SkaterStatsTable` + `GoalieStatsTable` from `/stats`
- Season Summary Strip added above depth chart
- Goalie block: dynamic slot count (no more 3 empty placeholder slots)
- Position pill in player identity cell

### Player Profile (`/roster/[id]`)

- Removed `CurrentSeasonSnapshotSection` (duplicate of hero strip)
- Removed "Source Notes" card
- `HeroStatStrip` expanded: 8 cells (skaters), 7 cells (goalies). Wrapped in `overflow-x-auto`.
- Game Log reordered before Career Stats
- Archetype badge (Sniper/Playmaker/Enforcer/Two-Way/Balanced) added to hero
- Position usage as `PositionPill` chips
- Section headings upgraded; radar fill boosted; hero bloom boosted

### Navigation

- `EASHL · #19224` subtitle removed from navbar
- Mobile wordmark overflow fixed (removed `sm:hidden` duplicate span)

### Docs & Research (2026-05-01)

- HANDOFF, CLAUDE.md, ROADMAP, ARCHITECTURE, README all rewritten/updated
- `research/investigations/` created with 6 investigation docs:
  - `player-scoring-model.md` — formula research + validation
  - `ea-api-data-gaps.md` — confirmed missing/available fields
  - `dtw-gauge-bugs.md` — 3-bug investigation + geometry proofs
  - `mcp-and-tooling-setup.md` — Playwright fix, postgres MCP config
  - `ui-bugs-and-fixes.md` — running bug log
  - `match-detail-page-design.md`, `player-profile-design.md`, `roster-page-design.md`

### MCP Tooling

- Playwright MCP working (Chrome symlink: `/opt/google/chrome/chrome` → Chromium binary)
- PostgreSQL MCP: replaced deprecated `@modelcontextprotocol/server-postgres` with `mcp-postgres` (env var config, port 5433). Tools appear **after session restart**.

---

## What's Next

Current most likely follow-ups:

- **`historical_club_team_stats` UI surfacing** — 17 rows are now imported and reviewed. Nothing on `/stats` or `/roster` reads this table yet. Next step is to decide what to surface and build the query + component.
- **Legacy table enrichment** — surface club-member-only fields already in DB (`blocked_shots`, `giveaways`, `takeaways`, `interceptions`, `shots`, `shooting_pct`, `shutout_periods`) if/when useful.
- **Discord alerting cron** — `localhost:3001/health`, notify when stale >30 min.
- **`pg_dump` backup cron** — daily dump to external drive.
- **Player profile: EA season TOI** — long-duration format (`17d 22h 47m`); reference ratio ≈ 78% of platform total game time (silkyjoker85 NHL 26 reference); use as backfill estimate only, not claimed stat.

### Deferred

- Chemistry heatmap — revisit at ~80–100+ match depth.
- Hot-zone / rink shot maps — blocked by missing spatial data in EA payload.
- Content season filtering — schema supports it; no UI.
- **Reintroduce archetype pill on player carousel cards (home page)** — `ArchetypePillCompact` was wired in once and pulled back out 2026-05-09 because it crowded the card. Data path is intact (`player.archetype` is already on `PlayerCardData`); just re-add the `<div className="hpc-archetype">…</div>` block in `apps/web/src/components/home/player-card.tsx` and the matching `.hpc-archetype` margin rule in `player-card.css` once we decide on a less-crowded layout.

---

## Standing Architectural Decisions

### Data sources

- `gameMode === null` (active title) → `ea_member_season_stats` → labeled "EA season totals".
- `gameMode !== null` (active title) → `player_game_title_stats` → labeled "local tracked 6s / 3s".
- Legacy `/roster` → `historical_club_member_season_stats` → labeled "Club-scoped totals".
- Legacy `/stats` → two separate sections:
  - `historical_club_member_season_stats` → "Club-scoped totals"
  - `historical_player_season_stats` → "Player-card season totals" with explicit warning that they may include other clubs.
- Legacy club/team totals → `historical_club_team_stats` (17 rows imported, reviewed). UI not yet built — no surface reads this table.
- **Do not blend sources.** EA totals ≠ local aggregates ≠ player-card legacy totals ≠ club-member legacy totals ≠ club/team screenshot totals. Never substitute silently.

### Player identity

- `blazeId` absent from EA match payloads — gamertag is the real production identity anchor.
- `players.ea_id` nullable permanently.

### Stats semantics

- `wins/losses/otl` on `player_game_title_stats` = team record during player appearances (not goalie-only).
- `club_season_rank.wins/losses/otl` = SEASON-SPECIFIC. Never conflate with `club_seasonal_stats`.
- Goalie sections gated by `goalieGp > 0`, not declared position.

### Scoring model

- V3 frozen. Do not redesign weights without evidence.
- BGM entries: `score > 0` filter (AI bench suppression). Opponent entries: no filter.
- EA Ratings fields (Off/Def/Team) are not extracted — cannot replicate Chelhead's primary signal.

### Chemistry

- `CHEMISTRY_MIN_GP_WITH = 5`, `CHEMISTRY_MIN_GP_WITHOUT = 3`, `CHEMISTRY_PAIR_MIN_GP = 5`
- DNF included in pool. Win% denominator = gp (includes DNF).

### Roster / depth chart

- 1 game at a position is enough to count.
- Depth chart uses `ea_member_season_stats`; live stats tables use `player_game_title_stats`.
- Legacy roster is intentionally club-scoped and uses `historical_club_member_season_stats` only.
- Depth chart is intentionally hidden on legacy views — match-level data is not captured for those titles.

---

## Locked Schema Decisions

| Decision                          | Implementation                                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match uniqueness composite        | `UNIQUE(game_title_id, ea_match_id)` on `matches` + `raw_match_payloads`; surrogate bigserial PK                                                                                                                |
| `players.ea_id` nullable          | Permanently — blazeId absent in all real match payloads                                                                                                                                                         |
| Goalie stats same table           | Nullable goalie columns in `player_match_stats`                                                                                                                                                                 |
| Aggregate unique index            | `UNIQUE(player_id, game_title_id, COALESCE(game_mode, ''))` — handles NULL game_mode                                                                                                                            |
| Historical aggregate unique index | `UNIQUE(game_title_id, player_id, game_mode, position_scope, role_group)`                                                                                                                                       |
| Club-member unique indexes        | matched: `UNIQUE(game_title_id, game_mode, role_group, player_id)` where `player_id IS NOT NULL`; unmatched: `UNIQUE(game_title_id, game_mode, role_group, lower(gamertag_snapshot))` where `player_id IS NULL` |
| `transform_status`                | `('pending', 'success', 'error')`                                                                                                                                                                               |
| `result`                          | `('WIN', 'LOSS', 'OTL', 'DNF')`                                                                                                                                                                                 |

---

## What's Built

| Surface                 | Status                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` Home                | Live — club record, latest result, player carousel, leaders, recent results (NHL 26 only by design)                                                                                     |
| `/games`, `/games/[id]` | Live — paginated list, mode filter, form strip, trend bullets, quality badges (NHL 26 only)                                                                                             |
| `/stats`                | Live + legacy — title selector across all 5 titles; live view has chemistry + recent + team averages; legacy view shows `Club-scoped totals` and `Player-card season totals` separately |
| `/roster`               | Live + legacy — same selector; legacy view is club-scoped only and hides depth chart                                                                                                    |
| `/roster/[id]`          | Live — hero, radar, recent form, game log, career stats with per-season `?title=` links, EA totals, gamertag history                                                                    |

---

## Key Files

| File                                                            | Purpose                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md`                                          | System architecture + schema reference                                        |
| `docs/planning/product-roadmap.md`                              | Product direction + near-term build order                                     |
| `research/investigations/`                                      | Bug logs, design decisions, API research                                      |
| `packages/db/src/schema/`                                       | Drizzle table definitions (canonical)                                         |
| `packages/db/src/schema/historical-club-member-season-stats.ts` | Club-scoped historical member rows + provenance tables                        |
| `packages/db/src/schema/historical-club-team-stats.ts`          | Club/team historical totals per `(game_title_id, playlist)`                   |
| `packages/db/src/queries/historical.ts`                         | Reviewed-only historical queries (mode-specific + all-modes aggregating)      |
| `packages/db/src/queries/historical-club-member.ts`             | Club-scoped historical member queries used by legacy `/stats` and `/roster`   |
| `packages/db/src/queries/game-titles.ts`                        | `listGameTitles` (active), `listArchiveGameTitles` (inactive), slug resolvers |
| `packages/db/src/tools/import-historical-reviewed.ts`           | Reviewed-row importer for `historical_player_season_stats`                    |
| `packages/db/src/tools/import-club-member-reviewed.ts`          | Reviewed-row importer for `historical_club_member_season_stats`               |
| `packages/db/src/tools/import-club-team-reviewed.ts`            | Reviewed-row importer for `historical_club_team_stats`                        |
| `apps/web/src/lib/title-resolver.ts`                            | Unified active+archive slug resolver used by `/stats` and `/roster`           |
| `apps/web/src/components/title-selector.tsx`                    | TitleSelector / ModeFilter / EmptyState / `statsSourceLabel`                  |
| `apps/worker/src/transform.ts`                                  | Raw EA payload → structured DB types                                          |
| `apps/worker/src/aggregate.ts`                                  | Precompute player/club aggregates                                             |
| `apps/web/src/lib/match-recap.ts`                               | View-model builders for `/games/[id]`                                         |
| `tools/historical_import/extract_review_artifacts.py`           | OCR-driven extractor for legacy stat-table videos                             |
| `tools/historical_import/club_team_stats/`                      | Club/team screenshot extractor, pilot JSONs, and generated review queue       |
