# OCR / In-Game Data Extraction — Independent Review

Reviewer: Claude (separate investigation)
Date: 2026-06-13
Method: read the existing report, then independently verified its claims against source code, the docs trail, the test suites, and the **live database** (not fixtures or docs alone).

---

## 1. Verdict on the existing report

`current-in-game-data-extraction-system-report.md` is **directionally accurate and well-supported.** Every load-bearing claim traces to either source code or an underlying doc that says it more bluntly. Pre-game really is the weakest subsystem; Action Tracker really is the strongest; the candidate-run workflow is real; the segmentation/wrong-frame defect is documented and real.

It is, however, **a qualitative narrative with no numbers**, and it is **optimistic by omission** on three points my investigation surfaced. The corrections below are the reason to read this document rather than just trusting the original.

---

## 2. Hard ground truth the original report omitted (live DB)

The original report describes capabilities but never states what is actually in the database. Measured today:

| Table | Rows |
|---|---|
| ocr_extraction_fields | 456,010 |
| ocr_extractions | 12,077 |
| ocr_field_evidence | 11,283 |
| ocr_promotions | 9,786 |
| ocr_capture_batches | 347 |
| ocr_decoder_runs | 10 (4 active) |
| match_events | 519 |
| player_loadout_snapshots | 162 (8 CPU) |
| player_loadout_attributes | 1,868 |
| ocr_run_quality_reports | 9 |

**OCR data spans 4 matches: 250, 463, 968, 2582** — not the single pilot match (250) that prior project notes assumed. The candidate→active promotion flow is genuinely exercised: 10 runs, supersession history per match, exactly one active run each (enforced by the `one_active_per_match` partial unique index).

`match_events` (519 rows) carry real provenance: every row has `source` NOT NULL and nearly all have an `ocr_extraction_id` FK; x/y + `position_confidence` are populated for most goals/shots/hits (faceoffs/penalties are mostly position-less by design). 206 reviewed / 313 `pending_review`.

## 3. The most important omission: **no active run passes its own quality gate**

`ocr_run_quality_reports` has 9 rows. **Every report that was scored has `overall_pass = FALSE`** (the 4 older legacy/v1 reports are NULL = unscored). The four *active* runs:

| Match | l2 (content) | l2_lineup | l3 | demoted | unresolved | overall_pass |
|---|---|---|---|---|---|---|
| 250 | 0.85 | 0.95 | 1.00 | 2 | 0 | false |
| 463 | 0.70 | 0.83 | 0.92 | 4 | 6 | false |
| 968 | 0.84 | 0.83 | 0.82 | 3 | 0 | false |
| 2582 | 0.57 | 0.93 | 0.96 | 3 | 13 | false |

`l1_score` is NULL everywhere. Match 2582 (the documented frame-segmentation-defect match) is the weakest on content (0.57, 13 unresolved segments).

The original report calls candidate/validate/activate "one of the most defensible parts of the system." The *mechanism* is defensible. But the operational reality is that **data was activated despite failing the quality gate** — i.e. the gate is currently advisory in practice, not blocking. That nuance is absent from the original and materially changes how much you should trust the activated data.

## 4. Maturity is real but partly **default-disabled**, and CI doesn't guard the headline claims

- **Two flagship optimizations ship OFF.** `nhl26.yaml` sets `pre_ocr_gate.enabled: false` (explicitly "measured net-negative on real footage," 2026-06-07) and `visual_prefilter.pass2_enabled: false`. The machinery is built and tested but not on the production path. Honest engineering — but a reader skimming the elaborate code could over-read "maturity."
- **The proving bench — which the original report recommends keeping as the acceptance gate — does not run in CI.** It is `@unittest.skipUnless(RUN_CLASSIFIER_E2E=1)`. The default suite is green (video_ingest 523 pass / 2 fail; game_ocr 400 pass) but never exercises classifier accuracy, real ingest, or DB activation. The acceptance gate exists; nothing enforces it automatically.
- **The proving-bench README the original report cites (line 187) is a stale pre-fix snapshot** — it documents 66.7% accuracy (S5.5 prep). Actual current state after the 2026-06-01 label re-anchor is 95.0% / 96.7% (`proving-bench-red-findings.md`). The original report slightly *understates* how far the classifier work has come by citing the older artifact.

## 5. Live regressions / stubs found that the original report does not mention

