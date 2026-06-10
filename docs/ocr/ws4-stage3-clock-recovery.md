# WS4 Stage 3 — Clock (+ Period) Recovery for Orphan Action-Tracker Events

**Status:** Tier 1 MERGED + PUSHED (`4340072`); reviewed + fresh-match-validated; follow-ups #5–#8 resolved (§10). 2026-06-09.
**Predecessors:** WS4 Stage 1 + 2a + 2b — MERGED to `main`.
Design root: [`action-tracker-identity-recovery-design.md`](./action-tracker-identity-recovery-design.md) §"Stage 3 — optional (high-ROI polish)".

This doc is the implementation scope. The central design decision (which approach) is
settled below by **evidence from the live DB**, not by the original spec's two-option
framing.

**Implementation note (2026-06-07).** Tier 1 shipped per the §3/§5/§7 plan (commits:
producer `recover_clock`/`recover_period`/`_orphan_identity`/per-child clock assignment;
worker recovered-clock exact-key dedup + guarded backfill, floor `0.66`). Two latent spec
conflicts were resolved during implementation: (1) confidence is scored by **distinct
transform kinds** (1.0/0.8/0.6) with a trailing **OT-suffix exemption** so `B:4910T`→`8:49`
clears the floor while `9:0D1`→`9:00` (glued trailing digit) stays below it; (2) recovered
clocks are emitted **un-zero-padded** to match the live promoter's stored form. Verified on
real matches 250/2582: 9/13 orphan identities recovered (~69%, matching §2.4), every value
matching the §2.1 table; period recovery additionally **admitted a previously-dropped
orphan** (RANTANEN p3 `D:14`). Tier 2 remains deferred (§8). End-to-end net-new INSERT
validation on the fresh un-reviewed match 968 is **done** — see §10.1 (disambiguation /
duplicate-prevention proven; net-new inserts rare by data nature).

---

## 1. What Stage 3 is

Stages 1/2a/2b recover the **identity + position** of garbled-clock Action-Tracker (AT)
events the live promoter drops, and insert them as `review_status='pending_review'`,
**clock-null** rows. Stage 3 recovers the **clock itself** (and, per the 2026-06-07
decision, the **period** when it too was garbled), so recovered rows carry a real
`clock`/`period_number` instead of a clock-independent placeholder.

The original spec offered two approaches:
- **(a)** targeted clock **re-OCR** on the detail row (like the yellow-marker spatial extractor), or
- **(b)** **cross-frame clock consensus** (same event/period → same clock).

Empirical evidence (below) supersedes both as the *primary* path and adds a cheaper one.

---

## 2. Empirical basis (live DB, 2026-06-07)

### 2.1 The garbled clock digits are already stored — in `event_detail`, not in the clock field

