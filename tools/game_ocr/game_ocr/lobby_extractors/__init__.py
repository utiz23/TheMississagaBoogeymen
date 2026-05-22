"""Phase 3b lobby extractor package.

Public surface:
    LobbyRow                       — frozen dataclass; one row per (team_side, position)
    detect_lobby_rows              — group full-frame OCR lines into up to 12 lobby rows
    group_rows_for_panel           — single-panel row grouping (used by legacy parse_lobby_team)
    detect_panel_state             — per-team state_1 vs state_2 detection by #NN count
    fill_missing_position_anchors  — synthesize anchors for un-OCR'd position labels
    LOBBY_POSITION_TOKENS          — {C, LW, RW, LD, RD, G}
    LOBBY_TEAM_SIDE_LABELS         — {HOME, AWAY}
    LOBBY_CANONICAL_ROW_ORDER      — [C, LW, RW, LD, RD, G]
    BGM_PANEL_X_RANGE              — x-band of the our-team panel
    OPP_PANEL_X_RANGE              — x-band of the opponent panel
    BGM_ANCHOR_X_MAX               — position labels are at x_center below this
    OPP_ANCHOR_X_MIN               — position labels are at x_center above this
"""

from .row_grouping import (
    BGM_ANCHOR_X_MAX,
    BGM_PANEL_X_RANGE,
    LOBBY_CANONICAL_ROW_ORDER,
    LOBBY_POSITION_TOKENS,
    LOBBY_TEAM_SIDE_LABELS,
    LobbyRow,
    OPP_ANCHOR_X_MIN,
    OPP_PANEL_X_RANGE,
    detect_lobby_rows,
    detect_panel_state,
    fill_missing_position_anchors,
    group_rows_for_panel,
)
from .slot_identity import (
    CAPTAIN_GLYPHS,
    LobbySubjectIdentity,
    identify_lobby_subjects,
    slot_key_for,
)

__all__ = [
    "BGM_ANCHOR_X_MAX",
    "BGM_PANEL_X_RANGE",
    "CAPTAIN_GLYPHS",
    "LOBBY_CANONICAL_ROW_ORDER",
    "LOBBY_POSITION_TOKENS",
    "LOBBY_TEAM_SIDE_LABELS",
    "LobbyRow",
    "LobbySubjectIdentity",
    "OPP_ANCHOR_X_MIN",
    "OPP_PANEL_X_RANGE",
    "detect_lobby_rows",
    "detect_panel_state",
    "fill_missing_position_anchors",
    "group_rows_for_panel",
    "identify_lobby_subjects",
    "slot_key_for",
]
