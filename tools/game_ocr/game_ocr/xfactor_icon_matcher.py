"""X-Factor icon-glyph matcher.

Replaces OCR-of-the-text-label as the primary X-Factor name classifier.
EA's 28 X-Factor icons each have THREE tier variants
(Red=Elite, Blue=All Star, Gold=Specialist), and the variants differ
in BOTH color and overall design — Red Elite has a spiky halo, Blue
All Star has chevron arrows, Gold Specialist is a plain diamond. So
a Gold-only template set DOES NOT correlate with a Red in-game render.

Strategy: load all 84 templates (28 X-Factors × 3 tiers), match the
grayscale ROI against every template, pick argmax. Grayscale matching
is COLOR-BLIND by design — the matcher reliably picks the right
X-Factor NAME but the template's tier field is NOT a reliable signal
(an All Star ROI may match an Elite template of the right X-Factor
better than the All Star template of the right X-Factor, because the
inner glyph silhouette is what dominates).

Callers should:
  - use `match_icon(...).canonical_name`  (reliable)
  - keep using `parsers._classify_xfactor_tier()` for tier (verified
    100% accurate on match-250 via HSV)
The `tier` field on `IconMatch` is exposed for diagnostics only.

Reference templates live at
`apps/web/public/assets/x-factors/<Name>/NHL_26_<Name>_X-Factor_Image__<Red|Gold|Blue>__File.png`.

Algorithm (one call per slot):
  1. Crop the ROI around the slot's centroid (default 70×70 px).
  2. Convert to grayscale (no thresholding — TM_CCOEFF_NORMED is
     brightness/contrast-invariant on its own; thresholding throws
     away mid-tone detail that helps disambiguate similar glyphs).
  3. For each of 84 templates: cv2.matchTemplate with TM_CCOEFF_NORMED.
  4. Pick argmax; return None when top score < confidence_threshold.

Performance: 84 × 64×64 templates against a 70×70 ROI is ~few ms per
slot — 3 slots per loadout capture is negligible vs the RapidOCR pass.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np


# Repo-root-relative path to the canonical X-Factor PNG library.
# `xfactor_icon_matcher.py` sits at `tools/game_ocr/game_ocr/`; the
# branding folder lives at `apps/web/public/assets/x-factors/`. Walk
# up four parents to reach repo root.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_TEMPLATE_DIR = _REPO_ROOT / "apps" / "web" / "public" / "assets" / "x-factors"

# Working sizes for template vs ROI:
#   TEMPLATE_PX is the size templates get resized to (after a
#   center-crop that trims away the empty corner padding of the source
#   PNG). ROI_PX is slightly larger so cv2.matchTemplate slides the
#   template across the ROI and finds the best alignment offset —
#   handles small centroid misalignment between the calibrated centroid
#   and the actual in-game icon center.
TEMPLATE_PX = 64
ROI_PX = 80
# Center-crop fraction applied to the raw 1024×1024 template PNGs.
# Empirically 0.60 gives the cleanest discrimination: tight enough to
# drop the empty-pixel padding around the icon (which made the matcher
# correlate against background instead of glyph), loose enough to keep
# the full glyph including the Elite tier's spiky halo. Lower fractions
# (≤0.45) crop INTO the glyph and conflate visually-similar X-Factors.
TEMPLATE_CENTER_CROP_FRACTION = 0.60
DEFAULT_CONFIDENCE_THRESHOLD = 0.35


_TIER_BY_COLOR: dict[str, str] = {
    "Red": "Elite",
    "Blue": "All Star",
    "Gold": "Specialist",
}


@dataclass(frozen=True)
class IconMatch:
    canonical_name: str
    tier: str  # 'Elite' | 'All Star' | 'Specialist' — implied by best-match template's color variant
    confidence: float


def _center_crop(bgr: np.ndarray, fraction: float) -> np.ndarray:
    """Take the central `fraction`-sized square. Used to trim empty
    padding around the icon in the raw 1024×1024 template PNGs."""
    h, w = bgr.shape[:2]
    side = int(min(h, w) * fraction)
    y0 = (h - side) // 2
    x0 = (w - side) // 2
    return bgr[y0:y0 + side, x0:x0 + side]


def _to_gray(bgr: np.ndarray, target_px: int) -> np.ndarray:
    """Resize → grayscale. TM_CCOEFF_NORMED is already brightness- /
    contrast-invariant so no thresholding is needed."""
    if bgr.shape[0] != target_px or bgr.shape[1] != target_px:
        bgr = cv2.resize(bgr, (target_px, target_px), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)


@dataclass(frozen=True)
class _Template:
    canonical_name: str
    tier: str
    gray: np.ndarray


@lru_cache(maxsize=1)
def _load_templates() -> tuple[_Template, ...]:
    """Load + preprocess all 28×3=84 canonical templates exactly once."""
    if not _TEMPLATE_DIR.is_dir():
        raise FileNotFoundError(
            f"X-Factor template dir missing: {_TEMPLATE_DIR}. "
            "Run scripts/scrape_ea_xfactor_pngs.sh to populate."
        )
    out: list[_Template] = []
    for sub in sorted(_TEMPLATE_DIR.iterdir()):
        if not sub.is_dir():
            continue
        for color, tier in _TIER_BY_COLOR.items():
            path = sub / f"NHL_26_{sub.name}_X-Factor_Image__{color}__File.png"
            if not path.exists():
                continue
            img = cv2.imread(str(path))
            if img is None:
                continue
            cropped = _center_crop(img, TEMPLATE_CENTER_CROP_FRACTION)
            out.append(
                _Template(
                    canonical_name=sub.name,
                    tier=tier,
                    gray=_to_gray(cropped, TEMPLATE_PX),
                )
            )
    if not out:
        raise FileNotFoundError(f"No tier-variant PNGs found under {_TEMPLATE_DIR}")
    return tuple(out)


def canonical_names() -> tuple[str, ...]:
    """Loaded canonical-name set — useful for tests / introspection."""
    return tuple(sorted({t.canonical_name for t in _load_templates()}))


def match_icon(
    frame_bgr: np.ndarray,
    cx: int,
    cy: int,
    radius: int = 40,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
) -> IconMatch | None:
    """Match the X-Factor glyph at (cx, cy) against all 84 canonical
    templates. Returns None when no template clears the confidence
    threshold — interpreted by the caller as an empty / unlocked slot.

    Args:
      frame_bgr: full BGR frame (numpy uint8, HxWx3).
      cx, cy: pixel coordinates of the icon center.
      radius: half-side of the crop. Default 65 produces a 130×130 ROI
        which fully encloses an in-game icon glyph (including Elite's
        spiky halo). Larger than the existing tier-classifier radius
        because template matching needs the whole glyph, not just a
        color sample.
      confidence_threshold: minimum TM_CCOEFF_NORMED score. 0.30 is the
        empirical lower bound observed on legitimate matches; raise to
        suppress weak matches if false positives appear.
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    x1, x2 = max(0, cx - radius), min(w, cx + radius)
    y1, y2 = max(0, cy - radius), min(h, cy + radius)
    if x2 <= x1 or y2 <= y1:
        return None
    crop = frame_bgr[y1:y2, x1:x2]
    if crop.size == 0:
        return None

    # ROI is larger than templates so matchTemplate slides the template
    # across the ROI and returns the best alignment offset's score —
    # forgives small centroid misalignment.
    roi = _to_gray(crop, ROI_PX)
    templates = _load_templates()

    best: _Template | None = None
    best_score = -1.0
    for tpl in templates:
        result = cv2.matchTemplate(roi, tpl.gray, cv2.TM_CCOEFF_NORMED)
        score = float(result.max())
        if score > best_score:
            best_score = score
            best = tpl

    if best is None or best_score < confidence_threshold:
        return None
    return IconMatch(canonical_name=best.canonical_name, tier=best.tier, confidence=best_score)
