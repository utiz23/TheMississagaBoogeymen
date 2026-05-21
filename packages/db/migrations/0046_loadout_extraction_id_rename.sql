-- Migration: rename source_extraction_id → ocr_extraction_id on player_loadout_snapshots
-- Phase 2A-12 of the OCR pipeline redesign (Round 1 §2.7 / Round 4 §6)
-- player_loadout_snapshots was the lone outlier; every other domain table already uses ocr_extraction_id.

-- 1. Drop FK constraint referencing the old column name.
--    Actual stored name is 63 chars (PostgreSQL identifier limit):
--    "player_loadout_snapshots_source_extraction_id_ocr_extractions_i"
--    (the full intended name "...ocr_extractions_id_fk" was truncated by PG)
ALTER TABLE "player_loadout_snapshots" DROP CONSTRAINT "player_loadout_snapshots_source_extraction_id_ocr_extractions_i";
--> statement-breakpoint

-- 2. Rename the column.
ALTER TABLE "player_loadout_snapshots" RENAME COLUMN "source_extraction_id" TO "ocr_extraction_id";
--> statement-breakpoint

-- 3. Recreate FK constraint with new column name (full name fits within 63 chars).
ALTER TABLE "player_loadout_snapshots" ADD CONSTRAINT "player_loadout_snapshots_ocr_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("ocr_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;
