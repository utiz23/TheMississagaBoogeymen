-- Fixture: match 463 single promoted slot (HenryTheBobJr/LD/for)
-- Sentinel match_id: 9002
-- Sentinel snapshot ID: 90050
-- Sentinel player ID: 99004 (HenryTheBobJr, reused from fixture_match250)
-- Sentinel x_factor IDs: 90150-90152
-- Sentinel attribute IDs: 90500-90522 (23 rows)
--
-- PROVENANCE: canonical rows copied verbatim from production
-- player_loadout_snapshots row id=1688, player_loadout_x_factors rows 1688 set,
-- player_loadout_attributes rows for snapshot 1688 — all match_id=463,
-- review_status='reviewed' (git SHA 475b05b3295136333658dbe7fb1f6cef468db3cb,
-- 2026-05-21). HenryTheBobJr is the ONLY promoted slot for match 463;
-- the other 9 expected slots produce blocked_observability rows.

-- ─── Sentinel match row ────────────────────────────────────────────────────────
INSERT INTO game_titles (id, slug, label) VALUES (1, 'nhl26', 'NHL 26')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO matches (
  id, game_title_id, ea_match_id, match_id_ea, score_for, score_against,
  game_mode, bgm_was_home, opponent_name, played_at
) VALUES (
  9002, 1, 'fixture-match-9002', 'fixture-match-9002', 0, 0,
  '6s', false, 'Opponent (fixture 463)', NOW()
) ON CONFLICT (id) DO NOTHING;

-- ─── Sentinel player ───────────────────────────────────────────────────────────
INSERT INTO players (id, gamertag, ea_id) VALUES
  (99004, 'HenryTheBobJr', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO club_memberships (player_id, game_title_id) VALUES
  (99004, 1)
ON CONFLICT (player_id, game_title_id) DO NOTHING;

-- ─── expected_roster_seed: player_match_stats + opponent_player_match_stats ────
-- Seeds 10 expected slots so getExpectedSlotsForMatch(9002) returns 10 entries.
-- BGM side: 5 skaters (center, defenseMen×2, leftWing, rightWing)
-- Opp side: 5 skaters (same positions)
-- HenryTheBobJr is defenseMen slot id=990041 → maps to LD (first defenseMen by id ASC).

INSERT INTO player_match_stats (
  id, match_id, player_id, position, goals, assists, shots, hits,
  plus_minus, penalty_minutes, is_goalie, client_platform
) VALUES
  (990041, 9002, 99004, 'defenseMen', 0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990042, 9002, 99004, 'defenseMen', 0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990043, 9002, 99004, 'center',     0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990044, 9002, 99004, 'leftWing',   0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990045, 9002, 99004, 'rightWing',  0, 0, 0, 0, 0, 0, false, 'xbsx')
ON CONFLICT (id) DO NOTHING;

INSERT INTO opponent_player_match_stats (
  id, match_id, gamertag, position, goals, assists, shots, hits,
  plus_minus, penalty_minutes, is_goalie, client_platform
) VALUES
  (990046, 9002, 'opp_c',   'center',     0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990047, 9002, 'opp_lw',  'leftWing',   0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990048, 9002, 'opp_rw',  'rightWing',  0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990049, 9002, 'opp_ld',  'defenseMen', 0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990050, 9002, 'opp_rd',  'defenseMen', 0, 0, 0, 0, 0, 0, false, 'xbsx')
ON CONFLICT (id) DO NOTHING;

-- ─── player_loadout_snapshots (1 promoted row) ────────────────────────────────
-- Canonical values from production row id=1688 (match 463, reviewed).
-- player_number=7, is_captain=false, build_class_canonical='Puck Moving Defenseman'
-- height_text='6'0"', weight_lbs=160, player_level_number=38.

INSERT INTO player_loadout_snapshots (
  id, match_id, player_id, team_side, position, gamertag_snapshot,
  player_name_persona, player_name_persona_raw,
  player_number, is_captain, build_class, build_class_canonical,
  height_text, weight_lbs, player_level_number, player_level_raw,
  handedness, platform, game_title_id, ocr_extraction_id, review_status
) VALUES (
  90050, 9002, 99004, 'for', 'LD', 'HenryTheBobJr',
  'H. JENKINS', 'H. JENKINS',
  7, false, 'Puck Moving Defenseman', 'Puck Moving Defenseman',
  '6''0"', 160, 38, 'P2LVL38',
  NULL, NULL, 1, 99999, 'reviewed'
) ON CONFLICT (id) DO NOTHING;

-- ─── player_loadout_x_factors (3 rows for snapshot 90050) ────────────────────
-- Canonical: Warrior (All Star), Wheels (All Star), Quick_Release (Specialist)
-- Source: production DB rows for match 463, HenryTheBobJr slot.

INSERT INTO player_loadout_x_factors (
  id, loadout_snapshot_id, slot_index, x_factor_name, x_factor_name_canonical, tier
) VALUES
  (90150, 90050, 0, 'WARRIOR',      'Warrior',      'All Star'),
  (90151, 90050, 1, 'WHEELS',       'Wheels',       'All Star'),
  (90152, 90050, 2, 'QUICK RELEASE','Quick_Release','Specialist')
ON CONFLICT (id) DO NOTHING;

-- ─── player_loadout_attributes (23 rows for snapshot 90050) ──────────────────
-- Canonical attribute values from production row id=1688 (match 463).
-- All 23 attributes populated; delta_value sourced from production DB.

INSERT INTO player_loadout_attributes (
  id, loadout_snapshot_id, attribute_key, value, delta_value
) VALUES
  (90500, 90050, 'wrist_shot_accuracy',  88,   4),
  (90501, 90050, 'slap_shot_accuracy',   78,  -6),
  (90502, 90050, 'speed',                96,   9),
  (90503, 90050, 'balance',              86,   1),
  (90504, 90050, 'agility',              89,   2),
  (90505, 90050, 'wrist_shot_power',     88,   6),
  (90506, 90050, 'slap_shot_power',      76, NULL),
  (90507, 90050, 'acceleration',         96,   9),
  (90508, 90050, 'puck_control',         90, NULL),
  (90509, 90050, 'endurance',            91,   3),
  (90510, 90050, 'passing',              91,  -1),
  (90511, 90050, 'offensive_awareness',  83,  -5),
  (90512, 90050, 'body_checking',        84,   3),
  (90513, 90050, 'stick_checking',       89,   5),
  (90514, 90050, 'defensive_awareness',  90,   5),
  (90515, 90050, 'hand_eye',             92,   7),
  (90516, 90050, 'strength',             85,   4),
  (90517, 90050, 'durability',           80,  -1),
  (90518, 90050, 'shot_blocking',        74,  -6),
  (90519, 90050, 'deking',               92,   7),
  (90520, 90050, 'faceoffs',             76,  -4),
  (90521, 90050, 'discipline',           92,   7),
  (90522, 90050, 'fighting_skill',       80, NULL)
ON CONFLICT (id) DO NOTHING;
