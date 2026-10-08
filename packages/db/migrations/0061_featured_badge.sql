-- Migration: featured badge per season card
-- Spec: docs/superpowers/specs/2026-10-08-season-cards-design.md ("Featured badge").
--
-- player_badge_levels.featured marks the one badge a card shows on its front.
-- Derived: the worker's card recompute sets it for every (player, title) from the
-- whole club's season totals, so it is rebuilt on the next cycle.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0060):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0061_featured_badge.sql
-- Apply BEFORE deploying the code that reads it. Idempotent.
-- ROLLBACK: ALTER TABLE "player_badge_levels" DROP COLUMN IF EXISTS "featured";

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "player_badge_levels"
  ADD COLUMN IF NOT EXISTS "featured" boolean NOT NULL DEFAULT false;

COMMIT;

SELECT count(*) FILTER (WHERE "featured") AS "featured_rows", count(*) AS "rows"
FROM "player_badge_levels";
