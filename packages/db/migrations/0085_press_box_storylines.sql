-- Migration: Press Box storylines: pin and close (release L3)
-- Task: docs/tasks/2026-11-14-web-press-box-l3-storylines.md
--
-- What it adds (hand-written, idempotent):
--   1. news_storylines: one row per storyline the admin acts on at /admin/press-box/storylines.
--      A storyline is either typed on the page (thread_key NULL; its stances use the key
--      'storyline:<id>') or a reporter-system thread the admin pinned or closed (thread_key = the
--      derived key, for example 'player-hot:5@2026-11-09'; threads themselves are still derived,
--      never stored; this row only holds the admin's decision).
--      `pinned` = the suggested angle the writers get for the next recap and scrums. At most ONE
--      row is pinned at a time (unique partial index). A pinned row is never closed (check).
--      `closed_at` set = closed: no writer reads it and the page hides it.
--      `angle` = the GM's suggested angle (may be empty: the writers then get the title only).
--      The page refuses digits, crude words and names of "Leave me out" players in title and
--      angle (the writers may only use numbers from the fact sheet).
--   Audit lines go in news_press_box_audit (0080) with new kinds storyline_new, storyline_pin,
--   storyline_unpin, storyline_close, take_add, take_edit, take_remove, stance_add, stance_edit
--   and stance_remove. That table has no kind check, so this migration does not touch it.
--   Takes (news_reporter_takes) and stances (news_stances) keep their tables and columns.
--
-- HOW TO APPLY - HAND-APPLIED (journal frozen at 0045; same form as 0081 and 0084):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0085_press_box_storylines.sql
-- Needs nothing newer than 0080 (news_press_box_audit); news_stances (0071) is read, not changed.
-- DEPLOY ORDER: apply this migration, then deploy the news desk and the press service (they read
-- the pinned row; a missing table or a failed read means no pinned angle, the writers work as
-- before), THEN the web app (the page reads the table with a fallback). Nothing is pinned until
-- the operator pins one.
--
-- ROLLBACK (run AFTER the code is rolled back; it drops every pin and close decision):
--   BEGIN;
--   DROP TABLE IF EXISTS "news_storylines";
--   COMMIT;
-- Audit lines with kind storyline_*, take_* and stance_* stay in news_press_box_audit (harmless
-- history). Takes and stances the admin added or changed stay (they live in their own tables).

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "news_storylines" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "thread_key" text,
  "title" text NOT NULL,
  "angle" text DEFAULT '' NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "pinned_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_by" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_storylines" DROP CONSTRAINT IF EXISTS "news_storylines_title_check";
  ALTER TABLE "news_storylines" ADD CONSTRAINT "news_storylines_title_check"
    CHECK (char_length("title") BETWEEN 1 AND 80);
  ALTER TABLE "news_storylines" DROP CONSTRAINT IF EXISTS "news_storylines_angle_check";
  ALTER TABLE "news_storylines" ADD CONSTRAINT "news_storylines_angle_check"
    CHECK (char_length("angle") <= 300);
  ALTER TABLE "news_storylines" DROP CONSTRAINT IF EXISTS "news_storylines_pin_state_check";
  ALTER TABLE "news_storylines" ADD CONSTRAINT "news_storylines_pin_state_check"
    CHECK (NOT "pinned" OR ("closed_at" IS NULL AND "pinned_at" IS NOT NULL));
END $$;

-- One storyline row per derived thread.
CREATE UNIQUE INDEX IF NOT EXISTS "news_storylines_thread_key_uniq"
  ON "news_storylines" ("thread_key") WHERE "thread_key" IS NOT NULL;
-- At most one pinned row (a unique index over a boolean that is true only on the pinned row).
CREATE UNIQUE INDEX IF NOT EXISTS "news_storylines_one_pinned_uniq"
  ON "news_storylines" ("pinned") WHERE "pinned";

COMMIT;
