# Screen classifier v2 — labeling runbook

Operator-facing guide for the Phase-A labeling pass that feeds
`train_screen_classifier.py`. The full plan is at
`/home/michal/.claude/plans/multi-session-strategic-fix-for-misty-hamster.md`;
this doc covers the day-to-day labeling steps.

## Goal

Get the screen classifier to stop sending non-lobby frames (CLUB management,
PLAYER LOADOUTS landing, loadout-detail, WORLD OF CHEL splash) into the typed
lobby/loadout extractors. The minimum-viable proof for Phase A is **20-30
labeled frames per new class plus per tightened class** (see counts below).

If 30 frames per class is enough to make the proving bench pass, Phase A is
done. Phase B (heavy labeling, 100+/class, gameplay subclass split) is
contingent on what the bench shows.

## Phase-A label targets

| Class | Target | Status |
|---|---|---|
| `menu_club_management` | 30 | new — start at 0 |
| `player_loadout_landing` | 30 | new — start at 0 |
| `menu_world_of_chel` | 30 | new — start at 0 |
| `player_loadout_view` (tightened: detail-only) | 30 | currently 1, retag if needed |
| `pre_game_lobby_state_2` (tightened: 2-panel only) | 30 | currently 4 |
| `loading_or_intro` (tightened: no WoC splash) | 20 | currently 0 |
| `unknown_or_transition` | 20 | currently 0 |

Run `python3 tools/game_ocr/scripts/label_state_machine_corpus.py --counts
--extra-states menu_club_management,player_loadout_landing,menu_world_of_chel`
any time to see live counts. `--extra-states` is required while the 3 new
classes are not yet registered in `nhl26.yaml` (S3 will add them and the flag
will be a no-op once the YAML catches up).

## Workflow

### 1. Bulk-extract candidates from your video library

```bash
python3 tools/game_ocr/scripts/bulk_extract_label_candidates.py \
    --root /mnt/k/NHL/NHL26 \
    --interval 30
```

This samples one frame every 30s from every `.mkv`/`.mp4` under
`/mnt/k/NHL/NHL26`, deduplicates exact-thumbnail matches, and writes PNGs to
`tools/game_ocr/calibration/extras/_inbox/<video_stem>/cand-tNNNNN.png` plus
a per-video `manifest.json`.

Pass `--interval 10` for denser sampling (more candidates → more labeling
work but better coverage of short-lived screens like goal overlays). Use
`--no-dedup` to keep every sample (useful when iterating on a single video).

You can re-run the extractor — already-extracted timestamps are skipped.

### 2. Label by class, highest-impact first

The labeler walks the inbox and asks for a numeric label for each PNG.
Press `s` (or Enter) to skip, `q` to quit.

**Wave A (proving-bench critical — do these first):**

```bash
python3 tools/game_ocr/scripts/label_state_machine_corpus.py \
    --from-inbox tools/game_ocr/calibration/extras/_inbox \
    --extra-states menu_club_management,player_loadout_landing,menu_world_of_chel \
    --target-class menu_club_management
```

`--extra-states` appends the 3 new (not-yet-in-YAML) classes to the menu so
you can pick them by index. They show up at positions 17/18/19 in the
numbered state menu.

Walk through every PNG; for each, decide which of the 17(+3) states it
actually shows and enter the corresponding number. `--target-class` just
prints a suggested default at each prompt; you're free to enter any class.

Repeat for `--target-class player_loadout_landing`, then
`--target-class menu_world_of_chel`. Then make sure `pre_game_lobby_state_2`
and `player_loadout_view` are at ≥30 fresh labels each so the classifier
re-learns their tightened definitions.

Skip frames that don't show what you're hunting for — the labeler keeps
unlabeled candidates in the inbox so a later pass can pick them up.

### 3. Check counts

```bash
python3 tools/game_ocr/scripts/label_state_machine_corpus.py \
    --counts --target 30 \
    --extra-states menu_club_management,player_loadout_landing,menu_world_of_chel
```

Print the per-class status. Anything still `[need +N]` for a Wave-A class
needs more labels before training.

### 4. Retrain

```bash
PYTHONPATH=tools/game_ocr python3 tools/game_ocr/scripts/train_screen_classifier.py \
    --version nhl26
```

Writes new weights to
`tools/game_ocr/game_ocr/weights/nhl26-screen-classifier.json`. Commit the
updated weights alongside the new PNGs.

### 5. Validate against the proving bench

The bench fixture lives at
`tools/video_ingest/tests/fixtures/screen-classifier-proving-bench/` (see the
README in that directory). It contains 3-5 short clips covering the
known-bad screens with hand-labeled ground truth. The S5 test
`test_screen_classifier_proving_bench.py` runs Pass-1 with the new weights
and asserts per-frame accuracy ≥ 90% on each clip.

If the bench passes for the known-bad clips AND existing regression tests
on matches 250 + 463 hold, Phase A is done — proceed to A3 (reprocess CLI).

If the bench fails for a class with already-target labels, the issue is
likely feature-pipeline-side (regex priors miss a screen variant, HSV
quadrants don't capture the layout difference, etc.) — that's S3's
territory; iterate on the feature pipeline rather than adding more labels.

## Filename convention

Labeled PNGs follow `<state>__match<N>_t<T>_vs_<opp>.png` (or
`<state>__match-unknown_t<T>_vs_unknown.png` when match/opp metadata is
missing). The trainer walks `calibration/extras/` and assigns each file's
label from the prefix before `__`. Don't rename files manually; just delete
and re-label if you mis-tagged.

## When to escalate to Phase B

Phase A ships only the minimum new-class set. If the proving bench shows
residual confusion in a class that Phase A didn't touch (e.g. gameplay
frames poisoning lobby extraction), that's Phase B's signal. Document the
residue in the A-gate decision and propose the specific class(es) to add.
