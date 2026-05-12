-- Per-period BGM attack direction, detected from the colored bar inside each
-- end-zone trapezoid in the Action Tracker rink art. Used to normalize event
-- (x, y) so BGM offensive zone is always +x when rendering analytical views,
-- while preserving raw "in-game art" coords for replay-matched views.
--
-- Values:
--   'right' — BGM attacks the right side of the in-game rink art (default convention)
--   'left'  — BGM attacks the left side; normalized rendering mirrors x
ALTER TABLE match_period_summaries
  ADD COLUMN bgm_attack_direction text;

COMMENT ON COLUMN match_period_summaries.bgm_attack_direction IS
  'left | right; encodes BGM attack direction for this period as drawn in the in-game art';
