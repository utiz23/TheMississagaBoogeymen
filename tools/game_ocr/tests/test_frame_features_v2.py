"""Unit tests for compute_frame_features_v2.

The v2 feature pipeline is consumed by the v2 screen classifier (wired
later in S5). These tests cover the contract that S5 will rely on:

  - FrameFeaturesV2 dataclass shape invariants.
  - Per-quadrant decomposition (TL/TR/BL/BR) of brightness/blur/edges.
  - Regex prior flags fired against the correct ROI text source, in
    `regex_priors.priors_flat` order — the canonical feature-vector
    position contract.
  - OCR presence flags (any alpha / any digit / any hash glyph).
  - Determinism: same input → identical output across calls.
"""

from __future__ import annotations

import unittest

import numpy as np

from game_ocr.frame_features import (
    OCR_PRESENCE_FLAG_NAMES,
    QUADRANT_NAMES,
    FrameFeaturesV2,
    compute_frame_features_v2,
)
from game_ocr.regex_priors import load_regex_priors


PRIORS = load_regex_priors("nhl26")


def _solid_image(color_bgr: tuple[int, int, int]) -> np.ndarray:
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    img[:, :] = color_bgr
    return img


def _features(
    image: np.ndarray | None = None,
    *,
    top_bar_text: str = "",
    side_strip_text: str = "",
) -> FrameFeaturesV2:
    if image is None:
        image = _solid_image((10, 10, 10))
    return compute_frame_features_v2(
        image,
        top_bar_text=top_bar_text,
        side_strip_text=side_strip_text,
        regex_priors=PRIORS,
    )


class TestShapeInvariants(unittest.TestCase):
    """The dataclass shapes are the v2 feature-vector contract."""

    def test_quadrant_names_are_canonical(self) -> None:
        self.assertEqual(QUADRANT_NAMES, ("tl", "tr", "bl", "br"))

    def test_full_frame_hsv_shape(self) -> None:
        f = _features()
        # Default bins (8, 3, 2) = 48
        self.assertEqual(f.full_frame_hsv.shape, (48,))
        self.assertAlmostEqual(float(f.full_frame_hsv.sum()), 1.0, places=5)

    def test_quadrant_hsv_shapes(self) -> None:
        f = _features()
        self.assertEqual(len(f.quadrant_hsvs), 4)
        for h in f.quadrant_hsvs:
            self.assertEqual(h.shape, (48,))
            self.assertAlmostEqual(float(h.sum()), 1.0, places=5)

    def test_quadrant_brightness_shape_and_range(self) -> None:
        f = _features()
        self.assertEqual(f.quadrant_brightness.shape, (4,))
        self.assertTrue(((f.quadrant_brightness >= 0.0) & (f.quadrant_brightness <= 1.0)).all())

    def test_quadrant_blur_shape_nonnegative(self) -> None:
        f = _features()
        self.assertEqual(f.quadrant_blur.shape, (4,))
        self.assertTrue((f.quadrant_blur >= 0.0).all())

    def test_quadrant_edge_density_shape_and_range(self) -> None:
        f = _features()
        self.assertEqual(f.quadrant_edge_density.shape, (4,))
        self.assertTrue(((f.quadrant_edge_density >= 0.0) & (f.quadrant_edge_density <= 1.0)).all())

    def test_regex_prior_flags_match_priors_flat_length(self) -> None:
        f = _features()
        self.assertEqual(f.regex_prior_flags.shape, (PRIORS.n_priors(),))
        # 0/1 valued
        self.assertTrue(set(np.unique(f.regex_prior_flags).tolist()).issubset({0.0, 1.0}))

    def test_ocr_presence_flags_length_matches_canonical_names(self) -> None:
        f = _features()
        self.assertEqual(f.ocr_presence_flags.shape, (len(OCR_PRESENCE_FLAG_NAMES),))
        self.assertTrue(set(np.unique(f.ocr_presence_flags).tolist()).issubset({0.0, 1.0}))

    def test_text_round_trip(self) -> None:
        f = _features(top_bar_text="PLAY", side_strip_text="HOME")
        self.assertEqual(f.top_bar_text, "PLAY")
        self.assertEqual(f.side_strip_text, "HOME")


class TestQuadrantDecomposition(unittest.TestCase):
    """Per-quadrant signals must correspond to TL/TR/BL/BR slices."""

    def test_brightness_only_in_top_left_quadrant(self) -> None:
        # Solid white in top-left, black elsewhere → TL much brighter.
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        img[:240, :320, :] = 255  # top-left quadrant
        f = _features(img)
        tl, tr, bl, br = f.quadrant_brightness.tolist()
        self.assertGreater(tl, 0.9)
        self.assertLess(tr, 0.05)
        self.assertLess(bl, 0.05)
        self.assertLess(br, 0.05)

    def test_edge_density_only_in_bottom_right_quadrant(self) -> None:
        # Random noise only in BR → high edge density there, near zero elsewhere.
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        rng = np.random.default_rng(seed=42)
        img[240:, 320:, :] = rng.integers(0, 256, size=(240, 320, 3), dtype=np.uint8)
        f = _features(img)
        tl, tr, bl, br = f.quadrant_edge_density.tolist()
        self.assertGreater(br, 0.1)
        self.assertLess(tl, 0.01)
        self.assertLess(tr, 0.01)
        self.assertLess(bl, 0.01)

    def test_blur_lower_for_sharp_quadrant_than_flat_quadrant(self) -> None:
        # Flat (zero variance) in TL, high-contrast checker in TR → TR blur much greater.
        img = np.zeros((480, 640, 3), dtype=np.uint8)
        # TR (rows 0..240, cols 320..640): alternating columns black/white
        img[:240, 320::2, :] = 255
        f = _features(img)
        tl_blur, tr_blur, _bl, _br = f.quadrant_blur.tolist()
        self.assertEqual(tl_blur, 0.0)
        self.assertGreater(tr_blur, 100.0)


