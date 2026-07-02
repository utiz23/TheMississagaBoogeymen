-- Migration: add player_loadout_snapshots.is_captain_confidence numeric(5,4)
-- Phase D — Captain ★ Real Detection
-- Plan: /home/michal/.claude/plans/plan-phase-d-wobbly-thimble.md
--
-- Per-observation captain confidence: the visual gold-★ score (0..1) computed by
-- tools/game_ocr/game_ocr/captain_star_matcher.py, carried through the
-- `is_captain` field decision by the snapshot-writing promoters
-- (apps/worker/src/ocr-promoters/{lobby-v2,loadout}.ts). Consolidation
-- (apps/worker/src/lib/consolidate-loadouts.ts) reads it for a per-side
-- argmax-by-confidence that enforces one captain per team_side — replacing the
-- old OR-fold and the non-discriminating OCR-text-glyph line confidence.
--
-- Nullable: NULL on snapshots predating Phase D and until the next reprocess
-- (operator-driven, per match; a full re-ingest lands at Phase G). Idempotent
-- via IF NOT EXISTS; runs in a single transaction.
--
-- NOTE: this repo's drizzle journal is frozen at 0045; migrations 0046–0051 are
-- hand-written idempotent SQL applied directly to the DB (not via drizzle-kit
-- generate, which would diff against the stale 0045 snapshot). This file follows
-- that convention.

BEGIN;

ALTER TABLE "player_loadout_snapshots"
  ADD COLUMN IF NOT EXISTS "is_captain_confidence" numeric(5, 4);
--> statement-breakpoint

COMMENT ON COLUMN "player_loadout_snapshots"."is_captain_confidence" IS
  'Per-observation captain confidence: the visual gold-star score (0..1) from tools/game_ocr/game_ocr/captain_star_matcher.py, carried via the is_captain field decision by the lobby-v2/loadout promoters. Consolidation (consolidate-loadouts.ts) uses it for a per-side argmax to enforce one captain per team_side. NULL on snapshots predating Phase D (2026-07-01) and until the next reprocess.';

COMMIT;
