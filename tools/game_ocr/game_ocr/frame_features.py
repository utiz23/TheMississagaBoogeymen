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
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

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
