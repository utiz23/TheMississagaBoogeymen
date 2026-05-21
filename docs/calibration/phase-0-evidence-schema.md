# Phase 0 evidence-layer schema — design notes

Companion doc to migration `0045_simple_blindfold.sql` and schema file
`packages/db/src/schema/ocr-evidence.ts`. Live as the "why" alongside Phase 1+
implementation; Phase 5 retires the legacy parallel and this doc becomes the
canonical reference.

Source of truth for the column shapes: Round 4 §6 of
`docs/calibration/redesign-round-4-codex-synthesis-2026-05-19.md`. This doc
explains the **design decisions** behind that schema, the access patterns
Phase 2+ promoters will use, and the rationale for the bits that aren't
obvious from the schema file itself.

## The three tables

### `ocr_segments`

One row per decoded screen segment OR HUD interval.

Today (Phase 0): emitted by `writeSegmentForBatch` in
`apps/worker/src/ingest-ocr.ts`. The legacy pipeline = one CLI invocation
per screen-type = one segment per batch, so the relationship is 1:1 with
`ocr_capture_batches`.

Phase 1 (HMM/Viterbi): replaced by per-state segments output by the
sequence decoder. Many segments per video, each carrying real `t_start_sec`
/ `t_end_sec` bounds. The `decoder_version` column distinguishes the two
paths so reports can filter (`legacy-passthrough-v0-*` vs `hmm-viterbi-v1`).

Key design choices:

- **`segment_key` is _stable_ across re-ingests, not per-insert random.**
  For video ingests it's `vsha-<sha-prefix>:seg<NNNN>` (derived from the
  Pass-1 segment index + video sha256). Re-ingesting the same video
  produces the same segments → `on_conflict do_update` makes the operation
  idempotent at the segment grain.
- **`match_id` is nullable, and Postgres treats NULL as distinct in the
  unique index** (verified in `ocr-evidence-schema.test.ts`). That's
  intentional: manual screenshot batches arrive without a match_id and
  shouldn't collide with each other.
- **`ui_version` + `decoder_version` are required, not nullable.** Every
  row should be reproducible: knowing which UI version and decoder
  produced it is non-optional. Round 4 §9 mandates this for the NHL 26 →
  NHL 27 calibration loop.
