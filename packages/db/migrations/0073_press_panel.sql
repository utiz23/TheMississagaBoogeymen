-- Migration: news desk bots — panel scrums (3 reporters) and the GM's /gm ask
-- Task: docs/tasks/2026-11-13-discord-press-panel-gm-ask.md (T2).
--
-- A scrum person is now asked by a panel of reporters, one question each (a
-- picked player: 3 reporters; a volunteer: 2). news_scrum_people gains
-- "panel" (the reporter ids in the order they ask) and "target_total" (how many
-- questions and follow-ups the round aims for, drawn per player). An empty
-- panel means an old one-reporter round: the scrum's own reporter asks and the
-- old limits apply, so rows made before this migration keep working.
-- news_scrum_answers gains "reporter" (who asked); null = the scrum's reporter.
-- news_gm_asks holds the GM's /gm ask: the player, the question (or topic) and
-- the reporter who asks it. It is a table of its own, not a news_gm_notes row:
-- a note is shown to the writers as a true event of the night, and a question
-- is not an event.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0072):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0073_press_panel.sql
-- Apply BEFORE deploying the code that reads it. Needs 0072 first. Idempotent:
-- the table and columns are added only when missing; the checks are dropped
-- and re-added by name. Additive only: nothing is back-filled or removed.
-- ROLLBACK (the code that reads these columns must be rolled back first):
--   DROP TABLE IF EXISTS "news_gm_asks";
--   ALTER TABLE "news_scrum_answers" DROP CONSTRAINT IF EXISTS "news_scrum_answers_reporter_check";
--   ALTER TABLE "news_scrum_answers" DROP COLUMN IF EXISTS "reporter";
--   ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_target_total_check";
--   ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_panel_check";
--   ALTER TABLE "news_scrum_people" DROP COLUMN IF EXISTS "target_total";
--   ALTER TABLE "news_scrum_people" DROP COLUMN IF EXISTS "panel";

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── news_scrum_people: the panel and the round's target ─────────────────────
ALTER TABLE "news_scrum_people" ADD COLUMN IF NOT EXISTS "panel" text[] DEFAULT '{}' NOT NULL;
ALTER TABLE "news_scrum_people" ADD COLUMN IF NOT EXISTS "target_total" integer;

DO $$ BEGIN
  ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_panel_check";
  ALTER TABLE "news_scrum_people" ADD CONSTRAINT "news_scrum_people_panel_check"
    CHECK ("panel" <@ ARRAY['barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom']::text[]);
END $$;

DO $$ BEGIN
  ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_target_total_check";
  ALTER TABLE "news_scrum_people" ADD CONSTRAINT "news_scrum_people_target_total_check"
    CHECK ("target_total" IS NULL OR "target_total" BETWEEN 2 AND 6);
END $$;

-- ── news_scrum_answers: who asked ───────────────────────────────────────────
ALTER TABLE "news_scrum_answers" ADD COLUMN IF NOT EXISTS "reporter" text;

DO $$ BEGIN
  ALTER TABLE "news_scrum_answers" DROP CONSTRAINT IF EXISTS "news_scrum_answers_reporter_check";
  ALTER TABLE "news_scrum_answers" ADD CONSTRAINT "news_scrum_answers_reporter_check"
    CHECK ("reporter" IS NULL OR "reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

-- ── news_gm_asks: the GM's /gm ask ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_gm_asks" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "match_id" bigint REFERENCES "matches"("id") ON DELETE SET NULL,
  "night" date NOT NULL,
  "player_id" integer NOT NULL REFERENCES "players"("id"),
  "question" text NOT NULL,
  "exact" boolean DEFAULT true NOT NULL,
  "reporter" text,
  "status" text DEFAULT 'active' NOT NULL,
  "refusal" text,
  "requested_by_user_id" text,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_gm_asks" DROP CONSTRAINT IF EXISTS "news_gm_asks_status_check";
  ALTER TABLE "news_gm_asks" ADD CONSTRAINT "news_gm_asks_status_check"
    CHECK ("status" IN ('active', 'refused', 'cancelled'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_gm_asks" DROP CONSTRAINT IF EXISTS "news_gm_asks_reporter_check";
  ALTER TABLE "news_gm_asks" ADD CONSTRAINT "news_gm_asks_reporter_check"
    CHECK ("reporter" IS NULL OR "reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

CREATE INDEX IF NOT EXISTS "news_gm_asks_match_player_idx" ON "news_gm_asks" ("match_id", "player_id");
CREATE INDEX IF NOT EXISTS "news_gm_asks_night_idx" ON "news_gm_asks" ("night");

COMMIT;
