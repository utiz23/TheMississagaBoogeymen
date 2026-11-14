-- Migration: press relationships — one signed scale per player and reporter
-- Task: docs/tasks/2026-11-14-discord-press-relationships.md (T9; replaces T5's feud-only points).
--
-- T5 (migration 0076) made news_press_feuds: feud points >= 0 between a player and a reporter.
-- T9 turns it into ONE signed number per pair: negative = the feud side, positive = the favour
-- side (warm / fan / glazing), capped at +-12. The table becomes news_press_relationships.
-- Existing T5 points are kept and mapped to the NEGATIVE side (points = -points). The level
-- (open war / feud / simmering / neutral / warm / fan / glazing) is read in code from the faded
-- points, the reporter's disposition and range (packages/db/src/news/relationships.ts); no level
-- and no message text is stored.
--
-- What it does, in order (each step runs only when its condition holds, so a re-run changes nothing):
--   1. Old table news_press_feuds exists and the new one does not: rename the table, its
--      constraints, its pkey index and its id sequence; flip every stored point to negative; replace
--      the points check (>= 0) with the signed one (between -12 and 12).
--   2. Neither table exists (0076 was never applied): create news_press_relationships fresh.
--   3. News_press_relationships exists: make sure the checks and the unique key are there.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0076):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0078_press_relationships.sql
-- Apply BEFORE deploying the code that reads it (the press and news services; without the table,
-- no points are saved (logged), every level reads neutral, and the recap has no storyline).
-- Needs 0072 (players). Do not apply it twice by hand on purpose: it is idempotent, but step 1's
-- point flip happens only on the run that renames the table.
--
-- ROLLBACK (back to T5's feud-only table; favour-side rows are DELETED, feud rows keep their
-- strength; run BEFORE rolling the code back to the T5 build):
--   BEGIN;
--   DELETE FROM "news_press_relationships" WHERE "points" > 0;
--   UPDATE "news_press_relationships" SET "points" = -"points";
--   ALTER TABLE "news_press_relationships" DROP CONSTRAINT IF EXISTS "news_press_relationships_points_check";
--   ALTER TABLE "news_press_relationships" RENAME CONSTRAINT "news_press_relationships_reporter_check" TO "news_press_feuds_reporter_check";
--   ALTER TABLE "news_press_relationships" RENAME CONSTRAINT "news_press_relationships_player_reporter_uniq" TO "news_press_feuds_player_reporter_uniq";
--   ALTER TABLE "news_press_relationships" ADD CONSTRAINT "news_press_feuds_points_check" CHECK ("points" >= 0);
--   ALTER INDEX IF EXISTS "news_press_relationships_pkey" RENAME TO "news_press_feuds_pkey";
--   ALTER SEQUENCE IF EXISTS "news_press_relationships_id_seq" RENAME TO "news_press_feuds_id_seq";
--   ALTER TABLE "news_press_relationships" RENAME TO "news_press_feuds";
--   COMMIT;
-- (If the table was created fresh by step 2, rolling back is just: DROP TABLE "news_press_relationships";)

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. T5's table becomes the relationships table; its points move to the negative side.
DO $$ BEGIN
  IF to_regclass('public.news_press_feuds') IS NOT NULL
     AND to_regclass('public.news_press_relationships') IS NULL THEN
    ALTER TABLE "news_press_feuds" RENAME TO "news_press_relationships";
    ALTER TABLE "news_press_relationships" RENAME CONSTRAINT "news_press_feuds_reporter_check" TO "news_press_relationships_reporter_check";
    ALTER TABLE "news_press_relationships" RENAME CONSTRAINT "news_press_feuds_player_reporter_uniq" TO "news_press_relationships_player_reporter_uniq";
    ALTER TABLE "news_press_relationships" DROP CONSTRAINT IF EXISTS "news_press_feuds_points_check";
    ALTER INDEX IF EXISTS "news_press_feuds_pkey" RENAME TO "news_press_relationships_pkey";
    ALTER SEQUENCE IF EXISTS "news_press_feuds_id_seq" RENAME TO "news_press_relationships_id_seq";
    -- T5 points were feud points (>= 0): they become negative.
    UPDATE "news_press_relationships" SET "points" = -"points";
  END IF;
END $$;

-- 2. Fresh install (0076 never applied): the table is created with the signed points.
CREATE TABLE IF NOT EXISTS "news_press_relationships" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "reporter" text NOT NULL,
  "points" numeric(6, 2) NOT NULL,
  "last_event_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 3. The checks and the unique key (dropped and re-added by name, like 0076).
DO $$ BEGIN
  ALTER TABLE "news_press_relationships" DROP CONSTRAINT IF EXISTS "news_press_relationships_reporter_check";
  ALTER TABLE "news_press_relationships" ADD CONSTRAINT "news_press_relationships_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_press_relationships" DROP CONSTRAINT IF EXISTS "news_press_relationships_points_check";
  ALTER TABLE "news_press_relationships" ADD CONSTRAINT "news_press_relationships_points_check"
    CHECK ("points" BETWEEN -12 AND 12);
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'news_press_relationships_player_reporter_uniq'
  ) THEN
    ALTER TABLE "news_press_relationships" ADD CONSTRAINT "news_press_relationships_player_reporter_uniq"
      UNIQUE ("player_id", "reporter");
  END IF;
END $$;

COMMIT;
