-- Migration: add ocr_run_quality_reports.l4_score — API-truth accuracy layer
-- Milestone ③ (AUTO-EVAL) of the OCR mass-ingest & eval program.
--
-- Plan: docs/superpowers/plans/2026-07-11-ocr-mass-ingest-and-eval-program.md
--
-- L4 grades promoted box-score team totals (match_period_summaries source='ocr')
-- and per-player audit lines (raw ocr_extraction_fields) against EA-API truth
-- (matches.score*/shots* + getMatchFaceoffTotals + player_match_stats). Like
-- l1/l2/l3 it is observability-only and lives in a dedicated numeric column for
-- cheap trend queries; the full per-field diff is preserved in the report jsonb.
--
-- Nullable, mirroring l2/l2_lineup/l3 (migration 0051): NULL when layer compute
-- was skipped (run not active for its match) OR the run is ungradable (no matches
-- row / no player_match_stats — OCR is the sole source). NULL passes the CHECK.
--
-- NOTE: this repo's drizzle journal is frozen at 0045; migrations 0046-0053 are
-- hand-written idempotent SQL applied directly to the DB (not via drizzle-kit
-- generate, which would diff against the stale 0045 snapshot). This file follows
-- that convention. Additive-only: one nullable column + one range CHECK.
--
-- Idempotent via IF NOT EXISTS + the DO/EXCEPTION duplicate_object guard; runs
-- in a single transaction.

BEGIN;

ALTER TABLE "ocr_run_quality_reports"
  ADD COLUMN IF NOT EXISTS "l4_score" numeric(5,4);
--> statement-breakpoint

-- Score-range CHECK (mirror the 0050 *_range_chk pattern). Real L4 scores are
-- bounded 0.0-1.0, but numeric(5,4) permits up to 9.9999 — guard against a bad
-- denominator silently corrupting trend queries. l4_score is nullable; the IS
-- NULL branch keeps the constraint satisfied for skipped / ungradable runs.
DO $$ BEGIN
  ALTER TABLE "ocr_run_quality_reports"
    ADD CONSTRAINT "ocr_run_quality_reports_l4_range_chk"
    CHECK ("l4_score" IS NULL OR ("l4_score" BETWEEN 0 AND 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

COMMENT ON COLUMN "ocr_run_quality_reports"."l4_score" IS
  'API-truth accuracy (L4): exact-match fraction of promoted box-score team totals + per-player audit lines vs EA-API truth. Observability-only. NULL when layer compute was skipped (run not active for its match) or the run is ungradable (no matches row / no player_match_stats). Bounded 0.0-1.0 by ocr_run_quality_reports_l4_range_chk. Added by Milestone ③ of the OCR mass-ingest & eval program.';

COMMIT;
