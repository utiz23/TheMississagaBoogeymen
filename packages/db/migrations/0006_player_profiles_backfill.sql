-- Backfill player_profiles rows for any players that existed before the
-- player_profiles table was created (migration 0005).
--
-- ON CONFLICT DO NOTHING makes this idempotent in all environments:
--   - Live DB: all rows already exist (created manually after 0005 was applied). No-op.
--   - Fresh DB with a pg_dump restore: inserts rows for any players in the dump.
--   - Truly empty DB: selects 0 rows. No-op.

INSERT INTO player_profiles (player_id)
SELECT id FROM players
ON CONFLICT DO NOTHING;
