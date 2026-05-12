"""Smoke tests for the rink-coordinate spatial extraction pipeline."""

from __future__ import annotations

import unittest

import cv2
import numpy as np

from game_ocr.spatial import (
    DetectedMarker,
    RinkPixelBox,
    detect_rink_markers,
    extract_selected_event_position,
    find_selected_marker,
    load_rink_calibration,
    pixel_to_hockey,
)


def _make_synthetic_rink(
    width: int = 1920,
    height: int = 1080,
    yellow_at: tuple[int, int] | None = None,
    red_at: list[tuple[int, int]] | None = None,
) -> np.ndarray:
    """Build a synthetic test image with optional yellow + red markers.

    Rink geometry mirrors the production landmarks in
    `post_game_action_tracker.json` so synthetic pixel positions map
    cleanly to expected hockey coordinates under the RBF calibration.
    """
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:] = (20, 20, 20)  # dark background
    # Rink boundary matches the production rink_pixel_box.
    cv2.rectangle(img, (835, 402), (1782, 811), (200, 200, 200), 2)
    # Center cross at the production centre landmark (1310, 608).
    cv2.line(img, (1310, 601), (1310, 615), (200, 200, 200), 1)
    cv2.line(img, (1303, 608), (1317, 608), (200, 200, 200), 1)

    if yellow_at is not None:
        # BGR for bright yellow ≈ (10, 170, 245). Big circle ~22px radius for area ~1500.
        cv2.circle(img, yellow_at, 22, (10, 170, 245), -1)
    for r in red_at or []:
        cv2.circle(img, r, 18, (10, 30, 220), -1)
    return img


