# Fixture Provenance — fixture_match250_full_lobby

## Source of truth

- **Canonical rows** (`expected_canonical.sql`): copied verbatim from production
  `player_loadout_snapshots` + `player_loadout_x_factors` + `player_loadout_attributes`
  for `match_id=250` with `review_status='reviewed'`. Snapshot taken at git SHA
  `475b05b3295136333658dbe7fb1f6cef468db3cb` (2026-05-21). Ten rows: IDs 1445–1455,
  x_factors IDs 329–361, attributes IDs 2257–2509.

  These rows are V2-benchmark-verified — the 70 V2 assertions in
  `apps/worker/src/__tests__/match-250-benchmark.test.ts` lock all categorical
  fields + canonical X-Factor / build_class values for all 10 slots:
  - gamertag_snapshot (lineup test Family 1)
  - position (lineup test)
  - is_captain (lineup test — XZ4RKY=captain; DuhPope=NOT captain per V2)
  - build_class_canonical (lineup test)
  - x_factor_name_canonical[0,1,2] (lineup test)
  - height_text, weight_lbs, player_level_number (lobby fields Family 7)
  - player_name_persona (persona Family 1)

  Cross-checked 2026-05-21: queried DB directly, compared each field against
  the benchmark assertions, confirmed exact matches.

- **Evidence JSON** (`seg_bgm/expected_loadout_evidence.json`,
  `seg_opp/expected_loadout_evidence.json`): hand-authored from first principles
  to be structurally consistent with the canonical rows and the promotion gate
  semantics in `apps/worker/src/lib/promotion-gate.ts`. The system-under-test
  (the Python extractor) was NOT invoked during authoring.

  Authoring strategy: for each slot, construct the minimal set of evidence
  records that `runPromotionGate` + `promoteLoadoutFromEvidence` (Task 2A-17)
  would promote into the canonical snapshot/x_factors/attributes rows above.
  Per record: `calibrated_confidence=0.9` for open_text+closed_vocab (rank 0),
  `1.0` for icon, `0.85` for tabular_numeric. All candidates are rank 0
  (single uncontested hypothesis), so `conflictCount=0` and the gate promotes
  without entering the dominance check.

- **PNG frames** (`seg_bgm/frames/`, `seg_opp/frames/`): TODO — operator must
  populate before running T1A (Python extractor parity). Phase 1 segment
  directories (`/tmp/vi-canonical/…/pass2/seg-001-player_loadout_view` and
  `/tmp/vi-phase1-smoke/…/pass2/seg-002-player_loadout_view`) were not present
  on disk at fixture authoring time (temporary directories cleaned up after
  Phase 1 runs). The operator should re-extract these segments from the
  canonical test recording (`/mnt/k/2026-05-08_18-25-42.mkv`) using the
  Phase 1 pipeline before running T1A tests.

## Per-field provenance

| Field | Source | V2-locked? |
|-------|--------|------------|
| `gamertag_snapshot` | Production DB reviewed row + V2 benchmark | Yes |
| `position` | Production DB reviewed row + V2 benchmark | Yes |
| `is_captain` | Production DB reviewed row + V2 benchmark | Yes |
| `build_class_canonical` | Production DB reviewed row + V2 benchmark | Yes |
| `x_factor_name_canonical[0,1,2]` | Production DB reviewed row + V2 benchmark | Yes |
| `height_text` | Production DB reviewed row + V2 benchmark (Family 7) | Yes |
| `weight_lbs` | Production DB reviewed row + V2 benchmark (Family 7) | Yes |
| `player_level_number` | Production DB reviewed row + V2 benchmark (Family 7) | Yes |
| `player_name_persona` | Production DB reviewed row + V2 benchmark (Family 1) | Yes |
| `x_factor_tier` | Production DB reviewed row (tiers not V2-asserted per benchmark comment) | DB only |
| Attribute values (23 keys) | Production DB reviewed rows (IDs 2257–2509) | DB only |
| `player_level_raw`, `build_class` (raw) | Production DB reviewed row | DB only |

## Sentinel IDs used

| Sentinel | Range | Purpose |
|----------|-------|---------|
| `match_id` | 9001 | Sentinel match to avoid FK conflicts with real data |
| `player_id` (BGM) | 99001–99005 | Sentinel players (BGM side) |
| `snapshot.id` | 90001–90010 | 10 loadout snapshot sentinel rows |
| `x_factor.id` | 90100–90129 | 30 x_factor child rows |
| `attribute.id` | 90200–90429 | 230 attribute child rows |
| `ocr_extraction_id` | 99999 | Placeholder (no FK enforcement in test DB) |

## Evidence record counts

| Segment | Slots | Records per slot | Total |
|---------|-------|-----------------|-------|
| `seg_bgm` | 5 | 61 | 305 |
| `seg_opp` | 5 | 61 | 305 |
| **Combined** | **10** | **61** | **610** |

Per-slot record breakdown (61 per slot):
- 1 gamertag (open_text)
- 1 position (closed_vocab)
- 1 player_number (open_text)
- 1 is_captain (icon)
- 1 build_class (closed_vocab)
- 1 player_name_persona (open_text)
- 1 height (open_text)
- 1 weight (open_text)
- 1 player_level_number (open_text)
- 3 x_factor_name (closed_vocab, slots 0/1/2)
- 3 x_factor_tier (closed_vocab, slots 0/1/2)
- 23 attr_* value (tabular_numeric, column_key=value)
- 23 attr_*_delta value (tabular_numeric, column_key=delta)
= **61 records per slot**

## Fixture serves acceptance gates

- **T1A** (Python extractor parity): run extractor against `frames/`; compare
  output to `expected_loadout_evidence.json`. Requires PNG population (see TODO above).
- **T6A** (Node promoter parity): run `promoteLoadoutFromEvidence` with evidence
  from this fixture; assert DB state matches `expected_canonical.sql`.
