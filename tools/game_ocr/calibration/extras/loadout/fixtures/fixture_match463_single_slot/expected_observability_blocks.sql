-- Fixture: match 463 expected observability blocks
-- Sentinel match_id: 9002
--
-- When promoteLoadoutFromEvidence(9002) runs with only one slot of evidence
-- (HenryTheBobJr / for / LD), the promoter compares the promoted slots against
-- getExpectedSlotsForMatch(9002). The expected roster has 10 slots (5 BGM + 5
-- opp); only 1 is covered (for/LD). The remaining 9 slots get
-- blocked_observability rows in ocr_promotions.
--
-- Expected ocr_promotions rows (status=blocked_observability):
--   for/C     — no evidence observed
--   for/LW    — no evidence observed
--   for/RW    — no evidence observed
--   for/RD    — no evidence observed  (LD is covered; RD is absent)
--   against/C  — no evidence observed
--   against/LW — no evidence observed
--   against/RW — no evidence observed
--   against/LD — no evidence observed
--   against/RD — no evidence observed
--
-- Sentinel IDs: 91050-91058 (9 rows).
-- These rows mirror the exact shape that promoteLoadoutFromEvidence writes to
-- ocr_promotions via the absent-expected-slots loop (Step 8, loadout-v2.ts).

INSERT INTO ocr_promotions (
  id, match_id, target_table, target_semantic_key, field_key,
  winning_value, winning_confidence,
  evidence_count, conflict_count, evidence_ids,
  promotion_status, blocking_reason, authority_source
) VALUES
  (91050, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"for","position":"C"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91051, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"for","position":"LW"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91052, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"for","position":"RW"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91053, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"for","position":"RD"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91054, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"against","position":"C"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91055, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"against","position":"LW"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91056, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"against","position":"RW"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91057, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"against","position":"LD"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL),
  (91058, 9002, 'player_loadout_snapshots',
   '{"match_id":9002,"team_side":"against","position":"RD"}',
   NULL, NULL, NULL, 0, 0, NULL,
   'blocked_observability', 'not_observable_from_source', NULL)
ON CONFLICT (id) DO NOTHING;
