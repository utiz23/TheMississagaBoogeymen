"""Visual prefilter primitives shared by Pass-1 emissions biasing and
Pass-2 frame selection.

Phase 1 produces a small fixed signal set per frame: HSV histogram,
brightness, log-blur, edge density, and a downscaled grayscale thumbnail
(for dHash dedup in Pass-2). Template-anchor scores are exposed as an
empty dict here and populated when `templates.py` lands.

The algorithmic choices mirror
`game_ocr.frame_features.compute_frame_features_v2` so the prefilter's
HSV histogram is bit-identical to the v2 classifier's `full_frame_hsv`
slot (both call `_hsv_histogram_from_hsv` with the same bin layout) and
the full-frame brightness/log-blur/edge-density are computed with the
same algorithms as the per-quadrant analogues. The regression test in
`tests/test_visual_prefilter_signals.py` locks this contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from game_ocr.signal_utils import _hsv_histogram_from_hsv

# Same Canny thresholds as game_ocr.frame_features. Mid-range defaults that
# work on UI screenshots without per-frame tuning.
_CANNY_LOW = 100
_CANNY_HIGH = 200

# Default HSV bin split: 8·3·2 = 48 bins. Matches `_DEFAULT_HSV_BINS` in
# `game_ocr.frame_features`; the prefilter centroid match (centroids.py,
# Phase 2) assumes this layout so classifier-YAML centroids are directly
# comparable to prefilter histograms.
_DEFAULT_HSV_BINS: tuple[int, int, int] = (8, 3, 2)

# Downscaled grayscale thumbnail for Pass-2 dHash dedup. 9 cols × 8 rows
# yields 8 horizontal-gradient bits per row → 64-bit perceptual hash.
_DHASH_THUMBNAIL_W = 9
_DHASH_THUMBNAIL_H = 8


@dataclass(frozen=True)
class VisualSignals:
    """Full-frame visual signals for cheap prefilter policy decisions.

    Field shapes:

      - `hsv_histogram`:       (prod(hsv_bins),)  normalized
      - `brightness`:          float in [0, 1]
      - `log_blur`:            float, log1p(Laplacian variance of grayscale)
      - `edge_density`:        float in [0, 1]
      - `dhash_thumbnail`:     (_DHASH_THUMBNAIL_H, _DHASH_THUMBNAIL_W) uint8
      - `template_scores`:     dict[str, float]; empty in Phase 1
    """

    hsv_histogram: np.ndarray
    brightness: float
    log_blur: float
    edge_density: float
    dhash_thumbnail: np.ndarray
    template_scores: dict[str, float] = field(default_factory=dict)


def compute_visual_signals(
    image_bgr: np.ndarray,
    *,
    hsv_bins: tuple[int, int, int] = _DEFAULT_HSV_BINS,
) -> VisualSignals:
    """Compute the prefilter signals for a single BGR frame.

    Shares the BGR→HSV and BGR→gray conversions across all sub-signals so
    each frame pays for one cv2.cvtColor pair.
    """
    if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
        raise ValueError(f"expected HxWx3 BGR image, got {image_bgr.shape}")

    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    hist = _hsv_histogram_from_hsv(hsv, hsv_bins)
    brightness = float(hsv[..., 2].astype(np.float64).mean() / 255.0)
    blur_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    log_blur = float(np.log1p(max(0.0, blur_var)))

    if gray.size == 0:
        edge_density = 0.0
    else:
        edges = cv2.Canny(gray, _CANNY_LOW, _CANNY_HIGH)
        edge_density = float(np.count_nonzero(edges)) / float(gray.size)

    dhash = cv2.resize(
        gray,
        (_DHASH_THUMBNAIL_W, _DHASH_THUMBNAIL_H),
        interpolation=cv2.INTER_AREA,
    )

    return VisualSignals(
        hsv_histogram=hist,
        brightness=brightness,
        log_blur=log_blur,
        edge_density=edge_density,
        dhash_thumbnail=dhash,
    )
