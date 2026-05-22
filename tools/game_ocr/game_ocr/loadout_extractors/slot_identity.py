"""Phase 2A (revised): single-subject-per-frame loadout identity extractor.

Public API
----------
extract_subject_identity(image_bgr, *, ocr_lines) -> SubjectIdentity | None
    Identify the SUBJECT of a single loadout-view frame.

SubjectIdentity
    Frozen dataclass.  One subject per frame — the player whose right-pane
    data (build class, X-Factors, attributes) is currently displayed.

Design notes
------------
The EA NHL loadout-view UI shows:
  - LEFT STRIP: all visible roster rows (HOME + AWAY), with position labels
    (C/LW/RW/LD/RD/G) at x_center < 130.
  - RIGHT PANE: data for the ONE currently-selected subject.
  - TOP-RIGHT CORNER: the subject's gamertag.
  - TITLE BAR: "<Player name> - <Build class>" (e.g., "TAGE THOMPSON - PWF").

So per-frame: exactly ONE subject's right-pane data is visible. The other
left-strip rows are context only.

Strategy (mirrors legacy parsers.py:_parse_loadout_left_strip):
  1. Find the subject's gamertag — top-right corner (y<200, x>1400).
  2. Find position-label anchors in the left strip (x<130, y in [180,980]).
  3. For each anchor, check if the row's content (x in [180,400], y±45)
     fuzzy-matches the subject's gamertag.
  4. Once matched, harvest position, jersey_number, player_name_full,
     is_captain from that row.
  5. Title-bar build class (raw): from text at y[100,175], x[300,1200].

slot_key is NOT assigned here — that happens at bundle-aggregation time.

Backward-compat exports
-----------------------
The old SlotIdentity / extract_slot_identities names are still exported as
deprecated thin wrappers so existing callers (tests, pass2_extract.py) do
not break immediately.  They will be removed in Phase 2B.
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

MAX_ROWS_PER_LOADOUT_SEGMENT: int = 12
"""Up to 12 distinct subjects may appear across a segment (6 BGM + 6 opp, both goalies human)."""

# NOTE: HOME/AWAY header authority
# The visual HOME/AWAY section headers in the loadout pregame menu are NOT a
# reliable source of team_side. BGM wears their AWAY uniform in-game; the
# post-game screens list them as AWAY despite the loadout menu showing them as
# HOME. team_side is determined exclusively by the worker promoter via
# resolveGamertagToPlayer with opponent_player_match_stats fallback.
# This module does NOT read HOME/AWAY headers for any purpose.

# Position-label spatial constraints
_POS_X_MAX: float = 130.0
_POS_Y_MIN: float = 180.0
_POS_Y_MAX: float = 980.0

# Row-content spatial constraints
_ROW_CONTENT_X_MIN: float = 130.0  # extended left to capture level at x≈179
_ROW_CONTENT_X_MAX: float = 400.0
_ROW_BAND_HALF_HEIGHT: float = 45.0

# Subject gamertag location: top-right corner
_GAMERTAG_Y_MAX: float = 200.0
_GAMERTAG_X_MIN: float = 1400.0

# Title-bar location: y in [100, 175], x in [300, 1200]
_TITLE_Y_MIN: float = 100.0
_TITLE_Y_MAX: float = 175.0
_TITLE_X_MIN: float = 300.0
_TITLE_X_MAX: float = 1200.0

# Confidence threshold below which evidence is considered low quality
_EVIDENCE_CONFIDENCE_THRESHOLD: float = 0.50

# Recognised position tokens
_POS_SET = {"C", "LW", "RW", "LD", "RD", "G"}

# Captain glyphs (from parsers.py)
_CAPTAIN_GLYPHS = {"★", "✯", "✦", "✪", "✩"}

# Jersey-number pattern: matches "#N", "#NN", "#NNN"
_NUMBER_RE = re.compile(r"#(\d{1,3})")

# Persona/full-name pattern: "#N - Name" or "#N-Name"
_NAME_RE = re.compile(r"#\d{1,3}\s*[-–.]+\s*(.+)")

# Player-level pattern: "P<gen>LVL<num>" e.g. "P1LVL17", "P2LVL34"
# Appears in the left strip at x≈179, alongside each player's row.
_LEVEL_RE = re.compile(r"P\d+LVL(\d+)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# SubjectIdentity dataclass (new, replaces SlotIdentity)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SubjectIdentity:
    """Identity of the SUBJECT of a single loadout-view frame.

    The subject is the player whose right-pane data (build class, X-Factors,
    attribute grid) is currently displayed. Identified by matching the
    top-right gamertag against the visible left-strip rows.

    ``slot_key`` is NOT set here — it is assigned at bundle-aggregation time.

    observability values
    --------------------
    ``'observable'``
        Subject identified with at least one evidence field above the
        confidence threshold.
    ``'low_quality'``
        Subject identified but all evidence fields are below threshold.
    ``'not_observable_from_source'``
        No subject could be identified (gamertag absent or no row match).
    """

    # Primary identity (from top-right OCR)
    gamertag: str
    gamertag_confidence: float

    # Evidence from the matched left-strip row
    position: Optional[str] = None          # 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G'
    position_confidence: Optional[float] = None
    jersey_number: Optional[int] = None
    jersey_confidence: Optional[float] = None
    player_name_full: Optional[str] = None  # from "#N - Name" pattern
    player_name_confidence: Optional[float] = None
    is_captain: Optional[bool] = None
    is_captain_confidence: Optional[float] = None

    # Build class from the title bar
    build_class_raw: Optional[str] = None   # e.g. "PWF" or "Power Forward"
    build_class_confidence: Optional[float] = None

    # Player level from the left-strip row (pattern: P<gen>LVL<num>, e.g. "P1LVL17")
    player_level_raw: Optional[str] = None   # raw string, e.g. "P1LVL17"
    player_level_confidence: Optional[float] = None

    # Anchor Y of the matched left-strip row (for row-scoped downstream extractors)
    anchor_y: Optional[int] = None

    # Quality flag
    observability: str = "observable"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _normalize_tag(text: str) -> str:
    """Lowercase, strip non-alphanumeric characters."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _levenshtein(a: str, b: str) -> int:
    """Simple O(m*n) Levenshtein distance."""
    if a == b:
        return 0
    m, n = len(a), len(b)
    if m < n:
        a, b, m, n = b, a, n, m
    row = list(range(n + 1))
    for i, ca in enumerate(a, 1):
        prev = row[0]
        row[0] = i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[n]


