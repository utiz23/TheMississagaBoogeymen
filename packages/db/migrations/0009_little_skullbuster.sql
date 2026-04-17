CREATE TABLE "club_seasonal_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_title_id" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"otl" integer NOT NULL,
	"games_played" integer NOT NULL,
	"record" text,
	"ranking_points" integer,
	"goals" integer,
	"goals_against" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_seasonal_stats" ADD CONSTRAINT "club_seasonal_stats_game_title_id_game_titles_id_fk" FOREIGN KEY ("game_title_id") REFERENCES "public"."game_titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "club_seasonal_stats_game_title_uniq" ON "club_seasonal_stats" USING btree ("game_title_id");