- **`observability_status` is enum, not boolean.** A segment can be
  `observable`, `not_observable_from_source` (data wasn't on screen),
  `obstructed`, or `low_quality` (too blurry / compressed). Round 4 §2
  treats observability as first-class — "we couldn't see it" is a real
  outcome, not a missing row.

### `ocr_field_evidence`

One row per **candidate** claim about one semantic field. Append-only
within a run.

Critical: **multiple competing candidates** for the same (screen,
field, slot) coexist as separate rows distinguished by `candidate_rank`
(0 = top). The Phase 2 promotion gate collapses them.

Why this matters: today's parsers collapse to a single output value
immediately. Information is lost — when two extractor families disagree
on a build_class, the loser is invisible. The Phase 2 promotion gate
needs both candidates to decide, and the triage queue needs both to
surface "ambiguous" cases.

Column families:

- **Identity**: `match_id`, `segment_id`, `screen_state`,
  `screen_instance_key` (disambiguates multiple instances of the same
  screen state — e.g. P1/P2/P3/OT box-score tabs), `subject_slot_key`
  (for entity-bearing rows — e.g. `loadout_slot_3`, `event_42`).
- **Semantic**: `field_key` (the field name — e.g. `build_class`,
  `scorer_gamertag`), `field_family` (`open_text` / `closed_vocab` /
  `tabular_numeric` / `icon` / `geometry` — Round 4 §5 extractor
  families).
- **Candidate**: `candidate_value` (JSONB — supports strings, numbers,
  objects), `candidate_rank` (0-indexed), `raw_confidence`,
  `calibrated_confidence`.
- **Provenance**: `support_frame_ids` (bigint[] referencing
  `ocr_extractions.id` — Round 4 §6 mandate that we standardise on
  `ocr_extraction_id` semantically across new tables), `roi_bbox`
  (JSONB `{x, y, w, h}` in normalised template coordinates),
  `template_version`, `extractor_family`, `extractor_version`.
- **Status**: `observability_status`, `normalization_status`.
- **Type-specific extension columns** — present but nullable for rows
  that don't use them:
  - Tabular: `row_key`, `column_key`.
  - Geometry: `x_norm`, `y_norm`, `shape_or_icon_class`.

Indexes:

- `ocr_field_evidence_promotion_lookup_idx` on `(match_id, screen_state,
field_key, subject_slot_key, candidate_rank)` is the Phase 2 hot path —
  promotion gate iterates evidence per `(match, screen, field, slot)`
  and walks candidates by rank.

### `ocr_promotions`

One row per **promotion decision** — even when promotion was _blocked_.
"Not promoted" is itself an inspectable fact: it captures _which_ of
the four blocking conditions fired (`blocked_observability`,
`blocked_consensus`, `blocked_invariant`, `blocked_authority`) plus a
free-form `blocking_reason`.

This is the input to the triage queue. Phase 5's review UI ranks
blocked promotions by recency + status; the operator clicks "approve"
or "reject" and the gate re-evaluates on next run.

Key design choices:

- **Unique index on `(target_table, target_semantic_key::text, field_key)`**
  prevents duplicate promotion records for the same canonical target.
  `target_semantic_key` is JSONB, cast to text for the index — Postgres
  doesn't index JSONB equality natively without an expression index.
- **`authority_source` is nullable**: only set for `promoted` rows. When
  blocked, no authority won so the column stays NULL.
- **`evidence_ids` (bigint[])** stores all `ocr_field_evidence.id` rows
  that participated in the decision. Drives the triage UI's "see all the
  evidence that voted" view.

## How data flows

```
                                          ┌───────────────────────┐
                       ┌─────────────────►│  ocr_promotions       │
                       │ Phase 2          │  (decision outcome)   │
                       │ promotion gate   │                       │
┌────────────────────┐ │                  └───────────────────────┘
│ ocr_segments       │ │                            ▲
│ (Pass-1 output)    │ │                            │ evidence_ids[]
└────────────────────┘ │                            │
        ▲              │                  ┌─────────┴─────────┐
        │ segment_id   │                  │ ocr_field_evidence│
        │              │                  │  (candidates)     │
        │              │                  └───────────────────┘
        │ FK           │                            ▲
        └──────────────┴────────────────────────────┘
                                       writes by Phase 2+ typed extractors
```

- Phase 0: only `ocr_segments` is populated. `ingestOcrBatch` writes one
  segment per CLI invocation; the video orchestrator + dispatch wire
  passes Pass-1 metadata so the row carries real time bounds.
- Phase 2: typed extractors (e.g. `loadout_closed_vocab`) write
  `ocr_field_evidence` rows. The promotion gate reads evidence,
  writes `ocr_promotions`, and conditionally writes the canonical
  table (e.g. `player_loadout_snapshots`).
- Phase 3+: same pattern extends to other screen families.

## Read patterns (queries layer)

`packages/db/src/queries/ocr-evidence.ts` exports the common access
patterns. Consumers should prefer these over raw Drizzle for forward-compat:

- `getMatchSegments(matchId)` — full segment timeline ordered by
  `t_start_sec` (NULLs last).
- `getMatchSegmentStateCounts(matchId)` — per-state segments / frames /
  avg confidence. Used by `ocr-segments-report` CLI.
- `listFieldEvidence({matchId, screenState?, fieldKey?, subjectSlotKey?})` —
  raw evidence rows, filterable.
- `groupFieldEvidenceForPromotion(matchId)` — pre-grouped candidate
  clusters; the Phase 2 promotion gate's hot read path.
- `listPromotions({matchId, status?})` + `getPromotionStatusCounts(matchId)` —
  promotion outcomes, optionally filtered.
- `getBlockedPromotions(matchId, limit)` — the triage queue (all
  `blocked_*` statuses, recency-ordered).

## Inspector CLI

```
pnpm --filter worker ocr-segments-report --match 250
pnpm --filter worker ocr-segments-report --match 250 --verbose
```

Reports segment counts per state, total frames, avg per-segment
confidence, plus field-evidence + promotion stats once Phase 2+ lands.
Verbose mode lists every segment with its time bounds + decoder
version. Pure read-only; safe to run against production data.

## Migration coexistence

Phase 0 is **additive**: the three new tables sit beside the legacy
`ocr_capture_batches` / `ocr_extractions` / `ocr_extraction_fields`
tables that current canonical write paths still depend on. No legacy
code reads from the new tables yet, and no canonical write path reads
from the legacy ones via the new schema.

The legacy `OcrScreenType` enum has 14 entries; the new
`OcrSegmentState` has 17 (adds `unknown_or_transition`,
`loading_or_intro`, `end_of_video`). The legacy enum is frozen during
migration; the new enum is the canonical Pass-1 state set going forward.
The casts in `writeSegmentForBatch` are total because every legacy
`OcrScreenType` value is also a valid `OcrSegmentState`.

The `player_loadout_snapshots.source_extraction_id` column inconsistency
(it's `source_extraction_id` in one table but everywhere else we call
it `ocr_extraction_id`) is **kept as-is** at Round 4 §6's direction.
The new tables standardise on `ocr_extraction_id` semantically; a
separate later migration can rename `source_extraction_id` without
infecting the new schema.

## Phase 2+ adoption checklist

When implementing a Phase 2 typed extractor + promoter:

1. Read the segment(s) you're operating on via `getMatchSegments`.
2. For each candidate value your extractor produces, insert one
   `ocr_field_evidence` row with the right `extractor_family`,
   `candidate_rank` (0 for top, n for n-th best), and
   `support_frame_ids` (which OCR extractions contributed).
3. Run the promotion gate over the grouped evidence
   (`groupFieldEvidenceForPromotion`) — produce one `ocr_promotions`
   row per `(target_table, target_semantic_key, field_key)` triple.
4. **Only after** the promotion gate produces a `promoted` status,
   write the canonical row to the target table.

Don't bypass the gate by writing canonical rows directly from extractors.
That's the architectural error Phase 0 fixes by inserting the evidence
layer.

**Calibrated vs raw confidence (Phase 2A).** Throughout Phase 2A, the typed
extractors set `calibrated_confidence = raw_confidence` for every emitted
record. The two-column design exists so the schema matches Phase 3+'s contract
where a per-extractor sigmoid calibrator maps raw OCR confidences to
calibrated posteriors. Until that calibrator ships, downstream consumers
(promotion gate, blocked-promotion triage) should treat both columns as
identical — the gate's consensus + dominance thresholds were chosen against
the raw confidence range.

## Open questions deferred to Phase 1+

- **Should `support_frame_ids` enforce a FK to `ocr_extractions.id`?** No
  current FK because postgres array-element FKs are clumsy. Phase 5
  could add a periodic integrity check instead.
- **JSONB schema for `candidate_value`** — should we enforce a discriminated
  union (e.g. `{type: 'string', value: '...'}`)? Decided no: each
  `field_family` has its own implicit shape, and downstream code already
  knows the type. Round 4 §6 explicitly leaves this open.
- **Per-extractor confidence calibration** — `raw_confidence` and
  `calibrated_confidence` are both stored. The calibration mapping is
  Phase 2 work (Round 4 §5 names this as `n_best confidence` to feed the
  promotion gate); for Phase 0 they can be equal.
