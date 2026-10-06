-- One-off data fix: quarantine the "Chipstuttar" matches ingested under NHL 26 club 19224.
-- Plan (evidence, counts, expected results): docs/planning/2026-10-05-nhl26-club-19224-quarantine.md
--
-- From 2026-09-07 EA's NHL 26 club 19224 reported as "Chipstuttar", not The Boogeymen, and 172
-- of its matches were ingested as ours. This file, in ONE transaction:
--   1. marks their 172 raw payloads transform_status='error' (payloads KEPT verbatim);
--   2. deletes their player_match_stats, opponent_player_match_stats and matches rows;
--   3. deletes the 6 players who appear ONLY in those matches, with their derived rows;
--   4. restores NHL 26 club_seasonal_stats / club_season_rank from the 2026-09-03 dump
--      (~/backups/pre-rotation-20260903/eanhl-pre-rotation.dump on the main PC).
-- Every statement asserts its exact row count; any difference raises and nothing is applied.
--
-- PRECONDITIONS (asserted): nhl26 polling is off (is_active=false) and migration 0058 has set
-- ea_club_name='The Boogeymen' for nhl26 — so neither the worker nor `reprocess` can re-create
-- these matches afterwards.
--
-- APPLY (Hotel-Echo; take a fresh pg_dump first):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=60s" \
--     eanhl-team-website-db-1 psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - \
--     < apps/worker/src/__scripts__/nhl26-chipstuttar-quarantine-2026-10-05.sql
-- THEN recompute NHL 26 aggregates (club_game_title_stats still counts the 172 until this runs):
--   recomputeAggregates(1) from the worker image — see the plan's step 2.5.
--
-- UNDO: restore the pre-change pg_dump. Every deleted row is also re-derivable from the kept raw
-- payloads (set ea_club_name to NULL for nhl26, then `reprocess`).

\set ON_ERROR_STOP 1

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── Preconditions ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT is_active FROM game_titles WHERE id = 1 AND slug = 'nhl26' AND ea_club_id = '19224') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'precondition: nhl26 (id 1, club 19224) must exist with is_active = false';
  END IF;
  IF (SELECT ea_club_name FROM game_titles WHERE id = 1) IS DISTINCT FROM 'The Boogeymen' THEN
    RAISE EXCEPTION 'precondition: apply migration 0058 first (nhl26 ea_club_name)';
  END IF;
END $$;

-- ── Scope ──────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE q_matches ON COMMIT DROP AS
SELECT m.id AS match_id, r.id AS raw_id
  FROM matches m
  JOIN raw_match_payloads r ON r.game_title_id = m.game_title_id AND r.ea_match_id = m.ea_match_id
 WHERE m.game_title_id = 1
   AND r.payload -> 'clubs' -> '19224' -> 'details' ->> 'name' = 'Chipstuttar';

CREATE TEMP TABLE q_players ON COMMIT DROP AS
SELECT DISTINCT s.player_id
  FROM player_match_stats s
 WHERE s.match_id IN (SELECT match_id FROM q_matches)
   AND NOT EXISTS (
         SELECT 1 FROM player_match_stats s2
          WHERE s2.player_id = s.player_id
            AND s2.match_id NOT IN (SELECT match_id FROM q_matches));

DO $$
DECLARE n int; ids int[];
BEGIN
  SELECT count(*) INTO n FROM q_matches;
  IF n <> 172 THEN RAISE EXCEPTION 'scope: expected 172 Chipstuttar matches, found %', n; END IF;

  SELECT array_agg(player_id ORDER BY player_id) INTO ids FROM q_players;
  IF ids IS DISTINCT FROM ARRAY[206, 207, 208, 209, 213, 228] THEN
    RAISE EXCEPTION 'scope: expected outsider players {206,207,208,209,213,228}, found %', ids;
  END IF;

  -- Same set by the operator's rule: every match with trollet06/willeG2006 on our side.
  SELECT count(*) INTO n FROM (
    SELECT match_id FROM q_matches
    EXCEPT SELECT DISTINCT s.match_id FROM player_match_stats s
            JOIN matches m ON m.id = s.match_id
           WHERE m.game_title_id = 1 AND s.player_id IN (206, 208)) d;
  IF n <> 0 THEN RAISE EXCEPTION 'scope: % Chipstuttar matches lack trollet06/willeG2006', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT DISTINCT s.match_id FROM player_match_stats s
      JOIN matches m ON m.id = s.match_id
     WHERE m.game_title_id = 1 AND s.player_id IN (206, 208)
    EXCEPT SELECT match_id FROM q_matches) d;
  IF n <> 0 THEN RAISE EXCEPTION 'scope: % trollet06/willeG2006 matches are not Chipstuttar-named', n; END IF;

  -- Nothing else may hang off these matches or players (counted 0 on 2026-10-06).
  SELECT (SELECT count(*) FROM user_player_claims       WHERE player_id IN (SELECT player_id FROM q_players))
       + (SELECT count(*) FROM user_player_notes        WHERE player_id IN (SELECT player_id FROM q_players))
       + (SELECT count(*) FROM player_display_aliases   WHERE player_id IN (SELECT player_id FROM q_players))
       + (SELECT count(*) FROM player_persona_aliases   WHERE player_id IN (SELECT player_id FROM q_players))
       + (SELECT count(*) FROM player_loadout_snapshots WHERE player_id IN (SELECT player_id FROM q_players)
                                                           OR match_id IN (SELECT match_id FROM q_matches))
       + (SELECT count(*) FROM historical_player_season_stats       WHERE player_id IN (SELECT player_id FROM q_players))
       + (SELECT count(*) FROM historical_club_member_season_stats  WHERE player_id IN (SELECT player_id FROM q_players))
       + (SELECT count(*) FROM account_invites WHERE claimed_player_id IN (SELECT player_id FROM q_players))
       + (SELECT count(*) FROM match_events    WHERE match_id IN (SELECT match_id FROM q_matches))
       + (SELECT count(*) FROM ocr_capture_batches    WHERE match_id IN (SELECT match_id FROM q_matches))
       + (SELECT count(*) FROM ocr_match_associations WHERE proposed_match_id IN (SELECT match_id FROM q_matches))
    INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'scope: % unexpected dependent rows (claims/notes/aliases/loadouts/historical/invites/events/OCR)', n; END IF;
