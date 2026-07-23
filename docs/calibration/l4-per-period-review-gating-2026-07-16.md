# L4 per-period review-gating — calibration decision (2026-07-16)

> **IMPLEMENTED 2026-07-22** — see the addendum at the bottom. The spec below shipped with
> **two corrections** forced by live data: the fire condition keys on `gateFromL4`, **not**
> `overall.pass`; and reconciliation-pass alone is **not** sufficient to promote (a vacuous
> sum can fake it). Read the addendum before trusting the spec text verbatim.

**Status:** DECISION RECORDED. No code changed. Implementation deferred to a focused session.
**Resolves:** HANDOFF "WHAT'S NEXT" gap (1) — "decide whether `PASS` is calibrated correctly given 2675 … decides whether the review queue is trustworthy at corpus scale."
**Trigger:** match 2675 is `overall.pass = PASS` yet L4 `score = 0.167` (1/6 fields), with misread per-period goals-against.

---

## Question

Is the quality gate mis-calibrated? A PASS match routes away from the review queue while
carrying badly-misread per-period rows (2675: P2 goals-against unread, P3 goals-against read
`7` in a game the opponent won 5-2). At corpus scale, does that make the review queue
untrustworthy?

## Finding: the premise is half-true — the misreads exist but do **not** leak

**2675's _final_ is read perfectly; only the _per-period_ rows are wrong.**

| signal                                             | BGM goals | Opp goals                      | source               | verdict                  |
| -------------------------------------------------- | --------- | ------------------------------ | -------------------- | ------------------------ |
| API truth (`matches.score_for/against`, bgm away)  | 2         | 5                              | EA — aggregate truth | —                        |
| OCR TOT row (`ocr_extraction_fields` `period.TOT`) | 2         | 5                              | OCR                  | ✅ `finalAccuracy = 1`   |
| OCR per-period GA (P1..P4)                         | —         | 1, ∅, **7**, 0 → sum **8 ≠ 5** | OCR (sole source)    | ❌ P2 unread, P3 misread |

