-- Migration: add player_loadout_snapshots.subject_slot_key text
-- Phase F — Confidence-Weighted Consolidation (F3)
-- Plan: /home/michal/.claude/plans/phase-f-planning-fancy-bentley.md
--
-- The extractor slot key each snapshot was promoted from (lobby
-- `lobby_{for|against}_{POS}`, loadout `loadout_slot_seg{NNNN}_subject{NN}`),
-- written by the v2 promoters (apps/worker/src/ocr-promoters/{loadout-v2,lobby-v2}.ts).
-- Consolidation (apps/worker/src/lib/consolidate-loadouts.ts) joins
-- ocr_field_evidence by (match_id, run_id, subject_slot_key, field_key) to weight
-- the cross-source scalar vote by per-field OCR confidence. Required because
-- ocr_extraction_id is a SHARED degraded value across every slot (loadout-v2 sets
-- it to the match's first loadout-view extraction), so it cannot key the join —
-- the same wall Phase D hit for is_captain_confidence, solved the same way.
--
-- Nullable: NULL on snapshots predating Phase F and until the next reprocess
-- (operator-driven, per match; a full re-ingest lands at Phase G). Also NULL on
-- the legacy per-extraction loadout promoter, which has no slot decomposition.
-- Idempotent via IF NOT EXISTS; runs in a single transaction.
--
-- NOTE: this repo's drizzle journal is frozen at 0045; migrations 0046–0052 are
-- hand-written idempotent SQL applied directly to the DB (not via drizzle-kit
-- generate, which would diff against the stale 0045 snapshot). This file follows
-- that convention.

BEGIN;

ALTER TABLE "player_loadout_snapshots"
  ADD COLUMN IF NOT EXISTS "subject_slot_key" text;
--> statement-breakpoint

COMMENT ON COLUMN "player_loadout_snapshots"."subject_slot_key" IS
  'Phase F: extractor slot key this snapshot was promoted from (lobby lobby_{side}_{POS}, loadout loadout_slot_seg{NNNN}_subject{NN}), written by the v2 promoters. Consolidation (consolidate-loadouts.ts) joins ocr_field_evidence by (match_id, run_id, subject_slot_key, field_key) to confidence-weight the cross-source vote. NULL on snapshots predating Phase F (2026-07-02) and on the legacy per-extraction loadout promoter.';

COMMIT;
