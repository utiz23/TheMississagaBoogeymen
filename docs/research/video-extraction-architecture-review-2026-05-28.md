# Video Extraction Architecture Review - 2026-05-28

## Executive Verdict

The current system is on the right path for **video-fed extraction of known NHL UI screens**.

It is not yet the right architecture for **live gameplay tracking or full in-game modeling**.

That distinction matters. The current pipeline is best understood as:

```text
recorded video -> screen/window discovery -> OCR/frame extraction -> evidence -> reviewed promotion
```

That is a valid architecture for extracting structured data from pre-game lobby screens, loadout screens, post-game tables, action tracker screens, box scores, and similar fixed-layout UI states.

It is not a general "understand hockey gameplay from the broadcast/camera feed" system. If the project starts treating it as one, we will over-invest in the wrong abstractions and keep patching around a scope mismatch.

The blunt call:

- Keep the two-pass extraction architecture.
- Keep the versioned screen configs, OCR evidence model, and review/promote discipline.
- Fix the timebase and extraction hot path before adding more model complexity.
- Do not replace the current pipeline with DeepStream/VSS/VLMs for current extraction.
- Build future live gameplay tracking as a separate video-native track, sharing storage/evidence ideas but not forcing it through this OCR-first architecture.

## What The Current System Actually Is

The current video ingestion system is already a two-pass video-to-OCR pipeline:

- [tools/video_ingest/video_ingest/orchestrator.py](../../tools/video_ingest/video_ingest/orchestrator.py) coordinates probe, Pass 1, Pass 2, and optional dispatch.
- [tools/video_ingest/video_ingest/configs/nhl26.yaml](../../tools/video_ingest/video_ingest/configs/nhl26.yaml) defines the NHL 26 extraction policy.
- [tools/video_ingest/video_ingest/pass1_classify.py](../../tools/video_ingest/video_ingest/pass1_classify.py) contains the frame sampling and segment representation.
- [tools/video_ingest/video_ingest/pass2_extract.py](../../tools/video_ingest/video_ingest/pass2_extract.py) extracts dense PNG frames from discovered segments.
- [tools/video_ingest/video_ingest/pts.py](../../tools/video_ingest/video_ingest/pts.py) probes video duration, FPS, sha256, and basic PTS/DTS health.
- [tools/video_ingest/video_ingest/version_detect.py](../../tools/video_ingest/video_ingest/version_detect.py) attempts to fail closed when a video does not match a known game UI version.
- [tools/game_ocr/game_ocr/ocr.py](../../tools/game_ocr/game_ocr/ocr.py) wraps RapidOCR behind the `OCRBackend` protocol.
- [tools/game_ocr/game_ocr/frame_pipeline_v2.py](../../tools/game_ocr/game_ocr/frame_pipeline_v2.py) builds screen-classification features from ROI OCR and visual features.
- [apps/worker/src/ocr-cli-runner.ts](../../apps/worker/src/ocr-cli-runner.ts) bridges the Python OCR CLI into the worker flow.

The current `nhl26.yaml` intent is clear:

- Pass 1 samples the whole video at `1 fps`.
- Pass 1 uses `viterbi_v2`, a screen-state decoder using learned classifier output plus regex priors.
- Pass 2 extracts only configured screen types.
- Pass 2 samples static/post-game screens at low FPS and loadout screens at `3 fps`.
- Action tracker extraction is sampled more densely at `5 fps`.

This is not a naive "OCR every frame" system. It is already doing the correct broad thing: find candidate windows cheaply, then spend OCR work where the data exists.

## Are We On The Right Path?

Yes, for the current extraction target.

The current target appears to be:

- feed in recorded match videos
- identify relevant NHL UI screens
- extract structured fields from those screens
- preserve evidence
- promote data only when confidence/review rules allow it

For that target, the current architecture is fundamentally sound.

The alternatives are mostly worse:

| Architecture                     |          Fit | Why                                                                                    |
| -------------------------------- | -----------: | -------------------------------------------------------------------------------------- |
| Dense OCR over every video frame |         Poor | Too slow, too noisy, high duplicate burden, poor failure isolation                     |
| Pure scene-cut detection first   |  Poor-Medium | Scene cuts do not equal semantic UI-state changes                                      |
| General VLM over frames/video    |         Poor | Expensive, non-deterministic, poor auditability for authoritative stats                |
| End-to-end learned screen parser | Medium later | Needs substantial labels and still needs review/evidence gates                         |
| Current two-pass UI extraction   |         High | Matches fixed UI layouts and keeps extraction auditable                                |
| DeepStream live pipeline         |   High later | Correct for continuous live video/tracking, but too heavy for current post-game UI OCR |

