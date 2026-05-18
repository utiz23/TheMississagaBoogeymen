CREATE TABLE "player_persona_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"canonical_persona" text NOT NULL,
	"player_id" integer,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_loadout_snapshots" ADD COLUMN "player_name_persona_raw" text;--> statement-breakpoint
ALTER TABLE "player_persona_aliases" ADD CONSTRAINT "player_persona_aliases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_persona_aliases_normalized_uniq" ON "player_persona_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE INDEX "player_persona_aliases_canonical_idx" ON "player_persona_aliases" USING btree ("canonical_persona");