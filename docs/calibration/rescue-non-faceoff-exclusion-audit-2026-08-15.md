# Rescue exclusion audit — the 14 non-faceoff auto windows (2026-08-15)

**Read-only semantic audit.** No `--execute`, no `ffmpeg`, no OCR, no ingest, no promotion,
no reprocessing, no repair. Every database statement ran in a session with
`default_transaction_read_only=on`. No rescue manifest, receipt ledger, allowlist, cache
artifact or archived run artifact was modified.

**Verdict: PARTIAL.** All 14 promotion keys, their non-execution, and the present database
coverage they would have targeted are independently reproduced. The *specific archived
classification label* per window (`NEEDS-REMEDIATION` / `WITHHOLD-FALSE-SUCCESS` / `NO-OP`) is
**UNVERIFIED for all 14** — the artifact that carried it (`removed_detail` in audit-v2's
`allowlist_proposal.json`, plus the per-window gate OCR JSONs) lived under `/tmp` and no longer
exists. What this audit adds instead is reproduced database and promoter-source evidence, an
explicitly *inferential* narrowing of the candidate class per window, and a bounded statement
of what execution could and could not do today.

**Boundary of what the database can prove.** The missing OCR payloads are load-bearing. The
live database proves which `(match, period, stat-family)` cells are populated, and the promoter
source proves that existing non-null numeric cells cannot be overwritten. Neither proves **which
period numbers an excluded payload would emit**. `box-score.ts` iterates every cell with
`period_number >= 1` in the payload and INSERTs a new `match_period_summaries` row whenever that
period does not already exist — so a payload carrying an unexpected or phantom positive period
could still add a row even when P1–P4 are complete. **No window in this set is characterised as
a proven execution no-op, and no window's complete execution effect is known.**

This document supersedes the transient citation
`/home/michal/.codex/attachments/d29b8ce6-e58e-47dd-921a-1f8c83cf2a83/pasted-text.txt` as the
durable home of the 22-window reconciliation table.

---

## 1. Scope and immutable inputs

| input | identity | role |
| --- | --- | --- |
| `/home/michal/ingest-cache/rescue-manifest.json` | sha256 `70b5bfbbf2d152264119ed255afe3da8d8404265cfabcb7f1e6bed841178ecc8`, schema 2, 303 windows, 97 `auto` | promotion-key source of truth |
| `…/rescue-runs/rescue-b2-20260807T031344Z/rescue-manifest.schema3.json` | sha256 `f0727066aa6b4f04cd6c095015b9d683532dd6b6686c357c4a41b2fdf1d33397` | schema-3 candidate; auto set set-identical to schema 2 |
| `…/rescue-execution-allowlist.json` | sha256 `0219ab6862c7c7ed235d5a35815fbff3134d91a4c03cbc2132f733e773a3e562`, 57 windows | what run 3 was authorised to execute |
| `…/rescue-audit-proposal.corrected.json` | sha256 `be7e93591ab30195d57d5e8c7b6aa0547731ea21466321438d506a9212b3128b`, 57 entries, all `SAFE-EVIDENCE` | audit-v3's machine-readable output |
| `…/audit-v3-REPORT.md` | sha256 `84e085e17a1eb49c09c7261f4857514b27ac286ab1240b53f758ead620317e30` | narrative audit; enumerates only the 8 faceoff-map windows |
| `/home/michal/ingest-cache/rescue-receipts.jsonl` | 20 lines, runs `…20260805T031634Z` + `…20260805T040226Z` | historical receipts |
| `…/rescue-receipts.execution.jsonl` | 57 lines, run `…20260807T031344Z`, all `promoted` | run-3 receipts |
| live PostgreSQL (`eanhl-team-website-db-1`) | queried SELECT-only | present state of promoted evidence |
| source | `apps/worker/src/ocr-promoters/box-score.ts`, `net-chart.ts`; `tools/video_ingest/video_ingest/rescue_execute.py`, `rescue_allowlist.py` | execution and write semantics |

