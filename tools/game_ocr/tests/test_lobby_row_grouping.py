"""Tests for the lobby row-grouping module.

`detect_lobby_rows` lifts the position-anchor row-grouping logic out of the
legacy parser. These tests synthesize lobby OCR frames and assert that the
right number of rows are emitted with correct team_side, position, and row
content. The legacy `parse_pre_game_result` tests in test_parsers.py exercise
the same logic through the legacy adapter — both must stay green.
"""

from __future__ import annotations

import unittest

from game_ocr.lobby_extractors.row_grouping import (
    BGM_ANCHOR_X_MAX,
    BGM_PANEL_X_RANGE,
    LOBBY_CANONICAL_ROW_ORDER,
    OPP_ANCHOR_X_MIN,
    OPP_PANEL_X_RANGE,
    detect_lobby_rows,
    detect_panel_state,
    fill_missing_position_anchors,
    group_rows_for_panel,
)
from game_ocr.ocr import OCRLine


def _line(text: str, x_center: float, y_center: float, conf: float = 0.95) -> OCRLine:
    return OCRLine(
        text=text,
        confidence=conf,
        x1=x_center - 30,
        x2=x_center + 30,
        y1=y_center - 12,
        y2=y_center + 12,
    )


def _full_state2_frame() -> list[OCRLine]:
    """Synthesize a fully rendered state_2 frame: 6 anchors per panel + #NN persona lines."""
    lines: list[OCRLine] = []
    # Position-label anchors (BGM at x_center=77, Opp at x_center=1844).
    # Row y_centers: 300, 388, 476, 564, 652, 740 (88-px gap).
    for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
        y = 300 + i * 88
        lines.append(_line(position, 77, y))
        lines.append(_line(position, 1844, y))
    # state_2 markers: #NN-persona per row, both panels.
    for i in range(6):
        y = 300 + i * 88
        # BGM panel data lines.
        lines.append(_line(f"BgmGT{i}", 250, y - 8, conf=0.92))
        lines.append(_line(f"#{10 + i}-Persona{i}", 250, y + 6))
        # Opp panel data lines.
        lines.append(_line(f"OppGT{i}", 1700, y - 8, conf=0.92))
        lines.append(_line(f"#{20 + i}-OppPersona{i}", 1700, y + 6))
    return lines


class LobbyRowGroupingTests(unittest.TestCase):
    def test_full_state2_frame_emits_12_rows(self) -> None:
        rows = detect_lobby_rows(_full_state2_frame())
        self.assertEqual(len(rows), 12)
        bgm = [r for r in rows if r.team_side == "our_team"]
        opp = [r for r in rows if r.team_side == "opponent_team"]
        self.assertEqual(len(bgm), 6)
        self.assertEqual(len(opp), 6)
        self.assertEqual([r.position for r in bgm], LOBBY_CANONICAL_ROW_ORDER)
        self.assertEqual([r.position for r in opp], LOBBY_CANONICAL_ROW_ORDER)
        for row in rows:
            self.assertEqual(row.panel_state, "state_2")

    def test_row_lines_constrained_to_panel_x_band(self) -> None:
        rows = detect_lobby_rows(_full_state2_frame())
        bgm_first = next(r for r in rows if r.team_side == "our_team")
        # BGM row content should sit in the BGM x-band only.
        for line in bgm_first.row_lines:
            self.assertTrue(
                BGM_PANEL_X_RANGE[0] <= line.x_center <= BGM_PANEL_X_RANGE[1],
                msg=f"BGM row contains OOB line: {line}",
            )

    def test_state_1_detection_when_no_hash_patterns(self) -> None:
        # Build a frame with only build-class text (no #NN), should detect state_1.
        lines: list[OCRLine] = []
        for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
            y = 300 + i * 88
            lines.append(_line(position, 77, y))
            lines.append(_line("Playmaker", 250, y + 5))
        rows = detect_lobby_rows(lines)
        bgm = [r for r in rows if r.team_side == "our_team"]
        for row in bgm:
            self.assertEqual(row.panel_state, "state_1")

    def test_synthesizes_missing_position_anchor(self) -> None:
        # Build a panel that is missing the "C" anchor — fill_missing should
        # synthesize a zero-confidence anchor at the inferred y.
        detected = [
            _line("LW", 77, 388),
            _line("RW", 77, 476),
            _line("LD", 77, 564),
            _line("RD", 77, 652),
            _line("G", 77, 740),
        ]
        filled = fill_missing_position_anchors(detected)
        self.assertEqual(len(filled), 6)
        positions = [a.text.strip().upper() for a in filled]
        self.assertEqual(positions, LOBBY_CANONICAL_ROW_ORDER)
        c_anchor = next(a for a in filled if a.text.strip().upper() == "C")
        self.assertEqual(c_anchor.confidence, 0.0, "synthetic anchor should be zero-confidence")
        # Inferred y should be ≈ 300 (388 - 88).
        self.assertAlmostEqual(c_anchor.y_center, 300, delta=5)

    def test_detect_panel_state_state_2_threshold(self) -> None:
        # Three #NN patterns → state_2.
        lines = [_line(f"#{10 + i}-X", 250, 300 + i * 88) for i in range(3)]
        self.assertEqual(detect_panel_state(lines), "state_2")
        # Two → state_1.
        lines = lines[:2]
        self.assertEqual(detect_panel_state(lines), "state_1")

    def test_group_rows_for_panel_requires_exactly_one_anchor_bound(self) -> None:
        with self.assertRaises(ValueError):
            group_rows_for_panel(
                [],
                team_side="our_team",
                panel_x_range=BGM_PANEL_X_RANGE,
                anchor_x_max=BGM_ANCHOR_X_MAX,
                anchor_x_min=OPP_ANCHOR_X_MIN,
            )
        with self.assertRaises(ValueError):
            group_rows_for_panel(
                [],
                team_side="our_team",
                panel_x_range=BGM_PANEL_X_RANGE,
            )

    def test_partial_panel_emits_fewer_rows(self) -> None:
        # Only the first three positions are present in the OCR output. The
        # synthesizer should still emit 6 BGM rows (filling in the missing 3
        # with zero-confidence anchors). Opp panel has zero anchors so emits 0.
        lines = [_line(p, 77, 300 + i * 88) for i, p in enumerate(["C", "LW", "RW"])]
        # Add a #NN line so the BGM panel is detected as state_2.
        lines.append(_line("#11-Foo", 250, 305))
        lines.append(_line("#12-Bar", 250, 393))
        lines.append(_line("#13-Baz", 250, 481))
        rows = detect_lobby_rows(lines)
        bgm = [r for r in rows if r.team_side == "our_team"]
        opp = [r for r in rows if r.team_side == "opponent_team"]
        self.assertEqual(len(bgm), 6)  # synthesized to fill out the 6
        self.assertEqual(len(opp), 0)


if __name__ == "__main__":
    unittest.main()
