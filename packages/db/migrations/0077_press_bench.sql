-- Migration: press bench voices — people with no player row, and a role for every press person
-- Task: docs/tasks/2026-11-14-discord-press-bench-voices.md (T7).
--
-- A game night can have people who watched in the team's voice call and did not play (a "bench"
-- person), and the coach (a configured Discord user, usually not a player in the database). They
-- can be asked questions like a player. Shape chosen: the existing press tables get a role and a
-- name instead of a second people table, so every claim, unique rule and thread lookup of the
-- scrums and interviews stays as it is.
--   * player_id becomes NULLABLE on news_scrum_people, news_scrum_answers, news_gm_asks,
--     news_interviews and news_interview_answers. A person with no players row has player_id NULL.
--   * news_scrum_people, news_gm_asks and news_interviews get:
--       person_role  text NOT NULL DEFAULT 'player'  -- 'player' | 'bench' | 'coach'
--       display_name text                            -- names a person with no player row
--     Every existing row keeps person_role 'player' and display_name NULL: nothing changes for them.
--   * news_gm_asks also gets discord_user_id (who is asked, when there is no player row).
--   * A person with player_id NULL must have a display_name (checks).
--   * Two partial unique indexes make a person with no player row count once: per scrum and
--     Discord user, and one open interview per Discord user (the player_id unique rules never
--     conflict on NULL).
-- A known player on the bench (a player who did not play that game) keeps their player_id and
-- gets person_role 'bench'. The voice-call data is NEVER stored: only the people who actually
-- took part in a scrum or interview get a row.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0072-0076):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0077_press_bench.sql
-- Apply BEFORE deploying the code that reads it (the press service and the news service: both
-- select the new columns). Idempotent: columns and indexes are added only when missing, DROP NOT
-- NULL is safe to repeat, the checks are dropped and re-added by name.
-- ROLLBACK (deletes every row made for a bench person or the coach, then restores the old shape;
-- the written articles stay as news items). Run it only after the code of T7 is rolled back:
--   BEGIN;
--   DELETE FROM news_scrum_answers WHERE person_id IN (SELECT id FROM news_scrum_people WHERE person_role <> 'player' OR player_id IS NULL);
--   DELETE FROM news_scrum_people WHERE person_role <> 'player' OR player_id IS NULL;
--   DELETE FROM news_interviews WHERE person_role <> 'player' OR player_id IS NULL;
--   DELETE FROM news_gm_asks WHERE person_role <> 'player' OR player_id IS NULL;
--   ALTER TABLE news_scrum_people ALTER COLUMN player_id SET NOT NULL;
--   ALTER TABLE news_scrum_answers ALTER COLUMN player_id SET NOT NULL;
--   ALTER TABLE news_gm_asks ALTER COLUMN player_id SET NOT NULL;
--   ALTER TABLE news_interviews ALTER COLUMN player_id SET NOT NULL;
--   ALTER TABLE news_interview_answers ALTER COLUMN player_id SET NOT NULL;
--   DROP INDEX IF EXISTS news_scrum_people_scrum_user_nonplayer_uniq;
--   DROP INDEX IF EXISTS news_interviews_open_nonplayer_uniq;
--   DROP INDEX IF EXISTS news_gm_asks_match_user_idx;
--   ALTER TABLE news_scrum_people DROP CONSTRAINT IF EXISTS news_scrum_people_person_role_check, DROP CONSTRAINT IF EXISTS news_scrum_people_person_named_check, DROP COLUMN IF EXISTS person_role, DROP COLUMN IF EXISTS display_name;
--   ALTER TABLE news_gm_asks DROP CONSTRAINT IF EXISTS news_gm_asks_person_role_check, DROP CONSTRAINT IF EXISTS news_gm_asks_person_named_check, DROP COLUMN IF EXISTS person_role, DROP COLUMN IF EXISTS display_name, DROP COLUMN IF EXISTS discord_user_id;
--   ALTER TABLE news_interviews DROP CONSTRAINT IF EXISTS news_interviews_person_role_check, DROP CONSTRAINT IF EXISTS news_interviews_person_named_check, DROP COLUMN IF EXISTS person_role, DROP COLUMN IF EXISTS display_name;
--   COMMIT;
-- (A scrum answer of a bench person who has a player row is deleted with its person: the
-- person_role filter catches it.)

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── news_scrum_people ───────────────────────────────────────────────────────
ALTER TABLE "news_scrum_people" ALTER COLUMN "player_id" DROP NOT NULL;
ALTER TABLE "news_scrum_people" ADD COLUMN IF NOT EXISTS "person_role" text DEFAULT 'player' NOT NULL;
ALTER TABLE "news_scrum_people" ADD COLUMN IF NOT EXISTS "display_name" text;

