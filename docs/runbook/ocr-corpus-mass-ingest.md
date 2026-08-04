# OCR Corpus Mass-Ingest Runbook

The full-corpus video→OCR ingest: ~70 fresh recordings, ~50.6 h of footage, run
**chunked across sessions**. Written 2026-07-25, after the multi-reel pilot
(matches 970/971), the N=2/N=3 parallel knee-tests, and the review-queue drain
that validated the confirm→promote path end to end.

**Budget:** ~35–40 h Pass-1 at `--jobs 3` (CPU-compute-bound; see HANDOFF
"BOTTLENECK RE-CHARACTERIZED") plus promote passes. Interruptions are cheap:
Pass-1/Pass-2 decode caches persist per sha under the output root, so a re-run
skips finished work in seconds.

## The cycle

Each chunk is one loop of:

```
batch (Pass-1, parallel)  →  operator confirms proposals  →  batch-promote  →  linkage sweep  →  L4 grades
```

Repeat until `batch` reports nothing fresh and `batch-promote --dry-run` plans 0 videos.

## 0. Preflight (EVERY session, before any dispatch)

All commands from the repo root unless noted.

```bash
# 1. DB up (worker CLIs die asymmetrically without it — planning works, dispatch dies)
docker ps --format '{{.Names}} {{.Status}}' | grep db     # expect: healthy

# 2. Env — REQUIRED for worker CLIs and batch-promote; failure is silent-ish
set -a && source .env && set +a

# 3. Ingest venv must be ACTIVATED (path-invoking the binary skips .pth setup)
cd tools/video_ingest && source .venv/bin/activate && cd ../..

# 4. Walk-import the FULL closure (uv sync can strip GPU/OCR wheels incl. pydantic;
#    an import hole here once crashed a re-ingest 37 min in)
cd tools/video_ingest && python - <<'EOF'
import pkgutil, importlib, sys
failed = []
for pkgname in ("video_ingest", "game_ocr"):
    pkg = importlib.import_module(pkgname)
    for m in pkgutil.walk_packages(pkg.__path__, prefix=pkgname + "."):
        try: importlib.import_module(m.name)
        except Exception as e: failed.append((m.name, repr(e)))
import onnxruntime, pydantic
assert "CUDAExecutionProvider" in onnxruntime.get_available_providers(), "CUDA EP missing"
if failed: [print(" ", n, e) for n, e in failed]; sys.exit(1)
print("PREFLIGHT OK")
EOF
cd ../..

# 5. Worker dist current (only needed after TS changes):
pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build

# 6. Headroom: GPU near-idle, / has room for the ingest cache
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # ~2 GB idle baseline
df -h /

# 7. Decode cache root present and POPULATED (see the trap below). /tmp is wiped
#    on reboot; the durable store is ~/ingest-cache and /tmp/ingest-cache is a
#    symlink to it. Expect one dir per cached video.
ls -d /tmp/ingest-cache/*/segments.json 2>/dev/null | wc -l   # expect: >0
[ -e /tmp/ingest-cache ] || ln -sfn ~/ingest-cache /tmp/ingest-cache
```

`batch`, `batch-promote` and `reprocess` now preflight this themselves and refuse
to start against a root that holds no cached video, printing the symlink command.
The check keys on CONTENT (`<root>/<sha>/segments.json`), not existence, because
an existing-but-empty `/tmp/ingest-cache` is the failure mode — see the trap
table. `--allow-empty-cache` overrides it and is only correct on a genuinely
fresh machine with no cache yet.

## 1. Pass-1 chunk (parallel)

```bash
cd tools/video_ingest && source .venv/bin/activate
video-ingest batch --video-root /mnt/k/NHL/NHL26 --jobs 3 --limit <N>
```

- **`--jobs 3`** is the measured sweet spot (N=2 scales perfectly, N=3 costs
  ~18–24 % per-worker, ≥5 flattens). CPU cores are the ceiling — the GPU never
  is (peak ~48 % mem at 3-way). Do NOT chase N=6–10.
- **`--limit` slices the ledger BEFORE the already-ingested skip**, and
  unconfirmed-proposal videos re-list as "loose". Re-listed videos cache-hit and
  drain in ~10–15 s each (propose skips, no duplicate proposals), so size chunks
  as `done_so_far + fresh_wanted`, or drop `--limit` for a full drain.
- Terminal shows only START/DONE/SKIP lines; per-video live output is in
  `/tmp/ingest-cache/batch-logs-<ts>/<sha>.log` (`tail -f`).
- ETA: ~1.3–1.65 s/frame per worker ≈ 1.5–2 h wall per hour-of-footage per
  worker slot at N=3.
- ⚠️ `/tmp/ingest-cache` does not survive a reboot. "Only costs re-decode time"
  understates it: at ~30–45 min per video over the corpus that is tens of hours,
  and before the preflight existed it was spent SILENTLY — the run completed and
  reported success. DB state is genuinely unaffected. The durable store is
  `~/ingest-cache`; keep `/tmp/ingest-cache` a symlink to it.

## 2. Operator confirm pass (after each chunk)