class SpatialPipelineTests(unittest.TestCase):
    def test_round_trip_center_ice(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        # Yellow marker placed exactly at the centre landmark (1310, 608).
        img = _make_synthetic_rink(yellow_at=(1310, 608))
        result = extract_selected_event_position(img, cal)
        self.assertIsNotNone(result.selected_coordinate)
        coord = result.selected_coordinate
        assert coord is not None  # for type checker
        self.assertAlmostEqual(coord.x, 0.0, delta=0.5)
        self.assertAlmostEqual(coord.y, 0.0, delta=0.5)
        self.assertEqual(coord.rink_zone, "neutral")
        # Centre is inside the landmark hull → high confidence.
        self.assertEqual(coord.confidence, 1.0)

    def test_offensive_zone(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        # goal-right landmark (1722, 608) corresponds to hockey x = +89.
        img = _make_synthetic_rink(yellow_at=(1722, 608))
        coord = extract_selected_event_position(img, cal).selected_coordinate
        assert coord is not None
        self.assertAlmostEqual(coord.x, 89.0, delta=2.0)
        self.assertEqual(coord.rink_zone, "offensive")
        self.assertEqual(coord.confidence, 1.0)

    def test_defensive_zone(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        # goal-left landmark (895, 608) corresponds to hockey x = -89.
        img = _make_synthetic_rink(yellow_at=(895, 608))
        coord = extract_selected_event_position(img, cal).selected_coordinate
        assert coord is not None
        self.assertAlmostEqual(coord.x, -89.0, delta=2.0)
        self.assertEqual(coord.rink_zone, "defensive")
        self.assertEqual(coord.confidence, 1.0)

    def test_y_axis_inverted(self) -> None:
        """Pixel-y above the centre should produce positive hockey-y."""
        cal = load_rink_calibration("post_game_action_tracker")
        # ez-fo-top-left landmark (1004, 510) → hockey y = +22 (upper half).
        img = _make_synthetic_rink(yellow_at=(1004, 510))
        coord = extract_selected_event_position(img, cal).selected_coordinate
        assert coord is not None
        self.assertAlmostEqual(coord.y, 22.0, delta=2.0)
        self.assertGreater(coord.y, 0.0)  # upper half = positive hockey-y

    def test_no_yellow_returns_none(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        img = _make_synthetic_rink(red_at=[(1376, 607), (1500, 700)])
        result = extract_selected_event_position(img, cal)
        self.assertIsNone(result.selected_coordinate)
        self.assertEqual(result.yellow_marker_count, 0)
        self.assertGreaterEqual(len(result.warnings), 1)

    def test_multiple_yellow_picks_largest(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        img = _make_synthetic_rink(yellow_at=(1310, 608))
        # Add a tiny yellow blob at another position via a small filled circle.
        cv2.circle(img, (1700, 700), 8, (10, 170, 245), -1)
        result = extract_selected_event_position(img, cal)
        self.assertEqual(result.yellow_marker_count, 2)
        # Pipeline picks the larger marker = centre.
        coord = result.selected_coordinate
        assert coord is not None
        self.assertAlmostEqual(coord.x, 0.0, delta=2.0)


class TransformDirectTests(unittest.TestCase):
    def test_pixel_to_hockey_at_landmarks(self) -> None:
        """Predicting a landmark's pixel position should yield its hockey coords.

        Under TPS RBF with neighbors=6, in-sample predictions are near-exact
        (the spline interpolates each landmark within sub-pixel error).
        """
        cal = load_rink_calibration("post_game_action_tracker")
        # Sample a representative subset of landmarks: centre, blue lines,
        # one ez-fo dot, one goal line.
        cases = [
            ("centre",          1310, 608,   0.0,   0.0),
            ("bl-right",        1440, 608,  25.0,   0.0),
            ("goal-right",      1722, 608,  89.0,   0.0),
            ("ez-fo-top-left",  1004, 510, -69.0,  22.0),
            ("board-bottom",    1310, 811,   0.0, -42.5),
        ]
        for name, px, py, expected_hx, expected_hy in cases:
            with self.subTest(landmark=name):
                m = DetectedMarker(
                    pixel_x=float(px),
                    pixel_y=float(py),
                    color="yellow",
                    area_px=1000.0,
                    bbox=(px, py, 1, 1),
                )
                coord = pixel_to_hockey(m, cal)
                # Landmarks ARE the hull vertices, so each one sits exactly
                # on the hull boundary. The hull-gate may report either side
                # of the boundary depending on numerical jitter, so we only
                # assert on hockey coords here (confidence is exercised by
                # the dedicated hull-gate tests below).
                self.assertAlmostEqual(coord.x, expected_hx, delta=1.0)
                self.assertAlmostEqual(coord.y, expected_hy, delta=1.0)

    def test_pixel_to_hockey_hull_gate_in_hull(self) -> None:
        """A pixel comfortably inside the landmark hull → confidence 1.0."""
        cal = load_rink_calibration("post_game_action_tracker")
        # (1500, 650) is well inside the hull (between centre and bl-right,
        # slightly below centre-y).
        m = DetectedMarker(1500.0, 650.0, "yellow", 1000.0, (1500, 650, 1, 1))
        coord = pixel_to_hockey(m, cal)
        self.assertEqual(coord.confidence, 1.0)

    def test_pixel_to_hockey_hull_gate_out_of_hull(self) -> None:
        """A pixel in a rink-art corner (outside the hull) → confidence 0.3."""
        cal = load_rink_calibration("post_game_action_tracker")
        box = cal.rink_pixel_box
        # Top-left corner of the rink_pixel_box is at (836, 403). The hull's
        # top-left vertex is board-left (835, 608); board-top is (1310, 402).
        # So the corner lies outside the hull's top-left edge.
        m = DetectedMarker(
            pixel_x=float(box.x1),
            pixel_y=float(box.y1),
            color="yellow",
            area_px=1000.0,
            bbox=(box.x1, box.y1, 1, 1),
        )
        coord = pixel_to_hockey(m, cal)
        self.assertEqual(coord.confidence, 0.3)
        # Should still produce a hockey coordinate in roughly the right region.
        self.assertLess(coord.x, -60.0)  # defensive side
        self.assertGreater(coord.y, 20.0)  # upper half


class CalibrationLoadTests(unittest.TestCase):
    def test_load_action_tracker(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        self.assertEqual(cal.screen_type, "post_game_action_tracker")
        self.assertEqual(cal.expected_width, 1920)
        self.assertEqual(cal.expected_height, 1080)
        self.assertEqual(cal.bgm_attacks, "right")
        self.assertIn("yellow", cal.color_thresholds)
        self.assertIn("center_ice", cal.reference_points)
        # Landmarks must be present for the RBF predictor to build.
        self.assertEqual(len(cal.landmarks), 13)
        landmark_names = {lm.name for lm in cal.landmarks}
        self.assertIn("centre", landmark_names)
        self.assertIn("board-top", landmark_names)
        self.assertIn("ez-fo-top-left", landmark_names)


class FindSelectedTests(unittest.TestCase):
    def test_empty(self) -> None:
        self.assertIsNone(find_selected_marker([]))

    def test_no_yellow(self) -> None:
        markers = [
            DetectedMarker(100.0, 100.0, "red", 500.0, (90, 90, 20, 20)),
            DetectedMarker(200.0, 200.0, "white", 500.0, (190, 190, 20, 20)),
        ]
        self.assertIsNone(find_selected_marker(markers))

    def test_picks_unique_yellow(self) -> None:
        m = DetectedMarker(100.0, 100.0, "yellow", 1500.0, (90, 90, 20, 20))
        markers = [
            DetectedMarker(50.0, 50.0, "red", 500.0, (40, 40, 20, 20)),
            m,
        ]
        self.assertIs(find_selected_marker(markers), m)


if __name__ == "__main__":
    unittest.main()
