-- Migration: Press Box reporter editor (admin page /admin/press-box/reporters), release L4
-- Task: docs/tasks/2026-11-14-web-press-box-l4-reporters.md
--
-- What it adds (hand-written, idempotent):
--   1. news_reporter_overrides: what the admin changed on a reporter's character, over the
--      definitions in code (packages/db/src/news/reporters.ts). One row per reporter that was ever
--      edited. A NULL field = "use the code default" (so a later change to the code default still
--      reaches the writers). `character_version` counts every save and every reset of that
--      reporter (a first save makes version 1; no row = version 0 = the code defaults only). A reset
--      sets the four fields to NULL and still adds 1, so the version never goes back.
--        bio          text      the reporter's bio (shown on the page; reaches the writers only when edited)
--        voice_notes  text      replaces the reporter's voice notes (how he or she writes)
--        catchphrases text[]    replaces the typical words and phrases list
--        disposition  smallint  -2 (critic) .. +2 (homer); replaces the code default (relationships T9)
--      The LOCKED safety rules are not stored here and cannot be: they live in code and are added to
--      every writer prompt after the character text.
--   2. news_items.character_version: the character version of the item's reporter when the item was
--      written (NULL on older rows and on items written by a service that did not know about it;
--      0 = the code defaults). Lets the admin tell which character version wrote an item.
--   3. news_press_box_requests learns the request kind `preview` ("Preview a sample line": one short
--      model call by the press service, with the result line stored in `result`; the page names the
--      reporter in the existing `reporter` column). A preview needs no person, so the target check
--      lets it through.
--   Audit lines go in news_press_box_audit (0080) with new kinds reporter_edit, reporter_reset and
--   reporter_preview. That table has no kind check, so this migration does not touch it.
--
-- HOW TO APPLY - HAND-APPLIED (journal frozen at 0045; same form as 0081 and 0085):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0087_press_box_reporters.sql
-- Needs 0071 (news_items), 0080 (requests, audit) and 0081 (the requests' reporter column).
-- DEPLOY ORDER: apply this migration, then deploy the news desk AND the press service (they read
-- the overrides at the start of each pass; a missing table or a failed read means the code
-- defaults, so the writers work as before), THEN the web app. The old press service runs any
-- request kind it does not know as a test scrum (it POSTS to Discord), so no `preview` request may
-- exist before the new press service is running: the web app is what writes those requests, and it
-- goes last. Nothing is overridden until the operator saves an edit.
--
-- ROLLBACK (run AFTER the code is rolled back; it drops every character edit and the version
-- numbers on items):
--   BEGIN;
--   DELETE FROM "news_press_box_requests" WHERE "kind" = 'preview';
--   ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_target_check";
--   ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_kind_check";
--   ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_kind_check" CHECK ("kind" IN ('testscrum', 'profile', 'interview'));
--   ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_target_check" CHECK ("kind" = 'testscrum' OR "target_player_id" IS NOT NULL OR "target_discord_user_id" IS NOT NULL);
--   ALTER TABLE "news_items" DROP COLUMN IF EXISTS "character_version";
--   DROP TABLE IF EXISTS "news_reporter_overrides";
--   COMMIT;
-- Audit lines with kind reporter_* stay in news_press_box_audit (harmless history).

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. Character overrides.
CREATE TABLE IF NOT EXISTS "news_reporter_overrides" (
  "reporter" text PRIMARY KEY NOT NULL,
  "bio" text,
  "voice_notes" text,
  "catchphrases" text[],
  "disposition" smallint,
  "character_version" integer DEFAULT 1 NOT NULL,
  "updated_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_reporter_overrides" DROP CONSTRAINT IF EXISTS "news_reporter_overrides_reporter_check";
  ALTER TABLE "news_reporter_overrides" ADD CONSTRAINT "news_reporter_overrides_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
  ALTER TABLE "news_reporter_overrides" DROP CONSTRAINT IF EXISTS "news_reporter_overrides_disposition_check";
  ALTER TABLE "news_reporter_overrides" ADD CONSTRAINT "news_reporter_overrides_disposition_check"
    CHECK ("disposition" IS NULL OR "disposition" BETWEEN -2 AND 2);
  ALTER TABLE "news_reporter_overrides" DROP CONSTRAINT IF EXISTS "news_reporter_overrides_bio_check";
  ALTER TABLE "news_reporter_overrides" ADD CONSTRAINT "news_reporter_overrides_bio_check"
    CHECK ("bio" IS NULL OR char_length("bio") BETWEEN 1 AND 600);
  ALTER TABLE "news_reporter_overrides" DROP CONSTRAINT IF EXISTS "news_reporter_overrides_voice_check";
  ALTER TABLE "news_reporter_overrides" ADD CONSTRAINT "news_reporter_overrides_voice_check"
    CHECK ("voice_notes" IS NULL OR char_length("voice_notes") BETWEEN 1 AND 3000);
  ALTER TABLE "news_reporter_overrides" DROP CONSTRAINT IF EXISTS "news_reporter_overrides_catch_check";
  ALTER TABLE "news_reporter_overrides" ADD CONSTRAINT "news_reporter_overrides_catch_check"
    CHECK ("catchphrases" IS NULL OR cardinality("catchphrases") BETWEEN 3 AND 16);
  ALTER TABLE "news_reporter_overrides" DROP CONSTRAINT IF EXISTS "news_reporter_overrides_version_check";
  ALTER TABLE "news_reporter_overrides" ADD CONSTRAINT "news_reporter_overrides_version_check"
    CHECK ("character_version" >= 1);
END $$;

-- 2. The character version an item was written with.
ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "character_version" integer;

-- 3. The `preview` request kind (no person needed).
DO $$ BEGIN
  ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_kind_check";
  ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_kind_check"
    CHECK ("kind" IN ('testscrum', 'profile', 'interview', 'preview'));
  ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_target_check";
  ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_target_check"
    CHECK ("kind" IN ('testscrum', 'preview') OR "target_player_id" IS NOT NULL OR "target_discord_user_id" IS NOT NULL);
END $$;

COMMIT;
