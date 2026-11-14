-- Migration: live events — small JSON events from OBS / the engine (E1)
-- Task: docs/tasks/2026-11-14-web-live-events-e1.md
-- Design: docs/superpowers/specs/2026-11-14-live-events-interface.md (§3 event shape v1, §4 E1).
--
-- One new table, live_events. POST /api/internal/live-events (web) stores each accepted event here,
-- once per sender id (the primary key makes a resend harmless). Append only. The worker reads it to
-- poll EA fast after the horn, and deletes rows older than 30 days. Nothing else changes: no
-- existing table, column or row is touched. Events never write match data (EA stays the truth).
--   id          text PRIMARY KEY  -- the sender's event id (1-128 characters)
--   type        text NOT NULL     -- one of the v1 types (check)
--   source      text NOT NULL     -- 'obs' | 'engine' (check)
--   at          timestamptz       -- the sender's wall time of the event
--   received_at timestamptz       -- the website's clock when stored (index: the worker reads by it)
--   payload     jsonb NOT NULL    -- the whole validated v1 event, as received (at most 4 KB)
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0072-0078):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0079_live_events.sql
-- Apply BEFORE deploying the web and worker code that use it. Without the table the endpoint answers
-- 503 to every event and the worker keeps its normal 5-minute polling (it logs the error, rarely).
-- Idempotent: the table and index are created only when missing; the checks are dropped and re-added
-- by name.
--
-- ROLLBACK (deletes every stored live event; run AFTER rolling the web and worker code back, or the
-- endpoint answers 503 and the worker logs that the table is missing):
--   DROP TABLE IF EXISTS "live_events";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "live_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "source" text NOT NULL,
  "at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "live_events_received_at_idx" ON "live_events" ("received_at");

DO $$ BEGIN
  ALTER TABLE "live_events" DROP CONSTRAINT IF EXISTS "live_events_type_check";
  ALTER TABLE "live_events" ADD CONSTRAINT "live_events_type_check"
    CHECK ("type" IN ('lobby_countdown', 'game_start', 'period_end', 'goal', 'penalty', 'end_of_game_screen', 'game_end'));
END $$;

DO $$ BEGIN
  ALTER TABLE "live_events" DROP CONSTRAINT IF EXISTS "live_events_source_check";
  ALTER TABLE "live_events" ADD CONSTRAINT "live_events_source_check"
    CHECK ("source" IN ('obs', 'engine'));
END $$;

DO $$ BEGIN
  ALTER TABLE "live_events" DROP CONSTRAINT IF EXISTS "live_events_id_check";
  ALTER TABLE "live_events" ADD CONSTRAINT "live_events_id_check"
    CHECK (char_length("id") BETWEEN 1 AND 128);
END $$;

COMMIT;
