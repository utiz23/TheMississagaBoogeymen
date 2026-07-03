"""Tests for `lobby_extractors.slot_identity`.

Synthetic OCR fixtures exercise the per-row field extraction. The legacy
parser's behavior on the same line shapes is the spec: gamertag cleaning,
#NN-Persona regex, LVL extraction, captain ★ + READY glyph detection,
state_1 build-class detection, measurement parsing.
"""

from __future__ import annotations

import unittest

from game_ocr.lobby_extractors.row_grouping import (
    LOBBY_CANONICAL_ROW_ORDER,
    detect_lobby_rows,
)
from game_ocr.lobby_extractors.slot_identity import (
    CAPTAIN_GLYPHS,
    LobbySubjectIdentity,
    _demote_cross_team_duplicates,
    identify_lobby_subjects,
    slot_key_for,
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


def _state2_frame() -> list[OCRLine]:
    """6 BGM + 6 opp anchors with #NN-Persona + gamertag per row."""
    lines: list[OCRLine] = []
    for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
        y = 300 + i * 88
        lines.append(_line(position, 77, y))
        lines.append(_line(position, 1844, y))
        # BGM panel rows.
        lines.append(_line(f"BgmGT{i}", 250, y - 12))
        lines.append(_line(f"#{10 + i}-Persona{i}", 250, y + 10))
        # Opp panel rows.
        lines.append(_line(f"OppGT{i}", 1700, y - 12))
        lines.append(_line(f"#{20 + i}-OppPersona{i}", 1700, y + 10))
    return lines


class SlotKeyTests(unittest.TestCase):
    def test_slot_key_for_our_team(self) -> None:
        self.assertEqual(slot_key_for("our_team", "C"), "lobby_for_C")
        self.assertEqual(slot_key_for("our_team", "LD"), "lobby_for_LD")

    def test_slot_key_for_opponent_team(self) -> None:
        self.assertEqual(slot_key_for("opponent_team", "G"), "lobby_against_G")


class IdentifyLobbySubjectsTests(unittest.TestCase):
    def test_full_state2_frame_emits_12_subjects(self) -> None:
        rows = detect_lobby_rows(_state2_frame())
        subjects = identify_lobby_subjects(rows)
        self.assertEqual(len(subjects), 12)
        for s in subjects:
            self.assertEqual(s.panel_state, "state_2")
            self.assertFalse(s.is_empty_or_cpu)

    def test_state2_extracts_player_number_and_persona(self) -> None:
        rows = detect_lobby_rows(_state2_frame())
        subjects = identify_lobby_subjects(rows)
        bgm_c = next(s for s in subjects if s.slot_key == "lobby_for_C")
        self.assertEqual(bgm_c.player_number, 10)
        self.assertEqual(bgm_c.player_name_persona, "Persona0")
        # Opponent G is the 5th row (index 5), so #25-OppPersona5.
        opp_g = next(s for s in subjects if s.slot_key == "lobby_against_G")
        self.assertEqual(opp_g.player_number, 25)
        self.assertEqual(opp_g.player_name_persona, "OppPersona5")

    def test_state2_extracts_gamertag(self) -> None:
        rows = detect_lobby_rows(_state2_frame())
        subjects = identify_lobby_subjects(rows)
        bgm_c = next(s for s in subjects if s.slot_key == "lobby_for_C")
        self.assertEqual(bgm_c.gamertag, "BgmGT0")
        opp_lw = next(s for s in subjects if s.slot_key == "lobby_against_LW")
        self.assertEqual(opp_lw.gamertag, "OppGT1")

    def test_cpu_row_marked_empty_and_skipped(self) -> None:
        # BGM panel: G row is CPU.
        lines = _state2_frame()
        lines.append(_line("CPU", 250, 740, 0.97))
        rows = detect_lobby_rows(lines)
        subjects = identify_lobby_subjects(rows)
        bgm_g = next(s for s in subjects if s.slot_key == "lobby_for_G")
        self.assertTrue(bgm_g.is_empty_or_cpu)
        self.assertIsNone(bgm_g.gamertag)

    def test_captain_glyph_concatenated_into_gamertag(self) -> None:
        # Synthesize a row where gamertag line has ★ glyph + READY chip
        # concatenated by RapidOCR (e.g. "XZ4RKY★READY"). Anchor at canonical
        # LW y so the Phase 3d relabeler preserves the LW label.
        lines = [
            _line("LW", 77, 406),
            _line("XZ4RKY★READY", 250, 396),
            _line("#11-E. Wanhg", 250, 414),
        ]
        rows = detect_lobby_rows(lines)
        bgm_rows = [r for r in rows if r.team_side == "our_team"]
        subjects = identify_lobby_subjects(bgm_rows)
        lw = next(s for s in subjects if s.position == "LW")
        self.assertEqual(lw.gamertag, "XZ4RKY")
        self.assertTrue(lw.is_captain)
        self.assertTrue(lw.is_ready)

    def test_non_captain_row_emits_confident_false(self) -> None:
        # A row with a real gamertag but no ★ glyph anywhere should resolve
        # is_captain=False (not None), so the lobby snapshot can definitively
        # distinguish non-captains from "not observed".
        lines = [
            _line("C", 77, 318),
            _line("MrHomiecide", 250, 308),
            _line("#11-E.Wanhg", 250, 326),
        ]
        rows = detect_lobby_rows(lines)
        bgm_rows = [r for r in rows if r.team_side == "our_team"]
        subjects = identify_lobby_subjects(bgm_rows)
        c = next(s for s in subjects if s.position == "C")
        self.assertEqual(c.gamertag, "MrHomiecide")
        self.assertEqual(c.is_captain, False, "non-captain row must emit False, not None")
        self.assertIsNotNone(c.is_captain_confidence)

    def test_unresolved_gamertag_row_leaves_captain_unobserved(self) -> None:
        # Row with no resolvable gamertag (only position + noise) must NOT
        # emit a confident "not captain" — semantic claim only makes sense
        # for real players. is_captain stays None.
        lines = [
            _line("LW", 77, 406),
            # No real gamertag candidate — just stray non-identity lines.
            _line("Sniper", 250, 396),  # filtered by build-class vocab
        ]
        rows = detect_lobby_rows(lines)
        bgm_rows = [r for r in rows if r.team_side == "our_team"]
        subjects = identify_lobby_subjects(bgm_rows)
        lw = next(s for s in subjects if s.position == "LW")
        self.assertIsNone(lw.gamertag)
        self.assertIsNone(lw.is_captain, "no-real-player row must leave is_captain unobserved")

    def test_frame_star_drives_is_captain_true(self) -> None:
        # Phase D: with the frame pixels available, a real gold ★ at the row's
        # captain ROI drives is_captain=True and the star score becomes the
        # confidence. Proves the ROI plumbing (panel x-band + anchor_y).
        import cv2
        import numpy as np

        from game_ocr.lobby_extractors.slot_identity import _captain_star_roi
        lines = [
            _line("C", 77, 318),
            _line("MrHomiecide", 250, 308),
            _line("#11-E.Wanhg", 250, 326),
        ]
        rows = [r for r in detect_lobby_rows(lines) if r.team_side == "our_team"]
        cx, cy, _ = _captain_star_roi(rows[0].anchor_y, (85, 410), "our_team")
        frame = np.full((1080, 1920, 3), (20, 20, 20), dtype=np.uint8)
        cv2.circle(frame, (cx, cy), 12, (0, 200, 255), -1)  # gold disc
        subjects = identify_lobby_subjects(rows, frame_bgr=frame)
        c = next(s for s in subjects if s.position == "C")
        self.assertTrue(c.is_captain)
        self.assertIsNotNone(c.captain_star_score)
        self.assertGreaterEqual(c.captain_star_score, 0.5)
        self.assertEqual(c.is_captain_confidence, c.captain_star_score)

    def test_frame_without_star_drives_is_captain_false(self) -> None:
        import numpy as np
        lines = [
            _line("C", 77, 318),
            _line("MrHomiecide", 250, 308),
            _line("#11-E.Wanhg", 250, 326),
        ]
        rows = [r for r in detect_lobby_rows(lines) if r.team_side == "our_team"]
        frame = np.full((1080, 1920, 3), (20, 20, 20), dtype=np.uint8)  # no star
        subjects = identify_lobby_subjects(rows, frame_bgr=frame)
        c = next(s for s in subjects if s.position == "C")
        self.assertEqual(c.is_captain, False)
        self.assertEqual(c.captain_star_score, 0.0)

    def test_frame_visual_score_overrides_text_glyph_false_positive(self) -> None:
        # The Phase D thesis: a stray ★ in the OCR text must NOT make a starless
        # row captain once the visual score is authoritative.
        import numpy as np
        lines = [
            _line("C", 77, 318),
            _line("MrHomiecide★", 250, 308),
            _line("#11-E.Wanhg", 250, 326),
        ]
        rows = [r for r in detect_lobby_rows(lines) if r.team_side == "our_team"]
        frame = np.full((1080, 1920, 3), (20, 20, 20), dtype=np.uint8)  # no star
        subjects = identify_lobby_subjects(rows, frame_bgr=frame)
        c = next(s for s in subjects if s.position == "C")
        self.assertEqual(c.gamertag, "MrHomiecide")  # glyph still stripped
        self.assertEqual(c.is_captain, False, "visual score must override text glyph FP")

    def test_level_extraction(self) -> None:
        lines = [
            _line("C", 77, 300),
            _line("PlayerX", 250, 290),
            _line("P1LVL17", 250, 310),
        ]
        rows = detect_lobby_rows(lines)
        subjects = identify_lobby_subjects([r for r in rows if r.team_side == "our_team"])
        c = next(s for s in subjects if s.position == "C")
        self.assertEqual(c.player_level_number, 17)
        self.assertEqual(c.player_level_raw, "P1LVL17")

    def test_measurements_extraction(self) -> None:
        # Anchor at canonical RW y (493) so Phase 3d relabeler preserves it.
        lines = [
            _line("RW", 77, 493),
            _line("PlayerY", 250, 483),
            _line("6'0\"|160lbs", 250, 513),
        ]
        rows = detect_lobby_rows(lines)
        subjects = identify_lobby_subjects([r for r in rows if r.team_side == "our_team"])
        rw = next(s for s in subjects if s.position == "RW")
        self.assertEqual(rw.height_text, "6'0\"")
        self.assertEqual(rw.weight_lbs, 160)

    def test_state1_extracts_build_class(self) -> None:
        # State_1 = no #NN patterns. The build-class line "Sniper" should
        # populate build_class_raw.
        lines = [
            _line("C", 77, 300),
            _line("MrHomicide", 250, 290),
            _line("Sniper", 250, 310),
        ]
        rows = detect_lobby_rows(lines)
        bgm = [r for r in rows if r.team_side == "our_team"]
        self.assertEqual(bgm[0].panel_state, "state_1")
        subjects = identify_lobby_subjects(bgm)
        c = next(s for s in subjects if s.position == "C")
        self.assertEqual(c.build_class_raw, "Sniper")

    def test_position_confidence_propagated(self) -> None:
        rows = detect_lobby_rows(_state2_frame())
        subjects = identify_lobby_subjects(rows)
        for s in subjects:
            # All anchors in the fixture are real (conf=0.95), not synthesized.
            self.assertGreater(s.position_confidence, 0.5)


class GamertagJunkFilterTests(unittest.TestCase):
    """Phase 3c: gamertag candidate filtering rejects UI labels + build-class strings.

    Both rejection paths fall through to the next candidate in the row's
    y-stack. The real gamertag is expected to be the topmost line that
    survives all filters.
    """

    def test_rejects_ui_label_viewingloadouts(self) -> None:
        # "VIEWING LOADOUTS" appears as a top-of-row OCR line in some match
        # 250 captures. Expectation: filter rejects it; real gamertag wins.
        # NOTE: filter normalizes via strip().upper().replace(" ", "") so
        # "VIEWING LOADOUTS" → "VIEWINGLOADOUTS" which IS in the denylist.
        lines = [
            _line("C", 77, 300),
            _line("VIEWING LOADOUTS", 250, 285),   # y=285 (topmost)
            _line("MrHomiecide", 250, 295),          # real gamertag
            _line("#11-E.Wanhg", 250, 310),
        ]
        rows = detect_lobby_rows(lines)
        bgm_rows = [r for r in rows if r.team_side == "our_team"]
        subjects = identify_lobby_subjects(bgm_rows)
        c = next(s for s in subjects if s.position == "C")
        self.assertEqual(c.gamertag, "MrHomiecide")

    def test_rejects_ui_label_chel(self) -> None:
        # "CHEL" picked up from the NHL CHEL header on some opp-panel
        # captures. Same expectation as above. Anchor at canonical RD y (670).
        lines = [
            _line("RD", 1844, 670),
            _line("CHEL", 1700, 655),                # topmost
            _line("shadowassault20", 1700, 665),     # real gamertag
            _line("#56-A.Player", 1700, 680),
        ]
        rows = detect_lobby_rows(lines)
        opp_rows = [r for r in rows if r.team_side == "opponent_team"]
        subjects = identify_lobby_subjects(opp_rows)
        rd = next(s for s in subjects if s.position == "RD")
        self.assertEqual(rd.gamertag, "shadowassault20")

    def test_rejects_build_class_as_gamertag(self) -> None:
        # In a state_1 frame where the build-class line wasn't pre-extracted
        # (or appears AGAIN above the gamertag), closed-vocab match rejects
        # it. Real gamertag wins. Anchor at canonical RD y (670).
        lines = [
            _line("RD", 77, 670),
            _line("Puck Moving Defenseman", 250, 655),  # build class as topmost
            _line("JoeyFlopfish", 250, 665),               # real gamertag
            _line("#48-L.Hutson", 250, 680),
        ]
        rows = detect_lobby_rows(lines)
        bgm_rows = [r for r in rows if r.team_side == "our_team"]
        subjects = identify_lobby_subjects(bgm_rows)
        rd = next(s for s in subjects if s.position == "RD")
        self.assertEqual(rd.gamertag, "JoeyFlopfish")

    def test_rejects_themed_build_class_abbreviation(self) -> None:
        # `MatthewTkachuk-PWF` is a themed build class with the suffix
        # abbreviation form. The vocab's `^.*[-\s]PWF$` alias should match.
        lines = [
            _line("C", 77, 300),
            _line("MatthewTkachuk-PWF", 250, 285),   # themed build class
            _line("Stick Menace", 250, 295),           # real gamertag
            _line("#96-M.Rantanen", 250, 310),
        ]
        rows = detect_lobby_rows(lines)
        bgm_rows = [r for r in rows if r.team_side == "our_team"]
        subjects = identify_lobby_subjects(bgm_rows)
        c = next(s for s in subjects if s.position == "C")
        self.assertEqual(c.gamertag, "Stick Menace")


class CrossTeamDuplicateDedupTests(unittest.TestCase):
    """Phase 3: cross-team gamertag duplicates are structurally CPU placeholders.

    A real human gamertag cannot appear on both rosters of the same EASHL
    lobby simultaneously, so any cross-team duplicate is an EA test-database
    CPU placeholder (e.g. 'XZ4RKY' for match 250, 'bad' for match 968) that
    OCR mistakenly read as text instead of detecting the CPU marker.
    """

    @staticmethod
    def _subject(
        team_side: str,
        position: str,
        gamertag,
        *,
        is_empty_or_cpu: bool = False,
    ) -> LobbySubjectIdentity:
        return LobbySubjectIdentity(
            slot_key=slot_key_for(team_side, position),  # type: ignore[arg-type]
            team_side=team_side,  # type: ignore[arg-type]
            position=position,
            position_confidence=0.95,
            is_empty_or_cpu=is_empty_or_cpu,
            gamertag=gamertag,
            gamertag_confidence=0.9 if gamertag is not None else None,
            anchor_y=300,
            panel_state="state_2",
        )

    def test_cross_team_dedup_demotes_both_sides(self) -> None:
        subjects = [
            self._subject("our_team", "G", "XZ4RKY"),
            self._subject("opponent_team", "C", "XZ4RKY"),
        ]
        out = _demote_cross_team_duplicates(subjects)
        bgm_g = next(s for s in out if s.slot_key == "lobby_for_G")
        opp_c = next(s for s in out if s.slot_key == "lobby_against_C")
        self.assertTrue(bgm_g.is_empty_or_cpu)
        self.assertIsNone(bgm_g.gamertag)
        self.assertTrue(opp_c.is_empty_or_cpu)
        self.assertIsNone(opp_c.gamertag)

    def test_cross_team_dedup_preserves_unique_gamertags(self) -> None:
        # 6 BGM positions × 6 opp positions with unique gamertags each.
        positions = list(LOBBY_CANONICAL_ROW_ORDER)
        subjects: list[LobbySubjectIdentity] = []
        for i, pos in enumerate(positions):
            subjects.append(self._subject("our_team", pos, f"BgmPlayer{i}"))
            subjects.append(self._subject("opponent_team", pos, f"OppPlayer{i}"))
        out = _demote_cross_team_duplicates(subjects)
        self.assertEqual(len(out), 12)
        for s in out:
            self.assertFalse(
                s.is_empty_or_cpu,
                msg=f"slot {s.slot_key} was wrongly demoted",
            )

    def test_cross_team_dedup_tolerates_whitespace_and_case(self) -> None:
        subjects = [
            self._subject("our_team", "G", "XZ4 RKY"),
            self._subject("opponent_team", "C", "xz4rky"),
        ]
        out = _demote_cross_team_duplicates(subjects)
        for s in out:
            self.assertTrue(
                s.is_empty_or_cpu,
                msg=f"slot {s.slot_key} should have been demoted",
            )
            self.assertIsNone(s.gamertag)

    def test_cross_team_dedup_skips_short_gamertags(self) -> None:
        # Single-char "?" duplicated across teams is OCR noise, NOT a CPU
        # placeholder — length-3 floor protects against false positives on
        # legitimately-empty / poorly-read slots.
        subjects = [
            self._subject("our_team", "G", "?"),
            self._subject("opponent_team", "C", "?"),
        ]
        out = _demote_cross_team_duplicates(subjects)
        for s in out:
            self.assertFalse(
                s.is_empty_or_cpu,
                msg=f"short-string slot {s.slot_key} must not be demoted",
            )

    def test_cross_team_dedup_skips_already_cpu_subjects(self) -> None:
        # A subject already flagged is_empty_or_cpu (literal "CPU" string)
        # has gamertag=None; the post-processor must skip it cleanly and
        # leave it in its existing CPU shape.
        already_cpu = self._subject(
            "our_team", "G", None, is_empty_or_cpu=True,
        )
        other = self._subject("opponent_team", "C", "RealPlayer")
        out = _demote_cross_team_duplicates([already_cpu, other])
        bgm_g = next(s for s in out if s.slot_key == "lobby_for_G")
        opp_c = next(s for s in out if s.slot_key == "lobby_against_C")
        self.assertTrue(bgm_g.is_empty_or_cpu)
        self.assertIsNone(bgm_g.gamertag)
        self.assertFalse(opp_c.is_empty_or_cpu)
        self.assertEqual(opp_c.gamertag, "RealPlayer")


class IdentifyLobbySubjectsCrossTeamDedupIntegrationTests(unittest.TestCase):
    def test_identify_lobby_subjects_demotes_cross_team_duplicates(self) -> None:
        # Build a 12-row state_2 frame, then mutate BGM-G AND opp-C gamertags
        # to both read "XZ4RKY". After identify_lobby_subjects + post-processor,
        # both should be demoted to CPU; the other 10 must remain real.
        lines: list[OCRLine] = []
        # BGM-G is row index 5 (positions: C, LW, RW, LD, RD, G), opp-C is
        # row index 0 on the opponent panel.
        for i, position in enumerate(LOBBY_CANONICAL_ROW_ORDER):
            y = 300 + i * 88
            lines.append(_line(position, 77, y))
            lines.append(_line(position, 1844, y))
            # BGM panel: G (i==5) gets XZ4RKY; everyone else gets unique tag.
            bgm_gt = "XZ4RKY" if position == "G" else f"BgmGT{i}"
            lines.append(_line(bgm_gt, 250, y - 12))
            lines.append(_line(f"#{10 + i}-Persona{i}", 250, y + 10))
            # Opp panel: C (i==0) gets XZ4RKY; everyone else gets unique tag.
            opp_gt = "XZ4RKY" if position == "C" else f"OppGT{i}"
            lines.append(_line(opp_gt, 1700, y - 12))
            lines.append(_line(f"#{20 + i}-OppPersona{i}", 1700, y + 10))

        subjects = identify_lobby_subjects(detect_lobby_rows(lines))
        self.assertEqual(len(subjects), 12)

        bgm_g = next(s for s in subjects if s.slot_key == "lobby_for_G")
        opp_c = next(s for s in subjects if s.slot_key == "lobby_against_C")
        self.assertTrue(bgm_g.is_empty_or_cpu)
        self.assertTrue(opp_c.is_empty_or_cpu)

        other_slots = [
            s for s in subjects
            if s.slot_key not in {"lobby_for_G", "lobby_against_C"}
        ]
        self.assertEqual(len(other_slots), 10)
        for s in other_slots:
            self.assertFalse(
                s.is_empty_or_cpu,
                msg=f"slot {s.slot_key} wrongly demoted (gamertag={s.gamertag!r})",
            )


if __name__ == "__main__":
    unittest.main()
