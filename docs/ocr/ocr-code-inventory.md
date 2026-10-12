# OCR Code Inventory

Status: current as of 2026-10-11. Read-only survey. Made as input for the
live game tracking engine planning.

This page lists where all video-stats (OCR) code, data and docs are. It does
not explain how each part works. Paths are relative to the repo root.

## Summary

- About 75,000 lines of Python in three tools, plus TypeScript in the worker
  and the database package.
- **All screen layouts, classifier weights and calibration data are for
  NHL 26 at 1920x1080.** The team plays NHL 27 since 2026-09-05. There is no
  NHL 27 config yet.
- The pipeline is **offline**. It needs a finished video file. See
  "Offline parts" below.
- Nothing reads the in-game HUD (score, clock, period) during play. The HUD
  exists only as classifier states.
- Video-stats writes to the Hotel-Echo database are on hold (operator,
  2026-10-09).

## 1. `tools/game_ocr` — the OCR engine (about 9,500 lines, plus scripts)

The engine reads one screen image and returns structured data. Most of its
per-frame parts take one numpy BGR image and keep no state.

| Area | Files |
|---|---|
| OCR backend | `game_ocr/ocr.py` — RapidOCR on ONNX Runtime, optional CUDA. No Tesseract, Paddle or Torch. |
| Screen classifier | `screen_classifier.py` (logistic regression, weights in `weights/nhl26-screen-classifier-v2.json`), `frame_features.py`, `frame_pipeline_v2.py`, `regex_priors.py` |
| Screen sequence decoder (offline) | `emissions.py`, `state_machine.py`, `viterbi.py` — needs the full video |
| Layouts (ROI) | `config.py`, `image.py`, `configs/roi/*.yaml` (11 screens, all 1920x1080) |
| Parsers | `extractor.py` (screen registry), `parsers.py` (2,737 lines, all `parse_*` functions) |
| Lobby and loadout | `lobby_evidence.py`, `lobby_extractors/`, `loadout_evidence.py`, `loadout_bundle.py`, `loadout_extractors/` |
| Rink and colours | `spatial.py`, `configs/rink/*.json`, `color_extractor.py` |
| Icons | `captain_star_matcher.py`, `xfactor_icon_matcher.py` (templates from `apps/web/public/assets/x-factors/`) |
| Output models | `models.py` (pydantic), `FieldEvidenceRecord` in `loadout_evidence.py` |
| Vocabulary | `configs/closed_vocab/nhl26/*` |
| Benchmark | `benchmark/` |
| CLI | `cli.py` |

Screens with a parser: pre-game lobby (states 1 and 2), player loadout,
post-game player summary, box score, net chart, faceoff map, events list,
action tracker.

Screens with no parser (classifier state only): in-game clock, in-game goal
overlays, loading, menus.

Other folders:

- `scripts/` — 39 scripts: training and labelling, rink calibration,
  DB post-processing (these use `DATABASE_URL`), benchmarks, diagnostics,
  spikes.
- `tests/` — 32 files, about 500 tests.
- `calibration/extras/` — 5.9 GB labelled NHL 26 screenshot corpus. Only 174
  files are in git.
- `ScreenShots/` — reference screenshots (git-ignored).
- `README.md` — stale. It lists 4 screens; there are 11.

Legacy code: `classifier.py`, the v1 state machine and weights, the
`bundle_dir` disk path, the old `SlotIdentity` API.

## 2. `tools/video_ingest` — the video pipeline (about 37,000 lines incl. tests)

Turns a recorded `.mkv` into staged frames and evidence, then calls the
worker to write the database.

| Stage | Files |
|---|---|
| Probe | `pts.py` (ffprobe, sha256 of the whole file), `version_detect.py` |
| Pass 1: find screens | `pass1_classify.py` (PyAV decode at 1 fps), `pass1_segment.py` (Viterbi), `visual_prefilter/` |
| Pass 2: dense frames | `pass2_extract.py`, `frame_provider.py` |
| Split into games ("reels") | `match_split.py`, `identity_probe.py` |
| Dispatch to worker | `dispatch.py` (runs `pnpm --filter worker ingest-ocr`) |
| Runs and batches | `orchestrator.py`, `reprocess.py`, `batch_ingest.py`, `cli.py` |
| Post-game rescue | `rescue_*.py`, `scripts/` |
| Config | `configs/nhl26.yaml` (only config) |
| GPU | `gpu_libs.py` |

- Python never writes to the database. It reads with `psql` and writes
  through worker CLIs.
