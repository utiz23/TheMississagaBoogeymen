CREATE TABLE "game_titles" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"ea_platform" text NOT NULL,
	"ea_club_id" text NOT NULL,
	"api_base_url" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"launched_at" date,
	CONSTRAINT "game_titles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "content_seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"starts_at" date NOT NULL,
	"ends_at" date,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"match_type" text NOT NULL,
	"matches_found" integer DEFAULT 0 NOT NULL,
	"matches_new" integer DEFAULT 0 NOT NULL,
	"transforms_failed" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	CONSTRAINT "ingestion_log_status_check" CHECK ("ingestion_log"."status" IN ('success', 'partial', 'error'))
);
--> statement-breakpoint
CREATE TABLE "raw_match_payloads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"ea_match_id" text NOT NULL,
	"match_type" text NOT NULL,
	"source_endpoint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"transform_status" text DEFAULT 'pending' NOT NULL,
	"transform_error" text,
	"ingestion_log_id" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_match_payloads_transform_status_check" CHECK ("raw_match_payloads"."transform_status" IN ('pending', 'success', 'error'))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"ea_match_id" text NOT NULL,
	"match_type" text NOT NULL,
	"content_season_id" integer,
	"opponent_club_id" text NOT NULL,
	"opponent_name" text NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"score_for" integer NOT NULL,
	"score_against" integer NOT NULL,
	"shots_for" integer NOT NULL,
	"shots_against" integer NOT NULL,
	"hits_for" integer NOT NULL,
	"hits_against" integer NOT NULL,
	"faceoff_pct" numeric(5, 2),
	"time_on_attack" integer,
	"penalty_minutes" integer,
	CONSTRAINT "matches_result_check" CHECK ("matches"."result" IN ('WIN', 'LOSS', 'OTL', 'DNF')),
	CONSTRAINT "matches_match_type_check" CHECK ("matches"."match_type" IN ('gameType5', 'gameType10', 'club_private'))
);
--> statement-breakpoint
CREATE TABLE "player_gamertag_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"gamertag" text NOT NULL,
	"seen_from" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"ea_id" text,
	"gamertag" text NOT NULL,
	"position" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_ea_id_unique" UNIQUE("ea_id")
);
--> statement-breakpoint
CREATE TABLE "player_match_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"match_id" integer NOT NULL,
	"position" text,
	"is_goalie" boolean DEFAULT false NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"plus_minus" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"pim" integer DEFAULT 0 NOT NULL,
	"takeaways" integer DEFAULT 0 NOT NULL,
	"giveaways" integer DEFAULT 0 NOT NULL,
	"faceoff_wins" integer DEFAULT 0 NOT NULL,
	"faceoff_losses" integer DEFAULT 0 NOT NULL,
	"pass_attempts" integer DEFAULT 0 NOT NULL,
	"pass_completions" integer DEFAULT 0 NOT NULL,
	"saves" integer,
	"goals_against" integer,
	"shots_against" integer
);
--> statement-breakpoint
CREATE TABLE "club_game_title_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"otl" integer DEFAULT 0 NOT NULL,
	"goals_for" integer DEFAULT 0 NOT NULL,
	"goals_against" integer DEFAULT 0 NOT NULL,
	"shots_per_game" numeric(5, 2),
	"hits_per_game" numeric(5, 2),
	"faceoff_pct" numeric(5, 2),
	"pass_pct" numeric(5, 2),
	CONSTRAINT "club_game_title_stats_game_title_id_unique" UNIQUE("game_title_id")
);
--> statement-breakpoint
CREATE TABLE "player_game_title_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"game_title_id" integer NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"plus_minus" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"pim" integer DEFAULT 0 NOT NULL,
	"takeaways" integer DEFAULT 0 NOT NULL,
	"giveaways" integer DEFAULT 0 NOT NULL,
	"faceoff_pct" numeric(5, 2),
	"pass_pct" numeric(5, 2),
	"wins" integer,
	"losses" integer,
	"save_pct" numeric(5, 2),
	"gaa" numeric(4, 2),
	"shutouts" integer
);
--> statement-breakpoint
ALTER TABLE "content_seasons" ADD CONSTRAINT "content_seasons_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_log" ADD CONSTRAINT "ingestion_log_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_match_payloads" ADD CONSTRAINT "raw_match_payloads_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_match_payloads" ADD CONSTRAINT "raw_match_payloads_ingestion_log_id_ingestion_log_id_fk" FOREIGN KEY ("ingestion_log_id") REFERENCES "public"."ingestion_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_content_season_id_content_seasons_id_fk" FOREIGN KEY ("content_season_id") REFERENCES "public"."content_seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_gamertag_history" ADD CONSTRAINT "player_gamertag_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_game_title_stats" ADD CONSTRAINT "club_game_title_stats_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD CONSTRAINT "player_game_title_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD CONSTRAINT "player_game_title_stats_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_seasons_title_number_uniq" ON "content_seasons" USING btree ("game_title_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_match_payloads_title_match_uniq" ON "raw_match_payloads" USING btree ("game_title_id","ea_match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_title_match_uniq" ON "matches" USING btree ("game_title_id","ea_match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_gamertag_history_open_ended_uniq" ON "player_gamertag_history" USING btree ("player_id") WHERE "player_gamertag_history"."seen_until" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "player_match_stats_player_match_uniq" ON "player_match_stats" USING btree ("player_id","match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_game_title_stats_uniq" ON "player_game_title_stats" USING btree ("player_id","game_title_id");