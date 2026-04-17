CREATE TABLE "club_season_rank" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"wins" integer,
	"losses" integer,
	"otl" integer,
	"games_played" integer,
	"points" integer,
	"ranking_points" integer,
	"projected_points" integer,
	"current_division" integer,
	"division_name" text,
	"points_for_promotion" integer,
	"points_to_hold_division" integer,
	"points_to_title" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_season_rank" ADD CONSTRAINT "club_season_rank_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "club_season_rank_game_title_uniq" ON "club_season_rank" USING btree ("game_title_id");