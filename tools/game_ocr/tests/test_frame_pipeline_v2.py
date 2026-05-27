"""Unit + gated-e2e tests for compute_frame_features_v2_from_image.

The wrapper handles ROI scaling, OCR backend invocation, text normalization,
and delegation to compute_frame_features_v2. Tests use a FakeOCRBackend so
they run sub-second; the real RapidOCR is exercised in TestRealRapidOCR,
which is gated behind RUN_CLASSIFIER_E2E=1 (same pattern as test_classifier).
"""

from __future__ import annotations

import os
import unittest
from pathlib import Path

import cv2
import numpy as np

from game_ocr.frame_features import FrameFeaturesV2
from game_ocr.frame_pipeline_v2 import (
    _scale_roi_to_image,
    compute_frame_features_v2_from_image,
)
from game_ocr.ocr import OCRLine
from game_ocr.regex_priors import RoiBbox, load_regex_priors


REPO_ROOT = Path(__file__).resolve().parents[3]
SCREENSHOTS = REPO_ROOT / "tools" / "game_ocr" / "ScreenShots"

RUN_E2E = os.environ.get("RUN_CLASSIFIER_E2E", "0") == "1"

PRIORS = load_regex_priors("nhl26")


# ─── Test helpers ────────────────────────────────────────────────────────────


class FakeOCRBackend:
    """OCRBackend Protocol implementation for tests.

    `responses` is a dict mapping crop shape (h, w) -> list[OCRLine]. The
    backend records every call's crop shape into `calls` for assertions.
    A None response means "raise KeyError" — useful for surfacing crop
    misalignment quickly.
    """

    name = "fake"

    def __init__(self, responses: dict[tuple[int, int], list[OCRLine]] | None = None):
        self.responses = responses or {}
        self.calls: list[tuple[int, int]] = []

    def read(self, image: np.ndarray) -> list[OCRLine]:
        shape = (image.shape[0], image.shape[1])
        self.calls.append(shape)
        return self.responses.get(shape, [])


def _line(text: str) -> OCRLine:
    """OCRLine factory; bbox values are irrelevant for these tests."""
    return OCRLine(text=text, confidence=0.99)


def _blank_image(h: int = 1080, w: int = 1920) -> np.ndarray:
    return np.zeros((h, w, 3), dtype=np.uint8)


# ─── Unit tests ──────────────────────────────────────────────────────────────


class TestRoiScaling(unittest.TestCase):
    """_scale_roi_to_image must map RoiBbox(x,y,w,h) onto image dims."""

    def test_native_resolution_passes_coords_unchanged(self) -> None:
        roi = RoiBbox(name="top_bar", x=0, y=0, w=1920, h=200)
        x1, y1, x2, y2 = _scale_roi_to_image(roi, (1080, 1920))
        self.assertEqual((x1, y1, x2, y2), (0, 0, 1920, 200))

    def test_half_resolution_halves_coords(self) -> None:
        roi = RoiBbox(name="side_strip", x=0, y=200, w=220, h=880)
        x1, y1, x2, y2 = _scale_roi_to_image(roi, (540, 960))
        # 0*0.5, 200*0.5, (0+220)*0.5, (200+880)*0.5 → 0, 100, 110, 540
        self.assertEqual((x1, y1, x2, y2), (0, 100, 110, 540))

    def test_clamps_x_to_image_width(self) -> None:
        # A ROI that would extend beyond the image gets clamped at the edge.
        roi = RoiBbox(name="overshoot", x=1800, y=0, w=500, h=100)
        x1, y1, x2, y2 = _scale_roi_to_image(roi, (1080, 1920))
        self.assertEqual(x2, 1920)
        self.assertEqual(y2, 100)

    def test_degenerate_roi_raises(self) -> None:
        # 10x10 image + a 1-pixel-tall ROI in the original 1080p space →
        # round(1*10/1080) == 0, collapses to height 0.
        roi = RoiBbox(name="thin", x=0, y=0, w=1920, h=1)
        with self.assertRaises(ValueError):
            _scale_roi_to_image(roi, (10, 10))


# ─── OCR plumbing ────────────────────────────────────────────────────────────


