ALTER TABLE "player_match_stats" DROP CONSTRAINT "player_match_stats_match_id_matches_id_fk";
ALTER TABLE "player_match_stats" ALTER COLUMN "match_id" TYPE bigint;
ALTER TABLE "player_match_stats"
  ADD CONSTRAINT "player_match_stats_match_id_matches_id_fk"
  FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
