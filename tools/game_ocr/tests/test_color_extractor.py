"""Tests for the team-color extractor.

Fixtures are synthetic 1920×1080 frames with known solid blocks placed where
the trapezoid ROIs sample from. We don't need real game frames to validate
the sampler — only that it picks the right colour out of the right ROI.
"""
from __future__ import annotations

import numpy as np
import pytest

from game_ocr.color_extractor import (
    TRAPEZOID_LEFT_ROI,
    TRAPEZOID_RIGHT_ROI,
    aggregate_team_color,
    sample_team_colors,
    sample_team_colors_batch,
)


def _bgr(r: int, g: int, b: int) -> tuple[int, int, int]:
    """Convert an RGB triple to the BGR triple that cv2.imread would yield."""
    return (b, g, r)


def _scale_test_roi(
    roi: tuple[int, int, int, int], width: int, height: int
) -> tuple[int, int, int, int]:
    sx = width / 1920
    sy = height / 1080
    x1, y1, x2, y2 = roi
    return (int(x1 * sx), int(y1 * sy), int(x2 * sx), int(y2 * sy))


def _make_frame(
    left_rgb: tuple[int, int, int] | None,
    right_rgb: tuple[int, int, int] | None,
    width: int = 1920,
    height: int = 1080,
    background_rgb: tuple[int, int, int] = (70, 70, 70),
) -> np.ndarray:
    """Build a mid-grey-ice BGR frame with optional ROI fills (scales to non-baseline).

    Ice background defaults to neutral mid-grey so dark trapezoids are
    distinguishable from background by `_sample_roi`.
    """
    frame = np.full((height, width, 3), _bgr(*background_rgb), dtype=np.uint8)
    if left_rgb is not None:
        x1, y1, x2, y2 = _scale_test_roi(TRAPEZOID_LEFT_ROI, width, height)
        frame[y1:y2, x1:x2] = _bgr(*left_rgb)
    if right_rgb is not None:
        x1, y1, x2, y2 = _scale_test_roi(TRAPEZOID_RIGHT_ROI, width, height)
        frame[y1:y2, x1:x2] = _bgr(*right_rgb)
    return frame


def test_samples_distinct_side_colors() -> None:
    frame = _make_frame(left_rgb=(216, 0, 24), right_rgb=(35, 63, 148))
    result = sample_team_colors(frame)
    # Quantization step is 24, so (216,0,24) → bucket (216,0,24);
    # (35,63,148) → (24,48,144) = #183090.
    assert result.left.hex_color == "#d80018"
    assert result.right.hex_color == "#183090"
    assert result.left.confidence > 0.9
    assert result.right.confidence > 0.9


def test_detects_dark_trapezoid_as_team_color() -> None:
    # Realistic match-250: BGM red on the left, 4th Line near-black on the right.
    frame = _make_frame(left_rgb=(216, 0, 24), right_rgb=(20, 20, 20))
    result = sample_team_colors(frame)
    assert result.left.hex_color == "#d80018"
    # Quantized (20,20,20) → bucket (0,0,0) → #000000. Dark jersey detected.
    assert result.right.hex_color == "#000000"
    assert result.right.confidence > 0.9


def test_ice_grey_yields_none() -> None:
    # Both ROIs filled with mid-grey ice. Sampler should return null.
    frame = _make_frame(left_rgb=(75, 75, 75), right_rgb=(75, 75, 75))
    result = sample_team_colors(frame)
    assert result.left.hex_color is None
    assert result.right.hex_color is None


def test_scales_to_non_baseline_resolution() -> None:
    # Half-resolution frame: the sampler should scale the ROI.
    frame = _make_frame(
        left_rgb=(0, 200, 0), right_rgb=(0, 0, 200), width=960, height=540
    )
    result = sample_team_colors(frame)
    assert result.left.hex_color is not None
    assert result.right.hex_color is not None
    assert result.left.hex_color != result.right.hex_color


def test_aggregate_picks_dominant_across_frames() -> None:
    good = sample_team_colors(_make_frame(left_rgb=(216, 0, 24), right_rgb=None)).left
    bad = sample_team_colors(_make_frame(left_rgb=(0, 0, 240), right_rgb=None)).left
    aggregated = aggregate_team_color([good, good, bad, good])
    assert aggregated.hex_color == "#d80018"


def test_aggregate_handles_all_null() -> None:
    null = sample_team_colors(_make_frame(left_rgb=None, right_rgb=None)).left
    aggregated = aggregate_team_color([null, null, null])
    assert aggregated.hex_color is None
    assert aggregated.confidence == 0.0


def test_batch_runs_per_side() -> None:
    frames = [
        _make_frame(left_rgb=(216, 0, 24), right_rgb=(20, 20, 20)),
        _make_frame(left_rgb=(216, 0, 24), right_rgb=(20, 20, 20)),
    ]
    result = sample_team_colors_batch(frames)
    assert result.left.hex_color == "#d80018"
    assert result.right.hex_color == "#000000"


def test_invalid_image_shape_raises() -> None:
    with pytest.raises(ValueError):
        sample_team_colors(np.zeros((100, 100), dtype=np.uint8))


def test_detects_white_trapezoid_as_team_color() -> None:
    # Pure-white opp jersey (e.g. a future opp wearing all-white). Pixels
    # are high-min, low-chroma — outside both saturated and very-dark
    # branches. The new white branch must catch them.
    frame = _make_frame(left_rgb=(216, 0, 24), right_rgb=(245, 240, 240))
    result = sample_team_colors(frame)
    # Existing red BGM still works.
    assert result.left.hex_color == "#d80018"
    # White right ROI quantizes to a near-white bucket (24-step quantizer).
    assert result.right.hex_color is not None
    assert result.right.hex_color.startswith("#")
    # All channels >= 0xd8 (216) — i.e. unambiguously light.
    r = int(result.right.hex_color[1:3], 16)
    g = int(result.right.hex_color[3:5], 16)
    b = int(result.right.hex_color[5:7], 16)
    assert min(r, g, b) >= 216, f"expected near-white, got {result.right.hex_color}"
    assert result.right.confidence > 0.9


def test_white_does_not_capture_ice_grey() -> None:
    # Bright ice highlight near boards (~200,200,200): below the white
    # threshold of 220. White branch must NOT fire — returns None like
    # the existing ice-grey case.
    frame = _make_frame(left_rgb=(200, 200, 200), right_rgb=(200, 200, 200))
    result = sample_team_colors(frame)
    assert result.left.hex_color is None
    assert result.right.hex_color is None
