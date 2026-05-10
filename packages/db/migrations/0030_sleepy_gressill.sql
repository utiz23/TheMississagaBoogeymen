CREATE TABLE "player_display_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_display_aliases" ADD CONSTRAINT "player_display_aliases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "player_display_aliases_player_alias_uniq" ON "player_display_aliases" USING btree ("player_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "player_display_aliases_normalized_idx" ON "player_display_aliases" USING btree ("normalized_alias");