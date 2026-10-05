-- Seed the NHL 27 game title for The Boogeymen (club #1650, platform: common-gen5).
--
-- Confirmed against a live EA API capture on 2026-09-04 — see
-- research/ea-api/nhl27-club1650/matches-gametype5-2026-09-04.json and the
-- "NHL 27 ENABLED" HANDOFF.md Active State entry for full provenance.
--
-- api_base_url matches EA_API_BASE in packages/ea-client/src/client.ts.
-- launched_at is left NULL: chronology is carried by release_order (27), not
-- by a launch date.
--
-- Requires migration 0057 (is_default / release_order): run after the migrations.
--
-- Default policy (E1J, 2026-09-08): NHL 27 is the frontend default. When this
-- seed CREATES the nhl27 row it takes the default from whichever title held it,
-- so migrations → game_titles.sql → this file ends with NHL 27 as the default.
-- A re-run never touches the default or release_order.
--
-- Idempotent and safe to re-run on any host:
--   - if no 'nhl27' row exists, inserts it (active, release_order 27, default);
--   - if one exists with matching ea_club_id/ea_platform/api_base_url,
--     activates it (no-op if already active) without touching any other
--     column — in particular launched_at, is_default and release_order;
--   - if one exists with a DIFFERENT ea_club_id/ea_platform/api_base_url,
--     raises instead of silently overwriting — resolve the conflict by hand.
--
-- Resolution is always by slug, never by numeric id: game_titles.id is not
-- guaranteed to match across independently-provisioned databases.
-- Apart from handing over the default on first insert, does not touch the
-- 'nhl26' row or any other title.

DO $$
DECLARE
  existing game_titles%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM game_titles WHERE slug = 'nhl27';

  IF FOUND THEN
    IF existing.ea_club_id IS DISTINCT FROM '1650'
       OR existing.ea_platform IS DISTINCT FROM 'common-gen5'
       OR existing.api_base_url IS DISTINCT FROM 'https://proclubs.ea.com/api/nhl' THEN
      RAISE EXCEPTION
        'nhl27 game_titles row exists with conflicting configuration (ea_club_id=%, ea_platform=%, api_base_url=%). Refusing to overwrite — resolve manually.',
        existing.ea_club_id, existing.ea_platform, existing.api_base_url;
    END IF;

    UPDATE game_titles SET is_active = true WHERE slug = 'nhl27' AND is_active = false;
  ELSE
    -- Clear first: the partial unique index allows at most one default.
    UPDATE game_titles SET is_default = false WHERE is_default;
    INSERT INTO game_titles (slug, name, ea_platform, ea_club_id, api_base_url, is_active, launched_at, release_order, is_default)
    VALUES ('nhl27', 'NHL 27', 'common-gen5', '1650', 'https://proclubs.ea.com/api/nhl', true, NULL, 27, true);
  END IF;
END $$;
