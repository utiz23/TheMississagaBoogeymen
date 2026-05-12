-- Cross-frame consensus needs to group raw loadout/lobby observations by
-- (match_id, team_side, position). Add team_side to support that grouping.
--
-- Values follow the project convention (matches match_events.team_side,
-- match_shot_type_summaries.team_side):
--   'for'     = BGM
--   'against' = opponent
--
-- Promoters derive team_side from gamertag resolution: a snapshot whose
-- gamertag resolves to a known BGM player_id is 'for'; otherwise 'against'.
-- Documented gotcha: new BGM players who haven't been rostered yet would
-- be misclassified as 'against' until their alias is added.

ALTER TABLE player_loadout_snapshots
  ADD COLUMN team_side text;

COMMENT ON COLUMN player_loadout_snapshots.team_side IS
  'for | against (BGM perspective). Derived from gamertag resolution: resolved → for, unresolved → against';

CREATE INDEX player_loadout_snapshots_match_side_position_idx
  ON player_loadout_snapshots (match_id, team_side, position);
