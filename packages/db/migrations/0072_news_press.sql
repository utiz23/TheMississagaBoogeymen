-- Migration: news desk bots — scrums, GM notes, nicknames, mirrors, reactions
-- Spec: docs/superpowers/specs/2026-10-25-news-desk-bots-design.md
-- Plan: docs/superpowers/plans/2026-10-26-news-desk-bots.md (task 1).
--
-- The reporters become Discord bots. A scrum is a short question round after a
-- game recap: news_scrums (one per recap item), news_scrum_people (who is
-- asked, and where they are in the round), news_scrum_answers (what they said,
-- with a usability label). news_gm_notes holds the operator's notes about a
-- game or player. news_player_aliases maps a nickname to a player.
-- news_press_settings is one row: the heat (cool | normal | hot) and how long
-- it lasts. news_press_mirrors records the trial copies of news items in the
-- bot test channel. news_reaction_votes and news_reaction_triggers drive the
-- fan follow-up. news_items gains is_game_recap, discord_via (webhook | bot)
-- and discord_channel_id. news_jobs.kind gains 'reaction' (job_key = the
-- original item id).
-- No back-fill: existing items stay webhook items and are not game recaps.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0071):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0072_news_press.sql
-- Apply BEFORE deploying the code that reads it. Needs 0071 first. Idempotent:
-- tables and columns are added only when missing; the checks that changed
-- (news_jobs_kind_check and the new ones) are dropped and re-added by name.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "news_reaction_triggers";
--   DROP TABLE IF EXISTS "news_reaction_votes";
--   DROP TABLE IF EXISTS "news_press_mirrors";
--   DROP TABLE IF EXISTS "news_press_settings";
--   DROP TABLE IF EXISTS "news_player_aliases";
--   DROP TABLE IF EXISTS "news_gm_notes";
--   DROP TABLE IF EXISTS "news_scrum_answers";
--   DROP TABLE IF EXISTS "news_scrum_people";
--   DROP TABLE IF EXISTS "news_scrums";
--   ALTER TABLE "news_items" DROP CONSTRAINT IF EXISTS "news_items_discord_via_check";
--   ALTER TABLE "news_items" DROP COLUMN IF EXISTS "discord_channel_id";
--   ALTER TABLE "news_items" DROP COLUMN IF EXISTS "discord_via";
--   ALTER TABLE "news_items" DROP COLUMN IF EXISTS "is_game_recap";
--   DELETE FROM "news_jobs" WHERE "kind" = 'reaction';
--   ALTER TABLE "news_jobs" DROP CONSTRAINT IF EXISTS "news_jobs_kind_check";
--   ALTER TABLE "news_jobs" ADD CONSTRAINT "news_jobs_kind_check"
--     CHECK ("kind" IN ('game', 'night', 'week', 'game_article'));

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── news_jobs: reaction jobs ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "news_jobs" DROP CONSTRAINT IF EXISTS "news_jobs_kind_check";
  ALTER TABLE "news_jobs" ADD CONSTRAINT "news_jobs_kind_check"
    CHECK ("kind" IN ('game', 'night', 'week', 'game_article', 'reaction'));
END $$;

-- ── news_items: recap flag and delivery route ───────────────────────────────
ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "is_game_recap" boolean DEFAULT false NOT NULL;
ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "discord_via" text DEFAULT 'webhook' NOT NULL;
ALTER TABLE "news_items" ADD COLUMN IF NOT EXISTS "discord_channel_id" text;

DO $$ BEGIN
  ALTER TABLE "news_items" DROP CONSTRAINT IF EXISTS "news_items_discord_via_check";
  ALTER TABLE "news_items" ADD CONSTRAINT "news_items_discord_via_check"
    CHECK ("discord_via" IN ('webhook', 'bot'));
END $$;

