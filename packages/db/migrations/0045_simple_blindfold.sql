CREATE TABLE "ocr_field_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint,
	"segment_id" bigint,
	"screen_state" text NOT NULL,
	"screen_instance_key" text,
	"subject_slot_key" text,
	"field_key" text NOT NULL,
	"field_family" text NOT NULL,
	"candidate_value" jsonb,
	"candidate_rank" integer DEFAULT 0 NOT NULL,
	"raw_confidence" numeric(5, 4),
	"calibrated_confidence" numeric(5, 4),
	"support_frame_ids" bigint[],
	"roi_bbox" jsonb,
	"template_version" text,
	"extractor_family" text NOT NULL,
	"extractor_version" text NOT NULL,
	"observability_status" text DEFAULT 'observable' NOT NULL,
	"normalization_status" text DEFAULT 'normalized' NOT NULL,
	"row_key" text,
	"column_key" text,
	"x_norm" numeric(6, 4),
	"y_norm" numeric(6, 4),
	"shape_or_icon_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_promotions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint,
	"target_table" text NOT NULL,
	"target_semantic_key" jsonb NOT NULL,
	"field_key" text,
	"winning_value" jsonb,
	"winning_confidence" numeric(5, 4),
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"evidence_ids" bigint[],
	"promotion_status" text NOT NULL,
	"blocking_reason" text,
	"authority_source" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_segments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint,
	"segment_key" text NOT NULL,
	"state" text NOT NULL,
	"t_start_sec" numeric(10, 3),
	"t_end_sec" numeric(10, 3),
	"frame_count" integer DEFAULT 0 NOT NULL,
	"segment_confidence" numeric(5, 4),
	"observability_status" text DEFAULT 'observable' NOT NULL,
	"ui_version" text NOT NULL,
	"decoder_version" text NOT NULL,
	"capture_batch_id" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_field_evidence" ADD CONSTRAINT "ocr_field_evidence_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_field_evidence" ADD CONSTRAINT "ocr_field_evidence_segment_id_ocr_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."ocr_segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_promotions" ADD CONSTRAINT "ocr_promotions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_segments" ADD CONSTRAINT "ocr_segments_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ocr_field_evidence_match_field_idx" ON "ocr_field_evidence" USING btree ("match_id","field_key");--> statement-breakpoint
CREATE INDEX "ocr_field_evidence_segment_idx" ON "ocr_field_evidence" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "ocr_field_evidence_promotion_lookup_idx" ON "ocr_field_evidence" USING btree ("match_id","screen_state","field_key","subject_slot_key","candidate_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_promotions_target_uniq" ON "ocr_promotions" USING btree ("target_table",(target_semantic_key::text),"field_key");--> statement-breakpoint
CREATE INDEX "ocr_promotions_match_status_idx" ON "ocr_promotions" USING btree ("match_id","promotion_status");--> statement-breakpoint
CREATE INDEX "ocr_promotions_blocked_idx" ON "ocr_promotions" USING btree ("promotion_status","match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_segments_match_segment_uniq" ON "ocr_segments" USING btree ("match_id","segment_key");--> statement-breakpoint
CREATE INDEX "ocr_segments_match_state_idx" ON "ocr_segments" USING btree ("match_id","state");--> statement-breakpoint
CREATE INDEX "ocr_segments_state_observability_idx" ON "ocr_segments" USING btree ("state","observability_status");