When the AT clock regex (`_CLOCK_PATTERN = r"[01]?\d:[0-5]\d"`,
[`parsers.py:2009`](../../tools/game_ocr/game_ocr/parsers.py#L2009)) fails, the parser sets
`clock = None`, so the **clock field's `raw_text` is `None`** — the garbled string is
discarded *there*. **But** the event's `raw_text` / `event_detail` (the full joined Row-B
line) preserves the digits, and `build_orphan_cards` already carries it forward as
`event_detail`.

Actual garbled `event_detail` strings for real orphans (matches 250 + 2582):

| `event_detail` (garbled) | true clock | recoverable by | failure cause |
|---|---|---|---|
| `...SHOT D:14...` | `0:14` | char-normalize | `D`→`0` |
| `...SHOT DT 18.12` | `18:12` | char-normalize | `.`→`:` |
| `...19·43 1 2nd Perind HIT` | `19:43` | char-normalize | `·`→`:` |
| `...S SHOT 8.12 1 2nd Perind` | `8:12` | char-normalize | `.`→`:` |
| `...H 2.59 HIT...` | `2:59` | char-normalize | `.`→`:` |
| `...SHOT B:4910T` | `8:49` (OT) | char-normalize | `B`→`8`, `10T`→OT |
| `...HIT 9:0D1 2nd Period` | `9:01`? | low-confidence | `D`→`0`, trailing noise |
| `...H 69:0 3rd Period HIT` | — | unrecoverable | invalid (69 > 20) |
| `...H HIT LU·UL 3rd Perind` | — | unrecoverable | fully garbled |
| `...H 2nd Period HIT` (U. MAILMAN) | — | unrecoverable | no clock token at all |

Estimate: **~60–70% of orphans recover from `event_detail` alone**, with zero re-OCR and
zero image access (pure host-side data transform; no new Python deps).

### 2.2 Cross-frame consensus (spec option b) is weaker than assumed

The garble is **pixel-consistent across frames**: e.g. `P. MAGROYNE ... D:33` is identical
across all 11 frames it appears in. Voting across frames mostly returns the *same* garbled
string, not a clean read. Consensus helps only the minority of orphans with frame-to-frame
variance. → **Deprioritize to a tie-breaker.**

### 2.3 Period is also garbled and currently causes the orphan to be SKIPPED

Several match-250 orphans have `period_number = -1` or `0` (period parse failed) **even
though `"3rd Period"` / `"2nd Period"` is right there in `event_detail`**.
`build_orphan_cards` filters `period < 1`
([`reconcile_action_tracker.py`](../../tools/game_ocr/scripts/reconcile_action_tracker.py),
in the `build_orphan_cards` loop) → these orphans **never reach Stage 2b/3 at all**.
Per the 2026-06-07 decision, Stage 3 folds in permissive period recovery from the same
`event_detail` so these become recoverable.

### 2.4 ROI sizing

Distinct garbled-clock orphan identities (post-dedup): ~9 (match 250), ~9 (match 2582);
more latent in 968/463. Frame-level garbled-orphan event counts: 968:46, 250:23, 463:17,
2582:16. Small but real; Tier 1 is cheap enough that the ROI is favorable.

### 2.5 Gate verification — EXECUTED 2026-06-07 (resolved, with a reframing)

The live DB has **no clock-null OCR `match_events`** and **zero orphan rows**
(`clock IS NULL AND review_status='pending_review'` → 0 of 508 OCR events). The 4
`position_confidence='extrapolated'` rows are *not* orphan recoveries — they carry real
clocks (`extrapolated` is a shared position tier, not the orphan fingerprint).

The §2.5 gate ("confirm Stage 2a/2b emits orphan inserts on a real run") was run host-side
against matches 250 + 2582 via the **standalone Python producer** (read-only; the TS
`reconcilePositions` apply has no standalone CLI — it only fires from the `ingest-ocr`
tail-hook, so the post-merge apply has simply never run on these matches). Findings:

- **Producer half: ALIVE.** 12 orphan cards emitted (5 for 250, 7 for 2582). Every
  `event_detail` matches the §2.1 table verbatim (`D:33`, `B:4910T`, `9:0D1`, `19·43`,
  `69:0`, `LU·UL`, …). Tier 1's premise — garbled clock digits survive in `event_detail` —
  is **confirmed on real stored data**.
- **Insert half: 0 net-new inserts on 250/2582 — by design, not a bug.** Predicted from the
  clockless dedup rule ([`match-events-dedup.ts:136`](../../apps/worker/src/ocr-promoters/match-events-dedup.ts#L136),
  bucket has no `review_status` filter, `effective.size > 1 → ambiguous`):

  | match | orphan cards | dedup-hit/refresh | ambiguous-skip | net-new insert |
  |---|---|---|---|---|
  | 250 | 5 | 2 | 3 | **0** |
  | 2582 | 7 | 1 | 6 | **0** |

  Cause is structural: 250/2582 are **saturated** (fully reviewed / all-pending dense). Every
  orphan identity already has ≥1 row in its bucket, and a clock-null orphan can't disambiguate
  among multiple same-actor rows → **ambiguous-skip dominates**.

**Gate conclusion.** The path is alive (producer + dedup both proven). "Does Stage 2 emit
orphan *inserts*" can only be answered on a match with genuine un-backfilled gaps (live
promoter dropped an event **and** no manual review filled it) — the two reference matches
have no such gaps left, so 0 inserts there is expected, not a failure. Stage 3 is cleared to
proceed; net-new insert volume should be validated separately on a fresh un-reviewed match.

### 2.5b Value reframing — on saturated matches the payoff is disambiguation, not volume

Because 250/2582 are saturated, Tier 1's measurable win there is **not** "more rows with
clocks" — it is **dedup correctness**. A recovered clock lets the §5 exact key convert
today's ambiguous-skips into clean hits, and fixes at least one **wrong refresh** today:

- MAGROYNE p3 shot `D:33`→`0:33` exact-hits the existing 0:33 row (today: ambiguous-skip).
- TOEWS p2 hit `19·43`→`19:43` exact-hits the existing 19:43 row (today: ambiguous-skip).
- SILKY p4 shot `B:4910T`→`8:49 OT` — today this positioned orphan **wrongly backfills** the
  unrelated 1:10 pending row; a recovered clock routes it to the correct 8:49 row instead.

The doc's earlier "~60–70% recover → real clocks" framing still holds for insert volume on
**non-saturated** matches; on reviewed matches the same recovery shows up as correctness, not
count. Both are real; the test plan (§7) must assert the disambiguation outcomes too.

---

## 3. Recommended design — tiered, cheapest-first

### Tier 1 — permissive clock + period re-parse from stored `event_detail` (PRIMARY)

Pure data transform in the **producer** (`build_orphan_cards`), reusing already-stored
strings. No image access, no video, no new deps. Steps:

1. **Permissive clock parse** of `event_detail`:
   - Normalize separators `.` `·` → `:`.
   - Normalize clock-context digit confusions (`D`/`O`→`0`, `B`→`8`, `I`/`l`→`1`, etc.) —
     **only** within a candidate `MM:SS` token, never globally (avoid corrupting actor text).
   - Relax then re-validate: a recovered clock must satisfy `0 ≤ MM ≤ 20` and `0 ≤ SS ≤ 59`.
     Reject invalid (`69:0`, `17:71`) → leave clock-null (Stage 2b behavior).
   - Attach a **confidence**: exact `:` match > separator-normalized > digit-normalized.
2. **Permissive period parse** when `period_number < 1`: extract `"1st|2nd|3rd Period"` (+
   garbled `Perind`/`Pet1o`/`Periar` variants) from `event_detail` → 1/2/3 (extend to OT —
   EASHL has no shootout; period 6 = OT3, never SO). Only then admit the orphan.
3. Emit new card fields: `recovered_clock: str | null`, `recovered_clock_confidence: float`,
   and the recovered `period_number`.

Keep the normalizer **table-driven and unit-tested against the §2.1 strings verbatim** so
regressions are visible.

### Tier 2 — targeted clock re-OCR on the detail-row ROI (OPTIONAL, deferred)

For the residual unrecoverable cases (§2.1 bottom rows). Model on the yellow-marker spatial
extractor: crop the detail-row clock ROI from the source frame, upscale + threshold, re-OCR.
Heavier — needs the video host-side and frame addressing. **Defer** unless Tier 1 leaves a
material gap on a real run.

### Cross-frame consensus — tie-breaker only

When Tier 1 yields multiple distinct candidate clocks across frames for one identity, pick
the highest-confidence / most-frequent. Not a standalone tier.

---

## 4. Seams (where the code changes land)

| Concern | File:line | Change |
|---|---|---|
| Loss point (context) | [`action-tracker.ts:105`](../../apps/worker/src/ocr-promoters/action-tracker.ts#L105) | none — read-only reference |
| Clock pattern | [`parsers.py:2009`](../../tools/game_ocr/game_ocr/parsers.py#L2009) | reuse for validation; new permissive layer is separate |
| **Producer (Tier 1 core)** | `reconcile_action_tracker.py` `build_orphan_cards` / `_emit_orphan_card` | add clock+period recovery; emit `recovered_clock`(+conf) |
| Wire shape | [`reconcile-positions.ts:105`](../../apps/worker/src/reconcile-positions.ts#L105) `RawOrphanCard` | add optional `recovered_clock?`, `recovered_clock_confidence?` |
| Proposal shape | [`reconcile-positions.ts:75`](../../apps/worker/src/reconcile-positions.ts#L75) `IdentityProposal` | add `clock: string \| null` (currently intentionally absent) |
| Resolve | `reconcile-positions.ts` `resolveOrphanCard` (~279) | carry `recovered_clock` → proposal |
| INSERT + dedup | `resolveOrphanCard`→`applyIdentityProposals` INSERT | write recovered `clock`; pick dedup key (see §5) |
| Dedup owner | [`match-events-dedup.ts:84`](../../apps/worker/src/ocr-promoters/match-events-dedup.ts#L84) | when clock recovered, prefer the **exact** key; else clock-independent (existing) |

Existing tests to extend (do not rewrite):
`apps/worker/src/__tests__/reconcile-orphan-cards.test.ts`,
`apps/worker/src/ocr-promoters/__tests__/match-events-dedup-clockless.test.ts`,
`apps/worker/src/__tests__/reconcile-identity.test.ts`, and the Python producer tests under
`tools/game_ocr/tests/`.

---

## 5. Dedup interaction (must get right)

Today recovered orphans dedup via the **clock-independent** key (`match-events-dedup.ts:84`).
Once a clock is recovered:

- **Clock recovered** → try the **exact** key `(matchId, period, event_type, clock,
  actor_player_id)` first (the live promoter's path). This lets a recovered orphan dedup
  against a normally-promoted row of the same event if one exists, preventing duplicates.
- **Fall back** to the clock-independent key when exact misses (still safe-INSERT on zero,
  ambiguous-skip on >1) — unchanged Stage-1 semantics.
- **Idempotency:** a recovered-clock row must dedup-hit itself on re-run. Verify a second
  reconcile pass produces `identity_inserted=0`, `identity_dedup_refreshed=N`.

Risk: a recovered-but-wrong clock could create a near-duplicate that the exact key won't
catch (it'd differ by the bad clock). Mitigation: only promote a recovered clock to the
exact-key path above a confidence floor; below it, keep the clock value on the row (for
reviewer context) but **dedup via the clock-independent key**.

---

## 6. Safety (inherited, non-negotiable)

- Recovered rows stay `review_status='pending_review'`; never auto-promoted.
- All INSERTs route through the shared dedup owner; no re-implementation.
- Ambiguous (>1) → no write, report only. Idempotent on re-run.
- A recovered clock that fails `MM≤20 / SS≤59` validation is **discarded** — better
  clock-null than a fabricated clock in canonical-adjacent data.

---

## 7. Test plan (TDD, Tier 1)

1. **Python producer** — table of §2.1 strings → asserts each `recovered_clock` (incl. the
   unrecoverable rows → `None`) and recovered period from `Perind`/`Pet1o` variants.
2. **Char-normalizer scope** — actor/target text untouched; only the clock token rewritten.
3. **Validation** — `69:0`, `17:71` rejected → clock-null.
4. **TS resolve+insert** — recovered clock flows to the `clock` column; exact-key dedup hit
   against a matching promoted row → no duplicate; zero-match → safe INSERT with clock.
5. **Idempotency** — second pass: `identity_inserted=0`.
6. **Period admission** — a `period_number=-1` orphan with `"3rd Period"` in detail is now
   admitted (was skipped) and lands `period_number=3`.

---

## 8. Out of scope

- Tier 2 re-OCR (deferred; separate follow-up if needed).
- Box-score per-period number accuracy (separate:
  [`box-score-ocr-accuracy-followup.md`](./box-score-ocr-accuracy-followup.md)).
- Any change to canonical reviewed rows.

---

## 9. Suggested branch / sequencing

1. **First**: confirm Stage 2a/2b emits orphan inserts on a real run (§2.5) — gating check.
2. Branch `feat/ws4-stage3-clock-recovery`.
3. TDD Tier 1 (Python producer first, then TS wire/insert/dedup), per §7.
4. Review (local high-effort + Codex, per repo convention) before any live run.
5. Defer Tier 2 unless a real run shows a material residual gap.

---

## 10. Code review (2026-06-09) — fixed + follow-ups

High-effort multi-angle review of the branch. Three correctness findings **fixed before merge**
(each with a TDD test; real-data recoveries on 250/2582 unchanged):

- **#1 `recover_clock` first-match-wins** — a clock-shaped token glued to the right of a
  word/gamertag (e.g. `PLAYER7:30`) could win and persist a wrong clock at ≥floor. Fix: skip a
  candidate whose MM is immediately preceded by a letter, so a real clock later in the line wins.
- **#2 `_OT_SUFFIX_RE` over-match** — `^[0-9]{0,2}[Oo]?[Tt]` exempted any digits-then-T (e.g.
  `1Tom`) from the glued-digit degrade, wrongly keeping 0.8. Fix: `(?![A-Za-z])` after the `T` so
  only a genuine OT marker is exempt (`10T` still 0.8; `1Tom` → 0.6, below floor).
- **#3 `recover_period` false positives** — a bare jersey/score digit glued to PERIOD, or a count
  digit glued to a `PER*` word (`PERSON`), could fabricate a period. Fix: require an ordinal
  **suffix** (legit periods have ST/ND/RD…, jerseys don't) and require the `PERI` stem (rejects
  `PERSON`).

Accepted / deferred (not merge-blocking):

- **#4 exact-key omits `team_side`** (`reconcile-positions.ts`) — real asymmetry vs the clockless
  key, but inherited from the live promoter's own `findExistingMatchEvent` contract; actor identity
  disambiguates. **Accepted** (not held; would require changing the promoter contract too).

Follow-ups #5–#8 — **RESOLVED in a follow-up cycle (2026-06-09, `feat/ws4-stage3-followups`):**

- **#5 `_pick_clock` majority vote** — ✅ **DONE.** Replaced strict single-distinct with a
  **strict-plurality** vote (exact tie still → null), so one stray misread no longer nukes a
  strong-consensus clock. Real-data spot-check: inert on 250/2582/968 (pixel-consistent garble → no
  within-child pluralities), no regression.
- **#6 `_CLOCK_CHAR_FIX` subset of `_DOT_DIGIT_LOOKALIKES`** — ✅ **DOCUMENTED (won't widen).** Kept
  the conservative subset; full reuse would require widening the clock-token regex char class and
  reintroduce finding #1's false-token risk. Added a cross-reference comment; the `S→5`/`Z→2`/`G→6`
  recall gap is speculative.
- **#7b OT `period_label`** — ✅ **DONE.** Recovered OT periods now label `"OT"`/`"OT2"`/`"OT3"`
  (parsers.py convention), not numeric. **#7a single-frame multiplicity** — **WON'T-FIX** (documented
  known-limitation: hard, rare, safe-fails to clock-null).
- **#8** — **DECIDED: keep the conservative skip** (no code change). See §10.2.

### 10.1 Fresh-match end-to-end validation — EXECUTED 2026-06-09 (match 968)

Ran the real `reconcilePositions(968)` tail-hook path against the live dev DB on the **un-reviewed**
match 968 (0 reviewed / 164 pending; the doc's highest-orphan candidate), then **restored 968 to its
pre-run state** (the run was a proof, not a sanctioned ingest). Result:

```
14 orphan cards → 13 recovered clocks ≥ floor (0.8)
apply: inserted=0  dedup_refreshed=10  ambiguous=1  wrong-writes=0  positions_recovered=13
```

**Proven:** the exact-key recovery correctly recognized **10 garbled-clock orphans as the same event
as an already-promoted row** (recovered clock matched the row the promoter captured from a *clean*
frame) and **refreshed instead of inserting duplicates** — the §2.5b disambiguation value, confirmed
end-to-end on fresh data, zero wrong writes.

**Reframing (final).** 968's orphans are garbled-*frame* re-detections of events the promoter already
saw in clean frames, not events it never saw. A net-new INSERT needs an event garbled in *every* frame
it appears — rarer than §2.4 assumed. So Stage 3's dominant, proven value is **duplicate-prevention via
exact-key dedup**, not insert volume. The §2.5 "does it emit inserts" gate is effectively answered:
the path is correct and safe; net-new inserts are simply rare because clean-frame promotion already
catches most events.

### 10.2 Finding #8 — DECIDED (2026-06-09): keep the conservative skip

The one ambiguous case (`G. VIEUX CRISSE p1 hit`): its recovered clock matched no existing row
(exact-**miss**), so it fell back to the clockless key, hit 10 same-actor candidates, and
ambiguous-skipped (plan §5 conservative path). The candidate change was: when a confident recovered
clock exact-misses, INSERT directly (the clock makes the event unique, as the live promoter does on
the exact key alone) instead of deferring to clockless ambiguity.

**Decision: do NOT make this change — keep the skip.** Rationale: the 968 fresh-match proof (§10.1)
showed orphans are overwhelmingly garbled-*frame* re-detections of already-promoted events, not
genuine misses, so the upside (capturing a rare genuine miss) is small. The downside is real: a
confident-but-wrong recovered clock that lands on an unoccupied slot would INSERT a reviewable
duplicate. Duplicate-safety wins; the current behavior is safe (skips, never wrong). **Re-open only
if a future real run shows material suppressed-insert loss** (i.e. genuine missing events being
skipped, not just garbled-frame re-detections).