END $$;

-- ── 1. Raw payloads: keep, mark refused ────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  UPDATE raw_match_payloads
     SET transform_status = 'error',
         transform_error  = 'quarantined 2026-10: club 19224 is "Chipstuttar", not The Boogeymen'
                            ' — see docs/planning/2026-10-05-nhl26-club-19224-quarantine.md'
   WHERE id IN (SELECT raw_id FROM q_matches);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 172 THEN RAISE EXCEPTION 'raw_match_payloads: expected 172, got %', n; END IF;
END $$;

-- ── 2. Match-level rows ────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  DELETE FROM player_match_stats WHERE match_id IN (SELECT match_id FROM q_matches);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 411 THEN RAISE EXCEPTION 'player_match_stats: expected 411, got %', n; END IF;

  DELETE FROM opponent_player_match_stats WHERE match_id IN (SELECT match_id FROM q_matches);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 440 THEN RAISE EXCEPTION 'opponent_player_match_stats: expected 440, got %', n; END IF;

  DELETE FROM matches WHERE id IN (SELECT match_id FROM q_matches);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 172 THEN RAISE EXCEPTION 'matches: expected 172, got %', n; END IF;
END $$;

-- ── 3. Outsider players ────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  DELETE FROM player_game_title_stats WHERE player_id IN (SELECT player_id FROM q_players);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 12 THEN RAISE EXCEPTION 'player_game_title_stats: expected 12, got %', n; END IF;

  DELETE FROM ea_member_season_stats WHERE player_id IN (SELECT player_id FROM q_players);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'ea_member_season_stats: expected 2, got %', n; END IF;

  DELETE FROM player_profiles WHERE player_id IN (SELECT player_id FROM q_players);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 6 THEN RAISE EXCEPTION 'player_profiles: expected 6, got %', n; END IF;

  DELETE FROM player_gamertag_history WHERE player_id IN (SELECT player_id FROM q_players);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 6 THEN RAISE EXCEPTION 'player_gamertag_history: expected 6, got %', n; END IF;

  DELETE FROM players WHERE id IN (SELECT player_id FROM q_players);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 6 THEN RAISE EXCEPTION 'players: expected 6, got %', n; END IF;
END $$;

-- ── 4. NHL 26 official record + season rank (values from the 2026-09-03 dump) ──
DO $$
DECLARE n int;
BEGIN
  UPDATE club_seasonal_stats
     SET wins = 365, losses = 229, otl = 27, games_played = 621, record = '365-229-27',
         ranking_points = 2173, goals = 2238, goals_against = 1825,
         fetched_at = '2026-08-18 02:05:20.414+00'
   WHERE game_title_id = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'club_seasonal_stats: expected 1, got %', n; END IF;

  UPDATE club_season_rank
     SET wins = 0, losses = 0, otl = 0, games_played = 0, points = 0, ranking_points = 0,
         projected_points = -1, current_division = 1, division_name = 'Division 1',
         points_for_promotion = 16, points_to_hold_division = 9, points_to_title = 16,
         fetched_at = '2026-08-18 02:05:22.75+00'
   WHERE game_title_id = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'club_season_rank: expected 1, got %', n; END IF;
END $$;

COMMIT;

-- ── Post-check (read-only) ─────────────────────────────────────────────────────
SELECT 'nhl26 matches' AS what, count(*)::text AS value FROM matches WHERE game_title_id = 1
UNION ALL SELECT 'refused raw payloads', count(*)::text FROM raw_match_payloads
 WHERE game_title_id = 1 AND transform_status = 'error'
UNION ALL SELECT 'outsider players left', count(*)::text FROM players WHERE id IN (206, 207, 208, 209, 213, 228)
UNION ALL SELECT 'nhl26 official record', record || ' / ' || games_played || ' GP' FROM club_seasonal_stats WHERE game_title_id = 1;
