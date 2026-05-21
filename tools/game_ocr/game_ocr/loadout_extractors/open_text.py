"""Phase 2A-7: open-text extractor — gamertag, persona, player level.

Public API
----------
OpenTextEvidence    — frozen dataclass, one candidate for an open-text field
LoadoutOpenTextExtractor — wraps existing RapidOCR output, emits n-best candidates

Design notes
------------
- Does NOT re-run OCR.  Operates on ``ocr_lines`` already extracted upstream.
- Returns n-best candidates sorted by RapidOCR confidence (descending).
- Normalises Unicode minus/dash glyphs (U+2212, U+2013, U+2014, U+2010, U+2011,
  U+2043) to ASCII '-' before emitting — downstream closed-vocab regex and match
  logic expects ASCII.
- Phase 2A stays on RapidOCR directly.  PARSeq adoption is Phase 3+ (Round 4 §5).
- ROI bbox uses {x, y, w, h} convention where (x, y) is the top-left corner.
  Overlap check converts to (x1, y1, x2, y2) axes-aligned rectangles.
- OCRLine.bbox is encoded as four separate float fields: x1, y1, x2, y2 (see
  tools/game_ocr/game_ocr/ocr.py).  x_center / y_center are computed properties.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from ..ocr import OCRLine

# ---------------------------------------------------------------------------
# Unicode minus/dash normalisation
# ---------------------------------------------------------------------------

# Glyphs that should map to ASCII hyphen-minus ('-', U+002D).
_MINUS_GLYPH_TABLE = str.maketrans(
    {
        "−": "-",  # MINUS SIGN
        "–": "-",  # EN DASH
        "—": "-",  # EM DASH
        "‐": "-",  # HYPHEN
        "‑": "-",  # NON-BREAKING HYPHEN
        "⁃": "-",  # HYPHEN BULLET
    }
)


def _normalize_unicode_minus(text: str) -> str:
    """Replace Unicode minus/dash glyphs with ASCII hyphen-minus."""
    return text.translate(_MINUS_GLYPH_TABLE)


# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OpenTextEvidence:
    """One candidate for an open-text field (gamertag, persona, level, ...).

    ``candidate_rank`` is 0 for the highest-confidence candidate, 1 for the
    second-highest, etc.  When no line satisfies the ROI + confidence filter
    the extractor emits a single record with ``value=''`` and
    ``observability='low_quality'``.
    """

    field_key: str              # e.g. "gamertag", "persona_raw", "player_level_raw"
    value: str                  # normalized (Unicode minus → ASCII '-') OCR text
    raw_confidence: float
    calibrated_confidence: float  # == raw_confidence in Phase 2A
    candidate_rank: int           # 0 = top confidence, 1+ = alternates
    roi_bbox: Optional[dict[str, float]] = None  # {x, y, w, h} pixel coords
    observability: str = "observable"  # 'observable' | 'low_quality' | 'not_observable_from_source'


# ---------------------------------------------------------------------------
# Overlap helper
# ---------------------------------------------------------------------------


def _bbox_overlaps(line: OCRLine, roi_bbox: dict[str, float]) -> bool:
    """Return True when the line's axis-aligned bbox overlaps the ROI.

    ``roi_bbox`` uses {x, y, w, h} convention (x/y = top-left corner).
    ``OCRLine`` stores absolute pixel coordinates as x1, y1, x2, y2.
    Two rectangles overlap when neither is fully to the left, right, above,
    or below the other.
    """
    # ROI corners
    rx1 = roi_bbox["x"]
    ry1 = roi_bbox["y"]
    rx2 = rx1 + roi_bbox["w"]
    ry2 = ry1 + roi_bbox["h"]

    # Line bbox corners
    lx1 = line.x1
    ly1 = line.y1
    lx2 = line.x2
    ly2 = line.y2

    # No overlap when one rect is fully outside the other on any axis.
    if lx2 <= rx1 or lx1 >= rx2:
        return False
    if ly2 <= ry1 or ly1 >= ry2:
        return False
    return True


# ---------------------------------------------------------------------------
# Extractor
# ---------------------------------------------------------------------------


class LoadoutOpenTextExtractor:
    """Open-text extractor for gamertag, persona, and player-level fields.

    Wraps existing RapidOCR output (the ``ocr_lines`` passed in by the bundle
    assembler).  Does NOT re-run OCR — operates on lines already extracted
    upstream.  Returns n-best candidates ranked by RapidOCR confidence.
    ASCII-normalizes Unicode minus glyphs before emitting.
    """

    EXTRACTOR_VERSION = "open-text-v1"

    def extract_open_text_for_roi(
        self,
        ocr_lines: Sequence[OCRLine],
        *,
        roi_bbox: dict[str, float],   # {x, y, w, h} in pixel coordinates
        field_key: str,
        max_candidates: int = 3,
        min_confidence: float = 0.3,
    ) -> list[OpenTextEvidence]:
        """Filter ocr_lines to the ROI, sort by confidence, emit top-N as candidates.

        Returns a list of ``OpenTextEvidence`` records:
        - If matching lines exist (overlap ROI, above ``min_confidence``):
          up to ``max_candidates`` records, ranked 0..N-1 by descending confidence.
        - If no lines qualify: a single record with ``value=''`` and
          ``observability='low_quality'``.

        Parameters
        ----------
        ocr_lines:
            All OCR lines extracted from the frame (or a pre-filtered subset).
        roi_bbox:
            Dict with keys ``x``, ``y``, ``w``, ``h`` (top-left + size in pixels).
        field_key:
            Logical name of the field being extracted (e.g. ``"gamertag"``).
        max_candidates:
            Maximum number of candidates to return.
        min_confidence:
            Lines with ``confidence < min_confidence`` are excluded.
        """
        # 1. Filter lines that overlap the ROI and meet the confidence threshold.
        candidates: list[OCRLine] = [
            line
            for line in ocr_lines
            if _bbox_overlaps(line, roi_bbox) and line.confidence >= min_confidence
        ]

        # 2. Sort descending by confidence.
        candidates.sort(key=lambda l: l.confidence, reverse=True)

        # 3. Emit top-N as OpenTextEvidence, applying Unicode normalization.
        results: list[OpenTextEvidence] = []
        for rank, line in enumerate(candidates[:max_candidates]):
            normalized = _normalize_unicode_minus(line.text)
            results.append(
                OpenTextEvidence(
                    field_key=field_key,
                    value=normalized,
                    raw_confidence=line.confidence,
                    calibrated_confidence=line.confidence,
                    candidate_rank=rank,
                    roi_bbox=roi_bbox,
                    observability="observable",
                )
            )

        # 4. If no candidates qualified, emit a single low_quality marker.
        if not results:
            results.append(
                OpenTextEvidence(
                    field_key=field_key,
                    value="",
                    raw_confidence=0.0,
                    calibrated_confidence=0.0,
                    candidate_rank=0,
                    roi_bbox=roi_bbox,
                    observability="low_quality",
                )
            )

        return results
