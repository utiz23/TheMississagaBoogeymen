CREATE TABLE "ocr_capture_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"match_id" bigint,
	"source_directory" text,
	"capture_kind" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "ocr_extractions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"match_id" bigint,
	"screen_type" text NOT NULL,
	"source_path" text NOT NULL,
	"source_hash" text,
	"ocr_backend" text DEFAULT 'rapidocr' NOT NULL,
	"overall_confidence" numeric(5, 4),
	"raw_result_json" jsonb NOT NULL,
	"transform_status" text DEFAULT 'pending' NOT NULL,
	"transform_error" text,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	"duplicate_of_extraction_id" bigint,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ocr_extraction_fields" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"extraction_id" bigint NOT NULL,
	"entity_type" text NOT NULL,
	"entity_key" text,
	"field_key" text NOT NULL,
	"raw_text" text,
	"parsed_value_json" jsonb,
	"confidence" numeric(5, 4),
	"status" text DEFAULT 'ok' NOT NULL,
	"promoted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "match_period_summaries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"period_number" integer NOT NULL,
	"period_label" text NOT NULL,
	"goals_for" integer,
	"goals_against" integer,
	"shots_for" integer,
	"shots_against" integer,
	"faceoffs_for" integer,
	"faceoffs_against" integer,
	"source" text NOT NULL,
	"ocr_extraction_id" bigint
);
--> statement-breakpoint
CREATE TABLE "match_shot_type_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"team_side" text NOT NULL,
	"period_number" integer DEFAULT -1 NOT NULL,
	"period_label" text,
	"total_shots" integer,
	"wrist_shots" integer,
	"slap_shots" integer,
	"backhand_shots" integer,
	"snap_shots" integer,
	"deflections" integer,
	"power_play_shots" integer,
	"source" text NOT NULL,
	"ocr_extraction_id" bigint
);
--> statement-breakpoint
CREATE TABLE "match_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"period_number" integer NOT NULL,
	"period_label" text NOT NULL,
	"clock" text,
	"event_type" text NOT NULL,
	"team_side" text NOT NULL,
	"team_abbreviation" text,
	"actor_player_id" integer,
	"actor_gamertag_snapshot" text,
	"target_player_id" integer,
	"target_gamertag_snapshot" text,
	"event_detail" text,
	"x" numeric(6, 2),
	"y" numeric(6, 2),
	"rink_zone" text,
	"source" text NOT NULL,
	"ocr_extraction_id" bigint,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	CONSTRAINT "match_events_event_type_check" CHECK ("match_events"."event_type" IN ('goal', 'shot', 'hit', 'penalty', 'faceoff')),
	CONSTRAINT "match_events_team_side_check" CHECK ("match_events"."team_side" IN ('for', 'against'))
);
--> statement-breakpoint
CREATE TABLE "match_goal_events" (
	"event_id" bigint PRIMARY KEY NOT NULL,
	"scorer_player_id" integer,
	"scorer_snapshot" text NOT NULL,
	"goal_number_in_game" integer,
	"primary_assist_player_id" integer,
	"primary_assist_snapshot" text,
	"secondary_assist_player_id" integer,
	"secondary_assist_snapshot" text
);
--> statement-breakpoint
CREATE TABLE "match_penalty_events" (
	"event_id" bigint PRIMARY KEY NOT NULL,
	"culprit_player_id" integer,
	"culprit_snapshot" text NOT NULL,
	"infraction" text NOT NULL,
	"penalty_type" text NOT NULL,
	"minutes" integer
);
--> statement-breakpoint
CREATE TABLE "player_loadout_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" integer,
	"gamertag_snapshot" text NOT NULL,
	"player_name_snapshot" text,
	"game_title_id" integer NOT NULL,
	"match_id" bigint,
	"source_extraction_id" bigint NOT NULL,
	"position" text,
	"build_class" text,
	"height_text" text,
	"weight_lbs" integer,
	"handedness" text,
	"player_level_raw" text,
	"player_level_number" integer,
	"platform" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_status" text DEFAULT 'pending_review' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_loadout_x_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"loadout_snapshot_id" bigint NOT NULL,
	"slot_index" integer NOT NULL,
	"x_factor_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_loadout_attributes" (
	"id" serial PRIMARY KEY NOT NULL,
	"loadout_snapshot_id" bigint NOT NULL,
	"attribute_key" text NOT NULL,
	"raw_text" text,
	"value" integer,
	"confidence" numeric(5, 4)
);
--> statement-breakpoint
ALTER TABLE "ocr_capture_batches" ADD CONSTRAINT "ocr_capture_batches_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_capture_batches" ADD CONSTRAINT "ocr_capture_batches_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_batch_id_ocr_capture_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ocr_capture_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_duplicate_of_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("duplicate_of_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_extraction_fields" ADD CONSTRAINT "ocr_extraction_fields_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_period_summaries" ADD CONSTRAINT "match_period_summaries_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_period_summaries" ADD CONSTRAINT "match_period_summaries_ocr_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("ocr_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_shot_type_summaries" ADD CONSTRAINT "match_shot_type_summaries_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_shot_type_summaries" ADD CONSTRAINT "match_shot_type_summaries_ocr_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("ocr_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_actor_player_id_players_id_fk" FOREIGN KEY ("actor_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_events" ADD CONSTRAINT "match_events_ocr_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("ocr_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_goal_events" ADD CONSTRAINT "match_goal_events_event_id_match_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."match_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_goal_events" ADD CONSTRAINT "match_goal_events_scorer_player_id_players_id_fk" FOREIGN KEY ("scorer_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_goal_events" ADD CONSTRAINT "match_goal_events_primary_assist_player_id_players_id_fk" FOREIGN KEY ("primary_assist_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_goal_events" ADD CONSTRAINT "match_goal_events_secondary_assist_player_id_players_id_fk" FOREIGN KEY ("secondary_assist_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_penalty_events" ADD CONSTRAINT "match_penalty_events_event_id_match_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."match_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_penalty_events" ADD CONSTRAINT "match_penalty_events_culprit_player_id_players_id_fk" FOREIGN KEY ("culprit_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_loadout_snapshots" ADD CONSTRAINT "player_loadout_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_loadout_snapshots" ADD CONSTRAINT "player_loadout_snapshots_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_loadout_snapshots" ADD CONSTRAINT "player_loadout_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_loadout_snapshots" ADD CONSTRAINT "player_loadout_snapshots_source_extraction_id_ocr_extractions_id_fk" FOREIGN KEY ("source_extraction_id") REFERENCES "public"."ocr_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_loadout_x_factors" ADD CONSTRAINT "player_loadout_x_factors_loadout_snapshot_id_player_loadout_snapshots_id_fk" FOREIGN KEY ("loadout_snapshot_id") REFERENCES "public"."player_loadout_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_loadout_attributes" ADD CONSTRAINT "player_loadout_attributes_loadout_snapshot_id_player_loadout_snapshots_id_fk" FOREIGN KEY ("loadout_snapshot_id") REFERENCES "public"."player_loadout_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocr_extractions_batch_path_uniq" ON "ocr_extractions" USING btree ("batch_id","source_path");--> statement-breakpoint
CREATE INDEX "ocr_extractions_match_idx" ON "ocr_extractions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "ocr_extractions_review_idx" ON "ocr_extractions" USING btree ("review_status","transform_status");--> statement-breakpoint
CREATE INDEX "ocr_extraction_fields_extraction_idx" ON "ocr_extraction_fields" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX "ocr_extraction_fields_promoted_idx" ON "ocr_extraction_fields" USING btree ("promoted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_period_summaries_uniq" ON "match_period_summaries" USING btree ("match_id","period_number","source");--> statement-breakpoint
CREATE INDEX "match_period_summaries_match_idx" ON "match_period_summaries" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_shot_type_summaries_uniq" ON "match_shot_type_summaries" USING btree ("match_id","team_side","period_number","source");--> statement-breakpoint
CREATE INDEX "match_shot_type_summaries_match_idx" ON "match_shot_type_summaries" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_events_match_idx" ON "match_events" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_events_match_type_idx" ON "match_events" USING btree ("match_id","event_type");--> statement-breakpoint
CREATE INDEX "player_loadout_snapshots_player_idx" ON "player_loadout_snapshots" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_loadout_snapshots_match_idx" ON "player_loadout_snapshots" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_loadout_x_factors_snapshot_slot_uniq" ON "player_loadout_x_factors" USING btree ("loadout_snapshot_id","slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "player_loadout_attributes_snapshot_key_uniq" ON "player_loadout_attributes" USING btree ("loadout_snapshot_id","attribute_key");
