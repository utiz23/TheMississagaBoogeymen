-- Migration: add ocr_match_associations — reel→match_id association review queue
-- Milestone ② (ASSOCIATE) of the OCR mass-ingest & eval program.
--
-- Plan: docs/superpowers/plans/2026-07-11-ocr-mass-ingest-and-eval-program.md
--
-- Milestone ① splits a multi-match video into per-match reels. This table is
-- the review queue that maps each reel to a DB match_id: the pure fuzzy scorer
-- (apps/worker/src/lib/match-association-score.ts) proposes a candidate per reel
-- from a cheap identity probe, lands it here as a `pending` row, and on operator
-- confirm (resolve-match-cli) stamps ocr_capture_batches.match_id — unlocking the
-- per-reel dispatch that orchestrator.py currently defers (reel_match_ids=None).
--
-- NOTE: this repo's drizzle journal is frozen at 0045; migrations 0046-0054 are
-- hand-written idempotent SQL applied directly to the DB (not via drizzle-kit
-- generate, which would diff against the stale 0045 snapshot). This file follows
-- that convention. Additive-only: one new table + its unique index + a range
-- CHECK. Nothing existing is altered.
--
-- Idempotent via CREATE TABLE / INDEX IF NOT EXISTS + the DO/EXCEPTION
-- duplicate_object guard on the CHECK constraint; runs in a single transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS "ocr_match_associations" (
  "id"                bigserial PRIMARY KEY,
  -- Stable reel key `${video_sha256}:${reel_index}`. One association per reel.
  "reel_identity"     text NOT NULL,
  "video_sha256"      text NOT NULL,
  -- Decoder run this reel belongs to; NULL if association precedes the run.
  "run_id"            bigint REFERENCES "ocr_decoder_runs"("id"),
  -- Winning candidate; NULL ⇒ no_api_match (operator supplies id on confirm).
  "proposed_match_id" bigint REFERENCES "matches"("id"),
  -- Best weighted score in [0,1]; bounded by the range CHECK below.
  "confidence"        numeric(5,4),
  -- Full scoring rationale: { score, opponent, personas, signals{...}, runnerUpGap }.
  "evidence"          jsonb NOT NULL,
  "status"            text NOT NULL DEFAULT 'pending',
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "decided_at"        timestamptz
);
--> statement-breakpoint

-- One association per reel.
CREATE UNIQUE INDEX IF NOT EXISTS "ocr_match_associations_reel_uniq"
  ON "ocr_match_associations" ("reel_identity");
--> statement-breakpoint

-- Confidence-range CHECK (mirror the 0050/0054 *_range_chk pattern). Scores are
-- bounded 0.0-1.0 but numeric(5,4) permits up to 9.9999 — guard against a bad
-- scorer denominator silently corrupting the review queue. Nullable confidence
-- (operator-authored no_api_match rows) passes via the IS NULL branch.
DO $$ BEGIN
  ALTER TABLE "ocr_match_associations"
    ADD CONSTRAINT "ocr_match_associations_confidence_range_chk"
    CHECK ("confidence" IS NULL OR ("confidence" BETWEEN 0 AND 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

COMMENT ON TABLE "ocr_match_associations" IS
  'Reel→match_id association review queue (Milestone ② of the OCR mass-ingest & eval program). One row per per-match reel: the fuzzy scorer proposes a candidate from an identity probe; operator confirm stamps ocr_capture_batches.match_id and unlocks per-reel dispatch. status: pending|confirmed|rejected. evidence jsonb holds the full scoring rationale.';
--> statement-breakpoint

COMMENT ON COLUMN "ocr_match_associations"."proposed_match_id" IS
  'Winning API-truth candidate match id. NULL means no_api_match: no candidate cleared the confidence threshold, so the operator supplies a match id at confirm time.';

COMMIT;
