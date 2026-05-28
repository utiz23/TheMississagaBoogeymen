# NVIDIA CV Stack Recommendation — 2026-05-28

## Purpose

This report answers two related questions for this repo:

1. What NVIDIA computer vision products are useful for the current `game data extraction` pipeline?
2. Which of those become useful later if the project grows into `live in-game tracking and modeling`?

Short answer:

- For `current OCR-driven game data extraction`, the best fit is:
  - keep the current screenshot-first ROI/OCR architecture
  - add `CV-CUDA` first
  - add `TAO Toolkit` only for narrow failure modes that justify training
- For `future live tracking`, the stack changes:
  - `DeepStream 8` becomes useful
  - `TAO Toolkit` becomes much more important
  - `CV-CUDA` still helps as lower-level plumbing
  - `Metropolis VSS` is optional analytics/search infrastructure, not the core extraction path

## Repo Reality

The current system is not a generic video AI pipeline. It is a structured, reviewable, screenshot-first OCR system:

- [tools/game_ocr/game_ocr/ocr.py](../../tools/game_ocr/game_ocr/ocr.py) uses `RapidOCR` with optional CUDA flags behind a simple `OCRBackend`.
- [tools/game_ocr/game_ocr/frame_pipeline_v2.py](../../tools/game_ocr/game_ocr/frame_pipeline_v2.py) composes ROI scaling, ROI OCR, normalization, and v2 feature generation.
- [apps/worker/src/ocr-cli-runner.ts](../../apps/worker/src/ocr-cli-runner.ts) wraps the Python extractor as a subprocess and returns structured JSON.
- [apps/web/src/app/games/[id]/page.tsx](../../apps/web/src/app/games/[id]/page.tsx) already surfaces OCR-derived lineups, box score, shot mix, event timeline, and action-tracker sections.

That matters because the "best NVIDIA product" depends on whether the project remains:

- `layout-stable extraction from selected screenshots / extracted frames`, or
- `continuous live video understanding`

Those are different problems and they should not be forced into the same architecture.

## Recommendation Matrix

| Option                                    | Fit For Current Project   | Robustness For Structured Game Data |        Cost | Complexity | Best Use                                                         | Recommendation                                |
| ----------------------------------------- | ------------------------- | ----------------------------------: | ----------: | ---------: | ---------------------------------------------------------------- | --------------------------------------------- |
| `CV-CUDA`                                 | Very high                 |                                High |      Medium | Low-Medium | Accelerate crop/resize/normalize/threshold/image-prep before OCR | `Adopt first`                                 |
| `TAO Toolkit`                             | High, if narrowly applied |                                High | Medium-High |     Medium | Train custom classifiers/detectors for known weak spots          | `Adopt later, selectively`                    |
| `DeepStream 8`                            | Medium today              |                              Medium |        High |       High | Continuous video ingestion, decode, inference, tracking          | `Use only if moving to live/continuous video` |
| `Metropolis VSS`                          | Low                       |                                 Low |        High |       High | Search/summarize archived video, replay intelligence             | `Ignore for primary extraction`               |
| `Current stack only`                      | High                      |                              Medium |         Low |        Low | Preserve existing OCR/evidence/review workflow                   | `Not enough by itself`                        |
| `Current stack + CV-CUDA + selective TAO` | Very high                 |                           Very high | Medium-High |     Medium | Strongest near-term architecture                                 | `Best overall choice now`                     |

## Current-State Recommendation: Game Data Extraction

The most robust solution for current purposes is:

`current screenshot-first OCR pipeline` + `CV-CUDA` + `selective TAO on proven weak spots`

### Why this is the right answer

- The repo already has the correct control shape for authoritative stat extraction:
  - deterministic ROIs
  - screen-specific parsing
  - evidence tables
  - review gates
  - promotion flows
- Structured extraction cares more about `debuggability`, `repeatability`, and `truth maintenance` than about having the largest video-AI platform in the room.
- A giant streaming framework does not automatically improve OCR correctness. It mostly increases system surface area.

### What CV-CUDA would actually do here

It would improve the boring part that still matters:

- crop and resize ROI batches on GPU
- normalize images before OCR
- apply thresholding / color transforms / denoising variants faster
- reduce CPU preprocessing overhead in high-volume extraction runs

This is the cleanest near-term NVIDIA integration because it improves throughput without forcing a pipeline rewrite.

### What TAO would actually do here

Only use it where heuristics keep failing and the failure is expensive enough to justify training. Good candidates:

- screen-state classification
- stylized HUD text / icon-region detection
- X-Factor icon classification support
- rink landmark detection for action-tracker extraction
- scorebug / clock / event-marker localization

Do not try to replace the whole OCR pipeline with TAO-trained models at once. That is how people create an expensive mess.

## Future-State Recommendation: Live In-Game Tracking and Modeling

If the project moves into `continuous live match understanding`, the architecture should split from the current screenshot-first system.

The best NVIDIA-shaped stack for that future is:

`DeepStream 8` + `TAO Toolkit` + `CV-CUDA` + project-specific event/state logic

### Why DeepStream starts to matter there

DeepStream is a serious answer only when the project needs:

- continuous live decode
- frame-by-frame inference at scale
- multi-stage real-time pipelines
- tracking across time
- GPU-native message/output flow

That is a real fit for:

- player tracking
- puck detection
- possession heuristics
- offensive/defensive zone occupancy models
- event detection from continuous footage

It is not the right first answer for the current OCR extraction workflow, but it becomes relevant once "watch the whole game live" is an actual requirement.

### What TAO would likely train for live tracking

Likely model classes:

- player detector
- puck detector
- rink landmark detector
- scoreboard / HUD detector
- event-state classifier
- possession / transition feature extractors built on top of detections

Generic pretrained models are unlikely to be reliable enough for this game-specific domain without fine-tuning.

### Where VSS fits later

`Metropolis VSS` is still not the core of live tracking. It becomes useful later for things like:

- "find every 2-on-1 rush"
- "find all ozone turnovers leading to shots"
- "show all goals from left-circle one-timers"
- replay search and coaching workflows

That is downstream video intelligence, not the primary extraction backbone.

## Concrete Recommendation

### Adopt Now

- `CV-CUDA`
  - Run a spike in `tools/game_ocr` that replaces the most common CPU OpenCV preprocessing steps with GPU equivalents.
  - Success criteria:
    - throughput improvement on real extraction batches
    - no regression on current calibration fixtures
    - no change to output schema or review semantics

### Adopt Later, If Metrics Justify It

- `TAO Toolkit`
  - Pick one high-value failure mode.
  - Label enough data.
  - Train one narrow model.
  - Integrate it behind existing evidence/review pathways.

### Do Not Adopt Yet

- `DeepStream 8`
  - Wait until the project is explicitly doing continuous live or near-live video processing.

### Ignore For Primary Extraction

- `Metropolis VSS`
  - Revisit only if replay search, highlight search, or natural-language archive exploration becomes a real product need.

## Suggested Two-Track Roadmap

### Track A — Post-Game Structured Extraction

1. Keep the current OCR/evidence/review architecture.
2. Add `CV-CUDA` preprocessing in a contained spike.
3. Measure batch throughput and OCR drift.
4. Use `TAO` only for persistent high-value weak spots.

### Track B — Live Tracking / Modeling

1. Start a separate video-native pipeline.
2. Evaluate `DeepStream 8` as the runtime backbone.
3. Use `TAO` for custom detectors/classifiers.
4. Keep storage, evidence, and QA discipline from the OCR system, but do not force the live system to share the same internal design.

## Bottom Line

For `current game data extraction`, the best solution is not a full NVIDIA platform rewrite. It is:

`existing structured OCR pipeline` + `CV-CUDA now` + `TAO later where failure data says it matters`

For `future live in-game tracking and modeling`, the answer changes to:

`DeepStream 8` + `TAO Toolkit` + `CV-CUDA`

Anything else is either premature or the wrong shape.

## Sources

- CV-CUDA: <https://developer.nvidia.com/cv-cuda>
- DeepStream getting started: <https://developer.nvidia.com/deepstream-getting-started>
- DeepStream 8 release notes: <https://docs.nvidia.com/metropolis/deepstream/8.0/text/DS_Release_notes.html>
- TAO Toolkit overview: <https://docs.nvidia.com/tao/tao-toolkit/latest/text/overview.html>
- NVIDIA Metropolis platform: <https://www.nvidia.com/en-us/autonomous-machines/intelligent-video-analytics-platform/>
- Video Search and Summarization GA announcement (May 18, 2025): <https://blogs.nvidia.com/blog/ai-blueprint-video-search-and-summarization/>
- Video agents / skills update (May 13, 2026): <https://developer.nvidia.com/blog/transform-video-into-instantly-searchable-actionable-intelligence-with-ai-agents-and-skills/>
