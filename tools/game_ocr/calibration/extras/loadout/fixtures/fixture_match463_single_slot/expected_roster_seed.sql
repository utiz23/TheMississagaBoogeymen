-- Fixture: match 463 expected roster seed
-- Sentinel match_id: 9002
--
-- Seeds player_match_stats + opponent_player_match_stats rows so that
-- getExpectedSlotsForMatch(9002) returns exactly 10 expected slots:
--   for: C, LW, RW, LD, RD  (5 BGM skaters)
--   against: C, LW, RW, LD, RD  (5 opp skaters)
--
-- The BGM defenseMen rows are assigned LD (id=990041, first by id ASC) and
-- RD (id=990042, second by id ASC) by the toExpectedSlots() logic in
-- expected-roster.ts. HenryTheBobJr (the promoted slot) is for/LD, so the
-- expected slot coverage check covers exactly that one position.
--
-- NOTE: These rows are also included in expected_canonical.sql (combined
-- fixture seed). This file is a standalone extract for cases where only the
-- roster authority needs to be seeded (e.g., when testing observability
-- blocking in isolation without the full canonical state).

INSERT INTO game_titles (id, slug, label) VALUES (1, 'nhl26', 'NHL 26')
  ON CONFLICT (id) DO NOTHING;

INSERT INTO matches (
  id, game_title_id, ea_match_id, match_id_ea, score_for, score_against,
  game_mode, bgm_was_home, opponent_name, played_at
) VALUES (
  9002, 1, 'fixture-match-9002', 'fixture-match-9002', 0, 0,
  '6s', false, 'Opponent (fixture 463)', NOW()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO players (id, gamertag, ea_id) VALUES
  (99004, 'HenryTheBobJr', NULL)
ON CONFLICT (id) DO NOTHING;

-- BGM side: 5 skaters
-- defenseMen ids 990041 (lower) → LD, 990042 (higher) → RD
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

-- Opponent side: 5 skaters (dummy gamertags for FK-free test DBs)
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
