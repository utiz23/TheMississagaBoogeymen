-- Migration: separate game-title ingestion eligibility, frontend default and chronology
-- LPL L1 — implements the E1J "NHL 26/27 CUTOVER + CAREER-STITCHING POLICY" (2026-09-08,
-- docs/archive/handoff-history-2026-09-12.md).
--
-- THE DEFECT THIS CLOSES
-- ----------------------
-- `game_titles.is_active` was one signal serving three concerns:
--   * worker polling (apps/worker/src/ingest.ts),
--   * the no-`?title=` frontend default (the highest-id active title),
--   * chronological ordering (auto-increment `id`, in contradictory directions).
-- NHL 27 was seeded with the highest id, so it became the default as a side effect,
-- and a player's career seasons sorted NHL 27 last (reversing the career-range label).
-- Stopping NHL 26 polling would also have stopped NHL 26 being selectable on `/` and `/games`.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds two operator controls, independent of each other and of `is_active`:
--   * `is_default boolean NOT NULL DEFAULT false` — the frontend default title.
--     INVARIANT: partial unique index `game_titles_single_default` ⇒ AT MOST ONE row is
--     the default. The index is checked immediately, so a concurrent second default fails
--     with unique_violation (23505) instead of producing two. "Exactly one" is not
--     DB-enforced (it would break seed/fresh-install intermediate states); the frontend
--     resolver falls back deterministically when no default is set.
--   * `release_order integer NULL` — explicit chronology, higher = newer. UNIQUE among set
--     values (NULLs allowed) and CHECK > 0. `launched_at` could not serve: it is NULL for
--     most titles. Application code orders by
--     `release_order DESC NULLS LAST, slug COLLATE "C" ASC` and never by `id`.
-- `is_active` keeps exactly one meaning — ingestion eligibility — and is NEVER written here.
--
-- DATA POLICY (fill-only; never overwrites an operator value)
-- -----------------------------------------------------------
--   * release_order: rows still NULL whose slug is `nhl<digits>` get that number (nhl27 → 27).
--     Non-conforming slugs stay NULL for the operator to set. A derived value that collides
--     with an existing one (or is 0) aborts the WHOLE transaction — fail closed.
--   * is_default: only when NO row is the default yet —
--       1. `nhl27` if that row exists (approved policy, regardless of its is_active);
--       2. otherwise the newest ingestion-enabled title by release_order (keeps the
--          previously visible default on databases that never had NHL 27);
--       3. otherwise none.
--   Re-running this file is a no-op once applied: it never changes a default, a set
--   release_order, or is_active.
--
-- HOW TO APPLY — HAND-APPLIED; NOT PART OF `pnpm --filter db migrate`
-- -----------------------------------------------------------------
-- This repo's drizzle journal is frozen at 0045; migrations 0046+ are hand-written idempotent
-- SQL applied directly with psql. `pnpm --filter db migrate` does NOT apply this file, and
-- `drizzle-kit generate` / `drizzle-kit migrate` must NOT be used for it. Apply exactly as 0056
-- was (docs/operations/migration-0056-application-2026-08-15.md §4):
--
--   docker exec -i \
--     -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 \
--     psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0057_game_title_controls.sql
--
-- No `-1` / `--single-transaction`: this file supplies its own BEGIN/COMMIT. On another host use
-- the same form against that host's database container.
--
-- ORDER: apply this migration (and check the verification output below) BEFORE starting web or
-- worker images built from code that knows these columns. Older images run unchanged on the
-- migrated schema. Newer images on an UNMIGRATED database fail every game_titles query,
-- including the worker's poll — so migrate first.
--
-- Seeds (packages/db/seed/game_titles*.sql) reference these columns and therefore must run AFTER
-- this file. Fresh install: drizzle 0000–0045 → hand-applied 0046–0057 → seeds.
--
-- VERIFICATION (printed after COMMIT; run again any time):
--   SELECT id, slug, is_active, is_default, release_order FROM game_titles
--    ORDER BY release_order DESC NULLS LAST, slug COLLATE "C";
-- Expect exactly one is_default row (nhl27 where it exists), release_order equal to the slug
-- number for every nhlNN title, and is_active unchanged. Review any NULL release_order row.
--
-- OPERATOR ACTIONS THIS FILE DELIBERATELY DOES NOT TAKE
-- ----------------------------------------------------
--   * Stopping NHL 26 polling. After the new code is deployed and `?title=nhl26` is verified on
--     /, /games, /stats and /roster, and only under separate authorization:
--       UPDATE game_titles SET is_active = false WHERE slug = 'nhl26';
--   * Changing the default. Swap atomically (the index rejects a second default):
--       BEGIN;
--       UPDATE game_titles SET is_default = false WHERE is_default;
--       UPDATE game_titles SET is_default = true WHERE slug = '<slug>';
--       COMMIT;
--
-- ROLLBACK ORDER
-- --------------
--   1. Redeploy the previous images. The migrated schema can stay; old code ignores it.
--   2. If NHL 26 polling was stopped, re-enable it
--      (`UPDATE game_titles SET is_active = true WHERE slug = 'nhl26';`) — old `/` and `/games`
--      cannot resolve an inactive title.
--   3. Only then, and only if the schema itself must go, record the current values and run:
--        BEGIN;
--        DROP INDEX IF EXISTS "game_titles_single_default";
--        DROP INDEX IF EXISTS "game_titles_release_order_uniq";
--        ALTER TABLE "game_titles" DROP CONSTRAINT IF EXISTS "game_titles_release_order_positive";
--        ALTER TABLE "game_titles" DROP COLUMN IF EXISTS "is_default";
--        ALTER TABLE "game_titles" DROP COLUMN IF EXISTS "release_order";
--        COMMIT;
--      The seeds at this revision reference the columns; roll them back with the code.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ALTER TABLE takes ACCESS EXCLUSIVE anyway; taking it first means no lock upgrade mid-file and
-- no writer can interleave between the read-then-write steps below.
LOCK TABLE "game_titles" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "game_titles" ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;
ALTER TABLE "game_titles" ADD COLUMN IF NOT EXISTS "release_order" integer;