-- ── news_scrums: one per recap item ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_scrums" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "match_id" bigint REFERENCES "matches"("id") ON DELETE SET NULL,
  "night" date NOT NULL,
  "recap_item_id" bigint NOT NULL UNIQUE REFERENCES "news_items"("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL,
  "message_id" text NOT NULL,
  "thread_id" text,
  "reporter" text NOT NULL,
  "heat" text NOT NULL,
  "buzz_level" text NOT NULL,
  "open_until" timestamp with time zone NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_scrums" DROP CONSTRAINT IF EXISTS "news_scrums_reporter_check";
  ALTER TABLE "news_scrums" ADD CONSTRAINT "news_scrums_reporter_check"
    CHECK ("reporter" IN ('barlow', 'voss', 'mercer', 'halberd', 'vale', 'quill', 'rink', 'pettibone', 'bergstrom'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_scrums" DROP CONSTRAINT IF EXISTS "news_scrums_heat_check";
  ALTER TABLE "news_scrums" ADD CONSTRAINT "news_scrums_heat_check"
    CHECK ("heat" IN ('cool', 'normal', 'hot'));
END $$;

CREATE INDEX IF NOT EXISTS "news_scrums_night_idx" ON "news_scrums" ("night");

-- ── news_scrum_people: who is asked, and where they are ─────────────────────
CREATE TABLE IF NOT EXISTS "news_scrum_people" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "scrum_id" bigint NOT NULL REFERENCES "news_scrums"("id") ON DELETE CASCADE,
  "player_id" integer NOT NULL REFERENCES "players"("id"),
  "discord_user_id" text NOT NULL,
  "role" text NOT NULL,
  "requested_by" text NOT NULL,
  "requested_by_user_id" text,
  "status" text DEFAULT 'pinged' NOT NULL,
  "ping_message_id" text,
  "pinged_at" timestamp with time zone,
  "questions_asked" integer DEFAULT 0 NOT NULL,
  "followups_asked" integer DEFAULT 0 NOT NULL,
  "current_question" text,
  "last_asked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "news_scrum_people_scrum_player_uniq" UNIQUE ("scrum_id", "player_id")
);

DO $$ BEGIN
  ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_role_check";
  ALTER TABLE "news_scrum_people" ADD CONSTRAINT "news_scrum_people_role_check"
    CHECK ("role" IN ('picked', 'volunteer'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_requested_by_check";
  ALTER TABLE "news_scrum_people" ADD CONSTRAINT "news_scrum_people_requested_by_check"
    CHECK ("requested_by" IN ('auto', 'gm', 'command', 'self'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_scrum_people" DROP CONSTRAINT IF EXISTS "news_scrum_people_status_check";
  ALTER TABLE "news_scrum_people" ADD CONSTRAINT "news_scrum_people_status_check"
    CHECK ("status" IN ('pinged', 'asking', 'done', 'expired'));
END $$;

CREATE INDEX IF NOT EXISTS "news_scrum_people_status_idx" ON "news_scrum_people" ("status");

-- ── news_scrum_answers: what the player said ────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_scrum_answers" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "person_id" bigint NOT NULL REFERENCES "news_scrum_people"("id") ON DELETE CASCADE,
  "scrum_id" bigint NOT NULL REFERENCES "news_scrums"("id") ON DELETE CASCADE,
  "player_id" integer NOT NULL REFERENCES "players"("id"),
  "night" date NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "usability" text NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_scrum_answers" DROP CONSTRAINT IF EXISTS "news_scrum_answers_usability_check";
  ALTER TABLE "news_scrum_answers" ADD CONSTRAINT "news_scrum_answers_usability_check"
    CHECK ("usability" IN ('usable', 'joke', 'unusable'));
END $$;

CREATE INDEX IF NOT EXISTS "news_scrum_answers_night_idx" ON "news_scrum_answers" ("night");

-- ── news_gm_notes: the operator's notes ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_gm_notes" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "match_id" bigint REFERENCES "matches"("id") ON DELETE SET NULL,
  "night" date NOT NULL,
  "player_id" integer REFERENCES "players"("id") ON DELETE SET NULL,
  "nickname" text,
  "note" text NOT NULL,
  "asks_player" boolean DEFAULT false NOT NULL,
  "critical" boolean DEFAULT false NOT NULL,
  "theme" text,
  "status" text DEFAULT 'active' NOT NULL,
  "refusal" text,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_gm_notes" DROP CONSTRAINT IF EXISTS "news_gm_notes_status_check";
  ALTER TABLE "news_gm_notes" ADD CONSTRAINT "news_gm_notes_status_check"
    CHECK ("status" IN ('active', 'refused', 'cancelled'));
END $$;

CREATE INDEX IF NOT EXISTS "news_gm_notes_night_idx" ON "news_gm_notes" ("night");

-- ── news_player_aliases: nickname -> player (alias is lowercase) ────────────
CREATE TABLE IF NOT EXISTS "news_player_aliases" (
  "alias" text PRIMARY KEY NOT NULL,
  "player_id" integer NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "news_player_aliases" DROP CONSTRAINT IF EXISTS "news_player_aliases_lowercase_check";
  ALTER TABLE "news_player_aliases" ADD CONSTRAINT "news_player_aliases_lowercase_check"
    CHECK ("alias" = lower("alias"));
END $$;

-- ── news_press_settings (one row) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_press_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "heat" text DEFAULT 'normal' NOT NULL,
  "heat_scope" text DEFAULT 'night' NOT NULL,
  "heat_night" date,
  "mirror_from_item_id" bigint,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "news_press_settings_single_row_check" CHECK ("id" = 1)
);

DO $$ BEGIN
  ALTER TABLE "news_press_settings" DROP CONSTRAINT IF EXISTS "news_press_settings_heat_check";
  ALTER TABLE "news_press_settings" ADD CONSTRAINT "news_press_settings_heat_check"
    CHECK ("heat" IN ('cool', 'normal', 'hot'));
END $$;

DO $$ BEGIN
  ALTER TABLE "news_press_settings" DROP CONSTRAINT IF EXISTS "news_press_settings_heat_scope_check";
  ALTER TABLE "news_press_settings" ADD CONSTRAINT "news_press_settings_heat_scope_check"
    CHECK ("heat_scope" IN ('next', 'night'));
END $$;

INSERT INTO "news_press_settings" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;

-- ── news_press_mirrors: trial copies of news items in the bot test channel ──
CREATE TABLE IF NOT EXISTS "news_press_mirrors" (
  "item_id" bigint PRIMARY KEY NOT NULL REFERENCES "news_items"("id") ON DELETE CASCADE,
  "channel_id" text NOT NULL,
  "message_id" text NOT NULL,
  "deleted_at" timestamp with time zone
);

-- ── fan reactions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "news_reaction_votes" (
  "item_id" bigint NOT NULL REFERENCES "news_items"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("item_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "news_reaction_triggers" (
  "item_id" bigint PRIMARY KEY NOT NULL REFERENCES "news_items"("id") ON DELETE CASCADE,
  "night" date NOT NULL,
  "is_test" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "news_reaction_triggers_night_idx" ON "news_reaction_triggers" ("night");

COMMIT;

SELECT
  (SELECT count(*) FROM "news_items" WHERE "discord_via" = 'webhook') AS "webhook_items",
  (SELECT count(*) FROM "news_scrums") AS "scrums",
  (SELECT count(*) FROM "news_press_settings") AS "press_settings_rows";
