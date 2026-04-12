-- Phase 5.2: add toi_seconds to player_match_stats.
--
-- Also widens match_id from integer to bigint to match matches.id (bigserial).
-- On a fresh DB this runs as the second migration after 0000_big_forgotten_one.
-- On the live DB the bigint change was already applied manually; the SET DATA TYPE
-- statement is a no-op (integer→bigint is an implicit cast; PostgreSQL accepts it).

ALTER TABLE "player_match_stats" ALTER COLUMN "match_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "player_match_stats" ADD COLUMN "toi_seconds" integer;
