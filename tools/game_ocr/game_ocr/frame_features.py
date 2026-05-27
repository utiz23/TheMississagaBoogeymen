"""Multi-signal per-frame feature extractor for Phase 1.

Round 4 §4 mandates more signals than HSV cosine alone. This module produces:

  - HSV histogram (kept from classifier.py — proven discriminator for stable
    high-contrast screens like loadout/lobby).
  - Anchor-text presence flags per state (using fuzzy_contains, same edit
    tolerance as the legacy classifier).
  - Reject-anchor flag (e.g. matchmaking / intermission text patterns).
  - Brightness (mean V channel, normalised) — separates loading transitions
    from gameplay.
  - Blur score (Laplacian variance) — quality signal for frame-bundle
    selection downstream and emission down-weighting today.

The output FrameFeatures dataclass is the contract for emissions.py.

v2 additions (S3 milestone B): `FrameFeaturesV2` + `compute_frame_features_v2`
produce a richer feature set for the v2 screen classifier — full-frame +
per-quadrant HSV, per-quadrant brightness/blur/edge density, regex prior
flags (one flag per `RegexPriorsConfig.priors_flat` entry), and global
OCR presence flags. The v1 path above is untouched; both coexist until
S5 wires v2 into the runtime.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from game_ocr.regex_priors import RegexPriorsConfig
from game_ocr.signal_utils import _hsv_histogram_from_hsv, fuzzy_contains
from game_ocr.state_machine import StateMachine


@dataclass(frozen=True)
class FrameFeatures:
    hsv_histogram: np.ndarray
    anchor_flags: np.ndarray
    anchor_text: str
    reject_anchor_present: bool
    brightness: float
    blur_score: float


def blur_score(image_bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _brightness_from_hsv(hsv: np.ndarray) -> float:
    v = hsv[..., 2].astype(np.float64)
    return float(v.mean() / 255.0)


def compute_frame_features(
    image_bgr: np.ndarray,
    *,
    anchor_text: str,
    state_machine: StateMachine,
    hist_bins: tuple[int, int, int] = (12, 4, 4),
    fuzzy_max_distance: int = 1,
) -> FrameFeatures:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    hist = _hsv_histogram_from_hsv(hsv, hist_bins)

    anchor_text_lower = anchor_text.lower()
    flags = np.zeros(len(state_machine.states), dtype=np.float64)
    for i, state in enumerate(state_machine.states):
        for sub in state_machine.anchor_substrings(state):
            if fuzzy_contains(anchor_text_lower, sub, fuzzy_max_distance):
                flags[i] = 1.0
                break

    reject_present = any(
        fuzzy_contains(anchor_text_lower, sub, fuzzy_max_distance)
        for sub in state_machine.reject_anchor_substrings
    )

    return FrameFeatures(
        hsv_histogram=hist,
        anchor_flags=flags,
        anchor_text=anchor_text,
        reject_anchor_present=reject_present,
        brightness=_brightness_from_hsv(hsv),
        blur_score=blur_score(image_bgr),
    )


# ─── v2 feature pipeline (S3 milestone B) ────────────────────────────────────

QUADRANT_NAMES: tuple[str, ...] = ("tl", "tr", "bl", "br")

OCR_PRESENCE_FLAG_NAMES: tuple[str, ...] = (
    "any_alpha",
    "any_digit",
    "any_hash_symbol",
)

# Default HSV bin split: 8·3·2 = 48 total bins per histogram.
_DEFAULT_HSV_BINS: tuple[int, int, int] = (8, 3, 2)

# Canny thresholds for the per-quadrant edge-density signal. Standard mid-range
# defaults that work well on UI screenshots without per-frame tuning.
_CANNY_LOW = 100
_CANNY_HIGH = 200


@dataclass(frozen=True)
class FrameFeaturesV2:
    """Frame features for the v2 screen classifier.

    Array shapes (the contract S5's trainer + runtime rely on):

      - `full_frame_hsv`:        (prod(hsv_bins),)        — normalized
      - `quadrant_hsvs`:         4 × (prod(hsv_bins),)    — normalized, TL/TR/BL/BR
      - `quadrant_brightness`:   (4,)  in [0, 1]
      - `quadrant_blur`:         (4,)  non-negative (Laplacian variance)
      - `quadrant_edge_density`: (4,)  in [0, 1]
      - `regex_prior_flags`:     (regex_priors.n_priors(),)  0/1, in priors_flat order
      - `ocr_presence_flags`:    (len(OCR_PRESENCE_FLAG_NAMES),)  0/1, in declared order
    """

    full_frame_hsv: np.ndarray
    quadrant_hsvs: tuple[np.ndarray, ...]
    quadrant_brightness: np.ndarray
    quadrant_blur: np.ndarray
    quadrant_edge_density: np.ndarray
    regex_prior_flags: np.ndarray
    ocr_presence_flags: np.ndarray
    top_bar_text: str
    side_strip_text: str


def _quadrants(image: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Split an HxWx? image into TL/TR/BL/BR. Odd dimensions: TL/TR/BL get the
    extra row/column so the four slices fully cover the image."""
    h, w = image.shape[:2]
    mid_y = h // 2 + (h % 2)
    mid_x = w // 2 + (w % 2)
    return (
        image[:mid_y, :mid_x],
        image[:mid_y, mid_x:],
        image[mid_y:, :mid_x],
        image[mid_y:, mid_x:],
    )


def _edge_density(gray_quadrant: np.ndarray) -> float:
    if gray_quadrant.size == 0:
        return 0.0
    edges = cv2.Canny(gray_quadrant, _CANNY_LOW, _CANNY_HIGH)
    return float(np.count_nonzero(edges)) / float(gray_quadrant.size)


def _laplacian_variance(gray_quadrant: np.ndarray) -> float:
    if gray_quadrant.size == 0:
        return 0.0
    return float(cv2.Laplacian(gray_quadrant, cv2.CV_64F).var())


def _ocr_presence_flags(combined_text: str) -> np.ndarray:
    flags = np.zeros(len(OCR_PRESENCE_FLAG_NAMES), dtype=np.float64)
    has_alpha = any(ch.isalpha() for ch in combined_text)
    has_digit = any(ch.isdigit() for ch in combined_text)
    has_hash = "#" in combined_text
    for i, name in enumerate(OCR_PRESENCE_FLAG_NAMES):
        if name == "any_alpha" and has_alpha:
            flags[i] = 1.0
        elif name == "any_digit" and has_digit:
            flags[i] = 1.0
        elif name == "any_hash_symbol" and has_hash:
            flags[i] = 1.0
    return flags


def _regex_prior_flags(
    regex_priors: RegexPriorsConfig,
    *,
    roi_texts: dict[str, str],
) -> np.ndarray:
    flags = np.zeros(regex_priors.n_priors(), dtype=np.float64)
    for i, prior in enumerate(regex_priors.priors_flat):
        text = roi_texts.get(prior.roi, "")
        if prior.matches(text):
            flags[i] = 1.0
    return flags


def compute_frame_features_v2(
    image_bgr: np.ndarray,
    *,
    top_bar_text: str,
    side_strip_text: str,
    regex_priors: RegexPriorsConfig,
    hsv_bins: tuple[int, int, int] = _DEFAULT_HSV_BINS,
) -> FrameFeaturesV2:
    """Compute the v2 feature vector for a single BGR frame.

    Caller is responsible for extracting `top_bar_text` and `side_strip_text`
    via OCR against the ROIs defined in `regex_priors.rois`. Keeping OCR
    out of this function lets the trainer batch OCR runs and lets tests
    pass synthetic text without standing up an OCR backend.
    """
    if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
        raise ValueError(f"expected HxWx3 BGR image, got {image_bgr.shape}")

    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    full_hsv_hist = _hsv_histogram_from_hsv(hsv, hsv_bins)

    hsv_quads = _quadrants(hsv)
    gray_quads = _quadrants(gray)

    quadrant_hsvs = tuple(_hsv_histogram_from_hsv(q, hsv_bins) for q in hsv_quads)
    quadrant_brightness = np.array(
        [_brightness_from_hsv(q) for q in hsv_quads], dtype=np.float64
    )
    quadrant_blur = np.array(
        [_laplacian_variance(q) for q in gray_quads], dtype=np.float64
    )
    quadrant_edge_density = np.array(
        [_edge_density(q) for q in gray_quads], dtype=np.float64
    )

    prior_flags = _regex_prior_flags(
        regex_priors,
        roi_texts={"top_bar": top_bar_text, "side_strip": side_strip_text},
    )
    presence_flags = _ocr_presence_flags(top_bar_text + " " + side_strip_text)

    return FrameFeaturesV2(
        full_frame_hsv=full_hsv_hist,
        quadrant_hsvs=quadrant_hsvs,
        quadrant_brightness=quadrant_brightness,
        quadrant_blur=quadrant_blur,
        quadrant_edge_density=quadrant_edge_density,
        regex_prior_flags=prior_flags,
        ocr_presence_flags=presence_flags,
        top_bar_text=top_bar_text,
        side_strip_text=side_strip_text,
    )
