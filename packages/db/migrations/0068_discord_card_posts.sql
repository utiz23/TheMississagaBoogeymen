-- Migration: discord_card_posts — one row per batch of card changes posted (or skipped)
-- Spec: docs/superpowers/specs/2026-10-24-discord-card-updates-design.md
-- Plan: docs/superpowers/plans/2026-10-24-discord-card-updates.md (task 1).
--
-- A batch = the player_card_events rows with one (game_title_id, occurred_at);
-- batch_event_id is the smallest event id in it. Same states as discord_posts:
-- pending (never re-picked: no double post), posted, failed (retried while
-- attempts < 3), skipped. Back-fills a skipped row for every existing batch so
-- launch never posts history.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0067):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0068_discord_card_posts.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "discord_card_posts";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "discord_card_posts" (
  "batch_event_id" bigint PRIMARY KEY NOT NULL
    REFERENCES "player_card_events"("id") ON DELETE CASCADE,
  "game_title_id" integer NOT NULL REFERENCES "game_titles"("id") ON DELETE CASCADE,
  "occurred_at" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "discord_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone,
  CONSTRAINT "discord_card_posts_status_check"
    CHECK ("status" IN ('pending', 'posted', 'failed', 'skipped'))
);

INSERT INTO "discord_card_posts" ("batch_event_id", "game_title_id", "occurred_at", "status", "last_error")
SELECT min("id"), "game_title_id", "occurred_at", 'skipped', 'before launch'
FROM "player_card_events"
GROUP BY "game_title_id", "occurred_at"
ON CONFLICT ("batch_event_id") DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM (SELECT 1 FROM "player_card_events" GROUP BY "game_title_id", "occurred_at") b) AS "batches",
  (SELECT count(*) FROM "discord_card_posts") AS "rows",
  (SELECT count(*) FROM "discord_card_posts" WHERE "status" = 'skipped') AS "skipped";
