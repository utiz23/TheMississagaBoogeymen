-- Seed the NHL 27 game title for The Boogeymen (club #1650, platform: common-gen5).
--
-- Confirmed against a live EA API capture on 2026-09-04 — see
-- research/ea-api/nhl27-club1650/matches-gametype5-2026-09-04.json and the
-- "NHL 27 ENABLED" HANDOFF.md Active State entry for full provenance.
--
-- api_base_url matches EA_API_BASE in packages/ea-client/src/client.ts.
-- launched_at is intentionally left NULL: no NHL 27 launch date has been
-- decided (see HANDOFF.md Gate 2 "NHL 27 readiness" — the cutover rules are
-- still an open decision as of this seed).
--
-- Idempotent and safe to re-run on any host:
--   - if no 'nhl27' row exists, inserts it (active);
--   - if one exists with matching ea_club_id/ea_platform/api_base_url,
--     activates it (no-op if already active) without touching any other
--     column, in particular launched_at;
--   - if one exists with a DIFFERENT ea_club_id/ea_platform/api_base_url,
--     raises instead of silently overwriting — resolve the conflict by hand.
--
-- Resolution is always by slug, never by numeric id: game_titles.id is not
-- guaranteed to match across independently-provisioned databases.
-- Does not touch the 'nhl26' row or any other title.

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
    INSERT INTO game_titles (slug, name, ea_platform, ea_club_id, api_base_url, is_active, launched_at)
    VALUES ('nhl27', 'NHL 27', 'common-gen5', '1650', 'https://proclubs.ea.com/api/nhl', true, NULL);
  END IF;
END $$;
