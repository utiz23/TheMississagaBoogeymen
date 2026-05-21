-- Fixture: match 250 full lobby canonical rows
-- Sentinel match_id: 9001
-- Sentinel snapshot IDs: 90001-90010
-- Sentinel player IDs:  99001-99005 (BGM), 99006-99010 (opp)
-- Sentinel x_factor IDs: 90100-90129 (30 rows, 3 per snapshot)
-- Sentinel attribute IDs: 90200-90429 (230 rows, 23 per snapshot)
--
-- PROVENANCE: canonical rows copied verbatim from production
-- player_loadout_snapshots, player_loadout_x_factors, player_loadout_attributes
-- for match_id=250 with review_status='reviewed' (snapshot git SHA
-- 475b05b3295136333658dbe7fb1f6cef468db3cb, 2026-05-21).
-- V2-benchmark assertions in apps/worker/src/__tests__/match-250-benchmark.test.ts
-- lock gamertag, position, captain, build_class_canonical, x_factor canonicals,
-- height_text, weight_lbs, player_level_number, and persona fields for all 10 slots.
--
-- NOTE: player_id is NULL throughout; resolveGamertagToPlayer looks up via
-- gamertag in the test DB context (seeded via expected_roster_seed.sql).
-- ocr_extraction_id is replaced with sentinel 99999 (FK not enforced in test DB).

-- ─── Sentinel match row (prerequisite) ────────────────────────────────────────
-- game_titles row with id=1 (NHL 26) must exist; matches sentinel row below.
-- Insert is SKIP-if-exists to be idempotent.
INSERT INTO game_titles (id, slug, label) VALUES (1, 'nhl26', 'NHL 26')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO matches (
  id, game_title_id, ea_match_id, match_id_ea, score_for, score_against,
  game_mode, bgm_was_home, opponent_name, played_at
) VALUES (
  9001, 1, 'fixture-match-9001', 'fixture-match-9001', 4, 3,
  '6s', false, '4th Line (fixture)', NOW()
) ON CONFLICT (id) DO NOTHING;

-- ─── Sentinel players (BGM) ────────────────────────────────────────────────────
INSERT INTO players (id, gamertag, ea_id) VALUES
  (99001, 'MrHomiecide',   NULL),
  (99002, 'Stick Menace',  NULL),
  (99003, 'silkyjoker85',  NULL),
  (99004, 'HenryTheBobJr', NULL),
  (99005, 'JoeyFlopfish',  NULL)
ON CONFLICT (id) DO NOTHING;

-- ─── Sentinel club_memberships (BGM, game_title_id=1) ─────────────────────────
-- Required so resolveGamertagToPlayer can bind BGM gamertags to team_side='for'.
INSERT INTO club_memberships (player_id, game_title_id) VALUES
  (99001, 1), (99002, 1), (99003, 1), (99004, 1), (99005, 1)
ON CONFLICT (player_id, game_title_id) DO NOTHING;

-- ─── Sentinel player_match_stats (for getExpectedSlotsForMatch(9001)) ──────────
-- BGM side — 5 rows: C, LW, RW, defenseMen×2
INSERT INTO player_match_stats (
  id, match_id, player_id, position, goals, assists, shots, hits,
  plus_minus, penalty_minutes, is_goalie, client_platform
) VALUES
  (990001, 9001, 99001, 'center',     1, 2, 0, 0, 0, 0, false, 'xbsx'),
  (990002, 9001, 99002, 'leftWing',   1, 1, 0, 0, 0, 0, false, 'xbsx'),
  (990003, 9001, 99003, 'rightWing',  2, 1, 0, 0, 0, 0, false, 'xbsx'),
  (990004, 9001, 99004, 'defenseMen', 0, 2, 0, 0, 0, 0, false, 'xbsx'),
  (990005, 9001, 99005, 'defenseMen', 0, 0, 0, 0, 0, 0, false, 'xbsx')
ON CONFLICT (id) DO NOTHING;

