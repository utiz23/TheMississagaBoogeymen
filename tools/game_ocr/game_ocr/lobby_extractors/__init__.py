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

"""Phase 3b lobby extractor package.

Public surface lives in two submodules:

- ``row_grouping`` — `LobbyRow`, `detect_lobby_rows`, `group_rows_for_panel`,
  `detect_panel_state`, `fill_missing_position_anchors`, plus panel x-band
  + position-token constants. This module has minimal dependencies and is
  safe to import from anywhere (including ``game_ocr.parsers``).

- ``slot_identity`` — `LobbySubjectIdentity`, `identify_lobby_subjects`,
  `slot_key_for`, `CAPTAIN_GLYPHS`. Pulls in `loadout_extractors.open_text`
  for the gamertag ROI extractor. Importing this transitively loads
  `loadout_extractors`, which in turn imports `parsers._classify_xfactor_tier`
  — so callers that themselves live inside ``game_ocr.parsers`` must import
  from ``row_grouping`` directly (not via this package's ``__init__``) to
  avoid a partial-initialisation cycle.

This ``__init__`` therefore re-exports ONLY the row-grouping surface. Users
who need slot identity import the submodule explicitly:

    from game_ocr.lobby_extractors.slot_identity import identify_lobby_subjects
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

__all__ = [
    "BGM_ANCHOR_X_MAX",
    "BGM_PANEL_X_RANGE",
    "LOBBY_CANONICAL_ROW_ORDER",
    "LOBBY_POSITION_TOKENS",
    "LOBBY_TEAM_SIDE_LABELS",
    "LobbyRow",
    "OPP_ANCHOR_X_MIN",
    "OPP_PANEL_X_RANGE",
    "detect_lobby_rows",
    "detect_panel_state",
    "fill_missing_position_anchors",
    "group_rows_for_panel",
]
