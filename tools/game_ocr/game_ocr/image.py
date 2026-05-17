from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image


@dataclass(frozen=True)
class Region:
    name: str
    x: float
    y: float
    width: float
    height: float
    preprocess: str = "default"


def load_image(path: str) -> np.ndarray:
    with Image.open(path) as image:
        return cv2.cvtColor(np.array(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def crop_region(image: np.ndarray, region: Region) -> np.ndarray:
    height, width = image.shape[:2]
    x1 = max(0, int(region.x * width))
    y1 = max(0, int(region.y * height))
    x2 = min(width, int((region.x + region.width) * width))
    y2 = min(height, int((region.y + region.height) * height))
    return image[y1:y2, x1:x2].copy()


def preprocess_image(image: np.ndarray, mode: str) -> np.ndarray:
    # Skip gray + 2x upscale when the parser needs OCR bboxes in native
    # image coordinates (e.g. anchor-based full-frame parsing).
    if mode == "raw" or mode == "none":
        return image
    if mode == "flag-away":
        return _isolate_flag_half(image, side="away")
    if mode == "flag-home":
        return _isolate_flag_half(image, side="home")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scaled = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    if mode == "threshold":
        _, thresh = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return thresh
    if mode == "invert-threshold":
        _, thresh = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return 255 - thresh
    return scaled


# ─── Face-off flag isolation ──────────────────────────────────────────────────
#
# The post-game Faceoff Map renders each dot as a side-by-side pair of small
# flag chips: a red flag with the AWAY team's win count (white digit on red)
# and a dark/black flag with the HOME team's win count (white digit on dark).
# When fed both chips at once, RapidOCR mis-detects glyph boundaries because
# the two digits are tightly spaced. Splitting the ROI into two sub-crops —
# one containing only the red chip, one containing only the dark chip — lets
# OCR see a single digit per call, dramatically improving accuracy.
#
# We anchor on the red chip (it's the easiest to detect via HSV) and locate
# the dark chip as the mirror-image area immediately to its right. If no red
# chip is found, the away side is empty by definition; the home side falls
# back to the full crop so a dark-only configuration (4TH won but BM had no
# wins) still gets OCR'd.

_RED_HSV_LO_1 = np.array([0, 80, 60], dtype=np.uint8)
_RED_HSV_HI_1 = np.array([12, 255, 255], dtype=np.uint8)
_RED_HSV_LO_2 = np.array([168, 80, 60], dtype=np.uint8)
_RED_HSV_HI_2 = np.array([180, 255, 255], dtype=np.uint8)
# Dark flag detection: very low V on the HSV scale, with morphological
# cleanup to drop thin rink-line components. The rink background is medium
# gray (V ≈ 60–100), the dark flag is much darker (V < 35).
_DARK_V_MAX = 35
_MIN_RED_PIXELS = 30  # smaller blobs are rink-art noise, not a flag chip
# A real flag chip is ~30 px wide, ~30 px tall. We require both axes to
# exceed this threshold so a thin red sliver from a neighbouring chip
# (single-column noise on the crop edge) isn't mistaken for a flag. The
# max bound rejects bboxes that have merged with rink art (the dark
# face-off circle, center-ice rink labels) — a real flag never exceeds
# ~55 px on either axis at 1080p capture resolution.
_MIN_FLAG_WIDTH = 18
_MIN_FLAG_HEIGHT = 18
_MAX_FLAG_WIDTH = 110
_MAX_FLAG_HEIGHT = 80
_FLAG_BBOX_PAD = 3
_EMPTY_OUTPUT = 255 * np.ones((40, 40), dtype=np.uint8)


def _detect_dark_flag_bbox(crop: np.ndarray) -> tuple[int, int, int, int] | None:
    """Locate the dark flag chip in a face-off dot crop.

    Iterates dark-pixel connected components and picks the largest one
    that's flag-shaped — roughly square (AR ~1), at least 18 px on each
    axis. Rejects the elongated dark blobs from rink-art text labels
    ("CENTER ICE" runs across the bottom of the center face-off circle)
    that would otherwise dominate as the largest component.
    """
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    dark_mask = (hsv[..., 2] < _DARK_V_MAX).astype(np.uint8) * 255
    # Large closing kernel fills the white-digit "hole" inside the dark
    # flag — without it the digit splits the flag perimeter into multiple
    # tiny components instead of one ~30x35 blob.
    cleaned = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # Closing kernel sized to fill the white-digit hole inside a single
    # flag chip (~10-15 px tall digit on a ~30 px flag) without bridging
    # the flag to a neighbouring dark blob (e.g. rink-text below the
    # center face-off circle, typically 15+ px away).
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    if int(cv2.countNonZero(cleaned)) < _MIN_RED_PIXELS:
        return None
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(cleaned, connectivity=8)
    # Score each component (skipping label 0 = background): keep the
    # largest area among those that pass the flag-shape filters.
    candidates: list[tuple[int, int, int, int, int]] = []  # (area, x, y, w, h)
    for i in range(1, num_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        if area < _MIN_RED_PIXELS:
            continue
        if bw < _MIN_FLAG_WIDTH or bh < _MIN_FLAG_HEIGHT:
            continue
        if bw > _MAX_FLAG_WIDTH or bh > _MAX_FLAG_HEIGHT:
            continue
        # Real flag bbox: roughly square (pentagon shape gives bh slightly
        # > bw, ratio ~1.2-1.4). Reject elongated blobs in either axis.
        if bw > 1.8 * bh or bh > 1.6 * bw:
            continue
        candidates.append((area, int(stats[i, cv2.CC_STAT_LEFT]),
                           int(stats[i, cv2.CC_STAT_TOP]), bw, bh))
    if not candidates:
        return None
    candidates.sort(reverse=True)  # largest area first
    _, x, y, bw, bh = candidates[0]
    h, w = crop.shape[:2]
    x1 = max(0, x - _FLAG_BBOX_PAD)
    y1 = max(0, y - _FLAG_BBOX_PAD)
    x2 = min(w, x + bw + _FLAG_BBOX_PAD)
    y2 = min(h, y + bh + _FLAG_BBOX_PAD)
    return (x1, y1, x2, y2)


def _detect_red_flag_bbox(crop: np.ndarray) -> tuple[int, int, int, int] | None:
    """Return the (x1, y1, x2, y2) bbox of the LARGEST red region in the
    crop (the flag chip), or None if no significant red blob is found.

    Uses connected-components rather than the bbox of all red pixels so
    incidental red noise from neighbouring UI elements (rink branding,
    JPEG compression artifacts near the dark flag's corners) doesn't
    inflate the bbox.
    """
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    red_mask = cv2.inRange(hsv, _RED_HSV_LO_1, _RED_HSV_HI_1) | cv2.inRange(
        hsv, _RED_HSV_LO_2, _RED_HSV_HI_2
    )
    if int(cv2.countNonZero(red_mask)) < _MIN_RED_PIXELS:
        return None
    # Morphological close fills 1-2px gaps inside the flag (anti-aliased
    # digit edges) so the flag stays a single connected component.
    kernel = np.ones((3, 3), np.uint8)
    closed = cv2.morphologyEx(red_mask, cv2.MORPH_CLOSE, kernel)
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
    if num_labels < 2:
        return None
    # Skip label 0 (background). Pick the largest component by area.
    areas = stats[1:, cv2.CC_STAT_AREA]
    if areas.size == 0:
        return None
    best = int(np.argmax(areas)) + 1
    if int(stats[best, cv2.CC_STAT_AREA]) < _MIN_RED_PIXELS:
        return None
    h, w = crop.shape[:2]
    x = int(stats[best, cv2.CC_STAT_LEFT])
    y = int(stats[best, cv2.CC_STAT_TOP])
    bw = int(stats[best, cv2.CC_STAT_WIDTH])
    bh = int(stats[best, cv2.CC_STAT_HEIGHT])
    if bw < _MIN_FLAG_WIDTH or bh < _MIN_FLAG_HEIGHT:
        return None
    if bw > _MAX_FLAG_WIDTH or bh > _MAX_FLAG_HEIGHT:
        return None
    x1 = max(0, x - _FLAG_BBOX_PAD)
    y1 = max(0, y - _FLAG_BBOX_PAD)
    x2 = min(w, x + bw + _FLAG_BBOX_PAD)
    y2 = min(h, y + bh + _FLAG_BBOX_PAD)
    return (x1, y1, x2, y2)


def _binarize_for_ocr(sub: np.ndarray) -> np.ndarray:
    """Prepare a color-isolated flag chip for RapidOCR.

    The EA flag chips render at ~70-80% opacity, so the rink art (face-off
    circles, blue lines, the dot itself) bleeds THROUGH the flag body. Otsu
    thresholding on a grayscale crop has to choose ONE cutoff for a
    three-peak histogram (white digit / translucent flag body / bleed-through
    rink lines) and frequently picks one that fragments the digit or leaves
    noise stripes that confuse RapidOCR's text-detection model.

    Pipeline that sidesteps that:
      1. HSV-isolate the white digit pixels (high V, low S) — leaves
         everything else as black, regardless of transparency artefacts.
      2. Morph-close 1-2 px gaps from anti-aliased edges.
      3. 3x cubic upscale.
      4. Invert (black digit on white background — what document-trained
         OCR models expect).
      5. 16-px white border so the digit isn't flush with the edge.
    """
    if sub.size == 0:
        return _EMPTY_OUTPUT.copy()
    h, w = sub.shape[:2]
    # The EA flag chips render at ~70-80% opacity, so the rink art bleeds
    # through. Otsu binarization picks a single global threshold which is
    # the wrong tool for a histogram with three peaks (white digit /
    # translucent flag body / bleed-through rink lines). Local adaptive
    # thresholding compares each pixel to its small neighbourhood instead,
    # which classifies the white digit as "much brighter than its local
    # surroundings" regardless of what colour the flag/rink behind it is.
    gray = cv2.cvtColor(sub, cv2.COLOR_BGR2GRAY)
    # Upscale BEFORE thresholding so the local-neighbourhood window has
    # enough pixels around each glyph edge to compute a stable mean.
    scaled = cv2.resize(gray, None, fx=3.0, fy=3.0, interpolation=cv2.INTER_CUBIC)
    # block_size must be odd; chosen to roughly match a single digit's
    # width (the local-mean window should "see" one digit's worth of
    # context). Too large and adaptive threshold degrades to global Otsu;
    # too small and the digit interior is misclassified.
    block_size = 31
    thresh = cv2.adaptiveThreshold(
        scaled, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, block_size, -10,
    )
    # `thresh` is white-on-black (pixels brighter than local mean → white).
    # Rink-art arcs (~3 px thick white lines from the face-off circle)
    # bleed through the translucent dark flag — OCR then reads "1" as "7"
    # (1 + arc) or sees a stray "|" fragment as a phantom "1". An ELLIPSE
    # OPEN with a 5x5 kernel erases anything thinner than ~5 px while
    # keeping the digit's strokes intact.
    open_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    opened = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, open_kernel)
    if int(cv2.countNonZero(opened)) < 50:
        return _EMPTY_OUTPUT.copy()
    # Keep ONLY the single largest connected component (the digit). Any
    # other surviving blob is a rink-line fragment — OCR otherwise reads
    # the digit + a stray curve as "7" or "9" instead of "1" or "0".
    # Iterate components by area descending; pick the first one whose
    # bbox is plausibly digit-shaped (a single digit fills most of its
    # bbox; rink-line arcs don't).
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    if num_labels < 2:
        return _EMPTY_OUTPUT.copy()
    areas = stats[1:, cv2.CC_STAT_AREA]
    sorted_idx = np.argsort(areas)[::-1] + 1
    chosen = None
    for idx in sorted_idx:
        area = int(stats[idx, cv2.CC_STAT_AREA])
        if area < 80:
            break  # remaining are even smaller
        bw = int(stats[idx, cv2.CC_STAT_WIDTH])
        bh = int(stats[idx, cv2.CC_STAT_HEIGHT])
        # Digit fill ratio: a digit's blob covers ~30-65% of its bbox.
        # Rink-line arcs are sparse (<15%). Reject sparse blobs.
        if bw == 0 or bh == 0:
            continue
        fill = area / float(bw * bh)
        if fill < 0.20:
            continue
        chosen = int(idx)
        break
    if chosen is None:
        return _EMPTY_OUTPUT.copy()
    digit_only = np.where(labels == chosen, 255, 0).astype(np.uint8)
    inverted = 255 - digit_only
    bordered = cv2.copyMakeBorder(inverted, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=255)
    return bordered


def _isolate_flag_half(crop: np.ndarray, *, side: str) -> np.ndarray:
    """Crop one half of a face-off dot ROI down to just the away (red) or
    home (dark) flag chip, then binarize for OCR.

    Returns a clean all-white image when the requested half is missing —
    OCR will return zero text and the parser reports MISSING.
    """
    if crop.size == 0:
        return _EMPTY_OUTPUT.copy()
    red_bbox = _detect_red_flag_bbox(crop)
    h, w = crop.shape[:2]
    if side == "away":
        if red_bbox is None:
            return _EMPTY_OUTPUT.copy()
        x1, y1, x2, y2 = red_bbox
        sub = crop[y1:y2, x1:x2]
        return _binarize_for_ocr(sub)
    # side == "home"
    if red_bbox is None:
        # No red anchor — locate the dark flag directly via low-V mask.
        dark_bbox = _detect_dark_flag_bbox(crop)
        if dark_bbox is None:
            return _EMPTY_OUTPUT.copy()
        dx1, dy1, dx2, dy2 = dark_bbox
        sub = crop[dy1:dy2, dx1:dx2]
        return _binarize_for_ocr(sub)
    rx1, ry1, rx2, ry2 = red_bbox
    red_w = max(rx2 - rx1, 30)
    home_x1 = min(w - 1, rx2 + 1)
    home_x2 = min(w, home_x1 + red_w + _FLAG_BBOX_PAD * 2)
    if home_x2 <= home_x1 + 4:
        # No room to the right — dark chip would be outside the ROI.
        return _EMPTY_OUTPUT.copy()
    # Extend vertically a touch beyond the red bbox in case the dark chip
    # sits slightly higher/lower (EA's flag chips are vertically aligned
    # but the connected-pixel bbox can crop too tightly).
    pad = _FLAG_BBOX_PAD
    home_y1 = max(0, ry1 - pad)
    home_y2 = min(h, ry2 + pad)
    sub = crop[home_y1:home_y2, home_x1:home_x2]
    if sub.size == 0:
        return _EMPTY_OUTPUT.copy()
    return _binarize_for_ocr(sub)

