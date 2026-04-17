ALTER TABLE "player_game_title_stats" ADD COLUMN "skater_gp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "goalie_gp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "skater_toi_seconds" integer;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "goalie_toi_seconds" integer;--> statement-breakpoint
CREATE INDEX "player_match_stats_lineup_idx" ON "player_match_stats" USING btree ("match_id","position","player_id");--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD CONSTRAINT "player_match_stats_position_check" CHECK ("player_match_stats"."position" IN ('goalie', 'center', 'defenseMen', 'leftWing', 'rightWing'));