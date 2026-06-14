"""Pre-game lobby row grouping.

Lifts the position-anchor row-grouping logic from
`parsers.py::parse_lobby_team` so both the legacy parser and the typed
evidence extractor can converge on one implementation. No behavior change vs
the legacy code paths the constants and helpers came from — see git blame on
`parsers.py` between lines 82-228 of the pre-Phase-3b version for the
original logic.

The lobby UI shows both teams' rosters side-by-side at fixed x-bands. Each
roster has 6 player rows (C / LW / RW / LD / RD / G) anchored by position
labels at the panel edges. The row's data lines (gamertag, build_class,
level, #NN, h/w, etc.) sit within ±45 px of the anchor's y_center.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from game_ocr.ocr import OCRLine

# ─── Constants ──────────────────────────────────────────────────────────────

LOBBY_POSITION_TOKENS = {"C", "LW", "RW", "LD", "RD", "G"}

# Top-of-panel team-side labels — picked up as topmost OCR'd text on border
# rows and historically mis-classified as gamertag (e.g. opp goalie slot
# rendered as a player named "Away"). Treated as junk by downstream extractors.
LOBBY_TEAM_SIDE_LABELS = {"HOME", "AWAY"}

# Canonical row order top-to-bottom on the panel.
LOBBY_CANONICAL_ROW_ORDER = ["C", "LW", "RW", "LD", "RD", "G"]

# Panel x-bands. Numbers calibrated on the 1920×1080 NHL 26 UI; lifted from
# the original `parse_pre_game_result` invocation in parsers.py.
BGM_PANEL_X_RANGE: tuple[float, float] = (85, 410)
OPP_PANEL_X_RANGE: tuple[float, float] = (1500, 1825)
BGM_ANCHOR_X_MAX: float = 130  # BGM position labels at far left (x_center ~77)
OPP_ANCHOR_X_MIN: float = 1820  # Opp position labels at far right (x_center ~1844)

# Vertical band where lobby rows live (excludes top header strip + bottom
# READY-UP banner / countdown bar).
_LOBBY_Y_MIN = 250
_LOBBY_Y_MAX = 980

# Row-band tolerance: data lines belonging to a row sit within this many
# pixels of the position anchor's y_center. Phase 3d tightened 45 → 35
# (each row is ~88 px tall; half is 44, leaving 9 px margin) to reduce
# within-frame cross-row bleed while still catching off-canonical OCR.
_LOBBY_ROW_BAND_PX = 35

# Default y-gap between adjacent rows when only one anchor was OCR'd.
_LOBBY_DEFAULT_ROW_GAP_PX = 88.0

# Canonical y_center positions for the 6 lobby rows at 1920×1080 NHL 26 UI.
# Empirically observed from match-250 + match-463 OCR evidence: BGM and opp
# panels share the same y origins; only the x-band differs. Rows are spaced
# ~88 px apart. Used by `relabel_anchors_to_canonical` to fix frames where
# OCR detected a position label at the wrong y (e.g. "LW" detected at the C
# row's y because the position labels jittered up one row). NOTE: if a
# future resolution differs from 1920×1080, this map needs adjustment.
LOBBY_CANONICAL_ROW_YS: dict[str, float] = {
    "C": 318.0,
    "LW": 406.0,
    "RW": 493.0,
    "LD": 582.0,
    "RD": 670.0,
    "G": 757.0,
}

# When a detected position label sits more than this many pixels from the
# canonical y for its labeled position, trust geometry over OCR: relabel
# the anchor to the position whose canonical y is closest. 35 ≈ half a
# row gap minus margin — wider than typical resolution jitter (~5 px) but
# tight enough that a full-row shift (88 px) always trips relabeling.
_LOBBY_ANCHOR_SNAP_TOLERANCE_PX = 35.0

_LOBBY_HASH_RE = re.compile(r"#\d{1,3}")


# ─── Types ──────────────────────────────────────────────────────────────────

TeamSide = Literal["our_team", "opponent_team"]
PanelState = Literal["state_1", "state_2"]


@dataclass(frozen=True)
class LobbyRow:
    """One per-team-per-position row from a lobby frame.

    Attributes:
        team_side: 'our_team' (BGM, left panel) or 'opponent_team' (right panel).
        position: One of {C, LW, RW, LD, RD, G}.
        anchor: The OCRLine that anchored the row (real or synthesized).
        anchor_y: Convenience copy of `anchor.y_center` (synthetic anchors are
            constructed to land at the inferred row centre even when the OCR
            backend failed to read the position label).
        row_lines: OCR lines inside the row band (±45 px of anchor_y) and
            within the panel's x-band.
        panel_state: 'state_1' (build class visible) or 'state_2' (#NN +
            persona visible) for the row's TEAM panel as a whole — derived
            from the per-panel #NN regex count.
    """

    team_side: TeamSide
    position: str
    anchor: OCRLine
    anchor_y: float
    row_lines: list[OCRLine]
    panel_state: PanelState


# ─── Helpers (public for downstream use) ────────────────────────────────────


def detect_panel_state(panel_lines: list[OCRLine]) -> PanelState:
    """Per-team state detection by `#NN` pattern count.

    state_2 (identity state) shows `#11 - E. Wanhg` per row → fully rendered
    panels emit 5 hash patterns on a 6v6 lobby. state_1 (class state) shows
    build class names instead.
    """
    joined = " ".join(line.text for line in panel_lines)
    n_hash = len(_LOBBY_HASH_RE.findall(joined))
    return "state_2" if n_hash >= 3 else "state_1"


def relabel_anchors_to_canonical(detected: list[OCRLine]) -> list[OCRLine]:
    """Trust geometry over OCR label when they disagree by >tolerance.

    OCR sometimes reads a position label at the wrong y. On match 250 BGM
    panel the position labels jittered up by one row in a subset of frames,
    so e.g. "LW" was detected at y=298 (close to C's canonical y=318), then
    every downstream row was attributed one slot up — landing real LW data
    in the lobby_for_C slot's evidence bucket and so on.

    When a detected anchor sits more than `_LOBBY_ANCHOR_SNAP_TOLERANCE_PX`
    from the canonical y for its labeled position, this helper relabels the
    anchor to the position whose canonical y is closest. If that target
    position already has a well-placed real anchor in the same frame, the
    misplaced anchor is dropped instead (the synthesizer downstream will
    fill its original-label position with a canonical-y synthetic anchor).

    Returns the relabeled anchor list. Anchors whose OCR-read text isn't a
    canonical position token (defensive) pass through unchanged.
    """
    # First pass: identify which positions have a well-placed real anchor.
    well_placed: set[str] = set()
    for a in detected:
        ocr_label = a.text.strip().upper().replace(" ", "")
        if ocr_label not in LOBBY_CANONICAL_ROW_YS:
            continue
        dist = abs(LOBBY_CANONICAL_ROW_YS[ocr_label] - a.y_center)
        if dist <= _LOBBY_ANCHOR_SNAP_TOLERANCE_PX:
            well_placed.add(ocr_label)

    out: list[OCRLine] = []
    for a in detected:
        ocr_label = a.text.strip().upper().replace(" ", "")
        if ocr_label not in LOBBY_CANONICAL_ROW_YS:
            out.append(a)
            continue
        dist_own = abs(LOBBY_CANONICAL_ROW_YS[ocr_label] - a.y_center)
        if dist_own <= _LOBBY_ANCHOR_SNAP_TOLERANCE_PX:
            out.append(a)
            continue
        # Out of tolerance — find nearest canonical position by y.
        new_label = min(
            LOBBY_CANONICAL_ROW_YS,
            key=lambda p: abs(LOBBY_CANONICAL_ROW_YS[p] - a.y_center),
        )
        # If that position already has a well-placed real anchor, drop this
        # misplaced one — letting the synthesizer fill the original slot
        # from canonical y. Avoids fighting two anchors for the same slot.
        if new_label in well_placed:
            continue
        out.append(
            OCRLine(
                text=new_label,
                confidence=a.confidence * 0.5,  # halve: we overrode the label
                x1=a.x1, x2=a.x2, y1=a.y1, y2=a.y2,
            )
        )
    return out


def position_for_row_y(
    row_y: float,
    *,
    tolerance_px: float = _LOBBY_ANCHOR_SNAP_TOLERANCE_PX,
) -> str | None:
    """Return the canonical lobby position whose y is closest to ``row_y``.

    Ported from the loadout extractor's grid-Y contract
    (``loadout_extractors/slot_identity.py::position_for_row_y``), specialised
    to the fixed lobby grid ``LOBBY_CANONICAL_ROW_YS``. Position is treated as a
    GEOMETRIC property of where the row sits on the panel, not as a function of
    the OCR-read anchor text. `group_rows_for_panel` uses this so a row's
    assigned position always agrees with the y-band that selected its data
    lines — closing the lobby-slot scramble where a misread label (or a
    synthesized anchor that landed off its canonical y) bound the right values
    to the wrong slot (docs/ocr/lobby-slot-scramble-extractor-followup.md).

    Returns the closest position label within ``tolerance_px``, or None when
    ``row_y`` is further than the tolerance from every canonical row (the caller
    then falls back to the anchor text).
    """
    best: str | None = None
    best_dist = float("inf")
    for pos, slot_y in LOBBY_CANONICAL_ROW_YS.items():
        dist = abs(slot_y - row_y)
        if dist < tolerance_px and dist < best_dist:
            best_dist = dist
            best = pos
    return best


def fill_missing_position_anchors(detected: list[OCRLine]) -> list[OCRLine]:
    """Synthesize anchors for rows whose position label RapidOCR failed to read.

    Single-character labels (notably 'C') don't always get tokenized even when
    the row is fully visible. We extrapolate the missing y_center from the
    median gap between detected anchors (fallback 88 px) and emit a synthetic
    OCRLine with confidence=0.0 so callers can choose to down-weight if
    needed.

    Returns the (possibly-augmented) anchor list, sorted by y_center, in
    canonical row order, clipped to the panel's vertical range.
    """
    if not detected:
        return []
    detected_set = {a.text.strip().upper().replace(" ", "") for a in detected}
    gaps = [
        detected[i + 1].y_center - detected[i].y_center
        for i in range(len(detected) - 1)
    ]
    median_gap = sorted(gaps)[len(gaps) // 2] if gaps else _LOBBY_DEFAULT_ROW_GAP_PX
    canonical_index = {pos: i for i, pos in enumerate(LOBBY_CANONICAL_ROW_ORDER)}
    anchored = sorted(
        detected,
        key=lambda l: canonical_index.get(l.text.strip().upper().replace(" ", ""), 999),
    )
    ref = anchored[0]
    ref_label = ref.text.strip().upper().replace(" ", "")
    ref_idx = canonical_index.get(ref_label, 0)

    # Phase 3d: prefer canonical-y as the synthesis reference when the ref
    # anchor is itself well-placed (post-relabel). This breaks the
    # "topmost-anchor-drift propagation" failure where a slightly-off ref
    # would shift every synthesized row by the same offset.
    ref_canonical_y = LOBBY_CANONICAL_ROW_YS.get(ref_label)
    if (
        ref_canonical_y is not None
        and abs(ref.y_center - ref_canonical_y) <= _LOBBY_ANCHOR_SNAP_TOLERANCE_PX
    ):
        synthesis_base_y = ref_canonical_y
    else:
        synthesis_base_y = ref.y_center

    result: list[OCRLine] = []
    for i, pos in enumerate(LOBBY_CANONICAL_ROW_ORDER):
        if pos in detected_set:
            real = next(
                l for l in detected
                if l.text.strip().upper().replace(" ", "") == pos
            )
            result.append(real)
            continue
        synth_y = synthesis_base_y + (i - ref_idx) * median_gap
        result.append(
            OCRLine(
                text=pos,
                confidence=0.0,
                x1=ref.x1,
                x2=ref.x2,
                y1=synth_y - 12,
                y2=synth_y + 12,
            )
        )
    result.sort(key=lambda l: l.y_center)
    return [l for l in result if _LOBBY_Y_MIN < l.y_center < _LOBBY_Y_MAX]


# ─── Single-panel grouping (used by legacy parse_lobby_team + detect_lobby_rows) ──


def group_rows_for_panel(
    all_lines: list[OCRLine],
    *,
    team_side: TeamSide,
    panel_x_range: tuple[float, float],
    anchor_x_max: float | None = None,
    anchor_x_min: float | None = None,
) -> tuple[list[LobbyRow], list[OCRLine], PanelState]:
    """Group the OCR lines of one team panel into rows.

    Args:
        all_lines: Full-frame OCR output.
        team_side: 'our_team' (BGM panel) or 'opponent_team'.
        panel_x_range: x-band of the panel's data lines (gamertag, build,
            level, etc.).
        anchor_x_max: Position labels are at x_center < this value (BGM ≈ 130).
        anchor_x_min: Position labels are at x_center > this value (Opp ≈ 1820).
            Exactly one of anchor_x_min / anchor_x_max must be set.

    Returns:
        rows: One LobbyRow per detected (or synthesized) position anchor,
              sorted by y_center.
        panel_lines: All OCR lines within the panel's x-band and vertical
              range — caller can use this for raw_lines / state-detection
              audits.
        state: 'state_1' or 'state_2' per `detect_panel_state`.
    """
    if (anchor_x_max is None) == (anchor_x_min is None):
        raise ValueError("Provide exactly one of anchor_x_min or anchor_x_max")

    detected_anchors: list[OCRLine] = []
    for line in all_lines:
        if line.text.strip().upper().replace(" ", "") not in LOBBY_POSITION_TOKENS:
            continue
        if not (_LOBBY_Y_MIN < line.y_center < _LOBBY_Y_MAX):
            continue
        if anchor_x_max is not None and line.x_center > anchor_x_max:
            continue
        if anchor_x_min is not None and line.x_center < anchor_x_min:
            continue
        detected_anchors.append(line)
    detected_anchors.sort(key=lambda l: l.y_center)
    # Phase 3d: relabel anchors whose detected y disagrees with their OCR-read
    # position label by more than the tolerance. Closes the match-250 BGM
    # one-row-up shift where "LW" was detected at C's row y.
    detected_anchors = relabel_anchors_to_canonical(detected_anchors)
    anchors = fill_missing_position_anchors(detected_anchors)

    panel_lines = [
        line for line in all_lines
        if panel_x_range[0] <= line.x_center <= panel_x_range[1]
        and _LOBBY_Y_MIN < line.y_center < _LOBBY_Y_MAX
    ]
    state = detect_panel_state(panel_lines)

    rows: list[LobbyRow] = []
    for anchor in anchors:
        # Phase C: derive position GEOMETRICALLY from the anchor's y-center
        # against the canonical row grid, NOT from the OCR-read anchor text.
        # The same y selects this row's data lines below, so grid-Y lookup
        # keeps position and data consistent even when a label is misread or a
        # synthesized anchor lands off its canonical y (the lobby-slot scramble
        # — docs/ocr/lobby-slot-scramble-extractor-followup.md). Falls back to
        # the OCR text only when the anchor sits outside every canonical row.
        geometric = position_for_row_y(anchor.y_center)
        position = (
            geometric
            if geometric is not None
            else anchor.text.strip().upper().replace(" ", "")
        )
        row_lines = [
            line for line in all_lines
            if abs(line.y_center - anchor.y_center) < _LOBBY_ROW_BAND_PX
            and panel_x_range[0] <= line.x_center <= panel_x_range[1]
        ]
        rows.append(
            LobbyRow(
                team_side=team_side,
                position=position,
                anchor=anchor,
                anchor_y=anchor.y_center,
                row_lines=row_lines,
                panel_state=state,
            )
        )
    return rows, panel_lines, state


# ─── Both-panel grouping (used by the typed evidence extractor) ─────────────


def detect_lobby_rows(all_lines: list[OCRLine]) -> list[LobbyRow]:
    """Return up to 12 rows (6 BGM + 6 opp) from a full-frame OCR pass.

    Anchors that couldn't be detected get synthesized rows with zero-confidence
    anchors; callers must inspect `row.anchor.confidence` if they need to
    distinguish observed-vs-synthetic anchors.
    """
    bgm_rows, _, _ = group_rows_for_panel(
        all_lines,
        team_side="our_team",
        panel_x_range=BGM_PANEL_X_RANGE,
        anchor_x_max=BGM_ANCHOR_X_MAX,
    )
    opp_rows, _, _ = group_rows_for_panel(
        all_lines,
        team_side="opponent_team",
        panel_x_range=OPP_PANEL_X_RANGE,
        anchor_x_min=OPP_ANCHOR_X_MIN,
    )
    return [*bgm_rows, *opp_rows]