Repository HEAD during this audit: `540777a17daa9f5df428cf0ffab141a02314748b` (`main`), unchanged.

### Reconciliation arithmetic (recomputed from the artifacts, not inherited)

- 97 `auto` windows → 97 unique promotion keys `(video_sha256, batch_dir, run_id)`, 0 duplicates.
- 77 receipt lines across both ledgers → 76 unique keys → **75 promoted**, **1 failed-only**.
- **22 non-promoted keys** = 97 − 75.
- Split by screen: **8 `post_game_faceoff_map`** (1 failed + 7 never attempted) and
  **14 non-faceoff** (all never attempted).
- The 14 keys requested for this audit are **exactly** the non-faceoff non-promoted set
  (set equality verified), **overlap with the faceoff-map set = 0**, and
  **14 + 8 = 22 = the non-promoted total**.
- The 57-entry execution allowlist has **0 overlap** with any of the 22.

---

## 2. The 22 non-promoted windows, with full promotion keys

`batch_dir` values are shown relative to the cache root `/home/michal/ingest-cache/`; the
promotion key is the 3-tuple `(video_sha256, <cache-root>/<batch_dir>, run_id)`, a verbatim
mirror of the DB unique constraint `ocr_capture_batches_video_sha_dir_run_uniq`.

### 2a. The 14 non-faceoff windows (this audit's scope)

| # | match | screen | seg | run | video_sha256 (full) | batch_dir (below cache root) |
| --: | --: | --- | --: | --: | --- | --- |
| 1 | 1090 | `post_game_net_chart` | 9002 | 2098 | `4f189ffc394ed9e6991a4bbe920d0463a78a6de5fa2e905c1b6d5a5c56588b80` | `4f189ffc…88b80/rescue/seg-9002-post_game_net_chart` |
| 2 | 2683 | `post_game_box_score_shots` | 9010 | 2138 | `6f010c2e9c1aba4ee7fc4ffada7b8595a8dd81e449510a36df834942060149db` | `6f010c2e…149db/rescue/seg-9010-post_game_box_score_shots` |
| 3 | 475 | `post_game_box_score_goals` | 9009 | 2069 | `7cad01ec7909dbae6934ce9facab3073a3111db5320a75815d04d08373c54789` | `7cad01ec…54789/rescue/seg-9009-post_game_box_score_goals` |
| 4 | 2672 | `post_game_box_score_goals` | 9003 | 2128 | `c85aee95b02f5c147706e2ca75796cdc4d1f0bc7503e6fdabafba78578f6d54a` | `c85aee95…6d54a/rescue/seg-9003-post_game_box_score_goals` |
| 5 | 2672 | `post_game_box_score_goals` | 9007 | 2128 | `c85aee95b02f5c147706e2ca75796cdc4d1f0bc7503e6fdabafba78578f6d54a` | `c85aee95…6d54a/rescue/seg-9007-post_game_box_score_goals` |
| 6 | 2676 | `post_game_box_score_goals` | 9003 | 2131 | `ca5d5da61f61d232bac69804672f910bb6e14cdce93e97a8fb0f0d4e6b4c572d` | `ca5d5da6…c572d/rescue/seg-9003-post_game_box_score_goals` |
| 7 | 2656 | `post_game_box_score_shots` | 9007 | 2114 | `d12028b83c97c42d5c12879a8c35fdc09d2474ec49bff8432afdea2af207e3b5` | `d12028b8…7e3b5/rescue/seg-9007-post_game_box_score_shots` |
| 8 | 2403 | `post_game_box_score_goals` | 9005 | 2107 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9005-post_game_box_score_goals` |
| 9 | 2403 | `post_game_box_score_goals` | 9010 | 2107 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9010-post_game_box_score_goals` |
| 10 | 2404 | `post_game_box_score_shots` | 9017 | 2108 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9017-post_game_box_score_shots` |
| 11 | 2404 | `post_game_box_score_faceoffs` | 9019 | 2108 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9019-post_game_box_score_faceoffs` |
| 12 | 2404 | `post_game_box_score_goals` | 9020 | 2108 | `ed82749188c235eb242af22fef05f3230cbe7a40824449510384868a4b55446b` | `ed827491…5446b/rescue/seg-9020-post_game_box_score_goals` |
| 13 | 2577 | `post_game_box_score_goals` | 9005 | 2110 | `f79307e0f0f9cc6dfd954b074a439cbe8f4830028f8cfaff88bfbd241b1c46e2` | `f79307e0…c46e2/rescue/seg-9005-post_game_box_score_goals` |
| 14 | 2577 | `post_game_box_score_faceoffs` | 9007 | 2110 | `f79307e0f0f9cc6dfd954b074a439cbe8f4830028f8cfaff88bfbd241b1c46e2` | `f79307e0…c46e2/rescue/seg-9007-post_game_box_score_faceoffs` |

