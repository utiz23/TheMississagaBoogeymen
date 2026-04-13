ALTER TABLE "matches" ADD COLUMN "ea_game_type_code" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "game_mode" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pass_attempts" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pass_completions" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pp_goals" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pp_opportunities" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "shot_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "blocked_shots" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "pp_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "sh_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "interceptions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "penalties_drawn" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "possession" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "deflections" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "saucer_passes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "client_platform" text;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "player_dnf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "breakaway_saves" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "breakaway_shots" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "desp_saves" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "pen_saves" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "pen_shots" integer;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "pokechecks" integer;