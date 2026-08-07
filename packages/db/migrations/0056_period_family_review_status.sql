-- Migration: per-stat-family review status on match_period_summaries
-- Corrective slice 1 of OCR period-summary publication safety.
--
-- THE DEFECT THIS CLOSES
-- ----------------------
-- `match_period_summaries` packs THREE independently-captured stat families into
-- one row — goals (Box Score → Goals tab), shots (Shots tab) and faceoffs
-- (Faceoffs tab) — but carries a SINGLE `review_status`. The reconciliation that
-- authorizes promotion (`reconcilePeriods`) can only grade GOALS: EA publishes a
-- per-period goal breakdown to reconcile against, and nothing else. Flipping the
-- one row-level status on a goals-only verdict therefore published, unvalidated:
--   * per-period shots,
--   * per-period faceoffs,
--   * partially-captured families (one tab read, the others absent),
--   * phantom OT periods invented by frame segmentation.
-- The live corpus already contains rows published through that path.
--
-- The fix is to make authorization as granular as capture: one review status per
-- stat family, so a goals-only verdict can only ever expose goals.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Adds three NOT NULL text columns defaulting to 'pending_review', each with a
-- CHECK mirroring the `OcrReviewStatus` union
-- (packages/db/src/schema/ocr-pipeline.ts):
--     'pending_review' | 'reviewed' | 'rejected'
-- and backfills each family from the row's existing `review_status`.
--
-- BACKFILL POLICY — COMPATIBILITY-PRESERVING, NOT REMEDIATING
-- -----------------------------------------------------------
-- The backfill is a verbatim copy of `review_status` into all three families:
--   * a legacy `reviewed` row stays visible EXACTLY as it was pre-migration;
--   * a legacy `pending_review` row keeps every family quarantined;
--   * a legacy `rejected` row keeps every family rejected (still masked).
-- This migration deliberately does NOT reinterpret, re-grade, downgrade or
-- otherwise remediate existing production rows. The known-bad rows in the live
-- corpus stay exactly as visible as they are today; remediating them is a
-- separate, evidence-driven operation. Mixing remediation into a schema change
-- would make the corpus state unauditable.
--
-- LEGACY `review_status` IS NOW TRANSITIONAL METADATA
-- --------------------------------------------------
-- `review_status` is retained for the staged transition (existing writers and
-- read paths still set/carry it) but is NO LONGER SUFFICIENT AUTHORIZATION to
-- expose any individual stat family. As of this migration the read boundary
-- (`getMatchPeriodSummaries`) authorizes each of goals/shots/faceoffs solely
-- from its own family column; `review_status = 'reviewed'` alone exposes
-- nothing. Do not add it back to any authorization predicate.
--
-- NOTE: this repo's drizzle journal is frozen at 0045; migrations 0046-0055 are
-- hand-written idempotent SQL applied directly to the DB (not via drizzle-kit
-- generate, which would diff against the stale 0045 snapshot). This file follows
-- that convention.
--
-- IDEMPOTENCY: each column is added and backfilled only when absent, so a rerun
-- neither errors nor clobbers family statuses that review has since advanced
-- (the reason this is NOT a bare `ADD COLUMN IF NOT EXISTS` + unconditional
-- UPDATE). The CHECKs use the DO/EXCEPTION duplicate_object guard. Everything
-- runs in a single transaction, and each column is created NOT NULL WITH a valid
-- DEFAULT in one statement — there is no window in which a row holds an invalid
-- or NULL family status.

BEGIN;

DO $$ BEGIN
  -- goals — the ONLY family EA data can currently grade.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_period_summaries'
      AND column_name = 'goals_review_status'
  ) THEN
    ALTER TABLE "match_period_summaries"
      ADD COLUMN "goals_review_status" text NOT NULL DEFAULT 'pending_review';
    UPDATE "match_period_summaries" SET "goals_review_status" = "review_status";
  END IF;

  -- shots — auto-unverifiable: EA publishes no per-period shot breakdown.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_period_summaries'
      AND column_name = 'shots_review_status'
  ) THEN
    ALTER TABLE "match_period_summaries"
      ADD COLUMN "shots_review_status" text NOT NULL DEFAULT 'pending_review';
    UPDATE "match_period_summaries" SET "shots_review_status" = "review_status";
  END IF;

  -- faceoffs — auto-unverifiable: EA publishes no per-period faceoff breakdown.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_period_summaries'
      AND column_name = 'faceoffs_review_status'
  ) THEN
    ALTER TABLE "match_period_summaries"
      ADD COLUMN "faceoffs_review_status" text NOT NULL DEFAULT 'pending_review';
    UPDATE "match_period_summaries" SET "faceoffs_review_status" = "review_status";
  END IF;
END $$;
--> statement-breakpoint

-- Domain CHECKs pinning each family column to the OcrReviewStatus union. The
-- legacy `review_status` column has never carried one (migration 0029 added it
-- bare); these three do, so a typo'd status can never silently behave as
-- "not reviewed" — it fails loudly at write time instead.
DO $$ BEGIN
  ALTER TABLE "match_period_summaries"
    ADD CONSTRAINT "match_period_summaries_goals_review_status_chk"
    CHECK ("goals_review_status" IN ('pending_review', 'reviewed', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "match_period_summaries"
    ADD CONSTRAINT "match_period_summaries_shots_review_status_chk"
    CHECK ("shots_review_status" IN ('pending_review', 'reviewed', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "match_period_summaries"
    ADD CONSTRAINT "match_period_summaries_faceoffs_review_status_chk"
    CHECK ("faceoffs_review_status" IN ('pending_review', 'reviewed', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

COMMENT ON COLUMN "match_period_summaries"."goals_review_status" IS
  'Review state of THIS ROW''S goals_for/goals_against only. OcrReviewStatus: pending_review|reviewed|rejected. getMatchPeriodSummaries returns goals_for/goals_against as NULL unless this is ''reviewed'' (source=''ea'' bypasses review entirely). Goals are the only family EA data can auto-grade, via reconcilePeriods. Backfilled verbatim from the legacy review_status at migration 0056.';
--> statement-breakpoint

COMMENT ON COLUMN "match_period_summaries"."shots_review_status" IS
  'Review state of THIS ROW''S shots_for/shots_against only. OcrReviewStatus: pending_review|reviewed|rejected. getMatchPeriodSummaries returns shots_for/shots_against as NULL unless this is ''reviewed'' (source=''ea'' bypasses review entirely). Auto-unverifiable — EA publishes no per-period shot breakdown — so only operator review may set it. Backfilled verbatim from the legacy review_status at migration 0056.';
--> statement-breakpoint

COMMENT ON COLUMN "match_period_summaries"."faceoffs_review_status" IS
  'Review state of THIS ROW''S faceoffs_for/faceoffs_against only. OcrReviewStatus: pending_review|reviewed|rejected. getMatchPeriodSummaries returns faceoffs_for/faceoffs_against as NULL unless this is ''reviewed'' (source=''ea'' bypasses review entirely). Auto-unverifiable — EA publishes no per-period faceoff breakdown — so only operator review may set it. Backfilled verbatim from the legacy review_status at migration 0056.';
--> statement-breakpoint

COMMENT ON COLUMN "match_period_summaries"."review_status" IS
  'TRANSITIONAL legacy row-level review state. As of migration 0056 this is metadata only and is NOT sufficient authorization to expose any stat family: goals/shots/faceoffs are each gated solely by their own *_review_status column. review_status = ''reviewed'' alone exposes nothing. Retained for the staged migration (existing writers still set it); do not reintroduce it into any read-boundary authorization predicate.';

COMMIT;