All 14 appear **exactly once**; each has `decision='auto'`, `frame_count=1`, `reason=null`,
a non-null pinned `commands` block, and both required artifacts still on disk (source video
and `<sha>/segments.json` — checked by `stat`, all 8 distinct videos present).

**Receipt / database status — all 14 identical:**

- 0 receipt lines in either ledger for the exact key.
- `SELECT count(*) FROM ocr_capture_batches WHERE video_sha256=… AND source_directory=… AND run_id=…` → **0** for all 14.
- `SELECT count(*) FROM ocr_capture_batches WHERE source_directory=…` → **0** for all 14
  (no batch under that path exists under *any* key).
- No `<sha>/rescue/seg-<idx>-<screen>/` directory exists on disk for any of the 14.

### 2b. The 8 faceoff-map windows (out of scope here; listed to close the 22)

| match | screen | seg | run | video_sha256 (short) | receipt |
| --: | --- | --: | --: | --- | --- |
| 2661 | `post_game_faceoff_map` | 9002 | 2119 | `4b8a77d091a9…` | `failed` (DB batch 5051, 2 extractions, both `error`) |
| 2659 | `post_game_faceoff_map` | 9001 | 2117 | `678821b21794…` | none |
| 1089 | `post_game_faceoff_map` | 9001 | 2097 | `7337e3f130e4…` | none |
| 1091 | `post_game_faceoff_map` | 9001 | 2099 | `8bcd0bd9f5ad…` | none |
| 472 | `post_game_faceoff_map` | 9001 | 2066 | `b12833771211…` | none |
| 2672 | `post_game_faceoff_map` | 9001 | 2128 | `c85aee95b02f…` | none |
| 2399 | `post_game_faceoff_map` | 9002 | 2104 | `caf7e3990848…` | none |
| 2660 | `post_game_faceoff_map` | 9001 | 2118 | `d8c1cc4a6e95…` | none |

Their exclusion reasons are enumerated and analysed in `audit-v3-REPORT.md` §§2–5 and are not
revisited here. Note match 2672 appears in both groups (a faceoff-map window *and* two
box-score-goals windows) — the keys are distinct, the overlap count between the sets is 0.

---

## 3. Write semantics established from source (needed to read the evidence)

| screen | promoter | write semantics |
| --- | --- | --- |
| `post_game_box_score_{goals,shots,faceoffs}` | `apps/worker/src/ocr-promoters/box-score.ts` | Iterates **every** payload cell with `period_number >= 1`. Per cell: update-first on `(match_id, period_number, source='ocr')` with `COALESCE(existing, incoming)` per column, **falling back to a plain INSERT when no row exists for that period**. So existing non-null values can never be overwritten, **but a payload period that has no row yet creates one**. `period_number < 1` (the TOT row) is skipped. Zero period cells → the promoter throws. |
| `post_game_net_chart` | `apps/worker/src/ocr-promoters/net-chart.ts` | Per-period upsert on `(match_id, team_side, period_number, source='ocr')` with `COALESCE` per column — **but** every per-period write then calls `recomputeAllPeriodsAggregate`, which rewrites the `period_number = -1` ALL PERIODS row with an **unconditional overwrite** (`set:` without COALESCE). Any contributing per-period NULL makes the aggregate column NULL. `period_number = 0` (unreadable label) throws `PERIOD_LABEL_UNRECOGNIZED`. |

