-- Migration: derive missing ALL SKATERS archive rows from position rows
-- Operator, 2026-10-08: archive season totals count every skater game.
--
-- Some reviewed player-card seasons were captured only per position (e.g.
-- silkyjoker85 NHL 25 3v3: CENTER + WING, no ALL SKATERS card). Every
-- season-total reader (profile season table, all-time stats, awards) reads the
-- `all_skaters` row, so those games were silently missing. For each reviewed
-- player × title × mode with skater position rows but no `all_skaters` row,
-- this inserts one summed from those rows — where both exist, the position sum
-- lands within a few games of the real card.
--
-- Counts are summed; a nullable count (faceoffs, passes, TOI) is summed only
-- when every row has it. FO% / pass% are recomputed from the summed counts.
-- `stats_json` keeps each key that is a whole-number count in every row,
-- summed, plus "derived_from". 6v6 `wing` is skipped when that mode also has
-- leftWing/rightWing rows, so a wing aggregate is never double counted.
-- Tagged import_batch '0064-derived-all-skaters' / source_position_label
-- 'ALL SKATERS (DERIVED)'.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0063):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0064_derived_all_skaters_rows.sql
-- Data only; no code depends on it. Idempotent (skips seasons that already
-- have an all_skaters row). A real ALL SKATERS import later must first delete
-- the derived row for that season.
-- ROLLBACK:
--   DELETE FROM historical_player_season_stats WHERE import_batch = '0064-derived-all-skaters';

BEGIN;

SET LOCAL lock_timeout = '5s';

WITH positions AS (
  SELECT
    h.*,
    bool_or(h.position_scope IN ('leftWing', 'rightWing'))
      OVER (PARTITION BY h.game_title_id, h.player_id, h.game_mode) AS has_lr_wing,
    bool_or(h.position_scope = 'all_skaters')
      OVER (PARTITION BY h.game_title_id, h.player_id, h.game_mode) AS has_total
  FROM historical_player_season_stats h
  WHERE h.review_status = 'reviewed'
    AND h.role_group = 'skater'
),
src AS (
  SELECT *
  FROM positions
  WHERE NOT has_total
    AND position_scope IN ('center', 'defenseMen', 'leftWing', 'rightWing', 'wing')
    AND NOT (position_scope = 'wing' AND has_lr_wing)
),
src_count AS (
  SELECT game_title_id, player_id, game_mode, count(*) AS n
  FROM src
  GROUP BY 1, 2, 3
),
json_keys AS (
  SELECT
    s.game_title_id, s.player_id, s.game_mode, e.key,
    sum(replace(e.value, ',', '')::bigint) AS total,
    count(*) AS n_ok
  FROM src s, jsonb_each_text(s.stats_json) e
  WHERE e.value ~ '^(\d{1,3}(,\d{3})*|\d+)$'
  GROUP BY 1, 2, 3, 4
),
json_sums AS (
  SELECT k.game_title_id, k.player_id, k.game_mode,
    jsonb_object_agg(k.key, k.total::text) AS j
  FROM json_keys k
  JOIN src_count c USING (game_title_id, player_id, game_mode)
  WHERE k.n_ok = c.n
  GROUP BY 1, 2, 3
),
summed AS (
  SELECT
    game_title_id, player_id, game_mode,
    max(gamertag_snapshot) AS gamertag_snapshot,
    max(source_game_mode_label) AS source_game_mode_label,
    sum(games_played) AS games_played,
    sum(goals) AS goals,
    sum(assists) AS assists,
    sum(points) AS points,
    sum(plus_minus) AS plus_minus,
    sum(pim) AS pim,
    sum(shots) AS shots,
    sum(shot_attempts) AS shot_attempts,
    sum(hits) AS hits,
    sum(takeaways) AS takeaways,
    sum(giveaways) AS giveaways,
    sum(blocked_shots) AS blocked_shots,
    sum(interceptions) AS interceptions,
    sum(sh_goals) AS sh_goals,
    sum(gw_goals) AS gw_goals,
    CASE WHEN count(faceoff_wins) = count(*) THEN sum(faceoff_wins) END AS faceoff_wins,
    CASE WHEN count(faceoff_losses) = count(*) THEN sum(faceoff_losses) END AS faceoff_losses,
    CASE WHEN count(pass_completions) = count(*) THEN sum(pass_completions) END AS pass_completions,
    CASE WHEN count(pass_attempts) = count(*) THEN sum(pass_attempts) END AS pass_attempts,
    CASE WHEN count(toi_seconds) = count(*) THEN sum(toi_seconds) END AS toi_seconds
  FROM src
  GROUP BY 1, 2, 3
)
INSERT INTO historical_player_season_stats (
  game_title_id, player_id, gamertag_snapshot, role_group, game_mode, position_scope,
  source_game_mode_label, source_position_label, source_asset_path, import_batch,
  games_played, goals, assists, points, plus_minus, pim, shots, shot_attempts, hits,
  takeaways, giveaways, blocked_shots, interceptions, sh_goals, gw_goals,
  faceoff_wins, faceoff_losses, faceoff_pct, pass_completions, pass_attempts, pass_pct,
  toi_seconds, stats_json, review_status, reviewed_at, imported_at
)
SELECT
  s.game_title_id, s.player_id, s.gamertag_snapshot, 'skater', s.game_mode, 'all_skaters',
  s.source_game_mode_label, 'ALL SKATERS (DERIVED)', 'derived:sum-of-position-rows',
  '0064-derived-all-skaters',
  s.games_played, s.goals, s.assists, s.points, s.plus_minus, s.pim, s.shots,
  s.shot_attempts, s.hits, s.takeaways, s.giveaways, s.blocked_shots, s.interceptions,
  s.sh_goals, s.gw_goals,
  s.faceoff_wins, s.faceoff_losses,
  CASE WHEN s.faceoff_wins + s.faceoff_losses > 0
    THEN round(100.0 * s.faceoff_wins / (s.faceoff_wins + s.faceoff_losses), 2) END,
  s.pass_completions, s.pass_attempts,
  CASE WHEN s.pass_attempts > 0
    THEN round(100.0 * s.pass_completions / s.pass_attempts, 2) END,
  s.toi_seconds,
  coalesce(j.j, '{}'::jsonb) || jsonb_build_object('derived_from', 'position rows'),
  'reviewed', now(), now()
FROM summed s
LEFT JOIN json_sums j USING (game_title_id, player_id, game_mode)
ON CONFLICT (game_title_id, player_id, game_mode, position_scope, role_group) DO NOTHING;

COMMIT;