class TestOcrPlumbing(unittest.TestCase):
    """The wrapper must crop, call OCR, and normalize per the v1 pattern."""

    def test_calls_ocr_once_per_roi_with_correct_crop_shape(self) -> None:
        # Native 1080p input → ROI shapes match raw YAML bbox (h, w).
        top_bar_shape = (200, 1920)   # h=200, w=1920
        side_strip_shape = (880, 220)  # h=880, w=220
        backend = FakeOCRBackend(responses={
            top_bar_shape: [_line("foo")],
            side_strip_shape: [_line("bar")],
        })
        compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        self.assertEqual(len(backend.calls), 2)
        self.assertIn(top_bar_shape, backend.calls)
        self.assertIn(side_strip_shape, backend.calls)

    def test_normalizes_and_lowercases_joined_text(self) -> None:
        top_bar_shape = (200, 1920)
        side_strip_shape = (880, 220)
        backend = FakeOCRBackend(responses={
            top_bar_shape: [_line("  PLAYER\n LOADOUTS  ")],
            side_strip_shape: [],
        })
        result = compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        self.assertEqual(result.top_bar_text, "player loadouts")
        self.assertEqual(result.side_strip_text, "")

    def test_joins_multiple_lines_with_single_spaces(self) -> None:
        top_bar_shape = (200, 1920)
        backend = FakeOCRBackend(responses={
            top_bar_shape: [_line("hello"), _line("world"), _line("again")],
            (880, 220): [],
        })
        result = compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        self.assertEqual(result.top_bar_text, "hello world again")

    def test_empty_ocr_results_yield_empty_text_and_no_priors(self) -> None:
        backend = FakeOCRBackend(responses={})  # every shape returns []
        result = compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        self.assertEqual(result.top_bar_text, "")
        self.assertEqual(result.side_strip_text, "")
        self.assertEqual(float(result.regex_prior_flags.sum()), 0.0)

    def test_drops_empty_text_lines(self) -> None:
        top_bar_shape = (200, 1920)
        backend = FakeOCRBackend(responses={
            top_bar_shape: [_line("real"), _line(""), _line("text")],
            (880, 220): [],
        })
        result = compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        self.assertEqual(result.top_bar_text, "real text")


# ─── End-to-end (still using FakeOCRBackend) ─────────────────────────────────


class TestEndToEnd(unittest.TestCase):
    """Wrapper output is a valid FrameFeaturesV2 with priors fired correctly."""

    def test_top_bar_text_drives_top_bar_priors(self) -> None:
        backend = FakeOCRBackend(responses={
            (200, 1920): [_line("PLAYER LOADOUTS")],
            (880, 220): [],
        })
        result = compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        self.assertIsInstance(result, FrameFeaturesV2)
        title_prior_pos = next(
            i
            for i, p in enumerate(PRIORS.priors_flat)
            if p.state == "player_loadout_landing" and p.name == "title"
        )
        self.assertEqual(result.regex_prior_flags[title_prior_pos], 1.0)

    def test_side_strip_text_drives_side_strip_priors(self) -> None:
        backend = FakeOCRBackend(responses={
            (200, 1920): [],
            (880, 220): [_line("HOME")],
        })
        result = compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        home_prior_pos = next(
            i
            for i, p in enumerate(PRIORS.priors_flat)
            if p.state == "player_loadout_view" and p.name == "home_strip"
        )
        self.assertEqual(result.regex_prior_flags[home_prior_pos], 1.0)

    def test_milestone_b_shape_invariants_preserved(self) -> None:
        backend = FakeOCRBackend(responses={})
        result = compute_frame_features_v2_from_image(
            _blank_image(),
            regex_priors=PRIORS,
            ocr_backend=backend,
        )
        # Spot-check the shapes that milestone B's contract guarantees.
        self.assertEqual(result.full_frame_hsv.shape, (48,))
        self.assertEqual(len(result.quadrant_hsvs), 4)
        self.assertEqual(result.quadrant_brightness.shape, (4,))
        self.assertEqual(result.regex_prior_flags.shape, (PRIORS.n_priors(),))


# ─── Real RapidOCR integration (gated) ───────────────────────────────────────


@unittest.skipUnless(RUN_E2E, "set RUN_CLASSIFIER_E2E=1 to enable")
class TestRealRapidOCR(unittest.TestCase):
    """Runs once with real RapidOCRBackend to prove the OCR seam works."""

    def test_player_loadout_view_screenshot_fires_side_strip_prior(self) -> None:
        from game_ocr.ocr import RapidOCRBackend

        path = SCREENSHOTS / "Player Loadout View.png"
        img = cv2.imread(str(path))
        self.assertIsNotNone(img, f"missing fixture: {path}")
        # Sanity: fixture is native 1080p.
        self.assertEqual(img.shape[:2], (1080, 1920))

        backend = RapidOCRBackend(use_gpu=False)
        result = compute_frame_features_v2_from_image(
            img, regex_priors=PRIORS, ocr_backend=backend,
        )

        side_strip_prior_positions = [
            i
            for i, p in enumerate(PRIORS.priors_flat)
            if p.state == "player_loadout_view"
            and p.name in {"home_strip", "away_strip"}
        ]
        fired = [
            PRIORS.priors_flat[i].name
            for i in side_strip_prior_positions
            if result.regex_prior_flags[i] == 1.0
        ]
        self.assertTrue(
            fired,
            f"expected at least one of home_strip/away_strip to fire; "
            f"side_strip_text={result.side_strip_text!r}",
        )


if __name__ == "__main__":
    unittest.main()
