# Historical Import Tooling

Review-assisted extraction pipeline for archived NHL stat-table videos.

## Purpose

Phase 1 targets:

- `NHL 25`
- `NHL 24`
- `NHL 23`
- season aggregates only

Supported `role_group` values:

- `skater`
- `goalie`

Supported skater `position_scope` values:

- `all_skaters`
- `wing`
- `leftWing`
- `center`
- `rightWing`
- `defenseMen`

Supported goalie `position_scope` values:

- `goalie`

This tooling does **not** reconstruct matches. It extracts reviewed archive
totals into JSON/CSV artifacts, which are then imported into
`historical_player_season_stats`.

## Dependencies

- Python 3.12+
- Python deps from `requirements.txt`

Install:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r tools/historical_import/requirements.txt
```

## GPU acceleration (RTX 3060 / WSL2)

The extractor currently uses `rapidocr-onnxruntime`. For NVIDIA GPU inference,
swap the CPU wheel for the GPU wheel after the current OCR jobs are finished:

```bash
source .venv/bin/activate
pip uninstall -y onnxruntime
pip install onnxruntime-gpu
```

Recommended runtime flags:

```bash
export OCR_USE_CUDA=1
export OCR_INTRA_THREADS=1
export OCR_INTER_THREADS=1
```

On startup the extractor now logs:

- available ONNX Runtime providers
- the effective RapidOCR kwargs

If `CUDAExecutionProvider` is not listed, the run will fall back to CPU even if
`OCR_USE_CUDA=1` is set.

Notes:

- Do **not** run two OCR batches in parallel on one GPU.
- First inference on a fresh process is slower due to model/runtime warmup.
- `--save-crops` is still mostly I/O-bound and will not speed up much.

## Naming and manifest

The extractor requires a manifest CSV, even if filenames are consistent.

Expected columns:

- `title_slug`
- `gamertag`
- `game_mode`
- `position_scope`
- `role_group`
- `source_game_mode_label`
- `source_position_label`
- `asset_path`

Use `build_manifest.py` to inventory local files into a starter CSV, then fix
anything ambiguous by hand.

## Workflow

1. Build or hand-author a manifest.
2. Run the extractor to produce:
   - `review.json`
   - `review.csv`
   - optional crop/debug artifacts
3. Review/fix the JSON/CSV.
4. Import only reviewed rows:

```bash
set -a && source .env && set +a
pnpm --filter @eanhl/db build
node packages/db/dist/tools/import-historical-reviewed.js path/to/review.json
```

## Extractor output contract

Each reviewed JSON record is expected to contain:

- `titleSlug`
- `gamertag`
- `gameMode`
- `positionScope`
- `roleGroup`
- `sourceGameModeLabel`
- `sourcePositionLabel`
- `sourceAssetPath`
- `importBatch`
- `reviewStatus`
- `confidenceScore`
- `stats`

The importer reads JSON arrays or `{ "records": [...] }` payloads.
