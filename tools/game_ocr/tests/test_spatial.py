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
    """Build a synthetic test image with optional yellow + red markers."""
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:] = (20, 20, 20)  # dark background
    # Draw rink boundary roughly matching the production calibration.
    cv2.rectangle(img, (960, 382), (1793, 832), (200, 200, 200), 2)
    # Center cross.
    cv2.line(img, (1376, 600), (1376, 614), (200, 200, 200), 1)
    cv2.line(img, (1369, 607), (1383, 607), (200, 200, 200), 1)

    if yellow_at is not None:
        # BGR for bright yellow ≈ (10, 170, 245). Big circle ~22px radius for area ~1500.
        cv2.circle(img, yellow_at, 22, (10, 170, 245), -1)
    for r in red_at or []:
        cv2.circle(img, r, 18, (10, 30, 220), -1)
    return img


class SpatialPipelineTests(unittest.TestCase):
    def test_round_trip_center_ice(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        # Yellow marker placed exactly at center ice (calibration's center).
        img = _make_synthetic_rink(yellow_at=(1376, 607))
        result = extract_selected_event_position(img, cal)
        self.assertIsNotNone(result.selected_coordinate)
        coord = result.selected_coordinate
        assert coord is not None  # for type checker
        self.assertAlmostEqual(coord.x, 0.0, delta=0.5)
        self.assertAlmostEqual(coord.y, 0.0, delta=0.5)
        self.assertEqual(coord.rink_zone, "neutral")

    def test_offensive_zone(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        # 80% of half-width to the right of center → x ≈ +80 (offensive zone).
        center_x = 1376
        half_w = (1793 - 960) / 2
        target_px = (int(center_x + half_w * 0.80), 607)
        img = _make_synthetic_rink(yellow_at=target_px)
        coord = extract_selected_event_position(img, cal).selected_coordinate
        assert coord is not None
        self.assertGreater(coord.x, 70.0)
        self.assertLess(coord.x, 90.0)
        self.assertEqual(coord.rink_zone, "offensive")

    def test_defensive_zone(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        center_x = 1376
        half_w = (1793 - 960) / 2
        target_px = (int(center_x - half_w * 0.80), 607)
        img = _make_synthetic_rink(yellow_at=target_px)
        coord = extract_selected_event_position(img, cal).selected_coordinate
        assert coord is not None
        self.assertLess(coord.x, -70.0)
        self.assertGreater(coord.x, -90.0)
        self.assertEqual(coord.rink_zone, "defensive")

    def test_y_axis_inverted(self) -> None:
        """Pixel-y above the center should produce positive hockey-y."""
        cal = load_rink_calibration("post_game_action_tracker")
        center_y = 607
        half_h = (832 - 382) / 2
        target_px = (1376, int(center_y - half_h * 0.50))
        img = _make_synthetic_rink(yellow_at=target_px)
        coord = extract_selected_event_position(img, cal).selected_coordinate
        assert coord is not None
        self.assertGreater(coord.y, 15.0)
        self.assertLess(coord.y, 30.0)

    def test_no_yellow_returns_none(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        img = _make_synthetic_rink(red_at=[(1376, 607), (1500, 700)])
        result = extract_selected_event_position(img, cal)
        self.assertIsNone(result.selected_coordinate)
        self.assertEqual(result.yellow_marker_count, 0)
        self.assertGreaterEqual(len(result.warnings), 1)

    def test_multiple_yellow_picks_largest(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        img = _make_synthetic_rink(yellow_at=(1376, 607))
        # Add a tiny yellow blob at another position via a small filled circle.
        cv2.circle(img, (1700, 700), 8, (10, 170, 245), -1)
        result = extract_selected_event_position(img, cal)
        self.assertEqual(result.yellow_marker_count, 2)
        # Pipeline picks the larger marker = (1376, 607) ≈ center ice.
        coord = result.selected_coordinate
        assert coord is not None
        self.assertAlmostEqual(coord.x, 0.0, delta=2.0)


class TransformDirectTests(unittest.TestCase):
    def test_pixel_to_hockey_at_box_corners(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        box = cal.rink_pixel_box

        # Top-left corner → x = -100 (defensive goal), y = +42.5 (boards).
        m = DetectedMarker(
            pixel_x=float(box.x1),
            pixel_y=float(box.y1),
            color="yellow",
            area_px=1000.0,
            bbox=(box.x1, box.y1, 1, 1),
        )
        coord = pixel_to_hockey(m, cal)
        self.assertAlmostEqual(coord.x, -100.0, delta=0.5)
        self.assertAlmostEqual(coord.y, 42.5, delta=0.5)
        self.assertEqual(coord.rink_zone, "defensive")

        # Bottom-right corner → x = +100 (offensive), y = -42.5.
        m2 = DetectedMarker(
            pixel_x=float(box.x2),
            pixel_y=float(box.y2),
            color="yellow",
            area_px=1000.0,
            bbox=(box.x2, box.y2, 1, 1),
        )
        coord2 = pixel_to_hockey(m2, cal)
        self.assertAlmostEqual(coord2.x, 100.0, delta=0.5)
        self.assertAlmostEqual(coord2.y, -42.5, delta=0.5)
        self.assertEqual(coord2.rink_zone, "offensive")


class CalibrationLoadTests(unittest.TestCase):
    def test_load_action_tracker(self) -> None:
        cal = load_rink_calibration("post_game_action_tracker")
        self.assertEqual(cal.screen_type, "post_game_action_tracker")
        self.assertEqual(cal.expected_width, 1920)
        self.assertEqual(cal.expected_height, 1080)
        self.assertEqual(cal.bgm_attacks, "right")
        self.assertIn("yellow", cal.color_thresholds)
        self.assertIn("center_ice", cal.reference_points)


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
