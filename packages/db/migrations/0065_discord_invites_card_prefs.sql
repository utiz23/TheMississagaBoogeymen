-- Migration: Discord member invites + equipped card theme
-- Plan: docs/superpowers/plans/2026-10-09-member-logins-step-1.md (commit 1).
--
-- 1. account_invites.email → nullable. Members sign in with Discord using the
--    `identify` scope only, so an invite is bound to a player, not an address.
-- 2. account_invites.invited_by_user_id → nullable. The bootstrap admin invite is
--    minted by the operator CLI while `users` is empty; NULL means "operator CLI".
-- 3. player_card_prefs: the theme a member equipped on their card, one row per
--    player across every game title. theme NULL = AUTO (follow tier). Kept out of
--    player_card_progress because the worker's card recompute overwrites that row.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0064):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0065_discord_invites_card_prefs.sql
-- Apply BEFORE deploying the code that reads it. Idempotent. Only relaxes and
-- adds, so the code already deployed is unaffected.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "player_card_prefs";
--   (Re-adding NOT NULL to the two invite columns only succeeds while no invite
--    row holds a NULL there:)
--   ALTER TABLE "account_invites" ALTER COLUMN "email" SET NOT NULL;
--   ALTER TABLE "account_invites" ALTER COLUMN "invited_by_user_id" SET NOT NULL;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "account_invites" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "account_invites" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "player_card_prefs" (
  "player_id" integer PRIMARY KEY NOT NULL
    REFERENCES "players"("id") ON DELETE CASCADE,
  "theme" text,
  "updated_by_user_id" text
    REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

COMMIT;

SELECT
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'account_invites' AND column_name = 'email') AS "invite_email_nullable",
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'account_invites' AND column_name = 'invited_by_user_id') AS "invite_inviter_nullable",
  (SELECT count(*) FROM "player_card_prefs") AS "card_prefs_rows";
