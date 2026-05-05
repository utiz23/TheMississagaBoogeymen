ALTER TABLE "ea_member_season_stats" ADD COLUMN "skater_wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "skater_losses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "skater_otl" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "skater_winner_by_dnf" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "skater_win_pct" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "skater_dnf" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "games_completed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "games_completed_fc" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "player_quit_disc" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "lw_gp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "rw_gp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "c_gp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "d_gp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "power_play_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "short_handed_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "game_winning_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "hat_tricks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "shots_per_game" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "shot_on_net_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "breakaways" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "breakaway_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "breakaway_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "passes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "pass_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "interceptions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "dekes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "dekes_made" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "deflections" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "saucer_passes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "screen_chances" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "screen_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "possession_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "xfactor_zone_used" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "hits_per_game" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "fights" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "fights_won" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "blocked_shots" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "pk_clear_zone" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "offsides" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "offsides_per_game" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "penalties_drawn" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "faceoff_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "faceoff_wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "faceoff_losses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "penalty_shot_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "penalty_shot_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "penalty_shot_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "prev_goals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "prev_assists" integer DEFAULT 0 NOT NULL;