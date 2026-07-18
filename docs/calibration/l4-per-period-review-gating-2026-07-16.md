# L4 per-period review-gating — calibration decision (2026-07-16)

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
