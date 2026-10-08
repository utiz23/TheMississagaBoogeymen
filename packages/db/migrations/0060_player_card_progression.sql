-- Migration: player-card progression — badge levels, card standing, card history
-- Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md (Part 1).
--
-- Derived data, recomputed by the worker (`card-recompute`) from EA season totals,
-- reviewed NHL 22-25 history and site-recorded matches. Everything here can be
-- rebuilt EXCEPT hand-awarded mythics (tier_pool = 'manual', set by `card-mythic`)
-- and the event history in player_card_events.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0059):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0060_player_card_progression.sql
-- Test run: <database> = eanhl_preview. Live (Hotel-Echo) only at the switch, after a fresh backup.
-- Idempotent.
-- ROLLBACK: DROP TABLE IF EXISTS "player_card_events", "player_card_progress", "player_badge_levels";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "player_badge_levels" (
  "player_id"   integer NOT NULL REFERENCES "players" ("id") ON DELETE CASCADE,
  "family_id"   text NOT NULL,
  "value"       integer NOT NULL,
  "level"       smallint NOT NULL,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_badge_levels_pk" PRIMARY KEY ("player_id", "family_id"),
  CONSTRAINT "player_badge_levels_family_check" CHECK ("family_id" IN (
    'p3v3', 'p6v6', 'p6g', 'pwins', 'pgoals', 'pasts', 'pshots', 'pdekes', 'pht', 'pbrk',
    'phits', 'pfo', 'ptka', 'pblk', 'pfight', 'gg', 'gw', 'gsv', 'gdsv', 'gpoke', 'gso')),
  CONSTRAINT "player_badge_levels_level_check" CHECK ("level" BETWEEN 0 AND 30),
  CONSTRAINT "player_badge_levels_value_check" CHECK ("value" >= 0)
);

CREATE TABLE IF NOT EXISTS "player_card_progress" (
  "player_id"    integer PRIMARY KEY REFERENCES "players" ("id") ON DELETE CASCADE,
  "tier"         smallint NOT NULL,
  "level"        smallint NOT NULL,
  "tier_pool"    text NOT NULL,
  "mythic_theme" text,
  "computed_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_card_progress_tier_check" CHECK ("tier" BETWEEN 1 AND 6),
  CONSTRAINT "player_card_progress_level_check" CHECK ("level" BETWEEN 1 AND 10),
  CONSTRAINT "player_card_progress_pool_check" CHECK ("tier_pool" IN ('skater', 'goalie', 'manual')),
  CONSTRAINT "player_card_progress_mythic_check" CHECK (
    "mythic_theme" IS NULL OR "mythic_theme" IN ('frozen', 'futureC', 'inferno', 'stormLive', 'olympus')),
  CONSTRAINT "player_card_progress_manual_check" CHECK (
    ("tier" = 6) = ("tier_pool" = 'manual') AND ("tier_pool" = 'manual') = ("mythic_theme" IS NOT NULL))
);

-- created_at: when this player's card history began (the locker's "History starts …").
-- Set once by the DEFAULT; the worker and card-mythic upserts never update it.
-- Added during the test run (step 3): a no-op where the CREATE above already made it.
ALTER TABLE "player_card_progress"
  ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS "player_card_events" (
  "id"          bigserial PRIMARY KEY,
  "player_id"   integer NOT NULL REFERENCES "players" ("id") ON DELETE CASCADE,
  "kind"        text NOT NULL,
  "family_id"   text,
  "from_value"  smallint NOT NULL,
  "to_value"    smallint NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_card_events_kind_check" CHECK ("kind" IN
    ('tier_up', 'level_up', 'badge_level_up', 'mythic_awarded', 'mythic_cleared')),
  CONSTRAINT "player_card_events_family_check" CHECK (("kind" = 'badge_level_up') = ("family_id" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "player_card_events_player_idx"
  ON "player_card_events" ("player_id", "occurred_at" DESC);

COMMIT;

SELECT 'player_badge_levels' AS "table", count(*) AS "rows" FROM "player_badge_levels"
UNION ALL SELECT 'player_card_progress', count(*) FROM "player_card_progress"
UNION ALL SELECT 'player_card_events', count(*) FROM "player_card_events";
