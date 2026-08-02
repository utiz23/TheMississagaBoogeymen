# Follow-up — post_game_box_score per-period OCR accuracy

**Opened:** 2026-06-04, out of the secondary post-game extractor robustness activation
(`docs/ocr/post-game-extractor-robustness-followup.md`).
**Status:** **DIAGNOSED 2026-06-09** (see §Diagnosis). Root cause is a **Pass-1/Pass-2 frame
segmentation defect** — a faceoff-tab frame was captured into the goals/shots box-score segments
(`goals/00003.png` is byte-identical to `faceoffs/00001.png`), so those extractions read faceoff
numbers. **Not** a parser/ROI bug and **not** stale data: the current parser reproduces the same
garble on the actual captured frames. **Re-OCR is ineffective; re-ingest is currently infeasible**
(video not in the per-match layout `reprocess` expects + unchanged decoder → provenance collision &
same frames). Accurate per-period box-score for 2582 is **not recoverable** without a segmentation fix

- decoder bump. **Disposition: keep the feature; leave or delete the 4 harmless `pending_review`
  rows.** Low priority — never promoted, never displayed.

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
- **UI is NOT affected (verified 2026-06-04).** The match-detail page (`apps/web/src/app/games/[id]/page.tsx`)
  reads enrichment only via the gated queries in `packages/db/src/queries/match-enrichments.ts`
  (`getMatchPeriodSummaries`, `getMatchShotTypeSummaries`, `getMatchFaceoffDots`,
  `getMatchFaceoffZoneSummaries`), each of which surfaces OCR rows only when
  `source='ocr' AND review_status='reviewed'`. **All of 2582's OCR enrichment rows are `pending_review`**
  (box-score 4, net-chart 6, faceoff zone 2, faceoff dots 9), so the garbled splits are filtered out and
  never render. They would only appear if an operator explicitly marks them `reviewed`. → not urgent; this
  follow-up is about data quality, not a user-facing display bug.

## Tasks (when picked up)

1. Diagnose on the saved good box-score frames (`tools/video_ingest/tests/fixtures/ws6-match2582-postgame/
frames/canonical/t1969_box_score_goalsummary.png`, `t1971_box_score_faceoffsummary.png`) whether the
   per-period column ROIs in `tools/game_ocr/game_ocr/configs/roi/post_game_box_score_*.yaml` are correct
   per tab, or whether the parser (`parse_post_game_box_score` in `parsers.py`) reads the wrong columns.
2. Confirm whether the three tabs genuinely share a column layout (so the same digits _should_ differ by
   tab) — i.e. is goals=shots=faceoffs a parse bug or a legitimate read of a shared region.
3. Cross-check corrected per-period sums against EA's 3–2 / 16–17 totals as ground truth.
4. Decide whether the OCR per-period box-score is worth keeping at all, given EA is authoritative — it may
   be cheaper to drop the `source='ocr'` box-score promotion than to fix it.

## Reference state

- Run **1945** is the active run for match 2582 (activated 2026-06-04). The garbled rows are
  `match_period_summaries WHERE match_id=2582 AND source='ocr'`.
- Zero-cell warning frames (redundant transition frames, no recoverable data): extractions 16029
  (shots 00003), 16031/16032 (faceoffs 00002/00003) — these are NOT the cause of the garble; the _good_
  frames (16024-26 goals, 16027-28 shots, 16030 faceoffs) carry the garbled values.

## Diagnosis (2026-06-09)

> **Correction:** an earlier draft of this section concluded "current parser correct, garble is stale
> data from an old parser." That was **wrong** — it tested the hand-curated _fixtures_, not the frames
> the pipeline actually captured. Re-checking against the real captured frames overturns it (below).

Method: ran the current `Extractor.extract_path` on **both** the curated fixtures
(`…/canonical/t1969_box_score_goalsummary.png`, `t1971_box_score_faceoffsummary.png`) **and** the nine
actual run-1945 captured frames in `/tmp/ingest-cache/967ed784…/pass2-run-1945/seg-07{2,3,4}-*/`,
plus the stored `raw_result_json` of extractions 16024–16032, all cross-checked against EA.

### Finding 1 — root cause is FRAME SEGMENTATION, not the parser and not stale data

The current parser on the **actual captured frames** still produces the garble — behaviour is
_unchanged_ old-run → now:

| captured frame | current parser reads | note                                            |
| -------------- | -------------------- | ----------------------------------------------- |
| goals 00001    | `5/7 1/5 3/5 1/0`    | faceoff-shaped — WRONG for goals                |
| goals 00002    | _(empty)_            | real goals frame, headers unreadable → no cells |
| goals 00003    | `5/7 1/5 3/5 1/0`    | faceoff-shaped — WRONG                          |
| shots 00002    | `5/7 1/5 3/5 1/0`    | faceoff-shaped — WRONG                          |
| faceoffs 00001 | `5/7 1/5 3/5 1/0`    | legit faceoff data                              |

