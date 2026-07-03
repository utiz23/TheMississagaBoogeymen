"""Phase 2A (revised): single-subject-per-frame loadout identity extractor.

Public API
----------
extract_subject_identity(image_bgr, *, ocr_lines) -> SubjectIdentity | None
    Identify the SUBJECT of a single loadout-view frame.

extract_roster_only_identities(image_bgr, *, ocr_lines, subject_gamertag, grids)
    -> list[SubjectIdentity]
    Extract identity-only entries for left-strip rows that are NOT the subject.

PositionGrid
    Dataclass representing a cluster of position-label anchors with inferred
    Y positions for missing labels.

build_position_grids(detected_anchors, *, canonical_order) -> list[PositionGrid]
    Cluster detected position-label anchors into grids and infer missing
    positions by canonical lineup order + median spacing.

position_for_row_y(row_y, grids) -> tuple[str, float] | None
    Look up the position label and confidence for a given row Y.

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
  3. Build PositionGrids from the detected anchors to infer missing positions.
  4. For each anchor (detected or inferred), check if the row's content
     (x in [180,400], y±45) fuzzy-matches the subject's gamertag.
  5. Once matched, harvest position, jersey_number, player_name_full,
     is_captain from that row.
  6. Title-bar build class (raw): from text at y[100,175], x[300,1200].

Position inference (Gap 1 fix):
  When ≥2 position labels ARE detected in a row cluster, infer missing
  positions using canonical lineup order (6v6: C/LW/RW/LD/RD/G) and
  median row spacing. Inferred positions get confidence 0.7.

Roster-only extraction (Gap 2 fix):
  For left-strip rows whose gamertag does NOT match the subject, emit
  identity-only SubjectIdentity instances (build_class_raw=None). These
  are used to capture players the operator never selected.

slot_key is NOT assigned here — that happens at bundle-aggregation time.

Backward-compat exports
-----------------------
The old SlotIdentity / extract_slot_identities names are still exported as
deprecated thin wrappers so existing callers (tests, pass2_extract.py) do
not break immediately.  They will be removed in Phase 2B.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from typing import Optional, Sequence

from ..captain_star_matcher import score_captain_star
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
_ROW_BAND_HALF_HEIGHT: float = 30.0

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

# Canonical lineup orders for position inference
_CANONICAL_LINEUP_6S: tuple[str, ...] = ("C", "LW", "RW", "LD", "RD", "G")
_CANONICAL_LINEUP_3S: tuple[str, ...] = ("C", "W", "D", "G")

# Position inference constants
_INFERRED_POSITION_CONFIDENCE: float = 0.7
_DETECTED_POSITION_CONFIDENCE_FALLBACK: float = 1.0
_GRID_CLUSTER_GAP_MULTIPLIER: float = 2.0  # gap > 2× median spacing → new cluster
_GRID_MAX_SPACING_VARIANCE_RATIO: float = 0.30  # reject if stddev/median > 30%
_GRID_MIN_DETECTED_LABELS: int = 2  # minimum detected labels to attempt inference

# Captain glyphs (from parsers.py)
_CAPTAIN_GLYPHS = {"★", "✯", "✦", "✪", "✩"}

# Phase D captain ★ visual detection. When a frame image is available the gold
# room-leader star is scored directly (captain_star_matcher) and OVERRIDES the
# OCR-text-glyph heuristic below, which was proven non-discriminating. The glyph
# scan survives as the frameless fallback (image_bgr=None → legacy behavior).
#
# CALIBRATED (Phase G / G1.2): measured against the committed match-2577 loadout
# bench frames. Unlike the lobby's two separate team panels, BOTH rosters render
# in the SAME left strip with an identical horizontal layout, so a single star
# column serves both sides (no per-side inset, cf. lobby_extractors.slot_identity).
# The gold ★ sits on the gamertag line just left of the gamertag at x≈240 (inset
# +110 from the row content's left edge). The old inset=12 (cx≈142) landed on the
# player-avatar portrait — which ends at x≈200 and is often gold/warm-toned — and
# produced captain false positives; cx≈240 is clear of every avatar. The scored
# row anchor lands either on the gamertag line (delta 0) or the persona/content
# line ~30px below it, so the ROI is nudged up ~half a row and sized to span both.
# Verified on 2577: real for_LW + against_RW both score 0.756, all 8 non-captain
# rows score 0.000 (tp=2 / fp=0 / fn=0).
_CAPTAIN_STAR_X_INSET: float = 110.0  # px right of row content's left edge → cx≈240
_CAPTAIN_STAR_CY_OFFSET: float = -15.0  # star is on the gamertag line, above the content anchor
_CAPTAIN_STAR_RADIUS: int = 18
# Minimum star score to call a row a captain. The authoritative cross-frame
# resolution is the argmax-by-star-score in loadout_bundle._merge_identities;
# this sets each per-frame boolean.
CAPTAIN_STAR_THRESHOLD: float = 0.5


def _score_row_captain_star(image_bgr, anchor_y: Optional[float]) -> Optional[float]:
    """Star score for a left-strip row, or None when no frame/anchor is given.

    None signals "not scored visually" so the caller keeps the legacy text
    result and the cross-frame merge can distinguish frameless observations.
    """
    if image_bgr is None or anchor_y is None:
        return None
    cx = int(_ROW_CONTENT_X_MIN + _CAPTAIN_STAR_X_INSET)
    cy = int(anchor_y + _CAPTAIN_STAR_CY_OFFSET)
    return score_captain_star(image_bgr, cx, cy, _CAPTAIN_STAR_RADIUS)

# Jersey-number pattern: matches "#N", "#NN", "#NNN"
_NUMBER_RE = re.compile(r"#(\d{1,3})")

# Persona/full-name pattern.  Two layout variants in EA NHL loadout views:
#   BGM section:  "#11 - Evgeni Wanhg"  (number first, then name)
#   Opp section:  "-Toews-#19"          (dash, name, dash, number)
_NAME_RE = re.compile(r"#\d{1,3}\s*[-–.]+\s*(.+)")
_NAME_RE_OPP = re.compile(r"^[-–.]\s*(.+?)\s*[-–.]\s*#\d{1,3}\s*$")

# Player-level pattern: "P<gen>LVL<num>" e.g. "P1LVL17", "P2LVL34"
# Appears in the left strip at x≈179, alongside each player's row.
_LEVEL_RE = re.compile(r"P\d+LVL(\d+)", re.IGNORECASE)

# Persona-summary indicator: "#NN-Name" or "-Name-#NN" — appears on the row
# BELOW the gamertag for each slot.  Must NOT be promoted as a gamertag.
_PERSONA_SUMMARY_RE = re.compile(r"#\d{1,3}\s*[-–]|-#\d{1,3}\b|^-[A-Za-z]")

# HUD labels and headers that appear in the left strip but are NOT slots.
# Normalized to uppercase-no-punct before comparison.
_HUD_LABELS_NORMALIZED: set[str] = {
    "HOME", "AWAY", "CHEL", "XFACTORS", "ATTRIBUTES", "VIEWPROFILE",
    "VIEWINGLOADOUTS", "ACTIVEABILITYPOINTSAP", "ACTIVEABILITYPOINTS",
    "XFACTORGLOSSARY", "BACK", "POWER", "TECHNIQUE", "ENDURANCE",
    "SPORTS", "BPORTS", "EASPORTS",
    # CPU placeholder occupies an empty roster slot (no human goalie etc.).
    # Treated as a non-slot for OCR purposes; CPU goalies are handled by
    # the promoter via a dedicated invariant if/when needed.
    "CPU",
    # Pre-game lobby HUD strings that occasionally leak into the loadout
    # view OCR window during transitional frames.
    "HOCKEY", "EAHOCKEY", "READY", "NOTREADY", "READYUP",
    "CONTINUE", "PROCEED", "ACCEPT", "DECLINE", "OPTIONS",
}

# Standalone level-fragment pattern: "LVL34" without the "P<gen>" prefix that
# `_LEVEL_RE` requires.  This appears when the player-level row is OCR'd as
# two separate tokens.
_BARE_LEVEL_RE = re.compile(r"^LVL\d+$", re.IGNORECASE)

# Team-name headers (e.g. "THE BOOGEYMEN") appear at the very top of the left
# strip.  They are all-caps with no digits, distinct from gamertags which
# usually contain mixed case or digits.  Heuristic: an all-caps multi-word
# string with length >5 (avoids gamertags like "CPU" / "AWAY" already in HUD
# list) and no digits is treated as a team-name header.
def _looks_like_team_name_header(text: str) -> bool:
    if any(c.isdigit() for c in text):
        return False
    if " " not in text:
        return False
    return text == text.upper() and len(text) > 5

# Height/weight indicator pattern.  OCR variants include:
#   "5'10|160lbs"  (apostrophe between feet and inches)
#   "6'2"170lbs"   (apostrophe + double-quote)
#   "5°8\"|175bs"  (degree sign instead of apostrophe, "bs" missing 'l')
#   "61|194lbs"    (apostrophe stripped → 5'1 reads as 51 / 61)
# Heuristic: a short string containing "lbs" or "bs" (after one or more
# digits + optional vertical bar) is a height/weight indicator.
_HEIGHT_WEIGHT_RE = re.compile(
    r"^\d+\s*['′’‚°\"]?\s*\d*\s*[|]?\s*\d+\s*l?bs?$|"
    r"\d['′’‚°\"]\d.*l?bs?",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# PositionGrid — geometric inference of missing position labels
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PositionGrid:
    """A cluster of left-strip rows with known or inferred position labels.

    Each slot maps a position label (e.g. "C", "LW") to its Y pixel coordinate
    and a confidence value:
      - 1.0 for detected (RapidOCR actually read the label)
      - 0.7 for inferred (computed from canonical order + median spacing)

    ``detected_count`` is the number of anchors that were directly detected
    (as opposed to inferred by extrapolation).
    """

    slots: tuple[tuple[str, float, float], ...]
    """Tuple of (position_label, y_center, confidence) for each slot in this cluster."""

    detected_count: int
    """Number of slots with confidence == 1.0 (detected, not inferred)."""


def build_position_grids(
    detected_anchors: list[OCRLine],
    *,
    canonical_order: tuple[str, ...] = _CANONICAL_LINEUP_6S,
) -> list[PositionGrid]:
    """Build PositionGrid objects from detected position-label OCR lines.

    Algorithm:
      1. Sort anchors by Y.
      2. Cluster anchors: a Y-gap > 2× median inter-anchor spacing starts a
         new cluster. This separates BGM rows from opponent rows when the two
         groups appear in the left strip with a large visual gap between them.
      3. Per cluster: map each detected position to its canonical-order index
         to compute median spacing. Extrapolate the Y positions for undetected
         slots.
      4. Reject clusters where the spacing standard deviation / median > 30%.
      5. A cluster with fewer than _GRID_MIN_DETECTED_LABELS (2) detected
         labels is not enough to infer spacing reliably — return no grid for
         that cluster.

    Parameters
    ----------
    detected_anchors:
        List of OCRLine objects that qualified as position-label anchors
        (i.e. returned by ``_extract_anchor_lines`` + ``_bucket_anchors``).
    canonical_order:
        The canonical position order to use for index mapping and
        extrapolation. Defaults to 6v6 (C/LW/RW/LD/RD/G).

    Returns
    -------
    list[PositionGrid]
        One PositionGrid per cluster (may be empty if no clusters qualify).
    """
    if not detected_anchors:
        return []

    # Sort by Y
    sorted_anchors = sorted(detected_anchors, key=lambda a: a.y_center)

    # Compute spacings between adjacent anchors to determine cluster threshold
    if len(sorted_anchors) >= 2:
        spacings = [
            sorted_anchors[i + 1].y_center - sorted_anchors[i].y_center
            for i in range(len(sorted_anchors) - 1)
        ]
        median_spacing = statistics.median(spacings)
        cluster_gap_threshold = _GRID_CLUSTER_GAP_MULTIPLIER * median_spacing
    else:
        # Only 1 anchor — nothing to cluster
        return []

    # Cluster anchors
    clusters: list[list[OCRLine]] = []
    current_cluster = [sorted_anchors[0]]
    for anchor in sorted_anchors[1:]:
        gap = anchor.y_center - current_cluster[-1].y_center
        if gap > cluster_gap_threshold:
            clusters.append(current_cluster)
            current_cluster = [anchor]
        else:
            current_cluster.append(anchor)
    clusters.append(current_cluster)

    grids: list[PositionGrid] = []
    for cluster in clusters:
        grid = _build_grid_for_cluster(cluster, canonical_order)
        if grid is not None:
            grids.append(grid)
    return grids


def _build_grid_for_cluster(
    cluster: list[OCRLine],
    canonical_order: tuple[str, ...],
) -> PositionGrid | None:
    """Build a PositionGrid for a single cluster of anchors.

    Returns None if the cluster doesn't qualify for inference (too few detected
    labels, inconsistent spacing, or all positions already detected with no
    inference needed but < 2 detected labels).
    """
    if len(cluster) < _GRID_MIN_DETECTED_LABELS:
        # Only 1 detected label — can't determine spacing reliably
        # Still emit a grid with just the detected label at its actual Y.
        if len(cluster) == 1:
            a = cluster[0]
            pos = a.text.strip().upper().replace(" ", "")
            if pos in _POS_SET:
                return PositionGrid(
                    slots=((pos, a.y_center, a.confidence),),
                    detected_count=1,
                )
        return None

    # Map detected positions to canonical indices
    pos_to_y: dict[str, float] = {}
    for a in cluster:
        pos = a.text.strip().upper().replace(" ", "")
        if pos in _POS_SET:
            pos_to_y[pos] = a.y_center

    if len(pos_to_y) < _GRID_MIN_DETECTED_LABELS:
        return None

    # Find the canonical indices of the detected positions
    detected_indices: list[int] = []
    for i, pos in enumerate(canonical_order):
        if pos in pos_to_y:
            detected_indices.append(i)

    if len(detected_indices) < _GRID_MIN_DETECTED_LABELS:
        return None

    # Compute median spacing between adjacent detected canonical positions
    detected_y_values = [pos_to_y[canonical_order[i]] for i in detected_indices]
    index_gaps = [detected_indices[j + 1] - detected_indices[j] for j in range(len(detected_indices) - 1)]
    y_gaps = [detected_y_values[j + 1] - detected_y_values[j] for j in range(len(detected_y_values) - 1)]

    # Normalize to per-slot spacing (gap in Y / gap in canonical index)
    per_slot_spacings = [y_g / i_g for y_g, i_g in zip(y_gaps, index_gaps) if i_g > 0]
    if not per_slot_spacings:
        return None

    median_per_slot = statistics.median(per_slot_spacings)
    if len(per_slot_spacings) > 1:
        try:
            stddev = statistics.stdev(per_slot_spacings)
        except statistics.StatisticsError:
            stddev = 0.0
        if median_per_slot > 0 and stddev / median_per_slot > _GRID_MAX_SPACING_VARIANCE_RATIO:
            # Inconsistent spacing — reject this cluster
            return None

    # Use the first detected position as the reference anchor
    ref_canonical_idx = detected_indices[0]
    ref_y = detected_y_values[0]

    # Determine the full range of canonical positions to cover:
    # - Always include all positions between first and last detected (gap filling)
    # - Extrapolate to the edges of canonical_order if the outermost Y values
    #   are consistent with the spacing (i.e., the cluster looks like it represents
    #   a full lineup where the boundary positions weren't OCR'd).
    #
    # We use a simple heuristic: extend 1 slot beyond each detected endpoint
    # when the cluster spacing is consistent (already validated above).
    min_idx = max(0, detected_indices[0] - 1)
    max_idx = min(len(canonical_order) - 1, detected_indices[-1] + 1)

    # Build slots for all canonical positions in the extended range
    slots: list[tuple[str, float, float]] = []
    for i in range(min_idx, max_idx + 1):
        pos = canonical_order[i]
        # Compute Y by extrapolating from reference
        y = ref_y + (i - ref_canonical_idx) * median_per_slot
        if pos in pos_to_y:
            # Use detected Y and full confidence
            slots.append((pos, pos_to_y[pos], 1.0))
        else:
            # Use inferred Y and reduced confidence
            slots.append((pos, y, _INFERRED_POSITION_CONFIDENCE))

    detected_count = sum(1 for s in slots if s[2] == 1.0)
    return PositionGrid(slots=tuple(slots), detected_count=detected_count)


def position_for_row_y(
    row_y: float,
    grids: list[PositionGrid],
    *,
    tolerance_px: float = 35.0,
) -> tuple[str, float] | None:
    """Find the position label and confidence for a row at the given Y coordinate.

    Searches all grids for the slot whose Y is closest to ``row_y`` within
    ``tolerance_px``.

    Parameters
    ----------
    row_y:
        The Y center of the row to look up.
    grids:
        The list of PositionGrid objects to search.
    tolerance_px:
        Maximum Y distance between row_y and a grid slot Y to count as a match.
        Default 35 px (slightly less than half the typical 80px row spacing).

    Returns
    -------
    tuple[str, float] | None
        (position_label, confidence) if a match is found, else None.
    """
    best: tuple[str, float] | None = None
    best_dist = float("inf")
    for grid in grids:
        for pos, slot_y, conf in grid.slots:
            dist = abs(slot_y - row_y)
            if dist < tolerance_px and dist < best_dist:
                best_dist = dist
                best = (pos, conf)
    return best


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
    # Phase D: raw visual gold-★ score for this row on THIS frame (None when
    # scored without a frame image). Used by loadout_bundle._merge_identities to
    # resolve captain by cross-frame argmax, overriding the first-True collapse.
    captain_star_score: Optional[float] = None

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
    def _is_hud_label(text: str) -> bool:
        normalized = "".join(c for c in text.upper() if c.isalpha())
        return normalized in _HUD_LABELS_NORMALIZED

    candidates = [
        l for l in ocr_lines
        if l.y_center < _GAMERTAG_Y_MAX and l.x_center > _GAMERTAG_X_MIN
        and l.text.strip()
        and any(c.isalpha() for c in l.text)
        and not _is_hud_label(l.text.strip())  # reject EA SPORTS branding etc.
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
    _parse_content_into_evidence(evidence, content_lines)
    return evidence


def _parse_row_evidence_no_anchor(content_lines: list[OCRLine]) -> dict:
    """Extract evidence from content lines when no position-label anchor is available.

    Same as _parse_row_evidence but without a position-label anchor to parse.
    The position fields default to None and are expected to be filled by the
    PositionGrid caller.
    """
    evidence: dict = {
        "position": None,
        "position_confidence": None,
        "jersey_number": None,
        "jersey_confidence": None,
        "player_name_full": None,
        "player_name_confidence": None,
        "is_captain": None,
        "is_captain_confidence": None,
        "player_level_raw": None,
        "player_level_confidence": None,
    }
    _parse_content_into_evidence(evidence, content_lines)
    return evidence


def _persona_name_from_summary(text: str) -> str | None:
    """Extract a persona name from an AWAY-format summary line (``Name-#NN``).

    The AWAY left strip lists the persona name BEFORE the jersey number with no
    leading dash (e.g. ``"Drew P Hog-#69"``) — a layout neither ``_NAME_RE``
    (number first) nor ``_NAME_RE_OPP`` (leading dash) matches, which is why
    away-side personas read as None before Phase E. Returns the cleaned name, or
    None if the line is not a name+jersey summary or reduces to a non-name token
    (level / height-weight / HUD label / team-name header).
    """
    # Only a persona-summary line that pairs a name with a "#NN" jersey qualifies.
    if not _PERSONA_SUMMARY_RE.search(text) or not _NUMBER_RE.search(text):
        return None
    # Reuse the gamertag-skip guards so a non-name row is never read as a persona
    # (the persona-summary + jersey gate already excludes most of these).
    if _LEVEL_RE.search(text) or _BARE_LEVEL_RE.match(text):
        return None
    if _HEIGHT_WEIGHT_RE.search(text):
        return None
    # Drop the "#NN" jersey token and surrounding separators; keep the name.
    name = _NUMBER_RE.sub("", text).strip(" -–.")
    if not name or not any(c.isalpha() for c in name):
        return None
    # Team-header / HUD checks run on the cleaned name: a header carrying a
    # stray "-#N" would pass the digit-bailing header heuristic on raw text.
    if _looks_like_team_name_header(name):
        return None
    if "".join(c for c in name.upper() if c.isalpha()) in _HUD_LABELS_NORMALIZED:
        return None
    return name


def _parse_content_into_evidence(evidence: dict, content_lines: list[OCRLine]) -> None:
    """Populate evidence dict in-place from content_lines (shared by both parse helpers)."""
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

        # Full name — three left-strip layouts:
        #   HOME "#NN - Name"  -> _NAME_RE (number first)
        #   OPP  "-Name-#NN"   -> _NAME_RE_OPP (leading dash)
        #   AWAY "Name-#NN"    -> _persona_name_from_summary (no leading dash; Phase E)
        if evidence["player_name_full"] is None:
            m_name = _NAME_RE.search(text)
            full_name: str | None = None
            if m_name:
                full_name = m_name.group(1).strip(". ")
            else:
                m_opp = _NAME_RE_OPP.match(text)
                if m_opp:
                    full_name = m_opp.group(1).strip(". ")
                else:
                    full_name = _persona_name_from_summary(text)
            if full_name:
                evidence["player_name_full"] = full_name
                evidence["player_name_confidence"] = line.confidence


def _find_content_row_ys(ocr_lines: Sequence[OCRLine]) -> list[float]:
    """Find distinct Y positions that have content in the row content band.

    Returns sorted list of Y center positions that are likely row centers,
    bucketed by ROW_Y_BUCKET_TOLERANCE_PX to avoid duplicates.
    """
    # Collect all lines in the content band
    content_lines = [
        l for l in ocr_lines
        if _ROW_CONTENT_X_MIN < l.x_center < _ROW_CONTENT_X_MAX
        and _POS_Y_MIN < l.y_center < _POS_Y_MAX
    ]
    if not content_lines:
        return []

    # Bucket Y positions
    sorted_ys = sorted(set(round(l.y_center) for l in content_lines))
    bucketed: list[float] = []
    for y in sorted_ys:
        if not bucketed or y - bucketed[-1] > ROW_Y_BUCKET_TOLERANCE_PX:
            bucketed.append(float(y))

    return bucketed


def _extract_gamertag_from_content_lines(
    content_lines: list[OCRLine],
) -> tuple[str, float] | None:
    """Extract the best gamertag candidate from a set of content lines.

    Returns (gamertag_text, confidence) or None if no gamertag found.
    Filters out lines that match level patterns, number patterns,
    persona summaries (``#NN-Name`` and ``-Name-#NN``), HUD labels
    (HOME/AWAY/CHEL/etc.), height/weight indicators, and empty strings.
    """
    for line in sorted(content_lines, key=lambda l: l.confidence, reverse=True):
        text = line.text.strip()
        if not text:
            continue
        # Skip level lines
        if _LEVEL_RE.search(text):
            continue
        # Skip pure number/jersey patterns
        if _NUMBER_RE.match(text):
            continue
        # Skip lines that are mostly numeric
        if text.replace("#", "").replace("-", "").replace(" ", "").isdigit():
            continue
        # Skip short single-char strings (position labels that leaked into content band)
        if len(text) <= 1:
            continue
        # Must have at least one alphabetic character
        if not any(c.isalpha() for c in text):
            continue
        # Skip persona-summary indicators ("#11-Evgeni Wanhg", "-Toews-#19",
        # "Pat Magroyne-#23"): these appear on the row BELOW the gamertag
        # and must not become their own slot.
        if _PERSONA_SUMMARY_RE.search(text):
            continue
        # Skip height/weight indicators that leak into the content band.
        if _HEIGHT_WEIGHT_RE.search(text):
            continue
        # Skip standalone level fragments ("LVL34") that escape _LEVEL_RE.
        if _BARE_LEVEL_RE.match(text):
            continue
        # Skip team-name headers (e.g. "THE BOOGEYMEN") that appear at the
        # top of the left strip.
        if _looks_like_team_name_header(text):
            continue
        # Skip HUD labels (HOME, AWAY, CHEL, X-FACTORS, etc.).
        normalized = "".join(c for c in text.upper() if c.isalpha())
        if normalized in _HUD_LABELS_NORMALIZED:
            continue
        return text, line.confidence
    return None


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
      4. Build PositionGrids from detected anchors (for position inference).
      5. Fuzzy-match the subject's gamertag against each anchor's row content.
         For rows not containing a detected anchor, scan all content rows and
         also try PositionGrid lookup for position inference.
      6. Harvest position/jersey/player_name/is_captain from the matched row.
         If the row's anchor didn't have a recognized position, use
         position_for_row_y() to infer position from the grid.
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

    # Step 4: Build PositionGrids for position inference
    grids = build_position_grids(anchors)

    # Step 5: Match the subject's gamertag against each anchor's row
    gt_normalized = _normalize_tag(gamertag_text)
    subject_anchor: OCRLine | None = None
    subject_anchor_y: float | None = None
    subject_content_lines: list[OCRLine] = []
    subject_inferred_position: tuple[str, float] | None = None

    # First pass: try rows with detected anchors
    for anchor in anchors:
        content_lines = _row_content_lines(ocr_lines, anchor.y_center)
        joined_norm = _normalize_tag(" ".join(l.text for l in content_lines))
        if _fuzzy_gamertag_match(gt_normalized, joined_norm):
            subject_anchor = anchor
            subject_anchor_y = anchor.y_center
            subject_content_lines = content_lines
            break

    # Second pass: if not found via anchors, scan content rows directly and
    # use PositionGrid to infer position for the matched row.
    if subject_anchor is None and grids:
        # Collect all distinct Y positions that have content lines in the
        # gamertag band.  We don't need an anchor line to identify the row.
        candidate_ys = _find_content_row_ys(ocr_lines)
        for row_y in candidate_ys:
            content_lines = _row_content_lines(ocr_lines, row_y)
            if not content_lines:
                continue
            joined_norm = _normalize_tag(" ".join(l.text for l in content_lines))
            if _fuzzy_gamertag_match(gt_normalized, joined_norm):
                subject_anchor_y = row_y
                subject_content_lines = content_lines
                # No OCR anchor for this row — look up position from grid
                inferred = position_for_row_y(row_y, grids)
                if inferred is not None:
                    subject_inferred_position = inferred
                break

    # Step 6: Harvest evidence from the matched row (or emit partial identity)
    if subject_anchor is not None or subject_anchor_y is not None:
        if subject_anchor is not None:
            evidence = _parse_row_evidence(subject_anchor, subject_content_lines)
            anchor_y_int = int(round(subject_anchor.y_center))
            # Override position if anchor didn't detect one but grid can infer it
            if evidence["position"] is None and grids:
                inferred = position_for_row_y(subject_anchor.y_center, grids)
                if inferred is not None:
                    evidence["position"] = inferred[0]
                    evidence["position_confidence"] = inferred[1]
        else:
            # No detected anchor for this row — synthesize evidence
            evidence = _parse_row_evidence_no_anchor(subject_content_lines)
            anchor_y_int = int(round(subject_anchor_y))  # type: ignore[arg-type]
            if subject_inferred_position is not None:
                evidence["position"] = subject_inferred_position[0]
                evidence["position_confidence"] = subject_inferred_position[1]

        # Phase D: when frame pixels are available, the visual gold-★ score is
        # the authoritative captain signal — it overrides the text-glyph result
        # harvested above (which did not discriminate true from false).
        captain_star = _score_row_captain_star(image_bgr, anchor_y_int)
        if captain_star is not None:
            evidence["is_captain"] = captain_star >= CAPTAIN_STAR_THRESHOLD
            evidence["is_captain_confidence"] = captain_star

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
            captain_star_score=captain_star,
            build_class_raw=build_class_raw,
            build_class_confidence=build_class_conf,
            player_level_raw=evidence["player_level_raw"],
            player_level_confidence=evidence["player_level_confidence"],
            anchor_y=anchor_y_int,
            observability=observability,
        )
    else:
        # No left-strip row matched the gamertag. Two sub-cases:
        #
        # (a) Title bar has a build_class — likely a real subject whose
        #     row OCR was weak; emit partial identity so downstream can
        #     try to dedupe across frames via gamertag fuzzy-match.
        # (b) No build_class either — this is almost certainly a transient
        #     frame (menu transition, loading screen, scrolling between
        #     screens) where the top-right caught a stray bit of text but
        #     no real subject is shown. Drop the identity entirely to
        #     avoid polluting bundle aggregation with spurious "PORTS"-
        #     style fragments.
        if not build_class_raw:
            return None
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


def extract_roster_only_identities(
    image_bgr,  # numpy.ndarray (H, W, 3) BGR — accepted but not used currently
    *,
    ocr_lines: Sequence[OCRLine],
    subject_gamertag: str | None,
    grids: list[PositionGrid],
) -> list[SubjectIdentity]:
    """Extract identity-only entries for left-strip rows that are NOT the subject.

    For each visible content row whose gamertag does NOT fuzzy-match the subject:
      - Extract gamertag, position (via PositionGrid), jersey, name, level, is_captain
      - build_class_raw = None (no right-pane data for non-selected players)
      - observability = 'observable' if confident; else 'low_quality'

    Parameters
    ----------
    image_bgr:
        Frame image (not currently used; reserved for future pixel-level heuristics).
    ocr_lines:
        OCR lines for the frame.
    subject_gamertag:
        The subject's gamertag (to exclude from roster-only results).
        If None, all rows are treated as non-subject rows.
    grids:
        Pre-built PositionGrid list for this frame (from build_position_grids).

    Returns
    -------
    list[SubjectIdentity]
        One SubjectIdentity per non-subject row that could be identified with a
        gamertag.  Entries have build_class_raw=None and anchor_y set to the
        row's Y center.  Empty list if no non-subject rows are found.
    """
    subject_norm = _normalize_tag(subject_gamertag) if subject_gamertag else None

    raw_anchors = _extract_anchor_lines(ocr_lines)
    anchors = _bucket_anchors(raw_anchors)

    # Collect rows from detected anchors first
    processed_ys: set[int] = set()
    result: list[SubjectIdentity] = []

    for anchor in anchors:
        content_lines = _row_content_lines(ocr_lines, anchor.y_center)
        anchor_y_int = int(round(anchor.y_center))

        # Find the best gamertag candidate in this row
        gamertag_candidate = _extract_gamertag_from_content_lines(content_lines)
        if gamertag_candidate is None:
            processed_ys.add(anchor_y_int)
            continue

        gt_text, gt_conf = gamertag_candidate
        gt_norm = _normalize_tag(gt_text)

        # Skip if this row is the subject
        if subject_norm and _fuzzy_gamertag_match(subject_norm, gt_norm):
            processed_ys.add(anchor_y_int)
            continue

        # Build evidence from the row
        evidence = _parse_row_evidence(anchor, content_lines)
        # Override position if anchor didn't detect one but grid can infer it
        if evidence["position"] is None and grids:
            inferred = position_for_row_y(anchor.y_center, grids)
            if inferred is not None:
                evidence["position"] = inferred[0]
                evidence["position_confidence"] = inferred[1]

        has_useful_evidence = any([
            evidence["position"] is not None and (evidence["position_confidence"] or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
            evidence["jersey_number"] is not None and (evidence["jersey_confidence"] or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
            (gt_conf or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
        ])
        observability = "observable" if has_useful_evidence else "low_quality"

        # Phase D: visual gold-★ score overrides the text-glyph captain result
        # (a captain may be roster-only — never navigated as the subject).
        captain_star = _score_row_captain_star(image_bgr, anchor_y_int)
        if captain_star is not None:
            evidence["is_captain"] = captain_star >= CAPTAIN_STAR_THRESHOLD
            evidence["is_captain_confidence"] = captain_star

        result.append(SubjectIdentity(
            gamertag=gt_text,
            gamertag_confidence=gt_conf,
            position=evidence["position"],
            position_confidence=evidence["position_confidence"],
            jersey_number=evidence["jersey_number"],
            jersey_confidence=evidence["jersey_confidence"],
            player_name_full=evidence["player_name_full"],
            player_name_confidence=evidence["player_name_confidence"],
            is_captain=evidence["is_captain"],
            is_captain_confidence=evidence["is_captain_confidence"],
            captain_star_score=captain_star,
            build_class_raw=None,       # no right-pane data for non-selected rows
            build_class_confidence=None,
            player_level_raw=evidence["player_level_raw"],
            player_level_confidence=evidence["player_level_confidence"],
            anchor_y=anchor_y_int,
            observability=observability,
        ))
        processed_ys.add(anchor_y_int)

    # Also scan content rows whose Y wasn't covered by a detected anchor
    if grids:
        candidate_ys = _find_content_row_ys(ocr_lines)
        for row_y in candidate_ys:
            row_y_int = int(round(row_y))
            # Skip if already processed via a detected anchor
            if any(abs(row_y_int - py) <= ROW_Y_BUCKET_TOLERANCE_PX for py in processed_ys):
                continue
            content_lines = _row_content_lines(ocr_lines, row_y)
            if not content_lines:
                continue
            gamertag_candidate = _extract_gamertag_from_content_lines(content_lines)
            if gamertag_candidate is None:
                continue
            gt_text, gt_conf = gamertag_candidate
            gt_norm = _normalize_tag(gt_text)
            if subject_norm and _fuzzy_gamertag_match(subject_norm, gt_norm):
                continue
            # Try grid position lookup
            inferred = position_for_row_y(row_y, grids)
            evidence = _parse_row_evidence_no_anchor(content_lines)
            if inferred is not None:
                evidence["position"] = inferred[0]
                evidence["position_confidence"] = inferred[1]
            has_useful_evidence = any([
                evidence["position"] is not None and (evidence["position_confidence"] or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
                evidence["jersey_number"] is not None and (evidence["jersey_confidence"] or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
                (gt_conf or 0) >= _EVIDENCE_CONFIDENCE_THRESHOLD,
            ])
            observability = "observable" if has_useful_evidence else "low_quality"
            # Phase D: visual gold-★ score overrides the text-glyph captain result.
            captain_star = _score_row_captain_star(image_bgr, row_y_int)
            if captain_star is not None:
                evidence["is_captain"] = captain_star >= CAPTAIN_STAR_THRESHOLD
                evidence["is_captain_confidence"] = captain_star
            result.append(SubjectIdentity(
                gamertag=gt_text,
                gamertag_confidence=gt_conf,
                position=evidence["position"],
                position_confidence=evidence["position_confidence"],
                jersey_number=evidence["jersey_number"],
                jersey_confidence=evidence["jersey_confidence"],
                player_name_full=evidence["player_name_full"],
                player_name_confidence=evidence["player_name_confidence"],
                is_captain=evidence["is_captain"],
                is_captain_confidence=evidence["is_captain_confidence"],
                captain_star_score=captain_star,
                build_class_raw=None,
                build_class_confidence=None,
                player_level_raw=evidence["player_level_raw"],
                player_level_confidence=evidence["player_level_confidence"],
                anchor_y=row_y_int,
                observability=observability,
            ))
            processed_ys.add(row_y_int)

    return result


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