DO $$ BEGIN
  ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_person_role_check";
  ALTER TABLE "news_scrum_people" ADD CONSTRAINT "news_scrum_people_person_role_check"
    CHECK ("person_role" IN ('player', 'bench', 'coach'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_person_named_check";
  ALTER TABLE "news_scrum_people" ADD CONSTRAINT "news_scrum_people_person_named_check"
    CHECK ("player_id" IS NOT NULL OR "display_name" IS NOT NULL);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "news_scrum_people_scrum_user_nonplayer_uniq"
  ON "news_scrum_people" ("scrum_id", "discord_user_id") WHERE player_id IS NULL;

-- ── news_scrum_answers ──────────────────────────────────────────────────────
ALTER TABLE "news_scrum_answers" ALTER COLUMN "player_id" DROP NOT NULL;

-- ── news_gm_asks ────────────────────────────────────────────────────────────
ALTER TABLE "news_gm_asks" ALTER COLUMN "player_id" DROP NOT NULL;
ALTER TABLE "news_gm_asks" ADD COLUMN IF NOT EXISTS "discord_user_id" text;
ALTER TABLE "news_gm_asks" ADD COLUMN IF NOT EXISTS "person_role" text DEFAULT 'player' NOT NULL;
ALTER TABLE "news_gm_asks" ADD COLUMN IF NOT EXISTS "display_name" text;

DO $$ BEGIN
  ALTER TABLE "news_gm_asks" DROP CONSTRAINT IF EXISTS "news_gm_asks_person_role_check";
  ALTER TABLE "news_gm_asks" ADD CONSTRAINT "news_gm_asks_person_role_check"
    CHECK ("person_role" IN ('player', 'bench', 'coach'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_gm_asks" DROP CONSTRAINT IF EXISTS "news_gm_asks_person_named_check";
  ALTER TABLE "news_gm_asks" ADD CONSTRAINT "news_gm_asks_person_named_check"
    CHECK ("player_id" IS NOT NULL OR ("discord_user_id" IS NOT NULL AND "display_name" IS NOT NULL));
END $$;

CREATE INDEX IF NOT EXISTS "news_gm_asks_match_user_idx"
  ON "news_gm_asks" ("match_id", "discord_user_id");

-- ── news_interviews ─────────────────────────────────────────────────────────
ALTER TABLE "news_interviews" ALTER COLUMN "player_id" DROP NOT NULL;
ALTER TABLE "news_interviews" ADD COLUMN IF NOT EXISTS "person_role" text DEFAULT 'player' NOT NULL;
ALTER TABLE "news_interviews" ADD COLUMN IF NOT EXISTS "display_name" text;

DO $$ BEGIN
  ALTER TABLE "news_interviews" DROP CONSTRAINT IF EXISTS "news_interviews_person_role_check";
  ALTER TABLE "news_interviews" ADD CONSTRAINT "news_interviews_person_role_check"
    CHECK ("person_role" IN ('player', 'bench', 'coach'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_interviews" DROP CONSTRAINT IF EXISTS "news_interviews_person_named_check";
  ALTER TABLE "news_interviews" ADD CONSTRAINT "news_interviews_person_named_check"
    CHECK ("player_id" IS NOT NULL OR "display_name" IS NOT NULL);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "news_interviews_open_nonplayer_uniq"
  ON "news_interviews" ("discord_user_id") WHERE player_id IS NULL AND status IN ('offered', 'active');

-- ── news_interview_answers ──────────────────────────────────────────────────
ALTER TABLE "news_interview_answers" ALTER COLUMN "player_id" DROP NOT NULL;

COMMIT;