The current system does not look like tunnel vision in its basic architecture. It looks like a pragmatic fixed-UI extraction system.

Where tunnel vision can creep in is **inside the current path**:

- treating sampled frame index as good enough time
- dumping PNGs as the permanent hot path
- adding more screen-classifier complexity before measuring stage-level failures
- treating this UI extraction stack as the future live tracking stack

Those are correctable. They do not mean the entire method is wrong.

## What The Current Design Gets Right

### 1. Two-pass processing is the right base pattern

The system first classifies coarse video windows, then extracts densely only where needed. That is the right tradeoff.

For fixed UI extraction, most frames in a video are useless. OCRing all of them is waste. The current pass split avoids that.

### 2. Version-aware configs are required

NHL 26 UI layouts are not forever. NHL 27 will move things. Even NHL 26 patches can move or restyle screens.

The version detection path in [version_detect.py](../../tools/video_ingest/video_ingest/version_detect.py) is the right kind of fail-closed machinery. It is narrow and incomplete today, but the concept is correct.

### 3. Evidence before promotion is the right data model

OCR should not be trusted as fact. The repo already reflects that:

- OCR outputs are captured as evidence.
- Promoters decide what can become canonical.
- Reviewed status gates user-facing use.
- Reprocessing and decoder runs are tracked.

This is the correct posture for noisy extraction.

### 4. Hybrid screen classification is appropriate

For known UI screens, a hybrid of:

- cheap visual features
- OCR anchors
- regex priors
- state-machine/Viterbi smoothing

is a strong approach. It is more debuggable than a general screenshot model and far cheaper than video-language inference.

### 5. The current system already has useful rollback and cache thinking

The pipeline hashes config/weights/state-machine inputs into cache keys, and keeps v1/v2 paths available. That matters. Without it, calibration work becomes untraceable.

## Where The Current System Is Weak

### 1. Time is still not first-class enough

The design acknowledges PTS/DTS risk in [pts.py](../../tools/video_ingest/video_ingest/pts.py), but Pass 1 still treats sampled frame index as canonical time:

```text
seconds = idx / sample_fps
```

That is tolerable for clean constant-frame-rate recordings. It is not robust enough as a long-term foundation.

Recorded gameplay files can come from OBS, ShadowPlay, console capture, remuxes, or editing tools. Some will have variable frame rate behavior, timestamp gaps, generated timestamps, or odd keyframe boundaries.

Recommended correction:

- Promote source PTS/time to the canonical timeline.
- Store frame/sample source timestamps in `segments.json`.
- Make segment `start_seconds` / `end_seconds` derive from source timestamps, not only sampled index.
- Keep frame index as a debugging field, not the source of truth.

External references:

- FFmpeg docs: <https://www.ffmpeg.org/ffmpeg.html>
- PyAV time docs: <https://pyav.org/docs/stable/api/time.html>

### 2. PNG extraction is good for debugging, poor as the permanent hot path

[pass2_extract.py](../../tools/video_ingest/video_ingest/pass2_extract.py) extracts segment frames to PNG directories, then downstream extractors read from disk.

That is excellent for:

- audit
- fixtures
- manual review
- reproducibility
- debugging a bad segment

It is not ideal for normal high-volume operation.

Problems:

- disk I/O becomes part of the core runtime
- PNG encode/decode cost is paid even when no human needs the image
- each segment creates filesystem churn
- timestamp fidelity is harder when files are named by sequence number

Recommended correction:

- Keep artifact dumps as an optional mode.
- Add an in-memory extraction path for normal operation:
  - decode segment frames
  - preserve source PTS per frame
  - crop/prepare ROIs
  - OCR/extract
  - write evidence JSON/DB rows
- Only materialize PNGs for review packs, failing cases, and labeled fixtures.

### 3. Pass 1 still does OCR work on every sampled frame

The v2 path performs ROI OCR for each sampled frame. At `1 fps`, that is acceptable. It is still not free.

This can become a bottleneck if:

- sample FPS increases
- videos get longer
- multiple matches are processed in batches
- version detection and reprocessing run often

Recommended correction:

- Make the first screen filter cheaper:
  - visual/layout features first
  - OCR only when visual state is plausible or ambiguous
- Batch ROI crops where possible.
- Evaluate RapidOCR GPU or ONNX Runtime GPU in the current environment before changing OCR families.
- Consider CV-CUDA only after measuring preprocessing cost; do not assume it is the bottleneck.

