ALTER TABLE "player_game_title_stats" ADD COLUMN "shot_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "toi_seconds" integer;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "otl" integer;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "total_saves" integer;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "total_shots_against" integer;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "total_goals_against" integer;