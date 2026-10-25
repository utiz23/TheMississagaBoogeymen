-- Migration: players.discord_user_id — manual Discord user ID for unlock pings
-- Spec: docs/superpowers/specs/2026-10-24-discord-unlock-pings-design.md
-- Plan: docs/superpowers/plans/2026-10-24-discord-unlock-pings.md (task 1).
--
-- Used only when the player has no Discord sign-in (the sign-in ID wins).
-- Entered on /admin. A Discord user ID is 17–20 digits.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0069):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0070_player_discord_user_id.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Adds only.
-- ROLLBACK:
--   ALTER TABLE "players" DROP COLUMN IF EXISTS "discord_user_id";

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "discord_user_id" text;

DO $$ BEGIN
  ALTER TABLE "players" ADD CONSTRAINT "players_discord_user_id_check"
    CHECK ("discord_user_id" IS NULL OR "discord_user_id" ~ '^[0-9]{17,20}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

SELECT count(*) FILTER (WHERE "discord_user_id" IS NOT NULL) AS "with_manual_id" FROM "players";
