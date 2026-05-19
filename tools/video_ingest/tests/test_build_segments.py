"""Unit tests for build_segments() — the Pass-1 segment opener/closer.

These tests use synthetic FrameClassification sequences so they need no
ffmpeg, no classifier, no GPU. The goal is to pin the segment-opening
contract, and in particular the per-screen overrides for short post-game
screens that the live match-463 ingest exposed as a regression.
"""

from __future__ import annotations

import unittest

from game_ocr.classifier import UNKNOWN_SCREEN
from video_ingest.pass1_classify import (
    FrameClassification,
    Pass1Config,
    build_segments,
)


def _fc(idx: int, screen_type: str, color_score: float = 0.95) -> FrameClassification:
    return FrameClassification(
        index=idx,
        seconds=float(idx),
        screen_type=screen_type,
        color_score=color_score,
        color_class=screen_type,
        anchor_text="",
    )


def _run(seq: list[str], **overrides) -> list:
    cfg = Pass1Config(
        sample_fps=1.0,
        min_run_to_open=overrides.get("min_run_to_open", 2),
        max_outliers_within=overrides.get("max_outliers_within", 1),
        min_segment_seconds=overrides.get("min_segment_seconds", 3.0),
        min_segment_seconds_by_screen=overrides.get("min_segment_seconds_by_screen", {}),
        min_run_to_open_by_screen=overrides.get("min_run_to_open_by_screen", {}),
    )
    frames = [_fc(i, s) for i, s in enumerate(seq)]
    return build_segments(frames, cfg)


class TestDefaultBehavior(unittest.TestCase):
    """Empty per-screen-override maps reproduce the existing global thresholds."""

    def test_long_action_tracker_run_emits(self):
        seq = [UNKNOWN_SCREEN] * 2 + ["post_game_action_tracker"] * 5 + [UNKNOWN_SCREEN] * 2
        segs = _run(seq)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0].screen_type, "post_game_action_tracker")
        self.assertEqual(segs[0].frame_count, 5)

    def test_short_screen_without_override_is_rejected(self):
        # 2-frame post_game_net_chart with no override — fails the 3.0s gate.
        seq = [UNKNOWN_SCREEN] * 3 + ["post_game_net_chart"] * 2 + [UNKNOWN_SCREEN] * 3
        segs = _run(seq)
        self.assertEqual(segs, [])

    def test_outlier_within_run_preserved(self):
        # 5 AT frames with one unknown_screen blip inside; outlier rule allows it.
        seq = (
            [UNKNOWN_SCREEN]
            + ["post_game_action_tracker"] * 3
            + [UNKNOWN_SCREEN]
            + ["post_game_action_tracker"] * 2
            + [UNKNOWN_SCREEN]
        )
        segs = _run(seq)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0].screen_type, "post_game_action_tracker")
        # The outlier counts as part of the run interior; last_match_idx
        # falls on the last AT frame.
        self.assertGreaterEqual(segs[0].frame_count, 5)


class TestPerScreenOverrides(unittest.TestCase):
    """The match-463 regression: brief post-game screens must emit."""

    OVERRIDES = {
        "min_segment_seconds_by_screen": {
            "player_loadout_view": 1.0,
            "post_game_box_score_goals": 1.0,
            "post_game_faceoff_map": 1.0,
            "post_game_net_chart": 1.0,
        },
        "min_run_to_open_by_screen": {
            "player_loadout_view": 1,
            "post_game_box_score_goals": 1,
            "post_game_faceoff_map": 1,
            "post_game_net_chart": 1,
        },
    }

    def test_single_frame_net_chart_emits(self):
        seq = [UNKNOWN_SCREEN] * 3 + ["post_game_net_chart"] + [UNKNOWN_SCREEN] * 3
        segs = _run(seq, **self.OVERRIDES)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0].screen_type, "post_game_net_chart")
        self.assertEqual(segs[0].frame_count, 1)

    def test_two_frame_faceoff_map_emits(self):
        seq = [UNKNOWN_SCREEN] * 2 + ["post_game_faceoff_map"] * 2 + [UNKNOWN_SCREEN] * 2
        segs = _run(seq, **self.OVERRIDES)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0].screen_type, "post_game_faceoff_map")
        self.assertEqual(segs[0].frame_count, 2)

    def test_single_action_tracker_flicker_still_rejected(self):
        # AT has NO override — a 1-frame flicker amid gameplay must stay
        # filtered, otherwise the looser thresholds let phantoms in.
        seq = [UNKNOWN_SCREEN] * 5 + ["post_game_action_tracker"] + [UNKNOWN_SCREEN] * 5
        segs = _run(seq, **self.OVERRIDES)
        self.assertEqual(segs, [])

    def test_player_loadout_view_at_video_start(self):
        # Replicates the match-463 case: 2-frame loadout view at index 0..1,
        # then a long unknown run. Should emit one 2-frame segment.
        seq = ["player_loadout_view"] * 2 + [UNKNOWN_SCREEN] * 20
        segs = _run(seq, **self.OVERRIDES)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0].screen_type, "player_loadout_view")

    def test_overrides_do_not_affect_unlisted_screens(self):
        # post_game_events is NOT in the override list — still needs >= 3s.
        seq = [UNKNOWN_SCREEN] + ["post_game_events"] * 2 + [UNKNOWN_SCREEN]
        segs = _run(seq, **self.OVERRIDES)
        self.assertEqual(segs, [])


class TestMatch463RegressionShape(unittest.TestCase):
    """End-to-end reproduction of the classifier shape seen in match 463's
    segments.json frame_classifications: brief loadout_view at the start
    and brief faceoff_map / net_chart / box_score_goals at the end."""

    def test_match_463_post_game_burst(self):
        # Single timeline: pre-game loadout + long unknown + post-game burst.
        # Sizes mirror the real match-463 video: loadout 2 frames, AT long,
        # faceoff_map 2 frames, net_chart 2 frames, box_goals 1 frame.
        seq = (
            ["player_loadout_view"] * 2
            + [UNKNOWN_SCREEN] * 30
            + ["post_game_action_tracker"] * 8
            + [UNKNOWN_SCREEN] * 2
            + ["post_game_faceoff_map"] * 2
            + [UNKNOWN_SCREEN] * 2
            + ["post_game_net_chart"] * 2
            + [UNKNOWN_SCREEN] * 2
            + ["post_game_box_score_goals"]
            + [UNKNOWN_SCREEN] * 3
        )
        segs = _run(seq, **TestPerScreenOverrides.OVERRIDES)
        emitted_types = [s.screen_type for s in segs]
        self.assertIn("player_loadout_view", emitted_types)
        self.assertIn("post_game_action_tracker", emitted_types)
        self.assertIn("post_game_faceoff_map", emitted_types)
        self.assertIn("post_game_net_chart", emitted_types)
        self.assertIn("post_game_box_score_goals", emitted_types)
        # AT should appear exactly once (no phantom AT segments from the
        # surrounding unknown/post-game frames).
        self.assertEqual(emitted_types.count("post_game_action_tracker"), 1)


if __name__ == "__main__":
    unittest.main()
