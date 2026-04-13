CREATE TABLE "raw_member_stats_payloads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ea_member_season_stats" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"gamertag" text NOT NULL,
	"player_id" integer NOT NULL,
	"favorite_position" text,
	"games_played" integer DEFAULT 0 NOT NULL,
	"skater_gp" integer DEFAULT 0 NOT NULL,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"points_per_game" numeric(5, 2),
	"plus_minus" integer DEFAULT 0 NOT NULL,
	"pim" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"shot_pct" numeric(5, 2),
	"shot_attempts" integer DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"toi_seconds" integer,
	"faceoff_pct" numeric(5, 2),
	"pass_pct" numeric(5, 2),
	"takeaways" integer DEFAULT 0 NOT NULL,
	"giveaways" integer DEFAULT 0 NOT NULL,
	"goalie_gp" integer DEFAULT 0 NOT NULL,
	"goalie_wins" integer,
	"goalie_losses" integer,
	"goalie_otl" integer,
	"goalie_save_pct" numeric(5, 2),
	"goalie_gaa" numeric(4, 2),
	"goalie_shutouts" integer,
	"goalie_saves" integer,
	"goalie_shots" integer,
	"goalie_goals_against" integer,
	"goalie_toi_seconds" integer,
	"client_platform" text,
	"last_fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_member_stats_payloads" ADD CONSTRAINT "raw_member_stats_payloads_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD CONSTRAINT "ea_member_season_stats_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD CONSTRAINT "ea_member_season_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_member_stats_payloads_title_uniq" ON "raw_member_stats_payloads" USING btree ("game_title_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ea_member_season_stats_uniq" ON "ea_member_season_stats" USING btree ("game_title_id","gamertag");