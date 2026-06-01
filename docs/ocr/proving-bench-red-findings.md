# Investigation: proving-bench absolute-RED (root cause)

**Branch:** `investigate/proving-bench-red` (off `main` @ `dc8745b`)
**Date:** 2026-06-01
**Symptom:** `test_screen_classifier_proving_bench.py` (`RUN_CLASSIFIER_E2E=1`) fails on the
baseline — `match-968-menu-sequence` 88.3% (53/60), `match-250-lobby-loadout` also <90%.
Independent of WS2 (the WS2 pre-OCR gate fires on 0 frames in these bright clips).

## Root cause (CONFIRMED)

The **canonical-PTS flip `c872670`** (2026-05-29, "flip Pass-1 to canonical PTS at all call
sites") replaced the proving bench's frame sampler **`_iter_raw_bgr_frames`** (ffmpeg `fps=1`
filter, index-derived timing) with **`iter_sampled_frames`** (PyAV, seeks by canonical
container PTS) and deleted `_iter_raw_bgr_frames`.

The ground-truth labels (`labels.json`, per-second) were authored and validated against the
**old** sampler's frames (green at `d1cdfee`, 2026-05-27). The two samplers select a
**materially different physical frame at 18 of 60 second-indices** (concentrated at
screen-transition boundaries), so after the flip the second-keyed labels no longer align with
the frames — at boundary seconds the new frame shows the adjacent screen → misclassification.

**Same model, same labels — only the frames moved.** This is a fixture/sampler-alignment
regression, not a classifier or label-content bug.

### Three independent proofs

1. **Weights unchanged.** `d1cdfee` (green) vs HEAD `nhl26-screen-classifier-v2.json` parse to
   numerically identical `coef (18,273)` + `intercept (18,)` (allclose), same classes/n_priors.
   `9cea42c` only reformatted the JSON (compacted whitespace). → not the weights.
2. **Labels unchanged.** `d1cdfee` vs HEAD label spans are semantically identical
   (`9cea42c` only pretty-printed). → not the labels.
3. **Only the sampler changed**, and the new sampler returns different frames. Decode-only
   comparison of `_iter_raw_bgr_frames` (resurrected from `d1cdfee`) vs `iter_sampled_frames`
   on match-968: meanAbsPixelDiff > 8 at indices
   **{0,1,2,6,14,18,19,23,27,29,32,40,42,45,46,47,58,59}** (18/60). (~4–7 baseline on
   "same" frames is ffmpeg-scale vs PyAV-reformat scaler noise.)

### Per-second corroboration (OCR content at the failing seconds)

match-968 (7 mismatches; 6 land on divergent frames, OCR shows the *adjacent* screen):
- t=6  exp lobby   → OCR is the club-menu nav (`play loadouts clubs customize…`) = prior screen
- t=14 exp loadout_view → OCR is the `playerloadouts` hub, not the player-detail view (shifted later)
- t=46 exp world_of_chel → OCR is `eashl 6v6` lobby (WoC window moved off t=46)
- t=47 exp world_of_chel → sparse transition frame
- t=58,59 exp loading_or_intro → different cutscene frames (empty OCR)
- t=9 (the 7th) is a "same-frame" knife-edge transition the label note itself calls
  "genuinely ambiguous… not testable"; decode flipped from scaler/Viterbi-context drift.

match-250 (5 mismatches, identical signature):
- t=16,17,18 exp loadout_view → OCR `playerloadouts` hub (detail span starts ~3 frames later)
- t=29 exp lobby → OCR still loadout detail (`playmaker home`) — span tail spilled past boundary
- t=51 exp world_of_chel → OCR `eashl 9^9` lobby (1-frame WoC window moved)

### Why it landed silently

`c872670` reported "418 passed" but the proving bench is gated behind `RUN_CLASSIFIER_E2E=1`
and was not run with that flag after the flip; the E2E gate was never executed post-flip.

### Collateral (same root cause)

`_iter_raw_bgr_frames` deletion also broke two diagnostic scripts that still import it:
`tools/game_ocr/scripts/diagnose_v2_proving_bench.py` and
`tools/game_ocr/scripts/diagnose_segments.py` (the latter is the `test_diagnose_segments.py`
pre-existing failure seen in the full suite).

## Recommended fix (NOT yet applied)

The bench must validate the **same sampler production uses** — `iter_sampled_frames` (canonical
PTS). So **re-anchor `labels.json` to the canonical-PTS frames**: dump the new per-second frames,
eyeball the ~12–18 boundary seconds across both clips, and shift the label spans to match the
frame each second actually shows. Optionally mark genuine 1-frame transition boundaries (WoC
splash, loadout entry) as relaxed/ambiguous (the labels already do this for t=9). Do **not**
revert the sampler (that would test a sampler production no longer uses) and do **not** loosen
the accuracy threshold (hides the issue). Also fix the two diagnostic scripts to use
`iter_sampled_frames`.

Reproduce / dump tool: `tools/game_ocr/scripts/diag_bench_current.py` (uses the current
`iter_sampled_frames` path; dumps per-second expected/predicted/OCR/top3).
