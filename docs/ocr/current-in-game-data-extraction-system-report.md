# Current In-Game Data Extraction System Report

Updated: 2026-06-13

## Executive Summary

The current in-game data extraction system is a hybrid OCR pipeline built around:

- a Python video pipeline in [tools/video_ingest](/home/michal/projects/eanhl-team-website/tools/video_ingest),
- a screenshot-first OCR package in [tools/game_ocr](/home/michal/projects/eanhl-team-website/tools/game_ocr),
- and worker-side TypeScript promoters in [apps/worker/src](/home/michal/projects/eanhl-team-website/apps/worker/src).

At a high level, the system is now good at extracting post-game event data from recorded videos, especially the Action Tracker path. It is much less trustworthy for pre-game lobby/loadout extraction, where the architecture has improved but the data quality problem is not fully solved.

The blunt status is:

- Post-game video extraction: real, useful, and operational.
- Screen classification and reprocess workflow: mature enough to support candidate-run validation and activation.
- Secondary post-game screens: usable, but still weaker than Action Tracker and still carrying OCR-quality caveats.
- Pre-game loadout/lobby extraction: partially modernized, still the weakest part of the system.
- Real gameplay extraction: not a current delivered capability. The system mainly extracts menu, lobby, loadout, and post-game screens, not continuous live gameplay semantics.

## Scope Of The System

The current system is designed to extract structured data from stable NHL UI screens rather than from arbitrary gameplay frames.

Primary supported screen families:

- Pre-game lobby
- Pre-game loadout view
- Post-game action tracker
- Post-game player summary
- Post-game box score tabs
- Post-game events list
- Post-game faceoff map
- Post-game net chart

Key references:

- [tools/video_ingest/video_ingest/cli.py](/home/michal/projects/eanhl-team-website/tools/video_ingest/video_ingest/cli.py)
- [tools/video_ingest/video_ingest/configs/nhl26.yaml](/home/michal/projects/eanhl-team-website/tools/video_ingest/video_ingest/configs/nhl26.yaml)
- [tools/game_ocr/README.md](/home/michal/projects/eanhl-team-website/tools/game_ocr/README.md)

## Current Architecture

### 1. Pass 1: Video Screen Classification

The video pipeline samples a source video and classifies frames into screen states, then merges them into segments. The active NHL 26 config uses:

- `sample_fps: 1`
- `engine: viterbi_v2`
- per-screen minimum run and duration overrides

This behavior is configured in [nhl26.yaml](/home/michal/projects/eanhl-team-website/tools/video_ingest/video_ingest/configs/nhl26.yaml).

Pass 1 is responsible for deciding which windows of a video are worth extracting in Pass 2. This is the gating step that makes the rest of the pipeline viable.

### 2. Pass 2: Screen-Specific Extraction

Once Pass 1 emits segments, Pass 2 samples each supported segment at screen-specific rates and runs extraction.

Important current defaults:

- `player_loadout_view` uses `loadout_engine: typed_v1`
- `pre_game_lobby_state_2` uses `lobby_engine: typed_v1`
- post-game screens still rely on the established OCR/promoter path

Pass 2 can run in:

- artifact mode, where PNG frames are written to disk,
- or the newer typed-evidence path, where evidence JSON is produced and ingested without needing legacy PNG-driven OCR for those screens.

### 3. OCR And Parsing Layer

The lower-level OCR/parsing system lives in [tools/game_ocr](/home/michal/projects/eanhl-team-website/tools/game_ocr).

It includes:

- ROI-based extraction
- screen parsers
- screen classifier weights and state-machine configs
- reconciliation and calibration scripts
- labeling and training utilities

This package started screenshot-first and still carries that DNA. The newer video ingest system wraps and extends it rather than replacing it outright.

### 4. Worker-Side Ingest And Promotion

The TypeScript worker ingest path:

1. creates OCR batch records,
2. writes extraction rows and OCR field/evidence rows,
3. dispatches each screen to a promoter,
4. writes domain tables such as loadouts, lineups, and match events.

