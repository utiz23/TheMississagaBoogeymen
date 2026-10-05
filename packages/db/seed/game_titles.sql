-- Seed the active game title for EANHL club #19224 (platform: common-gen5).
--
-- api_base_url must match EA_API_BASE in packages/ea-client/src/client.ts.
-- launched_at is approximate — update if the exact release date matters.
--
-- Requires migration 0057 (is_default / release_order): run after the migrations.
--
-- release_order 26 is this title's chronology (higher = newer). is_default is
-- claimed only when this seed CREATES the row and no title is the default yet
-- (a fresh install). Seeding NHL 27 afterwards hands the default to NHL 27
-- (game_titles_nhl27.sql).
--
-- Safe to re-run: ON CONFLICT (slug) DO NOTHING — an existing nhl26 row and
-- every other title are left exactly as they are.

INSERT INTO game_titles (slug, name, ea_platform, ea_club_id, api_base_url, is_active, launched_at, release_order, is_default)
SELECT
  'nhl26',
  'NHL 26',
  'common-gen5',
  '19224',
  'https://proclubs.ea.com/api/nhl',
  true,
  '2025-10-01',
  26,
  NOT EXISTS (SELECT 1 FROM game_titles WHERE is_default)
ON CONFLICT (slug) DO NOTHING;
