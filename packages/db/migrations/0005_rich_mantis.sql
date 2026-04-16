CREATE TABLE "player_profiles" (
	"player_id" integer PRIMARY KEY NOT NULL,
	"jersey_number" integer,
	"nationality" text,
	"preferred_position" text,
	"bio" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;