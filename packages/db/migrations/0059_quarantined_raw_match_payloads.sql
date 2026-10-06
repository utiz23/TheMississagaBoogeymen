-- Migration: quarantine table for raw match payloads that are not ours
-- Plan: docs/planning/2026-10-05-nhl26-club-19224-quarantine.md (step 2).
--
-- WHY A TABLE, NOT A STATUS
-- -------------------------
-- Payloads refused on purpose (NHL 26 club 19224 reporting as "Chipstuttar") must stay stored
-- verbatim — raw data is never discarded — but must not sit in raw_match_payloads as
-- transform_status = 'error': the worker heartbeat (apps/worker/src/heartbeat.ts) pings
-- Healthchecks `/fail` while ANY error row exists, `reprocess` retries error rows, and the club
-- identity guard refuses them again, so the alert could never clear and would mask real failures.
-- Moving them here keeps them out of monitoring, `reprocess` and `reprocess --all`, with no code
-- change and without widening the strict pending/success/error enum. A NEW identity mismatch still
-- lands in raw_match_payloads as 'error' and alerts, as it should.
--
-- Columns mirror raw_match_payloads one-for-one (same names and types; `id` keeps the original
-- raw_match_payloads.id) plus `quarantined_at` and `quarantine_reason`. Ops-only table: no
-- application code reads or writes it, so it is not declared in the Drizzle schema.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057/0058):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0059_quarantined_raw_match_payloads.sql
-- Idempotent; no application image depends on it.
--
-- UNDO a quarantine (per row, inside a transaction): INSERT the row back into raw_match_payloads
-- (all original columns, transform_status 'pending'), DELETE it here, clear the title's
-- ea_club_name if the club really is ours, then `reprocess`.
-- ROLLBACK the table (only when empty): DROP TABLE IF EXISTS "quarantined_raw_match_payloads";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "quarantined_raw_match_payloads" (
  "id"                bigint PRIMARY KEY,
  "game_title_id"     integer NOT NULL REFERENCES "game_titles" ("id"),
  "ea_match_id"       text NOT NULL,
  "match_type"        text NOT NULL,
  "source_endpoint"   text NOT NULL,
  "payload"           jsonb NOT NULL,
  "payload_hash"      text NOT NULL,
  "schema_version"    integer NOT NULL,
  "transform_status"  text NOT NULL,
  "transform_error"   text,
  "ingestion_log_id"  integer,
  "ingested_at"       timestamp with time zone NOT NULL,
  "quarantined_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "quarantine_reason" text NOT NULL,
  CONSTRAINT "quarantined_raw_match_payloads_title_match_uniq" UNIQUE ("game_title_id", "ea_match_id")
);

COMMIT;

SELECT 'quarantined_raw_match_payloads' AS "table", count(*) AS "rows"
  FROM "quarantined_raw_match_payloads";
