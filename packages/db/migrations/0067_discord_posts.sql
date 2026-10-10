-- Migration: discord_posts — one row per game posted (or skipped) to Discord
-- Spec: docs/superpowers/specs/2026-10-10-discord-game-results-design.md
-- Plan: docs/superpowers/plans/2026-10-10-discord-game-results.md (task 1).
--
-- The discord service writes only this table. A row is the service's memory of
-- what it did with a game: pending (claimed, in flight), posted, failed
-- (retried while attempts < 3), skipped (history at launch, or dry run).
-- A pending row is never re-picked: that is the no-double-post guarantee.
--
-- Back-fills a `skipped` row for every existing match so launch never posts
-- history.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0066):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0067_discord_posts.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "discord_posts";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "discord_posts" (
  "match_id" bigint PRIMARY KEY NOT NULL
    REFERENCES "matches"("id") ON DELETE CASCADE,
  "kind" text DEFAULT 'game_result' NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "discord_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "posted_at" timestamp with time zone,
  CONSTRAINT "discord_posts_status_check"
    CHECK ("status" IN ('pending', 'posted', 'failed', 'skipped'))
);

INSERT INTO "discord_posts" ("match_id", "status", "last_error")
SELECT "id", 'skipped', 'before launch' FROM "matches"
ON CONFLICT ("match_id") DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM "matches") AS "matches",
  (SELECT count(*) FROM "discord_posts") AS "discord_posts_rows",
  (SELECT count(*) FROM "discord_posts" WHERE "status" = 'skipped') AS "skipped_rows";
