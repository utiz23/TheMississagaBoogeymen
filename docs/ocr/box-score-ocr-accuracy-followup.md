# Follow-up — post_game_box_score per-period OCR accuracy

**Opened:** 2026-06-04, out of the secondary post-game extractor robustness activation
(`docs/ocr/post-game-extractor-robustness-followup.md`).
**Status:** NOT STARTED. Scoped, evidence captured, no fix attempted. **Out of scope** for the robustness
workstream (which only made the run activate); this is a separate OCR digit-quality defect.

## The defect

The box-score per-period values landed for match 2582 (run 1945, `match_period_summaries source='ocr'`)
are garbled:

```
period  goals_f/a  shots_f/a  faceoffs_f/a
1ST       5 / 7      5 / 7        5 / 7
2ND       1 / 5      1 / 5        1 / 5
3RD       3 / 5      3 / 5        3 / 5
OT        1 / 0      1 / 0        1 / 0
```

Two clear tells:
1. **All three stat tabs (goals / shots / faceoffs) read identical per-period numbers.** Independent tabs
   producing identical values across all 4 periods is implausible — the three `post_game_box_score_{goals,
   shots,faceoffs}` parses are reading the same cells (likely a shared per-period column ROI that doesn't
   shift per tab, or the tabs share a layout the parser doesn't disambiguate).
2. **Totals contradict EA.** `goals_for` sums to 10; EA's authoritative score is **3–2**, shots **16–17**.

This is **pre-existing** (the identical pattern is present in run 1944, the original pre-fix candidate), not
introduced by the robustness fixes.

## Why it's harmless right now

- Box-score `source='ocr'` rows are **supplementary / evidence-layer**. EA is authoritative for the box
  score; OCR box-score is **never promoted into `player_match_stats`** (explicit WS6 scope decision).
- Activation rebuilds only loadout/lobby canonical snapshots + match colors — it does **not** propagate
  these per-period rows into any authoritative table.
- The frontend match-detail page may surface these `source='ocr'` per-period rows; if so, they will display
  wrong per-period splits until fixed. Verify whether the UI reads `match_period_summaries source='ocr'`.

## Tasks (when picked up)

1. Diagnose on the saved good box-score frames (`tools/video_ingest/tests/fixtures/ws6-match2582-postgame/
   frames/canonical/t1969_box_score_goalsummary.png`, `t1971_box_score_faceoffsummary.png`) whether the
   per-period column ROIs in `tools/game_ocr/game_ocr/configs/roi/post_game_box_score_*.yaml` are correct
   per tab, or whether the parser (`parse_post_game_box_score` in `parsers.py`) reads the wrong columns.
2. Confirm whether the three tabs genuinely share a column layout (so the same digits *should* differ by
   tab) — i.e. is goals=shots=faceoffs a parse bug or a legitimate read of a shared region.
3. Cross-check corrected per-period sums against EA's 3–2 / 16–17 totals as ground truth.
4. Decide whether the OCR per-period box-score is worth keeping at all, given EA is authoritative — it may
   be cheaper to drop the `source='ocr'` box-score promotion than to fix it.

## Reference state

- Run **1945** is the active run for match 2582 (activated 2026-06-04). The garbled rows are
  `match_period_summaries WHERE match_id=2582 AND source='ocr'`.
- Zero-cell warning frames (redundant transition frames, no recoverable data): extractions 16029
  (shots 00003), 16031/16032 (faceoffs 00002/00003) — these are NOT the cause of the garble; the *good*
  frames (16024-26 goals, 16027-28 shots, 16030 faceoffs) carry the garbled values.