The smoking gun is in the md5s: **`seg-072-goals/00003.png` is byte-identical to
`seg-074-faceoffs/00001.png`** (`bcc70f6e…`). A **faceoff-tab frame was captured into the goals
segment** (and the shots segment behaves the same way). So the goals/shots box-score extractions read
_faceoff numbers_ because the frames they were given show the _faceoff tab_. The one true-goals frame
(00002) carries headers the parser can't normalise, so it yields nothing. This is a **Pass-1/Pass-2
frame segmentation/selection defect** (cross-tab frame bleed), upstream of OCR.

### Finding 2 — the curated fixtures are DIFFERENT, cleaner frames the pipeline never captured

`Extractor.extract_path('post_game_box_score_goals', t1969…)` on the **fixture** does read EA-exact:

```
away_stats_row : 1 1 0 1 0 3  → away total 3 ;  home_stats_row : 1 0 1 0 0 2  → home total 2   (= EA 3–2)
```

But the fixture (`md5 2d8ca39…`) matches **none** of the captured goals frames — it is a separate,
hand-picked clean frame. So "the parser reads goals correctly" is true _only on a frame the pipeline
did not select_. It does **not** mean the live data is recoverable from what was captured.

### Finding 3 — the promoter is sound

[`box-score.ts`](../../apps/worker/src/ocr-promoters/box-score.ts) writes only the `stat_kind`'s
columns, update-first to merge tabs, and skips garbled rows (`period_number < 1`). No bug. The
identical columns are an artifact of the **bad input frames**, not the promotion logic. (All 4 stored
rows carry `ocr_extraction_id = 16030`, the last writer; the values are the faceoff-shaped read.)

### EA ground truth (confirmed live)

`SELECT score_for, score_against, shots_for, shots_against FROM matches WHERE id=2582;` → `3 / 2 / 16 / 17`.

### Remedy assessment

- **Re-OCR the existing `/tmp` frames — INEFFECTIVE (proven).** The current parser yields the same
  `5/7` from those frames; re-extracting them just rewrites the same bad rows.
- **Re-ingest from source video — currently INFEASIBLE.** (a) `video-ingest reprocess` resolves the
  video at `/mnt/k/NHL/NHL26/match <id>/*.mkv`; that per-match layout doesn't exist (videos are stored
  flat by timestamp), so resolution fails. (b) Even with a `--video` override, the decoder is
  **unchanged** since run 1945 (same `decoder_version=hmm-viterbi-v2-pg-robust` + `weights_hash`), so
  `create-candidate` would collide on the `(match_id, video_sha256, decoder_version, weights_hash)`
  provenance unique index, **and** an unchanged segmenter would re-select the same faceoff-bleed frames
  → same garbage. A genuine re-ingest fix requires **(1) a segmentation/selection fix** so faceoff
  frames don't land in the goals/shots segments, **plus (2) a `DECODER_VERSION` bump** to mint a
  distinct run.
- **Manual fixture ingest** — the curated clean frames exist for goals + faceoffs only (no shots
  fixture), so this could correct 2 of 3 tabs at best, with fixture-file provenance. Hacky; not pursued.

### Disposition (2026-06-09)

**Keep the feature; the rows stay harmless.** Accurate per-period box-score for 2582 is **not
recoverable** without the segmentation fix + decoder bump above. The 4 stale `pending_review` rows
never reach `player_match_stats`, aggregates, or the UI, so they are safe to **leave as-is** or
**delete**; either is fine. Resolved this cycle as a _diagnosis_, not a data fix. Re-open the
segmentation angle only if per-period box-score accuracy is ever promoted to a real requirement.

### Resolution of the original tasks

1. **ROI per tab correct?** — ROI is fine; the _frames_ are wrong (faceoff frame in the goals segment).
2. **goals=shots=faceoffs a parse bug or shared region?** — Neither. Cross-tab **frame bleed** at
   capture time (Finding 1).
3. **Corrected sums vs EA?** — Recoverable only from curated clean frames (fixture goals → 3–2), not
   from what the pipeline captured.
4. **Worth keeping?** — Keep; the parser works on clean frames. Accuracy is gated on frame selection.

### Deferred hardening notes (optional, not blocking)

- **Segmentation cross-tab bleed** — the real fix: stop faceoff frames being captured into the
  goals/shots box-score segments (`pass1_segment.py` / `pass2_extract.py` selection). Needs a decoder
  bump to re-ingest.
- **Unreadable real-goals headers** — frame 00002's `1ST/2ND/3RD` garble (`ur`/`2N0D`/`'aRU`) isn't
  recovered by `_normalize_period_label`; if it were, the correct goals frame would have survived.
- **Promote-time EA cross-check** — reconcile box-score goals TOT against `matches.score_for/against`
  and flag/skip on mismatch; would have caught the run-1945 `goals→10` write at the source.
