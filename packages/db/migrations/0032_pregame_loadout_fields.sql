-- Pre-game lobby & loadout-view OCR field additions, per
-- docs/ocr/pre-game-extraction-research.md (May 2026 internal research).
--
-- Splits the schema into the fields that the V2 benchmark requires but
-- the existing parser drops on the floor:
--
--   player_loadout_snapshots
--     - is_captain         : the yellow ★ next to a player's gamertag
--                            in lobby/loadout views (V2 "Leader? Yes")
--     - player_number      : in-game jersey number (e.g. 11 for E. Wanhg)
--     - player_name_persona: short in-game name (e.g. "E. Wanhg").
--                            Distinct from player_name_snapshot which
--                            holds the FULL real name ("Evgeni Wanhg"
--                            from the loadout view title bar).
--
--   player_loadout_x_factors
--     - tier               : Elite | All Star | Specialist, derived
--                            from HSV color sample on the X-Factor icon
--                            (red / blue / yellow respectively).
--
--   player_loadout_attributes
--     - delta_value        : signed buff/nerf chip displayed next to
--                            the rating. Δ chips read e.g. +5, -2, +9.
--                            NULL when no Δ chip is present (base
--                            rating == displayed rating).
--                            base_rating = value - delta_value.

ALTER TABLE player_loadout_snapshots
  ADD COLUMN is_captain boolean,
  ADD COLUMN player_number integer,
  ADD COLUMN player_name_persona text;

COMMENT ON COLUMN player_loadout_snapshots.is_captain IS
  'Yellow star (★) detected next to gamertag in lobby/loadout; V2 "Leader? Yes"';
COMMENT ON COLUMN player_loadout_snapshots.player_number IS
  'In-game jersey number (e.g. 11 for E. Wanhg); from lobby state-2 or loadout left strip';
COMMENT ON COLUMN player_loadout_snapshots.player_name_persona IS
  'Short in-game persona name ("E. Wanhg"); distinct from player_name_snapshot which is the full real name ("Evgeni Wanhg")';

ALTER TABLE player_loadout_x_factors
  ADD COLUMN tier text;

COMMENT ON COLUMN player_loadout_x_factors.tier IS
  'Elite | All Star | Specialist, classified from HSV color sample on the icon (red / blue / yellow)';

ALTER TABLE player_loadout_attributes
  ADD COLUMN delta_value smallint;

COMMENT ON COLUMN player_loadout_attributes.delta_value IS
  'Signed buff/nerf chip displayed next to the rating; NULL when no Δ chip present. base_rating = value - delta_value';
