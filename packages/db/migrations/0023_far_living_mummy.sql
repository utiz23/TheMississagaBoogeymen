ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_games_completed" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_games_completed_fc" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_dnf" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_dnf_mm" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_winner_by_dnf" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_quit_disc" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_win_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_desperation_saves" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_poke_checks" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_pk_clear_zone" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_shutout_periods" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_pen_shots" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_pen_saves" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_pen_save_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_brk_shots" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_brk_saves" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_brk_save_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_so_shots" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_so_saves" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_so_save_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_prev_wins" integer;--> statement-breakpoint
ALTER TABLE "ea_member_season_stats" ADD COLUMN "goalie_prev_shutouts" integer;