def _fuzzy_gamertag_match(query_norm: str, text_norm: str) -> bool:
    """Return True if query_norm is a substring of text_norm, or
    Levenshtein(query_norm[:6], text_norm[:6]) <= 2 when the prefix is >=3 chars."""
    if not query_norm:
        return False
    head = query_norm[: min(6, len(query_norm))]
    # Substring match (fast path — legacy parsers.py strategy)
    if head and head in text_norm:
        return True
    # Full fuzzy match when prefix is long enough to avoid false positives
    if len(head) >= 3 and _levenshtein(head, text_norm[: len(head)]) <= 2:
        return True
    return False


def _extract_subject_gamertag(ocr_lines: Sequence[OCRLine]) -> tuple[str | None, float | None]:
    """Find the subject gamertag in the top-right corner (y<200, x>1400).

    Returns (gamertag_text, confidence) or (None, None) if not found.

    Filters out pure-numeric candidates (HUD currency/notification numerals at the
    very top of the screen — e.g. "554", "299,783", "100" — appear in the same
    bbox region but are not gamertags). The actual gamertag has alphabetic chars.
    """
    candidates = [
        l for l in ocr_lines
        if l.y_center < _GAMERTAG_Y_MAX and l.x_center > _GAMERTAG_X_MIN
        and l.text.strip()
        and any(c.isalpha() for c in l.text)
    ]
    if not candidates:
        return None, None
    # Pick the highest-confidence candidate; gamertag is the top-right line
    best = max(candidates, key=lambda l: l.confidence)
    return best.text.strip(), best.confidence


