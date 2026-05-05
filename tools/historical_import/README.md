# Historical Import Tooling

Review-assisted historical ingestion lives here. There are now three distinct
legacy source families:

1. player-card season totals (`historical_player_season_stats`)
2. club-member totals from `CLUBS -> MEMBERS` screenshots (`historical_club_member_season_stats`)
3. club/team totals from `STATS -> CLUB STATS` screenshots (`historical_club_team_stats`)

## Purpose

Status: **complete for NHL 22, 23, 24, 25** — 159 reviewed rows total in
`historical_player_season_stats`. The pipeline below remains the canonical
process if any future legacy title needs to be added.

Season aggregates only. No match-level data is reconstructed.

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
totals into artifacts that are then imported into one of the historical tables
above.

## Source families

### 1. Player-card videos

Files / scripts:

- `extract_review_artifacts.py`
- `build_manifest.py`
- `manifest.*.csv`

Output target:

- `historical_player_season_stats`

Status:

- complete for NHL 22–25 (`159` reviewed rows)

### 2. Club-member screenshots

Files / scripts:

- `club_members/`

Output target:

- `historical_club_member_season_stats`

Status:

- complete for NHL 22–25 (`42` canonical rows after final reconciliation)

### 3. Club/team stats screenshots

Files / scripts:

- `club_team_stats/extract_club_team_stats.py`
- `club_team_stats/run_review_queue.py`
- `club_team_stats/augment_review_index.py`

Output target:

- `historical_club_team_stats`

Status:

- schema + importer + extractor built
- NHL 25 hand-keyed pilots proven
- cross-title review queue generated for all `17` logical playlist pairs
- reviewed import across the full queue is still pending

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

GPU inference is wired up and was used for the NHL 22–25 batches. The venv has
`onnxruntime-gpu` installed (replacing the CPU `onnxruntime` wheel).

Required runtime env for a GPU run:

```bash
export OCR_USE_CUDA=1
export OCR_INTRA_THREADS=1
export OCR_INTER_THREADS=1
# LD_LIBRARY_PATH must point at the pip-bundled CUDA libs in the venv,
# otherwise ONNX Runtime falls back to CPU silently.
export LD_LIBRARY_PATH="$VIRTUAL_ENV/lib/python3.12/site-packages/nvidia/cudnn/lib:$VIRTUAL_ENV/lib/python3.12/site-packages/nvidia/cuda_runtime/lib:$LD_LIBRARY_PATH"
```

On startup the extractor logs:

- available ONNX Runtime providers
- the effective RapidOCR kwargs

If `CUDAExecutionProvider` is not listed, the run will fall back to CPU even
if `OCR_USE_CUDA=1` is set.

Operational rules:

- One OCR batch at a time per GPU. Do not run two in parallel.
- First inference on a fresh process is slower due to model/runtime warmup.
- `--save-crops` is still mostly I/O-bound and will not speed up much.
- Performance optimization is no longer the active workstream. The kept
  improvements are: video-static-context cache (filters / footer_gamertag /
  highlight_rank only — `footer_summary` deliberately excluded because of a
  transient bad-frame regression), `cv2.grab/retrieve` skip-frame pattern,
  and the GPU env above. The dHash header cache was reverted (0% hit rate on
  continuously scrolling tables).

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

## Salvage policy for bad OCR

If a typed numeric field is OCR-corrupt (e.g. clipped percent, overflow value),
patch that single column to NULL in the reviewed JSON before import rather
than dropping the whole record. The raw OCR remains in `stats_json`. Example
from NHL 25: `silkyjoker85` 6s/goalie was salvaged with `save_pct`,
`total_saves`, and `total_shots_against` set null while GP/W/L/OTL/GAA/GA
remained valid; UI renders the null cells as `—`.
