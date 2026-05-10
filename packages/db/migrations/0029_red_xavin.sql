ALTER TABLE "match_period_summaries" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'pending_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_shot_type_summaries" ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'pending_review' NOT NULL;
