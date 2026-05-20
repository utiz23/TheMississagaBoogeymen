"""Dependency-free signal helpers shared by the legacy classifier and the
Phase 1 frame-feature extractor.

Contains: Levenshtein-1 fuzzy substring matching, HSV histogram computation,
and a BGR→HSV one-shot converter. Pure numpy + cv2 — no OCR backend imports
(those live in `game_ocr.ocr` and pull in RapidOCR/ONNX).

The classifier module re-exports these symbols for backward compatibility.
"""

from __future__ import annotations

import cv2
import numpy as np


def hsv_histogram(image_bgr: np.ndarray, bins: tuple[int, int, int]) -> np.ndarray:
    """Compute a normalized HSV histogram. Returns a 1-D float64 array."""
    if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
        raise ValueError(f"expected HxWx3 BGR image, got {image_bgr.shape}")
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    return _hsv_histogram_from_hsv(hsv, bins)


def _hsv_histogram_from_hsv(hsv: np.ndarray, bins: tuple[int, int, int]) -> np.ndarray:
    """Same as hsv_histogram but takes an already-converted HSV image.

    Lets callers that need HSV for other purposes (e.g. brightness) reuse
    the conversion.
    """
    h_bins, s_bins, v_bins = bins
    hist = cv2.calcHist(
        [hsv], [0, 1, 2], None,
        [h_bins, s_bins, v_bins],
        [0, 180, 0, 256, 0, 256],
    )
    flat = hist.flatten().astype(np.float64)
    s = flat.sum()
    return flat / s if s > 0 else flat


def _levenshtein(a: str, b: str, max_distance: int) -> int:
    """Distance capped at max_distance + 1; returns early when exceeded."""
    if abs(len(a) - len(b)) > max_distance:
        return max_distance + 1
    m, n = len(a), len(b)
    if m == 0:
        return n
    if n == 0:
        return m
    prev = list(range(n + 1))
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        curr[0] = i
        min_row = i
        for j in range(1, n + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            v = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            curr[j] = v
            if v < min_row:
                min_row = v
        if min_row > max_distance:
            return max_distance + 1
        prev, curr = curr, prev
    return prev[n]


def fuzzy_contains(haystack: str, needle: str, max_distance: int = 1) -> bool:
    """True if `needle` (lowercased) appears in `haystack` (lowercased)
    with at most `max_distance` edits across a sliding window of needle's
    length. Exact substring is the fast path."""
    if not needle:
        return True
    h = haystack.lower()
    n = needle.lower()
    if n in h:
        return True
    if max_distance <= 0 or len(h) < len(n):
        return False
    nlen = len(n)
    for win_len in range(max(1, nlen - max_distance), nlen + max_distance + 1):
        for start in range(0, len(h) - win_len + 1):
            sub = h[start:start + win_len]
            if _levenshtein(sub, n, max_distance) <= max_distance:
                return True
    return False