- `tests/` — 50 files, about 1,070 tests. Fixture clip `match-250-clip.mkv`.
- Separate GPU venv at `tools/video_ingest/.venv`. Tests run with the
  repo-root `.venv-1`.

## 3. `tools/historical_import` — standalone

OCR of NHL 22–25 season totals from player-card videos and club screenshots.
Uses RapidOCR directly. Does not import `game_ocr`. Marked complete.

## 4. `apps/worker/src` — ingest, promotion, quality (TypeScript)

- Ingest: `ingest-ocr.ts`, `ingest-ocr-cli.ts`, `ocr-cli-runner.ts` (runs
  `python -m game_ocr.cli`).
- Promotion: `ocr-promoters/` (one per screen), `repromote-*-cli.ts`,
  `ingest-ocr-review-cli.ts`, `auto-drain-cli.ts`.
- Runs and reels: `decoder-runs-cli.ts`, `resolve-match-cli.ts`.
- Quality: `run-quality-cli.ts`, `match-quality-cli.ts`, `lib/quality-*`,
  `lib/l4-api-truth.ts`, `lib/promotion-gate.ts`.
- Identity and backfills: `ingest-ocr-resolve-cli.ts`,
  `promote-persona-alias-cli.ts`, `backfill-*-cli.ts`.
- Other: `consolidate-loadouts-cli.ts`, `reconcile-periods-cli.ts`,
  `reconcile-positions.ts`, `match-rink-diff-cli.ts`.
- About 50 OCR tests in `__tests__/`.

## 5. `packages/db` — schema and queries

- OCR tables: `schema/ocr-pipeline.ts`, `ocr-evidence.ts`,
  `ocr-decoder-runs.ts`, `ocr-run-quality-reports.ts`,
  `ocr-match-associations.ts`.
- OCR-fed tables: `match_events`, `match_goal_events`,
  `match_penalty_events`, `match_period_summaries`,
  `match_shot_type_summaries`, `match_faceoff_*`, `player_loadout_*`,
  `player_persona_aliases`.
- Queries: `src/queries/ocr-*.ts`, `run-quality.ts`, `match-events.ts`,
  `player-loadouts.ts`, `match-enrichments.ts`, `match-lineups.ts`,
  `l4-api-truth-inputs.ts`.
- Migrations 0028–0056 (from 0046: hand-written SQL, applied with `psql`).

## 6. `apps/web` — display only

OCR pill, provenance footer, lineups, box score, event timeline, action
tracker on `app/games/[id]/page.tsx`. No OCR admin page or API route.

## 7. Verification and tooling

- `scripts/verify-ocr.sh` (`pnpm verify:ocr`) — about 20 minutes.
- `.githooks/pre-push` + `lib/classify-push.mjs` — runs the full suite for
  any push that touches `tools/game_ocr/`, `tools/video_ingest/`, or a path
  with an `ocr` segment.
- `docker-compose.test.yml`, `ops/` — the verification database.
- `cvat/` (git-ignored), `label-studio-export.json` (git-ignored) —
  labelling tools.

## 8. Docs

- Closest system overview (2026-06-13, partly out of date):
  `docs/ocr/current-in-game-data-extraction-system-report.md`.
- Current operations: `docs/runbook/ocr-corpus-mass-ingest.md`.
- Live tracking direction (2026-05-28):
  `docs/research/video-extraction-architecture-review-2026-05-28.md`
  ("Track B"), `docs/research/nvidia-cv-stack-recommendation-2026-05-28.md`,
  `docs/ocr/advanced-stat-tracking-roadmap.md`.
- History: `docs/calibration/`, most of `docs/ocr/`, `research/OCR-SS/`
  (manual benchmarks), May plans in `docs/superpowers/`.

## Offline parts (cannot run live as built)

- Cache key is the sha256 of the finished file.
- Viterbi screen decoding reads the full sequence, then backtracks.
- Pass 2 seeks back into the file.
- Reel grouping needs all segments. Reel time comes from the file name.
- Reel-to-match link is a manual confirm step.
- Lobby and loadout evidence picks the best frame and votes across a whole
  segment.

## Parts a live engine can reuse

- `OCRBackend` / `RapidOCRBackend`.
- ROI crop (`image.py`) and the `parse_*` functions (one frame in, data out).
- `compute_frame_features_v2_from_image` and `ScreenClassifierV2` (per frame).
- The visual gate in `visual_prefilter/`.
- The evidence model (`FieldEvidenceRecord`) and the promote-after-review
  idea.
- The recorded videos and the labelled corpus, as test input.
