-- Migration: player-card progression — badge levels, card standing, card history
-- Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md (Part 1),
-- amended by docs/superpowers/specs/2026-10-08-season-cards-design.md: one card
-- per (player, game title), each title its own season.
--
-- Derived data, recomputed by the worker (`card-recompute`) from each title's EA
-- season totals and site-recorded matches. Everything here can be rebuilt EXCEPT
-- hand-awarded mythics (tier_pool = 'manual', set by `card-mythic`) and the event
-- history in player_card_events.
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0059):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0060_player_card_progression.sql
-- Test run: <database> = eanhl_preview (re-apply after the 2026-10-08 per-title amendment:
-- it drops the career-wide draft tables there). Live (Hotel-Echo) only at the switch,
-- after a fresh backup.
-- Idempotent.
-- ROLLBACK: DROP TABLE IF EXISTS "player_card_events", "player_card_progress", "player_badge_levels";

BEGIN;

SET LOCAL lock_timeout = '5s';

-- The first (career-wide) draft of these tables had no game_title_id. It was
-- only ever applied on the eanhl_preview test database, never on live. Drop that
-- shape so the CREATEs below build the per-title one; a per-title table is kept.
DO $$
BEGIN
  IF to_regclass('player_card_progress') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'player_card_progress'
      AND column_name = 'game_title_id'
  ) THEN
    DROP TABLE IF EXISTS "player_card_events", "player_card_progress", "player_badge_levels";
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "player_badge_levels" (
  "player_id"     integer NOT NULL REFERENCES "players" ("id") ON DELETE CASCADE,
  "game_title_id" integer NOT NULL REFERENCES "game_titles" ("id") ON DELETE CASCADE,
  "family_id"     text NOT NULL,
  "value"         integer NOT NULL,
  "level"         smallint NOT NULL,
  "computed_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_badge_levels_pk" PRIMARY KEY ("player_id", "game_title_id", "family_id"),
  CONSTRAINT "player_badge_levels_family_check" CHECK ("family_id" IN (
    'p3v3', 'p6v6', 'p6g', 'pwins', 'pgoals', 'pasts', 'pshots', 'pdekes', 'pht', 'pbrk',
    'phits', 'pfo', 'ptka', 'pblk', 'pfight', 'gg', 'gw', 'gsv', 'gdsv', 'gpoke', 'gso')),
  CONSTRAINT "player_badge_levels_level_check" CHECK ("level" BETWEEN 0 AND 30),
  CONSTRAINT "player_badge_levels_value_check" CHECK ("value" >= 0)
);

-- created_at: when this card's history began (the locker's "History starts …").
-- Set once by the DEFAULT; the worker and card-mythic upserts never update it.
CREATE TABLE IF NOT EXISTS "player_card_progress" (
  "player_id"     integer NOT NULL REFERENCES "players" ("id") ON DELETE CASCADE,
  "game_title_id" integer NOT NULL REFERENCES "game_titles" ("id") ON DELETE CASCADE,
  "tier"          smallint NOT NULL,
  "level"         smallint NOT NULL,
  "tier_pool"     text NOT NULL,
  "mythic_theme"  text,
  "computed_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_card_progress_pk" PRIMARY KEY ("player_id", "game_title_id"),
  CONSTRAINT "player_card_progress_tier_check" CHECK ("tier" BETWEEN 1 AND 6),
  CONSTRAINT "player_card_progress_level_check" CHECK ("level" BETWEEN 1 AND 10),
  CONSTRAINT "player_card_progress_pool_check" CHECK ("tier_pool" IN ('skater', 'goalie', 'manual')),
  CONSTRAINT "player_card_progress_mythic_check" CHECK (
    "mythic_theme" IS NULL OR "mythic_theme" IN ('frozen', 'futureC', 'inferno', 'stormLive', 'olympus')),
  CONSTRAINT "player_card_progress_manual_check" CHECK (
    ("tier" = 6) = ("tier_pool" = 'manual') AND ("tier_pool" = 'manual') = ("mythic_theme" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "player_card_events" (
  "id"            bigserial PRIMARY KEY,
  "player_id"     integer NOT NULL REFERENCES "players" ("id") ON DELETE CASCADE,
  "game_title_id" integer NOT NULL REFERENCES "game_titles" ("id") ON DELETE CASCADE,
  "kind"          text NOT NULL,
  "family_id"     text,
  "from_value"    smallint NOT NULL,
  "to_value"      smallint NOT NULL,
  "occurred_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "player_card_events_kind_check" CHECK ("kind" IN
    ('tier_up', 'level_up', 'badge_level_up', 'mythic_awarded', 'mythic_cleared')),
  CONSTRAINT "player_card_events_family_check" CHECK (("kind" = 'badge_level_up') = ("family_id" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "player_card_events_player_idx"
  ON "player_card_events" ("player_id", "game_title_id", "occurred_at" DESC);

COMMIT;

SELECT 'player_badge_levels' AS "table", count(*) AS "rows" FROM "player_badge_levels"
UNION ALL SELECT 'player_card_progress', count(*) FROM "player_card_progress"
UNION ALL SELECT 'player_card_events', count(*) FROM "player_card_events";
