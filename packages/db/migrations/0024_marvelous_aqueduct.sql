ALTER TABLE "player_match_stats" ADD COLUMN "rating_offense" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "rating_defense" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "rating_teamplay" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "rank_points" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "rank_tier_asset_id" text;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "player_level" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "player_class" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "pos_sorted" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "removed_reason" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "team_side" integer;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "rating_offense" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "rating_defense" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "rating_teamplay" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "rank_points" integer;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "rank_tier_asset_id" text;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "player_level" integer;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "player_class" integer;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "pos_sorted" integer;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "removed_reason" integer;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD COLUMN "team_side" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_shot_locations" jsonb;