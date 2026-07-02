"""Unit tests for the captain ★ visual scorer.

No committed fixture renders the captain star (see the plan / Phase D notes),
so these validate the detector *math* on synthetic gold-★-on-dark crops rather
than real frames. Real for/C vs against/C vs for/LW-FP calibration lands with
the Phase G re-ingest.

Ground truth here is constructed: a gold cluster of known size in a known ROI
must score high; a starless (white-text / gray) region must score ~0; clusters
below the noise floor and out-of-bounds ROIs must score exactly 0.0.
"""

from __future__ import annotations

import unittest

import numpy as np

from game_ocr.captain_star_matcher import (
    FULL_STAR_FRACTION,
    score_captain_star,
)

# Gold/amber in BGR — maps to OpenCV hue ~23, S=255, V=255, inside the gold
# gate (hue 15–35, S>100, V>60). Verified by test_gold_bgr_is_in_gate below.
GOLD_BGR = (0, 200, 255)
DARK_BGR = (20, 20, 20)


def _dark_crop(size: int = 40) -> np.ndarray:
    return np.full((size, size, 3), DARK_BGR, dtype=np.uint8)


class TestGoldGate(unittest.TestCase):
    def test_gold_bgr_is_in_gate(self) -> None:
        """Sanity-check the synthetic gold color actually reads as gold in HSV."""
        import cv2

        px = np.array([[list(GOLD_BGR)]], dtype=np.uint8)
        h, s, v = cv2.cvtColor(px, cv2.COLOR_BGR2HSV)[0, 0]
        self.assertTrue(15 <= h <= 35, f"hue {h} not in gold band")
        self.assertGreater(s, 100)
        self.assertGreater(v, 60)


class TestScoreCaptainStar(unittest.TestCase):
    def test_solid_gold_cluster_scores_high(self) -> None:
        import cv2

        crop = _dark_crop(40)
        # A filled gold disc (radius 10 → ~314 px, fraction ~0.196 > the
        # saturation fraction) stands in for a clearly-rendered star.
        cv2.circle(crop, (20, 20), 10, GOLD_BGR, -1)
        score = score_captain_star(crop, cx=20, cy=20, radius=20)
        self.assertGreaterEqual(score, 0.9)
        self.assertLessEqual(score, 1.0)

    def test_starless_region_scores_zero(self) -> None:
        # Gray background with a white "gamertag text" band — no gold anywhere.
        crop = np.full((40, 40, 3), (60, 60, 60), dtype=np.uint8)
        crop[15:25, 5:35] = (255, 255, 255)
        self.assertEqual(score_captain_star(crop, cx=20, cy=20, radius=20), 0.0)

    def test_partial_cluster_grades_between_zero_and_one(self) -> None:
        # 8×15 = 120 gold px in a 40×40 (1600 px) ROI → fraction 0.075, which is
        # half of FULL_STAR_FRACTION (0.15) → a graded score near 0.5, not
        # saturated. Proves the score discriminates, not just thresholds.
        crop = _dark_crop(40)
        crop[10:18, 10:25] = GOLD_BGR
        expected = (120 / 1600) / FULL_STAR_FRACTION
        score = score_captain_star(crop, cx=20, cy=20, radius=20)
        self.assertAlmostEqual(score, expected, places=5)
        self.assertGreater(score, 0.3)
        self.assertLess(score, 0.7)

    def test_gold_speck_below_noise_floor_scores_zero(self) -> None:
        # 2×5 = 10 gold px is below the _MIN_GOLD_PIXELS (12) cluster floor.
        crop = _dark_crop(40)
        crop[0:2, 0:5] = GOLD_BGR
        self.assertEqual(score_captain_star(crop, cx=20, cy=20, radius=20), 0.0)

    def test_roi_geometry_selects_the_star_location(self) -> None:
        import cv2

        # Star lives at (300, 120) in a full-width frame; scoring that ROI reads
        # high, while a different slot location (600, 120) reads zero.
        frame = np.full((200, 800, 3), DARK_BGR, dtype=np.uint8)
        cv2.circle(frame, (300, 120), 10, GOLD_BGR, -1)
        self.assertGreaterEqual(score_captain_star(frame, cx=300, cy=120, radius=20), 0.9)
        self.assertEqual(score_captain_star(frame, cx=600, cy=120, radius=20), 0.0)


class TestScoreCaptainStarBadInput(unittest.TestCase):
    def test_none_frame_scores_zero(self) -> None:
        self.assertEqual(score_captain_star(None, cx=10, cy=10, radius=20), 0.0)

    def test_empty_array_scores_zero(self) -> None:
        empty = np.empty((0, 0, 3), dtype=np.uint8)
        self.assertEqual(score_captain_star(empty, cx=10, cy=10, radius=20), 0.0)

    def test_out_of_bounds_roi_scores_zero(self) -> None:
        crop = _dark_crop(40)
        # ROI centered well outside the frame → empty intersection → 0.0.
        self.assertEqual(score_captain_star(crop, cx=500, cy=500, radius=20), 0.0)


if __name__ == "__main__":
    unittest.main()
