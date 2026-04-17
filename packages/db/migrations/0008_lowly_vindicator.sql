ALTER TABLE "club_game_title_stats" DROP CONSTRAINT "club_game_title_stats_game_title_id_unique";--> statement-breakpoint
DROP INDEX "player_game_title_stats_uniq";--> statement-breakpoint
ALTER TABLE "club_game_title_stats" ADD COLUMN "game_mode" text;--> statement-breakpoint
ALTER TABLE "player_game_title_stats" ADD COLUMN "game_mode" text;--> statement-breakpoint
CREATE UNIQUE INDEX "club_game_title_stats_uniq" ON "club_game_title_stats" USING btree ("game_title_id",COALESCE("game_mode", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "player_game_title_stats_uniq" ON "player_game_title_stats" USING btree ("player_id","game_title_id",COALESCE("game_mode", ''));