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
# pixels of the position anchor's y_center.
_LOBBY_ROW_BAND_PX = 45

# Default y-gap between adjacent rows when only one anchor was OCR'd.
_LOBBY_DEFAULT_ROW_GAP_PX = 88.0

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
    ref_idx = canonical_index.get(ref.text.strip().upper().replace(" ", ""), 0)

    result: list[OCRLine] = []
    for i, pos in enumerate(LOBBY_CANONICAL_ROW_ORDER):
        if pos in detected_set:
            real = next(
                l for l in detected
                if l.text.strip().upper().replace(" ", "") == pos
            )
            result.append(real)
            continue
        synth_y = ref.y_center + (i - ref_idx) * median_gap
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
    anchors = fill_missing_position_anchors(detected_anchors)

    panel_lines = [
        line for line in all_lines
        if panel_x_range[0] <= line.x_center <= panel_x_range[1]
        and _LOBBY_Y_MIN < line.y_center < _LOBBY_Y_MAX
    ]
    state = detect_panel_state(panel_lines)

    rows: list[LobbyRow] = []
    for anchor in anchors:
        position = anchor.text.strip().upper().replace(" ", "")
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
