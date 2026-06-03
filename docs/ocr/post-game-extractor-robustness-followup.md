# Follow-up workstream — secondary post-game extractor OCR robustness

**Opened:** 2026-06-02, out of the WS6 acceptance run (`docs/ocr/ws6-real-match-validation-findings.md`).
**Status:** NOT STARTED. Scoped, evidence captured, no fix attempted yet.

## Why this exists

The WS6 post-game **classifier** fix (`feat/post-game-classifier-fix`, merged) made post-game screens
classify + dispatch for the first time. The committed `reprocess` of match 2582 then proved:

- **Action-tracker path works end-to-end** — 133 positioned events extracted, goals 3–2 correct,
  penalties correct, identities + positions + elapsed clocks all ground-truth-verified.
- **`reprocess validate` FAILS (exit 2) → no activation**, on **27 extractor errors** that are **all in the
  secondary post-game extractors** (box-score, net-chart, faceoff-map). These are **pre-existing latent
  bugs** the classifier fix merely *exposed* — those extractors had never received a frame before (post-game
  always classified as `unknown`). The classifier fix did not break them.

Evidence: `tools/video_ingest/tests/fixtures/ws6-match2582-postgame/reprocess-acceptance-log.txt`
(dispatch 15/15 ok + the validate `failureReasons`).

## The two failure classes (from the run)

1. **Team-side resolution via garbled team-name OCR.** Box-score / net-chart / faceoff-map extractors read
   the on-screen team names to decide which side is BGM, and the OCR garbles them:
   - `Cannot resolve BGM side for match 2582: away="PEKIUV:" home="Aalf.ara: .l c...a" opponent_on_file="Roc River Rats"` (×2)
   - `away="null" home="ACEOFF SUMMARY"` · `away="V." home="H"` · `away="口 HIT" home="H"` (several variants)
   - **Note:** the **action-tracker** extractor resolves `team_side` ('for'/'against') correctly via a
     different mechanism — so a likely fix is to make these extractors **fall back to match metadata**
     (`opponent_on_file` / the known BGM club) when the header OCR is unreadable, or reuse the action-tracker's
     team-side resolution rather than re-OCR'ing team names.

2. **Period-label OCR garble.** Net-chart / faceoff-map read a period label (1ST/2ND/3RD/OT/ALL) and refuse
   to write when it's unrecognized (correct safety, but it hard-fails the run):
   - `Net Chart period_label OCR unrecognized: 'OPERIOD' / 'PERIOD' / 'ERIOD' / '2ND PERI0D B.43 PERINC' / '(null)' / '0.'`
   - `Faceoff Map period_label OCR unrecognized: 'RT PERIOD' / '(null)'`
   - **Likely fix:** fuzzy period-label parsing (map `*PERIOD*` fragments + `OT`/`ALL` to the canonical slot,
     tolerate the `RT`/leading-char noise), mirroring how the action-tracker tolerates messy headers.

## Tasks (focused — do NOT sprawl beyond these extractors)

1. **Diagnose** each failing extractor on the saved match-2582 frames
   (`fixtures/ws6-match2582-postgame/frames/`) — confirm whether it's an ROI/preprocessing issue (the
   team-name/period regions OCR poorly) or a parsing issue (text is read but not normalized).
2. **Team-side robustness:** add a match-metadata fallback (or share the action-tracker resolver) so a
   garbled header doesn't abort.
3. **Period-label robustness:** fuzzy-normalize the period label.
4. **Validate policy — DECIDE ONLY AFTER (1)–(3).** If the OCR fixes are quick, no policy change is needed.
   If not, consider whether a *secondary* post-game extractor that "refuses to write garbled OCR" should be
   a **non-blocking warning** rather than a run-aborting validate error — today its failure also blocks the
   cleanly-extracted action-tracker events + loadout/lineup from activating (collateral). Do not change
   validate semantics until the fix effort is known.
5. **Re-run** the WS6 reprocess of match 2582; target a clean `validate` pass + activation, with the
   secondary post-game screens either extracting correctly or being skipped non-fatally.

## What is NOT in scope

- Screen classification (fixed; guarded by the post-game proving-bench arm).
- The action-tracker path (works; 133 GT-verified events).
- WS3 version detection / WS4 Stage 3 / unrelated cleanup.

## Reference state

- Match 2582 has **133 `pending_review` `match_events`** from the WS6 run (action-tracker; correct) — leave
  for operator review. Run **1944** is an inert candidate (`is_active=false`, not activated).
- Extracted-events snapshot: `fixtures/ws6-match2582-postgame/match2582-extracted-events.tsv`.
- Host reprocess invocation (env): activate `.venv-1`, `set -a && source .env`, `OCR_PYTHON=.venv-1/bin/python3`,
  `PYTHONPATH=tools/video_ingest:tools/game_ocr`, then `python3 -m video_ingest.cli reprocess --match-id 2582
  --video /mnt/k/2026-05-31_16-09-36.mkv --version nhl26`. **Footgun:** a prior `--dry-run` creates a candidate
  run with the same `(match_id, sha, decoder_version, weights_hash)` provenance that BLOCKS the real run via
  `ocr_decoder_runs_provenance_uniq` — delete the inert candidate first.