```bash
set -a && source .env && set +a
pnpm --filter worker resolve-match list            # pending proposals + hints
pnpm --filter worker resolve-match confirm --id <N> [--match-id <M>]
pnpm --filter worker resolve-match reject  --id <N>
```

Review rules (all validated 2026-07-25):

- **`matches.played_at` is the game's END** (UTC). The identity probe now
  timestamps reels by their END too (`identity_probe.py`, fixed 2026-07-25), so
  the timestamp hint should usually be right — but boxscore-less reels are
  timestamp-only (conf ≈ 0.35, `runnerUpGap` in the 0.002 range), so **verify,
  don't rubber-stamp**: the candidate's `played_at` must fall inside
  `[video_start + reel.start_s, video_start + reel.end_s]` (reels.json under
  `/tmp/ingest-cache/<sha>/`).
- Recording basenames are the capture PC's **local wall-clock
  (America/Edmonton, DST-correct)** — add 6 h for UTC in summer. File mtime =
  recording end.
- **Spot-check with a frame** when in doubt — 10 seconds of work:
  `ffmpeg -ss <t> -i /mnt/k/NHL/NHL26/<file>.mkv -frames:v 1 -q:v 2 /tmp/f.jpg`
  The HUD score banner names the opponent (e.g. "716" = Fear the Buffalo) and
  the score bounds which match it can be (a team that won 4-0 never trails).
- **Lobby-only reels** (has_lobby, no game screens) → reject. Precedent:
  pilot reel 2, proposal 31.
- **The 8 known offline/junk recordings** (GAP-4 triage: all offline/vs-CPU/
  non-NHL/trims — `2026-05-09_02-07-51`, `2026-05-23_17-27-27`,
  `2026-05-23_17-57-40`, `2026-06-07_14-54-34`, `2026-06-07_15-18-45`, plus the
  Trim files inside `match2666/`, `match2667/`, `match2687/`) → reject their
  proposals on sight; the matcher can only produce garbage for them.
- A no-boxscore reel of a real game confirms fine — it grades HOLD later
  (unverifiable from video), like match 971. That is routing, not failure.

## 3. Promote chunk + linkage sweep

```bash
cd tools/video_ingest && source .venv/bin/activate
video-ingest batch-promote --video-root /mnt/k/NHL/NHL26 --dry-run   # check the plan
video-ingest batch-promote --video-root /mnt/k/NHL/NHL26 [--limit <N>]

# ALWAYS after a dispatch chunk — deferred dispatch writes run-less batch rows
set -a && source .env && set +a
pnpm --filter worker decoder-runs backfill-run-linkage --all-unlinked
```

- Confirm **all** of a video's reels before promoting it — skip granularity is
  per-video; a partially-confirmed video re-OCRs its drained reels.
- Promote is decode-cache-hit → dispatch-OCR only (~6–15 min/video observed).
- The reel-map lookup is fail-loud on this path (`--require-reel-map`, GAP-2):
  a lookup failure records `status="failed"`, never a false `"promoted"`.
- **L4 grades are printed per match: PASS / HOLD / OPERATOR_CONFIRM.** PASS
  certifies the FINAL SCORE only — per-period rows still flow through
  `reconcile-periods`. HOLD routes to review; it does not undo promotion.

Post-chunk invariant checks (should both be zero):

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -c "
SELECT count(*) AS matchlinked_unlinked FROM ocr_capture_batches WHERE match_id IS NOT NULL AND run_id IS NULL;
SELECT count(*) AS unmatched_with_run  FROM ocr_capture_batches WHERE match_id IS NULL AND run_id IS NOT NULL;"
```

## 4. Session wrap

- `reconcile-periods --all` to see what became promotable; `--match N --promote`
  per operator decision.
- Update HANDOFF.md with: chunk boundaries done, proposals confirmed/rejected,
  grades, anything weird.
- The review queue (HOLD matches) is expected to grow — that is the gate
  working, not a defect.

## Known traps (hard-won; do not rediscover)

| Trap                             | Rule                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| DATABASE_URL missing             | Planning succeeds, dispatch dies mid-run. Preflight step 2.                                                                                    |
| venv path-invoked, not activated | Imports resolve differently. Always `source .venv/bin/activate`.                                                                               |
| uv sync strips wheels            | Walk-import (preflight step 4) before every session.                                                                                           |
| Empty `/tmp/ingest-cache`        | Worse than a missing one: every existence check passes and the whole corpus re-decodes silently. Preflight step 7; the CLIs now fail closed.   |
| `--limit` pre-skip slicing       | Chunks shrink as the corpus completes; size limits generously.                                                                                 |
| played_at semantics              | Game END, not start. The pre-fix matcher ranked the previous match top on timestamp-only reels (frame-proven off-by-ones: proposals 28/29/30). |
| Foreground timeouts              | `batch`/`batch-promote` runs are hours long — background them; never under a 2-min foreground timeout.                                         |
| `git push`                       | Runs `scripts/verify-ocr.sh` (~20 min) pre-push. Background the push or `--no-verify` deliberately.                                            |
| Lobby #NN/build panel phases     | dHash prefilter stays OFF for lobby segments (phase-drop risk).                                                                                |
| EASHL has no shootout            | Period 6 = OT3. Tied OT3 games end as ties.                                                                                                    |
