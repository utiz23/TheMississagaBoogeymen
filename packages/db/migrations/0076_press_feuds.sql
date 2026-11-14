-- Migration: press feuds — points between a player and a reporter
-- Task: docs/tasks/2026-11-13-discord-press-hard-lines-feuds.md (T5, item B).
--
-- A player who insults a reporter (and is not off-limits) adds feud points
-- between that player and that reporter. news_press_feuds holds one row per
-- pair: the point total as of last_event_at. The points fade with a half-life
-- of 7 days; the level (none / simmering / feud / open war) is read in code
-- from the faded points, never stored. No message text is stored.
-- The hard-line class (item A, "off-limits") needs no column: an off-limits
-- message is never stored, so news_scrum_answers.usability stays
-- usable | joke | unusable.
-- Only a new table: this migration needs 0072 (players) and nothing else of
-- the press work.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0075):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0076_press_feuds.sql
-- Apply BEFORE deploying the code that reads it (the press and news services:
-- without the table, feed-in of insults fails and is logged; questions, replies
-- and the recap still work, with no feud content).
-- Idempotent: the table is added only when missing; the checks are dropped and
-- re-added by name.
-- ROLLBACK (deletes every feud point; nothing else depends on the table):
--   DROP TABLE IF EXISTS "news_press_feuds";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "news_press_feuds" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "reporter" text NOT NULL,
  "points" numeric(6, 2) NOT NULL,
  "last_event_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_press_feuds" DROP CONSTRAINT IF EXISTS "news_press_feuds_reporter_check";
  ALTER TABLE "news_press_feuds" ADD CONSTRAINT "news_press_feuds_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_press_feuds" DROP CONSTRAINT IF EXISTS "news_press_feuds_points_check";
  ALTER TABLE "news_press_feuds" ADD CONSTRAINT "news_press_feuds_points_check"
    CHECK ("points" >= 0);
END $$;

-- One row per player and reporter: a second insert conflicts and updates the row.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'news_press_feuds_player_reporter_uniq'
  ) THEN
    ALTER TABLE "news_press_feuds" ADD CONSTRAINT "news_press_feuds_player_reporter_uniq"
      UNIQUE ("player_id", "reporter");
  END IF;
END $$;

COMMIT;
