-- Migration: news desk — jobs, items, AI usage, settings, press level
-- Spec: docs/superpowers/specs/2026-10-24-news-desk-design.md
-- Plan: docs/superpowers/plans/2026-10-24-news-desk.md (task 1).
--
-- news_jobs: one row per unit of work (a game, a night, a week). Same states
-- as discord_posts: pending (never re-picked: no double write), done, failed
-- (retried while attempts < 3), skipped. news_items: the posts and articles
-- the fictional reporters write. news_ai_usage: one row per Claude call (cost
-- record for the monthly limit). news_settings: one row, the on/off switch.
-- player_profiles gains press_level (full | easy | out) and who set it.
-- Back-fills a skipped job for every existing game, night and week (Monday
-- start, from the night key) so launch never covers history.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0069):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0071_news_desk.sql
-- Apply BEFORE deploying the code that reads it. Idempotent in schema; adds only.
-- WARNING: re-running it AFTER launch marks every game, night and week that has
-- no job yet as 'skipped' (the back-fill covers every match without a row).
-- Re-run only right before the first launch.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "news_ai_usage";
--   DROP TABLE IF EXISTS "news_items";
--   DROP TABLE IF EXISTS "news_jobs";
--   DROP TABLE IF EXISTS "news_settings";
--   ALTER TABLE "player_profiles" DROP COLUMN IF EXISTS "press_level_set_by";
--   ALTER TABLE "player_profiles" DROP COLUMN IF EXISTS "press_level";

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── news_jobs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_jobs" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "job_key" text NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "news_jobs_kind_job_key_uniq" UNIQUE ("kind", "job_key")
);

DO $$ BEGIN
  ALTER TABLE "news_jobs" ADD CONSTRAINT "news_jobs_kind_check"
    CHECK ("kind" IN ('game', 'night', 'week'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "news_jobs" ADD CONSTRAINT "news_jobs_status_check"
    CHECK ("status" IN ('pending', 'done', 'failed', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── news_items ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_items" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "job_id" bigint REFERENCES "news_jobs"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "reporter" text NOT NULL,
  "match_id" bigint REFERENCES "matches"("id") ON DELETE SET NULL,
  "night" date,
  "week_start" date,
  "reply_to" bigint REFERENCES "news_items"("id") ON DELETE CASCADE,
  "slug" text UNIQUE,
  "headline" text,
  "dek" text,
  "body" text NOT NULL,
  "summary" text,
  "mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "facts" jsonb,
  "is_test" boolean DEFAULT false NOT NULL,
  "discord_status" text DEFAULT 'pending' NOT NULL,
  "discord_attempts" integer DEFAULT 0 NOT NULL,
  "discord_message_id" text,
  "last_error" text,
  "deleted_at" timestamp with time zone,
  "discord_deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_items" ADD CONSTRAINT "news_items_kind_check"
    CHECK ("kind" IN ('post', 'article'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "news_items" ADD CONSTRAINT "news_items_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "news_items" ADD CONSTRAINT "news_items_discord_status_check"
    CHECK ("discord_status" IN ('pending', 'posted', 'failed', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "news_items_feed_idx"
  ON "news_items" ("kind", "is_test", "deleted_at", "id" DESC);

-- ── news_ai_usage ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_ai_usage" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "job_id" bigint REFERENCES "news_jobs"("id") ON DELETE SET NULL,
  "purpose" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cache_read_tokens" integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "cost_usd" numeric(10, 6) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_ai_usage" ADD CONSTRAINT "news_ai_usage_purpose_check"
    CHECK ("purpose" IN ('write', 'review'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── news_settings (one row) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "news_settings_single_row_check" CHECK ("id" = 1)
);

INSERT INTO "news_settings" ("id", "enabled") VALUES (1, false)
ON CONFLICT ("id") DO NOTHING;

-- ── player_profiles: press level ────────────────────────────────────────────
ALTER TABLE "player_profiles" ADD COLUMN IF NOT EXISTS "press_level" text DEFAULT 'full' NOT NULL;
ALTER TABLE "player_profiles" ADD COLUMN IF NOT EXISTS "press_level_set_by" text;

DO $$ BEGIN
  ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_press_level_check"
    CHECK ("press_level" IN ('full', 'easy', 'out'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_press_level_set_by_check"
    CHECK ("press_level_set_by" IS NULL OR "press_level_set_by" IN ('self', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Back-fill: launch never covers history ──────────────────────────────────
-- Night key = the game's local (America/Edmonton) date, shifted 6 h so a game
-- that ends after midnight still belongs to the evening it started.
INSERT INTO "news_jobs" ("kind", "job_key", "status", "last_error")
SELECT 'game', m."id"::text, 'skipped', 'before launch' FROM "matches" m
ON CONFLICT ("kind", "job_key") DO NOTHING;

INSERT INTO "news_jobs" ("kind", "job_key", "status", "last_error")
SELECT DISTINCT 'night',
  to_char(((m."played_at" AT TIME ZONE 'America/Edmonton') - interval '6 hours')::date, 'YYYY-MM-DD'),
  'skipped', 'before launch'
FROM "matches" m
ON CONFLICT ("kind", "job_key") DO NOTHING;

-- Week key = the Monday of the night key's week (weeks run Monday to Sunday).
INSERT INTO "news_jobs" ("kind", "job_key", "status", "last_error")
SELECT DISTINCT 'week',
  to_char(date_trunc('week', (m."played_at" AT TIME ZONE 'America/Edmonton') - interval '6 hours')::date, 'YYYY-MM-DD'),
  'skipped', 'before launch'
FROM "matches" m
ON CONFLICT ("kind", "job_key") DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM "matches") AS "matches",
  (SELECT count(*) FROM "news_jobs" WHERE "kind" = 'game') AS "game_jobs",
  (SELECT count(*) FROM "news_jobs" WHERE "kind" = 'night') AS "night_jobs",
  (SELECT count(*) FROM "news_jobs" WHERE "kind" = 'week') AS "week_jobs",
  (SELECT count(*) FROM "news_jobs" WHERE "status" = 'skipped') AS "skipped",
  (SELECT count(*) FROM "player_profiles" WHERE "press_level" = 'full') AS "profiles_full";
