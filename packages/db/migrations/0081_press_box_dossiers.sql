-- Migration: Press Box player dossiers (admin page /admin/press-box/players), release L2
-- Task: docs/tasks/2026-11-14-web-press-box-l2-dossiers.md
--
-- What it adds (all hand-written, all idempotent):
--   1. news_player_profiles: the AI-written profile of one person ("how the press sees him"),
--      one row per person, replaced on each Refresh. A person is a club member (player_id) or a
--      bench person / coach with no players row (discord_user_id). Keeps the text, when it was
--      written, the writing-rules version it followed, the model and what it cost. The text is
--      shown only on the admin page. It is never written for a "Leave me out" player.
--   2. news_press_box_requests (from 0080) learns two request kinds, `profile` (write or refresh a
--      profile) and `interview` (offer an interview), and four columns that say who or what the
--      request is for: target_player_id, target_discord_user_id, reporter, topic. The web app has
--      no Anthropic key and no bot tokens, so a button writes one request and the press service
--      does it on its next pass, with the news desk's writer, and counts the cost in the monthly
--      spend. Existing `testscrum` rows are unchanged.
--
-- HOW TO APPLY - HAND-APPLIED (journal frozen at 0045; same form as 0080):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0081_press_box_dossiers.sql
-- Needs 0072 (players, news_player_aliases), 0074 (interviews) and 0080 (requests, audit).
-- DEPLOY ORDER: apply this migration, then deploy the press service, THEN the web app. The old
-- press service runs every request as a test scrum, so no `profile` or `interview` request may
-- exist before the new press service is running. The web app is what writes those requests.
--
-- ROLLBACK (run AFTER the code is rolled back; it drops every stored profile and any waiting
-- profile or interview request):
--   BEGIN;
--   DELETE FROM "news_press_box_requests" WHERE "kind" <> 'testscrum';
--   ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_target_check";
--   ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_reporter_check";
--   ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_kind_check";
--   ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_kind_check" CHECK ("kind" IN ('testscrum'));
--   ALTER TABLE "news_press_box_requests" DROP COLUMN IF EXISTS "topic";
--   ALTER TABLE "news_press_box_requests" DROP COLUMN IF EXISTS "reporter";
--   ALTER TABLE "news_press_box_requests" DROP COLUMN IF EXISTS "target_discord_user_id";
--   ALTER TABLE "news_press_box_requests" DROP COLUMN IF EXISTS "target_player_id";
--   DROP TABLE IF EXISTS "news_player_profiles";
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Stored profiles.
CREATE TABLE IF NOT EXISTS "news_player_profiles" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "player_id" integer REFERENCES "players"("id") ON DELETE CASCADE,
  "discord_user_id" text,
  "display_name" text,
  "profile" text NOT NULL,
  "written_at" timestamp with time zone DEFAULT now() NOT NULL,
  "rules_version" text NOT NULL,
  "model" text NOT NULL,
  "cost_usd" numeric(10, 6) DEFAULT 0 NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_player_profiles" DROP CONSTRAINT IF EXISTS "news_player_profiles_person_check";
  ALTER TABLE "news_player_profiles" ADD CONSTRAINT "news_player_profiles_person_check"
    CHECK ("player_id" IS NOT NULL OR ("discord_user_id" IS NOT NULL AND "display_name" IS NOT NULL));
END $$;

-- One row per person.
CREATE UNIQUE INDEX IF NOT EXISTS "news_player_profiles_player_uniq"
  ON "news_player_profiles" ("player_id") WHERE "player_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "news_player_profiles_user_uniq"
  ON "news_player_profiles" ("discord_user_id") WHERE "player_id" IS NULL;

-- 2. Request kinds and targets.
ALTER TABLE "news_press_box_requests" ADD COLUMN IF NOT EXISTS "target_player_id" integer REFERENCES "players"("id") ON DELETE CASCADE;
ALTER TABLE "news_press_box_requests" ADD COLUMN IF NOT EXISTS "target_discord_user_id" text;
ALTER TABLE "news_press_box_requests" ADD COLUMN IF NOT EXISTS "reporter" text;
ALTER TABLE "news_press_box_requests" ADD COLUMN IF NOT EXISTS "topic" text;

DO $$ BEGIN
  ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_kind_check";
  ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_kind_check"
    CHECK ("kind" IN ('testscrum', 'profile', 'interview'));
  ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_reporter_check";
  ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_reporter_check"
    CHECK ("reporter" IS NULL OR "reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
  -- A profile or interview request names its person (a club member or a Discord user).
  ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_target_check";
  ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_target_check"
    CHECK ("kind" = 'testscrum' OR "target_player_id" IS NOT NULL OR "target_discord_user_id" IS NOT NULL);
END $$;

COMMIT;