Core entry points:

- [apps/worker/src/ingest-ocr.ts](/home/michal/projects/eanhl-team-website/apps/worker/src/ingest-ocr.ts)
- [apps/worker/src/ocr-promoters/index.ts](/home/michal/projects/eanhl-team-website/apps/worker/src/ocr-promoters/index.ts)

Promoters currently exist for:

- pre-game lobby
- loadout
- post-game player summary
- box score
- net chart
- faceoff map
- events
- action tracker

### 5. Reprocess / Candidate Run Workflow

The system now has a proper candidate-run workflow for video reprocessing. A reprocess creates a candidate decoder run, ingests into that run scope, validates, and then activates only if the run passes.

This is one of the strongest parts of the current system because it imposes provenance and reduces the risk of silently overwriting canonical match data.

Reference:

- [tools/video_ingest/video_ingest/reprocess.py](/home/michal/projects/eanhl-team-website/tools/video_ingest/video_ingest/reprocess.py)

## What The System Extracts Reliably Today

### Post-Game Action Tracker

This is the best-performing extraction path in the current system.

What it does well:

- extracts event lists from post-game footage,
- resolves actor identity,
- recovers rink positions,
- supports dedup/reconciliation behavior,
- writes `match_events` with reviewable provenance.

Recent repo status indicates this path was validated on real footage and is the main delivered payoff of the OCR/video-ingestion revamp.

### Post-Game Screen Classification

The v2 classifier is now materially better than the legacy path and is wired into the current NHL 26 config. Post-game screens that previously fell into `unknown_or_transition` are now being classified and dispatched.

This matters because without correct classification the downstream extractors never run.

### Candidate Validation And Activation

The decoder-run model, validation step, and activation path are real strengths:

- extraction can be run against a non-active candidate,
- validation can block activation,
- activation can preserve canonical provenance instead of blindly replacing data.

Operationally, this is one of the most defensible parts of the system.

## What The System Extracts With Caveats

### Secondary Post-Game Screens

The secondary post-game extractors now work well enough to stop blocking good Action Tracker runs, but they are not as trustworthy as the Action Tracker path.

Current realities:

- team-side resolution had to be hardened using match metadata fallback,
- period-label parsing had to be made more tolerant,
- some secondary extractor failures are now warnings rather than fatal validation blockers,
- box-score number quality is still not fully trustworthy in all cases.

Reference:

- [docs/ocr/post-game-extractor-robustness-followup.md](/home/michal/projects/eanhl-team-website/docs/ocr/post-game-extractor-robustness-followup.md)

### Pre-Game Lobby And Loadout

This area has newer typed-evidence plumbing and much better architectural intent than before, but it remains the softest part of the system.

Known issues from the research and handoff trail:

- historical legacy parsing was badly broken,
- lobby taxonomy needed multiple relabel rounds,
- some classes are still label-starved,
- short-lived menu states are under-sampled,
- pre-game extraction quality is not yet at the same trust level as post-game Action Tracker.

Reference:

- [docs/ocr/pre-game-extraction-research.md](/home/michal/projects/eanhl-team-website/docs/ocr/pre-game-extraction-research.md)
- [docs/calibration/screen-classifier-v2-labeling.md](/home/michal/projects/eanhl-team-website/docs/calibration/screen-classifier-v2-labeling.md)
- [tools/video_ingest/tests/fixtures/screen-classifier-proving-bench/README.md](/home/michal/projects/eanhl-team-website/tools/video_ingest/tests/fixtures/screen-classifier-proving-bench/README.md)

## What Is Still Weak Or Incomplete

### 1. Pre-Game Extraction Quality

This is still the biggest extraction-quality weakness.

The earlier research doc was not subtle: the legacy pre-game system was partially implemented and mostly broken. While the repo has moved forward since then, that diagnosis still matters because it explains why pre-game trust is lower than post-game trust.

The unresolved themes are:

