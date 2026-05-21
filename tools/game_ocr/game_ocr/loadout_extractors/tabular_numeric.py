"""Phase 2A-5: Tabular numeric extractor for the 23-attribute grid + delta chips.

Public API
----------
NumericCellEvidence
    Frozen dataclass — one ranked candidate for one (row_key, column_key) cell.

LoadoutTabularExtractor
    Extracts all 23 × {value, delta} = 46+ NumericCellEvidence records from a
    loadout-view frame.  Multiple ranked candidates per cell are emitted when
    fallback strategies fire — the promotion gate (Task 2A-17) picks the winner.

Candidate ranking
-----------------
  rank 0 — cell-aligned crop OCR (`_extract_cell` result from full-frame lines)
  rank 1 — full-frame rescan via `_rescan_delta_chip` (tight-ROI 4× upscale)
  rank 2 — HSV-sign-recovery for delta sign when OCR drops the leading "-"

Missing cells (no above-threshold result) still emit one NumericCellEvidence
with observability='low_quality' and value=None — never silently dropped.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

from .closed_vocab import load_attribute_keys

# ---------------------------------------------------------------------------
# ROI constants — re-used from parsers.py loadout-attributes block
# ---------------------------------------------------------------------------
# Row y-centres for the attribute grid (5 rows per group, empirically derived).
_ATTR_ROW_YS = [598, 656, 714, 771, 830]

# x-offset from column centre to left edge of the delta chip band
# Layout relative to column cx:  label 0..90 | delta 90..170 | value 170..270
_DELTA_X_OFFSET_LEFT = 90   # delta band left (relative to cx)
_DELTA_X_OFFSET_RIGHT = 170  # delta band right
_VALUE_X_OFFSET_LEFT = 170   # value band left
_VALUE_X_OFFSET_RIGHT = 270  # value band right

# Minimum OCR confidence to treat a rank-0 result as "good enough" (skip rank 1)
_CONFIDENCE_THRESHOLD = 0.72

# Confidence assigned to rank-1 (rescan) and rank-2 (HSV-sign) candidates
_RESCAN_CONFIDENCE = 0.70
_HSV_SIGN_CONFIDENCE = 0.60

# ---------------------------------------------------------------------------
# NumericCellEvidence
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NumericCellEvidence:
    """One candidate value for one cell of the tabular attribute grid.

    Multiple candidates per (row_key, column_key) are allowed — different OCR
    strategies (cell-aligned crop, full-frame rescan, HSV sign recovery)
    each contribute a ranked candidate.  The promotion gate decides which wins.

    Attributes
    ----------
    row_key:
        One of the 23 attribute keys (e.g. "wrist_shot_accuracy", "speed").
    column_key:
        ``"value"`` (R column, 0-99) or ``"delta"`` (Δ chip, signed int).
    value:
        Extracted integer, or ``None`` when extraction failed.
    raw_confidence:
        Confidence from the OCR backend (rank 0) or a fixed heuristic value
        for fallback strategies (ranks 1-2).
    calibrated_confidence:
        Equal to ``raw_confidence`` in Phase 2A.  Reserved for Platt-scaling
        calibration in Phase 3+.
    candidate_rank:
        0 = top strategy (cell-aligned crop);
        1 = rescan fallback (`_rescan_delta_chip`);
        2 = HSV-color sign-recovery for delta chips.
    roi_bbox:
        Normalised bounding box ``{"x": ..., "y": ..., "w": ..., "h": ...}``
        of the region examined, or ``None``.
    observability:
        ``"observable"``            — OCR returned a plausible result.
        ``"low_quality"``           — No above-threshold result; value is None.
        ``"not_observable_from_source"`` — Region is outside the image bounds.
    """

    row_key: str
    column_key: str  # "value" | "delta"
    value: Optional[int]
    raw_confidence: float
    calibrated_confidence: float  # == raw_confidence in Phase 2A
    candidate_rank: int  # 0 = cell-aligned crop; 1 = rescan; 2 = HSV-sign
    roi_bbox: Optional[dict[str, float]] = None
    observability: str = "observable"  # 'observable' | 'low_quality' | 'not_observable_from_source'


# ---------------------------------------------------------------------------
# LoadoutTabularExtractor
# ---------------------------------------------------------------------------


class LoadoutTabularExtractor:
    """Tabular numeric extractor for the 23-attribute grid + delta chips.

    Per cell emits up to 3 ranked candidates:
      - rank 0: cell-aligned crop OCR (highest confidence when cell is clear)
      - rank 1: full-frame rescan (legacy ``_rescan_delta_chip`` fallback)
      - rank 2: HSV-sign-recovery fallback for delta sign when OCR drops "-"

    All candidates are emitted explicitly — the promotion gate decides which
    wins.  Missing cells (no above-threshold OCR result) get a single
    NumericCellEvidence with ``observability='low_quality'`` and
    ``value=None``.

    Parameters
    ----------
    version:
        NHL game version key matching the config subdirectory (default
        ``"nhl26"``).
    """

    EXTRACTOR_VERSION = "tabular-numeric-v1"

    def __init__(self, *, version: str = "nhl26") -> None:
        groups = load_attribute_keys(version=version)
        # Flatten groups to an ordered 23-key list preserving YAML order.
        self._attribute_keys: list[str] = [k for keys in groups.values() for k in keys]
        assert len(self._attribute_keys) == 23, (
            f"expected 23 attributes, got {len(self._attribute_keys)}"
        )

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def extract_attribute_grid(
        self,
        image_bgr: np.ndarray,
        *,
        slot_anchor_y: int,
        ocr_lines: Sequence,  # Sequence[OCRLine] — avoid hard import at class level
        column_cx: float = 0.0,
    ) -> list[NumericCellEvidence]:
        """Extract 23 × {value, delta} = 46+ NumericCellEvidence records.

        Parameters
        ----------
        image_bgr:
            Full-frame BGR image (numpy ndarray, shape H×W×3).
        slot_anchor_y:
            Y-offset applied to the empirical row-y constants.  Pass 0 for
            default layout; pass a measured offset when the loadout pane is
            shifted vertically.
        ocr_lines:
            Full-frame OCR lines (list of OCRLine) from the prior full-frame
            RapidOCR pass.  Used for rank-0 extraction via ``_extract_cell``.
        column_cx:
            X-centre of the attribute column.  Defaults to 0.0 (test/unknown);
            callers should supply the measured column centre so that
            ``_extract_cell`` and ``_rescan_delta_chip`` can locate the right
            band.

        Returns
        -------
        list[NumericCellEvidence]
            At least 46 records (one rank-0 per (row_key, column_key)),
            possibly more when fallback strategies fire.
        """
        # Import here to avoid circular dependency at module level and to make
        # the import patchable in tests.
        from ..parsers import _extract_cell, _rescan_delta_chip, _lines_in_bbox

        results: list[NumericCellEvidence] = []

        for grid_row_idx, attribute_key in enumerate(self._attribute_keys):
            row_y = _ATTR_ROW_YS[grid_row_idx % len(_ATTR_ROW_YS)] + slot_anchor_y

            # Gather the OCR lines that fall in this cell's bounding box.
            cell_lines = list(_lines_in_bbox(
                list(ocr_lines),
                (row_y - 25, row_y + 25),
                (column_cx - 80, column_cx + 280),
            ))

            # ── rank-0: value column ─────────────────────────────────────
            value_candidates = self._extract_value_candidates(
                image_bgr=image_bgr,
                grid_row_idx=grid_row_idx,
                slot_anchor_y=slot_anchor_y,
                cell_lines=cell_lines,
                attribute_key=attribute_key,
                column_cx=column_cx,
                extract_cell_fn=_extract_cell,
            )
            results.extend(value_candidates)

            # ── rank-0/1/2: delta column ─────────────────────────────────
            delta_candidates = self._extract_delta_candidates(
                image_bgr=image_bgr,
                grid_row_idx=grid_row_idx,
                slot_anchor_y=slot_anchor_y,
                cell_lines=cell_lines,
                attribute_key=attribute_key,
                column_cx=column_cx,
                extract_cell_fn=_extract_cell,
                rescan_fn=_rescan_delta_chip,
            )
            results.extend(delta_candidates)

        return results

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _row_roi(self, grid_row_idx: int, slot_anchor_y: int, column_cx: float) -> dict[str, float]:
        """Return the row-bounding-box dict for the given grid row."""
        row_y = _ATTR_ROW_YS[grid_row_idx % len(_ATTR_ROW_YS)] + slot_anchor_y
        return {
            "x": column_cx - 80,
            "y": row_y - 25,
            "w": 360.0,
            "h": 50.0,
        }

    def _extract_value_candidates(
        self,
        *,
        image_bgr: np.ndarray,
        grid_row_idx: int,
        slot_anchor_y: int,
        cell_lines: list,
        attribute_key: str,
        column_cx: float,
        extract_cell_fn,
    ) -> list[NumericCellEvidence]:
        """Emit rank-0 (and optional rank-1) candidates for the R-value column."""
        row_bbox = self._row_roi(grid_row_idx, slot_anchor_y, column_cx)
        value_roi = {
            "x": column_cx + _VALUE_X_OFFSET_LEFT,
            "y": row_bbox["y"],
            "w": float(_VALUE_X_OFFSET_RIGHT - _VALUE_X_OFFSET_LEFT),
            "h": row_bbox["h"],
        }

        value_field, _delta_field = extract_cell_fn(cell_lines, column_cx, image_bgr)

        # rank-0 candidate
        if value_field.value is not None:
            conf = value_field.confidence if value_field.confidence is not None else 0.0
            return [
                NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="value",
                    value=int(value_field.value),
                    raw_confidence=conf,
                    calibrated_confidence=conf,
                    candidate_rank=0,
                    roi_bbox=value_roi,
                    observability="observable",
                )
            ]

        # No value from rank-0: emit a low_quality placeholder.
        # (No rank-1 rescan is defined for the value column — only delta chips
        # have the tight-ROI rescan fallback in the legacy code.)
        return [
            NumericCellEvidence(
                row_key=attribute_key,
                column_key="value",
                value=None,
                raw_confidence=0.0,
                calibrated_confidence=0.0,
                candidate_rank=0,
                roi_bbox=value_roi,
                observability="low_quality",
            )
        ]

    def _extract_delta_candidates(
        self,
        *,
        image_bgr: np.ndarray,
        grid_row_idx: int,
        slot_anchor_y: int,
        cell_lines: list,
        attribute_key: str,
        column_cx: float,
        extract_cell_fn,
        rescan_fn,
    ) -> list[NumericCellEvidence]:
        """Emit ranked candidates for the Δ-delta column.

        Strategy:
          1. rank 0 — result from ``_extract_cell`` (full-frame OCR lines).
          2. rank 1 — ``_rescan_delta_chip`` (tight-ROI 4× upscale) when rank-0
             confidence < threshold OR rank-0 value is None.
          3. rank 2 — HSV-sign-recovery when OCR text had no leading sign glyph
             (``_infer_delta_sign_from_color`` applied to the rank-1 line).

        All emitted candidates are explicit — no silent rescue heuristics.
        """
        from ..parsers import _infer_delta_sign_from_color

        row_y = _ATTR_ROW_YS[grid_row_idx % len(_ATTR_ROW_YS)] + slot_anchor_y
        row_bbox = self._row_roi(grid_row_idx, slot_anchor_y, column_cx)
        delta_roi = {
            "x": column_cx + _DELTA_X_OFFSET_LEFT,
            "y": row_bbox["y"],
            "w": float(_DELTA_X_OFFSET_RIGHT - _DELTA_X_OFFSET_LEFT),
            "h": row_bbox["h"],
        }

        candidates: list[NumericCellEvidence] = []

        # ── rank 0: _extract_cell ────────────────────────────────────────
        _value_field, delta_field = extract_cell_fn(cell_lines, column_cx, image_bgr)

        rank0_has_value = delta_field is not None and delta_field.value is not None
        rank0_conf = (delta_field.confidence if (delta_field and delta_field.confidence is not None) else 0.0)

        if rank0_has_value:
            candidates.append(
                NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="delta",
                    value=int(delta_field.value),
                    raw_confidence=rank0_conf,
                    calibrated_confidence=rank0_conf,
                    candidate_rank=0,
                    roi_bbox=delta_roi,
                    observability="observable",
                )
            )
        else:
            # rank-0 placeholder — still emit the row
            candidates.append(
                NumericCellEvidence(
                    row_key=attribute_key,
                    column_key="delta",
                    value=None,
                    raw_confidence=0.0,
                    calibrated_confidence=0.0,
                    candidate_rank=0,
                    roi_bbox=delta_roi,
                    observability="low_quality",
                )
            )

        # ── rank 1: rescan fallback ──────────────────────────────────────
        # Fire when: rank-0 is missing OR rank-0 confidence is below threshold.
        # This surfaces the legacy "silent rescue" as an explicit ranked
        # candidate instead of quietly overwriting the rank-0 result.
        needs_rescan = (not rank0_has_value) or (rank0_conf < _CONFIDENCE_THRESHOLD)

        if needs_rescan and image_bgr is not None:
            rescan_field = rescan_fn(image_bgr, column_cx, row_y)
            if rescan_field is not None and rescan_field.value is not None:
                rescan_conf = rescan_field.confidence if rescan_field.confidence is not None else _RESCAN_CONFIDENCE
                candidates.append(
                    NumericCellEvidence(
                        row_key=attribute_key,
                        column_key="delta",
                        value=int(rescan_field.value),
                        raw_confidence=rescan_conf,
                        calibrated_confidence=rescan_conf,
                        candidate_rank=1,
                        roi_bbox=delta_roi,
                        observability="observable",
                    )
                )

                # ── rank 2: HSV-sign recovery ────────────────────────────────
                # When the rescan result lacked a sign glyph, apply HSV color
                # sampling.  Emitted as a separate rank-2 candidate — not a
                # silent sign-flip on rank 1.
                rescan_raw = (rescan_field.raw_text or "").strip()
                rescan_had_sign = rescan_raw.startswith("+") or rescan_raw.startswith("-")
                if not rescan_had_sign and rescan_field.value is not None:
                    # Build a minimal OCR-line-like object for the color sampler.
                    # Use the chip band's coordinates since we don't have the
                    # upscaled-and-translated OCRLine from the rescan internals.
                    chip_cx = float(column_cx) + (_DELTA_X_OFFSET_LEFT + _DELTA_X_OFFSET_RIGHT) / 2
                    chip_y = float(row_y)
                    # _infer_delta_sign_from_color expects an object with x1,x2,y1,y2 attrs.
                    class _FakeLine:
                        x1 = chip_cx - 6
                        x2 = chip_cx + 6
                        y1 = chip_y - 8
                        y2 = chip_y + 8
                    inferred = _infer_delta_sign_from_color(image_bgr, _FakeLine())
                    if inferred != 0:
                        signed_val = abs(int(rescan_field.value)) * inferred
                        if signed_val != int(rescan_field.value):
                            # The HSV inference disagrees with the OCR sign-less reading.
                            candidates.append(
                                NumericCellEvidence(
                                    row_key=attribute_key,
                                    column_key="delta",
                                    value=signed_val,
                                    raw_confidence=_HSV_SIGN_CONFIDENCE,
                                    calibrated_confidence=_HSV_SIGN_CONFIDENCE,
                                    candidate_rank=2,
                                    roi_bbox=delta_roi,
                                    observability="observable",
                                )
                            )

        return candidates