Only the review-cascade (`apps/worker/src/lib/review-cascade.ts`) and
`packages/db/src/queries/match-enrichments.ts` also write `match_period_summaries`, and both
touch **only** the per-family `*_review_status` columns. Therefore numeric cells are
monotonic: a cell that is NULL today was NULL at the audit's 2026-08-06 baseline.

**What this does and does not bound.** These semantics bound the *overwrite* risk to zero for
already-populated cells. They do **not** bound the *insert* risk, because the set of periods a
missing payload would emit is unknown: a mis-read label, a phantom OT/SO column, or a
period-number the parser assigns outside the expected 1–4 range would each produce a new row in
a previously-absent period slot. Every execution-effect statement in §4 is therefore scoped to
the *expected* periods that the database can speak to, and left explicitly unverified beyond them.

Executor gating (`tools/video_ingest/`): `--allowlist` is **required** for `--execute`
(`rescue_execute.py:2067`); the allowlist can only *narrow* the auto set, never widen it; and
it fails closed on manifest-SHA mismatch, repository-HEAD mismatch, unknown windows and
duplicates. The archived allowlist binds `repository_head = 06b198670fd909c9…`, which is not
the current HEAD (`540777a…`), so **re-running the archived allowlist today would abort on the
repository binding** — and it contains none of the 14 in any case. Nothing in the executor
itself rejects these 14: their exclusion is a *policy* decision encoded in the allowlist file,
not an intrinsic gate.

---

## 4. Per-window findings

Two structurally distinct groups emerge from the live database, defined by **present coverage of
the expected periods (P1–P4)**, not by any claim about payload content. Group R windows target
expected-period `(match, period, stat-family)` cells that are **already populated** by a
*promoted* sibling window; Group W windows target expected-period cells that are **still NULL
today** — i.e. their exclusion left a real coverage hole.

### Group R — expected-period coverage already complete; payload-level execution effect unverified (7 windows)

| # | window | promoted sibling that owns the data | current DB state of the expected-period cells | bounded execution effect |
| --: | --- | --- | --- | --- |
| 3 | 475 goals seg9009 | seg-9007 goals → batch 5068, extraction 30431 (`success`) | P1–P4 `goals_for/against` all non-null; sums 0–6 = EA final 0–6 | If the payload carries only P1–P4, its numeric writes COALESCE away and nothing changes but new batch/extraction rows. **An unexpected additional positive period in the payload would still INSERT a new row.** Payload unknown. |
| 11 | 2404 faceoffs seg9019 | seg-9015 faceoffs (promoted) | P1–P4 `faceoffs_for/against` all non-null | same bound as #3; payload periods unknown |
| 12 | 2404 goals seg9020 | seg-9013 + seg-9016 goals (promoted; batch 5100) | P1–P4 goals complete; sums 8–1 = EA final 8–1 | same bound as #3; payload periods unknown |
| 13 | 2577 goals seg9005 | seg-9002 goals → batch 5106, extraction 30547 | P1–P4 goals complete; sums 6–3 = EA final 6–3 | same bound as #3; payload periods unknown |
| 14 | 2577 faceoffs seg9007 | seg-9004 faceoffs (promoted) | P1–P4 faceoffs complete | same bound as #3; payload periods unknown |
| 7 | 2656 shots seg9007 | seg-9005 shots (promoted) | P1–P4 `shots_for/against` complete (13–15 vs EA 11–15) | same bound as #3; payload periods unknown |
| 10 | 2404 shots seg9017 | seg-9014 shots → batch 5101, extraction 30532 | P1, P3, P4 complete; **P2 `shots_for` is NULL** (P2 `shots_against`=6 present) | One *known* existing-period cell (2404 P2 `shots_for`) is fillable **if** the payload contains a valid P2 for-side value. Other expected-period writes would COALESCE away; any additional payload period could still INSERT. **Complete effect unknown.** |