DO $$ BEGIN
  ALTER TABLE "game_titles"
    ADD CONSTRAINT "game_titles_release_order_positive" CHECK ("release_order" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "game_titles_single_default"
  ON "game_titles" ("is_default") WHERE "is_default" = true;

CREATE UNIQUE INDEX IF NOT EXISTS "game_titles_release_order_uniq"
  ON "game_titles" ("release_order");

-- Chronology backfill: fill-only, conventional slugs only.
UPDATE "game_titles"
   SET "release_order" = substring("slug" from '^nhl([0-9]+)$')::integer
 WHERE "release_order" IS NULL
   AND "slug" ~ '^nhl[0-9]+$';

-- Default: only when none exists yet.
DO $$
DECLARE
  chosen text;
BEGIN
  IF EXISTS (SELECT 1 FROM "game_titles" WHERE "is_default") THEN
    RETURN;
  END IF;

  SELECT "slug" INTO chosen FROM "game_titles" WHERE "slug" = 'nhl27';

  IF chosen IS NULL THEN
    SELECT "slug" INTO chosen
      FROM "game_titles"
     WHERE "is_active"
     ORDER BY "release_order" DESC NULLS LAST, "slug" COLLATE "C" ASC
     LIMIT 1;
  END IF;

  IF chosen IS NOT NULL THEN
    UPDATE "game_titles" SET "is_default" = true WHERE "slug" = chosen;
  END IF;
END $$;

COMMIT;

SELECT "id", "slug", "is_active", "is_default", "release_order"
  FROM "game_titles"
 ORDER BY "release_order" DESC NULLS LAST, "slug" COLLATE "C";
