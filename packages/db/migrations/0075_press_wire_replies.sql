-- Migration: press wire replies — a reporter answers a member's reply to a wire post
-- Task: docs/tasks/2026-11-13-discord-press-replies.md (T4, item 3).
--
-- A team member replies (Discord Reply) to a reporter's news post in the press
-- channel; about half of the replies get one in-character answer from that
-- reporter. news_wire_replies holds one row per answered person and post:
-- claimed before the AI call (one answer per person per post, also after a
-- crash), then answered (the reporter's answer and its message id) or failed.
-- The member's reply TEXT is never stored: only its message id (privacy text,
-- operator 2026-11-13). The nightly limit (8) counts rows by the post's night.
-- Why a table and not news_items: an answer is not a news piece (it must not
-- show on /news or feed the desk), and the claim needs its own unique key.
-- Only a new table: this migration does not depend on 0073 or 0074.
-- Needs 0072 (news_items, players).
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0072):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0075_press_wire_replies.sql
-- Apply BEFORE deploying the code that reads it (the press service: without
-- the table a wire reply is logged as failed and gets no answer; scrums,
-- interviews and typed answers are not touched).
-- Idempotent: the table and indexes are added only when missing; the checks
-- are dropped and re-added by name.
-- ROLLBACK (deletes every stored wire answer; the Discord messages stay):
--   DROP TABLE IF EXISTS "news_wire_replies";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "news_wire_replies" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "item_id" bigint NOT NULL REFERENCES "news_items"("id") ON DELETE CASCADE,
  "discord_user_id" text NOT NULL,
  "player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "reporter" text NOT NULL,
  "night" date NOT NULL,
  "reply_message_id" text NOT NULL,
  "answer_message_id" text,
  "answer" text,
  "status" text DEFAULT 'claimed' NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_wire_replies" DROP CONSTRAINT IF EXISTS "news_wire_replies_reporter_check";
  ALTER TABLE "news_wire_replies" ADD CONSTRAINT "news_wire_replies_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_wire_replies" DROP CONSTRAINT IF EXISTS "news_wire_replies_status_check";
  ALTER TABLE "news_wire_replies" ADD CONSTRAINT "news_wire_replies_status_check"
    CHECK ("status" IN ('claimed', 'answered', 'failed'));
END $$;

-- One answer per person per post: a second claim conflicts and inserts nothing.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'news_wire_replies_item_user_uniq'
  ) THEN
    ALTER TABLE "news_wire_replies" ADD CONSTRAINT "news_wire_replies_item_user_uniq"
      UNIQUE ("item_id", "discord_user_id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "news_wire_replies_night_idx" ON "news_wire_replies" ("night");

COMMIT;
