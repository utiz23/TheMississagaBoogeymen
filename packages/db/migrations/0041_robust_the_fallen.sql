CREATE TABLE "match_faceoff_dots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"period_number" integer NOT NULL,
	"period_label" text,
	"dot_id" text NOT NULL,
	"away_wins" integer,
	"home_wins" integer,
	"source" text NOT NULL,
	"ocr_extraction_id" bigint,
	"review_status" text DEFAULT 'pending_review' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_faceoff_zone_summaries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"period_number" integer NOT NULL,
	"period_label" text,
	"team_side" text NOT NULL,
	"overall_win_pct" numeric(5, 2),
	"offensive_zone_wins" integer,
	"offensive_zone_total" integer,
	"defensive_zone_wins" integer,
	"defensive_zone_total" integer,
	"source" text NOT NULL,
	"ocr_extraction_id" bigint,
	"review_status" text DEFAULT 'pending_review' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_faceoff_dots" ADD CONSTRAINT "match_faceoff_dots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_faceoff_dots" ADD CONSTRAINT "match_faceoff_dots_ocr_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("ocr_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_faceoff_zone_summaries" ADD CONSTRAINT "match_faceoff_zone_summaries_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_faceoff_zone_summaries" ADD CONSTRAINT "match_faceoff_zone_summaries_ocr_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("ocr_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_faceoff_dots_uniq" ON "match_faceoff_dots" USING btree ("match_id","period_number","dot_id","source");--> statement-breakpoint
CREATE INDEX "match_faceoff_dots_match_idx" ON "match_faceoff_dots" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_faceoff_zone_summaries_uniq" ON "match_faceoff_zone_summaries" USING btree ("match_id","period_number","team_side","source");--> statement-breakpoint
CREATE INDEX "match_faceoff_zone_summaries_match_idx" ON "match_faceoff_zone_summaries" USING btree ("match_id");