The database proves the *overwrite* half of this bound and nothing more: existing non-null cells
are safe, but the payload's period set is unrecoverable, so **none of these seven is a proven
execution no-op**. What is established is narrower and still useful — their expected stat-family
coverage already exists, so none of them is a coverage-recovery target.

Compatible archived labels for Group R (**inference, not recovered audit fact**): `NO-OP`
matches the shape audit-v3 §6 describes (`isolated_wrote_anything()` true, in-run
`wrote_anything` false), and `WITHHOLD-FALSE-SUCCESS` matches an intrinsically empty payload
equally well. Distinguishing them requires the per-window gate OCR JSON, which is gone; no label
is assigned.

### Group W — expected-period coverage currently empty; payload content and safety unverified (7 windows)

| # | window | current DB state | EA anchor | bounded execution effect |
| --: | --- | --- | --- | --- |
| 1 | 1090 net_chart seg9002 | `match_shot_type_summaries` has **0 rows** for match 1090 | EA final 0–3, shots 5–8 | The manifest anchor (`rm 0 - 3 ana lt net chart rt 2nd period`) is classifier text, **not** the extractor payload, so the period the promoter would receive is unknown. *If* the frame parses and promotes as period 2, the promoter inserts the two per-period rows and then **unconditionally writes the ALL PERIODS (`-1`) row recomputed from whatever per-period state exists** — for a match with no other rows, that publishes one period's breakdown as the whole-game aggregate. *If* the label fails recognition, `PERIOD_LABEL_UNRECOGNIZED` is thrown and nothing is written. Both paths remain open. |
| 8 | 2403 goals seg9005 | `goals_for`/`goals_against` **NULL in all 4 period rows**; no goals window was promoted for 2403 | EA final 0–3 | Could populate per-period goals **if** the payload contains valid period cells; could equally be intrinsically empty, malformed, or carry unsafe period geometry. |
| 9 | 2403 goals seg9010 | same as #8 | EA final 0–3 | same conditional; see order-dependence note below |
| 4 | 2672 goals seg9003 | goals **NULL in all 4 period rows**; no goals window promoted for 2672 | EA final 3–0 | same conditional as #8 |
| 5 | 2672 goals seg9007 | same as #4 | EA final 3–0 | same conditional; see order-dependence note below |
| 6 | 2676 goals seg9003 | goals **NULL in all 4 period rows** (only shots/faceoffs promoted for 2676) | EA final 3–2 | same conditional as #8 |
| 2 | 2683 shots seg9010 | `shots_for`/`shots_against` **NULL in all 4 period rows**; only the faceoffs window (seg-9008, batch 5064) was promoted for 2683 | EA final 3–2, shots 22–8 | Could populate per-period shots **if** the payload is valid; the only shots window in the manifest for 2683 (its sibling shots-family windows are `decision='skip'`), so the coverage hole is real regardless of whether this window can fill it. |

A zero-cell payload makes the promoter throw, and an unreadable period label makes the net-chart
promoter throw — so "excluded window" and "would have delivered data" are not the same claim, and
this audit asserts only the first.

Compatible archived labels for Group W — **this narrowing is inference from the classifier branch
inventory in audit-v3 §2, not a recovered label.** `NO-OP` is the one class the database argues
against for the first window of each match: nothing had filled those cells at the audit baseline
(monotonicity, §3), so a payload with valid cells would have written. That leaves
`NEEDS-REMEDIATION` and `WITHHOLD-FALSE-SUCCESS` as the plausible pair, differentiated per screen
only by which branches existed (`post_game_net_chart` and `post_game_box_score_goals` had
screen-specific `NEEDS-REMEDIATION` branches; identity-degradation and ST-aggregate branches were
screen-agnostic; `post_game_box_score_shots` had neither, leaving the generic empty-payload test
or identity degradation as its only removal routes). **No exact label is assigned to any window;
all 14 remain UNVERIFIED.**

