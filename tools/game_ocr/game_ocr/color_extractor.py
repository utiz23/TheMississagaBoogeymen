"""Per-match team-color extraction from in-game post-game screens.

The Action Tracker rink panel tints the trapezoid behind each goal with
the *defending* team's brand colour in that screen view. Per the rink
calibration file `bgm_attacks: right`, BGM defends the LEFT goal in this
match's screens, so the LEFT trapezoid carries BGM's colour and the
RIGHT trapezoid carries the opponent's. The faceoff-map label "BM(A)" /
"4TH(H)" tells us which of those clubs is actually the away team and
which is home — the aggregator binds the left/right colour samples to
home/away based on that signal.

A team's brand colour can be saturated (BGM red `#cc2030`) OR very dark
(4th Line's near-black). The sampler returns whichever non-ice cluster
dominates: it filters out the rink's mid-grey ice surface and picks the
most common remaining bucket. Mid-grey ice is approximately
`(60..90, 60..90, 60..90)`; anything notably darker or notably more
saturated than that range is considered a team-colour candidate.

ROI coordinates are derived from `configs/rink/post_game_action_tracker.json`:
the rink box spans pixels (836, 403)–(1783, 812) at the 1920×1080 baseline,
with `goal-left` at (895, 608) and `goal-right` at (1722, 608). Each
trapezoid lives in the ~55×55 pixel pocket between the goal line and the
boards at that height.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np

# Baseline coordinates assume 1920×1080. When a frame is a different
# resolution the sampler scales these proportionally.
_BASELINE_W = 1920
_BASELINE_H = 1080

# Each ROI is (x1, y1, x2, y2) in the 1920×1080 baseline. "LEFT" / "RIGHT"
# describes the screen-space position of the trapezoid; whether that maps
# to BGM or OPP — and from there to home/away — is decided by the
# aggregator from the faceoff-map (H)/(A) label and rink calibration.
TRAPEZOID_LEFT_ROI: tuple[int, int, int, int] = (838, 580, 892, 638)
TRAPEZOID_RIGHT_ROI: tuple[int, int, int, int] = (1727, 580, 1781, 638)

# Pixel-classification thresholds.
# A pixel is "saturated" when (max − min) channel difference exceeds this.
# Saturated pixels are always preferred (a coloured jersey beats a dark one
# in the dominant-bucket vote, even if the dark cluster is bigger).
_SATURATION_THRESHOLD = 45
# A pixel is "very dark" when its max channel ≤ this. Used as the fallback
# signal for teams wearing black/near-black kits (4th Line in match 250)
# where the trapezoid samples to ~`#202020`–`#303030` with no saturated
# content. Set just above the empirical 50-ish floor of pixels inside a
# black trapezoid; ice grey starts ~70 and up.
_DARK_THRESHOLD = 55
# Minimum fraction of saturated pixels required to declare the ROI as
# "team-coloured saturated". If saturated pixels are below this share but
# dark pixels make up more than `_DARK_DOMINANT_SHARE` of the ROI we fall
# back to the dark colour. Both thresholds are intentionally generous —
# the trapezoid in EA's UI is partially occluded by markers and lines, so
# the dominant non-ice cluster typically covers ~10–40% of the ROI.
_SATURATED_MIN_SHARE = 0.05
_DARK_DOMINANT_SHARE = 0.30
# A pixel is "near-white" when its min channel is at or above this value AND
# chroma is low (the saturated branch already claimed high-chroma pixels, so
# anything reaching the white branch is by construction low-chroma). Captures
# pure-white and off-white opp jerseys (match 250's opp wore black, so the
# dark branch covered that; first matches with all-white kits fall outside
# both saturated and very-dark and would otherwise return None).
_WHITE_THRESHOLD = 220
# Whites tend to fill a large fraction of the trapezoid when present; require
# a dominant share to avoid grabbing rink-lighting highlights near the boards
# (which can hit 210-230 on bright ice next to the trapezoid edge).
_WHITE_DOMINANT_SHARE = 0.30

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
    """Pair of left/right-side samples extracted from a single frame.

    The sampler stays neutral about home/away; the aggregator combines these
    with the faceoff-map (H)/(A) labels to bind a side to a club.
    """

    left: TeamColorSample
    right: TeamColorSample

    # Back-compat aliases for older callers that referenced .home / .away.
    # They mirror left/right directly; the aggregator does the correct bind.
    @property
    def home(self) -> "TeamColorSample":
        return self.right

    @property
    def away(self) -> "TeamColorSample":
        return self.left


def sample_team_colors(image: np.ndarray) -> FrameTeamColors:
    """Sample the left and right trapezoid ROIs in a single action_tracker frame.

    Accepts a BGR numpy array (height × width × 3) as returned by
    `cv2.imread`. Returns per-side samples; either can be `None` when the
    ROI is featureless (all ice / blur).
    """
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"image must be HxWx3, got {image.shape!r}")
    height, width = image.shape[:2]
    left = _scale_roi(TRAPEZOID_LEFT_ROI, width, height)
    right = _scale_roi(TRAPEZOID_RIGHT_ROI, width, height)
    return FrameTeamColors(
        left=_sample_roi(image, left),
        right=_sample_roi(image, right),
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
    left_samples: list[TeamColorSample] = []
    right_samples: list[TeamColorSample] = []
    for frame in images:
        result = sample_team_colors(frame)
        left_samples.append(result.left)
        right_samples.append(result.right)
    return FrameTeamColors(
        left=aggregate_team_color(left_samples),
        right=aggregate_team_color(right_samples),
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
    """Find the dominant non-ice colour in the ROI.

    Strategy: bucket pixels into "saturated" (the typical coloured-jersey
    case) and "very dark" (the dark-jersey case, e.g. a black trapezoid).
    Saturated wins when present even at a low share; dark only wins when
    it dominates a large fraction of the ROI (otherwise it tends to
    capture the rink shadow rather than the trapezoid).
    """
    x1, y1, x2, y2 = roi
    crop = image[y1:y2, x1:x2]
    total_px = crop.shape[0] * crop.shape[1]
    if total_px == 0:
        return TeamColorSample(hex_color=None, confidence=0.0, pixel_count=0)

    saturated: Counter[tuple[int, int, int]] = Counter()
    dark: Counter[tuple[int, int, int]] = Counter()
    white: Counter[tuple[int, int, int]] = Counter()
    # cv2.imread returns BGR; we swap to RGB on hex emit.
    bgr = crop.reshape(-1, 3)
    for b, g, r in bgr:
        ir, ig, ib = int(r), int(g), int(b)
        mx = max(ir, ig, ib)
        mn = min(ir, ig, ib)
        bucket = _quantize_rgb((ir, ig, ib))
        if (mx - mn) >= _SATURATION_THRESHOLD:
            saturated[bucket] += 1
        elif mn >= _WHITE_THRESHOLD:
            white[bucket] += 1
        elif mx <= _DARK_THRESHOLD:
            dark[bucket] += 1

    sat_count = sum(saturated.values())
    if sat_count / total_px >= _SATURATED_MIN_SHARE:
        winner, winner_count = saturated.most_common(1)[0]
        return TeamColorSample(
            hex_color=_rgb_to_hex(winner),
            confidence=sat_count / total_px,
            pixel_count=winner_count,
        )

    # White wins over dark when both fire — high-min is more discriminative
    # than low-max in EA's UI (ice greys ~70-100 vs jersey whites >220).
    white_count = sum(white.values())
    if white_count / total_px >= _WHITE_DOMINANT_SHARE:
        winner, winner_count = white.most_common(1)[0]
        return TeamColorSample(
            hex_color=_rgb_to_hex(winner),
            confidence=white_count / total_px,
            pixel_count=winner_count,
        )

    dark_count = sum(dark.values())
    if dark_count / total_px >= _DARK_DOMINANT_SHARE:
        winner, winner_count = dark.most_common(1)[0]
        return TeamColorSample(
            hex_color=_rgb_to_hex(winner),
            confidence=dark_count / total_px,
            pixel_count=winner_count,
        )

    return TeamColorSample(hex_color=None, confidence=0.0, pixel_count=0)


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
