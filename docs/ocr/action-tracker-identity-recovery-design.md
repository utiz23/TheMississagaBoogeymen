# Action Tracker Identity Recovery — Design Spec (WS4)

**Status:** Designed, not yet implemented. Scoped during the "Finish the Pipeline
Revamp (Tier 2)" plan. The user chose the **most robust long-term** solution over a
quick position-only hack.

## Problem

Action Tracker (AT) reconciliation (`tools/game_ocr/scripts/reconcile_action_tracker.py`,
shipped PR #4 / wired live PR #5) can only **UPDATE positions** of already-promoted
`match_events`. It cannot close **true row-gaps**: orphan rink markers that have a
position (x, y) but whose event _card_ (clock / actor / event_type) was never promoted.

Match-250 confirmed ≥1 real case: a 115-frame orphan shot marker at hockey ~(36.5, 36.2)
with no captured event row, because the card's clock was blank/garbled.

## Where identity is captured and lost

| Stage                        | File:line                                             | Behavior                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| OCR clock parse              | `game_ocr/parsers.py:2376`                            | regex `([01]?\d:[0-5]\d)`; on garbled text → `clock=None`, `status='missing'`                                                                         |
| Python parse                 | `parsers.py:2303–2548`                                | card still emitted into `events[]` **with null clock**; full data (actor, event_type, period, markers) persisted to `ocr_extractions.raw_result_json` |
| **TS promoter (loss point)** | `apps/worker/src/ocr-promoters/action-tracker.ts:105` | `if (!clock) { stats.skipped_missing_clock++; continue }` — **the null-clock card is dropped; no `match_events` row inserted**                        |
| Dedup key                    | `ocr-promoters/match-events-dedup.ts:84`              | `DedupKey` requires non-null `clock`                                                                                                                  |

So the identity data **exists in `raw_result_json`** — recovery does **not** require new
extraction, only a recovery pass that re-reads stored extractions + a clock-independent
identity key.

## Robust identity key (clock-independent)

```
(matchId, periodNumber, eventType, teamSide, actorSnapshot, actorPlayerId)
  + position-cluster tie-breaker: (period, eventType, teamSide, rounded x, rounded y)
```

Dedup strategy:

1. Try exact `(matchId, period, eventType, clock, actorPlayerId)` (existing path).
2. If `clock` is null, fall through to the clock-independent key: search unpositioned
   `match_events` with matching `(matchId, period, eventType, teamSide)` + actor within
   Levenshtein-1. **Exactly one** match → dedup hit; **zero** → safe INSERT; **>1** →
   ambiguous, skip + flag for review (never guess).

## Safety (non-negotiable)

- Recovered inserts land `review_status='pending_review'` and `position_confidence` per
  the reconcile guard — **never** auto-promoted into canonical reviewed data.
- Route ALL inserts through the shared dedup owner (`findExistingMatchEvent`,
  `match-events-dedup.ts:84`) — do not re-implement dedup or reach into promoter internals.
- Ambiguous (>1 candidate) → no write; report only. Idempotent on re-run.

## Staged implementation path (~10–14 engineer-days total)

**Stage 1 — clock-independent dedup + guarded INSERT (~3 days).**
Extend `DedupKey` / `findExistingMatchEvent` to accept null clock with the fallback key
above. Add a guarded INSERT path in `reconcile-positions.ts` (or the promoter) that mints
`review_status='pending_review'` rows for zero-match orphans. TDD: insert-missing,
dedup-hit-no-duplicate, ambiguous-skip, positioned/manual untouched.

**Stage 2 — recovery pass (~7–10 days).**
New `tools/game_ocr/scripts/recover_action_tracker_identities.py`: reads
`ocr_extractions.raw_result_json`, finds `clock.status='missing'` cards, matches each to
its orphan marker via cross-frame consensus + position clustering (reuse
`inventory_consensus_match` clustering / `pair_weight`), emits JSON identity proposals
(mirroring the reconcile tool's `--json`). Worker applies via the Stage-1 guarded INSERT.

**Stage 3 — optional (high-ROI polish).**
Targeted clock re-OCR on the detail row (like the yellow-marker spatial extractor), or
cross-frame clock consensus (same event/period → same clock) to recover the clock itself.

## Out of scope / risks

- Over-promotion collision: same actor acting at multiple blank-clock times in one period →
  the position-cluster tie-breaker + ambiguous-skip rule must prevent a wrong merge.
- This changes canonical `match_events` dedup semantics → must ship on its own branch with
  full TDD + review before any live run.