**Order-dependence note (windows #9 and #5).** Matches 2403 and 2672 each contributed *two*
excluded goals windows, and audit-v3 records both removals in the same fixed-point iteration
(`iter 0: subset_size=79 removed=22`). If the simulation applied the earlier window's writes
to its in-memory state before evaluating the later one, the later window could have been
classified redundant relative to a sibling that was itself removed — an **order-dependent**
exclusion that would not reproduce if either window were re-simulated alone. Whether that
happened is not decidable from the surviving artifacts (`classify.py`'s loop body is gone).
This is the single most consequential unknown in the set, because matches 2403 and 2672 have
**no** per-period goals data at all today.

### Intrinsic vs. order/state-dependent exclusion

| kind | windows |
| --- | --- |
| **State-dependent** (a promoted sibling had already supplied the expected-period data, so redundancy is a sufficient explanation for the exclusion — though not a proven one) | #3, #7, #11, #12, #13, #14 — and #10 partially |
| **Intrinsic or order-dependent, cannot be separated from surviving evidence** | #1, #2, #4, #6, #8 (no sibling could have made them redundant, so the exclusion turned on a content judgement whose evidence is gone) |
| **Possibly order-dependent on an excluded sibling** | #5 (2672 seg9007), #9 (2403 seg9010) |

Nothing in the executor, the manifest, or the artifact preflight would refuse any of the 14:
their pinned commands validate, their videos and `segments.json` exist, and their promotion
keys are free. Their exclusion is entirely a decision recorded in the audit-v3 allowlist.

---

## 5. Reproduced vs. inherited-but-unverified

**Independently reproduced this session (evidence in §§1–4):**

- All 14 promotion keys, resolved from the manifest, each appearing exactly once.
- Zero receipts and zero database batches for all 14 exact keys (and zero for their `batch_dir`
  under any key); no rescue directory on disk.
- 97 = 75 promoted + 1 failed + 21 not attempted; 22 non-promoted = 8 faceoff-map + 14 non-faceoff;
  the requested 14 are set-equal to the non-faceoff non-promoted set; overlap with the faceoff
  set is 0; the 57-window allowlist excludes all 22.
- Present database coverage each exclusion left behind (which expected-period cells are filled,
  which are NULL, which promoted sibling batch/extraction supplied the row) and its agreement
  with the EA final score.
- The write semantics that bound what execution could do (per-period COALESCE merge plus
  INSERT-on-absent-period for box score; unconditional ALL PERIODS overwrite for net chart),
  read from committed source.
- Artifact availability for all 14 (videos + `segments.json` present).
- Archived-run integrity: `sha256sum -c SHA256SUMS` in the archived run directory — all 7 files
  match; the manifest and both ledgers match their recorded digests.

**Inherited from `audit-v3-REPORT.md` and NOT verified here:**

- That exactly 14 non-faceoff windows were removed at simulation iteration 0 "for the identical
  reasons as v2" (the report's aggregate statement — deliberately not treated as per-window proof).
- The specific classification label attached to each of the 14.
- The claim that 0 `NO-OP` windows remained after ablation on the surviving 57 (irrelevant to the
  14, and not re-simulable here).

**Not verifiable by anyone without the deleted payloads:**

- The set of `period_number` values each excluded payload would emit — and therefore whether any
  window would INSERT a row into a period slot that does not exist today.
- Whether each payload is well-formed at all (a zero-cell payload throws; an unreadable net-chart
  period label throws), so no window's *complete* execution effect is known.
- The candidate-class narrowing in §4 is **inference from the classifier branch inventory**, not a
  recovered fact.

---

## 6. Aggregate totals

**Archived per-window classification (the labels this audit was asked to recover):**

| classification | count |
| --- | --: |
| `NEEDS-REMEDIATION` | UNVERIFIED |
| `WITHHOLD-FALSE-SUCCESS` | UNVERIFIED |
| `NO-OP` | UNVERIFIED |
| **UNVERIFIED (label not recoverable per window)** | **14** |

No count is asserted for the three labels: the artifact that carried them is gone, and
inventing a split from the aggregate statement is exactly what this audit was told not to do.

**Execution-effect categories (this audit's own finding, bounded by present database coverage —
not a statement about payload content):**

| category | count | windows |
| --- | --: | --- |
| 1. Expected-period coverage already complete; payload-level effect unverified | 6 | #3, #7, #11, #12, #13, #14 |
| 2. One known existing-period NULL; remaining payload effect unverified | 1 | #10 (2404 P2 `shots_for`) |
| 3. Expected-period coverage currently empty; payload content and safety unverified | 7 | #1, #2, #4, #5, #6, #8, #9 |
| **4. total** | **14** | |

Within category 3, two windows (#5, #9) carry the additional order-dependence caveat below.

**Candidate-class narrowing — INFERENCE, not recovered audit fact.** No exact label is assigned
to any window; all 14 archived labels remain UNVERIFIED. These are the classes each window's
evidence leaves open:

| narrowed candidate set | count | windows |
| --- | --: | --- |
| `{NO-OP, WITHHOLD-FALSE-SUCCESS}` | 7 | Group R (#3, #7, #10, #11, #12, #13, #14) |
| `{NEEDS-REMEDIATION, WITHHOLD-FALSE-SUCCESS}` | 5 | #1, #2, #4, #6, #8 |
| `{NEEDS-REMEDIATION, WITHHOLD-FALSE-SUCCESS, NO-OP-by-run-order}` | 2 | #5, #9 |

---

## 7. Execution ruling — all 14

**DO NOT EXECUTE. The standing prohibition on blind execution of any of the 22 outstanding
windows is unchanged by this audit.** Per window:

| # | window | ruling |
| --: | --- | --- |
| 1 | 1090 net_chart seg9002 | **Do not execute.** Highest-risk reconsideration candidate: match 1090 has no shot-type rows at all, so *if* the frame promotes as a single per-period row, the promoter's unconditional ALL PERIODS recompute would publish one period's breakdown as the whole-game aggregate. Any reconsideration must first resolve whether that recompute is acceptable from a lone per-period frame. |
| 2 | 2683 shots seg9010 | **Do not execute.** Only shots source for match 2683 and the coverage is missing today, but the archived exclusion reason is unrecoverable and the screen has no reconciliation branch to fall back on. Needs re-simulation, not execution. |
| 3 | 475 goals seg9009 | **Do not execute** — expected-period goals coverage already complete and reconciles with the EA final (0–6); no coverage to recover, and the payload's period set is unknown. |
| 4 | 2672 goals seg9003 | **Do not execute.** Match 2672 has no per-period goals; the coverage gap is real, but the exclusion reason is unrecoverable. Re-simulation candidate. |
| 5 | 2672 goals seg9007 | **Do not execute.** Same gap; additionally the exclusion may be order-dependent on #4. |
| 6 | 2676 goals seg9003 | **Do not execute.** Match 2676 has no per-period goals. Re-simulation candidate. |
| 7 | 2656 shots seg9007 | **Do not execute** — expected-period shots coverage already complete. |
| 8 | 2403 goals seg9005 | **Do not execute.** Match 2403 has no per-period goals. Re-simulation candidate. |
| 9 | 2403 goals seg9010 | **Do not execute.** Same gap; exclusion may be order-dependent on #8. |
| 10 | 2404 shots seg9017 | **Do not execute.** One known fillable cell (P2 `shots_for`) does not justify executing a window whose audited exclusion reason is unknown and whose remaining payload effect is unverified. |
| 11 | 2404 faceoffs seg9019 | **Do not execute** — expected-period faceoffs coverage already complete. |
| 12 | 2404 goals seg9020 | **Do not execute** — expected-period goals coverage already complete and reconciles with EA (8–1). |
| 13 | 2577 goals seg9005 | **Do not execute** — expected-period goals coverage already complete and reconciles with EA (6–3). |
| 14 | 2577 faceoffs seg9007 | **Do not execute** — expected-period faceoffs coverage already complete. |

**Safe to reconsider?** No window is safe to *execute* on the strength of this audit. Six windows
(#3, #7, #11, #12, #13, #14) are reasonable to **deprioritize, or close as coverage-recovery
targets**, because the expected stat-family coverage they would have supplied already exists —
**not** because their execution is proven inert. Their payload period sets are unknown, so an
unexpected positive period could still insert a row; that residual risk is a further reason not
to run them, never a reason to consider them harmless. The seven Group W windows plus #10 are the
only ones with potential remaining information value; each requires a **fresh, read-only
re-capture + OCR and re-simulation inside an audit harness** (not a production execution) to
re-derive its payload and classification before any allowlist could legitimately include it. Any
such allowlist would also need to be re-bound to the current repository HEAD.

---

## 8. Missing evidence and blockers

| missing artifact | what it blocked |
| --- | --- |
| `/tmp/rescue-audit-20260805-sem-v2/` (deleted) — `allowlist_proposal.json` with `removed_detail`, `classify.py` | The per-window classification label and its stated reason for each of the 14; the exact body of the `if not wrote_anything:` branch, which determines whether `NO-OP` and `WITHHOLD-FALSE-SUCCESS` were distinguished by `isolated_wrote_anything()`. |
| `/tmp/rescue-audit-20260806-sem-v3/` (deleted) — `classify_corrected.py`, `build_proposal.py`, `faceoff_reconstruction.json` | Independent re-execution of the corrected classifier over the 14. |
| `/tmp/rescue-schema3-gate-20260805/results/ocr/<key>.json` and `frames/<key>/` (deleted) | The actual OCR payloads for the 14 windows — the only way to test intrinsic emptiness, run the EA-anchored goals-sum reconciliation, or learn **which `period_number` values each payload would emit**. That last unknown is why no window's complete execution effect can be stated and why none is a proven no-op. Regenerating them requires ffmpeg + OCR, which this audit is forbidden to run. |
| Simulation `BEFORE` `.psv` snapshots, `run.py`, `engine.py` | Reproducing the fixed-point ordering, and therefore resolving the order-dependence question for #5 and #9. |
| Per-column provenance in `match_period_summaries` | `ocr_extraction_id` records only the **first** row contributor (by design, via COALESCE), so which extraction filled a *specific* column cannot be recovered. Sibling attribution in §4 is therefore at row level plus receipt level, not per column. |

Searched exhaustively and read-only under `/home/michal/ingest-cache` (all 72 sha directories,
the archived run directory, every `*receipt*`/`*ledger*`/`*.jsonl`/`*manifest*`), `/tmp`, and
the repository. No copy of the audit-v2 or audit-v3 working directories survives anywhere.

---

## 9. Confirmation: no execution, no mutation

- No `--execute`, no `ffmpeg`, no `ingest-ocr`, no `reprocess`, no promotion, no reconciliation.
- All database access ran through `psql` with `PGOPTIONS='-c default_transaction_read_only=on'`
  (verified: `SELECT current_setting('default_transaction_read_only')` → `on`). Every statement
  was a `SELECT` or a `\pset`; a write would have been refused by the server.
- Rescue batch count under `source_directory LIKE '%/rescue/%'` is **76**, unchanged, matching the
  reconciliation of record.
- No file under `/home/michal/ingest-cache` was created, modified or deleted; the archived run
  directory still passes `sha256sum -c SHA256SUMS` on all 7 files.
- Repository changes are confined to this document and one citation line in `HANDOFF.md`.
- Scratch analysis files were written only under the session scratchpad
  (`/tmp/claude-1000/…/scratchpad/`), outside the repository and outside the cache root.