def _extract_title_bar_build_class(ocr_lines: Sequence[OCRLine]) -> tuple[str | None, float | None]:
    """Extract the raw build class from the title bar.

    Title bar format: "<PLAYER NAME> - <BUILD CLASS>" (e.g., "TAGE THOMPSON - PWF").
    We return the whole title-bar OCR text as build_class_raw for the closed-vocab
    extractor to parse; or just the portion after the last "-" if the pattern matches.
    """
    title_lines = [
        l for l in ocr_lines
        if _TITLE_Y_MIN <= l.y_center <= _TITLE_Y_MAX
        and _TITLE_X_MIN <= l.x_center <= _TITLE_X_MAX
        and l.text.strip()
    ]
    if not title_lines:
        return None, None
    title_lines.sort(key=lambda l: l.x_center)
    joined = " ".join(l.text for l in title_lines)
    # Confidence: average of all title-bar lines
    conf = sum(l.confidence for l in title_lines) / len(title_lines)
    return joined.strip(), conf


def _extract_anchor_lines(ocr_lines: Sequence[OCRLine]) -> list[OCRLine]:
    """Return position-label lines that qualify as left-strip row anchors."""
    return [
        line for line in ocr_lines
        if (
            _POS_Y_MIN < line.y_center < _POS_Y_MAX
            and line.x_center < _POS_X_MAX
            and line.text.strip().upper().replace(" ", "") in _POS_SET
        )
    ]


def _bucket_anchors(anchors: list[OCRLine]) -> list[OCRLine]:
    """Merge anchors within ROW_Y_BUCKET_TOLERANCE_PX; one representative per bucket."""
    if not anchors:
        return []
    sorted_anchors = sorted(anchors, key=lambda l: l.y_center)
    buckets: list[list[OCRLine]] = []
    current_bucket: list[OCRLine] = [sorted_anchors[0]]
    for anchor in sorted_anchors[1:]:
        if anchor.y_center - current_bucket[0].y_center <= ROW_Y_BUCKET_TOLERANCE_PX:
            current_bucket.append(anchor)
        else:
            buckets.append(current_bucket)
            current_bucket = [anchor]
    buckets.append(current_bucket)
    return [max(b, key=lambda l: l.confidence) for b in buckets]


def _row_content_lines(ocr_lines: Sequence[OCRLine], anchor_y: float) -> list[OCRLine]:
    """Return lines in the row band around anchor_y within the content X range."""
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
    """Extract position, jersey, player_name, is_captain, player_level from one matched row."""
    pos_upper = anchor.text.strip().upper().replace(" ", "")
    evidence: dict = {
        "position": pos_upper if pos_upper in _POS_SET else None,
        "position_confidence": anchor.confidence if pos_upper in _POS_SET else None,
        "jersey_number": None,
        "jersey_confidence": None,
        "player_name_full": None,
        "player_name_confidence": None,
        "is_captain": None,
        "is_captain_confidence": None,
        "player_level_raw": None,
        "player_level_confidence": None,
    }

    for line in content_lines:
        text = line.text.strip()

        # Captain glyph detection
        if evidence["is_captain"] is None and any(g in text for g in _CAPTAIN_GLYPHS):
            evidence["is_captain"] = True
            evidence["is_captain_confidence"] = line.confidence

        # Player level pattern: "P<gen>LVL<num>" (e.g. "P1LVL17")
        m_lvl = _LEVEL_RE.search(text)
        if m_lvl and evidence["player_level_raw"] is None:
            evidence["player_level_raw"] = text.strip()
            evidence["player_level_confidence"] = line.confidence

        # Jersey number from "#N" pattern — skip level lines to avoid false positives
        if not m_lvl:
            m_num = _NUMBER_RE.search(text)
            if m_num and evidence["jersey_number"] is None:
                evidence["jersey_number"] = int(m_num.group(1))
                evidence["jersey_confidence"] = line.confidence

        # Full name from "#N - Name" pattern
        m_name = _NAME_RE.search(text)
        if m_name and evidence["player_name_full"] is None:
            full_name = m_name.group(1).strip(". ")
            if full_name:
                evidence["player_name_full"] = full_name
                evidence["player_name_confidence"] = line.confidence

    return evidence


