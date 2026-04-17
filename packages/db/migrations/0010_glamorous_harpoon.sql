CREATE TABLE "opponent_clubs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ea_club_id" text NOT NULL,
	"name" text NOT NULL,
	"crest_asset_id" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "opponent_clubs_ea_club_id_uniq" ON "opponent_clubs" USING btree ("ea_club_id");