### 4. Pass 1 sampling policy is fragile around short screens

The config uses `1 fps` for Pass 1. The comments already show real pressure from short screens:

- some screens needed per-screen `min_run_to_open` overrides
- brief post-game tabs required lower minimum durations
- loadout moved from `1 fps` to `3 fps` in Pass 2 because subject windows were being missed

This does not mean `1 fps` is wrong. It means the system needs explicit recall measurement.

Recommended correction:

- Track Pass 1 segment recall on labeled clips.
- Maintain a small proving bench of real video windows.
- Decide sampling rate from measured missed-screen cost, not intuition.
- Consider adaptive sampling:
  - `1 fps` globally
  - higher FPS around menu/tab regions, post-game navigation, or high classifier uncertainty

### 5. Version detection is conceptually right but narrow

Current version detection samples a handful of frames and looks for top-bar anchors. That is fine as v0.

Risk:

- if sampled frames are gameplay only, anchors may not appear
- if a video starts/ends outside menus, confidence may be low
- future game versions may share many words

Recommended correction:

- Store version detection evidence with sampled timestamps and OCR text.
- Add visual anchors, not only text anchors.
- Add "unknown_version" as a normal outcome that stops extraction cleanly.
- Do not guess a version because extraction happened to produce something parseable.

### 6. Metrics are not stage-oriented enough

The pipeline has many tests and regression floors, but the architecture decision needs stage-level production metrics:

- version detection accuracy
- Pass 1 segment recall
- Pass 1 false-positive rate
- boundary error in seconds
- Pass 2 frame count per segment
- OCR field recall
- OCR field precision
- promotion precision
- manual review burden
- runtime per video
- disk footprint per video

Without those, it is easy to overfit to local fixtures or argue from anecdotes.

Recommended correction:

- Add a per-ingest quality report artifact.
- Make every run answer:
  - What did we find?
  - What did we skip?
  - What evidence was promoted?
  - What remained unresolved?
  - How long did each stage take?

## The Scope Boundary We Need To Enforce

There are two distinct future systems:

### Track A: Video-Fed UI Extraction

This is the current pipeline.

It extracts data that the game itself displays in structured UI screens:

- lobby rows
- player loadouts
- X-Factors
- box-score tables
- shot/faceoff tabs
- action tracker maps
- post-game player summary
- post-game event list

Best architecture:

```text
recorded video
  -> probe and version detect
  -> low-cadence screen/window classifier
  -> boundary refinement
  -> selected-frame extraction
  -> ROI OCR / icon matching / table parsing
  -> evidence
  -> review/promotion
```

This should remain deterministic, auditable, and versioned.

### Track B: Live Gameplay Tracking And Modeling

This is a different system.

It would infer data from gameplay footage itself:

- player locations
- puck location
- possession
- zone entries
- passes
- rush chances
- defensive structure
- goalie movement
- event detection before the game UI confirms it

Best architecture:

```text
live/recorded gameplay stream
  -> timestamp-safe decode
  -> detector models
  -> tracking across time
  -> rink calibration
  -> state/event model
  -> confidence/evidence output
```

That is not an OCR-first problem.

It may eventually use:

- DeepStream or GStreamer for live decode/inference plumbing
- TAO or a normal training stack for custom detectors
- CV-CUDA for preprocessing
- custom rink geometry and tracker logic

But it should not be bolted onto the existing screen-OCR pipeline as if it were another screen type.

## Architecture Alternatives Considered

### Alternative 1: OCR every frame

Rejected.

Why:

- slow
- duplicate-heavy
- noisy
- higher false-positive rate
- harder review burden

This only makes sense for a tiny corpus or a one-off forensic tool.

### Alternative 2: Scene detection as the main segmenter

Rejected as the primary oracle.

Scene detectors find visual transitions. They do not know whether a semantic UI screen appeared.

PySceneDetect can still be useful as a boundary refinement tool around candidate windows. It should not replace screen-state classification.

External reference:

- PySceneDetect detectors: <https://www.scenedetect.com/docs/latest/api/detectors.html>

### Alternative 3: End-to-end VLM/video agent extraction

Rejected for primary extraction.

Why:

- poor determinism
- expensive per video
- difficult to validate field-level truth
- worse auditability than ROI evidence
- too much ambiguity for canonical stats

VLMs may be useful for operator assist, summarization, or replay search later. They should not be the authority path for structured stat extraction.

### Alternative 4: DeepStream rewrite

Rejected for current extraction.

DeepStream is useful when the problem is continuous live inference and tracking. Current UI extraction is not that problem.

DeepStream becomes relevant for Track B, not as a replacement for Track A.

