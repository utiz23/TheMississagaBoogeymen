-- Migration: press interviews — one reporter, about 7 questions, a Q&A article
-- Task: docs/tasks/2026-11-13-discord-press-interviews.md (T3).
--
-- An interview is a longer question round than a scrum: one reporter asks one
-- player about 7 questions in a Discord thread, then writes a Q&A article.
-- news_interviews holds one interview (who, which reporter, how it started:
-- gm | player | auto, where it is: offered | active | done | stopped | expired,
-- the offer message, the thread, the question counters, the article step and
-- the article item). news_interview_answers holds each answer with its
-- usability label (usable | joke | unusable) and the reporter who asked.
-- The article itself is an ordinary news_items row (kind 'article', slug
-- 'interview-<id>-…'): news_items is not changed.
-- Only new tables: this migration does not depend on 0073 (T2) and 0073 does
-- not depend on it. Needs 0072 (news_items, players).
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0072):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0074_press_interviews.sql
-- Apply BEFORE deploying the code that reads it (the press service: without
-- the tables its interview steps fail and are logged; scrums are not touched).
-- Idempotent: tables and indexes are added only when missing; the checks are
-- dropped and re-added by name.
-- ROLLBACK (deletes every interview and its answers; the articles stay as news items):
--   DROP TABLE IF EXISTS "news_interview_answers";
--   DROP TABLE IF EXISTS "news_interviews";

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── news_interviews: one interview ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_interviews" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "discord_user_id" text NOT NULL,
  "reporter" text NOT NULL,
  "trigger" text NOT NULL,
  "requested_by_user_id" text,
  "status" text DEFAULT 'offered' NOT NULL,
  "night" date NOT NULL,
  "topic" text,
  "channel_id" text NOT NULL,
  "offer_message_id" text,
  "offered_at" timestamp with time zone,
  "thread_id" text,
  "questions_asked" integer DEFAULT 0 NOT NULL,
  "followups_asked" integer DEFAULT 0 NOT NULL,
  "asking_followup" boolean DEFAULT false NOT NULL,
  "current_question" text,
  "last_asked_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "article_status" text DEFAULT 'waiting' NOT NULL,
  "article_item_id" bigint REFERENCES "news_items"("id") ON DELETE SET NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_interviews" DROP CONSTRAINT IF EXISTS "news_interviews_reporter_check";
  ALTER TABLE "news_interviews" ADD CONSTRAINT "news_interviews_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_interviews" DROP CONSTRAINT IF EXISTS "news_interviews_trigger_check";
  ALTER TABLE "news_interviews" ADD CONSTRAINT "news_interviews_trigger_check"
    CHECK ("trigger" IN ('gm', 'player', 'auto'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_interviews" DROP CONSTRAINT IF EXISTS "news_interviews_status_check";
  ALTER TABLE "news_interviews" ADD CONSTRAINT "news_interviews_status_check"
    CHECK ("status" IN ('offered', 'active', 'done', 'stopped', 'expired'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_interviews" DROP CONSTRAINT IF EXISTS "news_interviews_article_status_check";
  ALTER TABLE "news_interviews" ADD CONSTRAINT "news_interviews_article_status_check"
    CHECK ("article_status" IN ('waiting', 'writing', 'written', 'skipped', 'failed'));
END $$;

-- One open interview per player: a second start conflicts and inserts nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "news_interviews_open_player_uniq"
  ON "news_interviews" ("player_id") WHERE status IN ('offered', 'active');
-- One automatic offer per night and mode: a second pass inserts nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "news_interviews_auto_night_uniq"
  ON "news_interviews" ("night", "is_test") WHERE "trigger" = 'auto';
CREATE INDEX IF NOT EXISTS "news_interviews_status_idx" ON "news_interviews" ("status");
CREATE INDEX IF NOT EXISTS "news_interviews_created_at_idx" ON "news_interviews" ("created_at");

-- ── news_interview_answers: what the player said ────────────────────────────
CREATE TABLE IF NOT EXISTS "news_interview_answers" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "interview_id" bigint NOT NULL REFERENCES "news_interviews"("id") ON DELETE CASCADE,
  "player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "reporter" text NOT NULL,
  "position" integer NOT NULL,
  "is_followup" boolean DEFAULT false NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "usability" text NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_interview_answers" DROP CONSTRAINT IF EXISTS "news_interview_answers_reporter_check";
  ALTER TABLE "news_interview_answers" ADD CONSTRAINT "news_interview_answers_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_interview_answers" DROP CONSTRAINT IF EXISTS "news_interview_answers_usability_check";
  ALTER TABLE "news_interview_answers" ADD CONSTRAINT "news_interview_answers_usability_check"
    CHECK ("usability" IN ('usable', 'joke', 'unusable'));
END $$;

CREATE INDEX IF NOT EXISTS "news_interview_answers_interview_idx"
  ON "news_interview_answers" ("interview_id");

COMMIT;
