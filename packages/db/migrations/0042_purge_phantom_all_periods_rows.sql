-- One-time cleanup of period_number=-1 rows whose stat columns are entirely NULL.
-- Pre-fix promoters defaulted period_number to -1 when period_label OCR failed,
-- silently writing garbage into the legitimate ALL PERIODS aggregate slot. The
-- new parser/promoter chain refuses those writes; this purges what's already
-- on disk so the slot is free for genuine ALL PERIODS rows.
DELETE FROM "match_shot_type_summaries"
WHERE "period_number" = -1
  AND "total_shots" IS NULL
  AND "wrist_shots" IS NULL
  AND "slap_shots" IS NULL
  AND "backhand_shots" IS NULL
  AND "snap_shots" IS NULL
  AND "deflections" IS NULL
  AND "power_play_shots" IS NULL;
--> statement-breakpoint
DELETE FROM "match_faceoff_zone_summaries"
WHERE "period_number" = -1
  AND "overall_win_pct" IS NULL
  AND "offensive_zone_wins" IS NULL
  AND "offensive_zone_total" IS NULL
  AND "defensive_zone_wins" IS NULL
  AND "defensive_zone_total" IS NULL;
--> statement-breakpoint
DELETE FROM "match_faceoff_dots"
WHERE "period_number" = -1
  AND "away_wins" IS NULL
  AND "home_wins" IS NULL;