-- Opponent side — 5 rows: C, LW, RW, defenseMen×2
INSERT INTO opponent_player_match_stats (
  id, match_id, gamertag, position, goals, assists, shots, hits,
  plus_minus, penalty_minutes, is_goalie, client_platform
) VALUES
  (990006, 9001, 'XZ4RKY',         'center',     2, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990007, 9001, 'DuhPope',         'leftWing',   0, 2, 0, 0, 0, 0, false, 'xbsx'),
  (990008, 9001, 'RAIDERSG7',       'rightWing',  0, 2, 0, 0, 0, 0, false, 'xbsx'),
  (990009, 9001, 'MuttButt',        'defenseMen', 0, 0, 0, 0, 0, 0, false, 'xbsx'),
  (990010, 9001, 'shadowassault20', 'defenseMen', 1, 1, 0, 0, 0, 0, false, 'xbsx')
ON CONFLICT (id) DO NOTHING;

-- ─── player_loadout_snapshots ─────────────────────────────────────────────────
-- 10 rows: 5 BGM (for) + 5 opponent (against).
-- Positions ordered to match DB canonical: for=[C, LW, RW, LD, RD]  against=[C, LW, RW, LD, RD]
-- player_number, is_captain, height_text, weight_lbs, player_level_number are
-- locked by V2 benchmark assertions (Family 7 + lineup tests).