### Alternative 5: Current pipeline with targeted corrections

Recommended.

This keeps the architecture that matches the data source and fixes the parts that hurt robustness and efficiency.

## Recommended Target Architecture For Current Extraction

The current pipeline should evolve toward this:

```text
video file
  -> ffprobe/PyAV probe
  -> source timestamp manifest
  -> version detection
  -> Pass 1 screen classifier at low cadence
  -> optional boundary refinement around candidate windows
  -> Pass 2 frame provider
       -> in-memory by default
       -> PNG artifact dump only when requested
  -> per-screen extractor
       -> ROI OCR
       -> icon/template matching
       -> table geometry
       -> parser validation
  -> evidence records
  -> quality report
  -> promoter/review
  -> canonical app data
```

The main architectural change is not "new AI." It is making time, frame access, and quality reporting first-class.

## Recommended Roadmap

### Phase 1: Add A Real Run Quality Report

Before making more algorithmic changes, make the system report itself.

Add one artifact per ingest:

```text
ingest_quality_report.json
```

It should include:

- video sha
- detected version and confidence
- pass1 engine and cache key
- frame sample count
- segments emitted by screen type
- skipped candidate screens
- Pass 2 frame counts
- extraction result counts
- field evidence counts
- promotion counts
- unresolved/blocked promotion counts
- runtime by stage
- disk bytes written

Why first:

- it tells us whether speed or accuracy is actually the next bottleneck
- it prevents guessing
- it gives future reports hard numbers

### Phase 2: Make PTS Canonical

Change Pass 1 from index-derived time to timestamp-backed samples.

Concrete target:

- sampled frame record includes:
  - `sample_index`
  - `source_pts`
  - `source_time_seconds`
  - `decode_order_index`
- segment bounds derive from source time
- Pass 2 uses source time from the segment manifest

This is a robustness fix, not a polish item.

### Phase 3: Split Artifact Extraction From Hot-Path Extraction

Keep PNG output, but stop requiring it for normal extraction.

Add an internal frame provider abstraction:

```text
FrameProvider
  -> iter_segment_frames(segment, fps)
  -> yields {image, source_time_seconds, pts, frame_index}
```

Then support two modes:

- `artifact_mode=true`: write PNGs and manifests for review/debug.
- `artifact_mode=false`: process frames in memory and only write evidence.

This keeps the current review workflow while removing unnecessary steady-state disk churn.

### Phase 4: Measure And Reduce Pass 1 OCR Cost

Do not guess. Measure first.

If Pass 1 OCR is material:

- apply visual prefiltering before OCR
- batch ROI OCR
- test RapidOCR GPU in this environment
- only then evaluate CV-CUDA preprocessing

If Pass 1 OCR is not material:

- leave it alone
- spend effort on field recall and promotion accuracy

### Phase 5: Add Boundary Refinement Only Where Needed

Do not add PySceneDetect globally.

Use boundary refinement only for screen types where:

- boundary error causes missed fields
- the screen is short-lived
- 1 fps coarse sampling is insufficient

Good candidates:

- fast post-game tab transitions
- short loadout subject windows
- action tracker entry/exit

### Phase 6: Use Learned Models Only For Proven Failures

Good candidates for selective model work:

- screen-state classifier improvements
- X-Factor icon classifier
- rink/action-tracker landmark detector
- scoreboard/HUD element detector
- custom OCR recognizer for NHL-specific fonts if RapidOCR misses persist

Bad candidate:

- replacing the entire parser with a black-box model

### Phase 7: Start A Separate Live Gameplay Spike

This should not be framed as "extend the OCR pipeline."

A proper first spike:

- pick one short gameplay clip
- define one live metric only, such as puck/player/scorebug detection
- build a timestamp-safe frame reader
- evaluate detection/tracking feasibility
- store outputs as separate evidence

Only after that should DeepStream/GStreamer/TAO be considered seriously.

## Keep / Change / Stop

### Keep

- two-pass extraction
- versioned configs
- Viterbi/state-machine smoothing
- unknown/fail-closed behavior
- OCR evidence tables
- reviewed promotion model
- calibration fixtures
- regression floors

### Change

- make source timestamps canonical
- add run-level quality reporting
- decouple PNG artifacts from normal extraction
- use stage metrics to pick the next bottleneck
- separate current UI extraction from future live gameplay CV

### Stop

- treating "video-fed" as equivalent to "live gameplay understanding"
- adding classifier complexity without stage metrics
- assuming disk PNG extraction is acceptable forever
- letting frame index masquerade as true time
- using NVIDIA platform choices as a substitute for architecture decisions

