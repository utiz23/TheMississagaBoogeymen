CREATE TABLE "historical_club_member_season_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"game_mode" text NOT NULL,
	"role_group" text NOT NULL,
	"player_id" integer,
	"gamertag_snapshot" text NOT NULL,
	"player_name_snapshot" text,
	"skater_gp" integer,
	"goalie_gp" integer,
	"goals" integer,
	"assists" integer,
	"points" integer,
	"plus_minus" integer,
	"pim" integer,
	"hits" integer,
	"pp_goals" integer,
	"sh_goals" integer,
	"dnf_pct" numeric(5, 2),
	"pass_pct" numeric(5, 2),
	"wins" integer,
	"losses" integer,
	"otl" integer,
	"save_pct" numeric(5, 2),
	"gaa" numeric(4, 2),
	"shutouts" integer,
	"total_saves" integer,
	"total_goals_against" integer,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	"import_batch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "historical_club_member_stat_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stat_row_id" bigint NOT NULL,
	"source_asset_path" text NOT NULL,
	"sorted_by_metric_label" text NOT NULL,
	"contributed_metrics" text[] NOT NULL,
	"raw_extract_json" jsonb NOT NULL,
	"confidence_score" numeric(5, 2),
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "historical_club_member_season_stats" ADD CONSTRAINT "historical_club_member_season_stats_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_club_member_season_stats" ADD CONSTRAINT "historical_club_member_season_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_club_member_stat_sources" ADD CONSTRAINT "historical_club_member_stat_sources_stat_row_id_historical_club_member_season_stats_id_fk" FOREIGN KEY ("stat_row_id") REFERENCES "public"."historical_club_member_season_stats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hcm_season_stats_player_uniq" ON "historical_club_member_season_stats" USING btree ("game_title_id","game_mode","role_group","player_id") WHERE player_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "hcm_season_stats_unmatched_uniq" ON "historical_club_member_season_stats" USING btree ("game_title_id","game_mode","role_group",lower(gamertag_snapshot)) WHERE player_id IS NULL;--> statement-breakpoint
CREATE INDEX "hcm_sources_stat_row_idx" ON "historical_club_member_stat_sources" USING btree ("stat_row_id");--> statement-breakpoint
CREATE INDEX "hcm_sources_asset_idx" ON "historical_club_member_stat_sources" USING btree ("source_asset_path");