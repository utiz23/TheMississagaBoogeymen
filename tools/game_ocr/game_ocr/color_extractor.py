"""Per-match team-color extraction from in-game post-game screens.

The Action Tracker screen tints two regions with each club's brand colour:

  - LEFT trapezoid (just inside the boards, behind the left goal). In every
    match this is the HOME team's defending end, so the trapezoid carries
    the HOME colour.
  - RIGHT trapezoid (behind the right goal). The AWAY team's defending end.

NHL broadcast convention: home teams wear their primary colour, away teams
wear their light/white uniform. EA's UI follows the same convention, so the
RIGHT trapezoid often samples as unsaturated white. That's expected — when
both teams happen to share a similar brand colour the marker geometry on the
client (solid vs. outlined) still separates them visually.

ROI coordinates are derived from `configs/rink/post_game_action_tracker.json`:
the rink box spans pixels (836, 403)–(1783, 812) at the 1920×1080 baseline,
with `goal-left` at (895, 608) and `goal-right` at (1722, 608). Each
trapezoid lives in the ~55×55 pixel pocket between the goal line and the
boards at that height.
"""
from __future__ import annotations

import colorsys
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np

# Baseline coordinates assume 1920×1080. When a frame is a different
# resolution the sampler scales these proportionally.
_BASELINE_W = 1920
_BASELINE_H = 1080

# Each ROI is (x1, y1, x2, y2) in the 1920×1080 baseline.
TRAPEZOID_HOME_ROI: tuple[int, int, int, int] = (838, 580, 892, 638)
TRAPEZOID_AWAY_ROI: tuple[int, int, int, int] = (1727, 580, 1781, 638)

# Saturation thresholds (HLS).
_MIN_VALUE = 40 / 255.0
_MAX_VALUE = 245 / 255.0
_MIN_SATURATION = 0.25

# Hex output normalisation.
_HEX_PREFIX = "#"


@dataclass(frozen=True)
class TeamColorSample:
    """Per-frame extraction result for one team."""

    hex_color: str | None  # e.g. "#cc3333"; None when no saturated pixels found
    confidence: float  # 0..1; share of ROI pixels that were saturated
    pixel_count: int  # raw saturated-pixel count for diagnostics


@dataclass(frozen=True)
class FrameTeamColors:
    """Pair of per-team samples extracted from a single frame."""

    home: TeamColorSample
    away: TeamColorSample


def sample_team_colors(image: np.ndarray) -> FrameTeamColors:
    """Sample the home and away trapezoid ROIs in a single action_tracker frame.

    Accepts a BGR or RGB numpy array (height × width × 3). Returns per-team
    samples; either can be `None` when the trapezoid is white / desaturated.
    """
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"image must be HxWx3, got {image.shape!r}")
    height, width = image.shape[:2]
    home_roi = _scale_roi(TRAPEZOID_HOME_ROI, width, height)
    away_roi = _scale_roi(TRAPEZOID_AWAY_ROI, width, height)
    return FrameTeamColors(
        home=_sample_roi(image, home_roi),
        away=_sample_roi(image, away_roi),
    )


def aggregate_team_color(samples: Iterable[TeamColorSample]) -> TeamColorSample:
    """Combine per-frame samples into one consensus colour for a team.

    Strategy: weight each sample by its confidence, then pick the dominant
    quantised bucket across the weighted vote. Robust against a few bad
    frames (motion blur, transitions) because confidence ~ 0 there.
    """
    weighted: Counter[tuple[int, int, int]] = Counter()
    total_confidence = 0.0
    sample_count = 0
    for sample in samples:
        if sample.hex_color is None:
            continue
        sample_count += 1
        rgb = _parse_hex(sample.hex_color)
        bucket = _quantize_rgb(rgb)
        weighted[bucket] += sample.pixel_count
        total_confidence += sample.confidence
    if not weighted:
        return TeamColorSample(hex_color=None, confidence=0.0, pixel_count=0)
    winner, winner_weight = weighted.most_common(1)[0]
    return TeamColorSample(
        hex_color=_rgb_to_hex(winner),
        confidence=total_confidence / max(sample_count, 1),
        pixel_count=winner_weight,
    )


def sample_team_colors_batch(images: Sequence[np.ndarray]) -> FrameTeamColors:
    """Run the per-frame sampler over a batch and aggregate per side."""
    home_samples: list[TeamColorSample] = []
    away_samples: list[TeamColorSample] = []
    for frame in images:
        result = sample_team_colors(frame)
        home_samples.append(result.home)
        away_samples.append(result.away)
    return FrameTeamColors(
        home=aggregate_team_color(home_samples),
        away=aggregate_team_color(away_samples),
    )


# ─── internals ────────────────────────────────────────────────────────────


def _scale_roi(
    roi: tuple[int, int, int, int], width: int, height: int
) -> tuple[int, int, int, int]:
    sx = width / _BASELINE_W
    sy = height / _BASELINE_H
    x1, y1, x2, y2 = roi
    return (
        max(0, int(x1 * sx)),
        max(0, int(y1 * sy)),
        min(width, int(x2 * sx)),
        min(height, int(y2 * sy)),
    )


def _sample_roi(
    image: np.ndarray, roi: tuple[int, int, int, int]
) -> TeamColorSample:
    x1, y1, x2, y2 = roi
    crop = image[y1:y2, x1:x2]
    total_px = crop.shape[0] * crop.shape[1]
    if total_px == 0:
        return TeamColorSample(hex_color=None, confidence=0.0, pixel_count=0)

    # cv2 hands us BGR by convention; detect by checking if it looks like
    # BGR vs RGB doesn't matter for clustering, but we want canonical hex
    # output, so normalise everything to RGB before hexing.
    flat = crop.reshape(-1, 3)
    # We don't know the input channel order; the caller passes whatever
    # opencv handed them. The pipeline reads frames via cv2.imread which
    # returns BGR. We assume BGR and swap on hex emit.
    bgr = flat
    buckets: Counter[tuple[int, int, int]] = Counter()
    for b, g, r in bgr:
        h, l, s = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
        if l < _MIN_VALUE / 1.0 or l > _MAX_VALUE / 1.0:
            continue
        if s < _MIN_SATURATION:
            continue
        buckets[_quantize_rgb((int(r), int(g), int(b)))] += 1

    saturated_count = sum(buckets.values())
    if saturated_count == 0:
        return TeamColorSample(hex_color=None, confidence=0.0, pixel_count=0)

    winner, winner_count = buckets.most_common(1)[0]
    confidence = saturated_count / total_px
    return TeamColorSample(
        hex_color=_rgb_to_hex(winner),
        confidence=confidence,
        pixel_count=winner_count,
    )


def _quantize_rgb(rgb: tuple[int, int, int], step: int = 24) -> tuple[int, int, int]:
    r, g, b = rgb
    return ((r // step) * step, (g // step) * step, (b // step) * step)


def _parse_hex(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip(_HEX_PREFIX)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return f"{_HEX_PREFIX}{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"
