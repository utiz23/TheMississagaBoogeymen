"""Tests for the per-frame multi-signal feature extractor."""

from __future__ import annotations

import unittest

import numpy as np

from game_ocr.frame_features import (
    FrameFeatures,
    blur_score,
    compute_frame_features,
)
from game_ocr.state_machine import load_state_machine


def _solid_frame(h: int, w: int, color_bgr: tuple[int, int, int]) -> np.ndarray:
    f = np.zeros((h, w, 3), dtype=np.uint8)
    f[:] = color_bgr
    return f


class TestBlurScore(unittest.TestCase):
    def test_solid_frame_is_blurry(self):
        # No edges → laplacian variance is ~0.
        f = _solid_frame(100, 100, (128, 128, 128))
        self.assertLess(blur_score(f), 5.0)

    def test_checkerboard_is_sharp(self):
        # High-contrast checkerboard → large laplacian variance.
        f = np.zeros((100, 100, 3), dtype=np.uint8)
        f[::2, ::2] = 255
        f[1::2, 1::2] = 255
        self.assertGreater(blur_score(f), 100.0)


class TestComputeFrameFeatures(unittest.TestCase):
    def setUp(self):
        self.sm = load_state_machine("nhl26")

    def test_hsv_histogram_shape(self):
        frame = _solid_frame(1080, 1920, (50, 100, 200))
        feats = compute_frame_features(frame, anchor_text="", state_machine=self.sm)
        # 12 * 4 * 4 = 192 bins.
        self.assertEqual(feats.hsv_histogram.shape, (192,))
        self.assertAlmostEqual(feats.hsv_histogram.sum(), 1.0, places=5)

    def test_anchor_flags_match_state_machine(self):
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="player loadouts header",
            state_machine=self.sm,
        )
        # 17 states in nhl26.yaml.
        self.assertEqual(feats.anchor_flags.shape, (17,))
        idx = self.sm.state_index("player_loadout_view")
        self.assertEqual(feats.anchor_flags[idx], 1.0)
        # No other state's anchor present.
        # Find another state whose substrings do not appear in the text.
        loadout_flag = feats.anchor_flags[idx]
        action_idx = self.sm.state_index("post_game_action_tracker")
        self.assertEqual(feats.anchor_flags[action_idx], 0.0)
        self.assertEqual(loadout_flag, 1.0)

    def test_anchor_fuzzy_match(self):
        # 1 character off — should still fire via fuzzy_contains in classifier.
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="player ioadouts",  # 'l' → 'i'
            state_machine=self.sm,
        )
        idx = self.sm.state_index("player_loadout_view")
        self.assertEqual(feats.anchor_flags[idx], 1.0)

    def test_reject_anchor_returns_features_with_flag(self):
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="customize roster",
            state_machine=self.sm,
        )
        # Reject anchors set a separate flag, do not zero out the per-state flags.
        self.assertTrue(feats.reject_anchor_present)

    def test_quality_signals_present(self):
        feats = compute_frame_features(
            _solid_frame(1080, 1920, (0, 0, 0)),
            anchor_text="",
            state_machine=self.sm,
        )
        self.assertGreaterEqual(feats.brightness, 0.0)
        self.assertLessEqual(feats.brightness, 1.0)
        self.assertGreaterEqual(feats.blur_score, 0.0)