- insufficient clean labels for some classes,
- ambiguity between WoC menu variants and lobby states,
- dependence on stable UI layouts,
- need for stronger benchmark-driven validation before treating outputs as canonical.

### 2. Sparse Training Data For Some Important Classes

The system has labeling infrastructure, but not enough good labels for every class that matters.

The repo already records that `menu_club_management` and `player_loadout_landing` are still sparse and need a targeted labeling round. This is not bookkeeping trivia. It directly limits classifier confidence and the proving bench has had to relax those classes.

### 3. OCR Quality On Some Supplementary Screens

Even when classification is correct, OCR quality on some secondary post-game screens can still produce:

- garbled period labels,
- ambiguous headers,
- bad per-period box-score digits,
- noisy or redundant frame reads.

The system now handles this more gracefully than before, but it has not eliminated the underlying OCR weakness.

### 4. Segmentation / Capture Defects Can Still Poison Downstream Data

Not every bad extraction is a parser bug. The repo already documents cases where a wrong frame was captured into the wrong segment, which means perfect OCR would still read the wrong thing.

That is an important current-system reality:

- screen classification quality matters,
- segment boundaries matter,
- sampled-frame choice matters,
- downstream parse quality alone does not guarantee correctness.

### 5. No Delivered General Gameplay Understanding

The system is not a live gameplay analytics engine.

It does not currently deliver:

- continuous gameplay event extraction from arbitrary in-game footage,
- general player tracking,
- full semantic understanding of play-by-play from live action frames.

Its strongest outputs come from stable UI screens, especially post-game summaries and trackers.

## Operational Model

One important implementation fact: OCR ingestion runs host-side via CLI tooling, not as a magical always-on ability inside the worker container.

In practice, the system depends on:

- host-side Python environment availability,
- host-side video access,
- worker build artifacts for the TS ingest/promoter path,
- reprocess/validation discipline when changing decoder behavior.

This is fine, but it means deployment and operations are more manual than a clean always-on service architecture.

## Current Strengths

- The system has a real end-to-end video ingest pipeline.
- The screen classifier and segmentation pipeline are substantially more mature than the old screenshot-only flow.
- The Action Tracker path provides meaningful extracted match-event data.
- The decoder-run candidate/validate/activate model is sound engineering.
- Evidence capture, typed-v1 carve-outs, and promoter separation give the repo a cleaner long-term structure than it used to have.

## Current Risks

- Pre-game outputs are easier to over-trust than they should be.
- Sparse labels still exist for important edge classes.
- Some post-game supplementary data remains warning-tolerated rather than fully solved.
- Sampling and segmentation defects can create wrong downstream reads even when OCR/parser code is fine.
- The system remains tightly coupled to fixed UI layouts and title/version-specific configs.

## Recommended Near-Term Priorities

1. Run the already-identified targeted labeling round for sparse WoC and lobby classes using proper annotation software and denser sampling.
2. Keep the proving bench as the acceptance gate for classifier changes instead of relying on anecdotal “looks better” validation.
3. Continue treating Action Tracker as the highest-confidence OCR product and pre-game extraction as a lower-confidence subsystem until its benchmarks materially improve.
4. Tighten segmentation/capture validation where wrong-frame-in-wrong-segment defects have already been observed.
5. Avoid expanding scope into box-drawing or detector training unless ROI instability becomes the bottleneck. Right now taxonomy and truth data are the bigger problems.

## Bottom Line

The current extraction system is no longer a toy. It has a serious video pipeline, a real candidate-run workflow, and a post-game event extraction path that produces useful data.

But it is not uniformly mature across all screen families. Post-game Action Tracker extraction is the strongest delivered capability. Pre-game lobby/loadout extraction is still the weakest and should be treated accordingly.

If someone asks whether the system “works,” the honest answer is:

- yes for post-game event-oriented extraction,
- partially for the rest of the post-game screens,
- and not yet to a high enough standard for pre-game extraction to be treated as fully trustworthy canonical data without caution.
