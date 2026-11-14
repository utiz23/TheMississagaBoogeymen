-- Migration: Player background: the bots ask (switch and ask log), release B2
-- Task: docs/tasks/2026-11-14-discord-background-b2.md
--
-- What it adds (hand-written, idempotent):
--   1. news_background_settings: one row (id = 1), the admin switch "background questions on/off".
--      Default FALSE: nothing is asked until the operator turns it on after the deploy. No row, no
--      table or a failed read all mean OFF. (A new table, not a new column on news_press_settings:
--      older code that selects every column of that table keeps working before this migration.)
--   2. news_background_asks: one row each time a reporter puts a bank question (0082) to a member in
--      a scrum or an interview. It records WHICH bank question was asked (the reporter rewrites it
--      in their own voice, so the posted text is not the key), the teammate named when the question
--      is about a teammate (the code picks only members at press level "full"; this table just
--      stores the pick), and the answer that came back. It drives
--      these rules: at most one background question per scrum panel, at most one per person per 7
--      days in scrums, and never again a question that was already asked (interviews have no cap).
--      A proposed fact points at its answer (0082); this table links the ask to that answer.
--   No fact is created by this migration. No worksheet answer is imported (operator, 2026-11-14:
--   every player starts with a blank fact sheet).
--
-- HOW TO APPLY - HAND-APPLIED (journal frozen at 0045; same form as 0081 and 0082):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0084_background_asks.sql
-- Needs 0082 (news_background_questions), 0073 (news_scrum_people, news_scrum_answers) and 0074
-- (news_interviews, news_interview_answers).
-- DEPLOY ORDER: apply this migration, then deploy the press service (it reads the switch and writes
-- the ask log), THEN the web app (the switch on the Press Box overview and the privacy sentence).
-- The switch stays OFF until the operator turns it on.
--
-- ROLLBACK (run AFTER the code is rolled back):
--   BEGIN;
--   DROP TABLE IF EXISTS "news_background_asks";
--   DROP TABLE IF EXISTS "news_background_settings";
--   COMMIT;
-- Facts already proposed (0082) stay; their links to the dropped table are not stored there.

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. The switch (default off). One row; the row is created OFF here.
CREATE TABLE IF NOT EXISTS "news_background_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_background_settings" DROP CONSTRAINT IF EXISTS "news_background_settings_single_row_check";
  ALTER TABLE "news_background_settings" ADD CONSTRAINT "news_background_settings_single_row_check"
    CHECK ("id" = 1);
END $$;

INSERT INTO "news_background_settings" ("id", "enabled") VALUES (1, false)
  ON CONFLICT ("id") DO NOTHING;

-- 2. The ask log.
CREATE TABLE IF NOT EXISTS "news_background_asks" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "question_id" bigint NOT NULL REFERENCES "news_background_questions"("id") ON DELETE CASCADE,
  "player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "subject_player_id" integer REFERENCES "players"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "scrum_person_id" bigint REFERENCES "news_scrum_people"("id") ON DELETE CASCADE,
  "interview_id" bigint REFERENCES "news_interviews"("id") ON DELETE CASCADE,
  "is_test" boolean DEFAULT false NOT NULL,
  "asked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "answered_at" timestamp with time zone,
  "answer_scrum_id" bigint REFERENCES "news_scrum_answers"("id") ON DELETE SET NULL,
  "answer_interview_id" bigint REFERENCES "news_interview_answers"("id") ON DELETE SET NULL
);

DO $$ BEGIN
  ALTER TABLE "news_background_asks" DROP CONSTRAINT IF EXISTS "news_background_asks_kind_check";
  ALTER TABLE "news_background_asks" ADD CONSTRAINT "news_background_asks_kind_check"
    CHECK (("kind" = 'scrum' AND "scrum_person_id" IS NOT NULL AND "interview_id" IS NULL)
        OR ("kind" = 'interview' AND "interview_id" IS NOT NULL AND "scrum_person_id" IS NULL));
  ALTER TABLE "news_background_asks" DROP CONSTRAINT IF EXISTS "news_background_asks_subject_check";
  ALTER TABLE "news_background_asks" ADD CONSTRAINT "news_background_asks_subject_check"
    CHECK ("subject_player_id" IS NULL OR "subject_player_id" <> "player_id");
END $$;

-- At most one background question per scrum person (one panel). An interview has NO cap (operator,
-- 2026-11-14): it may hold many asks, one open at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "news_background_asks_scrum_person_uniq"
  ON "news_background_asks" ("scrum_person_id") WHERE "scrum_person_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "news_background_asks_interview_idx"
  ON "news_background_asks" ("interview_id") WHERE "interview_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "news_background_asks_player_idx"
  ON "news_background_asks" ("player_id", "asked_at");

COMMIT;
