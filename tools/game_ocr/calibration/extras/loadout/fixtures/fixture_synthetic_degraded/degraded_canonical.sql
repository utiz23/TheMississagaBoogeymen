-- Fixture: synthetic degraded scenarios
-- Sentinel match_id: 9003
-- Tests 4 degraded branches in the loadout promoter field-matrix logic.
--
-- PROVENANCE: 100% hand-authored. No production DB rows are referenced.
-- Values are chosen to exercise specific gate branches in promotion-gate.ts
-- and promoteLoadoutFromEvidence (loadout-v2.ts).
--
-- ─── Match row ────────────────────────────────────────────────────────────────

INSERT INTO game_titles (id, slug, label) VALUES (1, 'nhl26', 'NHL 26')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO matches (
  id, game_title_id, ea_match_id, match_id_ea, score_for, score_against,
  game_mode, bgm_was_home, opponent_name, played_at
) VALUES (
  9003, 1, 'fixture-match-9003', 'fixture-match-9003', 0, 0,
  '6s', false, 'Degraded (fixture)', NOW()
) ON CONFLICT (id) DO NOTHING;

-- ─── Sentinel players ─────────────────────────────────────────────────────────
-- SlotA_Player and SlotB_Player are resolvable (in club_memberships) so team_side binds.
-- GhostNeverHeardOf is intentionally NOT in club_memberships → team_side unresolved.

INSERT INTO players (id, gamertag, ea_id) VALUES
  (99101, 'SlotA_Player', NULL),
  (99102, 'SlotB_Player', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO club_memberships (player_id, game_title_id) VALUES
  (99101, 1),
  (99102, 1)
ON CONFLICT (player_id, game_title_id) DO NOTHING;

-- NOTE: 'GhostNeverHeardOf' has NO players row and NO club_memberships row.
-- 'AWAY' has NO players row and NO club_memberships row.
-- This is intentional — these gamertags should not resolve.

-- ─── Expected roster seed ─────────────────────────────────────────────────────
-- 4 BGM skaters only (no opp for this sentinel — we test slot-level logic, not
-- roster completeness).

INSERT INTO player_match_stats (
  id, match_id, player_id, position, goals, assists, shots, hits,
  plus_minus, penalty_minutes, is_goalie, client_platform
) VALUES
  (990101, 9003, 99101, 'center',     0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990102, 9003, 99102, 'leftWing',   0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990103, 9003, 99101, 'rightWing',  0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990104, 9003, 99101, 'defenseMen', 0, 0, 0, 0, 0, 0, false, 'xbsx')
ON CONFLICT (id) DO NOTHING;

-- ─── Expected canonical snapshots ────────────────────────────────────────────
-- Only Slot A and Slot B promote a snapshot row.
-- Slot C (junk gamertag "AWAY") → NO row.
-- Slot D (unresolved gamertag "GhostNeverHeardOf") → NO row.

-- Slot A: snapshot promoted; x_factors promoted; attributes NOT promoted (18/23 < floor 20)
INSERT INTO player_loadout_snapshots (
  id, match_id, player_id, team_side, position, gamertag_snapshot,
  player_name_persona, player_name_persona_raw,
  player_number, is_captain, build_class, build_class_canonical,
  height_text, weight_lbs, player_level_number, player_level_raw,
  handedness, platform, game_title_id, ocr_extraction_id, review_status
) VALUES (
  90060, 9003, 99101, 'for', 'C', 'SlotA_Player',
  'A. PLAYER', 'A. PLAYER',
  11, false, 'Playmaker', 'Playmaker',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 1, 99999, 'reviewed'
) ON CONFLICT (id) DO NOTHING;

-- Slot A x_factors (all 3 promoted — evidence provided all 3 with conf=0.9)
INSERT INTO player_loadout_x_factors (
  id, loadout_snapshot_id, slot_index, x_factor_name, x_factor_name_canonical, tier
) VALUES
  (90160, 90060, 0, 'WHEELS',     'Wheels',       'All Star'),
  (90161, 90060, 1, 'ONET',       'One_T',        'All Star'),
  (90162, 90060, 2, 'TAPE TOTAPE','Tape_to_Tape', 'Specialist')
ON CONFLICT (id) DO NOTHING;
-- NOTE: NO player_loadout_attributes rows for snapshot 90060.
-- Attribute child block is BLOCKED: only 18 attribute field records exist in
-- degraded_evidence.json (5 were removed entirely so their field_key has no
-- evidence row). promotedAttrCount=18 < ATTRIBUTE_PROMOTION_FLOOR=20 → writeAttributes=false.
-- No player_loadout_attributes rows written; blocked_observability rows emitted in
-- ocr_promotions for the 18 promoted attrs (since writeAttributes=false triggers the
-- block-recording path for each non-promoted attr; the 5 absent fields never appear).

-- Slot B: snapshot promoted; x_factors NOT promoted (only 2/3 above threshold);
--         no attributes provided.
INSERT INTO player_loadout_snapshots (
  id, match_id, player_id, team_side, position, gamertag_snapshot,
  player_name_persona, player_name_persona_raw,
  player_number, is_captain, build_class, build_class_canonical,
  height_text, weight_lbs, player_level_number, player_level_raw,
  handedness, platform, game_title_id, ocr_extraction_id, review_status
) VALUES (
  90061, 9003, 99102, 'for', 'LW', 'SlotB_Player',
  'B. PLAYER', 'B. PLAYER',
  99, false, 'Sniper', 'Sniper',
  NULL, NULL, NULL, NULL,
  NULL, NULL, 1, 99999, 'reviewed'
) ON CONFLICT (id) DO NOTHING;
-- NOTE: NO player_loadout_x_factors rows for snapshot 90061.
-- X-Factor child block BLOCKED: x_factor_name_2 has no evidence record in
-- degraded_evidence.json (the low_quality record was removed entirely). The promoter
-- calls sd.fieldDecisions.get('x_factor_name_2') which returns undefined.
-- xfAllPromoted = xfDecisions.every(d => d?.status === 'promoted') = false → writeXFactors=false.
-- NOTE: NO player_loadout_attributes rows for snapshot 90061 (no attr evidence provided).

-- Slot C (junk gamertag "AWAY"): NO snapshot row.
-- resolveGamertagToPlayer("AWAY") → playerId=null → snapshotBlockReason='unresolved_team_side'
-- Expected: 0 player_loadout_snapshots rows for gamertag='AWAY' in match 9003.

-- Slot D (unresolved gamertag "GhostNeverHeardOf"): NO snapshot row.
-- resolveGamertagToPlayer("GhostNeverHeardOf") → playerId=null (not in club_memberships)
-- → snapshotBlockReason='unresolved_team_side'
-- Expected: 0 player_loadout_snapshots rows for gamertag='GhostNeverHeardOf' in match 9003.