# ---------------------------------------------------------------------------
# Public API — new contract
# ---------------------------------------------------------------------------


def extract_subject_identity(
    image_bgr,  # numpy.ndarray (H, W, 3) BGR — accepted but not used in Phase 2A
    *,
    ocr_lines: Sequence[OCRLine],
) -> "SubjectIdentity | None":
    """Identify the subject of a single loadout-view frame.

    Returns a SubjectIdentity if the subject can be identified, or None if:
      - No gamertag found in the top-right corner.
      - No left-strip row matches the gamertag (subject can still be partially
        identified with just gamertag + build_class if anchor matching fails).

    Strategy:
      1. Find gamertag in top-right corner (y<200, x>1400).
      2. Extract title-bar build class raw text.
      3. Find left-strip position-label anchors.
      4. Fuzzy-match the subject's gamertag against each anchor's row content.
      5. Harvest position/jersey/player_name/is_captain from the matched row.
    """
    # Step 1: Find subject gamertag from top-right corner
    gamertag_text, gamertag_conf = _extract_subject_gamertag(ocr_lines)
    if not gamertag_text:
        return None

    # Step 2: Extract title-bar build class
    build_class_raw, build_class_conf = _extract_title_bar_build_class(ocr_lines)

    # Step 3: Find and bucket position-label anchors
    raw_anchors = _extract_anchor_lines(ocr_lines)
    anchors = _bucket_anchors(raw_anchors)

    # Step 4: Match the subject's gamertag against each anchor's row
    gt_normalized = _normalize_tag(gamertag_text)
    subject_anchor: OCRLine | None = None
    subject_content_lines: list[OCRLine] = []

    for anchor in anchors:
        content_lines = _row_content_lines(ocr_lines, anchor.y_center)
        joined_norm = _normalize_tag(" ".join(l.text for l in content_lines))
        if _fuzzy_gamertag_match(gt_normalized, joined_norm):
            subject_anchor = anchor
            subject_content_lines = content_lines
            break

    # Step 5: Harvest evidence from the matched row (or emit partial identity)
    if subject_anchor is not None:
        evidence = _parse_row_evidence(subject_anchor, subject_content_lines)
        anchor_y_int = int(round(subject_anchor.y_center))

        # Determine observability
        has_useful_evidence = any([
            evidence["position"] is not None and (evidence["position_confidence"] or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
            evidence["jersey_number"] is not None and (evidence["jersey_confidence"] or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
            (gamertag_conf or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
        ])
        observability = "observable" if has_useful_evidence else "low_quality"

        return SubjectIdentity(
            gamertag=gamertag_text,
            gamertag_confidence=gamertag_conf or 0.0,
            position=evidence["position"],
            position_confidence=evidence["position_confidence"],
            jersey_number=evidence["jersey_number"],
            jersey_confidence=evidence["jersey_confidence"],
            player_name_full=evidence["player_name_full"],
            player_name_confidence=evidence["player_name_confidence"],
            is_captain=evidence["is_captain"],
            is_captain_confidence=evidence["is_captain_confidence"],
            build_class_raw=build_class_raw,
            build_class_confidence=build_class_conf,
            player_level_raw=evidence["player_level_raw"],
            player_level_confidence=evidence["player_level_confidence"],
            anchor_y=anchor_y_int,
            observability=observability,
        )
    else:
        # Could not match the gamertag to a left-strip row, but we still have
        # the gamertag (and maybe build class) — emit a partial identity.
        # observability='not_observable_from_source' signals that left-strip
        # context was not available (likely a transitional frame).
        observability = (
            "observable"
            if (gamertag_conf or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD
            else "not_observable_from_source"
        )
        return SubjectIdentity(
            gamertag=gamertag_text,
            gamertag_confidence=gamertag_conf or 0.0,
            build_class_raw=build_class_raw,
            build_class_confidence=build_class_conf,
            observability=observability,
        )


# ---------------------------------------------------------------------------
# Backward-compat shim — SlotIdentity (deprecated)
# ---------------------------------------------------------------------------
# The old SlotIdentity / extract_slot_identities names are kept to avoid
# breaking existing tests and callers during the transition.  They are
# scheduled for removal in Phase 2B.


@dataclass(frozen=True)
class SlotIdentity:
    """DEPRECATED: use SubjectIdentity instead.

    Kept for backward compatibility with existing tests and callers.
    Will be removed in Phase 2B.
    """

    # Identity (purely geometric — kept for compat)
    slot_key: str
    row_ordinal: int
    anchor_y: int

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

    observability: str = "observable"


def extract_slot_identities(
    image_bgr,
    *,
    segment_index: int,
    ocr_lines: Sequence[OCRLine],
) -> list[SlotIdentity]:
    """DEPRECATED: Extract slot identities from a single loadout-view frame.

    This implements the OLD "one SlotIdentity per visible row" contract.
    It is preserved for backward compat with existing tests and callers
    during the Phase 2A → 2B transition.  Use extract_subject_identity()
    for new code.

    Note: extract_slot_identities caps at MAX_ROWS_PER_LOADOUT_SEGMENT=5 for
    the old interface (one roster), even though the new constant is 10.
    """
    _OLD_MAX = 5

    raw_anchors = _extract_anchor_lines(ocr_lines)
    if not raw_anchors:
        return []

    anchors = _bucket_anchors(raw_anchors)
    sorted_anchors = sorted(anchors, key=lambda l: l.y_center)[:_OLD_MAX]

    result: list[SlotIdentity] = []
    for row_ordinal, anchor in enumerate(sorted_anchors):
        slot_key = f"loadout_slot_seg{segment_index:04d}_row{row_ordinal}"
        anchor_y_int = int(round(anchor.y_center))

        content_lines = _row_content_lines(ocr_lines, anchor.y_center)
        evidence = _parse_row_evidence(anchor, content_lines)

        # Observability for legacy contract
        if not content_lines:
            observability = "not_observable_from_source"
        else:
            confidence_values = [
                v for k, v in evidence.items()
                if k.endswith("_confidence") and k != "position_confidence" and v is not None
            ]
            if not confidence_values:
                pos_conf = evidence.get("position_confidence")
                if pos_conf is not None and pos_conf >= _EVIDENCE_CONFIDENCE_THRESHOLD:
                    observability = "observable"
                else:
                    observability = "not_observable_from_source"
            elif all(c < _EVIDENCE_CONFIDENCE_THRESHOLD for c in confidence_values):
                observability = "low_quality"
            else:
                observability = "observable"

        # Derive gamertag from content (first non-number line)
        gamertag = None
        gamertag_conf = None
        for line in content_lines:
            text = line.text.strip()
            if not _NUMBER_RE.search(text):
                gamertag = text
                gamertag_conf = line.confidence
                break

        result.append(
            SlotIdentity(
                slot_key=slot_key,
                row_ordinal=row_ordinal,
                anchor_y=anchor_y_int,
                position=evidence["position"],
                position_confidence=evidence["position_confidence"],
                gamertag=gamertag,
                gamertag_confidence=gamertag_conf,
                jersey_number=evidence["jersey_number"],
                jersey_confidence=evidence["jersey_confidence"],
                is_captain=evidence["is_captain"],
                is_captain_confidence=evidence["is_captain_confidence"],
                persona_raw=evidence["player_name_full"],
                persona_raw_confidence=evidence["player_name_confidence"],
                observability=observability,
            )
        )

    return result
