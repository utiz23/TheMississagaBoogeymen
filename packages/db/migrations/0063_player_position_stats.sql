-- Migration: per-position skater aggregates (player_position_stats)
-- Plan: position filter for the roster / stats / player-page skater tables (2026-10-08)
--
-- One row per player × title × mode (NULL = all modes) × position, summed
-- from player_match_stats skater appearances. `wing` = leftWing + rightWing.
-- Precomputed by the worker's recomputeAggregates (aggregate.ts), the same
-- way as player_game_title_stats; never computed on read.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0062):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0063_player_position_stats.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Then fill it:
--   pnpm --filter worker recompute-aggregates --all
-- ROLLBACK: DROP TABLE player_position_stats;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "player_position_stats" (
  "id" serial PRIMARY KEY,
  "player_id" integer NOT NULL REFERENCES "players" ("id"),
  "game_title_id" integer NOT NULL REFERENCES "game_titles" ("id"),
  "game_mode" text,
  "position" text NOT NULL,
  "gp" integer NOT NULL DEFAULT 0,
  "goals" integer NOT NULL DEFAULT 0,
  "assists" integer NOT NULL DEFAULT 0,
  "points" integer NOT NULL DEFAULT 0,
  "plus_minus" integer NOT NULL DEFAULT 0,
  "shots" integer NOT NULL DEFAULT 0,
  "shot_attempts" integer NOT NULL DEFAULT 0,
  "hits" integer NOT NULL DEFAULT 0,
  "pim" integer NOT NULL DEFAULT 0,
  "takeaways" integer NOT NULL DEFAULT 0,
  "giveaways" integer NOT NULL DEFAULT 0,
  "faceoff_wins" integer NOT NULL DEFAULT 0,
  "faceoff_losses" integer NOT NULL DEFAULT 0,
  "faceoff_pct" numeric(5, 2),
  "pass_completions" integer NOT NULL DEFAULT 0,
  "pass_attempts" integer NOT NULL DEFAULT 0,
  "pass_pct" numeric(5, 2),
  "blocked_shots" integer NOT NULL DEFAULT 0,
  "pp_goals" integer NOT NULL DEFAULT 0,
  "sh_goals" integer NOT NULL DEFAULT 0,
  "hat_tricks" integer NOT NULL DEFAULT 0,
  "interceptions" integer NOT NULL DEFAULT 0,
  "penalties_drawn" integer NOT NULL DEFAULT 0,
  "possession_seconds" integer NOT NULL DEFAULT 0,
  "deflections" integer NOT NULL DEFAULT 0,
  "saucer_passes" integer NOT NULL DEFAULT 0,
  "toi_seconds" integer
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_position_stats_position_check') THEN
    ALTER TABLE "player_position_stats" ADD CONSTRAINT "player_position_stats_position_check"
      CHECK ("position" IN ('center', 'leftWing', 'rightWing', 'wing', 'defenseMen'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "player_position_stats_uniq"
  ON "player_position_stats" ("player_id", "game_title_id", COALESCE("game_mode", ''), "position");

COMMIT;

SELECT count(*) AS rows FROM "player_position_stats";
