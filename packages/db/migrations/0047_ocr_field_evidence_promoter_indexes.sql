-- Migration: add (match_id, screen_state, subject_slot_key) index on ocr_field_evidence
-- Phase 2A-13 of the OCR pipeline redesign
-- Speeds up the per-slot promoter read path (Task 2A-17 queries this per slot per match).

CREATE INDEX IF NOT EXISTS "ocr_field_evidence_match_screen_slot_idx"
  ON "ocr_field_evidence" USING btree ("match_id","screen_state","subject_slot_key");
