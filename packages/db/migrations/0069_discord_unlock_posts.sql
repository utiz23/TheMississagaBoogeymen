-- Migration: discord_unlock_posts — one row per card event posted (or skipped)
-- Spec: docs/superpowers/specs/2026-10-24-discord-unlock-posts-design.md
-- Plan: docs/superpowers/plans/2026-10-24-discord-unlock-posts.md (task 1).
--
-- One Discord message per unlock, so one row per player_card_events row. Same
-- states as discord_posts: pending (never re-picked: no double post), posted,
-- failed (retried while attempts < 3), skipped. Back-fills a skipped row for
-- every existing event so launch never posts history. discord_card_posts (0068)
-- stays, unused.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0068):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0069_discord_unlock_posts.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "discord_unlock_posts";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "discord_unlock_posts" (
  "event_id" bigint PRIMARY KEY NOT NULL
    REFERENCES "player_card_events"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "discord_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone,
  CONSTRAINT "discord_unlock_posts_status_check"
    CHECK ("status" IN ('pending', 'posted', 'failed', 'skipped'))
);

INSERT INTO "discord_unlock_posts" ("event_id", "status", "last_error")
SELECT "id", 'skipped', 'before launch' FROM "player_card_events"
ON CONFLICT ("event_id") DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM "player_card_events") AS "events",
  (SELECT count(*) FROM "discord_unlock_posts") AS "rows",
  (SELECT count(*) FROM "discord_unlock_posts" WHERE "status" = 'skipped') AS "skipped";
