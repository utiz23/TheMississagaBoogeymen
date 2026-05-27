"""End-to-end caller-facing wrapper for the v2 feature pipeline.

Composes ROI extraction + OCR + text normalization with the pure
`compute_frame_features_v2` from `frame_features`. Lets the trainer +
dispatch swap an injected OCR backend without re-implementing the
crop/normalize boilerplate that `train_screen_classifier._read_anchor_text`
and `classifier.Classifier._read_anchor` already share for v1.

The OCRBackend is REQUIRED (no default). RapidOCR has a ~2s cold start, so
callers must construct it once outside per-frame loops; making the parameter
required at the type level forces that pattern.

The v1 path is not touched: `frame_features.compute_frame_features` +
`classifier.Classifier` remain callable for legacy reads until S5 swaps
the runtime over to v2.
"""

from __future__ import annotations

import numpy as np

from game_ocr.frame_features import (
    FrameFeaturesV2,
    compute_frame_features_v2,
)
from game_ocr.ocr import OCRBackend
from game_ocr.regex_priors import RegexPriorsConfig, RoiBbox
from game_ocr.utils import normalize_text


_DEFAULT_HSV_BINS: tuple[int, int, int] = (8, 3, 2)


def _scale_roi_to_image(
    roi: RoiBbox,
    image_shape: tuple[int, int],
) -> tuple[int, int, int, int]:
    """Map a 1920x1080-native RoiBbox onto the input frame's actual dims.

    Mirrors `classifier._scale_roi` (same scale factors + defensive clamps +
    degenerate-ROI raise) but adapted for `RoiBbox`'s (x, y, w, h) layout.
    Returns (x1, y1, x2, y2) suitable for `image[y1:y2, x1:x2]` slicing.
    """
    h, w = image_shape
    sx = w / 1920.0
    sy = h / 1080.0
    rx1 = max(0, min(w - 1, int(round(roi.x * sx))))
    rx2 = max(0, min(w, int(round((roi.x + roi.w) * sx))))
    ry1 = max(0, min(h - 1, int(round(roi.y * sy))))
    ry2 = max(0, min(h, int(round((roi.y + roi.h) * sy))))
    if rx2 <= rx1 or ry2 <= ry1:
        raise ValueError(
            f"degenerate ROI {roi.name!r} after scale to {image_shape}: "
            f"{(rx1, ry1, rx2, ry2)}"
        )
    return rx1, ry1, rx2, ry2


def _read_v2_roi_texts(
    image_bgr: np.ndarray,
    regex_priors: RegexPriorsConfig,
    ocr_backend: OCRBackend,
) -> dict[str, str]:
    """Crop + OCR + normalize every ROI in `regex_priors.rois`.

    Returns {roi_name: joined_normalized_lowercase_text}. Empty/whitespace
    OCR lines are dropped before joining (matches v1's `_read_anchor_text`).
    """
    texts: dict[str, str] = {}
    image_shape = (image_bgr.shape[0], image_bgr.shape[1])
    for roi_name, roi_bbox in regex_priors.rois.items():
        x1, y1, x2, y2 = _scale_roi_to_image(roi_bbox, image_shape)
        crop = image_bgr[y1:y2, x1:x2]
        lines = ocr_backend.read(crop)
        texts[roi_name] = " ".join(
            normalize_text(line.text) for line in lines if line.text
        ).lower()
    return texts


def compute_frame_features_v2_from_image(
    image_bgr: np.ndarray,
    *,
    regex_priors: RegexPriorsConfig,
    ocr_backend: OCRBackend,
    hsv_bins: tuple[int, int, int] = _DEFAULT_HSV_BINS,
) -> FrameFeaturesV2:
    """End-to-end: scale ROIs to image dims, crop, OCR, normalize, compute
    v2 features. The OCR backend is required — callers construct it once
    and pass it into per-frame loops to avoid RapidOCR's cold-start cost.
    """
    if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
        raise ValueError(f"expected HxWx3 BGR image, got {image_bgr.shape}")

    roi_texts = _read_v2_roi_texts(image_bgr, regex_priors, ocr_backend)
    return compute_frame_features_v2(
        image_bgr,
        top_bar_text=roi_texts.get("top_bar", ""),
        side_strip_text=roi_texts.get("side_strip", ""),
        regex_priors=regex_priors,
        hsv_bins=hsv_bins,
    )