class TestRegexPriorFiring(unittest.TestCase):
    """Each prior must fire only against its own ROI's text."""

    def test_top_bar_prior_fires_on_top_bar_text(self) -> None:
        # "WORLD OF CHEL" anchor lives in top_bar — fire only when text given there.
        prior = next(p for p in PRIORS.priors_flat if p.state == "menu_world_of_chel")
        pos = PRIORS.priors_flat.index(prior)

        f_match = _features(top_bar_text="THE WORLD OF CHEL")
        f_wrong_roi = _features(side_strip_text="THE WORLD OF CHEL")

        self.assertEqual(f_match.regex_prior_flags[pos], 1.0)
        self.assertEqual(f_wrong_roi.regex_prior_flags[pos], 0.0)

    def test_side_strip_prior_fires_on_side_strip_text(self) -> None:
        # The `home_strip` prior in player_loadout_view targets side_strip.
        prior = next(
            p
            for p in PRIORS.priors_flat
            if p.state == "player_loadout_view" and p.name == "home_strip"
        )
        pos = PRIORS.priors_flat.index(prior)

        f_match = _features(side_strip_text="HOME")
        f_wrong_roi = _features(top_bar_text="HOME")

        self.assertEqual(f_match.regex_prior_flags[pos], 1.0)
        self.assertEqual(f_wrong_roi.regex_prior_flags[pos], 0.0)

    def test_empty_text_fires_no_priors(self) -> None:
        f = _features(top_bar_text="", side_strip_text="")
        self.assertEqual(float(f.regex_prior_flags.sum()), 0.0)

    def test_multiple_priors_fire_independently(self) -> None:
        f = _features(
            top_bar_text="PLAYER LOADOUTS",
            side_strip_text="HOME",
        )
        names_fired = {
            PRIORS.priors_flat[i].name
            for i, v in enumerate(f.regex_prior_flags.tolist())
            if v == 1.0
        }
        # `title` lives in player_loadout_landing (top_bar) and `home_strip`
        # in player_loadout_view (side_strip).
        self.assertIn("title", names_fired)
        self.assertIn("home_strip", names_fired)


class TestOcrPresenceFlags(unittest.TestCase):
    """Coarse global signals computed across the combined ROI text."""

    def test_any_alpha_only(self) -> None:
        f = _features(top_bar_text="abc", side_strip_text="")
        flags = dict(zip(OCR_PRESENCE_FLAG_NAMES, f.ocr_presence_flags.tolist()))
        self.assertEqual(flags["any_alpha"], 1.0)
        self.assertEqual(flags["any_digit"], 0.0)
        self.assertEqual(flags["any_hash_symbol"], 0.0)

    def test_any_digit_only(self) -> None:
        f = _features(top_bar_text="", side_strip_text="12345")
        flags = dict(zip(OCR_PRESENCE_FLAG_NAMES, f.ocr_presence_flags.tolist()))
        self.assertEqual(flags["any_alpha"], 0.0)
        self.assertEqual(flags["any_digit"], 1.0)

    def test_any_hash_symbol(self) -> None:
        f = _features(side_strip_text="#19 DEVOURER")
        flags = dict(zip(OCR_PRESENCE_FLAG_NAMES, f.ocr_presence_flags.tolist()))
        self.assertEqual(flags["any_hash_symbol"], 1.0)
        self.assertEqual(flags["any_alpha"], 1.0)
        self.assertEqual(flags["any_digit"], 1.0)

    def test_all_zero_for_empty(self) -> None:
        f = _features(top_bar_text="", side_strip_text="")
        self.assertEqual(float(f.ocr_presence_flags.sum()), 0.0)


class TestDeterminism(unittest.TestCase):
    def test_repeated_calls_match(self) -> None:
        rng = np.random.default_rng(seed=0)
        img = rng.integers(0, 256, size=(480, 640, 3), dtype=np.uint8)
        a = _features(img, top_bar_text="PLAYER LOADOUTS", side_strip_text="HOME")
        b = _features(img, top_bar_text="PLAYER LOADOUTS", side_strip_text="HOME")

        np.testing.assert_array_equal(a.full_frame_hsv, b.full_frame_hsv)
        for ha, hb in zip(a.quadrant_hsvs, b.quadrant_hsvs):
            np.testing.assert_array_equal(ha, hb)
        np.testing.assert_array_equal(a.quadrant_brightness, b.quadrant_brightness)
        np.testing.assert_array_equal(a.quadrant_blur, b.quadrant_blur)
        np.testing.assert_array_equal(a.quadrant_edge_density, b.quadrant_edge_density)
        np.testing.assert_array_equal(a.regex_prior_flags, b.regex_prior_flags)
        np.testing.assert_array_equal(a.ocr_presence_flags, b.ocr_presence_flags)


class TestV1Coexistence(unittest.TestCase):
    """V1 path must remain importable + callable after v2 lands."""

    def test_v1_compute_frame_features_still_importable(self) -> None:
        from game_ocr.frame_features import FrameFeatures, compute_frame_features

        self.assertTrue(callable(compute_frame_features))
        self.assertTrue(FrameFeatures is not None)


if __name__ == "__main__":
    unittest.main()
