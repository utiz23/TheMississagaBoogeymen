-- Migration: add player_loadout_snapshots.is_cpu boolean
-- CPU-Goalie Lineage Fix — commit 1 of 6
-- Plan: /home/michal/.claude/plans/dazzling-toasting-metcalfe.md
--
-- The Python lobby extractor (tools/game_ocr/game_ocr/lobby_extractors/slot_identity.py)
-- already detects CPU/empty placeholder slots via _is_cpu_or_empty(), but the signal
-- was never propagated downstream. This migration adds the authoritative, queryable
-- column. Existing rows default to false; the lobby-v2 promoter writes correct
-- values on next reprocess (operator-driven, per match).
--
-- Idempotent via IF NOT EXISTS guards; runs in a single transaction.

BEGIN;

ALTER TABLE "player_loadout_snapshots"
  ADD COLUMN IF NOT EXISTS "is_cpu" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "player_loadout_snapshots_match_human_idx"
  ON "player_loadout_snapshots" ("match_id")
  WHERE "is_cpu" = false;
--> statement-breakpoint

COMMENT ON COLUMN "player_loadout_snapshots"."is_cpu" IS
  'True when the lobby OCR identified this slot as a CPU/empty placeholder (no human player). Source: tools/game_ocr/game_ocr/lobby_extractors/slot_identity.py::_is_cpu_or_empty, propagated through lobby_evidence.py and written by the lobby-v2 promoter. Defaults to false; goalies in CPU-controlled EASHL modes are the typical case. Downstream queries filter is_cpu = false so CPU rows never surface in lineups, anchors, or quality metrics.';

COMMIT;
