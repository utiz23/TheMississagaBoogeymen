# Fixture Provenance — fixture_synthetic_degraded

## Purpose

This fixture exercises 4 distinct degraded branches of the Promotable Slot Field
Matrix in `apps/worker/src/ocr-promoters/loadout-v2.ts`. It serves acceptance
gate **T8A** (synthetic degraded matrix branches) and validates that the promoter
correctly handles partial evidence and unresolvable slots.

No production DB rows are referenced. All values are hand-authored from first
principles to trigger specific code paths.

## Authoring source

100% hand-authored. The evidence records in `degraded_evidence.json` are
constructed to trigger specific gate behaviors:

- Confidences set to `0.9` for above-threshold candidates.
- Confidences set to `0.3` for below-threshold candidates (below the default
  `consensusThreshold=0.5` in `runPromotionGate`).
- A below-threshold candidate returns `blocked_observability` from the gate (no
  candidates above threshold = "no competing hypotheses" → the top candidate is
  still selected, but since it is below threshold it is effectively uncontested
  yet still promoted... Actually: re-reading `runPromotionGate`: any single
  candidate IS promoted regardless of its absolute confidence, because the
  `competing` array only counts candidates OTHER than the top that are ≥ threshold.
  So a single below-threshold candidate (conf=0.3) still promotes with
  `winningConfidence=0.3`.

  **Correction for Slot A attribute block:** The ATTRIBUTE_PROMOTION_FLOOR is
  based on count of `d.status === 'promoted'` from gate decisions. A single
  below-threshold candidate DOES promote (gate returns 'promoted' with conf=0.3).
  Therefore to make 5 attributes FAIL to promote, we must use `candidate_value=null`
  (which triggers `normalization_status='failed'`) OR rely on blocked_observability
  from zero candidates. The `degraded_evidence.json` emits low-quality records
  with `candidate_value=null` + `conf=0.3` for the last 5 attributes of Slot A.
  A null value may or may not block depending on how the promoter handles null
  winning values.

  **Resolution (T8A clarification applied):** The null-value low-confidence records
  (conf=0.3) ALSO promote via the gate (single candidate below threshold, no
  competitors, still reaches Step 6 → `status='promoted'`). Therefore the 5 null
  attribute records were REMOVED ENTIRELY from `degraded_evidence.json` during T8A
  implementation. With 18 attribute evidence records present (not 23), `promotedAttrCount=18`
  which is < ATTRIBUTE_PROMOTION_FLOOR=20, so `writeAttributes=false` as intended.
  The same fix was applied to Slot B's `x_factor_name_2`: that record was removed
  entirely so `sd.fieldDecisions.get('x_factor_name_2')` returns `undefined`, causing
  `xfAllPromoted=false` and blocking the x_factor child block.

## Slot breakdown

| Slot key                    | Gamertag          | Scenario                                                                      | Expected snapshot              | Expected x_factors                  | Expected attributes        |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------- | ------------------------------ | ----------------------------------- | -------------------------- |
| `loadout_slot_seg0001_row0` | SlotA_Player      | Valid gamertag + position + 18 attr records (5 omitted)                       | PROMOTED                       | PROMOTED (3/3)                      | BLOCKED (18 < 20 floor)    |
| `loadout_slot_seg0001_row1` | SlotB_Player      | Valid gamertag + position + 2 x_factor_name records (x_factor_name_2 omitted) | PROMOTED                       | BLOCKED (name_2 absent → not all 3) | BLOCKED (no attr evidence) |
| `loadout_slot_seg0001_row2` | AWAY              | Junk gamertag (not in players table + not in opp_match_stats)                 | BLOCKED (unresolved_team_side) | —                                   | —                          |
| `loadout_slot_seg0001_row3` | GhostNeverHeardOf | Unresolvable gamertag (not in players or opp_match_stats)                     | BLOCKED (unresolved_team_side) | —                                   | —                          |

**Evidence record counts (post T8A fix):**

- Slot A: 30 records (6 identity + 6 x_factor + 18 attr)
- Slot B: 11 records (6 identity + 5 x_factor [name_2 omitted] + 0 attr)
- Slot C: 3 records (gamertag + position + is_captain)
- Slot D: 35 records (6 identity + 6 x_factor + 23 attr)
- Total: 79 records

## Sentinel IDs used

| Sentinel      | Value        | Purpose                                 |
| ------------- | ------------ | --------------------------------------- |
| `match_id`    | 9003         | Synthetic sentinel match                |
| `player_id`   | 99101, 99102 | SlotA_Player, SlotB_Player (resolvable) |
| `snapshot.id` | 90060, 90061 | Slot A and B promoted snapshots         |
| `x_factor.id` | 90160–90162  | Slot A x_factor rows                    |

## Key gate behaviors exercised

1. **Attribute floor** (Slot A): `ATTRIBUTE_PROMOTION_FLOOR = 20`. Only 18 attr
   field records exist in the evidence (5 were omitted entirely). Gate returns
   'promoted' for all 18 present fields. `promotedAttrCount = 18 < 20 →
writeAttributes = false`. No `player_loadout_attributes` rows written.

2. **X-Factor child block** (Slot B): `writeXFactors = xfDecisions.every(d => d?.status === 'promoted')`.
   `x_factor_name_2` has no evidence record → `sd.fieldDecisions.get('x_factor_name_2')` returns
   `undefined` → `undefined?.status` is `undefined` ≠ 'promoted' → `xfAllPromoted = false` →
   `writeXFactors = false`. No `player_loadout_x_factors` rows written.

3. **Junk gamertag block** (Slot C): "AWAY" is not in `players` table →
   `resolveGamertagToPlayer` returns `playerId=null` → `snapshotBlockReason='unresolved_team_side'` →
   snapshot NOT written; `ocr_promotions` row with `blocked_invariant` emitted.

4. **Unresolved team_side block** (Slot D): "GhostNeverHeardOf" is not in
   `players` or `club_memberships` → same unresolved_team_side path as Slot C →
   snapshot NOT written despite otherwise-valid field evidence.

## Fixture serves acceptance gates

- **T8A** (synthetic degraded matrix branches): run promoter against
  `degraded_evidence.json` for sentinel match 9003; assert the `degraded_canonical.sql`
  expected state matches the actual DB state after promotion.
