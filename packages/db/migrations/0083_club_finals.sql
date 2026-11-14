-- Migration: Club Finals rounds (CF1) - what round, game and series score each 6v6 Club Finals game is
-- Task: docs/tasks/2026-11-14-web-club-finals-cf1.md
--
-- What it adds (hand-written, idempotent):
--   1. club_finals_games: one row per 6v6 Club Finals game (matches.match_type = 'gameType10' and
--      matches.ea_game_type_code = 10; the 3v3 code 206 is not a Club Finals game). The worker
--      derives it after each pass and quick check (apps/worker/src/club-finals.ts): attempt number,
--      round, game number in the round, the round's W-L before and after, the attempt's W-L after,
--      the round's results up to this game ("WLLWW"), and the marks "round won" / "eliminated" /
--      "final" / "final won". The rules: a round is first to 4 wins; 4 losses in a round end the
--      attempt (back to round 1); round 4 is the final; a DNF or an OT loss counts as a loss.
--   2. club_finals_attempts: one row per attempt (its record, the furthest round, its status), so
--      the Club Finals page reads rows and computes nothing.
--   Both tables are rebuilt by the worker for a title on each pass (a late game can change the rows
--   after it). The web app only reads them. Without this migration the worker skips the step and
--   the web app shows no Club Finals badges.
--
-- HOW TO APPLY - HAND-APPLIED (journal frozen at 0045; same form as 0081):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0083_club_finals.sql
-- Needs matches (game_title_id, ea_game_type_code) and game_titles.
-- DEPLOY ORDER: apply this migration, then deploy the worker (it fills the tables on its next
-- pass), THEN the web app. The web app reads the tables and fails soft when they are empty.
--
-- ROLLBACK (run AFTER the code is rolled back; it drops every derived row, which the worker
-- rebuilds from the matches table when the migration is applied again):
--   BEGIN;
--   DROP TABLE IF EXISTS "club_finals_games";
--   DROP TABLE IF EXISTS "club_finals_attempts";
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. One row per attempt.
CREATE TABLE IF NOT EXISTS "club_finals_attempts" (
  "game_title_id" integer NOT NULL REFERENCES "game_titles"("id"),
  "attempt" smallint NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone NOT NULL,
  "games" smallint NOT NULL,
  "wins" smallint NOT NULL,
  "losses" smallint NOT NULL,
  "round_reached" smallint NOT NULL,
  "rounds_won" smallint NOT NULL,
  "status" text NOT NULL,
  "first_match_id" bigint NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "last_match_id" bigint NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "derived_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("game_title_id", "attempt")
);

DO $$ BEGIN
  ALTER TABLE "club_finals_attempts" DROP CONSTRAINT IF EXISTS "club_finals_attempts_status_check";
  ALTER TABLE "club_finals_attempts" ADD CONSTRAINT "club_finals_attempts_status_check"
    CHECK ("status" IN ('active', 'eliminated', 'final_won'));
  ALTER TABLE "club_finals_attempts" DROP CONSTRAINT IF EXISTS "club_finals_attempts_round_check";
  ALTER TABLE "club_finals_attempts" ADD CONSTRAINT "club_finals_attempts_round_check"
    CHECK ("round_reached" BETWEEN 1 AND 4 AND "rounds_won" BETWEEN 0 AND 4);
END $$;

-- 2. One row per Club Finals game.
CREATE TABLE IF NOT EXISTS "club_finals_games" (
  "match_id" bigint PRIMARY KEY NOT NULL REFERENCES "matches"("id") ON DELETE CASCADE,
  "game_title_id" integer NOT NULL REFERENCES "game_titles"("id"),
  "attempt" smallint NOT NULL,
  "round" smallint NOT NULL,
  "game_in_round" smallint NOT NULL,
  "round_wins_before" smallint NOT NULL,
  "round_losses_before" smallint NOT NULL,
  "round_wins_after" smallint NOT NULL,
  "round_losses_after" smallint NOT NULL,
  "attempt_wins_after" smallint NOT NULL,
  "attempt_losses_after" smallint NOT NULL,
  "counted_as" text NOT NULL,
  "round_results" text NOT NULL,
  "round_won" boolean NOT NULL,
  "eliminated" boolean NOT NULL,
  "is_final" boolean NOT NULL,
  "final_won" boolean NOT NULL,
  "derived_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "club_finals_games" DROP CONSTRAINT IF EXISTS "club_finals_games_counted_as_check";
  ALTER TABLE "club_finals_games" ADD CONSTRAINT "club_finals_games_counted_as_check"
    CHECK ("counted_as" IN ('win', 'loss'));
  ALTER TABLE "club_finals_games" DROP CONSTRAINT IF EXISTS "club_finals_games_round_check";
  ALTER TABLE "club_finals_games" ADD CONSTRAINT "club_finals_games_round_check"
    CHECK ("round" BETWEEN 1 AND 4 AND "game_in_round" BETWEEN 1 AND 7);
END $$;

CREATE INDEX IF NOT EXISTS "club_finals_games_title_attempt_idx"
  ON "club_finals_games" ("game_title_id", "attempt", "round", "game_in_round");

COMMIT;
