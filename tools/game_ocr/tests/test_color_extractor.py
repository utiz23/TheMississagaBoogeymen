"""Tests for the team-color extractor.

Fixtures are synthetic 1920×1080 frames with known solid blocks placed where
the trapezoid ROIs sample from. We don't need real game frames to validate
the sampler — only that it picks the right colour out of the right ROI.
"""
from __future__ import annotations

import numpy as np
import pytest

from game_ocr.color_extractor import (
    TRAPEZOID_AWAY_ROI,
    TRAPEZOID_HOME_ROI,
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
    home_rgb: tuple[int, int, int] | None,
    away_rgb: tuple[int, int, int] | None,
    width: int = 1920,
    height: int = 1080,
) -> np.ndarray:
    """Build a black BGR frame with optional ROI fills (scales to non-baseline)."""
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    if home_rgb is not None:
        x1, y1, x2, y2 = _scale_test_roi(TRAPEZOID_HOME_ROI, width, height)
        frame[y1:y2, x1:x2] = _bgr(*home_rgb)
    if away_rgb is not None:
        x1, y1, x2, y2 = _scale_test_roi(TRAPEZOID_AWAY_ROI, width, height)
        frame[y1:y2, x1:x2] = _bgr(*away_rgb)
    return frame


def test_samples_distinct_team_colors() -> None:
    frame = _make_frame(home_rgb=(216, 0, 24), away_rgb=(35, 63, 148))
    result = sample_team_colors(frame)
    # Quantization step is 24, so (216,0,24) → bucket (216,0,24);
    # (35,63,148) → (24,48,144) = #183090.
    assert result.home.hex_color == "#d80018"
    assert result.away.hex_color == "#183090"
    assert result.home.confidence > 0.9
    assert result.away.confidence > 0.9


def test_away_white_yields_none() -> None:
    # Home solid red, away white (typical NHL "away wears white" case).
    frame = _make_frame(home_rgb=(216, 0, 24), away_rgb=(245, 245, 245))
    result = sample_team_colors(frame)
    assert result.home.hex_color == "#d80018"
    assert result.away.hex_color is None
    assert result.away.confidence == 0.0


def test_scales_to_non_baseline_resolution() -> None:
    # Half-resolution frame: the sampler should scale the ROI.
    frame = _make_frame(
        home_rgb=(0, 200, 0), away_rgb=(0, 0, 200), width=960, height=540
    )
    result = sample_team_colors(frame)
    assert result.home.hex_color is not None
    assert result.away.hex_color is not None
    # Green and blue should round into distinct buckets.
    assert result.home.hex_color != result.away.hex_color


def test_aggregate_picks_dominant_across_frames() -> None:
    # Three frames: red-red-red, then one bad blue, then red again.
    good = sample_team_colors(_make_frame(home_rgb=(216, 0, 24), away_rgb=None)).home
    bad = sample_team_colors(_make_frame(home_rgb=(0, 0, 240), away_rgb=None)).home
    aggregated = aggregate_team_color([good, good, bad, good])
    assert aggregated.hex_color == "#d80018"


def test_aggregate_handles_all_null() -> None:
    null = sample_team_colors(_make_frame(home_rgb=None, away_rgb=None)).home
    aggregated = aggregate_team_color([null, null, null])
    assert aggregated.hex_color is None
    assert aggregated.confidence == 0.0


def test_batch_runs_per_team() -> None:
    frames = [
        _make_frame(home_rgb=(216, 0, 24), away_rgb=(35, 63, 148)),
        _make_frame(home_rgb=(216, 0, 24), away_rgb=(35, 63, 148)),
    ]
    result = sample_team_colors_batch(frames)
    assert result.home.hex_color == "#d80018"
    assert result.away.hex_color is not None


def test_invalid_image_shape_raises() -> None:
    with pytest.raises(ValueError):
        sample_team_colors(np.zeros((100, 100), dtype=np.uint8))
