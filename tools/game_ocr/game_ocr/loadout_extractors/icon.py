"""Phase 2A-6: Icon-family extractor for X-Factor template match + tier color.

Public API
----------
IconEvidence
    Frozen dataclass — one candidate for an icon-family field (X-Factor name OR
    X-Factor tier color).

LoadoutIconExtractor
    Wraps the legacy ``xfactor_icon_matcher.match_icon`` (Phase 1 template
    matcher) and ``parsers._classify_xfactor_tier`` (HSV color sampler) as
    evidence-layer candidates.

    Per loadout slot emits up to 6 ``IconEvidence`` records:
      - 3 X-Factor *name* candidates (``field_key`` = ``x_factor_name_<idx>``)
      - 3 X-Factor *tier* candidates (``field_key`` = ``x_factor_tier_<idx>``)

    Slots with no recognisable icon emit a single ``observability='low_quality'``
    name record — never silently dropped.

Empirical icon centroids
------------------------
Taken from ``parsers._LOADOUT_XFACTOR_ICON_CENTROIDS``:

    [(500, 340), (1000, 340), (1500, 340)]

These are the defaults used when the caller does not supply ``icon_centers``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from ..xfactor_icon_matcher import match_icon  # noqa: F401  (re-exported for patch targets in tests)
from ..parsers import _classify_xfactor_tier  # noqa: F401

# ---------------------------------------------------------------------------
# Default ROI constants — kept in sync with parsers.py
# ---------------------------------------------------------------------------

# Empirical X-Factor icon centroids (validated 18/18 in xfactor_tier_spike.py).
_DEFAULT_ICON_CENTERS: tuple[tuple[int, int], ...] = (
    (500, 340),
    (1000, 340),
    (1500, 340),
)

# Radius used by the legacy tier classifier (parsers._LOADOUT_XFACTOR_ICON_RADIUS).
_TIER_RADIUS: int = 35

# Half-side of the ROI passed to match_icon (see xfactor_icon_matcher.match_icon).
_ICON_MATCH_RADIUS: int = 40


# ---------------------------------------------------------------------------
# IconEvidence
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IconEvidence:
    """One candidate for an icon-family field (X-Factor name OR X-Factor tier color).

    Attributes
    ----------
    field_family:
        Always ``"icon"``.
    field_key:
        ``"x_factor_name_<slot_idx>"`` for the template-match candidate, or
        ``"x_factor_tier_<slot_idx>"`` for the HSV tier-color candidate.
    shape_or_icon_class:
        Canonical X-Factor name (e.g. ``"Wheels"``, ``"One_T"``) for name
        candidates, or tier name (``"Elite"``, ``"All Star"``,
        ``"Specialist"``) for tier candidates.  Empty string when
        ``observability='low_quality'``.
    raw_confidence:
        Template-match TM_CCOEFF_NORMED score for name candidates; ``1.0``
        when the HSV classifier cleanly returns a tier; ``0.0`` for
        low-quality / no-match records.
    calibrated_confidence:
        Equal to ``raw_confidence`` in Phase 2A.  Reserved for Platt-scaling
        in Phase 3+.
    x_norm:
        Horizontal icon-centre in normalised [0, 1] image coordinates
        (``cx / image_width``).
    y_norm:
        Vertical icon-centre in normalised [0, 1] image coordinates
        (``cy / image_height``).
    roi_bbox:
        Normalised bounding box ``{"x": ..., "y": ..., "w": ..., "h": ...}``
        of the region examined, or ``None``.
    observability:
        ``"observable"``                  — a result was produced.
        ``"low_quality"``                 — template match below threshold
                                            (``raw_confidence == 0.0``).
        ``"not_observable_from_source"``  — ROI is outside the image bounds.
    """

    field_family: str  # always "icon"
    field_key: str  # e.g. "x_factor_name_0", "x_factor_tier_2"
    shape_or_icon_class: str  # canonical X-Factor name or tier label (or "" on low_quality)
    raw_confidence: float
    calibrated_confidence: float  # == raw_confidence in Phase 2A
    x_norm: float  # icon centre, normalised [0, 1]
    y_norm: float
    roi_bbox: Optional[dict[str, float]] = None
    observability: str = "observable"  # 'observable' | 'low_quality' | 'not_observable_from_source'


# ---------------------------------------------------------------------------
# LoadoutIconExtractor
# ---------------------------------------------------------------------------


class LoadoutIconExtractor:
    """Icon-family extractor wrapping the legacy X-Factor template matcher + tier color sampler.

    Per loadout slot emits up to 6 ``IconEvidence`` records:
      - Up to 3 X-Factor *name* candidates (one per slot).
      - Up to 3 X-Factor *tier* candidates (one per slot, only when the HSV
        classifier returns a clean tier label).

    Slots with no recognisable icon still emit exactly one name record with
    ``observability='low_quality'`` — never silently dropped.

    The legacy components (``xfactor_icon_matcher.match_icon`` and
    ``parsers._classify_xfactor_tier``) are called at extraction time via
    local imports so that they remain patchable in unit tests.
    """

    EXTRACTOR_VERSION = "icon-v1"

    def extract_xfactor_icons(
        self,
        image_bgr: np.ndarray,
        *,
        slot_anchor_y: int = 0,
        icon_centers: Sequence[tuple[int, int]] = _DEFAULT_ICON_CENTERS,
    ) -> list[IconEvidence]:
        """Extract X-Factor icon evidence + tier-color evidence for a single slot.

        Parameters
        ----------
        image_bgr:
            Full-frame BGR image (numpy ndarray, shape H×W×3).
        slot_anchor_y:
            Vertical offset applied to the default icon-centre y-values when
            the loadout pane is shifted vertically.  Pass 0 for the standard
            layout.
        icon_centers:
            Sequence of 3 ``(cx, cy)`` pixel pairs — one per X-Factor icon
            slot.  Defaults to the empirically calibrated centroids from
            ``parsers._LOADOUT_XFACTOR_ICON_CENTROIDS``.

        Returns
        -------
        list[IconEvidence]
            Up to 6 records in slot-index order:
            ``[name_0, name_1, name_2, tier_0*, tier_1*, tier_2*]``
            (tier records omitted when HSV returns ``None``).
            Slots with no recognisable icon emit a single ``low_quality``
            name record.
        """
        results: list[IconEvidence] = []

        if image_bgr is None or image_bgr.size == 0:
            return results

        H, W = image_bgr.shape[:2]

        for slot_idx, (cx_raw, cy_raw) in enumerate(icon_centers):
            cx = cx_raw
            cy = cy_raw + slot_anchor_y

            # Normalised centre coordinates (clamped to [0, 1]).
            x_norm = cx / W if W > 0 else 0.0
            y_norm = cy / H if H > 0 else 0.0

            # ROI bounding box in normalised coords (for observability records).
            roi_w = (2 * _ICON_MATCH_RADIUS) / W
            roi_h = (2 * _ICON_MATCH_RADIUS) / H
            roi_bbox: dict[str, float] = {
                "x": max(0.0, (cx - _ICON_MATCH_RADIUS) / W),
                "y": max(0.0, (cy - _ICON_MATCH_RADIUS) / H),
                "w": roi_w,
                "h": roi_h,
            }

            # ── X-Factor name via template matching ──────────────────────
            icon_result = match_icon(image_bgr, cx, cy)

            if icon_result is not None:
                # icon_result is an IconMatch(canonical_name, tier, confidence)
                results.append(
                    IconEvidence(
                        field_family="icon",
                        field_key=f"x_factor_name_{slot_idx}",
                        shape_or_icon_class=icon_result.canonical_name,
                        raw_confidence=icon_result.confidence,
                        calibrated_confidence=icon_result.confidence,
                        x_norm=x_norm,
                        y_norm=y_norm,
                        roi_bbox=roi_bbox,
                        observability="observable",
                    )
                )
            else:
                # No match above threshold → low_quality sentinel.
                results.append(
                    IconEvidence(
                        field_family="icon",
                        field_key=f"x_factor_name_{slot_idx}",
                        shape_or_icon_class="",
                        raw_confidence=0.0,
                        calibrated_confidence=0.0,
                        x_norm=x_norm,
                        y_norm=y_norm,
                        roi_bbox=roi_bbox,
                        observability="low_quality",
                    )
                )

            # ── X-Factor tier via HSV color sampler ──────────────────────
            tier = _classify_xfactor_tier(image_bgr, cx, cy)

            if tier is not None:
                tier_roi_bbox: dict[str, float] = {
                    "x": max(0.0, (cx - _TIER_RADIUS) / W),
                    "y": max(0.0, (cy - _TIER_RADIUS) / H),
                    "w": (2 * _TIER_RADIUS) / W,
                    "h": (2 * _TIER_RADIUS) / H,
                }
                results.append(
                    IconEvidence(
                        field_family="icon",
                        field_key=f"x_factor_tier_{slot_idx}",
                        shape_or_icon_class=tier,
                        raw_confidence=1.0,
                        calibrated_confidence=1.0,
                        x_norm=x_norm,
                        y_norm=y_norm,
                        roi_bbox=tier_roi_bbox,
                        observability="observable",
                    )
                )
            # When tier returns None the name record already tracks slot existence.

        return results
