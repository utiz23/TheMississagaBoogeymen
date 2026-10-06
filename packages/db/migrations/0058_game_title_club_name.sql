-- Migration: expected club name per game title (club identity guard)
-- Plan: docs/planning/2026-10-05-nhl26-club-19224-quarantine.md (step 1).
--
-- THE DEFECT THIS CLOSES
-- ----------------------
-- The worker trusted `game_titles.ea_club_id` alone. From 2026-09-07 EA's NHL 26 club 19224
-- came back as a different club ("Chipstuttar", other crest/region/players) and 172 of its
-- matches were ingested as Boogeymen games. Nothing checked who the club under our ID was.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds `ea_club_name text NULL`: the expected EA display name of our club
-- (clubs[ea_club_id].details.name). When set, `transformMatch` refuses any match whose club
-- under `ea_club_id` has a different (or no) name; the raw payload is kept and the row is marked
-- transform_status = 'error'. NULL = no check (archive titles that are never polled).
--
-- DATA POLICY (fill-only; never overwrites an operator value)
-- -----------------------------------------------------------
-- Sets 'The Boogeymen' only where the column is NULL AND the row's club ID is the one verified
-- for that slug (nhl26 = 19224, nhl27 = 1650). Verified 2026-10-06 on live raw payloads: all 204
-- pre-2026-09-07 NHL 26 payloads and all 73 NHL 27 payloads name our club "The Boogeymen".
-- Re-running this file is a no-op once applied.
--
-- HOW TO APPLY — HAND-APPLIED; NOT PART OF `pnpm --filter db migrate`
-- -----------------------------------------------------------------
-- The drizzle journal is frozen at 0045; 0046+ are hand-written SQL applied with psql
-- (same form as 0057). On Hotel-Echo:
--
--   docker exec -i \
--     -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 \
--     psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0058_game_title_club_name.sql
--
-- ORDER: apply BEFORE starting web or worker images built from code that knows this column.
-- Older images run unchanged on the migrated schema; newer images on an UNMIGRATED database fail
-- every game_titles query (including the worker's poll).
--
-- VERIFICATION (printed after COMMIT):
--   expect nhl26 and nhl27 = 'The Boogeymen', every other title NULL.
--
-- ROLLBACK
-- --------
--   1. Redeploy the previous images (they ignore the column).
--   2. Only if the column itself must go: ALTER TABLE "game_titles" DROP COLUMN IF EXISTS "ea_club_name";
--   To disable the guard for one title without a rollback: UPDATE game_titles SET ea_club_name = NULL WHERE slug = '<slug>';

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "game_titles" ADD COLUMN IF NOT EXISTS "ea_club_name" text;

UPDATE "game_titles"
   SET "ea_club_name" = 'The Boogeymen'
 WHERE "ea_club_name" IS NULL
   AND (("slug" = 'nhl26' AND "ea_club_id" = '19224')
     OR ("slug" = 'nhl27' AND "ea_club_id" = '1650'));

COMMIT;

SELECT "id", "slug", "ea_club_id", "ea_club_name", "is_active"
  FROM "game_titles"
 ORDER BY "release_order" DESC NULLS LAST, "slug" COLLATE "C";
