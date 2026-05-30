"""Regression test for `visual_prefilter.signals`.

The prefilter shares low-level primitives (HSV histogram, brightness, blur,
edge density) with `game_ocr.frame_features.compute_frame_features_v2`. This
test locks two contracts:

  1. `compute_visual_signals` produces values matching an independent
     reference implementation in this file (the documented algorithm).
  2. The HSV histogram is bit-identical to the v2 classifier's
     `full_frame_hsv` slot — both pipelines must agree on the same per-frame
     HSV signature so the prefilter's per-screen centroid match (Phase 2)
     can compare directly to classifier-YAML centroids.

A deterministic synthetic image (RNG seed = 0) drives the test so no
fixture file is required.
"""

from __future__ import annotations

import unittest

import cv2
import numpy as np

from game_ocr.frame_features import compute_frame_features_v2
from game_ocr.regex_priors import load_regex_priors
from game_ocr.signal_utils import _hsv_histogram_from_hsv
from video_ingest.visual_prefilter.signals import (
    VisualSignals,
    compute_visual_signals,
)


_HSV_BINS = (8, 3, 2)
_CANNY_LOW = 100
_CANNY_HIGH = 200


def _make_image(seed: int = 0, h: int = 80, w: int = 80) -> np.ndarray:
    """Deterministic synthetic BGR uint8 image."""
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8)


class TestVisualSignalsShapeAndDtype(unittest.TestCase):
    def test_field_shapes_and_dtypes(self) -> None:
        img = _make_image()
        s = compute_visual_signals(img)
        self.assertIsInstance(s, VisualSignals)
        self.assertEqual(s.hsv_histogram.shape, (48,))
        self.assertEqual(s.hsv_histogram.dtype, np.float64)
        self.assertIsInstance(s.brightness, float)
        self.assertIsInstance(s.log_blur, float)
        self.assertIsInstance(s.edge_density, float)
        self.assertEqual(s.dhash_thumbnail.shape, (8, 9))
        self.assertEqual(s.dhash_thumbnail.dtype, np.uint8)
        self.assertEqual(s.template_scores, {})


class TestVisualSignalsAgainstReference(unittest.TestCase):
    """compute_visual_signals must match the documented algorithm exactly."""

    def setUp(self) -> None:
        self.img = _make_image()
        self.hsv = cv2.cvtColor(self.img, cv2.COLOR_BGR2HSV)
        self.gray = cv2.cvtColor(self.img, cv2.COLOR_BGR2GRAY)
        self.signals = compute_visual_signals(self.img)

    def test_hsv_histogram_matches_canonical_helper(self) -> None:
        expected = _hsv_histogram_from_hsv(self.hsv, _HSV_BINS)
        np.testing.assert_array_equal(self.signals.hsv_histogram, expected)

    def test_brightness_matches_mean_v_over_255(self) -> None:
        expected = float(self.hsv[..., 2].astype(np.float64).mean() / 255.0)
        self.assertAlmostEqual(self.signals.brightness, expected, places=12)

    def test_log_blur_matches_log1p_laplacian_variance(self) -> None:
        var = float(cv2.Laplacian(self.gray, cv2.CV_64F).var())
        expected = float(np.log1p(max(0.0, var)))
        self.assertAlmostEqual(self.signals.log_blur, expected, places=12)

    def test_edge_density_matches_canny_ratio(self) -> None:
        edges = cv2.Canny(self.gray, _CANNY_LOW, _CANNY_HIGH)
        expected = float(np.count_nonzero(edges)) / float(self.gray.size)
        self.assertAlmostEqual(self.signals.edge_density, expected, places=12)

    def test_dhash_thumbnail_matches_inter_area_resize(self) -> None:
        expected = cv2.resize(self.gray, (9, 8), interpolation=cv2.INTER_AREA)
        np.testing.assert_array_equal(self.signals.dhash_thumbnail, expected)


class TestParityWithComputeFrameFeaturesV2(unittest.TestCase):
    """The prefilter's HSV histogram must be bit-identical to the v2
    classifier's `full_frame_hsv` slot — both pipelines feed Pass-1 and
    must agree on the same per-frame HSV signature."""

    def test_full_frame_hsv_parity(self) -> None:
        img = _make_image(seed=7)
        priors = load_regex_priors("nhl26")
        ff = compute_frame_features_v2(
            img,
            top_bar_text="",
            side_strip_text="",
            regex_priors=priors,
        )
        s = compute_visual_signals(img)
        np.testing.assert_array_equal(s.hsv_histogram, ff.full_frame_hsv)


class TestVisualSignalsValidation(unittest.TestCase):
    def test_raises_on_non_bgr_image(self) -> None:
        with self.assertRaises(ValueError):
            compute_visual_signals(np.zeros((10, 10), dtype=np.uint8))
        with self.assertRaises(ValueError):
            compute_visual_signals(np.zeros((10, 10, 4), dtype=np.uint8))


class TestVisualSignalsDeterminism(unittest.TestCase):
    def test_same_image_same_signals(self) -> None:
        img = _make_image(seed=42)
        a = compute_visual_signals(img)
        b = compute_visual_signals(img)
        np.testing.assert_array_equal(a.hsv_histogram, b.hsv_histogram)
        self.assertEqual(a.brightness, b.brightness)
        self.assertEqual(a.log_blur, b.log_blur)
        self.assertEqual(a.edge_density, b.edge_density)
        np.testing.assert_array_equal(a.dhash_thumbnail, b.dhash_thumbnail)


if __name__ == "__main__":
    unittest.main()
