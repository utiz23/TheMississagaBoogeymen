"""Unit tests for the hybrid screen-type classifier.

Covers:
  - HSV histogram math (shape + normalization)
  - cosine similarity edge cases
  - fuzzy substring matching (exact + 1-edit)
  - config loading
  - end-to-end classify() on every named ScreenShots/ fixture

End-to-end tests hit the real RapidOCR backend; they're slow (~2s
cold-start) and require the `game_ocr.configs.classifier.nhl26.yaml`
config to be present. Skipped via `RUN_CLASSIFIER_E2E=0`.
"""

from __future__ import annotations

import os
import unittest
from pathlib import Path

import cv2
import numpy as np

from game_ocr.classifier import (
    UNKNOWN_SCREEN,
    Classifier,
    cosine_similarity,
    fuzzy_contains,
    hsv_histogram,
    load_classifier_config,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
SCREENSHOTS = REPO_ROOT / "tools" / "game_ocr" / "ScreenShots"

NAMED_FIXTURES = {
    "Player Loadout View.png": "player_loadout_view",
    "Pre-Game Lobby State 1.png": "pre_game_lobby_state_2",
    "Pre-Game Lobby State 2.png": "pre_game_lobby_state_2",
    "Post Game Player Summary.png": "post_game_player_summary",
    "Post Game Box Score.png": "post_game_box_score_goals",
    "Post Game Events.png": "post_game_events",
    "Post Game Action tracker (All-Goals + Hits + Shots + Penalties + Faceoffs).png": "post_game_action_tracker",
    "Post Game Event Map Faceoffs.png": "post_game_faceoff_map",
    "Post Game Event Map Net-Chart.png": "post_game_net_chart",
}


class TestHsvHistogram(unittest.TestCase):
    def test_shape_and_normalization(self) -> None:
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        img[:50, :, 2] = 255  # top half red
        img[50:, :, 1] = 255  # bottom half green
        h = hsv_histogram(img, (12, 4, 4))
        self.assertEqual(h.shape, (12 * 4 * 4,))
        self.assertAlmostEqual(float(h.sum()), 1.0, places=5)

    def test_rejects_non_bgr(self) -> None:
        with self.assertRaises(ValueError):
            hsv_histogram(np.zeros((10, 10), dtype=np.uint8), (4, 4, 4))


class TestCosineSimilarity(unittest.TestCase):
    def test_identical_vectors(self) -> None:
        v = np.array([0.1, 0.2, 0.3, 0.4])
        self.assertAlmostEqual(cosine_similarity(v, v), 1.0, places=5)

    def test_zero_vector(self) -> None:
        v = np.zeros(4)
        self.assertEqual(cosine_similarity(v, v), 0.0)

    def test_orthogonal(self) -> None:
        a = np.array([1.0, 0.0])
        b = np.array([0.0, 1.0])
        self.assertEqual(cosine_similarity(a, b), 0.0)


class TestFuzzyContains(unittest.TestCase):
    def test_exact_substring(self) -> None:
        self.assertTrue(fuzzy_contains("the quick brown fox", "quick"))
        self.assertTrue(fuzzy_contains("PLAYER LOADOUTS", "loadouts"))

    def test_one_edit_substitution(self) -> None:
        self.assertTrue(fuzzy_contains("all evants", "all events", max_distance=1))

    def test_one_edit_insertion(self) -> None:
        self.assertTrue(fuzzy_contains("net chartx", "net chart", max_distance=1))

    def test_rejects_too_distant(self) -> None:
        self.assertFalse(fuzzy_contains("totally unrelated", "anchor", max_distance=1))

    def test_empty_needle(self) -> None:
        self.assertTrue(fuzzy_contains("anything", "", max_distance=1))


class TestConfigLoading(unittest.TestCase):
    def test_load_nhl26(self) -> None:
        cfg = load_classifier_config("nhl26")
        self.assertEqual(cfg.version, "nhl26")
        self.assertEqual(len(cfg.hist_bins), 3)
        self.assertGreater(len(cfg.classes), 0)
        names = {c.name for c in cfg.classes}
        for expected in NAMED_FIXTURES.values():
            self.assertIn(expected, names, f"class {expected} missing from config")

    def test_reject_anchors_loaded(self) -> None:
        cfg = load_classifier_config("nhl26")
        # Calibration includes main-menu tab labels.
        joined = " ".join(cfg.reject_anchor_substrings).lower()
        self.assertIn("customize", joined)

    def test_missing_version_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            load_classifier_config("nhl_does_not_exist")


# E2E tests load the real RapidOCR backend; they're slow. Gate behind
# an env var so plain unit-test runs stay fast.
RUN_E2E = os.environ.get("RUN_CLASSIFIER_E2E", "1") == "1"


@unittest.skipUnless(RUN_E2E, "set RUN_CLASSIFIER_E2E=1 to enable")
class TestClassifyE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cfg = load_classifier_config("nhl26")
        # CPU EP keeps the test environment portable; GPU is the
        # production knob, not a test requirement.
        cls.clf = Classifier(cls.cfg, use_gpu=False)

    def test_all_named_fixtures_classify_correctly(self) -> None:
        misses: list[str] = []
        for fname, expected in NAMED_FIXTURES.items():
            path = SCREENSHOTS / fname
            self.assertTrue(path.exists(), f"fixture missing: {path}")
            img = cv2.imread(str(path))
            self.assertIsNotNone(img, f"cv2.imread failed: {path}")
            r = self.clf.classify(img)
            if r.screen_type != expected:
                misses.append(
                    f"{fname}: expected={expected} got={r.screen_type} "
                    f"color={r.color_score:.3f} anchor={r.anchor_text[:80]!r}"
                )
        self.assertEqual(
            misses, [],
            "named-fixture classifier accuracy regression:\n" + "\n".join(misses),
        )

    def test_random_noise_classifies_as_unknown(self) -> None:
        rng = np.random.default_rng(seed=0xEA12345)
        noise = rng.integers(0, 255, size=(1080, 1920, 3), dtype=np.uint8)
        r = self.clf.classify(noise)
        self.assertEqual(r.screen_type, UNKNOWN_SCREEN)


if __name__ == "__main__":
    unittest.main()
