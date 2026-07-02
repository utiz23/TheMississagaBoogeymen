# Fixture Provenance — fixture_match2577_loadout

Second benchmark match for the pre-game field-accuracy gate (Phase B Gate 2).
`expected_loadout_evidence.json` is the parity-locked current-`main` extractor
output for match **2577**; `test_field_benchmark.py` scores it against the
hand-labeled ground truth (`../../benchmark/labels/2577.json`) and asserts each
field clears its per-match floor. Deterministic (reads the static golden JSON —
no OCR, no DB).

## Source of truth — frames

**Source video:** `/mnt/k/NHL/NHL26/match2577/2026-05-31_15-37-45.mkv`
(1920×1080, 60 fps, ~1904 s). Full recording of the club game archived as match
2577 (NHL 26 clip `2026-05-31_15-37-45`).

**Benchmark frames (regenerable + persisted off-repo):**
`/mnt/k/NHL/NHL26/match2577-bench-frames/00001.png … 00120.png` (120 frames).
Persisted on the K: drive rather than committed to git (same convention as the
`match463-label-frames/` label dumps) — 120 × ~2 MB is too heavy for the repo, and
the field-benchmark gate depends only on the committed golden JSON, not the frames.

**Exact reproduction recipe:**

```bash
ffmpeg -nostdin -ss 76 -i /mnt/k/NHL/NHL26/match2577/2026-05-31_15-37-45.mkv \
       -t 40 -vf fps=3 <bundle>/%05d.png
tools/game_ocr/.venv/bin/python tools/game_ocr/scripts/score_field_benchmark.py \
  --labels tools/game_ocr/calibration/extras/loadout/benchmark/labels/2577.json \
  --from-extractor <bundle> --segment-index 2 \
  --out tools/game_ocr/calibration/extras/loadout/benchmark/reports/2577-baseline.json
```

(The golden itself is `[r.to_dict() for r in records]` from the same
`extract_loadout_evidence(bundle_dir, segment_index=2)` run.)

**Window rationale — the cancelled first game.** The clip contains an initial
game that was **cancelled after partial data collection**, then the real game was
recorded (see `labels/2577.json` `labeling_notes`). The extraction window
**t76–116 s @ 1 fps** targets the real (second) game's loadout-navigation window
only:

- **~t45** — PLAYER LOADOUTS detail cards of the **cancelled** first game (before
  matchmaking). Excluded.
- **~t60** — lobby "FINDING OPPONENT" (a fresh matchmaking search).
- **~t75** — opponent found (LES CARCAJOUX), "GAME STARTS IN 0:38" → real game
  starts ≈ t113.
- **~t76–113** — the real game's PLAYER LOADOUTS navigation (all 10 skater cards).
- Starting at t76 keeps the window clear of the cancelled game. Sampling rate
  matters: the coarse 3 s inbox sampling surfaced only ~3 of 10 cards; 1 fps
  captures all 10 subjects but some cards' sharpest available frame is a blurry
  transition (build 0.80 / x_factor_name 0.767); **3 fps** gives enough candidate
  frames per card that the sharpness-based best-frame selection lands crisp cards
  (build 0.90 / x_factor_name 0.867 / position 1.00). 3 fps is the committed golden.

**segment_index used:** 2 (matches the `250` fixture; used only in slot_key
construction, not frame selection).

## Source of truth — expected_loadout_evidence.json

**Total records:** 905 across the assembled subject bundles (10 aligned skater
subjects + roster-strip / title-bar phantom bundles).
**Extractor version stamped:** whatever `EXTRACTOR_VERSION` was at generation.

This LOCKS current extractor behavior. Known honest artifacts (same families as
the match-250 golden documents):

- **Subject-split phantoms.** A player's roster-strip gamertag bundle and its
  title-bar-derived bundle can split (e.g. `MAJORBLAKA958` vs the title-bar
  `SHOOTS LEFT` read). The scorer aligns each truth subject to its best-matching
  predicted bundle, so 10/10 truth subjects align; splits show up as one missed
  card / captain (against_RW captain `fn`), not as a subject-count drop.
- **persona / attribute OCR.** persona 0.50 and attribute_value 0.665 reflect
  right-pane OCR difficulty on this footage, not a segmentation defect.

## Baseline (measured, committed)

`../../benchmark/reports/2577-baseline.json` — subjects 10/10 matched. Per-field
accuracy: gamertag 0.90 · player_number 1.00 · position 1.00 ·
build_class_canonical 0.90 · x_factor_name 0.867 · x_factor_tier 0.90 ·
attribute_value 0.748 · persona 0.50 · player_level 0.0 · handedness 0.0 ·
captain fp=0 (fn=1). These are the floors locked in `test_field_benchmark.py`
(rounded down to a clean lower bound); ratchet up as the extractor improves.
