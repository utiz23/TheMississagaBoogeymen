-- Seed the active game title for EANHL club #19224 (platform: common-gen5).
--
-- api_base_url must match EA_API_BASE in packages/ea-client/src/client.ts.
-- launched_at is approximate — update if the exact release date matters.
--
-- Safe to re-run: ON CONFLICT (slug) DO NOTHING.

INSERT INTO game_titles (slug, name, ea_platform, ea_club_id, api_base_url, is_active, launched_at)
VALUES (
  'nhl26',
  'NHL 26',
  'common-gen5',
  '19224',
  'https://proclubs.ea.com/api/nhl',
  true,
  '2025-10-01'
)
ON CONFLICT (slug) DO NOTHING;
