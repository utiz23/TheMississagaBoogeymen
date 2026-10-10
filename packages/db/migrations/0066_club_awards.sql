-- Migration: club awards (trophy case) move from code into the database
-- Plan: docs/superpowers/plans/2026-10-09-admin-tools.md (release C3).
--
-- Club-vote trophies and championship banners — the awards stats can't
-- produce — were hand-entered in apps/web/src/components/awards/club-awards.ts.
-- They now live here so the admin edits them on /admin/awards.
--
--   club_awards          one row per trophy or banner, tied to a game title
--   club_award_players   who it went to (real FKs: a typo can't point at a
--                        missing player), in display order
--
-- A trophy is mvp/defense/rookie with a source: 'vote' (a real club vote) or
-- 'stats' (no vote on record — picked from the archive; the reason is shown on
-- the page). A banner is a championship ('3s', '6s' or 'arcade').
--
-- The seed reproduces the 11 entries of club-awards.ts as of 2026-10-09, in
-- the same order, and only runs while club_awards is empty (re-running is a
-- no-op). Notes carried over from that file: NHL 22–24 had no vote on record;
-- no Rookie for any of them (the archive starts at NHL 22, NHL 23's only
-- newcomer played 7 games, NHL 24's joseph4577 is a 10-year veteran back from
-- retirement — operator veto 2026-10-08 — leaving BoshBandrews' 6 games).
--
-- HOW TO APPLY — HAND-APPLIED (journal frozen at 0045; same form as 0057–0065):
--   docker exec -i -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
--     eanhl-team-website-db-1 psql -U eanhl -d <database> -v ON_ERROR_STOP=1 -f - \
--     < packages/db/migrations/0066_club_awards.sql
-- Apply BEFORE deploying the code that reads it (the old code ignores it).
-- ROLLBACK: DROP TABLE IF EXISTS "club_award_players"; DROP TABLE IF EXISTS "club_awards";

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "club_awards" (
  "id" serial PRIMARY KEY,
  "kind" text NOT NULL CHECK ("kind" IN ('trophy', 'banner')),
  "trophy" text CHECK ("trophy" IN ('mvp', 'defense', 'rookie')),
  "mode" text,
  "game_title_id" integer NOT NULL REFERENCES "game_titles"("id"),
  "source" text CHECK ("source" IN ('vote', 'stats')),
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "club_awards_shape" CHECK (
    ("kind" = 'trophy' AND "trophy" IS NOT NULL AND "mode" IS NULL AND (
      ("source" = 'vote' AND "reason" IS NULL) OR ("source" = 'stats' AND "reason" IS NOT NULL)))
    OR
    ("kind" = 'banner' AND "mode" IS NOT NULL AND "trophy" IS NULL
      AND "source" IS NULL AND "reason" IS NULL)
  )
);

-- Named and re-created so re-running fixes a table made before '6s' was added
-- (the first draft of this file allowed only 3s/arcade; test/preview only).
ALTER TABLE "club_awards" DROP CONSTRAINT IF EXISTS "club_awards_mode_check";
ALTER TABLE "club_awards" ADD CONSTRAINT "club_awards_mode_check"
  CHECK ("mode" IN ('3s', '6s', 'arcade'));

CREATE TABLE IF NOT EXISTS "club_award_players" (
  "award_id" integer NOT NULL REFERENCES "club_awards"("id") ON DELETE CASCADE,
  "player_id" integer NOT NULL REFERENCES "players"("id"),
  "position" smallint NOT NULL,
  PRIMARY KEY ("award_id", "player_id")
);

CREATE INDEX IF NOT EXISTS "club_award_players_player_idx" ON "club_award_players" ("player_id");

DO $$
DECLARE
  r record;
  title_id integer;
  award_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "club_awards") THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'trophy', 'mvp', NULL, 'NHL 25', 'vote', NULL, ARRAY[3]),
      (2, 'trophy', 'defense', NULL, 'NHL 25', 'vote', NULL, ARRAY[1]),
      (3, 'trophy', 'rookie', NULL, 'NHL 25', 'vote', NULL, ARRAY[8]),
      (4, 'trophy', 'mvp', NULL, 'NHL 24', 'stats',
        'Led the club in goals (726), assists (1,106), points (1,832) and plus-minus (+440), and also played 150 games in goal (68 W, 11 shutouts).',
        ARRAY[2]),
      (5, 'trophy', 'defense', NULL, 'NHL 24', 'stats',
        'Most blocked shots (554) and interceptions (3,374) on the club, +364, with 334 games on defense.',
        ARRAY[5]),
      (6, 'trophy', 'mvp', NULL, 'NHL 23', 'stats',
        'Led the club in goals (626), assists (693) and points (1,319), and also played 67 games in goal (33 W).',
        ARRAY[5]),
      (7, 'trophy', 'defense', NULL, 'NHL 23', 'stats',
        'Full-time defenseman (298 games on D) with the most interceptions per game on the club (6.4).',
        ARRAY[1]),
      (8, 'trophy', 'mvp', NULL, 'NHL 22', 'stats',
        'Led the club in goals (427) and points (850), and also played 81 games in goal (35 W).',
        ARRAY[5]),
      (9, 'trophy', 'defense', NULL, 'NHL 22', 'stats',
        'Full-time defenseman with the club’s best plus-minus (+208) and the most takeaways (1,236), blocked shots (173) and interceptions (2,189).',
        ARRAY[1]),
      (10, 'banner', NULL, '3s', 'NHL 24', NULL, NULL, ARRAY[2, 5, 3, 6]),
      (11, 'banner', NULL, 'arcade', 'NHL 23', NULL, NULL, ARRAY[2, 3, 5])
    ) AS s(ord, kind, trophy, mode, title, source, reason, player_ids)
    ORDER BY ord
  LOOP
    SELECT id INTO title_id FROM "game_titles" WHERE name = r.title;
    CONTINUE WHEN title_id IS NULL;
    INSERT INTO "club_awards" ("kind", "trophy", "mode", "game_title_id", "source", "reason")
      VALUES (r.kind, r.trophy, r.mode, title_id, r.source, r.reason)
      RETURNING id INTO award_id;
    INSERT INTO "club_award_players" ("award_id", "player_id", "position")
      SELECT award_id, u.pid, u.ord
      FROM unnest(r.player_ids) WITH ORDINALITY AS u(pid, ord)
      WHERE EXISTS (SELECT 1 FROM "players" p WHERE p.id = u.pid);
  END LOOP;
END $$;

COMMIT;

SELECT a.kind, coalesce(a.trophy, a.mode) AS what, g.name AS title, a.source,
  string_agg(p.player_id::text, ',' ORDER BY p.position) AS players
FROM "club_awards" a
JOIN "game_titles" g ON g.id = a.game_title_id
LEFT JOIN "club_award_players" p ON p.award_id = a.id
GROUP BY a.id, g.name
ORDER BY a.id;
