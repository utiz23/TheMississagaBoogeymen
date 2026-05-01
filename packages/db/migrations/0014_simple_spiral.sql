CREATE TABLE "opponent_player_match_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"ea_player_id" text NOT NULL,
	"opponent_club_id" text NOT NULL,
	"gamertag" text NOT NULL,
	"position" text,
	"is_goalie" boolean DEFAULT false NOT NULL,
	"is_guest" boolean DEFAULT false NOT NULL,
	"player_dnf" boolean DEFAULT false NOT NULL,
	"client_platform" text,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"plus_minus" integer DEFAULT 0 NOT NULL,
	"shots" integer DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"pim" integer DEFAULT 0 NOT NULL,
	"takeaways" integer DEFAULT 0 NOT NULL,
	"giveaways" integer DEFAULT 0 NOT NULL,
	"faceoff_wins" integer DEFAULT 0 NOT NULL,
	"faceoff_losses" integer DEFAULT 0 NOT NULL,
	"pass_attempts" integer DEFAULT 0 NOT NULL,
	"pass_completions" integer DEFAULT 0 NOT NULL,
	"toi_seconds" integer,
	"shot_attempts" integer DEFAULT 0 NOT NULL,
	"blocked_shots" integer DEFAULT 0 NOT NULL,
	"pp_goals" integer DEFAULT 0 NOT NULL,
	"sh_goals" integer DEFAULT 0 NOT NULL,
	"interceptions" integer DEFAULT 0 NOT NULL,
	"penalties_drawn" integer DEFAULT 0 NOT NULL,
	"possession" integer DEFAULT 0 NOT NULL,
	"deflections" integer DEFAULT 0 NOT NULL,
	"saucer_passes" integer DEFAULT 0 NOT NULL,
	"saves" integer,
	"goals_against" integer,
	"shots_against" integer,
	"breakaway_saves" integer,
	"breakaway_shots" integer,
	"desp_saves" integer,
	"pen_saves" integer,
	"pen_shots" integer,
	"pokechecks" integer,
	CONSTRAINT "opponent_player_match_stats_position_check" CHECK ("opponent_player_match_stats"."position" IN ('goalie', 'center', 'defenseMen', 'leftWing', 'rightWing'))
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "penalty_minutes_against" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "time_on_attack_against" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pass_attempts_against" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pass_completions_against" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pp_goals_against" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "pp_opportunities_against" integer;--> statement-breakpoint
ALTER TABLE "opponent_player_match_stats" ADD CONSTRAINT "opponent_player_match_stats_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opponent_player_match_stats_match_player_uniq" ON "opponent_player_match_stats" USING btree ("match_id","ea_player_id");--> statement-breakpoint
CREATE INDEX "opponent_player_match_stats_match_idx" ON "opponent_player_match_stats" USING btree ("match_id");