So 2675 is a **correct PASS**: `overall.pass` (L2 && L2.5 && L3, [quality-layers.ts:311](../../apps/worker/src/lib/quality-layers.ts#L311))
and `gateFromL4` ([l4-api-truth.ts:147](../../apps/worker/src/lib/l4-api-truth.ts#L147)) both key on the **final**, which is
the only thing that feeds career/aggregate stats. The "1/6 fields" is the _overall_ L4 score
dragged down by soft per-period fields the gate deliberately does not act on.

**The misreads are quarantined, not published.** Trace:

1. Per-period rows are written `review_status = 'pending_review'`; the box-score promoter never
   sets `reviewed` ([box-score.ts:92-105](../../apps/worker/src/ocr-promoters/box-score.ts#L92-L105) — no `reviewStatus` in insert/update).
2. The frontend surfaces OCR periods **only** when `review_status = 'reviewed'`
   ([match-enrichments.ts:24-27](../../packages/db/src/queries/match-enrichments.ts#L24-L27)).
3. Corpus-wide, only matches **250 and 463** have `reviewed` period rows (both hand-reviewed
   during calibration). 968, 972-974, 2582, 2675 are all `pending_review` → invisible.

So P3 GA=7 never reaches a page. The **published** output of the review queue is trustworthy.

**Per-period is fundamentally auto-unverifiable.** All 32 `match_period_summaries` rows in the DB
are `source='ocr'` — **EA provides no per-period breakdown**. There is no external truth to grade a
period read against. The only automatic check possible is _self-consistency_: do the OCR periods
reconcile to the API-verified final? Both signals for that already exist and are already computed:

- `periodCoverage` ([l4-api-truth.ts:103-114](../../apps/worker/src/lib/l4-api-truth.ts#L103-L114)) — fraction of periods with both
  goals cells read. **2675 = 0.75** (P2 GA null ⇒ that period "not covered").
- `periodAccuracy` ([l4-api-truth.ts:254-266](../../apps/worker/src/lib/l4-api-truth.ts#L254-L266)) — do the per-period goals **sum**
  to the API final? Graded **only** at full coverage (else `null`, removing the missed-period
  confound). **2675 = null** (coverage < 1). Would catch the P3=7 class of error when all cells
  _are_ read but don't sum.

Both are documented "soft flag; never gates." Today they are computed and dropped — nothing
consumes them.

## The real exposure (not a leak, two other things)

1. **Completeness gap:** every auto-PASS match's per-period breakdown is permanently blank on the
   recap, because nothing promotes it. At corpus scale, per-period tables show ~2 matches, blank
   for the rest.
2. **Latent trap:** the tempting corpus-scale shortcut — "it PASSed, auto-promote its period rows
   to `reviewed`" — would turn the quarantine into a silent-corruption pipe. Neither gate would
   stop it, because per-period correctness is auto-unverifiable (no EA truth).

## Decision

1. **Do not change the gate.** 2675 passing is correct; its final/aggregates are right.
   Failing the match over per-period noise would wrongly quarantine good aggregate data and flood
   the queue. Per-period staying **soft** is the right call. The review queue is trustworthy for
   aggregates at corpus scale **as-is**.

2. **INVARIANT (write it down, enforce it): never wire "PASS ⇒ auto-promote period rows to
   `reviewed`."** A per-period row may become `reviewed` only via (a) manual review
   (`ingest-ocr-review-cli`) or (b) the reconciliation check below passing. `overall.pass` and
   `gateFromL4` say nothing about per-period correctness and must never be used as a proxy for it.
   This is the [[project_reel_association_gaps]] / "run-quality can't carry the L4 verdict" trap in
   a new spot.

3. **Turn the existing soft signals into a review-queue item — not a gate change.** Spec below.

## Spec — `period_reconciliation` review flag (deferred implementation)

- **Fire when:** a match is `overall.pass = PASS` **and** (`periodCoverage < 1` **or**
  `periodAccuracy < 1`). (2675 fires on `periodCoverage = 0.75`.)
- **Effect:** raise a `period_reconciliation` review task for that match. **Do NOT** fail the
  match, withhold its final, or block aggregate publication. The match publishes its correct
  final; its per-period breakdown is explicitly marked "unverified — reconcile" until a human or a
  clean re-OCR resolves it.
- **Promotion rule:** a per-period row is promoted to `reviewed` (⇒ eligible for the frontend)
  only when reconciliation passes (`periodCoverage = 1` **and** `periodAccuracy = 1`) **or** on
  manual review. Reconciliation-pass is the _only_ automatic per-period guard EA data can support.
- **Non-goals:** no new gate layer; no change to `overall.pass`; no change to `gateFromL4`; L4
  stays informational for the _final_ verdict path.

## Open follow-ups (carried from prior session, not part of this decision)

- `load_confirmed_reel_map` silent-no-op hardening (distinguish "nothing confirmed" from "lookup
  failed").
- Latent `ocr_capture_batches.match_id` stamp bug (routed around, not fixed).

## Addendum — IMPLEMENTED 2026-07-22 (with two corrections)

The spec above shipped. The verdict itself held on re-verification against the live DB
(24 `pending_review` rows across 6 matches, 8 `reviewed` across 250/463 — unchanged; the
gate still keys only on `finalAccuracy`). But building it surfaced two errors in the spec.

### Correction 1 — the fire condition is `gateFromL4`, not `overall.pass`

The spec says fire when "`overall.pass = PASS`". **Match 2675 is `overall.pass = FAIL`**
(L2 0%, L2.5 0%, L3 79.5%) — `overall.pass` is `l2 && l2_lineup && l3` and never inspects the
final at all. The "PASS" in every prior report — `batch-promote`'s `PASS=1`, "a PASS with 1/6
fields" — is the **`gateFromL4` decision**, which is what actually routes a match away from
review. Implemented literally, the flag would never have fired on its own archetype.
The line above ("`overall.pass` … keys on the **final**") is wrong; only `gateFromL4` does.

### Correction 2 — reconciliation-pass is NOT sufficient to promote (the vacuous sum)

The spec names `periodCoverage = 1 ∧ periodAccuracy = 1` as "the _only_ automatic per-period
guard EA data can support." That guard has a hole, found on **match 972**:

```
API final 5-1 · OCR periods: P1 5-1 · P2 0-0 · P3 0-0 · OT 0-0
⇒ periodCoverage = 1, periodAccuracy = 1  → "reconciled" → would auto-promote
```

The sum matches **by construction**. Whenever one period carries the entire final and the rest
are scoreless, the sum test has _zero_ discriminating power — "reconciled" is an artifact, not
evidence. Two different causes produce byte-identical rows, and box-score data alone cannot
separate them: a TOT/FINAL cell leaking into the P1 row (breakdown fabricated), or a game that
genuinely ended early so the unplayed periods really are 0-0. Promoting on the sum is unsound
regardless of which one it is.

So a third signal gates promotion: `periodSumVacuous`. Promotion now requires
`periodCoverage = 1 ∧ periodAccuracy = 1 ∧ ¬periodSumVacuous`. 972 routes to review instead.
(250 and 463 — the hand-verified pair — are genuinely distributed, stay `reconciled`, and are
already `reviewed`, so promotion is a no-op for them.)

> **Addendum 2026-07-22 — 972 is the _early-ended_ cause, not the leak.** See
> "Addendum: match 972 re-examined" at the end of this document. The guard is unchanged and
> still correct; only the worked example's diagnosis was wrong.

### What shipped

| piece                                                            | where                                                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `reconcilePeriods()` + `periodSumVacuous` (pure)                 | [l4-api-truth.ts](../../apps/worker/src/lib/l4-api-truth.ts)                                                                                 |
| wired into `computeLayers` (gated on `gateFromL4`)               | [quality-layers.ts](../../apps/worker/src/lib/quality-layers.ts)                                                                             |
| surfaced in the report body (additive, `schema_version` still 2) | [run-quality-report.ts](../../apps/worker/src/lib/run-quality-report.ts)                                                                     |
| surfaced in the human report                                     | [match-quality-cli.ts](../../apps/worker/src/match-quality-cli.ts)                                                                           |
| the promoter + corpus sweep                                      | [reconcile-periods-cli.ts](../../apps/worker/src/reconcile-periods-cli.ts)                                                                   |
| invariant guard-comments                                         | [box-score.ts](../../apps/worker/src/ocr-promoters/box-score.ts), [match-enrichments.ts](../../packages/db/src/queries/match-enrichments.ts) |

`overall.pass` and `gateFromL4` are **unchanged** — no match's verdict moved, exactly as decided.

### Corpus state at implementation (`reconcile-periods --all`, read-only)

```
match  overall  cov    acc    status          pending  promotable
  250  PASS     1.00   1.00   reconciled            0    (already reviewed)
  463  FAIL     1.00   1.00   reconciled            0    (already reviewed)
  968  FAIL     0.75    —     review                4    no
  972  FAIL     1.00   1.00   review (VACUOUS)      4    no  ← correction 2 (see addendum)
  973  FAIL     0.75    —     review                4    no  ← task raised
  974  FAIL     0.75    —     review                4    no  ← task raised
 2582  FAIL     1.00   0.00   review                4    no
 2675  FAIL     0.75    —     review                4    no  ← task raised
```

Review queue = **4 matches** (972, 973, 974, 2675 — those whose gate is PASS). 968 and 2582
are gate-HOLD, already queued on their own verdict, so no duplicate task. **Zero matches are
auto-promotable**; `--promote` wrote 0 rows and the 24/8 `pending_review`/`reviewed` split is
untouched. Per-period completeness therefore still needs manual review or a cleaner re-OCR —
the honest outcome, and a reminder that the automatic guard is deliberately narrow.

## Evidence appendix (so a future session need not re-derive)

```
matches:                id=2675 result=LOSS score_for=2 score_against=5 bgm_was_home=f
OCR period.TOT:         away=2 home=5   (== API final; finalAccuracy=1)
match_period_summaries (source=ocr, all pending_review):
  P1: GF=1 GA=1 SF=5 SA=5
  P2: GF=1 GA=∅ SF=5 SA=8      ← GA unread ⇒ periodCoverage 0.75
  P3: GF=0 GA=7 SF=8 SA=9      ← GA misread (7 in a 5-goal game)
  P4: GF=0 GA=0 SF=0 SA=0
reviewed period rows corpus-wide: only match 250 (4/4) and 463 (4/4)
all match_period_summaries rows are source='ocr' (EA has no per-period truth)
no ocr_run_quality_reports row for 2675 (0 ocr_decoder_runs ⇒ run-quality --emit-row unreachable;
  the PASS verdict came from the match-quality route)
```

## Addendum: match 972 re-examined (2026-07-22)

**Correction 2 named the right guard for the wrong reason.** 972 is not a TOT-cell leak. Its
per-period rows are CORRECT: the game ended after period 1, so `P1 5-1 · P2/P3/OT 0-0` is a
faithful read. The follow-up "investigate the 972 TOT-into-P1 leak in the box-score period
parser — it is an extractor defect" is **closed as not-a-defect**.

### Why the leak hypothesis fails

1. **The promoter is clean.** [box-score.ts](../../apps/worker/src/ocr-promoters/box-score.ts)
   skips `period_number < 1`, and the raw `ocr_extraction_fields` already carry `period.1ST`
   = 5/1 independently of `period.TOT` = 5/1. Any duplication predates promotion.
2. **The duplication cannot be a binning artifact.** `_align_row_to_headers` bins by nearest
   header x-center and `_explode_digit_token` splits glued tokens — both can move or drop a
   digit, neither can _duplicate_ one. For P1 and TOT to read 5/1 across four independent
   frames at ~0.99 confidence, the screen must actually show those digits twice.
3. **The extractor's own TOT-sum check passed** (`warnings: []` on extraction 17784). Headers
   resolved to `1ST 2ND 3RD OT SO TOT`, matching the real layout in
   `tools/game_ocr/ScreenShots/Post Game Box Score.png` (the `SO` column is genuinely on
   screen; the parser maps it to `period_number 0`, so it is excluded from the sum).

### The decisive evidence — `player_match_stats.toi_seconds`

| match               | API final | max TOI  | periods played         |
| ------------------- | --------- | -------- | ---------------------- |
| 463, 968, 973, 2675 | —         | 3600     | 3.00 (full regulation) |
| 2582                | 3-2       | 3742     | 3600 + 142s OT         |
| 250                 | 4-3       | 4643     | 3600 + OT              |
| 974                 | 6-2       | 1665     | 1.39                   |
| **972**             | **5-1**   | **1197** | **1.00**               |

All six skaters (3 BGM + 3 opponent) on 972 read `toi_seconds = 1197` ≈ 19:57 — nobody subbed,
the game simply ended after one period (the routine EASHL blowout quit). Per-player goals
confirm the score: 2 + 3 = 5 for, 1 against.

Two independent cross-checks: 2582's `3742 = 3600 + 142` matches its OCR OT row reading 1-0
(OT goal at 2:22), and 974's `1665` (P1 + 7:45 of P2) matches a box score carrying P1/P2 data
with P3 unread. 972 is also the _only_ vacuous-shaped match in the corpus and the _only_
~one-period game — the correlation is exact.

### What changes, and what does not

- **The guard is unchanged and still correct.** From box-score data alone the two causes are
  indistinguishable, so refusing to auto-promote was right. It was simply being conservative
  about a correct row rather than blocking a fabricated one.
- **No extractor fix is warranted.** Nothing in the parser or the promoter is defective.
- **972's rows are legitimately promotable** by a human reviewer.
- **A real de-confounder exists and is not yet used:** `toi_seconds` is EA API truth already in
  the DB. When it shows only N periods were played, zeros in periods > N are the _only_ correct
  answer, and the sum agreeing is no longer "by construction". Wiring a TOI-derived
  `periodsPlayed` into the vacuity test would make short games auto-promotable — a behaviour
  change to the promotion gate, deferred to its own session with tests.
