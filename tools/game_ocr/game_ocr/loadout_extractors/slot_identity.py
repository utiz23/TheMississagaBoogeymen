"""Phase 2A-3: slot identity extractor — geometric subject_slot_key.

Public API
----------
extract_slot_identities(image_bgr, *, segment_index, ocr_lines) -> list[SlotIdentity]
    Extract one SlotIdentity per visible row in the loadout left strip.

SlotIdentity
    Frozen dataclass.  `slot_key` is purely geometric (never includes OCR text).
    Evidence fields (gamertag, position, jersey_number, is_captain, persona_raw)
    carry what OCR saw at the row — they are attributes, not identity.

Design notes
------------
- Row detection re-uses the position-label anchor approach from
  parsers._parse_loadout_left_strip:
    • Position label (C/LW/RW/LD/RD/G) at x_center < 130, y in (180..980).
    • Row content at x_center in (180..400), within ±45 px of anchor y.
- Y-bucketing (ROW_Y_BUCKET_TOLERANCE_PX=6) collapses near-duplicate anchors
  that can arise from RapidOCR re-detecting the same glyph at slightly
  different bounding boxes.
- is_captain detection uses the captain-glyph set from parsers.py; the
  image_bgr parameter is accepted but currently unused (colour-sampling for
  captain was not needed — glyph detection in OCR text is sufficient).
  This is Option A from the task notes: heavy HSV image dependency is avoided.
- Closed-vocab position classification (e.g. "C" → canonical "C") happens in
  Task 2A-4; this task just stores the raw position string.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Sequence

from ..ocr import OCRLine

# ---------------------------------------------------------------------------
# Constants  (mirrored from parsers.py geometry)
# ---------------------------------------------------------------------------

ROW_Y_BUCKET_TOLERANCE_PX: int = 6
"""Rows whose anchor-Y values are within this many pixels are merged into one bucket."""

MAX_ROWS_PER_LOADOUT_SEGMENT: int = 5
"""One roster (BGM or opponent) shows at most 5 visible slots."""

# Position-label spatial constraints (from parsers._parse_loadout_left_strip):
_POS_X_MAX: float = 130.0          # x_center must be below this for a position label
_POS_Y_MIN: float = 180.0          # strip starts after the UI chrome
_POS_Y_MAX: float = 980.0          # strip ends before the footer chrome

# Row-content spatial constraints:
_ROW_CONTENT_X_MIN: float = 180.0  # gamertag / number-name content starts here
_ROW_CONTENT_X_MAX: float = 400.0  # and ends here
_ROW_BAND_HALF_HEIGHT: float = 45.0  # ±45 px of anchor y_center

# Confidence threshold below which all evidence is considered "low quality".
_EVIDENCE_CONFIDENCE_THRESHOLD: float = 0.50

# Recognised position tokens.
_POS_SET = {"C", "LW", "RW", "LD", "RD", "G"}

# Captain glyphs (from parsers.py).
_CAPTAIN_GLYPHS = {"★", "✯", "✦", "✪", "✩"}

# Jersey-number pattern: matches "#N" or "#NN" or "#NNN"
_NUMBER_RE = re.compile(r"#(\d{1,3})")

# Persona/full-name pattern: "#N - Name" or "#N-Name"
_NAME_RE = re.compile(r"#\d{1,3}\s*[-–.]+\s*(.+)")


# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SlotIdentity:
    """One slot's identity + the noisy OCR evidence attributed to it.

    ``slot_key`` is purely geometric — the same row Y-bucket across every frame
    in a bundle produces the same slot_key, regardless of OCR variation in any
    text field.  The downstream promoter / closed-vocab extractor (2A-4) binds
    team_side and resolves canonical position.

    All evidence fields are Optional; absent fields stay None.

    observability values
    --------------------
    ``'observable'``
        At least one evidence field is populated above the confidence threshold.
    ``'low_quality'``
        The row was detected (anchor present + content lines found) but all
        evidence lines are below the confidence threshold.
    ``'not_observable_from_source'``
        The row was geometrically located via its position anchor but no content
        lines fell within the row band.
    """

    # Identity (purely geometric)
    slot_key: str           # "loadout_slot_seg{NNNN}_row{R}"
    row_ordinal: int        # 0..4, ascending Y (topmost = 0)
    anchor_y: int           # Y pixel of the anchor line's center in the source image

    # Evidence fields
    position: Optional[str] = None
    position_confidence: Optional[float] = None
    gamertag: Optional[str] = None
    gamertag_confidence: Optional[float] = None
    jersey_number: Optional[int] = None
    jersey_confidence: Optional[float] = None
    is_captain: Optional[bool] = None
    is_captain_confidence: Optional[float] = None
    persona_raw: Optional[str] = None
    persona_raw_confidence: Optional[float] = None

    # Per-slot quality flag
    observability: str = "observable"  # 'observable' | 'low_quality' | 'not_observable_from_source'


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_anchor_lines(ocr_lines: Sequence[OCRLine]) -> list[OCRLine]:
    """Return position-label lines that qualify as row anchors."""
    return [
        line for line in ocr_lines
        if (
            _POS_Y_MIN < line.y_center < _POS_Y_MAX
            and line.x_center < _POS_X_MAX
            and line.text.strip().upper().replace(" ", "") in _POS_SET
        )
    ]


def _bucket_anchors(anchors: list[OCRLine]) -> list[OCRLine]:
    """Merge anchors that fall within ROW_Y_BUCKET_TOLERANCE_PX of each other.

    Uses a simple greedy single-pass bucket approach: sort by y_center, then
    group consecutive anchors that are within tolerance of the first member's y.
    Returns one representative (the one with the highest confidence) per bucket,
    capped at MAX_ROWS_PER_LOADOUT_SEGMENT.
    """
    if not anchors:
        return []

    sorted_anchors = sorted(anchors, key=lambda l: l.y_center)
    buckets: list[list[OCRLine]] = []
    current_bucket: list[OCRLine] = [sorted_anchors[0]]

    for anchor in sorted_anchors[1:]:
        # Compare against the first element of the current bucket
        if anchor.y_center - current_bucket[0].y_center <= ROW_Y_BUCKET_TOLERANCE_PX:
            current_bucket.append(anchor)
        else:
            buckets.append(current_bucket)
            current_bucket = [anchor]
    buckets.append(current_bucket)

    # Pick the highest-confidence anchor per bucket as the representative
    representatives = [
        max(bucket, key=lambda l: l.confidence)
        for bucket in buckets
    ]

    # Cap at MAX_ROWS_PER_LOADOUT_SEGMENT (top-most rows win)
    return representatives[:MAX_ROWS_PER_LOADOUT_SEGMENT]


def _row_content_lines(ocr_lines: Sequence[OCRLine], anchor_y: float) -> list[OCRLine]:
    """Return lines that fall in the row band around anchor_y, within the content X range."""
    return [
        line for line in ocr_lines
        if (
            abs(line.y_center - anchor_y) < _ROW_BAND_HALF_HEIGHT
            and _ROW_CONTENT_X_MIN < line.x_center < _ROW_CONTENT_X_MAX
        )
    ]


def _parse_row_evidence(
    anchor: OCRLine,
    content_lines: list[OCRLine],
) -> dict:
    """Extract evidence fields from the anchor line and its content lines.

    Returns a dict suitable for spreading into SlotIdentity constructor kwargs.
    """
    pos_upper = anchor.text.strip().upper().replace(" ", "")
    evidence: dict = {
        "position": pos_upper if pos_upper in _POS_SET else None,
        "position_confidence": anchor.confidence if pos_upper in _POS_SET else None,
        "gamertag": None,
        "gamertag_confidence": None,
        "jersey_number": None,
        "jersey_confidence": None,
        "is_captain": None,
        "is_captain_confidence": None,
        "persona_raw": None,
        "persona_raw_confidence": None,
    }

    for line in content_lines:
        text = line.text.strip()

        # Captain glyph detection
        if evidence["is_captain"] is None and any(g in text for g in _CAPTAIN_GLYPHS):
            evidence["is_captain"] = True
            evidence["is_captain_confidence"] = line.confidence

        # Jersey number and persona-name from "#N - Name" lines
        m_num = _NUMBER_RE.search(text)
        if m_num and evidence["jersey_number"] is None:
            evidence["jersey_number"] = int(m_num.group(1))
            evidence["jersey_confidence"] = line.confidence

        m_name = _NAME_RE.search(text)
        if m_name and evidence["persona_raw"] is None:
            persona = m_name.group(1).strip(". ")
            if persona:
                evidence["persona_raw"] = persona
                evidence["persona_raw_confidence"] = line.confidence

        # Gamertag: a content line that is NOT a "#N" line and NOT a jersey-name line
        # is treated as the gamertag. Pick the first one found.
        if evidence["gamertag"] is None and not m_num:
            evidence["gamertag"] = text
            evidence["gamertag_confidence"] = line.confidence

    return evidence


def _determine_observability(evidence: dict, has_content_lines: bool) -> str:
    """Classify observability based on evidence quality."""
    if not has_content_lines:
        return "not_observable_from_source"

    # Check whether at least one evidence field (excluding position, which comes
    # from the anchor and is always present for detected rows) has confidence
    # above threshold.
    confidence_values = [
        v for k, v in evidence.items()
        if k.endswith("_confidence") and k != "position_confidence" and v is not None
    ]
    if not confidence_values:
        # Only position was found (anchor only effectively) — but we have content lines
        # so check position confidence
        pos_conf = evidence.get("position_confidence")
        if pos_conf is not None and pos_conf >= _EVIDENCE_CONFIDENCE_THRESHOLD:
            return "observable"
        return "not_observable_from_source"

    if all(c < _EVIDENCE_CONFIDENCE_THRESHOLD for c in confidence_values):
        return "low_quality"
    return "observable"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def extract_slot_identities(
    image_bgr,  # numpy.ndarray (H, W, 3) BGR — accepted but not used in Phase 2A-3
    *,
    segment_index: int,
    ocr_lines: Sequence[OCRLine],
) -> list[SlotIdentity]:
    """Extract slot identities from a single loadout-view frame.

    Parameters
    ----------
    image_bgr:
        Full-frame BGR image (numpy array, H×W×3).  Not used in Phase 2A-3
        (captain glyph detection reads OCR text; HSV sampling is deferred to
        Phase 2B).  Accepted for API stability.
    segment_index:
        Integer index of the video segment this frame belongs to.  Used to
        construct the slot_key; zero-padded to 4 digits.
    ocr_lines:
        Sequence of OCRLine objects from a single RapidOCR pass over the full
        frame.

    Returns
    -------
    list[SlotIdentity]
        One SlotIdentity per detected row, sorted by row_ordinal (ascending Y).
        At most MAX_ROWS_PER_LOADOUT_SEGMENT (5) records.
    """
    # Step 1: Find position-label anchors in the left strip.
    raw_anchors = _extract_anchor_lines(ocr_lines)
    if not raw_anchors:
        return []

    # Step 2: Y-bucket the anchors (merge duplicates, cap at 5).
    bucketed_anchors = _bucket_anchors(raw_anchors)

    # Step 3: Sort by y_center ascending → assign row_ordinal 0..4.
    sorted_anchors = sorted(bucketed_anchors, key=lambda l: l.y_center)

    # Step 4 & 5: Build one SlotIdentity per row.
    result: list[SlotIdentity] = []
    for row_ordinal, anchor in enumerate(sorted_anchors):
        slot_key = f"loadout_slot_seg{segment_index:04d}_row{row_ordinal}"
        anchor_y_int = int(round(anchor.y_center))

        content_lines = _row_content_lines(ocr_lines, anchor.y_center)
        evidence = _parse_row_evidence(anchor, content_lines)
        observability = _determine_observability(evidence, bool(content_lines))

        result.append(
            SlotIdentity(
                slot_key=slot_key,
                row_ordinal=row_ordinal,
                anchor_y=anchor_y_int,
                position=evidence["position"],
                position_confidence=evidence["position_confidence"],
                gamertag=evidence["gamertag"],
                gamertag_confidence=evidence["gamertag_confidence"],
                jersey_number=evidence["jersey_number"],
                jersey_confidence=evidence["jersey_confidence"],
                is_captain=evidence["is_captain"],
                is_captain_confidence=evidence["is_captain_confidence"],
                persona_raw=evidence["persona_raw"],
                persona_raw_confidence=evidence["persona_raw_confidence"],
                observability=observability,
            )
        )

    return result
