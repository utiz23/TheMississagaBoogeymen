# Fixture Provenance — fixture_match463_single_slot

## Source of truth

- **Canonical rows** (`expected_canonical.sql`): copied verbatim from production
  `player_loadout_snapshots` row id=1688 + `player_loadout_x_factors` +
  `player_loadout_attributes` for `match_id=463`, `gamertag_snapshot='HenryTheBobJr'`,
  `review_status='reviewed'` (git SHA 475b05b3295136333658dbe7fb1f6cef468db3cb,
  2026-05-21).

  HenryTheBobJr is the ONLY promoted slot for match 463. The other 9 expected
  slots (for/C, for/LW, for/RW, for/RD, against/C, against/LW, against/RW,
  against/LD, against/RD) have no coverage in the Phase 1 segment output for
  match 463, producing `blocked_observability` rows in `ocr_promotions`.

- **Observability blocks** (`expected_observability_blocks.sql`): 9 hand-authored
  `ocr_promotions` rows with `promotion_status='blocked_observability'` and
  `blocking_reason='not_observable_from_source'`. These mirror what
  `promoteLoadoutFromEvidence` emits in Step 8 (absent-expected-slots loop) for
  the 9 unobserved positions when the expected roster has 10 slots.

- **Expected roster seed** (`expected_canonical.sql`, section: player_match_stats):
  5 BGM + 5 opp `player_match_stats` / `opponent_player_match_stats` rows for
  sentinel `match_id=9002`. Position encoding: 2× `defenseMen` per side, 1×
  each C/LW/RW. `getExpectedSlotsForMatch(9002)` returns 10 slots; `for/LD` is
  covered by the one promoted snapshot.

- **Evidence JSON** (`expected_loadout_evidence.json`): 61 hand-authored records
  for the HenryTheBobJr slot (slot_key `loadout_slot_seg0001_row0`). Same
  confidence levels and authoring methodology as `fixture_match250_full_lobby`.

- **PNG frames** (`frames/`): TODO — operator must populate before running T2A
  (match 463 observability). Phase 1 segment directories for match 463 were
  not present on disk at fixture authoring time.

## Per-field provenance

| Field | Source | Notes |
|-------|--------|-------|
| `gamertag_snapshot` | Production DB row 1688 | 'HenryTheBobJr' |
| `position` | Production DB row 1688 | 'LD' |
| `player_number` | Production DB row 1688 | 7 |
| `is_captain` | Production DB row 1688 | false |
| `build_class_canonical` | Production DB row 1688 | 'Puck Moving Defenseman' |
| `x_factor_name_canonical[0,1,2]` | Production DB x_factor rows | Warrior/Wheels/Quick_Release |
| `x_factor_tier[0,1,2]` | Production DB x_factor rows | All Star/All Star/Specialist |
| `height_text` | Production DB row 1688 | '6\'0"' |
| `weight_lbs` | Production DB row 1688 | 160 |
| `player_level_number` | Production DB row 1688 | 38 |
| `player_name_persona` | Production DB row 1688 | 'H. JENKINS' |
| Attribute values (23 keys) | Production DB attribute rows for snapshot 1688 | All 23 present |

Cross-checked 2026-05-21: queried DB directly for match 463, confirmed match
with the V2 benchmark (HenryTheBobJr LD slot locked by lineup test).

## Sentinel IDs used

| Sentinel | Value | Purpose |
|----------|-------|---------|
| `match_id` | 9002 | Sentinel match (no collision with real data) |
| `player_id` | 99004 | HenryTheBobJr sentinel (reused from match250 fixture) |
| `snapshot.id` | 90050 | Single promoted snapshot |
| `x_factor.id` | 90150–90152 | 3 x_factor rows |
| `attribute.id` | 90500–90522 | 23 attribute rows |
| `ocr_promotion.id` | 91050–91058 | 9 observability block rows |

## Fixture serves acceptance gates

- **T2A** (match 463 observability): run promoter against this fixture's evidence;
  assert 1 promoted snapshot + 9 blocked_observability rows match
  `expected_canonical.sql` + `expected_observability_blocks.sql`.
