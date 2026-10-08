-- Migration: the two EASHL AI goaltenders as players
-- Spec: docs/superpowers/specs/2026-10-08-ai-goalies-design.md
--
-- When no human BGM goalie plays, EA puts an AI goalie in net: Matteo Lehmann
-- for the home side, Jonas Wagner for the away side. They become ordinary
-- players, marked by players.ai_goalie_side. The worker's AI-goalie sync writes
-- their per-game rows (player_match_stats) and season totals
-- (ea_member_season_stats) from each match's team totals; that data is derived
-- and rebuilt every cycle, so only these two player rows are hand-made here.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0061):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0062_ai_goalies.sql
-- Apply BEFORE deploying the code that reads it. Idempotent.
-- ROLLBACK (after the sync has run, delete their derived rows first):
--   DELETE FROM player_match_stats WHERE player_id IN (SELECT id FROM players WHERE ai_goalie_side IS NOT NULL);
--   DELETE FROM ea_member_season_stats WHERE player_id IN (SELECT id FROM players WHERE ai_goalie_side IS NOT NULL);
--   DELETE FROM player_game_title_stats WHERE player_id IN (SELECT id FROM players WHERE ai_goalie_side IS NOT NULL);
--   (card tables cascade) DELETE FROM players WHERE ai_goalie_side IS NOT NULL;
--   ALTER TABLE players DROP COLUMN ai_goalie_side;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "players" ADD COLUMN IF NOT EXISTS "ai_goalie_side" text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'players_ai_goalie_side_check') THEN
    ALTER TABLE "players" ADD CONSTRAINT "players_ai_goalie_side_check"
      CHECK ("ai_goalie_side" IS NULL OR "ai_goalie_side" IN ('home', 'away'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "players_ai_goalie_side_uniq"
  ON "players" ("ai_goalie_side") WHERE "ai_goalie_side" IS NOT NULL;

INSERT INTO "players" ("gamertag", "position", "is_active", "ai_goalie_side")
SELECT 'Matteo Lehmann', 'goalie', true, 'home'
WHERE NOT EXISTS (SELECT 1 FROM "players" WHERE "ai_goalie_side" = 'home');

INSERT INTO "players" ("gamertag", "position", "is_active", "ai_goalie_side")
SELECT 'Jonas Wagner', 'goalie', true, 'away'
WHERE NOT EXISTS (SELECT 1 FROM "players" WHERE "ai_goalie_side" = 'away');

INSERT INTO "player_profiles" ("player_id", "player_name", "preferred_position")
SELECT "id", "gamertag", 'goalie' FROM "players" WHERE "ai_goalie_side" IS NOT NULL
ON CONFLICT ("player_id") DO NOTHING;

COMMIT;

SELECT p."id", p."gamertag", p."ai_goalie_side", pp."player_name"
FROM "players" p LEFT JOIN "player_profiles" pp ON pp."player_id" = p."id"
WHERE p."ai_goalie_side" IS NOT NULL ORDER BY p."ai_goalie_side" DESC;