- **Loadout typed_v1 parity regression (production default engine).** `test_loadout_evidence_fixture_parity.py::test_match250_parity` **fails** — extractor output diverged from authored expectation (151+ missing `loadout_slot_*` records). Either a real regression in the default loadout engine or fixture drift; either way it's an unflagged red test on the canonical pilot match.
- **Stale stub test.** `test_loadout_closed_vocab.py::test_predict_log_probs_raises_not_implemented` fails because the stub was implemented and the test wasn't updated. Harmless but indicates test-hygiene gaps in exactly the subsystem (loadout) the report calls weakest.
- **Player-summary promoter is a hard no-op** (`post-game-player-summary.ts:16`) — writes zero domain tables ("redundant with EA API"). The original report lists it among promoters that "currently exist" without noting it produces nothing.
- **Action Tracker emits deliberately-degraded data.** Penalty rows are written with placeholders (`infraction='(unknown)'`, `Minor`, `2 min`) at `review_status='pending_review'`, and `team_side` defaults to `'against'` when actor+target are both unresolved (a warn, not a failure). "Strongest path" ≠ "cleanest output."
- **NHL 27 version detection is a stub** (`version_detect.py`, empty anchors, `# TODO: populate when NHL 27 launches`). `auto` detection only works for nhl26. Relevant because cross-game is the product's core feature.
- **`ocr_segments` is a Phase-0 passthrough** — one row per batch, `decoderVersion: legacy-passthrough-v0-*`; real HMM/Viterbi segmentation on the worker side is unimplemented (the Python pipeline does the real segmentation).

## 6. Where the original report is exactly right (confirmed)

- Pre-game "MOSTLY BROKEN" is faithful to `pre-game-extraction-research.md` (header literally says so; ~10% attribute coverage; 28 auto-approved garbage loadout rows marked canonical). The diagnosis is done; the rewrite is planned, not landed.
- Sparse classes are real: `player_loadout_landing` = **0** hand-labeled PNGs, `menu_club_management` = **3**; both *relaxed* in the proving-bench gate.
- Wrong-frame-in-wrong-segment defect is real and documented: `seg-072-goals/00003.png` is byte-identical to `seg-074-faceoffs/00001.png` (`box-score-ocr-accuracy-followup.md`). Perfect OCR would still read the wrong number. Box-score per-period digits sum to 10 vs EA's authoritative 3-2; deemed not recoverable without a segmentation fix.
- Action Tracker validated on real footage: 133 events with rink positions, goals 3-2 correct, personas/clocks ground-truth-verified (`ws6-real-match-validation-findings.md`).
- typed_v1 carve-out for loadout/lobby is genuinely real (skips the Python OCR subprocess, ingests evidence JSON through a real promotion gate). It covers **only** loadout + lobby; all post-game screens still use the legacy PNG-OCR path.

## 7. Recommended priorities (revised from the original)

The original's 5 priorities are reasonable. I would re-rank and add:

1. **Make the quality gate actually block, or document why activated runs are allowed to fail it.** Today all four active runs have `overall_pass=false`. This is the single biggest trust gap and it's invisible in the original report.
2. **Wire the proving bench into CI** (even nightly). An acceptance gate that only runs when a human sets an env var is not a gate. Same for the reprocess E2E.
3. **Fix or triage the match-250 loadout parity failure** before treating typed_v1 loadout output as canonical — it's failing on the regression baseline match.
4. (original #1) Run the targeted labeling round for `player_loadout_landing` / `menu_club_management` (0 and 3 PNGs).
5. (original #4) Harden segmentation/capture validation for the cross-tab frame-bleed defect.
6. Update the original report to cite current artifacts (proving-bench-red-findings, not the stale README) and to state the DB ground truth + gate status.

## 8. Bottom line

The system is real and more capable than the prior project notes assumed — 4 matches ingested, a working two-pass video pipeline, an exercised candidate-run workflow, and a genuinely strong Action Tracker event path. The original report captures the qualitative shape correctly.

But three things should change how you act on it: **(a)** no active decoder run currently passes its own quality gate, **(b)** the acceptance gates the report leans on are not enforced by CI, and **(c)** there is a live parity regression in the default loadout engine on the pilot match. The system is no longer a toy — but "operational" should be read as "operational with all quality gates currently red," not "operational and verified."

---

# Addendum — Independent review of `ocr-improvement-report-small-efficient-ml.md` (2026-06-13)

Same method: read the report, then verified its premises and "build this" recommendations against source, the live DB, and the docs trail. This is a *strategy* report, so the relevant test is different — not "is the status accurate" but "does it recommend building what's already built, are its premises real, and does the direction hold against actual state."

## A1. Verdict

**The strategic direction is correct and I endorse it.** Small specialist ML (LR heads, closed-vocab classifiers, calibration, prototypes, active labeling) over a giant end-to-end VLM is the right call for this repo, this dataset size, and this problem shape. The "what I would NOT recommend" section (no VLM, no broad box-annotation, no full CNN retrain, don't replace deterministic parsers) is sound.

**But the report is written as if much of this is greenfield, and it is not.** Three of its headline "add this" recommendations describe infrastructure that already exists, is tested, and in two cases is already validated. The report would mislead a reader into re-building shipped components. The genuinely net-new, high-value parts are narrower than the report implies — and they are exactly the parts it spends the least ink on.

## A2. Recommends building what already exists

| Report recommendation | Reality | Evidence |
|---|---|---|
| #3 "Expand small closed-vocab specialists" (framed as a new pattern to grow) | **ALREADY EXISTS, tested.** `ClosedVocab.predict_log_probs` + `LoadoutClosedVocabExtractor` wire 5 families (build_class, x_factor_name, position, platform, x_factor_tier). The cited test `test_closed_vocab_lr_head.py` exists (30+ tests). 2 of 5 families have **trained** weights (build_class 6-class, x_factor_name 9-class); position/platform/tier have no trained image head (regex/HSV paths instead). | `loadout_extractors/closed_vocab.py:118,371,387`; `weights/nhl26-loadout-*.json` |
| #5 / Phase 2 "add a tiny specialist for X-Factor tier recognition" | **ALREADY EXISTS and is validated.** `_classify_xfactor_tier` (HSV circular-mean hue → Elite/All Star/Specialist), docstring "Verified 100% accuracy on 18/18 non-transitional match-250 captures." Exposed via `classify_x_factor_tier_from_image`. | `parsers.py:399-428`; `closed_vocab.py:528` |
| #4 "Use multi-prototype class models before bigger networks" | **PARTIALLY EXISTS.** A nearest-prototype matcher already ships: `xfactor_icon_matcher.py` loads 84 templates (28 X-Factors × 3 tiers), `cv2.matchTemplate` argmax + threshold. (True gap: no *multi-prototype-per-class* model for the screen classifier, which moved to LR — worth saying, but the report doesn't frame it that way.) | `xfactor_icon_matcher.py:10-79` |

The report's own bottom line ("refusing to use giant models where a 132-feature LR head already does the job") proves it half-knows this — yet recommends adding the very specialists that already exist.

## A3. Genuinely net-new and correct (the parts worth funding)

- **Score/confidence calibration (#2, Phase 1) — DOES NOT EXIST.** This is the report's best recommendation. `calibrated_confidence` is a *reserved stub*: every assignment sets `calibrated_confidence = raw_confidence`, with docstrings literally saying "Phase 3+ will apply Platt scaling or isotonic calibration behind this field." So calibration is genuinely missing and the field is already plumbed end-to-end for it. (Caveat: the report says "*replace* hard gates with calibrated decisions" — it's *adding* calibration, not replacing an existing one. And note the v2 screen classifier already turned anchor "gates" into soft LR features; the genuinely hard gates live in the **legacy** classifier, not the v2 path.) Evidence: `closed_vocab.py:357-359`, `tabular_numeric.py:76-78`, `lobby_evidence.py:480`.
- **Active *learning* sample-selection (#7) — DOES NOT EXIST.** Labeling/import infra is substantial (Label Studio + CVAT import, `bulk_extract_label_candidates.py`, crop-labeling CLIs), but candidate selection is explicitly *uniform sampling* ("the cheap Phase-A path: uniform sampling, no Pass-1 invocation"). The uncertainty/disagreement-based selection the report describes is the real new work. Don't conflate "we have Label Studio" with "we have active learning."
- **Targeted labeling round (#1) — correctly identified, already captured.** `HANDOFF.md:5` has it as the top to-do: `menu_club_management` (3 PNGs) and `player_loadout_landing` (0 PNGs), needing ~15–20 each, both currently *relaxed* in the proving-bench gate. Premise fully supported.

## A4. The sharpest finding — recommendation #6 is ~70% already built

The report's "Preserve Uncertainty Longer" (keep top-N candidates, keep confidence, richer `ocr_field_evidence`, confidence-aware promoters) is mostly already implemented — which changes the work from "build a new abstraction" to "fix one argmax":

- `ocr_field_evidence` **already** stores ranked candidates: `candidate_rank` (0=top, n=alt), `raw_confidence` + `calibrated_confidence`, `roi_bbox`, `observability_status`, with a promotion-lookup index keyed on `candidate_rank`. Top-N is a schema-native, one-row-per-candidate design. (`packages/db/src/schema/ocr-evidence.ts:178-186`)
- Promoters are **already** confidence-aware, not all-or-nothing: `promotion-gate.ts` does consensus-threshold + dominance-ratio + authority override, returning `blocked_consensus`/`blocked_observability`/etc. Live proof: 9,322 promoted, **289 `blocked_consensus`**, 160 `blocked_invariant`, 15 `blocked_observability`. (`apps/worker/src/lib/promotion-gate.ts:123-221`)
- The **only** real gap: the closed-vocab head computes the full softmax (`predict_log_probs`) then **throws it away** at `argmax` and returns a single candidate ("Returns top-1 candidate per field (N=1 hardcoded)"). The emitter already loops `for rank, cand in enumerate(candidates)` and would write rank-1/2 rows if given them. Live data confirms: of 11,283 evidence rows, only 174 have `rank>0` and **all 174 are tabular_numeric — closed_vocab has 0 alternates stored.** (`loadout_extractors/closed_vocab.py:492-522,572-591`)

**So the single highest-leverage concrete change isn't in the report's framing at all:** have the closed-vocab head emit top-N + implement the `calibrated_confidence` stub. The downstream consensus gate already consumes ranked + calibrated candidates — it's currently being fed top-1 with uncalibrated confidence. That one change activates machinery that's already built and unifies the report's #2, #3, and #6.

## A5. Factual corrections

- **"a 132-feature LR head"** is correct for the *loadout* heads (8×4×4 HSV hist = 128 + 4 = 132, asserted in tests, matches trained weights). It is **wrong for the screen classifier**, which is a separate **281-feature** LR (v2; v1 was 212). If the bottom line means "the screen classifier," the number is off.
- **"The repo research is right on this: hard yes/no anchor gates are too brittle"** is **overstated.** No doc argues that anchor gates are brittle or recommends scored gates for screen classification. `ws6-postgame-classifier-diagnosis.md` shows hard-anchor brittleness *empirically* but prescribes *retraining*, not a scored gate. The deep-research reports do argue for calibrated confidence — but for the **Action Tracker event-resolver**, not anchor gates. The report's scored-gate framing is its own synthesis, not a citation. (Fine as new synthesis; not fine as "the research already says so.")
- **Failure-types list:** 6 of 7 supported. Two caveats: "OCR digit confusion on post-game" and "wrong-frame/wrong-segment" are partly the *same* root cause for match 2582 (the box-score garble was diagnosed as the frame-segmentation defect, not OCR quality) — the report double-counts them. And several headline instances it presents as open are marked **resolved** in the docs (WS6 post-game classifier 2026-06-02; secondary-extractor robustness 2026-06-04; proving-bench RED 2026-06-01 → 95.0%/96.7%).

## A6. The report's biggest blind spot — it optimizes the wrong layer first

The report never mentions the trust-posture ground truth from Part 3 above: **all four active decoder runs currently fail their own quality gate, and the proving bench isn't in CI.** A strategy that opens with "improve the screen classifier with better labels first" is reasonable, but the actual binding constraint today is that *there is no enforced, passing acceptance gate to measure any of these improvements against.* Better labels and calibration are worth little if the bench that would validate them runs only when a human sets `RUN_CLASSIFIER_E2E=1` and every shipped run is red. Sequencing should be: **(0) make the gate enforced and green, then (1) labels, (2) calibration + top-N, (3) specialists** — not specialists the repo already has.

## A7. Revised recommendation ranking for the ML report

1. **Wire the proving bench / quality gate into CI and get a passing baseline** (precondition for measuring everything else — from Part 3, not in the report).
2. **Implement the `calibrated_confidence` stub** (report #2) — genuinely missing, already plumbed.
3. **Emit top-N from the closed-vocab head** (report #6) — one argmax fix activates the existing rank/consensus pipeline.
4. **Run the targeted labeling round** (report #1) — correctly identified, in HANDOFF.md.
5. **Add uncertainty-based active-learning selection** (report #7) — the real new part of "active learning"; the import/labeling plumbing already exists.
6. **Do NOT** "add" closed-vocab heads, an X-Factor tier classifier, or prototype matching (report #3/#4/#5) — these exist; instead *train the untrained families* (position, platform, tier image heads) and *extend* the icon matcher.

## A8. Bottom line on the ML report

Right destination, slightly wrong map. The "small specialist ML, not a giant model" thesis is correct and should be adopted. But discount its build list: closed-vocab heads, X-Factor tier recognition, and prototype matching already ship and are partly validated — recommending them as new work is the report's main flaw. The two genuinely missing, high-value pieces (confidence calibration; top-N preservation at the closed-vocab head) are under-emphasized, and they happen to be small because the schema, evidence layer, and consensus promotion gate are already built to consume them. And the report should have led with the fact that, today, there is no enforced quality gate to validate any ML improvement against.
