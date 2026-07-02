"""Captain ★ visual scorer.

Replaces the old glyph-substring heuristic (scan OCR text lines for a ``★``
character and report the *OCR line confidence*) as the authoritative captain
signal. That text signal did not discriminate — on match 250 a false positive
(for/LW) scored *between* the two real captains, and no threshold separated
true from false (see ``docs/ocr/captain-detection-extractor-followup.md``).

Strategy: score the real gold room-leader star directly from the frame. The
captain marker in the EASHL lobby/loadout is a small gold/amber ★ rendered to
the left of the room-leader's gamertag. We measure the **gold-pixel fraction**
over a tight ROI at that location — a slot that renders the star has a
meaningful gold cluster there; a slot that does not has ~none. This mirrors the
gold-hue logic already proven for X-Factor tiers in
``parsers._classify_xfactor_tier`` (hue ~15–35, S>~100, V>~60), and the icon
matcher's role of overriding an unreliable OCR-text field with a visual score.

Callers should:
  - compute ``score_captain_star(...)`` per available frame, and resolve
    captain by the **cross-frame max** score per slot (a clean non-star frame
    must not discard a star observation from another frame);
  - treat the returned score as the per-observation captain confidence, and
    enforce one-captain-per-side downstream via argmax over these scores.

CALIBRATE: the ROI geometry (radius, x-offset from the gamertag) and the
``FULL_STAR_FRACTION`` normalizer below are principled defaults, not yet tuned
against star-bearing source frames. No committed fixture renders the captain
star (``fixture_match250_full_lobby`` does not expose it for the two real
captains), so real-frame calibration is deferred to the Phase G re-ingest. The
detector math is validated synthetically in
``tests/test_captain_star_matcher.py``.
"""

from __future__ import annotations

# CALIBRATE: default half-width of the square star ROI, in px. Sized for a
# small lobby/loadout star; the caller normally passes an explicit radius.
DEFAULT_STAR_RADIUS = 20

# Gold-hue gate, matching parsers._classify_xfactor_tier's Specialist cluster.
# OpenCV hue is 0–179; gold/amber sits ~20–30.
_GOLD_HUE_LO = 15
_GOLD_HUE_HI = 35
_GOLD_SAT_MIN = 100
_GOLD_VAL_MIN = 60

# Minimum gold-pixel count for a real cluster. Below this we call it noise and
# return 0.0 (no star), analogous to the tier classifier's "< 50" saturated-
# pixel gate but scaled down for the smaller captain ROI.
_MIN_GOLD_PIXELS = 12

# CALIBRATE: gold-pixel fraction of the ROI a clearly-rendered star produces.
# The graded score saturates to 1.0 at this fraction. A star outline+fill fills
# only part of a tight ROI, so this is well below 1.0. Tune at Phase G against
# real for/C and against/C crops.
FULL_STAR_FRACTION = 0.15


def score_captain_star(
    frame_bgr,
    cx: int,
    cy: int,
    radius: int = DEFAULT_STAR_RADIUS,
) -> float:
    """Score the gold captain ★ in a tight ROI centered at ``(cx, cy)``.

    ``(cx, cy)`` is the expected star location — left of the gamertag at the
    row's y-center (the caller supplies this from row/panel geometry).

    Returns a graded confidence in ``[0.0, 1.0]``: high when a gold star
    cluster is present, ``0.0`` for ``None``/empty input, an out-of-bounds or
    empty ROI, or when the gold cluster is below the noise floor.
    """
    import cv2  # local import to avoid a hard cv2 dependency at module load
    import numpy as np

    if frame_bgr is None:
        return 0.0
    if not hasattr(frame_bgr, "shape") or frame_bgr.size == 0:
        return 0.0

    h, w = frame_bgr.shape[:2]
    x1, x2 = max(0, cx - radius), min(w, cx + radius)
    y1, y2 = max(0, cy - radius), min(h, cy + radius)
    if x2 <= x1 or y2 <= y1:
        return 0.0  # ROI fell entirely outside the frame

    patch = frame_bgr[y1:y2, x1:x2]
    if patch.size == 0:
        return 0.0

    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    pixels = hsv.reshape(-1, 3)
    mask = (
        (pixels[:, 0] >= _GOLD_HUE_LO)
        & (pixels[:, 0] <= _GOLD_HUE_HI)
        & (pixels[:, 1] > _GOLD_SAT_MIN)
        & (pixels[:, 2] > _GOLD_VAL_MIN)
    )
    gold_count = int(mask.sum())
    if gold_count < _MIN_GOLD_PIXELS:
        return 0.0  # no gold cluster: not a captain star

    total = int(pixels.shape[0])
    fraction = gold_count / total
    # Graded, saturating score. CALIBRATE: FULL_STAR_FRACTION reference above.
    score = fraction / FULL_STAR_FRACTION
    return float(min(1.0, score))
