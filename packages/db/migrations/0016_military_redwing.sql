ALTER TABLE "historical_player_season_stats" ADD COLUMN "wins" integer;--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "losses" integer;--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "otl" integer;--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "save_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "gaa" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "shutouts" integer;--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "total_saves" integer;--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "total_shots_against" integer;--> statement-breakpoint
ALTER TABLE "historical_player_season_stats" ADD COLUMN "total_goals_against" integer;