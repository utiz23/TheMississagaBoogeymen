CREATE TABLE "historical_player_season_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"gamertag_snapshot" text NOT NULL,
	"role_group" text NOT NULL,
	"game_mode" text NOT NULL,
	"position_scope" text NOT NULL,
	"source_game_mode_label" text NOT NULL,
	"source_position_label" text NOT NULL,
	"source_asset_path" text NOT NULL,
	"import_batch" text NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"plus_minus" integer DEFAULT 0 NOT NULL,
	"pim" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"shot_attempts" integer DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"takeaways" integer DEFAULT 0 NOT NULL,
	"giveaways" integer DEFAULT 0 NOT NULL,
	"faceoff_wins" integer,
	"faceoff_losses" integer,
	"faceoff_pct" numeric(5, 2),
	"pass_completions" integer,
	"pass_attempts" integer,
	"pass_pct" numeric(5, 2),
	"blocked_shots" integer DEFAULT 0 NOT NULL,
	"interceptions" integer DEFAULT 0 NOT NULL,
	"sh_goals" integer DEFAULT 0 NOT NULL,
	"gw_goals" integer DEFAULT 0 NOT NULL,
	"toi_seconds" integer,
	"stats_json" jsonb NOT NULL,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	"confidence_score" numeric(5, 2),
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "game_titles" ("slug", "name", "ea_platform", "ea_club_id", "api_base_url", "is_active", "launched_at")
VALUES
	('nhl25', 'NHL 25', 'common-gen5', '19224', 'https://proclubs.ea.com/api/nhl', false, NULL),
	('nhl24', 'NHL 24', 'common-gen5', '19224', 'https://proclubs.ea.com/api/nhl', false, NULL),
	('nhl23', 'NHL 23', 'common-gen5', '19224', 'https://proclubs.ea.com/api/nhl', false, NULL)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD CONSTRAINT "historical_player_season_stats_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD CONSTRAINT "historical_player_season_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "historical_player_season_stats_scope_uniq" ON "historical_player_season_stats" USING btree ("game_title_id","player_id","game_mode","position_scope","role_group");
