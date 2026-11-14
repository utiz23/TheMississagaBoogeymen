-- Migration: Press Box (admin page /admin/press-box), release L1
-- Task: docs/tasks/2026-11-14-web-press-box-l1-overview.md
--
-- What it adds (all hand-written, all idempotent):
--   1. news_press_box_audit: one row per Press Box change (who, when, kind, target, a short
--      before/after summary). Shown as the "change log" on the overview. No message text.
--   2. news_press_relationships gains `frozen`, `override_level`, `override_reason`:
--      freeze = the points stop changing (no new points, no fading) until unfrozen;
--      override = the GM pins the level the writers see (with a reason); clearing it returns to the
--      level the points give. Existing rows get frozen = false and no override.
--   3. news_press_box_requests: the web page cannot post to Discord (the bot tokens live in the
--      press service), so a button on the page (today: "Run a free test scrum") writes one request
--      row and the press service does it on its next pass (a few seconds), then writes the result back.
--   4. news_press_settings gains `press_mode` and `press_seen_at`: the press service writes its mode
--      (trial or live) and the time on every pass, so the page can show the mode (read only) and
--      whether the press service is running.
--
-- HOW TO APPLY - HAND-APPLIED (journal frozen at 0045; same form as 0078):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0080_press_box.sql
-- Needs 0072 (players, news_press_settings) and 0078 (news_press_relationships).
-- Apply BEFORE deploying the web and press code that read it. The old code ignores the new
-- columns and tables, so applying first is safe.
--
-- ROLLBACK (run AFTER the code is rolled back; it drops the audit log and any pending requests):
--   BEGIN;
--   DROP TABLE IF EXISTS "news_press_box_requests";
--   DROP TABLE IF EXISTS "news_press_box_audit";
--   ALTER TABLE "news_press_relationships" DROP CONSTRAINT IF EXISTS "news_press_relationships_override_level_check";
--   ALTER TABLE "news_press_relationships" DROP COLUMN IF EXISTS "override_reason";
--   ALTER TABLE "news_press_relationships" DROP COLUMN IF EXISTS "override_level";
--   ALTER TABLE "news_press_relationships" DROP COLUMN IF EXISTS "frozen";
--   ALTER TABLE "news_press_settings" DROP COLUMN IF EXISTS "press_seen_at";
--   ALTER TABLE "news_press_settings" DROP COLUMN IF EXISTS "press_mode";
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. The change log.
CREATE TABLE IF NOT EXISTS "news_press_box_audit" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "actor_player_id" integer REFERENCES "players"("id") ON DELETE SET NULL,
  "actor_name" text NOT NULL,
  "kind" text NOT NULL,
  "target" text NOT NULL,
  "summary" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "news_press_box_audit_at_idx" ON "news_press_box_audit" ("at" DESC);

-- 2. Freeze and override on the relationship rows.
ALTER TABLE "news_press_relationships" ADD COLUMN IF NOT EXISTS "frozen" boolean DEFAULT false NOT NULL;
ALTER TABLE "news_press_relationships" ADD COLUMN IF NOT EXISTS "override_level" text;
ALTER TABLE "news_press_relationships" ADD COLUMN IF NOT EXISTS "override_reason" text;

DO $$ BEGIN
  ALTER TABLE "news_press_relationships" DROP CONSTRAINT IF EXISTS "news_press_relationships_override_level_check";
  ALTER TABLE "news_press_relationships" ADD CONSTRAINT "news_press_relationships_override_level_check"
    CHECK ("override_level" IS NULL OR "override_level" IN ('war', 'feud', 'simmering', 'neutral', 'warm', 'fan', 'glazing'));
END $$;

-- 3. Requests from the page to the press service.
CREATE TABLE IF NOT EXISTS "news_press_box_requests" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "requested_by" text NOT NULL,
  "handled_at" timestamp with time zone,
  "result" text
);

DO $$ BEGIN
  ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_kind_check";
  ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_kind_check"
    CHECK ("kind" IN ('testscrum'));
  ALTER TABLE "news_press_box_requests" DROP CONSTRAINT IF EXISTS "news_press_box_requests_status_check";
  ALTER TABLE "news_press_box_requests" ADD CONSTRAINT "news_press_box_requests_status_check"
    CHECK ("status" IN ('pending', 'running', 'done', 'failed'));
END $$;

CREATE INDEX IF NOT EXISTS "news_press_box_requests_status_idx" ON "news_press_box_requests" ("status", "id");

-- 4. The press service's mode and last-seen time.
ALTER TABLE "news_press_settings" ADD COLUMN IF NOT EXISTS "press_mode" text;
ALTER TABLE "news_press_settings" ADD COLUMN IF NOT EXISTS "press_seen_at" timestamp with time zone;

DO $$ BEGIN
  ALTER TABLE "news_press_settings" DROP CONSTRAINT IF EXISTS "news_press_settings_press_mode_check";
  ALTER TABLE "news_press_settings" ADD CONSTRAINT "news_press_settings_press_mode_check"
    CHECK ("press_mode" IS NULL OR "press_mode" IN ('trial', 'live'));
END $$;

COMMIT;