## Risk Register

| Risk                                        | Severity | Current State                                | Recommended Response                                                         |
| ------------------------------------------- | -------: | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Silent misparse after UI drift              |     High | Version detection exists but is narrow       | Strengthen version/OOD gating and fail closed                                |
| Missed short screen windows                 |     High | Per-screen overrides exist                   | Measure Pass 1 recall and add adaptive sampling/refinement only where needed |
| Time drift on non-ideal captures            |     High | PTS probe exists, but Pass 1 uses index time | Make PTS/source time canonical                                               |
| Excess disk/runtime cost                    |   Medium | PNG extraction is normal Pass 2 path         | Add in-memory hot path with optional artifacts                               |
| Overfitting to a few known matches          |   Medium | Proving bench exists, fixture corpus growing | Expand labeled real-video bench by failure mode                              |
| Future live tracking forced into OCR design |     High | Not yet implemented                          | Create separate live gameplay track                                          |
| Tool/vendor distraction                     |   Medium | NVIDIA research done                         | Use tools only after bottlenecks are measured                                |

## Decision Gates

Stay on the current architecture unless one of these happens:

- Pass 1 segment recall remains poor after labeled training and boundary tuning.
- Runtime per video remains unacceptable after removing unnecessary disk artifacts.
- OCR field recall remains poor because the NHL font/UI domain defeats generic OCR.
- NHL 27 UI drift breaks most configs and manual retuning becomes too expensive.
- The product requirement changes from "extract displayed game data" to "infer gameplay state live."

If the requirement changes to live gameplay state inference, start Track B. Do not keep stretching Track A.

## What To Do Next

The most useful next work is not another broad research round. It is a measurement and architecture-hardening round:

1. Add `ingest_quality_report.json`.
2. Make Pass 1 sample records timestamp-backed.
3. Add a FrameProvider abstraction.
4. Keep PNG dumps as optional artifacts.
5. Run the same match through old and new paths.
6. Compare:
   - data output
   - runtime
   - disk footprint
   - segment boundaries
   - field evidence counts
   - promotion counts

This will tell us whether the next bottleneck is screen discovery, OCR, parsing, promotion, or I/O.

## Bottom Line

We did not pick a bad architecture.

We picked a good architecture for a narrower problem than the phrase "game data extraction from video" sometimes implies.

For current UI-derived data extraction:

```text
two-pass video screen discovery + OCR/evidence/review is the right path
```

For future live gameplay modeling:

```text
build a separate video-native detection/tracking pipeline
```

The immediate engineering risk is not that the current system is fundamentally wrong. The risk is that we keep layering patches onto it without first fixing time handling, artifact overhead, and stage-level measurement.

## Sources And References

Local code and project docs:

- [tools/video_ingest/video_ingest/orchestrator.py](../../tools/video_ingest/video_ingest/orchestrator.py)
- [tools/video_ingest/video_ingest/configs/nhl26.yaml](../../tools/video_ingest/video_ingest/configs/nhl26.yaml)
- [tools/video_ingest/video_ingest/pass1_classify.py](../../tools/video_ingest/video_ingest/pass1_classify.py)
- [tools/video_ingest/video_ingest/pass2_extract.py](../../tools/video_ingest/video_ingest/pass2_extract.py)
- [tools/video_ingest/video_ingest/pts.py](../../tools/video_ingest/video_ingest/pts.py)
- [tools/video_ingest/video_ingest/version_detect.py](../../tools/video_ingest/video_ingest/version_detect.py)
- [tools/game_ocr/game_ocr/ocr.py](../../tools/game_ocr/game_ocr/ocr.py)
- [tools/game_ocr/game_ocr/frame_pipeline_v2.py](../../tools/game_ocr/game_ocr/frame_pipeline_v2.py)
- [research/deep-research-report_5.md](../../research/deep-research-report_5.md)
- [docs/calibration/redesign-round-4-codex-synthesis-2026-05-19.md](../calibration/redesign-round-4-codex-synthesis-2026-05-19.md)
- [docs/research/nvidia-cv-stack-recommendation-2026-05-28.md](nvidia-cv-stack-recommendation-2026-05-28.md)

External references:

- FFmpeg documentation: <https://www.ffmpeg.org/ffmpeg.html>
- PyAV time documentation: <https://pyav.org/docs/stable/api/time.html>
- PySceneDetect detector documentation: <https://www.scenedetect.com/docs/latest/api/detectors.html>
- RapidOCR project: <https://github.com/RapidAI/RapidOCR>
