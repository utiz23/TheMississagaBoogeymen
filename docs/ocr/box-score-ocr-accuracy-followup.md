# Follow-up — post_game_box_score per-period OCR accuracy

**Opened:** 2026-06-04, out of the secondary post-game extractor robustness activation
(`docs/ocr/post-game-extractor-robustness-followup.md`).
**Status:** **DIAGNOSED 2026-06-09** (see §Diagnosis). Root cause is **stale run-1945 data**, not a
live parser/ROI defect: the current parser reads the canonical goals frame **correctly** (EA-exact
3–2). **Recommendation: keep the feature, no parser fix; refresh-or-delete the 4 stale rows.** Still
harmless (the bad rows are `pending_review`, never promoted, never displayed). Low priority.

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

## Diagnosis (2026-06-09)

Diagnosed read-only against the two saved canonical frames
(`…/canonical/t1969_box_score_goalsummary.png`, `t1971_box_score_faceoffsummary.png`) via
`Extractor.extract_path` + raw-region OCR dumps, cross-checked against EA and the stored
`raw_result_json` of all nine run-1945 box-score extractions (16024–16032).

### Finding 1 — the current parser is CORRECT on the goals frame (refutes the wrong-ROI hypothesis)

`Extractor.extract_path('post_game_box_score_goals', t1969…)` today yields the **EA-exact** result.
Raw per-region tokens (high confidence, cleanly column-aligned):

```
period_header_row : 1ST(.98) 2ND(.99) 3RD(1.0) OT(.96) S0(.69) TOT(.99)
away_stats_row    : 1   1   0   1   0   3      → THE BOOGEYMEN, away total 3
home_stats_row    : 1   0   1   0   0   2      → ROC RIVER RATS, home total 2
```

`3–2` matches EA (`matches.score_for/against = 3/2`) exactly, and the per-period sums reconcile to
TOT. **The goals ROI lands on the correct goals stat table and reads it correctly** — the leading
"shared score-strip / wrong ROI" hypothesis (§The defect, tell #1) is **refuted**. The faceoffs frame
likewise yields *distinct* values (`5/7, 1/5, 3/5, 1/0`), so `goals = shots = faceoffs` does **not**
reproduce with current code.

### Finding 2 — the DB garble is STALE run-1945 output, not a current read

The 4 stored rows all carry `ocr_extraction_id = 16030` and hold `5/7, 1/5, 3/5, 1/0` in **all three**
column-pairs (goals/shots/faceoffs). Provenance from the stored `raw_result_json`:

| extraction | tab | stored periods | headers |
|---|---|---|---|
| 16024, 16026 | goals | `5/7 1/5 3/5 1/0` | valid (1ST..OT) |
| 16025 | goals | `1/1 1/0 0/1` | **garbled** (`ur`,`2N0D`,`'aRU`) → period 0 |
| 16027 | shots | `1/1 1/0 0/1` | **garbled** → period 0 |
| 16028 | shots | `5/7 1/5 3/5 1/0` | valid |
| 16030 | faceoffs | `5/7 1/5 3/5 1/0` | valid |
| 16029, 16031, 16032 | shots/faceoffs | zero cells | — |

So at run-1945 the **goals and shots** tabs' *valid-header* frames (16024/16026/16028) produced the
same faceoff-shaped `5/7…` reading and were promoted into `goals_*`/`shots_*`; the genuinely-correct
goals values (`1/1 1/0 0/1`, = EA 3–2) appeared only in **garbled-header** frames (16025/16027) which
the promoter correctly **skipped** (`period_number < 1`). That is *why* all three column-pairs ended
up identical — not three tabs sharing an ROI today, but run-1945's valid-header frames all yielding
the faceoff-shaped read. The defect predates parser/selection hardening that has since landed; the
canonical frames prove current behaviour is correct.

### Finding 3 — the promoter is sound

[`box-score.ts`](../../apps/worker/src/ocr-promoters/box-score.ts) writes only the `stat_kind`'s
columns, update-first to merge tabs, and skips synthetic/garbled rows (`period_number < 1`). No bug.
The identical columns are an artifact of the stale *inputs*, not the promotion logic.

### EA ground truth (confirmed live)

`SELECT score_for, score_against, shots_for, shots_against FROM matches WHERE id=2582;` → `3 / 2 / 16 / 17`.

### Resolution of the original tasks

1. **ROI per tab correct?** — Yes. Goals ROI reads the goals table correctly (Finding 1). Not an ROI bug.
2. **goals=shots=faceoffs a parse bug or shared region?** — Neither (today). It's stale run-1945 data
   where every valid-header frame happened to read the faceoff-shaped values (Finding 2).
3. **Corrected sums vs EA?** — Current goals read reconciles to EA 3–2 exactly.
4. **Worth keeping?** — **Yes, keep.** The parser works and per-period splits are info EA doesn't expose.

### Recommendation

**KEEP the feature; no parser fix; data-refresh only.** The defect is already fixed in the producer.
**Chosen remedy: re-OCR match 2582** through current code (re-extract, not a transform-only
`reprocess` — the stored `raw_result_json` is itself wrong) **and** re-validate the result. This is
preferred over manual row deletion because the real fix is refreshed *source* data, not patching
around the symptom; deleting the 4 `pending_review` rows is only a last-resort fallback if re-OCR is
impractical (e.g. source frames no longer available). Low priority either way: the stale rows never
reach `player_match_stats`, aggregates, or the UI. **Not done this cycle** (rows left untouched).

**Two minor, deferred hardening notes (optional, not blocking):**
- The faceoffs frame's away/home rows mis-bin under `_align_row_to_headers` (scattered token
  x-positions + the `10`/`17` TOT tokens land the row TOT as UNCERTAIN even though the raw digits are
  present) — a robustness nit on the faceoffs path, not the goals defect under investigation.
- There is no cross-tab/EA sanity check at promotion. A cheap future guard: reconcile box-score goals
  TOT against `matches.score_for/against` at promote time and flag/skip on mismatch — it would have
  caught the run-1945 `goals→10` write at the source. Deferred unless re-OCR shows it's needed.