INSERT INTO player_loadout_snapshots (
  id, match_id, player_id, team_side, position, gamertag_snapshot,
  player_name_persona, player_name_persona_raw,
  player_number, is_captain, build_class, build_class_canonical,
  height_text, weight_lbs, player_level_number, player_level_raw,
  handedness, platform, game_title_id, ocr_extraction_id, review_status
) VALUES
  -- BGM C: MrHomiecide
  (90001, 9001, 99001, 'for', 'C', 'MrHomiecide',
   'E. WANHG', 'E. WANHG',
   11, true, 'Playmaker', 'Playmaker',
   '6''0"', 160, 17, 'P1LVL17',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- BGM LW: Stick Menace
  (90002, 9001, 99002, 'for', 'LW', 'Stick Menace',
   'M. RANTANEN', 'M. RANTANEN',
   96, false, 'Tage Thompson-PWF', 'Tage Thompson - Power Forward',
   '6''6"', 220, 34, 'P2LVL34',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- BGM RW: silkyjoker85
  (90003, 9001, 99003, 'for', 'RW', 'silkyjoker85',
   'SILKY', 'SILKY',
   10, false, 'Cole Caufield-SNP', 'Cole Caufield - Sniper',
   '5''8"', 175, 41, 'P2LVL41',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- BGM LD: HenryTheBobJr
  (90004, 9001, 99004, 'for', 'LD', 'HenryTheBobJr',
   'H. JENKINS', 'H. JENKINS',
   7, false, 'Puck Moving Defenseman', 'Puck Moving Defenseman',
   '6''0"', 160, 35, 'P2LVL35',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- BGM RD: JoeyFlopfish
  (90005, 9001, 99005, 'for', 'RD', 'JoeyFlopfish',
   'L. HUTSON', 'L. HUTSON',
   48, false, 'Puck Moving Defenseman', 'Puck Moving Defenseman',
   '5''10"', 160, 24, 'P2LVL24',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- Opponent C: XZ4RKY (captain; V2 benchmark: XZ4RKY is captain, is_captain=true)
  (90006, 9001, NULL, 'against', 'C', 'XZ4RKY',
   'TOEWS', 'TOEWS',
   19, true, 'Two-WayForward', 'Two-Way Forward',
   '5''10"', 176, 34, 'P5LVL34',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- Opponent LW: DuhPope (NOT captain per V2; is_captain=false)
  (90007, 9001, NULL, 'against', 'LW', 'DuhPope',
   'WHOOSAH', 'WHOOSAH',
   95, false, 'Sniper', 'Sniper',
   '5''9"', 160, 47, 'P4LVL47',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- Opponent RW: RAIDERSG7
  (90008, 9001, NULL, 'against', 'RW', 'RAIDERSG7',
   'WILDE', 'WILDE',
   7, false, 'Sniper', 'Sniper',
   '5''9"', 160, 14, 'P4LVL14',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- Opponent LD: MuttButt
  (90009, 9001, NULL, 'against', 'LD', 'MuttButt',
   'P. MAGROYNE', 'P. MAGROYNE',
   23, false, 'Defensive Defenseman', 'Defensive Defenseman',
   '6''0"', 195, 3, 'P5LVL3',
   NULL, NULL, 1, 99999, 'reviewed'),
  -- Opponent RD: shadowassault20
  (90010, 9001, NULL, 'against', 'RD', 'shadowassault20',
   'S. ZUBOV', 'S. ZUBOV',
   56, false, 'Puck Moving Defenseman', 'Puck Moving Defenseman',
   '5''8"', 160, 42, 'P5LVL42',
   NULL, NULL, 1, 99999, 'reviewed')
ON CONFLICT (id) DO NOTHING;

-- ─── player_loadout_x_factors ─────────────────────────────────────────────────
-- 30 rows: 3 per snapshot × 10 snapshots.
-- canonical names locked by V2 benchmark (lineup test xFactorsCanonical assertions).
-- Tiers from the reviewed DB rows (not V2-asserted but DB-sourced).

INSERT INTO player_loadout_x_factors (
  id, loadout_snapshot_id, slot_index, x_factor_name, x_factor_name_canonical, tier
) VALUES
  -- BGM C: MrHomiecide — Wheels, One_T, Tape_to_Tape
  (90100, 90001, 0, 'WHEELS',     'Wheels',      'All Star'),
  (90101, 90001, 1, 'ONET',       'One_T',       'All Star'),
  (90102, 90001, 2, 'TAPE TOTAPE','Tape_to_Tape','Specialist'),
  -- BGM LW: Stick Menace — Big_Rig, One_T, Ankle_Breaker
  (90103, 90002, 0, 'BIG RIG',     'Big_Rig',      'Elite'),
  (90104, 90002, 1, 'ONET',        'One_T',        'Elite'),
  (90105, 90002, 2, 'ANKLE BREAKER','Ankle_Breaker','Elite'),
  -- BGM RW: silkyjoker85 — Quick_Release, One_T, PressurePlus
  (90106, 90003, 0, 'QUICK RELEASE','Quick_Release','Elite'),
  (90107, 90003, 1, 'ONET',         'One_T',        'All Star'),
  (90108, 90003, 2, 'PRESSURE+',    'PressurePlus', 'All Star'),
  -- BGM LD: HenryTheBobJr — Warrior, Wheels, Quick_Release
  (90109, 90004, 0, 'WARRIOR',      'Warrior',      'All Star'),
  (90110, 90004, 1, 'WHEELS',       'Wheels',       'All Star'),
  (90111, 90004, 2, 'QUICK RELEASE','Quick_Release','Specialist'),
  -- BGM RD: JoeyFlopfish — Elite_Edges, Tape_to_Tape, Stick_Em_Up
  (90112, 90005, 0, 'ELITEEDGES',  'Elite_Edges',  'Elite'),
  (90113, 90005, 1, 'TAPE TO TAPE','Tape_to_Tape', 'Specialist'),
  (90114, 90005, 2, 'STICK''EM UP','Stick_Em_Up',  'Specialist'),
  -- Opp C: XZ4RKY — Warrior, Big_Rig, Rocket
  (90115, 90006, 0, 'WARRIOR', 'Warrior', 'Elite'),
  (90116, 90006, 1, 'BIG RIG', 'Big_Rig', 'All Star'),
  (90117, 90006, 2, 'ROCKET',  'Rocket',  'All Star'),
  -- Opp LW: DuhPope — Quick_Release, Elite_Edges, Warrior
  (90118, 90007, 0, 'QUICK RELEASE','Quick_Release','All Star'),
  (90119, 90007, 1, 'ELITE EDGES', 'Elite_Edges',  'Specialist'),
  (90120, 90007, 2, 'WARRIOR',     'Warrior',      'All Star'),
  -- Opp RW: RAIDERSG7 — Quick_Release, One_T, Tape_to_Tape
  (90121, 90008, 0, 'QUICK RELEASE','Quick_Release','All Star'),
  (90122, 90008, 1, 'ONET',        'One_T',        'All Star'),
  (90123, 90008, 2, 'TAPETOTAPE',  'Tape_to_Tape', 'Specialist'),
  -- Opp LD: MuttButt — Quickpick, Elite_Edges, Rocket
  (90124, 90009, 0, 'QUICK PICK',  'Quickpick',   'All Star'),
  (90125, 90009, 1, 'ELITEEDGES',  'Elite_Edges', 'Specialist'),
  (90126, 90009, 2, 'ROCKET',      'Rocket',      'All Star'),
  -- Opp RD: shadowassault20 — Wheels, Warrior, Big_Rig
  (90127, 90010, 0, 'WHEELS',  'Wheels',  'Specialist'),
  (90128, 90010, 1, 'WARRIOR', 'Warrior', 'Elite'),
  (90129, 90010, 2, 'BIG RIG', 'Big_Rig', 'Elite')
ON CONFLICT (id) DO NOTHING;

-- ─── player_loadout_attributes ────────────────────────────────────────────────
-- 230 rows: 23 attributes per snapshot × 10 snapshots.
-- Values from production DB canonical rows (reviewed; copied verbatim 2026-05-21).
-- NULL delta_value means the OCR pipeline did not capture a delta for that attribute.

INSERT INTO player_loadout_attributes (
  id, loadout_snapshot_id, attribute_key, value, delta_value
) VALUES
  -- ── BGM C: MrHomiecide (snapshot 90001) ──────────────────────────────────
  (90200, 90001, 'wrist_shot_accuracy',  80,  -4),
  (90201, 90001, 'slap_shot_accuracy',   80,  -4),
  (90202, 90001, 'speed',                95,   8),
  (90203, 90001, 'balance',              82,  -3),
  (90204, 90001, 'agility',              95,   8),
  (90205, 90001, 'wrist_shot_power',     79,  -3),
  (90206, 90001, 'slap_shot_power',      81,  -1),
  (90207, 90001, 'acceleration',         96,   9),
  (90208, 90001, 'puck_control',         89,  -3),
  (90209, 90001, 'endurance',            94,   6),
  (90210, 90001, 'passing',              90,  -2),
  (90211, 90001, 'offensive_awareness',  90, NULL),
  (90212, 90001, 'body_checking',        72,  -9),
  (90213, 90001, 'stick_checking',       85,   5),
  (90214, 90001, 'defensive_awareness',  88,   8),
  (90215, 90001, 'hand_eye',             92,   4),
  (90216, 90001, 'strength',             83,   2),
  (90217, 90001, 'durability',           76,  -5),
  (90218, 90001, 'shot_blocking',        75,  -3),
  (90219, 90001, 'deking',               94,   9),
  (90220, 90001, 'faceoffs',             90,   5),
  (90221, 90001, 'discipline',           80,  -5),
  (90222, 90001, 'fighting_skill',       68, -12),
  -- ── BGM LW: Stick Menace (snapshot 90002) ───────────────────────────────
  (90223, 90002, 'wrist_shot_accuracy',  92, NULL),
  (90224, 90002, 'slap_shot_accuracy',   90, NULL),
  (90225, 90002, 'speed',                93, NULL),
  (90226, 90002, 'balance',              90, NULL),
  (90227, 90002, 'agility',              94, NULL),
  (90228, 90002, 'wrist_shot_power',     93, NULL),
  (90229, 90002, 'slap_shot_power',      95, NULL),
  (90230, 90002, 'acceleration',         93, NULL),
  (90231, 90002, 'puck_control',         93, NULL),
  (90232, 90002, 'endurance',            90, NULL),
  (90233, 90002, 'passing',              90, NULL),
  (90234, 90002, 'offensive_awareness',  91, NULL),
  (90235, 90002, 'body_checking',        82, NULL),
  (90236, 90002, 'stick_checking',       80, NULL),
  (90237, 90002, 'defensive_awareness',  84, NULL),
  (90238, 90002, 'hand_eye',             93, NULL),
  (90239, 90002, 'strength',             91, NULL),
  (90240, 90002, 'durability',           87, NULL),
  (90241, 90002, 'shot_blocking',        80, NULL),
  (90242, 90002, 'deking',               93, NULL),
  (90243, 90002, 'faceoffs',             90, NULL),
  (90244, 90002, 'discipline',           82, NULL),
  (90245, 90002, 'fighting_skill',       75, NULL),
  -- ── BGM RW: silkyjoker85 (snapshot 90003) ───────────────────────────────
  (90246, 90003, 'wrist_shot_accuracy',  95, NULL),
  (90247, 90003, 'slap_shot_accuracy',   94, NULL),
  (90248, 90003, 'speed',                94, NULL),
  (90249, 90003, 'balance',              82, NULL),
  (90250, 90003, 'agility',              94, NULL),
  (90251, 90003, 'wrist_shot_power',     93, NULL),
  (90252, 90003, 'slap_shot_power',      93, NULL),
  (90253, 90003, 'acceleration',         93, NULL),
  (90254, 90003, 'puck_control',         89, NULL),
  (90255, 90003, 'endurance',            90, NULL),
  (90256, 90003, 'passing',              89, NULL),
  (90257, 90003, 'offensive_awareness',  93, NULL),
  (90258, 90003, 'body_checking',        83, NULL),
  (90259, 90003, 'stick_checking',       82, NULL),
  (90260, 90003, 'defensive_awareness',  84, NULL),
  (90261, 90003, 'hand_eye',             93, NULL),
  (90262, 90003, 'strength',             80, NULL),
  (90263, 90003, 'durability',           88, NULL),
  (90264, 90003, 'shot_blocking',        79, NULL),
  (90265, 90003, 'deking',               89, NULL),
  (90266, 90003, 'faceoffs',             90, NULL),
  (90267, 90003, 'discipline',           86, NULL),
  (90268, 90003, 'fighting_skill',       60, NULL),
  -- ── BGM LD: HenryTheBobJr (snapshot 90004) ──────────────────────────────
  (90269, 90004, 'wrist_shot_accuracy',  87,   3),
  (90270, 90004, 'slap_shot_accuracy',   77,  -7),
  (90271, 90004, 'speed',                96,   9),
  (90272, 90004, 'balance',              86,   1),
  (90273, 90004, 'agility',              89,   2),
  (90274, 90004, 'wrist_shot_power',     87,   5),
  (90275, 90004, 'slap_shot_power',      75,  -7),
  (90276, 90004, 'acceleration',         96,   9),
  (90277, 90004, 'puck_control',         90, NULL),
  (90278, 90004, 'endurance',            91,   3),
  (90279, 90004, 'passing',              88,  -4),
  (90280, 90004, 'offensive_awareness',  86,  -2),
  (90281, 90004, 'body_checking',        84,   3),
  (90282, 90004, 'stick_checking',       88,   4),
  (90283, 90004, 'defensive_awareness',  90,   5),
  (90284, 90004, 'hand_eye',             92,   7),
  (90285, 90004, 'strength',             85,   4),
  (90286, 90004, 'durability',           79,  -2),
  (90287, 90004, 'shot_blocking',        72,  -8),
  (90288, 90004, 'deking',               92,   7),
  (90289, 90004, 'faceoffs',             75,  -5),
  (90290, 90004, 'discipline',           92,   7),
  (90291, 90004, 'fighting_skill',       78,  -2),
  -- ── BGM RD: JoeyFlopfish (snapshot 90005) ───────────────────────────────
  (90292, 90005, 'wrist_shot_accuracy',  82,  -2),
  (90293, 90005, 'slap_shot_accuracy',   79,  -5),
  (90294, 90005, 'speed',                97,  10),
  (90295, 90005, 'balance',              82,  -3),
  (90296, 90005, 'agility',              96,   9),
  (90297, 90005, 'wrist_shot_power',     81,  -1),
  (90298, 90005, 'slap_shot_power',      83,   1),
  (90299, 90005, 'acceleration',         95,   8),
  (90300, 90005, 'puck_control',         92,   2),
  (90301, 90005, 'endurance',            93,   5),
  (90302, 90005, 'passing',              97,   5),
  (90303, 90005, 'offensive_awareness',  95,   7),
  (90304, 90005, 'body_checking',        75,  -6),
  (90305, 90005, 'stick_checking',       85,   1),
  (90306, 90005, 'defensive_awareness',  88,   3),
  (90307, 90005, 'hand_eye',             88,   3),
  (90308, 90005, 'strength',             85,   4),
  (90309, 90005, 'durability',           83,   2),
  (90310, 90005, 'shot_blocking',        73,  -7),
  (90311, 90005, 'deking',               92,   7),
  (90312, 90005, 'faceoffs',             75,  -5),
  (90313, 90005, 'discipline',           92,   7),
  (90314, 90005, 'fighting_skill',       77,  -3),
  -- ── Opp C: XZ4RKY (snapshot 90006) ─────────────────────────────────────
  (90315, 90006, 'wrist_shot_accuracy',  80,  -5),
  (90316, 90006, 'slap_shot_accuracy',   80, NULL),
  (90317, 90006, 'speed',                97,  11),
  (90318, 90006, 'balance',              83,  -3),
  (90319, 90006, 'agility',              96,  10),
  (90320, 90006, 'wrist_shot_power',     75,  -8),
  (90321, 90006, 'slap_shot_power',      90,   7),
  (90322, 90006, 'acceleration',         96,  10),
  (90323, 90006, 'puck_control',         83,  -3),
  (90324, 90006, 'endurance',            96,   9),
  (90325, 90006, 'passing',              91,   4),
  (90326, 90006, 'offensive_awareness',  91,   5),
  (90327, 90006, 'body_checking',        88,   6),
  (90328, 90006, 'stick_checking',       79, NULL),
  (90329, 90006, 'defensive_awareness',  91,   3),
  (90330, 90006, 'hand_eye',             90,   5),
  (90331, 90006, 'strength',             90,   8),
  (90332, 90006, 'durability',           75,  -7),
  (90333, 90006, 'shot_blocking',        83,  -2),
  (90334, 90006, 'deking',               88,   8),
  (90335, 90006, 'faceoffs',             90,   5),
  (90336, 90006, 'discipline',           91,   5),
  (90337, 90006, 'fighting_skill',       70, NULL),
  -- ── Opp LW: DuhPope (snapshot 90007) ────────────────────────────────────
  (90338, 90007, 'wrist_shot_accuracy',  85,  -5),
  (90339, 90007, 'slap_shot_accuracy',   84,  -6),
  (90340, 90007, 'speed',                97,  10),
  (90341, 90007, 'balance',              87,   2),
  (90342, 90007, 'agility',              97,  10),
  (90343, 90007, 'wrist_shot_power',     85,  -5),
  (90344, 90007, 'slap_shot_power',      84,  -6),
  (90345, 90007, 'acceleration',         97,  10),
  (90346, 90007, 'puck_control',         94,   7),
  (90347, 90007, 'endurance',            95,   7),
  (90348, 90007, 'passing',              90,   8),
  (90349, 90007, 'offensive_awareness',  97,   7),
  (90350, 90007, 'body_checking',        76,  -5),
  (90351, 90007, 'stick_checking',       70,  -5),
  (90352, 90007, 'defensive_awareness',  82,   7),
  (90353, 90007, 'hand_eye',             93,   5),
  (90354, 90007, 'strength',             85,   4),
  (90355, 90007, 'durability',           79,  -2),
  (90356, 90007, 'shot_blocking',        73,  -2),
  (90357, 90007, 'deking',               90,  10),
  (90358, 90007, 'faceoffs',             82,  -3),
  (90359, 90007, 'discipline',           90,   8),
  (90360, 90007, 'fighting_skill',       68, -12),
  -- ── Opp RW: RAIDERSG7 (snapshot 90008) ──────────────────────────────────
  (90361, 90008, 'wrist_shot_accuracy',  85,  -5),
  (90362, 90008, 'slap_shot_accuracy',   86,  -4),
  (90363, 90008, 'speed',                97,  10),
  (90364, 90008, 'balance',              87,   2),
  (90365, 90008, 'agility',              96,   9),
  (90366, 90008, 'wrist_shot_power',     84,  -6),
  (90367, 90008, 'slap_shot_power',      85,  -5),
  (90368, 90008, 'acceleration',         97,  10),
  (90369, 90008, 'puck_control',         94,   7),
  (90370, 90008, 'endurance',            95,   7),
  (90371, 90008, 'passing',              87,   5),
  (90372, 90008, 'offensive_awareness',  99,   9),
  (90373, 90008, 'body_checking',        71, -10),
  (90374, 90008, 'stick_checking',       75, NULL),
  (90375, 90008, 'defensive_awareness',  82,   7),
  (90376, 90008, 'hand_eye',             91,   3),
  (90377, 90008, 'strength',             85,   4),
  (90378, 90008, 'durability',           85,   4),
  (90379, 90008, 'shot_blocking',        66,  -9),
  (90380, 90008, 'deking',               86,   6),
  (90381, 90008, 'faceoffs',             90,   5),
  (90382, 90008, 'discipline',           90,   8),
  (90383, 90008, 'fighting_skill',       67, -13),
  -- ── Opp LD: MuttButt (snapshot 90009) ───────────────────────────────────
  (90384, 90009, 'wrist_shot_accuracy',  71, -10),
  (90385, 90009, 'slap_shot_accuracy',   83,   1),
  (90386, 90009, 'speed',                97,  15),
  (90387, 90009, 'balance',              76, -14),
  (90388, 90009, 'agility',              97,  14),
  (90389, 90009, 'wrist_shot_power',     75,  -8),
  (90390, 90009, 'slap_shot_power',      94,   7),
  (90391, 90009, 'acceleration',         94,  12),
  (90392, 90009, 'puck_control',         90,   5),
  (90393, 90009, 'endurance',            87,   4),
  (90394, 90009, 'passing',              82, NULL),
  (90395, 90009, 'offensive_awareness',  73,  -7),
  (90396, 90009, 'body_checking',        86, NULL),
  (90397, 90009, 'stick_checking',       92,   2),
  (90398, 90009, 'defensive_awareness',  98,   8),
  (90399, 90009, 'hand_eye',             80,  -2),
  (90400, 90009, 'strength',             86, NULL),
  (90401, 90009, 'durability',           83,  -3),
  (90402, 90009, 'shot_blocking',        99,   9),
  (90403, 90009, 'deking',               80,   5),
  (90404, 90009, 'faceoffs',             75,  -5),
  (90405, 90009, 'discipline',           99,   9),
  (90406, 90009, 'fighting_skill',       83,  -2),
  -- ── Opp RD: shadowassault20 (snapshot 90010) ────────────────────────────
  (90407, 90010, 'wrist_shot_accuracy',  90,   6),
  (90408, 90010, 'slap_shot_accuracy',   83,  -1),
  (90409, 90010, 'speed',                97,  10),
  (90410, 90010, 'balance',              73, -12),
  (90411, 90010, 'agility',              96,   9),
  (90412, 90010, 'wrist_shot_power',     86,   4),
  (90413, 90010, 'slap_shot_power',      86,   4),
  (90414, 90010, 'acceleration',         95,   8),
  (90415, 90010, 'puck_control',         82,  -8),
  (90416, 90010, 'endurance',            96,   8),
  (90417, 90010, 'passing',              95,   3),
  (90418, 90010, 'offensive_awareness',  95,   7),
  (90419, 90010, 'body_checking',        80,  -1),
  (90420, 90010, 'stick_checking',       76,  -8),
  (90421, 90010, 'defensive_awareness',  94,   9),
  (90422, 90010, 'hand_eye',             90,   5),
  (90423, 90010, 'strength',             85,   4),
  (90424, 90010, 'durability',           80,  -1),
  (90425, 90010, 'shot_blocking',        76,  -4),
  (90426, 90010, 'deking',               92,   7),
  (90427, 90010, 'faceoffs',             76,  -4),
  (90428, 90010, 'discipline',           92,   7),
  (90429, 90010, 'fighting_skill',       79,  -7)
ON CONFLICT (id) DO NOTHING;
